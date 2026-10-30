# Roadmap & status

Each milestone lands on the `carbmaxx-2` branch with tests. Merging to `main` publishes the site — that is always
the owner's decision.

| # | Milestone | Status |
|---|---|---|
| 0 | Audit, backup, plan | ✅ done (backup of the old cloud data saved locally, outside the repo) |
| 1 | **Ledger** — diary (planned vs eaten), Today, USDA core foods, label foods, saved meals, planner bridge, backups, v1 import | ✅ done — 252 unit + 19 e2e tests |
| 2 | Account & sync — sign-in, per-user cloud data, conflict-safe sync, migration of v1 cloud profiles | ⏳ planned (needs a one-time Firebase console setup by the owner) |
| 3 | Packaged foods — camera barcode scanning, Open Food Facts lookup, verify & save, offline repeat | ✅ done — live camera (native reader, or a self-hosted WebAssembly reader on iPhone), photo or typed code, check-digit validation, cached lookups |
| 4 | Kitchen — recipes and batch cooking with measured cooked yield, leftovers, scaling | ✅ done — portions are exact fractions of the weighed batch (property-tested), raw↔cooked yield estimator |
| 5 | Nutrients — age/sex reference intakes, unknown-aware coverage report, drill-downs, meal compare | ✅ done — NASEM DRIs for 27 nutrients, upper limits only where they apply to food, top contributors, 7-day average |
| 6 | Label reader — photo → OCR (Greek + English) → verified label values | ⏳ planned |
| 7 | Pantry & replan — stock, shopping list, constrained optimizer with explanations | ✅ done — pantry lots (eaten/cooked food comes out, undoable), shopping list, "Replan rest of day" (linear programming, 6 priorities, explanations, history + undo) |
| 8 | Training — session logging, progression, PRs; program editor and 3D viewer ported | ✅ logging done — v1 programs import read-only; sets, rest timer, prefill, PRs, weekly muscle volume, time budget. Program editor and 3D viewer stay on the classic page for now |
| 9 | Hardening — installable PWA, accessibility and performance audits | 🔨 offline app shell and install done; audits planned |

## Acceptance stories covered so far

- **A (manual label path):** create a label food (Greek EU-style), log grams, unknown micronutrients stay unknown. ✅
- **B (diary form):** log raw/cooked foods in the state weighed; change an amount and every view updates. ✅
- **A (barcode path):** photo or typed barcode → Open Food Facts → check → save → log 250 mL; the second scan answers
  offline from the saved food. ✅
- **C (actual vs plan):** three planned meals → breakfast eaten differently → unplanned 255 mL juice → "only use food in my
  pantry" replan → eaten food untouched, every planned food within stock, the diary projects exactly what the replan
  promised, and undo restores the previous plan. ✅
- **D (batch prep):** recipe → cook → weigh the batch (860 g) → eat 190 g now and 167 g later; leftovers 670 g → 503 g,
  every portion an exact fraction of the batch. ✅
- **E (micronutrient truth):** per-nutrient coverage against age/sex DRIs, per-food contributors, meal-vs-meal compare,
  and foods without a value shown as unknown, never zero. ✅
- **G (partial):** replan priorities "More micronutrients" and "Lowest saturated fat" (unknown saturated fat counts as
  all of the fat); an unplanned dessert is absorbed without starvation advice. A breakfast *generator* is not built yet.
- **H (exercise log):** import a custom v1 split without touching v1 data, log weighted dips, next session prefilled
  with a progression hint. ✅ (3D animation: classic page)

## Owner decisions still open

- Deploy method at merge time: committed `app/` (works today) or a GitHub Actions deploy (one setting).
- Firebase account setup for sync (milestone 2).
