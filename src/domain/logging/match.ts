import type { Food, Prep, Quantity } from '../nutrition/food';
import { displayName } from '../nutrition/food';
import { resolveQuantity } from '../nutrition/quantity';
import { fold, VAGUE_UNITS, type Mention, type StateHint } from './parse';

/**
 * Matches parsed mentions to real foods and turns their amounts into quantities.
 *
 * Nothing is invented: every value shown later comes from the matched food's own data. When the
 * food, its cooking state or the amount is unclear, the item carries a BLOCKING issue and cannot be
 * saved until the user decides. Softer doubts (an assumed medium size, "about 200 g") are shown as
 * notes so they can be checked at a glance.
 */

export type IssueKind = 'no-match' | 'confirm-food' | 'choose-food' | 'state' | 'amount' | 'unit';

export interface Issue {
  kind: IssueKind;
  blocking: boolean;
  message: string;
}

export interface MatchedItem {
  mention: Mention;
  /** Key for remembering the user's choice ("sweet chili sauce"). */
  phrase: string;
  food: Food | null;
  qty: Quantity | null;
  /** Other plausible foods, best first (for one-tap correction). */
  alternatives: Food[];
  /** The raw/cooked counterpart when the state must be chosen. */
  statePair: Food | null;
  issues: Issue[];
  notes: string[];
  approx: boolean;
}

