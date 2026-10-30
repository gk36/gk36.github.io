# Roadmap & status

Each milestone lands on the `carbmaxx-2` branch with tests. Merging to `main` publishes the site — that is always
the owner's decision.

| # | Milestone | Status |
|---|---|---|
| 0 | Audit, backup, plan | ✅ done (backup of the old cloud data saved locally, outside the repo) |
| 1 | **Ledger** — diary (planned vs eaten), Today, USDA core foods, label foods, saved meals, planner bridge, backups, v1 import | ✅ done — 252 unit + 19 e2e tests |
| 2 | Account & sync — sign-in, per-user cloud data, conflict-safe sync, offline app shell, migration of v1 cloud profiles | ⏳ planned (needs a one-time Firebase console setup by the owner) |
| 3 | Packaged foods — camera barcode scanning, Open Food Facts lookup, verify & save, offline repeat | ⏳ planned |
| 4 | Kitchen — recipes and batch cooking with measured cooked yield, leftovers, scaling | ⏳ planned |
| 5 | Nutrients — age/sex reference intakes, unknown-aware coverage report, drill-downs, meal compare | ⏳ planned |
| 6 | Label reader — photo → OCR (Greek + English) → verified label values | ⏳ planned |
| 7 | Pantry & replan — stock, shopping list, constrained optimizer with explanations | ⏳ planned |
| 8 | Training — session logging, progression, PRs; program editor and 3D viewer ported | ⏳ planned |
| 9 | Hardening — installable PWA, accessibility and performance audits | ⏳ planned |

## Acceptance stories covered so far

- **A (manual label path):** create a label food (Greek EU-style), log grams, unknown micronutrients stay unknown. ✅
- **B (diary form):** log raw/cooked foods in the state weighed; change an amount and every view updates. ✅
- **C (partial):** plan → mark eaten with different amounts → add an unplanned drink; totals reconcile. ✅ (pantry substitution: milestone 7)

## Owner decisions still open

- Deploy method at merge time: committed `app/` (works today) or a GitHub Actions deploy (one setting).
- Firebase account setup for sync (milestone 2).
