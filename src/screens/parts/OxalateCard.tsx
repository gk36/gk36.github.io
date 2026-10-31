import { useState } from 'preact/hooks';
import { useAsync, useLive } from '../../ui/hooks';
import { NumberField } from '../../ui/controls';
import { Leaf } from '../../ui/icons';
import { coreFoods } from '../../data/foods/registry';
import { listDay } from '../../data/entries';
import type { LogEntry } from '../../data/types';
import type { Food } from '../../domain/nutrition/food';
import { addDays, type DayKey } from '../../domain/time';
import {
  entryOxalate, sumOxalate, OXALATE_DAILY_CONTEXT, OXALATE_LABEL, OXALATE_SOURCES, type OxalateLevel, type OxalatePart,
} from '../../domain/micros/oxalate';
import { profile, updateProfile } from '../../app/store';

interface Row { label: string; mg: number | null; level: OxalateLevel | null; perServing: string | null; conflict: string | null }

/** One line per food (the same food logged twice is added up). */
function rowsOf(parts: readonly OxalatePart[], days: number): Row[] {
  const by = new Map<string, Row>();
  for (const p of parts) {
    const cur = by.get(p.foodId);
    const mg = p.est?.mg ?? null;
    if (cur) { if (cur.mg !== null && mg !== null) cur.mg += mg / days; continue; }
    by.set(p.foodId, {
      label: p.label, mg: mg === null ? null : mg / days, level: p.est?.level ?? null,
      perServing: p.est && p.est.mg === null && p.est.info.mg !== null && p.est.info.serving ? `${p.est.info.mg} mg per ${p.est.info.serving}` : null,
      conflict: p.est?.info.conflict ?? null,
    });
  }
  return [...by.values()];
}

const fmt = (mg: number) => (mg < 10 ? (Math.round(mg * 10) / 10).toString() : Math.round(mg).toString());

/**
 * Oxalate for the day (or the 7-day average) from foods with a cited value. Foods without one are
 * listed as unknown and make the total an "at least". There is no official daily intake: the card
 * quotes the two sources' guidance and lets the user set the limit their doctor gave them.
 */
export function OxalateCard({ dayKey, range }: { dayKey: DayKey; range: 'day' | 'week' }) {
  const p = profile.value!;
  const [editing, setEditing] = useState(false);
  const core = useAsync(async () => new Map((await coreFoods()).map((f) => [f.id, f])), []);
  const days = useLive(async () => {
    const n = range === 'day' ? 1 : 7;
    const out: LogEntry[][] = [];
    for (let i = 0; i < n; i++) {
      const rows = (await listDay(addDays(dayKey, -i))).filter((e) => e.status === 'eaten');
      if (rows.length) out.push(rows);
    }
    return out;
  }, [dayKey, range], [] as LogEntry[][]);
  if (!core || !days.length) return null;

  const parts = days.flatMap((d) => d.flatMap((e) => entryOxalate(e.food as Food, e.qty, core)));
  const total = sumOxalate(parts);
  const mg = total.mg / days.length;
  const rows = rowsOf(parts, days.length);
  const known = rows.filter((r) => r.mg !== null).sort((a, b) => (b.mg ?? 0) - (a.mg ?? 0));
  const unknown = rows.filter((r) => r.mg === null);
  const limit = p.oxalateLimitMg ?? null;
  const lower = unknown.length > 0;
  const pct = limit ? Math.min(100, (mg / limit) * 100) : null;
  const over = limit !== null && mg > limit;

  return (
    <section class="card stack-s oxalate" aria-labelledby="ox-title">
      <div class="spread">
        <h2 id="ox-title" class="card-title"><Leaf size={14} aria-hidden="true" /> Oxalate</h2>
        <button type="button" class="linkish small" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{limit ? 'Change limit' : 'Set a daily limit'}</button>
      </div>
      <p class="ox-total">
        <span class="ox-num num">{lower ? '≥ ' : ''}{fmt(mg)}</span>
        <span class="muted"> mg {range === 'day' ? 'today' : `a day (average of ${days.length} day${days.length === 1 ? '' : 's'})`}{limit ? ` · your limit ${limit} mg` : ''}</span>
      </p>
      {pct !== null ? (
        <div class={`bar-track${over ? ' bar-over' : ''}`} role="progressbar" aria-label="Oxalate against your daily limit" aria-valuemin={0} aria-valuemax={limit!}
          aria-valuenow={Math.round(mg)} aria-valuetext={`${lower ? 'at least ' : ''}${fmt(mg)} of ${limit} mg`}>
          <div class="bar-fill" style={{ width: `${pct}%`, background: over ? 'var(--warn)' : 'var(--carbs)' }} />
        </div>
      ) : null}
      {editing ? (
        <div class="stack-s">
          <NumberField label="Your daily oxalate limit" suffix="mg" value={limit} min={10} max={1000}
            onChange={(v) => void updateProfile({ oxalateLimitMg: v })}
            hint="Use the number your doctor gave you. Leave it empty for no limit." />
        </div>
      ) : null}
      <p class="small">
        Counted from <b>{known.length}</b> food{known.length === 1 ? '' : 's'} with a cited value{unknown.length ? <>; <b>{unknown.length}</b> without an amount we can count {unknown.length === 1 ? 'is' : 'are'} listed below and not added, so the real total is higher.</> : '.'}
      </p>
      {known.length ? (
        <ul class="ox-list" aria-label="Oxalate by food">
          {known.slice(0, 6).map((r) => (
            <li key={r.label}>
              <span class="ox-food">{r.label}</span>
              <span class="num">{fmt(r.mg!)} mg</span>
              {r.level ? <span class={`badge ${r.level === 'high' || r.level === 'very-high' ? 'warn' : ''}`}>{OXALATE_LABEL[r.level].replace(' oxalate', '')}</span> : null}
              {r.conflict ? <span class="xs subtle ox-note">Sources disagree: {r.conflict}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {unknown.length ? (
        <details class="ox-unknown">
          <summary class="small">Not counted ({unknown.length})</summary>
          <ul class="ox-list">
            {unknown.map((r) => (
              <li key={r.label}>
                <span class="ox-food">{r.label}</span>
                <span class="xs subtle">{r.perServing ? `${OXALATE_LABEL[r.level!].toLowerCase()} — ${r.perServing}, weight not stated` : 'no cited value (unknown, not zero)'}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p class="xs subtle">
        There is no official daily intake for oxalate. Guidance: <a href={OXALATE_DAILY_CONTEXT.upmc.url} target="_blank" rel="noopener noreferrer">UPMC</a> — low-oxalate diet 40–50 mg a day;{' '}
        <a href={OXALATE_DAILY_CONTEXT.uchicago.url} target="_blank" rel="noopener noreferrer">University of Chicago Kidney Stone Program</a> — under 100 mg a day, ideally about 50. Follow your doctor's number if you have one.
        Values: <a href={OXALATE_SOURCES['harvard-2023'].url} target="_blank" rel="noopener noreferrer">Harvard T.H. Chan 2023 table</a> first, then lab studies and kidney-stone program lists.
      </p>
    </section>
  );
}
