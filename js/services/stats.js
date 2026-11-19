import { dateToKey } from "./date.js";
import { isDone } from "./log.js";

/**
 * Schedule-aware statistics. A day only counts for a habit when the habit is
 * scheduled on that weekday, has already started, and was not yet archived.
 */
const noon = (key) => new Date(`${key}T12:00:00`);
const keyOf = (value) => (value ? dateToKey(value) : null);
const MAX_DAYS = 1100;

export function startKey(habit) {
  const keys = [
    keyOf(habit.createdAt),
    ...Object.keys(habit.log || {}).filter(
      (k) => (Number(habit.log[k]?.v) || 0) > 0,
    ),
  ].filter(Boolean);
  return keys.length ? keys.sort()[0] : null;
}

export function isScheduled(habit, key, { ignoreStart = false } = {}) {
  if (!(habit.frequency || []).includes(noon(key).getDay())) return false;
  if (!ignoreStart) {
    const s = startKey(habit);
    if (s && key < s) return false;
  }
  const archived = keyOf(habit.archivedAt);
  return !(archived && key >= archived);
}

function lastCountedKey(habit, todayKey) {
  const archived = keyOf(habit.archivedAt);
  if (archived && archived <= todayKey) {
    const d = noon(archived);
    d.setDate(d.getDate() - 1);
    return dateToKey(d);
  }
  return todayKey;
}

function* daysBetween(fromKey, toKey) {
  const d = noon(fromKey);
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = dateToKey(d);
    if (key > toKey) return;
    yield key;
    d.setDate(d.getDate() + 1);
  }
}

function clampedStart(habit, end) {
  const s = startKey(habit);
  if (!s) return null;
  const floor = noon(end);
  floor.setDate(floor.getDate() - MAX_DAYS + 1);
  const f = dateToKey(floor);
  return s > f ? s : f;
}

/** Consecutive scheduled days completed, ending today. An unfinished today does not break it. */
export function currentStreak(habit, todayKey) {
  const end = lastCountedKey(habit, todayKey),
    start = clampedStart(habit, end);
  if (!start) return 0;
  let streak = 0;
  const d = noon(end);
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = dateToKey(d);
    if (key < start) break;
    if (isScheduled(habit, key)) {
      if (isDone(habit, key)) streak++;
      else if (key !== todayKey) break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function bestStreak(habit, todayKey) {
  const end = lastCountedKey(habit, todayKey),
    start = clampedStart(habit, end);
  if (!start) return 0;
  let run = 0,
    best = 0;
  for (const key of daysBetween(start, end)) {
    if (!isScheduled(habit, key)) continue;
    if (isDone(habit, key)) {
      run++;
      best = Math.max(best, run);
    } else if (key !== todayKey) run = 0;
  }
  return best;
}

/** Share of scheduled days that were completed. An unfinished today is not counted against you. */
export function completionRate(habit, todayKey) {
  const end = lastCountedKey(habit, todayKey),
    start = clampedStart(habit, end);
  let scheduled = 0,
    done = 0;
  if (start)
    for (const key of daysBetween(start, end)) {
      if (!isScheduled(habit, key)) continue;
      if (isDone(habit, key)) {
        scheduled++;
        done++;
      } else if (key !== todayKey) scheduled++;
    }
  return {
    done,
    scheduled,
    percent: scheduled ? Math.round((done / scheduled) * 100) : 0,
  };
}
