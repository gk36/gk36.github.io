import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MACROS, replan, type Candidate, type ReplanMode } from './replan';
import type { Food } from '../nutrition/food';

const f = (id: string, n: Food['n'], over: Partial<Food> = {}): Food => ({
  id, names: { en: id }, kind: 'generic', group: 'other', prep: 'raw', basis: { per: '100g' }, portions: [], n,
  carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high' }, ...over,
});
const chicken = f('chicken (roasted)', { kcal: 165, protein: 31, carbs: 0, fat: 3.6, satFat: 1 });
const rice = f('rice (cooked)', { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, satFat: 0.1, fiber: 0.4 });
const potato = f('potato (boiled)', { kcal: 86, protein: 1.7, carbs: 20, fat: 0.1, satFat: 0, fiber: 2, potassium: 328 });
const beef90 = f('beef 90/10 (cooked)', { kcal: 217, protein: 26, carbs: 0, fat: 12, satFat: 4.7 });
const egg = f('egg', { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }, { portions: [{ id: 'large', label: '1 large', g: 50 }] });
const c = (key: string, food: Food, current: number, over: Partial<Candidate> = {}): Candidate => ({ key, food, unit: 'g', current, min: 0, max: 800, gPerUnit: 1, ...over });
const item = (r: ReturnType<typeof replan>, key: string) => r.items.find((i) => i.key === key)!;

