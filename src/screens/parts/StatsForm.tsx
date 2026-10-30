import { useState } from 'preact/hooks';
import { NumberField, Segmented, Field } from '../../ui/controls';
import { ACTIVITY, type ActivityKey } from '../../domain/planning/template';
import type { Profile } from '../../data/types';
import { ageFor } from '../../data/profile';
import { todayKey, updatePlanner, updateProfile } from '../../app/store';
import { isDayKey } from '../../domain/time';

/** Sex, age (or birth date), height, weight and activity — saved as you type. */
export function StatsForm({ p, compact }: { p: Profile; compact?: boolean }) {
  const [useBirth, setUseBirth] = useState(!!p.birthDate);
  const age = ageFor(p, todayKey.value);
  return (
    <div class="stack">
      <Segmented label="Sex (for the calorie formula and nutrient targets)" value={p.sex ?? ''} onChange={(v) => void updateProfile({ sex: v === '' ? null : v })}
        options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
      <div class="fields">
        {useBirth ? (
          <Field label="Birth date" for="st-birth" hint={age !== null ? `Age ${age} today — targets switch automatically on birthdays.` : undefined}>
            <input id="st-birth" type="date" class="input" value={p.birthDate ?? ''} max={todayKey.value}
              onChange={(e) => { const v = e.currentTarget.value; void updateProfile({ birthDate: isDayKey(v) ? v : null }); }} />
          </Field>
        ) : (
          <NumberField label="Age" suffix="years" value={p.ageYears ?? null} min={14} max={90} onChange={(v) => void updateProfile({ ageYears: v === null ? null : Math.round(v) })} />
        )}
        <NumberField label="Height" suffix="cm" value={p.heightCm} min={120} max={230} onChange={(v) => void updateProfile({ heightCm: v === null ? null : Math.round(v) })} />
        <NumberField label="Weight" suffix="kg" value={p.weightKg} min={30} max={250} onChange={(v) => void updateProfile({ weightKg: v })} />
      </div>
      <button type="button" class="linkish small" style={{ alignSelf: 'flex-start' }} onClick={() => { setUseBirth(!useBirth); if (useBirth) void updateProfile({ birthDate: null }); }}>
        {useBirth ? 'Enter age instead' : 'Use birth date (keeps age-based targets correct over time)'}
      </button>
      {compact ? null : (
        <Field label="Activity (all daily movement, including training)" for="st-act">
          <select id="st-act" class="select" value={p.planner.act} onChange={(e) => void updatePlanner({ act: e.currentTarget.value as ActivityKey })}>
            {ACTIVITY.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}
