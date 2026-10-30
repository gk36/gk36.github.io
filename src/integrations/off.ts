import { db } from '../data/db';
import { nowIso } from '../data/ids';
import { normalizeLabel, type LabelInput, KJ_PER_KCAL } from '../domain/nutrition/label';
import type { NutrientId } from '../domain/nutrition/nutrients';
import type { Food } from '../domain/nutrition/food';

/**
 * Open Food Facts (crowd-sourced, ODbL). Read-only product lookups by barcode:
 * v3 endpoint, only the fields we use, ≤ 1 request per ~4 s (OFF allows ~15 product reads/min/IP),
 * cached locally so a repeat scan works offline. Data is shown for the user to check against the
 * package — it is never treated as verified.
 */
export const OFF_API = 'https://world.openfoodfacts.org/api/v3/product';
const FIELDS = [
  'code', 'product_name', 'product_name_el', 'product_name_en', 'generic_name', 'brands', 'quantity',
  'product_quantity_unit', 'serving_size', 'serving_quantity', 'nutriments', 'nutrition_data_per',
  'image_front_small_url', 'countries_tags',
].join(',');

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_el?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
  nutrition_data_per?: string;
  image_front_small_url?: string;
  countries_tags?: string[];
}

let lastRequest = 0;
const MIN_INTERVAL_MS = 4100;

export type LookupResult =
  | { status: 'found'; product: OffProduct; fromCache: boolean }
  | { status: 'not-found'; fromCache: boolean }
  | { status: 'error'; message: string };

export async function lookupBarcode(code: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  const cached = await db().offLookups.get(code);
  if (cached) {
    return cached.status === 'found' ? { status: 'found', product: cached.product as OffProduct, fromCache: true } : { status: 'not-found', fromCache: true };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'error', message: 'You are offline. Enter the label by hand, or try again when online.' };
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(`${OFF_API}/${encodeURIComponent(code)}.json?fields=${FIELDS}`, {
      headers: { Accept: 'application/json', 'X-User-Agent': 'CARBMAXX/2.0 (https://gk36.github.io/app/)' },
    });
  } catch {
    return { status: 'error', message: 'Could not reach Open Food Facts. Check your connection.' };
  }
  if (res.status === 404) {
    await db().offLookups.put({ code, fetchedAt: nowIso(), status: 'not-found' });
    return { status: 'not-found', fromCache: false };
  }
  if (res.status === 429 || res.status === 503) return { status: 'error', message: 'Open Food Facts is busy. Try again in a minute.' };
  if (!res.ok) return { status: 'error', message: `Open Food Facts returned an error (${res.status}).` };
  const json = (await res.json()) as { status?: string; product?: OffProduct; result?: { id?: string } };
  if (!json.product || json.result?.id === 'product_not_found') {
    await db().offLookups.put({ code, fetchedAt: nowIso(), status: 'not-found' });
    return { status: 'not-found', fromCache: false };
  }
  await db().offLookups.put({ code, fetchedAt: nowIso(), status: 'found', product: json.product });
  return { status: 'found', product: json.product, fromCache: false };
}

/** OFF stores every nutrient in grams per 100 g/mL; these are our canonical units. */
const MICROS: [string, NutrientId, number][] = [
  ['monounsaturated-fat', 'monoFat', 1], ['polyunsaturated-fat', 'polyFat', 1], ['trans-fat', 'transFat', 1],
  ['cholesterol', 'cholesterol', 1e3], ['calcium', 'calcium', 1e3], ['iron', 'iron', 1e3], ['magnesium', 'magnesium', 1e3],
  ['potassium', 'potassium', 1e3], ['zinc', 'zinc', 1e3], ['phosphorus', 'phosphorus', 1e3], ['copper', 'copper', 1e3],
  ['manganese', 'manganese', 1e3], ['selenium', 'selenium', 1e6], ['iodine', 'iodine', 1e6], ['vitamin-c', 'vitC', 1e3],
  ['vitamin-d', 'vitD', 1e6], ['vitamin-e', 'vitE', 1e3], ['vitamin-k', 'vitK', 1e6], ['vitamin-b1', 'thiamin', 1e3],
  ['vitamin-b2', 'riboflavin', 1e3], ['vitamin-pp', 'niacin', 1e3], ['vitamin-b6', 'vitB6', 1e3], ['vitamin-b12', 'vitB12', 1e6],
  ['pantothenic-acid', 'pantothenic', 1e3], ['caffeine', 'caffeine', 1e3],
];

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const isLiquid = (p: OffProduct) => (p.product_quantity_unit ?? '').toLowerCase() === 'ml' || /\b\d+([.,]\d+)?\s?(ml|cl|l)\b/i.test(p.quantity ?? '');
const isUsOnly = (p: OffProduct) => {
  const c = p.countries_tags ?? [];
  return c.length > 0 && c.every((t) => t === 'en:united-states' || t === 'en:puerto-rico');
};

