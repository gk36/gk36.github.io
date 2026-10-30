import { db } from '../data/db';
import { listDay, copyEntries } from '../data/entries';
import { targetsFor } from '../data/plan';
import { dayTotals } from '../domain/diary';
import { addDays, formatDayLabel } from '../domain/time';
import { coverageNote, fmtTotal } from '../domain/nutrition/format';
import { openSheet, profile, toast, todayKey } from '../app/store';
import { href, navigate } from '../app/router';
import { useAsync, useLive } from '../ui/hooks';
import { CalorieRing, MacroBar } from '../ui/nutrition';
import { ArrowRight, BookOpen, ChefHat, ClipboardList, Plus, RefreshCw, Repeat, Smartphone } from '../ui/icons';
import { MealList, slotsFor } from './parts/DayView';
import { InstallHint } from './parts/InstallHint';
import { NutrientGaps } from './parts/NutrientGaps';
import { Composer } from './parts/Composer';

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
        <a class="btn btn-s" href={href('diary', day)}><BookOpen size={16} aria-hidden="true" /> Full diary</a>
      </div>

      <InstallHint />

      <section class="card summary" aria-labelledby="today-energy">
        <h2 id="today-energy" class="sr-only">Energy and macros</h2>
        <div class="summary-top">
          <CalorieRing eaten={t.eaten.kcal.value} planned={t.planned.kcal.value} target={kcalTarget} />
          <div class="summary-side">
            {left !== undefined ? (
              <>
                <span class={`summary-left num${left < 0 ? ' over' : ''}`}>{Math.round(Math.abs(left)).toLocaleString('en-GB')}</span>
                <span class="small muted">{left >= 0 ? 'kcal left' : 'kcal over'}{targets?.source === 'template' ? ' · estimate' : ''}</span>
              </>
            ) : (
              <span class="small muted">Add your stats in <a href={href('plan')}>Plan</a> to see calorie and protein targets.</span>
            )}
            {t.plannedCount > 0 ? (
              <span class="xs muted summary-planned">
                +{Math.round(t.planned.kcal.value).toLocaleString('en-GB')} planned → the day lands near <b>{Math.round(t.projected.kcal.value).toLocaleString('en-GB')}</b>
              </span>
            ) : null}
          </div>
        </div>
        <div class="bars">
          <MacroBar id="protein" eaten={t.eaten.protein.value} planned={t.planned.protein.value} target={targets?.protein} />
          <MacroBar id="carbs" eaten={t.eaten.carbs.value} planned={t.planned.carbs.value} target={targets?.carbs} />
          <MacroBar id="fat" eaten={t.eaten.fat.value} planned={t.planned.fat.value} target={targets?.fat} />
        </div>
        <p class="xs subtle">
          Fibre {fmtTotal('fiber', t.eaten.fiber)}{coverageNote(t.eaten.fiber) ? ` — ${coverageNote(t.eaten.fiber)}` : ''}
          {t.carbsCaveat ? ` · ${t.carbsCaveat} label food${t.carbsCaveat > 1 ? 's' : ''} list carbs without fibre` : ''}
        </p>
      </section>

      <Composer dayKey={day} />

      <button type="button" class="ideas-entry" onClick={() => openSheet({ kind: 'ideas', dayKey: day })}>
        <ChefHat size={24} aria-hidden="true" />
        <span class="ideas-entry-main">
          <b>What should I eat?</b>
          <span class="small muted">Meal ideas with exact grams, from your pantry, fitted to what's left today</span>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      <div class="quick-row" role="group" aria-label="More for today">
        <button type="button" class="quick" onClick={() => openSheet({ kind: 'replan', dayKey: day })}><RefreshCw size={17} aria-hidden="true" /> Replan rest of day</button>
        <button type="button" class="quick" onClick={() => navigate('plan')}><ClipboardList size={17} aria-hidden="true" /> Plan today</button>
        <button type="button" class="quick" onClick={() => void repeatYesterday()}><Repeat size={17} aria-hidden="true" /> Repeat yesterday</button>
        <button type="button" class="quick" onClick={() => openSheet({ kind: 'quicklog', dayKey: day })}><Plus size={17} aria-hidden="true" /> Log food</button>
      </div>

      <section aria-labelledby="today-meals" class="stack">
        <h2 id="today-meals" class="section-title">Meals</h2>
        {entries.length === 0 ? (
          <div class="card empty">
            <Smartphone size={28} aria-hidden="true" />
            <h3>Nothing logged yet today</h3>
            <p>Type what you ate above, ask for <b>meal ideas</b>, or turn your planner into planned meals with <b>Plan today</b>. Planned food never counts as eaten until you tap <b>Eaten</b>.</p>
          </div>
        ) : (
          <MealList dayKey={day} slots={slots} entries={entries} compact />
        )}
      </section>

      <NutrientGaps totals={t.eaten} dayKey={day} eatenCount={t.eatenCount} />
    </div>
  );
}
