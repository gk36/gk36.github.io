import solver from 'javascript-lp-solver';
import type { Food, NutrientMap, Quantity } from '../nutrition/food';
import { contribution, sumNutrients, type Totals } from '../nutrition/compute';
import { NUTRIENTS, type NutrientId } from '../nutrition/nutrients';
import { estimatedYield } from '../kitchen/recipe';
import { fold } from '../logging/parse';
import { stem } from '../logging/match';
import { BLUEPRINTS } from './blueprints';
import { FAT_SHARE, type AmountUnit, type Blueprint, type Chosen, type ChosenMap, type Equipment, type MealKind, type Option, type Role, type TastePrefs } from './model';
import { oxalateOfFood, type OxalateEstimate } from '../micros/oxalate';

/**
 * Meal ideas from real recipes, the user's pantry and today's numbers.
 *
 * For each recipe shape (blueprint) the best foods for every role are chosen — what is in the pantry,
 * what fills today's micronutrient gaps, lower oxalate when asked, never a disliked food — and a small
 * linear program sets exact amounts: the meal's calories, protein first (high-protein), total fat
 * and saturated fat kept under their limits, each food near a natural serving. Amounts are then
 * rounded to what people weigh, and every number shown is recomputed from the foods' own data
 * (unknown stays unknown). Deterministic for a given seed.
 */

export interface Need {
  id: NutrientId;
  /** How much of it this meal should ideally bring (canonical unit). */
  amount: number;
  /** 0–1: how big today's gap is. */
  weight: number;
}

export interface StockInfo { grams: number; expiresInDays: number | null }

export interface IdeaInput {
  meal: MealKind;
  target: { kcal: number; protein: number };
  taste: TastePrefs;
  needs: readonly Need[];
  /** Only ideas that take at most this long. */
  maxMinutes: number | null;
  /** Every food the app knows, by id (core and the user's own). */
  foods: ReadonlyMap<string, Food>;
  stock: ReadonlyMap<string, StockInfo>;
  pantryOnly: boolean;
  /** Foods logged recently — a sign they are liked. */
  recent: ReadonlySet<string>;
  seed: number;
  blueprints?: readonly Blueprint[];
}

export interface IdeaItem {
  role: string;
  roleLabel: string;
  label: string;
  food: Food;
  qty: Quantity;
  amount: number;
  unit: AmountUnit;
  grams: number | null;
  /** Raw/dry foods: about how much they weigh cooked (USDA raw↔cooked estimate). */
  cookedG: number | null;
  /** "≈ 1 tbsp" when a USDA kitchen measure is close. */
  household: string | null;
  /** 'staple': not in the pantry list, but a cupboard basic (baking powder, salt…) — check you have it. */
  stock: 'have' | 'short' | 'missing' | 'staple';
  oxalate: OxalateEstimate | null;
  /** Option this item came from (for swapping within the role). */
  option: Option;
}

export interface Idea {
  key: string;
  blueprint: Blueprint;
  items: IdeaItem[];
  totals: Totals;
  target: IdeaInput['target'] & { fatMax: number; satFatMax: number };
  /** Share of each need this meal covers (known data only — a lower bound). */
  covers: { id: NutrientId; pct: number }[];
  /** Vitamins/minerals that some ingredient has no data for. */
  unknown: NutrientId[];
  oxalate: { mg: number; unknown: number; highest: IdeaItem | null };
  steps: string[];
  score: number;
  notes: string[];
}

/** Recipes that need a food the user hasn't added (their own sweet chili sauce). */
export interface Unavailable { blueprint: Blueprint; missing: string[] }

/* ------------------------------------------------------------------ helpers */

/** Kitchen staples most people have but rarely add to a pantry list: allowed in "only what I have", marked to check. */
export const STAPLES: ReadonlySet<string> = new Set(['core:baking-powder', 'core:cinnamon', 'core:vanilla-extract', 'core:salt', 'core:olive-oil']);

