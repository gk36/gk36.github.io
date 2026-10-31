/**
 * Builds src/data/foods/core.json from the curated list (scripts/foods/core-foods.source.json)
 * and the official USDA FoodData Central bulk JSON files (public domain, CC0).
 *
 *   node --max-old-space-size=4096 scripts/foods/build-core-foods.ts \
 *     --sr <FoodData_Central_sr_legacy_food_json_2018-04.json> \
 *     --foundation <FoodData_Central_foundation_food_json_2026-10-29.json> \
 *     --fndds <surveyDownload.json>
 *
 * Downloads: https://fdc.nal.usda.gov/download-datasets/ (SR Legacy 2018-04, Foundation 2026-10-29,
 * FNDDS 2021–2023 released 2024-10-31). Every value is copied as published; nothing is invented:
 * missing nutrients stay absent (= unknown). Portion weights are verified against USDA's own portions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NUTRIENT_IDS, NUTRIENTS, convertUnit, type NutrientId, type Unit } from '../../src/domain/nutrition/nutrients.ts';

type Dataset = 'SR Legacy' | 'Foundation' | 'FNDDS';
interface SourceEntry {
  key: string; fdcId: number | null; dataset: Dataset | null; fdcDescription?: string;
  names: { en: string; el?: string; aliases?: string[] };
  group: string; prep: string; pair?: string;
  portions?: { label: string; g: number }[];
  densityGPerMl?: number | null; notes?: string;
}
interface FdcNutrient { nutrient: { id: number; unitName: string; name: string }; amount?: number; foodNutrientDerivation?: { code?: string; description?: string } }
interface FdcFood { fdcId: number; description: string; dataType: string; publicationDate?: string; foodNutrients: FdcNutrient[]; foodPortions?: { gramWeight: number; modifier?: string; portionDescription?: string }[] }

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const sourcePath = arg('source') ?? path.join(root, 'scripts/foods/core-foods.source.json');
const outPath = arg('out') ?? path.join(root, 'src/data/foods/core.json');
const metaPath = outPath.replace(/\.json$/, '.meta.json');

const RELEASE: Record<Dataset, string> = { 'SR Legacy': '2018-04', Foundation: '2026-10-29', FNDDS: '2021–2023 (2024-10-31)' };
const FILES: Record<Dataset, string | undefined> = { 'SR Legacy': arg('sr'), Foundation: arg('foundation'), FNDDS: arg('fndds') };

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as SourceEntry[];
const needed = new Set(source.map((s) => s.dataset).filter((d): d is Dataset => !!d));

const byId = new Map<number, FdcFood>();
for (const ds of needed) {
  const file = FILES[ds];
  if (!file) throw new Error(`--${ds === 'SR Legacy' ? 'sr' : ds.toLowerCase()} is required (entries use ${ds})`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, FdcFood[]>;
  const list = Object.values(json)[0]!;
  for (const f of list) byId.set(f.fdcId, f);
  console.log(`${ds}: ${list.length} foods from ${path.basename(file)}`);
}

const UNIT: Record<string, Unit> = { G: 'g', g: 'g', MG: 'mg', mg: 'mg', UG: 'µg', 'µg': 'µg', KCAL: 'kcal', kcal: 'kcal' };
const derivations = new Map<string, string>();
const problems: string[] = [];
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function extract(f: FdcFood): { n: Record<string, number>; nd: Record<string, string> } {
  const n: Record<string, number> = {};
  const nd: Record<string, string> = {};
  for (const id of NUTRIENT_IDS) {
    const def = NUTRIENTS[id];
    for (const fdcNid of def.fdc) {
      const hit = f.foodNutrients.find((x) => x.nutrient?.id === fdcNid && typeof x.amount === 'number' && Number.isFinite(x.amount));
      if (!hit) continue;
      const from = UNIT[hit.nutrient.unitName];
      if (!from) { problems.push(`${f.fdcId}: unknown unit ${hit.nutrient.unitName} for ${id}`); break; }
      let v = hit.amount!;
      if (from !== def.unit) v = convertUnit(v, from, def.unit);
      n[id] = Math.round(v * 10000) / 10000;
      const code = hit.foodNutrientDerivation?.code;
      if (code) {
        nd[id] = code;
        if (hit.foodNutrientDerivation?.description) derivations.set(code, hit.foodNutrientDerivation.description);
      }
      break;
    }
  }
  return { n, nd };
}

type Food = Record<string, unknown> & { id: string; n: Record<string, number> };
const out: Food[] = [];
const byKey = new Map<string, Food>();

for (const s of source) {
  if (!s.fdcId || !s.dataset) continue;
  const f = byId.get(s.fdcId);
  if (!f) { problems.push(`${s.key}: fdcId ${s.fdcId} not found in ${s.dataset}`); continue; }
  if (s.fdcDescription && s.fdcDescription !== f.description) problems.push(`${s.key}: description mismatch ("${f.description}")`);
  const { n, nd } = extract(f);
  for (const req of ['kcal', 'protein', 'fat', 'carbs'] as NutrientId[]) if (n[req] === undefined) problems.push(`${s.key}: missing ${req}`);
  const portions = (s.portions ?? []).map((p) => {
    const ok = (f.foodPortions ?? []).some((fp) => Math.abs(fp.gramWeight - p.g) < 0.05);
    if (!ok) problems.push(`${s.key}: portion "${p.label}" ${p.g} g is not a USDA portion of ${f.fdcId}`);
    return { id: slug(p.label) || 'portion', label: p.label, g: p.g };
  });
  const food: Food = {
    id: `core:${s.key}`,
    names: s.names,
    kind: 'generic',
    group: s.group,
    prep: s.prep,
    basis: { per: '100g' },
    ...(s.densityGPerMl ? { densityGPerMl: s.densityGPerMl } : {}),
    portions,
    n,
    nd,
    carbsIncludeFiber: true,
    kcalOrigin: 'database',
    src: {
      type: 'usda-fdc', confidence: s.dataset === 'FNDDS' ? 'medium' : 'high', dataset: s.dataset, fdcId: f.fdcId,
      ref: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`, release: RELEASE[s.dataset],
      note: s.dataset === 'FNDDS' ? 'FNDDS values are complete but partly imputed for survey use.' : `USDA: ${f.description}`,
    },
    ...(s.pair ? { pair: `core:${s.pair}` } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
  };
  out.push(food);
  byKey.set(s.key, food);
}

/* ---------- derived entries: always labelled, never presented as measured ---------- */
const need = (key: string): Food => {
  const f = byKey.get(key);
  if (!f) throw new Error(`derived entry needs ${key}`);
  return f;
};
const derived: Food[] = [];

