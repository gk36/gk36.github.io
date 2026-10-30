import type { Food, Quantity } from '../domain/nutrition/food';
import type { DayKey } from '../domain/time';
import type { PlannerInput } from '../domain/planning/template';

/** Fields every synced record carries (local-first; tombstones instead of hard deletes). */
export interface RecordMeta {
  createdAt: string;
  updatedAt: string;
  /** ISO time of deletion; null/absent = live. Deleted records stay so undo and sync work. */
  deletedAt?: string | null;
  rev: number;
}

export type EntryStatus = 'planned' | 'eaten' | 'skipped';
export type EntryOrigin = 'search' | 'plan' | 'saved-meal' | 'copy' | 'quick' | 'import' | 'barcode' | 'recipe' | 'replan' | 'text' | 'idea';

/** The food exactly as it was when logged — history never shifts when a food is edited later. */
export type FoodSnapshot = Omit<Food, 'createdAt' | 'updatedAt' | 'deletedAt' | 'rev'>;

export interface LogEntry extends RecordMeta {
  id: string;
  dayKey: DayKey;
  slotId: string;
  order: number;
  foodId: string;
  food: FoodSnapshot;
  qty: Quantity;
  status: EntryStatus;
  /** What the plan said, kept when the eaten amount or food differs. */
  planned?: { foodId: string; foodName: string; qty: Quantity };
  time?: string;
  note?: string;
  origin: EntryOrigin;
}

export interface Slot {
  id: string;
  name: string;
  time?: string;
  badge?: string;
}

export interface DayTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  source: 'template' | 'manual';
  /** e.g. "Slight Bulk · gym day · standard" */
  label: string;
  bmr?: number;
  tdee?: number;
  computedAt: string;
}

export interface DayRecord extends RecordMeta {
  dayKey: DayKey;
  slots: Slot[];
  targets?: DayTargets;
  dayType?: 'gym' | 'rest';
  /** The planner input that produced today's plan (for "why this portion"). */
  planInput?: PlannerInput;
  note?: string;
}

export interface SavedMealItem {
  foodId: string;
  food: FoodSnapshot;
  qty: Quantity;
}

export interface SavedMeal extends RecordMeta {
  id: string;
  name: string;
  items: SavedMealItem[];
}

export type PlannerPrefs = Omit<PlannerInput, 'kg' | 'cm' | 'age' | 'sex' | 'day'>;

export interface Profile {
  version: 1;
  onboarded: boolean;
  displayName?: string;
  sex: 'male' | 'female' | null;
  birthDate?: string | null;
  /** Used when no birth date is given. */
  ageYears?: number | null;
  heightCm: number | null;
  weightKg: number | null;
  timezone: string;
  dayStartHour: number;
  defaultSlots: Slot[];
  targetMode: 'template' | 'manual';
  manualTargets?: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number };
  planner: PlannerPrefs;
  defaultDayType: 'gym' | 'rest';
  theme: 'system' | 'dark' | 'light';
  density: 'simple' | 'detailed' | 'research';
  lastBackupAt?: string | null;
  /** Take food out of the pantry when it is logged as eaten or cooked (default on). */
  pantryDeduct?: boolean;
  /** Corrections remembered from typed meals: phrase (or "phrase|state") → food id. */
  phrases?: Record<string, string>;
  /** Preferences for meal ideas. */
  taste?: TastePrefs;
  legacyProfileName?: string | null;
  updatedAt: string;
}

export type Equipment = 'hob' | 'oven' | 'microwave' | 'airfryer' | 'blender' | 'kettle';

export interface TastePrefs {
  /** Foods never suggested: food ids ("core:broccoli-raw") or plain words ("cabbage"). */
  avoid: string[];
  /** Breakfast ideas lean sweet (protein pancakes, cream of rice, oats, cheesecake bowls). */
  sweetBreakfast: boolean;
  highProtein: boolean;
  equipment: Equipment[];
  /** How much total fat a meal may carry. */
  fat: 'low' | 'moderate' | 'flexible';
  /** Saturated fat ceiling as a share of the meal's calories. */
  satFatPct: number;
  /** Prefer lower-oxalate foods where cited data exist. */
  lowOxalate: boolean;
  /** The preferences card has been seen and confirmed. */
  confirmed: boolean;
}

export interface WeightRecord extends RecordMeta {
  dayKey: DayKey;
  kg: number;
}

export interface LegacyArchive {
  key: string;
  raw: string;
  importedAt: string;
  note?: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}
