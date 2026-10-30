import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Checkbox, NumberField, Segmented } from '../ui/controls';
import { useAsync } from '../ui/hooks';
import { Check, ChefHat, ChevronDown, Clock, Leaf, Pencil, Plus, Shuffle, ShoppingCart, SlidersHorizontal, Sparkles, Trash, X } from '../ui/icons';
import { ideaFood, ideaToShopping, loadIdeaSetup, mealGoal, mealNeeds, mealOfSlot, saveIdeaAsRecipe, tasteOf, type IdeaSetup } from '../data/ideas';
import { draftsOf, generateIdeas, nutrientWords, rebalance, roleChoices, sized, type Idea, type IdeaInput, type IdeaItem } from '../domain/ideas/generate';
import { EQUIPMENT_LABEL, type Equipment, type TastePrefs } from '../domain/ideas/model';
import { OXALATE_LABEL, OXALATE_SOURCES } from '../domain/ideas/oxalate';
import { displayName } from '../domain/nutrition/food';
import { roundFor } from '../domain/nutrition/format';
import { formatAmount, parseAmount } from '../domain/nutrition/quantity';
import { guessSlot } from './quick-helpers';
import { closeSheet, profile, toast, updateProfile } from '../app/store';
import { logEntries } from '../app/actions';
import { navigate } from '../app/router';
import type { DayKey } from '../domain/time';

const TIMES: { value: string; label: string; minutes: number | null }[] = [
  { value: 'any', label: 'Any time', minutes: null }, { value: '10', label: '≤ 10 min', minutes: 10 },
  { value: '20', label: '≤ 20 min', minutes: 20 }, { value: '45', label: '≤ 45 min', minutes: 45 },
];

export function IdeasSheet({ dayKey, slotId }: { dayKey: DayKey; slotId?: string }) {
  const p = profile.value!;
  const setup = useAsync(() => loadIdeaSetup(p, dayKey), [dayKey]);
  if (!setup) return <Sheet title="Meal ideas" onClose={closeSheet}><p class="muted" role="status">Looking at your day and your pantry…</p></Sheet>;
  return <IdeasBody setup={setup} {...(slotId ? { slotId } : {})} />;
}