{
  const b = need('chicken-breast-raw');
  derived.push({
    ...b, id: 'core:ground-chicken-breast-raw',
    names: { en: 'Ground chicken breast (raw)', el: 'Κιμάς στήθος κοτόπουλου (ωμός)', aliases: ['ground chicken', 'κιμάς κοτόπουλο'] },
    src: { type: 'proxy', confidence: 'medium', ref: (b.src as { ref: string }).ref, note: 'Skinless chicken breast values (USDA FDC 171077) for breast-only mince with no added skin or fat. Packaged ground chicken often contains skin/thigh — use its label instead.' },
    notes: 'Same as skinless breast. Check the pack: many ground chicken products include skin and are much fattier.',
  });
}
{
  const parts = ['strawberries', 'blueberries', 'raspberries'].map(need);
  const n: Record<string, number> = {};
  for (const id of NUTRIENT_IDS) {
    if (parts.every((p) => p.n[id] !== undefined)) n[id] = Math.round((parts.reduce((s, p) => s + p.n[id]!, 0) / parts.length) * 10000) / 10000;
  }
  derived.push({
    id: 'core:mixed-berries', names: { en: 'Mixed berries (raw)', el: 'Μικτά μούρα (ωμά)', aliases: ['berries', 'μούρα', 'φρούτα του δάσους'] },
    kind: 'generic', group: 'fruit', prep: 'as-sold', basis: { per: '100g' }, portions: [], n, carbsIncludeFiber: true, kcalOrigin: 'computed',
    src: { type: 'estimate', confidence: 'medium', note: 'Equal-weight average of USDA strawberries, blueberries and raspberries; nutrients missing in any of the three are unknown.' },
    notes: 'An average of three berries. Log the actual berries for exact values.',
  });
}
{
  const sp = need('sweet-potato-raw');
  const n = { ...sp.n };
  delete n.vitA;
  derived.push({
    ...sp, id: 'core:sweet-potato-purple-raw',
    names: { en: 'Purple sweet potato (raw)', el: 'Μωβ γλυκοπατάτα (ωμή)', aliases: ['purple sweet potato', 'okinawan', 'μωβ γλυκοπατάτα'] },
    n, nd: Object.fromEntries(Object.entries((sp.nd as Record<string, string>) ?? {}).filter(([k]) => k !== 'vitA')),
    src: { type: 'proxy', confidence: 'low', note: 'Macros borrowed from orange sweet potato (USDA). Purple varieties contain anthocyanins instead of β-carotene, so vitamin A is UNKNOWN rather than copied.' },
    notes: 'Vitamin A is deliberately unknown: orange sweet potato values do not apply to purple varieties.',
  });
}
derived.push({
  id: 'core:bone-broth', names: { en: 'Beef bone broth (typical)', el: 'Ζωμός κόκαλων μοσχαριού', aliases: ['bone broth', 'broth', 'ζωμός'] },
  kind: 'generic', group: 'drink', prep: 'as-sold', basis: { per: '100ml' }, portions: [{ id: 'cup-250-ml', label: '1 cup (250 mL)', ml: 250 }],
  n: { kcal: 16, protein: 3.6, carbs: 0, fat: 0.2 }, carbsIncludeFiber: true, kcalOrigin: 'label',
  src: { type: 'estimate', confidence: 'low', note: 'Typical commercial bone broth (≈ 40 kcal, 9 g protein per 250 mL) carried over from CARBMAXX v1. Brands vary widely — scan or enter your carton.' },
  notes: 'Brand values vary a lot; use your carton\'s label when you can.',
});
derived.push({
  id: 'core:tbjp-sticky-toffee', names: { en: 'Cream of rice · Sticky Toffee Pudding (dry)', el: 'Κρέμα ρυζιού Sticky Toffee (σκόνη)', aliases: ['tbjp', 'cream of rice sticky toffee', 'sticky toffee'] },
  kind: 'branded', brand: 'tbJP', group: 'starch', prep: 'dry', basis: { per: '100g' }, portions: [{ id: 'scoop', label: '1 scoop (25 g)', g: 25 }],
  n: { kcal: 340, protein: 6.7, carbs: 76.9, fat: 0.6 }, carbsIncludeFiber: false, kcalOrigin: 'label',
  src: { type: 'label', confidence: 'medium', note: 'Per-100 g values from the Sticky Toffee Pudding label as entered in CARBMAXX v1. Other flavours differ.' },
  notes: 'Weigh the dry powder. Other flavours have different macros.',
});

const all = [...out, ...derived];
const unresolved = source.filter((s) => !s.fdcId || !s.dataset).map((s) => s.key);
const groupOrder = ['protein', 'dairy', 'starch', 'fruit', 'veg', 'fat', 'sweet', 'drink', 'other'];
all.sort((a, b) => groupOrder.indexOf(a.group as string) - groupOrder.indexOf(b.group as string) || (a.names as { en: string }).en.localeCompare((b.names as { en: string }).en));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(all));
fs.writeFileSync(metaPath, JSON.stringify({
  builtAt: new Date().toISOString(),
  license: 'USDA FoodData Central data are in the public domain (CC0 1.0). Source: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central, fdc.nal.usda.gov.',
  datasets: Object.fromEntries([...needed].map((d) => [d, RELEASE[d]])),
  counts: { usda: out.length, derived: derived.length, total: all.length },
  unresolved,
  derivationCodes: Object.fromEntries([...derivations.entries()].sort()),
}, null, 2));
console.log(`wrote ${all.length} foods (${out.length} USDA + ${derived.length} derived) → ${path.relative(root, outPath)}`);
if (unresolved.length) console.log(`not in USDA (manual/proxy needed): ${unresolved.join(', ')}`);
