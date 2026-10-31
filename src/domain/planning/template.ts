/**
 * The CARBMAXX v1 meal-template planner, ported from the legacy index.html (main @ 1a18a8f).
 *
 * This is a deliberate line-by-line transliteration: same constants, same expression order,
 * same quantisation — so it reproduces the legacy page bit-for-bit (enforced by
 * tests/legacy-parity.test.ts, which runs the real legacy code side by side). The food table is
 * a parameter: parity tests use the legacy table; the app uses USDA-sourced core foods.
 */

export type ActivityKey = 'sedentary' | 'light' | 'moderate' | 'active';
export type GoalKey = 'cut' | 'recomp' | 'slight_bulk' | 'bulk';
export type CutStyleKey = 'gentle' | 'performance' | 'aggressive';
export type TimingKey = 'standard' | 'morning' | 'early' | 'fasted';
export type PlanGroup = 'protein' | 'starchy_carb' | 'fast_carb' | 'breakfast_carb' | 'dairy_drink';
export type Disp = 'weight' | 'volume' | 'count' | 'tbsp';

export interface PlanFood {
  id: string;
  name: string;
  p: number;
  c: number;
  f: number;
  k: number;
  disp: Disp;
  state?: string;
  cooked?: number;
  piece?: string;
  short?: string;
  preOnly?: boolean;
  note?: string;
}
export interface Macro { p: number; c: number; f: number; k: number }

export interface PlanTables {
  protein: PlanFood[];
  starchy_carb: PlanFood[];
  fast_carb: PlanFood[];
  breakfast_carb: PlanFood[];
  dairy_drink: PlanFood[];
  /** One large egg. */
  egg: Macro;
  /** 250 mL bone broth. */
  broth: Macro;
}

export interface PlannerInput {
  kg: number; cm: number; age: number; sex: 'male' | 'female';
  act: ActivityKey; goal: GoalKey; cutStyle: CutStyleKey;
  day: 'gym' | 'rest'; timing: TimingKey;
  eggs: number; liver: boolean; boneBroth: boolean;
  breakfastCarbOn: boolean; dairyOn: boolean; combineBreakfast: boolean; preHoney: boolean;
  pick: Record<string, string>;
  milkMl: number;
}

export const ACTIVITY: readonly { key: ActivityKey; label: string; mult: number }[] = [
  { key: 'sedentary', label: 'Sedentary — desk, little exercise', mult: 1.2 },
  { key: 'light', label: 'Light — 1–3 gym days / week', mult: 1.375 },
  { key: 'moderate', label: 'Moderate — 3–5 gym days / week', mult: 1.55 },
  { key: 'active', label: 'Active — 6–7 gym days / week', mult: 1.725 },
];

export interface Goal {
  key: GoalKey; label: string; sub: string; hasStyles?: boolean;
  deltaPct: number; pPerLb?: number; pPerKg?: number; fat?: number; fatPerKg?: number; fastCarb: number;
  desc: string; warn?: string; noBreakfastCarb?: boolean; carbCapPerKg?: number;
}
export type CutStyle = Omit<Goal, 'key' | 'sub'> & { key: CutStyleKey; sub: string; blurb: string };

export const GOALS: readonly Goal[] = [
  { key: 'cut', label: 'Cut', sub: 'pick style', hasStyles: true, deltaPct: -20, pPerLb: 1.1, fat: 50, fastCarb: 60,
    desc: 'Lose fat while keeping muscle. Calories ~20% below maintenance, protein pushed to the top of the range to protect lean mass, fat trimmed to the chosen fat target, fast carbs eased to ~60 g. Carbs still fuel training.' },
  { key: 'recomp', label: 'Recomp', sub: 'maint', deltaPct: 0, pPerLb: 1.0, fat: 60, fastCarb: 80,
    desc: 'Eat at maintenance to slowly add muscle and drop fat at the same time. Protein 1.0 g/lb, fat at the chosen 60 g target, ~80 g fast carbs around training, the rest of calories from carbs for performance and recovery.' },
  { key: 'slight_bulk', label: 'Slight Bulk', sub: '+10%', deltaPct: 10, pPerLb: 1.0, fat: 60, fastCarb: 80,
    desc: 'Lean gaining at +10% over maintenance for steady muscle with minimal fat spillover. Protein 1.0 g/lb, fat 60 g, ~80 g fast carbs around training, and the surplus delivered almost entirely as carbs.' },
  { key: 'bulk', label: 'Bulk', sub: '+20%', deltaPct: 20, pPerLb: 0.9, fat: 60, fastCarb: 80,
    desc: 'Mass gain at +20% over maintenance. Protein eased to 0.9 g/lb since plenty of energy spares it, fat kept at the 60 g target to leave max room for carbs, ~80 g fast carbs around training, big carb surplus driving growth.' },
];

