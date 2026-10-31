import { db, live, type DayEvent, type ReplanChange } from './db';
import { addEntry, listDay, restore, softDelete, updateEntry } from './entries';
import { batchUsage, listBatches } from './kitchen';
import { stockByFood } from './pantry';
import { targetsFor } from './plan';
import { nowIso, uuidv7 } from './ids';
import { DEFAULT_SLOTS } from './profile';
import type { LogEntry, Profile, Slot } from './types';
import { dayTotals } from '../domain/diary';
import { MACROS, type Candidate, type Macro, type ReplanInput, type ReplanMode, type ReplanResult } from '../domain/planning/replan-model';
import { displayName, type Food, type Quantity } from '../domain/nutrition/food';
import { resolveQuantity } from '../domain/nutrition/quantity';
import { addDays, type DayKey } from '../domain/time';

/** Everything the replan sheet needs about a day, read once. */
export interface ReplanSetup {
  dayKey: DayKey;
  targets: Record<Macro, number> | null;
  eaten: Record<Macro, number>;
  /** Still-planned entries of the day (the only ones a replan may change). */
  planned: LogEntry[];
  slots: Slot[];
  /** Grams available per food id, from the pantry or a cooked batch. */
  stock: Map<string, StockInfo>;
  /** Pantry foods and batches not already planned today, offered as additions. */
  offers: Offer[];
}
export interface StockInfo { grams: number; source: 'pantry' | 'batch'; expiresOn: string | null; approx: boolean }
export interface Offer { food: Food; stockG: number; source: 'pantry' | 'batch'; expiresOn: string | null; approx: boolean }

export type Choice = 'adjust' | 'keep' | 'drop';
export interface AddedFood { key: string; food: Food; slotId: string; unit: 'g' | 'ml' | 'portion'; portionId?: string }

export async function loadReplanSetup(p: Profile, dayKey: DayKey): Promise<ReplanSetup> {
  const entries = await listDay(dayKey);
  const record = await db().days.get(dayKey);
  const t = await targetsFor(p, dayKey, record?.dayType ?? p.defaultDayType);
  const totals = dayTotals(entries);
  const eaten = Object.fromEntries(MACROS.map((m) => [m, totals.eaten[m].value])) as Record<Macro, number>;
  const planned = entries.filter((e) => live(e) && e.status === 'planned');
  const base = record?.slots?.length ? [...record.slots] : (p.defaultSlots.length ? p.defaultSlots : DEFAULT_SLOTS).map((s) => ({ ...s }));
  for (const e of entries) if (!base.some((s) => s.id === e.slotId)) base.push({ id: e.slotId, name: 'Other' });

  const stock = new Map<string, StockInfo>();
  const offers: Offer[] = [];
  const plannedIds = new Set(planned.map((e) => e.foodId));
  for (const [foodId, s] of await stockByFood()) {
    stock.set(foodId, { grams: s.grams, source: 'pantry', expiresOn: s.expiresOn, approx: s.approx });
    if (!plannedIds.has(foodId) && s.grams > 0) offers.push({ food: s.items[0]!.food as Food, stockG: s.grams, source: 'pantry', expiresOn: s.expiresOn, approx: s.approx });
  }
  for (const b of await listBatches()) {
    const u = await batchUsage(b);
    // Today's planned portions of this batch are being re-decided, so they count as available.
    const todayG = planned.filter((e) => e.foodId === b.id).reduce((s, e) => {
      const r = resolveQuantity(b, e.qty);
      return s + (r.ok && r.grams !== null ? r.grams : 0);
    }, 0);
    const g = Math.max(0, (b.recipe?.totalG ?? 0) - u.eatenG - (u.plannedG - todayG));
    stock.set(b.id, { grams: g, source: 'batch', expiresOn: b.recipe?.cookedOn ? addDays(b.recipe.cookedOn, 4) : null, approx: false });
    if (!plannedIds.has(b.id) && g > 0) offers.push({ food: b, stockG: g, source: 'batch', expiresOn: b.recipe?.cookedOn ? addDays(b.recipe.cookedOn, 4) : null, approx: false });
  }
  offers.sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));
  const targets = t ? { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat } : null;
  return { dayKey, targets, eaten, planned, slots: base, stock, offers };
}

const isEggLike = (f: Food) => /(^|[-:])egg(-|$)/.test(f.id) || /\begg\b/i.test(f.names.en);

/** The most of one food a replan may propose in one go — a sensible serving, never "800 g of rice". */
export function practicalMax(food: Food, unit: Candidate['unit'], current: number): number {
  if (unit === 'portion') return isEggLike(food) ? Math.max(current, 6) : Math.max(current * 2, current + 2, 3);
  if (food.recipe) return Math.max(current * 1.5, 600);
  const cap = food.prep === 'dry' ? 160
    : ({ protein: 350, dairy: 500, starch: 450, fruit: 400, veg: 500, fat: 30, sweet: 80, drink: 600, other: 250 } as const)[food.group];
  return Math.round(Math.max(cap, current * 1.5));
}

const gPerUnit = (food: Food, unit: Candidate['unit'], portionId?: string): number | null => {
  const r = resolveQuantity(food, unit === 'portion' ? { amount: 1, unit: 'portion', portionId: portionId ?? 'unit' } : { amount: 1, unit });
  return r.ok ? r.grams : null;
};

