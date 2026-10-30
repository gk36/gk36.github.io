import type { Food } from '../nutrition/food';

/**
 * Types and constants of the replan model, kept free of the solver so screens and the data layer can
 * use them without loading it (the solver is fetched only when the replan sheet opens).
 */

export type Macro = 'kcal' | 'protein' | 'carbs' | 'fat';
export const MACROS: readonly Macro[] = ['kcal', 'protein', 'carbs', 'fat'];
export type ReplanMode = 'closest' | 'protein' | 'micros' | 'filling' | 'lowSatFat' | 'expiring';

export const MODES: readonly { key: ReplanMode; label: string; what: string }[] = [
  { key: 'closest', label: 'Closest to plan', what: 'Changes your planned amounts as little as possible.' },
  { key: 'protein', label: 'Protein first', what: 'Reaching your protein target outranks everything else (it still won\'t overshoot it on purpose).' },
  { key: 'micros', label: 'More micronutrients', what: 'Prefers foods with more fibre, potassium, magnesium, calcium, iron, folate, vitamins A and C per calorie. Unknown values earn no credit.' },
  { key: 'filling', label: 'Most filling', what: 'Prefers foods with fewer calories per gram and more protein and fibre per calorie.' },
  { key: 'lowSatFat', label: 'Lowest saturated fat', what: 'Prefers foods with less saturated fat. When it is unknown, all of the food\'s fat is counted as saturated.' },
  { key: 'expiring', label: 'Use expiring food', what: 'Prefers pantry items that expire within the next few days.' },
];

export interface Candidate {
  key: string;
  food: Food;
  /** How the amount is expressed: grams, mL, or portions (eggs, slices, servings). */
  unit: 'g' | 'ml' | 'portion';
  portionId?: string;
  /** Current planned amount (0 for a newly offered food). */
  current: number;
  min: number;
  max: number;
  /** Entries sharing a key share one stock (the same pantry food or batch). */
  stockKey?: string;
  /** Grams in one unit of `unit` (needed to count against a stock). */
  gPerUnit?: number | null;
  /** Slot the food is eaten in (for the per-meal cap). */
  slotId?: string;
  integer?: boolean;
  /** Days until a pantry item expires (for "Use expiring food"). */
  expiresInDays?: number | null;
  /** Why max is 0, when it was forced (e.g. "not in your pantry"). */
  blocked?: string;
}

export interface ReplanInput {
  /** Target minus what was eaten; negative = already over. */
  remaining: Record<Macro, number>;
  candidates: readonly Candidate[];
  mode: ReplanMode;
  /** Grams available per stockKey. */
  stocks?: Record<string, number>;
  /** Optional cap on any single meal's calories (no enormous last meal). */
  maxMealKcal?: number | null;
}

export type Limit = 'stock' | 'max' | 'kept' | 'blocked' | null;
export interface ReplanItem {
  key: string;
  from: number;
  to: number;
  unit: Candidate['unit'];
  /** What this food gives at the new amount. */
  n: Record<Macro, number>;
  limit: Limit;
  reason: string | null;
}
export type MacroStatus = 'ok' | 'short' | 'over';
export interface ReplanResult {
  feasible: boolean;
  items: ReplanItem[];
  /** Remaining target the model aimed at (never below zero). */
  target: Record<Macro, number>;
  totals: Record<Macro, number>;
  /** target − totals (positive = short, negative = over). */
  gap: Record<Macro, number>;
  status: Record<Macro, MacroStatus>;
  /** Tolerance used for each macro: within it counts as on target. */
  band: Record<Macro, { under: number; over: number }>;
  notes: string[];
}

/** Tolerance per macro: inside it, the day counts as on target. */
export function bands(target: Record<Macro, number>): Record<Macro, { under: number; over: number }> {
  const k = Math.max(30, Math.round(target.kcal * 0.03));
  return { kcal: { under: k, over: k }, protein: { under: 5, over: 15 }, carbs: { under: 10, over: 10 }, fat: { under: 5, over: 5 } };
}
