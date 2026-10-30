import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Food, NutrientMap } from './food';
import { parseAmount, resolveQuantity } from './quantity';
import { atwaterKcal, contribution, energyCheck, sumNutrients } from './compute';
import { normalizeLabel, saltToSodiumMg } from './label';
import { fmtTotal, roundFor } from './format';

const food = (over: Partial<Food>): Food => ({
  id: 'test:food', names: { en: 'Test food' }, kind: 'custom', group: 'other', prep: 'as-sold',
  basis: { per: '100g' }, portions: [], n: {}, carbsIncludeFiber: true, kcalOrigin: 'label',
  src: { type: 'label', confidence: 'high' }, ...over,
});

const cereal = food({ n: { kcal: 380, protein: 10.5, carbs: 70, fat: 5 } });
const juice = food({ basis: { per: '100ml' }, n: { kcal: 45, protein: 0.7, carbs: 10.4, fat: 0.2 } });
const sauce = food({ n: { kcal: 160, protein: 0.5, carbs: 38, fat: 0.3 } });
const egg = food({ n: { kcal: 143, protein: 12.56, carbs: 0.72, fat: 9.51 }, portions: [{ id: 'large', label: '1 large', g: 50 }] });

describe('parseAmount', () => {
  it.each([
    ['41,5', 41.5], ['41.5', 41.5], ['255', 255], [' 7 ', 7], ['1/2', 0.5], ['1 1/2', 1.5], [',5', 0.5],
  ])('parses %s', (s, v) => expect(parseAmount(s)).toBeCloseTo(v, 10));
  it.each(['', '-3', 'abc', '1/0', '4,5,6', '1e3'])('rejects %s', (s) => expect(parseAmount(s)).toBeNull());
});

describe('resolveQuantity / contribution — exact scaling', () => {
  it('41 g of a per-100 g label food', () => {
    const c = contribution(cereal, { amount: 41, unit: 'g' });
    if ('error' in c) throw new Error(c.error);
    expect(c.n.kcal).toBeCloseTo(155.8, 10);
    expect(c.n.protein).toBeCloseTo(4.305, 10);
    expect(c.n.carbs).toBeCloseTo(28.7, 10);
  });

  it('255 mL of a per-100 mL juice', () => {
    const c = contribution(juice, { amount: 255, unit: 'ml' });
    if ('error' in c) throw new Error(c.error);
    expect(c.n.kcal).toBeCloseTo(114.75, 10);
    expect(c.n.carbs).toBeCloseTo(26.52, 10);
  });

  it('45 g of a food labelled per 30 g serving (normalised once, never multiplied twice)', () => {
    const r = normalizeLabel({ name: 'Bar', basis: 'perServing', servingLabel: '1 bar', servingG: 30, region: 'eu', energyKcal: 120, protein: 6, carbs: 15, fat: 4 });
    expect(r.errors).toEqual([]);
    expect(r.basis).toEqual({ per: '100g' });
    expect(r.n.kcal).toBeCloseTo(400, 10);
    const f = food({ basis: r.basis, n: r.n, carbsIncludeFiber: false });
    const c = contribution(f, { amount: 45, unit: 'g' });
    if ('error' in c) throw new Error(c.error);
    expect(c.n.kcal).toBeCloseTo(180, 10); // 1.5 servings
    expect(c.n.protein).toBeCloseTo(9, 10);
  });

  it('refuses mL on a per-100 g sauce with no known density', () => {
    const r = resolveQuantity(sauce, { amount: 100, unit: 'ml' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/density/);
  });

  it('converts mL on a per-100 g sauce only with a known density', () => {
    const r = resolveQuantity({ ...sauce, densityGPerMl: 1.15 }, { amount: 100, unit: 'ml' });
    expect(r.ok && r.multiplier).toBeCloseTo(1.15, 10);
  });

  it('portions: 2 large eggs = 100 g', () => {
    const c = contribution(egg, { amount: 2, unit: 'portion', portionId: 'large' });
    if ('error' in c) throw new Error(c.error);
    expect(c.grams).toBe(100);
    expect(c.n.kcal).toBeCloseTo(143, 10);
  });

  it('per-unit foods count servings; grams work only when the unit weight is known', () => {
    const bar = food({ basis: { per: 'unit', unitLabel: 'bar' }, n: { kcal: 200 } });
    const ok = resolveQuantity(bar, { amount: 2, unit: 'portion', portionId: 'unit' });
    expect(ok.ok && ok.multiplier).toBe(2);
    expect(resolveQuantity(bar, { amount: 50, unit: 'g' }).ok).toBe(false);
    const weighed = { ...bar, basis: { per: 'unit' as const, unitLabel: 'bar', unitG: 40 } };
    const r = resolveQuantity(weighed, { amount: 60, unit: 'g' });
    expect(r.ok && r.multiplier).toBeCloseTo(1.5, 10);
  });

  it('EU labels: fibre is added back into total carbohydrate when known', () => {
    const f = food({ carbsIncludeFiber: false, n: { kcal: 370, protein: 12, carbs: 60, fat: 7, fiber: 9 } });
    const c = contribution(f, { amount: 100, unit: 'g' });
    if ('error' in c) throw new Error(c.error);
    expect(c.n.carbs).toBe(69);
    expect(c.carbsExcludeUnknownFiber).toBe(false);
    const noFiber = food({ carbsIncludeFiber: false, n: { kcal: 370, protein: 12, carbs: 60, fat: 7 } });
    const c2 = contribution(noFiber, { amount: 100, unit: 'g' });
    if ('error' in c2) throw new Error(c2.error);
    expect(c2.n.carbs).toBe(60);
    expect(c2.carbsExcludeUnknownFiber).toBe(true);
  });
});

describe('sumNutrients — unknown is never zero', () => {
  it('reports a lower bound and coverage when one food lacks fibre', () => {
    const t = sumNutrients([{ kcal: 200, fiber: 3 }, { kcal: 300, fiber: 5 }, { kcal: 500 }]);
    expect(t.fiber.value).toBe(8);
    expect(t.fiber.known).toBe(2);
    expect(t.fiber.unknown).toBe(1);
    expect(t.fiber.energyShare).toBeCloseTo(0.5, 10);
    expect(fmtTotal('fiber', t.fiber)).toBe('≥ 8 g');
  });

  it('a nutrient nobody reports is "unknown", not 0', () => {
    const t = sumNutrients([{ kcal: 100 }, { kcal: 50 }]);
    expect(fmtTotal('magnesium', t.magnesium)).toBe('unknown');
  });

  const nutrientMap = fc.record(
    { kcal: fc.double({ min: 0, max: 900, noNaN: true }), fiber: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }) },
    { requiredKeys: ['kcal'] },
  ).map((r) => { const m: NutrientMap = { kcal: r.kcal }; if (r.fiber !== undefined) m.fiber = r.fiber; return m; });

  it('property: adding a food with unknown fibre never lowers known fibre and always adds one unknown', () => {
    fc.assert(fc.property(fc.array(nutrientMap, { maxLength: 12 }), fc.double({ min: 0, max: 900, noNaN: true }), (items, kcal) => {
      const before = sumNutrients(items).fiber;
      const after = sumNutrients([...items, { kcal }]).fiber;
      return after.value === before.value && after.unknown === before.unknown + 1 && after.known === before.known;
    }));
  });

  it('property: totals are order-independent', () => {
    fc.assert(fc.property(fc.array(nutrientMap, { maxLength: 12 }), (items) => {
      const a = sumNutrients(items).fiber;
      const b = sumNutrients([...items].reverse()).fiber;
      return Math.abs(a.value - b.value) < 1e-9 && a.known === b.known && a.unknown === b.unknown;
    }));
  });
});

