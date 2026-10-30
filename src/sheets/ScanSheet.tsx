import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/controls';
import { Camera, ChevronLeft, ScanBarcode, Sun, TriangleAlert } from '../ui/icons';
import { NutrientTable, SourceBadge } from '../ui/nutrition';
import { decodeImageFile, getDetector, normalizeGtin } from '../integrations/barcode';
import { lookupBarcode, mapOffProduct, savedFoodsForBarcode, type MappedProduct } from '../integrations/off';
import { saveCustomFood } from '../data/foods/registry';
import { displayName, type Food } from '../domain/nutrition/food';
import { closeSheet, openSheet, toast } from '../app/store';
import type { DayKey } from '../domain/time';

type View =
  | { k: 'camera' }
  | { k: 'manual' }
  | { k: 'busy'; code: string }
  | { k: 'known'; code: string; foods: Food[] }
  | { k: 'found'; code: string; mapped: MappedProduct }
  | { k: 'not-found'; code: string }
  | { k: 'error'; code: string; message: string };

export function ScanSheet({ dayKey, slotId }: { dayKey: DayKey; slotId?: string }) {
  const [view, setView] = useState<View>({ k: 'camera' });
  const logFood = (food: Food) => openSheet({ kind: 'quicklog', dayKey, food, ...(slotId ? { slotId } : {}) });

  const handleCode = async (code: string) => {
    setView({ k: 'busy', code });
    const known = await savedFoodsForBarcode(code);
    if (known.length) { setView({ k: 'known', code, foods: known }); return; }
    const r = await lookupBarcode(code);
    if (r.status === 'found') setView({ k: 'found', code, mapped: mapOffProduct(r.product, code) });
    else if (r.status === 'not-found') setView({ k: 'not-found', code });
    else setView({ k: 'error', code, message: r.message });
  };

  const back = <button type="button" class="btn btn-ghost btn-icon" aria-label="Scan again" onClick={() => setView({ k: 'camera' })}><ChevronLeft size={20} /></button>;
  const attribution = <p class="xs subtle">Product data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a> contributors, ODbL. Crowd-sourced — check it against the package.</p>;

  switch (view.k) {
    case 'camera':
      return (
        <Sheet title="Scan a barcode" onClose={closeSheet}
          footer={<><button type="button" class="btn" onClick={() => setView({ k: 'manual' })}>Type the number</button><PhotoButton onCode={(c) => void handleCode(c)} /></>}>
          <CameraView onCode={(c) => void handleCode(c)} onFail={() => setView({ k: 'manual' })} />
        </Sheet>
      );
    case 'manual':
      return <ManualEntry onBack={() => setView({ k: 'camera' })} onCode={(c) => void handleCode(c)} />;
    case 'busy':
      return <Sheet title="Looking up…" onClose={closeSheet} lead={back}><p class="muted" role="status">Barcode {view.code} — checking your foods, then Open Food Facts…</p></Sheet>;
    case 'known':
      return (
        <Sheet title="Already in your foods" onClose={closeSheet} lead={back}>
          <p class="small muted">Barcode {view.code}</p>
          <ul class="list">{view.foods.map((f) => (
            <li key={f.id}><button type="button" class="item" onClick={() => logFood(f)}>
              <div class="item-main"><span class="item-name">{displayName(f)}</span><span class="item-sub cluster"><SourceBadge src={f.src} />{f.src.verifiedAt ? <span>checked {f.src.verifiedAt}</span> : null}</span></div>
              <span class="btn btn-s btn-primary">Log</span>
            </button></li>
          ))}</ul>
        </Sheet>
      );
    case 'found': {
      const { mapped } = view;
      const save = async (andLog: boolean) => {
        const saved = await saveCustomFood(mapped.food);
        toast(`Saved ${displayName(saved)}`, { tone: 'ok' });
        if (andLog) logFood(saved); else closeSheet();
      };
      return (
        <Sheet title={displayName(mapped.food)} onClose={closeSheet} lead={back}
          footer={<>
            <button type="button" class="btn" onClick={() => openSheet({ kind: 'food-editor', prefill: mapped.food, thenLog: { dayKey, ...(slotId ? { slotId } : {}) } })}>Check & edit first</button>
            <button type="button" class="btn btn-primary" disabled={mapped.errors.length > 0 || mapped.food.n.kcal === undefined} onClick={() => void save(true)}>Save & log</button>
          </>}>
          <div class="cluster" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            {mapped.image ? <img src={mapped.image} alt="" width={72} height={72} style={{ objectFit: 'contain', borderRadius: '10px', background: '#fff' }} /> : null}
            <div class="stack-s">
              <span class="small muted">Barcode {view.code}{mapped.food.notes ? ` · ${mapped.food.notes}` : ''}</span>
              <span class="cluster"><SourceBadge src={mapped.food.src} /><span class="badge">{mapped.food.basis.per === '100ml' ? 'per 100 mL' : 'per 100 g'}</span></span>
            </div>
          </div>
          {mapped.missing.length ? <div class="callout warn small" role="note"><TriangleAlert size={15} aria-hidden="true" /> Missing in Open Food Facts: {mapped.missing.join(', ')}. Use “Check & edit first” and copy them from the package.</div> : null}
          {mapped.errors.map((e) => <p key={e} class="error" role="alert">{e}</p>)}
          {mapped.warnings.map((w) => <p key={w} class="small muted">{w}</p>)}
          <NutrientTable ids={['kcal', 'protein', 'carbs', 'sugars', 'fiber', 'fat', 'satFat', 'sodium']} values={mapped.food.n} />
          {attribution}
        </Sheet>
      );
    }
    case 'not-found':
      return (
        <Sheet title="Not found" onClose={closeSheet} lead={back}
          footer={<button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'food-editor', prefill: { gtin: view.code, names: { en: '' } }, thenLog: { dayKey, ...(slotId ? { slotId } : {}) } })}>Add it from the label</button>}>
          <p>Barcode <b>{view.code}</b> is not in Open Food Facts yet. Add it from the nutrition label once — next time this barcode opens your saved food, even offline.</p>
          {attribution}
        </Sheet>
      );
    case 'error':
      return (
        <Sheet title="Couldn't look it up" onClose={closeSheet} lead={back}
          footer={<>
            <button type="button" class="btn" onClick={() => void handleCode(view.code)}>Try again</button>
            <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'food-editor', prefill: { gtin: view.code, names: { en: '' } }, thenLog: { dayKey, ...(slotId ? { slotId } : {}) } })}>Enter the label</button>
          </>}>
          <p role="alert">{view.message}</p>
        </Sheet>
      );
  }
}

