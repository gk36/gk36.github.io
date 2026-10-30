import { useMemo, useState } from 'preact/hooks';
import { db } from '../data/db';
import { listDay } from '../data/entries';
import type { DayRecord, LogEntry } from '../data/types';
import { dayTotals, entryNutrients } from '../domain/diary';
import { NUTRIENTS, type NutrientId } from '../domain/nutrition/nutrients';
import { sumNutrients, type Totals } from '../domain/nutrition/compute';
import { fmtNutrient, roundFor } from '../domain/nutrition/format';
import { coverageFor, averageTotals, type NutrientCoverage } from '../domain/micros/coverage';
import { groupLabel, referencesFor, type DriTable, type Reference } from '../domain/micros/dri';
import { addDays, formatDayLabel, type DayKey } from '../domain/time';
import { ageFor } from '../data/profile';
import { openSheet, profile, todayKey } from '../app/store';
import { href, navigate } from '../app/router';
import { useAsync, useLive } from '../ui/hooks';
import { Segmented } from '../ui/controls';
import { ChevronLeft, ChevronRight, Info } from '../ui/icons';
import { slotsFor } from './parts/DayView';
import { OxalateCard } from './parts/OxalateCard';

export const VITAMINS: NutrientId[] = ['vitA', 'retinol', 'vitC', 'vitD', 'vitE', 'vitK', 'thiamin', 'riboflavin', 'niacin', 'pantothenic', 'vitB6', 'biotin', 'folate', 'vitB12', 'choline'];
export const MINERALS: NutrientId[] = ['calcium', 'phosphorus', 'magnesium', 'potassium', 'sodium', 'iron', 'zinc', 'copper', 'manganese', 'selenium', 'iodine'];
export const OTHER: NutrientId[] = ['fiber', 'satFat', 'sugars', 'cholesterol', 'ala', 'epa', 'dha'];

export const loadDri = () => import('../domain/micros/dri-table.json').then((m) => (m as unknown as { default: DriTable }).default);

type Filter = 'all' | 'below' | 'unknown' | 'limits';

const STATUS_TEXT: Record<NutrientCoverage['status'], string> = {
  met: 'Met', partial: 'Below target', low: 'Low', unknown: 'Unknown', 'no-target': 'No reference', 'over-ul': 'Above upper limit', 'over-limit': 'Above recommended limit',
};

