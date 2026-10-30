/**
 * Training programs, compatible with CARBMAXX v1 (workout.html): days → exercises with
 * prescription strings ("4", "6–8", "to failure", "30–45 sec"), superset links (`ss` joins an
 * exercise with the NEXT one), up to 4 muscle tags and a 3D animation key.
 */

export const MUSCLES: Record<string, { n: string; c: string }> = {
  frontdelt: { n: 'Front Delts', c: '#ffa94d' }, sidedelt: { n: 'Side Delts', c: '#ff8c42' }, reardelt: { n: 'Rear Delts', c: '#ff6a3d' },
  biceps: { n: 'Biceps', c: '#f472b6' }, triceps: { n: 'Triceps', c: '#c084fc' }, forearms: { n: 'Forearms', c: '#fb7185' },
  chest: { n: 'Chest', c: '#ff5a5f' }, upperchest: { n: 'Upper Chest', c: '#ff7f9e' }, lats: { n: 'Lats', c: '#38bdf8' },
  upperback: { n: 'Upper Back', c: '#60a5fa' }, traps: { n: 'Traps', c: '#818cf8' }, lowerback: { n: 'Lower Back', c: '#7dd3fc' },
  quads: { n: 'Quads', c: '#3ecf8e' }, hamstrings: { n: 'Hamstrings', c: '#2fae76' }, glutes: { n: 'Glutes', c: '#86efac' },
  calves: { n: 'Calves', c: '#14b8a6' }, abs: { n: 'Abs', c: '#f6c453' },
};

export const ANIMKEYS = ['press', 'curl', 'skullcrusher', 'pushdown', 'lateralraise', 'rearfly', 'row', 'pullup', 'chestpress', 'fly', 'pullover', 'facepull', 'squat', 'splitsquat', 'kneext', 'hinge', 'legcurl', 'calfraise', 'hangraise', 'crunch', 'carry', 'wristcurl'] as const;

/** v1 keyword inference (workout.html inferMuscles), kept identical so old programs tag the same. */
export function inferMuscles(name: string): string[] {
  const n = String(name).toLowerCase();
  const has = (...w: string[]) => w.some((x) => n.includes(x));
  if (has('wrist')) return ['forearms'];
  if (has('leg curl')) return ['hamstrings'];
  if (has('leg extension')) return ['quads'];
  if (has('leg raise', 'crunch', 'sit-up', 'situp', 'plank', 'ab wheel')) return ['abs'];
  if (has('calf')) return ['calves'];
  if (has('deadlift', 'rdl', 'good morning', 'back extension')) return ['hamstrings', 'glutes', 'lowerback'];
  if (has('split squat', 'lunge', 'step-up', 'step up')) return ['quads', 'glutes'];
  if (has('squat', 'leg press', 'hack')) return ['quads', 'glutes'];
  if (has('hip thrust', 'glute')) return ['glutes', 'hamstrings'];
  if (has('reverse curl', 'reverse ez')) return ['forearms', 'biceps'];
  if (has('hammer')) return ['biceps', 'forearms'];
  if (has('curl')) return ['biceps'];
  if (has('dip')) return ['triceps', 'chest'];
  if (has('skull', 'pushdown', 'push-down', 'tricep', 'kickback', 'close-grip', 'jm press', 'overhead extension')) return ['triceps'];
  if (has('lateral raise', 'lat raise', 'side raise')) return ['sidedelt'];
  if (has('rear delt', 'face pull', 'facepull', 'reverse fly', 'reverse flye', 'reverse pec')) return ['reardelt', 'upperback'];
  if (has('front raise')) return ['frontdelt'];
  if (has('shoulder press', 'overhead press', 'ohp', 'arnold', 'military')) return ['frontdelt', 'sidedelt', 'triceps'];
  if (has('pull-up', 'pullup', 'pull up', 'chin', 'pulldown', 'pull-down')) return ['lats', 'biceps'];
  if (has('pullover')) return ['lats', 'chest'];
  if (has('shrug')) return ['traps'];
  if (has('row')) return ['upperback', 'lats'];
  if (has('incline') && has('press', 'fly', 'flye', 'flies')) return ['upperchest', 'frontdelt', 'triceps'];
  if (has('bench', 'chest press', 'pec', 'fly', 'flye', 'flies')) return ['chest', 'frontdelt', 'triceps'];
  if (has('carry', 'farmer', 'hold', 'grip')) return ['forearms', 'traps'];
  if (has('extension')) return ['triceps'];
  if (has('press')) return ['frontdelt', 'triceps'];
  return [];
}

