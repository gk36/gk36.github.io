import { db, live, type PantryItem, type ShoppingItem } from './db';
import { snapshotOf } from './entries';
import { nowIso, uuidv7 } from './ids';
import type { FoodSnapshot } from './types';
import { resolveQuantity } from '../domain/nutrition/quantity';
import type { Food, Quantity } from '../domain/nutrition/food';

/**
 * Pantry = lots of food at home. Stock changes only when the user says so: adding/editing a lot,
 * logging food as eaten, or cooking a batch. Planning never touches it.
 */

const bump = <T extends { rev: number; updatedAt: string }>(r: T, patch: Partial<NoInfer<T>>): T => ({ ...r, ...patch, rev: r.rev + 1, updatedAt: nowIso() });
const asFood = (f: FoodSnapshot): Food => f as Food;

export async function listPantry(): Promise<PantryItem[]> {
  return (await db().pantry.toArray()).filter(live).sort((a, b) => a.food.names.en.localeCompare(b.food.names.en));
}

export async function addPantryItem(input: { food: Food | FoodSnapshot; qty: Quantity; approx?: boolean; expiresOn?: string | null; openedOn?: string | null; note?: string }): Promise<PantryItem> {
  const t = nowIso();
  const item: PantryItem = {
    id: uuidv7(), foodId: input.food.id, food: snapshotOf(input.food), qty: { ...input.qty }, approx: !!input.approx,
    expiresOn: input.expiresOn ?? null, openedOn: input.openedOn ?? null, createdAt: t, updatedAt: t, deletedAt: null, rev: 1,
  };
  if (input.note) item.note = input.note;
  await db().pantry.put(item);
  return item;
}

export async function updatePantryItem(id: string, patch: Partial<Pick<PantryItem, 'qty' | 'approx' | 'expiresOn' | 'openedOn' | 'note'>>): Promise<PantryItem> {
  const it = await db().pantry.get(id);
  if (!live(it)) throw new Error('Pantry item not found');
  const next = bump(it, patch);
  await db().pantry.put(next);
  return next;
}

export async function removePantryItem(id: string): Promise<void> {
  const it = await db().pantry.get(id);
  if (live(it)) await db().pantry.put(bump(it, { deletedAt: nowIso() }));
}

export async function restorePantryItem(id: string): Promise<void> {
  const it = await db().pantry.get(id);
  if (it?.deletedAt) await db().pantry.put(bump(it, { deletedAt: null }));
}

/** Weight of a lot in grams, when its unit can be weighed. */
export function itemGrams(item: Pick<PantryItem, 'food' | 'qty'>): number | null {
  const r = resolveQuantity(asFood(item.food), item.qty);
  return r.ok ? r.grams : null;
}

export interface Stock { grams: number; items: PantryItem[]; expiresOn: string | null; approx: boolean }

/** Grams at home per food (lots that can't be weighed are listed but not counted). */
export async function stockByFood(): Promise<Map<string, Stock>> {
  const out = new Map<string, Stock>();
  for (const it of await listPantry()) {
    const g = itemGrams(it);
    const s = out.get(it.foodId) ?? { grams: 0, items: [], expiresOn: null, approx: false };
    s.items.push(it);
    if (g !== null) s.grams += g;
    if (it.expiresOn && (!s.expiresOn || it.expiresOn < s.expiresOn)) s.expiresOn = it.expiresOn;
    s.approx ||= it.approx;
    out.set(it.foodId, s);
  }
  return out;
}

export interface Deduction { itemId: string; before: Quantity }