function IdeasBody({ setup, slotId }: { setup: IdeaSetup; slotId?: string }) {
  const p = profile.value!;
  const taste = tasteOf(p);
  const [slot, setSlot] = useState(slotId ?? guessSlot(setup.slots));
  const meal = mealOfSlot(setup.slots.find((s) => s.id === slot));
  const goal = mealGoal(setup, meal, slot, taste);
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [editSize, setEditSize] = useState(false);
  const [time, setTime] = useState('any');
  const stocked = setup.stock.size;
  const [pantryOnly, setPantryOnly] = useState(stocked >= 6);
  const [seed, setSeed] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(!taste.confirmed);

  const target = { kcal: kcal ?? goal.kcal, protein: protein ?? goal.protein };
  const { needs, line } = useMemo(() => mealNeeds(setup, p, goal.share), [setup, p.sex, p.birthDate, p.ageYears, goal.share]);
  const input: IdeaInput = {
    meal, target, taste, needs, maxMinutes: TIMES.find((x) => x.value === time)?.minutes ?? null,
    foods: setup.foods, stock: setup.stock, pantryOnly, recent: setup.recent, seed,
  };
  const result = useMemo(() => generateIdeas(input, 3),
    [meal, target.kcal, target.protein, JSON.stringify(taste), needs, time, pantryOnly, seed, setup]);

  return (
    <Sheet title="Meal ideas" onClose={closeSheet}
      footer={<button type="button" class="btn" onClick={() => setSeed((s) => s + 1)}><Shuffle size={16} aria-hidden="true" /> Show other ideas</button>}>
      {prefsOpen ? <TastePanel taste={taste} onDone={() => setPrefsOpen(false)} /> : null}

      <div class="ideas-controls">
        <div class="field">
          <label for="ideas-slot">Meal</label>
          <select id="ideas-slot" class="select" value={slot} onChange={(e) => { setSlot(e.currentTarget.value); setKcal(null); setProtein(null); }}>
            {setup.slots.map((s) => <option key={s.id} value={s.id}>{s.name}{s.time && /^\d{1,2}:\d{2}$/.test(s.time) ? ` · ${s.time}` : ''}</option>)}
          </select>
        </div>
        <div class="field">
          <span class="label" id="ideas-size-l">Size</span>
          <button type="button" class="btn ideas-size" aria-labelledby="ideas-size-l" aria-expanded={editSize} onClick={() => setEditSize((v) => !v)}>
            <b class="num">{target.kcal.toLocaleString('en-GB')} kcal</b><span class="muted num"> · {target.protein} g protein</span>
            <Pencil size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {editSize ? (
        <div class="fields">
          <NumberField label="Calories" suffix="kcal" value={target.kcal} onChange={(v) => setKcal(v)} min={100} max={2000} />
          <NumberField label="Protein" suffix="g" value={target.protein} onChange={(v) => setProtein(v)} min={0} max={150} />
        </div>
      ) : null}
      <p class="xs subtle">
        {goal.note ?? (setup.left ? `This meal's share of what's left today (${Math.round(Math.max(0, setup.left.kcal)).toLocaleString('en-GB')} kcal, ${Math.round(Math.max(0, setup.left.protein))} g protein after what you've eaten and planned).` : '')}
      </p>

      <Segmented label="Time" value={time} onChange={setTime} options={TIMES.map((x) => ({ value: x.value, label: x.label }))} />
      <div class="cluster">
        <Checkbox label={<>Only what I have <span class="subtle">({stocked} in the pantry)</span></>} checked={pantryOnly} onChange={setPantryOnly} />
        <span class="topbar-spacer" />
        <button type="button" class="btn btn-s btn-ghost" onClick={() => setPrefsOpen((v) => !v)} aria-expanded={prefsOpen}><SlidersHorizontal size={15} aria-hidden="true" /> Your taste</button>
      </div>

      {line ? <p class="ideas-gap"><Sparkles size={16} aria-hidden="true" /> <span>{line} {result.ideas.length ? `Here ${result.ideas.length === 1 ? 'is a meal' : `are ${result.ideas.length === 2 ? 'two' : 'three'} meals`}${pantryOnly ? ' using what you have' : ''}.` : ''}</span></p> : null}

      {result.ideas.length === 0 ? (
        <div class="callout warn">
          No idea fits these limits{pantryOnly ? ' with only what is in your pantry' : ''}. {pantryOnly ? 'Turn off "Only what I have", or add foods to your pantry.' : 'Allow more time, or check "Your taste" (equipment, foods you avoid).'}
        </div>
      ) : null}

      <ul class="ideas-list" aria-label="Meal ideas">
        {result.ideas.map((idea, i) => (
          <li key={`${idea.key}-${seed}`}><IdeaCard idea={idea} input={input} dayKey={setup.dayKey} slotId={slot} first={i === 0} /></li>
        ))}
      </ul>

      {result.unavailable.length ? (
        <p class="xs subtle">
          {result.unavailable.map((u) => `${u.blueprint.name} needs your ${u.missing.join(', ')}`).join('; ')} — add it once (scan the bottle or enter the label) and it will appear here.
        </p>
      ) : null}
      <p class="xs subtle">
        Amounts are exact for the foods shown, from USDA data and your own foods; unknown nutrients stay unknown. Cooking times are guides — check doneness, especially meat and fish.
      </p>
    </Sheet>
  );
}

function pctText(x: number) { return x >= 9.95 ? '999%+' : `${Math.round(x * 100)}%`; }

