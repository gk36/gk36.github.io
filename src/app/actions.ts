import { addEntry, getEntry, markEaten, restore, revertEntry, softDelete, type NewEntry } from '../data/entries';
import { deductFromPantry, undoDeductions, type Deduction } from '../data/pantry';
import { freezeTargets } from '../data/plan';
import type { LogEntry } from '../data/types';
import { displayName, type Quantity } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { profile, toast } from './store';

let lastUndo: (() => Promise<void>) | null = null;
export const undoLast = async () => { const u = lastUndo; lastUndo = null; if (u) await u(); };
/** Makes Ctrl+Z undo something done outside these actions (a replan). */
export const rememberUndo = (u: () => Promise<void>) => { lastUndo = u; };

/** Pantry stock goes down when food is logged as eaten (unless turned off in the pantry). */
const pantryDeduct = async (e: LogEntry): Promise<Deduction[]> => (profile.value?.pantryDeduct === false ? [] : deductFromPantry(e.food, e.qty));
const pantryNote = (d: readonly Deduction[]) => (d.length ? ' · taken from the pantry' : '');

export async function logEntry(input: NewEntry): Promise<LogEntry> {
  const p = profile.value;
  if (p) await freezeTargets(p, input.dayKey);
  const e = await addEntry(input);
  const ded = e.status === 'eaten' ? await pantryDeduct(e) : [];
  const undo = async () => { await softDelete(e.id); await undoDeductions(ded); toast('Removed'); };
  lastUndo = undo;
  toast(`${input.status === 'planned' ? 'Planned' : 'Logged'} ${describeQuantity(e.food, e.qty)} ${displayName(e.food)}${pantryNote(ded)}`, { action: { label: 'Undo', run: undo }, tone: 'ok' });
  return e;
}

/** Logs several items at once (a typed meal, a meal idea) with one toast and one undo for all of them. */
export async function logEntries(inputs: readonly NewEntry[], label: string): Promise<LogEntry[]> {
  const p = profile.value;
  if (p && inputs[0]) await freezeTargets(p, inputs[0].dayKey);
  const made: LogEntry[] = [];
  const ded: Deduction[] = [];
  for (const input of inputs) {
    const e = await addEntry(input);
    made.push(e);
    if (e.status === 'eaten') ded.push(...(await pantryDeduct(e)));
  }
  const undo = async () => { for (const e of made) await softDelete(e.id); await undoDeductions(ded); toast('Removed'); };
  lastUndo = undo;
  toast(`${label}${pantryNote(ded)}`, { action: { label: 'Undo', run: undo }, tone: 'ok' });
  return made;
}

export async function deleteWithUndo(e: LogEntry): Promise<void> {
  await softDelete(e.id);
  const undo = async () => { await restore(e.id); toast('Restored'); };
  lastUndo = undo;
  toast(`Deleted ${displayName(e.food)}`, { action: { label: 'Undo', run: undo } });
}

/** Marks a planned entry eaten (optionally with the amount actually eaten); undo puts it back exactly. */
export async function eatEntry(e: LogEntry, actual?: { qty?: Quantity }): Promise<LogEntry> {
  const p = profile.value;
  if (p) await freezeTargets(p, e.dayKey);
  const before = (await getEntry(e.id)) ?? e;
  const next = await markEaten(e.id, actual);
  const ded = await pantryDeduct(next);
  const undo = async () => { await revertEntry(before); await undoDeductions(ded); toast('Back to planned'); };
  lastUndo = undo;
  toast(`Marked eaten: ${displayName(next.food)}${pantryNote(ded)}`, { tone: 'ok', action: { label: 'Undo', run: undo } });
  return next;
}

export async function eatNow(e: LogEntry): Promise<void> {
  await eatEntry(e);
}
