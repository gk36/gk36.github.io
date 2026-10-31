import { parseLabelText, type LabelText } from '../domain/nutrition/labelText';

/**
 * Reads a nutrition label photo on the device (Tesseract, Greek + English). The photo never leaves
 * the phone. Engine and models (~8 MB) are self-hosted and fetched on first use, then cached.
 */

const BASE = `${import.meta.env.BASE_URL}ocr/7.0.0/`; // also in vite.config.ts

/** WebAssembly SIMD (Safari 16.4+, every current Chrome/Firefox) picks the faster engine build. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const hasSimd = () => { try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; } };

/** Long side ≤ 2,400 px and greyscale: faster, and phone photos are far larger than OCR needs. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface OcrProgress { status: string; progress: number }

export async function readLabelPhoto(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<{ text: string; parsed: LabelText }> {
  onProgress?.({ status: 'Preparing the photo', progress: 0 });
  const image = await prepare(file);
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker(['ell', 'eng'], OEM.LSTM_ONLY, {
    workerPath: `${BASE}worker.min.js`,
    corePath: `${BASE}${hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`,
    langPath: `${BASE}lang`,
    gzip: true,
    workerBlobURL: false,
    // The service worker caches the model files; no second copy in IndexedDB.
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => onProgress?.({ status: m.status, progress: m.progress }),
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text, parsed: parseLabelText(data.text) };
  } finally {
    await worker.terminate();
  }
}
