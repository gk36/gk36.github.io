#!/usr/bin/env python3
"""
CRAZAY UGC CONCEPT GENERATOR V6
===============================
Reads a notepad full of "AI PROMPT:" blocks and makes one PNG per prompt with
OpenAI's Images API (gpt-image-2 / gpt-image-2.5 flare & sunburst).

V6 = V4's "keep trying until it works" behaviour + V5's features (encrypted
key, resume manifest, model check, background, xhigh/max) + a hardened network
layer so long xhigh/max renders stop dropping.

Why V5 missed images
--------------------
V5 treated every dropped connection ("ConnectionError") as "held for review"
and never retried it, so each network blip during a long render became a
missing image. V4 simply retried, which is why it looked more consistent.

What V6 does so it never misses one
-----------------------------------
* The real cause of V5's (and the first V6's) misses: requests applies its
  *connect* timeout (15s in V5, 30s in V6) to uploading the request body, so
  every prompt's multi-MB reference images had to finish uploading inside it.
  V6 now streams request bodies in small blocks (only a real stall fails) and,
  by default, uploads the references ONCE to OpenAI's Files API and sends each
  prompt as a few KB of JSON — falling back to per-prompt uploads by itself if
  OpenAI refuses that.
* TCP keep-alive on every request (probe after 30s idle, then every 10s) so
  routers, mobile hotspots, VPNs and antivirus/firewalls don't silently kill a
  connection that sits quiet for minutes while an xhigh/max image renders.
* Dropped connections, timeouts, 429 and 5xx are retried with backoff
  (default 6 retries per image). A 429 pauses ALL workers together.
* Keep-alive streaming (auto): after the first dropped connection the rest of
  the batch uses streamed replies (small partial previews keep bytes moving).
  Falls back by itself if a model refuses streaming.
* Repair passes: after the batch, anything still missing is queued again.
* Every image is integrity-checked (PNG chunk CRCs) before it is saved, and
  Generate / Resume skips prompts that already have a verified image.
* Safety blocks at the output stage get one more try (each render differs).

Run by double-clicking (opens the window) or from a terminal:
    python ugc_concept_generator_v6.py
CLI mode (no window):
    python ugc_concept_generator_v6.py --cli --prompts prompts.txt --out concepts
Self-test (no API calls):
    python ugc_concept_generator_v6.py --selftest
Needs:  pip install requests
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import hashlib
import io
import json
import math
import os
import queue
import random
import re
import socket
import struct
import sys
import threading
import time
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.filepost import encode_multipart_formdata
except ImportError:
    print("Missing dependency. Run:  pip install requests")
    sys.exit(1)

APP_TITLE = "Crazay Studio · UGC Concept Generator V6"
API_ROOT = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-image-2"
MODEL_CHOICES = [
    "gpt-image-2", "gpt-image-2-2026-04-21",
    "gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08",
    "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08",
    "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini",
]
QUALITY_CHOICES = ["low", "medium", "high", "xhigh", "max", "auto"]
SIZE_CHOICES = ["1536x1024", "2048x1152", "1024x1024", "1024x1536", "1152x2048", "auto"]
BACKGROUND_CHOICES = ["auto", "opaque", "transparent"]
STREAM_CHOICES = ["auto", "on", "off"]
FIDELITY_CHOICES = ["default", "high", "low"]
MODERATION_CHOICES = ["auto", "low"]
REF_UPLOAD_CHOICES = ["once", "every prompt"]
MANIFEST_NAME = "manifest.v6.json"
V5_MANIFEST_NAME = "manifest.v5.json"
LOCK_NAME = ".generator-v6.lock"
MAX_REFERENCES = 16
PARTIAL_IMAGES = 2            # streamed previews per image in keep-alive mode
STALL_TIMEOUT = 60            # seconds with zero progress while connecting/uploading
DEFAULT_READ_TIMEOUT = 900    # seconds to wait for a reply (xhigh/max can be slow)
QUOTA_WAIT = 60               # seconds all workers pause after a quota/billing reply
QUOTA_GIVE_UP = 600            # seconds of nonstop quota/billing errors before stopping
QUOTA_CODES = {"insufficient_quota", "billing_hard_limit_reached", "billing_not_active"}
# Optional request fields V6 may add; if a model refuses one it is dropped and
# the request is re-sent (a rejected request is not billed).
OPTIONAL_PARAMS = ("stream", "partial_images", "input_fidelity", "moderation")


# ----------------------------------------------------------------------------
# PROMPT FILE PARSING  (V4 behaviour + bold "**AI PROMPT:**" markers)
# ----------------------------------------------------------------------------
MARKER_RE = re.compile(r"^\s*[>#*\-\s]*AI\s*PROMPT\b\s*\**\s*:?\s*\**\s*", re.I)
BLOCK_END_RE = re.compile(
    r"^\s*(?:\*\*\s*(?:LC\b|\d*\s*Recolors\b|Retextures\b|Item Code\b|Why\b|Price\b)"
    r"|LC:|-{3,}|={3,}|#{1,6}\s)", re.I)
QUOTE_RE = re.compile(r"^\s*>\s?")
SHORT_PROMPT = 40


def parse_prompts(text: str) -> list[str]:
    """One prompt per "AI PROMPT:" paragraph.

    A block ends at a blank line (once it has text), a divider/heading, or a
    metadata line such as **LC / **Recolors / **Price. Unlike V4, short prompts
    are kept (the preview flags them) so nothing is dropped silently.
    """
    prompts, current = [], []
    active = False

    def flush():
        if current:
            joined = re.sub(r"\s+", " ", " ".join(current)).strip()
            if joined:
                prompts.append(joined)
            current.clear()

    for raw in text.lstrip("﻿").splitlines():
        if MARKER_RE.match(raw):
            flush()
            active = True
            rest = QUOTE_RE.sub("", MARKER_RE.sub("", raw, count=1)).strip()
            if rest:
                current.append(rest)
            continue
        if not active:
            continue
        line = QUOTE_RE.sub("", raw).strip()
        if not line:
            if current:
                flush()
                active = False
            continue
        if BLOCK_END_RE.match(line):
            flush()
            active = False
            continue
        if not line.startswith("```"):
            current.append(line)
    flush()
    return prompts


TITLE_RE = re.compile(r'header text[^"“]*["“]([^"”]+)["”]', re.I)
QUOTED_CAPS_RE = re.compile(r'["“]([A-Z0-9][A-Z0-9 &\'/.\-]{3,60})["”]')
HATDE_RE = re.compile(r"HATDE:?[^\[\n]*?\b([A-Za-z][A-Za-z0-9]{3,})\s+\d+\s+recolors", re.I)


def slugify(name: str, maxlen: int = 60) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower()[:maxlen] or "concept"


def filename_for(prompt: str, index: int) -> str:
    match = TITLE_RE.search(prompt) or QUOTED_CAPS_RE.search(prompt) or HATDE_RE.search(prompt)
    return f"{index:03d}_{slugify(match.group(1)) if match else 'concept'}"


# ----------------------------------------------------------------------------
# SETTINGS
# ----------------------------------------------------------------------------
def is_gpt_image_25(model: str) -> bool:
    return model.startswith("gpt-image-2.5")


def is_gpt_image_2_family(model: str) -> bool:
    return model.startswith("gpt-image-2") or model == "chatgpt-image-latest"


def ignores_fidelity(model: str) -> bool:
    # gpt-image-2 always reads references at high fidelity; OpenAI says to omit the field.
    return model.startswith("gpt-image-2") and not is_gpt_image_25(model)


@dataclass(frozen=True)
class Settings:
    model: str = DEFAULT_MODEL
    quality: str = "high"
    size: str = "1536x1024"
    n: int = 1
    background: str = "auto"
    input_fidelity: str = "default"
    moderation: str = "auto"

    def validate(self):
        if not re.fullmatch(r"[A-Za-z0-9._:-]{3,100}", self.model or ""):
            raise ValueError("Pick an image model.")
        if self.quality not in QUALITY_CHOICES:
            raise ValueError(f"Quality must be one of: {', '.join(QUALITY_CHOICES)}.")
        if self.quality in ("xhigh", "max") and not is_gpt_image_25(self.model):
            raise ValueError(f"Quality '{self.quality}' only works with the gpt-image-2.5 "
                             f"models (flare / sunburst). Use 'high' with {self.model}.")
        if type(self.n) is not int or not 1 <= self.n <= 10:
            raise ValueError("Images per prompt must be a whole number from 1 to 10.")
        if self.background not in BACKGROUND_CHOICES:
            raise ValueError("Background must be auto, opaque or transparent.")
        if self.input_fidelity not in FIDELITY_CHOICES:
            raise ValueError("Reference fidelity must be default, high or low.")
        if self.moderation not in MODERATION_CHOICES:
            raise ValueError("Moderation must be auto or low.")
        if self.size != "auto":
            match = re.fullmatch(r"([1-9]\d*)x([1-9]\d*)", self.size or "")
            if not match:
                raise ValueError("Canvas size must look like 2048x1152 (or auto).")
            w, h = map(int, match.groups())
            if is_gpt_image_2_family(self.model):
                if (w % 16 or h % 16 or max(w, h) > 3840 or max(w, h) / min(w, h) > 3
                        or not 655_360 <= w * h <= 8_294_400):
                    raise ValueError("Canvas size needs both sides divisible by 16, max 3840px "
                                     "per side, aspect up to 3:1, and 655,360-8,294,400 pixels.")
            elif self.size not in ("1024x1024", "1536x1024", "1024x1536"):
                raise ValueError(f"{self.model} only supports 1024x1024, 1536x1024, "
                                 "1024x1536 or auto.")
        return self

    def job_dict(self) -> dict:
        # Same shape as V5's settings so a V5 output folder's finished images
        # are recognised on resume when the extra V6 options are left at default.
        data = {"model": self.model, "quality": self.quality, "size": self.size,
                "n": self.n, "background": self.background}
        if self.input_fidelity != "default":
            data["input_fidelity"] = self.input_fidelity
        if self.moderation != "auto":
            data["moderation"] = self.moderation
        return data


def build_fields(settings: Settings, prompt: str, n: int, *, with_refs: bool,
                 stream: bool, dropped=frozenset()) -> dict:
    """Request body. Anything left at 'auto' is omitted (the API default)."""
    fields = {"model": settings.model, "prompt": prompt, "n": int(n), "output_format": "png"}
    if settings.quality != "auto":
        fields["quality"] = settings.quality
    if settings.size != "auto":
        fields["size"] = settings.size
    if settings.background != "auto":
        fields["background"] = settings.background
    if (with_refs and settings.input_fidelity != "default" and "input_fidelity" not in dropped
            and not ignores_fidelity(settings.model)):
        fields["input_fidelity"] = settings.input_fidelity
    if settings.moderation != "auto" and "moderation" not in dropped:
        fields["moderation"] = settings.moderation
    if stream:
        fields["stream"] = True
        if "partial_images" not in dropped:
            fields["partial_images"] = PARTIAL_IMAGES
    return fields


# ----------------------------------------------------------------------------
# COST  (OpenAI list prices in USD per 1M tokens, checked 2026-09 — edit here
# if OpenAI changes them)
# ----------------------------------------------------------------------------
PRICES = {
    # model prefix:          text in, cached text, image in, cached image, output
    "gpt-image-2.5":        (5.00, 1.25, 8.00, 2.00, 30.00),
    "gpt-image-2":          (5.00, 1.25, 8.00, 2.00, 30.00),
    "gpt-image-1.5":        (5.00, 1.25, 8.00, 2.00, 32.00),
    "gpt-image-1-mini":     (2.00, 0.20, 2.50, 0.25, 8.00),
    "gpt-image-1":          (5.00, 1.25, 10.00, 2.50, 40.00),
    "chatgpt-image-latest": (5.00, 1.25, 8.00, 2.00, 32.00),
}
# Output tokens per image, as computed by OpenAI's own cost calculator (image
# generation guide): ceil(q * round(q / (long/short)) * (2M + w*h) / 4M), where
# round() is half-to-even and q depends on the model family and quality.
QUALITY_AXIS = {
    "gpt-image-2":   {"low": 16, "medium": 48, "high": 96},
    "gpt-image-2.5": {"low": 16, "medium": 24, "high": 48, "xhigh": 64, "max": 96},
}
# gpt-image-1 family, tokens for 1024x1024 / 1024x1536 / 1536x1024
GPT_IMAGE_1_TOKENS = {"low": (272, 408, 400), "medium": (1056, 1584, 1568),
                      "high": (4160, 6240, 6208)}
PARTIAL_IMAGE_TOKENS = 100    # each streamed preview is billed as 100 extra output tokens


def prices_for(model: str):
    best = max((p for p in PRICES if model.startswith(p)), key=len, default=None)
    return PRICES.get(best)


def base_model(model: str) -> str:
    return re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model)


def formula_output_tokens(model: str, quality: str, size: str):
    """Output tokens per image from OpenAI's cost calculator (None = not published)."""
    q = "high" if quality == "auto" else quality
    w, h = (1024, 1024) if size == "auto" else map(int, size.split("x"))
    if model.startswith("gpt-image-2"):
        axis = QUALITY_AXIS["gpt-image-2.5" if is_gpt_image_25(model) else "gpt-image-2"].get(q)
        if axis is None:
            return None
        short_axis = round(axis / (max(w, h) / min(w, h)))                  # half-to-even
        return -(-axis * short_axis * (2_000_000 + w * h) // 4_000_000)       # ceil
    if model.startswith("gpt-image-1"):
        idx = {(1024, 1024): 0, (1024, 1536): 1, (1536, 1024): 2}.get((w, h))
        table = GPT_IMAGE_1_TOKENS.get(q)
        return table[idx] if table and idx is not None else None
    return None


def rough_ref_tokens(width: int, height: int) -> int:
    """Rough input tokens for one reference image on gpt-image-2.

    OpenAI doesn't publish this. Community measurements (community.openai.com
    t/1382940) fit 32px patches with a 1,536-patch budget, small images upscaled
    toward 1024px, and the canvas padded to a 1:3..3:1 aspect. A 16:9 screenshot
    of ~1650px or more lands around 1,450-1,510 tokens. Estimates only.
    """
    if width <= 0 or height <= 0:
        return 1500
    mag = min(2.0, max(1.0, 1024 / max(width, height)))
    ew, eh = math.floor(width * mag), math.floor(height * mag)
    pw, ph = math.ceil(ew / 32), math.ceil(eh / 32)
    cw, ch = ew, eh
    if pw > 3 * ph:
        ph = math.ceil(pw / 3)
        cw, ch = pw * 32, ph * 32
    elif ph > 3 * pw:
        pw = math.ceil(ph / 3)
        cw, ch = pw * 32, ph * 32
    if pw * ph <= 1536:
        return pw * ph
    scale = math.sqrt(32 * 32 * 1536 / (cw * ch))
    for _ in range(2000):
        pw, ph = math.ceil(math.floor(cw * scale) / 32), math.ceil(math.floor(ch * scale) / 32)
        if pw * ph <= 1536:
            return pw * ph
        scale *= 0.999
    return 1536


def usage_cost(model: str, usage):
    """USD for one API reply from its `usage` block. Unclear splits are priced high."""
    price = prices_for(model)
    if not price or not isinstance(usage, dict):
        return None
    num = lambda v: v if isinstance(v, (int, float)) and v >= 0 else None
    inp, out = num(usage.get("input_tokens")) or 0, num(usage.get("output_tokens"))
    if out is None:
        return None
    det = usage.get("input_tokens_details") if isinstance(usage.get("input_tokens_details"), dict) else {}
    text, image = num(det.get("text_tokens")), num(det.get("image_tokens"))
    if text is None and image is None:
        text, image = 0, inp
    text, image = text or 0, image or 0
    t_in, _t_cached, i_in, _i_cached, o_out = price
    # The images endpoints report no cached tokens (and don't apply cached pricing).
    parts = {"text": text * t_in / 1e6, "refs": image * i_in / 1e6, "output": out * o_out / 1e6}
    return {"usd": sum(parts.values()), **parts,
            "output_tokens": out, "image_input_tokens": image}


def ref_signature(refs) -> str:
    return hashlib.sha256("".join(sorted(r.digest for r in refs)).encode()).hexdigest()[:16] if refs else ""


def effective_fidelity(model: str, fidelity: str) -> str:
    return "high" if ignores_fidelity(model) else fidelity


class CostBook:
    """Remembers real token usage per setting, so estimates for things OpenAI has
    no published numbers for (reference images, older models, auto sizes) become
    exact after the first few images."""

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.lock = threading.Lock()
        self.data = {"output": {}, "refset": {}, "refimage": {}}
        if self.path and self.path.is_file():
            with contextlib.suppress(OSError, ValueError, AttributeError, TypeError):
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                for k in self.data:
                    if isinstance(loaded.get(k), dict):
                        self.data[k] = loaded[k]

    @staticmethod
    def _get(table, key):
        value = table.get(key)
        if (isinstance(value, list) and len(value) == 2
                and all(isinstance(x, (int, float)) and x >= 0 for x in value)):
            return value
        return [0, 0]

    def _add(self, table, key, count, total):
        c, t = self._get(table, key)
        c, t = c + count, t + total
        if c > 200:                      # keep it recent: halve old weight
            c, t = c / 2, t / 2
        table[key] = [c, t]

    def record(self, model, quality, size, refs, usage, images, fidelity="default", streamed=False):
        if not isinstance(usage, dict) or images <= 0:
            return
        m, fid = base_model(model), effective_fidelity(model, fidelity)
        with self.lock:
            out = usage.get("output_tokens")
            # Streamed replies include preview tokens; keep them out of the per-image average.
            if isinstance(out, (int, float)) and out > 0 and not streamed:
                self._add(self.data["output"], f"{m}|{quality}|{size}", images, out)
            det = usage.get("input_tokens_details") if isinstance(usage.get("input_tokens_details"), dict) else {}
            img = det.get("image_tokens")
            if refs and isinstance(img, (int, float)) and img > 0:
                self._add(self.data["refset"], f"{m}|{fid}|{ref_signature(refs)}", 1, img)
                self._add(self.data["refimage"], f"{m}|{fid}", len(refs), img)
            if self.path:
                with contextlib.suppress(OSError):
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(self.path, json.dumps(self.data, indent=1).encode("utf-8"))

    def output_tokens(self, model, quality, size):
        """(tokens per image or None, note)."""
        m = base_model(model)
        with self.lock:
            c, t = self._get(self.data["output"], f"{m}|{quality}|{size}")
        if c >= 1:
            return t / c, f"measured from your last {c:.0f} image(s)"
        tokens = formula_output_tokens(model, quality, size)
        if tokens is None:
            return None, "no published numbers; measured after the first image"
        note = "OpenAI's cost formula" + (" (assumes high / 1024x1024 for auto)"
                                          if "auto" in (quality, size) else "")
        return tokens, note

    def ref_tokens(self, model, refs, fidelity="default"):
        """(tokens per prompt or None, note, is_rough)."""
        if not refs:
            return 0, "", False
        m, fid = base_model(model), effective_fidelity(model, fidelity)
        with self.lock:
            c, t = self._get(self.data["refset"], f"{m}|{fid}|{ref_signature(refs)}")
            ci, ti = self._get(self.data["refimage"], f"{m}|{fid}")
        if c >= 1:
            return t / c, "measured for these exact references", False
        if ci >= 1:
            return ti / ci * len(refs), "measured average per reference image", False
        if is_gpt_image_2_family(model):
            tokens = sum(rough_ref_tokens(r.width, r.height) for r in refs)
            return tokens, "rough estimate — OpenAI doesn't publish this; exact after the first image", True
        return None, "measured after the first image", False


def estimate_cost(settings: Settings, prompts, refs, book: CostBook, stream_mode="auto") -> dict:
    """Estimate for making `prompts` (one request each, `settings.n` images per request)."""
    price = prices_for(settings.model)
    est = {"requests": len(prompts), "images": len(prompts) * settings.n, "priced": bool(price),
           "stream_mode": stream_mode}
    if not price or not prompts:
        return est
    out_tok, est["output_note"] = book.output_tokens(settings.model, settings.quality, settings.size)
    if out_tok is not None and stream_mode == "on":
        out_tok += PARTIAL_IMAGE_TOKENS * PARTIAL_IMAGES
        est["output_note"] += f", + {PARTIAL_IMAGES} streamed previews"
    ref_tok, est["refs_note"], est["refs_rough"] = book.ref_tokens(settings.model, refs,
                                                                    settings.input_fidelity)
    text_tok = sum(len(p) / 4 + 8 for p in prompts)            # ~4 characters per token
    est["text_usd"] = text_tok * price[0] / 1e6
    est["output_usd"] = None if out_tok is None else out_tok * est["images"] * price[4] / 1e6
    est["refs_usd"] = None if ref_tok is None else ref_tok * len(prompts) * price[2] / 1e6
    est["per_image_output"] = None if out_tok is None else out_tok * price[4] / 1e6
    est["preview_usd"] = PARTIAL_IMAGE_TOKENS * PARTIAL_IMAGES * price[4] / 1e6
    known = [v for v in (est["text_usd"], est["output_usd"], est["refs_usd"]) if v is not None]
    est["total_usd"] = sum(known)
    est["complete"] = len(known) == 3
    return est


def format_estimate(est: dict, settings: Settings, n_refs: int, already_done=0) -> list[str]:
    if not est.get("priced"):
        return [f"Cost estimate: no price list for {settings.model} (edit PRICES at the top of the file)."]
    if not est["requests"]:
        return ["Cost estimate: $0 — everything is already done in this output folder."]
    head = (f"Cost estimate for {est['requests']} prompt(s) x {settings.n} image(s) "
            f"[{settings.model}, {settings.quality}, {settings.size}"
            + (f", {n_refs} reference(s)" if n_refs else "") + "]"
            + (f" — {already_done} already done here, not counted" if already_done else "") + ":")
    lines = [head]
    if est["output_usd"] is not None:
        lines.append(f"  images:     ~${est['output_usd']:.2f}  (~${est['per_image_output']:.3f} each; "
                     f"{est['output_note']})")
    else:
        lines.append(f"  images:     unknown yet — {est['output_note']}")
    if n_refs:
        if est["refs_usd"] is not None:
            lines.append(f"  references: ~${est['refs_usd']:.2f}  (billed with every prompt; "
                         f"{est['refs_note']})")
        else:
            lines.append(f"  references: unknown yet — {est['refs_note']} "
                         "(they are billed with every prompt)")
    lines.append(f"  prompt text: ~${est['text_usd']:.2f}")
    total = f"~${est['total_usd']:.2f}"
    if not est["complete"]:
        lines.append(f"  TOTAL: at least {total} — the exact projection is logged after the first image")
    elif est.get("refs_rough"):
        lines.append(f"  TOTAL: {total} (the reference part is rough; exact projection after the first image)")
    else:
        lines.append(f"  TOTAL: {total}")
    if est.get("stream_mode") == "auto":
        lines.append(f"  (if keep-alive streaming switches on after a dropped connection, each image "
                     f"costs ~${est['preview_usd']:.3f} more for its {PARTIAL_IMAGES} previews)")
    return lines


# ----------------------------------------------------------------------------
# REFERENCE IMAGES + OUTPUT CHECKS (no Pillow needed)
# ----------------------------------------------------------------------------
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def sniff_image(raw: bytes):
    if raw.startswith(PNG_SIG):
        return "png"
    if raw[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def image_dimensions(raw: bytes):
    """(width, height) from a PNG/JPEG/WEBP header, or None."""
    try:
        kind = sniff_image(raw)
        if kind == "png":
            return struct.unpack(">II", raw[16:24])
        if kind == "webp":
            tag = raw[12:16]
            if tag == b"VP8X":
                return (1 + int.from_bytes(raw[24:27], "little"), 1 + int.from_bytes(raw[27:30], "little"))
            if tag == b"VP8 ":
                w, h = struct.unpack("<HH", raw[26:30])
                return (w & 0x3FFF, h & 0x3FFF)
            if tag == b"VP8L":
                b = raw[21:25]
                return (1 + (((b[1] & 0x3F) << 8) | b[0]),
                        1 + (((b[3] & 0x0F) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6)))
        if kind == "jpeg":
            i = 2
            while i + 9 < len(raw):
                if raw[i] != 0xFF:
                    i += 1
                    continue
                marker = raw[i + 1]
                if marker in (0xD8, 0x01, 0xFF) or 0xD0 <= marker <= 0xD7:
                    i += 1 if marker == 0xFF else 2
                    continue
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", raw[i + 5:i + 9])
                    return (w, h)
                i += 2 + int.from_bytes(raw[i + 2:i + 4], "big")
    except (struct.error, IndexError):
        pass
    return None


def verify_image(raw: bytes) -> str:
    """Return the file extension if `raw` is a complete image, else raise ValueError.

    PNGs are walked chunk by chunk with CRC checks, so a reply cut off
    mid-transfer is caught before it is saved as a broken file.
    """
    kind = sniff_image(raw)
    if kind == "png":
        pos, end, first = 8, len(raw), True
        while True:
            if pos + 12 > end:
                raise ValueError("PNG is truncated")
            length, ctype = struct.unpack(">I4s", raw[pos:pos + 8])
            if first and ctype != b"IHDR":
                raise ValueError("PNG has no header")
            first = False
            stop = pos + 12 + length
            if stop > end:
                raise ValueError("PNG is truncated")
            crc = struct.unpack(">I", raw[stop - 4:stop])[0]
            if zlib.crc32(raw[pos + 4:stop - 4]) & 0xFFFFFFFF != crc:
                raise ValueError("PNG is corrupted")
            if ctype == b"IEND":
                return "png"
            pos = stop
    if kind == "jpeg":
        if b"\xff\xd9" not in raw[-64:]:
            raise ValueError("JPEG is truncated")
        return "jpg"
    if kind == "webp":
        if struct.unpack("<I", raw[4:8])[0] + 8 > len(raw):
            raise ValueError("WEBP is truncated")
        return "webp"
    raise ValueError("not an image")


@dataclass(frozen=True)
class Reference:
    name: str
    mime: str
    data: bytes
    width: int = 0
    height: int = 0

    @property
    def digest(self):
        return hashlib.sha256(self.data).hexdigest()


def load_reference_images(paths) -> list[Reference]:
    """Read reference images once; the same bytes are re-sent on every retry."""
    paths = list(paths or [])
    if len(paths) > MAX_REFERENCES:
        raise ValueError(f"Attach at most {MAX_REFERENCES} reference images.")
    refs = []
    for path in paths:
        p = Path(path)
        if not p.is_file():
            raise ValueError(f"Reference image is missing: {p}")
        if p.stat().st_size >= 50 * 1024 * 1024:
            raise ValueError(f"Reference image must be smaller than 50MB: {p.name}")
        raw = p.read_bytes()
        kind = sniff_image(raw)
        if not kind:
            raise ValueError(f"Reference must be a real PNG, JPEG or WEBP file: {p.name}")
        # Name/mime follow the real content, not the extension (a .png that is
        # really a JPEG would otherwise be sent with the wrong type).
        ext = "jpg" if kind == "jpeg" else kind
        width, height = image_dimensions(raw) or (0, 0)
        refs.append(Reference(f"{p.stem}.{ext}", "image/" + kind, raw, width, height))
    return refs


# ----------------------------------------------------------------------------
# NETWORK LAYER
# ----------------------------------------------------------------------------
def _keepalive_socket_options():
    """TCP keep-alive options this OS accepts (probed, so none can break connects)."""
    wanted = [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1),
              (socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)]
    idle = getattr(socket, "TCP_KEEPIDLE", None)
    if idle is None:
        idle = getattr(socket, "TCP_KEEPALIVE", None)   # macOS name
    if idle is not None:
        wanted.append((socket.IPPROTO_TCP, idle, 30))
    if hasattr(socket, "TCP_KEEPINTVL"):
        wanted.append((socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 10))
    if hasattr(socket, "TCP_KEEPCNT"):
        wanted.append((socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 9))
    accepted = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return [], False
    with probe:
        for opt in wanted:
            try:
                probe.setsockopt(*opt)
                accepted.append(opt)
            except OSError:
                pass
    timed = idle is not None and any(o[1] == idle and o[0] == socket.IPPROTO_TCP for o in accepted)
    return accepted, timed


SOCKET_OPTIONS, KEEPALIVE_TIMED = _keepalive_socket_options()


class KeepAliveAdapter(HTTPAdapter):
    """requests adapter that turns on TCP keep-alive, also through proxies."""

    def init_poolmanager(self, *args, **kwargs):
        if SOCKET_OPTIONS:
            kwargs["socket_options"] = SOCKET_OPTIONS
        super().init_poolmanager(*args, **kwargs)

    def proxy_manager_for(self, proxy, **proxy_kwargs):
        if SOCKET_OPTIONS and proxy not in self.proxy_manager:
            proxy_kwargs["socket_options"] = SOCKET_OPTIONS
        return super().proxy_manager_for(proxy, **proxy_kwargs)


def new_session() -> requests.Session:
    # A fresh connection per attempt: no stale pooled socket can be reused.
    session = requests.Session()
    adapter = KeepAliveAdapter()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class Cancelled(Exception):
    pass


class RetryableError(Exception):
    """Temporary problem; retrying may work. kind: connect|drop|rate|quota|server|bad_reply."""

    def __init__(self, message, kind, wait=None):
        super().__init__(message)
        self.kind, self.wait = kind, wait


class JobError(Exception):
    """This prompt can't be finished right now; the batch continues."""

    def __init__(self, message, *, repairable=False, kind=None):
        super().__init__(message)
        self.repairable, self.kind = repairable, kind


class Blocked(JobError):
    def __init__(self, message, *, output_stage):
        super().__init__(message)
        self.output_stage = output_stage


class FatalError(Exception):
    """Stops the whole batch (bad key, model not available, disk problem)."""


class UnsupportedParam(Exception):
    def __init__(self, param):
        super().__init__(param)
        self.param = param


class UploadBody(io.BytesIO):
    """Request body handed to requests as a stream so it goes out in small blocks.

    requests applies its *connect* timeout to sending the request body. Passed as
    one bytes object, the whole upload (prompt + every reference image) had to
    finish inside that limit — 15s in V5, 30s in the first V6 — which a normal
    home upload with several workers can't do for multi-MB screenshots. That is
    the "ConnectionError -> ProtocolError -> TimeoutError" after exactly 30s.
    Streamed, the limit applies per block, so only a genuinely stalled upload
    fails, and it fails without being billed (OpenAI never got the full request).
    """

    def __init__(self, data: bytes, on_done=None):
        super().__init__(data)
        self.total = len(data)
        self.started = time.monotonic()
        self.finished_at = None
        self._on_done = on_done

    def read(self, size=-1):
        chunk = super().read(size)
        if not chunk and self.finished_at is None:
            self.finished_at = time.monotonic()
            if self._on_done:
                self._on_done(self.finished_at - self.started, self.total)
        return chunk


def safe_identifier(value) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]", "", str(value or ""))[:100]