export interface MatchContext {
  foods: readonly Food[];
  /** foodId → how strongly to prefer it (recently / often logged). */
  boost?: ReadonlyMap<string, number>;
  /** Remembered corrections: phrase (optionally "|state") → foodId. */
  learned?: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------ indexing */

interface Row {
  food: Food;
  tokens: string[];
  /** Names and aliases, folded, with any "(…)" part removed — and the same with every word stemmed. */
  phrases: string[];
  stems: string[];
  nameLen: number;
}

const strip = (s: string) => fold(s).replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
const stemPhrase = (s: string) => s.split(' ').map((w) => stem(w)).join(' ');

const cache = new WeakMap<readonly Food[], Row[]>();
export function indexForMatching(foods: readonly Food[]): Row[] {
  const hit = cache.get(foods);
  if (hit) return hit;
  const rows = foods.map((food) => {
    const names = [food.names.en, food.names.el ?? '', ...(food.names.aliases ?? []), food.brand ? `${food.brand} ${food.names.en}` : ''].filter(Boolean);
    const all = names.map((n) => fold(n).replace(/[^\p{L}\p{N}%]+/gu, ' ').trim());
    const tokens = Array.from(new Set(all.join(' ').split(' ').filter(Boolean)));
    const phrases = Array.from(new Set(names.map(strip)));
    return { food, tokens, phrases, stems: phrases.map(stemPhrase), nameLen: strip(food.names.en).length };
  });
  cache.set(foods, rows);
  return rows;
}

/* ------------------------------------------------------------------ word similarity */

/** English plural → singular; Greek words lose their inflection ending (μήλα/μήλο → μηλ). */
export function stem(w: string): string {
  if (/^[a-z]+$/.test(w)) {
    if (w.length < 4) return w;
    if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (/(sh|ch|x|s|o)es$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  if (/^[Ͱ-Ͽ]+$/.test(w)) {
    const m = /^(.{3,}?)(ιου|ιων|ια|ιο|ου|ων|εσ|οσ|ασ|ησ|οι|ο|α|η|ι|ε|υ)$/.exec(w);
    return m ? m[1]! : w;
  }
  return w;
}

/** Damerau-free Levenshtein distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * How well one typed word matches one food word. "sure" = the same word (exact, plural, inflection,
 * a short ending away); otherwise it is only a look-alike ("macarons" ~ "macaroni", "pea" ~ "peanut")
 * and the item must be confirmed before saving.
 */
export function wordScore(q: string, t: string): { score: number; sure: boolean } {
  if (q === t) return { score: 3, sure: true };
  if (stem(q) === stem(t) && stem(q).length >= 3) return { score: 2.8, sure: true };
  if (q.length >= 4 && t.startsWith(q)) return { score: 2, sure: t.length - q.length <= 3 };
  if (t.length >= 4 && q.startsWith(t)) return { score: 1.8, sure: q.length - t.length <= 3 };
  if (q.length >= 3 && t.startsWith(q)) return { score: 1.2, sure: false };
  const max = q.length >= 8 ? 2 : q.length >= 5 ? 1 : 0;
  if (max && editDistance(q, t, max) <= max) return { score: 1.5, sure: false };
  if (q.length >= 4 && t.includes(q)) return { score: 1, sure: false };
  return { score: 0, sure: false };
}

/** Words too general to identify a food on their own ("sauce" must not become soy sauce). */
const GENERIC = new Set(['sauce', 'juice', 'cheese', 'bread', 'powder', 'oil', 'drink', 'snack', 'bar', 'cake', 'mix', 'cream', 'salad', 'soup', 'meat', 'fish',
  'fruit', 'veg', 'vegetable', 'vegetables', 'food', 'meal', 'protein', 'sweet', 'light', 'white', 'red', 'green', 'fresh', 'plain', 'low', 'fat', 'free',
  'σαλτσα', 'χυμοσ', 'τυρι', 'ψωμι', 'σκονη', 'λαδι', 'ποτο', 'γλυκο', 'κρεμα', 'σαλατα', 'σουπα', 'κρεασ', 'ψαρι', 'φρουτο', 'φρουτα', 'λαχανικα', 'φαγητο', 'πρωτεινη', 'λευκο', 'κοκκινο', 'πρασινο', 'φρεσκο', 'σκετο', 'light']);

const COOKED: ReadonlySet<Prep> = new Set(['boiled', 'roasted', 'pan-cooked', 'baked', 'grilled', 'drained', 'prepared']);
const RAWISH: ReadonlySet<Prep> = new Set(['raw', 'dry']);

/** +1 the food is in the stated state, -1 it contradicts it, 0 the state does not apply. */
export function stateFit(hint: StateHint | null, prep: Prep): number {
  if (!hint) return 0;
  if (hint === 'raw' || hint === 'dry') return RAWISH.has(prep) ? 1 : COOKED.has(prep) ? -1 : 0;
  if (RAWISH.has(prep)) return -1;
  if (!COOKED.has(prep)) return 0;
  const exact: Partial<Record<StateHint, Prep[]>> = {
    boiled: ['boiled'], steamed: ['boiled'], roasted: ['roasted', 'baked'], baked: ['baked', 'roasted'], grilled: ['grilled', 'roasted', 'pan-cooked'], fried: ['pan-cooked'],
  };
  const want = exact[hint];
  return !want || want.includes(prep) ? 1 : 0.6;
}

interface Scored { row: Row; score: number; matched: number; total: number; strong: boolean; sure: boolean }

function scoreRow(words: readonly string[], phrase: string, row: Row, ctx: MatchContext, state: StateHint | null): Scored {
  let score = 0, matched = 0, strong = false, sure = true;
  for (const w of words) {
    let best = { score: 0, sure: false };
    for (const t of row.tokens) {
      const s = wordScore(w, t);
      if (s.score > best.score || (s.score === best.score && s.sure && !best.sure)) best = s;
      if (best.score === 3) break;
    }
    if (best.score > 0) {
      matched += 1;
      score += best.score;
      if (!best.sure) sure = false;
      else if (!GENERIC.has(w)) strong = true;
    }
  }
  if (matched === words.length && words.length) {
    if (row.phrases.includes(phrase) || row.stems.includes(stemPhrase(phrase))) score += 4;
    else if (row.phrases.some((p) => p.startsWith(`${phrase} `) || p.endsWith(` ${phrase}`))) score += 1.5;
    // Prefer "Apple" over "Apple juice": unmatched words in the food's main name count against it.
    const nameWords = strip(row.food.names.en).split(' ').filter((w) => w.length > 2);
    const extra = nameWords.filter((nw) => !words.some((w) => wordScore(w, nw).sure)).length;
    score -= 0.35 * extra;
  }
  const fit = stateFit(state, row.food.prep);
  score += fit > 0 ? 2 * fit : fit < 0 ? -3 : 0;
  score += ctx.boost?.get(row.food.id) ?? 0;
  if (row.food.kind === 'custom' || row.food.kind === 'branded') score += 0.3;
  if (!sure) score -= 2;
  return { row, score, matched, total: words.length, strong, sure };
}

const kcal100 = (f: Food): number | null => {
  const r = resolveQuantity(f, f.basis.per === 'unit' ? { amount: 1, unit: 'portion', portionId: 'unit' } : f.basis.per === '100ml' ? { amount: 100, unit: 'ml' } : { amount: 100, unit: 'g' });
  return r.ok && f.n.kcal !== undefined ? f.n.kcal * (f.basis.per === 'unit' ? 1 : r.multiplier) : null;
};

/** Differ by more than a quarter in energy density: picking the wrong one would matter. */
function materiallyDifferent(a: Food, b: Food): boolean {
  if (a.basis.per !== b.basis.per) return true;
  const ka = kcal100(a), kb = kcal100(b);
  if (ka === null || kb === null) return true;
  return Math.abs(ka - kb) > 0.25 * Math.max(ka, kb, 1);
}

/* ------------------------------------------------------------------ amounts */

const PIECE_EXCLUDE = /cup|tbsp|tsp|tablespoon|teaspoon|\boz\b|ounce|slice|crushed|chopped|diced|sliced|cubes|mashed|packet|container|serving|yields|quart|fl oz|pieces|stalk|leaf|strip|ring|wedge|dash|pat\b|cubic/i;
const leadingCount = (label: string): number => {
  const m = /^(\d+)\s*\/\s*(\d+)\s/.exec(label) ?? /^(\d+)\s/.exec(label);
  if (!m) return 1;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
};

function portionFor(food: Food, re: RegExp): { id: string; count: number; label: string; g?: number; ml?: number } | null {
  const p = food.portions.find((x) => re.test(x.label));
  return p ? { id: p.id, count: leadingCount(p.label), label: p.label, ...(p.g !== undefined ? { g: p.g } : {}), ...(p.ml !== undefined ? { ml: p.ml } : {}) } : null;
}

const canUseMl = (f: Food) => f.basis.per === '100ml' || !!f.densityGPerMl;
const canUseG = (f: Food) => f.basis.per === '100g' || !!f.densityGPerMl || (f.basis.per === 'unit' && !!f.basis.unitG);

const isEgg = (f: Food) => /(^|[-:])egg-whole/.test(f.id) || /^egg\b/i.test(f.names.en);

export interface AmountResult { qty: Quantity | null; issues: Issue[]; notes: string[]; approx: boolean }

/** Turns the mention's amount into a quantity of this food — or says exactly what is missing. */
export function amountFor(food: Food, m: Mention): AmountResult {
  const a = m.amount;
  const notes: string[] = [];
  const ask = (message: string, kind: IssueKind = 'amount'): AmountResult => ({ qty: null, issues: [{ kind, blocking: true, message }], notes, approx: false });
  if (!a) return ask('How much? Enter the amount.');
  if (a.vague || a.value === null) {
    const what = a.unit && VAGUE_UNITS.has(a.unit) ? `"${a.text}" can be any size` : `"${a.text || 'some'}" isn't an amount`;
    return ask(`${what} — how much was it?`);
  }
  const v = a.value;
  if (a.approx) notes.push(`About ${a.text} — check the amount.`);
  const done = (qty: Quantity): AmountResult => {
    const r = resolveQuantity(food, qty);
    if (!r.ok) return { qty: null, issues: [{ kind: 'unit', blocking: true, message: r.reason }], notes, approx: a.approx };
    return { qty, issues: [], notes, approx: a.approx };
  };
  switch (a.unit) {
    case 'g':
      if (!canUseG(food)) return ask(food.basis.per === 'unit' ? `${displayName(food)} is counted per ${food.basis.unitLabel}, and its weight isn't known. Enter how many ${food.basis.unitLabel}s.` : 'This food is measured in mL and its density is unknown. Enter millilitres.', 'unit');
      return done({ amount: v, unit: 'g' });
    case 'ml':
      if (!canUseMl(food)) return ask('This food has no known density, so millilitres can\'t be converted. Weigh it in grams.', 'unit');
      return done({ amount: v, unit: 'ml' });
    case 'cup': case 'tbsp': case 'tsp': {
      const re = a.unit === 'cup' ? /\bcup\b/i : a.unit === 'tbsp' ? /tbsp|tablespoon/i : /\btsp\b|teaspoon/i;
      const p = portionFor(food, re);
      if (p) return done({ amount: Math.round((v / p.count) * 1000) / 1000, unit: 'portion', portionId: p.id });
      if (canUseMl(food)) {
        const ml = a.unit === 'cup' ? 240 : a.unit === 'tbsp' ? 15 : 5;
        notes.push(`1 ${a.unit} counted as ${ml} mL (kitchen measure) — check if your ${a.unit} differs.`);
        return { ...done({ amount: v * ml, unit: 'ml' }), approx: true };
      }
      return ask(`There's no ${a.unit} measure for this food. Enter grams.`, 'unit');
    }
    case 'slice': case 'piece': case 'scoop': case 'serving': case 'can': {
      if (food.basis.per === 'unit' && (a.unit === 'serving' || a.unit === 'piece')) return done({ amount: v, unit: 'portion', portionId: 'unit' });
      const re = { slice: /slice/i, piece: /piece|^1 (?!cup|tbsp|tsp|oz)\w+/i, scoop: /scoop/i, serving: /serving|^1 \w+$/i, can: /\bcan\b|\btin\b/i }[a.unit];
      const p = portionFor(food, re);
      if (p) return done({ amount: Math.round((v / p.count) * 1000) / 1000, unit: 'portion', portionId: p.id });
      const hint = a.unit === 'scoop' ? ' Scoops vary — check the tub (often 25–35 g).' : '';
      return ask(`How many grams is one ${a.unit} of this?${hint}`, 'unit');
    }
    case 'glass': case 'bowl': case 'plate': case 'handful': case 'pinch':
      return ask(`"${a.text}" can be any size — how much was it?`);
    case null: {
      if (food.basis.per === 'unit') return done({ amount: v, unit: 'portion', portionId: 'unit' });
      const pieces = food.portions.filter((p) => !PIECE_EXCLUDE.test(p.label) && /^(\d+(\/\d+)?|½)\s/.test(p.label));
      const has = (re: RegExp) => pieces.find((p) => re.test(p.label) && !/extra/i.test(p.label));
      const sized = m.size ? has(new RegExp(`\\b${m.size}\\b`, 'i')) : undefined;
      // A typical whole one: eggs are "large" by convention; otherwise medium, a plain "1 orange", then large.
      const pick = sized ?? (isEgg(food) ? has(/\blarge\b/i) : undefined) ?? has(/\bmedium\b/i)
        ?? pieces.find((p) => !/\b(small|large)\b/i.test(p.label)) ?? has(/\blarge\b/i) ?? pieces[0];
      if (!pick) return ask(`How much does one weigh? Enter grams.`);
      const count = leadingCount(pick.label);
      if (!sized && pieces.length > 1) notes.push(`Size assumed: ${pick.label}${pick.g ? ` (${pick.g} g)` : ''} — change it if yours was different.`);
      return done({ amount: Math.round((v / count) * 1000) / 1000, unit: 'portion', portionId: pick.id });
    }
  }
}

/* ------------------------------------------------------------------ matching */

export const phraseKey = (m: Mention) => m.words.join(' ');

function learnedFood(m: Mention, ctx: MatchContext, byId: Map<string, Food>): Food | null {
  const k = phraseKey(m);
  const id = (m.state && ctx.learned?.get(`${k}|${m.state}`)) || ctx.learned?.get(k);
  return id ? byId.get(id) ?? null : null;
}

export function matchMention(m: Mention, ctx: MatchContext): MatchedItem {
  const phrase = phraseKey(m);
  const rows = indexForMatching(ctx.foods);
  const byId = new Map(ctx.foods.map((f) => [f.id, f]));
  const base: MatchedItem = { mention: m, phrase, food: null, qty: null, alternatives: [], statePair: null, issues: [], notes: [], approx: false };

  const remembered = learnedFood(m, ctx, byId);
  const order = (a: Scored, b: Scored) => b.score - a.score || a.row.nameLen - b.row.nameLen;
  const scored = rows.map((r) => scoreRow(m.words, phrase, r, ctx, m.state)).filter((s) => s.matched > 0);
  const full = scored.filter((s) => s.matched === s.total && s.sure).sort(order);
  const lookalike = scored.filter((s) => s.matched === s.total && !s.sure).sort(order);
  const partial = scored
    .filter((s) => s.matched < s.total && s.strong && s.matched / s.total >= 0.5)
    .sort((a, b) => b.matched - a.matched || order(a, b));

  let food: Food | null = remembered;
  const issues: Issue[] = [];
  const notes: string[] = [];
  let pool: Scored[] = full;

  if (!food) {
    if (full.length) food = full[0]!.row.food;
    else if (partial.length) {
      pool = partial;
      food = partial[0]!.row.food;
      issues.push({ kind: 'confirm-food', blocking: true, message: `Only part of "${m.words.join(' ')}" matched ${displayName(food)}. Is that right?` });
    } else {
      // Look-alikes ("macarons" ~ "macaroni") are offered as suggestions, never picked for the user.
      return { ...base, alternatives: lookalike.slice(0, 4).map((s) => s.row.food), issues: [{ kind: 'no-match', blocking: true, message: `"${m.words.join(' ')}" isn't in your foods yet.` }] };
    }
  }

  // The stated state wins over the closest name: "cooked rice" → the cooked entry of the pair.
  if (food.pair && stateFit(m.state, food.prep) < 0) {
    const p = byId.get(food.pair);
    if (p && stateFit(m.state, p.prep) > 0) food = p;
  }
  if (m.state && stateFit(m.state, food.prep) < 0) {
    issues.push({ kind: 'state', blocking: true, message: `You said ${m.state}, but ${displayName(food)} is the ${food.prep} weight. Enter the ${food.prep} weight, or choose another food.` });
  }

  const top = pool[0];
  const alternatives = pool.filter((s) => !top || s.score >= top.score - 3).map((s) => s.row.food).filter((f) => f.id !== food!.id && f.id !== food!.pair).slice(0, 5);
  if (!remembered && top && !issues.length) {
    const close = pool.slice(1).filter((s) => s.score >= top.score - 1.2 && s.row.food.id !== food.pair && s.row.food.id !== food.id);
    const boosted = (ctx.boost?.get(food.id) ?? 0) > 0;
    const risky = close.filter((s) => materiallyDifferent(food!, s.row.food));
    if (risky.length && !boosted) {
      issues.push({ kind: 'choose-food', blocking: true, message: `Which ${m.words.join(' ')}? They differ in calories.` });
    } else if (close.length) {
      notes.push(`Using ${displayName(food)} — tap to change if you meant another.`);
    }
  }

  // Raw or cooked weight decides the numbers (300 g rice dry ≈ 1,100 kcal, cooked ≈ 390 kcal).
  let statePair: Food | null = null;
  const weighed = m.amount && (m.amount.unit === 'g' || m.amount.unit === 'ml' || m.amount.unit === 'cup' || m.amount.unit === 'tbsp' || m.amount.unit === 'tsp' || m.amount.vague || m.amount.value === null);
  // Asked every time, even for a remembered food: the same food is weighed raw one day, cooked the next.
  if (food.pair && !m.state && (weighed || !m.amount)) {
    statePair = byId.get(food.pair) ?? null;
    if (statePair) issues.push({ kind: 'state', blocking: true, message: 'Was it weighed cooked, or raw/dry? It changes the numbers a lot.' });
  }

  const amt = amountFor(food, m);
  return { mention: m, phrase, food, qty: amt.qty, alternatives, statePair, issues: [...issues, ...amt.issues], notes: [...notes, ...amt.notes], approx: amt.approx };
}

export function matchAll(items: readonly Mention[], ctx: MatchContext): MatchedItem[] {
  return items.map((m) => matchMention(m, ctx));
}

/** Food names that contain joining words, so "chicken with rice (meal prep)" is not split in two. */
export function compoundNames(foods: readonly Food[]): string[] {
  const out = new Set<string>();
  for (const f of foods) {
    for (const n of [f.names.en, f.names.el ?? '', ...(f.names.aliases ?? [])]) {
      const s = strip(n);
      if (/\s(and|with|και|με)\s/.test(s)) out.add(s);
    }
  }
  return [...out];
}
