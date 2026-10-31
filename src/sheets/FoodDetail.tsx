import { useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync } from '../ui/hooks';
import { Segmented } from '../ui/controls';
import { Copy, Pencil, Plus, Trash, TriangleAlert } from '../ui/icons';
import { NutrientTable, SourceLine } from '../ui/nutrition';
import { NUTRIENTS, NUTRIENT_IDS, type NutrientId } from '../domain/nutrition/nutrients';
import { displayName, PREP_LABEL, type Food, type Quantity } from '../domain/nutrition/food';
import { contribution, energyCheck } from '../domain/nutrition/compute';
import { defaultQuantity, describeQuantity } from '../domain/nutrition/quantity';
import { deleteCustomFood, restoreCustomFood, saveCustomFood } from '../data/foods/registry';
import type { FoodSnapshot } from '../data/types';
import { closeSheet, openSheet, todayKey, toast } from '../app/store';
import { AmountPicker } from './AmountPicker';
import { coreFoods } from '../data/foods/registry';
import { oxalateOfFood, OXALATE_LABEL, OXALATE_SOURCES } from '../domain/micros/oxalate';
import type { DayKey } from '../domain/time';

const MAIN: NutrientId[] = ['kcal', 'protein', 'carbs', 'fiber', 'sugars', 'fat', 'satFat', 'sodium'];
const MINERALS = NUTRIENT_IDS.filter((id) => NUTRIENTS[id].group === 'mineral');
const VITAMINS = NUTRIENT_IDS.filter((id) => NUTRIENTS[id].group === 'vitamin');

async function derivationCodes(): Promise<Record<string, string>> {
  const m = (await import('../data/foods/core.meta.json')) as unknown as { default: { derivationCodes: Record<string, string> } };
  return m.default.derivationCodes;
}

