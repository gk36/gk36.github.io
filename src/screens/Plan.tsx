import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { listDay } from '../data/entries';
import { applyPlan, buildDayPlan, planBinding } from '../data/plan';
import { plannerInput } from '../data/profile';
import type { PlannerPrefs } from '../data/types';
import {
  availableFoods, CUT_STYLES, GOALS, MEALS, REST_DESC, TIMINGS, mealMeta, visibleMeals, isCream, pickFood, r0,
  type PlanGroup,
} from '../domain/planning/template';
import { addDays, formatDayLabel, type DayKey } from '../domain/time';
import { describeQuantity } from '../domain/nutrition/quantity';
import { contribution } from '../domain/nutrition/compute';
import { displayName } from '../domain/nutrition/food';
import { profile, todayKey, toast, updatePlanner, updateProfile } from '../app/store';
import { navigate } from '../app/router';
import { useAsync, useLive } from '../ui/hooks';
import { Checkbox, Segmented, Field } from '../ui/controls';
import { ChevronLeft, ChevronRight, ClipboardList, Minus, Plus, TriangleAlert } from '../ui/icons';
import { StatsForm } from './parts/StatsForm';

const GROUP_LABEL: Record<PlanGroup, string> = { protein: 'Protein', starchy_carb: 'Starch', fast_carb: 'Fast carb', breakfast_carb: 'Breakfast carb', dairy_drink: 'Dairy' };

