import { expect, test } from '@playwright/test';
import { main, onboardFresh, watchErrors } from './helpers';

const v1Workouts = {
  tester: {
    days: [
      { name: 'Upper Strength', rest: false, ex: [
        { name: 'Weighted Dips', sets: '2', reps: '6–8', note: '', ss: false, m: ['triceps', 'chest'], anim: 'chestpress' },
        { name: 'Weighted Pull-Ups', sets: '2', reps: '5–8', note: '', ss: false, m: ['lats', 'biceps'], anim: 'pullup' },
      ] },
      { name: 'Rest', rest: true, ex: [] },
    ],
    updatedAt: 1,
  },
};

test('import a classic program, log a workout, and the next one is prefilled', async ({ page }) => {
  const errors = watchErrors(page);
  const raw = JSON.stringify(v1Workouts);
  await page.addInitScript((d) => { localStorage.setItem('carbmaxx_workout_profiles_v1', d); }, raw);
  await onboardFresh(page);
  await page.goto('./#/train');
  await main(page).getByRole('button', { name: 'tester' }).click();
  await expect(main(page)).toContainText('tester (from classic page)');

  await main(page).getByRole('button', { name: 'Start Upper Strength' }).click();
  await expect(main(page).getByRole('heading', { name: 'Upper Strength', level: 1 })).toBeVisible();
  const dips = main(page).getByRole('region', { name: 'Weighted Dips' });
  for (const n of ['1', '2']) {
    await dips.getByRole('textbox', { name: `Set ${n} weight in kg` }).fill('20');
    if (n === '2') {
      // The rest timer re-renders every second; a value still being typed must survive it.
      await page.waitForTimeout(1200);
      await expect(dips.getByRole('textbox', { name: 'Set 2 weight in kg' })).toHaveValue('20');
    }
    await dips.getByRole('textbox', { name: `Set ${n} reps` }).fill('8');
    await dips.getByRole('checkbox', { name: `Set ${n} done` }).check();
  }
  await expect(page.getByRole('timer')).toContainText('Rest');
  await main(page).getByRole('button', { name: 'Finish' }).click();
  await expect(main(page).getByRole('region', { name: 'Workout summary' })).toContainText('2 working sets');

  await page.goto('./#/train');
  await main(page).getByRole('button', { name: 'Start', exact: true }).first().click();
  const again = main(page).getByRole('region', { name: 'Weighted Dips' });
  await expect(again.getByRole('textbox', { name: 'Set 1 weight in kg' })).toHaveValue('20');
  await expect(again).toContainText('Last time: 20×8, 20×8');
  await expect(again).toContainText('try a little more weight');
  expect(await page.evaluate(() => localStorage.getItem('carbmaxx_workout_profiles_v1'))).toBe(raw);
  expect(errors()).toEqual([]);
});
