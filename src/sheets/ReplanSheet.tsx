import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync, useLive } from '../ui/hooks';
import { Checkbox, Field, NumberField } from '../ui/controls';
import { FoodPicker } from '../ui/FoodPicker';
import { SourceBadge } from '../ui/nutrition';
import { Check, Plus, ShoppingCart, TriangleAlert, Undo2 } from '../ui/icons';
import type { DayEvent } from '../data/db';
import { addShopping } from '../data/pantry';
import {
  applyReplan, buildReplanInput, listDayEvents, loadReplanSetup, revertReplan, type AddedFood, type Choice, type ReplanSetup,
} from '../data/replan';
import { MACROS, MODES, perUnit, replan, type Macro, type ReplanInput, type ReplanItem, type ReplanMode, type ReplanResult } from '../domain/planning/replan';
import { displayName, type Food, type Quantity } from '../domain/nutrition/food';
import { describeQuantity, formatAmount } from '../domain/nutrition/quantity';
import type { DayKey } from '../domain/time';
import { uuidv7 } from '../data/ids';
import { rememberUndo } from '../app/actions';
import { closeSheet, profile, toast, todayKey } from '../app/store';

const LABEL: Record<Macro, string> = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const fmt = (m: Macro, v: number) => (m === 'kcal' ? `${Math.round(v).toLocaleString('en-GB')} kcal` : `${Math.round(v)} g`);

/**
 * "Plans change": rebalance what is still planned today around what was actually eaten and what is
 * actually available. Eaten food is never touched; every change is listed, explained and undoable.
 */
export function ReplanSheet({ dayKey }: { dayKey: DayKey }) {
  const p = profile.value!;
  const setup = useAsync(() => loadReplanSetup(p, dayKey), [dayKey]);
  if (!setup) return <Sheet title="Replan the rest of today" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
  if (!setup.targets) {
    return (
      <Sheet title="Replan the rest of today" onClose={closeSheet}>
        <p>Replanning needs today's targets. Add your stats in <b>Plan</b> (or set manual targets in Settings) first.</p>
      </Sheet>
    );
  }
  return <ReplanBody setup={setup} />;
}

