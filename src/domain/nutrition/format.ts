import { NUTRIENTS, type NutrientId } from './nutrients';
import type { NutrientTotal } from './compute';

/**
 * Display rounding. Values are stored and summed at full precision; rounding happens only
 * here, so totals come from unrounded numbers (rows may not add up visually — shown with ≈).
 */
export function roundFor(id: NutrientId, v: number): number {
  if (id === 'kcal') return Math.round(v);
  const def = NUTRIENTS[id];
  if (def.unit === 'g') {
    if (v >= 10) return Math.round(v);
    return Math.round(v * 10) / 10;
  }
  // mg / µg: 3 significant figures, never more decimals than the dictionary allows
  if (v === 0) return 0;
  const sig = Math.pow(10, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v)))));
  const cap = Math.pow(10, def.decimals);
  const factor = Math.min(sig, cap);
  return Math.round(v * factor) / factor;
}

export function fmtNum(v: number, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
}

export function fmtNutrient(id: NutrientId, v: number | undefined, opts: { unit?: boolean; locale?: string } = {}): string {
  if (v === undefined) return 'unknown';
  const r = roundFor(id, v);
  const s = fmtNum(r, opts.locale);
  if (opts.unit === false) return s;
  const u = NUTRIENTS[id].unit;
  return u === 'kcal' ? `${s} kcal` : `${s} ${u}`;
}

/** "120 mg", "≥ 120 mg" (some foods lack data) or "unknown" (no food reports it). */
export function fmtTotal(id: NutrientId, t: NutrientTotal, opts: { unit?: boolean; locale?: string } = {}): string {
  if (t.known === 0 && t.unknown > 0) return 'unknown';
  const base = fmtNutrient(id, t.value, opts);
  return t.unknown > 0 ? `≥ ${base}` : base;
}

export function coverageNote(t: NutrientTotal): string | null {
  if (t.unknown === 0) return null;
  const total = t.known + t.unknown;
  if (t.known === 0) return `no data for ${total === 1 ? 'this food' : `any of ${total} foods`}`;
  return `known for ${t.known} of ${total} foods`;
}
