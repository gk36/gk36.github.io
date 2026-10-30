import solver from 'javascript-lp-solver';
import type { NutrientMap, Quantity } from '../nutrition/food';
import { contribution } from '../nutrition/compute';
import { bands, MACROS, type Candidate, type Limit, type Macro, type MacroStatus, type ReplanInput, type ReplanItem, type ReplanMode, type ReplanResult } from './replan-model';

export * from './replan-model';

/**
 * "Plans change": re-balances the REST of the day with a linear program (goal programming).
 * - Food already eaten never enters the model; it only reduces what is left.
 * - Decision variables are amounts of the still-planned or offered foods, bounded by "keep" / "drop"
 *   choices, a practical serving maximum and shared stock (one pantry item or batch feeds every entry
 *   of that food).
 * - Each macro target is soft: inside a small tolerance band missing it is nearly free, beyond it every
 *   unit costs a documented weight. An impossible goal therefore yields the closest feasible plan plus
 *   an honest report of what is short or over — never a fake exact match.
 * - Protein shortfall costs far more than excess, so the solver never stuffs in protein to look good.
 * - Mode preferences are non-negative per-food costs (they choose between foods, they never push a
 *   food to its maximum for its own sake). Unknown values earn no credit and, for saturated fat,
 *   count as their worst case (all of the fat).
 * Deterministic arithmetic only.
 */

const LABEL: Record<Macro, string> = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

/** Penalty per unit beyond the band (kcal-equivalents) and inside it (tie-breakers). */
const WEIGHT: Record<Macro, { under: number; over: number; inBand: number }> = {
  kcal: { under: 1, over: 1.2, inBand: 0.02 },
  protein: { under: 14, over: 3, inBand: 0.3 },
  carbs: { under: 2.5, over: 2.5, inBand: 0.1 },
  fat: { under: 4, over: 6, inBand: 0.2 },
};


const qtyOf = (c: Candidate, amount: number): Quantity =>
  c.unit === 'portion' ? { amount, unit: 'portion', portionId: c.portionId ?? 'unit' } : { amount, unit: c.unit };

