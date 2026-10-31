import type { Table } from 'dexie';
import type { ZodType } from 'zod';
import { db } from '../db';
import { nowIso } from '../ids';
import { normalizeProfile } from '../profile';
import {
  daySchema, entrySchema, eventSchema, foodSchema, pantrySchema, programSchema, savedMealSchema, sessionSchema, shoppingSchema, weightSchema,
} from '../schemas';

/**
 * Two-way sync with the Realtime Database, one record at a time, newest version wins.
 * - Remote layout: /v2/users/{uid}/{table}/{id} = { u: updatedAt, r: rev, s: server time, j: JSON }.
 *   Records travel as exact JSON strings, so nothing is reshaped (RTDB drops empty arrays and nulls).
 * - Pull: records written since the last server time seen (indexed on s). A pulled record replaces the
 *   local one only if it is newer (updatedAt, then rev) and passes the same validation as a backup.
 * - Push: local records whose version differs from the last version known to be on the server.
 * - The database rules refuse an older version over a newer one, so two devices can't undo each
 *   other's newer edits even mid-race; a refused push re-pulls and retries once.
 * - Deletes are tombstones (deletedAt), so they sync like any edit. Caches and secrets never sync.
 */

export const SYNC_TABLES = ['settings', 'foods', 'days', 'entries', 'savedMeals', 'weights', 'programs', 'sessions', 'pantry', 'shopping', 'events'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
/** Settings rows that travel (the auth session, sync state and import snapshots never do). */
export const SYNCED_SETTINGS = ['profile'];

const KEY: Record<SyncTable, string> = {
  settings: 'key', foods: 'id', days: 'dayKey', entries: 'id', savedMeals: 'id', weights: 'dayKey',
  programs: 'id', sessions: 'id', pantry: 'id', shopping: 'id', events: 'id',
};
const SCHEMA: Record<Exclude<SyncTable, 'settings'>, ZodType> = {
  foods: foodSchema, days: daySchema, entries: entrySchema, savedMeals: savedMealSchema, weights: weightSchema,
  programs: programSchema, sessions: sessionSchema, pantry: pantrySchema, shopping: shoppingSchema, events: eventSchema,
};

export interface RemoteRecord { u: string; r: number; s: number; j: string }
export const SERVER_TIME = { '.sv': 'timestamp' } as const;

export interface Transport {
  /** Records of one table written at or after server time `after`. */
  list(table: SyncTable, after: number): Promise<Record<string, RemoteRecord>>;
  /** One atomic multi-path write: "table/id" → record (with s = SERVER_TIME). */
  write(rows: Record<string, Omit<RemoteRecord, 's'> & { s: typeof SERVER_TIME }>): Promise<void>;
}

export class RejectedError extends Error {}

export interface SyncState { uid: string; cursors: Partial<Record<SyncTable, number>>; pushedThrough: string | null; lastSyncAt: string | null }
export const SYNC_STATE_KEY = 'sync';

type Row = Record<string, unknown>;
interface Version { u: string; r: number }
const newer = (a: Version, b: Version) => b.u > a.u || (b.u === a.u && b.r > a.r);
const same = (a: Version, b: Version) => a.u === b.u && a.r === b.r;

function versionOf(table: SyncTable, row: Row): Version | null {
  if (table === 'settings') {
    const v = row.value as { updatedAt?: string } | undefined;
    return typeof v?.updatedAt === 'string' ? { u: v.updatedAt, r: 0 } : null;
  }
  return typeof row.updatedAt === 'string' ? { u: row.updatedAt, r: Number(row.rev ?? 0) } : null;
}

function validate(table: SyncTable, row: unknown): Row | null {
  if (table === 'settings') {
    const r = row as { key?: unknown; value?: unknown };
    if (r?.key !== 'profile') return null;
    return { key: 'profile', value: normalizeProfile(r.value) };
  }
  const res = SCHEMA[table].safeParse(row);
  return res.success ? (res.data as Row) : null;
}

const tableOf = (t: SyncTable) => (db() as unknown as Record<SyncTable, Table<Row, string>>)[t];

export async function loadState(): Promise<SyncState | null> {
  return ((await db().settings.get(SYNC_STATE_KEY))?.value as SyncState | undefined) ?? null;
}
async function saveState(s: SyncState): Promise<void> {
  await db().settings.put({ key: SYNC_STATE_KEY, value: s });
}

export interface SyncResult { pulled: number; pushed: number; skipped: number; profileChanged: boolean }

async function pull(t: Transport, state: SyncState, out: SyncResult): Promise<void> {
  for (const table of SYNC_TABLES) {
    const after = state.cursors[table] ?? 0;
    const remote = await t.list(table, after);
    let max = after;
    for (const [id, rec] of Object.entries(remote)) {
      if (typeof rec?.s === 'number') max = Math.max(max, rec.s);
      if (!rec || typeof rec.u !== 'string' || typeof rec.j !== 'string') { out.skipped += 1; continue; }
      const k = `${table}/${id}`;
      const local = await tableOf(table).get(id);
      const lv = local ? versionOf(table, local) : null;
      if (!lv || newer(lv, { u: rec.u, r: rec.r })) {
        let parsed: unknown;
        try { parsed = JSON.parse(rec.j); } catch { out.skipped += 1; continue; }
        const row = validate(table, parsed);
        if (!row || String(row[KEY[table]]) !== id) { out.skipped += 1; continue; }
        await tableOf(table).put(row);
        out.pulled += 1;
        if (table === 'settings') out.profileChanged = true;
      }
      await db().syncMeta.put({ k, u: rec.u, r: rec.r });
    }
    state.cursors[table] = max;
  }
}

async function collect(state: SyncState): Promise<Record<string, Omit<RemoteRecord, 's'> & { s: typeof SERVER_TIME }>> {
  const rows: Record<string, Omit<RemoteRecord, 's'> & { s: typeof SERVER_TIME }> = {};
  // A small overlap covers writes that landed while the previous push was being collected.
  const since = state.pushedThrough ? new Date(Date.parse(state.pushedThrough) - 5_000).toISOString() : null;
  for (const table of SYNC_TABLES) {
    const tbl = tableOf(table);
    const candidates = table === 'settings'
      ? (await Promise.all(SYNCED_SETTINGS.map((key) => tbl.get(key)))).filter((r): r is Row => !!r)
      : since ? await tbl.where('updatedAt').aboveOrEqual(since).toArray() : await tbl.toArray();
    for (const row of candidates) {
      const v = versionOf(table, row);
      if (!v) continue;
      const k = `${table}/${String(row[KEY[table]])}`;
      const known = await db().syncMeta.get(k);
      if (known && (same(known, v) || newer(v, known))) continue; // already there, or the server has newer
      rows[k] = { u: v.u, r: v.r, s: SERVER_TIME, j: JSON.stringify(row) };
    }
  }
  return rows;
}

async function push(t: Transport, state: SyncState, out: SyncResult): Promise<void> {
  const startedAt = nowIso();
  const rows = await collect(state);
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 300) {
    const part = Object.fromEntries(keys.slice(i, i + 300).map((k) => [k, rows[k]!]));
    await t.write(part);
    for (const [k, rec] of Object.entries(part)) await db().syncMeta.put({ k, u: rec.u, r: rec.r });
    out.pushed += Object.keys(part).length;
  }
  state.pushedThrough = startedAt;
}

