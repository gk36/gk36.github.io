import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import core from '../../data/foods/core.json';
import type { Food } from '../nutrition/food';
import { contribution } from '../nutrition/compute';
import { BLUEPRINTS } from './blueprints';
import { assembleIdea, chosenText, draftsOf, generateIdeas, isAvoided, rebalance, STAPLES, type Idea, type IdeaInput } from './generate';
import { DEFAULT_TASTE, FAT_SHARE, type MealKind } from './model';
import { levelFor, oxalateFor } from './oxalate';

const coreFoods = core as unknown as Food[];
const foods = new Map(coreFoods.map((f) => [f.id, f]));
const NEEDS: IdeaInput['needs'] = [{ id: 'calcium', amount: 350, weight: 0.8 }, { id: 'vitC', amount: 40, weight: 0.7 }, { id: 'folate', amount: 130, weight: 0.6 }];
const input = (o: Partial<IdeaInput> = {}): IdeaInput => ({
  meal: 'breakfast', target: { kcal: 650, protein: 45 }, taste: { ...DEFAULT_TASTE }, needs: NEEDS, maxMinutes: null,
  foods, stock: new Map(), pantryOnly: false, recent: new Set(), seed: 1, ...o,
});

/** Every number an idea shows must equal the sum of its ingredients' own data. */
function checkHonest(idea: Idea) {
  let kcal = 0, protein = 0, fat = 0;
  for (const it of idea.items) {
    const c = contribution(it.food, it.qty);
    if ('error' in c) throw new Error(c.error);
    kcal += c.n.kcal ?? 0; protein += c.n.protein ?? 0; fat += c.n.fat ?? 0;
  }
  expect(idea.totals.kcal.value).toBeCloseTo(kcal, 6);
  expect(idea.totals.protein.value).toBeCloseTo(protein, 6);
  expect(idea.totals.fat.value).toBeCloseTo(fat, 6);
}

function checkBounds(idea: Idea) {
  for (const it of idea.items) {
    expect(it.amount).toBeGreaterThan(0);
    expect(it.amount).toBeGreaterThanOrEqual(it.option.min - 1e-9);
    expect(it.amount).toBeLessThanOrEqual(it.option.max + 1e-9);
    if (it.unit === 'piece') expect(Number.isInteger(it.amount)).toBe(true);
  }
}

