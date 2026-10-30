import { db } from './db';
import { nowIso } from './ids';
import type { PlannerPrefs, Profile } from './types';
import { ACTIVITY, CUT_STYLES, GOALS, TIMINGS, type PlannerInput } from '../domain/planning/template';

/**
 * Read-only bridge from CARBMAXX v1 (index.html / workout.html). Those pages store profiles in
 * localStorage on the same origin and in Firebase under a profile name. This module only READS:
 * it never writes, renames or deletes a legacy key, so the old pages keep working unchanged.
 */

export const LEGACY_PROFILES_KEY = 'carbmaxx_profiles_v1';
export const LEGACY_WORKOUTS_KEY = 'carbmaxx_workout_profiles_v1';
export const LEGACY_DB = 'https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app';

/** v1 defaults (index.html DEFAULT_STATE) — v1 filled missing fields with these, so we do too. */
const V1_DEFAULT: PlannerInput = {
  kg: 65.65, cm: 174, age: 21, sex: 'male', act: 'moderate', goal: 'slight_bulk', cutStyle: 'gentle',
  day: 'gym', timing: 'standard', eggs: 4, liver: false, boneBroth: false, breakfastCarbOn: true, dairyOn: true,
  combineBreakfast: false, preHoney: false, pick: {}, milkMl: 250,
};

export const validLegacyName = (n: string) => /^[a-z0-9_-]{1,20}$/.test(n);

const PICK_KEY = /^[1-5]:(protein|starchy_carb|fast_carb|breakfast_carb|dairy_drink)$/;

/** Exactly the clamping/whitelisting v1's applySnapshot() did. */
export function sanitizeLegacySnapshot(raw: unknown): PlannerInput & { updatedAt?: number } {
  const snap = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick1 = <K extends keyof PlannerInput>(k: K): unknown => (snap[k] !== undefined ? snap[k] : V1_DEFAULT[k]);
  const num = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number.parseFloat(String(v));
    return Number.isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n));
  };
  const goal = pick1('goal');
  const act = pick1('act');
  const cutStyle = pick1('cutStyle');
  const timing = pick1('timing');
  const pickRaw = pick1('pick');
  const pick: Record<string, string> = {};
  if (pickRaw && typeof pickRaw === 'object' && !Array.isArray(pickRaw)) {
    for (const [k, v] of Object.entries(pickRaw as Record<string, unknown>)) {
      if (PICK_KEY.test(k) && typeof v === 'string' && /^[a-z0-9_]{1,30}$/i.test(v)) pick[k] = v;
    }
  }
  const out: PlannerInput & { updatedAt?: number } = {
    kg: num(pick1('kg'), 40, 160, V1_DEFAULT.kg),
    cm: Math.round(num(pick1('cm'), 140, 210, V1_DEFAULT.cm)),
    age: Math.round(num(pick1('age'), 14, 80, V1_DEFAULT.age)),
    sex: pick1('sex') === 'female' ? 'female' : 'male',
    act: ACTIVITY.some((a) => a.key === act) ? (act as PlannerInput['act']) : V1_DEFAULT.act,
    goal: GOALS.some((g) => g.key === goal) ? (goal as PlannerInput['goal']) : V1_DEFAULT.goal,
    cutStyle: CUT_STYLES.some((c) => c.key === cutStyle) ? (cutStyle as PlannerInput['cutStyle']) : V1_DEFAULT.cutStyle,
    day: pick1('day') === 'rest' ? 'rest' : 'gym',
    timing: TIMINGS.some((t) => t.key === timing) ? (timing as PlannerInput['timing']) : V1_DEFAULT.timing,
    eggs: Math.round(num(pick1('eggs'), 2, 8, V1_DEFAULT.eggs)),
    milkMl: Math.round(num(pick1('milkMl'), 50, 1000, V1_DEFAULT.milkMl)),
    liver: !!pick1('liver'), boneBroth: !!pick1('boneBroth'), combineBreakfast: !!pick1('combineBreakfast'),
    breakfastCarbOn: !!pick1('breakfastCarbOn'), dairyOn: !!pick1('dairyOn'), preHoney: !!pick1('preHoney'),
    pick,
  };
  if (typeof snap.updatedAt === 'number') out.updatedAt = snap.updatedAt;
  return out;
}