const roundAmount = (q: Quantity, v: number): number => (q.unit === 'portion' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

/**
 * Takes an eaten/cooked amount out of the pantry: soonest-expiring lot first, across lots, never
 * below zero. Returns what changed so it can be undone exactly.
 */
export async function deductFromPantry(food: Food | FoodSnapshot, qty: Quantity): Promise<Deduction[]> {
  const items = (await db().pantry.where('foodId').equals(food.id).toArray()).filter(live)
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  if (!items.length) return [];
  const need = resolveQuantity(asFood(snapshotOf(food)), qty);
  let needG = need.ok ? need.grams : null;
  let needUnits = qty.amount;
  const out: Deduction[] = [];
  for (const it of items) {
    let next: number | null = null;
    if (needG !== null && needG > 1e-9) {
      const have = itemGrams(it);
      const per = resolveQuantity(asFood(it.food), { ...it.qty, amount: 1 });
      if (have === null || have <= 0 || !per.ok || !per.grams) continue;
      const take = Math.min(have, needG);
      needG -= take;
      next = (have - take) / per.grams;
    } else if (needG === null && needUnits > 1e-9 && it.qty.unit === qty.unit && (it.qty.unit !== 'portion' || (qty.unit === 'portion' && it.qty.portionId === qty.portionId))) {
      const take = Math.min(it.qty.amount, needUnits);
      needUnits -= take;
      next = it.qty.amount - take;
    } else continue;
    out.push({ itemId: it.id, before: it.qty });
    await db().pantry.put(bump(it, { qty: { ...it.qty, amount: Math.max(0, roundAmount(it.qty, next)) } }));
    if ((needG !== null && needG <= 1e-9) || (needG === null && needUnits <= 1e-9)) break;
  }
  return out;
}

export async function undoDeductions(ds: readonly Deduction[]): Promise<void> {
  for (const d of ds) {
    const it = await db().pantry.get(d.itemId);
    if (it) await db().pantry.put(bump(it, { qty: d.before, deletedAt: null }));
  }
}

/* ---------- shopping list ---------- */

export async function listShopping(): Promise<ShoppingItem[]> {
  return (await db().shopping.toArray()).filter(live).sort((a, b) => Number(a.checked) - Number(b.checked) || a.createdAt.localeCompare(b.createdAt));
}

/** Adds to the list; the same food already on the list (unchecked, same unit) gets its amount topped up instead. */
export async function addShopping(input: { name: string; food?: Food | FoodSnapshot; qty?: Quantity; group?: ShoppingItem['group']; source?: ShoppingItem['source']; note?: string }): Promise<ShoppingItem> {
  if (input.food) {
    const same = (await db().shopping.where('foodId').equals(input.food.id).toArray()).find((s) => live(s) && !s.checked);
    if (same) {
      const sameUnit = same.qty && input.qty && same.qty.unit === input.qty.unit && (same.qty.unit !== 'portion' || (input.qty.unit === 'portion' && same.qty.portionId === input.qty.portionId));
      const qty = sameUnit ? { ...same.qty!, amount: same.qty!.amount + input.qty!.amount } : (same.qty ?? input.qty);
      const next = bump(same, qty ? { qty } : {});
      await db().shopping.put(next);
      return next;
    }
  }
  const t = nowIso();
  const item: ShoppingItem = {
    id: uuidv7(), name: input.name.trim(), group: input.group ?? input.food?.group ?? 'other', checked: false,
    source: input.source ?? 'manual', createdAt: t, updatedAt: t, deletedAt: null, rev: 1,
  };
  if (input.food) { item.foodId = input.food.id; item.food = snapshotOf(input.food); }
  if (input.qty) item.qty = { ...input.qty };
  if (input.note) item.note = input.note;
  await db().shopping.put(item);
  return item;
}

export async function setShoppingChecked(id: string, checked: boolean): Promise<void> {
  const it = await db().shopping.get(id);
  if (live(it)) await db().shopping.put(bump(it, { checked }));
}

export async function removeShopping(id: string): Promise<void> {
  const it = await db().shopping.get(id);
  if (live(it)) await db().shopping.put(bump(it, { deletedAt: nowIso() }));
}

export async function restoreShopping(id: string): Promise<void> {
  const it = await db().shopping.get(id);
  if (it?.deletedAt) await db().shopping.put(bump(it, { deletedAt: null }));
}

/** Bought: ticked items with a food and an amount go into the pantry; every ticked item leaves the list. */
export async function moveCheckedToPantry(): Promise<{ toPantry: number; cleared: number }> {
  const checked = (await listShopping()).filter((s) => s.checked);
  let toPantry = 0;
  for (const s of checked) {
    if (s.food && s.qty) { await addPantryItem({ food: s.food, qty: s.qty }); toPantry += 1; }
    await removeShopping(s.id);
  }
  return { toPantry, cleared: checked.length };
}
