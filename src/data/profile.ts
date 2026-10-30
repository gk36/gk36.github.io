import { db } from './db';
import { nowIso } from './ids';
import type { PlannerPrefs, Profile, Slot } from './types';
import { ageOn, systemTimeZone, type DayKey } from '../domain/time';
import type { PlannerInput } from '../domain/planning/template';

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'breakfast', name: 'Breakfast', time: '08:00' },
  { id: 'lunch', name: 'Lunch', time: '13:00' },
  { id: 'dinner', name: 'Dinner', time: '19:30' },
  { id: 'snacks', name: 'Snacks' },
];

export const DEFAULT_PLANNER: PlannerPrefs = {
  act: 'moderate', goal: 'recomp', cutStyle: 'gentle', timing: 'standard',
  eggs: 4, liver: false, boneBroth: false, breakfastCarbOn: true, dairyOn: true,
  combineBreakfast: false, preHoney: false, pick: {}, milkMl: 250,
};

export function defaultProfile(): Profile {
  return {
    version: 1, onboarded: false, sex: null, birthDate: null, ageYears: null, heightCm: null, weightKg: null,
    timezone: systemTimeZone(), dayStartHour: 4, defaultSlots: DEFAULT_SLOTS.map((s) => ({ ...s })),
    targetMode: 'template', planner: { ...DEFAULT_PLANNER, pick: {} }, defaultDayType: 'gym',
    theme: 'system', density: 'simple', lastBackupAt: null, legacyProfileName: null, updatedAt: nowIso(),
  };
}

/** Fills any field an older stored profile lacks, so upgrades never crash or reset data. */
export function normalizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const p = raw as Partial<Profile>;
  return {
    ...d,
    ...p,
    version: 1,
    planner: { ...d.planner, ...(p.planner ?? {}), pick: { ...((p.planner && p.planner.pick) || {}) } },
    defaultSlots: Array.isArray(p.defaultSlots) && p.defaultSlots.length ? p.defaultSlots : d.defaultSlots,
  };
}

export async function loadProfile(): Promise<Profile> {
  const row = await db().settings.get('profile');
  return normalizeProfile(row?.value);
}

export async function saveProfile(p: Profile): Promise<Profile> {
  const next = { ...p, updatedAt: nowIso() };
  await db().settings.put({ key: 'profile', value: next });
  return next;
}

export function ageFor(p: Profile, on: DayKey): number | null {
  if (p.birthDate) return ageOn(p.birthDate, on);
  return p.ageYears ?? null;
}

/** Planner input for one day, or why it cannot be built yet. */
export function plannerInput(p: Profile, day: DayKey, dayType: 'gym' | 'rest'): PlannerInput | { missing: string[] } {
  const age = ageFor(p, day);
  const missing: string[] = [];
  if (!p.sex) missing.push('sex');
  if (!p.weightKg) missing.push('weight');
  if (!p.heightCm) missing.push('height');
  if (age === null) missing.push('age');
  if (missing.length) return { missing };
  return { ...p.planner, kg: p.weightKg!, cm: p.heightCm!, age: age!, sex: p.sex!, day: dayType };
}
