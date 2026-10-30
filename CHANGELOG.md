# Changelog

## 2.0.0-alpha.6 — typed meals, meal ideas, starter recipes, a new Today (unreleased, branch `carbmaxx-2`)

- **Type what you ate** (Today's "What did you eat?" box, or the Log food search), in English or Greek:
  "I ate 282 g cooked chicken breast, 300 g cooked rice, 77 g sweet chili sauce and an apple". Each item is
  matched to a real food and shown with its calories before anything is saved.
  - Unclear items wait for an answer: an unknown food (scan it or enter the label and come straight back),
    cooked or raw/dry, "some" or "a glass of", or foods that differ in calories (which milk?).
  - Every food and amount can be changed, and corrections are remembered.
- **Meal ideas** ("What should I eat?"): three real meals with exact grams, sized to what is left of today.
  - They are built from your pantry, aimed at today's vitamin and mineral gaps, and follow your taste.
  - Sweet breakfasts come first, protein first, saturated fat is kept modest, and foods you avoid never
    appear (broccoli and cabbage are pre-filled).
  - Steps are written from the chosen foods and amounts.
  - Edit any amount and the rest re-balances. Then log it, plan it, save it as a recipe, or put what's
    missing on the shopping list.
- **Lower-oxalate preference**: uses cited values only (Harvard 2023 table first), and foods without data stay
  unknown.
- **Starter recipes** in the Kitchen: protein cream of rice, oat pancakes, chicken and rice, steak and
  potatoes, sweet chili chicken noodles, and lean beef soup.
  - They are built from USDA foods and marked "Example".
  - The sweet chili sauce has no values until you add your own bottle.
- **Today, redesigned**: a calorie ring with what's left, the typing box, meal ideas and one row of quick
  actions.
- Recipes and meal ideas logged as eaten take their ingredients out of the pantry.
- 20 more USDA foods (whey, skimmed milk, cottage cheese 1%, kiwi, maple syrup, egg noodles, broth, spices…).
- iPhone: form fields no longer zoom the page when tapped.
- The classic page has a "CARBMAXX 2.0" tab and banner that open the new app (live after the merge).

## 2.0.0-alpha.5 — milestone 2: sync across devices (unreleased, branch `carbmaxx-2`)

- **Sign in to sync** (Settings → Sync across devices, or "Already use CARBMAXX on another device?" on the
  welcome screen): diary, foods, recipes and batches, pantry, shopping list, workouts and profile follow you to
  every device. Works offline; sync catches up on start, after changes, on returning online, and every 5 minutes.
- Only your account can read or write your data (database rules); the newest edit of each record wins, and the
  server refuses an older version overwriting a newer one. A device synced with one account won't sync into
  another. The sign-in token stays on the device and never goes into backups.
- Header chip shows Synced / Syncing… / Offline · saved here / Sync problem.
- Off until the owner completes the one-time Firebase setup in `docs/SYNC_SETUP.md`.

## 2.0.0-alpha.4 — milestone 6: read a label from a photo (unreleased, branch `carbmaxx-2`)

- **Read label photo** in the label editor: photograph the nutrition table; the numbers are read on the
  phone (Greek + English, nothing is uploaded) and fill the *empty* fields — anything typed by hand wins.
  Works with EU per-100 g/mL tables and US Nutrition Facts (serving size, sodium in mg); "less than" values,
  impossible numbers and contradictions are flagged; "What the camera read" shows the raw text.
- The workout logger no longer uses browser pop-ups (blocked or clumsy in installed iPhone apps).

## 2.0.0-alpha.3 — milestone 7: pantry and "plans change" (unreleased, branch `carbmaxx-2`)

- **Pantry:** what you have at home, in the state it's in (raw chicken 420 g, cooked rice 250 g, 6 eggs), with
  use-by dates and estimates. Food logged as eaten — and ingredients of a cooked batch — come out of it
  automatically (switchable); undo puts them back. Scanned products can go straight into the pantry.
- **Shopping list:** add items or foods; the same food tops up instead of duplicating; tick what you bought and
  it moves into the pantry. Items that run out or expire can be sent to the list.
- **Replan rest of day:** after eating something different, rebalances only what is still planned — eaten food
  never changes. A linear program respects what you have (one stock feeds every meal that uses it, batches count
  once), keeps or leaves out foods you choose, can cap a meal's calories, and never invents an exact match: what
  ends up short or over is shown per target. Priorities: closest to plan, protein first, more micronutrients,
  most filling, lowest saturated fat, use expiring food. Every amount has a "Why this amount?" breakdown, and
  every replan is saved in the day's history and can be undone.

## 2.0.0-alpha.2 — milestones 3, 4, 5 and 8 (unreleased, branch `carbmaxx-2`)

- **Scan a barcode** with the camera, a photo, or by typing it. Codes are check-digit validated; lookups go to
  Open Food Facts, are cached on the device, and a product you saved opens instantly, even offline.
- **Kitchen:** recipes with ingredients, method and time; cook a batch, weigh it, log portions by weight and see
  what's left. A raw↔cooked converter estimates yield and says that it is an estimate.
- **Nutrients:** a full report against your age/sex reference intakes (27 nutrients), with what contributed each
  one, a 7-day average, meal-vs-meal compare, and unknown values kept unknown. Today shows your biggest gaps.
- **Training:** import a classic program (read-only), log sets with a rest timer, get the last session prefilled
  with a progression hint, PRs, weekly volume per muscle and a "fit it into N minutes" option.
- **Works offline** and can be installed to the Home Screen; new versions wait until you choose to reload.
- Vitamin A's upper limit is checked against preformed retinol only (plant carotenoids don't count).

## 2.0.0-alpha.1 — CARBMAXX 2.0, milestone 1 (unreleased, branch `carbmaxx-2`)

New app at `/app/`. The classic planner, workout page and private page are unchanged.

- Food diary with planned / eaten / skipped entries; planned food never counts as eaten.
- Today dashboard: eaten vs target vs left, planned projection, fibre coverage.
- 97 USDA FoodData Central core foods in raw and cooked states; Greek + English search.
- Add packaged foods from their label (EU or US conventions, per 100 g / 100 mL / serving).
- The v1 planner, rebuilt on the new foods, writes planned diary entries.
- Copy days, saved meals, swap a food keeping protein/carbs/kcal, undo.
- Backups (export, merge or replace with a restorable snapshot); import of v1 profiles (read-only).
- Light and dark themes, keyboard shortcuts (`/` search, `Ctrl+Z` undo), screen-reader friendly controls.
- Data stays on the device.
