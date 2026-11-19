import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";
import { forEachSchedulePage } from "./pagination.mjs";

const PROJECT_ID = "habitflow-aed6b";
const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SERVICE_ACCOUNT_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// A reminder is still "due" for this many minutes after its time. This tolerates a skipped cron run and
// lets claim_reminder_delivery() retry failed sends (it allows 3 attempts, spaced by at least 2 minutes).
const DUE_WINDOW_MINUTES = 7;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function safeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function localClock(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
  };

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    day: weekdayMap[values.weekday]
  };
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  project_id: string;
}) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging"
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || typeof tokenData.access_token !== "string") {
    throw new Error("Google OAuth token request failed.");
  }

  cachedAccessToken = {
    value: tokenData.access_token,
    expiresAt: Date.now() + Number(tokenData.expires_in ?? 3600) * 1000
  };
  return cachedAccessToken.value;
}

async function sendToDevice(token: string, accessToken: string, body: string) {
  const fcmResponse = await fetch(FCM_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token,
        data: {
          title: "HabitFlow",
          body,
          tag: "habitflow-reminder"
        }
      }
    })
  });

  const result = await fcmResponse.json().catch(() => ({}));
  if (fcmResponse.ok) return { ok: true, invalidToken: false };

  const status = result?.error?.status;
  const details = Array.isArray(result?.error?.details) ? result.error.details : [];
  const unregistered = status === "UNREGISTERED" ||
    details.some((item: any) => item?.errorCode === "UNREGISTERED");

  return { ok: false, invalidToken: unregistered };
}

const PAGE_SIZE = 500;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  if (!CRON_SECRET || !safeEqual(req.headers.get("Authorization") ?? "", `Bearer ${CRON_SECRET}`)) {
    return response({ error: "Unauthorized." }, 401);
  }

  if (!SERVICE_ACCOUNT_RAW || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing required server configuration.");
    return response({ error: "Server configuration is incomplete." }, 500);
  }

  try {
    const serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);
    if (
      serviceAccount.project_id !== PROJECT_ID ||
      typeof serviceAccount.client_email !== "string" ||
      typeof serviceAccount.private_key !== "string"
    ) {
      throw new Error("Firebase service account configuration is invalid.");
    }

    let due = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let accessToken: string | null = null;

    let lastId: string | null = null;

    while (true) {
      let query = admin
        .from("reminder_schedules")
        .select("id,firebase_uid,reminder_time,timezone,repeat_days,notification_body,updated_at")
        .eq("enabled", true)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);

      if (lastId !== null) {
        query = query.gt("id", lastId);
      }

      const { data: schedules, error: schedulesError } = await query;

      if (schedulesError) throw schedulesError;

      if (!schedules?.length) break;

      for (const schedule of schedules) {
        let clock;

        try {
          clock = localClock(schedule.timezone);
        } catch {
          skipped++;
          continue;
        }

        const minutesLate =
          toMinutes(clock.time) -
          toMinutes(String(schedule.reminder_time).slice(0, 5));

        if (
          minutesLate < 0 ||
          minutesLate >= DUE_WINDOW_MINUTES ||
          !Array.isArray(schedule.repeat_days) ||
          !schedule.repeat_days.includes(clock.day)
        ) {
          continue;
        }

        if (
          minutesLate > 0 &&
          new Date(schedule.updated_at).getTime() >
            Date.now() - minutesLate * 60_000
        ) {
          skipped++;
          continue;
        }

        due++;

        const { data: claimed, error: claimError } = await admin.rpc(
          "claim_reminder_delivery",
          {
            p_schedule_id: schedule.id,
            p_local_date: clock.date
          }
        );

        if (claimError) throw claimError;

        if (claimed !== true) {
          skipped++;
          continue;
        }

        const { data: devices, error: devicesError } = await admin
          .from("reminder_devices")
          .select("id,fcm_token")
          .eq("firebase_uid", schedule.firebase_uid);

        if (devicesError) {
          await admin.from("reminder_deliveries")
            .update({
              status: "failed",
              last_error: "Device lookup failed."
            })
            .eq("schedule_id", schedule.id)
            .eq("local_date", clock.date);

          failed++;
          continue;
        }

        if (!devices?.length) {
          await admin.from("reminder_deliveries")
            .update({
              status: "failed",
              last_error: "No registered devices."
            })
            .eq("schedule_id", schedule.id)
            .eq("local_date", clock.date);

          failed++;
          continue;
        }

        if (!accessToken) {
          accessToken = await getGoogleAccessToken(serviceAccount);
        }

        const body =
          typeof schedule.notification_body === "string" &&
          schedule.notification_body.trim()
            ? schedule.notification_body
            : "Time for your habit";

        let anySent = false;

        for (const device of devices) {
          try {
            const result = await sendToDevice(
              device.fcm_token,
              accessToken,
              body
            );

            if (result.ok) {
              anySent = true;
            } else if (result.invalidToken) {
              await admin.from("reminder_devices")
                .delete()
                .eq("id", device.id);
            }
          } catch {
            // Keep this generic; delivery details are recorded without exposing tokens.
          }
        }

        if (anySent) {
          await admin.from("reminder_deliveries")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              last_error: null
            })
            .eq("schedule_id", schedule.id)
            .eq("local_date", clock.date);

          sent++;
        } else {
          await admin.from("reminder_deliveries")
            .update({
              status: "failed",
              last_error: "FCM delivery failed."
            })
            .eq("schedule_id", schedule.id)
            .eq("local_date", clock.date);

          failed++;
        }
      }

      lastId = schedules[schedules.length - 1].id;

      if (schedules.length < PAGE_SIZE) break;
    }

    return response({ ok: true, due, sent, failed, skipped });
  } catch (error) {
    console.error("send-due-reminders failed:", error instanceof Error ? error.message : "Unknown error");
    return response({ error: "Reminder delivery could not be completed." }, 500);
  }
});