export function PlanScreen() {
  const p = profile.value!;
  const [day, setDay] = useState<DayKey>(todayKey.value);
  const record = useLive(() => db().days.get(day), [day], undefined);
  const [dayTypeLocal, setDayTypeLocal] = useState<'gym' | 'rest' | null>(null);
  const dayType = dayTypeLocal ?? record?.dayType ?? p.defaultDayType;
  const binding = useAsync(() => planBinding(), []);
  const plan = useAsync(() => buildDayPlan(p, day, dayType), [p.updatedAt, day, dayType]);
  const dayEntries = useLive(() => listDay(day), [day], []);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const pl = p.planner;
  const setPl = (patch: Partial<PlannerPrefs>) => void updatePlanner(patch);

  const input = plannerInput(p, day, dayType);
  const ready = !('missing' in input) && plan && !('missing' in plan);
  const oldPlanned = dayEntries.filter((e) => e.origin === 'plan' && e.status === 'planned').length;

  const apply = async () => {
    if (!plan || 'missing' in plan) return;
    if (oldPlanned && !confirmReplace) { setConfirmReplace(true); return; }
    const n = await applyPlan(day, plan);
    setConfirmReplace(false);
    toast(`Added ${n} planned items to ${formatDayLabel(day)}. Mark them eaten as you go.`, { tone: 'ok', action: { label: 'Open diary', run: () => navigate('diary', day) } });
  };

  const goal = GOALS.find((g) => g.key === pl.goal) ?? GOALS[0]!;
  const style = CUT_STYLES.find((c) => c.key === pl.cutStyle) ?? CUT_STYLES[0]!;
  const timing = TIMINGS.find((t) => t.key === pl.timing) ?? TIMINGS[0]!;

  return (
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Plan</h1>
          <p class="small muted">Your CARBMAXX meal template, now on USDA-sourced foods. It writes <b>planned</b> entries — nothing counts as eaten until you say so.</p>
        </div>
      </div>

      {'missing' in input ? (
        <section class="card stack">
          <h2 class="section-title">Your stats</h2>
          <p class="small muted">Needed for the calorie estimate: {input.missing.join(', ')}.</p>
          <StatsForm p={p} />
        </section>
      ) : (
        <details class="card">
          <summary class="spread" style={{ cursor: 'pointer' }}>
            <span class="card-title">Your stats</span>
            <span class="small muted">{p.sex} · {p.weightKg} kg · {p.heightCm} cm · {input.age} y</span>
          </summary>
          <div style={{ marginTop: '12px' }}><StatsForm p={p} /></div>
        </details>
      )}

      <section class="card stack" aria-labelledby="plan-goal">
        <h2 id="plan-goal" class="card-title">Goal</h2>
        <Segmented label="Goal" hideLabel value={pl.goal} onChange={(v) => setPl({ goal: v })} options={GOALS.map((g) => ({ value: g.key, label: `${g.label} · ${g.sub}` }))} />
        {goal.hasStyles ? (
          <Segmented label="Cut style" value={pl.cutStyle} onChange={(v) => setPl({ cutStyle: v })} options={CUT_STYLES.map((c) => ({ value: c.key, label: `${c.label} · ${c.sub}` }))} />
        ) : null}
        <p class="small muted">{goal.hasStyles ? style.desc : goal.desc}</p>
        {goal.hasStyles && style.warn ? <div class="callout warn small"><TriangleAlert size={15} aria-hidden="true" /> {style.warn}</div> : null}
      </section>

      <section class="card stack" aria-labelledby="plan-day">
        <div class="spread">
          <h2 id="plan-day" class="card-title">Day</h2>
          <div class="cluster">
            <button type="button" class="btn btn-icon btn-s" aria-label="Previous day" onClick={() => { setDay(addDays(day, -1)); setDayTypeLocal(null); }}><ChevronLeft size={18} /></button>
            <b>{formatDayLabel(day)}{day === todayKey.value ? ' · today' : ''}</b>
            <button type="button" class="btn btn-icon btn-s" aria-label="Next day" onClick={() => { setDay(addDays(day, 1)); setDayTypeLocal(null); }}><ChevronRight size={18} /></button>
          </div>
        </div>
        <Segmented label="Gym or rest" value={dayType} onChange={(v) => { setDayTypeLocal(v); if (day === todayKey.value) void updateProfile({ defaultDayType: v }); }}
          options={[{ value: 'gym', label: 'Gym day' }, { value: 'rest', label: 'Rest day' }]} />
        {dayType === 'gym' && !pl.combineBreakfast ? (
          <Segmented label="Meal timing" value={pl.timing} onChange={(v) => setPl({ timing: v })} options={TIMINGS.map((t) => ({ value: t.key, label: t.label }))} />
        ) : null}
        <p class="small muted">{dayType === 'rest' ? REST_DESC : pl.combineBreakfast ? 'Eggs, your selected meat and starch share one first meal. Daily portions are unchanged.' : `${timing.flow}. ${timing.desc}`}</p>
        <Checkbox label="First meal: eggs + meat + carbs together" checked={pl.combineBreakfast} onChange={(v) => setPl({ combineBreakfast: v })} />
      </section>

      {ready && binding ? (
        <section class="card stack" aria-labelledby="plan-options">
          <h2 id="plan-options" class="card-title">Foods & options</h2>
          <div class="cluster">
            <span class="label">Whole eggs</span>
            <button type="button" class="btn btn-icon btn-s" aria-label="Fewer eggs" disabled={pl.eggs <= 2} onClick={() => setPl({ eggs: Math.max(2, pl.eggs - 1) })}><Minus size={16} /></button>
            <b class="num" aria-live="polite">{pl.eggs}</b>
            <button type="button" class="btn btn-icon btn-s" aria-label="More eggs" disabled={pl.eggs >= 8} onClick={() => setPl({ eggs: Math.min(8, pl.eggs + 1) })}><Plus size={16} /></button>
          </div>
          <div class="fields">
            <Checkbox label="+ 40 g beef liver" checked={pl.liver} onChange={(v) => setPl({ liver: v })} hint="Very rich in vitamin A — keep it occasional." />
            <Checkbox label="+ 250 mL bone broth" checked={pl.boneBroth} onChange={(v) => setPl({ boneBroth: v })} hint="Typical values; brands vary." />
            <Checkbox label="Breakfast carb" checked={pl.breakfastCarbOn} onChange={(v) => setPl({ breakfastCarbOn: v })} />
            <Checkbox label="Dairy with the last meal" checked={pl.dairyOn} onChange={(v) => setPl({ dairyOn: v })} />
          </div>
          {pl.dairyOn ? (
            <Field label="Dairy amount" for="pl-milk" hint="mL for milk/kefir, g for yogurt/cottage">
              <input id="pl-milk" class="input input-num" type="number" inputMode="numeric" min={50} max={1000} step={25} value={pl.milkMl}
                onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 50 && v <= 1000) setPl({ milkMl: v }); }} />
            </Field>
          ) : null}
          <div class="fields fields-wide">
            {visibleMeals(input).flatMap((m) => mealMeta(input, m).rows.filter((r) => r.group).map((row) => {
              const key = `${m.id}:${row.group}`;
              const opts = availableFoods(binding.tables, m.id, row.group!);
              const cur = pickFood(input, binding.tables, m.id, row.group!);
              return (
                <Field key={key} label={`${mealMeta(input, m).name} · ${row.label ?? GROUP_LABEL[row.group!]}`} for={`pick-${key}`}>
                  <select id={`pick-${key}`} class="select" value={cur.id} onChange={(e) => setPl({ pick: { [key]: e.currentTarget.value } })}>
                    {opts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>
              );
            }))}
          </div>
          {isCream(pickFood(input, binding.tables, 3, 'fast_carb')) && dayType === 'gym' && TIMINGS.find((t) => t.key === (pl.combineBreakfast ? 'standard' : pl.timing))!.fastSplit > 0 ? (
            <Checkbox label="Add 1 tbsp honey to the pre-gym cream of rice" checked={pl.preHoney} onChange={(v) => setPl({ preHoney: v })} hint="The rice portion stays the same; honey carbs move from the post-gym serving." />
          ) : null}
        </section>
      ) : null}

      {plan && !('missing' in plan) ? (
        <section class="card stack" aria-labelledby="plan-preview">
          <h2 id="plan-preview" class="card-title">{formatDayLabel(day)} · {plan.targets.label}</h2>
          <div class="hero">
            <span class="hero-num">{plan.targets.kcal.toLocaleString('en-GB')}</span>
            <span class="hero-sub">kcal target · maintenance ≈ {r0(plan.result.tdee).toLocaleString('en-GB')} · BMR {r0(plan.result.bmr).toLocaleString('en-GB')}</span>
          </div>
          <p class="small">
            Targets: <b>P {plan.result.protein} g</b> ({Math.round((plan.result.protein / plan.input.kg) * 10) / 10} g/kg) · <b>F {plan.result.fat} g</b> · carbs fill the rest.
            Plan as shown ≈ <b>{r0(plan.result.planK).toLocaleString('en-GB')} kcal</b> · P {r0(plan.result.planP)} · C {r0(plan.result.planC)} · F {r0(plan.result.planF)}
            {plan.result.butter > 0 ? <span class="muted"> (incl. {plan.result.butter} g olive oil)</span> : null}
          </p>
          {plan.result.infeasible ? <div class="callout danger small" role="alert"><TriangleAlert size={15} aria-hidden="true" /> The protein and fat foods you picked already exceed this calorie target. Choose leaner proteins or less egg/dairy.</div> : null}
          {plan.result.planF > plan.result.fat + 8 ? <div class="callout warn small"><TriangleAlert size={15} aria-hidden="true" /> Fattier picks push fat {r0(plan.result.planF - plan.result.fat)} g above target; starch shrinks to keep calories on target.</div> : null}
          {plan.unresolved.length ? <div class="callout warn small">Some foods could not be placed: {plan.unresolved.join(', ')}.</div> : null}
          <div class="stack">
            {plan.meals.map((m) => (
              <div class="meal" key={m.id}>
                <div class="meal-head"><div><h3 class="meal-name">{m.name}</h3><div class="meal-meta">{m.badge} · {m.time}</div></div></div>
                <div class="list">
                  {plan.items.filter((it) => it.meal.id === m.id).map((it, i) => {
                    const c = contribution(it.food, it.qty);
                    return (
                      <div class="item" key={i}>
                        <div class="item-main"><span class="item-name">{displayName(it.food)}</span><span class="item-sub">{it.label} · {describeQuantity(it.food, it.qty)}</span></div>
                        <div class="item-end small num">{'error' in c ? '?' : `${Math.round(c.n.kcal ?? 0)} kcal`}</div>
                      </div>
                    );
                  })}
                </div>
                <p class="xs subtle">{m.note}</p>
              </div>
            ))}
          </div>
          <div class="cluster">
            <button type="button" class="btn btn-primary" onClick={() => void apply()}><ClipboardList size={18} aria-hidden="true" />
              {confirmReplace ? `Replace ${oldPlanned} untouched planned items` : `Add to ${day === todayKey.value ? 'today' : formatDayLabel(day)} as planned`}</button>
            {confirmReplace ? <button type="button" class="btn" onClick={() => setConfirmReplace(false)}>Cancel</button> : null}
          </div>
          {oldPlanned && !confirmReplace ? <p class="xs subtle">This day already has {oldPlanned} planned items from an earlier plan. Eaten and manually added food is never replaced.</p> : null}
          <p class="xs subtle">Estimates only: Mifflin–St Jeor × activity is a starting point. Compare your 2–3 week average weight and training before adjusting. Not medical advice.</p>
        </section>
      ) : null}
      <p class="xs subtle">Meal structures: {MEALS.length} template meals · {TIMINGS.length} gym-day timings.</p>
    </div>
  );
}
