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
| Sync | Vitest + fake-indexeddb | `tests/sync.test.ts` | Two devices through a fake server with the real rules: exact round trip (empty arrays, nulls), edits and deletes both ways, nothing pushed twice, newest wins even when the older device syncs last, a racing older write refused then recovered, other accounts isolated, device bound to one account, damaged records skipped, sign-in token and sync state never synced or exported; auth client requests, error messages, token refresh |
| Typed meals | Vitest | `src/domain/logging/logging.test.ts` | The owner's two example sentences, Greek, decimal commas and fractions, units and kitchen measures, number words, vague amounts, compound names, plural/inflection matching, look-alikes never auto-picked, raw/cooked questions, calorie-ambiguous foods, cooked weight refused for dry-only foods, remembered phrases, generic words never matched alone |
| Meal ideas | Vitest + fast-check | `src/domain/ideas/ideas.test.ts` | Ideas fit calories/protein/fat/sat-fat targets with totals recomputed from the foods, amounts within sensible servings, avoided foods (any language) never used, pantry-only uses stock only, very high oxalate foods left out, the user's own sauce used when it exists, instructions name every ingredient's exact amount, every recipe builds, re-balancing, determinism, property test over random targets/pantries/dislikes |
| Oxalate | Vitest | `src/domain/micros/oxalate.test.ts` | Cited values per weight (raw and dry foods through the cooked pair, flagged as such), zero stays zero, per-serving-only and missing values never counted as zero, dishes counted by their ingredients with what could not be counted |
| Starter recipes & ideas data | Vitest + fake-indexeddb | `tests/examples-ideas.test.ts` | The six starter recipes are valid with honest totals, the sauce placeholder has no values, seeded once and never resurrected after an edit or delete; meal size from what is left; gaps against the DRIs; a logged idea counts exactly and takes its ingredients from the pantry |
| Pantry & replan data | Vitest + fake-indexeddb | `tests/pantry-replan.test.ts` | Deduction soonest-expiring first across lots, by weight for pieces, never below zero, exact undo; different foods untouched; shopping merge and "bought → pantry"; backups include pantry/list/history; replan apply leaves eaten food untouched, respects stock, matches the diary totals, records history and reverts exactly; food eaten meanwhile is never changed; a batch's stock counts once |
| End to end | Playwright | `e2e/` | Desktop Chromium (1440×900) and iPhone 15 WebKit: onboarding targets, logging cooked foods, editing amounts, planned→eaten, undo, keyboard-only logging, copy yesterday, label foods, Plan today, backup export/wipe/import, v1 import, barcode photo → lookup → log and offline repeat, check-digit rejection, batch prep with leftovers, acceptance C (pantry-only replan, reconcile, undo), pantry deduction + undo, shopping list → pantry, label photo OCR on the device (rendered bilingual label → exact values, hand-typed values kept, no network), workout tools without pop-ups, acceptance I (two devices + a second account against a simulated Firebase), typed meals (the owner's sentence with exact USDA totals, the unknown sauce entered from its label and remembered, vague items blocking, Greek, meals typed into the search box), meal ideas (taste card, three ideas fitting the size, steps, edit and re-balance, log = diary, pantry-only, starter recipes), oxalate (exact total, "at least" with a per-scoop food, the user's limit, the food page's value or "unknown"), workout import/log/prefill (incl. typing during the rest timer), offline reload, axe scans in light and dark of every screen (incl. nutrients with the oxalate card, kitchen, training, pantry, shopping list) and of the sheets (replan, meal ideas, typed meal, recipe editor, quick log, food editor, food page); every test fails on any console error or CSP violation |
| Performance | Lighthouse 13.5 (mobile, simulated throttling) | manual, before a release | Built app served by `vite preview`: Performance 99, Accessibility 100, Best Practices 100, SEO 100 (2026-10-30) |

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
