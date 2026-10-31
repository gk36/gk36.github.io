import type { Food, Quantity } from './food';
import { contribution } from './compute';

export type KeepMacro = 'protein' | 'carbs' | 'kcal';

/** Nutrients for exactly one basis (100 g, 100 mL or 1 unit), normalised like everything else. */
function perBasis(food: Food, macro: KeepMacro): number | undefined {
  const q: Quantity = food.basis.per === '100g' ? { amount: 100, unit: 'g' } : food.basis.per === '100ml' ? { amount: 100, unit: 'ml' } : { amount: 1, unit: 'portion', portionId: 'unit' };
  const c = contribution(food, q);
  return 'error' in c ? undefined : c.n[macro];
}

/**
 * Amount of `food` that delivers `target` of `macro` (e.g. swap 200 g raw chicken for the beef
 * that gives the same protein). Null when the replacement has none of that macro or it is unknown.
 */
export function swapQuantity(food: Food, macro: KeepMacro, target: number): Quantity | null {
  const per = perBasis(food, macro);
  if (per === undefined || per <= 0 || !(target > 0)) return null;
  const bases = target / per;
  if (food.basis.per === '100g') return { amount: Math.round(bases * 100), unit: 'g' };
  if (food.basis.per === '100ml') return { amount: Math.round(bases * 100), unit: 'ml' };
  return { amount: Math.round(bases * 10) / 10, unit: 'portion', portionId: 'unit' };
}
