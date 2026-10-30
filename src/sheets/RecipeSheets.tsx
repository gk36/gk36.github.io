import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync } from '../ui/hooks';
import { Field, NumberField } from '../ui/controls';
import { FoodPicker } from '../ui/FoodPicker';
import { MacroLine } from '../ui/nutrition';
import { ChefHat, Trash } from '../ui/icons';
import { getFood, deleteCustomFood, restoreCustomFood } from '../data/foods/registry';
import { cookBatch, saveRecipe } from '../data/kitchen';
import { deductFromPantry } from '../data/pantry';
import { ensureDay } from '../data/entries';
import { recipeTotals, scaleComponents, type Component } from '../domain/kitchen/recipe';
import { displayName, type Food, type Quantity } from '../domain/nutrition/food';
import { defaultQuantity } from '../domain/nutrition/quantity';
import { NUTRIENTS, type NutrientId } from '../domain/nutrition/nutrients';
import { formatDayLabel } from '../domain/time';
import { closeSheet, openSheet, profile, todayKey, toast } from '../app/store';
import { logEntry } from '../app/actions';
import { unitOptions, qtyKey } from './AmountPicker';

const KEY_PARTIAL: NutrientId[] = ['fiber', 'satFat', 'sodium', 'calcium', 'iron', 'magnesium', 'potassium', 'vitC', 'vitD', 'folate', 'vitB12'];

