import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CarbmaxxDB, db, useDatabase } from '../src/data/db';
import { uuidv7 } from '../src/data/ids';
import { addEntry, getEntry, listDay, softDelete, updateEntry } from '../src/data/entries';
import { defaultProfile, loadProfile, saveProfile } from '../src/data/profile';
import { exportAll } from '../src/data/backup';
import { addPantryItem, listPantry } from '../src/data/pantry';
import { RejectedError, syncNow, type RemoteRecord, type SyncTable, type Transport } from '../src/data/sync/engine';
import { AuthError, freshSession, signInWithPassword, signUpWithPassword } from '../src/data/sync/auth';
import type { Food } from '../src/domain/nutrition/food';
import type { LogEntry } from '../src/data/types';

/** In-memory stand-in for the Realtime Database with the same rules as docs/firebase-rules-v2.json. */
class FakeServer {
  data: Record<string, Partial<Record<SyncTable, Record<string, RemoteRecord>>>> = {};
  clock = 1000;
  writes = 0;
  as(signedIn: string, folder = signedIn): Transport {
    const deny = () => { if (signedIn !== folder) throw new Error('Permission denied'); };
    return {
      list: async (table, after) => {
        deny();
        const t = this.data[folder]?.[table] ?? {};
        return Object.fromEntries(Object.entries(t).filter(([, r]) => r.s >= after).map(([k, r]) => [k, { ...r }]));
      },
      write: async (rows) => {
        deny();
        for (const [path, rec] of Object.entries(rows)) {
          const [table, id] = path.split('/') as [SyncTable, string];
          const cur = this.data[folder]?.[table]?.[id];
          if (cur && !(rec.u > cur.u || (rec.u === cur.u && rec.r >= cur.r))) throw new RejectedError('older');
        }
        const s = ++this.clock;
        this.writes += 1;
        for (const [path, rec] of Object.entries(rows)) {
          const [table, id] = path.split('/') as [SyncTable, string];
          ((this.data[folder] ??= {})[table] ??= {})[id] = { u: rec.u, r: rec.r, j: rec.j, s };
        }
      },
    };
  }
}

const rice: Food = {
  id: 'rice (cooked)', names: { en: 'Rice (cooked)' }, kind: 'generic', group: 'starch', prep: 'boiled', basis: { per: '100g' }, portions: [],
  n: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, carbsIncludeFiber: true, kcalOrigin: 'database', src: { type: 'usda-fdc', confidence: 'high' },
};
const DAY = '2026-10-30';
let A: CarbmaxxDB, B: CarbmaxxDB, server: FakeServer;
const on = (d: CarbmaxxDB) => useDatabase(d);

beforeEach(async () => {
  A = new CarbmaxxDB(`a-${uuidv7()}`);
  B = new CarbmaxxDB(`b-${uuidv7()}`);
  server = new FakeServer();
  on(A);
  await saveProfile({ ...defaultProfile(), sex: 'male', weightKg: 73, heightCm: 174, ageYears: 18, onboarded: true, updatedAt: '2026-10-30T08:00:00.000Z' });
});

