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
    planning/        v1 template planner (bit-for-bit port) + core-food bindings
    time.ts          day keys (wall-clock day start; DST-safe)
    search.ts        accent-insensitive Greek/English search
    diary.ts         eaten / planned / projected totals
  data/              IndexedDB via Dexie, schemas (Zod), repositories, backup, v1 import
    foods/           core.json (generated), registry (core + custom foods)
  app/               router (hash routes), signals store, high-level actions
  ui/                design-system components (sheets, controls, nutrition widgets, icons)
  screens/           Today, Diary, Plan, Foods, Settings, More, Train, Onboarding
  sheets/            Quick log, entry editor, food detail/editor, swap, copy day, saved meals, slots
  styles/            tokens.css (dark + light, WCAG-tested) and base.css
```

## Data

- **Local-first:** IndexedDB (`carbmaxx` database). Records carry UUIDv7 ids, `createdAt`, `updatedAt`, `rev`
  and a `deletedAt` tombstone (deletes are soft, so undo and future sync work).
- **Entries snapshot their food** at logging time, so editing or deleting a food never changes history.
- **Targets are frozen per day** the first time a day is used, so changing goals never rewrites past days.
- **Schema changes** add a new Dexie `version()` with an upgrade function; existing versions are never edited.
- **Validation:** Zod schemas guard backups, imports and custom foods (Zod runs jitless — no `eval`).

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