/** Ingredient list editor shared by recipes and batches. */
function Ingredients({ components, onChange }: { components: Component[]; onChange: (c: Component[]) => void }) {
  const set = (i: number, qty: Quantity) => onChange(components.map((c, j) => (j === i ? { ...c, qty } : c)));
  return (
    <div class="stack-s">
      <ul class="list" aria-label="Ingredients">
        {components.map((c, i) => {
          const opts = unitOptions(c.food);
          const cur = opts.find((o) => o.key === qtyKey(c.qty)) ?? opts[0];
          return (
            <li key={`${c.food.id}-${i}`}>
              <div class="item" style={{ cursor: 'default' }}>
                <div class="item-main"><span class="item-name">{displayName(c.food)}</span><span class="item-sub">{c.food.prep}</span></div>
                <input class="input input-num" style={{ maxWidth: '96px' }} inputMode="decimal" aria-label={`${displayName(c.food)} amount`} value={String(c.qty.amount)}
                  onChange={(e) => { const v = Number(e.currentTarget.value.replace(',', '.')); if (Number.isFinite(v) && v >= 0 && cur) set(i, cur.qty(v)); }} />
                <select class="select" style={{ maxWidth: '150px' }} aria-label={`${displayName(c.food)} unit`} value={cur?.key}
                  onChange={(e) => { const o = opts.find((x) => x.key === e.currentTarget.value); if (o) set(i, o.qty(o.key === 'g' || o.key === 'ml' ? 100 : 1)); }}>
                  {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <button type="button" class="btn btn-icon btn-s btn-danger" aria-label={`Remove ${displayName(c.food)}`} onClick={() => onChange(components.filter((_, j) => j !== i))}><Trash size={15} /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <FoodPicker label="Add an ingredient" onPick={(f) => onChange([...components, { food: f, qty: f.basis.per === 'unit' ? defaultQuantity(f) : { amount: 100, unit: f.basis.per === '100ml' ? 'ml' : 'g' } }])} />
    </div>
  );
}

function TotalsBox({ components, servings, totalG }: { components: Component[]; servings: number; totalG: number | null }) {
  const t = useMemo(() => recipeTotals(components), [components]);
  const per = (d: number) => Object.fromEntries(Object.entries(t.n).map(([k, v]) => [k, (v as number) / d]));
  const partial = t.partial.filter((id) => KEY_PARTIAL.includes(id));
  return (
    <div class="callout stack-s" aria-live="polite">
      <span><b>Whole recipe:</b> <MacroLine n={t.n} /></span>
      {servings > 0 ? <span><b>Per serving (÷ {servings}):</b> <MacroLine n={per(servings)} /></span> : null}
      {totalG ? <span><b>Per 100 g cooked:</b> <MacroLine n={per(totalG / 100)} /></span> : null}
      <span class="xs subtle">Raw/as-used ingredients weigh {Math.round(t.ingredientG)} g{totalG ? `; finished weight ${Math.round(totalG)} g (${Math.round((totalG / Math.max(1, t.ingredientG)) * 100)}% — water lost or gained in cooking)` : ''}.</span>
      {partial.length ? <span class="xs subtle">Some ingredients have no data for {partial.map((id) => NUTRIENTS[id].label.toLowerCase()).join(', ')} — those totals are “at least”.</span> : null}
      {t.errors.map((e) => <span key={e} class="error">{e}</span>)}
    </div>
  );
}

export function RecipeEditor({ foodId }: { foodId?: string }) {
  const existing = useAsync(() => (foodId ? getFood(foodId) : Promise.resolve(undefined)), [foodId]);
  if (foodId && !existing) return <Sheet title="Recipe" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  return <RecipeForm key={existing?.id ?? 'new'} existing={existing} />;
}

function RecipeForm({ existing }: { existing: Food | undefined }) {
  const r = existing?.recipe;
  const [name, setName] = useState(existing?.names.en ?? '');
  const [components, setComponents] = useState<Component[]>(r?.components ?? []);
  const [servings, setServings] = useState<number | null>(r?.servings ?? 2);
  const [steps, setSteps] = useState(r?.steps ?? '');
  const [prep, setPrep] = useState<number | null>(r?.prepMinutes ?? null);
  const valid = name.trim() && components.length > 0 && (servings ?? 0) > 0;
  const save = async (cook: boolean) => {
    if (!valid) return;
    const saved = await saveRecipe({ ...(existing ? { id: existing.id } : {}), name, components, servings: servings!, totalG: null, ...(steps.trim() ? { steps: steps.trim() } : {}), ...(prep ? { prepMinutes: prep } : {}) });
    toast(`Saved recipe “${saved.names.en}”`, { tone: 'ok' });
    if (cook) openSheet({ kind: 'cook', recipeId: saved.id }); else closeSheet();
  };
  return (
    <Sheet title={existing ? 'Edit recipe' : 'New recipe'} onClose={closeSheet}
      footer={<>
        {existing ? <button type="button" class="btn btn-danger" onClick={async () => { await deleteCustomFood(existing.id); toast('Recipe deleted', { action: { label: 'Undo', run: () => restoreCustomFood(existing.id) } }); closeSheet(); }}><Trash size={16} aria-hidden="true" /> Delete</button> : null}
        <button type="button" class="btn" disabled={!valid} onClick={() => void save(false)}>Save</button>
        <button type="button" class="btn btn-primary" disabled={!valid} onClick={() => void save(true)}><ChefHat size={16} aria-hidden="true" /> Save & cook</button>
      </>}>
      <Field label="Name" for="rc-name"><input id="rc-name" class="input" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Bolognese with lean mince" /></Field>
      <Ingredients components={components} onChange={setComponents} />
      {components.length ? (
        <div class="cluster">
          <span class="label">Scale</span>
          {[0.5, 1.5, 2].map((f) => <button type="button" key={f} class="chip" onClick={() => setComponents(scaleComponents(components, f))}>× {f}</button>)}
        </div>
      ) : null}
      <div class="fields">
        <NumberField label="Servings" value={servings} onChange={setServings} min={1} max={100} />
        <NumberField label="Prep + cook time" suffix="min" value={prep} onChange={setPrep} min={0} max={1440} />
      </div>
      <TotalsBox components={components} servings={servings ?? 1} totalG={null} />
      <Field label="Method" for="rc-steps"><textarea id="rc-steps" class="textarea" value={steps} onInput={(e) => setSteps(e.currentTarget.value)} placeholder="Steps, temperatures, equipment…" /></Field>
      <p class="xs subtle">Food safety: cook poultry to 74 °C / 165 °F and minced meat to 71 °C / 160 °F; cool leftovers within 2 hours and keep them refrigerated.</p>
    </Sheet>
  );
}

/** Cook a batch: confirm what went in, weigh the finished pot, optionally log a portion now. */
export function CookSheet({ recipeId }: { recipeId: string }) {
  const recipe = useAsync(() => getFood(recipeId), [recipeId]);
  if (!recipe?.recipe) return <Sheet title="Cook" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  return <CookForm recipe={recipe} />;
}

function CookForm({ recipe }: { recipe: Food }) {
  const today = todayKey.value;
  const [components, setComponents] = useState<Component[]>(recipe.recipe!.components);
  const [weight, setWeight] = useState<number | null>(null);
  const [portion, setPortion] = useState<number | null>(null);
  const [name, setName] = useState(`${recipe.names.en} · ${formatDayLabel(today)}`);
  const valid = components.length > 0 && (weight ?? 0) > 0 && name.trim() && (portion === null || portion <= weight!);
  const cook = async () => {
    if (!valid) return;
    const batch = await cookBatch({ recipe, name, components, cookedWeightG: weight!, servings: recipe.recipe!.servings, cookedOn: today });
    // Cooking uses the raw ingredients: take them out of the pantry (when they are in it).
    let used = 0;
    if (profile.value?.pantryDeduct !== false) {
      for (const c of components) if ((await deductFromPantry(c.food, c.qty)).length) used += 1;
    }
    if (used) toast(`${used} ingredient${used > 1 ? 's' : ''} taken from the pantry`, { tone: 'ok' });
    if (portion && portion > 0) {
      const day = await ensureDay(today);
      await logEntry({ dayKey: today, slotId: day.slots[0]?.id ?? 'lunch', food: batch, qty: { amount: portion, unit: 'g' }, status: 'eaten', origin: 'recipe' });
    } else toast(`Batch saved: ${Math.round(weight!)} g in the fridge`, { tone: 'ok' });
    closeSheet();
  };
  return (
    <Sheet title={`Cook ${recipe.names.en}`} onClose={closeSheet}
      footer={<button type="button" class="btn btn-primary" disabled={!valid} onClick={() => void cook()}><ChefHat size={16} aria-hidden="true" /> Save batch</button>}>
      <p class="small muted">Adjust anything you used differently. Weigh the finished food (pot contents minus the pot) — portions are then exact fractions of what went in.</p>
      <Ingredients components={components} onChange={setComponents} />
      <div class="fields">
        <NumberField label="Cooked weight of the whole batch" suffix="g" value={weight} onChange={setWeight} min={1} max={50000} hint="Weigh after cooking" />
        <NumberField label="Eat a portion now (optional)" suffix="g" value={portion} onChange={setPortion} min={0} max={50000} />
      </div>
      <Field label="Batch name" for="ck-name"><input id="ck-name" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} /></Field>
      <TotalsBox components={components} servings={recipe.recipe!.servings} totalG={weight} />
    </Sheet>
  );
}
