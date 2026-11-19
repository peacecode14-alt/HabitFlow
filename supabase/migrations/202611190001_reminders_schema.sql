-- Push-reminder backend for HabitFlow (Firebase Auth identities, Firebase Cloud Messaging delivery).
-- This file documents the schema that already exists on the project (idempotent: safe to re-run).
-- Rows are written only by the Edge Functions (service role); RLS is on and no policies exist,
-- so anon/authenticated API roles cannot read or write these tables.

create table if not exists public.reminder_devices (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  fcm_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists reminder_devices_fcm_token_key on public.reminder_devices (fcm_token);
create index if not exists reminder_devices_firebase_uid_idx on public.reminder_devices (firebase_uid);

create table if not exists public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  habit_key text not null,
  reminder_time time not null,
  timezone text not null,
  repeat_days smallint[] not null,
  enabled boolean not null default true,
  notification_body text not null default 'حان وقت عادتك',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists reminder_schedules_uid_habit_unique on public.reminder_schedules (firebase_uid, habit_key);
create index if not exists reminder_schedules_due_idx on public.reminder_schedules (enabled, reminder_time) where enabled = true;

create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  local_date date not null,
  status text not null default 'pending',
  attempts integer not null default 1,
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index if not exists reminder_deliveries_once_per_day on public.reminder_deliveries (schedule_id, local_date);
create index if not exists reminder_deliveries_status_idx on public.reminder_deliveries (status, last_attempt_at);

alter table public.reminder_devices enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.reminder_deliveries enable row level security;

-- Claims one delivery per schedule per local day; failed sends can be retried up to 3 times.
create or replace function public.claim_reminder_delivery(p_schedule_id uuid, p_local_date date)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  claimed_id uuid;
begin
  insert into public.reminder_deliveries (
    schedule_id, local_date, status, attempts, last_attempt_at
  )
  values (p_schedule_id, p_local_date, 'pending', 1, now())
  on conflict (schedule_id, local_date) do update
    set status = 'pending',
        attempts = public.reminder_deliveries.attempts + 1,
        last_attempt_at = now(),
        last_error = null
    where (
      public.reminder_deliveries.status = 'failed'
      and public.reminder_deliveries.attempts < 3
      and public.reminder_deliveries.last_attempt_at < now() - interval '2 minutes'
    ) or (
      public.reminder_deliveries.status = 'pending'
      and public.reminder_deliveries.last_attempt_at < now() - interval '5 minutes'
    )
  returning id into claimed_id;

  return claimed_id is not null;
end;
$function$;

-- Only the service role (Edge Functions) may call it.
revoke execute on function public.claim_reminder_delivery(uuid, date) from public, anon, authenticated;

-- The cron job is created once per project because it embeds the project URL and the CRON_SECRET:
--
--   select cron.schedule(
--     'habitflow-send-due-reminders', '* * * * *',
--     $$ select net.http_post(
--          url := 'https://<project-ref>.supabase.co/functions/v1/send-due-reminders',
--          headers := jsonb_build_object('Authorization', 'Bearer ' || '<CRON_SECRET>', 'Content-Type', 'application/json'),
--          body := '{}'::jsonb) $$);
--
-- Keep the real secret in Supabase Vault / project settings, never in this repository.
