# Nutrition data model

## Principles

1. **Unknown is never zero.** A nutrient that a source does not report is absent from the food's map and is
   counted as *unknown*. Totals report a lower bound plus coverage (`≥ 8 g · known for 2 of 3 foods`).
2. **Weigh it the way it was measured.** Foods carry an explicit preparation state (`raw`, `dry`, `boiled`,
   `roasted`, `pan-cooked`, `baked`, `grilled`, `drained`, `as-sold`, `prepared`). Core foods come in raw/cooked
   pairs (`pair`) so you log the record that matches what you weighed.
3. **Labels are never rewritten.** Stated energy is kept even when 4/4/9 math disagrees; a mismatch is flagged.
4. **Round only for display.** Amounts are stored as entered and summed at full precision.

## Food

```ts
Food {
  id: 'core:<key>' | 'custom:<uuid>'
  names: { en, el?, aliases? }
  kind: 'generic' | 'branded' | 'custom'; brand?; gtin?
  group, prep
  basis: { per: '100g' } | { per: '100ml' } | { per: 'unit', unitLabel, unitG? }
  densityGPerMl?            // only when known — g↔mL conversion is refused without it
  portions: { id, label, g? , ml? }[]   // USDA household portions (weights verified at build time)
  n: Partial<Record<NutrientId, number>> // per basis; missing = unknown
  nd?: Partial<Record<NutrientId, string>> // USDA derivation code per nutrient (A = analytical, Z = assumed zero, …)
  carbsIncludeFiber: boolean // true = US/USDA total carbohydrate; false = EU label (fibre excluded)
  kcalOrigin: 'label' | 'database' | 'computed'
  src: { type, confidence, dataset?, fdcId?, ref?, release?, verifiedAt?, note? }
}
```

### Carbohydrate conventions

EU (and Greek) labels declare carbohydrate **excluding** fibre; USDA reports **total** carbohydrate including
fibre. Contributions are normalised to total carbohydrate: for EU foods fibre is added back when it is known;
when it is not, the entry is flagged (`carbsExcludeUnknownFiber`) and the Today screen says so.

### Energy reconciliation

`atwaterKcal` uses 4/4/9 (+7 alcohol) for total-carbohydrate foods and EU factors (fibre 2 kcal/g) for EU labels.
Tolerances: labels > 10 kcal **and** > 5 % → flagged; database foods (USDA uses food-specific factors) > 20 kcal
**and** > 15 % → flagged. Nothing is auto-corrected.

### Labels

`normalizeLabel()` converts what is printed into a canonical basis: kJ → kcal (÷ 4.184, marked derived),
salt → sodium (÷ 2.5, i.e. 400 mg sodium per g salt, marked derived), "per 30 g serving" → per 100 g exactly once.
It rejects impossible values (sugars > carbohydrate, saturates > fat, > 100 g of macros per 100 g, > 900 kcal/100 g).

## Quantities

`{ amount, unit: 'g' }`, `{ amount, unit: 'ml' }` or `{ amount, unit: 'portion', portionId }`. `resolveQuantity`
returns how many bases a quantity represents; mL on a per-100 g food (or the reverse) requires a known density.
Decimal commas (`41,5`) and simple fractions (`1 1/2`) are accepted.

## Core food set (v1)

117 foods: 112 USDA SR Legacy records (2018-04) and 5 labelled derivations. The 20 added for meal ideas and the
starter recipes include whey protein (generic), skimmed milk *without* added vitamins A/D, cottage cheese 1%, kiwi,
maple syrup, chia, egg noodles (unenriched), beef broth, baking powder, cinnamon, cocoa, vanilla, graham crackers,
garlic, celery, spring onion, lemon and lime juice, and salt. Plain everyday names ("rice", "chicken", "ρύζι") are
aliases, so typed meals find the food people usually mean.

| Entry | Source type | Why |
|---|---|---|
| Ground chicken breast (raw) | proxy | Same as skinless breast; packaged mince often contains skin |
| Mixed berries | estimate | Equal-weight average of strawberries, blueberries, raspberries |
| Purple sweet potato | proxy | Macros from orange sweet potato; **vitamin A deliberately unknown** |
| Beef bone broth | estimate | Typical commercial values; brands vary |
| tbJP cream of rice Sticky Toffee | label | Label values carried over from v1 |

Rice and pasta use **unenriched** USDA records (EU products are not fortified). Gnocchi is intentionally absent:
the only USDA match is a homemade recipe unlike packaged gnocchi — add it from the pack label.
Iodine and biotin are unknown for all core foods (SR Legacy does not measure them).

## Oxalate

Kept apart from the USDA values, in `domain/ideas/oxalate.ts`, because the sources and units differ:

- Sources, in order: Harvard T.H. Chan Oxalate Table 2023 (mg per stated serving), peer-reviewed lab
  measurements (mg per 100 g), then university kidney-stone lists. Each value records its source, and where
  sources disagree (potatoes, berries, bananas, oranges, carrots…) the disagreement is noted.
- Serving weights come from USDA portions of the same food. Raw and dry foods use their cooked pair's value
  through the raw↔cooked yield.
- Levels follow UPMC: low under 2 mg, moderate 2–10 mg, high over 10 mg per serving. "Very high", over 50 mg,
  is our own cut-off for ranking.
- Foods without a cited value (egg white, kefir, feta, cream of rice, rice noodles, chia…) are unknown, never
  assumed low.

## Days

A day key is the local calendar date of the user's day, which starts at a configurable hour (default 04:00) in
the user's time zone. Comparison is by wall-clock time, so 25-hour and 23-hour DST days are handled.
