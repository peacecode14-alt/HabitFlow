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

- `auth.html` provides account creation, sign-in, sign-out, email verification, and password reset using Firebase Authentication.
- `js/firebase-client.js` initializes the Firebase Web SDK for project `habitflow-aed6b`.
- Firebase Authentication must have Email/Password enabled and `peacecode14-alt.github.io` listed under Authorized domains.
- Firestore is initialized but the app does not write user data to it yet. Its current production rules deny all reads and writes; keep that default until account-scoped rules and cloud sync are implemented.
- Habit data remains local in this version. Signing in is not yet a cloud backup or cross-device sync.

The previous Supabase migration files are retained only as historical project artifacts; the app's current authentication code no longer uses Supabase.

## Cloud sync (optional)
Settings → Cloud sync: enter a sync server address, an access token and, optionally, an encryption passphrase.
- Syncs a few seconds after each change, on start, and when the device comes back online. "Sync now" does it on demand.
- **Merge rules**: habit settings: the latest edit wins. Daily records merge **day by day**, so two devices that record different days never overwrite each other. Deleted habits stay deleted everywhere. Language and theme are per-device.
- **Encryption**: with a passphrase, data is encrypted on the device (AES-256-GCM, PBKDF2-SHA256) before upload; the server only sees ciphertext. If the passphrase is lost, the cloud copy cannot be recovered. All devices must use the same passphrase.
- `https://` is required (plain `http://` only for `localhost`). The token and passphrase are stored in this browser's local storage (separately from habit data, never included in backups), so they do not protect against someone with access to this browser.
- Disconnect or "Reset all data" removes the connection settings from the device; data already in the cloud is not deleted.

**Server contract** (any backend can implement it):
- `GET <url>` with `Authorization: Bearer <token>` → `200` + JSON object, or `404` if empty.
- `PUT <url>` with the same header and a JSON object body (a habit document or an encrypted envelope `{ "enc": 1, ... }`) → `2xx`.
- CORS must allow `Authorization` and `Content-Type` for the app's origin.

A dependency-free reference server is included for development and testing:

```
node server/sync-server.js
# use  http://localhost:8787/sync  and any token of 8+ characters
```
It is not for production. Use HTTPS and real authentication there.

Limitations: no live push between devices (changes arrive on the next sync); there are no user accounts (the token acts as the account key); reminders appear only while HabitFlow is open in a tab or as an installed app. Notifications while the app is fully closed would need a push server.

## Tests
```
node test/storage-sync.test.mjs     # storage, migrations, backups, merge, REST adapter + reference server
node test/features.test.mjs         # log, stats, reminders, encryption, import, templates
python3 test/e2e.py                 # real browser UI tests (pip install playwright && playwright install chromium)
```
`E2E_SHOTS=./shots python3 test/e2e.py` also saves screenshots. `npm test` runs all three.

## Project structure
- `index.html`, `auth.html`, `css/`: app and account page structure and styles.
- `js/app.js`: rendering, events, sync/reminder wiring. `js/auth.js` and `js/firebase-client.js`: Firebase authentication and SDK initialization.
- `js/habits.js`: habit operations. `js/storage.js`: versioned persistence. `js/migrations.js`: schema migrations.
- `js/services/log.js`: per-day log. `stats.js`: streaks and rates. `sync.js`: cloud sync. `crypto.js`: encryption. `reminders.js`: reminder logic. `backup.js`: import parsing. `date.js`: date helpers.
- `js/templates.js`, `js/translations.js`, `js/config.js`.
- `server/sync-server.js`: reference sync server. `test/`: automated tests.
- `manifest.json`, `service-worker.js`, `assets/icons/`: PWA. `supabase/migrations/`: database migrations.
