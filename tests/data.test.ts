import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CarbmaxxDB, db, useDatabase } from '../src/data/db';
import { uuidv7 } from '../src/data/ids';
import {
  addEntry, copyEntries, ensureDay, getEntry, listDay, markEaten, moveEntry, restore, softDelete, updateDay, duplicateEntry,
} from '../src/data/entries';
import { defaultProfile, loadProfile, saveProfile } from '../src/data/profile';
import { exportAll, importBackup, parseBackup, PRE_IMPORT_KEY } from '../src/data/backup';
import {
  fetchLegacyCloudProfile, legacyToProfile, readLegacyLocal, sanitizeLegacySnapshot, archiveLegacyRaw,
  LEGACY_PROFILES_KEY, LEGACY_WORKOUTS_KEY,
} from '../src/data/legacy';
import { dayTotals } from '../src/domain/diary';
import type { Food } from '../src/domain/nutrition/food';

const chicken: Food = {
  id: 'fdc:171477', names: { en: 'Chicken breast (roasted)' }, kind: 'generic', group: 'protein', prep: 'roasted',
  basis: { per: '100g' }, portions: [], n: { kcal: 165, protein: 31.02, carbs: 0, fat: 3.57, fiber: 0 },
  carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high', fdcId: 171477 },
};
const potato: Food = {
  id: 'fdc:170438', names: { en: 'Potato (boiled, no skin)' }, kind: 'generic', group: 'starch', prep: 'boiled',
  basis: { per: '100g' }, portions: [], n: { kcal: 86, protein: 1.71, carbs: 20.01, fat: 0.1, fiber: 2 },
  carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high' },
};
const yogurt: Food = {
  id: 'custom:yog', names: { en: 'Greek yogurt 2%' }, brand: 'Test', kind: 'custom', group: 'dairy', prep: 'as-sold',
  basis: { per: '100g' }, portions: [], n: { kcal: 72, protein: 9.5, carbs: 3.8, fat: 2 },
  carbsIncludeFiber: false, kcalOrigin: 'label', src: { type: 'label', confidence: 'high' },
};

beforeEach(async () => {
  useDatabase(new CarbmaxxDB(`test-${uuidv7()}`));
  await saveProfile({ ...defaultProfile(), sex: 'male', weightKg: 73, heightCm: 174, ageYears: 18, onboarded: true });
});

