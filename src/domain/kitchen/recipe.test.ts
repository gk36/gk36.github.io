import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compositeParts, estimatedYield, recipeFood, recipeFraction, recipeTotals, remainingG, scaleComponents, type Component } from './recipe';
import { sumNutrients } from '../nutrition/compute';
import type { Food } from '../nutrition/food';
import { dayTotals } from '../diary';
import type { LogEntry } from '../../data/types';

const f = (id: string, n: Food['n'], over: Partial<Food> = {}): Food => ({
  id, names: { en: id }, kind: 'generic', group: 'other', prep: 'raw', basis: { per: '100g' }, portions: [], n,
  carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high' }, ...over,
});
const mince = f('mince', { kcal: 137, protein: 21.4, fat: 5, carbs: 0, magnesium: 21 });
const passata = f('passata', { kcal: 38, protein: 1.6, fat: 0.2, carbs: 7 }); // no magnesium data
const onion = f('onion', { kcal: 40, protein: 1.1, fat: 0.1, carbs: 9.3, magnesium: 10 });
const bolognese: Component[] = [
  { food: mince, qty: { amount: 500, unit: 'g' } },
  { food: passata, qty: { amount: 400, unit: 'g' } },
  { food: onion, qty: { amount: 150, unit: 'g' } },
];
const base = { id: 'batch:1', names: { en: 'Bolognese' }, kind: 'custom' as const, group: 'other' as const, prep: 'prepared' as const, src: { type: 'user' as const, confidence: 'high' as const } };

describe('recipe totals', () => {
  it('sums known amounts and lists nutrients some ingredient lacks', () => {
    const t = recipeTotals(bolognese);
    expect(t.n.kcal).toBeCloseTo(5 * 137 + 4 * 38 + 1.5 * 40, 10);
    expect(t.n.magnesium).toBeCloseTo(5 * 21 + 1.5 * 10, 10);
    expect(t.partial).toContain('magnesium');
    expect(t.partial).not.toContain('kcal');
    expect(t.ingredientG).toBe(1050);
  });
});

describe('batch with a measured cooked weight', () => {
  const batch = recipeFood(base, { components: bolognese, totalG: 860, servings: 4, cookedOn: '2026-10-30' });

  it('is per 100 g of the FINISHED dish', () => {
    expect(batch.basis).toEqual({ per: '100g' });
    expect(batch.n.kcal).toBeCloseTo(((5 * 137 + 4 * 38 + 1.5 * 40) * 100) / 860, 10);
    expect(batch.portions[0]?.g).toBe(215);
  });

  it('a 190 g portion is exactly 190/860 of every ingredient', () => {
    expect(recipeFraction(batch, { amount: 190, unit: 'g' })).toBeCloseTo(190 / 860, 12);
    const parts = compositeParts(batch, { amount: 190, unit: 'g' })!;
    expect(parts).toHaveLength(3);
    expect(parts[0]!.protein).toBeCloseTo(5 * 21.4 * (190 / 860), 10);
    expect(parts[1]!.magnesium).toBeUndefined();
  });

  it('day totals keep the unknown attached to the sauce, not the whole dish', () => {
    const e = { id: 'e', dayKey: '2026-10-30', slotId: 's', order: 1, foodId: batch.id, food: batch, qty: { amount: 190, unit: 'g' }, status: 'eaten', origin: 'recipe', createdAt: '', updatedAt: '', rev: 1 } as LogEntry;
    const t = dayTotals([e]);
    expect(t.eaten.magnesium.known).toBe(2);
    expect(t.eaten.magnesium.unknown).toBe(1);
    expect(t.eaten.magnesium.value).toBeCloseTo((5 * 21 + 1.5 * 10) * (190 / 860), 10);
  });

  it('property: portions that add up to the whole batch conserve every known nutrient', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 8 }), (raw) => {
      const sum = raw.reduce((s, x) => s + x, 0);
      const portions = raw.map((x) => (x / sum) * 860);
      const total = sumNutrients(portions.flatMap((g) => compositeParts(batch, { amount: g, unit: 'g' })!));
      const whole = recipeTotals(bolognese);
      return Math.abs(total.kcal.value - whole.n.kcal!) < 1e-6 && Math.abs(total.protein.value - whole.n.protein!) < 1e-6
        && Math.abs(total.magnesium.value - whole.n.magnesium!) < 1e-6;
    }));
  });

  it('remaining weight after logged portions', () => {
    expect(remainingG(860, [190, 167])).toBe(503);
    expect(remainingG(860, [600, 400])).toBe(0);
  });
});

describe('recipe without a weighed total', () => {
  it('is per serving', () => {
    const r = recipeFood(base, { components: bolognese, totalG: null, servings: 4 });
    expect(r.basis).toEqual({ per: 'unit', unitLabel: 'serving' });
    expect(r.n.kcal).toBeCloseTo((5 * 137 + 4 * 38 + 1.5 * 40) / 4, 10);
    expect(recipeFraction(r, { amount: 1, unit: 'portion', portionId: 'unit' })).toBeCloseTo(0.25, 12);
  });
});

describe('helpers', () => {
  it('scales ingredient amounts', () => {
    expect(scaleComponents(bolognese, 1.5).map((c) => c.qty.amount)).toEqual([750, 600, 225]);
  });
  it('estimates a food-specific cooked yield from a USDA raw/cooked pair', () => {
    const raw = f('chicken raw', { protein: 22.5 });
    const roasted = f('chicken roasted', { protein: 31 });
    expect(estimatedYield(raw, roasted)).toBeCloseTo(0.7258, 3);
    expect(estimatedYield(f('a', { protein: 0.5 }), f('b', { protein: 1 }))).toBeNull();
  });
});