export const CUT_STYLES: readonly CutStyle[] = [
  { key: 'gentle', label: 'Gentle Cut', sub: '−10% calories', deltaPct: -10, pPerKg: 2.1, fatPerKg: 0.7, fastCarb: 60,
    blurb: '10% below estimated maintenance · P 2.1 g/kg · F 0.7 g/kg',
    desc: 'A modest 10% calorie deficit on both gym and rest days. Protein includes every food in the plan; carbohydrates fill the remaining budget. Monitor your weight trend and training performance to assess whether the estimate fits you.' },
  { key: 'performance', label: 'Performance Cut', sub: 'balanced carbs', deltaPct: -20, pPerKg: 2.1, fatPerKg: 0.7, fastCarb: 70,
    blurb: 'P 2.1 g/kg · F 0.7 g/kg · carbs fill the rest',
    desc: 'Fat loss with enough fuel left to keep training hard. Calories sit ~20% under maintenance, protein at 2.1 g/kg holds lean mass, fat is trimmed moderately to 0.7 g/kg, and carbs take every calorie that\'s left, timed around the session. Review your weight trend, hunger, recovery and performance regularly.' },
  { key: 'aggressive', label: 'Larger Cut', sub: '−25% calories', deltaPct: -25, pPerKg: 2.4, fatPerKg: 0.7, fastCarb: 30,
    blurb: '25% below estimated maintenance',
    desc: 'A larger estimated deficit, with protein from all foods counted.',
    warn: 'A larger deficit can make training and recovery harder. Use a smaller deficit if performance or recovery deteriorates.' },
];

export interface Timing {
  key: TimingKey; label: string; meals: readonly number[]; fastSplit: number; starchSplit: number; flow: string; desc: string;
}

export const TIMINGS: readonly Timing[] = [
  { key: 'standard', label: 'Standard day', meals: [1, 2, 3, 4, 5], fastSplit: 0.5, starchSplit: 0.45,
    flow: 'Breakfast → digest → pre-meal → fast carb → GYM → fast carb → feast',
    desc: 'Five planned feedings around training. Total daily energy and protein matter more than precise meal timing. Fast carbs are a template choice, not a requirement for muscle growth.' },
  { key: 'morning', label: 'Breakfast → gym', meals: [1, 3, 4, 2, 5], fastSplit: 0.5, starchSplit: 0.5,
    flow: 'Breakfast → ~1 h digest → fast carb → GYM → fast carb → post meal → feast',
    desc: 'Breakfast before a morning session; the first meat-and-starch meal follows training. Allow enough time to digest comfortably. Daily intake matters more than a narrow recovery window.' },
  { key: 'early', label: 'Early workout', meals: [1, 2, 4, 5], fastSplit: 0, starchSplit: 0.40,
    flow: 'Quick eggs → 30–45 min → pre-meal → GYM → fast carb → feast',
    desc: 'An earlier meal schedule. Eggs are not especially fast-digesting; allow time for comfort and adjust the workout interval to your portion size.' },
  { key: 'fasted', label: 'Direct pre-workout', meals: [2, 4, 5], fastSplit: 0, starchSplit: 0.32,
    flow: 'Single pre-workout fuel meal → GYM → fast carb → big re-feed',
    desc: 'No breakfast. One condensed pre-workout meal carries the morning, then you train and re-feed. The eggs and breakfast fruit disappear and their protein and carbs move into the fuel meal and the post-workout meal — portions are recalculated to the same calorie and protein targets.' },
];

