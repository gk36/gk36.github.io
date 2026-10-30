import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync, useLive } from '../ui/hooks';
import { Segmented, NumberField, Field } from '../ui/controls';
import { ChevronLeft, Info, Pencil, Plus, ScanBarcode, Search, Star } from '../ui/icons';
import { MacroLine, SourceBadge } from '../ui/nutrition';
import { allFoods, saveCustomFood } from '../data/foods/registry';
import { ensureDay, recentFoods, type NewEntry } from '../data/entries';
import { db } from '../data/db';
import type { SavedMeal, Slot } from '../data/types';
import { indexFoods, searchFoods } from '../domain/search';
import { displayName, PREP_LABEL, type Food, type Quantity } from '../domain/nutrition/food';
import { defaultQuantity, describeQuantity, minutesOfDayLabel } from './quick-helpers';
import { contribution } from '../domain/nutrition/compute';
import { closeSheet, openSheet, profile } from '../app/store';
import { logEntry } from '../app/actions';
import { AmountPicker } from './AmountPicker';
import type { DayKey } from '../domain/time';

interface Props { dayKey: DayKey; slotId?: string; status?: 'eaten' | 'planned'; query?: string; food?: Food }

function guessSlot(slots: readonly Slot[]): string {
  const h = new Date().getHours();
  const want = h < 11 ? /breakfast|morning|first/i : h < 16 ? /lunch|pre|post-gym meal|midday/i : h < 22 ? /dinner|feast|evening|re-feed/i : /snack/i;
  return (slots.find((s) => want.test(s.name)) ?? slots[0])?.id ?? 'snacks';
}