describe('energy reconciliation — the label is never overwritten', () => {
  it('flags label 380 kcal vs 352 kcal implied by macros, keeps 380', () => {
    const r = normalizeLabel({ name: 'Cereal', basis: 'per100g', region: 'eu', energyKcal: 380, protein: 8, carbs: 70, fat: 4, fiber: 2 });
    expect(atwaterKcal(r.n, false)).toBeCloseTo(352, 10);
    expect(r.n.kcal).toBe(380);
    expect(r.warnings.join(' ')).toMatch(/380 kcal vs 352 kcal/);
  });

  it('accepts ordinary rounding differences', () => {
    const r = normalizeLabel({ name: 'Milk', basis: 'per100ml', region: 'eu', energyKcal: 64, protein: 3.3, carbs: 4.8, fat: 3.5 });
    expect(r.warnings).toEqual([]);
  });

  it('database tolerance is wider (USDA fruit uses specific factors)', () => {
    const banana = food({ n: { kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, fiber: 2.6 } });
    expect(energyCheck(banana)?.mismatch).toBe(false);
  });
});

describe('normalizeLabel', () => {
  it('salt → sodium (÷ 2.5), marked derived', () => {
    const r = normalizeLabel({ name: 'Tuna', basis: 'per100g', region: 'eu', energyKcal: 110, protein: 25, carbs: 0, fat: 1, salt: 1.2 });
    expect(r.n.sodium).toBe(480);
    expect(saltToSodiumMg(1.2)).toBe(480);
    expect(r.derived).toContain('sodium calculated from salt (salt ÷ 2.5)');
  });

  it('kJ only → kcal, marked derived', () => {
    const r = normalizeLabel({ name: 'X', basis: 'per100g', region: 'eu', energyKj: 1674, protein: 10, carbs: 60, fat: 10 });
    expect(r.n.kcal).toBeCloseTo(400.1, 1);
    expect(r.derived[0]).toMatch(/kJ/);
  });

  it('rejects impossible values', () => {
    expect(normalizeLabel({ name: 'X', basis: 'per100g', region: 'eu', energyKcal: 100, carbs: 10, sugars: 20, protein: 1, fat: 1 }).errors.join()).toMatch(/Sugars/);
    expect(normalizeLabel({ name: 'X', basis: 'per100g', region: 'eu', energyKcal: 500, carbs: 80, protein: 30, fat: 10 }).errors.join()).toMatch(/100 g/);
    expect(normalizeLabel({ name: 'X', basis: 'per100g', region: 'eu', protein: 1 }).errors.join()).toMatch(/Energy/);
  });

  it('missing macros stay unknown (quick add)', () => {
    const r = normalizeLabel({ name: 'Macaron', basis: 'perServing', servingLabel: '1 macaron', region: 'eu', energyKcal: 90 });
    expect(r.basis).toEqual({ per: 'unit', unitLabel: '1 macaron' });
    expect(r.n.protein).toBeUndefined();
    expect(r.errors).toEqual([]);
  });
});

describe('display rounding', () => {
  it('rounds only for display', () => {
    expect(roundFor('kcal', 155.8)).toBe(156);
    expect(roundFor('protein', 4.305)).toBe(4.3);
    expect(roundFor('protein', 31.6)).toBe(32);
    expect(roundFor('sodium', 480.4)).toBe(480);
    expect(roundFor('vitB12', 0.4567)).toBe(0.46);
  });
});