export function FoodDetail({ food, dayKey, slotId }: { food: Food | FoodSnapshot; dayKey?: DayKey; slotId?: string }) {
  const [view, setView] = useState<'basis' | 'amount'>('basis');
  const [qty, setQty] = useState<Quantity>(defaultQuantity(food as Food));
  const codes = useAsync(() => (food.nd ? derivationCodes() : Promise.resolve({} as Record<string, string>)), [food.id]);
  const isCustom = food.id.startsWith('custom:');
  const check = energyCheck(food, food.kcalOrigin === 'label' ? 'label' : 'database');
  const basisLabel = food.basis.per === 'unit' ? `per ${food.basis.unitLabel}` : food.basis.per === '100ml' ? 'per 100 mL' : 'per 100 g';
  const amount = contribution(food, qty);
  const values = view === 'basis' ? food.n : 'error' in amount ? {} : amount.n;
  const known = NUTRIENT_IDS.filter((id) => food.n[id] !== undefined).length;

  return (
    <Sheet title={displayName(food)} onClose={closeSheet}
      footer={<>
        {isCustom ? (
          <>
            <button type="button" class="btn btn-danger" onClick={async () => {
              await deleteCustomFood(food.id);
              toast('Food deleted (past entries keep their copy)', { action: { label: 'Undo', run: () => restoreCustomFood(food.id) } });
              closeSheet();
            }}><Trash size={16} aria-hidden="true" /> Delete</button>
            <button type="button" class="btn" onClick={() => openSheet({ kind: 'food-editor', foodId: food.id })}><Pencil size={16} aria-hidden="true" /> Edit</button>
          </>
        ) : (
          <button type="button" class="btn" onClick={() => openSheet({ kind: 'food-editor', prefill: { ...(food as Food), id: '', kind: 'custom', names: { ...food.names, en: `${food.names.en} (my version)` } } })}><Copy size={16} aria-hidden="true" /> Save my version</button>
        )}
        <button type="button" class="btn btn-primary" onClick={() => {
          const s: { kind: 'quicklog'; dayKey: DayKey; food: Food; slotId?: string } = { kind: 'quicklog', dayKey: dayKey ?? todayKey.value, food: food as Food };
          if (slotId) s.slotId = slotId;
          openSheet(s);
        }}><Plus size={16} aria-hidden="true" /> Log this</button>
      </>}>
      <div class="stack-s">
        {food.names.el ? <p class="muted">{food.names.el}</p> : null}
        <div class="cluster small"><span class="badge">{PREP_LABEL[food.prep]}</span><span class="badge">{basisLabel}</span>{food.brand ? <span class="badge">{food.brand}</span> : null}{food.gtin ? <span class="badge">EAN {food.gtin}</span> : null}</div>
        <SourceLine src={food.src} />
        {food.src.note ? <p class="small muted">{food.src.note}</p> : null}
        {food.notes ? <p class="small">{food.notes}</p> : null}
      </div>

      {isCustom && food.src.type === 'off' && !food.src.verifiedAt ? (
        <div class="callout small cluster" role="note">
          <span>From Open Food Facts and not yet checked. Compare the numbers with the package.</span>
          <button type="button" class="btn btn-s" onClick={async () => {
            await saveCustomFood({ ...(food as Food), src: { ...food.src, confidence: 'high', verifiedAt: new Date().toISOString().slice(0, 10) } });
            toast('Marked as checked against the package', { tone: 'ok' });
            closeSheet();
          }}>Checked against the package</button>
          <button type="button" class="btn btn-s" onClick={() => openSheet({ kind: 'food-editor', foodId: food.id })}>Fix values</button>
        </div>
      ) : null}
      {check?.mismatch ? (
        <div class="callout warn small" role="note">
          <TriangleAlert size={16} aria-hidden="true" /> Stated energy {Math.round(check.stated)} kcal vs {Math.round(check.computed)} kcal implied by the macros. The stated value is kept; check the label if this is your entry.
        </div>
      ) : null}
      {!food.carbsIncludeFiber ? <p class="small muted">EU-style label: carbohydrate excludes fibre. Totals add fibre back when it is known.</p> : null}

      <Segmented label="Show values" value={view} onChange={setView} options={[{ value: 'basis', label: basisLabel }, { value: 'amount', label: 'For an amount' }]} />
      {view === 'amount' ? <AmountPicker food={food as Food} qty={qty} onChange={setQty} /> : null}

      <section class="stack-s" aria-label="Main nutrients">
        <h3 class="card-title">Nutrition {view === 'amount' ? `· ${describeQuantity(food as Food, qty)}` : `· ${basisLabel}`}</h3>
        <NutrientTable ids={MAIN} values={values} />
      </section>
      <details>
        <summary class="small" style={{ cursor: 'pointer', fontWeight: 700 }}>Vitamins & minerals ({known} of {NUTRIENT_IDS.length} nutrients known)</summary>
        <div class="grid2" style={{ marginTop: '10px' }}>
          <NutrientTable ids={MINERALS} values={values} caption="Minerals" />
          <NutrientTable ids={VITAMINS} values={values} caption="Vitamins" />
        </div>
        <p class="xs subtle" style={{ marginTop: '8px' }}>“unknown” means the source does not report it — it is never counted as zero.</p>
      </details>
      <OxalateLine food={food} />
      {food.nd && codes ? (
        <details>
          <summary class="small" style={{ cursor: 'pointer', fontWeight: 700 }}>How these values were obtained</summary>
          <table class="ntable" style={{ marginTop: '8px' }}>
            <thead><tr><th scope="col">Nutrient</th><th scope="col">USDA method</th></tr></thead>
            <tbody>
              {(Object.entries(food.nd) as [NutrientId, string][]).filter(([id]) => MAIN.includes(id) || NUTRIENTS[id].group !== 'other').map(([id, code]) => (
                <tr key={id}><td>{NUTRIENTS[id].label}</td><td class="small">{codes[code] ?? code}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </Sheet>
  );
}

/** Oxalate for this food, only from a cited source; otherwise it says unknown. */
function OxalateLine({ food }: { food: Food | FoodSnapshot }) {
  const core = useAsync(async () => new Map((await coreFoods()).map((f) => [f.id, f])), []);
  if (!core) return null;
  const est = food.basis.per === '100g' ? oxalateOfFood(food, 100, core) : oxalateOfFood(food, null, core);
  if (!est) return <p class="small muted">Oxalate: no cited value for this food — unknown, not zero.</p>;
  const src = OXALATE_SOURCES[est.info.src];
  return (
    <p class="small">
      Oxalate: {est.mg !== null
        ? <><b>≈ {est.mg < 10 ? Math.round(est.mg * 10) / 10 : Math.round(est.mg)} mg per 100 g</b>{est.fromPair ? ' (from the cooked food, adjusted for weight)' : ''} — {OXALATE_LABEL[est.level].toLowerCase()} for that amount.</>
        : est.info.category ? <>listed as <b>low</b> (no amount given).</>
          : <><b>{est.info.mg} mg per {est.info.serving}</b> (the source doesn't give that serving's weight).</>}{' '}
      <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>.{est.info.conflict ? ` Sources disagree: ${est.info.conflict}` : ''}
    </p>
  );
}
