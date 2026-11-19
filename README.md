# HabitFlow

A bilingual (English / Arabic) habit tracker. It is a plain JavaScript PWA with no build step, deployed on GitHub Pages:
<https://peacecode14-alt.github.io/HabitFlow/>

- Habits, counters, streaks, calendar and statistics, stored locally in the browser.
- **Accounts** with Firebase Authentication (verified email required).
- Optional **cloud sync** through Firestore (one document per user, optional client-side encryption with a passphrase).
- Optional **push reminders** through Firebase Cloud Messaging, scheduled by Supabase Edge Functions (see `supabase/`).
- Works offline: the Firebase SDK is loaded lazily, so the tracker keeps working when the CDN is unreachable.

## Run locally

```bash
npm start          # static dev server on http://localhost:8080
npm test           # Node unit tests
npm run test:e2e   # browser tests of the tracker (Python + Playwright)
npm run test:cloud # browser tests of accounts, cloud sync and reminders (Firebase is stubbed)
```

Browser tests need `pip install playwright && playwright install chromium`.

## Firebase setup (project `habitflow-aed6b`)

1. **Authentication**: enable Email/Password, list `peacecode14-alt.github.io` under Authorized domains, turn on the
   password policy, and (optional) set the email-template action URL to `https://peacecode14-alt.github.io/HabitFlow/auth.html`
   so verification and reset links are handled by `auth.html`.
2. **Firestore**: publish the rules in `firestore.rules`:
   `firebase deploy --only firestore:rules`. Only the verified owner can read, write or delete
   `users/{uid}/sync/state`; everything else is denied.
3. **API key**: restrict the web API key to the HTTP referrer `https://peacecode14-alt.github.io/*`
   (Google Cloud Console → APIs & Services → Credentials). The key is public by design; the restriction limits abuse.
4. **Cloud Messaging**: the web push (VAPID) key in `js/services/push.js` must match the key in Project settings → Cloud Messaging.

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `auth.html` | The tracker and the account page |
| `js/` | App code (`app.js`, `auth.js`, habits, migrations, storage) |
| `js/services/` | Sync (`sync.js`, `firestore-sync.js`), crypto, reminders (`reminders.js` local, `reminders-server.js` + `push.js` push), stats, backup |
| `service-worker.js` | Offline cache and background push display |
| `firestore.rules`, `firebase.json` | Firestore security rules |
| `supabase/` | Push-reminder backend (Edge Functions, schema); see its README |
| `server/sync-server.js` | Reference REST sync server used only by the unit tests (`npm run sync-server` to run it); the app does not use it |
| `test/` | Unit tests and browser tests |

## Privacy notes

- Habit data stays in the browser unless cloud sync is turned on.
- Without a sync passphrase, habit names and notes are stored unencrypted in the cloud copy. Set a passphrase to encrypt
  them before upload (use the same passphrase on every device; it is kept in the browser's local storage).
- Signing out can also remove HabitFlow data from the device, and "Delete cloud copy" removes the Firestore document.
- Push notifications only contain generic text ("Time for your habit"), never habit names.
