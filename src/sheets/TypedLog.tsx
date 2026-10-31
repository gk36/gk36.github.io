import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { NumberField, Segmented } from '../ui/controls';
import { FoodPicker } from '../ui/FoodPicker';
import { SourceBadge } from '../ui/nutrition';
import { useAsync } from '../ui/hooks';
import { Check, ChevronLeft, CircleAlert, Info, Pencil, Plus, ScanBarcode, Search, Trash } from '../ui/icons';
import { allFoods, saveCustomFood } from '../data/foods/registry';
import { ensureDay, recentFoods } from '../data/entries';
import type { Slot } from '../data/types';
import { parseFoodText, type SlotHint } from '../domain/logging/parse';
import { amountFor, compoundNames, matchMention, type Issue, type MatchedItem } from '../domain/logging/match';
import { contribution, sumNutrients } from '../domain/nutrition/compute';
import { displayName, PREP_LABEL, type Food, type NutrientMap, type Quantity } from '../domain/nutrition/food';
import { defaultQuantity, formatAmount, parseAmount } from '../domain/nutrition/quantity';
import { roundFor } from '../domain/nutrition/format';
import { unitOptions, qtyKey } from './AmountPicker';
import { guessSlot } from './quick-helpers';
import { closeSheet, draftText, openSheet, profile, typedResume, updateProfile } from '../app/store';
import { logEntries } from '../app/actions';
import type { DayKey } from '../domain/time';

/**
 * "Type what you ate": the sentence is read into items, each matched to a real food with its own
 * data. Anything unclear (unknown food, cooked or dry, "some", foods that differ in calories) has to
 * be answered before saving, and every amount and food can be changed. Corrections are remembered.
 */

interface Row {
  key: string;
  item: MatchedItem;
  food: Food | null;
  qty: Quantity | null;
  /** Blocking questions still open. */
  open: Issue[];
  notes: string[];
  /** The user chose this food themselves: remember the phrase. */
  picked: boolean;
  mode: null | 'search' | 'estimate' | 'change';
}

const SLOT_RE: Record<SlotHint, RegExp> = {
  breakfast: /breakfast|morning|πρωιν/i, lunch: /lunch|midday|μεσημ/i, dinner: /dinner|evening|βραδ|δείπν/i,
  snack: /snack|σνακ/i, pre: /pre|before/i, post: /post|after/i,
};

function slotFromHint(hint: SlotHint | null, slots: readonly Slot[]): string | null {
  if (!hint) return null;
  return slots.find((s) => SLOT_RE[hint].test(s.name))?.id ?? null;
}

const nutrientsOf = (r: Row): NutrientMap | null => {
  if (!r.food || !r.qty) return null;
  const c = contribution(r.food, r.qty);
  return 'error' in c ? null : c.n;
};

/** Re-reads the amount the user typed for a newly chosen food (keeps the amount they edited by hand). */
function withFood(r: Row, food: Food, picked: boolean, keepQty: boolean): Row {
  const kept = keepQty && r.qty && !('error' in contribution(food, r.qty)) ? r.qty : null;
  const a = kept ? { qty: kept, issues: [], notes: [] as string[] } : amountFor(food, r.item.mention);
  const open = r.open.filter((i) => !['no-match', 'choose-food', 'confirm-food', 'state', 'amount', 'unit'].includes(i.kind)).concat(a.issues);
  return { ...r, food, qty: a.qty, open, notes: [...r.item.notes.filter((n) => !n.startsWith('Using ')), ...a.notes].filter((n, i, all) => all.indexOf(n) === i), picked, mode: null };
}

