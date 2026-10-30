import { expect, test } from '@playwright/test';
import { dialog, logFood, main, onboardFresh, watchErrors } from './helpers';

test('oxalate: cited foods are counted, foods without a usable amount stay unknown, the limit is your own', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  // Raw white potato: 17.1 mg per 100 g (Honow & Hesse 2002 lab value) → 250 g = 42.75 mg.
  await logFood(page, 'potato raw', /Potato, white \(raw\)/, '250', { unit: 'g' });
  await page.goto('./#/nutrients');
  const card = main(page).getByRole('region', { name: 'Oxalate' });
  await expect(card).toContainText('43 mg today');
  await expect(card).not.toContainText('≥');
  await expect(card.getByRole('list', { name: 'Oxalate by food' })).toContainText(/Potato, white \(raw\)\s*43 mg\s*High/);

  // Whey: Harvard gives 1.5 mg per scoop without the scoop's weight, so it is listed, not added.
  await page.goto('./#/today');
  await logFood(page, 'whey', /Whey protein powder/, '30', { unit: 'g' });
  await page.goto('./#/nutrients');
  await expect(card).toContainText('≥ 43 mg today');
  await card.getByText('Not counted (1)').click();
  await expect(card).toContainText(/Whey protein powder \(generic\)\s*low oxalate — 1\.5 mg per 1 scoop, weight not stated/);

  // No official intake: the limit is the one the user sets.
  await expect(card.getByRole('progressbar')).toHaveCount(0);
  await card.getByRole('button', { name: 'Set a daily limit' }).click();
  await card.getByRole('textbox', { name: /Your daily oxalate limit/ }).fill('50');
  await expect(card.getByRole('progressbar', { name: 'Oxalate against your daily limit' })).toHaveAttribute('aria-valuetext', 'at least 43 of 50 mg');
  await expect(card).toContainText('your limit 50 mg');

  // The food page says where the number comes from, and when there is none.
  await page.goto('./#/foods');
  await main(page).getByRole('searchbox').fill('potato raw');
  await main(page).getByRole('button', { name: /^Potato, white \(raw\)/ }).first().click();
  await expect(dialog(page)).toContainText('Oxalate: ≈ 17 mg per 100 g — high oxalate for that amount.');
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await main(page).getByRole('searchbox').fill('egg white');
  await main(page).getByRole('button', { name: /^Egg white \(raw\)/ }).first().click();
  await expect(dialog(page)).toContainText('Oxalate: no cited value for this food — unknown, not zero.');
  expect(errors()).toEqual([]);
});