def redact(text: str) -> str:
    return re.sub(r"sk-[A-Za-z0-9_\-*]{6,}", "sk-[hidden]", str(text or ""))


DROP_NAMES = {"ReadTimeout", "ReadTimeoutError", "ChunkedEncodingError", "ProtocolError",
              "RemoteDisconnected", "ConnectionResetError", "ConnectionAbortedError",
              "IncompleteRead", "BrokenPipeError", "SSLEOFError"}


def exception_chain(exc, limit=6) -> list[str]:
    """Class names down the cause chain, e.g. ConnectionError -> ProtocolError -> ConnectionResetError[10054]."""
    names, seen, cur = [], set(), exc
    while cur is not None and id(cur) not in seen and len(names) < limit:
        seen.add(id(cur))
        code = getattr(cur, "winerror", None) or getattr(cur, "errno", None)
        name = type(cur).__name__ + (f"[{code}]" if isinstance(code, int) else "")
        if not names or names[-1] != name:
            names.append(name)
        nxt = getattr(cur, "reason", None)
        if not isinstance(nxt, BaseException):
            nxt = next((a for a in getattr(cur, "args", ()) if isinstance(a, BaseException)), None)
        cur = nxt or cur.__cause__ or (None if cur.__suppress_context__ else cur.__context__)
    return names


