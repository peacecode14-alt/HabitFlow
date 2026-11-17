import { dateToKey } from "./date.js";
import { isScheduled } from "./stats.js";
import { isDone } from "./log.js";

/** Habits whose reminder time has arrived (within `windowMin` minutes), still unfinished today, and not yet announced. */
export function dueReminders({ habits, now = new Date(), fired = new Set(), windowMin = 5 }) {
  const todayKey = dateToKey(now), minutes = now.getHours() * 60 + now.getMinutes(), due = [];
  for (const habit of habits) {
    if (!/^\d{2}:\d{2}$/.test(habit.reminderTime || "") || habit.archivedAt) continue;
    if (!isScheduled(habit, todayKey) || isDone(habit, todayKey)) continue;
    const [h, m] = habit.reminderTime.split(":").map(Number), at = h * 60 + m;
    if (minutes < at || minutes - at > windowMin) continue;
    const id = `${habit.id}:${todayKey}`;
    if (!fired.has(id)) due.push({ habit, id });
  }
  return due;
}

export const notificationsSupported = () => typeof Notification !== "undefined";
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : "unsupported");

/** Shows a system notification when permission was granted. Returns true if one was shown. */
export async function showSystemNotification(title, body, tag) {
  if (notificationPermission() !== "granted") return false;
  const options = { body, tag, icon: "./assets/icons/icon-192.png" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { await reg.showNotification(title, options); return true; }
    new Notification(title, options); return true;
  } catch (error) { console.error("Could not show notification:", error); return false; }
}
