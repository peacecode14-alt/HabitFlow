/**
 * Client side of the reminder backend (Supabase Edge Function `register-reminders`).
 * Kept free of Firebase imports so the account page can use it without loading the SDK.
 */
export const REMINDERS_URL =
  "https://yylgyambooemhfpbcnpi.supabase.co/functions/v1/register-reminders";
export const PUSH_TOKEN_KEY = "habitflow_push_token";
export const REMINDER_SIGNATURE_KEY = "habitflow_reminder_signature";

/** Habits that should produce a push reminder. */
export function reminderSchedules(habits) {
  return (habits || [])
    .filter((h) => !h.archivedAt && h.reminderTime)
    .map((h) => ({
      habitKey: h.id,
      reminderTime: h.reminderTime,
      repeatDays: h.frequency,
    }));
}

/** Short fingerprint of what the server should know; identical fingerprint => nothing to send. */
export function reminderSignature({
  uid,
  deviceToken,
  timezone,
  language,
  schedules,
}) {
  const text = JSON.stringify([
    uid,
    deviceToken,
    timezone,
    language,
    schedules,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

export async function postToReminders(user, body) {
  const idToken = await user.getIdToken();
  const response = await fetch(REMINDERS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(10000)
        : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Reminder request failed.");
  return result;
}

/**
 * Stops this device from receiving the signed-in account's reminders.
 * Best effort: always forgets the local token, even when the server cannot be reached.
 */
export async function unregisterDevice(user) {
  const deviceToken = localStorage.getItem(PUSH_TOKEN_KEY);
  localStorage.removeItem(PUSH_TOKEN_KEY);
  localStorage.removeItem(REMINDER_SIGNATURE_KEY);
  if (!user || !deviceToken) return false;
  try {
    await postToReminders(user, { action: "unregister", deviceToken });
    return true;
  } catch (error) {
    console.warn(
      "HabitFlow: could not unregister this device from reminders.",
      error,
    );
    return false;
  }
}