export interface ProgramExercise {
  id: string;
  name: string;
  sets: string;
  reps: string;
  note: string;
  /** Superset with the NEXT exercise (v1 semantics). */
  ss: boolean;
  m: string[];
  anim: string;
}

export interface ProgramDay { id: string; name: string; rest: boolean; exercises: ProgramExercise[] }

export interface Prescription {
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  /** "to failure", "AMRAP" */
  toFailure: boolean;
  /** "30–45 sec" holds/carries */
  seconds: [number, number] | null;
  perSide: boolean;
}

/** Turns v1 prescription strings into numbers (the original text is always kept for display). */
export function parsePrescription(sets: string, reps: string): Prescription {
  const s = /(\d+)/.exec(sets);
  const r = reps.toLowerCase();
  const range = /(\d+)\s*(?:[-–—]|to)\s*(\d+)/.exec(r);
  const single = /(\d+)/.exec(r);
  const secs = /sec|s\b|second/.test(r);
  const lo = range ? Number(range[1]) : single ? Number(single[1]) : null;
  const hi = range ? Number(range[2]) : lo;
  return {
    sets: s ? Number(s[1]) : null,
    repMin: secs ? null : lo,
    repMax: secs ? null : hi,
    toFailure: /fail|amrap|max/.test(r),
    seconds: secs && lo !== null && hi !== null ? [lo, hi] : null,
    perSide: /\/\s*(leg|side|arm)|each|per side/.test(r),
  };
}

/** Superset groups as [from, to] index ranges (an `ss` exercise joins the next one). */
export function supersetGroups(exercises: readonly Pick<ProgramExercise, 'ss'>[]): [number, number][] {
  const groups: [number, number][] = [];
  let i = 0;
  while (i < exercises.length) {
    let j = i;
    while (j < exercises.length - 1 && exercises[j]!.ss) j++;
    groups.push([i, j]);
    i = j + 1;
  }
  return groups;
}

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Sanitises a v1 program JSON ({days:[{name,rest,ex:[…]}]}) with v1's own limits
 * (14 days, 25 exercises/day, names 80, notes 180, 4 muscles) into the new shape.
 */
export function fromV1Program(raw: unknown): ProgramDay[] {
  const p = raw as { days?: unknown };
  const days = Array.isArray(p?.days) ? (p.days as unknown[]) : [];
  return days.slice(0, 14).map((d0) => {
    const d = (d0 ?? {}) as { name?: unknown; rest?: unknown; ex?: unknown };
    const ex = Array.isArray(d.ex) ? (d.ex as unknown[]) : [];
    return {
      id: nextId('day'),
      name: String(d.name ?? 'Day').slice(0, 60),
      rest: !!d.rest,
      exercises: ex.slice(0, 25).map((e0) => {
        const e = (e0 ?? {}) as Record<string, unknown>;
        const name = String(e.name ?? 'Exercise').slice(0, 80);
        const m = Array.isArray(e.m) ? (e.m as unknown[]).filter((k): k is string => typeof k === 'string' && k in MUSCLES).slice(0, 4) : inferMuscles(name);
        return {
          id: nextId('ex'), name,
          sets: String(e.sets ?? '3').slice(0, 6), reps: String(e.reps ?? '10').slice(0, 20), note: String(e.note ?? '').slice(0, 180),
          ss: !!e.ss, m, anim: typeof e.anim === 'string' && (ANIMKEYS as readonly string[]).includes(e.anim) ? e.anim : '',
        };
      }),
    };
  });
}
