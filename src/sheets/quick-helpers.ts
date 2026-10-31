import type { Slot } from '../data/types';

export { defaultQuantity, describeQuantity } from '../domain/nutrition/quantity';

/** The meal that fits the time of day. */
export function guessSlot(slots: readonly Slot[], d = new Date()): string {
  const h = d.getHours();
  const want = h < 11 ? /breakfast|morning|first/i : h < 16 ? /lunch|pre|post-gym meal|midday/i : h < 22 ? /dinner|feast|evening|re-feed/i : /snack/i;
  return (slots.find((s) => want.test(s.name)) ?? slots[0])?.id ?? 'snacks';
}

export function minutesOfDayLabel(d = new Date()): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