describe('replan', () => {
  it('a bigger breakfast shrinks the rest of the day; nothing goes negative', () => {
    // Planned lunch+dinner (350 g chicken, 550 g rice) were ≈1,290 kcal; breakfast ran ≈200 kcal (50 g carbs) over.
    const r = replan({ remaining: { kcal: 1100, protein: 120, carbs: 105, fat: 14 }, mode: 'closest', candidates: [c('ch', chicken, 350), c('ri', rice, 550)] });
    expect(r.feasible).toBe(true);
    expect(r.items.every((i) => i.to >= 0)).toBe(true);
    expect(r.status.kcal).toBe('ok');
    expect(item(r, 'ri').to).toBeLessThan(450);
    expect(Math.abs(item(r, 'ch').to - 350)).toBeLessThanOrEqual(25);
  });

  it('never forces extra protein when the target is already met', () => {
    const r = replan({ remaining: { kcal: 600, protein: -20, carbs: 130, fat: 10 }, mode: 'protein', candidates: [c('ch', chicken, 150), c('ri', rice, 300)] });
    expect(item(r, 'ch').to).toBeLessThan(150);
    expect(r.notes.join(' ')).toMatch(/Protein target already reached/);
  });

  it('respects stock and reports the shortfall honestly instead of faking a match', () => {
    const r = replan({
      remaining: { kcal: 900, protein: 80, carbs: 100, fat: 20 }, mode: 'closest', stocks: { chicken: 100 },
      candidates: [c('ch', chicken, 250, { stockKey: 'chicken' }), c('ri', rice, 300)],
    });
    expect(item(r, 'ch').to).toBe(100);
    expect(item(r, 'ch').limit).toBe('stock');
    expect(item(r, 'ch').reason).toMatch(/only this much left/);
    expect(r.status.protein).toBe('short');
    expect(r.notes.join(' ')).toMatch(/Protein lands about \d+ g short/);
  });

  it('one stock feeds every entry of that food', () => {
    const r = replan({
      remaining: { kcal: 1200, protein: 20, carbs: 250, fat: 5 }, mode: 'closest', stocks: { rice: 250 },
      candidates: [c('lunch', rice, 200, { stockKey: 'rice' }), c('dinner', rice, 200, { stockKey: 'rice' }), c('po', potato, 0)],
    });
    expect(item(r, 'lunch').to + item(r, 'dinner').to).toBeLessThanOrEqual(250);
    expect(item(r, 'po').to).toBeGreaterThan(0);
  });

  it('uses exactly what is left of a batch, not a rounded-off 165 g', () => {
    const r = replan({
      remaining: { kcal: 700, protein: 60, carbs: 60, fat: 15 }, mode: 'closest', stocks: { batch: 167 },
      candidates: [c('beef', beef90, 200, { stockKey: 'batch' }), c('po', potato, 300)],
    });
    expect(item(r, 'beef').to).toBe(167);
    expect(item(r, 'beef').reason).toMatch(/only this much left/);
  });

  it('kept foods stay exactly; left-out foods go to zero; neither is "explained" as an optimisation', () => {
    const r = replan({
      remaining: { kcal: 800, protein: 60, carbs: 80, fat: 20 }, mode: 'closest',
      candidates: [c('ch', chicken, 120, { min: 120, max: 120 }), c('bf', beef90, 150, { min: 0, max: 0 }), c('ri', rice, 200)],
    });
    expect(item(r, 'ch')).toMatchObject({ to: 120, limit: 'kept', reason: 'kept as you asked' });
    expect(item(r, 'bf')).toMatchObject({ to: 0, limit: 'kept', reason: 'left out, as you asked' });
  });

  it('a dessert that blows the budget keeps meals light without negative portions or punishment', () => {
    const r = replan({ remaining: { kcal: -150, protein: 40, carbs: -20, fat: -5 }, mode: 'closest', candidates: [c('ch', chicken, 200), c('po', potato, 300)] });
    expect(r.items.every((i) => i.to >= 0)).toBe(true);
    expect(r.notes[0]).toMatch(/150 kcal past today's target.*one day over is fine/);
    expect(r.notes.join(' ')).not.toMatch(/over target/);
  });

  it('lowest saturated fat prefers chicken over 90/10 beef', () => {
    const r = replan({ remaining: { kcal: 700, protein: 50, carbs: 70, fat: 15 }, mode: 'lowSatFat', candidates: [c('ch', chicken, 0), c('bf', beef90, 0), c('ri', rice, 250)] });
    expect(item(r, 'ch').to).toBeGreaterThan(item(r, 'bf').to);
  });

  it('unknown saturated fat counts as all of the fat, never as zero', () => {
    const mystery = f('mystery mince', { kcal: 200, protein: 20, carbs: 0, fat: 13 });
    const known = f('known mince', { kcal: 200, protein: 20, carbs: 0, fat: 13, satFat: 5 });
    const r = replan({ remaining: { kcal: 400, protein: 40, carbs: 0, fat: 26 }, mode: 'lowSatFat', candidates: [c('m', mystery, 0), c('k', known, 0)] });
    expect(item(r, 'k').to).toBeGreaterThan(item(r, 'm').to);
  });

  it('more micronutrients prefers potato (fibre, potassium) over rice for the carbs', () => {
    const r = replan({ remaining: { kcal: 500, protein: 10, carbs: 100, fat: 2 }, mode: 'micros', candidates: [c('ri', rice, 0), c('po', potato, 0)] });
    expect(item(r, 'po').to).toBeGreaterThan(item(r, 'ri').to);
  });

  it('use expiring food prefers what expires tomorrow', () => {
    const r = replan({
      remaining: { kcal: 500, protein: 10, carbs: 110, fat: 2 }, mode: 'expiring',
      candidates: [c('ri', rice, 0, { expiresInDays: 30 }), c('po', potato, 0, { expiresInDays: 1 })],
    });
    expect(item(r, 'po').to).toBeGreaterThan(item(r, 'ri').to);
  });

  it('modes never push a food to its maximum for its own sake', () => {
    for (const mode of ['filling', 'micros', 'expiring', 'lowSatFat'] as const) {
      const r = replan({ remaining: { kcal: 300, protein: 5, carbs: 60, fat: 2 }, mode, candidates: [c('po', potato, 0, { expiresInDays: 0 })] });
      expect(item(r, 'po').to).toBeLessThan(450);
    }
  });

  it('whole eggs stay whole', () => {
    const r = replan({ remaining: { kcal: 300, protein: 25, carbs: 0, fat: 19 }, mode: 'closest', candidates: [c('eg', egg, 2, { unit: 'portion', portionId: 'large', integer: true, max: 6, gPerUnit: 50 })] });
    expect(Number.isInteger(r.items[0]!.to)).toBe(true);
  });

  it('a per-meal calorie cap avoids one enormous last meal, and says so', () => {
    const r = replan({
      remaining: { kcal: 1800, protein: 120, carbs: 200, fat: 40 }, mode: 'closest', maxMealKcal: 1000,
      candidates: [c('ch', chicken, 0, { slotId: 'dinner', max: 1000 }), c('ri', rice, 0, { slotId: 'dinner', max: 1500 })],
    });
    const dinner = item(r, 'ch').n.kcal + item(r, 'ri').n.kcal;
    expect(dinner).toBeLessThanOrEqual(1000 + 15);
    expect(r.status.kcal).toBe('short');
  });

  it('a meal cap that the kept amounts already break is relaxed with a note, not an error', () => {
    const r = replan({
      remaining: { kcal: 1200, protein: 60, carbs: 100, fat: 30 }, mode: 'closest', maxMealKcal: 300,
      candidates: [c('bf', beef90, 250, { slotId: 'dinner', min: 250, max: 250 }), c('ri', rice, 200, { slotId: 'dinner' })],
    });
    expect(r.feasible).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Couldn't keep every meal under 300 kcal/);
  });

  it('property: amounts stay in bounds, stocks hold after rounding, totals add up', () => {
    const foods = [chicken, rice, potato, beef90];
    const cand = fc.record({
      food: fc.integer({ min: 0, max: 3 }), current: fc.integer({ min: 0, max: 400 }), extra: fc.integer({ min: 0, max: 400 }),
      keep: fc.boolean(), shared: fc.boolean(),
    });
    fc.assert(fc.property(
      fc.array(cand, { minLength: 1, maxLength: 5 }),
      fc.record({ kcal: fc.integer({ min: -300, max: 2500 }), protein: fc.integer({ min: -30, max: 200 }), carbs: fc.integer({ min: -50, max: 350 }), fat: fc.integer({ min: -20, max: 90 }) }),
      fc.constantFrom<ReplanMode>('closest', 'protein', 'micros', 'filling', 'lowSatFat', 'expiring'),
      fc.integer({ min: 0, max: 500 }),
      (cs, remaining, mode, stock) => {
        const candidates = cs.map((x, i) => c(`c${i}`, foods[x.food]!, x.current, {
          min: x.keep ? x.current : 0, max: x.current + x.extra, ...(x.shared ? { stockKey: 'shared' } : {}),
        }));
        const r = replan({ remaining, mode, candidates, stocks: { shared: stock } });
        let used = 0;
        r.items.forEach((it, i) => {
          const cd = candidates[i]!;
          expect(it.to).toBeGreaterThanOrEqual(0);
          expect(it.to).toBeGreaterThanOrEqual(cd.min - 1e-9);
          expect(it.to).toBeLessThanOrEqual(Math.max(cd.min, cd.max) + 1e-9);
          if (cd.stockKey) used += it.to;
        });
        const kept = candidates.reduce((s, cd) => s + (cd.stockKey ? cd.min : 0), 0);
        expect(used).toBeLessThanOrEqual(Math.max(stock, kept) + 1e-6);
        for (const m of MACROS) expect(r.totals[m]).toBeCloseTo(r.items.reduce((s, it) => s + it.n[m], 0), 6);
      },
    ), { numRuns: 150 });
  });
});