const KEY_MICROS: NutrientId[] = ['fiber', 'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'selenium', 'iodine', 'vitA', 'vitC', 'vitD', 'vitE', 'vitK', 'folate', 'vitB12', 'vitB6', 'thiamin', 'riboflavin', 'niacin', 'choline'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const PIECE_EXCLUDE = /cup|tbsp|tsp|\boz\b|slice|crushed|chopped|diced|sliced|cubes|mashed|packet|container|serving|yields|pieces/i;
/** The portion one counted "piece" means: a large egg, a rice cake… */
function piecePortion(food: Food): { id: string; g: number } | null {
  const pieces = food.portions.filter((p) => p.g && !PIECE_EXCLUDE.test(p.label) && /^1\s/.test(p.label));
  const pick = (/(^|:)egg-whole/.test(food.id) ? pieces.find((p) => /\blarge\b/i.test(p.label) && !/extra/i.test(p.label)) : undefined) ?? pieces.find((p) => /medium/i.test(p.label)) ?? pieces[0];
  return pick ? { id: pick.id, g: pick.g! } : null;
}

function qtyFor(food: Food, unit: AmountUnit, amount: number): Quantity | null {
  if (unit === 'g') return { amount, unit: 'g' };
  if (unit === 'ml') return { amount, unit: 'ml' };
  const p = piecePortion(food);
  return p ? { amount, unit: 'portion', portionId: p.id } : null;
}

function perUnit(food: Food, unit: AmountUnit): { n: NutrientMap; g: number | null } | null {
  const q = qtyFor(food, unit, 1);
  if (!q) return null;
  const c = contribution(food, q);
  return 'error' in c ? null : { n: c.n, g: c.grams };
}

const avoidTokens = (food: Food): string[] =>
  fold([food.names.en, food.names.el ?? '', ...(food.names.aliases ?? [])].join(' ')).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A food is avoided by its id, or when a word the user avoids names it ("broccoli", "μπρόκολο"). */
export function isAvoided(food: Food, avoid: readonly string[]): boolean {
  if (!avoid.length) return false;
  const tokens = avoidTokens(food).map(stem);
  return avoid.some((a) => {
    if (a === food.id) return true;
    const words = fold(a).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);
    return words.length > 0 && words.every((w) => tokens.includes(w));
  });
}

function resolveOption(opt: Option, foods: ReadonlyMap<string, Food>): Food | null {
  if (opt.food.startsWith('match:')) {
    const words = fold(opt.food.slice(6)).split(/\s+/).filter(Boolean);
    const mine = [...foods.values()].filter((f) => f.kind !== 'generic' && !f.recipe && !f.deletedAt)
      .filter((f) => { const n = fold(`${f.brand ?? ''} ${f.names.en} ${f.names.el ?? ''} ${(f.names.aliases ?? []).join(' ')}`); return words.every((w) => n.includes(w)); })
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return mine[0] ?? null;
  }
  return foods.get(`core:${opt.food}`) ?? null;
}

function cookedFactor(food: Food, foods: ReadonlyMap<string, Food>): { pair: Food; factor: number } | null {
  if (!food.pair || (food.prep !== 'raw' && food.prep !== 'dry')) return null;
  const pair = foods.get(food.pair);
  if (!pair) return null;
  const y = estimatedYield(food, pair);
  return y ? { pair, factor: y } : null;
}

const oxalateOf = (food: Food, grams: number | null, foods: ReadonlyMap<string, Food>): OxalateEstimate | null => oxalateOfFood(food, grams, foods);

function equipmentOk(bp: Blueprint, have: readonly Equipment[]): boolean {
  return bp.needs.some((set) => set.every((e) => have.includes(e)));
}

/**
 * Servings follow the meal's size: the recipe ranges describe a ~600 kcal meal (300 for snacks),
 * so a 900 kcal bulking dinner or a 350 kcal light lunch scale every range together.
 */
export function portionScale(meal: MealKind, kcal: number): number {
  return Math.min(1.9, Math.max(0.55, kcal / (meal === 'snack' ? 300 : 600)));
}

