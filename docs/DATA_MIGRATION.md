# Data migration & backups

## From CARBMAXX v1 (classic pages)

The classic planner keeps profiles in this origin's `localStorage` (`carbmaxx_profiles_v1`) and in the old cloud
path under a profile name. The workout page uses `carbmaxx_workout_profiles_v1`.

CARBMAXX 2.0 only **reads** v1 data:

1. **On this device:** Onboarding / Settings → *CARBMAXX v1* lists the profiles found locally. Choosing one maps
   weight, height, age, sex, activity, goal, cut style, day type, timing and all planner options and food picks.
   Every field is clamped exactly like v1's `applySnapshot()` did.
2. **By name from the old cloud:** fetches that **one** profile (never the whole collection). Useful on iPhone,
   where a Home Screen app has storage separate from Safari.
3. The raw v1 JSON is archived inside the new app (`legacy` table) so nothing is lost even if the old pages change.

v1 keys are never written, renamed or deleted (tested: `tests/data.test.ts`, `e2e/foods-plan-data.spec.ts`).
The classic pages keep working exactly as before.

## Backups

- **Export:** Settings → *Export backup* downloads a JSON file with every table (including deletion tombstones).
- **Import:** the file is validated completely before anything is written. Then either
  - **Merge** — keeps the newer copy of each record (`updatedAt`, then `rev`), or
  - **Replace** — clears local data, but first stores the current data as a *pre-import snapshot* that can be
    restored from Settings.
- Imports run in a single IndexedDB transaction: any failure rolls everything back.

## Storage durability

Browsers may evict "best effort" storage, and **iPhone Safari deletes script-written data after 7 days without a
visit** unless the site is installed to the Home Screen. CARBMAXX:

- asks for persistent storage (`navigator.storage.persist()`),
- shows an *Add to Home Screen* hint on iPhone,
- tracks and shows when you last exported a backup.

Cloud sync with a real account is planned (see [Roadmap](ROADMAP.md)).

## Schema versions

The IndexedDB schema is versioned with Dexie. New versions add an upgrade function; old versions are never edited.
v1 diary, foods, settings · v2 Open Food Facts cache · v3 training programs and sessions · v4 pantry, shopping list
and day history (replans) · v5 sync metadata. Backups include every table except the Open Food Facts cache and
sync metadata; older backups (without the newer tables) still import. Device-only settings (`auth`, `sync`, the
pre-import snapshot) are never exported and survive a "replace" import.

Moving from the classic name-based cloud profiles: import the v1 profile on any device (Settings → CARBMAXX v1),
then sign in to sync — it travels to your other devices from there. The classic data is never modified.
Backups carry `schema: 1`; a backup from a newer app version is refused instead of being partially imported.
