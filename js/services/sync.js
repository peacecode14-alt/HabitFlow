import { APP_CONFIG } from "../config.js";
import { loadData, saveData } from "../storage.js";
import { applyMergedState } from "../habits.js";
import { migrate, CURRENT_SCHEMA_VERSION } from "../migrations.js";
import { mergeLogs, deriveCompletions, targetOf } from "./log.js";
import { encryptJSON, decryptJSON, isEncrypted } from "./crypto.js";

/**
 * Cloud synchronization
 * ---------------------
 * The app talks to Firestore through an adapter: { pull(), push(payload) }.
 * The legacy REST adapter remains exported only for its isolated reference-server tests.
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

/* ---------- cloud sync preferences ---------- */

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.syncKey);
    const parsed = JSON.parse(raw || "null") || {};
    const clean = { enabled: Boolean(parsed.enabled), passphrase: String(parsed.passphrase || "") };
    // Remove legacy REST credentials from older versions of this browser config.
    if (raw && (Object.hasOwn(parsed, "url") || Object.hasOwn(parsed, "token"))) {
      localStorage.setItem(APP_CONFIG.syncKey, JSON.stringify(clean));
    }
    return clean;
  } catch { return { enabled: false, passphrase: "" }; }
}
export function saveSyncConfig(config) {
  try {
    localStorage.setItem(APP_CONFIG.syncKey, JSON.stringify({
      enabled: Boolean(config.enabled),
      passphrase: String(config.passphrase || "")
    }));
    return true;
  } catch (error) { console.error("Could not save sync settings:", error); return false; }
}
export function clearSyncConfig() {
  try { localStorage.removeItem(APP_CONFIG.syncKey); } catch { /* ignore */ }
}

// Retained only for the standalone reference-server test suite. The app UI now
// uses the authenticated Firestore adapter in firestore-sync.js.
export function isValidSyncUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch { return false; }
}
export function createRestAdapter({ url, token }, fetchImpl = (...a) => fetch(...a)) {
  const headers = () => ({ Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const fail = res => new SyncError(res.status === 401 || res.status === 403 ? "AUTH" : "HTTP", `HTTP ${res.status}`);
  return {
    name: "rest-test",
    async pull() {
      const res = await fetchImpl(url, { method: "GET", headers: headers(), cache: "no-store" });
      if (res.status === 404) return null;
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}
function sameCloudState(a, b) {
  const state = value => ({
    habits: [...(value?.habits || [])].sort((x, y) => String(x.id).localeCompare(String(y.id))).map(stableValue),
    deleted: stableValue(value?.deleted || {})
  });
  return JSON.stringify(state(a)) === JSON.stringify(state(b));
}

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
  const wrote = !remote || !sameCloudState(merged, remote);
  if (wrote) await adapter.push(passphrase ? await encryptJSON(payload, passphrase) : payload);
  saveData({ ...loadData(), meta: { lastSyncedAt: syncedAt } });
  return { syncedAt, habits: merged.habits.length, wrote };
}

/** True when something changed on this device since the last successful sync. */
export function hasUnsyncedChanges() {
  const { meta } = loadData();
  return !meta.lastSyncedAt || time(meta.updatedAt) > time(meta.lastSyncedAt);
}