export function scaleOption(o: Option, f: number): Option {
  if (o.scaledBy !== undefined || Math.abs(f - 1) < 0.02) return { ...o, scaledBy: o.scaledBy ?? 1 };
  if ((o.unit ?? 'g') === 'piece') {
    const min = Math.max(1, Math.round(o.min * f));
    const max = Math.max(min, Math.round(o.max * f));
    return { ...o, min, max, typical: o.typical ? Math.min(max, Math.max(min, Math.round(o.typical * f))) : 0, scaledBy: f };
  }
  const r = (x: number) => (x >= 20 ? Math.round(x / 5) * 5 : Math.max(0.5, Math.round(x * 2) / 2));
  const min = r(o.min * f);
  const max = Math.max(min, r(o.max * f));
  return { ...o, min, max, typical: o.typical ? Math.min(max, Math.max(min, r(o.typical * f))) : 0, scaledBy: f };
}

/** An option sized for this request (already-sized options are kept as they are). */
export const sized = (o: Option, input: Pick<IdeaInput, 'meal' | 'target'>): Option => scaleOption(o, portionScale(input.meal, input.target.kcal));

/* ------------------------------------------------------------------ candidates */

interface Cand {
  role: Role;
  opt: Option;
  food: Food;
  per: NutrientMap;
  gPerUnit: number | null;
  stockUnits: number | null;
  score: number;
  /** mg oxalate per unit, when lower oxalate is preferred and a cited value exists. */
  oxPerUnit: number;
}

function scoreOption(bp: Blueprint, role: Role, raw: Option, input: IdeaInput): Cand | null | 'missing-own' {
  const opt = sized(raw, input);
  const food = resolveOption(opt, input.foods);
  if (!food) return opt.food.startsWith('match:') ? 'missing-own' : null;
  if (isAvoided(food, input.taste.avoid)) return null;
  const unit = opt.unit ?? 'g';
  const pu = perUnit(food, unit);
  if (!pu) return null;
  const st = input.stock.get(food.id);
  const stockUnits = st && pu.g ? st.grams / pu.g : null;
  const minNeed = role.optional ? 0 : opt.min;
  if (input.pantryOnly && !STAPLES.has(food.id) && (stockUnits === null || stockUnits < minNeed - 1e-9)) {
    if (!role.optional) return null;
    if (!stockUnits) return null;
  }
  let score = 0;
  if (stockUnits !== null && stockUnits >= Math.max(opt.min, 1e-9)) score += 1.5;
  else if (stockUnits) score += 0.5;
  else score -= 0.4;
  const exp = st?.expiresInDays;
  if (exp !== null && exp !== undefined) score += exp <= 3 ? 1 : exp <= 6 ? 0.4 : 0;
  const typical = opt.typical || opt.min;
  for (const n of input.needs) score += 2.5 * n.weight * Math.min(1, ((pu.n[n.id] ?? 0) * typical) / n.amount);
  if (input.recent.has(food.id)) score += 0.4;
  if ((pu.n.satFat ?? pu.n.fat ?? 0) * typical > 4) score -= 0.5;
  let oxPerUnit = 0;
  if (input.taste.lowOxalate) {
    // Left out only when even the smallest sensible serving is very high; otherwise kept small.
    const atMin = oxalateOf(food, pu.g !== null ? pu.g * Math.max(opt.min, 1e-9) : null, input.foods);
    if (atMin?.level === 'very-high') return null;
    const ox = oxalateOf(food, pu.g !== null ? pu.g * typical : null, input.foods);
    if (ox?.level === 'high') score -= 2.5;
    else if (ox?.level === 'moderate') score -= 0.6;
    const one = oxalateOf(food, pu.g, input.foods);
    oxPerUnit = one?.mg ?? 0;
  }
  score += 0.5 * hash(`${input.seed}|${bp.id}|${role.key}|${food.id}`);
  return { role, opt, food, per: pu.n, gPerUnit: pu.g, stockUnits, score, oxPerUnit };
}

/* ------------------------------------------------------------------ amounts */

interface Solved { x: number[]; feasible: boolean }

