import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeGtin, upcEToA } from '../src/integrations/barcode';
import { lookupBarcode, mapOffProduct, type OffProduct } from '../src/integrations/off';
import { CarbmaxxDB, useDatabase } from '../src/data/db';
import { uuidv7 } from '../src/data/ids';
import { contribution } from '../src/domain/nutrition/compute';

beforeEach(() => { useDatabase(new CarbmaxxDB(`off-${uuidv7()}`)); });

describe('GTIN validation', () => {
  it.each(['4006381333931', '5449000000996', '96385074', '036000291452', '00036000291452'])('accepts %s', (c) => expect(normalizeGtin(c)).toBe(c));
  it.each(['4006381333932', '123', 'abcdefghijklm', '40063813339311', ''])('rejects %s', (c) => expect(normalizeGtin(c)).toBeNull());
  it('ignores spaces and dashes', () => expect(normalizeGtin('4006381 333931')).toBe('4006381333931'));
  it('expands UPC-E to UPC-A', () => {
    expect(upcEToA('04252614')).toBe('042100005264');
    expect(upcEToA('12345')).toBeNull();
  });
});

const milk: OffProduct = {
  code: '5201234567892', product_name: 'Fresh milk 1.5%', product_name_el: 'Φρέσκο γάλα 1,5%', brands: 'TestDairy, Other',
  quantity: '1 l', product_quantity_unit: 'ml', nutrition_data_per: '100g', countries_tags: ['en:greece'],
  nutriments: {
    'energy-kcal_100g': 46, 'energy-kj_100g': 194, proteins_100g: 3.4, carbohydrates_100g: 4.8, sugars_100g: 4.8,
    fat_100g: 1.5, 'saturated-fat_100g': 1, salt_100g: 0.1, calcium_100g: 0.12, 'vitamin-d_100g': 0.0000012,
  },
  image_front_small_url: 'https://images.openfoodfacts.org/images/products/520/123/456/7892/front_el.4.200.jpg',
};

describe('Open Food Facts mapping', () => {
  it('maps a Greek milk: per 100 mL, EU carbs, salt→sodium, g→mg/µg micronutrients', () => {
    const m = mapOffProduct(milk, '5201234567892');
    expect(m.errors).toEqual([]);
    expect(m.food.basis).toEqual({ per: '100ml' });
    expect(m.food.carbsIncludeFiber).toBe(false);
    expect(m.food.n.kcal).toBe(46);
    expect(m.food.n.sodium).toBeCloseTo(40, 10);
    expect(m.food.n.calcium).toBeCloseTo(120, 10);
    expect(m.food.n.vitD).toBeCloseTo(1.2, 10);
    expect(m.food.n.fiber).toBeUndefined();
    expect(m.food.brand).toBe('TestDairy');
    expect(m.food.names.el).toBe('Φρέσκο γάλα 1,5%');
    expect(m.food.gtin).toBe('5201234567892');
    expect(m.food.src.type).toBe('off');
    expect(m.food.src.verifiedAt).toBeUndefined();
    expect(m.image).toMatch(/^https:\/\/images\.openfoodfacts\.org\//);
    const c = contribution({ ...m.food, id: 'x' }, { amount: 250, unit: 'ml' });
    if ('error' in c) throw new Error(c.error);
    expect(c.n.kcal).toBeCloseTo(115, 10);
  });

  it('lists missing main nutrients and keeps them unknown', () => {
    const m = mapOffProduct({ product_name: 'Mystery bar', nutriments: { 'energy-kcal_100g': 420 } }, '96385074');
    expect(m.missing).toEqual(['protein', 'carbohydrate', 'fat']);
    expect(m.food.n.protein).toBeUndefined();
  });

  it('converts kJ when kcal is absent and says so', () => {
    const m = mapOffProduct({ product_name: 'X', nutriments: { 'energy-kj_100g': 1674, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 10 } }, '96385074');
    expect(m.food.n.kcal).toBeCloseTo(400.1, 1);
    expect(m.warnings.join(' ')).toMatch(/kJ/);
  });

  it('rejects impossible crowd data instead of saving it', () => {
    const m = mapOffProduct({ product_name: 'Broken', nutriments: { 'energy-kcal_100g': 50, proteins_100g: 60, carbohydrates_100g: 60, fat_100g: 5 } }, '96385074');
    expect(m.errors.join(' ')).toMatch(/100 g/);
  });

  it('ignores image URLs that are not from Open Food Facts', () => {
    const m = mapOffProduct({ ...milk, image_front_small_url: 'https://evil.example/x.jpg' }, '5201234567892');
    expect(m.image).toBeUndefined();
  });
});

describe('lookupBarcode', () => {
  it('fetches once, then answers from the local cache (offline repeat)', async () => {
    let calls = 0;
    const fake = (async () => { calls += 1; return new Response(JSON.stringify({ status: 'success', result: { id: 'product_found' }, product: milk })); }) as unknown as typeof fetch;
    const a = await lookupBarcode('5201234567892', fake);
    expect(a.status).toBe('found');
    const b = await lookupBarcode('5201234567892', fake);
    expect(b).toMatchObject({ status: 'found', fromCache: true });
    expect(calls).toBe(1);
  });

  it('remembers not-found products', async () => {
    let calls = 0;
    const fake = (async () => { calls += 1; return new Response('{}', { status: 404 }); }) as unknown as typeof fetch;
    expect((await lookupBarcode('96385074', fake)).status).toBe('not-found');
    expect((await lookupBarcode('96385074', fake)).status).toBe('not-found');
    expect(calls).toBe(1);
  });

  it('reports rate limiting without caching it', async () => {
    const fake = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
    const r = await lookupBarcode('036000291452', fake);
    expect(r.status).toBe('error');
  }, 10_000);
});
