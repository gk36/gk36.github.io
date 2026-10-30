import { db } from '../data/db';
import { listDay, copyEntries } from '../data/entries';
import { targetsFor } from '../data/plan';
import { dayTotals } from '../domain/diary';
import { addDays, formatDayLabel } from '../domain/time';
import { coverageNote, fmtTotal } from '../domain/nutrition/format';
import { openSheet, profile, toast, todayKey } from '../app/store';
import { href, navigate } from '../app/router';
import { useAsync, useLive } from '../ui/hooks';
import { MacroBar } from '../ui/nutrition';
import { BookOpen, ClipboardList, Plus, Repeat, ScanBarcode, Smartphone } from '../ui/icons';
import { MealList, slotsFor } from './parts/DayView';
import { InstallHint } from './parts/InstallHint';
import { NutrientGaps } from './parts/NutrientGaps';

export function Today() {
  const p = profile.value!;
  const day = todayKey.value;
  const entries = useLive(() => listDay(day), [day], []);
  const record = useLive(() => db().days.get(day), [day], undefined);
  const dayType = record?.dayType ?? p.defaultDayType;
  const targets = useAsync(() => targetsFor(p, day, dayType), [day, dayType, p.updatedAt, record?.targets?.computedAt]);
  const t = dayTotals(entries);
  const slots = slotsFor(record, entries, p.defaultSlots);
  const kcalTarget = targets?.kcal;
  const left = kcalTarget !== undefined ? kcalTarget - t.eaten.kcal.value : undefined;

  const repeatYesterday = async () => {
    const y = addDays(day, -1);
    const rows = (await listDay(y)).filter((e) => e.status === 'eaten');
    if (!rows.length) { toast('Nothing was logged as eaten yesterday.'); return; }
    const yRec = await db().days.get(y);
    await copyEntries(rows, day, 'planned', yRec?.slots ?? p.defaultSlots);
    toast(`Added ${rows.length} items from yesterday as planned — mark them eaten as you go.`, { tone: 'ok' });
  };

  return (
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Today</h1>
          <p class="muted small">{formatDayLabel(day)}{targets ? ` · ${targets.label}` : ''}</p>
        </div>
        <div class="cluster">
          <a class="btn btn-s" href={href('diary', day)}><BookOpen size={16} aria-hidden="true" /> Full diary</a>
        </div>
      </div>

      <InstallHint />

      <section class="card" aria-labelledby="today-energy">
        <h2 id="today-energy" class="card-title">Energy</h2>
        <div class="hero" style={{ marginTop: '8px' }}>
          <span class="hero-num">{Math.round(t.eaten.kcal.value).toLocaleString('en-GB')}</span>
          <span class="hero-sub">
            {kcalTarget !== undefined ? <>of {kcalTarget.toLocaleString('en-GB')} kcal{targets?.source === 'template' ? ' (estimate)' : ''}</> : 'kcal eaten'}
          </span>
          {left !== undefined ? (
            <span class="badge" style={{ marginLeft: 'auto' }}>
              {left >= 0 ? `${Math.round(left).toLocaleString('en-GB')} kcal left` : `${Math.round(-left).toLocaleString('en-GB')} kcal over`}
            </span>
          ) : null}
        </div>
        {t.plannedCount > 0 ? (
          <p class="small muted" style={{ marginTop: '8px' }}>
            Planned, not eaten yet: <b>+{Math.round(t.planned.kcal.value).toLocaleString('en-GB')} kcal</b> → the day lands near <b>{Math.round(t.projected.kcal.value).toLocaleString('en-GB')} kcal</b> if you eat it all.
          </p>
        ) : null}
        {!targets && entries.length === 0 ? (
          <div class="callout" style={{ marginTop: '12px' }}>
            Add your stats in <a href={href('plan')}>Plan</a> to see calorie and protein targets.
          </div>
        ) : null}
        <div class="bars" style={{ marginTop: '16px' }}>
          <MacroBar id="protein" eaten={t.eaten.protein.value} planned={t.planned.protein.value} target={targets?.protein} />
          <MacroBar id="carbs" eaten={t.eaten.carbs.value} planned={t.planned.carbs.value} target={targets?.carbs} />
          <MacroBar id="fat" eaten={t.eaten.fat.value} planned={t.planned.fat.value} target={targets?.fat} />
        </div>
        <p class="small muted" style={{ marginTop: '12px' }}>
          Fibre {fmtTotal('fiber', t.eaten.fiber)}{coverageNote(t.eaten.fiber) ? ` — ${coverageNote(t.eaten.fiber)}` : ''}
          {t.carbsCaveat ? ` · ${t.carbsCaveat} label food${t.carbsCaveat > 1 ? 's' : ''} list carbs without fibre` : ''}
        </p>
      </section>

      <NutrientGaps totals={t.eaten} dayKey={day} eatenCount={t.eatenCount} />

      <div class="cluster">
        <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'quicklog', dayKey: day })}><Plus size={18} aria-hidden="true" /> Log food</button>
        <button type="button" class="btn" onClick={() => openSheet({ kind: 'scan', dayKey: day })}><ScanBarcode size={18} aria-hidden="true" /> Scan</button>
        <button type="button" class="btn" onClick={() => navigate('plan')}><ClipboardList size={18} aria-hidden="true" /> Plan today</button>
        <button type="button" class="btn" onClick={() => void repeatYesterday()}><Repeat size={18} aria-hidden="true" /> Repeat yesterday</button>
      </div>

      <section aria-labelledby="today-meals" class="stack">
        <h2 id="today-meals" class="section-title">Meals</h2>
        {entries.length === 0 ? (
          <div class="card empty">
            <Smartphone size={28} aria-hidden="true" />
            <h3>Nothing logged yet today</h3>
            <p>Log what you eat with <b>+ Log</b>, or turn your planner into planned meals with <b>Plan today</b>. Planned food never counts as eaten until you tap <b>Eaten</b>.</p>
          </div>
        ) : (
          <MealList dayKey={day} slots={slots} entries={entries} compact />
        )}
      </section>
    </div>
  );
}