/**
 * One full sync for the signed-in account. A device that last synced with a different account is
 * refused, so one person's diary never lands in someone else's account.
 */
export async function syncNow(t: Transport, uid: string): Promise<SyncResult> {
  const prev = await loadState();
  if (prev && prev.uid !== uid) throw new Error('This device was synced with a different account. Sign in with that account, or back up and reset the app first.');
  const state: SyncState = prev ?? { uid, cursors: {}, pushedThrough: null, lastSyncAt: null };
  const out: SyncResult = { pulled: 0, pushed: 0, skipped: 0, profileChanged: false };
  await pull(t, state, out);
  try {
    await push(t, state, out);
  } catch (e) {
    if (!(e instanceof RejectedError)) throw e;
    // Another device wrote something newer in between: take it, then push what is still ours.
    await pull(t, state, out);
    await push(t, state, out);
  }
  state.lastSyncAt = nowIso();
  await saveState(state);
  return out;
}

/** REST transport: the ID token goes in `auth=` as the Realtime Database REST API requires. */
export function restTransport(databaseURL: string, uid: string, token: () => Promise<string>, f: typeof fetch = fetch): Transport {
  const base = `${databaseURL.replace(/\/$/, '')}/v2/users/${encodeURIComponent(uid)}`;
  const url = async (path: string, q: Record<string, string> = {}) => `${base}${path}.json?${new URLSearchParams({ ...q, auth: await token() })}`;
  const check = async (res: Response, writing: boolean) => {
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      if (/expired|invalid.*token/i.test(body)) throw new Error('Sign-in expired. Sign in again.');
      // A refused write means the server holds a newer version; a refused read means no rules yet.
      if (writing) throw new RejectedError('The server refused an older version.');
      throw new Error('The database refused access — its sync rules may not be set up yet (see the sync setup guide).');
    }
    throw new Error(`Sync failed (HTTP ${res.status}).`);
  };
  return {
    async list(table, after) {
      const res = await f(await url(`/${table}`, { orderBy: '"s"', startAt: String(after) }));
      await check(res, false);
      return ((await res.json()) as Record<string, RemoteRecord> | null) ?? {};
    },
    async write(rows) {
      const res = await f(await url(''), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });
      await check(res, true);
    },
  };
}
