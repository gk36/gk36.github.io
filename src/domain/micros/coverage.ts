import type { NutrientId } from '../nutrition/nutrients';
import type { Totals } from '../nutrition/compute';
import type { Reference } from './dri';

export type CoverageStatus = 'met' | 'partial' | 'low' | 'unknown' | 'no-target' | 'over-ul' | 'over-limit';

export interface NutrientCoverage {
  id: NutrientId;
  /** Sum of KNOWN amounts — a lower bound when `unknown` > 0. */
  amount: number;
  known: number;
  unknown: number;
  energyShare: number;
  ref: Reference | null;
  /** amount ÷ target (null without a target). */
  pct: number | null;
  status: CoverageStatus;
}

/**
 * Coverage against reference intakes without inventing data:
 * - nothing known → "unknown" (never 0 %),
 * - some foods unknown → the % is a lower bound ("at least"),
 * - above a food-relevant upper limit / sodium's CDRR → flagged, never scored as "better".
 */
export function coverageFor(totals: Totals, refs: ReadonlyMap<NutrientId, Reference> | null, ids: readonly NutrientId[]): NutrientCoverage[] {
  return ids.map((id) => {
    const t = totals[id];
    const ref = refs?.get(id) ?? null;
    const pct = ref?.target ? t.value / ref.target : null;
    let status: CoverageStatus;
    if (t.known === 0 && t.unknown > 0) status = 'unknown';
    else if (ref?.ul !== null && ref?.ul !== undefined && t.value > ref.ul) status = 'over-ul';
    else if (ref?.limit !== null && ref?.limit !== undefined && t.value > ref.limit) status = 'over-limit';
    else if (pct === null) status = 'no-target';
    else if (pct >= 1) status = 'met';
    else if (pct >= 0.5) status = 'partial';
    else status = 'low';
    return { id, amount: t.value, known: t.known, unknown: t.unknown, energyShare: t.energyShare, ref, pct, status };
  });
}

export interface Contributor { key: string; label: string; amount: number; share: number }

/** Largest contributors to one nutrient (items without data are listed separately by the caller). */
export function topContributors(items: readonly { key: string; label: string; value: number | undefined }[], limit = 8): Contributor[] {
  const known = items.filter((i): i is { key: string; label: string; value: number } => i.value !== undefined && i.value > 0);
  const total = known.reduce((s, i) => s + i.value, 0);
  return known
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((i) => ({ key: i.key, label: i.label, amount: i.value, share: total > 0 ? i.value / total : 0 }));
}

/** Average of daily totals over the days that have food (days with nothing logged are skipped, not zeros). */
export function averageTotals(days: readonly Totals[]): Totals | null {
  if (!days.length) return null;
  const first = days[0]!;
  const out = {} as Totals;
  for (const id of Object.keys(first) as NutrientId[]) {
    const vals = days.map((d) => d[id]);
    out[id] = {
      value: vals.reduce((s, v) => s + v.value, 0) / days.length,
      known: vals.reduce((s, v) => s + v.known, 0),
      unknown: vals.reduce((s, v) => s + v.unknown, 0),
      energyShare: vals.reduce((s, v) => s + v.energyShare, 0) / days.length,
    };
  }
  return out;
}
