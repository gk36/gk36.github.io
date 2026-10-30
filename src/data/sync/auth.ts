/**
 * Firebase Authentication over its REST API (no SDK, no third-party scripts): email + password.
 * Works inside an installed iPhone app, where email links and Google pop-ups open a different
 * browser with different storage. The refresh token is kept on this device only (never in backups).
 */

const IDT = 'https://identitytoolkit.googleapis.com/v1/accounts';
const STS = 'https://securetoken.googleapis.com/v1/token';

export interface AuthSession { uid: string; email: string; idToken: string; refreshToken: string; expiresAt: number }

export class AuthError extends Error {
  constructor(public code: string) { super(friendly(code)); }
}

export function friendly(code: string): string {
  const c = code.split(' ')[0]!;
  switch (c) {
    case 'EMAIL_EXISTS': return 'An account with this email already exists — sign in instead.';
    case 'EMAIL_NOT_FOUND': case 'INVALID_PASSWORD': case 'INVALID_LOGIN_CREDENTIALS': return 'Email or password is wrong.';
    case 'WEAK_PASSWORD': return 'Choose a password of at least 6 characters.';
    case 'INVALID_EMAIL': case 'MISSING_EMAIL': return 'Check the email address.';
    case 'MISSING_PASSWORD': return 'Enter your password.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER': return 'Too many attempts. Wait a few minutes and try again.';
    case 'USER_DISABLED': return 'This account has been disabled.';
    case 'OPERATION_NOT_ALLOWED': case 'PASSWORD_LOGIN_DISABLED': return 'Email sign-in is not switched on for this app yet (owner: see the sync setup guide).';
    case 'TOKEN_EXPIRED': case 'INVALID_REFRESH_TOKEN': case 'USER_NOT_FOUND': case 'INVALID_ID_TOKEN': return 'Your sign-in expired. Sign in again.';
    case 'NETWORK': return 'No connection. Your data is safe on this device; sync will retry.';
    default: return `Could not sign in (${c}).`;
  }
}

async function post(url: string, body: Record<string, unknown> | URLSearchParams, f: typeof fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, body instanceof URLSearchParams
      ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AuthError('NETWORK');
  }
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new AuthError(j.error?.message ?? `HTTP_${res.status}`);
  return j;
}

const toSession = (j: Record<string, unknown>): AuthSession => ({
  uid: String(j.localId), email: String(j.email ?? ''), idToken: String(j.idToken), refreshToken: String(j.refreshToken),
  expiresAt: Date.now() + Number(j.expiresIn ?? 3600) * 1000,
});

export async function signInWithPassword(apiKey: string, email: string, password: string, f: typeof fetch = fetch): Promise<AuthSession> {
  return toSession(await post(`${IDT}:signInWithPassword?key=${encodeURIComponent(apiKey)}`, { email: email.trim(), password, returnSecureToken: true }, f));
}

export async function signUpWithPassword(apiKey: string, email: string, password: string, f: typeof fetch = fetch): Promise<AuthSession> {
  return toSession(await post(`${IDT}:signUp?key=${encodeURIComponent(apiKey)}`, { email: email.trim(), password, returnSecureToken: true }, f));
}

export async function sendPasswordReset(apiKey: string, email: string, f: typeof fetch = fetch): Promise<void> {
  await post(`${IDT}:sendOobCode?key=${encodeURIComponent(apiKey)}`, { requestType: 'PASSWORD_RESET', email: email.trim() }, f);
}

/** Returns the same session if its ID token is good for another minute, else a refreshed one. */
export async function freshSession(apiKey: string, s: AuthSession, f: typeof fetch = fetch): Promise<AuthSession> {
  if (s.expiresAt - Date.now() > 60_000) return s;
  const j = await post(`${STS}?key=${encodeURIComponent(apiKey)}`, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }), f);
  return {
    uid: String(j.user_id ?? s.uid), email: s.email, idToken: String(j.id_token), refreshToken: String(j.refresh_token ?? s.refreshToken),
    expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
  };
}
