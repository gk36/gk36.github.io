import type { JSX } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useAsync, useLive } from '../ui/hooks';
import { Check, Plus, Timer, Trash, X } from '../ui/icons';
import { db, type WorkoutSession } from '../data/db';
import { discardSession, finishSession, lastPerformance, listSessions, updateSession } from '../data/training';
import { MUSCLES } from '../domain/training/program';
import { bestE1rm, estimateMinutes, findPRs, fitToTime, muscleVolume, progressionHint, tonnage, type LoggedSet, type SessionExercise } from '../domain/training/metrics';
import { uuidv7 } from '../data/ids';
import { formatDayLabel } from '../domain/time';
import { navigate } from '../app/router';
import { toast } from '../app/store';

const num = (s: string): number | null => { const v = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(v) || v < 0 ? null : v; };

/**
 * Keeps exactly what is typed ("22.", "") and commits the parsed number on every keystroke, so the
 * once-a-second rest-timer re-render can never wipe a half-typed weight.
 */
function SetNumber({ value, onCommit, ...rest }: { value: number | null; onCommit: (v: number | null) => void } & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput' | 'onChange'>) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { if (num(text) !== value) setText(value === null ? '' : String(value)); }, [value]);
  return <input {...rest} value={text} onInput={(ev) => { const t = ev.currentTarget.value; setText(t); onCommit(num(t)); }} />;
}

