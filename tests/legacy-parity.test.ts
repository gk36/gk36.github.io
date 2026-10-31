/**
 * Parity: the TypeScript planner must reproduce the legacy page (index.html) exactly.
 * The legacy <script> data + math is executed in a VM next to the port, for a full grid of
 * goals × cut styles × timings × day types × combined breakfast × body profiles, plus
 * randomised picks/toggles (fast-check). Any change to either side shows up here.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computePlan, CUT_STYLES, GOALS, planMeals, TIMINGS,
  type PlanFood, type PlannerInput, type PlanTables,
} from '../src/domain/planning/template';

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const ACTIVITY');
const end = html.indexOf('function buildActivity');
if (start < 0 || end < 0) throw new Error('legacy markers not found in index.html');
const legacySrc = `${html.slice(start, end)}\n;globalThis.__legacy={state,compute,amountText,FOODS,EGG,BROTH,DEFAULT_STATE};`;
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, isNaN, parseFloat });
vm.runInContext(legacySrc, ctx);
const L = (ctx as unknown as { __legacy: {
  state: Record<string, unknown>; compute: () => Record<string, unknown>;
  amountText: (f: unknown, g: number, m: string) => { main: string };
  FOODS: Record<string, PlanFood[]>; EGG: PlanTables['egg']; BROTH: PlanTables['broth']; DEFAULT_STATE: Record<string, unknown>;
} }).__legacy;

const tables: PlanTables = {
  protein: L.FOODS.protein!, starchy_carb: L.FOODS.starchy_carb!, fast_carb: L.FOODS.fast_carb!,
  breakfast_carb: L.FOODS.breakfast_carb!, dairy_drink: L.FOODS.dairy_drink!, egg: L.EGG, broth: L.BROTH,
};

const FIELDS = [
  'lbs', 'bmr', 'tdee', 'cal', 'protein', 'fat', 'carbs', 'eggs', 'breakfastCarb', 'fastCarbTotal', 'starchyTotal',
  'starchyPre', 'starchyPost', 'fastPre', 'fastPost', 'preRiceUnits', 'preRiceCarbs', 'preHoneyTbsp',
  'preHoneyMovedFromPost', 'preCream', 'beefPre', 'beefPost', 'milkMl', 'planK', 'planP', 'planC', 'planF',
  'butter', 'infeasible', 'rest',
] as const;

function legacyRun(input: PlannerInput) {
  const s = L.state;
  Object.assign(s, JSON.parse(JSON.stringify(L.DEFAULT_STATE)), JSON.parse(JSON.stringify(input)));
  return L.compute();
}

function assertParity(input: PlannerInput) {
  const legacy = legacyRun(input);
  const port = computePlan(input, tables) as unknown as Record<string, unknown>;
  for (const k of FIELDS) {
    const a = legacy[k], b = port[k];
    if (typeof a === 'number' && typeof b === 'number') expect(b, k).toBeCloseTo(a, 9);
    else expect(b, k).toBe(a);
  }
  // Row amounts must match what the legacy page prints.
  for (const meal of planMeals(input, tables, computePlan(input, tables))) {
    for (const it of meal.items) {
      if (it.group === 'fixed' || it.foodId === 'liver' || it.macroGrams === undefined) continue;
      if (it.foodId === 'riceflour' || it.foodId === 'tbjp' || it.label === 'Dairy') continue;
      const f = (tables[it.group] as PlanFood[]).find((x) => x.id === it.foodId)!;
      const macro = it.label === 'Lean protein' ? 'p' : 'c';
      const main = L.amountText(f, it.macroGrams, macro).main;
      expect(Number.parseFloat(main), `${meal.name} ${it.label} "${main}"`).toBe(it.amount.amount);
    }
  }
}

const base: PlannerInput = {
  kg: 65.65, cm: 174, age: 21, sex: 'male', act: 'moderate', goal: 'slight_bulk', cutStyle: 'gentle',
  day: 'gym', timing: 'standard', eggs: 4, liver: false, boneBroth: false, breakfastCarbOn: true,
  dairyOn: true, combineBreakfast: false, preHoney: false, pick: {}, milkMl: 250,
};

describe('legacy planner parity — full grid', () => {
  const people = [
    { kg: 65.65, cm: 174, age: 21 }, { kg: 73, cm: 174, age: 18 }, { kg: 90, cm: 185, age: 30 },
  ];
  const goals: [PlannerInput['goal'], PlannerInput['cutStyle']][] = [
    ['cut', 'gentle'], ['cut', 'performance'], ['cut', 'aggressive'], ['recomp', 'gentle'], ['slight_bulk', 'gentle'], ['bulk', 'gentle'],
  ];
  let n = 0;
  for (const p of people) for (const [goal, cutStyle] of goals) for (const T of TIMINGS) for (const day of ['gym', 'rest'] as const) for (const combine of [false, true]) {
    if (day === 'rest' && T.key !== 'standard') continue;
    if (combine && T.key !== 'standard') continue;
    n += 1;
    it(`${p.kg}kg ${goal}/${cutStyle} ${day} ${T.key}${combine ? ' combined' : ''}`, () => {
      assertParity({ ...base, ...p, goal, cutStyle, day, timing: T.key, combineBreakfast: combine });
    });
  }
  it('covers the 126 grid scenarios', () => expect(n).toBe(126));
  it('uses every goal and cut style', () => {
    expect(GOALS.length).toBe(4);
    expect(CUT_STYLES.length).toBe(3);
  });
});

describe('legacy planner parity — randomised (fast-check)', () => {
  const ids = (g: keyof typeof L.FOODS) => L.FOODS[g]!.map((f) => f.id);
  const fastAll = ids('fast_carb');
  const fastPost = L.FOODS.fast_carb!.filter((f) => !f.preOnly).map((f) => f.id);
  const arb = fc.record({
    kg: fc.double({ min: 45, max: 130, noNaN: true }),
    cm: fc.integer({ min: 150, max: 205 }),
    age: fc.integer({ min: 14, max: 70 }),
    sex: fc.constantFrom<PlannerInput['sex']>('male', 'female'),
    act: fc.constantFrom<PlannerInput['act']>('sedentary', 'light', 'moderate', 'active'),
    goal: fc.constantFrom<PlannerInput['goal']>('cut', 'recomp', 'slight_bulk', 'bulk'),
    cutStyle: fc.constantFrom<PlannerInput['cutStyle']>('gentle', 'performance', 'aggressive'),
    day: fc.constantFrom<PlannerInput['day']>('gym', 'rest'),
    timing: fc.constantFrom<PlannerInput['timing']>('standard', 'morning', 'early', 'fasted'),
    eggs: fc.integer({ min: 2, max: 8 }),
    liver: fc.boolean(), boneBroth: fc.boolean(), breakfastCarbOn: fc.boolean(), dairyOn: fc.boolean(),
    combineBreakfast: fc.boolean(), preHoney: fc.boolean(),
    milkMl: fc.integer({ min: 50, max: 1000 }),
    pick: fc.record({
      '1:breakfast_carb': fc.constantFrom(...ids('breakfast_carb')),
      '2:protein': fc.constantFrom(...ids('protein')),
      '5:protein': fc.constantFrom(...ids('protein')),
      '2:starchy_carb': fc.constantFrom(...ids('starchy_carb')),
      '5:starchy_carb': fc.constantFrom(...ids('starchy_carb')),
      '3:fast_carb': fc.constantFrom(...fastAll),
      '4:fast_carb': fc.constantFrom(...fastPost),
      '5:dairy_drink': fc.constantFrom(...ids('dairy_drink')),
    }),
  });

  it('matches the legacy page for 400 random setups', () => {
    fc.assert(fc.property(arb, (input) => { assertParity(input as PlannerInput); }), { numRuns: 400 });
  });
});
