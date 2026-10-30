import { expect, test } from '@playwright/test';
import { dialog, eatenKcal, food, logFood, main, onboardFresh, watchErrors } from './helpers';

test('onboarding gives Mifflin–St Jeor targets (73 kg, 174 cm, 18 y, male, moderate, recomp)', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  // BMR = 10·73 + 6.25·174 − 5·18 + 5 = 1732.5; ×1.55 = 2685; recomp = maintenance; protein 1.0 g/lb = 161 g
  await expect(main(page)).toContainText('of 2,685 kcal (estimate)');
  await expect(main(page).getByRole('progressbar', { name: 'Protein' })).toHaveAttribute('aria-valuemax', '161');
  expect(errors()).toEqual([]);
});

test('logs weighed foods in their cooked state and updates everywhere when an amount changes', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  const chicken = food('chicken-breast-roasted');
  const potato = food('potato-boiled');
  await logFood(page, 'chicken breast roasted', /Chicken breast.*roasted/i, '282', { unit: 'g' });
  await logFood(page, 'potato boiled', /Potato.*boiled/i, '336', { unit: 'g' });
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(2.82 * chicken.n.kcal! + 3.36 * potato.n.kcal!));

  await main(page).getByRole('button', { name: /Potato.*336 g.*Edit/ }).click();
  await dialog(page).getByRole('textbox', { name: /^Amount/ }).fill('450');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(2.82 * chicken.n.kcal! + 4.5 * potato.n.kcal!));

  await page.reload();
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(2.82 * chicken.n.kcal! + 4.5 * potato.n.kcal!));
  expect(errors()).toEqual([]);
});

test('planned food does not count as eaten until marked; delete has undo', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  const oj = food('orange-juice');
  await logFood(page, 'orange juice', /Orange juice/i, '255', { unit: 'mL', status: 'Planned' });
  await expect.poll(() => eatenKcal(page)).toBe(0);
  await expect(main(page)).toContainText('Planned, not eaten yet');
  await main(page).getByRole('button', { name: /Mark Orange juice.*eaten/ }).click();
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(2.55 * oj.densityGPerMl! * oj.n.kcal!));

  await main(page).getByRole('button', { name: /Orange juice.*Edit/ }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => eatenKcal(page)).toBe(0);
  await page.getByRole('status').locator('.toast', { hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(2.55 * oj.densityGPerMl! * oj.n.kcal!));
  expect(errors()).toEqual([]);
});

test('keyboard-only logging: / opens search, Enter picks, Enter logs', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hardware keyboard flow');
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.keyboard.press('/');
  await expect(dialog(page).getByRole('searchbox')).toBeFocused();
  await page.keyboard.type('oats');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('textbox', { name: /^Amount/ })).toBeFocused();
  await page.keyboard.type('80');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
  const oats = food('oats-dry');
  await expect.poll(() => eatenKcal(page)).toBe(Math.round(0.8 * oats.n.kcal!));
  expect(errors()).toEqual([]);
});

test('copying yesterday creates planned entries on today', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.getByRole('link', { name: 'Diary' }).first().click();
  await main(page).getByRole('button', { name: 'Previous day' }).click();
  await main(page).getByRole('button', { name: /Add food to Dinner/ }).click();
  const d = dialog(page);
  await d.getByRole('searchbox').fill('salmon cooked');
  await d.getByRole('listitem').first().click();
  await d.getByRole('button', { name: 'g', exact: true }).click();
  await d.getByRole('textbox', { name: /^Amount/ }).fill('180');
  await d.getByRole('button', { name: 'Log eaten' }).click();
  await page.getByRole('link', { name: 'Today' }).first().click();
  await main(page).getByRole('button', { name: 'Repeat yesterday' }).click();
  await expect(main(page)).toContainText('Planned, not eaten yet');
  await expect.poll(() => eatenKcal(page)).toBe(0);
  expect(errors()).toEqual([]);
});
