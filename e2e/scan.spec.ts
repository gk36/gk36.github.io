import { expect, test, type Page } from '@playwright/test';
import { dialog, eatenKcal, main, onboardFresh, watchErrors } from './helpers';

/** EAN-13 check digit (mod 10, weights 1/3 from the left). */
function withCheck(d12: string): string {
  const s = d12.split('').reduce((acc, ch, i) => acc + Number(ch) * (i % 2 ? 3 : 1), 0);
  return d12 + ((10 - (s % 10)) % 10);
}

/** Draws a real EAN-13 barcode as SVG (L/G/R encodings, guards, quiet zones). */
function ean13Svg(code: string): string {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map((p) => p.split('').map((b) => (b === '1' ? '0' : '1')).join(''));
  const G = R.map((p) => p.split('').reverse().join(''));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  const par = PARITY[d[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]!]!;
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]!]!;
  bits += '101';
  const m = 4, quiet = 12, w = (bits.length + quiet * 2) * m, h = 160;
  const bars = bits.split('').map((b, i) => (b === '1' ? `<rect x="${(i + quiet) * m}" y="10" width="${m}" height="${h - 20}" fill="#000"/>` : '')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${bars}</svg>`;
}

async function barcodePng(page: Page, code: string): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setContent(`<html><body style="margin:0;background:#fff">${ean13Svg(code)}</body></html>`);
  const buf = await p.locator('svg').screenshot();
  await p.close();
  return buf;
}

const CODE = withCheck('520123456789');
const product = {
  status: 'success', result: { id: 'product_found' },
  product: {
    code: CODE, product_name: 'Fresh milk 1.5%', product_name_el: 'Φρέσκο γάλα 1,5%', brands: 'TestDairy', quantity: '1 l',
    product_quantity_unit: 'ml', countries_tags: ['en:greece'],
    nutriments: { 'energy-kcal_100g': 46, proteins_100g: 3.4, carbohydrates_100g: 4.8, sugars_100g: 4.8, fat_100g: 1.5, 'saturated-fat_100g': 1, salt_100g: 0.1, calcium_100g: 0.12 },
  },
};

test('photo of a barcode → Open Food Facts → save & log 250 mL; second scan is instant and offline', async ({ page, context }) => {
  const errors = watchErrors(page);
  let offCalls = 0;
  await context.route('https://world.openfoodfacts.org/api/v3/product/**', async (route) => {
    offCalls += 1;
    expect(route.request().url()).toContain(`/${CODE}.json`);
    await route.fulfill({ json: product });
  });
  await onboardFresh(page);
  await main(page).getByRole('button', { name: 'Scan' }).click();
  const d = dialog(page);
  await expect(d).toContainText(/camera|Point at the barcode/i);
  await d.locator('input[type=file]').setInputFiles({ name: 'barcode.png', mimeType: 'image/png', buffer: await barcodePng(page, CODE) });

  await expect(d.getByRole('heading', { name: 'Fresh milk 1.5%' })).toBeVisible({ timeout: 20_000 });
  await expect(d.getByRole('row', { name: /Sodium/ })).toContainText('40 mg');
  await d.getByRole('button', { name: 'Save & log' }).click();
  await d.getByRole('button', { name: 'mL', exact: true }).click();
  await d.getByRole('textbox', { name: /^Amount/ }).fill('250');
  await d.getByRole('button', { name: 'Log eaten' }).click();
  await expect.poll(() => eatenKcal(page)).toBe(115);

  // Second scan, typed, while offline: answered from the saved food, no network.
  await context.setOffline(true);
  await main(page).getByRole('button', { name: 'Scan' }).click();
  await dialog(page).getByRole('button', { name: 'Type the number', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: /Barcode number/ }).fill(CODE);
  await dialog(page).getByRole('button', { name: 'Look up' }).click();
  await expect(dialog(page)).toContainText('Already in your foods');
  await context.setOffline(false);
  expect(offCalls).toBe(1);
  expect(errors()).toEqual([]);
});

test('a mistyped barcode is rejected by its check digit; unknown products go to the label editor', async ({ page, context }) => {
  const errors = watchErrors(page);
  await context.route('https://world.openfoodfacts.org/api/v3/product/**', (route) => route.fulfill({ status: 404, json: { status: 'failure', result: { id: 'product_not_found' } } }));
  await onboardFresh(page);
  await main(page).getByRole('button', { name: 'Scan' }).click();
  await dialog(page).getByRole('button', { name: 'Type the number', exact: true }).click();
  const box = dialog(page).getByRole('textbox', { name: /Barcode number/ });
  await box.fill(`${CODE.slice(0, 12)}${(Number(CODE[12]) + 1) % 10}`);
  await expect(dialog(page).getByRole('button', { name: 'Look up' })).toBeDisabled();
  await box.fill(withCheck('400638133393'));
  await dialog(page).getByRole('button', { name: 'Look up' }).click();
  await expect(dialog(page)).toContainText('is not in Open Food Facts');
  await dialog(page).getByRole('button', { name: 'Add it from the label' }).click();
  await expect(dialog(page).getByRole('textbox', { name: /Barcode/ })).toHaveValue(withCheck('400638133393'));
  // Open Food Facts answers an unknown product with HTTP 404, which browsers always log.
  expect(errors().filter((e) => !e.includes('status of 404'))).toEqual([]);
});
