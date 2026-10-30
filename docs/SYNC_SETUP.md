# Turning on sync (one-time, owner only)

Sync is built and tested, but it stays off until these Firebase console steps are done. Nothing here changes
the classic pages.

## 1. Switch on email sign-in

Firebase console → project **carbmaxx** → **Build → Authentication** → *Get started* (first time only) →
**Sign-in method** → **Email/Password** → *Enable* → *Save*. Leave "Email link (passwordless sign-in)" off.

Why email and password: it works inside the installed iPhone app. Email links and Google pop-ups open Safari,
which has separate storage from a Home Screen app.

## 2. Add the database rules for the new app

**Build → Realtime Database → Rules.** Copy the `"v2": { … }` block from
[`firebase-rules-v2.json`](firebase-rules-v2.json) and paste it inside the existing `"rules": { … }` object,
next to what is already there. Do not change or remove the existing entries. Then press **Publish**.

What the rules enforce:

- Each account can read and write only `/v2/users/<its own id>`.
- Every record must have the expected shape, and its server time is stamped by the server.
- A device can never overwrite a newer version of a record with an older one.
- Records cannot be deleted. Deletes travel as "deleted at" markers, so undo works on every device.

## 3. Get the Web API key

**Project settings → General → Your apps.** If there is no Web app yet: *Add app → Web*, any nickname, no
Hosting. Copy the `apiKey` value (it starts with `AIza`).

The key is a public identifier, not a password. Sign-in and the rules above are what protect the data.

## 4. Put the key in the app

Edit `src/data/sync/config.ts` and set `apiKey: 'AIza…'`, then rebuild (`npm run build`) and commit — or ask
Claude to do it.

To try it on one device first: **Settings → Sync across devices → "Owner: try a Firebase Web API key on this
device"**.

## 5. Optional hardening

In Google Cloud console → **APIs & Services → Credentials**, open the browser key:

- **Application restrictions:** HTTP referrers `https://gk36.github.io/*` (plus `http://localhost:*/*` while
  developing).
- **API restrictions:** Identity Toolkit API and Token Service API.

## 6. Check it

1. On the phone: Settings → Sync → *Create account* → the header says **Synced**.
2. On the computer: open the app → *Already use CARBMAXX on another device?* → *Sign in*. The diary appears,
   and setup is skipped.
3. Log something on one device and press *Sync now* on the other. (Sync also runs by itself: on start, a few
   seconds after any change, when the app comes back into view or online, and every five minutes.)

## What is stored where

- **Where:** your records go to the Firebase Realtime Database (Google Cloud, europe-west1) under your
  account id, as exact copies of what is on the device.
- **Password:** handled by Firebase Authentication; the app never stores it. The app keeps a sign-in token on
  the device. It is never synced and never included in backups. *Sign out* removes it, and your data stays
  on the device.
- **Shared devices:** a device that has synced with one account refuses to sync into another, so one
  person's diary never lands in someone else's account.
