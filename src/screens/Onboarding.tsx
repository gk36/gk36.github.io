import { useState } from 'preact/hooks';
import { profile, updatePlanner, updateProfile } from '../app/store';
import { plannerInput } from '../data/profile';
import { todayKey } from '../app/store';
import { Segmented } from '../ui/controls';
import { Shield, Utensils } from '../ui/icons';
import { StatsForm } from './parts/StatsForm';
import { LegacyImport } from './parts/LegacyImport';
import { InstallHint } from './parts/InstallHint';
import { GOALS } from '../domain/planning/template';

type Step = 'welcome' | 'import' | 'stats';

export function Onboarding() {
  const p = profile.value!;
  const [step, setStep] = useState<Step>('welcome');
  const input = plannerInput(p, todayKey.value, 'gym');
  const finish = async () => {
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
    await updateProfile({ onboarded: true });
  };
  return (
    <main id="main" class="page" style={{ maxWidth: '640px', paddingTop: '32px' }} tabIndex={-1}>
      <div class="brand" style={{ fontSize: '22px' }}>
        <span class="brand-mark" aria-hidden="true"><Utensils size={17} /></span><span>CARB<b>MAXX</b></span>
      </div>
      {step === 'welcome' ? (
        <section class="card stack">
          <h1 class="page-title">Your food diary, planner and targets — on your phone</h1>
          <p class="muted">Log what you actually eat, keep it separate from what you planned, and see honest totals: weighed foods in the state you weighed them, unknown values shown as unknown.</p>
          <div class="callout small cluster" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <Shield size={18} aria-hidden="true" />
            <span>Your data stays <b>on this device</b>. Nothing is uploaded. You can export a backup any time.</span>
          </div>
          <InstallHint />
          <div class="cluster">
            <button type="button" class="btn btn-primary" onClick={() => setStep('import')}>Get started</button>
          </div>
        </section>
      ) : null}
      {step === 'import' ? (
        <section class="card stack">
          <h1 class="section-title">Used the classic CARBMAXX planner?</h1>
          <LegacyImport onDone={() => setStep('stats')} />
          <div class="cluster">
            <button type="button" class="btn" onClick={() => setStep('welcome')}>Back</button>
            <button type="button" class="btn btn-primary" onClick={() => setStep('stats')}>Start fresh instead</button>
          </div>
        </section>
      ) : null}
      {step === 'stats' ? (
        <section class="card stack">
          <h1 class="section-title">Your stats</h1>
          <p class="small muted">Used for the calorie estimate (Mifflin–St Jeor) and age-appropriate nutrient targets. Skip anything you prefer not to share — you can log food without targets.</p>
          <StatsForm p={p} />
          <Segmented label="Goal" value={p.planner.goal} onChange={(v) => void updatePlanner({ goal: v })}
            options={GOALS.map((g) => ({ value: g.key, label: g.label }))} />
          <div class="cluster">
            <button type="button" class="btn" onClick={() => setStep('import')}>Back</button>
            <button type="button" class="btn btn-primary" onClick={() => void finish()}>{'missing' in input ? 'Skip for now' : 'Done'}</button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
