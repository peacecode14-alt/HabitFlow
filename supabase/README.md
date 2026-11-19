# Supabase backend (push reminders)

HabitFlow's identity provider is **Firebase Authentication**. Supabase only runs the push-reminder backend:

| Piece | Purpose |
|---|---|
| `functions/register-reminders` | Called by the app with a Firebase ID token. Verifies the token (signature, issuer, audience, `email_verified`), stores the device's FCM token and reminder schedules, and supports `{ "action": "unregister", "deviceToken": … }` on sign-out/reset. |
| `functions/send-due-reminders` | Called every minute by `pg_cron`. Finds due schedules (a 7-minute window with retries), claims one delivery per day, and sends the push via Firebase Cloud Messaging. |
| `migrations/202611190001_reminders_schema.sql` | The `reminder_*` tables, indexes, RLS (no policies: only the service role can access them) and `claim_reminder_delivery()`. |
| `migrations/202611170001_profiles.sql` | **Legacy** (Supabase Auth profiles from an earlier stage). Not used by the app. |
| `config.toml` | Turns off Supabase's own JWT check for the two functions, because they authenticate callers themselves. |

## Deploying the functions

```bash
supabase login
supabase link --project-ref yylgyambooemhfpbcnpi
supabase functions deploy register-reminders
supabase functions deploy send-due-reminders
```

Required function secrets (never commit them): `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase).

> The sources in this folder include changes that may be **newer than what is deployed**:
> the `unregister` action and per-language notification text (`register-reminders`), and the 7-minute due window,
> per-schedule text and constant-time secret comparison (`send-due-reminders`).
> Until `register-reminders` is redeployed, the app's sign-out "unregister" request is rejected by the server
> (the app ignores that and still forgets the token locally).

## Recommended manual steps in the Supabase dashboard

1. **Authentication → Providers → Email → turn off "Allow new users to sign up".** Supabase Auth is no longer used,
   and open sign-ups let anyone with the public key create accounts and store data in `public.user_data`.
2. `public.user_data` and `public.profiles` are leftovers from earlier stages. If you no longer need them,
   export the rows you want to keep and drop the tables. At minimum remove broad table privileges:
   ```sql
   revoke truncate, references, trigger on public.user_data from authenticated, anon;
   ```
3. `reminder_deliveries` has no foreign key to `reminder_schedules`, so rows of deleted schedules stay behind.
   A periodic cleanup is enough, for example:
   ```sql
   delete from public.reminder_deliveries where local_date < current_date - 30;
   ```
