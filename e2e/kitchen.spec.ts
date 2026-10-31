import { expect, test, type Page } from '@playwright/test';
import { dialog, eatenKcal, food, main, onboardFresh, watchErrors } from './helpers';

async function addIngredient(page: Page, query: string, pick: RegExp, grams: string) {
  const d = dialog(page);
  await d.getByRole('searchbox', { name: 'Add an ingredient' }).fill(query);
  await d.getByRole('list', { name: 'Matching foods' }).getByRole('button', { name: pick }).first().click();
  const row = d.getByRole('list', { name: 'Ingredients' }).getByRole('listitem').last();
  await row.getByRole('textbox').fill(grams);
  await row.getByRole('textbox').blur();
}

test('batch prep: recipe → cook → weigh → portions are exact fractions; leftovers tracked', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.goto('./#/kitchen');
  await main(page).getByRole('button', { name: 'New recipe' }).click();
  await dialog(page).getByRole('textbox', { name: 'Name' }).fill('Bolognese');
  await addIngredient(page, 'ground beef 95 raw', /Ground beef 95% lean \(raw\)/, '500');
  await addIngredient(page, 'tomato raw', /Tomato/, '400');
  await addIngredient(page, 'onion raw', /Onion/, '150');
  await dialog(page).getByRole('button', { name: 'Save & cook' }).click();

  await dialog(page).getByRole('textbox', { name: /Cooked weight of the whole batch/ }).fill('860');
  await dialog(page).getByRole('textbox', { name: /Eat a portion now/ }).fill('190');
  await dialog(page).getByRole('button', { name: 'Save batch' }).click();
  await expect(dialog(page)).toBeHidden();

  const whole = 5 * food('beef-ground-95-raw').n.kcal! + 4 * food('tomato-raw').n.kcal! + 1.5 * food('onion-raw').n.kcal!;
  await page.goto('./#/today');
  await expect.poll(() => eatenKcal(page)).toBe(Math.round((whole * 190) / 860));

  await page.goto('./#/kitchen');
  await expect(main(page)).toContainText('670 g left');
  await main(page).getByRole('button', { name: 'Log a portion' }).click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: /^Amount/ }).fill('167');
  await d.getByRole('button', { name: 'Log eaten' }).click();
  await expect(main(page)).toContainText('503 g left');
  await page.goto('./#/today');
  await expect.poll(() => eatenKcal(page)).toBe(Math.round((whole * 357) / 860));
  expect(errors()).toEqual([]);
});
