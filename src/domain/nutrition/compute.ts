import { NUTRIENT_IDS, type NutrientId } from './nutrients';
import type { Food, NutrientMap, Quantity } from './food';
import { resolveQuantity } from './quantity';

/** Scales every KNOWN nutrient; unknown stays unknown. */
export function scale(n: NutrientMap, multiplier: number): NutrientMap {
  const out: NutrientMap = {};
  for (const id of NUTRIENT_IDS) {
    const v = n[id];
    if (v !== undefined) out[id] = v * multiplier;
  }
  return out;
}

/**
 * Nutrients for one food at one quantity, normalised so `carbs` is always TOTAL carbohydrate
 * (US/USDA convention). EU-label foods (carbs exclude fibre) get fibre added back when it is
 * known; when fibre is unknown their carbs stay as labelled and `carbsExcludeUnknownFiber` is set.
 */
export interface Contribution {
  n: NutrientMap;
  grams: number | null;
  ml: number | null;
  carbsExcludeUnknownFiber: boolean;
}

export function contribution(food: Food, qty: Quantity): Contribution | { error: string } {
  const r = resolveQuantity(food, qty);
  if (!r.ok) return { error: r.reason };
  const n = scale(food.n, r.multiplier);
  let carbsExcludeUnknownFiber = false;
  if (!food.carbsIncludeFiber && n.carbs !== undefined) {
    if (n.fiber !== undefined) n.carbs = n.carbs + n.fiber;
    else carbsExcludeUnknownFiber = true;
  }
  return { n, grams: r.grams, ml: r.ml, carbsExcludeUnknownFiber };
}

export interface NutrientTotal {
  /** Sum of the known values (a lower bound when `unknown` > 0). */
  value: number;
  /** Number of items that report this nutrient. */
  known: number;
  /** Number of items where it is unknown. */
  unknown: number;
  /** Share of the items' energy that comes from items where this nutrient is known (0–1). */
  energyShare: number;
}

export type Totals = Record<NutrientId, NutrientTotal>;

export function emptyTotals(): Totals {
  const t = {} as Totals;
  for (const id of NUTRIENT_IDS) t[id] = { value: 0, known: 0, unknown: 0, energyShare: 1 };
  return t;
}

/** Sums nutrient maps without ever treating unknown as zero. */
export function sumNutrients(items: readonly NutrientMap[]): Totals {
  const t = emptyTotals();
  const energyKnown: Partial<Record<NutrientId, number>> = {};
  let energyAll = 0;
  for (const n of items) {
    const kcal = n.kcal ?? 0;
    energyAll += kcal;
    for (const id of NUTRIENT_IDS) {
      const v = n[id];
      const slot = t[id];
      if (v === undefined) slot.unknown += 1;
      else {
        slot.value += v;
        slot.known += 1;
        energyKnown[id] = (energyKnown[id] ?? 0) + kcal;
      }
    }
  }
  for (const id of NUTRIENT_IDS) {
    const slot = t[id];
    if (items.length === 0) slot.energyShare = 1;
    else if (energyAll > 0) slot.energyShare = (energyKnown[id] ?? 0) / energyAll;
    else slot.energyShare = slot.known / items.length;
  }
  return t;
}

/**
 * Energy implied by the macros. EU-style foods (carbs exclude fibre) use EU factors
 * (fibre 2 kcal/g); total-carbohydrate foods count fibre inside carbs at 4 kcal/g.
 */
export function atwaterKcal(n: NutrientMap, carbsIncludeFiber: boolean): number | null {
  if (n.protein === undefined || n.carbs === undefined || n.fat === undefined) return null;
  const alcohol = n.alcohol ?? 0;
  if (carbsIncludeFiber) return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 7 * alcohol;
  return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 2 * (n.fiber ?? 0) + 7 * alcohol;
}

export interface EnergyCheck {
  stated: number;
  computed: number;
  diff: number;
  /** Large enough to deserve a look. Never auto-corrected. */
  mismatch: boolean;
}

/**
 * EU labels calculate energy FROM the declared macros, so beyond rounding (≈ ±9 kcal per 100 g)
 * they should agree: flag > 10 kcal AND > 5 %. Database values (USDA) use food-specific
 * factors, so only flag gross differences (> 20 kcal AND > 15 %).
 */
export function energyCheck(food: Pick<Food, 'n' | 'carbsIncludeFiber'>, mode: 'label' | 'database' = 'database'): EnergyCheck | null {
  const stated = food.n.kcal;
  const computed = atwaterKcal(food.n, food.carbsIncludeFiber);
  if (stated === undefined || computed === null) return null;
  const diff = stated - computed;
  const [absTol, relTol] = mode === 'label' ? [10, 0.05] : [20, 0.15];
  const mismatch = Math.abs(diff) > absTol && Math.abs(diff) > relTol * Math.max(stated, computed);
  return { stated, computed, diff, mismatch };
}
