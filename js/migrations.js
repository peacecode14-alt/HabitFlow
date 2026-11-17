import { APP_CONFIG, isHexColor } from "./config.js";
import { deriveCompletions, targetOf } from "./services/log.js";

/**
 * Data migration system
 * ---------------------
 * Stored data carries a `schemaVersion`. Data saved before versioning existed
 * has no such field and is treated as version 1.
 *
 * To change the data shape:
 *   1. Bump `schemaVersion` in config.js.
 *   2. Append a step { from, to, description, up(data) } below.
 *      `up` receives a deep copy and must return the upgraded object.
 * Steps run in order, so any old version upgrades to the latest one.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function cleanHabit(raw, now, seen) {
  let id = typeof raw.id === "string" && raw.id ? raw.id : newId();
  if (seen.has(id)) id = newId();
  seen.add(id);

  const frequency = Array.isArray(raw.frequency)
    ? [...new Set(raw.frequency.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : [];
  const completions = Array.isArray(raw.completions)
    ? [...new Set(raw.completions.filter(d => typeof d === "string" && DATE_KEY.test(d)))].sort()
    : [];
  const createdAt = raw.createdAt || now;

  return {
    ...raw,
    id,
    name: String(raw.name ?? "").trim(),
    category: APP_CONFIG.categories.includes(raw.category) ? raw.category : "Personal",
    icon: raw.icon || "✦",
    color: isHexColor(raw.color) ? raw.color : APP_CONFIG.defaultHabitColor,
    frequency: frequency.length ? frequency : [0, 1, 2, 3, 4, 5, 6],
    completions,
    createdAt,
    updatedAt: raw.updatedAt || createdAt
  };
}

export const migrations = [
  {
    from: 1,
    to: 2,
    description: "Add schemaVersion, per-habit updatedAt, deletion records and sync metadata; repair malformed habits.",
    up(data) {
      const now = new Date().toISOString();
      const seen = new Set();
      const habits = (Array.isArray(data.habits) ? data.habits : [])
        .filter(h => h && typeof h === "object")
        .map(h => cleanHabit(h, now, seen))
        .filter(h => h.name);
      return {
        ...data,
        habits,
        deleted: data.deleted && typeof data.deleted === "object" ? data.deleted : {},
        meta: {
          deviceId: data.meta?.deviceId || newId(),
          updatedAt: data.meta?.updatedAt || now,
          lastSyncedAt: data.meta?.lastSyncedAt || null
        }
      };
    }
  },
  {
    from: 2,
    to: 3,
    description: "Per-day habit log (merges day by day when syncing), counter habits, reminders, archiving, custom categories.",
    up(data) {
      const now = new Date().toISOString();
      const habits = (Array.isArray(data.habits) ? data.habits : []).map(h => {
        const stamp = h.updatedAt || h.createdAt || now;
        const log = { ...(h.log && typeof h.log === "object" ? h.log : {}) };
        for (const day of Array.isArray(h.completions) ? h.completions : []) if (!log[day]) log[day] = { v: 1, t: stamp };
        const type = h.type === "count" ? "count" : "check";
        const target = type === "count" ? Math.min(999, Math.max(1, Math.floor(Number(h.target)) || 1)) : 1;
        const next = {
          ...h, type, target, log,
          reminderTime: /^\d{2}:\d{2}$/.test(h.reminderTime || "") ? h.reminderTime : "",
          archivedAt: h.archivedAt || null
        };
        next.completions = deriveCompletions(log, targetOf(next));
        return next;
      });
      return { ...data, habits };
    }
  }
];

export const CURRENT_SCHEMA_VERSION = APP_CONFIG.schemaVersion;

export function detectVersion(data) {
  const v = Number(data?.schemaVersion);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * Upgrade `input` to the current schema without mutating it.
 * Returns { data, from, to, migrated, newer }.
 * `newer` is true when the data was written by a newer app version; it is
 * returned untouched so an old build never damages newer data.
 */
export function migrate(input) {
  let data = JSON.parse(JSON.stringify(input ?? {}));
  const from = detectVersion(data);
  if (from > CURRENT_SCHEMA_VERSION) return { data, from, to: from, migrated: false, newer: true };

  let version = from;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations.find(m => m.from === version);
    if (!step) throw new Error(`No migration path from schema v${version}`);
    data = step.up(data);
    data.schemaVersion = step.to;
    version = step.to;
  }
  data.schemaVersion = version;
  return { data, from, to: version, migrated: from !== version, newer: false };
}
