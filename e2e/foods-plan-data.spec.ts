import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dialog, eatenKcal, logFood, main, onboardFresh, watchErrors } from './helpers';

test('custom food from a Greek label: per-100 g, salt → sodium, unknown micronutrients stay unknown', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.goto('./#/foods');
  await main(page).getByRole('button', { name: 'New food from label' }).click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: 'Name', exact: true }).fill('Greek yogurt 2%');
  const box = (name: string) => d.getByRole('textbox', { name, exact: true });
  await box('Brand').fill('TestBrand');
  await box('Energy (kcal)').fill('72');
  await box('Fat (g)').fill('2');
  await box('of which saturates (g)').fill('1,3');
  await box('Carbohydrate (g)').fill('3,8');
  await box('of which sugars (g)').fill('3,8');
  await box('Protein (g)').fill('9,5');
  await box('Salt (g)').fill('0,1');
  // 0.1 g salt ÷ 2.5 = 40 mg sodium, shown in the "saved as" preview
  await expect(d.getByRole('row', { name: /Sodium/ })).toContainText('40 mg');
  await d.getByRole('button', { name: 'Save food' }).click();
  await expect(d).toBeHidden();

  await page.goto('./#/today');
  await logFood(page, 'testbrand yogurt', /Greek yogurt 2%/, '176', { unit: 'g' });
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(1.76 * 72));
  await main(page).getByRole('button', { name: /Greek yogurt.*Edit/ }).click();
  await dialog(page).getByRole('button', { name: 'Food details' }).click();
  await dialog(page).getByText(/Vitamins & minerals/).click();
  await expect(dialog(page).getByRole('row', { name: /Calcium/ })).toContainText('unknown');
  expect(errors()).toEqual([]);
});

test('Plan today writes planned entries that match the plan totals', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.goto('./#/plan');
  const planned = Number((await main(page).locator('.hero-num').innerText()).replace(/\D/g, ''));
  expect(planned).toBe(2685);
  await main(page).getByRole('button', { name: /Add to today as planned/ }).click();
  await page.goto('./#/today');
  await expect.poll(() => eatenKcal(page)).toBe(0);
  await expect(main(page)).toContainText(/\+2,6\d\d planned → the day lands near/);
  expect(errors()).toEqual([]);
});

test('backup: export, wipe, import restores the same diary', async ({ page, browserName }, testInfo) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await logFood(page, 'banana', /Banana/, '2');
  const before = await eatenKcal(page);
  expect(before).toBeGreaterThan(0);

  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), main(page).getByRole('button', { name: 'Export backup' }).click()]);
  const file = testInfo.outputPath(`backup-${browserName}.json`);
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { app: string; data: { entries: unknown[] } };
  expect(json.app).toBe('carbmaxx');
  expect(json.data.entries).toHaveLength(1);

  await page.evaluate(async () => {
    await new Promise<void>((res, rej) => { const r = indexedDB.deleteDatabase('carbmaxx'); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
  });
  await page.reload();
  await onboardFresh(page);
  await expect.poll(() => eatenKcal(page)).toBe(0);

  await page.goto('./#/settings');
  await main(page).locator('input[type=file]').setInputFiles(file);
  await expect(main(page)).toContainText('1 diary entries');
  await main(page).getByRole('button', { name: 'Replace everything' }).click();
  await expect(page.getByRole('status')).toContainText('Backup restored');
  await page.goto('./#/today');
  await expect.poll(() => eatenKcal(page)).toBe(before);
  expect(errors()).toEqual([]);
});

test('v1 planner profile on this device imports read-only', async ({ page }) => {
  const errors = watchErrors(page);
  const v1 = { tester: { kg: 80, cm: 180, age: 25, sex: 'male', act: 'active', goal: 'bulk', cutStyle: 'gentle', day: 'gym', timing: 'early', eggs: 5, pick: {}, milkMl: 300, updatedAt: 1 } };
  await page.addInitScript((data) => { localStorage.setItem('carbmaxx_profiles_v1', data); }, JSON.stringify(v1));
  await page.goto('./');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'tester' }).click();
  await expect(page.getByLabel('Weight')).toHaveValue('80');
  await page.getByRole('button', { name: 'Done' }).click();
  // BMR = 800 + 1125 − 125 + 5 = 1805; × 1.725 = 3113.6; bulk +20% = 3736
  await expect(main(page)).toContainText('of 3,736 kcal');
  expect(await page.evaluate(() => localStorage.getItem('carbmaxx_profiles_v1'))).toBe(JSON.stringify(v1));
  expect(errors()).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility (${scheme}): no serious or critical axe violations on the main screens and sheets`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onboardFresh(page);
    await logFood(page, 'rice cooked', /White rice.*cooked/i, '200', { unit: 'g' });
    await logFood(page, 'whey', /Whey protein powder/, '30', { unit: 'g' }); // oxalate: listed as not counted
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${label}: ${v.id} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    };
    await scan('today');
    await page.goto('./#/diary'); await scan('diary');
    await page.goto('./#/plan'); await scan('plan');
    await page.goto('./#/foods'); await scan('foods');
    await page.goto('./#/settings'); await scan('settings');
    await page.goto('./#/nutrients');
    await main(page).getByRole('region', { name: 'Oxalate' }).getByText(/^Not counted/).click();
    await scan('nutrients + oxalate');
    await page.goto('./#/kitchen'); await scan('kitchen');
    await main(page).getByRole('region', { name: 'Recipes' }).getByRole('button', { name: /^Protein cream of rice/ }).click();
    await scan('recipe editor');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await page.goto('./#/train'); await scan('train');
    await page.goto('./#/pantry'); await scan('pantry');
    await page.goto('./#/pantry/shopping'); await scan('shopping list');
    await page.goto('./#/today');
    await main(page).getByRole('button', { name: 'Replan rest of day' }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Replan the rest of today' })).toBeVisible();
    await scan('replan');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await main(page).getByRole('button', { name: /What should I eat\?/ }).click();
    await dialog(page).getByRole('region', { name: 'Your taste' }).getByRole('button', { name: 'Looks right' }).click();
    await expect(dialog(page).getByRole('button', { name: /^Log it/ }).first()).toBeVisible();
    await scan('meal ideas');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await main(page).getByRole('textbox', { name: 'What did you eat?' }).fill('2 eggs, some pasta and 250 ml orange juice');
    await main(page).getByRole('button', { name: 'Check & log' }).click();
    await expect(dialog(page).getByRole('heading', { name: /Check/ })).toBeVisible();
    await scan('typed meal');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await main(page).getByRole('button', { name: 'Log food' }).first().click();
    await scan('quick log');
    await dialog(page).getByRole('button', { name: 'New food from label' }).click();
    await scan('food editor');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await page.goto('./#/foods');
    await main(page).getByRole('searchbox').fill('potato raw');
    await main(page).getByRole('button', { name: /^Potato, white \(raw\)/ }).first().click();
    await scan('food detail');
  });
}
