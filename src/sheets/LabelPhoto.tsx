import { useState } from 'preact/hooks';
import { Camera } from '../ui/icons';
import type { LabelText } from '../domain/nutrition/labelText';
import type { OcrProgress } from '../integrations/ocr';

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Loading the reader',
  'initializing tesseract': 'Starting the reader',
  'loading language traineddata': 'Loading Greek + English',
  'initializing api': 'Starting the reader',
  'recognizing text': 'Reading the label',
};

/** "Read label photo": OCR on the device; the editor fills the empty fields for the user to check. */
export function LabelPhoto({ onRead }: { onRead: (r: { text: string; parsed: LabelText }) => void }) {
  const [busy, setBusy] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div class="callout small stack-s">
      <div class="cluster" style={{ justifyContent: 'space-between' }}>
        <span style={{ flex: '1 1 220px' }}>Photograph the nutrition table and the numbers are filled in for you to check. It is read on this phone; the first time downloads about 8 MB.</span>
        <label class="btn btn-s" aria-busy={!!busy}>
          <Camera size={15} aria-hidden="true" /> {busy ? 'Reading…' : 'Read label photo'}
          <input type="file" accept="image/*" capture="environment" class="sr-only" disabled={!!busy} onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            setError(null);
            setBusy({ status: 'Preparing the photo', progress: 0 });
            try {
              const { readLabelPhoto } = await import('../integrations/ocr');
              onRead(await readLabelPhoto(f, (p) => setBusy(p)));
            } catch {
              setError('The photo could not be read. Try again in good light, or type the values.');
            } finally {
              setBusy(null);
            }
          }} />
        </label>
      </div>
      {busy ? (
        <div class="cluster" role="status">
          <span>{STATUS[busy.status] ?? busy.status}…</span>
          <progress max={1} value={busy.progress} aria-label="Reading progress" style={{ flex: '1 1 120px' }} />
        </div>
      ) : null}
      {error ? <p class="error" role="alert">{error}</p> : null}
    </div>
  );
}