/** A one-field inline form. Replaces window.prompt, which installed iPhone apps block or show badly. */
function InlineAsk({ label, initial = '', numeric, submitLabel, onSubmit, onCancel }: {
  label: string; initial?: string; numeric?: boolean; submitLabel: string; onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const ok = numeric ? Number(v.replace(',', '.')) > 0 : v.trim().length > 0;
  return (
    <form class="cluster" style={{ width: '100%' }} onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(v.trim()); }}>
      <label for={id} class="small">{label}</label>
      <input ref={ref} id={id} class="input" style={{ flex: '1 1 140px', minHeight: '40px' }} value={v} maxLength={120} inputMode={numeric ? 'numeric' : 'text'}
        onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }} />
      <button type="submit" class="btn btn-s btn-primary" disabled={!ok}>{submitLabel}</button>
      <button type="button" class="btn btn-s" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export function Session({ id }: { id: string }) {
  const stored = useLive(() => db().sessions.get(id), [id], undefined as WorkoutSession | undefined);
  const [s, setS] = useState<WorkoutSession | null>(null);
  const [rest, setRest] = useState<{ until: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState(false);
  const [ask, setAsk] = useState<null | 'add' | 'discard'>(null);
  const [notes, setNotes] = useState('');
  const saveTimer = useRef(0);
  // Edits arrive in bursts (a reps field commits on blur in the same tick as the "done" tap), so every
  // update applies to the latest session, never to the one captured by the last render.
  const latest = useRef<WorkoutSession | null>(null);
  latest.current = s;
  useEffect(() => { if (stored && !s) { setS(stored); setNotes(stored.notes ?? ''); } }, [stored]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (rest && now >= rest.until) { setRest(null); try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ } }
  }, [now, rest]);
  const history = useAsync(async () => (await listSessions(200)).filter((x) => x.id !== id && x.endedAt).flatMap((x) => x.exercises), [id]);

  if (!s) return <div class="page"><p class="muted">Loading…</p></div>;
  const readOnly = !!s.endedAt;

  const change = (f: (cur: WorkoutSession) => WorkoutSession) => {
    const next = f(latest.current!);
    latest.current = next;
    setS(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void updateSession(next), 400);
  };
  const setEx = (exId: string, f: (e: SessionExercise) => SessionExercise) => change((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === exId ? f(e) : e)) }));
  const setSet = (exId: string, setId: string, patch: Partial<LoggedSet>) => setEx(exId, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)) }));

  const elapsed = Math.max(0, Math.round(((s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt)) / 60000));
  const prs = findPRs(s.exercises, history ?? []);

  const finish = async () => {
    clearTimeout(saveTimer.current);
    const done = await finishSession(latest.current!, notes.trim() || undefined);
    setS(done);
    setSummary(true);
    toast('Workout saved', { tone: 'ok' });
  };

  return (
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">{s.name}</h1>
          <p class="small muted">{formatDayLabel(s.dayKey)} · {elapsed} min{readOnly ? ' · finished' : ''}</p>
        </div>
        <div class="cluster">
          {!readOnly ? <button type="button" class="btn btn-primary" onClick={() => void finish()}><Check size={16} aria-hidden="true" /> Finish</button> : null}
          <button type="button" class="btn btn-s" onClick={() => navigate('train')}>Back</button>
        </div>
      </div>

      {!readOnly ? <TimeBudget s={s} onChange={change} /> : null}

      {(summary || readOnly) ? <Summary s={s} prs={prs} /> : null}

      {s.exercises.map((e, i) => (
        <ExerciseCard key={e.id} e={e} prevSs={i > 0 && s.exercises[i - 1]!.ss} readOnly={readOnly} startedAt={s.startedAt}
          onSet={(setId, patch) => {
            setSet(e.id, setId, patch);
            if (patch.done === true && !e.ss) setRest({ until: Date.now() + s.restSec * 1000 });
          }}
          onChange={(f) => setEx(e.id, f)} />
      ))}

      {!readOnly ? (
        ask === 'add' ? (
          <InlineAsk label="Exercise name" submitLabel="Add" onCancel={() => setAsk(null)} onSubmit={(name) => {
            change((cur) => ({ ...cur, exercises: [...cur.exercises, { id: uuidv7(), name, m: [], ss: false, plannedSets: 3, repMin: null, repMax: null, prescription: '3 sets', sets: [1, 2, 3].map(() => ({ id: uuidv7(), kind: 'working' as const, weightKg: null, reps: null, rir: null, done: false })) }] }));
            setAsk(null);
          }} />
        ) : ask === 'discard' ? (
          <div class="callout danger cluster" role="alert">
            <span class="grow">Discard this workout? Its logged sets will be removed.</span>
            <button type="button" class="btn btn-s btn-danger" onClick={async () => { clearTimeout(saveTimer.current); await discardSession(latest.current!); navigate('train'); }}>Discard workout</button>
            <button type="button" class="btn btn-s" onClick={() => setAsk(null)}>Keep it</button>
          </div>
        ) : (
          <div class="cluster">
            <button type="button" class="btn" onClick={() => setAsk('add')}><Plus size={16} aria-hidden="true" /> Add exercise</button>
            <button type="button" class="btn btn-danger" onClick={() => setAsk('discard')}><Trash size={16} aria-hidden="true" /> Discard</button>
          </div>
        )
      ) : null}

      {!readOnly || notes ? (
        <section class="card stack-s">
          <label for="ses-notes" class="card-title">Notes</label>
          <textarea id="ses-notes" class="textarea" value={notes} readOnly={readOnly} onInput={(e) => setNotes(e.currentTarget.value)} placeholder="Energy, sleep, pain, what to change…" />
        </section>
      ) : null}

      {rest && !readOnly ? (
        <div class="toast" role="timer" aria-live="off" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(var(--nav-h) + 16px + env(safe-area-inset-bottom))', zIndex: 40, minWidth: '280px' }}>
          <Timer size={18} aria-hidden="true" />
          <span class="grow num"><b>Rest {Math.floor(Math.max(0, rest.until - now) / 60000)}:{String(Math.floor((Math.max(0, rest.until - now) % 60000) / 1000)).padStart(2, '0')}</b></span>
          <button type="button" class="btn btn-s" onClick={() => setRest({ until: rest.until + 30_000 })}>+30 s</button>
          <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label="Skip rest" onClick={() => setRest(null)}><X size={16} /></button>
        </div>
      ) : null}
    </div>
  );
}

