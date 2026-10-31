/**
 * Reads nutrition values out of OCR text from a package label (Greek and/or English; EU per-100 g/mL
 * tables or US "Nutrition Facts"). Pure and deterministic: it only finds numbers that are printed —
 * nothing is estimated — and every value goes back to the user to check against the package.
 */

export type LabelTextField = 'energyKcal' | 'energyKj' | 'fat' | 'satFat' | 'carbs' | 'sugars' | 'fiber' | 'protein' | 'salt' | 'sodiumMg';

export interface FoundValue {
  value: number;
  /** Printed as "<0.5 g": the value is an upper bound. */
  lessThan: boolean;
  /** The text line it came from (shown to the user). */
  line: string;
}

export interface LabelText {
  basis: 'per100g' | 'per100ml' | 'perServing' | null;
  region: 'eu' | 'us' | null;
  servingG: number | null;
  servingMl: number | null;
  fields: Partial<Record<LabelTextField, FoundValue>>;
  warnings: string[];
}

/** OCR reads 0 as O/o and 1 as l/I inside numbers; fix those only next to digits. */
export function fixDigits(s: string): string {
  let t = s;
  for (let i = 0; i < 3; i++) {
    t = t.replace(/(?<=[\d.,])[oO]|[oO](?=[\d.,]\d)/g, '0').replace(/(?<=\d)[lI|](?=[\d.,\s]*\d)|(?<=[\d][.,])[lI|]/g, '1');
  }
  return t;
}

const num = (s: string): number => Number(s.replace(',', '.'));

/** Lower-case, accents off, final sigma unified — but digits, decimal commas, '<' and line breaks kept. */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/ς/g, 'σ').replace(/µ/g, 'μ');

/**
 * On a bilingual label the OCR often writes Latin words with Greek look-alike letters ("375 kcal" →
 * "375 κοαι", "Protein" → "Ρrotein"). Units and English keywords are therefore also matched on a copy
 * with those letters mapped to their Latin twins. Greek keywords keep using the real Greek text.
 */
