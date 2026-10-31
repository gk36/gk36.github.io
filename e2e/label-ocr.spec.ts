import { expect, test, type Page } from '@playwright/test';
import { dialog, main, onboardFresh, watchErrors } from './helpers';

/** A bilingual EU label, rendered as an image the way a phone photo would arrive. */
const LABEL = `<html><body style="margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,'DejaVu Sans',sans-serif">
<div id="label" style="width:640px;padding:28px;font-size:26px;line-height:1.55;border:3px solid #111">
<div style="font-weight:700">ΔΙΑΤΡΟΦΙΚΗ ΕΠΙΣΗΜΑΝΣΗ / NUTRITION</div>
<div>ανά 100 g / per 100 g</div>
<div>Ενέργεια / Energy 1569 kJ / 375 kcal</div>
<div>Λιπαρά / Fat 9,5 g</div>
<div>εκ των οποίων κορεσμένα / of which saturates 3,1 g</div>
<div>Υδατάνθρακες / Carbohydrate 61 g</div>
<div>εκ των οποίων σάκχαρα / of which sugars 22 g</div>
<div>Φυτικές ίνες / Fibre 4,2 g</div>
<div>Πρωτεΐνες / Protein 8,8 g</div>
<div>Αλάτι / Salt 0,45 g</div>
</div></body></html>`;

async function labelPng(page: Page): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setContent(LABEL);
  const buf = await p.locator('#label').screenshot();
  await p.close();
  return buf;
}

test('label photo → on-device OCR (Greek + English) → only empty fields are filled, for checking', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  let remote = 0;
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) remote += 1; });
  await onboardFresh(page);
  await main(page).getByRole('button', { name: 'Log food' }).click();
  await dialog(page).getByRole('button', { name: 'New food from label' }).click();
  const d = dialog(page);
  await d.getByRole('textbox', { name: 'Name', exact: true }).fill('Test granola');
  await d.getByRole('textbox', { name: 'Fat (g)' }).fill('9'); // typed by hand: the photo must not overwrite it
  await d.locator('input[type=file]').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer: await labelPng(page) });

  await expect(d.getByText(/Filled from your photo/)).toBeVisible({ timeout: 120_000 });
  await expect(d.getByRole('textbox', { name: 'Energy (kcal)' })).toHaveValue('375');
  await expect(d.getByRole('textbox', { name: 'Fat (g)' })).toHaveValue('9');
  await expect(d.getByRole('textbox', { name: 'of which saturates (g)' })).toHaveValue('3.1');
  await expect(d.getByRole('textbox', { name: 'Carbohydrate (g)' })).toHaveValue('61');
  await expect(d.getByRole('textbox', { name: 'of which sugars (g)' })).toHaveValue('22');
  await expect(d.getByRole('textbox', { name: 'Fibre (g)' })).toHaveValue('4.2');
  await expect(d.getByRole('textbox', { name: 'Protein (g)' })).toHaveValue('8.8');
  await expect(d.getByRole('textbox', { name: 'Salt (g)' })).toHaveValue('0.45');
  // The photo was read on the device: no request left this machine.
  expect(remote).toBe(0);
  // Tesseract's LSTM-only models print one harmless notice about a legacy-engine parameter.
  expect(errors().filter((e) => !e.startsWith('Warning: Parameter not found: language_model_ngram_on'))).toEqual([]);
});