describe('meal ideas', () => {
  it.each<[MealKind, number, number]>([['breakfast', 650, 45], ['lunch', 700, 50], ['dinner', 750, 55], ['snack', 300, 25]])(
    '%s %i kcal / %i g protein: three different recipes that fit the targets, honestly totalled',
    (meal, kcal, protein) => {
      const { ideas } = generateIdeas(input({ meal, target: { kcal, protein } }));
      expect(ideas).toHaveLength(3);
      expect(new Set(ideas.map((i) => i.blueprint.id)).size).toBe(3);
      for (const idea of ideas) {
        checkHonest(idea);
        checkBounds(idea);
        expect(Math.abs(idea.totals.kcal.value - kcal)).toBeLessThanOrEqual(Math.max(50, 0.08 * kcal));
        expect(idea.totals.protein.value).toBeGreaterThanOrEqual(protein - 6);
        expect(idea.totals.fat.value).toBeLessThanOrEqual((kcal * FAT_SHARE.moderate) / 9 + 2);
        if (idea.totals.satFat.unknown === 0) expect(idea.totals.satFat.value).toBeLessThanOrEqual((kcal * 0.1) / 9 + 1);
      }
    },
  );

  it('prefers sweet breakfasts when asked, savory when not', () => {
    expect(generateIdeas(input()).ideas.every((i) => i.blueprint.taste === 'sweet')).toBe(true);
    const savory = generateIdeas(input({ taste: { ...DEFAULT_TASTE, sweetBreakfast: false } })).ideas;
    expect(savory.length).toBe(3);
  });

  it('never suggests an avoided food, by word (any language) or by id', () => {
    expect(isAvoided(foods.get('core:broccoli-raw')!, ['broccoli'])).toBe(true);
    expect(isAvoided(foods.get('core:broccoli-cooked')!, ['μπρόκολο'])).toBe(true);
    expect(isAvoided(foods.get('core:banana')!, ['broccoli'])).toBe(false);
    const avoid = ['banana', 'mango', 'core:whey-protein'];
    for (const meal of ['breakfast', 'snack', 'dinner'] as const) {
      const { ideas } = generateIdeas(input({ meal, taste: { ...DEFAULT_TASTE, avoid } }));
      for (const it of ideas.flatMap((i) => i.items)) {
        expect(['core:banana', 'core:mango', 'core:whey-protein']).not.toContain(it.food.id);
      }
    }
  });

  it('only what I have: uses pantry foods (and cupboard basics), never more than there is', () => {
    const stock = new Map([
      ['core:cream-of-rice-dry', 500], ['core:greek-yogurt-nonfat', 400], ['core:strawberries', 150], ['core:honey', 300], ['core:oats-dry', 500],
      ['core:milk-skim', 1000], ['core:egg-white-raw', 300], ['core:banana', 118],
    ].map(([id, g]) => [id as string, { grams: g as number, expiresInDays: null }]));
    const { ideas } = generateIdeas(input({ stock, pantryOnly: true }));
    expect(ideas.length).toBeGreaterThan(0);
    for (const it of ideas.flatMap((i) => i.items)) {
      if (STAPLES.has(it.food.id)) { expect(it.stock).toMatch(/staple|have/); continue; }
      expect(stock.has(it.food.id)).toBe(true);
      const c = contribution(it.food, it.qty);
      if ('error' in c) throw new Error(c.error);
      expect(c.grams!).toBeLessThanOrEqual(stock.get(it.food.id)!.grams + 0.5);
    }
  });

  it('lower oxalate leaves out very high foods; off, they can appear', () => {
    expect(levelFor(1)).toBe('low');
    expect(levelFor(60)).toBe('very-high');
    expect(oxalateFor('spinach-raw', 30)!.level).toBe('very-high');
    expect(oxalateFor('chicken-breast-roasted', 150)!.mg).toBe(0);
    expect(oxalateFor('egg-white-raw', 100)).toBeNull(); // no cited value: unknown, not low
    const veryHigh = new Set(['core:sweet-potato-raw', 'core:spinach-raw', 'core:cocoa-powder', 'core:almonds', 'core:dark-chocolate']);
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      for (const seed of [1, 2, 3]) {
        const { ideas } = generateIdeas(input({ meal, seed, target: { kcal: 700, protein: 50 } }));
        for (const it of ideas.flatMap((i) => i.items)) expect(veryHigh.has(it.food.id)).toBe(false);
      }
    }
    const off = { ...DEFAULT_TASTE, lowOxalate: false };
    const used = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) for (const meal of ['lunch', 'dinner'] as const) generateIdeas(input({ meal, seed, taste: off, target: { kcal: 750, protein: 50 } })).ideas.forEach((i) => i.items.forEach((x) => used.add(x.food.id)));
    expect(used.has('core:sweet-potato-raw')).toBe(true);
  });

  it('sweet chili noodles need the user\'s own sauce — and then use exactly that product', () => {
    const dinner = input({ meal: 'dinner', target: { kcal: 750, protein: 55 } });
    expect(generateIdeas(dinner).unavailable.map((u) => u.blueprint.id)).toContain('sweet-chili-chicken-noodles');
    const sauce: Food = {
      id: 'custom:sauce', names: { en: 'Sweet chili sauce' }, kind: 'custom', group: 'sweet', prep: 'as-sold', basis: { per: '100g' }, portions: [],
      n: { kcal: 218, protein: 0.5, carbs: 52, fat: 0.4, satFat: 0.1 }, carbsIncludeFiber: false, kcalOrigin: 'label', src: { type: 'label', confidence: 'high' },
    };
    const withSauce = new Map(foods);
    withSauce.set(sauce.id, sauce);
    const bp = BLUEPRINTS.find((b) => b.id === 'sweet-chili-chicken-noodles')!;
    const r = generateIdeas({ ...dinner, foods: withSauce, blueprints: [bp] });
    expect(r.unavailable).toEqual([]);
    expect(r.ideas[0]!.items.find((i) => i.role === 'sauce')!.food.id).toBe('custom:sauce');
    checkHonest(r.ideas[0]!);
  });

  it('instructions name every ingredient with its exact amount', () => {
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      for (const seed of [1, 2, 3, 4]) {
        for (const idea of generateIdeas(input({ meal, seed, taste: { ...DEFAULT_TASTE, sweetBreakfast: seed % 2 === 0, lowOxalate: seed > 2 } })).ideas) {
          const steps = idea.steps.join(' ');
          for (const it of idea.items) expect(steps).toContain(chosenText(it.amount, it.unit, it.label, it.option.labelOne).text);
        }
      }
    }
  });

  it('every recipe can be built from its typical amounts, with real steps', () => {
    const sauce: Food = {
      id: 'custom:sauce', names: { en: 'Sweet chili sauce' }, kind: 'custom', group: 'sweet', prep: 'as-sold', basis: { per: '100g' }, portions: [],
      n: { kcal: 218, protein: 0.5, carbs: 52, fat: 0.4 }, carbsIncludeFiber: false, kcalOrigin: 'label', src: { type: 'label', confidence: 'high' },
    };
    const all = new Map(foods);
    all.set(sauce.id, sauce);
    for (const bp of BLUEPRINTS) {
      const drafts = bp.roles.map((r) => {
        const o = r.options[0]!;
        const food = o.food.startsWith('match:') ? sauce : all.get(`core:${o.food}`);
        expect(food, `${bp.id}: ${o.food}`).toBeDefined();
        return { role: r.key, roleLabel: r.label, option: o, food: food!, unit: o.unit ?? 'g', amount: o.typical || o.min };
      });
      const idea = assembleIdea(bp, drafts, input({ foods: all }));
      expect(idea.items.length).toBe(drafts.length);
      expect(idea.steps.length).toBeGreaterThanOrEqual(2);
      for (const s of idea.steps) expect(s).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it('re-balances around an amount the user typed', () => {
    const idea = generateIdeas(input()).ideas[0]!;
    const role = idea.items.find((i) => !i.role.match(/spice|sweet|rise|vanilla/) && i.unit === 'g')!.role;
    const drafts = draftsOf(idea).map((d) => (d.role === role ? { ...d, amount: d.option.max } : d));
    const next = rebalance(idea.blueprint, drafts, input(), new Set([role]));
    expect(next.items.find((i) => i.role === role)!.amount).toBe(drafts.find((d) => d.role === role)!.amount);
    checkHonest(next);
    expect(Math.abs(next.totals.kcal.value - 650)).toBeLessThanOrEqual(Math.max(50, 0.08 * 650) + 150);
  });

  it('is deterministic for a seed', () => {
    const a = generateIdeas(input({ seed: 7 })).ideas.map((i) => i.key);
    const b = generateIdeas(input({ seed: 7 })).ideas.map((i) => i.key);
    expect(a).toEqual(b);
  });

  it('property: any target, pantry and dislikes — honest totals, sensible amounts, rules kept', () => {
    const pantryIds = coreFoods.filter((f) => f.group !== 'other').map((f) => f.id);
    fc.assert(fc.property(
      fc.constantFrom<MealKind>('breakfast', 'lunch', 'dinner', 'snack'),
      fc.integer({ min: 200, max: 1300 }), fc.integer({ min: 10, max: 90 }),
      fc.subarray(pantryIds, { maxLength: 25 }), fc.boolean(), fc.subarray(['banana', 'chicken', 'oats', 'rice', 'μήλο', 'milk'], { maxLength: 3 }), fc.boolean(), fc.integer({ min: 0, max: 50 }),
      (meal, kcal, protein, stocked, pantryOnly, avoid, lowOx, seed) => {
        const stock = new Map(stocked.map((id) => [id, { grams: 400, expiresInDays: null }]));
        const taste = { ...DEFAULT_TASTE, avoid, lowOxalate: lowOx };
        const { ideas } = generateIdeas(input({ meal, target: { kcal, protein: Math.min(protein, Math.round(kcal / 10)) }, stock, pantryOnly, taste, seed }));
        for (const idea of ideas) {
          checkHonest(idea);
          checkBounds(idea);
          for (const it of idea.items) {
            expect(isAvoided(it.food, avoid)).toBe(false);
            if (pantryOnly && !STAPLES.has(it.food.id)) expect(stock.has(it.food.id)).toBe(true);
          }
        }
      },
    ), { numRuns: 60 });
  });
});