def transport_error(exc) -> RetryableError:
    names = exception_chain(exc)
    bare = {n.split("[")[0] for n in names}
    detail = " -> ".join(names)
    if bare & DROP_NAMES:
        if "ReadTimeout" in bare or "ReadTimeoutError" in bare:
            return RetryableError(f"no reply before the timeout ({detail})", "drop")
        return RetryableError(f"connection dropped ({detail})", "drop")
    return RetryableError(f"could not connect ({detail})", "connect")


def retry_after(headers):
    for name, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        value = headers.get(name)
        if value:
            try:
                seconds = float(value) * scale
            except ValueError:
                continue
            if math.isfinite(seconds) and seconds >= 0:
                return max(1.0, min(300.0, seconds))
    return None


def _unsupported_param(err: dict, sent: dict):
    param = str(err.get("param") or "")
    message = str(err.get("message") or "").lower()
    for name in OPTIONAL_PARAMS:
        if name not in sent:
            continue
        if param == name or param.endswith("." + name):
            return name
        if re.search(rf"['\"`]?{name}['\"`]?", message) and re.search(
                r"unknown|unrecogni[sz]ed|unsupported|not supported|not allowed|invalid|unexpected",
                message):
            return name
    return None


def _moderation_stage(body, err):
    for source in (err, body if isinstance(body, dict) else {}):
        details = source.get("moderation_details") if isinstance(source, dict) else None
        if isinstance(details, dict) and details.get("moderation_stage"):
            return str(details["moderation_stage"])
    return None


def error_from_payload(status, err: dict, body, headers, sent: dict):
    code, etype = err.get("code"), err.get("type")
    message = redact(str(err.get("message") or ""))[:300]
    rid = safe_identifier(headers.get("x-request-id")) if headers is not None else ""
    suffix = f" (request {rid})" if rid else ""
    wait = retry_after(headers) if headers is not None else None
    shown = f": {message}" if message else ""

    if status == 400:
        param = _unsupported_param(err, sent)
        if param:
            return UnsupportedParam(param)
    if code in QUOTA_CODES or etype == "insufficient_quota":
        return RetryableError(f"OpenAI quota/billing message ({status}){shown}", "quota",
                              wait=max(wait or 0, QUOTA_WAIT))
    stage = _moderation_stage(body, err)
    # image_generation_user_error also covers non-safety problems (e.g. invalid_image_file);
    # only moderation codes/details, or the old code-less form, are safety blocks.
    if code == "moderation_blocked" or stage or (etype == "image_generation_user_error" and not code):
        where = f" ({stage} check)" if stage else ""
        return Blocked(f"blocked by OpenAI's safety system{where}{shown}{suffix}",
                       output_stage=stage != "input")
    if code in ("invalid_image_file", "invalid_image", "invalid_image_format"):
        return FatalError(f"OpenAI couldn't read one of the input images{shown}{suffix}. "
                          "Check your reference images (every prompt uses them).")
    if status == 401:
        return FatalError(f"API key rejected (401). Check the key.{suffix}")
    if status == 403:
        return FatalError(f"Permission denied for this model/project (403){shown}{suffix}")
    if status == 404:
        return FatalError(f"Not found (404){shown or ' — usually the model is not available to this key'}{suffix}")
    if status == 429:
        return RetryableError("rate limit (429)", "rate", wait=wait)
    if status is None or status in (408, 409) or status >= 500:
        label = f"OpenAI server error {status}" if status else "OpenAI stream error"
        return RetryableError(f"{label}{shown}", "server", wait=wait)
    return JobError(f"HTTP {status}{shown or ': request rejected'}{suffix}")


def http_error(response, sent: dict):
    try:
        body = response.json()
    except ValueError:
        body = None
    err = body.get("error") if isinstance(body, dict) else None
    return error_from_payload(response.status_code, err if isinstance(err, dict) else {},
                              body, response.headers, sent)


def iter_sse(response):
    """Yield JSON events from a text/event-stream reply."""
    def lines():
        pending = bytearray()
        for chunk in response.iter_content(chunk_size=65536):
            if not chunk:
                continue
            start = 0
            while True:
                i = chunk.find(b"\n", start)
                if i < 0:
                    pending += chunk[start:]
                    break
                pending += chunk[start:i]
                yield bytes(pending).rstrip(b"\r")
                pending = bytearray()
                start = i + 1
        if pending:
            yield bytes(pending).rstrip(b"\r")

    data = []
    for line in lines():
        if not line:
            if data:
                payload, data = b"\n".join(data), []
                if payload.strip() == b"[DONE]":
                    return
                try:
                    yield json.loads(payload)
                except ValueError:
                    continue
            continue
        if line.startswith(b"data:"):
            data.append(line[5:].lstrip())
    if data:
        try:
            yield json.loads(b"\n".join(data))
        except ValueError:
            pass


