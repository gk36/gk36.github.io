import { useState } from 'preact/hooks';
import { useAsync } from '../../ui/hooks';
import { Field } from '../../ui/controls';
import { archiveLegacyRaw, fetchLegacyCloudProfile, legacyToProfile, readLegacyLocal } from '../../data/legacy';
import { profile, toast, updateProfile } from '../../app/store';
import type { PlannerInput } from '../../domain/planning/template';

/** Imports a v1 planner profile (read-only: v1 data is never modified). */
export function LegacyImport({ onDone }: { onDone?: () => void }) {
  const local = useAsync(async () => readLegacyLocal(), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = Object.keys(local?.profiles ?? {});

  const importSnap = async (snap: PlannerInput, profileName: string) => {
    const cur = profile.value!;
    const next = legacyToProfile(snap, cur, profileName);
    await updateProfile(next);
    if (local) await archiveLegacyRaw(local, `imported "${profileName}"`);
    toast(`Imported “${profileName}”: ${snap.kg} kg · ${snap.cm} cm · ${snap.age} y · ${snap.goal.replace('_', ' ')}`, { tone: 'ok', ms: 5000 });
    onDone?.();
  };

  const fromCloud = async () => {
    setErr(null);
    setBusy(true);
    try {
      const snap = await fetchLegacyCloudProfile(name);
      if (!snap) setErr(`No v1 profile called “${name.trim().toLowerCase()}”.`);
      else await importSnap(snap, name.trim().toLowerCase());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not fetch the profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="stack">
      <p class="small muted">Bring your stats, goal, meal timing and food picks over from the classic planner. The old pages and their data are only read, never changed.</p>
      {names.length ? (
        <div class="stack-s">
          <span class="label">Found on this device</span>
          <div class="chips">{names.map((n) => <button type="button" key={n} class="chip" onClick={() => void importSnap(local!.profiles[n]!, n)}>{n}</button>)}</div>
        </div>
      ) : <p class="small subtle">No classic planner profiles in this browser{typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent) ? ' (a Home Screen app has its own storage, separate from Safari)' : ''}.</p>}
      <Field label="Or fetch one profile by name from the classic cloud" for="legacy-name" error={err} hint="Reads only that one profile. Nothing is uploaded.">
        <div class="cluster" style={{ flexWrap: 'nowrap' }}>
          <input id="legacy-name" class="input" value={name} autoComplete="off" autoCapitalize="none" spellcheck={false} placeholder="your v1 profile name" onInput={(e) => setName(e.currentTarget.value)} />
          <button type="button" class="btn" disabled={busy || !name.trim()} onClick={() => void fromCloud()}>Import</button>
        </div>
      </Field>
    </div>
  );
}