export const REST_DESC = 'Rest days keep the selected calorie target. Fast-carb portions move into whole-food meals, so a 10% cut remains a 10% cut. Recovery still needs energy.';

export interface MealRow { kind: 'eggs' | 'food' | 'dairy'; label?: string; group?: PlanGroup; target?: RowTarget; macro?: 'c' | 'p' }
export type RowTarget = 'breakfastCarb' | 'starchyPre' | 'starchyPost' | 'fastPre' | 'fastPost' | 'beefPre' | 'beefPost' | 'milk';
interface MealOverride { name?: string; badge?: string; time?: string; note?: string }
export interface Meal {
  id: number; name: string; badge: string; gym: boolean; gymOnly?: boolean; time: string; note: string;
  rest?: MealOverride; timing?: Partial<Record<TimingKey, MealOverride>>; rows: readonly MealRow[];
}

export const MEALS: readonly Meal[] = [
  { id: 1, name: 'Breakfast Baseline', badge: 'Morning', gym: false, time: 'On waking / start of day',
    note: 'Eggs contribute protein and fat. Meal timing can follow your preferences and training comfort.',
    timing: {
      morning: { badge: 'Morning · fuel', time: 'On waking · ~1–1.5 h before the pump',
        note: 'Your pre-workout fuel today — eggs + breakfast carb on waking, then about an hour to settle before the fast-carb pump.' },
      early: { name: 'Quick Breakfast', badge: 'Morning · fast', time: 'On waking · 30–45 min before your pre-workout meal',
        note: 'Light version — eggs (or a whey shake) only, so it clears before you train.' },
    },
    rows: [{ kind: 'eggs' }, { kind: 'food', label: 'Breakfast carb', group: 'breakfast_carb', target: 'breakfastCarb', macro: 'c' }] },
  { id: 2, name: 'Pre-Workout Meal', badge: 'Pre · 1.5–2 h', gym: false, time: '1.5–2 hours before the gym',
    note: 'Starch and lean protein before training; digestion depends on meal size and individual tolerance.',
    rest: { name: 'Lunch', badge: 'Midday', time: '~4–5 hours after breakfast', note: 'Starch + lean protein for recovery.' },
    timing: {
      morning: { name: 'Post-Gym Meal', badge: 'Post · 1.5–2 h', time: '1.5–2 hours after the gym', note: 'Moved behind the session — the first of two big recovery meals.' },
      early: { badge: 'Pre · 45–60 min', time: '45–60 min before the gym', note: 'Main fuelling meal on an early day — keep the portion comfortable.' },
      fasted: { name: 'Pre-Workout Fuel Meal', badge: 'Pre · 60–90 min', time: '60–90 min before the gym · first food of the day', note: 'One condensed meal standing in for breakfast and the pre-workout meal.' },
    },
    rows: [
      { kind: 'food', label: 'Starchy carb', group: 'starchy_carb', target: 'starchyPre', macro: 'c' },
      { kind: 'food', label: 'Lean protein', group: 'protein', target: 'beefPre', macro: 'p' },
    ] },
  { id: 3, name: 'Pre-Gym Fast Pump', badge: 'Fast · 30–45 min', gym: true, gymOnly: true, time: '30–45 min before the gym',
    note: 'Choose the carb you prefer. Cream of rice is a more substantial option; allow more digestion time if needed.',
    rows: [{ kind: 'food', label: 'Pre-gym carb', group: 'fast_carb', target: 'fastPre', macro: 'c' }] },
  { id: 4, name: 'Post-Gym Fast Carb', badge: 'Fast · <30 min', gym: true, gymOnly: true, time: 'within 30 min after the gym',
    note: 'Carbohydrate helps replenish glycogen. An immediate sugar serving is not required for ordinary once-daily strength training.',
    rows: [{ kind: 'food', label: 'Fast carb', group: 'fast_carb', target: 'fastPost', macro: 'c' }] },
  { id: 5, name: 'Post-Workout Feast', badge: 'Post · 1.5–2 h', gym: false, time: '1.5–2 hours after the gym',
    note: 'Big whole-food meal to finish glycogen loading and support overnight recovery.',
    rest: { name: 'Dinner', badge: 'Evening', time: 'Evening · finish 2–3 h before bed', note: 'Same big whole-food meal.' },
    timing: {
      morning: { name: 'Afternoon Feast', badge: 'Later · PM', time: '3–4 hours after the post-gym meal', note: 'Second big whole-food meal.' },
      fasted: { name: 'Post-Workout Re-feed', badge: 'Post · 1.5–2 h', note: 'The biggest meal of the day — it absorbs the skipped breakfast.' },
    },
    rows: [
      { kind: 'food', label: 'Starchy carb', group: 'starchy_carb', target: 'starchyPost', macro: 'c' },
      { kind: 'food', label: 'Lean protein', group: 'protein', target: 'beefPost', macro: 'p' },
      { kind: 'dairy', label: 'Dairy', group: 'dairy_drink', target: 'milk', macro: 'p' },
    ] },
];

