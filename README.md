# CARBMAXX

A local-first food diary, meal planner and training tracker that runs as a static site on
GitHub Pages.

| Path | What it is |
|---|---|
| `/` (`index.html`) | Classic CARBMAXX planner (v1) — unchanged |
| `/workout.html` | Classic training program + 3D exercise viewer — unchanged |
| `/hub.html` | Private, encrypted page — unchanged |
| `/app/` | **CARBMAXX 2.0** — the new app (built from `src/`) |

## CARBMAXX 2.0 in one minute

- **Diary that tells the truth.** Planned food never counts as eaten until you mark it. Plan-vs-actual is kept.
- **Weigh it how you cooked it.** Core foods come from USDA FoodData Central in the states you weigh
  them (raw *and* roasted chicken, dry *and* cooked rice…), each with its FDC id.
- **Unknown is never zero.** Missing nutrient data is shown as unknown, and totals say “≥ … · known for 7 of 9 foods”.
- **Your labels.** Add any packaged food from its label (Greek/EU or US style, per 100 g, per 100 mL or per serving) —
  or photograph the table and the numbers are read on your phone for you to check.
- **Your planner.** The v1 meal template (goals, cut styles, gym/rest timings, food picks) writes *planned* entries.
- **Scan it.** Barcode by camera, photo or typing → Open Food Facts → check → save; saved products work offline.
- **Cook once, eat all week.** Batch recipes weighed after cooking; every portion is an exact share of the batch.
- **See every nutrient.** Coverage against your age/sex reference intakes, with what contributed each one.
- **Plans change.** Ate something else? "Replan rest of day" rebalances only what is still planned, using what's in
  your pantry — every change explained, nothing eaten touched, one tap to undo.
- **Pantry & shopping list.** Stock comes down when you eat or cook; bought items go back in.
- **Train.** Log sets from your program with a rest timer, prefilled weights, PRs and weekly volume.
- **Works offline**, installable to the Home Screen.
- **Your data stays on your device** (IndexedDB), and — once sync is switched on — in your own account, readable
  only by you. Export/import backups at any time.

## Develop

Requires Node 22+.

```bash
npm ci
npm run dev          # http://localhost:5173/app/
npm run check        # type-check + unit tests + build
npm run e2e          # Playwright: desktop Chromium + iPhone WebKit (run `npx playwright install` once)
```

`npm run build` writes the production app to `app/`. **The built `app/` folder is committed** so GitHub Pages can
serve it with no settings change; CI fails if `app/` does not match the source.

### Food data

`src/data/foods/core.json` is generated from the curated list in `scripts/foods/core-foods.source.json` and the
official USDA bulk files (public domain, CC0):

```bash
npm run foods:build -- --sr <FoodData_Central_sr_legacy_food_json_2018-04.json> --foundation <…json> --fndds <surveyDownload.json>
```

Downloads: <https://fdc.nal.usda.gov/download-datasets/>. The build verifies every pick (description, required
macros, and that each portion weight is one of USDA's own portions) and refuses to write on any mismatch.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Nutrition data model](docs/NUTRITION_DATA_MODEL.md)
- [Data migration & backups](docs/DATA_MIGRATION.md)
- [Test plan](docs/TEST_PLAN.md)
- [Roadmap & status](docs/ROADMAP.md)
- [Turning on sync (owner)](docs/SYNC_SETUP.md)
- [Changelog](CHANGELOG.md)

## Sources & licences

- Generic food composition: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central,
  SR Legacy (2018). Public domain (CC0 1.0).
- Packaged products: Open Food Facts contributors, Open Database License (ODbL); attribution is shown wherever
  their data appears. Crowd-sourced — the app asks you to check it against the package.
- Reference intakes: National Academies of Sciences, Engineering, and Medicine, Dietary Reference Intakes (via NIH
  Office of Dietary Supplements fact sheets and the 2019 sodium/potassium report); sources per nutrient in
  `src/domain/micros/dri-table.json`.
- Barcode reading on browsers without a built-in reader: zxing-wasm (MIT) / ZXing-C++ (Apache-2.0), self-hosted.
- Label OCR: Tesseract.js and tesseract.js-core (Apache-2.0) with the tessdata_best_int Greek and English models
  (Apache-2.0), self-hosted under `/app/ocr/`.
- Calorie estimate: Mifflin–St Jeor × activity factor — an estimate to check against your weight trend.
- This app is general information, not medical or dietetic advice.
