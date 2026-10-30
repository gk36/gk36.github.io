import { beforeEach, describe, expect, it } from 'vitest';
import { CarbmaxxDB, db, useDatabase } from '../src/data/db';
import { uuidv7 } from '../src/data/ids';
import { addEntry, getEntry, listDay, markEaten } from '../src/data/entries';
import { defaultProfile, loadProfile, saveProfile } from '../src/data/profile';
import {
  addPantryItem, addShopping, deductFromPantry, listPantry, listShopping, moveCheckedToPantry, setShoppingChecked, stockByFood, undoDeductions,
} from '../src/data/pantry';
import { applyReplan, buildReplanInput, listDayEvents, loadReplanSetup, revertReplan } from '../src/data/replan';
import { exportAll, importBackup, parseBackup } from '../src/data/backup';
import { replan } from '../src/domain/planning/replan';
import { dayTotals } from '../src/domain/diary';
import type { Food } from '../src/domain/nutrition/food';

const food = (id: string, group: Food['group'], n: Food['n'], over: Partial<Food> = {}): Food => ({
  id, names: { en: id }, kind: 'generic', group, prep: 'roasted', basis: { per: '100g' }, portions: [], n,
  carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high' }, ...over,
});
const chicken = food('chicken breast (roasted)', 'protein', { kcal: 165, protein: 31, carbs: 0, fat: 3.6 });
const potato = food('potato (boiled)', 'starch', { kcal: 86, protein: 1.7, carbs: 20, fat: 0.1 }, { prep: 'boiled' });
const rice = food('rice (cooked)', 'starch', { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, { prep: 'boiled' });
const egg = food('egg', 'protein', { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }, { prep: 'raw', portions: [{ id: 'large', label: '1 large', g: 50 }] });
const juice = food('orange juice', 'drink', { kcal: 45, protein: 0.7, carbs: 10.4, fat: 0.2 }, { prep: 'as-sold', basis: { per: '100ml' }, densityGPerMl: 1.04 });
const DAY = '2026-10-30';

beforeEach(async () => {
  useDatabase(new CarbmaxxDB(`test-${uuidv7()}`));
  await saveProfile({
    ...defaultProfile(), sex: 'male', weightKg: 73, heightCm: 174, ageYears: 18, onboarded: true,
    targetMode: 'manual', manualTargets: { kcal: 2400, protein: 160, carbs: 280, fat: 70 },
  });
});

describe('pantry', () => {
  it('takes eaten food from the soonest-expiring lot first, across lots, never below zero; undo is exact', async () => {
    const late = await addPantryItem({ food: chicken, qty: { amount: 400, unit: 'g' }, expiresOn: '2026-11-05' });
    const soon = await addPantryItem({ food: chicken, qty: { amount: 100, unit: 'g' }, expiresOn: '2026-10-31' });
    const ded = await deductFromPantry(chicken, { amount: 150, unit: 'g' });
    expect(ded.map((d) => d.itemId)).toEqual([soon.id, late.id]);
    const after = new Map((await listPantry()).map((i) => [i.id, i.qty.amount]));
    expect(after.get(soon.id)).toBe(0);
    expect(after.get(late.id)).toBe(350);
    await deductFromPantry(chicken, { amount: 1000, unit: 'g' });
    expect((await listPantry()).every((i) => i.qty.amount >= 0)).toBe(true);
    expect((await stockByFood()).get(chicken.id)!.grams).toBe(0);
    await undoDeductions(ded);
    // Undo restores the amounts before THAT deduction.
    const back = new Map((await listPantry()).map((i) => [i.id, i.qty.amount]));
    expect(back.get(soon.id)).toBe(100);
    expect(back.get(late.id)).toBe(400);
  });

  it('counts pieces by weight: 2 eggs eaten from a lot of 6', async () => {
    const lot = await addPantryItem({ food: egg, qty: { amount: 6, unit: 'portion', portionId: 'large' } });
    await deductFromPantry(egg, { amount: 100, unit: 'g' });
    expect((await listPantry()).find((i) => i.id === lot.id)!.qty).toEqual({ amount: 4, unit: 'portion', portionId: 'large' });
  });

  it('does not touch stock for a different food (raw chicken is not roasted chicken)', async () => {
    const raw = { ...chicken, id: 'chicken breast (raw)', prep: 'raw' as const };
    await addPantryItem({ food: raw, qty: { amount: 420, unit: 'g' } });
    expect(await deductFromPantry(chicken, { amount: 150, unit: 'g' })).toEqual([]);
    expect((await listPantry())[0]!.qty.amount).toBe(420);
  });

  it('shopping list merges the same food and moves bought items into the pantry', async () => {
    await addShopping({ name: 'Rice', food: rice, qty: { amount: 500, unit: 'g' } });
    await addShopping({ name: 'Rice', food: rice, qty: { amount: 250, unit: 'g' } });
    await addShopping({ name: 'Kitchen roll' });
    const list = await listShopping();
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.foodId === rice.id)!.qty!.amount).toBe(750);
    for (const s of list) await setShoppingChecked(s.id, true);
    expect(await moveCheckedToPantry()).toEqual({ toPantry: 1, cleared: 2 });
    expect(await listShopping()).toEqual([]);
    expect((await stockByFood()).get(rice.id)!.grams).toBe(750);
  });

  it('pantry, shopping list and replan history are in backups', async () => {
    await addPantryItem({ food: potato, qty: { amount: 336, unit: 'g' }, approx: true });
    await addShopping({ name: 'Eggs', food: egg, qty: { amount: 6, unit: 'portion', portionId: 'large' } });
    const parsed = parseBackup(JSON.stringify(await exportAll()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.counts.pantry).toBe(1);
    expect(parsed.counts.shopping).toBe(1);
    useDatabase(new CarbmaxxDB(`test-${uuidv7()}`));
    await importBackup(parsed.file, 'replace');
    expect((await listPantry())[0]).toMatchObject({ approx: true, qty: { amount: 336, unit: 'g' } });
  });
});