export const LIVER_G = 40;
const LIVER_ID = 'liver';
const HONEY_ID = 'honeyF';

/* ---------- helpers (same semantics as the legacy globals, but state/table are explicit) ---------- */
export const r0 = (n: number) => Math.round(n);
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r5 = (n: number) => Math.round(n / 5) * 5;

const isRest = (s: PlannerInput) => s.day === 'rest';
export function timingOf(s: PlannerInput): Timing {
  return isRest(s) || s.combineBreakfast ? TIMINGS[0]! : (TIMINGS.find((t) => t.key === s.timing) ?? TIMINGS[0]!);
}
const cutStyleOf = (s: PlannerInput) => CUT_STYLES.find((c) => c.key === s.cutStyle) ?? CUT_STYLES[0]!;

export type GoalParams = Goal & { styleKey?: CutStyleKey; blurb?: string };
export function goalParams(s: PlannerInput): GoalParams {
  const g = GOALS.find((x) => x.key === s.goal) ?? GOALS[0]!;
  if (!g.hasStyles) return g;
  const st = cutStyleOf(s);
  return Object.assign({}, g, st, { key: g.key, styleKey: st.key, label: st.label, sub: st.sub });
}
export function mealMeta(s: PlannerInput, m: Meal): Meal {
  if (isRest(s)) return m.rest ? Object.assign({}, m, m.rest, { gym: false }) : m;
  const t = m.timing?.[timingOf(s).key];
  return t ? Object.assign({}, m, t) : m;
}
export function visibleMeals(s: PlannerInput): Meal[] {
  if (isRest(s)) return MEALS.filter((m) => !m.gymOnly);
  return timingOf(s).meals.map((id) => MEALS.find((m) => m.id === id)!);
}
const breakfastLive = (s: PlannerInput) => visibleMeals(s).some((m) => m.id === 1);
const eggsActive = (s: PlannerInput) => (breakfastLive(s) ? s.eggs : 0);
const liverActive = (s: PlannerInput) => breakfastLive(s) && s.liver;
export const bfCarbActive = (s: PlannerInput) => breakfastLive(s) && s.breakfastCarbOn && !goalParams(s).noBreakfastCarb;

export function foodById(t: PlanTables, group: PlanGroup, id: string | undefined): PlanFood {
  return t[group].find((f) => f.id === id) ?? t[group][0]!;
}
export function availableFoods(t: PlanTables, mealId: number, group: PlanGroup): PlanFood[] {
  return t[group].filter((f) => !f.preOnly || mealId === 3);
}
export function pickFood(s: PlannerInput, t: PlanTables, mealId: number, group: PlanGroup): PlanFood {
  const av = availableFoods(t, mealId, group);
  return av.find((f) => f.id === s.pick[`${mealId}:${group}`]) ?? av[0]!;
}
export const isCream = (f: PlanFood) => f.id === 'riceflour' || f.id === 'tbjp';

