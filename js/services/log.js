/**
 * Per-day habit log.
 * Each habit keeps `log: { "YYYY-MM-DD": { v: number, t: ISO date, n?: note } }`.
 *  - v is the recorded amount (1 for a "done" check habit, 0..N for a counter).
 *  - t is when that day was last changed, so two devices can be merged day by day.
 * `habit.completions` is always derived from the log (days where v >= target).
 */
const time = (iso) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

export const targetOf = (habit) => {
  const n = Math.floor(Number(habit?.target));
  return habit?.type === "count" && Number.isFinite(n) && n >= 1 ? n : 1;
};
export const valueOn = (habit, key) =>
  Math.max(0, Number(habit?.log?.[key]?.v) || 0);
export const isDone = (habit, key) => valueOn(habit, key) >= targetOf(habit);
export const noteOn = (habit, key) => habit?.log?.[key]?.n || "";

export function deriveCompletions(log, target) {
  return Object.keys(log || {})
    .filter((k) => (Number(log[k]?.v) || 0) >= target)
    .sort();
}

/** Union of two logs; for the same day the most recent change wins. */
export function mergeLogs(a, b) {
  const out = { ...(a || {}) };
  for (const [key, entry] of Object.entries(b || {})) {
    const mine = out[key];
    if (!mine || time(entry?.t) > time(mine.t)) out[key] = entry;
  }
  return out;
}

/** Return a copy of `habit` with one day changed (never mutates). */
export function withDay(habit, key, patch, nowIso = new Date().toISOString()) {
  const entry = { ...(habit.log?.[key] || { v: 0 }), ...patch, t: nowIso };
  if (!entry.n) delete entry.n;
  const log = { ...(habit.log || {}), [key]: entry };
  return {
    ...habit,
    log,
    completions: deriveCompletions(log, targetOf(habit)),
  };
}
