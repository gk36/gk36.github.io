import { db } from './db';
import { nowIso, uuidv7 } from './ids';
import type { DayRecord, EntryOrigin, EntryStatus, FoodSnapshot, LogEntry, Slot } from './types';
import type { Food, Quantity } from '../domain/nutrition/food';
import { displayName } from '../domain/nutrition/food';
import type { DayKey } from '../domain/time';
import { loadProfile } from './profile';

export function snapshotOf(food: Food | FoodSnapshot): FoodSnapshot {
  const { createdAt: _c, updatedAt: _u, deletedAt: _d, rev: _r, ...snap } = food as Food;
  return JSON.parse(JSON.stringify(snap)) as FoodSnapshot;
}

const bump = <T extends { rev: number }>(r: T, patch: Partial<NoInfer<T>>): T => ({ ...r, ...patch, rev: r.rev + 1, updatedAt: nowIso() });

/* ---------------- days ---------------- */

export async function getDay(dayKey: DayKey): Promise<DayRecord | undefined> {
  const d = await db().days.get(dayKey);
  return d && !d.deletedAt ? d : undefined;
}

/** Returns the day, creating it from the profile's default meal slots if needed. */
export async function ensureDay(dayKey: DayKey): Promise<DayRecord> {
  const existing = await getDay(dayKey);
  if (existing) return existing;
  const p = await loadProfile();
  const t = nowIso();
  const day: DayRecord = { dayKey, slots: p.defaultSlots.map((s) => ({ ...s })), dayType: p.defaultDayType, createdAt: t, updatedAt: t, rev: 1 };
  await db().days.put(day);
  return day;
}

export async function updateDay(dayKey: DayKey, patch: Partial<Omit<DayRecord, 'dayKey'>>): Promise<DayRecord> {
  const d = await ensureDay(dayKey);
  const next = bump(d, patch);
  await db().days.put(next);
  return next;
}

export async function addSlot(dayKey: DayKey, name: string, time?: string): Promise<Slot> {
  const d = await ensureDay(dayKey);
  const slot: Slot = time ? { id: uuidv7(), name, time } : { id: uuidv7(), name };
  await updateDay(dayKey, { slots: [...d.slots, slot] });
  return slot;
}

/* ---------------- entries ---------------- */

