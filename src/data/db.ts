import Dexie, { type Table } from 'dexie';
import type { Food } from '../domain/nutrition/food';
import type { DayRecord, LegacyArchive, LogEntry, SavedMeal, SettingRow, WeightRecord } from './types';

/**
 * Local-first store. IndexedDB survives reloads and works offline; every change bumps `rev`
 * and `updatedAt`, deletes are tombstones. Schema changes MUST add a new version() with an
 * upgrade function — never edit an existing version.
 */
export interface OffLookup {
  code: string;
  fetchedAt: string;
  status: 'found' | 'not-found';
  /** Trimmed Open Food Facts product JSON (only the requested fields). */
  product?: unknown;
}

export interface Program {
  id: string;
  name: string;
  days: import('../domain/training/program').ProgramDay[];
  active: boolean;
  source: 'v1' | 'user' | 'default';
  importedFrom?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  rev: number;
}

export interface WorkoutSession {
  id: string;
  dayKey: string;
  programId: string | null;
  programDayId: string | null;
  name: string;
  startedAt: string;
  endedAt: string | null;
  restSec: number;
  exercises: import('../domain/training/metrics').SessionExercise[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  rev: number;
}

export class CarbmaxxDB extends Dexie {
  programs!: Table<Program, string>;
  sessions!: Table<WorkoutSession, string>;
  offLookups!: Table<OffLookup, string>;
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
    // v2: cache of Open Food Facts lookups (barcode scans work offline once seen).
    this.version(2).stores({ offLookups: 'code, fetchedAt' });
    // v3: training programs and logged workout sessions.
    this.version(3).stores({ programs: 'id, updatedAt', sessions: 'id, dayKey, startedAt, programId, updatedAt' });
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