function TimeBudget({ s, onChange }: { s: WorkoutSession; onChange: (f: (cur: WorkoutSession) => WorkoutSession) => void }) {
  const est = estimateMinutes(s.exercises, s.restSec);
  const [asking, setAsking] = useState(false);
  return (
    <section class="card cluster" aria-label="Time and rest">
      <span class="small">≈ <b>{est} min</b> at {Math.round(s.restSec / 60 * 10) / 10} min rest</span>
      <label class="small cluster">Rest
        <select class="select" style={{ width: 'auto', minHeight: '36px' }} value={String(s.restSec)} onChange={(e) => { const restSec = Number(e.currentTarget.value); onChange((cur) => ({ ...cur, restSec })); }}>
          {[60, 90, 120, 150, 180, 240].map((r) => <option key={r} value={String(r)}>{r} s</option>)}
        </select>
      </label>
      {asking ? (
        <InlineAsk label="Minutes you have" initial={String(Math.max(10, Math.round(est / 5) * 5 - 15))} numeric submitLabel="Fit" onCancel={() => setAsking(false)} onSubmit={(v) => {
          const m = Number(v.replace(',', '.'));
          const fitted = fitToTime(s.exercises, m, s.restSec);
          onChange((cur) => ({ ...cur, exercises: fitted }));
          setAsking(false);
          toast(`Kept ${fitted.filter((e) => !e.skipped).length} of ${fitted.length} exercises (main lifts first). Skipped ones stay in your program.`, { ms: 5000 });
        }} />
      ) : <button type="button" class="btn btn-s" onClick={() => setAsking(true)}>I only have…</button>}
    </section>
  );
}

