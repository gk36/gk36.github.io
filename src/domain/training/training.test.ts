import { describe, expect, it } from 'vitest';
import { fromV1Program, inferMuscles, parsePrescription, supersetGroups } from './program';
import { bestE1rm, e1rm, estimateMinutes, findPRs, fitToTime, muscleVolume, progressionHint, type SessionExercise } from './metrics';

const ex = (name: string, sets: [number | null, number | null, ('warmup' | 'working')?][], m: string[] = inferMuscles(name)): SessionExercise => ({
  id: name, name, m, ss: false, plannedSets: sets.length, repMin: 6, repMax: 8, prescription: '3 × 6–8',
  sets: sets.map(([w, r, k], i) => ({ id: `${name}-${i}`, kind: k ?? 'working', weightKg: w, reps: r, done: true })),
});

describe('prescriptions', () => {
  it.each([
    ['4', '6–8', { sets: 4, repMin: 6, repMax: 8, toFailure: false, seconds: null, perSide: false }],
    ['3', '8-10 /leg', { sets: 3, repMin: 8, repMax: 10, toFailure: false, seconds: null, perSide: true }],
    ['3', 'to failure', { sets: 3, repMin: null, repMax: null, toFailure: true, seconds: null, perSide: false }],
    ['3', '30–45 sec', { sets: 3, repMin: null, repMax: null, toFailure: false, seconds: [30, 45], perSide: false }],
    ['4', '15', { sets: 4, repMin: 15, repMax: 15, toFailure: false, seconds: null, perSide: false }],
  ])('%s × %s', (s, r, want) => expect(parsePrescription(s, r)).toEqual(want));
});

describe('v1 programs', () => {
  it('keeps supersets, tags and limits like workout.html', () => {
    const days = fromV1Program({ days: [{ name: 'Arms', rest: false, ex: [
      { name: 'EZ-Bar Skull Crushers', sets: '3', reps: '8–12', ss: true, m: ['triceps', 'bogus'] },
      { name: 'EZ-Bar Curls', sets: '3', reps: '8–12', ss: false },
      { name: 'Weighted Dips', sets: '3', reps: '8–12', note: 'x'.repeat(300) },
    ] }, { name: 'Rest', rest: true, ex: [] }] });
    expect(days).toHaveLength(2);
    const [a, b, c] = days[0]!.exercises;
    expect(a!.m).toEqual(['triceps']);
    expect(b!.m).toEqual(['biceps']);
    expect(c!.m).toEqual(['triceps', 'chest']);
    expect(c!.note).toHaveLength(180);
    expect(supersetGroups(days[0]!.exercises)).toEqual([[0, 1], [2, 2]]);
    expect(days[1]!.rest).toBe(true);
  });
  it('rejects junk safely', () => {
    expect(fromV1Program(null)).toEqual([]);
    expect(fromV1Program({ days: 'nope' })).toEqual([]);
  });
});

describe('metrics', () => {
  it('Epley e1RM only for 1–12 reps', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 2);
    expect(e1rm(100, 15)).toBeNull();
    expect(e1rm(null, 5)).toBeNull();
  });

  it('ignores warm-ups for e1RM and volume', () => {
    const bench = ex('Bench Press', [[60, 10, 'warmup'], [100, 6], [100, 5]]);
    expect(bestE1rm(bench)).toBeCloseTo(120, 5);
    const v = muscleVolume([bench]);
    expect(v.chest).toEqual({ direct: 2, assisting: 0 });
    expect(v.triceps).toEqual({ direct: 0, assisting: 2 });
  });

  it('finds e1RM and weight-for-reps records against history only', () => {
    const before = [ex('Weighted Dips', [[20, 8], [20, 8]])];
    const now = [ex('Weighted Dips', [[22.5, 8], [22.5, 7]])];
    const prs = findPRs(now, before);
    expect(prs.map((p) => p.kind).sort()).toEqual(['e1rm', 'weight-for-reps']);
    expect(findPRs(now, [])).toEqual([]);
  });

  it('progression hint: double progression', () => {
    expect(progressionHint(ex('Row', [[60, 8], [60, 8]]), 8)).toMatch(/more weight/);
    expect(progressionHint(ex('Row', [[60, 8], [60, 6]]), 8)).toMatch(/one more rep/);
  });

  it('fits a session into the time available, main lifts first', () => {
    const list = [{ plannedSets: 4, skipped: false }, { plannedSets: 3, skipped: false }, { plannedSets: 3, skipped: false }, { plannedSets: 4, skipped: false }];
    expect(estimateMinutes(list)).toBe(39);
    const fitted = fitToTime(list, 25);
    expect(fitted.map((e) => e.skipped)).toEqual([false, false, true, true]);
  });
});
