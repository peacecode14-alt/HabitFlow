# HabitFlow

A bilingual (Arabic / English) habit tracker built with vanilla HTML, CSS and JavaScript. Installable as a PWA, works offline, optional end-to-end-encrypted cloud sync.

## Run
1. Extract the ZIP and open the folder in VS Code.
2. Run `index.html` with the Live Server extension (ES modules and the service worker need a web server, not `file://`).

## Features
- **Habits**: name, category (built-in or your own), icon, color, weekly schedule.
- **Two habit types**: done / not done, or a **counter** with a daily target (e.g. 8 glasses of water).
- **Daily check-in** from the dashboard, and **edit any past day** from the calendar (tap a day), including a per-day note.
- **Per-habit streaks** (current and best) that follow each habit's own schedule, and completion rates that count only scheduled days.
- **Filters that combine**: status (All / Active / Completed today / Archived) + category + search; sort by newest, name, category or streak.
- **Archive** a habit to pause it without losing history. **Undo** after deleting.
- **Reminders** at a time you choose per habit (in-app toast, plus system notification if you allow it).
- **Starter templates** on the empty screen.
- Arabic / English with automatic RTL, dark / light themes, responsive layout.
- Accessible: keyboard navigation, focus trap in dialogs, skip link, ARIA labels and states, reduced-motion support.
- **Backup**: export and **import** (also accepts backups from older versions).
- Installable PWA with icons; the app shell works offline.
- Optional **cloud sync** with optional **end-to-end encryption** (see below).

## Data and storage
Data lives in browser `localStorage` (`habitflow_data`). Clearing site data removes it, so export a backup occasionally or use cloud sync.

Schema version 3:

```json
{
  "schemaVersion": 3,
  "habits": [{
    "id": "...", "name": "...", "category": "Health",
    "type": "check | count", "target": 1, "reminderTime": "08:30",
    "archivedAt": null, "createdAt": "ISO", "updatedAt": "ISO",
    "log": { "2026-11-15": { "v": 1, "t": "ISO", "n": "optional note" } },
    "completions": ["2026-11-15"]
  }],
  "deleted": { "<habitId>": "ISO date of deletion" },
  "settings": { "language": "en", "theme": "dark" },
  "meta": { "deviceId": "...", "updatedAt": "...", "lastSyncedAt": "..." }
}
```
`log` is the source of truth for each day (`v` = amount, `t` = when it changed); `completions` is derived from it.

### Versioning and migrations
- Data from older builds has no `schemaVersion` and is treated as version 1. On load, `js/migrations.js` upgrades it step by step (1 → 2 → 3).
- The original data is kept as `habitflow_data_backup_v<N>` before the first migration.
- Data written by a **newer** app version is never modified or downgraded. Corrupted data is kept as `habitflow_data_corrupt_<time>` and the app starts clean.
- To change the data shape later: bump `schemaVersion` in `js/config.js` and append a `{ from, to, up(data) }` step in `js/migrations.js`.

### Import
Settings → Import backup. The current data is replaced (after confirmation) and a safety copy is kept as `habitflow_data_backup_vpre_import`. Imported habits are marked as just-updated so they are not removed by older deletion records during sync.

## Accounts (Firebase Authentication)

- `auth.html` provides account creation, sign-in, sign-out, email verification, and password reset using Firebase Authentication. Only accounts with a verified email count as signed in; an unverified sign-in closes the session and re-sends the verification link.
- `js/auth.js` also handles the `resetPassword` and `verifyEmail` action links. They only reach it if the Email templates' action URL in the Firebase Console points at `https://peacecode14-alt.github.io/HabitFlow/auth.html`; with Firebase's default handler the links still work, they are just handled on Firebase's own page.
- `js/firebase-client.js` initializes the Firebase Web SDK (pinned to 13.4.0) for project `habitflow-aed6b`. `app.js` loads it lazily, so the tracker keeps working if the CDN is unreachable.
- In the Firebase / Google Cloud console: enable Email/Password, list `peacecode14-alt.github.io` under Authorized domains, turn on **Password policy** (enforce), and restrict the web API key to the HTTP referrer `https://peacecode14-alt.github.io/*`.
- Firestore is used for cloud sync. Publish the account-scoped rules in `firestore.rules` from Firebase Console → Firestore Database → Rules. The app only allows a verified user to read/write `users/{uid}/sync/state` where `{uid}` is their own Firebase UID; every other path is denied.
- The Firebase Web SDK is loaded from Google's CDN. The app uses the signed-in Firebase identity and does not require a server URL or access token.

