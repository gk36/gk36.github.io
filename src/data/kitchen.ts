import { db } from './db';
import { nowIso, uuidv7 } from './ids';
import { saveCustomFood } from './foods/registry';
import { recipeFood, type Component, type RecipeInfo } from '../domain/kitchen/recipe';
import type { Food } from '../domain/nutrition/food';
import { resolveQuantity } from '../domain/nutrition/quantity';
import type { DayKey } from '../domain/time';

const live = (f: Food) => !f.deletedAt;

export async function listRecipes(): Promise<Food[]> {
  return (await db().foods.toArray()).filter((f) => live(f) && f.recipe && !f.recipe.cookedOn).sort((a, b) => a.names.en.localeCompare(b.names.en));
}

export async function listBatches(includeFinished = false): Promise<Food[]> {
  return (await db().foods.toArray())
    .filter((f) => live(f) && f.recipe?.cookedOn && (includeFinished || !f.recipe.finishedAt))
    .sort((a, b) => (b.recipe!.cookedOn ?? '').localeCompare(a.recipe!.cookedOn ?? ''));
}

/** Recipes are flat: a batch added as an ingredient contributes its own ingredients, scaled. */
export function flattenComponent(c: Component): Component[] {
  const info = c.food.recipe;
  if (!info) return [c];
  const r = resolveQuantity(c.food, c.qty);
  if (!r.ok) return [c];
  const fraction = c.food.basis.per === '100g' ? (info.totalG ? (r.multiplier * 100) / info.totalG : null) : r.multiplier / (info.servings || 1);
  if (fraction === null) return [c];
  return info.components.map((x) => ({ food: x.food, qty: { ...x.qty, amount: Math.round(x.qty.amount * fraction * 10) / 10 } }));
}

export async function saveRecipe(input: { id?: string; name: string; components: Component[]; servings: number; totalG: number | null; steps?: string; prepMinutes?: number }): Promise<Food> {
  const info: RecipeInfo = { components: input.components.flatMap(flattenComponent), totalG: input.totalG, servings: input.servings };
  if (input.steps) info.steps = input.steps;
  if (input.prepMinutes) info.prepMinutes = input.prepMinutes;
  const food = recipeFood({
    id: input.id ?? '', names: { en: input.name.trim() }, kind: 'custom', group: 'other', prep: 'prepared',
    src: { type: 'user', confidence: 'high', note: 'Your recipe: nutrients are the sum of its ingredients.' },
  }, info);
  return saveCustomFood(food);
}

/**
 * Cooks a batch: the ingredients as actually used plus the measured weight of the finished dish.
 * The result is a food "per 100 g of the cooked batch" whose portions conserve every ingredient.
 */
export async function cookBatch(input: { recipe?: Food; name: string; components: Component[]; cookedWeightG: number; servings: number; cookedOn: DayKey }): Promise<Food> {
  const info: RecipeInfo = {
    components: input.components.flatMap(flattenComponent), totalG: input.cookedWeightG, servings: input.servings, cookedOn: input.cookedOn, finishedAt: null,
  };
  if (input.recipe) info.recipeId = input.recipe.id;
  if (input.recipe?.recipe?.steps) info.steps = input.recipe.recipe.steps;
  const food = recipeFood({
    id: `custom:${uuidv7()}`, names: { en: input.name.trim() }, kind: 'custom', group: 'other', prep: 'prepared',
    src: { type: 'user', confidence: 'high', note: `Batch cooked ${input.cookedOn}: ${Math.round(input.cookedWeightG)} g finished weight. Portions are exact fractions of the ingredients.` },
  }, info);
  return saveCustomFood(food);
}

export interface BatchUsage { eatenG: number; plannedG: number; remainingG: number }

export async function batchUsage(batch: Food): Promise<BatchUsage> {
  const total = batch.recipe?.totalG ?? 0;
  const rows = (await db().entries.where('foodId').equals(batch.id).toArray()).filter((e) => !e.deletedAt && e.status !== 'skipped');
  let eatenG = 0, plannedG = 0;
  for (const e of rows) {
    const r = resolveQuantity(batch, e.qty);
    if (!r.ok || r.grams === null) continue;
    if (e.status === 'eaten') eatenG += r.grams; else plannedG += r.grams;
  }
  return { eatenG, plannedG, remainingG: Math.max(0, total - eatenG - plannedG) };
}

export async function finishBatch(batch: Food): Promise<void> {
  const f = await db().foods.get(batch.id);
  if (!f?.recipe) return;
  await db().foods.put({ ...f, recipe: { ...f.recipe, finishedAt: nowIso() }, updatedAt: nowIso(), rev: (f.rev ?? 0) + 1 });
}