class ImageClient:
    def __init__(self, api_key: str, *, api_root: str = API_ROOT,
                 read_timeout: float = DEFAULT_READ_TIMEOUT):
        key = (api_key or "").strip()
        if not key:
            raise ValueError("Paste your OpenAI API key first (or set OPENAI_API_KEY).")
        self._headers = {"Authorization": "Bearer " + key}
        self.api_root = api_root.rstrip("/")
        self.read_timeout = float(read_timeout)

    def models(self) -> list[str]:
        last = None
        for attempt in range(3):
            try:
                with new_session() as s:
                    r = s.get(self.api_root + "/models", headers=self._headers,
                              timeout=(STALL_TIMEOUT, 60), allow_redirects=False)
            except requests.RequestException as exc:
                last = transport_error(exc)
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code != 200:
                raise http_error(r, {})
            try:
                return sorted({row["id"] for row in r.json()["data"]
                               if isinstance(row.get("id"), str)
                               and ("image" in row["id"])})
            except (ValueError, KeyError, TypeError, AttributeError):
                raise RetryableError("the model list reply was invalid", "bad_reply") from None
        raise last

    def _decode(self, body):
        items = body.get("data") if isinstance(body, dict) else None
        if not isinstance(items, list):
            raise RetryableError("reply had no image data", "bad_reply")
        images = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                if item.get("b64_json"):
                    raw = base64.b64decode(item["b64_json"], validate=True)
                elif item.get("url"):
                    with new_session() as s:
                        raw = s.get(item["url"], timeout=(STALL_TIMEOUT, 120)).content
                else:
                    continue
                images.append((raw, verify_image(raw)))
            except (ValueError, requests.RequestException):
                continue
        if not images:
            raise RetryableError("reply contained no complete image", "bad_reply")
        return images

    def _read_stream(self, response, on_partial):
        images, usage = [], None
        try:
            for event in iter_sse(response):
                if not isinstance(event, dict):
                    continue
                etype = str(event.get("type") or "")
                if etype.endswith("partial_image"):
                    on_partial(event.get("partial_image_index"))
                    continue
                if etype == "error" or isinstance(event.get("error"), dict):
                    err = event.get("error") if isinstance(event.get("error"), dict) else event
                    raise error_from_payload(None, err, event, None, {})
                if event.get("b64_json"):
                    try:
                        raw = base64.b64decode(event["b64_json"], validate=True)
                        images.append((raw, verify_image(raw)))
                    except ValueError:
                        pass
                    usage = event.get("usage") or usage
        except requests.RequestException as exc:
            if images:
                return images, usage      # keep what arrived; the rest is re-requested
            raise transport_error(exc) from None
        if not images:
            raise RetryableError("stream ended before the image was finished", "drop")
        return images, usage

    @staticmethod
    def _transport(exc, upload):
        """Classify by how far the request body got, not just by exception name:
        nothing sent = never reached OpenAI; part sent = OpenAI never got the full
        request (neither is billed); all sent = the render may be running."""
        err = transport_error(exc)
        if upload is not None and upload.finished_at is None:
            detail = str(err).split("(", 1)[-1].rstrip(")")
            if upload.tell() == 0:
                return RetryableError(f"could not connect ({detail})", "connect")
            if upload.total >= 1_000_000:
                return RetryableError(f"upload interrupted at {upload.tell() / 1e6:.1f} of "
                                      f"{upload.total / 1e6:.1f} MB ({detail})", "upload")
            return RetryableError(f"connection dropped while sending ({detail})", "upload")
        return err

    def upload_file(self, ref, expire=True) -> str:
        """Upload one reference image to the Files API once; returns its file id."""
        form = [("purpose", "vision")]
        if expire:
            form += [("expires_after[anchor]", "created_at"), ("expires_after[seconds]", "86400")]
        form.append(("file", (ref.name, ref.data, ref.mime)))
        body, content_type = encode_multipart_formdata(form)
        upload = UploadBody(body)
        with new_session() as s:
            try:
                r = s.post(self.api_root + "/files", data=upload, allow_redirects=False,
                           headers={**self._headers, "Content-Type": content_type},
                           timeout=(STALL_TIMEOUT, 300))
            except requests.RequestException as exc:
                raise self._transport(exc, upload) from None
            with r:
                if r.status_code != 200:
                    raise http_error(r, {})
                try:
                    file_id = r.json()["id"]
                except (ValueError, KeyError, TypeError):
                    raise RetryableError("the file upload reply was invalid", "bad_reply") from None
        if not isinstance(file_id, str) or not file_id:
            raise RetryableError("the file upload reply had no file id", "bad_reply")
        return file_id

    def delete_file(self, file_id):
        with contextlib.suppress(Exception), new_session() as s:
            s.delete(f"{self.api_root}/files/{file_id}", headers=self._headers,
                     timeout=(STALL_TIMEOUT, 30), allow_redirects=False).close()

    def request(self, fields: dict, refs, stream: bool, on_partial=lambda _i: None,
                on_upload=None, file_ids=None):
        """One HTTP attempt. Returns ([(bytes, ext)], usage, request_id).

        With `file_ids` the references were uploaded once to the Files API and
        the edit request is a few KB of JSON; otherwise the images ride along as
        multipart parts. Every body is streamed (see UploadBody)."""
        if refs and file_ids:
            url = self.api_root + "/images/edits"
            body = json.dumps({**fields, "images": [{"file_id": f} for f in file_ids]}).encode("utf-8")
            content_type = "application/json"
        elif refs:
            url = self.api_root + "/images/edits"
            form = [(k, "true" if v is True else "false" if v is False else str(v))
                    for k, v in fields.items()]
            form += [("image[]", (ref.name, ref.data, ref.mime)) for ref in refs]
            body, content_type = encode_multipart_formdata(form)
        else:
            url = self.api_root + "/images/generations"
            body, content_type = json.dumps(fields).encode("utf-8"), "application/json"
        upload = UploadBody(body, on_upload if refs and not file_ids else None)
        kwargs = {"headers": {**self._headers, "Content-Type": content_type}, "data": upload,
                  "allow_redirects": False, "stream": stream,
                  "timeout": (STALL_TIMEOUT, self.read_timeout)}
        with new_session() as s:
            try:
                response = s.post(url, **kwargs)
            except requests.RequestException as exc:
                raise self._transport(exc, upload) from None
            with response:
                rid = safe_identifier(response.headers.get("x-request-id"))
                try:
                    if response.status_code != 200:
                        _ = response.content
                        raise http_error(response, fields)
                    if stream and "text/event-stream" in response.headers.get("content-type", ""):
                        images, usage = self._read_stream(response, on_partial)
                        return images, usage, rid
                    body = response.json()
                except ValueError:      # includes requests' JSONDecodeError (also a RequestException)
                    raise RetryableError("reply was cut off or unreadable", "drop") from None
                except requests.RequestException as exc:
                    raise transport_error(exc) from None
                return self._decode(body), body.get("usage"), rid


# ----------------------------------------------------------------------------
# PACING / SHARED STATE
# ----------------------------------------------------------------------------
class Gate:
    """Launch gap between requests + a shared cool-down all workers respect."""

    def __init__(self, gap):
        self.gap, self.next_at, self.cool_until = float(gap), 0.0, 0.0
        self.lock = threading.Lock()

    def cooldown(self, seconds):
        with self.lock:
            self.cool_until = max(self.cool_until, time.monotonic() + seconds)

    def wait_turn(self, stop):
        while True:
            with self.lock:
                now = time.monotonic()
                if self.cool_until > now:
                    slot, wait = None, self.cool_until - now
                else:
                    slot = max(now, self.next_at)
                    self.next_at = slot + self.gap
                    wait = slot - now
            if wait > 0 and stop.wait(wait):
                raise Cancelled()
            if stop.is_set():
                raise Cancelled()
            if slot is None:
                continue
            with self.lock:
                if self.cool_until <= time.monotonic():
                    return


class BatchState:
    def __init__(self, stream_mode, log):
        self.lock = threading.Lock()
        self.log = log
        self.stream_mode = stream_mode
        self.stream_on = stream_mode == "on"
        self.stream_ok = True
        self.dropped = set()
        self.drops = 0
        self.quota_since = None      # start of the current run of quota/billing errors
        self.fatal = None
        self.file_ids = None         # reference file ids when uploaded once
        self.file_proven = False     # a request using them has succeeded

    def set_fatal(self, message) -> bool:
        """Record the first fatal error; True only for the first caller."""
        with self.lock:
            first = self.fatal is None
            if first:
                self.fatal = message
            return first

    def quota_seconds(self) -> float:
        with self.lock:
            now = time.monotonic()
            if self.quota_since is None:
                self.quota_since = now
            return now - self.quota_since

    def success(self):
        with self.lock:
            self.quota_since = None

    def refs_as_files(self):
        with self.lock:
            return self.file_ids

    def stop_file_refs(self, reason) -> bool:
        with self.lock:
            if self.file_ids is None:
                return False
            self.file_ids = None
        self.log(f"Upload-once references didn't work here ({reason}). Sending the references "
                 "with every prompt instead.")
        return True

    def use_stream(self):
        with self.lock:
            return self.stream_on and self.stream_ok

    def note_drop(self):
        with self.lock:
            self.drops += 1
            if self.stream_mode == "auto" and not self.stream_on and self.stream_ok:
                self.stream_on = True
                self.log("Auto keep-alive: a connection dropped, so the rest of this batch "
                         f"uses streamed replies to keep the line busy (adds {PARTIAL_IMAGES} "
                         f"previews = {PARTIAL_IMAGES * PARTIAL_IMAGE_TOKENS} output tokens per image).")

    def drop_param(self, name) -> bool:
        with self.lock:
            if name in self.dropped:
                return False
            self.dropped.add(name)
            if name == "stream":
                self.stream_ok = False
                self.log("This model doesn't accept streaming; continuing without it "
                         "(TCP keep-alive still on).")
            elif name == "partial_images":
                self.log("This model doesn't send partial previews; streaming without them.")
            else:
                self.log(f"This model doesn't accept '{name}'; sending without it.")
            return True


def backoff(tries):
    return min(120.0, 5.0 * 2 ** (tries - 1)) * random.uniform(0.85, 1.15)


# ----------------------------------------------------------------------------
# FILES / MANIFEST
# ----------------------------------------------------------------------------
def job_key(prompt: str, settings: Settings, references=(), occurrence=0, ordered=False) -> str:
    # References are keyed as a set (re-adding them in another order is the same
    # job); ordered=True gives the older V5/early-V6 key so their work is found.
    digests = [ref.digest for ref in references]
    data = {"prompt": prompt, "settings": settings.job_dict(),
            "references": digests if ordered else sorted(digests), "output_format": "png"}
    if occurrence:
        data["occurrence"] = occurrence    # the same prompt twice = two images
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def atomic_write(path: Path, data: bytes):
    temp = path.with_name(path.name + ".tmp")
    with temp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    # On Windows, antivirus / OneDrive / the search indexer can hold a file open for a
    # moment and make the rename fail; retry briefly instead of failing the batch.
    for attempt in range(10):
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            if os.name != "nt" or attempt == 9:
                raise
            time.sleep(0.1 * (attempt + 1))


def unique_path(folder: Path, stem: str, ext: str) -> Path:
    path = folder / f"{stem}.{ext}"
    k = 2
    while path.exists():
        path = folder / f"{stem}_{k}.{ext}"
        k += 1
    return path


@contextlib.contextmanager
def output_lock(folder: Path):
    """OS-owned lock (released even on a crash) so two batches can't share a folder."""
    path = folder / LOCK_NAME
    with path.open("a+b") as f:
        f.seek(0, os.SEEK_END)
        if f.tell() == 0:
            f.write(b"0")
            f.flush()
        f.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise ValueError("Another generator is already using this output folder. "
                             "Pick a different folder or wait for it to finish.") from None
        try:
            yield
        finally:
            if os.name == "nt":
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def read_manifest(folder: Path):
    """The folder's V6 manifest; a fresh one if missing, None if unreadable."""
    path = folder / MANIFEST_NAME
    if not path.exists():
        return {"version": 6, "jobs": {}}
    for attempt in range(3):            # OSError (locked by sync/backup) is not corruption
        try:
            text = path.read_text(encoding="utf-8")
            break
        except OSError:
            if attempt == 2:
                raise ValueError(f"Couldn't read {MANIFEST_NAME} in the output folder (is another "
                                 "program using it?). Close it and try again.") from None
            time.sleep(0.5)
    try:
        data = json.loads(text)
        if data.get("version") != 6 or not isinstance(data.get("jobs"), dict):
            raise ValueError()
        data["jobs"] = {k: v for k, v in data["jobs"].items() if isinstance(v, dict)}
        return data
    except (ValueError, AttributeError):
        return None


