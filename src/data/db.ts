import Dexie, { type Table } from 'dexie';
import type { Food } from '../domain/nutrition/food';
import type { DayRecord, LegacyArchive, LogEntry, SavedMeal, SettingRow, WeightRecord } from './types';

/**
 * Local-first store. IndexedDB survives reloads and works offline; every change bumps `rev`
 * and `updatedAt`, deletes are tombstones. Schema changes MUST add a new version() with an
 * upgrade function — never edit an existing version.
 */
export class CarbmaxxDB extends Dexie {
  entries!: Table<LogEntry, string>;
  days!: Table<DayRecord, string>;
  foods!: Table<Food, string>;
  savedMeals!: Table<SavedMeal, string>;
  weights!: Table<WeightRecord, string>;
  settings!: Table<SettingRow, string>;
  legacy!: Table<LegacyArchive, string>;

  constructor(name = 'carbmaxx') {
    super(name);
    this.version(1).stores({
      entries: 'id, dayKey, [dayKey+slotId], foodId, updatedAt, status',
      days: 'dayKey, updatedAt',
      foods: 'id, updatedAt, gtin, kind',
      savedMeals: 'id, updatedAt, name',
      weights: 'dayKey, updatedAt',
      settings: 'key',
      legacy: 'key',
    });
  }
}

let instance: CarbmaxxDB | null = null;
export function db(): CarbmaxxDB {
  if (!instance) instance = new CarbmaxxDB();
  return instance;
}

/** Tests use isolated databases. */
export function useDatabase(next: CarbmaxxDB): void {
  instance = next;
}

export const live = <T extends { deletedAt?: string | null }>(r: T | undefined): r is T => !!r && !r.deletedAt;
