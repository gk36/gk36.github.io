import { useMemo, useRef, useState } from 'preact/hooks';
import { LabelPhoto } from './LabelPhoto';
import type { LabelText } from '../domain/nutrition/labelText';
import { Sheet } from '../ui/Sheet';
import { useAsync } from '../ui/hooks';
import { Field, NumberField, Segmented } from '../ui/controls';
import { NutrientTable } from '../ui/nutrition';
import { getFood, saveCustomFood } from '../data/foods/registry';
import { normalizeLabel, sodiumMgToSalt, type LabelInput } from '../domain/nutrition/label';
import { NUTRIENTS, type NutrientId } from '../domain/nutrition/nutrients';
import type { Food, FoodGroup, Prep } from '../domain/nutrition/food';
import { closeSheet, openSheet, toast } from '../app/store';
import type { DayKey } from '../domain/time';

const EXTRA: NutrientId[] = ['potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitC', 'vitD', 'vitB12', 'vitA', 'folate', 'cholesterol', 'transFat'];
const GROUPS: { value: FoodGroup; label: string }[] = [
  { value: 'protein', label: 'Meat, fish, eggs' }, { value: 'dairy', label: 'Dairy' }, { value: 'starch', label: 'Grains & starch' },
  { value: 'fruit', label: 'Fruit' }, { value: 'veg', label: 'Vegetables' }, { value: 'fat', label: 'Fats, nuts, oils' },
  { value: 'sweet', label: 'Sweets & sauces' }, { value: 'drink', label: 'Drinks' }, { value: 'other', label: 'Other' },
];
const PREPS: { value: Prep; label: string }[] = [
  { value: 'as-sold', label: 'As sold / ready to eat' }, { value: 'dry', label: 'Dry (uncooked)' }, { value: 'raw', label: 'Raw' },
  { value: 'boiled', label: 'Boiled' }, { value: 'roasted', label: 'Roasted / baked' }, { value: 'pan-cooked', label: 'Pan-cooked' },
  { value: 'drained', label: 'Drained' }, { value: 'prepared', label: 'Prepared' },
];

type Num = number | null;

/** Turns a stored food back into "as printed on a per-100" label for editing. */
function toForm(f: Partial<Food>): Record<string, Num> {
  const n = f.n ?? {};
  const v = (x: number | undefined): Num => (x === undefined ? null : Math.round(x * 1000) / 1000);
  const out: Record<string, Num> = {
    energyKcal: v(n.kcal), fat: v(n.fat), satFat: v(n.satFat), carbs: v(n.carbs), sugars: v(n.sugars),
    fiber: v(n.fiber), protein: v(n.protein), salt: n.sodium === undefined ? null : Math.round(sodiumMgToSalt(n.sodium) * 1000) / 1000,
  };
  for (const id of EXTRA) out[id] = v(n[id]);
  return out;
}

export function FoodEditor({ foodId, prefill, thenLog }: { foodId?: string; prefill?: Partial<Food>; thenLog?: { dayKey: DayKey; slotId?: string } }) {
  const existing = useAsync(() => (foodId ? getFood(foodId) : Promise.resolve(undefined)), [foodId]);
  const seed: Partial<Food> | undefined = existing ?? prefill;
  if (foodId && !existing) return <Sheet title="Edit food" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  return <EditorForm key={seed?.id ?? 'new'} seed={seed} {...(thenLog ? { thenLog } : {})} />;
}