def load_manifest(folder: Path, log):
    data = read_manifest(folder)
    if data is not None:
        return data
    backup = folder / f"manifest.v6.broken-{int(time.time())}.json"
    with contextlib.suppress(OSError):
        os.replace(folder / MANIFEST_NAME, backup)
    log(f"Note: the old manifest was unreadable, moved it to {backup.name} and started fresh.")
    return {"version": 6, "jobs": {}}


def plan_jobs(folder: Path, manifest: dict, settings: Settings, prompts, refs):
    """Split prompts into (to make, already done) using verified files in the folder."""
    todo, done, seen = [], [], {}
    for index, prompt in enumerate(prompts, 1):
        base = job_key(prompt, settings, refs)
        occurrence = seen.get(base, 0)
        seen[base] = occurrence + 1
        key = base if not occurrence else job_key(prompt, settings, refs, occurrence)
        old = (manifest["jobs"].get(key)
               or manifest["jobs"].get(job_key(prompt, settings, refs, occurrence, ordered=True)) or {})
        good = verified_files(folder, old)
        (done if len(good) >= settings.n else todo).append((index, prompt, key, old, good))
    return todo, done


def preview_plan(out_dir, settings: Settings, prompts, refs):
    """Read-only version of the resume check, for previews and estimates."""
    folder = Path(out_dir).expanduser()
    if not folder.is_dir():
        return list(prompts), 0
    manifest = read_manifest(folder) or {"version": 6, "jobs": {}}
    import_v5_manifest(folder, manifest)
    todo, done = plan_jobs(folder, manifest, settings, prompts, refs)
    return [t[1] for t in todo], len(done)


def import_v5_manifest(folder: Path, manifest: dict) -> int:
    """Carry over finished jobs from a V5 run in the same folder."""
    path = folder / V5_MANIFEST_NAME
    try:
        old = json.loads(path.read_text(encoding="utf-8"))["jobs"]
    except (OSError, ValueError, KeyError, TypeError):
        return 0
    count = 0
    for key, entry in old.items() if isinstance(old, dict) else ():
        if (isinstance(entry, dict) and entry.get("status") == "completed"
                and key not in manifest["jobs"] and isinstance(entry.get("files"), list)):
            manifest["jobs"][key] = {"status": "completed", "files": entry["files"],
                                     "prompt": entry.get("prompt"), "imported_from": "v5"}
            count += 1
    return count


def save_manifest(folder: Path, manifest: dict):
    atomic_write(folder / MANIFEST_NAME,
                 json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))


def verified_files(folder: Path, entry) -> list[dict]:
    good = []
    for item in (entry or {}).get("files", []) or []:
        try:
            name = item["name"]
            if Path(name).name != name:
                continue
            if hashlib.sha256((folder / name).read_bytes()).hexdigest() == item["sha256"]:
                good.append({"name": name, "sha256": item["sha256"]})
        except (KeyError, TypeError, OSError):
            continue
    return good


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ----------------------------------------------------------------------------
# BATCH
# ----------------------------------------------------------------------------
@dataclass
class Job:
    index: int
    prompt: str
    key: str
    stem: str
    entry: dict
    have: int = 0
    status: str = "pending"
    error: str = ""
    repairable: bool = False
    extra: dict = field(default_factory=dict)


@contextlib.contextmanager
def keep_awake(log):
    """Keep Windows from sleeping mid-batch: renders in flight would be billed but lost."""
    set_state = None
    if os.name == "nt":
        with contextlib.suppress(Exception):
            import ctypes
            set_state = ctypes.windll.kernel32.SetThreadExecutionState
            set_state.argtypes, set_state.restype = [ctypes.c_uint], ctypes.c_uint
            if set_state(0x80000000 | 0x00000001):        # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
                log("Keeping the PC awake until the batch finishes.")
            else:
                set_state = None
    try:
        yield
    finally:
        if set_state:
            with contextlib.suppress(Exception):
                set_state(0x80000000)                     # back to normal


def upload_references_once(client, refs, log, stop):
    """Upload each reference to the Files API once. Returns file ids, or None to
    fall back to sending the images with every prompt."""
    ids, size = [], sum(len(r.data) for r in refs) / 1e6
    log(f"Uploading {len(refs)} reference image(s) ({size:.1f} MB) to OpenAI once...")
    started = time.monotonic()
    try:
        for ref in refs:
            expire = True
            for attempt in range(4):
                if stop.is_set():
                    raise Cancelled()
                try:
                    ids.append(client.upload_file(ref, expire=expire))
                    break
                except RetryableError as exc:
                    if attempt == 3:
                        raise
                    log(f"  {ref.name}: {exc}; retrying...")
                    if stop.wait(3 * (attempt + 1)):
                        raise Cancelled() from None
                except JobError:
                    if not expire:                        # a 400 even without the expiry option
                        raise
                    expire = False                        # try once without the auto-expiry
            else:
                raise JobError("upload kept failing")
    except Exception as exc:
        for file_id in ids:
            client.delete_file(file_id)
        if not isinstance(exc, Cancelled):
            log(f"Couldn't upload the references once ({exc}); sending them with every prompt instead.")
        return None
    log(f"References uploaded once in {time.monotonic() - started:.0f}s — each prompt now sends "
        f"a few KB instead of {size:.1f} MB.")
    return ids


