/**
 * Reads a typed or dictated meal description into item mentions:
 *   "I ate 282 g cooked chicken breast, 300 g cooked rice and an apple"
 *   "έφαγα 2 αυγά, μισή μπανάνα και 250 ml χυμό πορτοκάλι"
 *
 * Pure text processing. It never decides nutrition: matching to real foods happens in match.ts,
 * and every item is shown for review before anything is saved. What it cannot read with
 * certainty ("some pasta", "a glass of") is reported as vague, never filled in.
 */

export type AmountUnit =
  | 'g' | 'ml' | 'cup' | 'tbsp' | 'tsp' | 'slice' | 'piece' | 'scoop' | 'serving' | 'can'
  | 'glass' | 'bowl' | 'plate' | 'handful' | 'pinch';

export interface Amount {
  /** null when only a vague word was given ("some", "a bit of"). */
  value: number | null;
  /** null = a count of whole items ("2 eggs", "an apple"). */
  unit: AmountUnit | null;
  /** "about 200 g", "a couple of" — usable, but shown as approximate. */
  approx: boolean;
  /** No usable number: the user must say how much. */
  vague: boolean;
  /** What the user wrote for the amount. */
  text: string;
}

export type StateHint = 'cooked' | 'boiled' | 'roasted' | 'grilled' | 'fried' | 'baked' | 'steamed' | 'raw' | 'dry';
export type Size = 'small' | 'medium' | 'large';
export type SlotHint = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'pre' | 'post';

export interface Mention {
  /** The item as written (original spelling). */
  text: string;
  /** Normalised words that name the food (amount, state, size and filler removed). */
  words: string[];
  amount: Amount | null;
  state: StateHint | null;
  size: Size | null;
}

export interface ParsedText {
  items: Mention[];
  /** "I ate…" → eaten, "I'll have…" → planned, otherwise unknown. */
  status: 'eaten' | 'planned' | null;
  slot: SlotHint | null;
}

/* ------------------------------------------------------------------ normalisation */

/** Lower-case, accents removed, final sigma unified — one output character per input character. */
function foldChar(ch: string): string {
  const f = ch.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  const c = f[0] ?? ch;
  return c === 'ς' ? 'σ' : c;
}

/** Same rules as foldChar, for whole strings (food names, phrases). */
export function fold(s: string): string {
  return Array.from(s, foldChar).join('');
}

const FRACTIONS: Record<string, string> = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8' };

/* ------------------------------------------------------------------ vocabulary (folded forms) */

// A "word boundary" that understands Greek: JavaScript's \b only knows ASCII letters.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const alt = (words: readonly string[]) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');
const wordRe = (words: readonly string[], flags = 'gu') => new RegExp(`${B}(?:${alt(words)})${E}`, flags);