export async function listDay(dayKey: DayKey): Promise<LogEntry[]> {
  const rows = await db().entries.where('dayKey').equals(dayKey).toArray();
  return rows.filter((e) => !e.deletedAt).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export interface NewEntry {
  dayKey: DayKey;
  slotId: string;
  food: Food | FoodSnapshot;
  qty: Quantity;
  status: EntryStatus;
  origin: EntryOrigin;
  time?: string;
  note?: string;
  planned?: LogEntry['planned'];
}

async function nextOrder(dayKey: DayKey, slotId: string): Promise<number> {
  const rows = await db().entries.where('[dayKey+slotId]').equals([dayKey, slotId]).toArray();
  return rows.reduce((m, e) => Math.max(m, e.order), 0) + 1;
}

export async function addEntry(input: NewEntry): Promise<LogEntry> {
  await ensureDay(input.dayKey);
  const t = nowIso();
  const e: LogEntry = {
    id: uuidv7(), dayKey: input.dayKey, slotId: input.slotId, order: await nextOrder(input.dayKey, input.slotId),
    foodId: input.food.id, food: snapshotOf(input.food), qty: { ...input.qty }, status: input.status, origin: input.origin,
    createdAt: t, updatedAt: t, rev: 1, deletedAt: null,
  };
  if (input.time) e.time = input.time;
  if (input.note) e.note = input.note;
  if (input.planned) e.planned = input.planned;
  await db().entries.put(e);
  return e;
}

export async function getEntry(id: string): Promise<LogEntry | undefined> {
  const e = await db().entries.get(id);
  return e && !e.deletedAt ? e : undefined;
}

export async function updateEntry(id: string, patch: Partial<Pick<LogEntry, 'qty' | 'status' | 'slotId' | 'time' | 'note' | 'food' | 'foodId' | 'planned' | 'order' | 'dayKey'>>): Promise<LogEntry> {
  const e = await db().entries.get(id);
  if (!e || e.deletedAt) throw new Error('Entry not found');
  const next = bump(e, patch);
  await db().entries.put(next);
  return next;
}

/** Marks a planned entry eaten. If the amount or food changed, the original plan is kept for plan-vs-actual. */
export async function markEaten(id: string, actual?: { qty?: Quantity; food?: Food | FoodSnapshot }): Promise<LogEntry> {
  const e = await db().entries.get(id);
  if (!e || e.deletedAt) throw new Error('Entry not found');
  const qty = actual?.qty ?? e.qty;
  const food = actual?.food ? snapshotOf(actual.food) : e.food;
  const changed = JSON.stringify(qty) !== JSON.stringify(e.qty) || food.id !== e.food.id;
  const planned = e.status === 'planned' && changed ? { foodId: e.foodId, foodName: displayName(e.food), qty: e.qty } : e.planned;
  const patch: Partial<LogEntry> = { status: 'eaten', qty, food, foodId: food.id };
  if (planned) patch.planned = planned;
  const next = bump(e, patch);
  await db().entries.put(next);
  return next;
}

export async function softDelete(id: string): Promise<void> {
  const e = await db().entries.get(id);
  if (!e || e.deletedAt) return;
  await db().entries.put(bump(e, { deletedAt: nowIso() }));
}

export async function restore(id: string): Promise<void> {
  const e = await db().entries.get(id);
  if (!e || !e.deletedAt) return;
  await db().entries.put(bump(e, { deletedAt: null }));
}

export async function duplicateEntry(id: string): Promise<LogEntry> {
  const e = await getEntry(id);
  if (!e) throw new Error('Entry not found');
  const input: NewEntry = { dayKey: e.dayKey, slotId: e.slotId, food: e.food, qty: e.qty, status: e.status, origin: 'copy' };
  if (e.time) input.time = e.time;
  if (e.note) input.note = e.note;
  return addEntry(input);
}

export async function moveEntry(id: string, slotId: string, dayKey?: DayKey): Promise<LogEntry> {
  const e = await getEntry(id);
  if (!e) throw new Error('Entry not found');
  const targetDay = dayKey ?? e.dayKey;
  await ensureDay(targetDay);
  return updateEntry(id, { slotId, dayKey: targetDay, order: await nextOrder(targetDay, slotId) });
}

/**
 * Copies entries to another day. Slots are matched by id, then by name; missing slots are
 * created. Copies are new records (never shared), so editing one day never edits another.
 */
export async function copyEntries(entries: readonly LogEntry[], toDay: DayKey, status: EntryStatus, sourceSlots: readonly Slot[]): Promise<LogEntry[]> {
  const day = await ensureDay(toDay);
  const slots = [...day.slots];
  const resolveSlot = (slotId: string): string => {
    if (slots.some((s) => s.id === slotId)) return slotId;
    const src = sourceSlots.find((s) => s.id === slotId);
    const byName = src && slots.find((s) => s.name.toLowerCase() === src.name.toLowerCase());
    if (byName) return byName.id;
    const created: Slot = src ? { ...src, id: uuidv7() } : { id: uuidv7(), name: 'Copied' };
    slots.push(created);
    return created.id;
  };
  const mapped = entries.filter((e) => !e.deletedAt).map((e) => ({ e, slotId: resolveSlot(e.slotId) }));
  if (slots.length !== day.slots.length) await updateDay(toDay, { slots });
  const out: LogEntry[] = [];
  for (const { e, slotId } of mapped) {
    const input: NewEntry = { dayKey: toDay, slotId, food: e.food, qty: e.qty, status, origin: 'copy' };
    if (e.time) input.time = e.time;
    out.push(await addEntry(input));
  }
  return out;
}

/** Most recently logged foods (newest first), for one-tap repeat logging. */
export async function recentFoods(limit = 30): Promise<{ food: FoodSnapshot; qty: Quantity; at: string }[]> {
  const rows = await db().entries.orderBy('updatedAt').reverse().limit(400).toArray();
  const seen = new Set<string>();
  const out: { food: FoodSnapshot; qty: Quantity; at: string }[] = [];
  for (const e of rows) {
    if (e.deletedAt || seen.has(e.foodId)) continue;
    seen.add(e.foodId);
    out.push({ food: e.food, qty: e.qty, at: e.updatedAt });
    if (out.length >= limit) break;
  }
  return out;
}
