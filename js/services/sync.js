import { APP_CONFIG } from "../config.js";
import { loadData, saveData } from "../storage.js";
import { applyMergedState } from "../habits.js";
import { migrate, CURRENT_SCHEMA_VERSION } from "../migrations.js";
import { mergeLogs, deriveCompletions, targetOf } from "./log.js";
import { encryptJSON, decryptJSON, isEncrypted } from "./crypto.js";

/**
 * Cloud synchronization
 * ---------------------
 * The app talks to a backend through a small adapter: { pull(), push(payload) }.
 * `createRestAdapter` implements it over plain HTTPS (GET/PUT of one JSON
 * document), so any backend that follows that contract can be used.
 * See README.md ("Cloud sync") and server/sync-server.js for a reference server.
 *
 * Merge strategy:
 *  - Habit settings (name, schedule, ...): the most recently edited copy wins.
 *  - Daily records: merged day by day, so two devices recording different days
 *    (or different counters) never overwrite each other.
 *  - Deleting a habit leaves a record in `deleted`, so it is removed on every
 *    device instead of being re-created by the next sync.
 *  - Language/theme are per-device and are not synced.
 * With a passphrase set, data is encrypted on this device before upload.
 */

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const time = iso => { const n = Date.parse(iso); return Number.isNaN(n) ? 0 : n; };

export class SyncError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/* ---------- connection settings (kept apart from habit data and backups) ---------- */

export function loadSyncConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_CONFIG.syncKey) || "null") || {};
    return { enabled: Boolean(parsed.enabled), url: String(parsed.url || ""), token: String(parsed.token || ""), passphrase: String(parsed.passphrase || "") };
  } catch { return { enabled: false, url: "", token: "", passphrase: "" }; }
}
export function saveSyncConfig(config) {
  try { localStorage.setItem(APP_CONFIG.syncKey, JSON.stringify(config)); return true; }
  catch (error) { console.error("Could not save sync settings:", error); return false; }
}
export function clearSyncConfig() {
  try { localStorage.removeItem(APP_CONFIG.syncKey); } catch { /* ignore */ }
}

/** HTTPS only, except for localhost during development. */
export function isValidSyncUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch { return false; }
}

/* ---------- adapter ---------- */

export function createRestAdapter({ url, token }, fetchImpl = (...a) => fetch(...a)) {
  const headers = () => ({ Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const fail = res => new SyncError(res.status === 401 || res.status === 403 ? "AUTH" : "HTTP", `HTTP ${res.status}`);
  return {
    name: "rest",
    async pull() {
      const res = await fetchImpl(url, { method: "GET", headers: headers(), cache: "no-store" });
      if (res.status === 404) return null;           // nothing stored yet
      if (!res.ok) throw fail(res);
      return res.json();
    },
    async push(payload) {
      const res = await fetchImpl(url, { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
      if (!res.ok) throw fail(res);
    }
  };
}

/* ---------- merge ---------- */

function mergeHabit(a, b) {
  const newer = time(b.updatedAt) > time(a.updatedAt) ? b : a;
  const log = mergeLogs(a.log, b.log);
  return { ...newer, log, completions: deriveCompletions(log, targetOf(newer)) };
}

export function mergeStates(local, remote, nowMs = Date.now()) {
  const remoteHabits = Array.isArray(remote?.habits) ? remote.habits : [];
  const deleted = { ...(remote?.deleted || {}) };
  for (const [id, at] of Object.entries(local.deleted || {})) {
    if (!deleted[id] || time(at) > time(deleted[id])) deleted[id] = at;
  }

  const byId = new Map();
  for (const h of local.habits || []) byId.set(h.id, h);
  for (const h of remoteHabits) {
    const mine = byId.get(h.id);
    byId.set(h.id, mine ? mergeHabit(mine, h) : h);
  }

  const habits = [];
  for (const h of byId.values()) {
    if (deleted[h.id]) {
      if (time(deleted[h.id]) >= time(h.updatedAt)) continue;  // deletion is newer: drop it
      delete deleted[h.id];                                    // edited after deletion: keep it
    }
    habits.push(h);
  }
  for (const [id, at] of Object.entries(deleted)) {
    if (nowMs - time(at) > TOMBSTONE_TTL_MS) delete deleted[id];
  }
  return { habits, deleted };
}

/* ---------- sync ---------- */

export async function syncNow(adapter, { passphrase = "" } = {}) {
  const local = loadData();

  let remoteRaw = await adapter.pull();
  if (remoteRaw && isEncrypted(remoteRaw)) {
    if (!passphrase) throw new SyncError("ENC_REQUIRED", "Cloud data is encrypted");
    try { remoteRaw = await decryptJSON(remoteRaw, passphrase); }
    catch { throw new SyncError("ENC_WRONG", "Wrong passphrase or damaged cloud data"); }
  }
  let remote = null;
  if (remoteRaw) {
    let result;
    try { result = migrate(remoteRaw); }
    catch (error) { throw new SyncError("BAD_REMOTE", error.message); }
    if (result.newer) throw new SyncError("REMOTE_NEWER", "Cloud data was saved by a newer version of the app");
    remote = result.data;
  }

  const merged = mergeStates({ habits: local.habits, deleted: local.deleted }, remote);
  if (!applyMergedState(merged)) throw new SyncError("LOCAL_SAVE", "Could not save merged data");

  const syncedAt = new Date().toISOString();
  const payload = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deviceId: local.meta.deviceId,
    updatedAt: syncedAt,
    habits: merged.habits,
    deleted: merged.deleted
  };
  await adapter.push(passphrase ? await encryptJSON(payload, passphrase) : payload);
  saveData({ ...loadData(), meta: { lastSyncedAt: syncedAt } });
  return { syncedAt, habits: merged.habits.length };
}

/** True when something changed on this device since the last successful sync. */
export function hasUnsyncedChanges() {
  const { meta } = loadData();
  return !meta.lastSyncedAt || time(meta.updatedAt) > time(meta.lastSyncedAt);
}
