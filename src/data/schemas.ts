import { z } from 'zod';
import { NUTRIENT_IDS } from '../domain/nutrition/nutrients';

// The app's CSP forbids eval; without this Zod probes `Function('')` to decide whether to JIT
// its validators, which browsers report as a CSP violation.
z.config({ jitless: true });

/** Validation for everything that crosses a trust boundary: imports, backups, storage reads. */

const num = z.number().finite();
const nonNeg = num.nonnegative();
const iso = z.string().min(10).max(40);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const nutrientMapSchema = z.partialRecord(z.enum(NUTRIENT_IDS), nonNeg);

export const quantitySchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('g'), amount: nonNeg }),
  z.object({ unit: z.literal('ml'), amount: nonNeg }),
  z.object({ unit: z.literal('portion'), amount: nonNeg, portionId: z.string().min(1).max(80) }),
]);

export const basisSchema = z.discriminatedUnion('per', [
  z.object({ per: z.literal('100g') }),
  z.object({ per: z.literal('100ml') }),
  z.object({ per: z.literal('unit'), unitLabel: z.string().min(1).max(80), unitG: nonNeg.optional() }),
]);

export const sourceSchema = z.object({
  type: z.enum(['usda-fdc', 'label', 'off', 'user', 'estimate', 'proxy', 'legacy-v1']),
  confidence: z.enum(['high', 'medium', 'low']),
  dataset: z.string().max(80).optional(),
  fdcId: z.number().int().optional(),
  ref: z.string().max(400).optional(),
  release: z.string().max(40).optional(),
  verifiedAt: z.string().max(40).optional(),
  note: z.string().max(600).optional(),
});

const portionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  g: nonNeg.optional(),
  ml: nonNeg.optional(),
});

const recordMeta = {
  createdAt: iso,
  updatedAt: iso,
  deletedAt: iso.nullable().optional(),
  rev: z.number().int().nonnegative(),
};

export const foodSchema = z.object({
  id: z.string().min(1).max(120),
  names: z.object({ en: z.string().min(1).max(200), el: z.string().max(200).optional(), aliases: z.array(z.string().max(80)).max(30).optional() }),
  kind: z.enum(['generic', 'branded', 'custom']),
  brand: z.string().max(120).optional(),
  gtin: z.string().regex(/^\d{8,14}$/).optional(),
  group: z.enum(['protein', 'dairy', 'starch', 'fruit', 'veg', 'fat', 'sweet', 'drink', 'other']),
  prep: z.enum(['raw', 'dry', 'boiled', 'roasted', 'pan-cooked', 'baked', 'grilled', 'drained', 'as-sold', 'prepared']),
  basis: basisSchema,
  densityGPerMl: num.positive().max(3).optional(),
  portions: z.array(portionSchema).max(40),
  n: nutrientMapSchema,
  nd: z.partialRecord(z.enum(NUTRIENT_IDS), z.string().max(12)).optional(),
  carbsIncludeFiber: z.boolean(),
  kcalOrigin: z.enum(['label', 'database', 'computed']),
  src: sourceSchema,
  pair: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  labelServing: z.object({ label: z.string().max(120), g: nonNeg.optional(), ml: nonNeg.optional() }).optional(),
  createdAt: iso.optional(),
  updatedAt: iso.optional(),
  deletedAt: iso.nullable().optional(),
  rev: z.number().int().nonnegative().optional(),
});

const snapshotSchema = foodSchema.omit({ createdAt: true, updatedAt: true, deletedAt: true, rev: true });

export const entrySchema = z.object({
  id: z.string().min(1).max(80),
  dayKey,
  slotId: z.string().min(1).max(80),
  order: num,
  foodId: z.string().min(1).max(120),
  food: snapshotSchema,
  qty: quantitySchema,
  status: z.enum(['planned', 'eaten', 'skipped']),
  planned: z.object({ foodId: z.string().max(120), foodName: z.string().max(300), qty: quantitySchema }).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().max(2000).optional(),
  origin: z.enum(['search', 'plan', 'saved-meal', 'copy', 'quick', 'import', 'barcode', 'recipe']),
  ...recordMeta,
});

const slotSchema = z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(80), time: z.string().max(80).optional(), badge: z.string().max(80).optional() });

export const daySchema = z.object({
  dayKey,
  slots: z.array(slotSchema).max(20),
  targets: z.object({
    kcal: nonNeg, protein: nonNeg, carbs: nonNeg, fat: nonNeg, fiber: nonNeg.optional(),
    source: z.enum(['template', 'manual']), label: z.string().max(200), bmr: nonNeg.optional(), tdee: nonNeg.optional(), computedAt: iso,
  }).optional(),
  dayType: z.enum(['gym', 'rest']).optional(),
  planInput: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(4000).optional(),
  ...recordMeta,
});

export const savedMealSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  items: z.array(z.object({ foodId: z.string().max(120), food: snapshotSchema, qty: quantitySchema })).max(60),
  ...recordMeta,
});

export const weightSchema = z.object({ dayKey, kg: num.min(20).max(400), ...recordMeta });

export const settingSchema = z.object({ key: z.string().min(1).max(80), value: z.unknown() });

export const BACKUP_SCHEMA = 1;

export const backupSchema = z.object({
  app: z.literal('carbmaxx'),
  kind: z.literal('backup'),
  schema: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.object({
    entries: z.array(entrySchema),
    days: z.array(daySchema),
    foods: z.array(foodSchema),
    savedMeals: z.array(savedMealSchema),
    weights: z.array(weightSchema),
    settings: z.array(settingSchema),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;
