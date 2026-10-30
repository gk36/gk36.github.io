import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync, useLive } from '../ui/hooks';
import { Checkbox, Field, Segmented } from '../ui/controls';
import { ChevronLeft, ChevronRight, Plus, Trash } from '../ui/icons';
import { copyEntries, ensureDay, listDay, updateDay } from '../data/entries';
import { db } from '../data/db';
import { nowIso, uuidv7 } from '../data/ids';
import type { SavedMeal, Slot } from '../data/types';
import { addDays, formatDayLabel, type DayKey } from '../domain/time';
import { displayName } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { closeSheet, profile, toast, updateProfile } from '../app/store';
import { snapshotOf } from '../data/entries';

/** Copy meals from another day — as new, independent entries. */
export function CopyDaySheet({ toDay }: { toDay: DayKey }) {
  const [from, setFrom] = useState(addDays(toDay, -1));
  const [status, setStatus] = useState<'planned' | 'eaten'>('planned');
  const entries = useLive(() => listDay(from), [from], []);
  const src = useLive(() => db().days.get(from), [from], undefined);
  const slots = (src?.slots ?? profile.value?.defaultSlots ?? []).filter((s) => entries.some((e) => e.slotId === s.id));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => setChosen(new Set(slots.map((s) => s.id))), [from, slots.length]);
  const rows = entries.filter((e) => chosen.has(e.slotId) && e.status !== 'skipped');
  const run = async () => {
    await copyEntries(rows, toDay, status, src?.slots ?? []);
    toast(`Copied ${rows.length} items to ${formatDayLabel(toDay)}`, { tone: 'ok' });
    closeSheet();
  };
  return (
    <Sheet title={`Copy into ${formatDayLabel(toDay)}`} onClose={closeSheet}
      footer={<><button type="button" class="btn" onClick={closeSheet}>Cancel</button><button type="button" class="btn btn-primary" disabled={!rows.length} onClick={() => void run()}>Copy {rows.length} items</button></>}>
      <div class="spread">
        <button type="button" class="btn btn-icon" aria-label="Earlier day" onClick={() => setFrom(addDays(from, -1))}><ChevronLeft size={18} /></button>
        <b>From {formatDayLabel(from)}</b>
        <button type="button" class="btn btn-icon" aria-label="Later day" onClick={() => setFrom(addDays(from, 1))}><ChevronRight size={18} /></button>
      </div>
      {slots.length ? slots.map((s) => (
        <Checkbox key={s.id} checked={chosen.has(s.id)} onChange={(v) => { const n = new Set(chosen); if (v) n.add(s.id); else n.delete(s.id); setChosen(n); }}
          label={<span><b>{s.name}</b> <span class="muted small">— {entries.filter((e) => e.slotId === s.id).map((e) => displayName(e.food)).join(', ')}</span></span>} />
      )) : <p class="muted">Nothing logged on that day.</p>}
      <Segmented label="Add them as" value={status} onChange={setStatus} options={[{ value: 'planned', label: 'Planned' }, { value: 'eaten', label: 'Eaten' }]} />
    </Sheet>
  );
}

