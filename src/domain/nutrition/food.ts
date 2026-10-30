import type { NutrientId } from './nutrients';

/** Nutrient amounts per the food's basis. A missing key means UNKNOWN — never zero. */
export type NutrientMap = Partial<Record<NutrientId, number>>;

export type Prep =
  | 'raw' | 'dry' | 'boiled' | 'roasted' | 'pan-cooked' | 'baked' | 'grilled'
  | 'drained' | 'as-sold' | 'prepared';

export const PREP_LABEL: Record<Prep, string> = {
  raw: 'raw', dry: 'dry', boiled: 'boiled', roasted: 'roasted', 'pan-cooked': 'pan-cooked',
  baked: 'baked', grilled: 'grilled', drained: 'drained', 'as-sold': 'as sold', prepared: 'prepared',
};

export type FoodGroup = 'protein' | 'dairy' | 'starch' | 'fruit' | 'veg' | 'fat' | 'sweet' | 'drink' | 'other';

/** What one "basis" of nutrient values refers to. */
export type Basis =
  | { per: '100g' }
  | { per: '100ml' }
  | { per: 'unit'; unitLabel: string; unitG?: number };

export type SourceType = 'usda-fdc' | 'label' | 'off' | 'user' | 'estimate' | 'proxy' | 'legacy-v1';

export interface Source {
  type: SourceType;
  confidence: 'high' | 'medium' | 'low';
  dataset?: string;
  fdcId?: number;
  ref?: string;
  release?: string;
  verifiedAt?: string;
  note?: string;
}

export interface Portion {
  id: string;
  label: string;
  g?: number;
  ml?: number;
}

export interface Food {
  id: string;
  names: { en: string; el?: string; aliases?: string[] };
  kind: 'generic' | 'branded' | 'custom';
  brand?: string;
  gtin?: string;
  group: FoodGroup;
  prep: Prep;
  basis: Basis;
  densityGPerMl?: number;
  portions: Portion[];
  n: NutrientMap;
  /** Per-nutrient USDA derivation codes (e.g. "A" analytical, "Z" assumed zero) — see core.meta.json. */
  nd?: Partial<Record<NutrientId, string>>;
  /**
   * true = carbs is TOTAL carbohydrate including fibre (USDA / US labels);
   * false = carbs EXCLUDES fibre (EU labels, incl. Greek packaging).
   */
  carbsIncludeFiber: boolean;
  /** Where the kcal value came from — label/database values are never overwritten by 4/4/9 math. */
  kcalOrigin: 'label' | 'database' | 'computed';
  src: Source;
  /** Raw/cooked counterpart (core foods). */
  pair?: string;
  notes?: string;
  /** For label entries converted from "per serving": what the label actually showed. */
  labelServing?: { label: string; g?: number; ml?: number };
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  rev?: number;
}

export type Quantity =
  | { amount: number; unit: 'g' }
  | { amount: number; unit: 'ml' }
  | { amount: number; unit: 'portion'; portionId: string };

export function displayName(f: Pick<Food, 'names' | 'brand'>, lang: 'en' | 'el' = 'en'): string {
  const base = (lang === 'el' && f.names.el) || f.names.en;
  return f.brand ? `${f.brand} ${base}` : base;
}
