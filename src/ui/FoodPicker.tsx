import { useId, useMemo, useState } from 'preact/hooks';
import { useLive } from './hooks';
import { SourceBadge } from './nutrition';
import { allFoods } from '../data/foods/registry';
import { indexFoods, searchFoods } from '../domain/search';
import { displayName, PREP_LABEL, type Food } from '../domain/nutrition/food';

/** Search box + results; used wherever a food has to be chosen (recipes, converters). */
export function FoodPicker({ onPick, label = 'Search foods', filter, initialQuery = '', autoFocus }: {
  onPick: (f: Food) => void; label?: string; filter?: (f: Food) => boolean; initialQuery?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState(initialQuery);
  // Several pickers can be on screen at once (a screen and a sheet), so ids must be unique.
  const id = useId();
  const foods = useLive(() => allFoods(), [], [] as Food[]);
  const pool = useMemo(() => (filter ? foods.filter(filter) : foods), [foods, filter]);
  const index = useMemo(() => indexFoods(pool), [pool]);
  const results = q.trim() ? searchFoods(index, q, new Map(), 30) : [];
  return (
    <div class="stack-s">
      <label for={id} class="label">{label}</label>
      <input id={id} class="input" type="search" autoComplete="off" value={q} placeholder="e.g. mince, passata, ρύζι…" autoFocus={autoFocus} onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onPick(results[0]); setQ(''); } }} />
      {results.length ? (
        <ul class="list" aria-label="Matching foods">
          {results.map((f) => (
            <li key={f.id}>
              <button type="button" class="item" onClick={() => { onPick(f); setQ(''); }}>
                <div class="item-main">
                  <span class="item-name">{displayName(f)}</span>
                  <span class="item-sub cluster"><SourceBadge src={f.src} />{f.prep !== 'as-sold' ? <span>{PREP_LABEL[f.prep]}</span> : null}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
