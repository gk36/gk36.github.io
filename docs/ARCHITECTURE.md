# Architecture

## Decision (ADR-001): TypeScript + Vite + Preact, static build at `/app/`

| Option | Verdict |
|---|---|
| Modularise the vanilla JS (ES modules, no build) | No build step, but keeps the string-template UI that was already the bottleneck and gives weak typing for units, prep states and migrations. |
| **TypeScript + Vite + Preact (signals)** ✅ | Strict types and tests for the hard parts; components in ~4 KB; code-splitting keeps heavy optional features (food data, scanners, solvers) out of the first load; output is plain static files. |
| React | Same model, ~10× the runtime, no benefit here. |

The app is served next to the classic pages on the same origin, so it can read v1 data for migration without
changing those pages.

## Layers

```
src/
  domain/            pure TypeScript — no DOM, no storage (unit-tested)
    nutrition/       nutrient dictionary, food model, quantities, null-aware sums, labels, swaps
    planning/        v1 template planner (bit-for-bit port) + core-food bindings; replan (goal-programming LP)
    time.ts          day keys (wall-clock day start; DST-safe)
    search.ts        accent-insensitive Greek/English search
    diary.ts         eaten / planned / projected totals
  data/              IndexedDB via Dexie, schemas (Zod), repositories, backup, v1 import
    foods/           core.json (generated), registry (core + custom foods)
  app/               router (hash routes), signals store, high-level actions
  ui/                design-system components (sheets, controls, nutrition widgets, icons)
  screens/           Today, Diary, Plan, Foods, Settings, More, Train, Session, Kitchen, Nutrients, Pantry, Onboarding
  sheets/            Quick log, entry editor, food detail/editor, swap, copy day, saved meals, slots, scan,
                     recipe/cook, nutrient drill-down, pantry item, replan
  styles/            tokens.css (dark + light, WCAG-tested) and base.css
```

## Data

- **Local-first:** IndexedDB (`carbmaxx` database). Records carry UUIDv7 ids, `createdAt`, `updatedAt`, `rev`
  and a `deletedAt` tombstone (deletes are soft, so undo and future sync work).
- **Entries snapshot their food** at logging time, so editing or deleting a food never changes history.
- **Targets are frozen per day** the first time a day is used, so changing goals never rewrites past days.
- **Schema changes** add a new Dexie `version()` with an upgrade function; existing versions are never edited.
- **Validation:** Zod schemas guard backups, imports and custom foods (Zod runs jitless — no `eval`).

## Replan engine ("plans change")

`domain/planning/replan.ts` builds a small linear program (javascript-lp-solver, pure JS, loaded only when the
replan sheet opens):

- **Variables:** amount of each still-planned or offered food (grams, mL or whole pieces; eggs are integers).
- **Hard constraints:** eaten food is not in the model; keep / leave-out choices; a practical single-serving
  maximum; shared stock per food (pantry lots, or what is left of a cooked batch); optional per-meal calorie cap
  (relaxed with a note if the kept amounts already break it).
- **Soft goals:** for kcal, protein, carbs and fat, `food + under − over = what is left`. Inside a tolerance band
  (kcal ±3 %, protein −5/+15 g, carbs ±10 g, fat ±5 g) a miss is nearly free; beyond it each unit costs a fixed
  weight (protein shortfall 14, or 40 with "protein first"; protein excess 3; fat over 6…), so an impossible day
  yields the closest plan and an honest shortfall, never a fake match.
- **Priorities** add non-negative per-food costs (they pick between foods, never push one to its maximum);
  unknown values earn no credit, and unknown saturated fat counts as all of the fat.
- **Closeness:** |new − planned| is priced in kcal so grams and pieces compare fairly.
- Results are rounded to weighable amounts without breaking a stock or a limit (property-tested), applied in one
  transaction, and stored as a day event that can be reverted.

## Security baseline

- Strict Content-Security-Policy injected into production builds (`script-src 'self' 'wasm-unsafe-eval'`,
  `style-src 'self'`, explicit `connect-src`). GitHub Pages cannot send headers, so it is a `<meta>` tag
  (`frame-ancestors` is therefore unavailable).
- No third-party runtime scripts; fonts and icons are bundled.
- Text from labels, remote APIs or the user is rendered as text, never as HTML.

## Deployment

- `npm run build` → `app/` (committed). Merging to `main` publishes it at `https://gk36.github.io/app/`.
- CI (`.github/workflows/ci.yml`) runs type-check, unit/property/parity tests, the build, a check that the
  committed `app/` matches the source, and Playwright end-to-end tests. It never deploys.
- Optional later: switch Pages to the "GitHub Actions" source and deploy from a workflow instead of committing
  `app/` (one repository setting).