describe('sync between two devices', () => {
  it('a new device gets the diary, pantry and profile exactly as they are', async () => {
    const e = await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 200, unit: 'g' }, status: 'eaten', origin: 'search' });
    await addPantryItem({ food: rice, qty: { amount: 500, unit: 'g' } });
    expect(await syncNow(server.as('u1'), 'u1')).toMatchObject({ pushed: 4 }); // profile, day, entry, pantry lot
    on(B);
    const r = await syncNow(server.as('u1'), 'u1');
    expect(r).toMatchObject({ pulled: 4, skipped: 0, profileChanged: true });
    expect(await getEntry(e.id)).toEqual((await A.entries.get(e.id))!); // exact, incl. empty arrays and nulls
    expect((await loadProfile()).heightCm).toBe(174);
    expect((await listPantry())[0]!.qty.amount).toBe(500);
  });

  it('edits and deletes travel both ways; nothing is pushed twice', async () => {
    const e = await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    await syncNow(server.as('u1'), 'u1');
    on(B);
    await syncNow(server.as('u1'), 'u1');
    await new Promise((r) => setTimeout(r, 5));
    await updateEntry(e.id, { qty: { amount: 150, unit: 'g' } });
    expect((await syncNow(server.as('u1'), 'u1')).pushed).toBe(1);
    expect((await syncNow(server.as('u1'), 'u1')).pushed).toBe(0);
    on(A);
    await syncNow(server.as('u1'), 'u1');
    expect((await getEntry(e.id))!.qty.amount).toBe(150);
    await new Promise((r) => setTimeout(r, 5));
    await softDelete(e.id);
    await syncNow(server.as('u1'), 'u1');
    on(B);
    await syncNow(server.as('u1'), 'u1');
    expect(await listDay(DAY)).toEqual([]);
  });

  it('the newest edit wins on both devices, even when the older one syncs last', async () => {
    const e = await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    await syncNow(server.as('u1'), 'u1');
    on(B);
    await syncNow(server.as('u1'), 'u1');
    const base = (await B.entries.get(e.id))!;
    const at = (min: number) => new Date(Date.parse(base.updatedAt) + min * 60_000).toISOString();
    // A edits two hours later; B (offline) edited the same entry one hour later and syncs after A.
    on(A);
    await A.entries.put({ ...base, qty: { amount: 300, unit: 'g' }, updatedAt: at(120), rev: base.rev + 1 });
    await syncNow(server.as('u1'), 'u1');
    on(B);
    await B.entries.put({ ...base, qty: { amount: 100, unit: 'g' }, updatedAt: at(60), rev: base.rev + 1 });
    await syncNow(server.as('u1'), 'u1');
    expect((await B.entries.get(e.id))!.qty.amount).toBe(300);
    on(A);
    await syncNow(server.as('u1'), 'u1');
    expect((await A.entries.get(e.id))!.qty.amount).toBe(300);
  });

  it('a racing older write is refused by the server, then the device re-pulls and finishes', async () => {
    const e = await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 200, unit: 'g' }, status: 'planned', origin: 'plan' });
    await syncNow(server.as('u1'), 'u1');
    const base = (await A.entries.get(e.id))!;
    const at = (min: number) => new Date(Date.parse(base.updatedAt) + min * 60_000).toISOString();
    await A.entries.put({ ...base, qty: { amount: 120, unit: 'g' }, updatedAt: at(60), rev: base.rev + 1 });
    const t = server.as('u1');
    // Another device writes a newer version between this device's pull and push.
    const sneaky: Transport = {
      list: t.list,
      write: async (rows) => {
        const k = `entries/${e.id}`;
        if (rows[k] && server.writes < 2) {
          ((server.data.u1 ??= {}).entries ??= {})[e.id] = { u: at(120), r: base.rev + 5, s: ++server.clock, j: JSON.stringify({ ...base, qty: { amount: 250, unit: 'g' }, updatedAt: at(120), rev: base.rev + 5 }) };
          server.writes += 1;
        }
        return t.write(rows);
      },
    };
    await syncNow(sneaky, 'u1');
    expect((await A.entries.get(e.id))!.qty.amount).toBe(250);
  });

  it('another account sees nothing and cannot write into this one', async () => {
    await addEntry({ dayKey: DAY, slotId: 'lunch', food: rice, qty: { amount: 200, unit: 'g' }, status: 'eaten', origin: 'search' });
    await syncNow(server.as('u1'), 'u1');
    on(B);
    expect((await syncNow(server.as('u2'), 'u2')).pulled).toBe(0);
    expect(await B.entries.count()).toBe(0);
    await expect(server.as('u2', 'u1').list('entries', 0)).rejects.toThrow(/Permission denied/);
    await expect(server.as('u2', 'u1').write({})).rejects.toThrow(/Permission denied/);
  });

  it('a device synced with one account refuses to sync into another', async () => {
    await syncNow(server.as('u1'), 'u1');
    await expect(syncNow(server.as('u2'), 'u2')).rejects.toThrow(/different account/);
  });

  it('damaged or foreign records are skipped, never crash the app', async () => {
    server.data.u1 = { entries: {
      bad1: { u: '2026-10-30T10:00:00.000Z', r: 1, s: 5, j: '{not json' },
      bad2: { u: '2026-10-30T10:00:00.000Z', r: 1, s: 6, j: JSON.stringify({ id: 'bad2', dayKey: 'nope' }) },
      other: { u: '2026-10-30T10:00:00.000Z', r: 1, s: 7, j: JSON.stringify({ id: 'mismatch' }) },
    } };
    const r = await syncNow(server.as('u1'), 'u1');
    expect(r.skipped).toBe(3);
    expect(await db().entries.count()).toBe(0);
  });

  it('the sign-in session and sync state never sync and never go into backups', async () => {
    await db().settings.put({ key: 'auth', value: { refreshToken: 'secret' } });
    await syncNow(server.as('u1'), 'u1');
    expect(Object.keys(server.data.u1!.settings!)).toEqual(['profile']);
    const file = await exportAll();
    expect(file.data.settings.map((s) => s.key)).toEqual(['profile']);
  });
});

describe('sign-in client (Firebase Auth REST)', () => {
  const okFetch = (body: Record<string, unknown>, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('signs in and keeps what it needs', async () => {
    const f = okFetch({ localId: 'u1', email: 'a@b.c', idToken: 'id', refreshToken: 'rt', expiresIn: '3600' });
    const s = await signInWithPassword('KEY', ' a@b.c ', 'pw', f as unknown as typeof fetch);
    expect(s).toMatchObject({ uid: 'u1', email: 'a@b.c', idToken: 'id', refreshToken: 'rt' });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=KEY');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.c', password: 'pw', returnSecureToken: true });
  });

  it('turns error codes into plain words', async () => {
    await expect(signInWithPassword('K', 'a@b.c', 'x', okFetch({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400) as unknown as typeof fetch)).rejects.toThrow('Email or password is wrong.');
    await expect(signUpWithPassword('K', 'a@b.c', 'x', okFetch({ error: { message: 'WEAK_PASSWORD : Password should be at least 6 characters' } }, 400) as unknown as typeof fetch)).rejects.toThrow(/at least 6/);
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(signInWithPassword('K', 'a@b.c', 'x', offline as unknown as typeof fetch)).rejects.toBeInstanceOf(AuthError);
  });

  it('refreshes an expiring token, keeps a fresh one', async () => {
    const s = { uid: 'u1', email: 'a@b.c', idToken: 'old', refreshToken: 'rt', expiresAt: Date.now() + 10_000 };
    const f = okFetch({ id_token: 'new', refresh_token: 'rt2', expires_in: '3600', user_id: 'u1' });
    const n = await freshSession('K', s, f as unknown as typeof fetch);
    expect(n).toMatchObject({ idToken: 'new', refreshToken: 'rt2', uid: 'u1' });
    const same = await freshSession('K', { ...s, expiresAt: Date.now() + 3_000_000 }, f as unknown as typeof fetch);
    expect(same.idToken).toBe('old');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

// Keep the type import used (LogEntry) for readers of the fixtures above.
export type { LogEntry };
