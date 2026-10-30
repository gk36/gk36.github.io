import { NUTRIENT_IDS, type NutrientId } from '../nutrition/nutrients';
import type { Food, NutrientMap, Quantity } from '../nutrition/food';
import { contribution, scale } from '../nutrition/compute';
import { resolveQuantity } from '../nutrition/quantity';

/**
 * Recipes and batches keep their INGREDIENTS. A logged portion counts that exact fraction of each
 * ingredient, so unknown nutrients stay attached to the ingredient that lacks them (a sauce with no
 * magnesium data never hides the chicken's magnesium, and is never counted as zero).
 */
/** An ingredient. Recipes are kept flat: adding a batch to a recipe adds the batch's own ingredients. */
export interface Component {
  food: Food;
  qty: Quantity;
}

export interface RecipeInfo {
  components: Component[];
  /** Measured weight of the whole cooked dish/batch in grams (null = not weighed). */
  totalG: number | null;
  /** Portions the whole recipe makes (used when it is not weighed). */
  servings: number;
  cookedOn?: string;
  recipeId?: string;
  /** Set when a batch is finished or the rest was thrown away. */
  finishedAt?: string | null;
  steps?: string;
  prepMinutes?: number;
}

export interface RecipeTotals {
  /** Sum of KNOWN amounts for the whole recipe. */
  n: NutrientMap;
  /** Nutrients that at least one ingredient (with a real amount) does not report. */
  partial: NutrientId[];
  /** Sum of ingredient weights where known (raw/as-used). */
  ingredientG: number;
  errors: string[];
}

export function recipeTotals(components: readonly Component[]): RecipeTotals {
  const n: NutrientMap = {};
  const partial = new Set<NutrientId>();
  const errors: string[] = [];
  let ingredientG = 0;
  for (const c of components) {
    const r = contribution(c.food, c.qty);
    if ('error' in r) { errors.push(`${c.food.names.en}: ${r.error}`); continue; }
    if (r.grams !== null) ingredientG += r.grams;
    const counted = (r.n.kcal ?? 0) > 0 || (r.grams ?? 0) > 0;
    for (const id of NUTRIENT_IDS) {
      const v = r.n[id];
      if (v === undefined) { if (counted) partial.add(id); }
      else n[id] = (n[id] ?? 0) + v;
    }
  }
  return { n, partial: NUTRIENT_IDS.filter((id) => partial.has(id)), ingredientG, errors };
}

/**
 * Builds the loggable food for a recipe/batch. Weighed: per 100 g of the finished dish.
 * Not weighed: per serving (and per gram only if the user later weighs it).
 */
export function recipeFood(base: Omit<Food, 'n' | 'basis' | 'recipe' | 'portions' | 'carbsIncludeFiber' | 'kcalOrigin'>, info: RecipeInfo): Food {
  const t = recipeTotals(info.components);
  const servings = info.servings > 0 ? info.servings : 1;
  const n: NutrientMap = {};
  let basis: Food['basis'];
  if (info.totalG && info.totalG > 0) {
    basis = { per: '100g' };
    for (const id of NUTRIENT_IDS) if (t.n[id] !== undefined) n[id] = (t.n[id]! * 100) / info.totalG;
  } else {
    basis = { per: 'unit', unitLabel: 'serving' };
    for (const id of NUTRIENT_IDS) if (t.n[id] !== undefined) n[id] = t.n[id]! / servings;
  }
  const portions: Food['portions'] = info.totalG && info.totalG > 0
    ? [{ id: 'serving', label: `1 serving (≈ ${Math.round(info.totalG / servings)} g)`, g: info.totalG / servings }]
    : [];
  return { ...base, basis, n, portions, carbsIncludeFiber: true, kcalOrigin: 'computed', recipe: { ...info, components: info.components.map((c) => ({ ...c })) }, partial: t.partial };
}

/** Which fraction of the WHOLE recipe/batch a quantity represents (null if it cannot be resolved). */
export function recipeFraction(food: Food, qty: Quantity): number | null {
  const info = food.recipe;
  if (!info) return null;
  const r = resolveQuantity(food, qty);
  if (!r.ok) return null;
  if (food.basis.per === '100g') return info.totalG ? (r.multiplier * 100) / info.totalG : null;
  return r.multiplier / (info.servings > 0 ? info.servings : 1);
}

/** The ingredient-level nutrient maps for one logged portion (used for honest totals). */
export function compositeParts(food: Food, qty: Quantity): NutrientMap[] | null {
  const info = food.recipe;
  if (!info) return null;
  const f = recipeFraction(food, qty);
  if (f === null) return null;
  const parts: NutrientMap[] = [];
  for (const c of info.components) {
    const r = contribution(c.food, c.qty);
    if ('error' in r) continue;
    parts.push(scale(r.n, f));
  }
  return parts;
}

/** Grams of a weighed batch still left after the logged portions (never below zero). */
export function remainingG(totalG: number, loggedG: readonly number[]): number {
  return Math.max(0, totalG - loggedG.reduce((s, g) => s + g, 0));
}

/** Scales every ingredient amount (cooking 1.5× the recipe, half a recipe…). */
export function scaleComponents(components: readonly Component[], factor: number): Component[] {
  return components.map((c) => ({ ...c, qty: { ...c.qty, amount: Math.round(c.qty.amount * factor * 10) / 10 } as Quantity }));
}

/**
 * Food-specific cooked yield estimated from a USDA raw/cooked pair: protein is (nearly) conserved
 * while water is lost, so yield ≈ protein density raw ÷ cooked. An ESTIMATE (± ~10 %), always shown
 * as such; a measured batch weight always wins.
 */
export function estimatedYield(raw: Pick<Food, 'n'>, cooked: Pick<Food, 'n'>): number | null {
  const pr = raw.n.protein, pc = cooked.n.protein;
  if (!pr || !pc || pr < 2 || pc < 2) return null;
  const y = pr / pc;
  return y > 0.3 && y < 3.5 ? y : null;
}
