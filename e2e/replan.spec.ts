import { expect, test, type Page } from '@playwright/test';
import { dialog, eatenKcal, logFood, main, onboardFresh, watchErrors } from './helpers';

interface Row { id: string; foodId: string; status: string; unit: string; amount: number; deleted: boolean }

/** Reads the diary straight from IndexedDB, to check what the screens claim. */
async function entries(page: Page): Promise<Row[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('carbmaxx'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise<Record<string, unknown>[]>((res) => { const r = db.transaction('entries').objectStore('entries').getAll(); r.onsuccess = () => res(r.result as Record<string, unknown>[]); });
    db.close();
    return all.map((e) => {
      const q = e.qty as { unit: string; amount: number };
      return { id: e.id as string, foodId: e.foodId as string, status: e.status as string, unit: q.unit, amount: q.amount, deleted: !!e.deletedAt };
    });
  });
}

async function addToPantry(page: Page, query: string, pick: RegExp, grams: string) {
  await main(page).getByRole('button', { name: 'Add food' }).click();
  const d = dialog(page);
  await d.getByRole('searchbox', { name: 'What do you have?' }).fill(query);
  await d.getByRole('list', { name: 'Matching foods' }).getByRole('button', { name: pick }).first().click();
  await d.getByRole('textbox', { name: /^Amount/ }).fill(grams);
  await d.getByRole('button', { name: 'Add to pantry' }).click();
  await expect(d).toBeHidden();
}

const num = (s: string) => Number(s.replace(/[^\d]/g, ''));

test('acceptance C: plan → eat differently → unplanned juice → pantry-only replan reconciles exactly; undo restores', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);

  // What is actually at home.
  await page.goto('./#/pantry');
  await addToPantry(page, 'chicken breast raw', /^Chicken breast, skinless \(raw\)/i, '420');
  await addToPantry(page, 'potato boiled', /Potato.*boiled/i, '336');
  await expect(main(page)).toContainText('420 g');

  // Three planned meals from the planner; breakfast's first item eaten; an unplanned 255 mL juice.
  await page.goto('./#/plan');
  await main(page).getByRole('button', { name: /Add to today as planned/ }).click();
  await page.goto('./#/today');
  await main(page).getByRole('button', { name: /^Mark .+ eaten$/ }).first().click();
  await logFood(page, 'orange juice', /Orange juice/i, '255', { unit: 'mL' });
  const eaten = await eatenKcal(page);
  const before = (await entries(page)).filter((e) => !e.deleted);
  const plannedBefore = before.filter((e) => e.status === 'planned');
  expect(plannedBefore.length).toBeGreaterThan(3);

  await main(page).getByRole('button', { name: 'Replan rest of day' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Replan the rest of today' })).toBeVisible();
  // "Only use food in my pantry" brings in everything at home and leaves out what isn't.
  await d.getByRole('checkbox', { name: 'Only use food in my pantry' }).check();
  await expect(d.getByRole('list').filter({ hasText: 'Chicken breast' })).toContainText('new');
  await expect(d.getByRole('list').filter({ hasText: 'Potato, peeled (boiled)' })).toContainText('new');
  await expect(d).toContainText('not in your pantry');
  const calories = await d.getByRole('list', { name: "Today's targets with this replan" }).getByRole('listitem').first().innerText();
  const newPlanKcal = num(/new plan ([\d,]+) kcal/.exec(calories)![1]!);
  await d.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(/^Replanned: \d+ changes?$/)).toBeVisible();

  // Eaten food untouched; only pantry foods remain planned, within stock; nothing negative.
  const after = (await entries(page)).filter((e) => !e.deleted);
  expect(after.filter((e) => e.status === 'eaten').map((e) => [e.id, e.amount])).toEqual(before.filter((e) => e.status === 'eaten').map((e) => [e.id, e.amount]));
  expect(await eatenKcal(page)).toBe(eaten);
  const planned = after.filter((e) => e.status === 'planned');
  expect(planned.every((e) => e.amount > 0)).toBe(true);
  expect(new Set(planned.map((e) => e.foodId))).toEqual(new Set(['core:chicken-breast-raw', 'core:potato-boiled']));
  const grams = (id: string) => planned.filter((e) => e.foodId === id).reduce((s, e) => s + e.amount, 0);
  expect(grams('core:chicken-breast-raw')).toBeLessThanOrEqual(420);
  expect(grams('core:potato-boiled')).toBeLessThanOrEqual(336);
  // The sheet's promise is what the diary now projects.
  await expect(main(page)).toContainText(`Planned, not eaten yet: +${newPlanKcal.toLocaleString('en-GB')} kcal`);

  // Undo puts the previous plan back exactly.
  await page.getByRole('status').locator('.toast', { hasText: 'Replanned' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Previous plan restored')).toBeVisible();
  const restored = (await entries(page)).filter((e) => !e.deleted && e.status === 'planned');
  expect(restored.map((e) => [e.id, e.amount]).sort()).toEqual(plannedBefore.map((e) => [e.id, e.amount]).sort());
  expect(errors()).toEqual([]);
});

test('eating takes food out of the pantry; undo puts it back; the shopping list moves bought food in', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.goto('./#/pantry');
  await addToPantry(page, 'greek yogurt 0%', /Greek yogurt, plain 0%/i, '500');
  await page.goto('./#/today');
  await logFood(page, 'greek yogurt 0%', /Greek yogurt, plain 0%/i, '176', { unit: 'g' });
  await expect(page.getByText(/taken from the pantry/)).toBeVisible();
  await page.goto('./#/pantry');
  await expect(main(page)).toContainText('324 g');
  await page.goto('./#/today');
  await page.keyboard.press('Control+z');
  await page.goto('./#/pantry');
  await expect(main(page)).toContainText('500 g');

  await page.goto('./#/pantry/shopping');
  await main(page).getByRole('textbox', { name: 'Add an item' }).fill('Kitchen roll');
  await main(page).getByRole('button', { name: 'Add', exact: true }).click();
  await main(page).getByText('Or add a food from the database').click();
  await main(page).getByRole('searchbox', { name: 'Food to buy' }).fill('oats');
  await main(page).getByRole('list', { name: 'Matching foods' }).getByRole('button', { name: /Oats/i }).first().click();
  await main(page).getByRole('checkbox', { name: /Kitchen roll/ }).check();
  await main(page).getByRole('checkbox', { name: /Oats/ }).check();
  await main(page).getByRole('button', { name: /Bought/ }).click();
  await expect(page.getByText(/Ticked items cleared|added to the pantry/)).toBeVisible();
  await expect(main(page)).toContainText('The shopping list is empty');
  expect(errors()).toEqual([]);
});
