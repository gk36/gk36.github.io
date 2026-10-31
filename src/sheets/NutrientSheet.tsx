import { useMemo } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { useAsync, useLive } from '../ui/hooks';
import { listDay } from '../data/entries';
import { ageFor } from '../data/profile';
import { entryNutrients } from '../domain/diary';
import { NUTRIENTS, type NutrientId } from '../domain/nutrition/nutrients';
import { fmtNutrient } from '../domain/nutrition/format';
import { displayName } from '../domain/nutrition/food';
import { describeQuantity } from '../domain/nutrition/quantity';
import { topContributors } from '../domain/micros/coverage';
import { groupLabel, referencesFor } from '../domain/micros/dri';
import { addDays, formatDayLabel, type DayKey } from '../domain/time';
import { closeSheet, profile } from '../app/store';
import { loadDri } from '../screens/Nutrients';
import type { LogEntry } from '../data/types';

/** "Why does it say 120 % vitamin C?" — every contributing food, its amount and source. */
export function NutrientSheet({ id, dayKey, range }: { id: NutrientId; dayKey: DayKey; range: 'day' | 'week' }) {
  const p = profile.value!;
  const def = NUTRIENTS[id];
  const dri = useAsync(loadDri, []);
  const age = ageFor(p, dayKey);
  const ref = useMemo(() => (dri && p.sex && age !== null ? referencesFor(dri, p.sex, age)?.get(id) ?? null : null), [dri, p.sex, age, id]);
  const entries = useLive(async () => {
    const days = range === 'day' ? [dayKey] : Array.from({ length: 7 }, (_, i) => addDays(dayKey, -i));
    const all: LogEntry[] = [];
    for (const d of days) all.push(...(await listDay(d)).filter((e) => e.status === 'eaten'));
    return all;
  }, [dayKey, range], [] as LogEntry[]);
  const items = entries.map((e) => ({ key: e.id, label: `${displayName(e.food)} · ${describeQuantity(e.food, e.qty)}${range === 'week' ? ` · ${formatDayLabel(e.dayKey)}` : ''}`, value: entryNutrients(e).n[id], src: e.food.src }));
  const top = topContributors(items, 12);
  const missing = items.filter((i) => i.value === undefined);
  const total = items.reduce((s, i) => s + (i.value ?? 0), 0);
  const days = range === 'week' ? new Set(entries.map((e) => e.dayKey)).size || 1 : 1;

  return (
    <Sheet title={def.label} onClose={closeSheet}>
      <div class="stack-s">
        <p><b class="num">{missing.length && items.length > missing.length ? '≥ ' : ''}{fmtNutrient(id, total / days)}</b> {range === 'week' ? 'per day (average of days with food)' : `on ${formatDayLabel(dayKey)}`}</p>
        {ref?.target ? <p class="small">Reference: <b>{fmtNutrient(id, ref.target)}</b> per day ({ref.kind === 'AI' ? 'Adequate Intake — set where evidence is weaker than for an RDA' : 'Recommended Dietary Allowance'}) for {groupLabel(ref.group)}.</p> : null}
        {ref?.ul ? <p class="small">Upper limit from food and supplements: <b>{fmtNutrient(id, ref.ul)}</b>. Above it is not “extra credit”.</p> : null}
        {ref?.limit ? <p class="small">Chronic-disease risk reduction: aim to stay below <b>{fmtNutrient(id, ref.limit)}</b>.</p> : null}
        {ref?.ulNote ? <p class="small muted">{ref.ulNote}</p> : null}
        {def.note ? <p class="small muted">{def.note}</p> : null}
      </div>
      <section class="stack-s" aria-label="Contributing foods">
        <h3 class="card-title">Where it came from</h3>
        {top.length ? (
          <table class="ntable">
            <thead><tr><th scope="col">Food</th><th scope="col" style={{ textAlign: 'right' }}>Amount</th><th scope="col" style={{ textAlign: 'right' }}>Share</th></tr></thead>
            <tbody>
              {top.map((c) => {
                const src = items.find((i) => i.key === c.key)?.src;
                return (
                  <tr key={c.key}>
                    <td>{c.label}{src?.fdcId ? <div class="xs subtle">USDA FDC {src.fdcId}</div> : src ? <div class="xs subtle">{src.type === 'label' ? 'Your label' : src.type}</div> : null}</td>
                    <td class="v">{fmtNutrient(id, c.amount)}</td>
                    <td class="v">{Math.round(c.share * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p class="small muted">No eaten food reports this nutrient.</p>}
      </section>
      {missing.length ? (
        <section class="callout small" aria-label="Foods without data">
          <b>No data for {missing.length} food{missing.length > 1 ? 's' : ''}:</b> {missing.slice(0, 8).map((m) => m.label).join(', ')}{missing.length > 8 ? '…' : ''}. These are not counted as zero — the real total is probably higher.
        </section>
      ) : null}
      {ref?.sources.length ? <p class="xs subtle">Reference source: {ref.sources.map((s) => <a key={s} href={s} target="_blank" rel="noopener noreferrer">{new URL(s).hostname}</a>)}</p> : null}
    </Sheet>
  );
}
