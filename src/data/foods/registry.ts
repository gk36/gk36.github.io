import type { Food } from '../../domain/nutrition/food';
import { db } from '../db';
import { nowIso, uuidv7 } from '../ids';
import { foodSchema } from '../schemas';

/**
 * Core foods (USDA-sourced, read-only, built by scripts/foods) load lazily as their own
 * cached chunk; custom/label foods live in IndexedDB. Ids: "core:<key>", "custom:<uuid>".
 */
let corePromise: Promise<Food[]> | null = null;
let coreById: Map<string, Food> | null = null;

export function coreFoods(): Promise<Food[]> {
  corePromise ??= import('./core.json').then((m) => {
    const list = (m as unknown as { default: Food[] }).default;
    coreById = new Map(list.map((f) => [f.id, f]));
    return list;
  });
  return corePromise;
}

export async function getFood(id: string): Promise<Food | undefined> {
  if (id.startsWith('core:')) {
    await coreFoods();
    return coreById?.get(id);
  }
  const f = await db().foods.get(id);
  return f && !f.deletedAt ? f : undefined;
}

export async function customFoods(): Promise<Food[]> {
  return (await db().foods.toArray()).filter((f) => !f.deletedAt).sort((a, b) => a.names.en.localeCompare(b.names.en));
}

export async function allFoods(): Promise<Food[]> {
  const [core, custom] = await Promise.all([coreFoods(), customFoods()]);
  return [...custom, ...core];
}

/** Validates and saves a custom/label food (new id when absent). */
export async function saveCustomFood(input: Food): Promise<Food> {
  const t = nowIso();
  const existing = input.id ? await db().foods.get(input.id) : undefined;
  const food: Food = {
    ...input,
    id: input.id && !input.id.startsWith('core:') ? input.id : `custom:${uuidv7()}`,
    kind: input.kind === 'generic' ? 'custom' : input.kind,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
    rev: (existing?.rev ?? 0) + 1,
    deletedAt: null,
  };
  const r = foodSchema.safeParse(food);
  if (!r.success) throw new Error(`Food is invalid: ${r.error.issues[0]?.message ?? 'unknown error'}`);
  await db().foods.put(food);
  return food;
}

export async function deleteCustomFood(id: string): Promise<void> {
  const f = await db().foods.get(id);
  if (!f) return;
  await db().foods.put({ ...f, deletedAt: nowIso(), updatedAt: nowIso(), rev: (f.rev ?? 0) + 1 });
}

export async function restoreCustomFood(id: string): Promise<void> {
  const f = await db().foods.get(id);
  if (!f) return;
  await db().foods.put({ ...f, deletedAt: null, updatedAt: nowIso(), rev: (f.rev ?? 0) + 1 });
}