export interface LegacyLocal {
  profiles: Record<string, ReturnType<typeof sanitizeLegacySnapshot>>;
  workoutNames: string[];
  rawProfiles: string | null;
  rawWorkouts: string | null;
}

function parseMap(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Reads (never writes) the v1 keys from this origin's localStorage. */
export function readLegacyLocal(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): LegacyLocal {
  let rawProfiles: string | null = null;
  let rawWorkouts: string | null = null;
  try {
    rawProfiles = storage?.getItem(LEGACY_PROFILES_KEY) ?? null;
    rawWorkouts = storage?.getItem(LEGACY_WORKOUTS_KEY) ?? null;
  } catch {
    /* storage blocked (private mode) */
  }
  const profiles: LegacyLocal['profiles'] = {};
  for (const [name, snap] of Object.entries(parseMap(rawProfiles))) {
    if (validLegacyName(name) && snap && typeof snap === 'object') profiles[name] = sanitizeLegacySnapshot(snap);
  }
  const workoutNames = Object.keys(parseMap(rawWorkouts)).filter(validLegacyName);
  return { profiles, workoutNames, rawProfiles, rawWorkouts };
}

/** Fetches ONE named v1 profile from the old cloud path (read-only). Never lists the collection. */
export async function fetchLegacyCloudProfile(name: string, fetchImpl: typeof fetch = fetch): Promise<ReturnType<typeof sanitizeLegacySnapshot> | null> {
  const n = name.trim().toLowerCase();
  if (!validLegacyName(n)) throw new Error('Profile names are 1–20 lowercase letters, numbers, - or _.');
  const res = await fetchImpl(`${LEGACY_DB}/carbmaxx/profiles/${encodeURIComponent(n)}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not reach the old cloud profile (HTTP ${res.status}).`);
  const data = (await res.json()) as unknown;
  return data && typeof data === 'object' ? sanitizeLegacySnapshot(data) : null;
}

export function legacyToProfile(snap: PlannerInput, base: Profile, name: string | null): Profile {
  const planner: PlannerPrefs = {
    act: snap.act, goal: snap.goal, cutStyle: snap.cutStyle, timing: snap.timing, eggs: snap.eggs,
    liver: snap.liver, boneBroth: snap.boneBroth, breakfastCarbOn: snap.breakfastCarbOn, dairyOn: snap.dairyOn,
    combineBreakfast: snap.combineBreakfast, preHoney: snap.preHoney, pick: { ...snap.pick }, milkMl: snap.milkMl,
  };
  return {
    ...base,
    sex: snap.sex, weightKg: snap.kg, heightCm: snap.cm,
    birthDate: base.birthDate ?? null, ageYears: base.birthDate ? (base.ageYears ?? null) : snap.age,
    planner, defaultDayType: snap.day, targetMode: 'template', legacyProfileName: name,
  };
}

/** Keeps an untouched copy of the raw v1 data inside the new app (idempotent). */
export async function archiveLegacyRaw(local: LegacyLocal, note?: string): Promise<void> {
  const rows: [string, string | null][] = [[LEGACY_PROFILES_KEY, local.rawProfiles], [LEGACY_WORKOUTS_KEY, local.rawWorkouts]];
  for (const [key, raw] of rows) {
    if (!raw) continue;
    const cur = await db().legacy.get(key);
    if (cur && cur.raw === raw) continue;
    await db().legacy.put(note ? { key, raw, importedAt: nowIso(), note } : { key, raw, importedAt: nowIso() });
  }
}
