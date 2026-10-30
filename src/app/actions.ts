import { addEntry, markEaten, restore, softDelete, type NewEntry } from '../data/entries';
import { freezeTargets } from '../data/plan';
import type { LogEntry } from '../data/types';
import { displayName } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { profile, toast } from './store';

let lastUndo: (() => Promise<void>) | null = null;
export const undoLast = async () => { const u = lastUndo; lastUndo = null; if (u) await u(); };

export async function logEntry(input: NewEntry): Promise<LogEntry> {
  const p = profile.value;
  if (p) await freezeTargets(p, input.dayKey);
  const e = await addEntry(input);
  const undo = async () => { await softDelete(e.id); toast('Removed'); };
  lastUndo = undo;
  toast(`${input.status === 'planned' ? 'Planned' : 'Logged'} ${describeQuantity(e.food, e.qty)} ${displayName(e.food)}`, { action: { label: 'Undo', run: undo }, tone: 'ok' });
  return e;
}

export async function deleteWithUndo(e: LogEntry): Promise<void> {
  await softDelete(e.id);
  const undo = async () => { await restore(e.id); toast('Restored'); };
  lastUndo = undo;
  toast(`Deleted ${displayName(e.food)}`, { action: { label: 'Undo', run: undo } });
}

export async function eatNow(e: LogEntry): Promise<void> {
  const p = profile.value;
  if (p) await freezeTargets(p, e.dayKey);
  await markEaten(e.id);
  toast(`Marked eaten: ${displayName(e.food)}`, { tone: 'ok' });
}
