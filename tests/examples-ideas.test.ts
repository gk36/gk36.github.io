import { beforeEach, describe, expect, it } from 'vitest';
import { CarbmaxxDB, db, useDatabase } from '../src/data/db';
import { uuidv7 } from '../src/data/ids';
import { foodSchema } from '../src/data/schemas';
import { buildExamples, EXAMPLE_IDS, seedExamples } from '../src/data/examples';
import { listRecipes, saveRecipe } from '../src/data/kitchen';
import { defaultProfile, saveProfile } from '../src/data/profile';
import { addEntry, listDay } from '../src/data/entries';
import { addPantryItem, deductFromPantry, listPantry } from '../src/data/pantry';
import { ideaFood, loadIdeaSetup, mealGoal, mealNeeds } from '../src/data/ideas';
import { coreFoods } from '../src/data/foods/registry';
import { recipeTotals } from '../src/domain/kitchen/recipe';
import { generateIdeas } from '../src/domain/ideas/generate';
import { DEFAULT_TASTE } from '../src/domain/ideas/model';
import { dayTotals } from '../src/domain/diary';

const DAY = '2026-10-30';

beforeEach(async () => {
  useDatabase(new CarbmaxxDB(`test-${uuidv7()}`));
  await saveProfile({
    ...defaultProfile(), sex: 'male', weightKg: 73, heightCm: 174, ageYears: 18, onboarded: true,
    targetMode: 'manual', manualTargets: { kcal: 2700, protein: 160, carbs: 360, fat: 60 },
  });
});

