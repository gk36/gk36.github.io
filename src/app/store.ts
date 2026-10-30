import { computed, signal } from '@preact/signals';
import type { Profile } from '../data/types';
import { loadProfile, saveProfile } from '../data/profile';
import { nowIso } from '../data/ids';
import { dayKeyFor, type DayKey } from '../domain/time';
import type { Food } from '../domain/nutrition/food';
import type { FoodSnapshot } from '../data/types';
import type { NutrientId } from '../domain/nutrition/nutrients';

/* ---------- profile ---------- */
export const profile = signal<Profile | null>(null);

export async function initProfile(): Promise<Profile> {
  const p = await loadProfile();
  profile.value = p;
  applyTheme(p.theme);
  return p;
}

/**
 * Applies a change to the in-memory profile SYNCHRONOUSLY, then queues the write. Rapid edits
 * (typing age then height) therefore always build on each other — none is lost — and writes
 * reach IndexedDB in order. Pass a function to derive nested fields (planner) from the latest state.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
export function updateProfile(patch: Partial<Profile> | ((prev: Profile) => Partial<Profile>)): Promise<Profile> {
  const cur = profile.value;
  if (!cur) return loadProfile().then((p) => { profile.value = p; return updateProfile(patch); });
  const delta = typeof patch === 'function' ? patch(cur) : patch;
  const next: Profile = { ...cur, ...delta, updatedAt: nowIso() };
  profile.value = next;
  if (delta.theme) applyTheme(delta.theme);
  const write = writeQueue.then(() => saveProfile(next));
  writeQueue = write.catch((e: unknown) => console.error('profile save failed', e));
  return write.then(() => next);
}

/** Updates planner preferences from the latest state (safe under rapid successive changes). */
export const updatePlanner = (patch: Partial<Profile['planner']>) =>
  updateProfile((prev) => ({ planner: { ...prev.planner, ...patch, pick: { ...prev.planner.pick, ...(patch.pick ?? {}) } } }));

export function applyTheme(theme: Profile['theme']): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/* ---------- clock / today ---------- */
export const now = signal(Date.now());
if (typeof window !== 'undefined') {
  setInterval(() => { now.value = Date.now(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) now.value = Date.now(); });
}

export const todayKey = computed<DayKey>(() => {
  const p = profile.value;
  return dayKeyFor(now.value, p?.timezone ?? 'Europe/Athens', p?.dayStartHour ?? 4);
});

/* ---------- sheets (one at a time) ---------- */
export type SheetState =
  | { kind: 'quicklog'; dayKey: DayKey; slotId?: string; status?: 'eaten' | 'planned'; query?: string; food?: Food; text?: string }
  | { kind: 'entry'; entryId: string }
  | { kind: 'food'; food: Food | FoodSnapshot; dayKey?: DayKey; slotId?: string }
  | { kind: 'food-editor'; foodId?: string; prefill?: Partial<Food>; thenLog?: { dayKey: DayKey; slotId?: string } }
  | { kind: 'copy-day'; toDay: DayKey }
  | { kind: 'saved-meal'; mealId?: string; fromEntries?: string[]; dayKey?: DayKey }
  | { kind: 'swap'; entryId: string }
  | { kind: 'slots'; dayKey: DayKey }
  | { kind: 'nutrient'; id: NutrientId; dayKey: DayKey; range: 'day' | 'week' }
  | { kind: 'scan'; dayKey: DayKey; slotId?: string }
  | { kind: 'recipe'; foodId?: string }
  | { kind: 'cook'; recipeId: string }
  | { kind: 'replan'; dayKey: DayKey }
  | { kind: 'ideas'; dayKey: DayKey; slotId?: string }
  | { kind: 'pantry-item'; itemId?: string; food?: Food | FoodSnapshot };

export const sheet = signal<SheetState | null>(null);
/** What is typed in Today's "What did you eat?" box — kept until it is logged. */
export const draftText = signal('');
/**
 * Set while the user scans or enters a food that a typed meal didn't know. The next food chosen for
 * logging is remembered for that phrase and the user lands back on their typed list.
 */
export const typedResume = signal<{ text: string; phrase: string; dayKey: DayKey } | null>(null);
export const openSheet = (s: SheetState) => {
  const r = typedResume.value;
  if (r && s.kind === 'quicklog' && s.food && !s.text) {
    typedResume.value = null;
    const id = s.food.id;
    void updateProfile((p) => ({ phrases: { ...(p.phrases ?? {}), [r.phrase]: id } }));
    sheet.value = { kind: 'quicklog', dayKey: r.dayKey, text: r.text };
    return;
  }
  sheet.value = s;
};
export const closeSheet = () => { sheet.value = null; typedResume.value = null; };

/* ---------- toasts ---------- */
export interface Toast { id: number; text: string; action?: { label: string; run: () => void | Promise<void> }; tone?: 'ok' | 'warn' | 'error' }
export const toasts = signal<Toast[]>([]);
let toastSeq = 0;
export function toast(text: string, opts: { action?: Toast['action']; tone?: Toast['tone']; ms?: number } = {}): void {
  const id = ++toastSeq;
  const t: Toast = { id, text };
  if (opts.action) t.action = opts.action;
  if (opts.tone) t.tone = opts.tone;
  toasts.value = [...toasts.value.slice(-2), t];
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 9000 : 3200));
}
export const dismissToast = (id: number) => { toasts.value = toasts.value.filter((t) => t.id !== id); };