function IdeaCard({ idea: initial, input, dayKey, slotId, first }: { idea: Idea; input: IdeaInput; dayKey: DayKey; slotId: string; first: boolean }) {
  const [idea, setIdea] = useState(initial);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setIdea(initial); setFixed(new Set()); setEditing(false); }, [initial]);

  const T = idea.totals;
  const tgt = idea.target;
  const sat = T.satFat.known ? T.satFat.value : null;
  const band = Math.max(25, 0.04 * tgt.kcal);
  const off = Math.abs(T.kcal.value - tgt.kcal);
  const kcalFit: FitState = off <= band ? 'ok' : off <= 2 * band ? 'close' : 'off';
  const proteinFit: FitState = T.protein.value >= tgt.protein - 3 ? 'ok' : T.protein.value >= tgt.protein - 8 ? 'close' : 'off';
  const fatFit: FitState = T.fat.value <= tgt.fatMax + 1 ? 'ok' : T.fat.value <= tgt.fatMax + 4 ? 'close' : 'off';
  const satFit: FitState | null = sat === null ? null : sat <= tgt.satFatMax + 0.5 ? 'ok' : sat <= tgt.satFatMax + 1.5 ? 'close' : 'off';
  const helps = idea.covers.filter((c) => c.pct >= 0.25).sort((a, b) => b.pct - a.pct).slice(0, 4);
  const missing = idea.items.filter((i) => i.stock === 'missing' || i.stock === 'short');
  const staples = idea.items.filter((i) => i.stock === 'staple');

  const update = (drafts: ReturnType<typeof draftsOf>, lock: Set<string>) => { setFixed(lock); setIdea(rebalance(idea.blueprint, drafts, input, lock, idea.key)); };
  const setAmount = (role: string, v: number) => {
    const lock = new Set(fixed); lock.add(role);
    update(draftsOf(idea).map((d) => (d.role === role ? { ...d, amount: v } : d)), lock);
  };
  const swap = (role: string, foodId: string) => {
    const choice = roleChoices(idea.blueprint, role, input).find((c) => c.food.id === foodId);
    if (!choice) return;
    const lock = new Set(fixed); lock.delete(role);
    const opt = sized(choice.option, input);
    update(draftsOf(idea).map((d) => (d.role === role ? { ...d, food: choice.food, option: opt, unit: opt.unit ?? 'g', amount: opt.typical || opt.min } : d)), lock);
  };
  const remove = (role: string) => update(draftsOf(idea).filter((d) => d.role !== role), fixed);

  const log = async (status: 'eaten' | 'planned') => {
    setBusy(true);
    const food = ideaFood(idea);
    await logEntries([{ dayKey, slotId, food, qty: { amount: 1, unit: 'portion', portionId: 'unit' }, status, origin: 'idea' }],
      `${status === 'eaten' ? 'Logged' : 'Planned'} ${idea.blueprint.name} · ${Math.round(T.kcal.value).toLocaleString('en-GB')} kcal`);
    closeSheet();
  };
  const save = async () => {
    setBusy(true);
    await saveIdeaAsRecipe(idea);
    setBusy(false);
    toast(`Saved "${idea.blueprint.name}" to your recipes`, { tone: 'ok', action: { label: 'Open', run: () => { closeSheet(); navigate('kitchen'); } } });
  };
  const shop = async () => {
    const n = await ideaToShopping(idea);
    toast(`Added ${n} item${n === 1 ? '' : 's'} to the shopping list`, { tone: 'ok' });
  };

  const id = `idea-${idea.blueprint.id}`;
  return (
    <article class="idea" aria-labelledby={`${id}-t`}>
      <header class="idea-head">
        <h3 id={`${id}-t`} class="idea-title">{idea.blueprint.name}</h3>
        <span class="cluster xs">
          <span class="badge"><Clock size={12} aria-hidden="true" /> {idea.blueprint.minutes} min{idea.blueprint.ahead ? ' + overnight' : ''}</span>
          {missing.length === 0 && input.stock.size ? <span class="badge ok"><Check size={12} aria-hidden="true" /> All at home</span> : missing.length && input.stock.size ? <span class="badge warn">{missing.length} to buy</span> : null}
        </span>
      </header>

      <div class="idea-numbers" aria-label="Nutrition for this meal">
        <span class="idea-kcal num">{Math.round(T.kcal.value).toLocaleString('en-GB')}<small> kcal</small></span>
        <span class="idea-macro num"><span class="dot" style={{ background: 'var(--protein)' }} aria-hidden="true" /><b>{roundFor('protein', T.protein.value)}</b> g protein</span>
        <span class="idea-macro num"><span class="dot" style={{ background: 'var(--carbs)' }} aria-hidden="true" /><b>{roundFor('carbs', T.carbs.value)}</b> g carbs</span>
        <span class="idea-macro num"><span class="dot" style={{ background: 'var(--fat)' }} aria-hidden="true" /><b>{roundFor('fat', T.fat.value)}</b> g fat{sat !== null ? <span class="subtle"> ({roundFor('satFat', sat)} sat.)</span> : null}</span>
      </div>
      <p class="idea-fit xs">
        <Fit state={kcalFit} text={`${Math.round(tgt.kcal)} kcal goal`} />
        <Fit state={proteinFit} text={`${tgt.protein} g protein goal`} />
        <Fit state={fatFit} text={`fat under ${Math.round(tgt.fatMax)} g`} />
        {satFit !== null ? <Fit state={satFit} text={`sat. fat under ${roundFor('satFat', tgt.satFatMax)} g`} /> : <span class="subtle">saturated fat unknown for an ingredient</span>}
      </p>
      {helps.length ? (
        <p class="small idea-helps"><Leaf size={14} aria-hidden="true" /><span>Covers {helps.map((h, i) => <span key={h.id}>{i ? (i === helps.length - 1 ? ' and ' : ', ') : ''}<b>{pctText(h.pct)}</b> of the {nutrientWords([h.id])}</span>)} you still need{helps.some((h) => idea.totals[h.id].unknown) ? ' (at least)' : ''}.</span></p>
      ) : null}

      <ul class="idea-items" aria-label={`Ingredients for ${idea.blueprint.name}`}>
        {idea.items.map((it) => (
          <IngredientRow key={it.role} item={it} editing={editing} choices={editing ? roleChoices(idea.blueprint, it.role, input) : []} pantry={input.stock.size > 0}
            optional={!!idea.blueprint.roles.find((r) => r.key === it.role)?.optional} lowOx={input.taste.lowOxalate}
            onAmount={(v) => setAmount(it.role, v)} onSwap={(f) => swap(it.role, f)} onRemove={() => remove(it.role)} />
        ))}
      </ul>
      <div class="cluster">
        <button type="button" class="btn btn-s btn-ghost" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? <><Check size={15} aria-hidden="true" /> Done editing</> : <><Pencil size={15} aria-hidden="true" /> Change ingredients</>}</button>
        {fixed.size ? <span class="xs subtle">Other amounts re-balanced around yours.</span> : null}
      </div>

      <details class="idea-steps" open={first}>
        <summary><ChefHat size={15} aria-hidden="true" /> How to make it <span class="subtle">· {idea.steps.length} steps</span> <ChevronDown size={15} aria-hidden="true" class="chev" /></summary>
        <ol>{idea.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {idea.notes.map((n) => <p key={n} class="xs subtle">{n}</p>)}
      </details>

      <div class="idea-facts xs subtle">
        {idea.unknown.length ? <p>No data in some ingredients for {nutrientWords(idea.unknown.slice(0, 5))}{idea.unknown.length > 5 ? ` and ${idea.unknown.length - 5} more` : ''} — those totals are “at least”.</p> : <p>Every vitamin and mineral above has data for all ingredients.</p>}
        {input.taste.lowOxalate || (idea.oxalate.highest?.oxalate && idea.oxalate.highest.oxalate.level !== 'low') ? (
          <p>
            Oxalate ≈ {Math.round(idea.oxalate.mg)} mg from ingredients with cited values{idea.oxalate.unknown ? ` (${idea.oxalate.unknown} without data)` : ''}
            {idea.oxalate.highest && (idea.oxalate.highest.oxalate?.mg ?? 0) >= 2 ? `; most from ${idea.oxalate.highest.label}` : ''}.{' '}
            <a href={OXALATE_SOURCES['harvard-2023'].url} target="_blank" rel="noopener noreferrer">Source: Harvard 2023</a>
          </p>
        ) : null}
        {staples.length ? <p>Cupboard basics, not in your pantry list: {staples.map((s) => s.label).join(', ')}.</p> : null}
      </div>

      <div class="idea-actions">
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void log('eaten')}><Check size={16} aria-hidden="true" /> Log it</button>
        <button type="button" class="btn" disabled={busy} onClick={() => void log('planned')}><Plus size={16} aria-hidden="true" /> Plan it</button>
        <button type="button" class="btn" disabled={busy} onClick={() => void save()}><ChefHat size={16} aria-hidden="true" /> Save recipe</button>
        {missing.length ? <button type="button" class="btn" onClick={() => void shop()}><ShoppingCart size={16} aria-hidden="true" /> {missing.length} to list</button> : null}
      </div>
    </article>
  );
}

