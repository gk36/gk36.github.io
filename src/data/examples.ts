import { db } from './db';
import { coreFoods } from './foods/registry';
import { foodSchema } from './schemas';
import { recipeFood } from '../domain/kitchen/recipe';
import type { Food } from '../domain/nutrition/food';
import { BLUEPRINTS } from '../domain/ideas/blueprints';
import { assembleIdea, type IdeaInput, type ItemDraft } from '../domain/ideas/generate';
import { DEFAULT_TASTE } from '../domain/ideas/model';

/**
 * Starter recipes the owner asked for, built from USDA foods with the same recipe shapes (and so the
 * same instructions) as meal ideas. They are examples to edit — never logged as eaten. Ingredients
 * without trustworthy generic data (sweet chili sauce: brands differ a lot) are placeholders with NO
 * values, so the recipe's totals say "at least" until the user swaps in their own product.
 *
 * Fixed ids and an old timestamp: on a second device the same recipes are the same records, and any
 * edit or delete the user made elsewhere is newer, so it wins when syncing.
 */

const EXAMPLE_TIME = '2026-10-30T00:00:00.000Z';

export const SAUCE_PLACEHOLDER: Food = {
  id: 'placeholder:sweet-chili-sauce', names: { en: 'Sweet chili sauce — add yours' }, kind: 'custom', group: 'sweet', prep: 'as-sold',
  basis: { per: '100g' }, portions: [], n: {}, carbsIncludeFiber: false, kcalOrigin: 'label',
  src: { type: 'user', confidence: 'low', note: 'No values yet. Brands differ a lot: scan your bottle or enter its label, then swap it into this recipe.' },
};

interface Example { key: string; name: string; blueprint: string; servings: number; scale?: number; pick: Record<string, [string, number]> }

const EXAMPLES: Example[] = [
  { key: 'protein-cream-of-rice', name: 'Protein cream of rice', blueprint: 'protein-cream-of-rice', servings: 1,
    pick: { base: ['cream-of-rice-dry', 60], protein: ['whey-protein', 30], fruit: ['banana', 100], sweet: ['honey', 10], spice: ['cinnamon', 2] } },
  { key: 'oat-pancakes', name: 'Protein oat pancakes', blueprint: 'protein-oat-pancakes', servings: 1,
    pick: { oats: ['oats-dry', 60], whites: ['egg-white-raw', 150], egg: ['egg-whole-raw', 1], banana: ['banana', 60], milk: ['milk-skim', 60], rise: ['baking-powder', 4], spice: ['cinnamon', 2], yogurt: ['greek-yogurt-nonfat', 100], fruit: ['strawberries', 100], syrup: ['maple-syrup', 15] } },
  { key: 'chicken-and-rice', name: 'Chicken and rice', blueprint: 'chicken-rice-bowl', servings: 1,
    pick: { protein: ['chicken-breast-raw', 180], rice: ['rice-white-raw', 85], veg: ['pepper-red-raw', 100], veg2: ['carrots-raw', 60], sauce: ['soy-sauce', 10], garlic: ['garlic', 3], oil: ['olive-oil', 7] } },
  { key: 'steak-and-potatoes', name: 'Steak and potatoes', blueprint: 'steak-potatoes', servings: 1,
    pick: { steak: ['beef-steak-lean-raw', 200], carb: ['potato-raw', 300], leaf: ['lettuce-romaine', 60], salad: ['tomato-raw', 120], salad2: ['cucumber-raw', 100], oil: ['olive-oil', 7], acid: ['lemon-juice', 10] } },
  { key: 'sweet-chili-chicken-noodles', name: 'Sweet chili chicken noodles', blueprint: 'sweet-chili-chicken-noodles', servings: 1,
    pick: { chicken: ['chicken-breast-raw', 170], noodles: ['rice-noodles-dry', 75], sauce: ['match:sweet chili', 40], soy: ['soy-sauce', 10], veg: ['pepper-red-raw', 100], veg2: ['carrots-raw', 60], onion: ['spring-onion', 15], garlic: ['garlic', 3], lime: ['lime-juice', 8], oil: ['olive-oil', 5] } },
  { key: 'lean-beef-soup', name: 'Lean beef soup', blueprint: 'lean-beef-soup', servings: 4, scale: 4,
    pick: { beef: ['beef-ground-95-raw', 160], potato: ['potato-raw', 180], carrot: ['carrots-raw', 80], onion: ['onion-raw', 70], celery: ['celery', 40], tomato: ['tomato-raw', 100], garlic: ['garlic', 3], broth: ['beef-broth', 450], oil: ['olive-oil', 4] } },
];

export const EXAMPLE_IDS = EXAMPLES.map((e) => `custom:example-${e.key}`);

export async function buildExamples(): Promise<Food[]> {
  const core = await coreFoods();
  const foods = new Map(core.map((f) => [f.id, f]));
  const input: IdeaInput = { meal: 'lunch', target: { kcal: 600, protein: 40 }, taste: DEFAULT_TASTE, needs: [], maxMinutes: null, foods, stock: new Map(), pantryOnly: false, recent: new Set(), seed: 0 };
  return EXAMPLES.map((ex) => {
    const bp = BLUEPRINTS.find((b) => b.id === ex.blueprint)!;
    const drafts: ItemDraft[] = bp.roles.filter((r) => ex.pick[r.key]).map((r) => {
      const [key, amount] = ex.pick[r.key]!;
      const option = r.options.find((o) => o.food === key) ?? r.options[0]!;
      const food = key.startsWith('match:') ? SAUCE_PLACEHOLDER : foods.get(`core:${key}`)!;
      return { role: r.key, roleLabel: r.label, option, food, unit: option.unit ?? 'g', amount: amount * (ex.scale ?? 1) };
    });
    const idea = assembleIdea(bp, drafts, input);
    const steps = [...idea.steps, ...(ex.scale ? [`Makes ${ex.servings} servings — keeps 3 days in the fridge and freezes well.`] : [])];
    const food = recipeFood({
      id: `custom:example-${ex.key}`, names: { en: ex.name }, kind: 'custom', group: 'other', prep: 'prepared',
      src: { type: 'user', confidence: 'high', note: 'Example recipe from CARBMAXX — change it to how you make it. Nutrients are the sum of its ingredients.' },
    }, { components: idea.items.map((i) => ({ food: i.food, qty: i.qty })), totalG: null, servings: ex.servings, steps: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), prepMinutes: bp.minutes, example: true });
    return { ...food, createdAt: EXAMPLE_TIME, updatedAt: EXAMPLE_TIME, rev: 1, deletedAt: null };
  });
}

/** Adds the starter recipes once per device; a recipe the user deleted or changed is never brought back. */
export async function seedExamples(): Promise<number> {
  if (await db().settings.get('examples-v1')) return 0;
  let added = 0;
  for (const food of await buildExamples()) {
    if (await db().foods.get(food.id)) continue;
    const r = foodSchema.safeParse(food);
    if (!r.success) { console.error('example recipe invalid', food.id, r.error.issues[0]); continue; }
    await db().foods.put(food);
    added += 1;
  }
  await db().settings.put({ key: 'examples-v1', value: { at: new Date().toISOString() } });
  return added;
}