export function QuickLog({ dayKey, slotId, status: initialStatus, query: initialQuery, food: initialFood }: Props) {
  const p = profile.value!;
  const [query, setQuery] = useState(initialQuery ?? '');
  const [picked, setPicked] = useState<Food | null>(initialFood ?? null);
  const [meal, setMeal] = useState<SavedMeal | null>(null);
  const [quick, setQuick] = useState(false);
  const [qty, setQty] = useState<Quantity>(initialFood ? defaultQuantity(initialFood) : { amount: 100, unit: 'g' });
  const [status, setStatus] = useState<'eaten' | 'planned'>(initialStatus ?? 'eaten');
  const [slot, setSlot] = useState<string>(slotId ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  const day = useAsync(() => ensureDay(dayKey), [dayKey]);
  const slots = day?.slots ?? p.defaultSlots;
  useEffect(() => { if (!slot && slots.length) setSlot(slotId ?? guessSlot(slots)); }, [slots.length]);

  const foods = useLive(() => allFoods(), [], [] as Food[]);
  const recents = useLive(() => recentFoods(12), [], []);
  const meals = useLive(async () => (await db().savedMeals.toArray()).filter((m) => !m.deletedAt), [], [] as SavedMeal[]);
  const index = useMemo(() => indexFoods(foods), [foods]);
  const boost = useMemo(() => new Map(recents.map((r, i) => [r.food.id, 2 - i * 0.1])), [recents]);
  const results = useMemo(() => (query.trim() ? searchFoods(index, query, boost, 50) : []), [index, query, boost]);
  const lastQty = useMemo(() => new Map(recents.map((r) => [r.food.id, r.qty])), [recents]);

  const choose = (f: Food) => {
    setPicked(f);
    setQty(lastQty.get(f.id) ?? defaultQuantity(f));
  };

  const back = () => { setPicked(null); setMeal(null); setQuick(false); requestAnimationFrame(() => searchRef.current?.focus()); };

  const submitFood = async () => {
    if (!picked) return;
    const c = contribution(picked, qty);
    if ('error' in c) return;
    const input: NewEntry = { dayKey, slotId: slot, food: picked, qty, status, origin: 'search' };
    await logEntry(input);
    closeSheet();
  };

  const submitMeal = async () => {
    if (!meal) return;
    for (const it of meal.items) await logEntry({ dayKey, slotId: slot, food: it.food, qty: it.qty, status, origin: 'saved-meal' });
    closeSheet();
  };

  const slotPicker = (
    <Field label="Meal" for="ql-slot">
      <select id="ql-slot" class="select" value={slot} onChange={(e) => setSlot(e.currentTarget.value)}>
        {slots.map((s) => <option key={s.id} value={s.id}>{s.name}{s.time && /^\d{1,2}:\d{2}$/.test(s.time) ? ` · ${s.time}` : s.badge ? ` · ${s.badge}` : ''}</option>)}
      </select>
    </Field>
  );
  const statusPicker = (
    <Segmented label="Status" value={status} onChange={setStatus}
      options={[{ value: 'eaten', label: 'Eaten' }, { value: 'planned', label: 'Planned' }]} />
  );

  if (quick) return <QuickAdd dayKey={dayKey} slot={slot} slotPicker={slotPicker} status={status} statusPicker={statusPicker} onBack={back} />;

  if (meal) {
    return (
      <Sheet title={meal.name} onClose={closeSheet} lead={<button type="button" class="btn btn-ghost btn-icon" aria-label="Back to search" onClick={back}><ChevronLeft size={20} /></button>}
        footer={<><button type="button" class="btn" onClick={back}>Back</button><button type="button" class="btn btn-primary" onClick={() => void submitMeal()}>{status === 'eaten' ? 'Log' : 'Plan'} {meal.items.length} items</button></>}>
        <div class="list">
          {meal.items.map((it, i) => {
            const c = contribution(it.food, it.qty);
            return (
              <div class="item" key={i}>
                <div class="item-main"><span class="item-name">{displayName(it.food)}</span><span class="item-sub">{describeQuantity(it.food, it.qty)}</span></div>
                <div class="item-end">{'error' in c ? '?' : <MacroLine n={c.n} compact />}</div>
              </div>
            );
          })}
        </div>
        {slotPicker}
        {statusPicker}
      </Sheet>
    );
  }

  if (picked) {
    const c = contribution(picked, qty);
    return (
      <Sheet title={displayName(picked)} onClose={closeSheet} lead={<button type="button" class="btn btn-ghost btn-icon" aria-label="Back to search" onClick={back}><ChevronLeft size={20} /></button>}
        footer={<>
          <button type="button" class="btn" onClick={() => openSheet({ kind: 'food', food: picked, dayKey, slotId: slot })}><Info size={16} aria-hidden="true" /> Details</button>
          <button type="submit" form="ql-form" class="btn btn-primary" disabled={'error' in c}>{status === 'eaten' ? 'Log eaten' : 'Add as planned'}</button>
        </>}>
        <form id="ql-form" class="stack" onSubmit={(ev) => { ev.preventDefault(); void submitFood(); }}>
          <div class="cluster small muted">
            <SourceBadge src={picked.src} />
            <span class="badge">{PREP_LABEL[picked.prep]}</span>
            {picked.notes ? <span>{picked.notes}</span> : null}
          </div>
          <AmountPicker food={picked} qty={qty} onChange={setQty} autoFocus />
          {slotPicker}
          {statusPicker}
        </form>
      </Sheet>
    );
  }

  return (
    <Sheet title="Log food" onClose={closeSheet}
      footer={<>
        <button type="button" class="btn" onClick={() => openSheet({ kind: 'scan', dayKey, ...(slot ? { slotId: slot } : {}) })}><ScanBarcode size={16} aria-hidden="true" /> Scan</button>
        <button type="button" class="btn" onClick={() => setQuick(true)}><Plus size={16} aria-hidden="true" /> Quick add</button>
        <button type="button" class="btn" onClick={() => openSheet({ kind: 'food-editor', thenLog: { dayKey, slotId: slot } })}><Pencil size={16} aria-hidden="true" /> New food from label</button>
      </>}>
      <div class="field">
        <label for="ql-search" class="sr-only">Search foods</label>
        <div style={{ position: 'relative' }}>
          <input ref={searchRef} id="ql-search" class="input" type="search" placeholder="Search foods (English or Ελληνικά)…" value={query}
            autoFocus autoComplete="off" enterKeyHint="search"
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); choose(results[0]); } }}
          />
        </div>
      </div>
      {query.trim() ? (
        results.length ? (
          <ul class="list" aria-label="Search results">
            {results.map((f) => <FoodResult key={f.id} food={f} onPick={() => choose(f)} />)}
          </ul>
        ) : (
          <div class="empty">
            <Search size={24} aria-hidden="true" />
            <p>No match for “{query}”. Create it from the package label, or quick-add an estimate.</p>
            <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'food-editor', prefill: { names: { en: query } }, thenLog: { dayKey, slotId: slot } })}>Create “{query}”</button>
          </div>
        )
      ) : (
        <div class="stack">
          {meals.length ? (
            <section class="stack-s" aria-label="Saved meals">
              <h3 class="card-title">Saved meals</h3>
              <div class="chips">{meals.map((m) => <button type="button" key={m.id} class="chip" onClick={() => setMeal(m)}><Star size={14} aria-hidden="true" /> {m.name}</button>)}</div>
            </section>
          ) : null}
          <section class="stack-s" aria-label="Recent foods">
            <h3 class="card-title">Recent</h3>
            {recents.length ? (
              <ul class="list" aria-label="Recent foods">
                {recents.map((r) => <FoodResult key={r.food.id} food={r.food as Food} hint={describeQuantity(r.food, r.qty)} onPick={() => { setPicked(r.food as Food); setQty(r.qty); }} />)}
              </ul>
            ) : <p class="small muted">Foods you log appear here for one-tap repeats. Try searching “chicken”, “ρύζι” or “yogurt”.</p>}
          </section>
        </div>
      )}
      <p class="xs subtle">{minutesOfDayLabel()} · logging to {slots.find((s) => s.id === slot)?.name ?? 'a meal'}</p>
    </Sheet>
  );
}

