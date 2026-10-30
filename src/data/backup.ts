import { db, type DayEvent, type PantryItem, type Program, type ShoppingItem, type WorkoutSession } from './db';
import { nowIso } from './ids';
import { BACKUP_SCHEMA, backupSchema, type BackupFile } from './schemas';
import type { Food } from '../domain/nutrition/food';
import type { DayRecord, LogEntry, SavedMeal, SettingRow, WeightRecord } from './types';

const TABLES = ['entries', 'days', 'foods', 'savedMeals', 'weights', 'settings', 'programs', 'sessions', 'pantry', 'shopping', 'events'] as const;
type TableName = (typeof TABLES)[number];
/** Kept across a "replace" import so the previous state can always be restored. */
export const PRE_IMPORT_KEY = 'preImportSnapshot';
/** Settings that belong to this device only: never exported, never overwritten by an import. */
export const LOCAL_ONLY = new Set([PRE_IMPORT_KEY, 'auth', 'sync']);

export async function exportAll(): Promise<BackupFile> {
  const d = db();
  const [entries, days, foods, savedMeals, weights, settings, programs, sessions, pantry, shopping, events] = await Promise.all([
    d.entries.toArray(), d.days.toArray(), d.foods.toArray(), d.savedMeals.toArray(), d.weights.toArray(),
    d.settings.filter((s) => !LOCAL_ONLY.has(s.key)).toArray(), d.programs.toArray(), d.sessions.toArray(),
    d.pantry.toArray(), d.shopping.toArray(), d.events.toArray(),
  ]);
  return {
    app: 'carbmaxx', kind: 'backup', schema: BACKUP_SCHEMA, exportedAt: nowIso(),
    data: { entries, days, foods, savedMeals, weights, settings, programs, sessions, pantry, shopping, events },
  } as BackupFile;
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `carbmaxx-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export type ParsedBackup =
  | { ok: true; file: BackupFile; counts: Record<TableName, number> }
  | { ok: false; error: string };

/** Validates a backup completely BEFORE anything is written. */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not a valid JSON file.' };
  }
  const r = backupSchema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `Not a CARBMAXX backup, or it is damaged (${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'}).` };
  }
  if (r.data.schema > BACKUP_SCHEMA) return { ok: false, error: 'This backup was made by a newer version of CARBMAXX. Update the app first.' };
  const counts = Object.fromEntries(TABLES.map((t) => [t, (r.data.data[t] ?? []).length])) as Record<TableName, number>;
  return { ok: true, file: r.data, counts };
}

const newer = (a: { updatedAt?: string; rev?: number } | undefined, b: { updatedAt?: string; rev?: number }) =>
  !a || (b.updatedAt ?? '') > (a.updatedAt ?? '') || ((b.updatedAt ?? '') === (a.updatedAt ?? '') && (b.rev ?? 0) > (a.rev ?? 0));

/**
 * Imports a validated backup in ONE transaction — any failure rolls everything back.
 * 'replace' first stores the current data under PRE_IMPORT_KEY; 'merge' keeps the newer copy of each record.
 */
export async function importBackup(file: BackupFile, mode: 'replace' | 'merge'): Promise<void> {
  const d = db();
  const before = mode === 'replace' ? await exportAll() : null;
  const data = file.data;
  const programs = (data.programs ?? []) as Program[];
  const sessions = (data.sessions ?? []) as WorkoutSession[];
  const pantry = (data.pantry ?? []) as PantryItem[];
  const shopping = (data.shopping ?? []) as ShoppingItem[];
  const events = (data.events ?? []) as DayEvent[];
  await d.transaction('rw', [d.entries, d.days, d.foods, d.savedMeals, d.weights, d.settings, d.programs, d.sessions, d.pantry, d.shopping, d.events], async () => {
    if (mode === 'replace') {
      await Promise.all([d.entries.clear(), d.days.clear(), d.foods.clear(), d.savedMeals.clear(), d.weights.clear(), d.programs.clear(), d.sessions.clear(), d.pantry.clear(), d.shopping.clear(), d.events.clear()]);
      const keep = (await d.settings.toArray()).filter((s) => LOCAL_ONLY.has(s.key));
      await d.settings.clear();
      await d.settings.bulkPut(keep);
      await d.settings.put({ key: PRE_IMPORT_KEY, value: { savedAt: nowIso(), backup: before } });
      await d.entries.bulkPut(data.entries as LogEntry[]);
      await d.days.bulkPut(data.days as DayRecord[]);
      await d.foods.bulkPut(data.foods as Food[]);
      await d.savedMeals.bulkPut(data.savedMeals as SavedMeal[]);
      await d.weights.bulkPut(data.weights as WeightRecord[]);
      await d.programs.bulkPut(programs);
      await d.sessions.bulkPut(sessions);
      await d.pantry.bulkPut(pantry);
      await d.shopping.bulkPut(shopping);
      await d.events.bulkPut(events);
      await d.settings.bulkPut((data.settings as SettingRow[]).filter((s) => !LOCAL_ONLY.has(s.key)));
      return;
    }
    const mergeTable = async <T extends { updatedAt?: string; rev?: number }>(table: { get(k: string): PromiseLike<T | undefined>; put(v: T): PromiseLike<unknown> }, rows: T[], key: (r: T) => string) => {
      for (const row of rows) {
        const cur = await table.get(key(row));
        if (newer(cur, row)) await table.put(row);
      }
    };
    await mergeTable<LogEntry>(d.entries, data.entries as LogEntry[], (r) => r.id);
    await mergeTable<DayRecord>(d.days, data.days as DayRecord[], (r) => r.dayKey);
    await mergeTable<Food>(d.foods, data.foods as Food[], (r) => r.id);
    await mergeTable<SavedMeal>(d.savedMeals, data.savedMeals as SavedMeal[], (r) => r.id);
    await mergeTable<WeightRecord>(d.weights, data.weights as WeightRecord[], (r) => r.dayKey);
    await mergeTable<Program>(d.programs, programs, (r) => r.id);
    await mergeTable<WorkoutSession>(d.sessions, sessions, (r) => r.id);
    await mergeTable<PantryItem>(d.pantry, pantry, (r) => r.id);
    await mergeTable<ShoppingItem>(d.shopping, shopping, (r) => r.id);
    await mergeTable<DayEvent>(d.events, events, (r) => r.id);
    for (const s of data.settings as SettingRow[]) {
      if (LOCAL_ONLY.has(s.key)) continue;
      if (!(await d.settings.get(s.key))) await d.settings.put(s);
    }
  });
}
