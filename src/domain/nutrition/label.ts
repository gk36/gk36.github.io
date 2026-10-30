import { NUTRIENTS, type NutrientId } from './nutrients';
import type { Basis, Food, NutrientMap } from './food';
import { energyCheck } from './compute';

/** kJ per kcal (EU Regulation 1169/2011 uses 4.184). */
export const KJ_PER_KCAL = 4.184;
/** Sodium (mg) per gram of salt — EU labels declare salt = sodium × 2.5. */
export const SODIUM_MG_PER_G_SALT = 400;

export const saltToSodiumMg = (saltG: number): number => saltG * SODIUM_MG_PER_G_SALT;
export const sodiumMgToSalt = (sodiumMg: number): number => sodiumMg / SODIUM_MG_PER_G_SALT;

export interface LabelInput {
  name: string;
  brand?: string;
  flavour?: string;
  gtin?: string;
  /** What the column on the label refers to. */
  basis: 'per100g' | 'per100ml' | 'perServing';
  servingLabel?: string;
  servingG?: number;
  servingMl?: number;
  /** 'eu': carbohydrate excludes fibre (Greek/EU labels). 'us': total carbohydrate. */
  region: 'eu' | 'us';
  energyKcal?: number;
  energyKj?: number;
  fat?: number;
  satFat?: number;
  carbs?: number;
  sugars?: number;
  fiber?: number;
  protein?: number;
  salt?: number;
  sodiumMg?: number;
  /** Optional extra nutrients in canonical units, per the same column. */
  extra?: Partial<Record<NutrientId, number>>;
  densityGPerMl?: number;
  prep?: Food['prep'];
  group?: Food['group'];
  notes?: string;
}

export interface LabelResult {
  basis: Basis;
  n: NutrientMap;
  labelServing?: Food['labelServing'];
  errors: string[];
  warnings: string[];
  derived: string[];
}

const nonNeg = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v >= 0;

/**
 * Turns label values (as printed) into canonical per-100 g / per-100 mL / per-unit nutrients.
 * Never invents a value: anything not on the label stays unknown.
 */
export function normalizeLabel(input: LabelInput): LabelResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const derived: string[] = [];
  const col: NutrientMap = {};

  // Energy: kcal preferred; kJ converted only when kcal is absent.
  if (nonNeg(input.energyKcal)) {
    col.kcal = input.energyKcal;
    if (nonNeg(input.energyKj)) {
      const fromKj = input.energyKj / KJ_PER_KCAL;
      if (Math.abs(fromKj - input.energyKcal) > Math.max(2, 0.03 * input.energyKcal)) {
        warnings.push(`kJ (${input.energyKj}) and kcal (${input.energyKcal}) on the label disagree; kcal is used.`);
      }
    }
  } else if (nonNeg(input.energyKj)) {
    col.kcal = input.energyKj / KJ_PER_KCAL;
    derived.push('kcal calculated from kJ (÷ 4.184)');
  } else {
    errors.push('Energy (kcal or kJ) is required.');
  }

  const macro = (k: 'fat' | 'satFat' | 'carbs' | 'sugars' | 'fiber' | 'protein') => {
    const v = input[k];
    if (v === undefined) return;
    if (!nonNeg(v)) errors.push(`${NUTRIENTS[k].label} must be zero or more.`);
    else col[k] = v;
  };
  macro('fat'); macro('satFat'); macro('carbs'); macro('sugars'); macro('fiber'); macro('protein');

  if (nonNeg(input.sodiumMg)) {
    col.sodium = input.sodiumMg;
    if (nonNeg(input.salt) && Math.abs(saltToSodiumMg(input.salt) - input.sodiumMg) > Math.max(20, 0.1 * input.sodiumMg)) {
      warnings.push('Salt and sodium on the label do not match (salt = sodium × 2.5); sodium is used.');
    }
  } else if (nonNeg(input.salt)) {
    col.sodium = saltToSodiumMg(input.salt);
    derived.push('sodium calculated from salt (salt ÷ 2.5)');
  }

  for (const [k, v] of Object.entries(input.extra ?? {}) as [NutrientId, number | undefined][]) {
    if (v === undefined) continue;
    if (!nonNeg(v)) errors.push(`${NUTRIENTS[k].label} must be zero or more.`);
    else col[k] = v;
  }

  if (col.protein === undefined || col.carbs === undefined || col.fat === undefined) {
    warnings.push('Protein, carbohydrate or fat is missing — those stay unknown, not zero.');
  }
  if (col.sugars !== undefined && col.carbs !== undefined && col.sugars > col.carbs + 0.05) errors.push('Sugars cannot exceed carbohydrate.');
  if (col.satFat !== undefined && col.fat !== undefined && col.satFat > col.fat + 0.05) errors.push('Saturated fat cannot exceed fat.');

  // Convert the label column to the canonical basis.
  let basis: Basis;
  let factor = 1;
  let labelServing: Food['labelServing'];
  if (input.basis === 'per100g') basis = { per: '100g' };
  else if (input.basis === 'per100ml') basis = { per: '100ml' };
  else {
    const label = input.servingLabel?.trim() || 'serving';
    if (nonNeg(input.servingG) && input.servingG > 0) {
      basis = { per: '100g' };
      factor = 100 / input.servingG;
      labelServing = { label, g: input.servingG };
    } else if (nonNeg(input.servingMl) && input.servingMl > 0) {
      basis = { per: '100ml' };
      factor = 100 / input.servingMl;
      labelServing = { label, ml: input.servingMl };
    } else {
      basis = { per: 'unit', unitLabel: label };
      labelServing = { label };
      warnings.push('No serving weight given — this food can only be logged in whole servings.');
    }
  }
  const n: NutrientMap = {};
  for (const [k, v] of Object.entries(col) as [NutrientId, number][]) n[k] = v * factor;

  // Plausibility per 100 g / 100 mL (only checkable when the basis is mass/volume).
  if (basis.per !== 'unit') {
    const solids = (n.protein ?? 0) + (n.carbs ?? 0) + (n.fat ?? 0) + (input.region === 'eu' ? (n.fiber ?? 0) : 0);
    if (basis.per === '100g' && solids > 102) errors.push('Protein + carbohydrate + fat add up to more than 100 g per 100 g — check the column or serving size.');
    if (n.kcal !== undefined && n.kcal > 910) errors.push('More than 900 kcal per 100 is impossible — check kJ vs kcal or the serving size.');
  }

  const check = energyCheck({ n, carbsIncludeFiber: input.region === 'us' }, 'label');
  if (check?.mismatch) {
    warnings.push(`Label energy ${Math.round(check.stated)} kcal vs ${Math.round(check.computed)} kcal from the macros — check the label. The label value is kept.`);
  }

  return labelServing ? { basis, n, labelServing, errors, warnings, derived } : { basis, n, errors, warnings, derived };
}
