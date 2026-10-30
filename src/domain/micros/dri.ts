import { convertUnit, NUTRIENTS, type NutrientId, type Unit } from '../nutrition/nutrients';

/**
 * NASEM Dietary Reference Intakes (via NIH ODS / NAP), stored in src/domain/micros/dri-table.json with
 * citations. Values are converted from the table's units into each nutrient's canonical unit here.
 */
export type DriKind = 'RDA' | 'AI' | 'CDRR';
export interface DriEntry {
  unit: 'g' | 'mg' | 'µg';
  kind: DriKind;
  values: (number | null)[];
  ul: (number | null)[];
  ulScope: string;
  cdrr?: (number | null)[];
  sources: string[];
}
export interface DriGroup { sex: 'male' | 'female'; minAge: number; maxAge: number }
export interface DriTable {
  source: string;
  retrieved: string;
  groups: DriGroup[];
  nutrients: Record<string, DriEntry>;
  notes: string[];
}

export interface Reference {
  id: NutrientId;
  /** RDA or AI in the nutrient's canonical unit. */
  target: number | null;
  kind: DriKind | null;
  /** Upper limit in canonical units, only when it applies to food sources. */
  ul: number | null;
  ulNote: string | null;
  /** Sodium's chronic-disease-risk-reduction intake ("reduce intakes above"). */
  limit: number | null;
  group: DriGroup;
  sources: string[];
}

/** Which nutrient a table key maps to (vitamin A's UL is checked against preformed retinol). */
const KEY_TO_ID: Record<string, NutrientId> = {
  calcium: 'calcium', phosphorus: 'phosphorus', magnesium: 'magnesium', potassium: 'potassium', sodium: 'sodium',
  iron: 'iron', zinc: 'zinc', copper: 'copper', manganese: 'manganese', selenium: 'selenium', iodine: 'iodine',
  vitA: 'vitA', vitC: 'vitC', vitD: 'vitD', vitE: 'vitE', vitK: 'vitK', thiamin: 'thiamin', riboflavin: 'riboflavin',
  niacin: 'niacin', pantothenic: 'pantothenic', vitB6: 'vitB6', biotin: 'biotin', folate: 'folate', vitB12: 'vitB12',
  choline: 'choline', fiber: 'fiber', ala: 'ala',
};

/** A UL only means something for food when it covers all sources (or preformed vitamin A from food). */
export function ulAppliesToFood(scope: string): boolean {
  const s = scope.toLowerCase();
  if (s.includes('supplement') && !s.includes('all sources') && !s.includes('food')) return false;
  if (s.includes('synthetic') || s.includes('fortified')) return false;
  return s.includes('all') || s.includes('preformed') || s.includes('food');
}

export function groupIndex(table: DriTable, sex: 'male' | 'female', age: number): number {
  return table.groups.findIndex((g) => g.sex === sex && age >= g.minAge && age <= g.maxAge);
}

export function referencesFor(table: DriTable, sex: 'male' | 'female', age: number): Map<NutrientId, Reference> | null {
  const gi = groupIndex(table, sex, age);
  if (gi < 0) return null;
  const group = table.groups[gi]!;
  const out = new Map<NutrientId, Reference>();
  for (const [key, e] of Object.entries(table.nutrients)) {
    const id = KEY_TO_ID[key];
    if (!id) continue;
    const to: Unit = NUTRIENTS[id].unit;
    const conv = (v: number | null | undefined) => (v === null || v === undefined ? null : convertUnit(v, e.unit, to));
    const ulRaw = conv(e.ul[gi]);
    const ulApplies = ulRaw !== null && ulAppliesToFood(e.ulScope);
    const ref: Reference = {
      id, target: conv(e.values[gi]), kind: e.kind, ul: ulApplies ? ulRaw : null,
      ulNote: ulRaw !== null && !ulApplies ? `Upper limit (${e.ulScope}) — not applied to food.` : null,
      limit: e.cdrr ? conv(e.cdrr[gi]) : null, group, sources: e.sources,
    };
    out.set(id, ref);
    // Vitamin A: the target is total RAE, but the upper limit is for preformed retinol only.
    if (id === 'vitA') {
      out.set('vitA', { ...ref, ul: null, ulNote: 'The upper limit applies to preformed vitamin A (retinol), shown separately.' });
      if (ulRaw !== null) out.set('retinol', { ...ref, id: 'retinol', target: null, kind: null, ul: ulRaw, ulNote: 'Upper limit for preformed vitamin A from food and supplements.' });
    }
  }
  return out;
}

export const groupLabel = (g: DriGroup) => `${g.sex === 'male' ? 'Males' : 'Females'} ${g.maxAge >= 200 ? `${g.minAge}+` : `${g.minAge}–${g.maxAge}`}`;