/** Live camera preview + continuous detection. A code must be read twice in a row to count. */
function CameraView({ onCode, onFail }: { onCode: (c: string) => void; onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting the camera…');
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = '';
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('The camera needs a secure (https) page. Type the number or use a photo instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setStatus(name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings, or type the number / use a photo.' : name === 'NotFoundError' ? 'No camera found. Type the number or use a photo.' : 'The camera could not start. Type the number or use a photo.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch({ available: !!caps.torch, on: false });
      setStatus('Point at the barcode. Hold steady.');
      let det;
      try { det = await getDetector(); } catch { setStatus('The barcode reader could not load. Type the number or use a photo.'); return; }
      const tick = async () => {
        if (stopped) return;
        if (v.readyState >= 2) {
          try {
            for (const raw of await det.detect(v)) {
              const code = normalizeGtin(raw);
              if (!code) continue;
              if (code === last) { stopped = true; onCode(code); return; }
              last = code;
            }
          } catch { /* transient decode errors are fine */ }
        }
        timer = window.setTimeout(() => void tick(), 180);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    const t = trackRef.current;
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch({ available: true, on: !torch.on });
    } catch { setTorch({ available: false, on: false }); }
  };

  return (
    <div class="stack">
      <div style={{ position: 'relative', borderRadius: '14px', overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
        <video ref={video} playsInline muted aria-label="Camera preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div aria-hidden="true" style={{ position: 'absolute', left: '12%', right: '12%', top: '38%', height: '24%', border: '3px solid var(--ember)', borderRadius: '12px' }} />
      </div>
      <p class="small muted" role="status" aria-live="polite"><ScanBarcode size={15} aria-hidden="true" /> {status}</p>
      {torch.available ? <button type="button" class="btn btn-s" aria-pressed={torch.on} onClick={() => void toggleTorch()}><Sun size={16} aria-hidden="true" /> {torch.on ? 'Torch off' : 'Torch on'}</button> : null}
      <button type="button" class="linkish small" style={{ alignSelf: 'flex-start' }} onClick={onFail}>Camera not working? Type the number</button>
    </div>
  );
}

function PhotoButton({ onCode }: { onCode: (c: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label class="btn btn-primary" aria-busy={busy}>
      <Camera size={16} aria-hidden="true" /> {busy ? 'Reading…' : 'Use a photo'}
      <input type="file" accept="image/*" capture="environment" class="sr-only" onChange={async (e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!f) return;
        setBusy(true);
        try {
          const code = await decodeImageFile(f);
          if (code) onCode(code);
          else toast('No barcode found in that photo. Try closer, flatter and well lit — or type the number.', { tone: 'warn', ms: 5000 });
        } catch {
          toast('That image could not be read.', { tone: 'warn' });
        } finally {
          setBusy(false);
        }
      }} />
    </label>
  );
}

function ManualEntry({ onBack, onCode }: { onBack: () => void; onCode: (c: string) => void }) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const code = normalizeGtin(text);
  return (
    <Sheet title="Type the barcode" onClose={closeSheet} lead={<button type="button" class="btn btn-ghost btn-icon" aria-label="Back to camera" onClick={onBack}><ChevronLeft size={20} /></button>}
      footer={<button type="submit" form="bc-form" class="btn btn-primary" disabled={!code}>Look up</button>}>
      <form id="bc-form" class="stack" onSubmit={(e) => { e.preventDefault(); if (code) onCode(code); else setTouched(true); }}>
        <Field label="Barcode number (EAN or UPC)" for="bc-input" error={touched && text && !code ? 'That number is not a valid barcode (check digit does not match).' : null} hint="The digits under the bars, e.g. 5201234567890">
          <input id="bc-input" class="input input-num" inputMode="numeric" autoComplete="off" autoFocus value={text}
            onInput={(e) => setText(e.currentTarget.value.replace(/[^\d]/g, ''))} onBlur={() => setTouched(true)} />
        </Field>
      </form>
    </Sheet>
  );
}