export function TypedLog({ dayKey, text, slotId, status: initialStatus, onBack }: {
  dayKey: DayKey; text: string; slotId?: string; status?: 'eaten' | 'planned'; onBack?: () => void;
}) {
  const p = profile.value!;
  const foods = useAsync(() => allFoods(), []);
  const recents = useAsync(() => recentFoods(60), []);
  const day = useAsync(() => ensureDay(dayKey), [dayKey]);
  const slots = day?.slots ?? p.defaultSlots;
  const parsed = useMemo(() => (foods ? parseFoodText(text, { compounds: compoundNames(foods) }) : null), [foods, text]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [slot, setSlot] = useState(slotId ?? '');
  const [status, setStatus] = useState<'eaten' | 'planned'>(initialStatus ?? 'eaten');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!foods || !recents || !parsed || rows) return;
    const boost = new Map(recents.map((r, i) => [r.food.id, Math.max(0.5, 2 - i * 0.05)]));
    const learned = new Map(Object.entries(p.phrases ?? {}));
    setRows(parsed.items.map((m, i) => {
      const item = matchMention(m, { foods, boost, learned });
      return { key: `t${i}`, item, food: item.food, qty: item.qty, open: item.issues.filter((x) => x.blocking), notes: item.notes, picked: false, mode: null };
    }));
    if (parsed.status && !initialStatus) setStatus(parsed.status);
  }, [foods, recents, parsed]);

  useEffect(() => {
    if (!slots.length || slots.some((s) => s.id === slot)) return;
    setSlot((slotId && slots.some((s) => s.id === slotId) ? slotId : null) ?? slotFromHint(parsed?.slot ?? null, slots) ?? guessSlot(slots));
  }, [slots.map((s) => s.id).join('|'), parsed]);

  const update = (key: string, f: (r: Row) => Row | null) =>
    setRows((rs) => (rs ?? []).flatMap((r) => (r.key === key ? (f(r) ? [f(r)!] : []) : [r])));

  if (!rows) {
    return <Sheet title="Check and log" onClose={closeSheet}><p class="muted" role="status">Reading what you ate…</p></Sheet>;
  }

  const live = rows.filter((r) => r.food && r.qty);
  const parts = live.map(nutrientsOf).filter((n): n is NutrientMap => !!n);
  const total = sumNutrients(parts);
  const waiting = rows.filter((r) => r.open.length || !r.food || !r.qty).length;
  const approx = rows.some((r) => r.item.approx || r.notes.length > 0);

  const save = async () => {
    if (waiting || !live.length || saving) return;
    setSaving(true);
    const inputs = live.map((r) => ({ dayKey, slotId: slot, food: r.food!, qty: r.qty!, status, origin: 'text' as const }));
    const kcal = Math.round(total.kcal.value);
    await logEntries(inputs, `${status === 'eaten' ? 'Logged' : 'Planned'} ${inputs.length} item${inputs.length === 1 ? '' : 's'} · ${kcal.toLocaleString('en-GB')} kcal`);
    const learned: Record<string, string> = {};
    for (const r of live) {
      if (!r.picked || !r.item.phrase) continue;
      learned[r.item.mention.state ? `${r.item.phrase}|${r.item.mention.state}` : r.item.phrase] = r.food!.id;
    }
    if (Object.keys(learned).length) void updateProfile((prev) => ({ phrases: { ...(prev.phrases ?? {}), ...learned } }));
    if (draftText.value.trim() === text.trim()) draftText.value = '';
    closeSheet();
  };

  return (
    <Sheet
      title="Check and log" onClose={closeSheet}
      lead={onBack ? <button type="button" class="btn btn-ghost btn-icon" aria-label="Back to the text" onClick={onBack}><ChevronLeft size={20} /></button> : undefined}
      footer={<>
        <div class="tl-total" aria-live="polite">
          <b class="num">{approx ? '≈ ' : ''}{Math.round(total.kcal.value).toLocaleString('en-GB')} kcal</b>
          <span class="muted num"> · P {roundFor('protein', total.protein.value)} · C {roundFor('carbs', total.carbs.value)} · F {roundFor('fat', total.fat.value)}</span>
          {waiting ? <span class="tl-wait"> · {waiting} to check</span> : null}
        </div>
        <button type="button" class="btn btn-primary" disabled={!!waiting || !live.length || saving} onClick={() => void save()}>
          <Check size={18} aria-hidden="true" /> {waiting ? `Check ${waiting} item${waiting === 1 ? '' : 's'} first` : `${status === 'eaten' ? 'Log' : 'Plan'} ${live.length} item${live.length === 1 ? '' : 's'}`}
        </button>
      </>}
    >
      <figure class="tl-quote">
        <blockquote>{text}</blockquote>
        {onBack ? <button type="button" class="linkish small" onClick={onBack}>Edit text</button> : null}
      </figure>

      {rows.length === 0 ? <p class="callout">No foods found in that text. Try “2 eggs, 80 g oats and a banana”.</p> : null}

      <ul class="tl-list" aria-label="Foods from your text">
        {rows.map((r) => (
          <ItemRow key={r.key} row={r} onChange={(f) => update(r.key, f)} onRemove={() => update(r.key, () => null)}
            onFetch={(how) => {
              // Scan or enter the label, then come straight back to this list with the food remembered.
              typedResume.value = { text, phrase: r.item.phrase, dayKey };
              if (how === 'scan') openSheet({ kind: 'scan', dayKey });
              else openSheet({ kind: 'food-editor', prefill: { names: { en: r.item.mention.words.join(' ') } }, thenLog: { dayKey } });
            }} />
        ))}
      </ul>

      {adding ? (
        <div class="card stack-s">
          <FoodPicker label="Add a food" autoFocus onPick={(f) => {
            const m = { text: displayName(f), words: [], amount: null, state: null, size: null };
            const item: MatchedItem = { mention: m, phrase: '', food: f, qty: defaultQuantity(f), alternatives: [], statePair: null, issues: [], notes: [], approx: false };
            setRows((rs) => [...(rs ?? []), { key: `a${Date.now()}`, item, food: f, qty: defaultQuantity(f), open: [], notes: [], picked: false, mode: null }]);
            setAdding(false);
          }} />
          <button type="button" class="btn btn-s" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" class="btn" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add another food</button>
      )}

      <div class="fields">
        <div class="field">
          <label for="tl-slot">Meal</label>
          <select id="tl-slot" class="select" value={slot} onChange={(e) => setSlot(e.currentTarget.value)}>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.name}{s.time && /^\d{1,2}:\d{2}$/.test(s.time) ? ` · ${s.time}` : ''}</option>)}
          </select>
        </div>
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'eaten', label: 'Eaten' }, { value: 'planned', label: 'Planned' }]} />
      </div>
      <p class="xs subtle">Values come from each food's own data (USDA, your labels and recipes). Nothing is guessed: unclear items wait for you.</p>
    </Sheet>
  );
}

