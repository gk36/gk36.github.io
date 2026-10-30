import type { Food } from '../nutrition/food';

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Equipment = 'hob' | 'oven' | 'microwave' | 'airfryer' | 'blender' | 'kettle';

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  hob: 'Hob / stove', oven: 'Oven', microwave: 'Microwave', airfryer: 'Air fryer', blender: 'Blender', kettle: 'Kettle',
};

export interface TastePrefs {
  /** Foods never suggested: food ids ("core:broccoli-raw") or plain words ("cabbage"). */
  avoid: string[];
  /** Breakfast ideas lean sweet (protein pancakes, cream of rice, oats, cheesecake bowls). */
  sweetBreakfast: boolean;
  highProtein: boolean;
  equipment: Equipment[];
  /** How much total fat a meal may carry. */
  fat: 'low' | 'moderate' | 'flexible';
  /** Saturated fat ceiling, as a share of the meal's calories. */
  satFatPct: number;
  /** Prefer lower-oxalate foods where cited data exist. */
  lowOxalate: boolean;
  /** The preferences card has been seen and saved. */
  confirmed: boolean;
}

/** Starting point, shown for checking the first time meal ideas open. */
export const DEFAULT_TASTE: TastePrefs = {
  avoid: ['broccoli', 'cabbage'], sweetBreakfast: true, highProtein: true, equipment: ['hob', 'oven', 'microwave', 'blender'],
  fat: 'moderate', satFatPct: 10, lowOxalate: true, confirmed: false,
};

/** Share of a meal's calories that may come from fat. */
export const FAT_SHARE: Record<TastePrefs['fat'], number> = { low: 0.2, moderate: 0.3, flexible: 0.4 };

export type AmountUnit = 'g' | 'ml' | 'piece';

/** One food a role may use, with the range that makes a sensible single serving. */
export interface Option {
  /** Core food key ("cream-of-rice-dry"), or "match:<words>" for a food of the user's own (their sweet chili sauce). */
  food: string;
  min: number;
  max: number;
  typical: number;
  unit?: AmountUnit;
  /** Short name used in the instructions ("cream of rice"); plural for counted foods ("eggs"). */
  label: string;
  /** Singular for counted foods ("egg"). */
  labelOne?: string;
  /** Set once the range has been scaled to the meal's size (see portionScale). */
  scaledBy?: number;
}

export interface Role {
  key: string;
  label: string;
  options: Option[];
  /** May be left out (amount 0) when it doesn't help. */
  optional?: boolean;
}

/** A role filled with a food and an amount, as the instructions see it. */
export interface Chosen {
  food: Food;
  amount: number;
  unit: AmountUnit;
  label: string;
  /** "60 g", "150 mL", "2". */
  qtyText: string;
  /** "60 g cream of rice". */
  text: string;
}

export type ChosenMap = Partial<Record<string, Chosen>>;

export interface Blueprint {
  id: string;
  name: string;
  meals: MealKind[];
  taste: 'sweet' | 'savory';
  /** Hands-on plus cooking time. */
  minutes: number;
  /** Any one of these sets of equipment is enough ([] = no cooking). */
  needs: Equipment[][];
  roles: Role[];
  steps: (c: ChosenMap) => string[];
  /** Needs doing ahead ("the night before"). */
  ahead?: string;
  tip?: string;
}