function EditorForm({ seed, thenLog }: { seed: Partial<Food> | undefined; thenLog?: { dayKey: DayKey; slotId?: string } }) {
  const [name, setName] = useState(seed?.names?.en ?? '');
  const [nameEl, setNameEl] = useState(seed?.names?.el ?? '');
  const [brand, setBrand] = useState(seed?.brand ?? '');
  const [gtin, setGtin] = useState(seed?.gtin ?? '');
  const [group, setGroup] = useState<FoodGroup>(seed?.group ?? 'other');
  const [prep, setPrep] = useState<Prep>(seed?.prep ?? 'as-sold');
  const [region, setRegion] = useState<'eu' | 'us'>(seed?.carbsIncludeFiber ? 'us' : 'eu');
  const [basis, setBasis] = useState<LabelInput['basis']>(seed?.basis?.per === '100ml' ? 'per100ml' : seed?.basis?.per === 'unit' ? 'perServing' : 'per100g');
  const [servingLabel, setServingLabel] = useState(seed?.basis?.per === 'unit' ? seed.basis.unitLabel : seed?.labelServing?.label ?? '');
  const [servingG, setServingG] = useState<Num>(seed?.labelServing?.g ?? (seed?.basis?.per === 'unit' ? seed.basis.unitG ?? null : null));
  const [servingMl, setServingMl] = useState<Num>(seed?.labelServing?.ml ?? null);
  const [density, setDensity] = useState<Num>(seed?.densityGPerMl ?? null);
  const [vals, setVals] = useState<Record<string, Num>>(() => toForm(seed ?? {}));
  const [useKj, setUseKj] = useState(false);
  const [kj, setKj] = useState<Num>(null);
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const setV = (k: string) => (v: Num) => setVals((s) => ({ ...s, [k]: v }));
  const [ocr, setOcr] = useState<{ filled: string[]; warnings: string[]; text: string } | null>(null);
  const valsRef = useRef(vals);
  valsRef.current = vals;

  /** Fills only EMPTY fields from the photo; anything typed by hand wins. */
  const applyOcr = ({ text, parsed }: { text: string; parsed: LabelText }) => {
    const next = { ...valsRef.current };
    const filled: string[] = [];
    const take = (key: string, label: string, v: number | undefined) => {
      if (v === undefined || (next[key] !== null && next[key] !== undefined)) return;
      next[key] = Math.round(v * 1000) / 1000;
      filled.push(label);
    };
    const f = parsed.fields;
    if (f.energyKcal) take('energyKcal', 'energy', f.energyKcal.value);
    else if (f.energyKj && (next.energyKcal === null || next.energyKcal === undefined) && !useKj) { setUseKj(true); setKj(f.energyKj.value); filled.push('energy (kJ)'); }
    take('fat', 'fat', f.fat?.value);
    take('satFat', 'saturates', f.satFat?.value);
    take('carbs', 'carbohydrate', f.carbs?.value);
    take('sugars', 'sugars', f.sugars?.value);
    take('fiber', 'fibre', f.fiber?.value);
    take('protein', 'protein', f.protein?.value);
    take('salt', f.salt ? 'salt' : 'salt (from sodium)', f.salt?.value ?? (f.sodiumMg ? sodiumMgToSalt(f.sodiumMg.value) : undefined));
    setVals(next);
    if (parsed.basis) setBasis(parsed.basis);
    if (parsed.region) setRegion(parsed.region);
    if (parsed.basis === 'perServing' && parsed.servingG) { setServingG(parsed.servingG); setServingMl(null); }
    else if (parsed.basis === 'perServing' && parsed.servingMl) { setServingMl(parsed.servingMl); setServingG(null); }
    setOcr({ filled, warnings: parsed.warnings, text: text.trim() });
  };

  const input: LabelInput = useMemo(() => {
    const i: LabelInput = { name, basis, region };
    const put = <K extends keyof LabelInput>(k: K, v: LabelInput[K] | null | undefined) => { if (v !== null && v !== undefined && v !== '') i[k] = v as LabelInput[K]; };
    put('brand', brand.trim() || null); put('servingLabel', servingLabel.trim() || null);
    put('servingG', basis === 'perServing' ? servingG : null); put('servingMl', basis === 'perServing' ? servingMl : null);
    if (useKj) put('energyKj', kj); else put('energyKcal', vals.energyKcal);
    put('fat', vals.fat); put('satFat', vals.satFat); put('carbs', vals.carbs); put('sugars', vals.sugars);
    put('fiber', vals.fiber); put('protein', vals.protein); put('salt', vals.salt);
    const extra: LabelInput['extra'] = {};
    for (const id of EXTRA) if (vals[id] !== null && vals[id] !== undefined) extra[id] = vals[id]!;
    if (Object.keys(extra).length) i.extra = extra;
    return i;
  }, [name, basis, region, brand, servingLabel, servingG, servingMl, useKj, kj, vals]);
  const r = normalizeLabel(input);
  const gtinOk = gtin === '' || /^\d{8,14}$/.test(gtin);
  const canSave = name.trim() && r.errors.length === 0 && gtinOk && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const food: Food = {
        id: seed?.id && seed.id.startsWith('custom:') ? seed.id : '',
        names: { en: name.trim(), ...(nameEl.trim() ? { el: nameEl.trim() } : {}), ...(seed?.names?.aliases ? { aliases: seed.names.aliases } : {}) },
        kind: brand.trim() ? 'branded' : 'custom', group, prep, basis: r.basis, portions: seed?.portions ?? [], n: r.n,
        carbsIncludeFiber: region === 'us', kcalOrigin: 'label',
        src: { type: 'label', confidence: 'high', verifiedAt: new Date().toISOString().slice(0, 10), note: [r.derived.join('; '), 'Entered from the package label.'].filter(Boolean).join(' · ') },
      };
      if (brand.trim()) food.brand = brand.trim();
      if (gtin) food.gtin = gtin;
      if (density && density > 0) food.densityGPerMl = density;
      if (r.labelServing) food.labelServing = r.labelServing;
      if (notes.trim()) food.notes = notes.trim();
      const saved = await saveCustomFood(food);
      toast(`Saved ${saved.names.en}`, { tone: 'ok' });
      if (thenLog) {
        const s: { kind: 'quicklog'; dayKey: DayKey; food: Food; slotId?: string } = { kind: 'quicklog', dayKey: thenLog.dayKey, food: saved };
        if (thenLog.slotId) s.slotId = thenLog.slotId;
        openSheet(s);
      } else closeSheet();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', { tone: 'error' });
      setSaving(false);
    }
  };

  const colName = basis === 'per100g' ? 'per 100 g' : basis === 'per100ml' ? 'per 100 mL' : 'per serving';
  return (
    <Sheet title={seed?.id?.startsWith('custom:') ? 'Edit food' : 'New food from label'} onClose={closeSheet}
      footer={<><button type="button" class="btn" onClick={closeSheet}>Cancel</button><button type="button" class="btn btn-primary" disabled={!canSave} onClick={() => void save()}>{thenLog ? 'Save & log' : 'Save food'}</button></>}>
      <p class="small muted">Copy the numbers exactly as printed. Leave anything not on the label empty — it stays <b>unknown</b>, never zero.</p>
      <LabelPhoto onRead={applyOcr} />
      {ocr ? (
        <div class="callout warn small stack-s" role="status">
          <span>{ocr.filled.length ? <>Filled from your photo: <b>{ocr.filled.join(', ')}</b>. Check every number against the package before saving — photos can be misread.</> : 'Nothing new could be filled in from the photo.'}</span>
          {ocr.warnings.map((w) => <span key={w}>{w}</span>)}
          {ocr.text ? <details><summary>What the camera read</summary><pre class="xs" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{ocr.text}</pre></details> : null}
        </div>
      ) : null}
      <Field label="Name" for="fe-name"><input id="fe-name" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Greek yogurt 2%" autoFocus /></Field>
      <div class="fields">
        <Field label="Brand" for="fe-brand"><input id="fe-brand" class="input" value={brand} onInput={(e) => setBrand(e.currentTarget.value)} placeholder="optional" /></Field>
        <Field label="Greek name" for="fe-el"><input id="fe-el" class="input" value={nameEl} lang="el" onInput={(e) => setNameEl(e.currentTarget.value)} placeholder="προαιρετικό" /></Field>
        <Field label="Barcode (EAN/UPC)" for="fe-gtin" error={gtinOk ? null : '8–14 digits'}><input id="fe-gtin" class="input" inputMode="numeric" value={gtin} onInput={(e) => setGtin(e.currentTarget.value.replace(/\s/g, ''))} placeholder="optional" /></Field>
      </div>
      <div class="fields">
        <Field label="Type" for="fe-group"><select id="fe-group" class="select" value={group} onChange={(e) => setGroup(e.currentTarget.value as FoodGroup)}>{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></Field>
        <Field label="State the label describes" for="fe-prep"><select id="fe-prep" class="select" value={prep} onChange={(e) => setPrep(e.currentTarget.value as Prep)}>{PREPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></Field>
      </div>
      <Segmented label="Label column" value={basis} onChange={setBasis} options={[{ value: 'per100g', label: 'per 100 g' }, { value: 'per100ml', label: 'per 100 mL' }, { value: 'perServing', label: 'per serving' }]} />
      {basis === 'perServing' ? (
        <div class="fields">
          <Field label="Serving name" for="fe-sl"><input id="fe-sl" class="input" value={servingLabel} onInput={(e) => setServingLabel(e.currentTarget.value)} placeholder="1 bar, 1 scoop…" /></Field>
          <NumberField label="Serving weight" suffix="g" value={servingG} onChange={(v) => { setServingG(v); if (v) setServingMl(null); }} min={0} max={5000} hint="Lets you log in grams" />
          <NumberField label="or volume" suffix="mL" value={servingMl} onChange={(v) => { setServingMl(v); if (v) setServingG(null); }} min={0} max={5000} />
        </div>
      ) : null}
      <Segmented label="Carbohydrate on this label" value={region} onChange={setRegion}
        options={[{ value: 'eu', label: 'EU / Greek (excludes fibre)' }, { value: 'us', label: 'US (total, includes fibre)' }]} />

      <fieldset class="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend class="card-title">Nutrition {colName}</legend>
        <div class="fields">
          {useKj
            ? <NumberField label="Energy" suffix="kJ" value={kj} onChange={setKj} min={0} max={4000} />
            : <NumberField label="Energy" suffix="kcal" value={vals.energyKcal} onChange={setV('energyKcal')} min={0} max={950} />}
          <NumberField label="Fat" suffix="g" value={vals.fat} onChange={setV('fat')} min={0} max={100} />
          <NumberField label="of which saturates" suffix="g" value={vals.satFat} onChange={setV('satFat')} min={0} max={100} />
          <NumberField label="Carbohydrate" suffix="g" value={vals.carbs} onChange={setV('carbs')} min={0} max={100} />
          <NumberField label="of which sugars" suffix="g" value={vals.sugars} onChange={setV('sugars')} min={0} max={100} />
          <NumberField label="Fibre" suffix="g" value={vals.fiber} onChange={setV('fiber')} min={0} max={100} />
          <NumberField label="Protein" suffix="g" value={vals.protein} onChange={setV('protein')} min={0} max={100} />
          <NumberField label="Salt" suffix="g" value={vals.salt} onChange={setV('salt')} min={0} max={100} hint="Sodium = salt ÷ 2.5" />
        </div>
        <button type="button" class="linkish small" onClick={() => setUseKj(!useKj)}>{useKj ? 'Enter kcal instead' : 'Label only shows kJ?'}</button>
      </fieldset>
      <details>
        <summary class="small" style={{ cursor: 'pointer', fontWeight: 700 }}>More nutrients from the label (optional)</summary>
        <div class="fields" style={{ marginTop: '10px' }}>
          {EXTRA.map((id) => <NumberField key={id} label={NUTRIENTS[id].label} suffix={NUTRIENTS[id].unit} value={vals[id]} onChange={setV(id)} min={0} max={100000} />)}
        </div>
      </details>
      <NumberField label="Density (only for liquids/sauces you measure in mL)" suffix="g per mL" value={density} onChange={setDensity} min={0.3} max={2.5} hint="Leave empty unless the label gives both g and mL; we never assume 1 g = 1 mL." />
      <Field label="Notes" for="fe-notes"><textarea id="fe-notes" class="textarea" value={notes} onInput={(e) => setNotes(e.currentTarget.value)} placeholder="Flavour, where you buy it…" /></Field>

      {r.errors.length ? <div class="callout danger" role="alert">{r.errors.map((e) => <p key={e} class="error">{e}</p>)}</div> : null}
      {r.warnings.length ? <div class="callout warn" role="note">{r.warnings.map((w) => <p key={w} class="small">{w}</p>)}</div> : null}
      {r.errors.length === 0 && r.n.kcal !== undefined ? (
        <section class="stack-s" aria-label="Preview">
          <h3 class="card-title">Saved as {r.basis.per === 'unit' ? `per ${r.basis.unitLabel}` : r.basis.per === '100ml' ? 'per 100 mL' : 'per 100 g'}</h3>
          <NutrientTable ids={['kcal', 'protein', 'carbs', 'fiber', 'fat', 'satFat', 'sodium']} values={r.n} />
          {r.derived.length ? <p class="xs subtle">{r.derived.join(' · ')}</p> : null}
        </section>
      ) : null}
    </Sheet>
  );
}
