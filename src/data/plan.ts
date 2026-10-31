import { db } from './db';
import { nowIso } from './ids';
import { addEntry, ensureDay, listDay, updateDay } from './entries';
import type { DayTargets, Profile, Slot } from './types';
import { coreFoods } from './foods/registry';
import { plannerInput } from './profile';
import { bindPlanFoods, type PlanBinding } from '../domain/planning/plan-foods';
import { computePlan, planMeals, r0, type PlanMeal, type PlannerInput, type PlanResult } from '../domain/planning/template';
import type { DayKey } from '../domain/time';
import type { Food, Quantity } from '../domain/nutrition/food';

let binding: Promise<PlanBinding> | null = null;
export function planBinding(): Promise<PlanBinding> {
  binding ??= coreFoods().then((list) => bindPlanFoods(new Map(list.map((f) => [f.id, f]))));
  return binding;
}

export interface DayPlan {
  input: PlannerInput;
  result: PlanResult;
  meals: PlanMeal[];
  /** Each plan item resolved to a real food + quantity (null if a food is unavailable). */
  items: { meal: PlanMeal; label: string; food: Food; qty: Quantity }[];
  unresolved: string[];
  targets: DayTargets;
}

export function targetsFromPlan(r: PlanResult, label: string): DayTargets {
  return {
    kcal: r0(r.cal), protein: r.protein, carbs: r0(r.planC), fat: r.fat, source: 'template', label,
    bmr: r0(r.bmr), tdee: r0(r.tdee), computedAt: nowIso(),
  };
}

export function planLabel(r: PlanResult): string {
  return `${r.g.label} · ${r.rest ? 'rest day' : `gym day · ${r.T.label.toLowerCase()}`}`;
}

export async function buildDayPlan(p: Profile, dayKey: DayKey, dayType: 'gym' | 'rest'): Promise<DayPlan | { missing: string[] }> {
  const input = plannerInput(p, dayKey, dayType);
  if ('missing' in input) return input;
  const b = await planBinding();
  const result = computePlan(input, b.tables);
  const meals = planMeals(input, b.tables, result);
  const items: DayPlan['items'] = [];
  const unresolved: string[] = [...b.missing];
  for (const meal of meals) {
    for (const it of meal.items) {
      const r = b.resolve(it.foodId, it.group, it.amount);
      if (r) items.push({ meal, label: it.label, food: r.food, qty: r.qty });
      else unresolved.push(`${meal.name}: ${it.label}`);
    }
  }
  return { input, result, meals, items, unresolved, targets: targetsFromPlan(result, planLabel(result)) };
}

/** Today's targets: the stored snapshot, else computed from the profile (not stored until used). */
export async function targetsFor(p: Profile, dayKey: DayKey, dayType: 'gym' | 'rest'): Promise<DayTargets | null> {
  const day = await db().days.get(dayKey);
  if (day && !day.deletedAt && day.targets) return day.targets;
  if (p.targetMode === 'manual' && p.manualTargets) {
    return { ...p.manualTargets, source: 'manual', label: 'Manual targets', computedAt: nowIso() };
  }
  const plan = await buildDayPlan(p, dayKey, dayType);
  return 'missing' in plan ? null : plan.targets;
}

/** Freezes the day's targets the first time something is logged, so history never shifts. */
export async function freezeTargets(p: Profile, dayKey: DayKey): Promise<void> {
  const day = await ensureDay(dayKey);
  if (day.targets) return;
  const t = await targetsFor(p, dayKey, day.dayType ?? p.defaultDayType);
  if (t) await updateDay(dayKey, { targets: t });
}

/**
 * Writes the plan into the diary as PLANNED entries. Replaces only entries a previous plan
 * created that are still untouched (origin 'plan', status 'planned'); eaten, skipped and
 * manually added entries are never removed.
 */
export async function applyPlan(dayKey: DayKey, plan: DayPlan): Promise<number> {
  const day = await ensureDay(dayKey);
  const existing = await listDay(dayKey);
  const stale = existing.filter((e) => e.origin === 'plan' && e.status === 'planned');
  const t = nowIso();
  const planSlots: Slot[] = plan.meals.map((m) => ({ id: `plan-${m.id}`, name: m.name, time: m.time, badge: m.badge }));
  const keepIds = new Set(existing.filter((e) => !stale.includes(e)).map((e) => e.slotId));
  const kept = day.slots.filter((s) => keepIds.has(s.id) && !planSlots.some((ps) => ps.id === s.id));
  await db().transaction('rw', [db().entries, db().days], async () => {
    for (const e of stale) await db().entries.put({ ...e, deletedAt: t, updatedAt: t, rev: e.rev + 1 });
  });
  await updateDay(dayKey, {
    slots: [...planSlots, ...kept], dayType: plan.input.day, targets: plan.targets, planInput: plan.input,
  });
  let n = 0;
  for (const it of plan.items) {
    await addEntry({ dayKey, slotId: `plan-${it.meal.id}`, food: it.food, qty: it.qty, status: 'planned', origin: 'plan' });
    n += 1;
  }
  return n;
}