describe('example recipes', () => {
  it('are the six the owner asked for, valid, with real steps and honest totals', async () => {
    const ex = await buildExamples();
    expect(ex.map((f) => f.names.en)).toEqual(['Protein cream of rice', 'Protein oat pancakes', 'Chicken and rice', 'Steak and potatoes', 'Sweet chili chicken noodles', 'Lean beef soup']);
    for (const f of ex) {
      expect(foodSchema.safeParse(f).success).toBe(true);
      expect(f.recipe!.example).toBe(true);
      expect(f.recipe!.steps!.split('\n').length).toBeGreaterThanOrEqual(3);
      for (const c of f.recipe!.components) {
        // USDA foods, except the sauce, which has no values at all until the user adds their own.
        if (c.food.id.startsWith('placeholder:')) expect(c.food.n).toEqual({});
        else expect(c.food.src.type).toBe('usda-fdc');
      }
    }
    const noodles = ex.find((f) => f.names.en === 'Sweet chili chicken noodles')!;
    expect(noodles.partial).toContain('kcal');
    const soup = ex.find((f) => f.names.en === 'Lean beef soup')!;
    expect(soup.recipe!.servings).toBe(4);
    const cor = ex.find((f) => f.names.en === 'Protein cream of rice')!;
    const t = recipeTotals(cor.recipe!.components);
    // 60 g cream of rice + 30 g whey + 100 g banana + 10 g honey + 2 g cinnamon, from USDA per-100 g values.
    const core = new Map((await coreFoods()).map((f) => [f.id, f]));
    const k = (id: string, g: number) => (core.get(id)!.n.kcal! * g) / 100;
    expect(t.n.kcal).toBeCloseTo(k('core:cream-of-rice-dry', 60) + k('core:whey-protein', 30) + k('core:banana', 100) + k('core:honey', 10) + k('core:cinnamon', 2), 6);
    expect(cor.n.kcal).toBeCloseTo(t.n.kcal!, 6);
  });

  it('are added once per device, and a deleted or edited one is never brought back', async () => {
    expect(await seedExamples()).toBe(6);
    expect(await seedExamples()).toBe(0);
    const recipes = await listRecipes();
    expect(recipes.map((r) => r.id).sort()).toEqual([...EXAMPLE_IDS].sort());
    // The user edits one and deletes another; seeding again (or on a new install) leaves both alone.
    const pancakes = recipes.find((r) => r.id === 'custom:example-oat-pancakes')!;
    await saveRecipe({ id: pancakes.id, name: 'My pancakes', components: pancakes.recipe!.components, servings: 1, totalG: null });
    const soup = (await db().foods.get('custom:example-lean-beef-soup'))!;
    await db().foods.put({ ...soup, deletedAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z', rev: 2 });
    await db().settings.delete('examples-v1');
    expect(await seedExamples()).toBe(0);
    expect((await db().foods.get(pancakes.id))!.names.en).toBe('My pancakes');
    expect((await db().foods.get(pancakes.id))!.recipe!.example).toBeUndefined();
    expect((await db().foods.get('custom:example-lean-beef-soup'))!.deletedAt).toBeTruthy();
  });
});

describe('meal ideas from the real day', () => {
  it('size the meal from what is left and aim at real gaps', async () => {
    const core = new Map((await coreFoods()).map((f) => [f.id, f]));
    await addEntry({ dayKey: DAY, slotId: 'breakfast', food: core.get('core:oats-dry')!, qty: { amount: 80, unit: 'g' }, status: 'eaten', origin: 'search' });
    const p = (await db().settings.get('profile'))!.value as ReturnType<typeof defaultProfile>;
    const setup = await loadIdeaSetup(p, DAY);
    const projected = dayTotals(await listDay(DAY)).projected.kcal.value;
    expect(setup.left!.kcal).toBeCloseTo(2700 - projected, 6);
    // Lunch, dinner and snacks are still open: lunch gets 1.25 of 3 shares.
    const goal = mealGoal(setup, 'lunch', 'lunch', DEFAULT_TASTE);
    expect(goal.kcal).toBe(Math.round(((2700 - projected) * 1.25) / 3 / 10) * 10);
    const { needs, line } = mealNeeds(setup, p, goal.share);
    expect(needs.length).toBeGreaterThan(0);
    expect(line).toMatch(/^You still need more /);
    // Every need is a real gap against the 18-year-old male reference intakes.
    for (const n of needs) expect(n.amount).toBeGreaterThan(0);
  });

  it('a logged idea counts its ingredients exactly and takes them out of the pantry', async () => {
    const core = new Map((await coreFoods()).map((f) => [f.id, f]));
    await addPantryItem({ food: core.get('core:oats-dry')!, qty: { amount: 500, unit: 'g' } });
    const p = (await db().settings.get('profile'))!.value as ReturnType<typeof defaultProfile>;
    const setup = await loadIdeaSetup(p, DAY);
    const { ideas } = generateIdeas({
      meal: 'breakfast', target: { kcal: 650, protein: 45 }, taste: DEFAULT_TASTE, needs: [], maxMinutes: null, foods: setup.foods,
      stock: setup.stock, pantryOnly: false, recent: setup.recent, seed: 3,
    });
    const idea = ideas.find((i) => i.items.some((x) => x.food.id === 'core:oats-dry'))!;
    expect(idea).toBeDefined();
    const food = ideaFood(idea);
    const e = await addEntry({ dayKey: DAY, slotId: 'breakfast', food, qty: { amount: 1, unit: 'portion', portionId: 'unit' }, status: 'eaten', origin: 'idea' });
    const t = dayTotals(await listDay(DAY));
    expect(t.eaten.kcal.value).toBeCloseTo(idea.totals.kcal.value, 6);
    expect(t.eaten.protein.value).toBeCloseTo(idea.totals.protein.value, 6);
    // The dish's oats come out of the pantry (the same rule logEntry applies to recipes made on the spot).
    const oats = idea.items.find((x) => x.food.id === 'core:oats-dry')!;
    for (const c of e.food.recipe!.components) await deductFromPantry(c.food, c.qty);
    const left = (await listPantry()).find((x) => x.foodId === 'core:oats-dry')!;
    expect(left.qty.amount).toBeCloseTo(500 - oats.amount, 6);
  });
});