function solveAmounts(items: readonly Cand[], input: IdeaInput, fatMax: number, satFatMax: number): Solved {
  const T = input.target;
  const model: {
    optimize: string; opType: 'min';
    constraints: Record<string, { equal?: number; max?: number; min?: number }>;
    variables: Record<string, Record<string, number>>;
    ints: Record<string, 1>;
  } = { optimize: 'cost', opType: 'min', constraints: {}, variables: {}, ints: {} };
  const kBand = Math.max(25, 0.04 * T.kcal);
  model.constraints.t_k = { equal: T.kcal };
  model.constraints.ub_k = { max: kBand };
  model.constraints.ob_k = { max: kBand };
  model.variables.u1_k = { t_k: 1, ub_k: 1, cost: 0.02 };
  model.variables.u2_k = { t_k: 1, cost: 1 };
  model.variables.o1_k = { t_k: -1, ob_k: 1, cost: 0.02 };
  model.variables.o2_k = { t_k: -1, cost: 1.2 };
  // Protein: falling short costs a lot (high-protein meals); a little over is fine.
  model.constraints.t_p = { equal: T.protein };
  model.constraints.ub_p = { max: 3 };
  model.constraints.ob_p = { max: 25 };
  model.variables.u1_p = { t_p: 1, ub_p: 1, cost: 0.5 };
  model.variables.u2_p = { t_p: 1, cost: input.taste.highProtein ? 16 : 8 };
  model.variables.o1_p = { t_p: -1, ob_p: 1, cost: 0.05 };
  model.variables.o2_p = { t_p: -1, cost: 1.5 };
  // Fat and saturated fat are ceilings; unknown saturated fat counts as all of the fat.
  model.constraints.fat = { max: fatMax };
  model.constraints.sat = { max: satFatMax };
  model.variables.fo = { fat: -1, cost: 8 };
  model.variables.so = { sat: -1, cost: 15 };
  for (const n of input.needs) {
    model.constraints[`m_${n.id}`] = { max: 0 };
    model.constraints[`g_${n.id}`] = { max: n.amount };
    model.variables[`gn_${n.id}`] = { [`m_${n.id}`]: 1, [`g_${n.id}`]: 1, cost: -(20 * n.weight) / n.amount };
  }
  items.forEach((c, i) => {
    const v: Record<string, number> = {
      cost: c.oxPerUnit * 0.8, t_k: c.per.kcal ?? 0, t_p: c.per.protein ?? 0, fat: c.per.fat ?? 0, sat: c.per.satFat ?? c.per.fat ?? 0, [`cap${i}`]: 1, [`d${i}`]: 1,
    };
    for (const n of input.needs) v[`m_${n.id}`] = -(c.per[n.id] ?? 0);
    model.variables[`x${i}`] = v;
    const hi = input.pantryOnly && c.stockUnits !== null && !STAPLES.has(c.food.id) ? Math.min(c.opt.max, c.stockUnits) : c.opt.max;
    model.constraints[`cap${i}`] = { min: c.role.optional ? 0 : c.opt.min, max: Math.max(c.role.optional ? 0 : c.opt.min, hi) };
    // Close to a natural serving, priced in kcal so grams and pieces compare fairly.
    model.constraints[`d${i}`] = { equal: c.opt.typical };
    const unitCost = Math.max(0.05, c.per.kcal ?? 0) * 0.12;
    model.variables[`dp${i}`] = { [`d${i}`]: -1, cost: unitCost };
    model.variables[`dm${i}`] = { [`d${i}`]: 1, cost: unitCost };
    if ((c.opt.unit ?? 'g') === 'piece') model.ints[`x${i}`] = 1;
  });
  const out = solver.Solve(model as never) as Record<string, number | boolean | undefined>;
  return { feasible: !!out.feasible, x: items.map((_, i) => Number(out[`x${i}`] ?? 0)) };
}