describe('diary entries', () => {
  it('creates the day from default slots and lists entries in order', async () => {
    const day = await ensureDay('2026-10-30');
    expect(day.slots.map((s) => s.id)).toEqual(['breakfast', 'lunch', 'dinner', 'snacks']);
    await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: chicken, qty: { amount: 282, unit: 'g' }, status: 'eaten', origin: 'search' });
    await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: potato, qty: { amount: 336, unit: 'g' }, status: 'eaten', origin: 'search' });
    const rows = await listDay('2026-10-30');
    expect(rows.map((r) => r.foodId)).toEqual(['fdc:171477', 'fdc:170438']);
    const t = dayTotals(rows);
    expect(t.eaten.kcal.value).toBeCloseTo(2.82 * 165 + 3.36 * 86, 9);
    expect(t.eaten.protein.value).toBeCloseTo(2.82 * 31.02 + 3.36 * 1.71, 9);
  });

  it('planned food never counts as eaten; marking eaten moves it and keeps the plan', async () => {
    const e = await addEntry({ dayKey: '2026-10-30', slotId: 'breakfast', food: yogurt, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    let t = dayTotals(await listDay('2026-10-30'));
    expect(t.eaten.kcal.value).toBe(0);
    expect(t.planned.kcal.value).toBeCloseTo(144, 9);
    expect(t.projected.kcal.value).toBeCloseTo(144, 9);
    const done = await markEaten(e.id, { qty: { amount: 176, unit: 'g' } });
    expect(done.status).toBe('eaten');
    expect(done.planned?.qty).toEqual({ amount: 200, unit: 'g' });
    t = dayTotals(await listDay('2026-10-30'));
    expect(t.eaten.kcal.value).toBeCloseTo(126.72, 9);
    expect(t.planned.kcal.value).toBe(0);
  });

  it('delete + undo restores the same record', async () => {
    const e = await addEntry({ dayKey: '2026-10-30', slotId: 'snacks', food: chicken, qty: { amount: 50, unit: 'g' }, status: 'eaten', origin: 'quick' });
    await softDelete(e.id);
    expect(await listDay('2026-10-30')).toHaveLength(0);
    expect(await getEntry(e.id)).toBeUndefined();
    await restore(e.id);
    const back = await getEntry(e.id);
    expect(back?.id).toBe(e.id);
    expect(back?.rev).toBe(3);
  });

  it('duplicate and move create/relocate without touching other entries', async () => {
    const e = await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: potato, qty: { amount: 100, unit: 'g' }, status: 'eaten', origin: 'search' });
    const d = await duplicateEntry(e.id);
    expect(d.id).not.toBe(e.id);
    await moveEntry(d.id, 'dinner');
    const rows = await listDay('2026-10-30');
    expect(rows.find((r) => r.id === d.id)?.slotId).toBe('dinner');
    expect(rows.find((r) => r.id === e.id)?.slotId).toBe('lunch');
  });

  it('copying yesterday creates independent records, matching slots by name', async () => {
    await addEntry({ dayKey: '2026-10-29', slotId: 'dinner', food: chicken, qty: { amount: 200, unit: 'g' }, status: 'eaten', origin: 'search' });
    const src = await listDay('2026-10-29');
    const day29 = await ensureDay('2026-10-29');
    await updateDay('2026-10-30', { slots: [{ id: 'x1', name: 'Dinner' }] });
    const copies = await copyEntries(src, '2026-10-30', 'planned', day29.slots);
    expect(copies[0]?.slotId).toBe('x1');
    expect(copies[0]?.status).toBe('planned');
    await markEaten(copies[0]!.id, { qty: { amount: 150, unit: 'g' } });
    expect((await listDay('2026-10-29'))[0]?.qty).toEqual({ amount: 200, unit: 'g' });
  });

  it('a stored day target never changes when the profile changes later', async () => {
    await updateDay('2026-10-29', { targets: { kcal: 2954, protein: 161, carbs: 404, fat: 60, source: 'template', label: 'Slight Bulk', computedAt: new Date().toISOString() } });
    const p = await loadProfile();
    await saveProfile({ ...p, planner: { ...p.planner, goal: 'cut' }, weightKg: 70 });
    expect((await db().days.get('2026-10-29'))?.targets?.kcal).toBe(2954);
  });
});

describe('backup export / import', () => {
  it('export → wipe → import gives back identical data', async () => {
    await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: chicken, qty: { amount: 282, unit: 'g' }, status: 'eaten', origin: 'search' });
    await db().foods.put({ ...yogurt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rev: 1 });
    const file = await exportAll();
    const text = JSON.stringify(file);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await Promise.all([db().entries.clear(), db().days.clear(), db().foods.clear()]);
    await importBackup(parsed.file, 'replace');
    const again = await exportAll();
    expect(again.data.entries).toEqual(file.data.entries);
    expect(again.data.days).toEqual(file.data.days);
    expect(again.data.foods).toEqual(file.data.foods);
    expect(again.data.settings).toEqual(file.data.settings);
    expect(await db().settings.get(PRE_IMPORT_KEY)).toBeDefined();
  });

  it('rejects damaged files before writing anything', async () => {
    await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: chicken, qty: { amount: 100, unit: 'g' }, status: 'eaten', origin: 'search' });
    const file = await exportAll();
    (file.data.entries[0] as unknown as { qty: unknown }).qty = { amount: -5, unit: 'g' };
    const r = parseBackup(JSON.stringify(file));
    expect(r.ok).toBe(false);
    expect(parseBackup('{not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: 'other' })).ok).toBe(false);
    expect(await listDay('2026-10-30')).toHaveLength(1);
  });

  it('a failure mid-import rolls back everything', async () => {
    await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: chicken, qty: { amount: 100, unit: 'g' }, status: 'eaten', origin: 'search' });
    const file = await exportAll();
    const spy = vi.spyOn(db().foods, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(importBackup(file, 'replace')).rejects.toThrow();
    spy.mockRestore();
    expect(await listDay('2026-10-30')).toHaveLength(1);
  });

  it('merge keeps the newer copy of each record', async () => {
    const e = await addEntry({ dayKey: '2026-10-30', slotId: 'lunch', food: chicken, qty: { amount: 100, unit: 'g' }, status: 'eaten', origin: 'search' });
    const old = await exportAll();
    await new Promise((r) => setTimeout(r, 5));
    await db().entries.put({ ...e, qty: { amount: 150, unit: 'g' }, updatedAt: new Date().toISOString(), rev: 2 });
    await importBackup(old, 'merge');
    expect((await getEntry(e.id))?.qty).toEqual({ amount: 150, unit: 'g' });
  });
});