function ExerciseCard({ e, prevSs, readOnly, startedAt, onSet, onChange }: {
  e: SessionExercise; prevSs: boolean; readOnly: boolean; startedAt: string;
  onSet: (setId: string, patch: Partial<LoggedSet>) => void; onChange: (f: (e: SessionExercise) => SessionExercise) => void;
}) {
  const last = useAsync(() => lastPerformance(e.name, startedAt), [e.name, startedAt]);
  const hint = useMemo(() => progressionHint(last, e.repMax), [last, e.repMax]);
  const lastText = last ? last.sets.filter((x) => x.done && x.kind !== 'warmup').map((x) => `${x.weightKg ?? 'BW'}×${x.reps ?? '?'}`).join(', ') : null;
  const best = bestE1rm(e);
  const [swapping, setSwapping] = useState(false);
  return (
    <section class="meal" aria-label={e.name} style={{ opacity: e.skipped ? 0.55 : 1, marginTop: prevSs ? '-10px' : undefined, borderTopLeftRadius: prevSs ? '4px' : undefined, borderTopRightRadius: prevSs ? '4px' : undefined }}>
      <div class="meal-head">
        <div>
          <h2 class="meal-name">{prevSs ? <span class="badge ember" style={{ marginRight: '6px' }}>superset</span> : null}{e.name}</h2>
          <div class="meal-meta">{e.prescription}{e.note ? ` · ${e.note}` : ''}</div>
          <div class="chips" style={{ marginTop: '4px' }}>{e.m.map((m) => <span key={m} class="badge" style={{ borderColor: MUSCLES[m]?.c }}>{MUSCLES[m]?.n ?? m}</span>)}</div>
        </div>
        {!readOnly ? (
          <div class="cluster">
            <button type="button" class="btn btn-s" aria-expanded={swapping} onClick={() => setSwapping(!swapping)}>Swap</button>
            <button type="button" class="btn btn-s" aria-pressed={!!e.skipped} onClick={() => onChange((x) => ({ ...x, skipped: !x.skipped }))}>{e.skipped ? 'Unskip' : 'Skip'}</button>
          </div>
        ) : null}
      </div>
      {swapping && !readOnly ? (
        <InlineAsk label="Replace with" initial={e.name} submitLabel="Replace" onCancel={() => setSwapping(false)} onSubmit={(name) => {
          if (name !== e.name) onChange((x) => ({ ...x, name, note: `${x.note ? `${x.note} · ` : ''}replaced ${x.name}` }));
          setSwapping(false);
        }} />
      ) : null}
      {lastText ? <p class="xs subtle">Last time: {lastText}{hint ? ` — ${hint}` : ''}</p> : null}
      <table class="ntable" aria-label={`${e.name} sets`}>
        <thead><tr><th scope="col">Set</th><th scope="col">kg</th><th scope="col">Reps</th><th scope="col">RIR</th><th scope="col"><span class="sr-only">Done</span></th></tr></thead>
        <tbody>
          {e.sets.map((x, i) => {
            const label = x.kind === 'warmup' ? 'W' : String(e.sets.filter((y, j) => j <= i && y.kind !== 'warmup').length);
            return (
              <tr key={x.id}>
                <td><b>{label}</b></td>
                <td><SetNumber class="input input-num" style={{ minHeight: '40px', padding: '6px 8px', maxWidth: '84px' }} inputMode="decimal" aria-label={`Set ${label} weight in kg`} readOnly={readOnly}
                  value={x.weightKg} onCommit={(v) => onSet(x.id, { weightKg: v })} /></td>
                <td><SetNumber class="input input-num" style={{ minHeight: '40px', padding: '6px 8px', maxWidth: '72px' }} inputMode="numeric" aria-label={`Set ${label} reps`} readOnly={readOnly}
                  placeholder={e.repMin ? `${e.repMin}${e.repMax && e.repMax !== e.repMin ? `–${e.repMax}` : ''}` : ''}
                  value={x.reps} onCommit={(v) => onSet(x.id, { reps: v })} /></td>
                <td><select class="select" style={{ minHeight: '40px', padding: '4px', width: 'auto' }} aria-label={`Set ${label} reps in reserve`} disabled={readOnly}
                  value={x.rir === null || x.rir === undefined ? '' : String(x.rir)} onChange={(ev) => onSet(x.id, { rir: ev.currentTarget.value === '' ? null : Number(ev.currentTarget.value) })}>
                  <option value="">–</option>{[0, 1, 2, 3, 4].map((r) => <option key={r} value={String(r)}>{r}{r === 4 ? '+' : ''}</option>)}
                </select></td>
                <td><input type="checkbox" style={{ width: '24px', height: '24px', accentColor: 'var(--ok)' }} aria-label={`Set ${label} done`} disabled={readOnly}
                  checked={x.done} onChange={(ev) => onSet(x.id, { done: ev.currentTarget.checked })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly ? (
        <div class="cluster" style={{ marginTop: '6px' }}>
          <button type="button" class="btn btn-s" onClick={() => onChange((x) => ({ ...x, sets: [...x.sets, { id: uuidv7(), kind: 'working', weightKg: x.sets.at(-1)?.weightKg ?? null, reps: null, rir: null, done: false }] }))}><Plus size={14} aria-hidden="true" /> Set</button>
          <button type="button" class="btn btn-s" onClick={() => onChange((x) => ({ ...x, sets: [{ id: uuidv7(), kind: 'warmup', weightKg: null, reps: null, rir: null, done: false }, ...x.sets] }))}><Plus size={14} aria-hidden="true" /> Warm-up</button>
          {best ? <span class="xs subtle">est. 1RM {Math.round(best * 10) / 10} kg</span> : null}
        </div>
      ) : best ? <p class="xs subtle">est. 1RM {Math.round(best * 10) / 10} kg</p> : null}
    </section>
  );
}

function Summary({ s, prs }: { s: WorkoutSession; prs: ReturnType<typeof findPRs> }) {
  const vol = muscleVolume(s.exercises);
  const sets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done && x.kind !== 'warmup').length, 0);
  const kg = s.exercises.reduce((t, e) => t + tonnage(e), 0);
  return (
    <section class="card stack-s" aria-label="Workout summary">
      <h2 class="card-title">Summary</h2>
      <p class="small"><b>{sets}</b> working sets · <b>{Math.round(kg).toLocaleString('en-GB')} kg</b> moved · {Object.keys(vol).length} muscles trained</p>
      {prs.length ? <ul class="small" style={{ margin: 0, paddingLeft: '18px' }}>{prs.map((p, i) => (
        <li key={i}>{p.exercise}: {p.kind === 'e1rm' ? `best estimated 1RM ${Math.round(p.value * 10) / 10} kg` : `${p.value} kg × ${p.reps}`}{p.previous !== null ? ` (was ${Math.round(p.previous * 10) / 10})` : ''}</li>
      ))}</ul> : <p class="small muted">No new records this time — consistency counts.</p>}
    </section>
  );
}
