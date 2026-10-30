import { sheet } from '../app/store';
import { QuickLog } from './QuickLog';
import { EntryEditor } from './EntryEditor';
import { FoodDetail } from './FoodDetail';
import { FoodEditor } from './FoodEditor';
import { SwapSheet } from './SwapSheet';
import { CopyDaySheet, SavedMealSheet, SlotsSheet } from './SmallSheets';
import { NutrientSheet } from './NutrientSheet';
import { ScanSheet } from './ScanSheet';
import { CookSheet, RecipeEditor } from './RecipeSheets';
import { useAsync } from '../ui/hooks';
import { Sheet } from '../ui/Sheet';
import { closeSheet } from '../app/store';
import type { DayKey } from '../domain/time';
import { PantryItemSheet } from './PantryItemSheet';

/** Renders the one open sheet. Keyed so switching sheets remounts cleanly (focus, state). */
export function SheetHost() {
  const s = sheet.value;
  if (!s) return null;
  const key = `${s.kind}-${JSON.stringify(s).length}-${'entryId' in s ? s.entryId : ''}`;
  switch (s.kind) {
    case 'quicklog': return <QuickLog key={key} dayKey={s.dayKey} {...(s.slotId ? { slotId: s.slotId } : {})} {...(s.status ? { status: s.status } : {})} {...(s.query ? { query: s.query } : {})} {...(s.food ? { food: s.food } : {})} {...(s.text ? { text: s.text } : {})} />;
    case 'entry': return <EntryEditor key={key} entryId={s.entryId} />;
    case 'food': return <FoodDetail key={key} food={s.food} {...(s.dayKey ? { dayKey: s.dayKey } : {})} {...(s.slotId ? { slotId: s.slotId } : {})} />;
    case 'food-editor': return <FoodEditor key={key} {...(s.foodId ? { foodId: s.foodId } : {})} {...(s.prefill ? { prefill: s.prefill } : {})} {...(s.thenLog ? { thenLog: s.thenLog } : {})} />;
    case 'swap': return <SwapSheet key={key} entryId={s.entryId} />;
    case 'copy-day': return <CopyDaySheet key={key} toDay={s.toDay} />;
    case 'saved-meal': return <SavedMealSheet key={key} {...(s.mealId ? { mealId: s.mealId } : {})} {...(s.fromEntries ? { fromEntries: s.fromEntries } : {})} />;
    case 'slots': return <SlotsSheet key={key} dayKey={s.dayKey} />;
    case 'nutrient': return <NutrientSheet key={`${key}-${s.id}`} id={s.id} dayKey={s.dayKey} range={s.range} />;
    case 'scan': return <ScanSheet key={key} dayKey={s.dayKey} {...(s.slotId ? { slotId: s.slotId } : {})} />;
    case 'recipe': return <RecipeEditor key={`${key}-${s.foodId ?? 'new'}`} {...(s.foodId ? { foodId: s.foodId } : {})} />;
    case 'cook': return <CookSheet key={`${key}-${s.recipeId}`} recipeId={s.recipeId} />;
    case 'replan': return <LazyReplan key={key} dayKey={s.dayKey} />;
    case 'pantry-item': return <PantryItemSheet key={`${key}-${s.itemId ?? s.food?.id ?? 'new'}`} {...(s.itemId ? { itemId: s.itemId } : {})} {...(s.food ? { food: s.food } : {})} />;
  }
}

/** The replan sheet carries the LP solver, so it is fetched on first use. */
function LazyReplan({ dayKey }: { dayKey: DayKey }) {
  const mod = useAsync(() => import('./ReplanSheet'), []);
  return mod ? <mod.ReplanSheet dayKey={dayKey} /> : <Sheet title="Replan the rest of today" onClose={closeSheet}><p class="muted">Loading…</p></Sheet>;
}
