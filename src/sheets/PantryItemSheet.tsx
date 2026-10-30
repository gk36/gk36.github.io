import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync } from '../ui/hooks';
import { Checkbox, Field } from '../ui/controls';
import { FoodPicker } from '../ui/FoodPicker';
import { SourceBadge } from '../ui/nutrition';
import { AmountPicker } from './AmountPicker';
import { db } from '../data/db';
import { addPantryItem, removePantryItem, restorePantryItem, updatePantryItem } from '../data/pantry';
import type { FoodSnapshot } from '../data/types';
import { displayName, PREP_LABEL, type Food, type Quantity } from '../domain/nutrition/food';
import { defaultQuantity } from '../domain/nutrition/quantity';
import { closeSheet, toast } from '../app/store';

const startQty = (f: Food): Quantity => (f.basis.per === 'unit' || f.group === 'fruit' || /\begg\b/i.test(f.names.en) ? defaultQuantity(f) : { amount: 100, unit: f.basis.per === '100ml' ? 'ml' : 'g' });

/** Add a food to the pantry, or edit / use up a pantry lot. */
export function PantryItemSheet({ itemId, food: given }: { itemId?: string; food?: Food | FoodSnapshot }) {
  const existing = useAsync(async () => (itemId ? (await db().pantry.get(itemId)) ?? null : null), [itemId]);
  const [food, setFood] = useState<Food | null>(given ? (given as Food) : null);
  const [qty, setQty] = useState<Quantity | null>(given ? startQty(given as Food) : null);
  const [approx, setApprox] = useState(false);
  const [expires, setExpires] = useState('');
  const [opened, setOpened] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!existing) return;
    setFood(existing.food as Food); setQty(existing.qty); setApprox(existing.approx);
    setExpires(existing.expiresOn ?? ''); setOpened(existing.openedOn ?? ''); setNote(existing.note ?? '');
  }, [existing?.id]);

  if (itemId && existing === undefined) return <Sheet title="Pantry" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  if (!food || !qty) {
    return (
      <Sheet title="Add to pantry" onClose={closeSheet}>
        <p class="small muted">Pick the food in the state it is in at home: raw chicken, cooked rice, dry pasta…</p>
        <FoodPicker label="What do you have?" onPick={(f) => { setFood(f); setQty(startQty(f)); }} />
      </Sheet>
    );
  }

  const save = async () => {
    const fields = { qty, approx, expiresOn: expires || null, openedOn: opened || null, ...(note.trim() ? { note: note.trim() } : {}) };
    if (existing) await updatePantryItem(existing.id, fields);
    else await addPantryItem({ food, ...fields });
    toast(`${existing ? 'Updated' : 'Added to the pantry:'} ${displayName(food)}`, { tone: 'ok' });
    closeSheet();
  };
  const usedUp = async () => {
    if (!existing) return;
    await removePantryItem(existing.id);
    toast(`Removed ${displayName(food)}`, { action: { label: 'Undo', run: () => restorePantryItem(existing.id) } });
    closeSheet();
  };

  return (
    <Sheet title={existing ? displayName(food) : `Add ${displayName(food)}`} onClose={closeSheet}
      footer={<>
        {existing ? <button type="button" class="btn btn-danger" onClick={() => void usedUp()}>Used up</button> : null}
        <button type="button" class="btn btn-primary" onClick={() => void save()}>{existing ? 'Save' : 'Add to pantry'}</button>
      </>}>
      <p class="cluster small muted"><SourceBadge src={food.src} />{food.prep !== 'as-sold' ? <span>Amount {PREP_LABEL[food.prep].toLowerCase()} — weigh it in this state.</span> : null}</p>
      <AmountPicker food={food} qty={qty} onChange={setQty} autoFocus />
      <Checkbox label="This is an estimate (not weighed)" checked={approx} onChange={setApprox} />
      <div class="cluster" style={{ alignItems: 'flex-start' }}>
        <Field label="Use by" for="pi-exp"><input id="pi-exp" class="input" type="date" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} /></Field>
        <Field label="Opened on" for="pi-open"><input id="pi-open" class="input" type="date" value={opened} onInput={(e) => setOpened(e.currentTarget.value)} /></Field>
      </div>
      <Field label="Note" for="pi-note"><input id="pi-note" class="input" value={note} maxLength={400} placeholder="Brand, container weight, where it is…" onInput={(e) => setNote(e.currentTarget.value)} /></Field>
    </Sheet>
  );
}