export interface MappedProduct {
  food: Food;
  errors: string[];
  warnings: string[];
  /** Main label nutrients the record lacks (shown as "missing — check the package"). */
  missing: string[];
  image?: string;
}

/** Maps an OFF product to a CARBMAXX food through the same validator as hand-entered labels. */
export function mapOffProduct(p: OffProduct, code: string): MappedProduct {
  const n = p.nutriments ?? {};
  const get = (k: string) => num(n[`${k}_100g`]);
  const liquid = isLiquid(p);
  const input: LabelInput = {
    name: (p.product_name_en || p.product_name || p.product_name_el || p.generic_name || `Product ${code}`).trim(),
    basis: liquid ? 'per100ml' : 'per100g',
    region: isUsOnly(p) ? 'us' : 'eu',
  };
  const kcal = get('energy-kcal');
  const kj = get('energy-kj') ?? (get('energy') !== undefined && (n['energy_unit'] === 'kJ' || n['energy_unit'] === undefined) ? get('energy') : undefined);
  if (kcal !== undefined) input.energyKcal = kcal;
  else if (kj !== undefined) input.energyKj = kj;
  const set = (k: keyof LabelInput, v: number | undefined) => { if (v !== undefined) (input as unknown as Record<string, number>)[k] = v; };
  set('protein', get('proteins'));
  set('carbs', get('carbohydrates'));
  set('sugars', get('sugars'));
  set('fat', get('fat'));
  set('satFat', get('saturated-fat'));
  set('fiber', get('fiber'));
  const sodiumG = get('sodium');
  if (sodiumG !== undefined) input.sodiumMg = sodiumG * 1000;
  else set('salt', get('salt'));
  const extra: Partial<Record<NutrientId, number>> = {};
  for (const [key, id, factor] of MICROS) {
    const v = get(key);
    if (v !== undefined) extra[id] = v * factor;
  }
  if (Object.keys(extra).length) input.extra = extra;
  if (p.brands) input.brand = p.brands.split(',')[0]!.trim();

  const r = normalizeLabel(input);
  const missing = [
    ['energy', input.energyKcal ?? input.energyKj], ['protein', input.protein], ['carbohydrate', input.carbs], ['fat', input.fat],
  ].filter(([, v]) => v === undefined).map(([k]) => k as string);
  const warnings = [...r.warnings];
  if (liquid) warnings.push('Values treated as per 100 mL because the product is sold by volume — check the label.');
  if (kcal === undefined && kj !== undefined) warnings.push(`Energy converted from ${Math.round(kj)} kJ (÷ ${KJ_PER_KCAL}).`);

  const servingG = num(p.serving_quantity);
  const food: Food = {
    id: '',
    names: {
      en: input.name,
      ...(p.product_name_el && p.product_name_el !== input.name ? { el: p.product_name_el.trim() } : {}),
      aliases: [code],
    },
    kind: 'branded', group: 'other', prep: 'as-sold', basis: r.basis, gtin: code,
    portions: servingG && servingG > 0 ? [{ id: 'serving', label: `1 serving${p.serving_size ? ` (${p.serving_size})` : ''}`, ...(liquid ? { ml: servingG } : { g: servingG }) }] : [],
    n: r.n, carbsIncludeFiber: input.region === 'us', kcalOrigin: 'label',
    src: {
      type: 'off', confidence: 'medium', ref: `https://world.openfoodfacts.org/product/${code}`,
      note: 'Open Food Facts (crowd-sourced, ODbL). Check the values against the package before relying on them.',
    },
    ...(input.brand ? { brand: input.brand } : {}),
    ...(p.quantity ? { notes: `Pack size: ${p.quantity}` } : {}),
  };
  return { food, errors: r.errors, warnings, missing, ...(p.image_front_small_url && /^https:\/\/images\.openfoodfacts\.org\//.test(p.image_front_small_url) ? { image: p.image_front_small_url } : {}) };
}

/** Foods already saved with this barcode (a scan of a known product needs no network). */
export async function savedFoodsForBarcode(code: string): Promise<Food[]> {
  return (await db().foods.where('gtin').equals(code).toArray()).filter((f) => !f.deletedAt);
}
