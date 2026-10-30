import { draftText, openSheet } from '../../app/store';
import { ScanBarcode, Search, Sparkles } from '../../ui/icons';
import type { DayKey } from '../../domain/time';

/** "What did you eat?" — type or dictate a whole meal; it is checked item by item before saving. */
export function Composer({ dayKey }: { dayKey: DayKey }) {
  const text = draftText.value;
  const submit = () => { if (text.trim()) openSheet({ kind: 'quicklog', dayKey, text: text.trim() }); };
  return (
    <form class="composer" aria-label="Log what you ate" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label for="composer-text" class="composer-label"><Sparkles size={16} aria-hidden="true" /> What did you eat?</label>
      <textarea
        id="composer-text" class="composer-input" rows={2} value={text} enterkeyhint="send"
        placeholder="e.g. 2 eggs, 80 g oats with 250 ml milk and a banana"
        onInput={(e) => { draftText.value = e.currentTarget.value; }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div class="composer-actions">
        <button type="button" class="btn btn-ghost btn-s" onClick={() => openSheet({ kind: 'scan', dayKey })}><ScanBarcode size={16} aria-hidden="true" /> Scan</button>
        <button type="button" class="btn btn-ghost btn-s" onClick={() => openSheet({ kind: 'quicklog', dayKey })}><Search size={16} aria-hidden="true" /> Search</button>
        <span class="topbar-spacer" />
        <button type="submit" class="btn btn-primary btn-s" disabled={!text.trim()}>Check &amp; log</button>
      </div>
      <p class="xs subtle composer-hint">English or Ελληνικά. Tap the keyboard's mic to dictate. Nothing is saved until you check it.</p>
    </form>
  );
}
