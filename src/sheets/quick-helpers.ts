export { defaultQuantity, describeQuantity } from '../domain/nutrition/quantity';

export function minutesOfDayLabel(d = new Date()): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