/** Amounts people actually weigh; optional extras below half a serving are left out. */
function roundAmount(c: Cand, v: number, input: IdeaInput): number {
  const unit = c.opt.unit ?? 'g';
  const stockCap = input.pantryOnly && c.stockUnits !== null && !STAPLES.has(c.food.id) ? c.stockUnits : Infinity;
  const hi = Math.min(c.opt.max, stockCap);
  if (c.role.optional && v < c.opt.min * 0.6) return 0;
  let x = Math.max(c.role.optional ? c.opt.min : c.opt.min, Math.min(hi, v));
  const step = unit === 'piece' ? 1 : unit === 'ml' ? (x >= 100 ? 10 : 5) : x >= 50 ? 5 : x >= 5 ? 1 : 0.5;
  x = Math.round(x / step) * step;
  if (x > hi + 1e-9) x = Math.floor(hi / step) * step;
  return Math.max(0, x);
}

/**
 * Rounding to weighable amounts can push a meal out of its calorie band; nudge the most
 * energy-dense adjustable foods (in their own steps, within their limits) until it is back.
 */
function trimToTarget(drafts: ItemDraft[], combo: readonly Cand[], input: IdeaInput, fixed: ReadonlySet<string> = new Set()): ItemDraft[] {
  const T = input.target.kcal;
  const band = Math.max(25, 0.04 * T);
  let k = drafts.reduce((s, d, i) => s + d.amount * (combo[i]!.per.kcal ?? 0), 0);
  if (Math.abs(k - T) <= band) return drafts;
  const out = drafts.map((d) => ({ ...d }));
  const order = combo.map((_, i) => i)
    .filter((i) => (combo[i]!.opt.unit ?? 'g') !== 'piece' && !fixed.has(combo[i]!.role.key) && out[i]!.amount > 0 && !STAPLES.has(combo[i]!.food.id))
    .sort((a, b) => (combo[b]!.per.kcal ?? 0) - (combo[a]!.per.kcal ?? 0));
  for (const i of order) {
    const c = combo[i]!;
    const per = c.per.kcal ?? 0;
    if (per <= 0) continue;
    const cur = out[i]!.amount;
    const step = (c.opt.unit ?? 'g') === 'ml' ? 10 : cur >= 50 ? 5 : 1;
    const stockCap = input.pantryOnly && c.stockUnits !== null ? c.stockUnits : Infinity;
    const hi = Math.floor(Math.min(c.opt.max, stockCap) / step) * step;
    const next = Math.min(Math.max(hi, c.opt.min), Math.max(c.opt.min, cur + Math.round((T - k) / per / step) * step));
    k += (next - cur) * per;
    out[i]!.amount = next;
    if (Math.abs(k - T) <= band) break;
  }
  return out;
}

/* ------------------------------------------------------------------ assembling an idea */

function householdFor(food: Food, grams: number | null): string | null {
  if (!grams) return null;
  for (const p of food.portions) {
    if (!p.g || !/^1\s/.test(p.label) || !/tbsp|tsp|\bcup\b/i.test(p.label)) continue;
    const r = grams / p.g;
    for (const nice of [0.5, 1, 1.5, 2, 3]) {
      if (Math.abs(r - nice) <= nice * 0.12) {
        const unit = p.label.replace(/^1\s+/, '').replace(/\s*\(.*\)$/, '');
        return `≈ ${nice === 0.5 ? '½' : nice === 1.5 ? '1½' : nice} ${unit}`;
      }
    }
  }
  return null;
}

export function chosenText(amount: number, unit: AmountUnit, label: string, labelOne?: string): { qtyText: string; text: string } {
  const a = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 10) / 10);
  if (unit === 'piece') return { qtyText: a, text: `${a} ${amount === 1 ? labelOne ?? label : label}` };
  const qtyText = `${a} ${unit === 'ml' ? 'mL' : 'g'}`;
  return { qtyText, text: `${qtyText} ${label}` };
}

export interface ItemDraft { role: string; roleLabel: string; option: Option; food: Food; amount: number; unit: AmountUnit }

