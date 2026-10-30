import type { DayRecord, LogEntry, Slot } from '../../data/types';
import { entryNutrients } from '../../domain/diary';
import { displayName, PREP_LABEL } from '../../domain/nutrition/food';
import { describeQuantity } from '../../domain/nutrition/quantity';
import { roundFor } from '../../domain/nutrition/format';
import { openSheet } from '../../app/store';
import { eatNow } from '../../app/actions';
import { Check, Plus } from '../../ui/icons';
import type { DayKey } from '../../domain/time';
import { DEFAULT_SLOTS } from '../../data/profile';

export function slotsFor(day: DayRecord | undefined, entries: readonly LogEntry[], defaults: readonly Slot[] = DEFAULT_SLOTS): Slot[] {
  const base = day?.slots?.length ? [...day.slots] : defaults.map((s) => ({ ...s }));
  for (const e of entries) if (!base.some((s) => s.id === e.slotId)) base.push({ id: e.slotId, name: 'Other' });
  return base;
}

export function EntryRow({ e, compact }: { e: LogEntry; compact?: boolean }) {
  const r = entryNutrients(e);
  const name = displayName(e.food);
  const amount = describeQuantity(e.food, e.qty);
  const planned = e.status === 'planned';
  return (
    <div class={`item${planned ? ' planned' : ''}`}>
      <button type="button" class="item-main linkish" style={{ color: 'inherit', textAlign: 'left', fontWeight: 'inherit' }} onClick={() => openSheet({ kind: 'entry', entryId: e.id })}
        aria-label={`${name}, ${amount}, ${e.status}. Edit`}>
        <span class="item-name">{name}</span>
        <span class="item-sub">
          {amount}{e.food.prep !== 'as-sold' ? ` · ${PREP_LABEL[e.food.prep]}` : ''}
          {e.status === 'skipped' ? ' · skipped' : ''}
          {e.planned && e.status === 'eaten' ? ` · planned ${describeQuantity(e.food, e.planned.qty)}` : ''}
        </span>
        {r.error ? <span class="error">{r.error}</span> : null}
      </button>
      <div class="item-end">
        <span class="num"><b>{r.n.kcal === undefined ? '?' : roundFor('kcal', r.n.kcal)}</b> <span class="muted small">kcal</span></span>
        {!compact ? <span class="small muted num">P {r.n.protein === undefined ? '?' : roundFor('protein', r.n.protein)}</span> : null}
      </div>
      {planned ? (
        <button type="button" class="btn btn-s" onClick={() => void eatNow(e)} aria-label={`Mark ${name} eaten`}><Check size={16} /> Eaten</button>
      ) : null}
    </div>
  );
}

export function MealList({ dayKey, slots, entries, compact }: { dayKey: DayKey; slots: readonly Slot[]; entries: readonly LogEntry[]; compact?: boolean }) {
  return (
    <div class="stack">
      {slots.map((s) => {
        const rows = entries.filter((e) => e.slotId === s.id);
        if (compact && rows.length === 0 && !s.id.startsWith('plan-')) return null;
        const kcal = rows.filter((e) => e.status === 'eaten').reduce((sum, e) => sum + (entryNutrients(e).n.kcal ?? 0), 0);
        const plannedKcal = rows.filter((e) => e.status === 'planned').reduce((sum, e) => sum + (entryNutrients(e).n.kcal ?? 0), 0);
        return (
          <section class="meal" key={s.id} aria-label={s.name}>
            <div class="meal-head">
              <div>
                <h3 class="meal-name">{s.name}</h3>
                <div class="meal-meta">{[s.badge, s.time].filter(Boolean).join(' · ')}</div>
              </div>
              <div class="cluster">
                <span class="small num"><b>{Math.round(kcal)}</b> kcal{plannedKcal ? <span class="subtle"> · +{Math.round(plannedKcal)} planned</span> : null}</span>
                <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label={`Add food to ${s.name}`} onClick={() => openSheet({ kind: 'quicklog', dayKey, slotId: s.id })}><Plus size={18} /></button>
              </div>
            </div>
            {rows.length ? <div class="list">{rows.map((e) => <EntryRow key={e.id} e={e} compact={compact} />)}</div> : <p class="small subtle" style={{ padding: '4px 0 6px' }}>Nothing yet.</p>}
          </section>
        );
      })}
    </div>
  );
}
