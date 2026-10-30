import { useState } from 'preact/hooks';
import { profile, toast, updateProfile } from '../app/store';
import { useAsync } from '../ui/hooks';
import { Field, NumberField, Segmented } from '../ui/controls';
import { Download, Lock, Shield, Upload } from '../ui/icons';
import { StatsForm } from './parts/StatsForm';
import { LegacyImport } from './parts/LegacyImport';
import { backupFileName, exportAll, importBackup, parseBackup, PRE_IMPORT_KEY, type ParsedBackup } from '../data/backup';
import { db } from '../data/db';
import { initProfile } from '../app/store';
import type { BackupFile } from '../data/schemas';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportBackup(): Promise<void> {
  const file = await exportAll();
  download(backupFileName(), JSON.stringify(file, null, 1));
  await updateProfile({ lastBackupAt: new Date().toISOString() });
  toast('Backup downloaded. Keep it somewhere safe (Files, iCloud Drive, e-mail to yourself).', { tone: 'ok', ms: 5000 });
}

export function SettingsScreen() {
  const p = profile.value!;
  const zones = useAsync(async () => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [p.timezone]), []);
  const persisted = useAsync(() => navigator.storage?.persisted?.() ?? Promise.resolve(false), [p.updatedAt]);
  const estimate = useAsync(() => navigator.storage?.estimate?.() ?? Promise.resolve(undefined), []);
  const preImport = useAsync(() => db().settings.get(PRE_IMPORT_KEY), [p.updatedAt]);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [busy, setBusy] = useState(false);

  const runImport = async (file: BackupFile, mode: 'merge' | 'replace') => {
    setBusy(true);
    try {
      await importBackup(file, mode);
      await initProfile();
      setParsed(null);
      toast(mode === 'replace' ? 'Backup restored. Your previous data was kept and can be restored below.' : 'Backup merged.', { tone: 'ok', ms: 5000 });
    } catch (e) {
      toast(`Import failed — nothing was changed. ${e instanceof Error ? e.message : ''}`, { tone: 'error', ms: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page">
      <h1 class="page-title">Settings</h1>

      <section class="card stack" aria-labelledby="set-body">
        <h2 id="set-body" class="card-title">You</h2>
        <StatsForm p={p} />
      </section>

      <section class="card stack" aria-labelledby="set-day">
        <h2 id="set-day" class="card-title">Your day</h2>
        <div class="fields">
          <Field label="Time zone" for="set-tz">
            <select id="set-tz" class="select" value={p.timezone} onChange={(e) => void updateProfile({ timezone: e.currentTarget.value })}>
              {(zones ?? [p.timezone]).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="My day starts at" for="set-start" hint="Late-night food before this hour counts toward the previous day.">
            <select id="set-start" class="select" value={String(p.dayStartHour)} onChange={(e) => void updateProfile({ dayStartHour: Number(e.currentTarget.value) })}>
              {[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section class="card stack" aria-labelledby="set-targets">
        <h2 id="set-targets" class="card-title">Targets</h2>
        <Segmented label="Where targets come from" value={p.targetMode} onChange={(v) => void updateProfile({ targetMode: v })}
          options={[{ value: 'template', label: 'CARBMAXX planner (estimate)' }, { value: 'manual', label: 'My own numbers' }]} />
        {p.targetMode === 'manual' ? (
          <div class="fields">
            {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
              <NumberField key={k} label={k === 'kcal' ? 'Calories' : k[0]!.toUpperCase() + k.slice(1)} suffix={k === 'kcal' ? 'kcal' : 'g'}
                value={p.manualTargets?.[k] ?? null} min={0} max={k === 'kcal' ? 8000 : 1000}
                onChange={(v) => void updateProfile((prev) => ({ manualTargets: { kcal: 2500, protein: 150, carbs: 300, fat: 70, ...prev.manualTargets, [k]: v ?? 0 } }))} />
            ))}
          </div>
        ) : <p class="small muted">Targets come from your goal and day type in Plan. Each day keeps the targets it had, so changing goals never rewrites history.</p>}
      </section>

      <section class="card stack" aria-labelledby="set-display">
        <h2 id="set-display" class="card-title">Display</h2>
        <Segmented label="Theme" value={p.theme} onChange={(v) => void updateProfile({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        <Segmented label="Detail" value={p.density} onChange={(v) => void updateProfile({ density: v })} options={[{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }, { value: 'research', label: 'Research' }]} />
      </section>

      <section class="card stack" aria-labelledby="set-data">
        <h2 id="set-data" class="card-title">Your data</h2>
        <p class="small">Everything is stored <b>on this device</b> (IndexedDB). Nothing is uploaded. Export a backup regularly{p.lastBackupAt ? ` — last one ${new Date(p.lastBackupAt).toLocaleDateString('en-GB')}` : ' — you have not made one yet'}.</p>
        <div class="cluster">
          <button type="button" class="btn btn-primary" onClick={() => void exportBackup()}><Download size={16} aria-hidden="true" /> Export backup</button>
          <label class="btn">
            <Upload size={16} aria-hidden="true" /> Import backup
            <input type="file" accept="application/json,.json" class="sr-only" onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) setParsed(parseBackup(await f.text()));
            }} />
          </label>
        </div>
        {parsed ? (
          parsed.ok ? (
            <div class="callout stack-s" role="region" aria-label="Backup preview">
              <b>Backup from {new Date(parsed.file.exportedAt).toLocaleString('en-GB')}</b>
              <span class="small">{parsed.counts.entries} diary entries · {parsed.counts.days} days · {parsed.counts.foods} foods · {parsed.counts.savedMeals} saved meals</span>
              <div class="cluster">
                <button type="button" class="btn btn-s" disabled={busy} onClick={() => void runImport(parsed.file, 'merge')}>Merge (keep newest of each)</button>
                <button type="button" class="btn btn-s btn-danger" disabled={busy} onClick={() => void runImport(parsed.file, 'replace')}>Replace everything</button>
                <button type="button" class="btn btn-s btn-ghost" onClick={() => setParsed(null)}>Cancel</button>
              </div>
            </div>
          ) : <p class="error" role="alert">{parsed.error} Nothing was changed.</p>
        ) : null}
        {preImport ? (
          <button type="button" class="linkish small" style={{ alignSelf: 'flex-start' }} onClick={() => {
            const snap = (preImport.value as { backup: BackupFile | null }).backup;
            if (snap) void runImport(snap, 'replace');
          }}>Restore the data from before the last “Replace” import</button>
        ) : null}
        <div class="divider" />
        <div class="cluster small">
          {persisted ? <><Lock size={15} aria-hidden="true" /> The browser has agreed to keep this data (persistent storage).</> : (
            <>
              <Shield size={15} aria-hidden="true" /> Storage is “best effort”: the browser may clear it under pressure — and Safari clears site data after 7 days without a visit unless the app is on your Home Screen.
              <button type="button" class="btn btn-s" onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                toast(ok ? 'Storage protected.' : 'The browser declined for now (Safari grants it to Home Screen apps). Keep exporting backups.', { ms: 6000 });
                await updateProfile({});
              }}>Ask to protect</button>
            </>
          )}
        </div>
        {estimate?.usage !== undefined ? <p class="xs subtle">Using {(estimate.usage / 1024 / 1024).toFixed(1)} MB{estimate.quota ? ` of ${(estimate.quota / 1024 / 1024 / 1024).toFixed(1)} GB available` : ''}.</p> : null}
      </section>

      <section class="card stack" aria-labelledby="set-legacy">
        <h2 id="set-legacy" class="card-title">CARBMAXX v1 (classic pages)</h2>
        <LegacyImport />
      </section>

      <section class="card stack small" aria-labelledby="set-about">
        <h2 id="set-about" class="card-title">About & sources</h2>
        <p>CARBMAXX 2.0 (alpha). Generic food values: U.S. Department of Agriculture, Agricultural Research Service, <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer">FoodData Central</a> (SR Legacy, 2018) — public domain (CC0). Unknown values are shown as unknown, never as zero.</p>
        <p>Calorie targets use Mifflin–St Jeor × an activity factor: an estimate to check against your weight trend. This app is general information, not medical or dietetic advice.</p>
        <p class="muted">The classic <a href="../index.html">planner</a> and <a href="../workout.html">workout</a> pages keep working unchanged.</p>
      </section>
    </div>
  );
}
