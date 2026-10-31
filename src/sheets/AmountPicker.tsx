import type { Food, Quantity } from '../domain/nutrition/food';
import { contribution } from '../domain/nutrition/compute';
import { resolveQuantity } from '../domain/nutrition/quantity';
import { AmountInput } from '../ui/controls';
import { MacroLine } from '../ui/nutrition';

/** Units that make sense for this food: grams, mL (only with a density or mL basis), its portions. */
export function unitOptions(food: Pick<Food, 'basis' | 'densityGPerMl' | 'portions'>): { key: string; label: string; qty: (n: number) => Quantity; step: number }[] {
  const opts: { key: string; label: string; qty: (n: number) => Quantity; step: number }[] = [];
  const b = food.basis;
  if (b.per === 'unit') opts.push({ key: 'portion:unit', label: b.unitLabel, qty: (n) => ({ amount: n, unit: 'portion', portionId: 'unit' }), step: 1 });
  if (b.per === '100g' || (b.per === '100ml' && food.densityGPerMl) || (b.per === 'unit' && b.unitG)) opts.push({ key: 'g', label: 'g', qty: (n) => ({ amount: n, unit: 'g' }), step: 5 });
  if (b.per === '100ml' || (b.per === '100g' && food.densityGPerMl)) opts.push({ key: 'ml', label: 'mL', qty: (n) => ({ amount: n, unit: 'ml' }), step: 10 });
  for (const p of food.portions) opts.push({ key: `portion:${p.id}`, label: p.label, qty: (n) => ({ amount: n, unit: 'portion', portionId: p.id }), step: 1 });
  return opts;
}

export const qtyKey = (q: Quantity) => (q.unit === 'portion' ? `portion:${q.portionId}` : q.unit);

/** Amount + unit selection with a live, honest nutrition preview. */
export function AmountPicker({ food, qty, onChange, autoFocus }: { food: Food; qty: Quantity; onChange: (q: Quantity) => void; autoFocus?: boolean }) {
  const opts = unitOptions(food);
  const current = opts.find((o) => o.key === qtyKey(qty)) ?? opts[0];
  const c = contribution(food, qty);
  const r = resolveQuantity(food, qty);
  return (
    <div class="stack">
      <div class="field">
        <span class="label" id="unit-label">Unit</span>
        <div class="chips" role="group" aria-labelledby="unit-label">
          {opts.map((o) => (
            <button
              type="button" key={o.key} class="chip" aria-pressed={o.key === current?.key}
              onClick={() => {
                if (o.key === current?.key) return;
                const fresh = o.key === 'g' ? 100 : o.key === 'ml' ? 100 : 1;
                onChange(o.qty(fresh));
              }}
            >{o.label}</button>
          ))}
        </div>
      </div>
      {current ? (
        <AmountInput
          label="Amount" value={qty.amount} step={current.step} autoFocus={autoFocus}
          suffix={current.key.startsWith('portion') ? `× ${current.label}` : current.label}
          onChange={(n) => onChange(current.qty(n))}
        />
      ) : null}
      <div class="callout" aria-live="polite">
        {'error' in c ? <span class="error">{c.error}</span> : (
          <div class="stack-s">
            <MacroLine n={c.n} />
            <span class="small subtle">
              {r.ok && r.grams !== null && qty.unit !== 'g' ? `≈ ${Math.round(r.grams)} g` : ''}
              {r.ok && r.ml !== null && qty.unit !== 'ml' && food.basis.per === '100ml' ? `≈ ${Math.round(r.ml)} mL` : ''}
              {c.carbsExcludeUnknownFiber ? ' · label carbs exclude fibre (fibre not given)' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
