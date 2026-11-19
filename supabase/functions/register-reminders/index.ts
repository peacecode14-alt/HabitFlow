import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const FIREBASE_PROJECT_ID = "habitflow-aed6b";
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const ALLOWED_ORIGIN = "https://peacecode14-alt.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

const NOTIFICATION_BODY = { ar: "حان وقت عادتك", en: "Time for your habit" } as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== ALLOWED_ORIGIN) {
    return json({ error: "Origin not allowed." }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Missing Firebase ID token." }, 401);

    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID
    });

    const firebaseUid = typeof payload.sub === "string" ? payload.sub : "";
    if (!firebaseUid || payload.email_verified !== true) {
      return json({ error: "A verified Firebase account is required." }, 403);
    }

    const rawBody = await req.text();
    if (rawBody.length > 120_000) return json({ error: "Request too large." }, 413);

    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }

    const deviceToken = body?.deviceToken;
    if (typeof deviceToken !== "string" || deviceToken.length < 20 || deviceToken.length > 4096) {
      return json({ error: "Invalid device token." }, 400);
    }

    // Sign-out / reset: stop this device from receiving the account's reminders.
    if (body?.action === "unregister") {
      const { error: removeError } = await admin
        .from("reminder_devices")
        .delete()
        .eq("firebase_uid", firebaseUid)
        .eq("fcm_token", deviceToken);
      if (removeError) throw removeError;

      // With no device left there is nobody to notify, so drop the schedules as well.
      const { count, error: countError } = await admin
        .from("reminder_devices")
        .select("id", { count: "exact", head: true })
        .eq("firebase_uid", firebaseUid);
      if (countError) throw countError;

      if (!count) {
        const { error: schedulesError } = await admin
          .from("reminder_schedules")
          .delete()
          .eq("firebase_uid", firebaseUid);
        if (schedulesError) throw schedulesError;
      }
      return json({ ok: true, unregistered: true });
    }

    const timezone = body?.timezone;
    const schedules = body?.schedules;
    const language = body?.language === "en" ? "en" : "ar";

    if (!validTimezone(timezone)) return json({ error: "Invalid timezone." }, 400);
    if (!Array.isArray(schedules) || schedules.length > 100) {
      return json({ error: "Invalid schedules list." }, 400);
    }

    const seen = new Set<string>();
    const rows = [];
    for (const item of schedules) {
      const habitKey = item?.habitKey;
      const reminderTime = item?.reminderTime;
      const repeatDays = item?.repeatDays;

      if (typeof habitKey !== "string" || !habitKey.trim() || habitKey.length > 100 || seen.has(habitKey)) {
        return json({ error: "Invalid or duplicate reminder identifier." }, 400);
      }
      if (typeof reminderTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
        return json({ error: "Invalid reminder time." }, 400);
      }
      if (!Array.isArray(repeatDays) || repeatDays.length < 1 || repeatDays.length > 7 ||
          repeatDays.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6) ||
          new Set(repeatDays).size !== repeatDays.length) {
        return json({ error: "Invalid repeat days." }, 400);
      }

      seen.add(habitKey);
      rows.push({
        firebase_uid: firebaseUid,
        habit_key: habitKey,
        reminder_time: reminderTime,
        timezone,
        repeat_days: repeatDays,
        enabled: true,
        notification_body: NOTIFICATION_BODY[language],
        updated_at: new Date().toISOString()
      });
    }

    const { error: deviceError } = await admin.from("reminder_devices").upsert({
      firebase_uid: firebaseUid,
      fcm_token: deviceToken,
      last_seen_at: new Date().toISOString()
    }, { onConflict: "fcm_token" });
    if (deviceError) throw deviceError;

    if (rows.length) {
      const { error: upsertError } = await admin.from("reminder_schedules").upsert(rows, {
        onConflict: "firebase_uid,habit_key"
      });
      if (upsertError) throw upsertError;
    }

    const { data: existing, error: readError } = await admin
      .from("reminder_schedules")
      .select("habit_key")
      .eq("firebase_uid", firebaseUid);
    if (readError) throw readError;

    const staleKeys = (existing || [])
      .map((row: { habit_key: string }) => row.habit_key)
      .filter((key: string) => !seen.has(key));

    if (staleKeys.length) {
      const { error: deleteError } = await admin
        .from("reminder_schedules")
        .delete()
        .eq("firebase_uid", firebaseUid)
        .in("habit_key", staleKeys);
      if (deleteError) throw deleteError;
    }

    return json({ ok: true, deviceRegistered: true, schedulesSynced: rows.length });
  } catch (error) {
    console.error("register-reminders failed:", error);
    return json({ error: "Request could not be processed." }, 400);
  }
});
