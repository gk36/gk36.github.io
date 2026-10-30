import { db } from './db';
import { uuidv7 } from './ids';
import { allFoods } from './foods/registry';
import { listDay, recentFoods } from './entries';
import { stockByFood, addShopping } from './pantry';
import { daysUntil } from './replan';
import { targetsFor } from './plan';
import { ageFor } from './profile';
import { saveRecipe } from './kitchen';
import type { DayTargets, Profile, Slot } from './types';
import { dayTotals } from '../domain/diary';
import { coverageFor } from '../domain/micros/coverage';
import { referencesFor, type DriTable } from '../domain/micros/dri';
import type { Totals } from '../domain/nutrition/compute';
import { recipeFood, type Component } from '../domain/kitchen/recipe';
import type { Food } from '../domain/nutrition/food';
import type { NutrientId } from '../domain/nutrition/nutrients';
import { DEFAULT_TASTE, type MealKind, type TastePrefs } from '../domain/ideas/model';
import { nutrientWords, type Idea, type Need, type StockInfo } from '../domain/ideas/generate';
import type { DayKey } from '../domain/time';

/**
 * What meal ideas start from: the meal's share of what is left of today's calories and protein,
 * today's micronutrient gaps (against the user's age/sex reference intakes), the pantry, and the
 * foods the user eats often. Only planned and eaten food counts; nothing is assumed.
 */

export const MEAL_RE: Record<MealKind, RegExp> = {
  breakfast: /breakfast|morning|πρωιν/i, lunch: /lunch|midday|μεσημ/i, dinner: /dinner|supper|evening|βραδ|δείπν/i, snack: /snack|σνακ|pre|post/i,
};
const WEIGHT: Record<MealKind, number> = { breakfast: 1, lunch: 1.25, dinner: 1.25, snack: 0.5 };

export function mealOfSlot(slot: Pick<Slot, 'name'> | undefined, hour = new Date().getHours()): MealKind {
  if (slot) for (const k of ['breakfast', 'lunch', 'dinner', 'snack'] as const) if (MEAL_RE[k].test(slot.name)) return k;
  return hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';
}

export function tasteOf(p: Profile): TastePrefs {
  return { ...DEFAULT_TASTE, ...(p.taste ?? {}) };
}