/** Builds (or rebuilds after an edit) an idea from its items: every number comes from the foods' own data. */
export function assembleIdea(bp: Blueprint, drafts: readonly ItemDraft[], input: IdeaInput, score = 0, key = bp.id): Idea {
  const fatMax = (input.target.kcal * FAT_SHARE[input.taste.fat]) / 9;
  const satFatMax = (input.target.kcal * input.taste.satFatPct) / 100 / 9;
  const items: IdeaItem[] = [];
  const parts: NutrientMap[] = [];
  const chosen: ChosenMap = {};
  for (const d of drafts) {
    if (d.amount <= 0) continue;
    const qty = qtyFor(d.food, d.unit, d.amount);
    if (!qty) continue;
    const c = contribution(d.food, qty);
    if ('error' in c) continue;
    parts.push(c.n);
    const cf = cookedFactor(d.food, input.foods);
    const st = input.stock.get(d.food.id);
    const stock = st && c.grams !== null ? (st.grams + 0.5 >= c.grams ? 'have' : 'short') : st ? 'have' : STAPLES.has(d.food.id) ? 'staple' : 'missing';
    const label = d.option.label;
    const tx = chosenText(d.amount, d.unit, label, d.option.labelOne);
    chosen[d.role] = { food: d.food, amount: d.amount, unit: d.unit, label, qtyText: tx.qtyText, text: tx.text } satisfies Chosen;
    items.push({
      role: d.role, roleLabel: d.roleLabel, label, food: d.food, qty, amount: d.amount, unit: d.unit, grams: c.grams,
      cookedG: cf && d.unit === 'g' && c.grams !== null && Math.abs(cf.factor - 1) > 0.1 ? Math.round((c.grams * cf.factor) / 5) * 5 : null,
      household: householdFor(d.food, c.grams), stock, oxalate: oxalateOf(d.food, c.grams, input.foods), option: d.option,
    });
  }
  const totals = sumNutrients(parts);
  const covers = input.needs.map((n) => ({ id: n.id, pct: n.amount > 0 ? totals[n.id].value / n.amount : 0 }));
  const unknown = KEY_MICROS.filter((id) => totals[id].unknown > 0);
  let oxMg = 0, oxUnknown = 0;
  let highest: IdeaItem | null = null;
  for (const it of items) {
    if (!it.oxalate || it.oxalate.mg === null) { if (!it.oxalate) oxUnknown += 1; continue; }
    oxMg += it.oxalate.mg;
    if (!highest || (highest.oxalate?.mg ?? 0) < it.oxalate.mg) highest = it;
  }
  const notes: string[] = [];
  if (bp.ahead) notes.push(bp.ahead);
  if (bp.tip) notes.push(bp.tip);
  return {
    key, blueprint: bp, items, totals, target: { ...input.target, fatMax, satFatMax }, covers, unknown,
    oxalate: { mg: oxMg, unknown: oxUnknown, highest }, steps: bp.steps(chosen), score, notes,
  };
}

/* ------------------------------------------------------------------ the generator */

function combos(roles: { role: Role; cands: Cand[] }[], limit: number): Cand[][] {
  const required = roles.filter((r) => !r.role.optional);
  const optional = roles.filter((r) => r.role.optional);
  let out: Cand[][] = [[]];
  for (const r of required) {
    const next: Cand[][] = [];
    for (const partial of out) {
      for (const c of r.cands.filter((x) => !partial.some((p) => p.food.id === x.food.id)).slice(0, 2)) next.push([...partial, c]);
    }
    out = next.sort((a, b) => b.reduce((s, c) => s + c.score, 0) - a.reduce((s, c) => s + c.score, 0)).slice(0, limit);
  }
  return out.map((base) => {
    const full = [...base];
    for (const r of optional) {
      const c = r.cands.find((x) => !full.some((p) => p.food.id === x.food.id));
      if (c) full.push(c);
    }
    return full;
  });
}

