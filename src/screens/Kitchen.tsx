import { useState } from 'preact/hooks';
import { useAsync, useLive } from '../ui/hooks';
import { FoodPicker } from '../ui/FoodPicker';
import { NumberField } from '../ui/controls';
import { ChefHat, Plus, Refrigerator, Scale, Sparkles } from '../ui/icons';
import { batchUsage, finishBatch, listBatches, listRecipes, type BatchUsage } from '../data/kitchen';
import { coreFoods, getFood } from '../data/foods/registry';
import { estimatedYield } from '../domain/kitchen/recipe';
import { displayName, type Food } from '../domain/nutrition/food';
import { formatDayLabel } from '../domain/time';
import { openSheet, todayKey, toast } from '../app/store';

export function Kitchen() {
  const batches = useLive(() => listBatches(), [], [] as Food[]);
  const recipes = useLive(() => listRecipes(), [], [] as Food[]);
  return (
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Kitchen</h1>
        <div class="cluster">
          <button type="button" class="btn" onClick={() => openSheet({ kind: 'ideas', dayKey: todayKey.value })}><Sparkles size={16} aria-hidden="true" /> Meal ideas</button>
          <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'recipe' })}><Plus size={16} aria-hidden="true" /> New recipe</button>
        </div>
      </div>

      <section class="card stack" aria-labelledby="k-batches">
        <h2 id="k-batches" class="card-title"><Refrigerator size={15} aria-hidden="true" /> Batches in the fridge</h2>
        {batches.length ? <ul class="list">{batches.map((b) => <BatchRow key={b.id} batch={b} />)}</ul>
          : <p class="small muted">Cook a recipe (“Save & cook”), weigh the finished pot, and log portions in grams. Each portion is an exact share of the ingredients, and leftovers are tracked here.</p>}
      </section>

      <section class="card stack" aria-labelledby="k-recipes">
        <h2 id="k-recipes" class="card-title"><ChefHat size={15} aria-hidden="true" /> Recipes</h2>
        {recipes.length ? (
          <ul class="list">
            {recipes.map((r) => (
              <li key={r.id}>
                <div class="item" style={{ cursor: 'default' }}>
                  <button type="button" class="item-main linkish" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => openSheet({ kind: 'recipe', foodId: r.id })}>
                    <span class="item-name">{r.names.en}{r.recipe!.example ? <span class="badge" style={{ marginLeft: '8px' }}>Example</span> : null}</span>
                    <span class="item-sub">{r.recipe!.components.length} ingredients · {r.recipe!.servings} serving{r.recipe!.servings === 1 ? '' : 's'}{r.recipe!.prepMinutes ? ` · ${r.recipe!.prepMinutes} min` : ''}{r.partial?.includes('kcal') ? ' · needs an ingredient' : ''}</span>
                  </button>
                  <button type="button" class="btn btn-s" onClick={() => openSheet({ kind: 'quicklog', dayKey: todayKey.value, food: r })}>Log a serving</button>
                  <button type="button" class="btn btn-s btn-primary" onClick={() => openSheet({ kind: 'cook', recipeId: r.id })}>Cook</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p class="small muted">No recipes yet. Ingredients are weighed in the state you use them (raw mince, dry pasta…).</p>}
      </section>

      <YieldEstimator />
    </div>
  );
}

function BatchRow({ batch }: { batch: Food }) {
  const usage = useLive(() => batchUsage(batch), [batch.id, batch.updatedAt], { eatenG: 0, plannedG: 0, remainingG: batch.recipe?.totalG ?? 0 } as BatchUsage);
  const total = batch.recipe?.totalG ?? 0;
  const pct = total ? Math.round(((usage.eatenG + usage.plannedG) / total) * 100) : 0;
  return (
    <li>
      <div class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
        <div class="item-main">
          <span class="item-name">{displayName(batch)}</span>
          <span class="item-sub num">Cooked {formatDayLabel(batch.recipe!.cookedOn!)} · {Math.round(total)} g · eaten {Math.round(usage.eatenG)} g{usage.plannedG ? ` · planned ${Math.round(usage.plannedG)} g` : ''} · <b>{Math.round(usage.remainingG)} g left</b></span>
          <div class="bar-track" role="progressbar" aria-label={`${displayName(batch)} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} style={{ marginTop: '4px' }}>
            <div class="bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: 'var(--ember)' }} />
          </div>
        </div>
        <button type="button" class="btn btn-s btn-primary" onClick={() => openSheet({ kind: 'quicklog', dayKey: todayKey.value, food: batch })}>Log a portion</button>
        <button type="button" class="btn btn-s" onClick={async () => { await finishBatch(batch); toast('Batch marked finished'); }}>Finished</button>
      </div>
    </li>
  );
}

/** Raw ↔ cooked weight estimate from a USDA raw/cooked pair (protein density ratio). */
function YieldEstimator() {
  const core = useAsync(() => coreFoods(), []);
  const [food, setFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState<number | null>(null);
  const pair = useAsync(async () => (food?.pair ? getFood(food.pair) : undefined), [food?.id]);
  const raw = food && pair ? (food.prep === 'raw' || food.prep === 'dry' ? food : pair) : null;
  const cooked = food && pair ? (raw === food ? pair : food) : null;
  const y = raw && cooked ? estimatedYield(raw, cooked) : null;
  const fromRaw = food === raw;
  const est = y && grams ? (fromRaw ? grams * y : grams / y) : null;
  return (
    <section class="card stack" aria-labelledby="k-yield">
      <h2 id="k-yield" class="card-title"><Scale size={15} aria-hidden="true" /> Raw ↔ cooked weight</h2>
      <p class="small muted">Best: log the record for the state you weighed (e.g. roasted chicken by its cooked weight), or weigh a batch. This estimate uses USDA's own raw and cooked records for the same food.</p>
      {food ? (
        <div class="stack-s">
          <div class="spread"><b>{displayName(food)}</b><button type="button" class="linkish small" onClick={() => setFood(null)}>Change</button></div>
          <NumberField label={`Weight ${fromRaw ? 'raw/dry' : 'cooked'}`} suffix="g" value={grams} onChange={setGrams} min={0} max={20000} />
          {!pair ? <p class="small muted">No cooked/raw pair for this food.</p> : y && est ? (
            <p class="callout small" aria-live="polite">≈ <b>{Math.round(est)} g</b> {fromRaw ? `cooked (${pair.names.en})` : `raw (${pair.names.en})`} — an estimate (± ~10 %): cooking method, time and cut change it. Weigh when you can.</p>
          ) : <p class="small muted">Enter a weight.</p>}
        </div>
      ) : core ? (
        <FoodPicker label="Food with raw and cooked versions" onPick={setFood} filter={(f) => !!f.pair} />
      ) : null}
    </section>
  );
}