/** Save a meal for one-tap logging, or rename/delete an existing one. */
export function SavedMealSheet({ mealId, fromEntries }: { mealId?: string; fromEntries?: string[] }) {
  const existing = useAsync(() => (mealId ? db().savedMeals.get(mealId) : Promise.resolve(undefined)), [mealId]);
  const source = useAsync(async () => (fromEntries ? (await Promise.all(fromEntries.map((id) => db().entries.get(id)))).filter((e) => e && !e.deletedAt) : []), [fromEntries?.join()]);
  const [name, setName] = useState('');
  useEffect(() => { if (existing) setName(existing.name); }, [existing?.id]);
  const items = existing?.items ?? (source ?? []).map((e) => ({ foodId: e!.foodId, food: snapshotOf(e!.food), qty: e!.qty }));
  const save = async () => {
    const t = nowIso();
    const meal: SavedMeal = existing
      ? { ...existing, name: name.trim(), updatedAt: t, rev: existing.rev + 1 }
      : { id: uuidv7(), name: name.trim(), items, createdAt: t, updatedAt: t, rev: 1, deletedAt: null };
    await db().savedMeals.put(meal);
    toast(`Saved meal “${meal.name}”`, { tone: 'ok' });
    closeSheet();
  };
  const remove = async () => {
    if (!existing) return;
    await db().savedMeals.put({ ...existing, deletedAt: nowIso(), updatedAt: nowIso(), rev: existing.rev + 1 });
    toast('Saved meal deleted', { action: { label: 'Undo', run: async () => { await db().savedMeals.put({ ...existing, deletedAt: null, updatedAt: nowIso(), rev: existing.rev + 2 }); } } });
    closeSheet();
  };
  return (
    <Sheet title={existing ? 'Saved meal' : 'Save as meal'} onClose={closeSheet}
      footer={<>{existing ? <button type="button" class="btn btn-danger" onClick={() => void remove()}><Trash size={16} aria-hidden="true" /> Delete</button> : null}<button type="button" class="btn btn-primary" disabled={!name.trim() || !items.length} onClick={() => void save()}>Save</button></>}>
      <Field label="Name" for="sm-name"><input id="sm-name" class="input" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Chicken sweet-chili bowl" /></Field>
      <div class="list">
        {items.map((it, i) => (
          <div class="item" key={i}><div class="item-main"><span class="item-name">{displayName(it.food)}</span><span class="item-sub">{describeQuantity(it.food, it.qty)}</span></div></div>
        ))}
      </div>
    </Sheet>
  );
}

/** Rename, reorder, add and remove the meal slots of one day (and optionally make them the default). */
export function SlotsSheet({ dayKey }: { dayKey: DayKey }) {
  const day = useAsync(() => ensureDay(dayKey), [dayKey]);
  const entries = useLive(() => listDay(dayKey), [dayKey], []);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  useEffect(() => { if (day && !slots) setSlots(day.slots.map((s) => ({ ...s }))); }, [day]);
  if (!slots) return <Sheet title="Meals" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  const used = new Set(entries.map((e) => e.slotId));
  const move = (i: number, d: -1 | 1) => { const n = [...slots]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setSlots(n); };
  const valid = slots.every((s) => s.name.trim());
  const save = async (asDefault: boolean) => {
    await updateDay(dayKey, { slots });
    if (asDefault) await updateProfile({ defaultSlots: slots.map((s) => ({ ...s })) });
    toast('Meals updated', { tone: 'ok' });
    closeSheet();
  };
  return (
    <Sheet title={`Meals · ${formatDayLabel(dayKey)}`} onClose={closeSheet}
      footer={<><button type="button" class="btn" disabled={!valid} onClick={() => void save(true)}>Save as my default</button><button type="button" class="btn btn-primary" disabled={!valid} onClick={() => void save(false)}>Save</button></>}>
      {slots.map((s, i) => (
        <div class="cluster" key={s.id} style={{ flexWrap: 'nowrap' }}>
          <input class="input" aria-label={`Meal ${i + 1} name`} value={s.name} onInput={(e) => { const n = [...slots]; n[i] = { ...s, name: e.currentTarget.value }; setSlots(n); }} />
          <input class="input" aria-label={`Meal ${i + 1} time`} style={{ maxWidth: '110px' }} value={s.time ?? ''} placeholder="time" onInput={(e) => { const n = [...slots]; const v = e.currentTarget.value; n[i] = v ? { ...s, time: v } : { id: s.id, name: s.name }; setSlots(n); }} />
          <button type="button" class="btn btn-icon btn-s" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" class="btn btn-icon btn-s" aria-label={`Move ${s.name} down`} disabled={i === slots.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" class="btn btn-icon btn-s btn-danger" aria-label={`Remove ${s.name}`} disabled={used.has(s.id)} title={used.has(s.id) ? 'Move or delete its food first' : undefined} onClick={() => setSlots(slots.filter((x) => x.id !== s.id))}><Trash size={15} /></button>
        </div>
      ))}
      <button type="button" class="btn" onClick={() => setSlots([...slots, { id: uuidv7(), name: 'New meal' }])}><Plus size={16} aria-hidden="true" /> Add a meal</button>
    </Sheet>
  );
}
