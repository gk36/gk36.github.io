import { describe, expect, it } from 'vitest';
import core from '../../data/foods/core.json';
import type { Food, Quantity } from '../nutrition/food';
import { estimatedYield, recipeFood } from '../kitchen/recipe';
import { entryOxalate, OXALATE, oxalateOfFood, sumOxalate } from './oxalate';

const foods = core as unknown as Food[];
const map = new Map(foods.map((f) => [f.id, f]));
const f = (key: string) => map.get(`core:${key}`)!;
const g = (amount: number): Quantity => ({ amount, unit: 'g' });

describe('oxalate per food and per day', () => {
  it('uses the cited value, through the cooked pair for raw or dry weights', () => {
    expect(oxalateOfFood(f('chicken-breast-raw'), 200, map)!.mg).toBe(0);
    const potato = oxalateOfFood(f('potato-raw'), 250, map)!;
    expect(potato.mg).toBeCloseTo((17.1 * 250) / 100, 6);
    expect(potato.level).toBe('high');
    expect(potato.fromPair).toBeUndefined(); // raw potato has its own lab value
    // Rice: Harvard gives 3.8 mg per cup of COOKED rice (158 g); dry rice gains water when cooked.
    const y = estimatedYield(f('rice-white-raw'), f('rice-white-cooked'))!;
    const rice = oxalateOfFood(f('rice-white-raw'), 85, map)!;
    expect(rice.mg).toBeCloseTo(OXALATE['rice-white-cooked']!.per100g! * 85 * y / 100, 6);
    expect(rice.fromPair).toBe(true);
    // Tomato: "2 slices" weighed with USDA's own medium slice (20 g).
    expect(oxalateOfFood(f('tomato-raw'), 100, map)!.mg).toBeCloseTo(7.75, 6);
    // Measured at zero: zero in any amount, even without a serving weight.
    expect(oxalateOfFood(f('oats-dry'), 80, map)!.mg).toBe(0);
  });

  it('keeps per-serving-only and missing values out of the total, never as zero', () => {
    const whey = oxalateOfFood(f('whey-protein'), 30, map)!;
    expect(whey.mg).toBeNull();
    expect(whey.level).toBe('low');
    expect(oxalateOfFood(f('egg-white-raw'), 100, map)).toBeNull();
    const mine: Food = { ...f('honey'), id: 'custom:my-honey', kind: 'custom', src: { type: 'label', confidence: 'high' } };
    expect(oxalateOfFood(mine, 20, map)).toBeNull();
  });

  it('counts a dish by its ingredients and reports what it could not count', () => {
    const dish = recipeFood({ id: 'idea:test', names: { en: 'Cream of rice' }, kind: 'custom', group: 'other', prep: 'prepared', src: { type: 'user', confidence: 'high' } }, {
      components: [
        { food: f('cream-of-rice-dry'), qty: g(60) }, { food: f('whey-protein'), qty: g(30) }, { food: f('banana'), qty: g(118) },
        { food: f('honey'), qty: g(10) }, { food: f('cinnamon'), qty: g(2) },
      ],
      totalG: null, servings: 2,
    });
    // Half the dish: half of every ingredient.
    const t = sumOxalate(entryOxalate(dish, { amount: 1, unit: 'portion', portionId: 'unit' }, map));
    expect(t.mg).toBeCloseTo(10.3 / 2, 6); // half a banana (10.3 mg per banana); honey is 0
    expect(t.counted).toBe(2); // banana, honey
    expect(t.levelOnly).toBe(2); // whey (per scoop), cinnamon (category only)
    expect(t.noData).toBe(1); // cream of rice: no cited value
    expect(t.energyShare).toBeGreaterThan(0);
    expect(t.energyShare).toBeLessThan(1);
  });
});
