/**
 * Oxalate, only where a cited value exists. Kept apart from the USDA nutrient data: the values come
 * from different sources, per serving rather than per 100 g, and sources disagree for several foods
 * (noted per food). Foods without a cited value are UNKNOWN — never assumed low.
 *
 * Main source: Harvard T.H. Chan School of Public Health, Oxalate Table 2023 (posted Nov 2023), mg per
 * the serving it lists. Where Harvard has no row: peer-reviewed lab measurements (mg per 100 g fresh
 * weight), then university kidney-stone program lists. Gram weights of servings come from USDA
 * portions of the same food, or exact unit conversions (1 oz = 28.35 g).
 *
 * Levels follow UPMC's low-oxalate diet (the only source that states cut-offs): low under 2 mg,
 * moderate 2–10 mg, high over 10 mg per serving. "Very high" (over 50 mg) is our own cut-off, used only
 * to rank meal ideas.
 */

export type OxalateSource = 'harvard-2023' | 'honow-hesse-2002' | 'siener-2021' | 'nguyen-savage-2013' | 'uchicago' | 'upmc' | 'wake-forest' | 'derived';

export const OXALATE_SOURCES: Record<OxalateSource, { title: string; url: string }> = {
  'harvard-2023': { title: 'Harvard T.H. Chan School of Public Health — Oxalate Table 2023', url: 'https://hsph.harvard.edu/wp-content/uploads/2024/07/OXALATE-TABLE-1.xlsx' },
  'honow-hesse-2002': { title: 'Hönow & Hesse 2002, Food Chemistry 78:511–521 (via Salgado et al. 2023, Foods 12:3201)', url: 'https://europepmc.org/article/PMC/PMC10486698' },
  'siener-2021': { title: 'Siener, Seidler & Hönow 2021, Food Science and Technology 41 (Suppl 1)', url: 'https://www.scielo.br/j/cta/a/TfJ6dZ8CD88rGwfqdKpqyVf/?lang=en' },
  'nguyen-savage-2013': { title: 'Nguyễn & Savage 2013, Foods 2(1):76–82', url: 'https://pubmed.ncbi.nlm.nih.gov/28239098/' },
  uchicago: { title: 'University of Chicago Kidney Stone Program — oxalate list', url: 'https://kidneystones.uchicago.edu/how-to-eat-a-low-oxalate-diet/' },
  upmc: { title: 'UPMC — Low-oxalate diet (category only)', url: 'https://www.upmc.com/healthbeat/urology/help-prevent-kidney-stones-with-a-low-oxalate-diet' },
  'wake-forest': { title: 'Wake Forest Baptist Urology — oxalate food list (2008)', url: 'https://www.wakehealth.edu/-/media/WakeForest/Clinical/Files/Urology/Oxalate-Food-List.pdf' },
  derived: { title: 'Average of the three berries above (as the food itself is)', url: 'https://hsph.harvard.edu/wp-content/uploads/2024/07/OXALATE-TABLE-1.xlsx' },
};

export interface OxalateInfo {
  /** mg per the source's serving (null when the source gives only per 100 g or only a category). */
  mg: number | null;
  serving: string | null;
  /** Grams of that serving for this food (USDA portion or exact unit), when known. */
  servingG: number | null;
  /** mg per 100 g of THIS food in the state it is stored (given, or mg × 100 / servingG). */
  per100g: number | null;
  /** A category with no number (UPMC/UChicago "low"). */
  category?: 'low';
  src: OxalateSource;
  /** Where sources disagree noticeably. */
  conflict?: string;
}

const oz = 28.349523125;
const h = (mg: number, serving: string, servingG: number | null, conflict?: string): OxalateInfo =>
  ({ mg, serving, servingG, per100g: servingG ? Math.round((mg * 100 * 10) / servingG) / 10 : null, src: 'harvard-2023', ...(conflict ? { conflict } : {}) });
const lab = (per100g: number, src: OxalateSource, conflict?: string): OxalateInfo =>
  ({ mg: null, serving: null, servingG: null, per100g, src, ...(conflict ? { conflict } : {}) });
const low = (src: OxalateSource): OxalateInfo => ({ mg: null, serving: null, servingG: null, per100g: null, category: 'low', src });