const UNIT_WORDS: { unit: AmountUnit; factor?: number; words: string[] }[] = [
  { unit: 'g', factor: 1000, words: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'κιλο', 'κιλα'] },
  { unit: 'g', words: ['g', 'gr', 'grs', 'gram', 'grams', 'gramme', 'grammes', 'γρ', 'γραμ', 'γραμμαρια', 'γραμμαριο', 'γραμαρια'] },
  { unit: 'g', factor: 28.349523125, words: ['oz', 'ounce', 'ounces'] },
  { unit: 'g', factor: 453.59237, words: ['lb', 'lbs', 'pound', 'pounds'] },
  { unit: 'ml', factor: 29.5735295625, words: ['fl oz', 'fluid ounce', 'fluid ounces'] },
  { unit: 'ml', factor: 1000, words: ['l', 'lt', 'ltr', 'liter', 'liters', 'litre', 'litres', 'λιτρο', 'λιτρα'] },
  { unit: 'ml', factor: 100, words: ['dl'] },
  { unit: 'ml', factor: 10, words: ['cl'] },
  { unit: 'ml', words: ['ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'μλ'] },
  { unit: 'cup', words: ['cup', 'cups', 'φλιτζανι', 'φλιτζανια', 'φλυτζανι', 'φλυτζανια', 'κουπα', 'κουπεσ'] },
  { unit: 'tbsp', words: ['tbsp', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'κουταλια τησ σουπασ', 'κουταλιεσ τησ σουπασ', 'κουταλια', 'κουταλιεσ', 'κ.σ.'] },
  { unit: 'tsp', words: ['tsp', 'teaspoon', 'teaspoons', 'κουταλακι του γλυκου', 'κουταλακια του γλυκου', 'κουταλακι', 'κουταλακια', 'κ.γ.'] },
  { unit: 'slice', words: ['slice', 'slices', 'φετα', 'φετεσ'] },
  { unit: 'piece', words: ['piece', 'pieces', 'pc', 'pcs', 'τεμαχιο', 'τεμαχια', 'κομματι', 'κομματια', 'τμχ'] },
  { unit: 'scoop', words: ['scoop', 'scoops', 'σκουπ', 'μεζουρα', 'μεζουρεσ', 'δοση', 'δοσεισ'] },
  { unit: 'serving', words: ['serving', 'servings', 'portion', 'portions', 'μεριδα', 'μεριδεσ'] },
  { unit: 'can', words: ['can', 'cans', 'tin', 'tins', 'κονσερβα', 'κονσερβεσ', 'κουτι', 'κουτακι'] },
  { unit: 'glass', words: ['glass', 'glasses', 'ποτηρι', 'ποτηρια'] },
  { unit: 'bowl', words: ['bowl', 'bowls', 'μπολ', 'μπωλ'] },
  { unit: 'plate', words: ['plate', 'plates', 'πιατο', 'πιατα'] },
  { unit: 'handful', words: ['handful', 'handfuls', 'χουφτα', 'χουφτεσ'] },
  { unit: 'pinch', words: ['pinch', 'πρεζα'] },
];

/** Containers and handfuls have no fixed size: the user has to say or pick how much. */
export const VAGUE_UNITS: ReadonlySet<AmountUnit> = new Set(['glass', 'bowl', 'plate', 'handful', 'pinch']);

const NUMBER_WORDS: Record<string, { n: number; approx?: boolean }> = {
  a: { n: 1 }, an: { n: 1 }, one: { n: 1 }, two: { n: 2 }, three: { n: 3 }, four: { n: 4 }, five: { n: 5 }, six: { n: 6 },
  seven: { n: 7 }, eight: { n: 8 }, nine: { n: 9 }, ten: { n: 10 }, eleven: { n: 11 }, twelve: { n: 12 }, dozen: { n: 12 },
  'a dozen': { n: 12 }, half: { n: 0.5 }, 'half a': { n: 0.5 }, 'half an': { n: 0.5 }, 'a half': { n: 0.5 },
  'one and a half': { n: 1.5 }, 'a couple of': { n: 2, approx: true }, 'a couple': { n: 2, approx: true }, 'couple of': { n: 2, approx: true },
  ενα: { n: 1 }, εναν: { n: 1 }, ενασ: { n: 1 }, μια: { n: 1 }, μιασ: { n: 1 }, δυο: { n: 2 }, τρια: { n: 3 }, τρεισ: { n: 3 },
  τεσσερα: { n: 4 }, τεσσερισ: { n: 4 }, πεντε: { n: 5 }, εξι: { n: 6 }, επτα: { n: 7 }, εφτα: { n: 7 }, οκτω: { n: 8 }, οχτω: { n: 8 },
  εννεα: { n: 9 }, εννια: { n: 9 }, δεκα: { n: 10 }, εντεκα: { n: 11 }, δωδεκα: { n: 12 },
  μισο: { n: 0.5 }, μιση: { n: 0.5 }, μισοσ: { n: 0.5 }, εναμισι: { n: 1.5 }, εναμιση: { n: 1.5 }, μιαμιση: { n: 1.5 },
};

const VAGUE_WORDS = [
  'some', 'a bit of', 'a bit', 'a little', 'a little bit of', 'a lot of', 'lots of', 'a few', 'few', 'several', 'a little of', 'a splash of', 'a drizzle of',
  'λιγο', 'λιγη', 'λιγα', 'λιγεσ', 'λιγακι', 'μερικα', 'μερικεσ', 'μερικοι', 'πολυ', 'πολλα', 'πολλη', 'αρκετο', 'αρκετα', 'αρκετη',
];

const APPROX_WORDS = ['about', 'around', 'approx', 'approximately', 'roughly', 'nearly', 'almost', 'maybe', 'like', 'περιπου', 'γυρω στα', 'γυρω στο', 'γυρω στισ', 'κανα', 'καμια', 'κοντα στα'];

const SIZE_WORDS: { size: Size; words: string[] }[] = [
  { size: 'small', words: ['small', 'little', 'μικρο', 'μικρη', 'μικρα', 'μικροσ', 'μικρεσ'] },
  { size: 'medium', words: ['medium', 'average', 'μεσαιο', 'μεσαια', 'μετριο', 'μετρια', 'μεσαιεσ'] },
  { size: 'large', words: ['large', 'big', 'jumbo', 'extra large', 'μεγαλο', 'μεγαλη', 'μεγαλα', 'μεγαλοσ', 'μεγαλεσ'] },
];

const STATE_WORDS: { state: StateHint; words: string[] }[] = [
  { state: 'raw', words: ['raw weight', 'weighed raw', 'raw', 'uncooked', 'ωμο', 'ωμη', 'ωμα', 'ωμοσ', 'ωμεσ', 'ωμου', 'ωμησ', 'ωμοι', 'ζυγισμενο ωμο'] },
  { state: 'dry', words: ['dry weight', 'weighed dry', 'dry', 'αβραστο', 'αβραστη', 'αβραστα', 'αβραστοσ', 'αβραστεσ', 'ξηρο', 'ξηρα'] },
  { state: 'boiled', words: ['boiled', 'hard boiled', 'hard-boiled', 'βραστο', 'βραστη', 'βραστα', 'βραστοσ', 'βραστεσ', 'βρασμενο', 'βρασμενη', 'βρασμενα', 'βρασμενοσ', 'βρασμενεσ', 'βρασμενου'] },
  { state: 'steamed', words: ['steamed', 'στον ατμο', 'ατμου'] },
  { state: 'grilled', words: ['grilled', 'chargrilled', 'σχαρασ', 'στη σχαρα', 'στα καρβουνα', 'στο γκριλ'] },
  { state: 'roasted', words: ['roasted', 'roast', 'ψητο', 'ψητη', 'ψητα', 'ψητοσ', 'ψητεσ', 'ψημενο', 'ψημενη', 'ψημενα', 'ψημενοσ', 'ψητου', 'φουρνου', 'στο φουρνο', 'στον φουρνο'] },
  { state: 'baked', words: ['baked'] },
  { state: 'fried', words: ['fried', 'pan fried', 'pan-fried', 'sauteed', 'sautéed', 'τηγανητο', 'τηγανητη', 'τηγανητα', 'τηγανητοσ', 'τηγανητεσ', 'σοταρισμενο', 'σοταρισμενη', 'σοταρισμενα', 'σοταρισμενοσ'] },
  { state: 'cooked', words: ['cooked weight', 'weighed cooked', 'cooked', 'μαγειρεμενο', 'μαγειρεμενη', 'μαγειρεμενα', 'μαγειρεμενοσ', 'μαγειρεμενεσ', 'μαγειρεμενου'] },
];

const EATEN_WORDS = ['i ate', 'i have eaten', 'i\'ve eaten', 'ive eaten', 'i had', 'i\'ve had', 'ive had', 'i just had', 'just had', 'i drank', 'had', 'ate', 'eaten', 'drank',
  'εφαγα', 'εχω φαει', 'ηπια', 'ειχα', 'πηρα', 'τσιμπησα', 'μολισ εφαγα'];
const PLANNED_WORDS = ['i will have', 'i\'ll have', 'ill have', 'i will eat', 'i\'ll eat', 'ill eat', 'i am going to have', 'i\'m going to have', 'im going to have',
  'going to have', 'going to eat', 'gonna have', 'gonna eat', 'i plan to have', 'plan to have', 'planning to have', 'θα φαω', 'θα πιω', 'θα παρω', 'σκοπευω να φαω'];

const SLOT_WORDS: { slot: SlotHint; words: string[] }[] = [
  { slot: 'pre', words: ['pre workout', 'pre-workout', 'preworkout', 'pre gym', 'pre-gym', 'before the gym', 'before gym', 'before training', 'before my workout', 'before workout',
    'πριν το γυμναστηριο', 'πριν τη προπονηση', 'πριν την προπονηση', 'πριν το γυμ'] },
  { slot: 'post', words: ['post workout', 'post-workout', 'postworkout', 'post gym', 'post-gym', 'after the gym', 'after gym', 'after training', 'after my workout', 'after workout',
    'μετα το γυμναστηριο', 'μετα τη προπονηση', 'μετα την προπονηση', 'μετα το γυμ'] },
  { slot: 'breakfast', words: ['breakfast', 'this morning', 'in the morning', 'πρωινο', 'για πρωινο', 'στο πρωινο', 'το πρωι'] },
  { slot: 'lunch', words: ['lunch', 'at noon', 'μεσημεριανο', 'το μεσημερι', 'για μεσημεριανο'] },
  { slot: 'dinner', words: ['dinner', 'supper', 'tonight', 'this evening', 'βραδινο', 'δειπνο', 'το βραδυ', 'για βραδινο'] },
  { slot: 'snack', words: ['snack', 'as a snack', 'σνακ', 'κολατσιο'] },
];

/** Words that never name a food on their own. */
const FILLER = new Set([
  'of', 'the', 'my', 'for', 'at', 'in', 'on', 'today', 'earlier', 'then', 'also', 'just', 'too', 'as', 'well', 'x', 'and', 'with', 'plus', 'i',
  'του', 'τησ', 'των', 'το', 'τα', 'τη', 'την', 'τον', 'η', 'ο', 'οι', 'απο', 'μου', 'σε', 'στο', 'στα', 'στη', 'για', 'σημερα', 'επισησ', 'μετα', 'μαζι',
]);

/** Phrases that contain a joining word but name one food. Food names with "and"/"with" are added at run time. */
const COMPOUNDS = ['sweet and sour', 'mac and cheese', 'macaroni and cheese', 'salt and pepper', 'fish and chips', 'peanut butter and jelly', 'bread and butter', 'surf and turf', 'γλυκοξινη'];

const SPLIT_WORDS = ['and', '&', 'plus', 'with', 'along with', 'together with', 'also', 'then', 'και', 'κι', 'με', 'μαζι με', 'συν', 'επισησ'];

/* ------------------------------------------------------------------ number reading */

const NUM = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d{1,3}(?:_\d{3})+|\d+(?:\.\d+)?`;

export function readNumber(s: string): number | null {
  const t = s.trim().replace(/_/g, '');
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null;
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ the parser */

interface Span { start: number; end: number }

/**
 * Prepares the text: unicode fractions, decimal commas ("1,5 kg" → 1.5) and thousands separators
 * ("1,000 ml") are rewritten in both the display copy and the folded copy, keeping them aligned
 * character for character so any match in the folded copy maps back to what the user typed.
 */
function prepare(input: string): { orig: string; norm: string } {
  let orig = input.replace(/[½¼¾⅓⅔⅛]/g, (c) => FRACTIONS[c] ?? c).replace(/\s+/g, ' ').trim();
  // "1,000 ml" / "1,500 g": a thousands separator only before grams/millilitres; everything else with a comma between digits is a decimal comma.
  orig = orig.replace(/(\d),(\d{3})(?=\s*(?:g|gr|ml|γρ|μλ)(?![\p{L}]))/gu, '$1_$2');
  orig = orig.replace(/(\d),(\d)/g, '$1.$2');
  const norm = Array.from(orig, foldChar).join('');
  return { orig, norm };
}

function blank(s: string, span: Span): string {
  return s.slice(0, span.start) + ' '.repeat(span.end - span.start) + s.slice(span.end);
}

function findFirst(re: RegExp, s: string): (Span & { m: RegExpExecArray }) | null {
  re.lastIndex = 0;
  const m = re.exec(s);
  return m ? { start: m.index, end: m.index + m[0].length, m } : null;
}

/** Removes every match of the given phrases from the working copy; returns whether any matched. */
function strip(norm: string, words: readonly string[]): { norm: string; hit: boolean } {
  const re = wordRe(words);
  let hit = false;
  const out = norm.replace(re, (m) => { hit = true; return ' '.repeat(m.length); });
  return { norm: out, hit };
}

const UNIT_RE = new RegExp(`^\\s*(${UNIT_WORDS.flatMap((u) => u.words).sort((a, b) => b.length - a.length).map((w) => alt([w])).join('|')})${E}`, 'u');
const NUM_WORD_LIST = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);

function unitFor(word: string): { unit: AmountUnit; factor: number } | null {
  const w = word.replace(/\s+/g, ' ').trim();
  for (const u of UNIT_WORDS) if (u.words.includes(w)) return { unit: u.unit, factor: u.factor ?? 1 };
  return null;
}

/** Reads the amount in one item (first number + unit, or a count, or a vague word) and blanks it out. */
function readAmount(orig: string, norm: string): { amount: Amount | null; norm: string } {
  let work = norm;
  let approx = false;
  const ap = strip(work, APPROX_WORDS);
  work = ap.norm;
  if (ap.hit) approx = true;
  if (/~/.test(work)) { approx = true; work = work.replace(/~/g, ' '); }

  // "2 x 150 g" → 300 g
  const mult = findFirst(new RegExp(`${B}(\\d+)\\s*[x×]\\s*(${NUM})`, 'gu'), work);
  let numSpan: Span | null = null;
  let value: number | null = null;
  if (mult) {
    const a = readNumber(mult.m[1]!);
    const b = readNumber(mult.m[2]!);
    if (a !== null && b !== null) { value = a * b; numSpan = { start: mult.start, end: mult.end }; }
  }
  if (!numSpan) {
    const num = findFirst(new RegExp(`${B}(${NUM})`, 'gu'), work);
    if (num) { value = readNumber(num.m[1]!); numSpan = { start: num.start, end: num.end }; }
  }
  let wordNum: { n: number; approx?: boolean } | null = null;
  if (!numSpan) {
    const vague = findFirst(wordRe(VAGUE_WORDS), work);
    const nw = findFirst(wordRe(NUM_WORD_LIST), work);
    // "a few", "some" win over the article "a" they start with.
    if (vague && (!nw || vague.start <= nw.start)) {
      const after = work.slice(vague.end);
      const u = UNIT_RE.exec(after);
      let end = vague.end;
      let unit: AmountUnit | null = null;
      if (u) { const uf = unitFor(u[1]!); if (uf) { unit = uf.unit; end = vague.end + u[0].length; } }
      const text = orig.slice(vague.start, end).trim();
      work = blank(work, { start: vague.start, end });
      return { amount: { value: null, unit, approx: true, vague: true, text }, norm: work };
    }
    if (nw) {
      wordNum = NUMBER_WORDS[nw.m[0].replace(/\s+/g, ' ')] ?? null;
      if (wordNum) { value = wordNum.n; numSpan = { start: nw.start, end: nw.end }; if (wordNum.approx) approx = true; }
    }
  }
  if (!numSpan || value === null) return { amount: null, norm: work };

  // A unit right after the number ("282 g", "2 cups", "μισό φλιτζάνι"), optionally followed by "of".
  const after = work.slice(numSpan.end);
  const u = UNIT_RE.exec(after);
  let unit: AmountUnit | null = null;
  let end = numSpan.end;
  if (u) {
    const uf = unitFor(u[1]!);
    const rest = after.slice(u[0].length).replace(/[^\p{L}\p{N}]+/gu, '');
    // "μια φέτα" with nothing after it is one piece of feta, not one slice of something.
    if (uf && (rest.length > 0 || !['slice'].includes(uf.unit))) {
      unit = uf.unit;
      value = value * uf.factor;
      end = numSpan.end + u[0].length;
    }
  }
  const text = orig.slice(numSpan.start, end).trim();
  work = blank(work, { start: numSpan.start, end });
  if (unit === null && wordNum === null && value !== null && !Number.isInteger(value) && value > 20) approx = true;
  return { amount: { value: Math.round(value * 1000) / 1000, unit, approx, vague: unit !== null && VAGUE_UNITS.has(unit), text }, norm: work };
}

function readTag<T extends string>(norm: string, table: readonly { [k: string]: unknown; words: string[] }[], key: string): { tag: T | null; norm: string } {
  let tag: T | null = null;
  let work = norm;
  for (const row of table) {
    const r = strip(work, row.words);
    if (r.hit) { work = r.norm; tag ??= row[key] as T; }
  }
  return { tag, norm: work };
}

/**
 * Splits the description into item spans on commas, semicolons, line breaks, sentence ends and
 * joining words ("and", "with", "και", "με") — except inside known compound names.
 */
function splitItems(norm: string, compounds: readonly string[]): Span[] {
  const protectedSpans: Span[] = [];
  for (const c of [...COMPOUNDS, ...compounds]) {
    const re = new RegExp(`${B}${alt([c])}${E}`, 'gu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) protectedSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  const inside = (i: number) => protectedSpans.some((p) => i > p.start && i < p.end);
  const cuts: Span[] = [];
  const sep = new RegExp(`[,;\\n]+|[.!?](?=\\s|$)|\\s\\+\\s|${B}(?:${alt(SPLIT_WORDS)})${E}`, 'gu');
  let m: RegExpExecArray | null;
  while ((m = sep.exec(norm))) {
    // "1.5" is a number, not a sentence end.
    if (m[0] === '.' && /\d/.test(norm[m.index - 1] ?? '') && /\d/.test(norm[m.index + 1] ?? '')) continue;
    if (inside(m.index)) continue;
    cuts.push({ start: m.index, end: m.index + m[0].length });
  }
  const spans: Span[] = [];
  let pos = 0;
  for (const c of cuts) { spans.push({ start: pos, end: c.start }); pos = c.end; }
  spans.push({ start: pos, end: norm.length });
  return spans.filter((s) => norm.slice(s.start, s.end).trim().length > 0);
}

export interface ParseOptions {
  /** Folded food names that contain a joining word ("chicken with rice (meal prep)") and must not be split. */
  compounds?: readonly string[];
}

export function parseFoodText(input: string, opts: ParseOptions = {}): ParsedText {
  const { orig, norm: folded } = prepare(input);
  let norm = folded;

  let status: ParsedText['status'] = null;
  const planned = strip(norm, PLANNED_WORDS);
  if (planned.hit) { status = 'planned'; norm = planned.norm; }
  const eaten = strip(norm, EATEN_WORDS);
  if (eaten.hit) { status ??= 'eaten'; norm = eaten.norm; }

  let slot: SlotHint | null = null;
  for (const row of SLOT_WORDS) {
    const r = strip(norm, row.words.flatMap((w) => [`for ${w}`, `at ${w}`, `as ${w}`, `για ${w}`, `στο ${w}`, w]));
    if (r.hit) { slot ??= row.slot; norm = r.norm; }
  }

  const items: Mention[] = [];
  for (const span of splitItems(norm, opts.compounds ?? [])) {
    // What the user wrote for this item, minus "I ate" / "for breakfast" (blanked in the working copy).
    const o = Array.from(orig.slice(span.start, span.end), (ch, i) => (norm[span.start + i] === ' ' && folded[span.start + i] !== ' ' ? ' ' : ch)).join('');
    let n = norm.slice(span.start, span.end);
    const a = readAmount(o, n);
    n = a.norm;
    const st = readTag<StateHint>(n, STATE_WORDS, 'state');
    n = st.norm;
    const sz = readTag<Size>(n, SIZE_WORDS, 'size');
    n = sz.norm;
    const words = n.split(/[^\p{L}\p{N}%]+/u).filter((w) => w && !FILLER.has(w));
    const text = o.replace(/\s+/g, ' ').replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '').trim();
    if (!words.length && !a.amount) continue;
    items.push({ text, words, amount: a.amount, state: st.tag, size: sz.tag });
  }
  // A lone amount followed by its food in the next piece ("200 g, chicken") belongs together.
  const merged: Mention[] = [];
  for (const it of items) {
    const prev = merged[merged.length - 1];
    if (prev && prev.words.length === 0 && prev.amount && !it.amount) {
      merged[merged.length - 1] = { ...it, text: `${prev.text} ${it.text}`, amount: prev.amount, state: it.state ?? prev.state, size: it.size ?? prev.size };
    } else merged.push(it);
  }
  return { items: merged.filter((m) => m.words.length > 0), status, slot };
}

/** True when the text reads as "amount + food" or several foods, rather than a plain search. */
export function looksLikeMealText(input: string): boolean {
  const t = input.trim();
  if (t.length < 3) return false;
  const p = parseFoodText(t);
  if (p.items.length >= 2) return true;
  const one = p.items[0];
  return !!one && (one.amount !== null || p.status !== null);
}
