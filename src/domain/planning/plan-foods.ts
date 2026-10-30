import type { Food, Quantity } from '../nutrition/food';
import type { Disp, Macro, PlanAmount, PlanFood, PlanGroup, PlanTables } from './template';

/**
 * Maps the v1 planner's food choices (same ids as index.html, so saved picks keep working)
 * onto USDA-sourced core foods in the state the plan weighs them (raw meat, dry starch, …).
 */
interface MapRow { id: string; core: string; disp: Disp; portion?: RegExp; preOnly?: boolean; label?: string }

export const PLAN_FOOD_MAP: Record<PlanGroup, MapRow[]> = {
  protein: [
    { id: 'beef95', core: 'beef-ground-95-raw', disp: 'weight' },
    { id: 'beef90', core: 'beef-ground-90-raw', disp: 'weight' },
    { id: 'lamb', core: 'lamb-leg-lean-raw', disp: 'weight' },
    { id: 'bison', core: 'bison-raw', disp: 'weight' },
    { id: 'chicken', core: 'chicken-breast-raw', disp: 'weight' },
    { id: 'groundchicken', core: 'ground-chicken-breast-raw', disp: 'weight' },
    { id: 'thigh', core: 'chicken-thigh-raw', disp: 'weight' },
    { id: 'turkey', core: 'turkey-breast-raw', disp: 'weight' },
    { id: 'porktl', core: 'pork-tenderloin-raw', disp: 'weight' },
    { id: 'cod', core: 'cod-raw', disp: 'weight' },
    { id: 'shrimp', core: 'shrimp-raw', disp: 'weight' },
    { id: 'tuna', core: 'tuna-canned-water-drained', disp: 'weight' },
    { id: 'liver', core: 'beef-liver-raw', disp: 'weight' },
  ],
  starchy_carb: [
    { id: 'jasmine', core: 'rice-white-raw', disp: 'weight', label: 'White rice, long-grain (jasmine)' },
    { id: 'sushi', core: 'rice-short-raw', disp: 'weight', label: 'White rice, short-grain (sushi)' },
    { id: 'basmati', core: 'rice-white-raw', disp: 'weight', label: 'White rice, long-grain (basmati)' },
    { id: 'pasta', core: 'pasta-dry', disp: 'weight' },
    { id: 'ricenoodle', core: 'rice-noodles-dry', disp: 'weight' },
    { id: 'wpotato', core: 'potato-raw', disp: 'weight' },
    { id: 'russet', core: 'potato-russet-raw', disp: 'weight' },
    { id: 'sweet', core: 'sweet-potato-raw', disp: 'weight' },
  ],
  fast_carb: [
    { id: 'oj', core: 'orange-juice', disp: 'volume' },
    { id: 'banana', core: 'banana', disp: 'count', portion: /medium/i },
    { id: 'honeyF', core: 'honey', disp: 'tbsp', portion: /tbsp/i },
    { id: 'dates', core: 'dates-medjool', disp: 'count', portion: /date/i },
    { id: 'grapes', core: 'grapes', disp: 'weight' },
    { id: 'melon', core: 'watermelon', disp: 'weight' },
    // USDA lists sugar by the teaspoon (4.2 g), not the tablespoon — the plan counts teaspoons.
    { id: 'sugar', core: 'sugar', disp: 'tbsp', portion: /tsp/i },
    { id: 'ricecake', core: 'rice-cakes', disp: 'count', portion: /cake/i },
    { id: 'riceflour', core: 'rice-flour', disp: 'weight', preOnly: true },
    { id: 'tbjp', core: 'tbjp-sticky-toffee', disp: 'weight', preOnly: true },
  ],
  breakfast_carb: [
    { id: 'orange', core: 'orange', disp: 'count', portion: /medium|^1 orange|fruit/i },
    { id: 'oj_b', core: 'orange-juice', disp: 'volume' },
    { id: 'apple', core: 'apple', disp: 'count', portion: /medium/i },
    { id: 'berries', core: 'mixed-berries', disp: 'weight' },
    { id: 'grapes', core: 'grapes', disp: 'weight' },
    { id: 'melon', core: 'watermelon', disp: 'weight' },
    { id: 'ccwater', core: 'coconut-water', disp: 'volume' },
    { id: 'honeyB', core: 'honey', disp: 'tbsp', portion: /tbsp/i },
  ],
  dairy_drink: [
    { id: 'rawmilk', core: 'milk-whole', disp: 'volume' },
    { id: 'kefir', core: 'kefir-plain', disp: 'volume' },
    { id: 'greekyog', core: 'greek-yogurt-lowfat', disp: 'weight' },
    { id: 'cottage', core: 'cottage-cheese-2', disp: 'weight' },
  ],
};

