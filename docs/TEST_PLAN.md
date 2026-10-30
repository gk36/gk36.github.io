# Test plan

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Nutrition core | Vitest + fast-check | `src/domain/nutrition/nutrition.test.ts` | Exact scaling (per 100 g / 100 mL / serving / unit / portions), decimal commas, density-gated g↔mL, EU vs US carbs, unknown ≠ zero (property tests), label energy reconciliation, salt→sodium, kJ→kcal, impossible-value rejection, display rounding |
| Calendar | Vitest | `src/domain/time.test.ts` | Day start, Athens 25-hour (2026-10-25) and 23-hour (2027-03-28) days, month/year arithmetic, birthdays |
| Planner parity | Vitest + fast-check | `tests/legacy-parity.test.ts` | The port reproduces the live `index.html` planner exactly: 126-scenario grid + 400 random setups, every target and every meal amount |
| Data layer | Vitest + fake-indexeddb | `tests/data.test.ts` | Planned vs eaten, plan-vs-actual, undo, duplicate/move/copy, frozen day targets, backup round trip, rejection of damaged files, rollback on mid-import failure, merge semantics, v1 import clamping, read-only guarantee, single-profile cloud fetch |
| Design tokens | Vitest | `tests/contrast.test.ts` | WCAG 2.2 AA contrast for every text token on every surface in both themes; 3:1 for macro bars |
| Barcodes & Open Food Facts | Vitest + fake-indexeddb | `tests/barcode-off.test.ts` | GTIN-8/12/13/14 check digits, UPC-E expansion, product mapping (per 100 mL for liquids, salt→sodium, unit conversions, US carb convention), 404 cached as not-found, 429/503 not cached, rate limit between requests |
| Micronutrients | Vitest | `src/domain/micros/micros.test.ts` | DRI lookup by age/sex, unit conversion, which upper limits apply to food, retinol-only vitamin A limit, sodium CDRR, coverage statuses with unknowns, contributors, 7-day average skipping empty days |
| Recipes & batches | Vitest + fast-check | `src/domain/kitchen/recipe.test.ts` | Batch totals, per-100 g or per-serving foods, portions as exact fractions (conservation property test), leftovers, scaling, raw↔cooked yield estimate bounds |
| Training | Vitest | `src/domain/training/training.test.ts` | Prescription parsing, e1RM, working sets, volume per muscle, PRs (dominated sets ignored), progression hints, time-budget fitting |
| Replan optimizer | Vitest + fast-check | `src/domain/planning/replan.test.ts` | No negative amounts, stock shared across entries (exact "all of it"), kept/left-out choices, honest shortfall notes, no forced extra protein, each priority changes the choice, unknown saturated fat = all fat, priorities never push a food to its maximum, whole eggs, per-meal cap (relaxed with a note when kept amounts break it); property test: bounds, stock after rounding, totals add up |
| Label text | Vitest | `src/domain/nutrition/labelText.test.ts` | Bilingual EU tables, two columns (per 100 g wins, serving size read), per 100 mL with "<" values, US Nutrition Facts (per serving, sodium mg, added sugars ignored), OCR digit noise (O→0), real mixed-script Tesseract output (Greek look-alike letters in English words and units), protein ≠ fibre (πρωτεΐνες/ίνες), unsaturated ≠ saturated, impossible/contradictory values flagged, no table found |
| Pantry & replan data | Vitest + fake-indexeddb | `tests/pantry-replan.test.ts` | Deduction soonest-expiring first across lots, by weight for pieces, never below zero, exact undo; different foods untouched; shopping merge and "bought → pantry"; backups include pantry/list/history; replan apply leaves eaten food untouched, respects stock, matches the diary totals, records history and reverts exactly; food eaten meanwhile is never changed; a batch's stock counts once |
| End to end | Playwright | `e2e/` | Desktop Chromium (1440×900) and iPhone 15 WebKit: onboarding targets, logging cooked foods, editing amounts, planned→eaten, undo, keyboard-only logging, copy yesterday, label foods, Plan today, backup export/wipe/import, v1 import, barcode photo → lookup → log and offline repeat, check-digit rejection, batch prep with leftovers, acceptance C (pantry-only replan, reconcile, undo), pantry deduction + undo, shopping list → pantry, label photo OCR on the device (rendered bilingual label → exact values, hand-typed values kept, no network), workout tools without pop-ups, workout import/log/prefill (incl. typing during the rest timer), offline reload, axe scans of every screen (incl. nutrients, kitchen, training, pantry, shopping list) and of the main sheets (incl. replan); every test fails on any console error or CSP violation |

## Known engine quirk

WebKit reports a `style-src-attr` CSP violation whenever a `<select>` is created from script, even on a one-line
page, while rendering it normally. The e2e error watcher ignores exactly that message in WebKit only.

## Run

```bash
npm test          # unit, property, parity, data, contrast
npm run e2e       # build first (npm run build); uses vite preview on :4173
```

## Not automated (manual, on a real phone)

- Live camera scanning on a real phone (the e2e tests decode a generated barcode photo instead), and Home Screen
  installation on iOS.
- Open Food Facts is mocked in e2e; one manual lookup of a real product confirms the live API shape.
- Logging a real day and spot-checking 5 foods against packaging.
