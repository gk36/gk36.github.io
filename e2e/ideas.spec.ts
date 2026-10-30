import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { dialog, eatenKcal, main, onboardFresh, watchErrors } from './helpers';

const num = (s: string) => Number(s.replace(/[^\d]/g, ''));

test('meal ideas: taste check, three recipes with exact grams and steps, edit and re-balance, log it', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await main(page).getByRole('button', { name: /What should I eat\?/ }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Meal ideas' })).toBeVisible();

  // First time: the taste card, pre-filled and editable.
  const taste = d.getByRole('region', { name: 'Your taste' });
  await expect(taste.getByRole('button', { name: 'Stop avoiding broccoli' })).toBeVisible();
  await expect(taste.getByRole('checkbox', { name: 'Prefer lower-oxalate foods' })).toBeChecked();
  await taste.getByRole('button', { name: 'Looks right' }).click();
  await expect(taste).toBeHidden();

  await d.getByRole('combobox', { name: 'Meal' }).selectOption({ label: 'Breakfast · 08:00' });
  const ideas = d.getByRole('list', { name: 'Meal ideas' }).getByRole('article');
  await expect(ideas).toHaveCount(3);
  const goal = num((await d.getByRole('button', { name: 'Size' }).innerText()).split('kcal')[0]!);
  for (let i = 0; i < 3; i++) {
    const card = ideas.nth(i);
    const kcal = num(await card.locator('.idea-kcal').innerText());
    expect(Math.abs(kcal - goal)).toBeLessThanOrEqual(Math.max(50, goal * 0.08));
    await expect(card.getByText('How to make it')).toBeVisible();
    // Never broccoli, and every amount is an exact weight or count.
    await expect(card.getByRole('list', { name: /^Ingredients for/ })).not.toContainText(/broccoli/i);
  }
  await expect(ideas.first().locator('ol li').first()).toContainText(/\d+ (g|mL)/);

  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

  // Change an amount: the rest re-balances around it.
  const first = ideas.first();
  const name = (await first.getByRole('heading').innerText()).trim();
  await first.getByRole('button', { name: 'Change ingredients' }).click();
  const amount = first.getByRole('textbox', { name: /amount \(g\)$/ }).first();
  await amount.fill('5');
  await amount.press('Tab');
  await expect(first).toContainText('Other amounts re-balanced around yours.');
  await first.getByRole('button', { name: 'Done editing' }).click();

  const before = await eatenKcal(page);
  const kcal = num(await first.locator('.idea-kcal').innerText());
  await first.getByRole('button', { name: 'Log it' }).click();
  await expect(d).toBeHidden();
  await expect(page.locator('.toast').filter({ hasText: `Logged ${name}` })).toBeVisible();
  // The diary counts exactly what the card showed (± rounding of the display).
  expect(Math.abs((await eatenKcal(page)) - before - kcal)).toBeLessThanOrEqual(1);
  await expect(main(page).getByText(name).first()).toBeVisible();
  expect(errors()).toEqual([]);
});

test('meal ideas from the pantry only; example recipes in the kitchen are honest about missing data', async ({ page }) => {
  const errors = watchErrors(page);
  await onboardFresh(page);
  await page.goto('./#/pantry');
  for (const [q, pick, g] of [['cream of rice dry', /^Cream of Rice \(dry\)/, '500'], ['whey', /^Whey protein/, '900'], ['strawberries', /^Strawberries/, '400'], ['greek yogurt 0', /^Greek yogurt, plain 0%/, '500'], ['honey', /^Honey/, '300'], ['oats', /^Oats, rolled/, '500']] as const) {
    await main(page).getByRole('button', { name: 'Add food' }).click();
    const d = dialog(page);
    await d.getByRole('searchbox', { name: 'What do you have?' }).fill(q);
    await d.getByRole('list', { name: 'Matching foods' }).getByRole('button', { name: pick }).first().click();
    await d.getByRole('textbox', { name: /^Amount/ }).fill(g);
    await d.getByRole('button', { name: 'Add to pantry' }).click();
    await expect(d).toBeHidden();
  }
  await page.goto('./#/kitchen');
  const recipes = main(page).getByRole('region', { name: 'Recipes' });
  for (const n of ['Protein cream of rice', 'Protein oat pancakes', 'Chicken and rice', 'Steak and potatoes', 'Sweet chili chicken noodles', 'Lean beef soup']) {
    await expect(recipes.getByRole('button', { name: new RegExp(`^${n}`) })).toBeVisible();
  }
  await recipes.getByRole('button', { name: /^Sweet chili chicken noodles/ }).click();
  await expect(dialog(page)).toContainText('has no values yet');
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  await main(page).getByRole('button', { name: 'Meal ideas' }).click();
  const d = dialog(page);
  await d.getByRole('region', { name: 'Your taste' }).getByRole('button', { name: 'Looks right' }).click();
  await d.getByRole('combobox', { name: 'Meal' }).selectOption({ label: 'Breakfast · 08:00' });
  await d.getByRole('checkbox', { name: /Only what I have/ }).check();
  const ideas = d.getByRole('list', { name: 'Meal ideas' }).getByRole('article');
  await expect(ideas.first()).toBeVisible();
  const count = await ideas.count();
  for (let i = 0; i < count; i++) {
    await expect(ideas.nth(i)).not.toContainText('to buy');
    await expect(ideas.nth(i)).toContainText('All at home');
  }
  await expect(d).toContainText(/You still need more|Nothing logged yet today/);
  expect(errors()).toEqual([]);
});
