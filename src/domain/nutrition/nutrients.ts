/**
 * Nutrient dictionary — the single source of truth for every nutrient the app knows.
 *
 * Units are canonical per nutrient and match USDA FoodData Central's native unit, so imported
 * values are never converted (DRI targets are converted to these units instead).
 * An absent value always means UNKNOWN, never zero.
 */

export const NUTRIENT_IDS = [
  'kcal', 'protein', 'carbs', 'fat',
  'fiber', 'sugars', 'satFat', 'monoFat', 'polyFat', 'transFat', 'cholesterol',
  'sodium', 'potassium', 'calcium', 'magnesium', 'phosphorus', 'iron', 'zinc', 'copper', 'manganese', 'selenium', 'iodine',
  'vitA', 'retinol', 'vitC', 'vitD', 'vitE', 'vitK', 'thiamin', 'riboflavin', 'niacin', 'pantothenic', 'vitB6', 'biotin', 'folate', 'vitB12', 'choline',
  'epa', 'dha', 'ala', 'water', 'alcohol', 'caffeine', 'oxalate',
] as const;

export type NutrientId = (typeof NUTRIENT_IDS)[number];
export type Unit = 'kcal' | 'g' | 'mg' | 'µg';
export type NutrientGroup = 'energy' | 'macro' | 'detail' | 'mineral' | 'vitamin' | 'other';

export interface NutrientDef {
  id: NutrientId;
  label: string;
  short: string;
  unit: Unit;
  group: NutrientGroup;
  /** FoodData Central nutrient ids, in order of preference. */
  fdc: readonly number[];
  /** Decimal places used for display at typical magnitudes. */
  decimals: number;
  note?: string;
}

const def = (
  id: NutrientId, label: string, short: string, unit: Unit, group: NutrientGroup,
  fdc: readonly number[], decimals: number, note?: string,
): NutrientDef => (note === undefined ? { id, label, short, unit, group, fdc, decimals } : { id, label, short, unit, group, fdc, decimals, note });

