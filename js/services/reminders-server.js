/**
 * Client side of the reminder backend (Supabase Edge Function `register-reminders`).
 * Kept free of Firebase imports so the account page can use it without loading the SDK.
 */
export const REMINDERS_URL =
  "https://yylgyambooemhfpbcnpi.supabase.co/functions/v1/register-reminders";
export const PUSH_TOKEN_KEY = "habitflow_push_token";
export const REMINDER_SIGNATURE_KEY = "habitflow_reminder_signature";
export const PENDING_UNREGISTER_KEY =
  "habitflow_pending_unregister";

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

function readPendingUnregister() {
  const raw = localStorage.getItem(PENDING_UNREGISTER_KEY);
  if (!raw) return null;

  try {
    const pending = JSON.parse(raw);

    if (
      typeof pending?.uid !== "string" ||
      !pending.uid ||
      typeof pending?.deviceToken !== "string" ||
      !pending.deviceToken
    ) {
      localStorage.removeItem(PENDING_UNREGISTER_KEY);
      return null;
    }

    return pending;
  } catch {
    localStorage.removeItem(PENDING_UNREGISTER_KEY);
    return null;
  }
}

const unregisterRequests = new Map();

async function sendPendingUnregister(user, pending) {
  const key = JSON.stringify([pending.uid, pending.deviceToken]);

  if (unregisterRequests.has(key)) {
    return unregisterRequests.get(key);
  }

  const request = (async () => {
    try {
      const result = await postToReminders(user, {
        action: "unregister",
        deviceToken: pending.deviceToken,
      });

      if (result.ok !== true) {
        throw new Error("Reminder unregister was not confirmed.");
      }

      const currentPending = readPendingUnregister();

      if (
        currentPending?.uid === pending.uid &&
        currentPending?.deviceToken === pending.deviceToken
      ) {
        localStorage.removeItem(PENDING_UNREGISTER_KEY);
      }

      if (
        localStorage.getItem(PUSH_TOKEN_KEY) === pending.deviceToken
      ) {
        localStorage.removeItem(PUSH_TOKEN_KEY);
        localStorage.removeItem(REMINDER_SIGNATURE_KEY);
      }

      return true;
    } catch (error) {
      console.warn(
        "HabitFlow: could not unregister this device from reminders.",
        error,
      );
      return false;
    }
  })();

  unregisterRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (unregisterRequests.get(key) === request) {
      unregisterRequests.delete(key);
    }
  }
}

export async function unregisterDevice(user) {
  const deviceToken = localStorage.getItem(PUSH_TOKEN_KEY);

  if (!user?.uid || !deviceToken) return false;

  const pending = {
    uid: user.uid,
    deviceToken,
  };

  try {
    localStorage.setItem(
      PENDING_UNREGISTER_KEY,
      JSON.stringify(pending),
    );
  } catch (error) {
    console.warn("HabitFlow: could not save pending unregister.", error);
    return false;
  }

  return sendPendingUnregister(user, pending);
}

export async function retryPendingUnregister(user) {
  if (!user?.uid) return false;

  const pending = readPendingUnregister();

  if (!pending || pending.uid !== user.uid) return false;

  return sendPendingUnregister(user, pending);
}