function FoodResult({ food, onPick, hint }: { food: Food; onPick: () => void; hint?: string }) {
  const per = food.basis.per === 'unit' ? `per ${food.basis.unitLabel}` : food.basis.per === '100ml' ? 'per 100 mL' : 'per 100 g';
  return (
    <li>
    <button type="button" class="item" onClick={onPick}>
      <div class="item-main">
        <span class="item-name">{displayName(food)}</span>
        <span class="item-sub cluster">
          <SourceBadge src={food.src} />
          {food.prep !== 'as-sold' ? <span>{PREP_LABEL[food.prep]}</span> : null}
          {hint ? <span>last: {hint}</span> : null}
        </span>
      </div>
      <div class="item-end small">
        <span class="num">{food.n.kcal === undefined ? '?' : Math.round(food.n.kcal)} kcal</span>
        <span class="xs subtle">{per}</span>
      </div>
    </button>
    </li>
  );
}

/** Calories-only (or rough macros) estimate, e.g. a restaurant dish — stored as a low-confidence custom food. */
function QuickAdd({ dayKey, slot, slotPicker, status, statusPicker, onBack }: { dayKey: DayKey; slot: string; slotPicker: ComponentChildren; status: 'eaten' | 'planned'; statusPicker: ComponentChildren; onBack: () => void }) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const ok = name.trim().length > 0 && kcal !== null && kcal > 0;
  const save = async () => {
    if (!ok) return;
    const n: Food['n'] = { kcal: kcal! };
    if (protein !== null) n.protein = protein;
    if (carbs !== null) n.carbs = carbs;
    if (fat !== null) n.fat = fat;
    const food = await saveCustomFood({
      id: '', names: { en: name.trim() }, kind: 'custom', group: 'other', prep: 'prepared', basis: { per: 'unit', unitLabel: 'serving' },
      portions: [], n, carbsIncludeFiber: true, kcalOrigin: 'label',
      src: { type: 'estimate', confidence: 'low', note: 'Quick estimate entered by you (e.g. restaurant food). Unlisted nutrients are unknown.' },
    });
    await logEntry({ dayKey, slotId: slot, food, qty: { amount: 1, unit: 'portion', portionId: 'unit' }, status, origin: 'quick' });
    closeSheet();
  };
  return (
    <Sheet title="Quick add estimate" onClose={closeSheet} lead={<button type="button" class="btn btn-ghost btn-icon" aria-label="Back" onClick={onBack}><ChevronLeft size={20} /></button>}
      footer={<><button type="button" class="btn" onClick={onBack}>Back</button><button type="button" class="btn btn-primary" disabled={!ok} onClick={() => void save()}>{status === 'eaten' ? 'Log estimate' : 'Plan estimate'}</button></>}>
      <p class="small muted">For restaurant food or anything without a label. It is saved as a <b>low-confidence estimate</b>; anything you leave blank stays unknown, not zero.</p>
      <Field label="What was it?" for="qa-name"><input id="qa-name" class="input" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. 2 macarons, burger at …" /></Field>
      <div class="fields">
        <NumberField label="Calories" suffix="kcal" value={kcal} onChange={setKcal} min={0} max={5000} />
        <NumberField label="Protein" suffix="g" value={protein} onChange={setProtein} min={0} max={500} />
        <NumberField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} min={0} max={1000} />
        <NumberField label="Fat" suffix="g" value={fat} onChange={setFat} min={0} max={500} />
      </div>
      {slotPicker}
      {statusPicker}
    </Sheet>
  );
}
