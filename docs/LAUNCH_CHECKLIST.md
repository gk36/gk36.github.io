# Launch checklist: CARBMAXX 2.0

Plain steps, in order. Each one says who does it. Nothing on the live site changes until step 4, and only
when you say so.

## 1. Try the private preview (you)

- [ ] Open the private preview link from Claude. On a phone or computer, try:
  - Today → "What did you eat?": type a meal in English or Greek, check it, log it.
  - Today → "What should I eat?": meal ideas, then change an amount.
  - Nutrients → the Oxalate card (log a potato or a banana first).
  - Kitchen → open a starter recipe, change an ingredient.
  - Diary, Plan, Pantry, Train.
- [ ] Note anything that looks wrong or confusing, and send the list to Claude.

The preview can't use the camera or work offline (the preview page blocks both). Both are tested on the real
site.

## 2. Final checks (Claude runs them, you read the summary)

- [ ] All automated tests pass: unit tests, and browser tests on desktop Chrome and on iPhone Safari.
- [ ] Lighthouse speed and accessibility check on a simulated phone.
- [ ] A fresh read-only backup of the classic cloud data, compared with the earlier one, saved on your
  computer (never in this repository).

## 3. Firebase setup for sync (together, one step at a time)

Claude walks you through [SYNC_SETUP.md](SYNC_SETUP.md):

- [ ] Switch on email sign-in.
- [ ] Add the new app's database rules **next to** the existing ones. Don't change the existing ones.
- [ ] Before you press Publish, read the whole rules box with Claude. Claude will tell you privately if
  anything should be tightened. Changing an existing rule is always your decision.
- [ ] Copy the Web API key. Claude puts it in the app.
- [ ] Optional: restrict the key to this website.

Sync can also come later. The app works fully on one device without it.

## 4. Go live (you decide)

- [ ] Claude opens a pull request from `carbmaxx-2` to `main`. That only shows the changes; nothing goes live.
- [ ] You look at it on GitHub, then press **Merge** (or tell Claude "merge it").
- [ ] About a minute later, GitHub Pages serves:
  - the new app at `https://gk36.github.io/app/`;
  - a "CARBMAXX 2.0" tab and banner on the classic pages.
- [ ] The classic pages keep working as before, and nothing is deleted.

## 5. Right after going live (about 10 minutes)

- [ ] On the iPhone, open `https://gk36.github.io/app/` in Safari → Share → **Add to Home Screen**. From now
  on, open CARBMAXX from that icon. Safari deletes a website's data after 7 days unused; Home Screen apps keep
  it.
- [ ] In the app, import your classic profile by name, or start fresh.
- [ ] If sync is set up: Settings → Sync → **Create account**. The header should say "Synced".
- [ ] Log one meal on the phone, and check it shows on the computer.
- [ ] Settings → **Export backup**. Keep the file somewhere safe.
- [ ] Open the classic page and check your profile still looks the same.

## If something goes wrong

- The classic pages are separate files, and they keep working.
- To undo the launch, Claude makes a "revert" commit on `main`. The site goes back to how it was within a
  minute. Nothing is deleted.
- Your data in the new app lives on your device, and also in your account once sync is on. Export a backup
  before big changes.

## Keep in mind

- Use the Home Screen app on iPhone, not a Safari tab.
- Export a backup about once a month (Settings shows when you last did).
- Nutrient and oxalate numbers are information, not medical advice. If your doctor gave you an oxalate
  limit, set it on the Oxalate card.
