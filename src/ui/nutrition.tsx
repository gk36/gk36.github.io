import { NUTRIENTS, type NutrientId } from '../domain/nutrition/nutrients';
import type { Totals } from '../domain/nutrition/compute';
import { coverageNote, fmtNutrient, fmtTotal, roundFor } from '../domain/nutrition/format';
import type { NutrientMap, Source } from '../domain/nutrition/food';
import { ExternalLink } from './icons';

const COLOR: Partial<Record<NutrientId, string>> = { kcal: 'var(--kcal)', protein: 'var(--protein)', carbs: 'var(--carbs)', fat: 'var(--fat)', fiber: 'var(--fiber)' };

/**
 * Progress toward a target. The solid part is EATEN; a hatched segment shows what is PLANNED
 * but not eaten yet. Values are always written out — never colour alone.
 */
export function MacroBar({ id, eaten, planned, target, label }: { id: NutrientId; eaten: number; planned?: number; target?: number; label?: string }) {
  const name = label ?? NUTRIENTS[id].label;
  const unit = NUTRIENTS[id].unit === 'kcal' ? 'kcal' : NUTRIENTS[id].unit;
  const t = target && target > 0 ? target : null;
  const eatenPct = t ? Math.min(100, (eaten / t) * 100) : 0;
  const plannedPct = t && planned ? Math.max(0, Math.min(100 - eatenPct, (planned / t) * 100)) : 0;
  const over = t !== null && eaten > t * 1.05;
  const text = t ? `${roundFor(id, eaten)} of ${roundFor(id, t)} ${unit}` : `${roundFor(id, eaten)} ${unit}`;
  return (
    <div class="bar-row">
      <div class="bar-label">
        <span class="cluster"><span class="dot" style={{ background: COLOR[id] ?? 'var(--fg-muted)' }} aria-hidden="true" /><b>{name}</b></span>
        <span class="num">
          <b>{roundFor(id, eaten)}</b>
          {t ? <span class="muted"> / {roundFor(id, t)} {unit}</span> : <span class="muted"> {unit}</span>}
          {planned ? <span class="subtle"> · +{roundFor(id, planned)} planned</span> : null}
        </span>
      </div>
      <div
        class={`bar-track${over ? ' bar-over' : ''}`} role="progressbar" aria-label={name}
        aria-valuemin={0} aria-valuemax={t ? Math.round(t) : undefined} aria-valuenow={Math.round(eaten)} aria-valuetext={`${text}${planned ? `, ${roundFor(id, planned)} more planned` : ''}`}
      >
        <div class="bar-fill" style={{ width: `${eatenPct}%`, background: COLOR[id] ?? 'var(--fg-muted)' }} />
        {plannedPct > 0 ? <div class="bar-planned" style={{ left: `${eatenPct}%`, width: `${plannedPct}%` }} /> : null}
      </div>
    </div>
  );
}

/**
 * Today's calories as a ring: solid = eaten, faint = planned on top. The numbers are always written
 * in the middle and in the label, never colour alone.
 */
