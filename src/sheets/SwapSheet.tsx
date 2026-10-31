import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useLive } from '../ui/hooks';
import { Segmented } from '../ui/controls';
import { MacroLine } from '../ui/nutrition';
import { allFoods } from '../data/foods/registry';
import { getEntry, snapshotOf, updateEntry } from '../data/entries';
import { indexFoods, searchFoods } from '../domain/search';
import { displayName, type Food } from '../domain/nutrition/food';
import { contribution } from '../domain/nutrition/compute';
import { describeQuantity } from '../domain/nutrition/quantity';
import { swapQuantity, type KeepMacro } from '../domain/nutrition/swap';
import { closeSheet, toast } from '../app/store';

/** Replace a food while keeping protein, carbs or calories the same — the plan stays coherent. */
export function SwapSheet({ entryId }: { entryId: string }) {
  const e = useLive(() => getEntry(entryId), [entryId], undefined);
  const foods = useLive(() => allFoods(), [], [] as Food[]);
  const [keep, setKeep] = useState<KeepMacro>('protein');
  const [query, setQuery] = useState('');
  const index = useMemo(() => indexFoods(foods), [foods]);
  if (!e) return <Sheet title="Swap food" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  const cur = contribution(e.food, e.qty);
  const target = 'error' in cur ? 0 : cur.n[keep] ?? 0;
  const results = query.trim() ? searchFoods(index, query, new Map(), 30) : foods.filter((f) => f.group === e.food.group).slice(0, 30);

  const pick = async (f: Food) => {
    const q = swapQuantity(f, keep, target);
    if (!q) return;
    const planned = e.planned ?? { foodId: e.foodId, foodName: displayName(e.food), qty: e.qty };
    await updateEntry(e.id, { food: snapshotOf(f), foodId: f.id, qty: q, planned });
    toast(`Swapped to ${describeQuantity(f, q)} ${displayName(f)}`, { tone: 'ok' });
    closeSheet();
  };

  return (
    <Sheet title={`Swap ${displayName(e.food)}`} onClose={closeSheet}>
      <p class="small muted">Now: {describeQuantity(e.food, e.qty)} · {'error' in cur ? '?' : <MacroLine n={cur.n} />}</p>
      <Segmented label="Keep the same" value={keep} onChange={setKeep}
        options={[{ value: 'protein', label: 'Protein' }, { value: 'carbs', label: 'Carbs' }, { value: 'kcal', label: 'Calories' }]} />
      <div class="field">
        <label for="swap-q">Replace with</label>
        <input id="swap-q" class="input" type="search" value={query} placeholder="Search a replacement…" onInput={(ev) => setQuery(ev.currentTarget.value)} />
      </div>
      <div class="list">
        {results.map((f) => {
          const q = swapQuantity(f, keep, target);
          const c = q ? contribution(f, q) : null;
          return (
            <button type="button" key={f.id} class="item" disabled={!q} onClick={() => void pick(f)}>
              <div class="item-main">
                <span class="item-name">{displayName(f)}</span>
                <span class="item-sub">{q ? describeQuantity(f, q) : `no ${keep} data — can't match`}</span>
              </div>
              <div class="item-end small">{c && !('error' in c) ? <MacroLine n={c.n} compact /> : null}</div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