/** Keyed by core food key (without "core:"). Cooked foods carry the value; raw/dry ones use their cooked pair. */
export const OXALATE: Readonly<Record<string, OxalateInfo>> = {
  'chicken-breast-roasted': h(0, '3 oz', 3 * oz),
  'chicken-thigh-roasted': h(0.2, '2 pieces', null),
  'turkey-breast-roasted': h(0, '3 oz', 3 * oz),
  'beef-ground-90-cooked': h(0.1, '3 oz', 3 * oz),
  'beef-ground-95-cooked': h(0.1, '3 oz', 3 * oz),
  'beef-steak-lean-cooked': h(0.1, '5 oz', 5 * oz),
  'lamb-leg-lean-roasted': low('upmc'),
  'pork-tenderloin-roasted': h(0.1, '5 oz', 5 * oz),
  'cod-cooked': h(0, '4 oz', 4 * oz),
  'shrimp-cooked': h(0.1, '3 oz', 3 * oz),
  'tuna-canned-water-drained': h(1.5, '3.5 oz', 3.5 * oz),
  'salmon-cooked': h(0.2, '4 oz', 4 * oz),
  'beef-liver-cooked': h(0.1, '4 oz', 4 * oz, 'The Wake Forest list gives 13.5 mg per 100 g; UPMC lists liver as moderate.'),
  'egg-whole-raw': h(0, '1 egg', 50),
  'egg-whole-boiled': h(0, '1 egg', 50),
  'milk-whole': h(0.5, '8 fl oz', 244),
  'milk-2': h(0.7, '8 fl oz', 244),
  'milk-1': h(0.5, '8 fl oz', 244),
  'milk-skim': h(0.7, '8 fl oz', 245),
  'greek-yogurt-nonfat': h(0.6, '5.3 oz', 150, 'UPMC lists yogurt as moderate.'),
  'greek-yogurt-lowfat': h(0.6, '5.3 oz', 150, 'UPMC lists yogurt as moderate.'),
  'greek-yogurt-whole': h(0.8, '6 oz', 6 * oz),
  'cottage-cheese-1': h(0, '1/2 cup', 113),
  'cottage-cheese-2': h(0.1, '1/2 cup', 113),
  'mozzarella-part-skim': h(0.1, '1 oz', oz),
  butter: h(0, '1 tsp', 4.7, 'The Wake Forest list gives 47.2 mg per 100 g.'),
  'whey-protein': h(1.5, '1 scoop', null),
  'rice-white-cooked': h(3.8, '1 cup', 158),
  'rice-short-cooked': h(3.8, '1 cup (long-grain value)', 158),
  'pasta-cooked': h(16.5, '1 cup spaghetti', 124, 'The UChicago list gives 11 mg per cup; UPMC lists plain pasta as low.'),
  'egg-noodles-cooked': low('upmc'),
  'potato-boiled': lab(24.3, 'honow-hesse-2002', 'Harvard 2023 lists 91.7 mg per baked potato with skin; lab values for peeled potato are lower.'),
  'potato-baked': lab(13, 'honow-hesse-2002', 'Harvard 2023 lists 91.7 mg per baked potato with skin.'),
  'potato-raw': lab(17.1, 'honow-hesse-2002', 'Harvard 2023 lists 91.7 mg per baked potato with skin.'),
  'potato-russet-raw': lab(17.1, 'honow-hesse-2002', 'Harvard 2023 lists 91.7 mg per baked potato with skin.'),
  'sweet-potato-baked': h(54.2, '1/2 cup', 100, 'Siener 2021 measured 495.6 mg per 100 g raw; the UChicago list gives 28 mg per cup.'),
  'oats-dry': h(0, '1 cup cooked', null, 'UPMC lists oatmeal as moderate.'),
  'rice-flour': { mg: 11, serving: '1 cup', servingG: 158, per100g: 7, src: 'uchicago' },
  'bread-sourdough': h(4.4, '1 slice (white bread)', null),
  'rice-cakes': { mg: 4, serving: '1 cake', servingG: 9, per100g: 44.4, src: 'uchicago' },
  banana: h(10.3, '1 banana', 118, 'The UChicago list gives 3 mg per banana; lab data about 7 mg per 100 g.'),
  orange: h(23.3, '1 orange', 131, 'Lab measurements give about 1.8 mg per 100 g; the UChicago list 29 mg per orange.'),
  'orange-juice': h(1.1, '6 fl oz', 186),
  apple: h(0.7, '1 apple', 182, 'UPMC lists apples as moderate.'),
  strawberries: h(1.2, '1/2 cup', 72),
  blueberries: h(18.5, '1/2 cup', 74, 'The UChicago list gives 2 mg per ½ cup; another list 0.1 mg per 100 g.'),
  raspberries: h(2.5, '1/2 cup', 61.5, 'The UChicago list gives 48 mg per cup; lab data 18.9 mg per 100 g.'),
  grapes: h(1.2, '1/2 cup', 75.5),
  watermelon: h(0.6, '1 slice', null),
  'dates-medjool': h(25.5, '5 dates (variety not stated)', null, 'The UChicago list gives 24 mg per single date.'),
  mango: h(0.3, '1/2 fruit', 168),
  kiwi: lab(19.3, 'nguyen-savage-2013', 'Other lab data 23 mg per 100 g; the UChicago list rates kiwi very high.'),
  'mixed-berries': { mg: null, serving: null, servingG: null, per100g: 10.3, src: 'derived', conflict: 'Built from Harvard values that other sources dispute for blueberries and raspberries.' },
  'spinach-raw': h(316.2, '1 cup', 30),
  'broccoli-cooked': h(6, '1/2 cup', 78),
  'pepper-red-raw': h(2.2, '2 rings', 20),
  'mushrooms-white-raw': h(0, '1 mushroom', 18),
  'carrots-raw': h(4.5, '1/2 large', 36, 'The UChicago list gives 15 mg per ½ large carrot; UPMC lists carrots as high.'),
  'tomato-raw': h(3.1, '2 slices', null),
  'cucumber-raw': h(1, '1/4 cucumber', 75),
  'onion-raw': h(2.1, '1 onion', 110),
  'lettuce-romaine': h(0.3, '1 cup', 47),
  garlic: h(0.4, '1 clove', 3),
  celery: h(7.6, '1/2 medium stalk', 20, 'The UChicago list gives 19 mg per ½ cup; UPMC lists celery as high.'),
  'spring-onion': h(0, '1 spring onion', 15),
  'lemon-juice': h(0.9, '1 tbsp', 15),
  'olive-oil': { mg: null, serving: null, servingG: null, per100g: 0, src: 'wake-forest' },
  honey: { mg: 0, serving: '1 tbsp', servingG: 21, per100g: 0, src: 'uchicago' },
  sugar: h(0, '1 tsp', 4.2),
  'maple-syrup': low('upmc'),
  ketchup: h(1.5, '1 tbsp', 17),
  'soy-sauce': h(2.9, '1 tbsp', 16, 'UPMC lists soy sauce as high.'),
  'peanut-butter': h(19.2, '1 tbsp', 16),
  almonds: h(72, '1 oz', oz, 'Oil-roasted almonds; the UChicago list gives 122 mg per ounce.'),
  'dark-chocolate': h(67.7, '1.5 oz', 1.5 * oz),
  'cocoa-powder': lab(619.3, 'siener-2021', 'Another list gives 951.5 mg per 100 g.'),
  cinnamon: low('upmc'),
  'graham-crackers': { mg: 2, serving: '1 large rectangle', servingG: 14, per100g: 14.3, src: 'uchicago' },
};

