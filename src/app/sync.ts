import { signal } from '@preact/signals';
import { db } from '../data/db';
import { apiKey, FIREBASE, syncConfigured } from '../data/sync/config';
import { freshSession, sendPasswordReset, signInWithPassword, signUpWithPassword, type AuthSession } from '../data/sync/auth';
import { loadState, restTransport, syncNow, SYNC_TABLES } from '../data/sync/engine';
import { loadProfile } from '../data/profile';
import { profile } from './store';

/**
 * App-side sync: who is signed in, the status shown in the header, and when to sync — on start,
 * a few seconds after any change, when the app comes back to the foreground or online, and every
 * five minutes while it is open. Everything works offline; sync only ever catches up.
 */

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle' | 'syncing' | 'offline'; email: string; lastAt: string | null }
  | { state: 'error'; email: string; lastAt: string | null; message: string };
export const syncStatus = signal<SyncStatus>({ state: 'off' });

const AUTH_KEY = 'auth';
const getSession = async () => ((await db().settings.get(AUTH_KEY))?.value as AuthSession | undefined) ?? null;
const putSession = async (s: AuthSession | null) => (s ? db().settings.put({ key: AUTH_KEY, value: s }) : db().settings.delete(AUTH_KEY));

let running: Promise<void> | null = null;
let timer = 0;
let applyingRemote = false;

export function scheduleSync(ms = 4000): void {
  if (syncStatus.value.state === 'off') return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void runSync(), ms);
}

export function runSync(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const s = await getSession();
    if (!s || !syncConfigured()) { syncStatus.value = { state: 'off' }; return; }
    const lastAt = (await loadState())?.lastSyncAt ?? null;
    if (!navigator.onLine) { syncStatus.value = { state: 'offline', email: s.email, lastAt }; return; }
    syncStatus.value = { state: 'syncing', email: s.email, lastAt };
    let cur = s;
    const token = async () => {
      const next = await freshSession(apiKey(), cur);
      if (next !== cur) { cur = next; await putSession(next); }
      return cur.idToken;
    };
    try {
      applyingRemote = true;
      const r = await syncNow(restTransport(FIREBASE.databaseURL, s.uid, token), s.uid);
      if (r.profileChanged) profile.value = await loadProfile();
      syncStatus.value = { state: 'idle', email: s.email, lastAt: (await loadState())?.lastSyncAt ?? null };
    } catch (e) {
      syncStatus.value = navigator.onLine
        ? { state: 'error', email: s.email, lastAt, message: e instanceof Error ? e.message : String(e) }
        : { state: 'offline', email: s.email, lastAt };
    } finally {
      applyingRemote = false;
    }
  })().finally(() => { running = null; });
  return running;
}

/**
 * Signs in (or creates the account) and syncs at once. On a brand-new device that hasn't been set
 * up, the account's profile replaces the empty local one, so setup isn't repeated.
 */
export async function signIn(email: string, password: string, create: boolean, freshDevice = false): Promise<void> {
  const key = apiKey();
  const s = create ? await signUpWithPassword(key, email, password) : await signInWithPassword(key, email, password);
  const prev = await loadState();
  if (prev && prev.uid !== s.uid) throw new Error('This device was synced with a different account. Sign in with that account, or back up and reset the app first.');
  if (freshDevice && !profile.value?.onboarded) await db().settings.delete('profile');
  await putSession(s);
  syncStatus.value = { state: 'idle', email: s.email, lastAt: prev?.lastSyncAt ?? null };
  await runSync();
}

export async function signOut(): Promise<void> {
  clearTimeout(timer);
  await putSession(null);
  syncStatus.value = { state: 'off' };
}

export const resetPassword = (email: string) => sendPasswordReset(apiKey(), email);

/** Starts background sync for a signed-in device (no-op when sync isn't set up or signed out). */
export async function initSync(): Promise<void> {
  const d = db();
  for (const t of SYNC_TABLES) {
    const table = d.table(t);
    const changed = (key: unknown) => { if (!applyingRemote && (t !== 'settings' || key === 'profile')) scheduleSync(); };
    table.hook('creating', (key) => { changed(key); });
    table.hook('updating', (_mods, key) => { changed(key); });
    table.hook('deleting', (key) => { changed(key); });
  }
  window.addEventListener('online', () => void runSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void runSync(); }, 5 * 60_000);
  const s = await getSession();
  if (s && syncConfigured()) {
    syncStatus.value = { state: 'idle', email: s.email, lastAt: (await loadState())?.lastSyncAt ?? null };
    void runSync();
  }
}
