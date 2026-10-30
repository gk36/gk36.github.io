import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync, useLive } from '../ui/hooks';
import { Field, Segmented } from '../ui/controls';
import { ArrowRightLeft, Copy, Info, Trash } from '../ui/icons';
import { MacroLine, SourceBadge } from '../ui/nutrition';
import { duplicateEntry, ensureDay, getEntry, markEaten, updateEntry } from '../data/entries';
import { displayName, type Quantity } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { contribution } from '../domain/nutrition/compute';
import type { EntryStatus } from '../data/types';
import { closeSheet, openSheet, profile, toast } from '../app/store';
import { deleteWithUndo } from '../app/actions';
import { freezeTargets } from '../data/plan';
import { AmountPicker } from './AmountPicker';

export function EntryEditor({ entryId }: { entryId: string }) {
  const e = useLive(() => getEntry(entryId), [entryId], undefined);
  const day = useAsync(async () => (e ? ensureDay(e.dayKey) : undefined), [e?.dayKey]);
  const [qty, setQty] = useState<Quantity | null>(null);
  const [status, setStatus] = useState<EntryStatus>('eaten');
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!e) return;
    setQty(e.qty); setStatus(e.status); setSlot(e.slotId); setNote(e.note ?? '');
  }, [e?.id]);

  if (!e || !qty) return <Sheet title="Entry" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  const food = e.food;
  const c = contribution(food, qty);

  const save = async () => {
    const p = profile.value;
    if (status === 'eaten' && e.status === 'planned') {
      if (p) await freezeTargets(p, e.dayKey);
      await markEaten(e.id, { qty });
      if (slot !== e.slotId || note !== (e.note ?? '')) await updateEntry(e.id, { slotId: slot, note });
    } else {
      await updateEntry(e.id, { qty, status, slotId: slot, note });
    }
    toast('Saved', { tone: 'ok' });
    closeSheet();
  };

  return (
    <Sheet title={displayName(food)} onClose={closeSheet}
      footer={<>
        <button type="button" class="btn btn-danger" onClick={() => { void deleteWithUndo(e); closeSheet(); }}><Trash size={16} aria-hidden="true" /> Delete</button>
        <button type="button" class="btn btn-primary" disabled={'error' in c} onClick={() => void save()}>Save</button>
      </>}>
      <div class="cluster small muted"><SourceBadge src={food.src} /><span>{food.notes}</span></div>
      {e.planned ? (
        <div class="callout small">
          Planned: <b>{describeQuantity(food, e.planned.qty)}</b>{e.planned.foodId !== e.foodId ? ` of ${e.planned.foodName}` : ''}
          {(() => {
            const pc = contribution(food, e.planned.qty);
            return 'error' in pc || 'error' in c ? null : <> · actual differs by <b>{Math.round((c.n.kcal ?? 0) - (pc.n.kcal ?? 0))} kcal</b></>;
          })()}
        </div>
      ) : null}
      <AmountPicker food={food} qty={qty} onChange={setQty} />
      <Segmented label="Status" value={status} onChange={setStatus}
        options={[{ value: 'eaten', label: 'Eaten' }, { value: 'planned', label: 'Planned' }, { value: 'skipped', label: 'Skipped' }]} />
      <Field label="Meal" for="ee-slot">
        <select id="ee-slot" class="select" value={slot} onChange={(ev) => setSlot(ev.currentTarget.value)}>
          {(day?.slots ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {!day?.slots.some((s) => s.id === slot) ? <option value={slot}>Other</option> : null}
        </select>
      </Field>
      <Field label="Note" for="ee-note"><textarea id="ee-note" class="textarea" value={note} onInput={(ev) => setNote(ev.currentTarget.value)} placeholder="e.g. weighed after cooking, half the pan…" /></Field>
      <div class="cluster">
        <button type="button" class="btn btn-s" onClick={() => openSheet({ kind: 'food', food })}><Info size={16} aria-hidden="true" /> Food details</button>
        <button type="button" class="btn btn-s" onClick={async () => { await duplicateEntry(e.id); toast('Duplicated'); closeSheet(); }}><Copy size={16} aria-hidden="true" /> Duplicate</button>
        <button type="button" class="btn btn-s" onClick={() => openSheet({ kind: 'swap', entryId: e.id })}><ArrowRightLeft size={16} aria-hidden="true" /> Swap food</button>
      </div>
      {'error' in c ? <p class="error">{c.error}</p> : <p class="small muted">This entry: <MacroLine n={c.n} /></p>}
    </Sheet>
  );
}