export function daysUntil(today: DayKey, day: string | null): number | null {
  if (!day) return null;
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export function buildReplanInput(setup: ReplanSetup, opts: {
  mode: ReplanMode; choices: Record<string, Choice>; added: readonly AddedFood[]; pantryOnly: boolean; maxMealKcal: number | null; today: DayKey;
}): ReplanInput {
  const t = setup.targets ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const remaining = Object.fromEntries(MACROS.map((m) => [m, t[m] - setup.eaten[m]])) as Record<Macro, number>;
  const stocks: Record<string, number> = {};
  for (const [foodId, s] of setup.stock) stocks[foodId] = s.grams;
  const make = (key: string, food: Food, unit: Candidate['unit'], portionId: string | undefined, current: number, slotId: string, choice: Choice): Candidate => {
    const s = setup.stock.get(food.id);
    const c: Candidate = {
      key, food, unit, current, slotId, min: 0, max: practicalMax(food, unit, current),
      gPerUnit: gPerUnit(food, unit, portionId), integer: unit === 'portion' && isEggLike(food),
      expiresInDays: daysUntil(opts.today, s?.expiresOn ?? null),
    };
    if (portionId) c.portionId = portionId;
    if (s) c.stockKey = food.id;
    if (choice === 'keep') { c.min = current; c.max = current; }
    else if (choice === 'drop') { c.min = 0; c.max = 0; }
    else if (opts.pantryOnly && !s) { c.max = 0; c.blocked = 'not in your pantry'; }
    return c;
  };
  const candidates = [
    ...setup.planned.map((e) => make(e.id, e.food as Food, e.qty.unit, e.qty.unit === 'portion' ? e.qty.portionId : undefined, e.qty.amount, e.slotId, opts.choices[e.id] ?? 'adjust')),
    ...opts.added.map((a) => make(a.key, a.food, a.unit, a.portionId, 0, a.slotId, opts.choices[a.key] ?? 'adjust')),
  ];
  return { remaining, candidates, mode: opts.mode, stocks, maxMealKcal: opts.maxMealKcal };
}

const qtyFor = (base: Quantity | { unit: Candidate['unit']; portionId?: string }, amount: number): Quantity =>
  base.unit === 'portion' ? { amount, unit: 'portion', portionId: ('portionId' in base && base.portionId) || 'unit' } : { amount, unit: base.unit };

/** Writes a replan in one transaction and records it, so it can be reverted. Eaten food is never touched. */
export async function applyReplan(setup: ReplanSetup, result: ReplanResult, added: readonly AddedFood[], mode: ReplanMode, modeLabel: string): Promise<DayEvent | null> {
  const d = db();
  const changes: ReplanChange[] = [];
  await d.transaction('rw', [d.entries, d.days, d.events], async () => {
    for (const it of result.items) {
      if (Math.abs(it.to - it.from) < 1e-9) continue;
      const entry = setup.planned.find((e) => e.id === it.key);
      if (entry) {
        const cur = await d.entries.get(entry.id);
        if (!live(cur) || cur.status !== 'planned') continue; // eaten or deleted meanwhile: hands off
        if (it.to === 0) {
          await softDelete(entry.id);
          changes.push({ entryId: entry.id, kind: 'removed', foodName: displayName(entry.food), from: cur.qty, to: null });
        } else {
          const to = qtyFor(cur.qty, it.to);
          await updateEntry(entry.id, { qty: to });
          changes.push({ entryId: entry.id, kind: 'updated', foodName: displayName(entry.food), from: cur.qty, to });
        }
        continue;
      }
      const a = added.find((x) => x.key === it.key);
      if (!a || it.to === 0) continue;
      const qty = qtyFor(a.portionId ? { unit: a.unit, portionId: a.portionId } : { unit: a.unit }, it.to);
      const e = await addEntry({ dayKey: setup.dayKey, slotId: a.slotId, food: a.food, qty, status: 'planned', origin: 'replan' });
      changes.push({ entryId: e.id, kind: 'added', foodName: displayName(a.food), from: null, to: qty });
    }
    if (!changes.length) return;
    const t = nowIso();
    await d.events.put({
      id: uuidv7(), kind: 'replan', dayKey: setup.dayKey, at: t, mode, summary: `${modeLabel}: ${changes.length} change${changes.length > 1 ? 's' : ''}`,
      changes, revertedAt: null, createdAt: t, updatedAt: t, deletedAt: null, rev: 1,
    });
  });
  if (!changes.length) return null;
  return (await d.events.where('dayKey').equals(setup.dayKey).toArray()).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

/** Undoes a replan. Entries the user changed or ate since are left alone (and counted). */
export async function revertReplan(eventId: string): Promise<{ reverted: number; skipped: number }> {
  const d = db();
  let reverted = 0, skipped = 0;
  await d.transaction('rw', [d.entries, d.events], async () => {
    const ev = await d.events.get(eventId);
    if (!ev || ev.revertedAt) return;
    for (const ch of ev.changes) {
      const e = await d.entries.get(ch.entryId);
      if (!e) { skipped += 1; continue; }
      if (ch.kind === 'updated') {
        if (live(e) && e.status === 'planned' && ch.to && e.qty.amount === ch.to.amount && ch.from) { await updateEntry(e.id, { qty: ch.from }); reverted += 1; } else skipped += 1;
      } else if (ch.kind === 'added') {
        if (live(e) && e.status === 'planned') { await softDelete(e.id); reverted += 1; } else skipped += 1;
      } else if (e.deletedAt) { await restore(e.id); reverted += 1; } else skipped += 1;
    }
    await d.events.put({ ...ev, revertedAt: nowIso(), updatedAt: nowIso(), rev: ev.rev + 1 });
  });
  return { reverted, skipped };
}

export async function listDayEvents(dayKey: DayKey): Promise<DayEvent[]> {
  return (await db().events.where('dayKey').equals(dayKey).toArray()).filter(live).sort((a, b) => b.at.localeCompare(a.at));
}