/** Nutrients worth steering meals towards (sodium is a limit, not a goal). */
const GOALS: NutrientId[] = ['fiber', 'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'vitA', 'vitC', 'vitD', 'vitE', 'vitK', 'folate', 'vitB12', 'choline'];

export interface IdeaSetup {
  dayKey: DayKey;
  slots: Slot[];
  targets: DayTargets | null;
  /** Calories and protein left for the day after eaten and planned food (null without targets). */
  left: { kcal: number; protein: number } | null;
  projected: Totals;
  foods: Map<string, Food>;
  stock: Map<string, StockInfo>;
  recent: Set<string>;
  dri: DriTable;
  plannedSlots: Set<string>;
}

export async function loadIdeaSetup(p: Profile, dayKey: DayKey): Promise<IdeaSetup> {
  const [entries, day, foods, stock, recents, dri] = await Promise.all([
    listDay(dayKey), db().days.get(dayKey), allFoods(), stockByFood(), recentFoods(40),
    import('../domain/micros/dri-table.json').then((m) => (m as unknown as { default: DriTable }).default),
  ]);
  const dayType = day?.dayType ?? p.defaultDayType;
  const targets = await targetsFor(p, dayKey, dayType);
  const t = dayTotals(entries);
  const stockInfo = new Map<string, StockInfo>();
  for (const [id, s] of stock) stockInfo.set(id, { grams: s.grams, expiresInDays: daysUntil(dayKey, s.expiresOn) });
  return {
    dayKey, slots: day?.slots ?? p.defaultSlots, targets,
    left: targets ? { kcal: targets.kcal - t.projected.kcal.value, protein: targets.protein - t.projected.protein.value } : null,
    projected: t.projected, foods: new Map(foods.map((f) => [f.id, f])), stock: stockInfo,
    recent: new Set(recents.map((r) => r.food.id)), dri,
    plannedSlots: new Set(entries.filter((e) => e.status !== 'skipped').map((e) => e.slotId)),
  };
}

export interface MealGoal {
  kcal: number;
  protein: number;
  /** This meal's share of what is left today (0–1). */
  share: number;
  note: string | null;
}

/** The meal's fair share of what is left: open meals split it by size (snacks count half). */
export function mealGoal(setup: IdeaSetup, meal: MealKind, slotId: string, taste: TastePrefs): MealGoal {
  const snack = meal === 'snack';
  const fallback = snack ? { kcal: 300, protein: 25 } : { kcal: 600, protein: 40 };
  const minProteinShare = taste.highProtein ? 0.065 : 0.05;
  if (!setup.left) return { ...fallback, share: 1, note: 'Add your stats in Plan to size meals to your targets — these use a standard size.' };
  const open = setup.slots.filter((s) => s.id === slotId || !setup.plannedSlots.has(s.id));
  const weights = open.map((s) => WEIGHT[mealOfSlot(s)]);
  const share = Math.min(1, WEIGHT[meal] / Math.max(WEIGHT[meal], weights.reduce((a, b) => a + b, 0)));
  if (setup.left.kcal < 150) {
    return { kcal: 200, protein: 20, share, note: `You're at today's calorie target already, so these are light, protein-rich options.` };
  }
  const kcal = Math.round(Math.min(snack ? 500 : 1300, Math.max(snack ? 150 : 300, setup.left.kcal * share)) / 10) * 10;
  const protein = Math.round(Math.min(kcal * 0.1, Math.max(kcal * minProteinShare, setup.left.protein * share)));
  return { kcal, protein, share, note: null };
}

/** Today's biggest micronutrient gaps, and how much of each this meal should aim for. */
export function mealNeeds(setup: IdeaSetup, p: Profile, share: number): { needs: Need[]; line: string | null } {
  const age = ageFor(p, setup.dayKey);
  const refs = p.sex && age !== null ? referencesFor(setup.dri, p.sex, age) : null;
  if (!refs) return { needs: [], line: null };
  const rows = coverageFor(setup.projected, refs, GOALS)
    .filter((r) => r.ref?.target)
    .map((r) => ({ r, left: Math.max(0, r.ref!.target! - r.amount) }))
    .filter((x) => x.left > 0.2 * x.r.ref!.target!)
    .map((x) => ({ ...x, weight: x.left / x.r.ref!.target! }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);
  const needs: Need[] = rows.map((x) => ({ id: x.r.id, amount: x.left * Math.max(share, 0.25), weight: Math.min(1, x.weight) }));
  const top = rows.slice(0, 3);
  if (!top.length) return { needs, line: null };
  const nothing = setup.projected.kcal.value < 1;
  const line = nothing
    ? `Nothing logged yet today — these ideas aim for a good share of ${nutrientWords(top.map((x) => x.r.id))}.`
    : `You still need more ${nutrientWords(top.map((x) => x.r.id))} today.`;
  return { needs, line };
}

/* ------------------------------------------------------------------ actions */

const componentsOf = (idea: Idea): Component[] => idea.items.map((i) => ({ food: i.food, qty: i.qty }));

/** The idea as one loggable dish: its ingredients are kept, so totals stay honest per ingredient. */
export function ideaFood(idea: Idea): Food {
  return recipeFood({
    id: `idea:${uuidv7()}`, names: { en: idea.blueprint.name }, kind: 'custom', group: 'other', prep: 'prepared',
    src: { type: 'user', confidence: 'high', note: 'Meal idea: nutrients are the sum of its ingredients (USDA and your own foods).' },
  }, { components: componentsOf(idea), totalG: null, servings: 1, steps: idea.steps.join('\n'), prepMinutes: idea.blueprint.minutes });
}

export async function saveIdeaAsRecipe(idea: Idea): Promise<Food> {
  return saveRecipe({ name: idea.blueprint.name, components: componentsOf(idea), servings: 1, totalG: null, steps: idea.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), prepMinutes: idea.blueprint.minutes });
}

/** Adds what the pantry lacks (staples excluded) to the shopping list. */
export async function ideaToShopping(idea: Idea): Promise<number> {
  let n = 0;
  for (const it of idea.items) {
    if (it.stock !== 'missing' && it.stock !== 'short') continue;
    await addShopping({ name: it.food.names.en, food: it.food, qty: it.qty, group: it.food.group, source: 'recipe', note: `For ${idea.blueprint.name}` });
    n += 1;
  }
  return n;
}
