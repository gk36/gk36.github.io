# Test plan

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Nutrition core | Vitest + fast-check | `src/domain/nutrition/nutrition.test.ts` | Exact scaling (per 100 g / 100 mL / serving / unit / portions), decimal commas, density-gated g↔mL, EU vs US carbs, unknown ≠ zero (property tests), label energy reconciliation, salt→sodium, kJ→kcal, impossible-value rejection, display rounding |
| Calendar | Vitest | `src/domain/time.test.ts` | Day start, Athens 25-hour (2026-10-25) and 23-hour (2027-03-28) days, month/year arithmetic, birthdays |
| Planner parity | Vitest + fast-check | `tests/legacy-parity.test.ts` | The port reproduces the live `index.html` planner exactly: 126-scenario grid + 400 random setups, every target and every meal amount |
| Data layer | Vitest + fake-indexeddb | `tests/data.test.ts` | Planned vs eaten, plan-vs-actual, undo, duplicate/move/copy, frozen day targets, backup round trip, rejection of damaged files, rollback on mid-import failure, merge semantics, v1 import clamping, read-only guarantee, single-profile cloud fetch |
| Design tokens | Vitest | `tests/contrast.test.ts` | WCAG 2.2 AA contrast for every text token on every surface in both themes; 3:1 for macro bars |
| End to end | Playwright | `e2e/` | Desktop Chromium (1440×900) and iPhone 15 WebKit: onboarding targets, logging cooked foods, editing amounts, planned→eaten, undo, keyboard-only logging, copy yesterday, label foods, Plan today, backup export/wipe/import, v1 import, axe scans of every screen and sheet; every test fails on any console error or CSP violation |

## Known engine quirk

WebKit reports a `style-src-attr` CSP violation whenever a `<select>` is created from script, even on a one-line
page, while rendering it normally. The e2e error watcher ignores exactly that message in WebKit only.

## Run

```bash
npm test          # unit, property, parity, data, contrast
npm run e2e       # build first (npm run build); uses vite preview on :4173
```

## Not automated (manual, on a real phone)

- Camera features (when added) and Home Screen installation on iOS.
- Logging a real day and spot-checking 5 foods against packaging.
