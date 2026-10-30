import { useState } from 'preact/hooks';
import { useLive } from '../ui/hooks';
import { Checkbox, Segmented } from '../ui/controls';
import { FoodPicker } from '../ui/FoodPicker';
import { ChefHat, Plus, Refrigerator, ScanBarcode, ShoppingCart, Trash } from '../ui/icons';
import type { PantryItem, ShoppingItem } from '../data/db';
import { batchUsage, listBatches, type BatchUsage } from '../data/kitchen';
import {
  addShopping, listPantry, listShopping, moveCheckedToPantry, removeShopping, restoreShopping, setShoppingChecked,
} from '../data/pantry';
import { daysUntil } from '../data/replan';
import { displayName, PREP_LABEL, type Food } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { formatDayLabel } from '../domain/time';
import { href, navigate } from '../app/router';
import { openSheet, profile, toast, todayKey, updateProfile } from '../app/store';

export const GROUP_LABEL: Record<Food['group'], string> = {
  protein: 'Meat, fish & eggs', dairy: 'Dairy', starch: 'Grains, potatoes & bread', fruit: 'Fruit', veg: 'Vegetables',
  fat: 'Oils, nuts & fats', sweet: 'Sweet things', drink: 'Drinks', other: 'Other',
};
const GROUP_ORDER = Object.keys(GROUP_LABEL) as Food['group'][];

function byGroup<T>(rows: readonly T[], group: (r: T) => Food['group']): [Food['group'], T[]][] {
  return GROUP_ORDER.map((g) => [g, rows.filter((r) => group(r) === g)] as [Food['group'], T[]]).filter(([, r]) => r.length > 0);
}

export function Pantry({ tab }: { tab: 'stock' | 'shopping' }) {
  const items = useLive(() => listPantry(), [], [] as PantryItem[]);
  const shopping = useLive(() => listShopping(), [], [] as ShoppingItem[]);
  const open = shopping.filter((s) => !s.checked).length;
  return (
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Pantry</h1>
          <p class="small muted">What you have at home. The replanner uses it to suggest amounts you can actually make.</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn" onClick={() => openSheet({ kind: 'scan', dayKey: todayKey.value })}><ScanBarcode size={16} aria-hidden="true" /> Scan</button>
          <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'pantry-item' })}><Plus size={16} aria-hidden="true" /> Add food</button>
        </div>
      </div>
      <Segmented label="Show" hideLabel value={tab} onChange={(v) => (v === 'shopping' ? navigate('pantry', 'shopping') : navigate('pantry'))}
        options={[{ value: 'stock', label: `At home (${items.length})` }, { value: 'shopping', label: `Shopping list (${open})` }]} />
      {tab === 'stock' ? <Stock items={items} /> : <Shopping rows={shopping} />}
    </div>
  );
}