def run_batch(api_key, settings: Settings, prompts, out_dir, *, image_paths=(), workers=4,
              pace=1.3, delay=0.0, retries=6, read_timeout=DEFAULT_READ_TIMEOUT,
              stream_mode="auto", ref_upload="once", repair_passes=2, repair_wait=20.0,
              stop_event=None, progress=None, log=print, client=None, preflight=True,
              cost_book=None, on_cost=None):
    settings.validate()
    prompts = list(prompts)
    if not prompts:
        raise ValueError("No 'AI PROMPT:' blocks found.")
    for i, prompt in enumerate(prompts, 1):
        if not prompt.strip() or len(prompt) > 32000:
            raise ValueError(f"Prompt {i} must be 1-32,000 characters.")
    if not 1 <= int(workers) <= 16:
        raise ValueError("Use 1-16 parallel workers.")
    if not (math.isfinite(pace) and pace >= 0 and math.isfinite(delay) and delay >= 0):
        raise ValueError("Launch gap and delay must be 0 or more.")
    if not 0 <= int(retries) <= 20:
        raise ValueError("Retries per image must be 0-20.")
    if not 60 <= float(read_timeout) <= 3600:
        raise ValueError("Request timeout must be 60-3600 seconds.")
    if stream_mode not in STREAM_CHOICES:
        raise ValueError("Keep-alive streaming must be auto, on or off.")
    if ref_upload not in REF_UPLOAD_CHOICES:
        raise ValueError("Reference upload must be 'once' or 'every prompt'.")
    workers, retries = int(workers), int(retries)

    refs = load_reference_images(image_paths)
    folder = Path(out_dir).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    stop = stop_event or threading.Event()
    total = len(prompts)
    lock = threading.Lock()

    book = cost_book or CostBook()
    spent = {"usd": 0.0, "text": 0.0, "refs": 0.0, "output": 0.0, "images": 0, "requests": 0,
             "priced_images": 0, "priced_requests": 0, "unpriced": 0, "projected": False}
    state = BatchState(stream_mode, log)

    with output_lock(folder):
        manifest = load_manifest(folder, log)
        imported = import_v5_manifest(folder, manifest)
        todo, done = plan_jobs(folder, manifest, settings, prompts, refs)
        skipped = len(done)
        for index, _prompt, _key, _old, good in done:
            log(f"[{index}/{total}] already done — {', '.join(f['name'] for f in good)}")
        jobs = []
        for index, prompt, key, old, good in todo:
            entry = {"status": "pending", "prompt": prompt, "settings": settings.job_dict(),
                     "reference_hashes": [r.digest for r in refs], "files": good,
                     "runs": int(old.get("runs", 0)) + 1, "request_ids": old.get("request_ids", []),
                     "cost_usd": old.get("cost_usd", 0.0)}
            manifest["jobs"][key] = entry
            jobs.append(Job(index, prompt, key, filename_for(prompt, index), entry, have=len(good)))
        save_manifest(folder, manifest)
        if imported:
            log(f"Found a V5 manifest here: {imported} finished V5 job(s) will be reused if unchanged.")

        counts = {"completed": 0, "failed_now": 0}

        def tick():
            if progress:
                progress(min(total, skipped + counts["completed"] + counts["failed_now"]), total)

        tick()
        if not jobs:
            log("Nothing to do — every prompt already has a verified image in this folder.")
            return {"total": total, "generated": 0, "skipped": skipped, "failed": 0,
                    "cancelled": 0, "cost_usd": 0.0}

        client = client or ImageClient(api_key, read_timeout=read_timeout)
        if preflight:            # advisory only: the first image request is the real check
            try:
                available = client.models()
                if available and settings.model not in available:
                    log(f"Warning: {settings.model} isn't in this key's model list "
                        f"({', '.join(available)}). Trying anyway.")
            except Exception as exc:
                log(f"Model check skipped ({exc}); continuing — the first image request will "
                    "confirm the key.")

        keepalive = ("on (probe after 30s idle, every 10s)" if KEEPALIVE_TIMED
                     else "on (OS default timing)" if SOCKET_OPTIONS else "unavailable")
        log(f"Starting batch: {len(jobs)} to make, {skipped} already done | model={settings.model} | "
            f"quality={settings.quality} | size={settings.size} | {settings.n} image(s)/prompt")
        log(f"{workers} parallel worker(s) | launch gap {pace:g}s | {retries} retries per image | "
            f"timeout {read_timeout:g}s")
        log(f"TCP keep-alive: {keepalive} | keep-alive streaming: {stream_mode}")
        for line in format_estimate(estimate_cost(settings, [j.prompt for j in jobs], refs, book,
                                                  stream_mode), settings, len(refs), skipped):
            log(line)
        log(f"Saving to: {folder}")

        gate = Gate(pace)

        def save_images(job, images, usage, rid, took, streamed):
            cost = usage_cost(settings.model, usage)
            fidelity = "default" if "input_fidelity" in state.dropped else settings.input_fidelity
            book.record(settings.model, settings.quality, settings.size, refs, usage, len(images),
                        fidelity, streamed)
            each = f", ${cost['usd'] / max(1, len(images)):.3f}" if cost else ""
            with lock:
                saved = 0
                for raw, ext in images:
                    if job.have >= settings.n:
                        break
                    variant = job.have + 1
                    stem = job.stem if settings.n == 1 else f"{job.stem}_v{variant}"
                    path = unique_path(folder, stem, ext)
                    atomic_write(path, raw)
                    job.entry["files"].append({"name": path.name,
                                               "sha256": hashlib.sha256(raw).hexdigest()})
                    job.have += 1
                    saved += 1
                    log(f"[{job.index}/{total}] saved  {path.name}  "
                        f"({len(raw) // 1024} KB, {took:.0f}s{each})")
                spent["requests"] += 1
                spent["images"] += saved
                if cost:
                    for part in ("usd", "text", "refs", "output"):
                        spent[part] += cost[part]
                    spent["priced_images"] += saved
                    spent["priced_requests"] += 1
                    job.entry["cost_usd"] = round(float(job.entry.get("cost_usd") or 0) + cost["usd"], 5)
                else:
                    spent["unpriced"] += saved
                if rid:
                    job.entry["request_ids"] = (job.entry.get("request_ids") or [])[-9:] + [rid]
                if usage:
                    job.entry["usage"] = usage
                try:                    # the image is safe on disk; the manifest is rewritten again later
                    save_manifest(folder, manifest)
                except OSError as exc:
                    log(f"[{job.index}/{total}] note: couldn't update {MANIFEST_NAME} ({exc}); "
                        "will retry on the next save.")
                if cost and not spent["projected"]:
                    spent["projected"] = True
                    per_prompt = cost["usd"] / max(1, len(images)) * settings.n
                    log(f"Cost check: this image cost ${cost['usd']:.3f} "
                        f"(image ${cost['output']:.3f}, references ${cost['refs']:.3f}, "
                        f"text ${cost['text']:.4f}) -> the {len(jobs)} prompt(s) in this run "
                        f"should cost about ${per_prompt * len(jobs):.2f} in total.")
                if on_cost:
                    on_cost(spent["usd"], spent["priced_images"])

        def make_images(job):
            tag = f"[{job.index}/{total}] {job.stem}"
            tries = rate_hits = 0
            second_chance = False
            while job.have < settings.n:
                if stop.is_set():
                    raise Cancelled()
                gate.wait_turn(stop)
                stream = state.use_stream()
                file_ids = state.refs_as_files() if refs else None
                fields = build_fields(settings, job.prompt, settings.n - job.have,
                                      with_refs=bool(refs), stream=stream,
                                      dropped=frozenset(state.dropped))
                started = time.monotonic()

                def on_partial(i, _tag=tag):
                    log(f"{_tag} — preview {int(i or 0) + 1} received, still rendering...")

                def on_upload(seconds, size, _tag=tag):
                    if seconds >= 5:
                        log(f"{_tag} — references uploaded ({size / 1e6:.1f} MB in "
                            f"{seconds:.0f}s), rendering...")

                try:
                    images, usage, rid = client.request(fields, refs, stream, on_partial, on_upload,
                                                        file_ids)
                except UnsupportedParam as exc:
                    # Rejected requests aren't billed; resend without that field
                    # (a no-op drop means another worker already removed it).
                    state.drop_param(exc.param)
                    continue
                except Blocked as exc:
                    if exc.output_stage and not second_chance:
                        second_chance = True
                        log(f"{tag} — {exc}. One more try (every render is different)...")
                        continue
                    raise
                except (JobError, FatalError) as exc:
                    # Upload-once is newer API surface: if it is refused, fall back to
                    # sending the images with the request (4xx replies aren't billed).
                    if file_ids and (not state.file_proven or re.search(r"file|image", str(exc), re.I)):
                        state.stop_file_refs(str(exc))
                        continue
                    raise
                except RetryableError as exc:
                    took = time.monotonic() - started
                    if exc.kind == "rate":
                        rate_hits += 1
                        if rate_hits > 40:
                            raise JobError("still rate limited after 40 waits",
                                           repairable=True, kind="rate") from None
                        wait = exc.wait or min(60.0, 4.0 * rate_hits) * random.uniform(0.9, 1.3)
                        gate.cooldown(wait)
                        log(f"{tag} — rate limited (429). All workers pause {wait:.0f}s...")
                        continue
                    if exc.kind == "quota":
                        waited = state.quota_seconds()
                        if waited > QUOTA_GIVE_UP:
                            raise FatalError(f"OpenAI kept returning a quota/billing error for "
                                             f"{waited / 60:.0f} minutes. Check Billing on "
                                             "platform.openai.com, then press Generate / Resume.") from None
                        wait = exc.wait or QUOTA_WAIT
                        gate.cooldown(wait)
                        log(f"{tag} — {exc}. This often clears on its own; all workers pause "
                            f"{wait:.0f}s (check Billing if it never clears)...")
                        continue
                    tries += 1
                    if exc.kind == "drop":
                        state.note_drop()
                    if tries > retries:
                        raise JobError(f"gave up after {tries} tries — {exc}",
                                       repairable=True, kind=exc.kind) from None
                    wait = exc.wait or backoff(tries)
                    how = " with keep-alive streaming" if state.use_stream() and not stream else ""
                    log(f"{tag} — {exc} after {took:.0f}s. Retry {tries}/{retries} "
                        f"in {wait:.0f}s{how}...")
                    if stop.wait(wait):
                        raise Cancelled() from None
                    continue
                if file_ids:
                    with state.lock:
                        state.file_proven = True
                state.success()
                save_images(job, images, usage, rid, time.monotonic() - started, stream)

        def worker(job, first_pass):
            try:
                if stop.is_set():
                    raise Cancelled()
                if first_pass:
                    log(f"[{job.index}/{total}] {job.stem} — queued...")
                make_images(job)
                job.status, job.error, job.repairable = "completed", "", False
                with lock:
                    counts["completed"] += 1
                if delay:
                    stop.wait(delay)
            except Cancelled:
                if job.status != "failed":      # keep an earlier pass's failure on record
                    job.status = "cancelled"
            except FatalError as exc:
                job.status, job.error, job.repairable = "failed", str(exc), False
                stop.set()
                if state.set_fatal(str(exc)):
                    log(f"[{job.index}/{total}] STOPPING BATCH — {exc}")
            except JobError as exc:
                job.status, job.error, job.repairable = "failed", str(exc), exc.repairable
                log(f"[{job.index}/{total}] MISSED {job.stem} — {exc}")
                with lock:
                    counts["failed_now"] += 1
            except Exception as exc:     # disk full, permissions, bugs: stop safely
                job.status, job.error, job.repairable = "failed", f"local error: {exc}", False
                stop.set()
                if state.set_fatal(f"Local error while saving ({type(exc).__name__}: {exc})"):
                    log(f"[{job.index}/{total}] STOPPING BATCH — local error "
                        f"({type(exc).__name__}: {exc}). Check disk space / folder permissions.")
            finally:
                with lock:
                    job.entry["status"] = job.status
                    job.entry["error"] = job.error
                    job.entry["updated_at"] = now_iso()
                    with contextlib.suppress(OSError):
                        save_manifest(folder, manifest)
                tick()

        uploaded = None
        with keep_awake(log):
            try:
                if refs and ref_upload == "once":
                    uploaded = upload_references_once(client, refs, log, stop)
                    state.file_ids = uploaded
                if refs and not state.file_ids:
                    ref_mb = sum(len(r.data) for r in refs) / 1e6
                    log(f"Sending {len(refs)} reference image(s) with every prompt — {ref_mb:.1f} MB "
                        f"each time (~{ref_mb * len(jobs):.0f} MB for this batch).")
                log("")
                pending = jobs
                for pass_no in range(int(repair_passes) + 1):
                    if pass_no:
                        log(f"\nRepair pass {pass_no}/{repair_passes}: {len(pending)} image(s) still "
                            f"missing, trying again in {repair_wait:g}s...")
                        if stop.wait(repair_wait):
                            break
                        counts["failed_now"] -= len(pending)   # they are being retried
                        tick()
                    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                        list(pool.map(lambda j: worker(j, pass_no == 0), pending))
                    pending = [j for j in pending if j.status == "failed" and j.repairable]
                    if not pending or stop.is_set():
                        break
            finally:
                if uploaded:
                    for file_id in uploaded:
                        client.delete_file(file_id)
                    log("Removed the one-time reference uploads from OpenAI.")

        generated = sum(1 for j in jobs if j.status == "completed")
        cancelled = sum(1 for j in jobs if j.status in ("cancelled", "pending"))
        missing = [j for j in jobs if j.status == "failed"]
        tick()

        if missing:
            lines = [f"AI PROMPT: {j.prompt}\n" for j in missing]
            with contextlib.suppress(OSError):
                atomic_write(folder / "missing_prompts.txt", "\n".join(lines).encode("utf-8"))
        elif not cancelled:
            with contextlib.suppress(OSError):
                (folder / "missing_prompts.txt").unlink(missing_ok=True)

    if stop.is_set() and not state.fatal:
        log("\nStopped by user. Finished images are saved; Generate / Resume continues from here.")
    if state.fatal:
        log(f"\nBatch stopped: {state.fatal}")
    log(f"\nDone. {generated} generated, {skipped} already done, {len(missing)} missed, "
        f"{cancelled} not started.")
    cost_usd = round(spent["usd"], 4)
    if spent["priced_images"]:
        avg = spent["usd"] / spent["priced_images"]
        log(f"Cost this run (from OpenAI's own usage numbers): ${spent['usd']:.2f} for "
            f"{spent['priced_images']} image(s), avg ${avg:.3f} each "
            f"[images ${spent['output']:.2f} · references ${spent['refs']:.2f} · "
            f"text ${spent['text']:.2f}]")
        if spent["unpriced"]:
            log(f"  + {spent['unpriced']} image(s) came back without usage numbers "
                f"(about ${avg * spent['unpriced']:.2f} more).")
    elif spent["unpriced"]:
        why = (f"no price list for {settings.model} (edit PRICES at the top of the file)"
               if prices_for(settings.model) is None else "the replies had no usage numbers")
        log(f"Cost: no total for {spent['unpriced']} image(s) — {why}.")
        cost_usd = None
    if state.drops:
        per_request = spent["usd"] / max(1, spent["priced_requests"])
        worst = (f" OpenAI may still bill some of those even though nothing arrived "
                 f"(worst case about ${state.drops * per_request:.2f})." if spent["priced_requests"] else "")
        log(f"({state.drops} dropped connection(s) were caught and retried.{worst})")
    if missing:
        log("Missed prompts:")
        for j in missing:
            log(f"  [{j.index}] {j.stem} — {j.error}")
        log("Press Generate / Resume again to retry only these (they are also listed in "
            "missing_prompts.txt).")
    return {"total": total, "generated": generated, "skipped": skipped,
            "failed": len(missing), "cancelled": cancelled, "cost_usd": cost_usd}


# ----------------------------------------------------------------------------
# API KEY STORAGE (Windows DPAPI, same file as V5 so the saved key carries over)
# ----------------------------------------------------------------------------
def _dpapi(data: bytes, protect: bool) -> bytes:
    if os.name != "nt":
        raise OSError("Windows DPAPI is only available on Windows.")
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    blob_out = DATA_BLOB()
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(blob_in), "Crazay UGC API key", None, None,
                                      None, 0, ctypes.byref(blob_out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0,
                                        ctypes.byref(blob_out))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        if blob_out.pbData:
            kernel32.LocalFree(ctypes.cast(blob_out.pbData, ctypes.c_void_p))


def remember_key(key_var, data_dir: Path, status_var):
    if os.name != "nt":
        status_var.set("API key is kept for this session only on this platform.")
        return None
    path = Path(data_dir) / "openai_api_key.dpapi"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        status_var.set("API key is session-only; the key storage folder is unavailable.")
        return None
    if key_var.get().strip():
        status_var.set("Using the API key from OPENAI_API_KEY (not copied to disk).")
    elif path.exists():
        try:
            key_var.set(_dpapi(path.read_bytes(), protect=False).decode("utf-8"))
            status_var.set("Key loaded with Windows encryption.")
        except Exception:
            status_var.set("Saved key could not be decrypted. Paste the API key again.")

    def persist(*_):
        key = key_var.get().strip()
        try:
            if key:
                atomic_write(path, _dpapi(key.encode("utf-8"), protect=True))
                status_var.set("Key saved with Windows encryption.")
            else:
                path.unlink(missing_ok=True)
                status_var.set("Saved API key cleared.")
        except Exception:
            status_var.set("Could not save the key; it works for this session only.")

    return key_var.trace_add("write", persist)