describe('legacy (v1) import — read-only', () => {
  const v1 = {
    gk: { kg: 300, cm: 174, age: 18, sex: 'male', act: 'moderate', goal: 'nonsense', cutStyle: 'performance', day: 'rest', timing: 'morning',
      eggs: 20, liver: 1, boneBroth: 0, breakfastCarbOn: true, dairyOn: false, milkMl: 5, pick: { '2:protein': 'chicken', 'evil<script>': 'x', '5:dairy_drink': 42 }, updatedAt: 123 },
    '<bad name>': { kg: 70 },
  };
  const storage = {
    getItem: (k: string) => (k === LEGACY_PROFILES_KEY ? JSON.stringify(v1) : k === LEGACY_WORKOUTS_KEY ? JSON.stringify({ gk: { days: [] } }) : null),
    setItem: () => { throw new Error('legacy storage must never be written'); },
    removeItem: () => { throw new Error('legacy storage must never be written'); },
  };

  it('reads and clamps exactly like v1 applySnapshot, dropping invalid names and picks', () => {
    const r = readLegacyLocal(storage);
    expect(Object.keys(r.profiles)).toEqual(['gk']);
    const p = r.profiles.gk!;
    expect(p.kg).toBe(160);
    expect(p.eggs).toBe(8);
    expect(p.milkMl).toBe(50);
    expect(p.goal).toBe('slight_bulk');
    expect(p.cutStyle).toBe('performance');
    expect(p.day).toBe('rest');
    expect(p.liver).toBe(true);
    expect(p.pick).toEqual({ '2:protein': 'chicken' });
    expect(r.workoutNames).toEqual(['gk']);
  });

  it('missing fields fall back to v1 defaults', () => {
    const s = sanitizeLegacySnapshot({ kg: 80 });
    expect(s.kg).toBe(80);
    expect(s.breakfastCarbOn).toBe(true);
    expect(s.timing).toBe('standard');
  });

  it('maps into the new profile and archives the raw data idempotently', async () => {
    const r = readLegacyLocal(storage);
    const prof = legacyToProfile(r.profiles.gk!, defaultProfile(), 'gk');
    expect(prof.weightKg).toBe(160);
    expect(prof.ageYears).toBe(18);
    expect(prof.defaultDayType).toBe('rest');
    expect(prof.planner.timing).toBe('morning');
    expect(prof.legacyProfileName).toBe('gk');
    await archiveLegacyRaw(r);
    await archiveLegacyRaw(r);
    expect(await db().legacy.count()).toBe(2);
  });

  it('cloud import fetches ONE named profile, never the whole collection', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ kg: 73, cm: 174, age: 18 })); }) as unknown as typeof fetch;
    const s = await fetchLegacyCloudProfile('gk36', fake);
    expect(s?.kg).toBe(73);
    expect(calls).toEqual(['https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app/carbmaxx/profiles/gk36.json']);
    await expect(fetchLegacyCloudProfile('../profiles', fake)).rejects.toThrow();
    await expect(fetchLegacyCloudProfile('', fake)).rejects.toThrow();
  });
});