export type OxalateLevel = 'low' | 'moderate' | 'high' | 'very-high';
export const OXALATE_LABEL: Record<OxalateLevel, string> = { low: 'Low oxalate', moderate: 'Moderate oxalate', high: 'High oxalate', 'very-high': 'Very high oxalate' };

export const levelFor = (mg: number): OxalateLevel => (mg < 2 ? 'low' : mg <= 10 ? 'moderate' : mg <= 50 ? 'high' : 'very-high');

export interface OxalateEstimate { mg: number | null; level: OxalateLevel; info: OxalateInfo }

/**
 * Oxalate in an amount of a core food. `cookedFactor` converts a raw/dry weight to the cooked weight
 * the value refers to (from the USDA raw↔cooked pair). Null = no cited value for this food.
 */
export function oxalateFor(key: string, grams: number | null, opts: { pairKey?: string; cookedFactor?: number | null } = {}): OxalateEstimate | null {
  let info = OXALATE[key];
  let factor = 1;
  if (!info && opts.pairKey && OXALATE[opts.pairKey] && opts.cookedFactor) { info = OXALATE[opts.pairKey]; factor = opts.cookedFactor; }
  if (!info) return null;
  if (info.category) return { mg: null, level: 'low', info };
  if (info.per100g !== null && grams !== null) {
    const mg = (info.per100g * grams * factor) / 100;
    return { mg, level: levelFor(mg), info };
  }
  if (info.mg !== null) return { mg: null, level: levelFor(info.mg), info };
  return null;
}