function kcalLabel(food: Food, qty: Quantity | null): string {
  if (qty) {
    const c = contribution(food, qty);
    if (!('error' in c) && c.n.kcal !== undefined) return `${Math.round(c.n.kcal).toLocaleString('en-GB')} kcal`;
  }
  const per = food.basis.per === 'unit' ? `/${food.basis.unitLabel}` : food.basis.per === '100ml' ? '/100 mL' : '/100 g';
  return food.n.kcal === undefined ? '? kcal' : `${food.partial?.includes('kcal') ? '≥ ' : ''}${Math.round(food.n.kcal)} kcal${per}`;
}

function ItemRow({ row, onChange, onRemove, onFetch }: { row: Row; onChange: (f: (r: Row) => Row) => void; onRemove: () => void; onFetch: (how: 'scan' | 'label') => void }) {
  const { item, food, qty } = row;
  const n = nutrientsOf(row);
  const issue = row.open[0];
  const name = food ? displayName(food) : `“${item.mention.words.join(' ') || item.mention.text}”`;
  const choose = (f: Food) => onChange((r) => withFood(r, f, true, false));
  return (
    <li class={`tl-item${row.open.length || !food ? ' needs' : ''}`}>
      <div class="tl-head">
        <div class="tl-name">
          <span class="item-name">{name}</span>
          <span class="xs subtle">{item.mention.text}</span>
        </div>
        <span class="tl-kcal num">{food ? kcalLabel(food, qty) : '—'}</span>
        <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label={`Remove ${name}`} onClick={onRemove}><Trash size={15} /></button>
      </div>

      {food ? (
        <div class="tl-meta">
          <AmountEdit food={food} qty={qty} label={name} onChange={(q) => onChange((r) => ({ ...r, qty: q, open: r.open.filter((i) => i.kind !== 'amount' && i.kind !== 'unit') }))} />
          <span class="cluster xs">
            <SourceBadge src={food.src} />
            {food.prep !== 'as-sold' ? <span class="badge">{PREP_LABEL[food.prep]}</span> : null}
            {n ? <span class="muted num">P {roundFor('protein', n.protein ?? 0)}{n.protein === undefined ? '?' : ''} · C {roundFor('carbs', n.carbs ?? 0)} · F {roundFor('fat', n.fat ?? 0)}</span> : null}
          </span>
          {!issue && row.mode !== 'change' && row.mode !== 'search' ? (
            <button type="button" class="linkish xs tl-change" onClick={() => onChange((r) => ({ ...r, mode: 'change' }))}><Pencil size={13} aria-hidden="true" /> Change food</button>
          ) : null}
        </div>
      ) : null}

      {issue ? <IssueBox row={row} issue={issue} onChange={onChange} onChoose={choose} onRemove={onRemove} onFetch={onFetch} /> : null}

      {!issue && food && row.mode === 'search' ? (
        <FoodPicker label={`Replace ${displayName(food)}`} initialQuery={item.mention.words.join(' ')} autoFocus onPick={choose} />
      ) : null}
      {!issue && food && row.mode === 'change' ? (
        <div class="chips tl-alts">
          {[...(item.statePair && item.statePair.id !== food.id ? [item.statePair] : []), ...item.alternatives].filter((f) => f.id !== food.id).slice(0, 4).map((f) => (
            <button key={f.id} type="button" class="chip" onClick={() => choose(f)}>{displayName(f)}</button>
          ))}
          <button type="button" class="chip" onClick={() => onChange((r) => ({ ...r, mode: 'search' }))}><Search size={13} aria-hidden="true" /> Search</button>
          <button type="button" class="chip" onClick={() => onChange((r) => ({ ...r, mode: null }))}>Keep</button>
        </div>
      ) : null}

      {row.notes.length ? (
        <ul class="tl-notes">{row.notes.map((t) => <li key={t}><Info size={13} aria-hidden="true" /> {t}</li>)}</ul>
      ) : null}
    </li>
  );
}

