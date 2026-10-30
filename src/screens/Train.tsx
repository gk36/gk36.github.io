import { useState } from 'preact/hooks';
import { useAsync, useLive } from '../ui/hooks';
import { Field } from '../ui/controls';
import { Dumbbell, ExternalLink, Timer } from '../ui/icons';
import type { Program, WorkoutSession } from '../data/db';
import { activeProgram, fetchV1Program, importV1Program, listSessions, nextProgramDay, readV1Programs, startSession } from '../data/training';
import { MUSCLES, supersetGroups, type ProgramDay } from '../domain/training/program';
import { findPRs, muscleVolume, tonnage } from '../domain/training/metrics';
import { addDays, formatDayLabel } from '../domain/time';
import { navigate } from '../app/router';
import { todayKey, toast } from '../app/store';
import { Session } from './Session';

export function Train({ params }: { params: string[] }) {
  if (params[0] === 'session' && params[1]) return <Session id={params[1]} />;
  return <TrainHome />;
}

function TrainHome() {
  const program = useLive(() => activeProgram(), [], undefined as Program | undefined);
  const sessions = useLive(() => listSessions(40), [], [] as WorkoutSession[]);
  const next = useAsync(async () => (program ? nextProgramDay(program) : undefined), [program?.id, program?.updatedAt, sessions.length]);
  const open = sessions.find((s) => !s.endedAt);

  const start = async (day?: ProgramDay) => {
    const s = await startSession({ dayKey: todayKey.value, ...(program ? { program } : {}), ...(day ? { day } : {}) });
    navigate('train', 'session', s.id);
  };

  return (
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Train</h1>
        <a class="btn btn-s" href="../workout.html"><ExternalLink size={15} aria-hidden="true" /> Classic editor & 3D viewer</a>
      </div>

      {open ? (
        <section class="card cluster" aria-label="Workout in progress">
          <Timer size={20} aria-hidden="true" />
          <div class="item-main"><b>{open.name}</b><span class="small muted">started {new Date(open.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <button type="button" class="btn btn-primary" onClick={() => navigate('train', 'session', open.id)}>Resume</button>
        </section>
      ) : null}

      {program ? (
        <section class="card stack" aria-labelledby="tr-prog">
          <div class="spread">
            <h2 id="tr-prog" class="card-title">{program.name}</h2>
            {next && !open ? <button type="button" class="btn btn-primary" onClick={() => void start(next)}>Start {next.rest ? 'rest day' : next.name}</button> : null}
          </div>
          <ul class="list">
            {program.days.map((d) => (
              <li key={d.id}>
                <div class="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div class="item-main">
                    <span class="item-name">{d.name}{next?.id === d.id ? <span class="badge ember" style={{ marginLeft: '6px' }}>next</span> : null}</span>
                    {d.rest ? <span class="item-sub">Rest</span> : (
                      <span class="item-sub">
                        {supersetGroups(d.exercises).map(([a, b], gi) => (
                          <span key={gi}>{gi ? ' · ' : ''}{d.exercises.slice(a, b + 1).map((e) => `${e.name} ${e.sets}×${e.reps}`).join(' + ')}</span>
                        ))}
                      </span>
                    )}
                  </div>
                  {!d.rest && !open ? <button type="button" class="btn btn-s" onClick={() => void start(d)}>Start</button> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : <ImportProgram />}

      {!program && !open ? <button type="button" class="btn" onClick={() => void start()}>Start an empty workout</button> : null}

      <WeeklyVolume sessions={sessions} />

      <section class="card stack" aria-labelledby="tr-hist">
        <h2 id="tr-hist" class="card-title">History</h2>
        {sessions.filter((s) => s.endedAt).length ? (
          <ul class="list">
            {sessions.filter((s) => s.endedAt).slice(0, 15).map((s, i, all) => {
              const sets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done && x.kind !== 'warmup').length, 0);
              const kg = s.exercises.reduce((t, e) => t + tonnage(e), 0);
              const prs = findPRs(s.exercises, all.slice(i + 1).flatMap((h) => h.exercises));
              return (
                <li key={s.id}>
                  <button type="button" class="item" onClick={() => navigate('train', 'session', s.id)}>
                    <div class="item-main"><span class="item-name">{s.name}</span><span class="item-sub">{formatDayLabel(s.dayKey)} · {sets} working sets · {Math.round(kg).toLocaleString('en-GB')} kg moved</span></div>
                    {prs.length ? <span class="badge ok">{prs.length} PR{prs.length > 1 ? 's' : ''}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p class="small muted">Finished workouts appear here with sets, load and personal records.</p>}
      </section>
    </div>
  );
}

function WeeklyVolume({ sessions }: { sessions: WorkoutSession[] }) {
  const from = addDays(todayKey.value, -6);
  const week = sessions.filter((s) => s.endedAt && s.dayKey >= from);
  const vol = muscleVolume(week.flatMap((s) => s.exercises));
  const rows = Object.entries(vol).sort((a, b) => b[1].direct + b[1].assisting / 2 - (a[1].direct + a[1].assisting / 2));
  if (!rows.length) return null;
  const max = Math.max(...rows.map(([, v]) => v.direct + v.assisting));
  return (
    <section class="card stack" aria-labelledby="tr-vol">
      <h2 id="tr-vol" class="card-title">Last 7 days · working sets per muscle</h2>
      <ul class="list">
        {rows.map(([m, v]) => (
          <li key={m} style={{ padding: '6px 0' }}>
            <div class="bar-label"><span>{MUSCLES[m]?.n ?? m}</span><span class="num small">{v.direct} direct{v.assisting ? ` · ${v.assisting} assisting` : ''}</span></div>
            <div class="bar-track" aria-hidden="true">
              <div class="bar-fill" style={{ width: `${(v.direct / max) * 100}%`, background: MUSCLES[m]?.c ?? 'var(--ember)' }} />
              <div class="bar-planned" style={{ left: `${(v.direct / max) * 100}%`, width: `${(v.assisting / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p class="xs subtle">Direct = the exercise's first tagged muscle; assisting = its other tags. A rough guide, not a measure of stimulus.</p>
    </section>
  );
}

function ImportProgram() {
  const local = useAsync(async () => readV1Programs(), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = Object.keys(local ?? {});
  const done = (n: string) => toast(`Imported your program “${n}”. The classic page is unchanged.`, { tone: 'ok' });
  return (
    <section class="card stack" aria-labelledby="tr-import">
      <div class="cluster"><Dumbbell size={20} aria-hidden="true" /><h2 id="tr-import" class="section-title">Bring your program over</h2></div>
      <p class="small muted">Your split, supersets and muscle tags from the classic workout page. It is copied, never moved: the classic page keeps working.</p>
      {names.length ? (
        <div class="chips">{names.map((n) => <button type="button" key={n} class="chip" onClick={async () => { await importV1Program(n, local![n]!); done(n); }}>{n}</button>)}</div>
      ) : <p class="small subtle">No classic programs saved in this browser.</p>}
      <Field label="Or fetch one program by name from the classic cloud" for="tr-name" error={err} hint="Reads only that one program.">
        <div class="cluster" style={{ flexWrap: 'nowrap' }}>
          <input id="tr-name" class="input" value={name} autoCapitalize="none" spellcheck={false} onInput={(e) => setName(e.currentTarget.value)} placeholder="program name" />
          <button type="button" class="btn" disabled={busy || !name.trim()} onClick={async () => {
            setErr(null); setBusy(true);
            try {
              const days = await fetchV1Program(name);
              if (!days) setErr('No program with that name.');
              else { await importV1Program(name.trim().toLowerCase(), days); done(name); }
            } catch (e) { setErr(e instanceof Error ? e.message : 'Could not fetch the program.'); } finally { setBusy(false); }
          }}>Import</button>
        </div>
      </Field>
    </section>
  );
}