The previous Supabase migration files are retained only as historical project artifacts; the app's current authentication code no longer uses Supabase.

## Colours

The brand colour is cyan `#22D3EE` (`--accent`). It is used for solid fills with dark ink (`--on-accent`). In the light theme, text and graphics use darker cyan tokens (`--accent-ink` `#0B6A84`, `--accent-edge` `#0891B2`) so they keep readable contrast; the dark theme uses `#22D3EE` for all three. Neutrals are tinted toward the same hue. All tokens live at the top of `css/style.css`; the PWA icons and `theme-color` follow the dark background `#0a171c`.

## Cloud sync (optional)
Settings → Cloud sync: sign in with a verified HabitFlow account, then choose **Enable cloud sync**. An encryption passphrase is optional.
- Syncs a few seconds after each change, on app start/sign-in, and when the device comes back online. **Sync now** triggers it on demand.
- Each account has a separate Firestore document at `users/{uid}/sync/state`; Firestore Rules require an authenticated, email-verified owner. The client never chooses another user's UID.
- On the first sync for this browser, local habits are merged with the signed-in account's cloud copy. The local data is not cleared. A browser owner marker prevents accidentally uploading one account's local data into another account; export or reset local data before switching accounts on the same browser.
- **Merge rules**: habit settings: the latest edit wins. Daily records merge **day by day**, so two devices that record different days never overwrite each other. Deleted habits stay deleted everywhere. Language and theme are per-device.
- **Encryption**: with a passphrase, data is encrypted on the device (AES-256-GCM, PBKDF2-SHA256) before upload. If the passphrase is lost, the cloud copy cannot be recovered. All devices must use the same passphrase.
- **Pause sync** stops future syncs on this browser; it does not delete the cloud document. **Reset all data** clears local data and the browser's account-owner marker, but does not delete cloud data.

The Firestore rules in `firestore.rules` are intentionally narrow. Before enabling sync, publish them in Firebase Console → Firestore Database → Rules (or use `firebase deploy --only firestore:rules` from a configured Firebase CLI project). The live Firebase project must have Firestore enabled.

## Tests
```
node test/storage-sync.test.mjs     # storage, migrations, backups, merge, no-op sync writes
node test/features.test.mjs         # log, stats, reminders, encryption, import, templates
node test/multi-device-sync.test.mjs # two independent devices sharing one cloud document
npm test                            # runs all three browser-independent suites
npm run test:e2e                    # local UI/PWA/mobile browser tests (install Playwright Chromium first)
```
`E2E_SHOTS=./shots npm run test:e2e` also saves screenshots. `npm test` runs all three browser-independent test suites; run E2E separately after installing Chromium. The E2E suite also checks the dark-mode `#22D3EE` accent.

## Project structure
- `index.html`, `auth.html`, `css/`: app and account page structure and styles.
- `js/app.js`: rendering, events, sync/reminder wiring. `js/auth.js` and `js/firebase-client.js`: Firebase authentication and SDK initialization.
- `js/habits.js`: habit operations. `js/storage.js`: versioned persistence. `js/migrations.js`: schema migrations.
- `js/services/log.js`: per-day log. `stats.js`: streaks and rates. `sync.js`: merge/encryption orchestration; `firestore-sync.js`: Firebase Firestore adapter. `crypto.js`: encryption. `reminders.js`: reminder logic. `backup.js`: import parsing. `date.js`: date helpers.
- `js/templates.js`, `js/translations.js`, `js/config.js`.
- `server/sync-server.js`: reference sync server. `test/`: automated tests.
- `manifest.json`, `service-worker.js`, `assets/icons/`: PWA. `supabase/migrations/`: database migrations.
