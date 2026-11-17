import { loadData, saveData } from "./storage.js";
import { getTodayKey } from "./services/date.js";
import {
  withDay,
  deriveCompletions,
  targetOf,
  valueOn,
} from "./services/log.js";

let habits = loadData().habits;
const now = () => new Date().toISOString();
const persist = (extra = {}) => saveData({ ...loadData(), habits, ...extra });
const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const validTime = (value) => (/^\d{2}:\d{2}$/.test(value || "") ? value : "");
const normalizeKind = (data) => {
  const type = data.type === "count" ? "count" : "check";
  return {
    type,
    target: type === "count" ? clampInt(data.target, 1, 999, 1) : 1,
  };
};

export const getAllHabits = () =>
  habits.map((h) => ({
    ...h,
    frequency: [...(h.frequency || [])],
    completions: [...(h.completions || [])],
    log: { ...(h.log || {}) },
  }));

/** Replace one habit through `fn` and save; rolls back if saving fails. */
function mutate(id, fn) {
  const i = habits.findIndex((h) => h.id === id);
  if (i < 0) return false;
  const old = habits[i];
  habits[i] = fn(old);
  if (!persist()) {
    habits[i] = old;
    return false;
  }
  return true;
}

export function addHabit(data) {
  const name = String(data.name || "").trim();
  if (!name || !Array.isArray(data.frequency) || !data.frequency.length)
    return false;
  const stamp = now();
  const habit = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    name,
    category:
      String(data.category || "Personal")
        .trim()
        .slice(0, 30) || "Personal",
    icon: data.icon || "✦",
    color: data.color || "#42D9F5",
    frequency: [...data.frequency],
    ...normalizeKind(data),
    reminderTime: validTime(data.reminderTime),
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    log: {},
    completions: [],
  };
  habits.push(habit);
  if (!persist()) {
    habits.pop();
    return false;
  }
  return true;
}

export function updateHabit(id, data) {
  return mutate(id, (old) => {
    const next = {
      ...old,
      name: String(data.name ?? old.name).trim(),
      category:
        String(data.category ?? old.category)
          .trim()
          .slice(0, 30) || "Personal",
      icon: data.icon ?? old.icon,
      color: data.color ?? old.color,
      frequency: [...(data.frequency ?? old.frequency)],
      ...normalizeKind({
        type: data.type ?? old.type,
        target: data.target ?? old.target,
      }),
      reminderTime:
        "reminderTime" in data
          ? validTime(data.reminderTime)
          : old.reminderTime,
      updatedAt: now(),
    };
    next.completions = deriveCompletions(next.log || {}, targetOf(next));
    return next;
  });
}

export function deleteHabit(id) {
  const old = habits;
  habits = habits.filter((h) => h.id !== id);
  // Remember the deletion so cloud sync does not bring the habit back.
  if (!persist({ deleted: { ...loadData().deleted, [id]: now() } })) {
    habits = old;
    return false;
  }
  return true;
}

/** Undo a deletion: the habit comes back and the deletion record is removed. */
export function restoreHabit(habit) {
  if (!habit || habits.some((h) => h.id === habit.id)) return false;
  const deleted = { ...loadData().deleted };
  delete deleted[habit.id];
  habits.push({ ...habit, updatedAt: now() });
  if (!persist({ deleted })) {
    habits.pop();
    return false;
  }
  return true;
}

export const archiveHabit = (id, archived) =>
  mutate(id, (h) => ({
    ...h,
    archivedAt: archived ? now() : null,
    updatedAt: now(),
  }));

// Day-level changes only touch the habit's log, so they merge cleanly across devices.
export const toggleCompletion = (id, date = getTodayKey()) =>
  mutate(id, (h) =>
    withDay(
      h,
      date,
      { v: valueOn(h, date) >= targetOf(h) ? 0 : targetOf(h) },
      now(),
    ),
  );
export const adjustValue = (id, delta, date = getTodayKey()) =>
  mutate(id, (h) =>
    withDay(
      h,
      date,
      { v: clampInt(valueOn(h, date) + delta, 0, 9999, 0) },
      now(),
    ),
  );
export function setNote(id, date, note) {
  const text = String(note ?? "")
    .trim()
    .slice(0, 200);
  const habit = habits.find((h) => h.id === id);
  if (!habit) return false;
  if ((habit.log?.[date]?.n || "") === text) return true;
  return mutate(id, (h) => withDay(h, date, { n: text }, now()));
}

export function replaceHabits(next) {
  if (!Array.isArray(next)) return false;
  const old = habits;
  habits = next;
  if (!persist()) {
    habits = old;
    return false;
  }
  return true;
}
/** Used by cloud sync and backup import: swap in habits and deletion records in one save. */
export function applyMergedState({ habits: nextHabits, deleted }) {
  const old = habits;
  habits = nextHabits;
  if (!persist({ deleted })) {
    habits = old;
    return false;
  }
  return true;
}