const TWIN: Record<string, string> = { α: 'a', β: 'b', γ: 'y', ε: 'e', ζ: 'z', η: 'n', ι: 'i', κ: 'k', μ: 'm', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w' };
export const latinize = (s: string): string => s.replace(/[αβγεζηικμνορτυχω]/g, (c) => TWIN[c]!);

/** First "number [unit]" on a line, after its keyword. */
function firstAmount(rest: string): { value: number; unit: string | null; lessThan: boolean } | null {
  const m = /(<|less than|λιγοτερο απο|κατω απο)?\s*(\d+(?:[.,]\d+)?)\s*(mg|μg|µg|g|γρ|kcal|kj)?/iu.exec(rest);
  if (!m) return null;
  return { value: num(m[2]!), unit: m[3] ? m[3].toLowerCase().replace('γρ', 'g') : null, lessThan: !!m[1] };
}

interface Rule { field: LabelTextField; match: RegExp; not?: RegExp }

// Matched against folded text (lower-case, no accents, ς→σ). Order matters: specific before general.
const RULES: Rule[] = [
  { field: 'satFat', match: /κορεσμεν|saturat|satur/, not: /unsat|ακορεστ|trans/ },
  { field: 'fat', match: /λιπαρ|λιπη|λιποσ|\bfat\b|fats\b|lipid/, not: /κορεσμεν|saturat|ακορεστ|trans|unsat|cholest/ },
  { field: 'sugars', match: /σακχαρ|sugar/, not: /added|προστεθ|πολυολ|polyol/ },
  { field: 'carbs', match: /υδατανθρακ|carbohydrate|\bcarbs?\b/, not: /σακχαρ|sugar/ },
  { field: 'fiber', match: /φυτικ|(^|[^\p{L}])ινεσ|fib(re|er)/u },
  { field: 'protein', match: /πρωτειν|protein/ },
  { field: 'salt', match: /αλατι|\bsalt\b/ },
  { field: 'sodiumMg', match: /νατριο|sodium/ },
];

export function parseLabelText(raw: string): LabelText {
  const warnings: string[] = [];
  const lines = fixDigits(raw).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = fold(lines.join('\n'));
  const flatL = latinize(flat);
  const fields: LabelText['fields'] = {};

  const isUs = /nutrition facts|serving size|daily value|total carbohydrate/.test(flat) && !/100 ?g\b|100 ?ml\b|100 ?γρ/.test(flat);
  const per100ml = /(ανα|per|\/)\s*100 ?m[lι1i]\b|100 ?m[lι1i]\b/.test(flat);
  const per100g = /(ανα|per|\/)\s*100 ?(g|γρ)\b|100 ?(g|γρ)\b/.test(flat);
  const basis: LabelText['basis'] = isUs ? 'perServing' : per100ml && !per100g ? 'per100ml' : per100g ? 'per100g' : per100ml ? 'per100ml' : null;
  const region: LabelText['region'] = isUs ? 'us' : basis ? 'eu' : null;

  // Energy: the first kcal / kJ figures (the first column is the per-100 or per-serving one).
  // "kcal" survives OCR as kcai, koal, keal… — a k, a c-like letter, an a, an l-like letter.
  const kcal = /(\d+(?:[.,]\d+)?)\s*k\s?[coe(][a][l1i|]/.exec(flatL);
  if (kcal) fields.energyKcal = { value: num(kcal[1]!), lessThan: false, line: lineOf(lines, kcal[1]!, /kca/i) };
  const kj = /(\d{1,2}[ .]\d{3}|\d+(?:[.,]\d+)?)\s*k\s?[jJ)]/.exec(flatL);
  if (kj) {
    const v = /^\d{1,2}[ .]\d{3}$/.test(kj[1]!) ? Number(kj[1]!.replace(/[ .]/, '')) : num(kj[1]!);
    fields.energyKj = { value: v, lessThan: false, line: lineOf(lines, kj[1]!, /kj/i) };
  }
  if (!fields.energyKcal && isUs) {
    const c = /calories\s*(\d+)/.exec(flatL);
    if (c) fields.energyKcal = { value: Number(c[1]), lessThan: false, line: lineOf(lines, c[1]!, /calories/i) };
  }

  const normLines = lines.map(fold);
  const latLines = normLines.map(latinize);
  const hit = (r: Rule, i: number) => {
    if (r.not && (r.not.test(normLines[i]!) || r.not.test(latLines[i]!))) return null;
    const m = r.match.exec(normLines[i]!);
    if (m) return { l: normLines[i]!, m };
    const ml = r.match.exec(latLines[i]!);
    return ml ? { l: latLines[i]!, m: ml } : null;
  };
  for (const rule of RULES) {
    for (let i = 0; i < normLines.length; i++) {
      const h = hit(rule, i);
      if (!h) continue;
      const { l, m } = h;
      let a = firstAmount(l.slice(m.index + m[0].length));
      let line = lines[i]!;
      // "Λιπαρά" on one line, "Fat 9,5 g" or just "9,5 g" on the next.
      if (!a && i + 1 < normLines.length && !RULES.some((r) => r !== rule && hit(r, i + 1))) {
        a = firstAmount(normLines[i + 1]!);
        line = `${lines[i]} ${lines[i + 1]}`;
      }
      if (!a || a.unit === 'kcal' || a.unit === 'kj') continue;
      let value = a.value;
      if (rule.field === 'sodiumMg') value = a.unit === 'g' ? a.value * 1000 : a.value;
      else if (a.unit === 'mg') value = a.value / 1000;
      fields[rule.field] = { value, lessThan: a.lessThan, line };
      break;
    }
  }

  // Serving size ("Serving size 2/3 cup (55g)", "Μερίδα 30 g", "per portion (250 ml)").
  let servingG: number | null = null, servingMl: number | null = null;
  const sv = /(serving size|μεριδα|portion|serving)[^\n\d]{0,30}?(?:\d+\/\d+\s*\w+\s*)?\(?\s*(\d+(?:[.,]\d+)?)\s*(g|γρ|ml|m[lι1])\b/.exec(flat);
  if (sv) { if (sv[3]!.startsWith('m')) servingMl = num(sv[2]!); else servingG = num(sv[2]!); }

  // Plausibility: per 100 g no single macro exceeds 100 g, and energy stays under 900 kcal / 3,800 kJ.
  const per100 = basis === 'per100g' || basis === 'per100ml';
  for (const k of ['fat', 'satFat', 'carbs', 'sugars', 'fiber', 'protein', 'salt'] as const) {
    const f = fields[k];
    if (f && per100 && f.value > 100) { warnings.push(`Ignored ${k} = ${f.value} g (more than 100 g per 100 — probably misread).`); delete fields[k]; }
  }
  if (fields.energyKcal && per100 && fields.energyKcal.value > 900) { warnings.push(`Ignored ${fields.energyKcal.value} kcal (impossible per 100).`); delete fields.energyKcal; }
  if (fields.energyKj && per100 && fields.energyKj.value > 3800) { warnings.push(`Ignored ${fields.energyKj.value} kJ (impossible per 100).`); delete fields.energyKj; }
  if (fields.satFat && fields.fat && fields.satFat.value > fields.fat.value + 1e-9) warnings.push('Saturated fat is higher than total fat — one of them was probably misread.');
  if (fields.sugars && fields.carbs && fields.sugars.value > fields.carbs.value + 1e-9) warnings.push('Sugars are higher than carbohydrate — one of them was probably misread.');
  for (const [k, f] of Object.entries(fields)) if (f?.lessThan) warnings.push(`${k} is printed as “less than ${f.value}” — entered as ${f.value}, the most it can be.`);
  if (!Object.keys(fields).length) warnings.push('No nutrition values found in the photo. Try again closer, with the table filling the frame and no glare.');
  if (!basis && Object.keys(fields).length) warnings.push('Could not tell whether the values are per 100 g, per 100 mL or per serving — choose the column below.');
  return { basis, region, servingG, servingMl, fields, warnings };
}

function lineOf(lines: readonly string[], number: string, hint: RegExp): string {
  return lines.find((l) => l.includes(number) && hint.test(l)) ?? lines.find((l) => l.includes(number)) ?? number;
}