function ReplanBody({ setup }: { setup: ReplanSetup }) {
  const events = useLive(() => listDayEvents(setup.dayKey), [setup.dayKey], [] as DayEvent[]);
  const [mode, setMode] = useState<ReplanMode>('closest');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [added, setAdded] = useState<AddedFood[]>([]);
  const [pantryOnly, setPantryOnly] = useState(false);
  const [mealCap, setMealCap] = useState<number | null>(null);
  const lastSlot = setup.planned.at(-1)?.slotId ?? setup.slots.at(-1)?.id ?? 'dinner';
  const [addSlot, setAddSlot] = useState(lastSlot);
  const [busy, setBusy] = useState(false);

  const input = useMemo(() => buildReplanInput(setup, { mode, choices, added, pantryOnly, maxMealKcal: mealCap, today: todayKey.value }), [setup, mode, choices, added, pantryOnly, mealCap]);
  const result = useMemo(() => replan(input), [input]);
  const t = setup.targets!;
  const changes = result.items.filter((i) => Math.abs(i.to - i.from) > 1e-9);
  const foodOf = (key: string): Food => (setup.planned.find((e) => e.id === key)?.food as Food | undefined) ?? added.find((a) => a.key === key)!.food;
  const slotOf = (key: string) => setup.planned.find((e) => e.id === key)?.slotId ?? added.find((a) => a.key === key)?.slotId ?? lastSlot;
  const missing = result.items.filter((i) => i.to > 0 && !setup.stock.has(foodOf(i.key).id));
  const addedIds = new Set([...added.map((a) => a.food.id), ...setup.planned.map((e) => e.foodId)]);

  const toAdded = (food: Food, auto = false): AddedFood => {
    const unit = food.basis.per === 'unit' ? 'portion' : food.basis.per === '100ml' ? 'ml' : 'g';
    return { key: `add:${auto ? 'auto:' : ''}${uuidv7()}`, food, slotId: addSlot, unit, ...(unit === 'portion' ? { portionId: 'unit' } : {}) };
  };
  const addFood = (food: Food) => setAdded([...added, toAdded(food)]);
  // "Use what I have": every pantry food and batch becomes an option; turning it off takes back
  // only the ones it added.
  const togglePantryOnly = (on: boolean) => {
    setPantryOnly(on);
    if (on) setAdded([...added, ...setup.offers.filter((o) => !addedIds.has(o.food.id)).map((o) => toAdded(o.food, true))]);
    else setAdded(added.filter((a) => !a.key.startsWith('add:auto:')));
  };

  const apply = async () => {
    setBusy(true);
    try {
      const ev = await applyReplan(setup, result, added, mode, MODES.find((m) => m.key === mode)!.label);
      closeSheet();
      if (!ev) { toast('Nothing needed to change.'); return; }
      const undo = async () => {
        const r = await revertReplan(ev.id);
        toast(r.skipped ? `Restored, except ${r.skipped} item${r.skipped > 1 ? 's' : ''} you changed since` : 'Previous plan restored');
      };
      rememberUndo(undo);
      toast(`Replanned: ${ev.changes.length} change${ev.changes.length > 1 ? 's' : ''}`, { tone: 'ok', ms: 8000, action: { label: 'Undo', run: undo } });
    } finally { setBusy(false); }
  };

  const groups = setup.slots.map((s) => ({ slot: s, items: result.items.filter((i) => slotOf(i.key) === s.id) })).filter((g) => g.items.length);

  return (
    <Sheet title="Replan the rest of today" onClose={closeSheet}
      footer={<>
        {missing.length && !pantryOnly ? (
          <button type="button" class="btn" onClick={async () => {
            for (const i of missing) {
              const f = foodOf(i.key);
              await addShopping({ name: displayName(f), food: f, qty: qtyOf(i, f, setup, added), source: 'replan' });
            }
            toast(`${missing.length} food${missing.length > 1 ? 's' : ''} added to the shopping list`, { tone: 'ok' });
          }}><ShoppingCart size={16} aria-hidden="true" /> Missing → shopping list</button>
        ) : null}
        <button type="button" class="btn btn-primary" disabled={busy || !changes.length} onClick={() => void apply()}>
          <Check size={16} aria-hidden="true" /> {changes.length ? `Apply ${changes.length} change${changes.length > 1 ? 's' : ''}` : 'No changes'}
        </button>
      </>}>
      <p class="small muted">Food you've eaten stays exactly as logged. Only planned food changes — you see every change before it's saved, and you can undo it.</p>

      <Totals t={t} eaten={setup.eaten} result={result} plannedNow={sumPlanned(input)} />

      {result.notes.length ? (
        <div class="stack-s" role="status">
          {result.notes.map((n) => (
            <p key={n} class="callout warn small cluster" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <TriangleAlert size={15} aria-hidden="true" style={{ flex: 'none', marginTop: '2px' }} /><span>{n}</span>
            </p>
          ))}
        </div>
      ) : null}

      <section class="stack-s" aria-labelledby="rp-plan">
        <h3 id="rp-plan" class="section-title">The rest of today</h3>
        {groups.length === 0 ? <p class="small muted">Nothing is planned for later today. Add food you have below, or use <b>Plan today</b> first.</p> : null}
        {groups.map((g) => (
          <div key={g.slot.id} class="stack-s">
            <h4 class="small muted" style={{ margin: 0 }}>{g.slot.name}</h4>
            <ul class="list" aria-label={`${g.slot.name} changes`}>
              {g.items.map((i) => (
                <ItemRow key={i.key} item={i} food={foodOf(i.key)} setup={setup} added={added} choice={choices[i.key] ?? 'adjust'}
                  isAdded={i.key.startsWith('add:')}
                  onChoice={(c) => setChoices({ ...choices, [i.key]: c })}
                  onRemove={() => setAdded(added.filter((a) => a.key !== i.key))} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section class="stack-s" aria-labelledby="rp-add">
        <h3 id="rp-add" class="section-title">Add food you have</h3>
        <Field label="Add to" for="rp-slot">
          <select id="rp-slot" class="select" value={addSlot} onChange={(e) => setAddSlot(e.currentTarget.value)}>
            {setup.slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {setup.offers.filter((o) => !addedIds.has(o.food.id)).length ? (
          <div class="cluster">
            {setup.offers.filter((o) => !addedIds.has(o.food.id)).map((o) => (
              <button key={o.food.id} type="button" class="btn btn-s" onClick={() => addFood(o.food)}>
                <Plus size={14} aria-hidden="true" /> {displayName(o.food)} <span class="muted num">· {o.approx ? '≈' : ''}{Math.round(o.stockG)} g{o.source === 'batch' ? ' left' : ''}</span>
              </button>
            ))}
          </div>
        ) : <p class="small muted">{setup.offers.length ? 'Everything you have is already in this replan.' : 'Your pantry is empty — pantry items and cooked batches show up here.'}</p>}
        <details>
          <summary class="small">Add any other food</summary>
          <FoodPicker label="Search foods" onPick={(f) => addFood(f)} />
        </details>
      </section>

      <section class="stack-s" aria-labelledby="rp-how">
        <h3 id="rp-how" class="section-title">How to rebalance</h3>
        <Field label="Priority" for="rp-mode" hint={MODES.find((m) => m.key === mode)!.what}>
          <select id="rp-mode" class="select" value={mode} onChange={(e) => setMode(e.currentTarget.value as ReplanMode)}>
            {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
        <Checkbox label="Only use food in my pantry" checked={pantryOnly} onChange={togglePantryOnly}
          hint="Uses everything in your pantry and cooked batches; planned foods you don't have are left out." />
        <NumberField label="Keep any one meal under" suffix="kcal" value={mealCap} onChange={setMealCap} min={100} max={5000} placeholder="no limit" />
      </section>

      {events.length ? (
        <section class="stack-s" aria-labelledby="rp-hist">
          <h3 id="rp-hist" class="section-title">Earlier replans today</h3>
          <ul class="list">
            {events.map((ev) => (
              <li key={ev.id} class="cluster" style={{ justifyContent: 'space-between' }}>
                <span class="small"><b>{new Date(ev.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b> · {ev.summary}
                  <span class="muted"> — {ev.changes.map((c) => `${c.foodName} ${c.from ? qtext(c.from) : 'new'} → ${c.to ? qtext(c.to) : 'removed'}`).join('; ')}</span>
                  {ev.revertedAt ? <span class="badge" style={{ marginLeft: '6px' }}>undone</span> : null}
                </span>
                {!ev.revertedAt ? (
                  <button type="button" class="btn btn-s" onClick={async () => {
                    const r = await revertReplan(ev.id);
                    toast(r.skipped ? `Restored, except ${r.skipped} item${r.skipped > 1 ? 's' : ''} you changed since` : 'Previous plan restored');
                    closeSheet();
                  }}><Undo2 size={14} aria-hidden="true" /> Undo</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}

const qtext = (q: Quantity) => (q.unit === 'g' ? `${formatAmount(q.amount)} g` : q.unit === 'ml' ? `${formatAmount(q.amount)} mL` : `×${formatAmount(q.amount)}`);

/** Macros of the plan as it is now (before this replan). */
function sumPlanned(input: ReplanInput): Record<Macro, number> {
  const out: Record<Macro, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const c of input.candidates) {
    const per = perUnit(c);
    if (per) for (const m of MACROS) out[m] += (per[m] ?? 0) * c.current;
  }
  return out;
}

function qtyOf(i: ReplanItem, food: Food, setup: ReplanSetup, added: readonly AddedFood[]): Quantity {
  const e = setup.planned.find((x) => x.id === i.key);
  if (e) return { ...e.qty, amount: i.to } as Quantity;
  const a = added.find((x) => x.key === i.key);
  return a?.unit === 'portion' ? { amount: i.to, unit: 'portion', portionId: a.portionId ?? 'unit' } : { amount: i.to, unit: a?.unit === 'ml' ? 'ml' : 'g' };
}

function Totals({ t, eaten, result, plannedNow }: { t: Record<Macro, number>; eaten: Record<Macro, number>; result: ReplanResult; plannedNow: Record<Macro, number> }) {
  return (
    <ul class="list" aria-label="Today's targets with this replan">
      {MACROS.map((m) => {
        const left = t[m] - eaten[m];
        const s = result.status[m];
        const moved = Math.abs(plannedNow[m] - result.totals[m]) >= (m === 'kcal' ? 5 : 1);
        return (
          <li key={m} class="stack-s" style={{ gap: '2px', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div class="cluster" style={{ justifyContent: 'space-between' }}>
              <b>{LABEL[m]}</b>
              {s === 'ok' ? <span class="badge" style={{ color: 'var(--ok)' }}>on target</span>
                : <span class="badge warn">{s === 'short' ? `${fmt(m, result.gap[m])} short` : `${fmt(m, -result.gap[m])} over`}</span>}
            </div>
            <div class="small num">
              {left >= 0 ? <>Left {fmt(m, left)}</> : <>Over by {fmt(m, -left)}</>} · new plan <b>{fmt(m, result.totals[m])}</b>
              {moved ? <span class="muted"> (was {fmt(m, plannedNow[m])})</span> : null}
            </div>
            <div class="xs subtle num">{fmt(m, eaten[m])} eaten of {fmt(m, t[m])}</div>
          </li>
        );
      })}
    </ul>
  );
}

function ItemRow({ item: i, food, setup, added, choice, isAdded, onChoice, onRemove }: {
  item: ReplanItem; food: Food; setup: ReplanSetup; added: readonly AddedFood[]; choice: Choice; isAdded: boolean;
  onChoice: (c: Choice) => void; onRemove: () => void;
}) {
  const q = (amount: number) => describeQuantity(food, { ...qtyOf(i, food, setup, added), amount } as Quantity);
  const changed = Math.abs(i.to - i.from) > 1e-9;
  const stock = setup.stock.get(food.id);
  const per100 = food.basis.per === 'unit' ? null : food.n;
  const name = displayName(food);
  return (
    <li class="stack-s" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div class="cluster" style={{ justifyContent: 'space-between' }}>
        <div class="stack-s" style={{ gap: '2px', minWidth: 0 }}>
          <span class="item-name">{name}</span>
          <span class="small num" aria-label={changed ? `${name}: ${isAdded ? 'add' : q(i.from)} to ${q(i.to)}` : `${name}: ${q(i.to)}, unchanged`}>
            {changed ? <>{isAdded ? <span class="muted">new</span> : <s class="muted">{q(i.from)}</s>} → <b>{i.to === 0 ? 'none' : q(i.to)}</b></> : <>{q(i.to)} <span class="muted">· unchanged</span></>}
            {i.reason ? <span class="muted"> · {i.reason}</span> : null}
          </span>
        </div>
        {isAdded ? (
          <button type="button" class="btn btn-s btn-ghost" aria-label={`Remove ${name} from this replan`} onClick={onRemove}>Remove</button>
        ) : (
          <select class="select" style={{ width: 'auto', minHeight: '36px' }} aria-label={`What to do with ${name}`} value={choice} onChange={(e) => onChoice(e.currentTarget.value as Choice)}>
            <option value="adjust">Adjust</option>
            <option value="keep">Keep as planned</option>
            <option value="drop">Leave out</option>
          </select>
        )}
      </div>
      <details>
        <summary class="xs">Why this amount?</summary>
        <div class="stack-s xs" style={{ paddingTop: '4px' }}>
          <span>Gives {fmt('kcal', i.n.kcal)} · protein {formatAmount(Math.round(i.n.protein * 10) / 10)} g · carbs {formatAmount(Math.round(i.n.carbs * 10) / 10)} g · fat {formatAmount(Math.round(i.n.fat * 10) / 10)} g</span>
          {per100 ? <span class="cluster">Per 100 {food.basis.per === '100ml' ? 'mL' : 'g'}: {per100.kcal ?? '?'} kcal · P {per100.protein ?? '?'} · C {per100.carbs ?? '?'} · F {per100.fat ?? '?'} <SourceBadge src={food.src} /></span> : null}
          <span>{stock ? `Available: ${stock.approx ? 'about ' : ''}${Math.round(stock.grams)} g ${stock.source === 'batch' ? 'left in the batch' : 'in your pantry'}${stock.expiresOn ? ` (use by ${stock.expiresOn})` : ''}.` : 'Not in your pantry — check you have it, or put it on the shopping list.'}</span>
          <span>{i.limit === 'kept' ? 'You fixed this amount.' : i.limit === 'blocked' ? 'Left out because it is not in your pantry.' : i.limit === 'stock' ? 'Limited by what you have.' : i.limit === 'max' ? 'Capped at a sensible single serving.' : 'Chosen by the balance of your targets and the priority you picked.'}</span>
        </div>
      </details>
    </li>
  );
}