export function generateIdeas(input: IdeaInput, count = 3): { ideas: Idea[]; unavailable: Unavailable[] } {
  const fatMax = (input.target.kcal * FAT_SHARE[input.taste.fat]) / 9;
  const satFatMax = (input.target.kcal * input.taste.satFatPct) / 100 / 9;
  const all: Idea[] = [];
  const unavailable: Unavailable[] = [];
  for (const bp of input.blueprints ?? BLUEPRINTS) {
    if (!bp.meals.includes(input.meal)) continue;
    if (input.maxMinutes !== null && bp.minutes > input.maxMinutes) continue;
    if (!equipmentOk(bp, input.taste.equipment)) continue;
    const roles: { role: Role; cands: Cand[] }[] = [];
    const missingOwn: string[] = [];
    let ok = true;
    for (const role of bp.roles) {
      const cands: Cand[] = [];
      for (const opt of role.options) {
        const c = scoreOption(bp, role, opt, input);
        if (c === 'missing-own') { missingOwn.push(opt.label); continue; }
        if (c) cands.push(c);
      }
      cands.sort((a, b) => b.score - a.score);
      if (!cands.length && !role.optional) { ok = false; break; }
      roles.push({ role, cands });
    }
    if (!ok) {
      if (missingOwn.length) unavailable.push({ blueprint: bp, missing: missingOwn });
      continue;
    }
    const mine: Idea[] = [];
    for (const combo of combos(roles, 12)) {
      const s = solveAmounts(combo, input, fatMax, satFatMax);
      if (!s.feasible) continue;
      const drafts: ItemDraft[] = trimToTarget(combo.map((c, i) => ({
        role: c.role.key, roleLabel: c.role.label, option: c.opt, food: c.food, unit: c.opt.unit ?? 'g', amount: roundAmount(c, s.x[i]!, input),
      })), combo, input);
      if (drafts.some((d, i) => !combo[i]!.role.optional && d.amount <= 0)) continue;
      const idea = assembleIdea(bp, drafts, input, 0, `${bp.id}:${combo.map((c) => c.food.id).join('+')}`);
      idea.score = rank(idea, combo, input);
      mine.push(idea);
    }
    // Up to three variants of each recipe (different fruit, protein…), so the final pick can vary.
    mine.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    for (const idea of mine) {
      const sig = idea.items.filter((i) => (i.grams ?? 0) >= 40).map((i) => i.food.id).sort().join('+');
      if (seen.has(sig)) continue;
      seen.add(sig);
      all.push(idea);
      if (seen.size >= 3) break;
    }
  }
  return { ideas: pickVaried(all, count), unavailable };
}

/** Best first, then each next idea loses points for every main food it shares with those already picked. */
function pickVaried(all: readonly Idea[], count: number): Idea[] {
  const picked: Idea[] = [];
  const used = new Set<string>();
  const pool = [...all];
  while (picked.length < count && pool.length) {
    let bestI = -1, best = -Infinity;
    pool.forEach((idea, i) => {
      if (picked.some((p) => p.blueprint.id === idea.blueprint.id)) return;
      const shared = idea.items.filter((it) => !STAPLES.has(it.food.id) && used.has(it.food.id) && (it.grams ?? 0) >= 40).length;
      const s = idea.score - 22 * shared;
      if (s > best) { best = s; bestI = i; }
    });
    if (bestI < 0) break;
    const [idea] = pool.splice(bestI, 1);
    picked.push(idea!);
    for (const it of idea!.items) used.add(it.food.id);
  }
  return picked;
}

/** Ranking across recipes: fit to the targets, gaps filled, pantry, taste, time. */
function rank(idea: Idea, combo: readonly Cand[], input: IdeaInput): number {
  const T = idea.target;
  const kcal = idea.totals.kcal.value;
  const band = Math.max(25, 0.04 * T.kcal);
  const kcalOff = Math.max(0, Math.abs(kcal - T.kcal) - band);
  const proteinShort = Math.max(0, T.protein - 3 - idea.totals.protein.value) * (input.taste.highProtein ? 14 : 7);
  const fatOver = Math.max(0, idea.totals.fat.value - T.fatMax) * 8;
  const satValue = idea.totals.satFat.known ? idea.totals.satFat.value : idea.totals.fat.value;
  const satOver = Math.max(0, satValue - T.satFatMax) * 15;
  const micro = input.needs.reduce((s, n) => s + 20 * n.weight * Math.min(1, idea.totals[n.id].value / n.amount), 0);
  // Pantry counts only once there is one: an empty pantry shouldn't punish recipes with more ingredients.
  const have = idea.items.filter((i) => i.stock === 'have').length;
  const missing = idea.items.filter((i) => i.stock === 'missing').length;
  const pantry = input.stock.size >= 3 ? have * 12 - missing * 8 : 0;
  const taste = input.meal === 'breakfast' && input.taste.sweetBreakfast ? (idea.blueprint.taste === 'sweet' ? 40 : -15) : 0;
  const ox = input.taste.lowOxalate ? -Math.max(0, idea.oxalate.mg - 10) * 1.2 : 0;
  const options = combo.reduce((s, c) => s + c.score, 0) * 6;
  return micro + pantry + taste + options + ox - kcalOff - proteinShort - fatOver - satOver - idea.blueprint.minutes * 0.3;
}