function AmountEdit({ food, qty, label, onChange }: { food: Food; qty: Quantity | null; label: string; onChange: (q: Quantity) => void }) {
  const opts = unitOptions(food);
  const cur = (qty && opts.find((o) => o.key === qtyKey(qty))) ?? opts[0];
  const [text, setText] = useState(qty ? formatAmount(qty.amount) : '');
  useEffect(() => { if (qty && parseAmount(text) !== qty.amount) setText(formatAmount(qty.amount)); }, [qty?.amount]);
  if (!cur) return null;
  return (
    <span class="tl-amount">
      <input class="input input-num" inputMode="decimal" aria-label={`${label} amount`} value={text} placeholder="?"
        onInput={(e) => { const s = e.currentTarget.value; setText(s); const v = parseAmount(s); if (v !== null && v > 0) onChange(cur.qty(v)); }} />
      <select class="select" aria-label={`${label} unit`} value={cur.key}
        onChange={(e) => { const o = opts.find((x) => x.key === e.currentTarget.value); const v = parseAmount(text); if (o) onChange(o.qty(v && v > 0 ? (o.key === 'g' || o.key === 'ml' ? (qty && (qty.unit === 'g' || qty.unit === 'ml') ? v : 100) : 1) : o.key === 'g' || o.key === 'ml' ? 100 : 1)); }}>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </span>
  );
}