export const NUTRIENTS: Readonly<Record<NutrientId, NutrientDef>> = {
  kcal: def('kcal', 'Energy', 'kcal', 'kcal', 'energy', [1008, 2048, 2047], 0,
    'Label or USDA energy. USDA "Atwater specific" (2048) is preferred over "general" (2047) when 1008 is absent.'),
  protein: def('protein', 'Protein', 'Protein', 'g', 'macro', [1003], 1),
  carbs: def('carbs', 'Carbohydrate', 'Carbs', 'g', 'macro', [1005, 1050], 1, 'Total carbohydrate (by difference; by summation if that is all USDA has).'),
  fat: def('fat', 'Fat', 'Fat', 'g', 'macro', [1004, 1085], 1),
  fiber: def('fiber', 'Fibre', 'Fibre', 'g', 'detail', [1079, 2033], 1),
  sugars: def('sugars', 'Sugars', 'Sugars', 'g', 'detail', [2000, 1063], 1),
  satFat: def('satFat', 'Saturated fat', 'Sat. fat', 'g', 'detail', [1258], 1),
  monoFat: def('monoFat', 'Monounsaturated fat', 'Mono', 'g', 'detail', [1292], 1),
  polyFat: def('polyFat', 'Polyunsaturated fat', 'Poly', 'g', 'detail', [1293], 1),
  transFat: def('transFat', 'Trans fat', 'Trans', 'g', 'detail', [1257], 2),
  cholesterol: def('cholesterol', 'Cholesterol', 'Chol.', 'mg', 'detail', [1253], 0),
  sodium: def('sodium', 'Sodium', 'Sodium', 'mg', 'mineral', [1093], 0, 'Labels list salt; sodium = salt ÷ 2.5.'),
  potassium: def('potassium', 'Potassium', 'Potassium', 'mg', 'mineral', [1092], 0),
  calcium: def('calcium', 'Calcium', 'Calcium', 'mg', 'mineral', [1087], 0),
  magnesium: def('magnesium', 'Magnesium', 'Magnesium', 'mg', 'mineral', [1090], 0),
  phosphorus: def('phosphorus', 'Phosphorus', 'Phosphorus', 'mg', 'mineral', [1091], 0),
  iron: def('iron', 'Iron', 'Iron', 'mg', 'mineral', [1089], 1),
  zinc: def('zinc', 'Zinc', 'Zinc', 'mg', 'mineral', [1095], 1),
  copper: def('copper', 'Copper', 'Copper', 'mg', 'mineral', [1098], 2),
  manganese: def('manganese', 'Manganese', 'Manganese', 'mg', 'mineral', [1101], 2),
  selenium: def('selenium', 'Selenium', 'Selenium', 'µg', 'mineral', [1103], 1),
  iodine: def('iodine', 'Iodine', 'Iodine', 'µg', 'mineral', [1100], 0, 'Rarely measured; usually unknown.'),
  vitA: def('vitA', 'Vitamin A (RAE)', 'Vit A', 'µg', 'vitamin', [1106], 0, 'Retinol activity equivalents (RAE), not IU.'),
  retinol: def('retinol', 'Retinol (preformed vitamin A)', 'Retinol', 'µg', 'vitamin', [1105], 0,
    'Preformed vitamin A (liver, dairy, eggs). The upper limit applies to this, not to carotenoids.'),
  vitC: def('vitC', 'Vitamin C', 'Vit C', 'mg', 'vitamin', [1162], 1),
  vitD: def('vitD', 'Vitamin D', 'Vit D', 'µg', 'vitamin', [1114], 1, 'µg (1 µg = 40 IU).'),
  vitE: def('vitE', 'Vitamin E (α-tocopherol)', 'Vit E', 'mg', 'vitamin', [1109], 1),
  vitK: def('vitK', 'Vitamin K (phylloquinone)', 'Vit K', 'µg', 'vitamin', [1185], 1),
  thiamin: def('thiamin', 'Thiamin (B1)', 'B1', 'mg', 'vitamin', [1165], 2),
  riboflavin: def('riboflavin', 'Riboflavin (B2)', 'B2', 'mg', 'vitamin', [1166], 2),
  niacin: def('niacin', 'Niacin (B3, preformed)', 'B3', 'mg', 'vitamin', [1167], 1,
    'USDA lists preformed niacin; targets use niacin equivalents, so coverage is understated.'),
  pantothenic: def('pantothenic', 'Pantothenic acid (B5)', 'B5', 'mg', 'vitamin', [1170], 2),
  vitB6: def('vitB6', 'Vitamin B6', 'B6', 'mg', 'vitamin', [1175], 2),
  biotin: def('biotin', 'Biotin (B7)', 'B7', 'µg', 'vitamin', [1176], 1, 'Rarely measured; usually unknown.'),
  folate: def('folate', 'Folate (DFE)', 'Folate', 'µg', 'vitamin', [1190], 0, 'Dietary folate equivalents.'),
  vitB12: def('vitB12', 'Vitamin B12', 'B12', 'µg', 'vitamin', [1178], 2),
  choline: def('choline', 'Choline', 'Choline', 'mg', 'vitamin', [1180], 0),
  epa: def('epa', 'EPA (omega-3)', 'EPA', 'g', 'other', [1278], 2),
  dha: def('dha', 'DHA (omega-3)', 'DHA', 'g', 'other', [1272], 2),
  ala: def('ala', 'ALA (omega-3)', 'ALA', 'g', 'other', [1404], 2),
  water: def('water', 'Water', 'Water', 'g', 'other', [1051], 1),
  alcohol: def('alcohol', 'Alcohol', 'Alcohol', 'g', 'other', [1018], 1),
  caffeine: def('caffeine', 'Caffeine', 'Caffeine', 'mg', 'other', [1057], 0),
  oxalate: def('oxalate', 'Oxalate', 'Oxalate', 'mg', 'other', [1041], 0,
    'Only shown where a cited measurement exists; otherwise unknown.'),
};

export const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const satisfies readonly NutrientId[];

export const isNutrientId = (x: string): x is NutrientId => (NUTRIENT_IDS as readonly string[]).includes(x);

/** Converts an amount between mass units. Energy is never converted. */
export function convertUnit(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  const scale: Record<Exclude<Unit, 'kcal'>, number> = { g: 1, mg: 1e-3, 'µg': 1e-6 };
  if (from === 'kcal' || to === 'kcal') throw new Error(`cannot convert ${from} to ${to}`);
  return (value * scale[from]) / scale[to];
}