/** Names of nutrients, lower-case, for sentences ("calcium, vitamin C and folate"). */
export function nutrientWords(ids: readonly NutrientId[]): string {
  const names = ids.map((id) => {
    const l = NUTRIENTS[id].label.replace(/\s*\(.*\)$/, '');
    return /^Vitamin|^B\d/.test(l) ? l : l.toLowerCase();
  });
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Foods that can fill a role of this recipe (its options the user doesn't avoid and the app knows). */
export function roleChoices(bp: Blueprint, roleKey: string, input: Pick<IdeaInput, 'foods' | 'taste'>): { option: Option; food: Food }[] {
  const role = bp.roles.find((r) => r.key === roleKey);
  if (!role) return [];
  return role.options
    .map((option) => ({ option, food: resolveOption(option, input.foods) }))
    .filter((x): x is { option: Option; food: Food } => !!x.food && !isAvoided(x.food, input.taste.avoid));
}

/**
 * Re-solves the amounts after the user changed the idea (swapped a food, removed an extra, typed an
 * amount). Roles in `fixed` keep exactly the amount the user typed; the rest re-balance around them.
 */
export function rebalance(bp: Blueprint, items: readonly ItemDraft[], input: IdeaInput, fixed: ReadonlySet<string>, key = bp.id): Idea {
  const fatMax = (input.target.kcal * FAT_SHARE[input.taste.fat]) / 9;
  const satFatMax = (input.target.kcal * input.taste.satFatPct) / 100 / 9;
  const cands: Cand[] = [];
  const kept: ItemDraft[] = [];
  for (const d of items) {
    const role = bp.roles.find((r) => r.key === d.role);
    const pu = perUnit(d.food, d.unit);
    if (!role || !pu) { kept.push(d); continue; }
    const st = input.stock.get(d.food.id);
    const lock = fixed.has(d.role);
    const opt = sized(d.option, input);
    cands.push({
      role: lock ? { ...role, optional: false } : role,
      opt: lock ? { ...opt, min: d.amount, max: d.amount, typical: d.amount } : opt,
      food: d.food, per: pu.n, gPerUnit: pu.g, stockUnits: st && pu.g ? st.grams / pu.g : null, score: 0, oxPerUnit: 0,
    });
  }
  const s = solveAmounts(cands, input, fatMax, satFatMax);
  const rounded: ItemDraft[] = cands.map((c, i) => {
    const orig = items.find((d) => d.role === c.role.key)!;
    const option = sized(orig.option, input);
    const amount = fixed.has(c.role.key) ? orig.amount : s.feasible ? roundAmount({ ...c, opt: option }, s.x[i]!, input) : orig.amount;
    return { ...orig, option, amount };
  });
  const drafts = s.feasible ? trimToTarget(rounded, cands.map((c, i) => ({ ...c, opt: rounded[i]!.option })), input, fixed) : rounded;
  return assembleIdea(bp, [...drafts, ...kept], input, 0, key);
}

/** The drafts behind an idea (what the editor changes). */
export const draftsOf = (idea: Idea): ItemDraft[] =>
  idea.items.map((i) => ({ role: i.role, roleLabel: i.roleLabel, option: i.option, food: i.food, amount: i.amount, unit: i.unit }));
