/**
 * Date helpers for HabitFlow.
 * Date-only keys always use the device's local calendar date (YYYY-MM-DD).
 */

function toLocalDate(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      // Reject impossible dates such as 2026-02-31 instead of normalizing them.
      if (
        parsed.getFullYear() !== Number(year) ||
        parsed.getMonth() !== Number(month) - 1 ||
        parsed.getDate() !== Number(day)
      ) {
        return null;
      }
      return parsed;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Convert a Date (or supported date value) to a local YYYY-MM-DD key. */
export function dateToKey(value) {
  const date = toLocalDate(value);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Return today's date in the device's local timezone. */
export function getTodayKey() {
  return dateToKey(new Date());
}

/** Compare two dates by their local calendar day, ignoring their time. */
export function isSameDay(dateA, dateB) {
  const keyA = dateToKey(dateA);
  const keyB = dateToKey(dateB);
  return Boolean(keyA && keyB && keyA === keyB);
}

/** Return an inclusive array of local Date objects between start and end. */
export function getDateRange(start, end) {
  const first = toLocalDate(start);
  const last = toLocalDate(end);
  if (!first || !last) return [];

  first.setHours(0, 0, 0, 0);
  last.setHours(0, 0, 0, 0);
  if (first > last) return [];

  const dates = [];
  const cursor = new Date(first);

  while (cursor <= last) {
    dates.push(new Date(cursor));
    // Calendar-day arithmetic avoids assuming every local day is 24 hours.
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}
