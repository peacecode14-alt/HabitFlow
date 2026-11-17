import { APP_CONFIG } from "./config.js";
import { migrate, detectVersion, CURRENT_SCHEMA_VERSION } from "./migrations.js";

const KEY = APP_CONFIG.storageKey;
const BACKUP_PREFIX = `${KEY}_backup_v`;
const CORRUPT_PREFIX = `${KEY}_corrupt_`;

const defaults = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  habits: [],
  deleted: {},
  settings: { language: APP_CONFIG.defaultLanguage, theme: APP_CONFIG.defaultTheme },
  meta: { deviceId: null, updatedAt: null, lastSyncedAt: null }
});

function normalize(parsed) {
  const base = defaults();
  return {
    ...parsed,
    schemaVersion: parsed.schemaVersion ?? base.schemaVersion,
    habits: Array.isArray(parsed.habits) ? parsed.habits : [],
    deleted: parsed.deleted && typeof parsed.deleted === "object" ? parsed.deleted : {},
    settings: {
      language: parsed.settings?.language || APP_CONFIG.defaultLanguage,
      theme: parsed.settings?.theme || APP_CONFIG.defaultTheme
    },
    meta: { ...base.meta, ...(parsed.meta || {}) }
  };
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch (error) { console.error("Could not save HabitFlow data:", error); return false; }
}

/** Keep a copy of the original bytes before touching them. Never overwrites an existing backup. */
function backupRaw(key, raw) {
  try { if (localStorage.getItem(key) === null) localStorage.setItem(key, raw); }
  catch (error) { console.error("Could not create HabitFlow backup:", error); }
}

export function loadData() {
  let raw;
  try { raw = localStorage.getItem(KEY); }
  catch (error) { console.error("Could not read HabitFlow data:", error); return defaults(); }
  if (!raw) return defaults();

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    console.error("HabitFlow data is corrupted; a copy was kept for recovery.", error);
    backupRaw(`${CORRUPT_PREFIX}${Date.now()}`, raw);
    return defaults();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults();

  try {
    const result = migrate(parsed);
    if (result.newer) {
      console.warn(`HabitFlow data is schema v${result.from}, newer than this app (v${CURRENT_SCHEMA_VERSION}). Loaded without changes.`);
      return normalize(result.data);
    }
    const data = normalize(result.data);
    if (result.migrated) {
      backupRaw(`${BACKUP_PREFIX}${result.from}`, raw);
      if (!write(data)) console.error("HabitFlow migration could not be saved; it will be retried on next load.");
      console.info(`HabitFlow data migrated from schema v${result.from} to v${result.to}.`);
    }
    return data;
  } catch (error) {
    // The stored data is left exactly as it was.
    console.error("HabitFlow migration failed; stored data was not changed.", error);
    backupRaw(`${BACKUP_PREFIX}${detectVersion(parsed)}_failed`, raw);
    return defaults();
  }
}

/**
 * Save data. Fields that are not passed (e.g. `deleted`, `meta`) are kept from
 * the stored copy. `meta.updatedAt` only moves when habits, deletions or
 * settings actually change, so it can be used to tell whether there is
 * anything new to sync.
 */
export function saveData(data) {
  const prev = loadData();
  const next = normalize({
    ...prev,
    ...data,
    schemaVersion: Math.max(CURRENT_SCHEMA_VERSION, prev.schemaVersion || 0),
    meta: { ...prev.meta, ...(data.meta || {}) }
  });
  if (!next.meta.deviceId) next.meta.deviceId = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const content = d => JSON.stringify([d.habits, d.deleted, d.settings]);
  if (content(next) !== content(prev) || !prev.meta.updatedAt) next.meta.updatedAt = new Date().toISOString();

  if (JSON.stringify(next) === JSON.stringify(prev)) return true;
  return write(next);
}

/** Keep a copy of the current data before it is replaced by an imported backup. */
export function snapshotBeforeImport() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(`${BACKUP_PREFIX}pre_import`, raw);
    return true;
  } catch (error) { console.error("Could not create pre-import snapshot:", error); return false; }
}

export function clearData() {
  try {
    localStorage.removeItem(KEY);
    Object.keys(localStorage)
      .filter(k => k.startsWith(BACKUP_PREFIX) || k.startsWith(CORRUPT_PREFIX))
      .forEach(k => localStorage.removeItem(k));
    return true;
  } catch (error) { console.error("Could not clear HabitFlow data:", error); return false; }
}
