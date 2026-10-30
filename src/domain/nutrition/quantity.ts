import type { Food, Portion, Quantity } from './food';

/**
 * Parses a user-typed amount. Accepts a decimal comma ("41,5"), a decimal point, simple
 * fractions ("1/2", "1 1/2") and surrounding spaces. Rejects negatives, NaN and junk.
 */
export function parseAmount(input: string): number | null {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const [, w, a, b] = mixed;
    return Number(b) === 0 ? null : Number(w) + Number(a) / Number(b);
  }
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const [, a, b] = frac;
    return Number(b) === 0 ? null : Number(a) / Number(b);
  }
  if (!/^\d+([.,]\d+)?$|^[.,]\d+$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type Resolved =
  | { ok: true; multiplier: number; grams: number | null; ml: number | null; approximate: boolean }
  | { ok: false; reason: string };

export function findPortion(food: Food, id: string): Portion | undefined {
  return food.portions.find((p) => p.id === id);
}

/**
 * How many "bases" of the food a quantity represents, so nutrients = food.n × multiplier.
 * Converting between grams and millilitres REQUIRES a known density — never assumed 1 g/mL.
 */
export function resolveQuantity(food: Food, qty: Quantity): Resolved {
  if (!(qty.amount >= 0) || !Number.isFinite(qty.amount)) return { ok: false, reason: 'Enter an amount of zero or more.' };
  const d = food.densityGPerMl;

  let grams: number | null = null;
  let ml: number | null = null;
  let units: number | null = null;

  if (qty.unit === 'g') grams = qty.amount;
  else if (qty.unit === 'ml') ml = qty.amount;
  else {
    if (food.basis.per === 'unit' && qty.portionId === 'unit') units = qty.amount;
    else {
      const p = findPortion(food, qty.portionId);
      if (!p) return { ok: false, reason: 'That portion no longer exists for this food.' };
      if (p.g !== undefined) grams = p.g * qty.amount;
      else if (p.ml !== undefined) ml = p.ml * qty.amount;
      else return { ok: false, reason: `"${p.label}" has no weight or volume.` };
    }
  }

  if (grams === null && ml !== null && d) grams = ml * d;
  if (ml === null && grams !== null && d) ml = grams / d;

  switch (food.basis.per) {
    case '100g':
      if (grams === null) return { ok: false, reason: 'This food is measured per 100 g and has no known density, so millilitres cannot be converted. Weigh it in grams.' };
      return { ok: true, multiplier: grams / 100, grams, ml, approximate: false };
    case '100ml':
      if (ml === null) return { ok: false, reason: 'This food is measured per 100 mL and has no known density, so grams cannot be converted. Measure it in millilitres.' };
      return { ok: true, multiplier: ml / 100, grams, ml, approximate: false };
    case 'unit': {
      if (units !== null) {
        const g = food.basis.unitG !== undefined ? units * food.basis.unitG : null;
        return { ok: true, multiplier: units, grams: g, ml: null, approximate: false };
      }
      const unitG = food.basis.unitG;
      if (grams !== null && unitG) return { ok: true, multiplier: grams / unitG, grams, ml, approximate: false };
      return { ok: false, reason: `This food is counted per ${food.basis.unitLabel}; enter a number of ${food.basis.unitLabel}s.` };
    }
  }
}

/**
 * A sensible first quantity. Weighed foods (meat, starch, dairy, sauces…) start in grams/mL because
 * that is how they are measured; foods eaten by the piece (fruit, eggs, per-serving items) start at
 * one piece.
 */
export function defaultQuantity(food: Food): Quantity {
  if (food.basis.per === 'unit') return { amount: 1, unit: 'portion', portionId: 'unit' };
  const p = food.portions[0];
  const byPiece = food.group === 'fruit' || /(^|[-:])egg(-|$)/.test(food.id) || /\begg\b/i.test(food.names.en);
  if (p && byPiece) return { amount: 1, unit: 'portion', portionId: p.id };
  return food.basis.per === '100ml' ? { amount: 100, unit: 'ml' } : { amount: 100, unit: 'g' };
}

export function describeQuantity(food: Food, qty: Quantity): string {
  const n = formatAmount(qty.amount);
  if (qty.unit === 'g') return `${n} g`;
  if (qty.unit === 'ml') return `${n} mL`;
  if (food.basis.per === 'unit' && qty.portionId === 'unit') return `${n} × ${food.basis.unitLabel}`;
  const p = findPortion(food, qty.portionId);
  return p ? `${n} × ${p.label}` : `${n} portion`;
}

export function formatAmount(x: number): string {
  if (Number.isInteger(x)) return String(x);
  return x < 10 ? String(Math.round(x * 100) / 100) : String(Math.round(x * 10) / 10);
}
