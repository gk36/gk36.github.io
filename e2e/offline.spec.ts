import { expect, test } from '@playwright/test';
import { eatenKcal, logFood, main, onboardFresh, watchErrors } from './helpers';

test.use({ serviceWorkers: 'allow' });

test('works offline after the first visit (service worker), with data intact', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'service-worker offline emulation is reliable in Chromium');
  const errors = watchErrors(page);
  await onboardFresh(page);
  await logFood(page, 'banana', /Banana/, '1');
  const kcal = await eatenKcal(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
  // The first install must not reload the page under the user (it once did, mid-onboarding).
  expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).not.toBe('reload');

  await context.setOffline(true);
  await page.reload();
  await expect(main(page).getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect.poll(() => eatenKcal(page)).toBe(kcal);
  // Core foods (a lazily loaded chunk) are available offline too.
  await logFood(page, 'apple', /Apple/, '1');
  await expect.poll(() => eatenKcal(page)).toBeGreaterThan(kcal);
  await context.setOffline(false);
  expect(errors()).toEqual([]);
});
