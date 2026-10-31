import { useMemo } from 'preact/hooks';
import type { Totals } from '../../domain/nutrition/compute';
import { NUTRIENTS } from '../../domain/nutrition/nutrients';
import { coverageFor } from '../../domain/micros/coverage';
import { referencesFor } from '../../domain/micros/dri';
import { ageFor } from '../../data/profile';
import { profile } from '../../app/store';
import { href } from '../../app/router';
import { useAsync } from '../../ui/hooks';
import { loadDri, MINERALS, VITAMINS } from '../Nutrients';
import type { DayKey } from '../../domain/time';

/** Today's three lowest-covered nutrients so far — lower bounds when some foods lack data. */
export function NutrientGaps({ totals, dayKey, eatenCount }: { totals: Totals; dayKey: DayKey; eatenCount: number }) {
  const p = profile.value!;
  const dri = useAsync(loadDri, []);
  const age = ageFor(p, dayKey);
  const refs = useMemo(() => (dri && p.sex && age !== null ? referencesFor(dri, p.sex, age) : null), [dri, p.sex, age]);
  if (!refs || eatenCount === 0) return null;
  const rows = coverageFor(totals, refs, [...VITAMINS, ...MINERALS, 'fiber'])
    .filter((r) => r.pct !== null && (r.status === 'partial' || r.status === 'low'))
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .slice(0, 3);
  const unknown = coverageFor(totals, refs, [...VITAMINS, ...MINERALS]).filter((r) => r.status === 'unknown').length;
  const flagged = coverageFor(totals, refs, [...VITAMINS, ...MINERALS]).filter((r) => r.status === 'over-ul' || r.status === 'over-limit');
  return (
    <section class="card stack-s" aria-labelledby="gaps-title">
      <div class="spread">
        <h2 id="gaps-title" class="card-title">Nutrients so far</h2>
        <a class="small" href={href('nutrients', dayKey)}>All nutrients</a>
      </div>
      {rows.length ? (
        <p class="small">Lowest so far: {rows.map((r, i) => (
          <span key={r.id}>{i ? ', ' : ''}<b>{NUTRIENTS[r.id].label}</b> {r.unknown ? '≥ ' : ''}{Math.round((r.pct ?? 0) * 100)}%</span>
        ))}.</p>
      ) : <p class="small">Every nutrient with data is at or above its reference so far.</p>}
      {flagged.length ? <p class="small" style={{ color: 'var(--warn)' }}>Above a limit: {flagged.map((f) => NUTRIENTS[f.id].label).join(', ')}.</p> : null}
      <p class="xs subtle">Micronutrient data known for {Math.round(totals.calcium.energyShare * 100)}% of today's energy{unknown ? ` · ${unknown} nutrients have no data yet` : ''}. Planned food is not counted.</p>
    </section>
  );
}