function IssueBox({ row, issue, onChange, onChoose, onRemove, onFetch }: {
  row: Row; issue: Issue; onChange: (f: (r: Row) => Row) => void; onChoose: (f: Food) => void; onRemove: () => void; onFetch: (how: 'scan' | 'label') => void;
}) {
  const { item, food } = row;
  const words = item.mention.words.join(' ');
  const setMode = (mode: Row['mode']) => onChange((r) => ({ ...r, mode }));

  if (row.mode === 'search') {
    return (
      <div class="tl-issue">
        <FoodPicker label={`Find “${words}”`} initialQuery={words} autoFocus onPick={onChoose} />
        <button type="button" class="btn btn-s" onClick={() => setMode(null)}>Cancel</button>
      </div>
    );
  }
  if (row.mode === 'estimate') return <EstimateForm row={row} onDone={(f) => onChange((r) => ({ ...withFood(r, f, false, false), qty: { amount: 1, unit: 'portion', portionId: 'unit' }, open: [] }))} onCancel={() => setMode(null)} />;

  const msg = <p class="tl-msg"><CircleAlert size={15} aria-hidden="true" /> {issue.message}</p>;
  switch (issue.kind) {
    case 'no-match':
      return (
        <div class="tl-issue">
          {msg}
          {item.alternatives.length ? (
            <div class="chips"><span class="xs subtle">Did you mean</span>{item.alternatives.map((f) => <button key={f.id} type="button" class="chip" onClick={() => onChoose(f)}>{displayName(f)}?</button>)}</div>
          ) : null}
          <div class="cluster">
            <button type="button" class="btn btn-s" onClick={() => onFetch('scan')}><ScanBarcode size={15} aria-hidden="true" /> Scan it</button>
            <button type="button" class="btn btn-s" onClick={() => onFetch('label')}><Pencil size={15} aria-hidden="true" /> From the label</button>
            <button type="button" class="btn btn-s" onClick={() => setMode('search')}><Search size={15} aria-hidden="true" /> Find it</button>
          </div>
          <div class="cluster">
            <button type="button" class="btn btn-s btn-ghost" onClick={() => setMode('estimate')}>Enter an estimate</button>
            <button type="button" class="btn btn-s btn-ghost" onClick={onRemove}>Leave it out</button>
          </div>
          <p class="xs subtle">Scanning or the label gives exact values; you come back to this list and it's remembered next time.</p>
        </div>
      );
    case 'confirm-food':
      return (
        <div class="tl-issue">
          {msg}
          <div class="cluster">
            {food ? <button type="button" class="btn btn-s" onClick={() => onChange((r) => ({ ...r, open: r.open.filter((i) => i !== issue), picked: true }))}><Check size={15} aria-hidden="true" /> Yes, {displayName(food)}</button> : null}
            <button type="button" class="btn btn-s" onClick={() => setMode('search')}><Search size={15} aria-hidden="true" /> Something else</button>
          </div>
        </div>
      );
    case 'choose-food': {
      const options = food ? [food, ...item.alternatives] : item.alternatives;
      return (
        <div class="tl-issue">
          {msg}
          <div class="chips" role="group" aria-label={`Which ${words}?`}>
            {options.slice(0, 5).map((f) => <button key={f.id} type="button" class="chip" onClick={() => onChoose(f)}>{displayName(f)} <span class="subtle num">{kcalLabel(f, null)}</span></button>)}
            <button type="button" class="chip" onClick={() => setMode('search')}><Search size={13} aria-hidden="true" /> Other</button>
          </div>
        </div>
      );
    }
    case 'state': {
      if (!item.statePair && food) {
        // "300 g cooked oatmeal" with only dry oats on file: the typed weight can't be used as it is.
        return (
          <div class="tl-issue">
            {msg}
            <div class="cluster">
              <button type="button" class="btn btn-s" onClick={() => onChange((r) => ({ ...r, qty: null, open: [{ kind: 'amount', blocking: true, message: `Enter the ${food.prep} weight.` }] }))}>Enter the {food.prep} weight</button>
              <button type="button" class="btn btn-s" onClick={() => setMode('search')}><Search size={15} aria-hidden="true" /> Choose another food</button>
            </div>
          </div>
        );
      }
      const both = food && item.statePair ? [food, item.statePair].sort((a, b) => Number(a.prep === 'raw' || a.prep === 'dry') - Number(b.prep === 'raw' || b.prep === 'dry')) : [];
      return (
        <div class="tl-issue">
          {msg}
          <div class="cluster" role="group" aria-label="Cooked or raw">
            {both.map((f) => {
              const a = amountFor(f, item.mention);
              return (
                <button key={f.id} type="button" class="btn btn-s" onClick={() => onChange((r) => withFood(r, f, false, true))}>
                  {f.prep === 'dry' ? 'Dry (uncooked)' : f.prep === 'raw' ? 'Raw' : `Cooked (${PREP_LABEL[f.prep]})`}{a.qty ? <span class="subtle num"> · {kcalLabel(f, a.qty)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'amount':
    case 'unit': {
      const portions = food?.portions.slice(0, 4) ?? [];
      return (
        <div class="tl-issue">
          {msg}
          {food && portions.length ? (
            <div class="chips">
              {portions.map((pt) => <button key={pt.id} type="button" class="chip" onClick={() => onChange((r) => ({ ...r, qty: { amount: 1, unit: 'portion', portionId: pt.id }, open: r.open.filter((i) => i.kind !== 'amount' && i.kind !== 'unit') }))}>{pt.label}{pt.g ? ` · ${formatAmount(pt.g)} g` : ''}</button>)}
            </div>
          ) : null}
          <p class="xs subtle">Or type the amount above.</p>
        </div>
      );
    }
  }
}

function EstimateForm({ row, onDone, onCancel }: { row: Row; onDone: (f: Food) => void; onCancel: () => void }) {
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const save = async () => {
    if (!kcal) return;
    const n: Food['n'] = { kcal };
    if (protein !== null) n.protein = protein;
    if (carbs !== null) n.carbs = carbs;
    if (fat !== null) n.fat = fat;
    const f = await saveCustomFood({
      id: '', names: { en: row.item.mention.text }, kind: 'custom', group: 'other', prep: 'prepared', basis: { per: 'unit', unitLabel: 'serving' },
      portions: [], n, carbsIncludeFiber: true, kcalOrigin: 'label',
      src: { type: 'estimate', confidence: 'low', note: 'Your own estimate. Nutrients left blank are unknown, not zero.' },
    });
    onDone(f);
  };
  return (
    <div class="tl-issue stack-s">
      <p class="small">Your estimate for <b>{row.item.mention.text}</b> — saved as a low-confidence estimate. Blank = unknown.</p>
      <div class="fields">
        <NumberField label="Calories" suffix="kcal" value={kcal} onChange={setKcal} min={1} max={5000} />
        <NumberField label="Protein" suffix="g" value={protein} onChange={setProtein} min={0} max={500} />
        <NumberField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} min={0} max={1000} />
        <NumberField label="Fat" suffix="g" value={fat} onChange={setFat} min={0} max={500} />
      </div>
      <div class="cluster">
        <button type="button" class="btn btn-s btn-primary" disabled={!kcal} onClick={() => void save()}>Use estimate</button>
        <button type="button" class="btn btn-s" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