// Quantize once, using the same units displayed in the food rows.
export function foodUnits(f: PlanFood, target: number, macro: 'c' | 'p'): number {
  const q = Math.max(0, target) / f[macro];
  return f.disp === 'weight' || f.disp === 'volume' ? r0(q * 100) / 100 : r1(q);
}

export interface PlanResult {
  g: GoalParams; a: (typeof ACTIVITY)[number]; T: Timing; lbs: number; bmr: number; tdee: number; cal: number;
  protein: number; fat: number; carbs: number; eggs: number; deficitPct: number;
  breakfastCarb: number; fastCarbTotal: number; starchyTotal: number; starchyPre: number; starchyPost: number;
  fastPre: number; fastPost: number; preRiceUnits: number; preRiceCarbs: number; preHoneyTbsp: number;
  preHoneyMovedFromPost: number; preCream: boolean; beefPre: number; beefPost: number; milkMl: number;
  planK: number; planP: number; planC: number; planF: number; butter: number; infeasible: boolean; rest: boolean;
}

export function computePlan(s: PlannerInput, t: PlanTables): PlanResult {
  const EGG = t.egg, BROTH = t.broth, HONEY = foodById(t, 'fast_carb', HONEY_ID);
  const g = goalParams(s), T = timingOf(s), a = ACTIVITY.find((x) => x.key === s.act) ?? ACTIVITY[2]!, rest = isRest(s);
  const { kg, cm, age, sex } = s, lbs = kg * 2.20462;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161), tdee = bmr * a.mult;
  const cal = tdee * (1 + g.deltaPct / 100), protein = r0(g.pPerKg ? kg * g.pPerKg : lbs * g.pPerLb!), fat = r0(g.fatPerKg ? kg * g.fatPerKg : g.fat!);
  const eggs = eggsActive(s), milkMl = s.dairyOn ? s.milkMl : 0;
  const preP = pickFood(s, t, 2, 'protein'), postP = pickFood(s, t, 5, 'protein'), preS = pickFood(s, t, 2, 'starchy_carb'), postS = pickFood(s, t, 5, 'starchy_carb');
  const bf = pickFood(s, t, 1, 'breakfast_carb'), fp = pickFood(s, t, 3, 'fast_carb'), fq = pickFood(s, t, 4, 'fast_carb');
  const carbBudget = Math.max(0, (cal - protein * 4 - fat * 9) / 4);
  let breakfastCarb = bfCarbActive(s) ? Math.min(30, carbBudget * 0.06) : 0;
  let fastCarbTotal = rest ? 0 : Math.min(g.fastCarb, Math.max(0, carbBudget - breakfastCarb));
  let fastPre = fastCarbTotal * T.fastSplit, fastPost = fastCarbTotal - fastPre;
  const preCream = !rest && T.fastSplit > 0 && isCream(fp);
  const preHoneyTbsp = preCream && s.preHoney && fastPre > 0 ? 1 : 0;
  const honeyCarbs = preHoneyTbsp * HONEY.c;
  const preHoneyMovedFromPost = Math.min(fastPost, honeyCarbs);
  const preRiceUnits = foodUnits(fp, fastPre, 'c');
  const total = (items: [Macro, number][]) => items.reduce((out, [f, q]) => {
    for (const k of ['p', 'c', 'f', 'k'] as const) out[k] += (f[k] || 0) * q;
    return out;
  }, { p: 0, c: 0, f: 0, k: 0 });
  const fixed: [Macro, number][] = [
    [EGG, eggs], [foodById(t, 'protein', LIVER_ID), liverActive(s) ? LIVER_G / 100 : 0], [BROTH, breakfastLive(s) && s.boneBroth ? 1 : 0], [pickFood(s, t, 5, 'dairy_drink'), milkMl / 100],
    [bf, foodUnits(bf, breakfastCarb, 'c')], [fp, preRiceUnits], [fq, foodUnits(fq, fastPost - preHoneyMovedFromPost, 'c')], [HONEY, preHoneyTbsp],
  ];
  const base = total(fixed);
  breakfastCarb = fixed[4]![1] * bf.c; fastPre = fixed[5]![1] * fp.c + preHoneyTbsp * HONEY.c; fastPost = fixed[6]![1] * fq.c; fastCarbTotal = fastPre + fastPost;
  // Solve the protein allocation and remaining starch energy together, counting all foods.
  let meat = Math.max(0, protein - base.p), starch = 0, oil = 0;
  const meatK = (preP.k / preP.p + postP.k / postP.p) / 2, meatF = (preP.f / preP.p + postP.f / postP.p) / 2;
  const starchP = T.starchSplit * preS.p / preS.k + (1 - T.starchSplit) * postS.p / postS.k;
  const starchF = T.starchSplit * preS.f / preS.k + (1 - T.starchSplit) * postS.f / postS.k;
  for (let i = 0; i < 200; i++) {
    oil = Math.max(0, fat - base.f - meat * meatF - starch * starchF);
    const nextStarch = Math.max(0, cal - base.k - meat * meatK - oil * 8.84);
    starch = (starch + nextStarch) / 2;
    meat = (meat + Math.max(0, protein - base.p - starch * starchP)) / 2;
  }
  const qPre = foodUnits(preP, meat / 2, 'p'), qPost = foodUnits(postP, meat / 2, 'p');
  const sPre = foodUnits(preS, starch * T.starchSplit * preS.c / preS.k, 'c'), sPost = foodUnits(postS, starch * (1 - T.starchSplit) * postS.c / postS.k, 'c');
  const plan = total([...fixed, [preP, qPre], [postP, qPost], [preS, sPre], [postS, sPost]]);
  const butter = r1(Math.max(0, fat - plan.f)); // grams of olive oil, not butter
  plan.f += butter; plan.k += butter * 8.84;
  const starchyPre = sPre * preS.c, starchyPost = sPost * postS.c, starchyTotal = starchyPre + starchyPost;
  return {
    g, a, T, lbs, bmr, tdee, cal, protein, fat, carbs: r0(plan.c), eggs, deficitPct: g.deltaPct,
    breakfastCarb, fastCarbTotal, starchyTotal, starchyPre, starchyPost, fastPre, fastPost,
    preRiceUnits, preRiceCarbs: fixed[5]![1] * fp.c, preHoneyTbsp, preHoneyMovedFromPost, preCream,
    beefPre: qPre * preP.p, beefPost: qPost * postP.p, milkMl, planK: plan.k, planP: plan.p, planC: plan.c, planF: plan.f, butter,
    infeasible: plan.k > cal + 15 || base.p > protein + 2, rest,
  };
}