export const SPECIAL = { egg: 'egg-whole-raw', broth: 'bone-broth', oil: 'olive-oil' } as const;

export interface PlanBinding {
  tables: PlanTables;
  /** Plan-table food id (or 'egg' | 'broth' | 'olive-oil') → core food + quantity converter. */
  resolve(planId: string, group: PlanGroup | 'fixed', amount: PlanAmount): { food: Food; qty: Quantity } | null;
  missing: string[];
}

const per = (n: number | undefined) => n ?? 0;

function macroPer100(food: Food): Macro {
  return { p: per(food.n.protein), c: per(food.n.carbs), f: per(food.n.fat), k: per(food.n.kcal) };
}

export function bindPlanFoods(core: ReadonlyMap<string, Food>): PlanBinding {
  const missing: string[] = [];
  const get = (key: string) => {
    const f = core.get(`core:${key}`);
    if (!f) missing.push(key);
    return f;
  };
  const portionOf = (f: Food, re?: RegExp) => (re ? f.portions.find((p) => re.test(p.label)) : undefined);
  const resolved = new Map<string, { food: Food; disp: Disp; portionId?: string }>();

  const toPlanFood = (row: MapRow): PlanFood | null => {
    const f = get(row.core);
    if (!f) return null;
    const m = macroPer100(f);
    let scale = 1;
    let portionId: string | undefined;
    if (row.disp === 'volume') {
      if (f.basis.per === '100ml') scale = 1;
      else if (f.densityGPerMl) scale = f.densityGPerMl;
      else { missing.push(`${row.core} (density)`); return null; }
    } else if (row.disp === 'count' || row.disp === 'tbsp') {
      const p = portionOf(f, row.portion);
      if (!p?.g) { missing.push(`${row.core} (portion ${row.portion})`); return null; }
      scale = p.g / 100;
      portionId = p.id;
    }
    resolved.set(`${row.id}`, portionId ? { food: f, disp: row.disp, portionId } : { food: f, disp: row.disp });
    const pf: PlanFood = {
      id: row.id, name: row.label ?? f.names.en, p: m.p * scale, c: m.c * scale, f: m.f * scale, k: m.k * scale, disp: row.disp,
    };
    if (row.preOnly) pf.preOnly = true;
    if (row.disp === 'count') pf.piece = f.portions.find((p) => p.id === portionId)?.label ?? 'piece';
    return pf;
  };

  const build = (g: PlanGroup) => PLAN_FOOD_MAP[g].map(toPlanFood).filter((x): x is PlanFood => !!x);
  const tables: PlanTables = {
    protein: build('protein'), starchy_carb: build('starchy_carb'), fast_carb: build('fast_carb'),
    breakfast_carb: build('breakfast_carb'), dairy_drink: build('dairy_drink'),
    egg: { p: 6.3, c: 0.36, f: 4.8, k: 72 }, broth: { p: 9, c: 0, f: 0.5, k: 40 },
  };

  const egg = get(SPECIAL.egg);
  const eggPortion = egg && portionOf(egg, /large/i);
  if (egg && eggPortion?.g) {
    const m = macroPer100(egg);
    const s = eggPortion.g / 100;
    tables.egg = { p: m.p * s, c: m.c * s, f: m.f * s, k: m.k * s };
  } else missing.push('egg-whole-raw (large portion)');
  const broth = get(SPECIAL.broth);
  if (broth) {
    const m = macroPer100(broth);
    tables.broth = { p: m.p * 2.5, c: m.c * 2.5, f: m.f * 2.5, k: m.k * 2.5 };
  }
  const oil = get(SPECIAL.oil);

  const resolve: PlanBinding['resolve'] = (planId, _group, amount) => {
    if (planId === 'egg') return egg && eggPortion ? { food: egg, qty: { amount: amount.amount, unit: 'portion', portionId: eggPortion.id } } : null;
    if (planId === 'broth') return broth ? { food: broth, qty: { amount: amount.amount, unit: 'ml' } } : null;
    if (planId === 'olive-oil') return oil ? { food: oil, qty: { amount: amount.amount, unit: 'g' } } : null;
    const r = resolved.get(planId);
    if (!r) return null;
    if (amount.unit === 'g') return { food: r.food, qty: { amount: amount.amount, unit: 'g' } };
    if (amount.unit === 'ml') return { food: r.food, qty: { amount: amount.amount, unit: 'ml' } };
    if (!r.portionId) return null;
    return { food: r.food, qty: { amount: amount.amount, unit: 'portion', portionId: r.portionId } };
  };

  return { tables, resolve, missing: Array.from(new Set(missing)) };
}
