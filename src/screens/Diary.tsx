import { useEffect, useState } from 'preact/hooks';
import { db } from '../data/db';
import { listDay, updateDay } from '../data/entries';
import { targetsFor, buildDayPlan } from '../data/plan';
import { dayTotals } from '../domain/diary';
import { addDays, formatDayLabel, isDayKey, type DayKey } from '../domain/time';
import { fmtTotal, coverageNote, roundFor } from '../domain/nutrition/format';
import type { NutrientId } from '../domain/nutrition/nutrients';
import { NUTRIENTS } from '../domain/nutrition/nutrients';
import { openSheet, profile, todayKey, toast } from '../app/store';
import { navigate } from '../app/router';
import { useAsync, useLive } from '../ui/hooks';
import { Segmented } from '../ui/controls';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, ListPlus, Star } from '../ui/icons';
import { MacroBar } from '../ui/nutrition';
import { MealList, slotsFor } from './parts/DayView';

const DETAIL: NutrientId[] = ['fiber', 'sugars', 'satFat', 'sodium', 'potassium', 'calcium', 'iron', 'vitC'];

export function Diary({ dayKey }: { dayKey: DayKey }) {
  const p = profile.value!;
  const entries = useLive(() => listDay(dayKey), [dayKey], []);
  const record = useLive(() => db().days.get(dayKey), [dayKey], undefined);
  const dayType = record?.dayType ?? p.defaultDayType;
  const targets = useAsync(() => targetsFor(p, dayKey, dayType), [dayKey, dayType, p.updatedAt, record?.targets?.computedAt]);
  const t = dayTotals(entries);
  const slots = slotsFor(record, entries, p.defaultSlots);
  const [note, setNote] = useState(record?.note ?? '');
  useEffect(() => setNote(record?.note ?? ''), [dayKey, record?.note]);
  const go = (k: DayKey) => navigate('diary', k);

  const setDayType = async (v: 'gym' | 'rest') => {
    if (record?.targets && record.targets.source === 'template') {
      const plan = await buildDayPlan(p, dayKey, v);
      await updateDay(dayKey, { dayType: v, ...('missing' in plan ? {} : { targets: plan.targets }) });
      toast(`${v === 'gym' ? 'Gym' : 'Rest'} day — targets updated for ${formatDayLabel(dayKey)}`);
    } else await updateDay(dayKey, { dayType: v });
  };

  return (
    <div class="page">
      <div class="page-head">
        <div class="cluster">
          <button type="button" class="btn btn-icon" aria-label="Previous day" onClick={() => go(addDays(dayKey, -1))}><ChevronLeft size={20} /></button>
          <div>
            <h1 class="page-title">{formatDayLabel(dayKey)}</h1>
            <p class="small muted">{dayKey === todayKey.value ? 'Today' : dayKey < todayKey.value ? 'Past day' : 'Upcoming'}{targets ? ` · ${targets.label}` : ''}</p>
          </div>
          <button type="button" class="btn btn-icon" aria-label="Next day" onClick={() => go(addDays(dayKey, 1))}><ChevronRight size={20} /></button>
        </div>
        <div class="cluster">
          {dayKey !== todayKey.value ? <button type="button" class="btn btn-s" onClick={() => go(todayKey.value)}>Today</button> : null}
          <label class="btn btn-s" style={{ position: 'relative' }}>
            <CalendarDays size={16} aria-hidden="true" /> <span>Jump to date</span>
            <input type="date" value={dayKey} aria-label="Jump to date" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              onChange={(e) => { const v = e.currentTarget.value; if (isDayKey(v)) go(v); }} />
          </label>
        </div>
      </div>

      <section class="card" aria-labelledby="diary-totals">
        <div class="card-head">
          <h2 id="diary-totals" class="card-title">Day totals · eaten</h2>
          <Segmented label="Day type" hideLabel value={dayType} onChange={(v) => void setDayType(v)} options={[{ value: 'gym', label: 'Gym day' }, { value: 'rest', label: 'Rest day' }]} />
        </div>
        <div class="bars">
          <MacroBar id="kcal" label="Energy" eaten={t.eaten.kcal.value} planned={t.planned.kcal.value} target={targets?.kcal} />
          <MacroBar id="protein" eaten={t.eaten.protein.value} planned={t.planned.protein.value} target={targets?.protein} />
          <MacroBar id="carbs" eaten={t.eaten.carbs.value} planned={t.planned.carbs.value} target={targets?.carbs} />
          <MacroBar id="fat" eaten={t.eaten.fat.value} planned={t.planned.fat.value} target={targets?.fat} />
        </div>
        <dl class="fields" style={{ marginTop: '14px' }}>
          {DETAIL.map((id) => (
            <div key={id} class="stack-s">
              <dt class="xs subtle">{NUTRIENTS[id].label}</dt>
              <dd class="num" style={{ margin: 0, fontWeight: 800 }}>{fmtTotal(id, t.eaten[id])}</dd>
              {coverageNote(t.eaten[id]) ? <dd class="xs subtle" style={{ margin: 0 }}>{coverageNote(t.eaten[id])}</dd> : null}
            </div>
          ))}
        </dl>
        {t.plannedCount ? <p class="small muted" style={{ marginTop: '10px' }}>If you eat everything planned: {Math.round(t.projected.kcal.value)} kcal · P {roundFor('protein', t.projected.protein.value)} · C {roundFor('carbs', t.projected.carbs.value)} · F {roundFor('fat', t.projected.fat.value)}</p> : null}
        {targets?.source === 'template' ? <p class="xs subtle" style={{ marginTop: '8px' }}>Targets are estimates (Mifflin–St Jeor × activity). Judge them by your 2–3 week weight trend, not single days.</p> : null}
      </section>

      <div class="cluster">
        <button type="button" class="btn" onClick={() => openSheet({ kind: 'copy-day', toDay: dayKey })}><Copy size={16} aria-hidden="true" /> Copy from another day</button>
        <button type="button" class="btn" onClick={() => openSheet({ kind: 'slots', dayKey })}><ListPlus size={16} aria-hidden="true" /> Meals</button>
      </div>

      <MealList dayKey={dayKey} slots={slots} entries={entries} />

      {entries.length ? (
        <div class="cluster">
          {slots.filter((s) => entries.some((e) => e.slotId === s.id)).map((s) => (
            <button type="button" key={s.id} class="btn btn-s" onClick={() => openSheet({ kind: 'saved-meal', fromEntries: entries.filter((e) => e.slotId === s.id).map((e) => e.id) })}>
              <Star size={14} aria-hidden="true" /> Save “{s.name}” as a meal
            </button>
          ))}
        </div>
      ) : null}

      <section class="card stack-s">
        <label for="day-note" class="card-title">Day note</label>
        <textarea id="day-note" class="textarea" value={note} placeholder="Sleep, training, how you felt…" onInput={(e) => setNote(e.currentTarget.value)}
          onBlur={() => { if ((record?.note ?? '') !== note) void updateDay(dayKey, { note }); }} />
      </section>
    </div>
  );
}