describe('replan the rest of the day (acceptance C at the data level)', () => {
  async function plannedDay() {
    const b1 = await addEntry({ dayKey: DAY, slotId: 'breakfast', food: egg, qty: { amount: 3, unit: 'portion', portionId: 'large' }, status: 'planned', origin: 'plan' });
    const b2 = await addEntry({ dayKey: DAY, slotId: 'breakfast', food: rice, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    const l1 = await addEntry({ dayKey: DAY, slotId: 'lunch', food: chicken, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    const l2 = await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 300, unit: 'g' }, status: 'planned', origin: 'plan' });
    const d1 = await addEntry({ dayKey: DAY, slotId: 'dinner', food: chicken, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    const d2 = await addEntry({ dayKey: DAY, slotId: 'dinner', food: rice, qty: { amount: 300, unit: 'g' }, status: 'planned', origin: 'plan' });
    return { b1, b2, l1, l2, d1, d2 };
  }

  it('eaten food is untouched, stock is respected, the diary reconciles, and revert restores the plan exactly', async () => {
    const p = (await loadProfile())!;
    const { b1, b2, d1, d2 } = await plannedDay();
    // Breakfast went differently: 4 eggs and only 120 g rice; then an unplanned 255 mL juice.
    await markEaten(b1.id, { qty: { amount: 4, unit: 'portion', portionId: 'large' } });
    await markEaten(b2.id, { qty: { amount: 120, unit: 'g' } });
    await addEntry({ dayKey: DAY, slotId: 'snacks', food: juice, qty: { amount: 255, unit: 'ml' }, status: 'eaten', origin: 'quick' });
    // Only 250 g chicken and 336 g potatoes at home; no rice left.
    await addPantryItem({ food: chicken, qty: { amount: 250, unit: 'g' } });
    await addPantryItem({ food: potato, qty: { amount: 336, unit: 'g' } });
    const eatenBefore = (await listDay(DAY)).filter((e) => e.status === 'eaten').map((e) => JSON.stringify([e.id, e.qty, e.rev]));

    const setup = await loadReplanSetup(p, DAY);
    expect(setup.planned).toHaveLength(4);
    expect(setup.offers.map((o) => o.food.id)).toEqual([potato.id]);
    const added = [{ key: 'add:potato', food: potato, slotId: 'dinner', unit: 'g' as const }];
    const input = buildReplanInput(setup, { mode: 'closest', choices: {}, added, pantryOnly: true, maxMealKcal: null, today: DAY });
    const result = replan(input);
    expect(result.feasible).toBe(true);
    const ev = await applyReplan(setup, result, added, 'closest', 'Closest to plan');
    expect(ev).not.toBeNull();

    const after = await listDay(DAY);
    expect(after.filter((e) => e.status === 'eaten').map((e) => JSON.stringify([e.id, e.qty, e.rev]))).toEqual(eatenBefore);
    expect(after.every((e) => e.qty.amount >= 0)).toBe(true);
    const plannedG = (id: string) => after.filter((e) => e.status === 'planned' && e.foodId === id).reduce((s, e) => s + e.qty.amount, 0);
    expect(plannedG(chicken.id)).toBeLessThanOrEqual(250);
    expect(plannedG(potato.id)).toBeLessThanOrEqual(336);
    expect(plannedG(rice.id)).toBe(0); // not in the pantry → dropped, with a reason
    expect(result.items.find((i) => i.key === d2.id)!.reason).toBe('not in your pantry');
    // What the solver reported is exactly what the diary now projects.
    const t = dayTotals(after);
    expect(t.planned.kcal.value).toBeCloseTo(result.totals.kcal, 6);
    expect(t.projected.kcal.value).toBeCloseTo(setup.eaten.kcal + result.totals.kcal, 6);
    // Every change is recorded…
    expect(ev!.changes.length).toBe(result.items.filter((i) => i.to !== i.from).length);
    expect((await listDayEvents(DAY))[0]!.id).toBe(ev!.id);

    // …and reverting restores the previous plan exactly.
    const r = await revertReplan(ev!.id);
    expect(r.skipped).toBe(0);
    const reverted = await listDay(DAY);
    expect(reverted.filter((e) => e.status === 'planned').map((e) => [e.id, e.qty.amount]).sort())
      .toEqual(setup.planned.map((e) => [e.id, e.qty.amount]).sort());
    expect((await getEntry(d1.id))!.qty.amount).toBe(200);
  });

  it('a replan never changes food eaten after it was proposed, and revert leaves later edits alone', async () => {
    const p = (await loadProfile())!;
    const { l1 } = await plannedDay();
    const setup = await loadReplanSetup(p, DAY);
    const input = buildReplanInput(setup, { mode: 'closest', choices: {}, added: [], pantryOnly: false, maxMealKcal: null, today: DAY });
    input.remaining = { kcal: 900, protein: 80, carbs: 90, fat: 20 };
    const result = replan(input);
    expect(result.items.find((i) => i.key === l1.id)!.to).not.toBe(200);
    await markEaten(l1.id); // eaten while the sheet was open
    const ev = await applyReplan(setup, result, [], 'closest', 'Closest to plan');
    expect((await getEntry(l1.id))!.qty.amount).toBe(200);
    expect(ev!.changes.some((c) => c.entryId === l1.id)).toBe(false);
    // Something the replan changed is eaten before the revert: it keeps what was eaten.
    const upd = ev!.changes.find((c) => c.kind === 'updated')!;
    await markEaten(upd.entryId);
    const r = await revertReplan(ev!.id);
    expect(r.skipped).toBe(1);
    expect((await getEntry(upd.entryId))!).toMatchObject({ status: 'eaten', qty: upd.to });
    expect((await db().events.get(ev!.id))!.revertedAt).toBeTruthy();
  });

  it('a cooked batch counts once: today\'s planned portions are re-decided against what is left', async () => {
    const p = (await loadProfile())!;
    const batch: Food = {
      ...food('beef & potato batch', 'other', { kcal: 150, protein: 14, carbs: 12, fat: 5 }, { prep: 'prepared' }),
      recipe: { components: [{ food: chicken, qty: { amount: 500, unit: 'g' } }], totalG: 860, servings: 4, cookedOn: '2026-10-29' },
    };
    await db().foods.put({ ...batch, createdAt: '2026-10-29T10:00:00Z', updatedAt: '2026-10-29T10:00:00Z', rev: 1, deletedAt: null });
    await addEntry({ dayKey: '2026-10-29', slotId: 'dinner', food: batch, qty: { amount: 690, unit: 'g' }, status: 'eaten', origin: 'recipe' });
    const planned = await addEntry({ dayKey: DAY, slotId: 'dinner', food: batch, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'recipe' });
    const setup = await loadReplanSetup(p, DAY);
    expect(setup.stock.get(batch.id)).toMatchObject({ grams: 170, source: 'batch' });
    const input = buildReplanInput(setup, { mode: 'closest', choices: {}, added: [], pantryOnly: false, maxMealKcal: null, today: DAY });
    const res = replan(input);
    expect(res.items.find((i) => i.key === planned.id)!.to).toBeLessThanOrEqual(170);
  });
});