export function Nutrients({ dayKey }: { dayKey: DayKey }) {
  const p = profile.value!;
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [filter, setFilter] = useState<Filter>('all');
  const dri = useAsync(loadDri, []);
  const age = ageFor(p, dayKey);
  const refs = useMemo(() => (dri && p.sex && age !== null ? referencesFor(dri, p.sex, age) : null), [dri, p.sex, age]);

  const entries = useLive(() => listDay(dayKey), [dayKey], [] as LogEntry[]);
  const week = useLive(async () => {
    const days: Totals[] = [];
    for (let i = 0; i < 7; i++) {
      const rows = (await listDay(addDays(dayKey, -i))).filter((e) => e.status === 'eaten');
      if (rows.length) days.push(sumNutrients(rows.flatMap((e) => entryNutrients(e).parts)));
    }
    return days;
  }, [dayKey], [] as Totals[]);

  const eaten = entries.filter((e) => e.status === 'eaten');
  const totals = range === 'day' ? dayTotals(entries).eaten : averageTotals(week);
  const rows = totals ? coverageFor(totals, refs, [...VITAMINS, ...MINERALS, ...OTHER]) : [];
  const visible = rows.filter((r) => {
    if (filter === 'below') return r.status === 'partial' || r.status === 'low';
    if (filter === 'unknown') return r.status === 'unknown' || r.unknown > 0;
    if (filter === 'limits') return r.status === 'over-ul' || r.status === 'over-limit';
    return true;
  });
  const microShare = totals ? totals.calcium.energyShare : 1;

  return (
    <div class="page">
      <div class="page-head">
        <div class="cluster">
          <button type="button" class="btn btn-icon" aria-label="Previous day" onClick={() => navigate('nutrients', addDays(dayKey, -1))}><ChevronLeft size={20} /></button>
          <div>
            <h1 class="page-title">Nutrients</h1>
            <p class="small muted">{range === 'day' ? formatDayLabel(dayKey) : `7 days to ${formatDayLabel(dayKey)} · ${week.length} day${week.length === 1 ? '' : 's'} with food`}</p>
          </div>
          <button type="button" class="btn btn-icon" aria-label="Next day" onClick={() => navigate('nutrients', addDays(dayKey, 1))}><ChevronRight size={20} /></button>
        </div>
        <Segmented label="Range" hideLabel value={range} onChange={setRange} options={[{ value: 'day', label: 'This day' }, { value: 'week', label: '7-day average' }]} />
      </div>

      <section class="card stack-s" aria-label="About these numbers">
        {refs ? (
          <p class="small">Compared with <b>{groupLabel(refs.values().next().value!.group)}</b> reference intakes (NASEM DRIs: <abbr title="Recommended Dietary Allowance — covers nearly all healthy people">RDA</abbr> or <abbr title="Adequate Intake — used when an RDA cannot be set; less certain">AI</abbr>). Targets update automatically when your age changes.</p>
        ) : (
          <p class="small">Add your sex and age in <a href={href('settings')}>Settings</a> to compare with age-appropriate reference intakes. Amounts below are still exact.</p>
        )}
        <p class="small muted">
          {range === 'day' ? `${eaten.length} eaten food${eaten.length === 1 ? '' : 's'}` : 'Daily average'} · micronutrient data known for {Math.round(microShare * 100)}% of the energy eaten.
          Unknown values are never counted as zero; amounts with “≥” are at least that much.
        </p>
      </section>

      <div class="chips" role="group" aria-label="Filter">
        {([['all', 'All'], ['below', 'Below target'], ['unknown', 'Has unknowns'], ['limits', 'Above limits']] as [Filter, string][]).map(([v, l]) => (
          <button type="button" key={v} class="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      {!totals || (range === 'day' && eaten.length === 0) ? (
        <div class="card empty"><Info size={24} aria-hidden="true" /><h3>Nothing eaten logged {range === 'day' ? 'on this day' : 'this week'}</h3><p>Nutrients come from food marked as eaten. Planned food is not counted.</p></div>
      ) : (
        <>
          {[['Vitamins', VITAMINS], ['Minerals', MINERALS], ['Fats, fibre & sugar', OTHER]].map(([title, ids]) => {
            const list = visible.filter((r) => (ids as NutrientId[]).includes(r.id));
            if (!list.length) return null;
            return (
              <section class="card" key={title as string} aria-labelledby={`n-${title}`}>
                <h2 id={`n-${title}`} class="card-title" style={{ marginBottom: '8px' }}>{title as string}</h2>
                <ul class="list">{list.map((r) => <NutrientRow key={r.id} r={r} dayKey={dayKey} range={range} />)}</ul>
              </section>
            );
          })}
          <OxalateCard dayKey={dayKey} range={range} />
          {range === 'day' ? <MealCompare entries={eaten} dayKey={dayKey} refs={refs} /> : null}
        </>
      )}
      <p class="xs subtle">Reference intakes: National Academies of Sciences, Engineering, and Medicine (via NIH Office of Dietary Supplements). Food data: USDA FoodData Central and your labels. Information, not medical advice.</p>
    </div>
  );
}

function NutrientRow({ r, dayKey, range }: { r: NutrientCoverage; dayKey: DayKey; range: 'day' | 'week' }) {
  const def = NUTRIENTS[r.id];
  const lower = r.unknown > 0 && r.known > 0;
  const pct = r.pct === null ? null : Math.round(r.pct * 100);
  const amountText = r.status === 'unknown' ? 'unknown' : `${lower ? '≥ ' : ''}${fmtNutrient(r.id, r.amount)}`;
  const targetText = r.ref?.target ? ` of ${fmtNutrient(r.id, r.ref.target)}` : r.ref?.ul ? ` · upper limit ${fmtNutrient(r.id, r.ref.ul)}` : r.ref?.limit ? ` · limit ${fmtNutrient(r.id, r.ref.limit)}` : '';
  const tone = r.status === 'met' ? 'ok' : r.status === 'over-ul' || r.status === 'over-limit' ? 'warn' : '';
  return (
    <li>
      <button type="button" class="item" onClick={() => openSheet({ kind: 'nutrient', id: r.id, dayKey, range })}>
        <div class="item-main">
          <span class="item-name">{def.label} {r.ref?.kind ? <span class="badge" title={r.ref.kind === 'AI' ? 'Adequate Intake' : r.ref.kind === 'RDA' ? 'Recommended Dietary Allowance' : 'Chronic disease risk reduction'}>{r.ref.kind}</span> : null}</span>
          <span class="item-sub num">{amountText}{targetText}{r.unknown > 0 && r.known > 0 ? ` · known for ${r.known} of ${r.known + r.unknown}` : ''}</span>
          {pct !== null && r.status !== 'unknown' ? (
            <div class="bar-track" role="progressbar" aria-label={`${def.label} coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-valuetext={`${lower ? 'at least ' : ''}${pct}% of target`} style={{ marginTop: '4px' }}>
              <div class="bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: r.status === 'met' ? 'var(--ok)' : 'var(--ember)' }} />
              {lower ? <div class="bar-planned" style={{ left: `${Math.min(100, pct)}%`, width: `${Math.max(0, 100 - Math.min(100, pct))}%` }} /> : null}
            </div>
          ) : null}
        </div>
        <div class="item-end">
          <span class={`badge ${tone}`}>{r.status === 'partial' || r.status === 'low' ? `${lower ? '≥ ' : ''}${pct}%` : STATUS_TEXT[r.status]}</span>
        </div>
      </button>
    </li>
  );
}

function MealCompare({ entries, dayKey, refs }: { entries: LogEntry[]; dayKey: DayKey; refs: Map<NutrientId, Reference> | null }) {
  const p = profile.value!;
  const record = useLive(() => db().days.get(dayKey), [dayKey], undefined as DayRecord | undefined);
  const slots = slotsFor(record, entries, p.defaultSlots).filter((s) => entries.some((e) => e.slotId === s.id));
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  if (slots.length < 2) return null;
  const sa = a || slots[0]!.id;
  const sb = b || slots[1]!.id;
  const tot = (slot: string) => sumNutrients(entries.filter((e) => e.slotId === slot).flatMap((e) => entryNutrients(e).parts));
  const ta = tot(sa), tb = tot(sb);
  const ids: NutrientId[] = ['kcal', 'protein', 'fiber', 'satFat', 'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'vitC', 'vitD', 'vitE', 'folate', 'vitB12', 'choline'];
  const cell = (t: Totals, id: NutrientId) => {
    const v = t[id];
    if (v.known === 0) return 'unknown';
    const target = refs?.get(id)?.target;
    return `${v.unknown ? '≥ ' : ''}${roundFor(id, v.value)}${target ? ` (${Math.round((v.value / target) * 100)}%)` : ''}`;
  };
  return (
    <section class="card stack" aria-labelledby="mc-title">
      <h2 id="mc-title" class="card-title">Compare two meals</h2>
      <div class="fields">
        <div class="field"><label for="mc-a">Meal A</label><select id="mc-a" class="select" value={sa} onChange={(e) => setA(e.currentTarget.value)}>{slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div class="field"><label for="mc-b">Meal B</label><select id="mc-b" class="select" value={sb} onChange={(e) => setB(e.currentTarget.value)}>{slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      <table class="ntable">
        <thead><tr><th scope="col">Nutrient</th><th scope="col" style={{ textAlign: 'right' }}>{slots.find((s) => s.id === sa)?.name}</th><th scope="col" style={{ textAlign: 'right' }}>{slots.find((s) => s.id === sb)?.name}</th></tr></thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id}><td>{NUTRIENTS[id].label} <span class="subtle xs">{NUTRIENTS[id].unit}</span></td><td class="v">{cell(ta, id)}</td><td class="v">{cell(tb, id)}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="xs subtle">% = share of the whole day's reference intake.</p>
    </section>
  );
}
