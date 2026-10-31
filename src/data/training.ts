import { db, type Program, type WorkoutSession } from './db';
import { nowIso, uuidv7 } from './ids';
import { LEGACY_DB, LEGACY_WORKOUTS_KEY, validLegacyName } from './legacy';
import { fromV1Program, parsePrescription, type ProgramDay } from '../domain/training/program';
import type { SessionExercise } from '../domain/training/metrics';
import type { DayKey } from '../domain/time';

const live = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

export async function listPrograms(): Promise<Program[]> {
  return (await db().programs.toArray()).filter(live).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

export async function activeProgram(): Promise<Program | undefined> {
  return (await listPrograms()).find((p) => p.active);
}

export async function saveProgram(p: Omit<Program, 'createdAt' | 'updatedAt' | 'rev'> & Partial<Pick<Program, 'createdAt' | 'rev'>>, makeActive = false): Promise<Program> {
  const t = nowIso();
  const existing = p.id ? await db().programs.get(p.id) : undefined;
  const next: Program = { ...p, id: p.id || uuidv7(), createdAt: existing?.createdAt ?? t, updatedAt: t, rev: (existing?.rev ?? 0) + 1, deletedAt: null };
  await db().transaction('rw', db().programs, async () => {
    if (makeActive || next.active) {
      for (const o of await db().programs.toArray()) if (o.id !== next.id && o.active) await db().programs.put({ ...o, active: false, updatedAt: t, rev: o.rev + 1 });
      next.active = true;
    }
    await db().programs.put(next);
  });
  return next;
}

/** v1 programs saved in this browser (read only; the classic page's storage is never written). */
export function readV1Programs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, ProgramDay[]> {
  try {
    const raw = storage?.getItem(LEGACY_WORKOUTS_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ProgramDay[]> = {};
    for (const [name, prog] of Object.entries(map ?? {})) {
      if (!validLegacyName(name)) continue;
      const days = fromV1Program(prog);
      if (days.length) out[name] = days;
    }
    return out;
  } catch {
    return {};
  }
}

/** Fetches ONE named v1 program from the old cloud path (read-only, never the whole collection). */
export async function fetchV1Program(name: string, fetchImpl: typeof fetch = fetch): Promise<ProgramDay[] | null> {
  const n = name.trim().toLowerCase();
  if (!validLegacyName(n)) throw new Error('Program names are 1–20 lowercase letters, numbers, - or _.');
  const res = await fetchImpl(`${LEGACY_DB}/carbmaxx/workouts/${encodeURIComponent(n)}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not reach the old cloud program (HTTP ${res.status}).`);
  const days = fromV1Program(await res.json());
  return days.length ? days : null;
}

export async function importV1Program(name: string, days: ProgramDay[]): Promise<Program> {
  return saveProgram({ id: '', name: `${name} (from classic page)`, days, active: true, source: 'v1', importedFrom: name }, true);
}

export async function listSessions(limit = 60): Promise<WorkoutSession[]> {
  return (await db().sessions.orderBy('startedAt').reverse().limit(limit * 2).toArray()).filter(live).slice(0, limit);
}

export async function openSession(): Promise<WorkoutSession | undefined> {
  return (await listSessions(10)).find((s) => !s.endedAt);
}

/** The most recent finished performance of an exercise (by name), for prefill and hints. */
export async function lastPerformance(name: string, before?: string): Promise<SessionExercise | undefined> {
  for (const s of await listSessions(200)) {
    if (!s.endedAt || (before && s.startedAt >= before)) continue;
    const e = s.exercises.find((x) => x.name.toLowerCase() === name.toLowerCase() && !x.skipped && x.sets.some((y) => y.done));
    if (e) return e;
  }
  return undefined;
}

/** Next day in the rotation after the last finished session of this program. */
export async function nextProgramDay(p: Program): Promise<ProgramDay | undefined> {
  const last = (await listSessions(50)).find((s) => s.programId === p.id && s.endedAt);
  if (!last) return p.days.find((d) => !d.rest) ?? p.days[0];
  const i = p.days.findIndex((d) => d.id === last.programDayId);
  return p.days[(i + 1 + p.days.length) % p.days.length];
}

export async function startSession(input: { dayKey: DayKey; program?: Program; day?: ProgramDay; name?: string; restSec?: number }): Promise<WorkoutSession> {
  const t = nowIso();
  const exercises: SessionExercise[] = [];
  for (const pe of input.day?.exercises ?? []) {
    const rx = parsePrescription(pe.sets, pe.reps);
    const last = await lastPerformance(pe.name);
    const lastWork = last?.sets.filter((s) => s.done && s.kind !== 'warmup') ?? [];
    const n = rx.sets ?? (lastWork.length || 3);
    exercises.push({
      id: uuidv7(), name: pe.name, m: pe.m, ss: pe.ss, plannedSets: rx.sets, repMin: rx.repMin, repMax: rx.repMax,
      prescription: `${pe.sets} × ${pe.reps}`, ...(pe.note ? { note: pe.note } : {}),
      sets: Array.from({ length: n }, (_, i) => ({ id: uuidv7(), kind: 'working' as const, weightKg: lastWork[i]?.weightKg ?? lastWork[0]?.weightKg ?? null, reps: null, rir: null, done: false })),
    });
  }
  const s: WorkoutSession = {
    id: uuidv7(), dayKey: input.dayKey, programId: input.program?.id ?? null, programDayId: input.day?.id ?? null,
    name: input.name ?? input.day?.name ?? 'Workout', startedAt: t, endedAt: null, restSec: input.restSec ?? 120, exercises,
    createdAt: t, updatedAt: t, rev: 1, deletedAt: null,
  };
  await db().sessions.put(s);
  return s;
}

export async function updateSession(s: WorkoutSession): Promise<WorkoutSession> {
  const cur = await db().sessions.get(s.id);
  const next = { ...s, updatedAt: nowIso(), rev: (cur?.rev ?? s.rev) + 1 };
  await db().sessions.put(next);
  return next;
}

export async function finishSession(s: WorkoutSession, notes?: string): Promise<WorkoutSession> {
  return updateSession({ ...s, endedAt: nowIso(), ...(notes ? { notes } : {}) });
}

export async function discardSession(s: WorkoutSession): Promise<void> {
  await db().sessions.put({ ...s, deletedAt: nowIso(), updatedAt: nowIso(), rev: s.rev + 1 });
}
