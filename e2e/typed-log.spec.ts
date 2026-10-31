import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dialog, eatenKcal, food, main, onboardFresh, watchErrors } from './helpers';

/** kcal of `grams` of a core food, straight from the USDA data the app ships. */
const kcal = (key: string, grams: number) => (food(key).n.kcal! * grams) / 100;

async function typeMeal(page: Page, text: string) {
  await main(page).getByRole('textbox', { name: 'What did you eat?' }).fill(text);
  await main(page).getByRole('button', { name: 'Check & log' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Check and log' })).toBeVisible();
}

const item = (page: Page, name: string | RegExp) => dialog(page).getByRole('list', { name: 'Foods from your text' }).getByRole('listitem').filter({ hasText: name });

test('typed meal: the owner\'s sentence — exact USDA numbers, unknown sauce entered from its label, remembered next time', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await typeMeal(page, 'I ate 282 g cooked chicken breast, 300 g cooked rice, 77 g sweet chili sauce and an apple.');
  const d = dialog(page);

  await expect(item(page, 'Chicken breast, skinless (roasted)')).toContainText(`${Math.round(kcal('chicken-breast-roasted', 282))} kcal`);
  await expect(item(page, 'White rice, long-grain (cooked)')).toContainText(`${Math.round(kcal('rice-white-cooked', 300))} kcal`);
  await expect(item(page, 'Apple, with skin')).toContainText('Size assumed: 1 medium');
  await expect(item(page, 'sweet chili sauce')).toContainText("isn't in your foods yet");
  // Nothing can be saved while an item is unresolved.
  await expect(d.getByRole('button', { name: 'Check 1 item first' })).toBeDisabled();

  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // Enter the bottle's label; the list comes back with the sauce matched.
  await item(page, 'sweet chili sauce').getByRole('button', { name: 'From the label' }).click();
  await expect(d.getByRole('heading', { name: 'New food from label' })).toBeVisible();
  await expect(d.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('sweet chili sauce');
  await d.getByRole('textbox', { name: /^Energy/ }).fill('218');
  await d.getByRole('textbox', { name: /^Fat/ }).fill('0,4');
  await d.getByRole('textbox', { name: /^Carbohydrate/ }).fill('52');
  await d.getByRole('textbox', { name: /^Protein/ }).fill('0,5');
  await d.getByRole('textbox', { name: /^Salt/ }).fill('2,3');
  await d.getByRole('button', { name: 'Save & log' }).click();
  await expect(d.getByRole('heading', { name: 'Check and log' })).toBeVisible();
  await expect(item(page, 'sweet chili sauce')).toContainText(`${Math.round(218 * 0.77)} kcal`);

  const total = kcal('chicken-breast-roasted', 282) + kcal('rice-white-cooked', 300) + kcal('apple', 182) + 218 * 0.77;
  await d.getByRole('button', { name: 'Log 4 items' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByRole('status').or(page.locator('.toast')).filter({ hasText: 'Logged 4 items' }).first()).toBeVisible();
  expect(await eatenKcal(page)).toBe(Math.round(total));

  // The sauce is remembered: typing it again needs no questions.
  await typeMeal(page, '100 g sweet chili sauce');
  await expect(item(page, 'sweet chili sauce')).toContainText('218 kcal');
  await expect(d.getByRole('button', { name: 'Log 1 item' })).toBeEnabled();
  await d.getByRole('button', { name: 'Close' }).click();
  expect(errors()).toEqual([]);
});

test('typed meal: vague and unknown items wait for an answer; Greek works; the search box reads meals too', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await typeMeal(page, 'Had 2 macarons, some pasta and 250 ml orange juice.');
  const d = dialog(page);
  await expect(d.getByRole('button', { name: 'Check 2 items first' })).toBeDisabled();
  // macarons are not in the database: never replaced by a look-alike.
  await expect(item(page, 'macarons')).toContainText("isn't in your foods yet");
  await item(page, 'macarons').getByRole('button', { name: 'Leave it out' }).click();
  // "some pasta": cooked or dry first, then how much.
  await item(page, 'pasta').getByRole('button', { name: /^Cooked \(boiled\)/ }).click();
  await item(page, 'pasta').getByRole('button', { name: /1 cup spaghetti/ }).click();
  await expect(item(page, 'Orange juice')).toContainText(`${Math.round(kcal('orange-juice', 250 * food('orange-juice').densityGPerMl!))} kcal`);
  await d.getByRole('button', { name: 'Log 2 items' }).click();
  await expect(d).toBeHidden();
  const first = kcal('pasta-cooked', 124) + kcal('orange-juice', 250 * food('orange-juice').densityGPerMl!);
  expect(await eatenKcal(page)).toBe(Math.round(first));

  await typeMeal(page, 'Έφαγα 2 αυγά και μισή μπανάνα');
  await expect(item(page, 'Egg, whole (raw)')).toContainText('Size assumed: 1 large');
  await expect(item(page, 'Banana')).toBeVisible();
  await d.getByRole('button', { name: 'Log 2 items' }).click();
  await expect(d).toBeHidden();
  expect(await eatenKcal(page)).toBe(Math.round(first + kcal('egg-whole-raw', 100) + kcal('banana', 59)));

  // The Log food search box recognises a typed meal as well.
  await main(page).getByRole('button', { name: 'Log food' }).click();
  await d.getByRole('searchbox').fill('150 g greek yogurt 0% and 80 g blueberries');
  await d.getByRole('button', { name: /Check and log 2 foods/ }).click();
  await expect(item(page, 'Greek yogurt, plain 0%')).toContainText(`${Math.round(kcal('greek-yogurt-nonfat', 150))} kcal`);
  await expect(item(page, 'Blueberries')).toContainText(`${Math.round(kcal('blueberries', 80))} kcal`);
  // Every amount can still be corrected before saving.
  await item(page, 'Blueberries').getByRole('textbox', { name: 'Blueberries amount' }).fill('100');
  await expect(item(page, 'Blueberries')).toContainText(`${Math.round(kcal('blueberries', 100))} kcal`);
  await d.getByRole('button', { name: 'Log 2 items' }).click();
  await expect(d).toBeHidden();
  expect(errors()).toEqual([]);
});