/* ---------- amounts per row (port of amountText + the row rules in recompute) ---------- */

export type PlanAmount = { unit: 'g' | 'ml' | 'count' | 'tbsp'; amount: number };

/** Natural amount of `food` supplying `grams` of `macro`, exactly as the legacy rows display it. */
export function amountFor(food: PlanFood, grams: number, macro: 'c' | 'p'): PlanAmount | null {
  const per = food[macro];
  if (!per || grams <= 0) return null;
  const q = grams / per;
  if (food.disp === 'weight') return { unit: 'g', amount: r0(q * 100) };
  if (food.disp === 'volume') return { unit: 'ml', amount: r0(q * 100) };
  const n = r1(q);
  if (food.disp === 'count') return n ? { unit: 'count', amount: n } : null;
  return { unit: 'tbsp', amount: n };
}

export interface PlanItem {
  mealId: number;
  /** Planned food id in the plan table, or the special ids 'egg' | 'broth' | 'olive-oil'. */
  foodId: string;
  group: PlanGroup | 'fixed';
  label: string;
  amount: PlanAmount;
  macroGrams?: number;
}

export interface PlanMeal { id: number; name: string; badge: string; time: string; note: string; gym: boolean; items: PlanItem[] }

/**
 * The day as concrete portions, meal by meal — what the legacy page shows in its meal cards.
 * Olive oil (legacy: "across all meals") is split evenly over the starch-and-protein meals.
 */
