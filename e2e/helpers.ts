import { expect, type Page } from '@playwright/test';
import core from '../src/data/foods/core.json' with { type: 'json' };

export interface CoreFood { id: string; names: { en: string }; n: Record<string, number | undefined>; densityGPerMl?: number }
export const CORE = core as unknown as CoreFood[];
export const food = (key: string): CoreFood => {
  const f = CORE.find((x) => x.id === `core:${key}`);
  if (!f) throw new Error(`no core food ${key}`);
  return f;
};

/**
 * WebKit reports a style-src-attr CSP violation for ANY script-created <select> (its own internal
 * styling), even on a one-line page, and still renders the select normally. Chromium does not.
 * That single engine report is ignored; every other console error or CSP report fails the test.
 */
const WEBKIT_SELECT_CSP_QUIRK = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

/** Collects console errors and CSP violations; every test asserts there were none. */
export function watchErrors(page: Page): () => string[] {
  const errors: string[] = [];
  const isWebKit = page.context().browser()?.browserType().name() === 'webkit';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (isWebKit && m.text() === WEBKIT_SELECT_CSP_QUIRK) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return () => errors;
}

export async function onboardFresh(page: Page, stats = { age: '18', height: '174', weight: '73' }): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Start fresh instead' }).click();
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  await page.getByLabel('Age').fill(stats.age);
  await page.getByLabel('Height').fill(stats.height);
  await page.getByLabel('Weight').fill(stats.weight);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

export const main = (page: Page) => page.getByRole('main');
export const dialog = (page: Page) => page.getByRole('dialog');

/** Opens Log food, searches, picks the first result whose name matches, enters an amount. */
export async function logFood(page: Page, query: string, pick: RegExp, amount: string, opts: { unit?: 'g' | 'mL'; status?: 'Eaten' | 'Planned' } = {}): Promise<void> {
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await d.getByRole('searchbox').fill(query);
  await d.getByRole('listitem').filter({ hasText: pick }).first().click();
  if (opts.unit) await d.getByRole('button', { name: opts.unit, exact: true }).click();
  await d.getByRole('textbox', { name: /^Amount/ }).fill(amount);
  if (opts.status) await d.getByRole('radio', { name: opts.status }).click();
  await d.getByRole('button', { name: opts.status === 'Planned' ? 'Add as planned' : 'Log eaten' }).click();
  await expect(d).toBeHidden();
}

/** The big "kcal eaten" number on Today. */
export async function eatenKcal(page: Page): Promise<number> {
  const t = await main(page).locator('.hero-num').first().innerText();
  return Number(t.replace(/[^\d]/g, ''));
}