type FitState = 'ok' | 'close' | 'off';
function Fit({ state, text }: { state: FitState; text: string }) {
  return (
    <span class={`fit ${state}`}>
      {state === 'ok' ? <Check size={12} aria-hidden="true" /> : state === 'close' ? <span aria-hidden="true">≈</span> : <X size={12} aria-hidden="true" />}
      {' '}{state === 'close' ? 'close to ' : state === 'off' ? 'misses ' : ''}{text}
    </span>
  );
}

function IngredientRow({ item, editing, choices, optional, lowOx, pantry, onAmount, onSwap, onRemove }: {
  item: IdeaItem; editing: boolean; choices: ReturnType<typeof roleChoices>; optional: boolean; lowOx: boolean; pantry: boolean;
  onAmount: (v: number) => void; onSwap: (foodId: string) => void; onRemove: () => void;
}) {
  const [text, setText] = useState(formatAmount(item.amount));
  useEffect(() => setText(formatAmount(item.amount)), [item.amount]);
  const unit = item.unit === 'piece' ? '×' : item.unit === 'ml' ? 'mL' : 'g';
  const ox = item.oxalate && item.oxalate.level !== 'low' && (lowOx || item.oxalate.level === 'high' || item.oxalate.level === 'very-high') ? item.oxalate : null;
  const stockBadge = !pantry || item.stock === 'have' ? null : item.stock === 'short' ? <span class="badge warn">not enough</span> : item.stock === 'missing' ? <span class="badge">to buy</span> : null;
  return (
    <li class="idea-item">
      {editing ? (
        <span class="idea-edit">
          <input class="input input-num" inputMode="decimal" aria-label={`${item.label} amount (${unit})`} value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onChange={(e) => { const v = parseAmount(e.currentTarget.value); if (v !== null && v > 0) onAmount(v); else setText(formatAmount(item.amount)); }} />
          <span class="subtle small">{unit}</span>
          {choices.length > 1 ? (
            <select class="select" aria-label={`Swap ${item.label}`} value={item.food.id} onChange={(e) => onSwap(e.currentTarget.value)}>
              {choices.map((c) => <option key={c.food.id} value={c.food.id}>{c.option.label}</option>)}
            </select>
          ) : <span class="idea-name">{item.label}</span>}
          {optional ? <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label={`Leave out ${item.label}`} onClick={onRemove}><Trash size={15} /></button> : null}
        </span>
      ) : (
        <span class="idea-line">
          <b class="num">{item.unit === 'piece' ? `${formatAmount(item.amount)} ×` : `${formatAmount(item.amount)} ${unit}`}</b>{' '}
          <span>{item.label}</span>
          {item.food.pair && (item.food.prep === 'dry' || item.food.prep === 'raw') && item.unit === 'g' ? <span class="subtle"> ({item.food.prep === 'dry' ? 'dry weight' : 'raw weight'}{item.cookedG ? ` · ≈ ${item.cookedG} g cooked` : ''})</span> : null}
          {item.household ? <span class="subtle"> · {item.household}</span> : null}
        </span>
      )}
      <span class="cluster idea-badges">
        {stockBadge}
        {ox ? <span class={`badge ${ox.level === 'moderate' ? '' : 'warn'}`} title={`${ox.mg !== null ? `≈ ${formatAmount(Math.round(ox.mg * 10) / 10)} mg. ` : ''}${OXALATE_SOURCES[ox.info.src].title}${ox.info.conflict ? `. ${ox.info.conflict}` : ''}`}>{OXALATE_LABEL[ox.level]}</span> : null}
        {item.food.src.type !== 'usda-fdc' ? <span class="badge" title={displayName(item.food)}>your food</span> : null}
      </span>
    </li>
  );
}

