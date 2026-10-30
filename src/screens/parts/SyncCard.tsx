import { useState } from 'preact/hooks';
import { Field } from '../../ui/controls';
import { Cloud, CloudOff, RefreshCw } from '../../ui/icons';
import { API_KEY_OVERRIDE, syncConfigured } from '../../data/sync/config';
import { resetPassword, runSync, signIn, signOut, syncStatus } from '../../app/sync';
import { toast } from '../../app/store';

const ago = (iso: string | null) => {
  if (!iso) return 'not yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Sign in, see sync status, sync now, sign out. `freshDevice`: shown during setup on a new device. */
export function SyncCard({ freshDevice }: { freshDevice?: boolean }) {
  const st = syncStatus.value;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);

  if (!syncConfigured()) {
    return (
      <div class="stack-s">
        <p class="small muted">Sync isn't switched on for this app yet. Until it is, your data stays on this device — use backups to move it.</p>
        <details>
          <summary class="small">Owner: try a Firebase Web API key on this device</summary>
          <form class="cluster" style={{ marginTop: '8px' }} onSubmit={(e) => {
            e.preventDefault();
            const v = (e.currentTarget.elements.namedItem('key') as HTMLInputElement).value.trim();
            if (!v) return;
            try { localStorage.setItem(API_KEY_OVERRIDE, v); } catch { /* storage blocked */ }
            force((n) => n + 1);
          }}>
            <label class="sr-only" for="sync-key">Web API key</label>
            <input id="sync-key" name="key" class="input" style={{ flex: '1 1 220px' }} autoComplete="off" spellcheck={false} placeholder="Web API key (AIza…)" />
            <button type="submit" class="btn btn-s">Use key</button>
          </form>
        </details>
      </div>
    );
  }

  if (st.state === 'off') {
    const go = async (create: boolean) => {
      setBusy(true); setError(null);
      try {
        await signIn(email, password, create, freshDevice);
        setPassword('');
        toast(create ? 'Account created — this device is now synced' : 'Signed in — syncing', { tone: 'ok' });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally { setBusy(false); }
    };
    return (
      <form class="stack-s" onSubmit={(e) => { e.preventDefault(); void go(false); }}>
        <p class="small muted">{freshDevice ? 'Sign in with the account you use there and everything comes over — no need to set up again.' : 'Sign in to keep your diary, foods, pantry and workouts in sync across your devices. Only you can read them.'}</p>
        <div class="cluster" style={{ alignItems: 'flex-start' }}>
          <Field label="Email" for="sync-email"><input id="sync-email" class="input" type="email" autoComplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></Field>
          <Field label="Password" for="sync-pw"><input id="sync-pw" class="input" type="password" autoComplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></Field>
        </div>
        {error ? <p class="error" role="alert">{error}</p> : null}
        <div class="cluster">
          <button type="submit" class="btn btn-primary" disabled={busy || !email.trim() || !password}>Sign in</button>
          <button type="button" class="btn" disabled={busy || !email.trim() || password.length < 6} onClick={() => void go(true)}>Create account</button>
          <button type="button" class="linkish small" disabled={busy || !email.trim()} onClick={async () => {
            try { await resetPassword(email); toast('If that email has an account, a reset link is on its way.', { tone: 'ok', ms: 6000 }); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>Forgot password?</button>
        </div>
      </form>
    );
  }

  return (
    <div class="stack-s">
      <p class="cluster small">
        {st.state === 'offline' || st.state === 'error' ? <CloudOff size={16} aria-hidden="true" /> : <Cloud size={16} aria-hidden="true" />}
        <span>Signed in as <b>{st.email}</b></span>
      </p>
      <p class="small" role="status">
        {st.state === 'syncing' ? 'Syncing…' : st.state === 'offline' ? `Offline — changes are saved here and will sync when you're back online. Last synced ${ago(st.lastAt)}.` : st.state === 'error' ? null : `Synced ${ago(st.lastAt)}.`}
      </p>
      {st.state === 'error' ? <p class="error" role="alert">{st.message}</p> : null}
      <div class="cluster">
        <button type="button" class="btn btn-s" disabled={st.state === 'syncing'} onClick={() => void runSync()}><RefreshCw size={14} aria-hidden="true" /> Sync now</button>
        <button type="button" class="btn btn-s" onClick={async () => { await signOut(); toast('Signed out. Your data stays on this device.'); }}>Sign out</button>
      </div>
    </div>
  );
}
