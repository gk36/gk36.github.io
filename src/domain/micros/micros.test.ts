import { describe, expect, it } from 'vitest';
import { averageTotals, coverageFor, topContributors } from './coverage';
import { groupIndex, referencesFor, ulAppliesToFood, type DriTable } from './dri';
import { sumNutrients } from '../nutrition/compute';

const G = [
  { sex: 'male', minAge: 14, maxAge: 18 }, { sex: 'male', minAge: 19, maxAge: 30 },
  { sex: 'female', minAge: 14, maxAge: 18 }, { sex: 'female', minAge: 19, maxAge: 30 },
] as const;
const table: DriTable = {
  source: 'fixture', retrieved: '2026-10-30', groups: [...G], notes: [],
  nutrients: {
    calcium: { unit: 'mg', kind: 'RDA', values: [1300, 1000, 1300, 1000], ul: [3000, 2500, 3000, 2500], ulScope: 'all sources', sources: [] },
    magnesium: { unit: 'mg', kind: 'RDA', values: [410, 400, 360, 310], ul: [350, 350, 350, 350], ulScope: 'supplements and pharmacological agents only', sources: [] },
    copper: { unit: 'µg', kind: 'RDA', values: [890, 900, 890, 900], ul: [8000, 10000, 8000, 10000], ulScope: 'all sources', sources: [] },
    vitA: { unit: 'µg', kind: 'RDA', values: [900, 900, 700, 700], ul: [2800, 3000, 2800, 3000], ulScope: 'preformed vitamin A (retinol) only', sources: [] },
    sodium: { unit: 'mg', kind: 'AI', values: [1500, 1500, 1500, 1500], ul: [null, null, null, null], cdrr: [2300, 2300, 2300, 2300], ulScope: 'none (replaced by CDRR)', sources: [] },
    fiber: { unit: 'g', kind: 'AI', values: [38, 38, 26, 25], ul: [null, null, null, null], ulScope: 'none', sources: [] },
  },
};

describe('reference intakes', () => {
  it('picks the life-stage group by sex and age, switching on the 19th birthday', () => {
    expect(groupIndex(table, 'male', 18)).toBe(0);
    expect(groupIndex(table, 'male', 19)).toBe(1);
    expect(referencesFor(table, 'male', 18)?.get('calcium')?.target).toBe(1300);
    expect(referencesFor(table, 'male', 19)?.get('calcium')?.target).toBe(1000);
  });

  it('converts table units to canonical units (copper µg → mg)', () => {
    expect(referencesFor(table, 'male', 18)?.get('copper')?.target).toBeCloseTo(0.89, 10);
  });

  it('only applies upper limits that cover food', () => {
    expect(ulAppliesToFood('all sources')).toBe(true);
    expect(ulAppliesToFood('supplements and pharmacological agents only')).toBe(false);
    expect(ulAppliesToFood('supplements and fortified foods only (synthetic forms)')).toBe(false);
    expect(ulAppliesToFood('preformed vitamin A (retinol) only')).toBe(true);
    const r = referencesFor(table, 'male', 18)!;
    expect(r.get('calcium')?.ul).toBe(3000);
    expect(r.get('magnesium')?.ul).toBeNull();
    expect(r.get('magnesium')?.ulNote).toMatch(/not applied to food/);
  });

  it('vitamin A targets total RAE but checks the upper limit against retinol', () => {
    const r = referencesFor(table, 'male', 18)!;
    expect(r.get('vitA')?.target).toBe(900);
    expect(r.get('vitA')?.ul).toBeNull();
    expect(r.get('retinol')?.ul).toBe(2800);
    expect(r.get('retinol')?.target).toBeNull();
  });
});

describe('coverage', () => {
  const refs = referencesFor(table, 'male', 18)!;

  it('unknown is reported as unknown, never 0 %', () => {
    const t = sumNutrients([{ kcal: 300 }, { kcal: 200 }]);
    const [mg] = coverageFor(t, refs, ['magnesium']);
    expect(mg?.status).toBe('unknown');
  });

  it('a partial total is a lower bound with coverage counts', () => {
    const t = sumNutrients([{ kcal: 300, calcium: 650 }, { kcal: 200 }]);
    const [ca] = coverageFor(t, refs, ['calcium']);
    expect(ca?.pct).toBeCloseTo(0.5, 10);
    expect(ca?.status).toBe('partial');
    expect(ca?.unknown).toBe(1);
    expect(ca?.energyShare).toBeCloseTo(0.6, 10);
  });

  it('above a food-relevant UL is flagged, not scored as better', () => {
    const t = sumNutrients([{ kcal: 500, calcium: 3200 }]);
    expect(coverageFor(t, refs, ['calcium'])[0]?.status).toBe('over-ul');
  });

  it('magnesium from food above the supplement UL is NOT flagged', () => {
    const t = sumNutrients([{ kcal: 500, magnesium: 600 }]);
    expect(coverageFor(t, refs, ['magnesium'])[0]?.status).toBe('met');
  });

  it('retinol above the UL is flagged even when total vitamin A looks merely "met"', () => {
    const t = sumNutrients([{ kcal: 300, vitA: 3000, retinol: 2980 }]);
    const [a, ret] = coverageFor(t, refs, ['vitA', 'retinol']);
    expect(a?.status).toBe('met');
    expect(ret?.status).toBe('over-ul');
  });

  it('sodium above the CDRR is flagged as over the limit', () => {
    const t = sumNutrients([{ kcal: 800, sodium: 2600 }]);
    expect(coverageFor(t, refs, ['sodium'])[0]?.status).toBe('over-limit');
  });

  it('top contributors are sorted with shares; unknown items are left out', () => {
    const c = topContributors([{ key: 'a', label: 'yogurt', value: 300 }, { key: 'b', label: 'cereal', value: undefined }, { key: 'c', label: 'milk', value: 600 }]);
    expect(c.map((x) => x.label)).toEqual(['milk', 'yogurt']);
    expect(c[0]?.share).toBeCloseTo(2 / 3, 10);
  });

  it('averages only days that have food', () => {
    const d1 = sumNutrients([{ kcal: 2000, fiber: 30 }]);
    const d2 = sumNutrients([{ kcal: 2400, fiber: 20 }]);
    expect(averageTotals([d1, d2])?.fiber.value).toBe(25);
    expect(averageTotals([])).toBeNull();
  });
});