const EQUIPMENT: Equipment[] = ['hob', 'oven', 'microwave', 'airfryer', 'blender'];

function TastePanel({ taste, onDone }: { taste: TastePrefs; onDone: () => void }) {
  const [t, setT] = useState<TastePrefs>(taste);
  const [word, setWord] = useState('');
  const set = (patch: Partial<TastePrefs>) => setT((x) => ({ ...x, ...patch }));
  const addAvoid = () => { const w = word.trim(); if (w && !t.avoid.includes(w)) set({ avoid: [...t.avoid, w] }); setWord(''); };
  const save = () => { void updateProfile({ taste: { ...t, confirmed: true } }); onDone(); };
  return (
    <section class="card stack taste" aria-labelledby="taste-t">
      <div class="spread">
        <h3 id="taste-t" class="section-title">Your taste</h3>
        {taste.confirmed ? <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label="Close your taste" onClick={onDone}><X size={18} /></button> : null}
      </div>
      {!taste.confirmed ? <p class="small muted">Meal ideas follow these. Check the starting points once — you can change them any time.</p> : null}
      <div class="stack-s">
        <span class="label" id="avoid-l">Never suggest</span>
        <div class="chips" aria-labelledby="avoid-l">
          {t.avoid.map((a) => <button key={a} type="button" class="chip" aria-label={`Stop avoiding ${a}`} onClick={() => set({ avoid: t.avoid.filter((x) => x !== a) })}>{a} <X size={13} aria-hidden="true" /></button>)}
          {!t.avoid.length ? <span class="small subtle">Nothing yet.</span> : null}
        </div>
        <div class="cluster">
          <input class="input" style={{ flex: 1, minWidth: '160px' }} aria-label="A food to avoid" placeholder="e.g. mushrooms, μανιτάρια" value={word}
            onInput={(e) => setWord(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAvoid(); } }} />
          <button type="button" class="btn btn-s" disabled={!word.trim()} onClick={addAvoid}>Add</button>
        </div>
      </div>
      <Checkbox label="Sweet breakfasts first (protein pancakes, cream of rice, oats, cheesecake bowls)" checked={t.sweetBreakfast} onChange={(v) => set({ sweetBreakfast: v })} />
      <Checkbox label="High protein" checked={t.highProtein} onChange={(v) => set({ highProtein: v })} />
      <div class="stack-s">
        <span class="label" id="eq-l">Your kitchen</span>
        <div class="chips" role="group" aria-labelledby="eq-l">
          {EQUIPMENT.map((e) => <button key={e} type="button" class="chip" aria-pressed={t.equipment.includes(e)} onClick={() => set({ equipment: t.equipment.includes(e) ? t.equipment.filter((x) => x !== e) : [...t.equipment, e] })}>{EQUIPMENT_LABEL[e]}</button>)}
        </div>
      </div>
      <Segmented label="Fat per meal" value={t.fat} onChange={(v) => set({ fat: v })}
        options={[{ value: 'low', label: 'Low · ~20%' }, { value: 'moderate', label: 'Moderate · ~30%' }, { value: 'flexible', label: 'Flexible · ~40%' }]} />
      <NumberField label="Saturated fat limit" suffix="% of the meal's calories" value={t.satFatPct} onChange={(v) => set({ satFatPct: v ?? 10 })} min={3} max={20} hint="10% is the common guideline." />
      <Checkbox label="Prefer lower-oxalate foods" checked={t.lowOxalate} onChange={(v) => set({ lowOxalate: v })}
        hint="Uses cited values only (mainly Harvard's 2023 table): leaves out very high foods like spinach and sweet potato, keeps high ones small. Sources disagree for some foods (potatoes, berries, bananas); foods without data are not assumed low." />
      <div class="cluster"><button type="button" class="btn btn-primary" onClick={save}><Check size={16} aria-hidden="true" /> {taste.confirmed ? 'Save' : 'Looks right'}</button></div>
    </section>
  );
}