function Stock({ items }: { items: PantryItem[] }) {
  const p = profile.value!;
  const batches = useLive(() => listBatches(), [], [] as Food[]);
  const today = todayKey.value;
  return (
    <>
      <Checkbox label="Take food out of the pantry when I log it as eaten" checked={p.pantryDeduct !== false}
        onChange={(v) => updateProfile({ pantryDeduct: v })} hint="Planning never changes your stock — only eating or cooking does." />
      {batches.length ? (
        <section class="card stack-s" aria-labelledby="pa-batches">
          <h2 id="pa-batches" class="card-title"><ChefHat size={15} aria-hidden="true" /> Cooked batches</h2>
          <ul class="list">{batches.map((b) => <BatchLine key={b.id} batch={b} />)}</ul>
        </section>
      ) : null}
      {items.length === 0 ? (
        <div class="card empty">
          <Refrigerator size={28} aria-hidden="true" />
          <h3>Nothing in the pantry yet</h3>
          <p>Add what's in your fridge and cupboards — “cooked rice 250 g”, “yogurt tub, 176 g left”, “6 eggs”. Estimates are fine; mark them as such.</p>
        </div>
      ) : byGroup(items, (i) => i.food.group).map(([g, rows]) => (
        <section key={g} class="card stack-s" aria-labelledby={`pa-${g}`}>
          <h2 id={`pa-${g}`} class="card-title">{GROUP_LABEL[g]}</h2>
          <ul class="list">
            {rows.map((it) => {
              const d = daysUntil(today, it.expiresOn ?? null);
              const out = it.qty.amount <= 0;
              return (
                <li key={it.id}>
                  <div class="item" style={{ cursor: 'default' }}>
                    <button type="button" class="item-main linkish" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => openSheet({ kind: 'pantry-item', itemId: it.id })}
                      aria-label={`${displayName(it.food)}, ${out ? 'none left' : `${it.approx ? 'about ' : ''}${describeQuantity(it.food as Food, it.qty)}`}. Edit`}>
                      <span class="item-name">{displayName(it.food)}</span>
                      <span class="item-sub cluster">
                        {out ? <span class="badge warn">Out</span> : <span class="num">{it.approx ? '≈ ' : ''}{describeQuantity(it.food as Food, it.qty)}</span>}
                        {it.food.prep !== 'as-sold' ? <span>{PREP_LABEL[it.food.prep]}</span> : null}
                        {d !== null ? <span class={d <= 2 ? 'badge warn' : 'badge'}>{d < 0 ? 'expired' : d === 0 ? 'use today' : d === 1 ? 'use by tomorrow' : `use by ${formatDayLabel(it.expiresOn!)}`}</span> : null}
                      </span>
                    </button>
                    {out || (d !== null && d <= 2) ? (
                      <button type="button" class="btn btn-s" onClick={async () => { await addShopping({ name: displayName(it.food), food: it.food, group: it.food.group, source: 'pantry' }); toast(`${displayName(it.food)} is on the shopping list`, { tone: 'ok' }); }}>
                        <ShoppingCart size={14} aria-hidden="true" /> To list
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function BatchLine({ batch }: { batch: Food }) {
  const u = useLive(() => batchUsage(batch), [batch.id, batch.updatedAt], null as BatchUsage | null);
  return (
    <li>
      <a class="item" href={href('kitchen')}>
        <div class="item-main">
          <span class="item-name">{displayName(batch)}</span>
          <span class="item-sub num">{u ? `${Math.round(u.remainingG)} g left` : '…'} · cooked {formatDayLabel(batch.recipe!.cookedOn!)}</span>
        </div>
      </a>
    </li>
  );
}

function Shopping({ rows }: { rows: ShoppingItem[] }) {
  const [text, setText] = useState('');
  const ticked = rows.filter((r) => r.checked).length;
  const add = async () => {
    const name = text.trim();
    if (!name) return;
    await addShopping({ name });
    setText('');
  };
  return (
    <>
      <section class="card stack-s" aria-label="Add to the shopping list">
        <form class="cluster" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label for="sh-new" class="sr-only">Add an item</label>
          <input id="sh-new" class="input grow" style={{ flex: '1 1 200px' }} value={text} placeholder="Add an item (e.g. kitchen roll)" maxLength={200} onInput={(e) => setText(e.currentTarget.value)} />
          <button type="submit" class="btn" disabled={!text.trim()}>Add</button>
        </form>
        <details>
          <summary class="small">Or add a food from the database</summary>
          <FoodPicker label="Food to buy" onPick={async (f) => { await addShopping({ name: displayName(f), food: f, group: f.group }); toast(`${displayName(f)} added to the list`, { tone: 'ok' }); }} />
        </details>
      </section>
      {rows.length === 0 ? (
        <div class="card empty">
          <ShoppingCart size={28} aria-hidden="true" />
          <h3>The shopping list is empty</h3>
          <p>Add items here, or from a replan (“Add missing to the shopping list”) and from pantry items that run out.</p>
        </div>
      ) : byGroup(rows, (r) => r.group).map(([g, list]) => (
        <section key={g} class="card stack-s" aria-labelledby={`sh-${g}`}>
          <h2 id={`sh-${g}`} class="card-title">{GROUP_LABEL[g]}</h2>
          <ul class="list">
            {list.map((s) => (
              <li key={s.id} class="cluster" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <Checkbox checked={s.checked} onChange={(v) => void setShoppingChecked(s.id, v)}
                  label={<span style={s.checked ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>{s.name}{s.qty && s.food ? <span class="muted num"> · {describeQuantity(s.food as Food, s.qty)}</span> : null}</span>} />
                <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label={`Remove ${s.name}`} onClick={async () => { await removeShopping(s.id); toast(`Removed ${s.name}`, { action: { label: 'Undo', run: () => restoreShopping(s.id) } }); }}><Trash size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ticked ? (
        <div class="cluster">
          <button type="button" class="btn btn-primary" onClick={async () => {
            const r = await moveCheckedToPantry();
            toast(r.toPantry ? `${r.toPantry} item${r.toPantry > 1 ? 's' : ''} added to the pantry` : 'Ticked items cleared', { tone: 'ok' });
          }}>Bought — put ticked items in the pantry</button>
        </div>
      ) : null}
    </>
  );
}