def load_prefs(data_dir: Path) -> dict:
    try:
        data = json.loads((data_dir / "settings_v6.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_prefs(data_dir: Path, prefs: dict):
    with contextlib.suppress(OSError):
        data_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(data_dir / "settings_v6.json",
                     json.dumps(prefs, ensure_ascii=False, indent=2).encode("utf-8"))


def open_folder(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        os.startfile(str(path))  # noqa: S606 - opens Explorer on the user's own folder
    elif sys.platform == "darwin":
        import subprocess
        subprocess.Popen(["open", str(path)])
    else:
        import subprocess
        subprocess.Popen(["xdg-open", str(path)])


# ----------------------------------------------------------------------------
# GUI
# ----------------------------------------------------------------------------
def launch_gui():
    try:
        import tkinter as tk
        from tkinter import ttk, filedialog, scrolledtext, messagebox
    except Exception:
        print("tkinter is not available. Use CLI mode instead:\n"
              "  python ugc_concept_generator_v6.py --cli --prompts prompts.txt")
        sys.exit(1)

    script_dir = Path(__file__).resolve().parent
    data_dir = Path(os.environ.get("CRAZAY_DATA_DIR", str(script_dir / "data")))
    prefs = load_prefs(data_dir)
    book = CostBook(data_dir / "cost_history_v6.json")

    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("1000x900")
    root.minsize(840, 720)
    frm = ttk.Frame(root, padding=14)
    frm.pack(fill="both", expand=True)
    frm.columnconfigure(1, weight=1)
    frm.columnconfigure(3, weight=1)

    def pref(name, default):
        return str(prefs.get(name, default))

    v = {
        "key": tk.StringVar(value=os.environ.get("OPENAI_API_KEY", "")),
        "model": tk.StringVar(value=pref("model", DEFAULT_MODEL)),
        "quality": tk.StringVar(value=pref("quality", "high")),
        "size": tk.StringVar(value=pref("size", "1536x1024")),
        "background": tk.StringVar(value=pref("background", "auto")),
        "n": tk.StringVar(value=pref("n", 1)),
        "workers": tk.StringVar(value=pref("workers", 4)),
        "pace": tk.StringVar(value=pref("pace", 1.3)),
        "retries": tk.StringVar(value=pref("retries", 6)),
        "timeout": tk.StringVar(value=pref("timeout", DEFAULT_READ_TIMEOUT)),
        "stream": tk.StringVar(value=pref("stream", "auto")),
        "fidelity": tk.StringVar(value=pref("fidelity", "default")),
        "moderation": tk.StringVar(value=pref("moderation", "auto")),
        "refupload": tk.StringVar(value=pref("refupload", "once")),
        "prompts": tk.StringVar(value=pref("prompts", "")),
        "out": tk.StringVar(value=pref("out", str(script_dir / "concepts"))),
    }
    key_status = tk.StringVar()
    remember_key(v["key"], data_dir, key_status)
    # Keep remembered references even if one went missing, so the batch refuses to run
    # with fewer references instead of silently producing off-model images.
    references = [p for p in prefs.get("references", []) if isinstance(p, str)]
    events = queue.Queue()
    state = {"busy": False, "closing": False, "stop": threading.Event()}
    controls = []

    def add_control(widget, normal="normal"):
        controls.append((widget, normal))
        return widget

    row = 0
    ttk.Label(frm, text="UGC CONCEPT GENERATOR / V6", font=("Segoe UI", 17, "bold")).grid(
        row=row, column=0, columnspan=4, sticky="w")
    row += 1
    ttk.Label(frm, text="never-miss edition: keep-alive connections, automatic retries and "
                        "repair passes", foreground="#666666").grid(
        row=row, column=0, columnspan=5, sticky="w", pady=(0, 10))
    row += 1

    ttk.Label(frm, text="OpenAI API key").grid(row=row, column=0, sticky="w", pady=3)
    add_control(ttk.Entry(frm, textvariable=v["key"], show="•")).grid(
        row=row, column=1, columnspan=3, sticky="ew", padx=6)
    check_btn = add_control(ttk.Button(frm, text="Check key / models"))
    check_btn.grid(row=row, column=4, sticky="ew")
    row += 1
    ttk.Label(frm, textvariable=key_status, foreground="#666666").grid(
        row=row, column=1, columnspan=4, sticky="w", padx=6)
    row += 1

    combos = {}

    def pair(r, col, label, name, values=None, readonly=False, spin=None):
        ttk.Label(frm, text=label).grid(row=r, column=col, sticky="w" if col == 0 else "e",
                                        pady=3, padx=(0 if col == 0 else 12, 0))
        if values is not None:
            state_ = "readonly" if readonly else "normal"
            w = ttk.Combobox(frm, textvariable=v[name], values=values, state=state_, width=28)
            combos[name] = w
            add_control(w, state_)
        else:
            lo, hi, step = spin
            w = add_control(ttk.Spinbox(frm, from_=lo, to=hi, increment=step,
                                        textvariable=v[name], width=10))
        w.grid(row=r, column=col + 1, sticky="ew", padx=6, pady=3)

    pair(row, 0, "Image model", "model", MODEL_CHOICES)
    pair(row, 2, "Quality", "quality", QUALITY_CHOICES, readonly=True)
    row += 1
    pair(row, 0, "Canvas size", "size", SIZE_CHOICES)
    pair(row, 2, "Background", "background", BACKGROUND_CHOICES, readonly=True)
    row += 1
    pair(row, 0, "Images per prompt", "n", spin=(1, 10, 1))
    pair(row, 2, "Parallel workers", "workers", spin=(1, 16, 1))
    row += 1
    pair(row, 0, "Launch gap (seconds)", "pace", spin=(0.0, 60.0, 0.1))
    pair(row, 2, "Retries per image", "retries", spin=(0, 20, 1))
    row += 1
    pair(row, 0, "Request timeout (s)", "timeout", spin=(60, 3600, 30))
    pair(row, 2, "Keep-alive streaming", "stream", STREAM_CHOICES, readonly=True)
    row += 1
    pair(row, 0, "Reference fidelity", "fidelity", FIDELITY_CHOICES, readonly=True)
    pair(row, 2, "Moderation", "moderation", MODERATION_CHOICES, readonly=True)
    row += 1
    pair(row, 0, "Reference upload", "refupload", REF_UPLOAD_CHOICES, readonly=True)
    row += 1

    def browse(target):
        if target == "prompts":
            path = filedialog.askopenfilename(title="Pick your prompts notepad", filetypes=[
                ("Text / Markdown", "*.txt *.md"), ("All files", "*.*")])
        else:
            path = filedialog.askdirectory(title="Pick the output folder")
        if path:
            v[target].set(path)

    for name, label in (("prompts", "Prompt file (.txt / .md)"), ("out", "Output folder")):
        ttk.Label(frm, text=label).grid(row=row, column=0, sticky="w", pady=(8 if name == "prompts" else 3, 3))
        add_control(ttk.Entry(frm, textvariable=v[name])).grid(
            row=row, column=1, columnspan=3, sticky="ew", padx=6, pady=(8 if name == "prompts" else 3, 3))
        add_control(ttk.Button(frm, text="Browse", command=lambda n=name: browse(n))).grid(
            row=row, column=4, sticky="ew", pady=(8 if name == "prompts" else 3, 3))
        row += 1

    ttk.Label(frm, text="Reference images\n(optional)").grid(row=row, column=0, sticky="nw", pady=(8, 0))
    ref_frame = ttk.Frame(frm)
    ref_frame.grid(row=row, column=1, columnspan=3, sticky="ew", padx=6, pady=(8, 0))
    ref_frame.columnconfigure(0, weight=1)
    refs_list = tk.Listbox(ref_frame, height=4, selectmode="extended", font=("Consolas", 9))
    refs_list.grid(row=0, column=0, sticky="ew")
    ref_scroll = ttk.Scrollbar(ref_frame, orient="vertical", command=refs_list.yview)
    ref_scroll.grid(row=0, column=1, sticky="ns")
    refs_list.configure(yscrollcommand=ref_scroll.set)
    def ref_label(path):
        return Path(path).name if os.path.isfile(path) else f"[MISSING] {Path(path).name}"

    for path in references:
        refs_list.insert("end", ref_label(path))
    ref_buttons = ttk.Frame(frm)
    ref_buttons.grid(row=row, column=4, sticky="new", pady=(8, 0))

    def add_refs():
        for path in filedialog.askopenfilenames(title="Select reference images", filetypes=[
                ("Images", "*.png *.jpg *.jpeg *.webp"), ("All files", "*.*")]):
            if path not in references:
                references.append(path)
                refs_list.insert("end", Path(path).name)

    def remove_refs():
        for index in reversed(refs_list.curselection()):
            refs_list.delete(index)
            references.pop(index)

    def clear_refs():
        refs_list.delete(0, "end")
        references.clear()

    for label, handler in (("Add", add_refs), ("Remove selected", remove_refs), ("Clear all", clear_refs)):
        add_control(ttk.Button(ref_buttons, text=label, command=handler)).pack(fill="x", pady=1)
    row += 1

    progressbar = ttk.Progressbar(frm, mode="determinate")
    progressbar.grid(row=row, column=0, columnspan=5, sticky="ew", pady=(12, 4))
    row += 1
    status = tk.StringVar(value="Ready. Pick your prompts file, check settings, hit Generate / Resume.")
    ttk.Label(frm, textvariable=status).grid(row=row, column=0, columnspan=5, sticky="w")
    row += 1
    cost_var = tk.StringVar(value="Cost: press Load & Preview for an estimate.")
    ttk.Label(frm, textvariable=cost_var, font=("Segoe UI", 10, "bold")).grid(
        row=row, column=0, columnspan=5, sticky="w")
    row += 1
    logbox = scrolledtext.ScrolledText(frm, height=12, state="disabled", font=("Consolas", 9))
    logbox.grid(row=row, column=0, columnspan=5, sticky="nsew", pady=(4, 0))
    frm.rowconfigure(row, weight=1)
    row += 1
    bar = ttk.Frame(frm)
    bar.grid(row=row, column=0, columnspan=5, sticky="ew", pady=(8, 0))

    def log(message):
        events.put(("log", message))

    def busy(value):
        state["busy"] = value
        for widget, normal in controls:
            widget.configure(state="disabled" if value else normal)
        stop_btn.configure(state="normal" if value else "disabled")

    def read_number(name, kind, label):
        try:
            value = kind(v[name].get().strip())
        except ValueError:
            raise ValueError(f"{label} must be a number.") from None
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{label} must be a number.")
        return value

    def current_settings():
        return Settings(model=v["model"].get().strip(), quality=v["quality"].get(),
                        size=v["size"].get().strip(),
                        n=read_number("n", int, "Images per prompt"),
                        background=v["background"].get(), input_fidelity=v["fidelity"].get(),
                        moderation=v["moderation"].get()).validate()

    def show_estimate(prompts):
        try:
            settings = current_settings()
            refs = load_reference_images(references)
            todo, done_n = preview_plan(v["out"].get().strip() or ".", settings, prompts, refs)
        except (ValueError, OSError) as exc:
            log(f"Cost estimate unavailable: {exc}")
            cost_var.set("Cost: estimate unavailable (see log).")
            return
        est = estimate_cost(settings, todo, refs, book, v["stream"].get())
        for line in format_estimate(est, settings, len(refs), done_n):
            log(line)
        log("")
        if not est.get("priced"):
            cost_var.set("Cost: no price list for this model.")
        elif not todo:
            cost_var.set("Estimate: $0 — everything is already done in this output folder.")
        else:
            prefix = "~" if est["complete"] else "at least ~"
            cost_var.set(f"Estimate: {prefix}${est['total_usd']:.2f} for {est['images']} image(s)"
                         + (f"  ({done_n} already done)" if done_n else ""))

    def preview(estimate=True):
        path = v["prompts"].get().strip()
        if not path or not Path(path).is_file():
            messagebox.showerror("No file", "Pick your prompts file first.")
            return None
        try:
            prompts = parse_prompts(Path(path).read_text(encoding="utf-8-sig", errors="replace"))
        except OSError as exc:
            messagebox.showerror("Prompt file", str(exc))
            return None
        if not prompts:
            messagebox.showerror("No prompts found", "No 'AI PROMPT:' blocks found in that file.\n"
                                 "Put the line AI PROMPT: above each prompt paragraph.")
            return None
        log(f"Loaded {len(prompts)} prompt(s) from {Path(path).name}:")
        for i, prompt in enumerate(prompts, 1):
            note = "   <- very short, check it" if len(prompt) < SHORT_PROMPT else ""
            log(f"  {filename_for(prompt, i)}.png   ({len(prompt)} chars){note}")
        log("")
        if estimate:
            show_estimate(prompts)
        return prompts

    def check_models():
        try:
            client = ImageClient(v["key"].get())
        except ValueError as exc:
            messagebox.showerror("API key", str(exc))
            return
        busy(True)
        status.set("Checking the key and listing image models...")

        def worker():
            try:
                events.put(("models", client.models()))
                events.put(("done", "Key works."))
            except Exception as exc:
                log(f"Key/model check failed: {exc}")
                events.put(("done", "Key/model check failed. See the log."))

        threading.Thread(target=worker, daemon=True).start()

    check_btn.configure(command=check_models)

    def start():
        if state["busy"]:
            return
        prompts = preview(estimate=False)
        if not prompts:
            return
        try:
            settings = current_settings()
            options = dict(
                image_paths=tuple(references),
                workers=read_number("workers", int, "Parallel workers"),
                pace=read_number("pace", float, "Launch gap"),
                retries=read_number("retries", int, "Retries per image"),
                read_timeout=read_number("timeout", float, "Request timeout"),
                stream_mode=v["stream"].get(),
                ref_upload=v["refupload"].get())
            client = ImageClient(v["key"].get(), read_timeout=options["read_timeout"])
            out = v["out"].get().strip()
            if not out:
                raise ValueError("Choose an output folder.")
            load_reference_images(references)
        except (ValueError, OSError) as exc:
            messagebox.showerror("Settings", str(exc))
            return
        save_prefs(data_dir, {"model": settings.model, "quality": settings.quality,
                              "size": settings.size, "background": settings.background,
                              "n": settings.n, "workers": options["workers"],
                              "pace": options["pace"], "retries": options["retries"],
                              "timeout": options["read_timeout"], "stream": options["stream_mode"],
                              "fidelity": settings.input_fidelity,
                              "moderation": settings.moderation,
                              "refupload": options["ref_upload"],
                              "prompts": v["prompts"].get().strip(), "out": out,
                              "references": list(references)})
        state["stop"].clear()
        busy(True)
        progressbar.configure(maximum=len(prompts), value=0)
        status.set("Generating... finished images are saved and verified as they arrive.")
        cost_var.set("Spent this run: $0.00")

        def worker():
            try:
                result = run_batch("", settings, prompts, out, stop_event=state["stop"], log=log,
                                   progress=lambda i, n: events.put(("progress", (i, n))),
                                   on_cost=lambda usd, n: events.put(("cost", (usd, n))),
                                   client=client, cost_book=book, **options)
                events.put(("done", f"{result['generated']} generated, {result['skipped']} already "
                                    f"done, {result['failed']} missed, {result['cancelled']} not started"))
                events.put(("cost_final", result["cost_usd"]))
            except (ValueError, FatalError, JobError, RetryableError) as exc:
                log(str(exc))
                events.put(("done", "Stopped. Review the log."))
            except Exception as exc:
                log(f"Batch stopped due to a local error ({type(exc).__name__}: {exc}).")
                events.put(("done", "Stopped. Review the log."))

        threading.Thread(target=worker, daemon=True).start()

    def stop():
        state["stop"].set()
        status.set("Stopping: no new requests. Waiting for images already rendering to arrive...")

    def close():
        if not state["busy"]:
            root.destroy()
            return
        answer = messagebox.askyesnocancel(
            "Batch running",
            "A batch is still running.\n\nYes = stop, save the images already rendering, then close.\n"
            "No = quit right now (images still rendering are lost).\nCancel = keep going.")
        if answer is None:
            return
        if answer:
            state["closing"] = True
            stop()
        else:
            state["stop"].set()
            root.destroy()
            os._exit(0)   # don't linger in the background waiting for in-flight renders

    def open_out():
        try:
            open_folder(Path(v["out"].get().strip() or "."))
        except Exception as exc:
            messagebox.showerror("Output folder", str(exc))

    for label, handler in (("Load & Preview", preview), ("Generate / Resume", start)):
        add_control(ttk.Button(bar, text=label, command=handler)).pack(side="left", padx=(0, 8))
    stop_btn = ttk.Button(bar, text="Stop", command=stop, state="disabled")
    stop_btn.pack(side="left")
    ttk.Button(bar, text="Open output folder", command=open_out).pack(side="right")

    def pump():
        while True:
            try:
                kind, value = events.get_nowait()
            except queue.Empty:
                break
            if kind == "log":
                logbox.configure(state="normal")
                logbox.insert("end", str(value) + "\n")
                logbox.see("end")
                logbox.configure(state="disabled")
            elif kind == "progress":
                progressbar.configure(value=value[0], maximum=max(1, value[1]))
            elif kind == "cost":
                cost_var.set(f"Spent this run: ${value[0]:.2f} for {value[1]} image(s)")
            elif kind == "cost_final":
                cost_var.set("Spent this run: unknown (no usage numbers or price list; see the log)"
                             if value is None else
                             f"Spent this run: ${value:.2f} (from OpenAI's usage numbers; "
                             "details in the log)")
            elif kind == "models":
                combos["model"].configure(values=sorted(set(MODEL_CHOICES) | set(value)))
                log("Image models on this key: " + (", ".join(value) or "none listed"))
            elif kind == "done":
                status.set(value)
                busy(False)
                if state["closing"]:
                    root.destroy()
                    return
        root.after(100, pump)

    root.protocol("WM_DELETE_WINDOW", close)
    log("Ready. Pick your prompts file, check settings, add references if needed, "
        "hit Generate / Resume.")
    log(f"Network: TCP keep-alive {'on' if SOCKET_OPTIONS else 'unavailable'}; dropped "
        "connections are retried automatically.")
    for path in references:
        if not os.path.isfile(path):
            log(f"Reference image not found (moved or deleted?): {path} — re-add it or remove it "
                "before generating.")
    pump()
    root.mainloop()


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------
def selftest():
    sample = ("Intro text\n\n**AI PROMPT:** Draw a blue cotton hoodie on a mannequin, studio light,\n"
              "soft shadow, header text \"BLUE HOODIE\".\n\n**LC:** hoodie\n\n"
              "AI PROMPT:\n> A pink bunny plush sitting in a squishy dumpling farm, thumbnail style, "
              "bright colours.\n**Price** 50\n\n## AI PROMPT: short one\n\nAI PROMPT: dup prompt text\n"
              "AI PROMPT: dup prompt text\n")
    prompts = parse_prompts(sample)
    assert prompts == [
        'Draw a blue cotton hoodie on a mannequin, studio light, soft shadow, header text "BLUE HOODIE".',
        "A pink bunny plush sitting in a squishy dumpling farm, thumbnail style, bright colours.",
        "short one", "dup prompt text", "dup prompt text"], prompts
    assert filename_for(prompts[0], 1) == "001_blue_hoodie"
    s = Settings("gpt-image-2.5-flare", "xhigh", "2048x1152").validate()
    with contextlib.suppress(ValueError):
        Settings("gpt-image-2", "xhigh").validate()
        raise AssertionError("xhigh must be rejected for gpt-image-2")
    f = build_fields(s, "x", 1, with_refs=True, stream=True)
    assert f["stream"] is True and f["partial_images"] == PARTIAL_IMAGES and "background" not in f
    assert "partial_images" not in build_fields(s, "x", 1, with_refs=False, stream=True,
                                                dropped={"partial_images"})
    assert job_key("a", Settings()) != job_key("a", Settings(), occurrence=1)
    ra, rb = Reference("a.png", "image/png", b"A"), Reference("b.png", "image/png", b"B")
    assert job_key("a", Settings(), [ra, rb]) == job_key("a", Settings(), [rb, ra])   # order-free
    assert "input_fidelity" not in build_fields(Settings("gpt-image-2", input_fidelity="high"), "x", 1,
                                                with_refs=True, stream=False)
    # Output-token formula must reproduce OpenAI's published gpt-image-2 prices.
    assert formula_output_tokens("gpt-image-2", "high", "1024x1024") == 7024      # $0.211
    assert formula_output_tokens("gpt-image-2", "high", "1536x1024") == 5488      # $0.165
    assert formula_output_tokens("gpt-image-2", "medium", "1024x1024") == 1756    # $0.053
    assert formula_output_tokens("gpt-image-2", "low", "1024x1536") == 158        # $0.005
    assert formula_output_tokens("gpt-image-2", "medium", "1472x1200") == 1763
    # gpt-image-2.5 uses its own quality table (from OpenAI's cost calculator).
    assert [formula_output_tokens("gpt-image-2.5-flare", q, "2048x1152")
            for q in ("medium", "high", "xhigh", "max")] == [367, 1413, 2511, 5650]
    assert formula_output_tokens("gpt-image-2", "low", "2560x1040") == 112       # half-to-even
    assert image_dimensions(_tiny_png(5, 3)) == (5, 3)
    assert 1400 < rough_ref_tokens(2000, 1125) <= 1536
    cost = usage_cost("gpt-image-2", {"input_tokens": 1050, "output_tokens": 5488,
                                      "input_tokens_details": {"text_tokens": 50, "image_tokens": 1000}})
    assert abs(cost["usd"] - (50 * 5 + 1000 * 8 + 5488 * 30) / 1e6) < 1e-9
    book = CostBook()
    assert book.output_tokens("gpt-image-2.5-flare", "xhigh", "2048x1152")[0] == 2511
    book.record("gpt-image-2.5-flare-2026-09-08", "xhigh", "2048x1152", (),
                {"output_tokens": 9000, "input_tokens": 60}, 1)
    assert book.output_tokens("gpt-image-2.5-flare", "xhigh", "2048x1152")[0] == 9000
    book.record("gpt-image-2.5-flare", "xhigh", "2048x1152", (),
                {"output_tokens": 99999, "input_tokens": 60}, 1, streamed=True)       # previews excluded
    assert book.output_tokens("gpt-image-2.5-flare", "xhigh", "2048x1152")[0] == 9000
    for payload, kind in (({"type": "image_generation_user_error", "code": "invalid_image_file"}, FatalError),
                          ({"type": "image_generation_user_error", "code": "moderation_blocked"}, Blocked),
                          ({"type": "image_generation_user_error"}, Blocked)):
        assert type(error_from_payload(400, payload, {}, {}, {})) is kind, payload
    png = _tiny_png()
    assert verify_image(png) == "png"
    for broken in (png[:-5], png[:40] + b"\x00" + png[41:]):
        with contextlib.suppress(ValueError):
            verify_image(broken)
            raise AssertionError("broken PNG accepted")
    print(f"Parser, settings and image checks passed (no API calls). "
          f"TCP keep-alive options: {len(SOCKET_OPTIONS)} accepted, timed={KEEPALIVE_TIMED}.")
    return 0


def _tiny_png(w=4, h=4) -> bytes:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\xff\x80\x00" * w for _ in range(h))
    return (PNG_SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Crazay UGC Concept Generator V6")
    ap.add_argument("--cli", action="store_true", help="run without the window")
    ap.add_argument("--prompts", help="path to prompts .txt/.md")
    ap.add_argument("--out", default="ugc_concepts_v6", help="output folder")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--quality", default="high", choices=QUALITY_CHOICES)
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--background", default="auto", choices=BACKGROUND_CHOICES)
    ap.add_argument("--fidelity", default="default", choices=FIDELITY_CHOICES)
    ap.add_argument("--moderation", default="auto", choices=MODERATION_CHOICES)
    ap.add_argument("--n", type=int, default=1, help="images per prompt")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--pace", type=float, default=1.3, help="seconds between request launches")
    ap.add_argument("--delay", type=float, default=0.0, help="pause per worker after each image")
    ap.add_argument("--retries", type=int, default=6, help="retries per image")
    ap.add_argument("--timeout", type=float, default=DEFAULT_READ_TIMEOUT, help="request timeout (s)")
    ap.add_argument("--stream", default="auto", choices=STREAM_CHOICES, help="keep-alive streaming")
    ap.add_argument("--ref-upload", default="once", choices=REF_UPLOAD_CHOICES,
                    help="upload references once (file IDs) or with every prompt")
    ap.add_argument("--repair-passes", type=int, default=2)
    ap.add_argument("--reference", action="append", default=[], help="reference image (repeatable)")
    ap.add_argument("--key", default=None, help="API key (default: OPENAI_API_KEY)")
    ap.add_argument("--list-models", action="store_true", help="list image models for the key")
    ap.add_argument("--dry-run", action="store_true", help="parse + validate only, no API calls")
    ap.add_argument("--selftest", action="store_true", help="offline self-test")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest()
    key = args.key or os.environ.get("OPENAI_API_KEY", "")
    data_dir = Path(os.environ.get("CRAZAY_DATA_DIR", str(Path(__file__).resolve().parent / "data")))
    try:
        if args.list_models:
            print("\n".join(ImageClient(key).models()))
            return 0
        if not (args.cli or args.dry_run):
            launch_gui()
            return 0
        if not args.prompts or not Path(args.prompts).is_file():
            ap.error("pass --prompts path/to/your_prompts.txt")
        prompts = parse_prompts(Path(args.prompts).read_text(encoding="utf-8-sig", errors="replace"))
        if not prompts:
            raise ValueError("No 'AI PROMPT:' blocks found in that file.")
        settings = Settings(args.model, args.quality, args.size, args.n, args.background,
                            args.fidelity, args.moderation).validate()
        book = CostBook(data_dir / "cost_history_v6.json")
        if args.dry_run:
            refs = load_reference_images(args.reference)
            for i, p in enumerate(prompts, 1):
                print(f"  {filename_for(p, i)}.png  |  {len(p)} chars  |  {p[:70]}...")
            todo, done_n = preview_plan(args.out, settings, prompts, refs)
            print("\n".join(format_estimate(estimate_cost(settings, todo, refs, book, args.stream),
                                            settings, len(refs), done_n)))
            print("(dry run: no API calls made)")
            return 0
        stop = threading.Event()
        import signal
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        result = run_batch(key, settings, prompts, args.out, image_paths=args.reference,
                           workers=args.workers, pace=args.pace, delay=args.delay,
                           retries=args.retries, read_timeout=args.timeout,
                           stream_mode=args.stream, repair_passes=args.repair_passes,
                           ref_upload=args.ref_upload, stop_event=stop, cost_book=book)
        return 0 if not (result["failed"] or result["cancelled"]) else 2
    except (ValueError, FatalError, JobError, RetryableError, OSError) as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