/** Nutrients for ONE unit of the candidate's amount (1 g, 1 mL or 1 portion). */
export function perUnit(c: Candidate): NutrientMap | null {
  const r = contribution(c.food, qtyOf(c, 1));
  return 'error' in r ? null : r.n;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0..1: low energy density, protein and fibre per calorie (unknown = no credit). */
export function fillScore(per: NutrientMap, gPerUnit: number | null | undefined): number {
  const kcal = per.kcal ?? 0;
  if (kcal <= 0) return 1;
  const ed = gPerUnit ? clamp01(1 - kcal / gPerUnit / 4) : 0.5;
  return 0.4 * ed + 0.3 * clamp01(((per.protein ?? 0) / kcal) * 100 / 20) + 0.3 * clamp01(((per.fiber ?? 0) / kcal) * 100 / 5);
}

/** Per 100 kcal, a food that gives 5 % of a typical daily reference gets full credit for that nutrient. */
const MICRO_REF: Partial<Record<keyof NutrientMap, number>> = {
  fiber: 1.5, potassium: 170, magnesium: 20, calcium: 50, iron: 0.5, vitC: 4.5, folate: 20, vitA: 45,
};
export function microScore(per: NutrientMap): number {
  const kcal = per.kcal ?? 0;
  if (kcal <= 0) return 0;
  const ids = Object.keys(MICRO_REF) as (keyof NutrientMap)[];
  return ids.reduce((s, id) => s + clamp01((((per[id] ?? 0) / kcal) * 100) / MICRO_REF[id]!), 0) / ids.length;
}

function modeCost(mode: ReplanMode, c: Candidate, per: NutrientMap): number {
  const kcal = per.kcal ?? 0;
  switch (mode) {
    case 'filling': return kcal * 0.5 * (1 - fillScore(per, c.gPerUnit));
    case 'micros': return kcal * 0.5 * (1 - microScore(per));
    case 'lowSatFat': return 25 * (per.satFat ?? per.fat ?? 0);
    case 'expiring': {
      const d = c.expiresInDays;
      return kcal * 0.4 * (d === null || d === undefined ? 1 : d <= 2 ? 0 : d <= 5 ? 0.5 : 1);
    }
    default: return 0;
  }
}

interface Solved { feasible: boolean; x: number[] }

function solve(input: ReplanInput, usable: { c: Candidate; per: NutrientMap }[], target: Record<Macro, number>, withMealCap: boolean, withStock: boolean): Solved {
  const band = bands(target);
  const model: {
    optimize: string; opType: 'min';
    constraints: Record<string, { equal?: number; max?: number; min?: number }>;
    variables: Record<string, Record<string, number>>;
    ints: Record<string, 1>;
  } = { optimize: 'cost', opType: 'min', constraints: {}, variables: {}, ints: {} };
  const w = (m: Macro, side: 'under' | 'over') => (m === 'protein' && side === 'under' && input.mode === 'protein' ? 40 : WEIGHT[m][side]);
  for (const m of MACROS) {
    // target = Σ food + under − over, with under/over split into an in-band part and the rest.
    model.constraints[`t_${m}`] = { equal: target[m] };
    model.constraints[`ub_${m}`] = { max: band[m].under };
    model.constraints[`ob_${m}`] = { max: band[m].over };
    model.variables[`u1_${m}`] = { [`t_${m}`]: 1, [`ub_${m}`]: 1, cost: WEIGHT[m].inBand };
    model.variables[`u2_${m}`] = { [`t_${m}`]: 1, cost: w(m, 'under') };
    model.variables[`o1_${m}`] = { [`t_${m}`]: -1, [`ob_${m}`]: 1, cost: WEIGHT[m].inBand };
    model.variables[`o2_${m}`] = { [`t_${m}`]: -1, cost: w(m, 'over') };
  }
  const closeness = input.mode === 'closest' ? 0.35 : 0.08;
  usable.forEach(({ c, per }, i) => {
    const v: Record<string, number> = { cost: modeCost(input.mode, c, per), [`cap${i}`]: 1, [`d${i}`]: 1 };
    for (const m of MACROS) v[`t_${m}`] = per[m] ?? 0;
    if (withMealCap && input.maxMealKcal && c.slotId) v[`meal_${c.slotId}`] = per.kcal ?? 0;
    if (withStock && c.stockKey && c.gPerUnit && input.stocks?.[c.stockKey] !== undefined) v[`stock_${c.stockKey}`] = c.gPerUnit;
    model.variables[`x${i}`] = v;
    model.constraints[`cap${i}`] = { min: c.min, max: Math.max(c.min, c.max) };
    // |x − current| = dp + dm, priced in kcal so grams and portions compare fairly.
    model.constraints[`d${i}`] = { equal: c.current };
    const unitCost = Math.max(0.05, per.kcal ?? 0) * closeness;
    model.variables[`dp${i}`] = { [`d${i}`]: -1, cost: unitCost };
    model.variables[`dm${i}`] = { [`d${i}`]: 1, cost: unitCost };
    if (c.integer) model.ints[`x${i}`] = 1;
  });
  if (withMealCap && input.maxMealKcal) {
    for (const slot of new Set(usable.map((u) => u.c.slotId).filter((s): s is string => !!s))) {
      model.constraints[`meal_${slot}`] = { max: input.maxMealKcal };
    }
  }
  if (withStock && input.stocks) {
    for (const [key, g] of Object.entries(input.stocks)) {
      // Amounts the user insists on are never fought: the limit stretches to cover them.
      const kept = usable.reduce((s, { c }) => s + (c.stockKey === key && c.gPerUnit ? c.min * c.gPerUnit : 0), 0);
      model.constraints[`stock_${key}`] = { max: Math.max(g, kept) };
    }
  }
  const out = solver.Solve(model as never) as Record<string, number | boolean | undefined>;
  return { feasible: !!out.feasible, x: usable.map((_, i) => Number(out[`x${i}`] ?? 0)) };
}

/** Rounds to amounts people actually weigh; never past a stock, and "all of it" stays exact. */
function roundAmounts(usable: { c: Candidate }[], raw: number[], stocks: Record<string, number> | undefined): number[] {
  const left: Record<string, number> = { ...(stocks ?? {}) };
  const tracked = (c: Candidate) => !!c.stockKey && !!c.gPerUnit && left[c.stockKey] !== undefined;
  // Kept amounts take their share of a stock first.
  for (const { c } of usable) if (tracked(c)) left[c.stockKey!] = left[c.stockKey!]! - c.min * c.gPerUnit!;
  return usable.map(({ c }, i) => {
    const stockLeft = tracked(c) ? (left[c.stockKey!]! + c.min * c.gPerUnit!) / c.gPerUnit! : Infinity;
    const hi = Math.max(c.min, c.max);
    // Kept amounts are never cut; otherwise the stock and the serving maximum both cap.
    const cap = Math.max(c.min, Math.min(hi, stockLeft));
    let v = Math.min(cap, Math.max(c.min, raw[i]!));
    const step = c.unit === 'portion' ? (c.integer ? 1 : 0.5) : v >= 50 ? 5 : 1;
    if (c.unit !== 'portion' && stockLeft <= hi && v > 0 && cap - v < Math.min(3, cap * 0.05)) {
      v = Math.round(cap * 10) / 10; // "all of it": the exact amount left, not 165 of 167 g
      if (v > cap) v = Math.floor(cap * 10) / 10;
    } else {
      v = Math.round(v / step) * step;
      if (v > cap + 1e-9) v = Math.floor(cap / step) * step;
    }
    v = Math.max(c.min, v, 0);
    if (tracked(c)) left[c.stockKey!] = left[c.stockKey!]! - (v - c.min) * c.gPerUnit!;
    return v;
  });
}

export function replan(input: ReplanInput): ReplanResult {
  const notes: string[] = [];
  const target = { ...input.remaining };
  for (const m of MACROS) {
    if (target[m] < 0) {
      notes.push(m === 'kcal'
        ? `You're ${Math.round(-target.kcal)} kcal past today's target already. The rest of the plan stays light, but nothing is cut to zero to "make up" for it — one day over is fine.`
        : `${LABEL[m]} target already reached.`);
      target[m] = 0;
    }
  }
  const usable: { c: Candidate; per: NutrientMap }[] = [];
  for (const c of input.candidates) {
    const per = perUnit(c);
    if (!per) { notes.push(`${c.food.names.en}: its amount can't be converted, so it was left as planned.`); continue; }
    const missing = MACROS.filter((m) => per[m] === undefined);
    if (missing.length) notes.push(`${c.food.names.en} has no ${missing.map((m) => LABEL[m].toLowerCase()).join('/')} data, so it counts as 0 there.`);
    if (c.stockKey && !c.gPerUnit && input.stocks?.[c.stockKey] !== undefined) notes.push(`${c.food.names.en}: this unit has no weight, so your stock can't limit it.`);
    usable.push({ c, per });
  }

  let s = solve(input, usable, target, true, true);
  if (!s.feasible && input.maxMealKcal) {
    s = solve(input, usable, target, false, true);
    if (s.feasible) notes.push(`Couldn't keep every meal under ${input.maxMealKcal} kcal with the amounts you kept.`);
  }
  if (!s.feasible) s = solve(input, usable, target, false, false);
  const feasible = s.feasible;
  if (!feasible) notes.push('No solution within these limits — your current plan is shown unchanged. Loosen a limit or add a food.');

  const amounts = feasible ? roundAmounts(usable, s.x, input.stocks) : usable.map(({ c }) => c.current);
  const totals: Record<Macro, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const stockUsed: Record<string, number> = {};
  usable.forEach(({ c }, i) => { if (c.stockKey && c.gPerUnit) stockUsed[c.stockKey] = (stockUsed[c.stockKey] ?? 0) + amounts[i]! * c.gPerUnit; });

  const items: ReplanItem[] = usable.map(({ c, per }, i) => {
    const to = amounts[i]!;
    const n = Object.fromEntries(MACROS.map((m) => [m, (per[m] ?? 0) * to])) as Record<Macro, number>;
    for (const m of MACROS) totals[m] += n[m];
    const stock = c.stockKey ? input.stocks?.[c.stockKey] : undefined;
    const stockFull = stock !== undefined && c.gPerUnit ? (stockUsed[c.stockKey!] ?? 0) >= stock - Math.max(1, c.gPerUnit * 0.5) : false;
    let limit: Limit = null;
    let reason: string | null = null;
    if (c.blocked && c.max === 0) { limit = 'blocked'; reason = c.blocked; }
    else if (c.min === c.max) { limit = 'kept'; reason = c.max === 0 ? 'left out, as you asked' : 'kept as you asked'; }
    else if (stockFull && to > 0) {
      limit = 'stock';
      reason = c.current > to ? 'only this much left' : to > c.current ? 'all you have' : 'uses all you have';
    } else if (to >= c.max - 1e-9 && to > c.current) { limit = 'max'; reason = 'more, up to a sensible serving'; }
    else if (to === c.current) reason = null;
    else if (to === 0) reason = 'dropped — the other foods fit better';
    else if (c.current === 0) reason = 'added to close the gap';
    else reason = to > c.current ? 'more, to close the gap' : 'less, to stay on target';
    return { key: c.key, from: c.current, to, unit: c.unit, n, limit, reason };
  });

  const band = bands(target);
  const gap = Object.fromEntries(MACROS.map((m) => [m, target[m] - totals[m]])) as Record<Macro, number>;
  const status = Object.fromEntries(MACROS.map((m) => [m, gap[m] > band[m].under ? 'short' : -gap[m] > band[m].over ? 'over' : 'ok'])) as Record<Macro, MacroStatus>;
  // Short/over per macro is shown next to each target; a note only adds what to DO about protein.
  if (status.protein === 'short' && target.protein > 0) {
    notes.push(`Protein lands about ${Math.round(gap.protein)} g short: there isn't enough protein-rich food available. Add a protein food, or the same food to another meal too.`);
  }
  return { feasible, items, target, totals, gap, status, band, notes };
}
