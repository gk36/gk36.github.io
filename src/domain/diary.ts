import { contribution } from './nutrition/compute';
import { sumNutrients, type Totals } from './nutrition/compute';
import type { NutrientMap } from './nutrition/food';
import { compositeParts } from './kitchen/recipe';
import type { LogEntry } from '../data/types';

export interface EntryNutrients {
  id: string;
  /** Known totals for the entry (for display). */
  n: NutrientMap;
  /** What totals should sum: the food itself, or each ingredient of a recipe/batch portion. */
  parts: NutrientMap[];
  error?: string;
  carbsExcludeUnknownFiber: boolean;
}

export function entryNutrients(e: Pick<LogEntry, 'id' | 'food' | 'qty'>): EntryNutrients {
  const c = contribution(e.food, e.qty);
  if ('error' in c) return { id: e.id, n: {}, parts: [], error: c.error, carbsExcludeUnknownFiber: false };
  const parts = e.food.recipe ? compositeParts(e.food, e.qty) : null;
  return { id: e.id, n: c.n, parts: parts ?? [c.n], carbsExcludeUnknownFiber: c.carbsExcludeUnknownFiber };
}

export interface DayTotals {
  /** Only food marked eaten. Plans never count as eaten. */
  eaten: Totals;
  /** Planned and not yet eaten (skipped entries count nowhere). */
  planned: Totals;
  /** eaten + planned: where the day lands if the rest of the plan is eaten. */
  projected: Totals;
  eatenCount: number;
  plannedCount: number;
  /** Eaten EU-label foods whose carbs exclude fibre that is unknown. */
  carbsCaveat: number;
}

export function dayTotals(entries: readonly LogEntry[]): DayTotals {
  const eaten: NutrientMap[] = [];
  const planned: NutrientMap[] = [];
  let carbsCaveat = 0;
  for (const e of entries) {
    if (e.deletedAt) continue;
    const r = entryNutrients(e);
    if (e.status === 'eaten') {
      eaten.push(...r.parts);
      if (r.carbsExcludeUnknownFiber) carbsCaveat += 1;
    } else if (e.status === 'planned') planned.push(...r.parts);
  }
  return {
    eaten: sumNutrients(eaten),
    planned: sumNutrients(planned),
    projected: sumNutrients([...eaten, ...planned]),
    eatenCount: eaten.length,
    plannedCount: planned.length,
    carbsCaveat,
  };
}