export function planMeals(s: PlannerInput, t: PlanTables, d: PlanResult): PlanMeal[] {
  const targets: Record<RowTarget, number> = {
    breakfastCarb: d.breakfastCarb, starchyPre: d.starchyPre, starchyPost: d.starchyPost,
    fastPre: d.fastPre, fastPost: d.fastPost, beefPre: d.beefPre, beefPost: d.beefPost, milk: d.milkMl,
  };
  const meals: PlanMeal[] = visibleMeals(s).map((mm) => {
    const m = mealMeta(s, mm);
    const items: PlanItem[] = [];
    for (const row of m.rows) {
      if (row.kind === 'eggs') {
        if (d.eggs > 0) items.push({ mealId: m.id, foodId: 'egg', group: 'fixed', label: 'Whole eggs', amount: { unit: 'count', amount: d.eggs } });
        if (liverActive(s)) items.push({ mealId: m.id, foodId: LIVER_ID, group: 'protein', label: 'Beef liver', amount: { unit: 'g', amount: LIVER_G } });
        if (breakfastLive(s) && s.boneBroth) items.push({ mealId: m.id, foodId: 'broth', group: 'fixed', label: 'Bone broth', amount: { unit: 'ml', amount: 250 } });
        continue;
      }
      const group = row.group!;
      if (row.kind === 'dairy') {
        if (!s.dairyOn) continue;
        const f = foodById(t, group, s.pick[`${m.id}:${group}`]);
        items.push({ mealId: m.id, foodId: f.id, group, label: row.label!, amount: { unit: f.disp === 'weight' ? 'g' : 'ml', amount: d.milkMl } });
        continue;
      }
      if (row.target === 'breakfastCarb' && !bfCarbActive(s)) continue;
      const f = pickFood(s, t, m.id, group);
      if (row.target === 'fastPre' && isCream(f)) {
        const grams = r0(d.preRiceUnits * 100);
        if (grams > 0) items.push({ mealId: m.id, foodId: f.id, group, label: row.label!, amount: { unit: 'g', amount: grams }, macroGrams: d.preRiceCarbs });
        if (d.preHoneyTbsp) items.push({ mealId: m.id, foodId: HONEY_ID, group: 'fast_carb', label: 'Honey', amount: { unit: 'tbsp', amount: d.preHoneyTbsp } });
        continue;
      }
      const target = targets[row.target!];
      const amt = amountFor(f, target, row.macro!);
      if (amt) items.push({ mealId: m.id, foodId: f.id, group, label: row.label!, amount: amt, macroGrams: target });
    }
    return { id: m.id, name: m.name, badge: m.badge, time: m.time, note: m.note, gym: m.gym, items };
  });

  // Olive oil: split over the meals that carry starch + protein (2 and 5).
  if (d.butter > 0) {
    const hosts = meals.filter((m) => m.id === 2 || m.id === 5);
    const share = hosts.length ? r1(d.butter / hosts.length) : d.butter;
    hosts.forEach((m, i) => {
      const amount = i === hosts.length - 1 ? r1(d.butter - share * (hosts.length - 1)) : share;
      if (amount > 0) m.items.push({ mealId: m.id, foodId: 'olive-oil', group: 'fixed', label: 'Olive oil (cooking)', amount: { unit: 'g', amount } });
    });
  }

  if (s.combineBreakfast) {
    const first = meals.find((m) => m.id === 1), second = meals.find((m) => m.id === 2);
    if (first && second) {
      first.name = 'First Meal · Eggs, Meat & Carbs';
      first.time = 'Start of day · allow a comfortable digestion interval before training';
      first.note = 'Your breakfast and first meat-and-carb meal combined. These portions replace the separate meal; they are not extra food.';
      first.items.push(...second.items.map((it) => ({ ...it, mealId: 1 })));
      meals.splice(meals.indexOf(second), 1);
    }
  }
  return meals;
}