export function CalorieRing({ eaten, planned, target }: { eaten: number; planned: number; target?: number | undefined }) {
  const size = 132, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const t = target && target > 0 ? target : null;
  const e = t ? Math.min(1, eaten / t) : 0;
  const p = t ? Math.max(0, Math.min(1 - e, planned / t)) : 0;
  const over = t !== null && eaten > t * 1.05;
  const label = t
    ? `${Math.round(eaten).toLocaleString('en-GB')} of ${Math.round(t).toLocaleString('en-GB')} kcal eaten${planned ? `, ${Math.round(planned).toLocaleString('en-GB')} more planned` : ''}`
    : `${Math.round(eaten).toLocaleString('en-GB')} kcal eaten`;
  return (
    <div class="ring" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle class="ring-track" cx={mid} cy={mid} r={r} stroke-width={stroke} />
        {p > 0 ? <circle class="ring-planned" cx={mid} cy={mid} r={r} stroke-width={stroke} stroke-dasharray={`${p * c} ${c}`} stroke-dashoffset={-e * c} transform={`rotate(-90 ${mid} ${mid})`} /> : null}
        {e > 0 ? <circle class={`ring-fill${over ? ' over' : ''}`} cx={mid} cy={mid} r={r} stroke-width={stroke} stroke-dasharray={`${e * c} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} /> : null}
      </svg>
      <div class="ring-center" aria-hidden="true">
        <span class="hero-num">{Math.round(eaten).toLocaleString('en-GB')}</span>
        <span class="xs muted">{t ? `of ${Math.round(t).toLocaleString('en-GB')} kcal` : 'kcal eaten'}</span>
      </div>
    </div>
  );
}

/** Nutrient table that says "unknown" instead of inventing zeros. */
export function NutrientTable({ ids, values, totals, caption }: { ids: readonly NutrientId[]; values?: NutrientMap; totals?: Totals; caption?: string }) {
  return (
    <table class="ntable">
      {caption ? <caption class="sr-only">{caption}</caption> : null}
      <thead><tr><th scope="col">Nutrient</th><th scope="col" style={{ textAlign: 'right' }}>Amount</th></tr></thead>
      <tbody>
        {ids.map((id) => {
          if (totals) {
            const t = totals[id];
            const note = coverageNote(t);
            const unknown = t.known === 0;
            return (
              <tr key={id} class={unknown ? 'unknown' : ''}>
                <td>{NUTRIENTS[id].label}{note ? <div class="hint">{note}</div> : null}</td>
                <td class="v">{fmtTotal(id, t)}</td>
              </tr>
            );
          }
          const v = values?.[id];
          return (
            <tr key={id} class={v === undefined ? 'unknown' : ''}>
              <td>{NUTRIENTS[id].label}</td>
              <td class="v">{fmtNutrient(id, v)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const SOURCE_LABEL: Record<Source['type'], string> = {
  'usda-fdc': 'USDA', label: 'Label', off: 'Open Food Facts', user: 'Custom', estimate: 'Estimate', proxy: 'Proxy', 'legacy-v1': 'CARBMAXX v1',
};

export function SourceBadge({ src }: { src: Source }) {
  const tone = src.type === 'usda-fdc' || (src.type === 'label' && src.verifiedAt) ? 'ok' : src.confidence === 'low' || src.type === 'estimate' || src.type === 'proxy' ? 'warn' : '';
  return <span class={`badge ${tone}`} title={src.note ?? `${SOURCE_LABEL[src.type]} · ${src.confidence} confidence`}>{SOURCE_LABEL[src.type]}</span>;
}

export function SourceLine({ src }: { src: Source }) {
  return (
    <div class="small muted cluster">
      <SourceBadge src={src} />
      {src.dataset ? <span>{src.dataset}{src.release ? ` (${src.release})` : ''}</span> : null}
      {src.fdcId ? <a href={`https://fdc.nal.usda.gov/food-details/${src.fdcId}/nutrients`} target="_blank" rel="noopener noreferrer" class="cluster">FDC {src.fdcId} <ExternalLink size={13} aria-hidden="true" /><span class="sr-only">(opens in new tab)</span></a> : null}
      <span>· {src.confidence} confidence</span>
    </div>
  );
}

export function MacroLine({ n, compact }: { n: NutrientMap; compact?: boolean }) {
  const part = (id: NutrientId, prefix: string) => (n[id] === undefined ? `${prefix} ?` : `${prefix} ${roundFor(id, n[id]!)}`);
  return (
    <span class="num">
      {n.kcal === undefined ? '? kcal' : `${roundFor('kcal', n.kcal)} kcal`}
      {compact ? null : <span class="muted"> · {part('protein', 'P')} · {part('carbs', 'C')} · {part('fat', 'F')}</span>}
    </span>
  );
}
