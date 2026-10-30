/**
 * Training metrics. Estimates are labelled as estimates: e1RM uses Epley only for sets of
 * ≤ 12 reps; weekly volume counts working sets, split into "direct" (first tagged muscle) and
 * "assisting" (other tags) — not a claim about exact muscle stimulus.
 */

export interface LoggedSet {
  id: string;
  kind: 'warmup' | 'working' | 'drop';
  weightKg: number | null;
  reps: number | null;
  rir?: number | null;
  done: boolean;
}

export interface SessionExercise {
  id: string;
  name: string;
  m: string[];
  ss: boolean;
  plannedSets: number | null;
  repMin: number | null;
  repMax: number | null;
  prescription: string;
  note?: string;
  skipped?: boolean;
  sets: LoggedSet[];
}

/** Epley estimated one-rep max; null outside 1–12 reps or without a load. */
export function e1rm(weightKg: number | null, reps: number | null): number | null {
  if (!weightKg || !reps || reps < 1 || reps > 12) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export const workingSets = (ex: SessionExercise) => ex.sets.filter((s) => s.done && s.kind !== 'warmup' && (s.reps ?? 0) > 0);

export function bestE1rm(ex: SessionExercise): number | null {
  let best: number | null = null;
  for (const s of workingSets(ex)) {
    const v = e1rm(s.weightKg, s.reps);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

export function tonnage(ex: SessionExercise): number {
  return workingSets(ex).reduce((t, s) => t + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
}

export interface MuscleVolume { direct: number; assisting: number }

export function muscleVolume(exercises: readonly SessionExercise[]): Record<string, MuscleVolume> {
  const out: Record<string, MuscleVolume> = {};
  for (const ex of exercises) {
    const n = workingSets(ex).length;
    if (!n) continue;
    ex.m.forEach((m, i) => {
      const v = (out[m] ??= { direct: 0, assisting: 0 });
      if (i === 0) v.direct += n; else v.assisting += n;
    });
  }
  return out;
}

export interface PR { exercise: string; kind: 'e1rm' | 'weight-for-reps'; value: number; reps?: number; previous: number | null }

/** New records vs history (best e1RM, and heaviest weight at a given rep count). */
export function findPRs(current: readonly SessionExercise[], history: readonly SessionExercise[]): PR[] {
  const prs: PR[] = [];
  for (const ex of current) {
    const past = history.filter((h) => h.name.toLowerCase() === ex.name.toLowerCase());
    const prevBest = past.reduce<number | null>((b, h) => { const v = bestE1rm(h); return v !== null && (b === null || v > b) ? v : b; }, null);
    const best = bestE1rm(ex);
    if (best !== null && (prevBest === null || best > prevBest + 1e-9) && past.length) prs.push({ exercise: ex.name, kind: 'e1rm', value: best, previous: prevBest });
    const done = workingSets(ex);
    // A set "dominated" by another set this session (≥ weight AND ≥ reps) is not a separate record.
    const dominated = (s: LoggedSet) => done.some((o) => o !== s && (o.weightKg ?? 0) >= (s.weightKg ?? 0) && (o.reps ?? 0) >= (s.reps ?? 0) && ((o.weightKg ?? 0) > (s.weightKg ?? 0) || (o.reps ?? 0) > (s.reps ?? 0)));
    for (const s of done) {
      if (!s.weightKg || !s.reps || dominated(s)) continue;
      const prevAtReps = past.flatMap(workingSets).filter((p) => (p.reps ?? 0) >= s.reps!).reduce<number | null>((b, p) => (p.weightKg !== null && (b === null || p.weightKg > b) ? p.weightKg : b), null);
      if (past.length && prevAtReps !== null && s.weightKg > prevAtReps && !prs.some((p) => p.exercise === ex.name && p.kind === 'weight-for-reps' && p.reps === s.reps)) {
        prs.push({ exercise: ex.name, kind: 'weight-for-reps', value: s.weightKg, reps: s.reps, previous: prevAtReps });
      }
    }
  }
  return prs;
}

/**
 * Progression hint (double progression): when every working set reached the top of the rep range,
 * suggest more load next time; otherwise suggest adding a rep. Never automatic — just a hint.
 */
export function progressionHint(last: SessionExercise | undefined, repMax: number | null): string | null {
  if (!last) return null;
  const sets = workingSets(last);
  if (!sets.length) return null;
  const top = Math.max(...sets.map((s) => s.weightKg ?? 0));
  const atTop = sets.filter((s) => (s.weightKg ?? 0) === top);
  if (repMax && atTop.every((s) => (s.reps ?? 0) >= repMax)) return top ? `All sets hit ${repMax} reps at ${top} kg — try a little more weight.` : `All sets hit ${repMax} reps — make it harder.`;
  return top ? `Last time ${top} kg × ${atTop.map((s) => s.reps).join(', ')} — aim for one more rep.` : null;
}

/** Rough session length: sets × (work + rest). Used for "I only have 50 minutes". */
export function estimateMinutes(exercises: readonly Pick<SessionExercise, 'plannedSets' | 'skipped'>[], restSec = 120, workSec = 45): number {
  const sets = exercises.filter((e) => !e.skipped).reduce((s, e) => s + (e.plannedSets ?? 3), 0);
  return Math.round((sets * (restSec + workSec)) / 60);
}

/** Keeps the first exercises (main lifts come first in a program) that fit the time; marks the rest skipped. */
export function fitToTime<T extends Pick<SessionExercise, 'plannedSets' | 'skipped'>>(exercises: readonly T[], minutes: number, restSec = 120): T[] {
  let used = 0;
  return exercises.map((e) => {
    const cost = ((e.plannedSets ?? 3) * (restSec + 45)) / 60;
    if (used + cost <= minutes) { used += cost; return { ...e, skipped: false }; }
    return { ...e, skipped: true };
  });
}
