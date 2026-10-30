/**
 * Public Firebase identifiers. They are not secrets — what protects the data is sign-in plus the
 * database rules in docs/firebase-rules-v2.json (each account can only read and write its own folder).
 * Sync stays off until the owner fills in the Web API key (docs/SYNC_SETUP.md).
 */
export const FIREBASE = {
  /** Firebase console → Project settings → General → Web API key. Empty = sync not set up yet. */
  apiKey: '',
  databaseURL: 'https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app',
};

/** Lets the owner try a key on one device before committing it (Settings → Sync → "Use a key"). */
export const API_KEY_OVERRIDE = 'carbmaxx_sync_api_key';

export function apiKey(): string {
  try {
    return localStorage.getItem(API_KEY_OVERRIDE)?.trim() || FIREBASE.apiKey;
  } catch {
    return FIREBASE.apiKey;
  }
}

export const syncConfigured = (): boolean => apiKey().length > 0;
