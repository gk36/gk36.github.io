/**
 * Barcode reading for packaged food (EAN-13, EAN-8, UPC-A, UPC-E).
 * Uses the native BarcodeDetector where it exists (Chrome on Android/macOS/ChromeOS); everywhere
 * else (iPhone Safari, Windows/Linux Chrome, Firefox) a self-hosted ZXing WebAssembly ponyfill,
 * loaded only when the scanner is opened. A barcode identifies a product record — it never
 * carries nutrition by itself.
 */

export const FOOD_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

/** Validates a GTIN-8/12/13/14 check digit and returns the digits, or null. */
export function normalizeGtin(raw: string): string | null {
  const d = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return null;
  const digits = d.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check ? d : null;
}

/** Expands a UPC-E (8 digits incl. number system and check digit) to UPC-A, for database lookups. */
export function upcEToA(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0]!, d = upce.slice(1, 7), check = upce[7]!;
  const last = d[5]!;
  let body: string;
  if ('012'.includes(last)) body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  else if (last === '3') body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (last === '4') body = `${d.slice(0, 4)}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  const upca = `${ns}${body}${check}`;
  return normalizeGtin(upca) ? upca : null;
}

export interface Detector {
  native: boolean;
  detect(source: ImageBitmapSource): Promise<string[]>;
}

interface DetectedLike { rawValue: string; format: string }
type DetectorCtor = new (opts?: { formats?: string[] }) => { detect(src: ImageBitmapSource): Promise<DetectedLike[]> };

let detectorPromise: Promise<Detector> | null = null;

export function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const g = globalThis as unknown as { BarcodeDetector?: DetectorCtor & { getSupportedFormats?: () => Promise<string[]> } };
    if (g.BarcodeDetector && typeof g.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await g.BarcodeDetector.getSupportedFormats();
        if (FOOD_FORMATS.every((f) => supported.includes(f))) {
          const det = new g.BarcodeDetector({ formats: [...FOOD_FORMATS] });
          return { native: true, detect: async (s) => (await det.detect(s)).map((r) => r.rawValue) };
        }
      } catch { /* fall through to the ponyfill */ }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    // Load the WebAssembly from this site, never from a CDN (privacy, offline use, CSP).
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
    const det = new BarcodeDetector({ formats: [...FOOD_FORMATS] });
    return { native: false, detect: async (s) => (await det.detect(s)).map((r) => r.rawValue) };
  })();
  return detectorPromise;
}

/** Reads the first valid food barcode in a photo, or null. */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  const det = await getDetector();
  const bitmap = await createImageBitmap(file);
  try {
    for (const raw of await det.detect(bitmap)) {
      const g = normalizeGtin(raw);
      if (g) return g;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
