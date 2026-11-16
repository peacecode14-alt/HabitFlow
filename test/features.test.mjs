// Run: node test/features.test.mjs   (Node 18+)
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = new Proxy({
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: k => void store.delete(k)
}, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (t, k) => store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : Reflect.getOwnPropertyDescriptor(t, k) });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };
const { withDay, deriveCompletions, mergeLogs, isDone, valueOn, targetOf } = await import("../js/services/log.js");
const stats = await import("../js/services/stats.js");
const { dueReminders } = await import("../js/services/reminders.js");
const { encryptJSON, decryptJSON, isEncrypted } = await import("../js/services/crypto.js");
const { parseBackup, BackupError } = await import("../js/services/backup.js");
const { migrate, CURRENT_SCHEMA_VERSION } = await import("../js/migrations.js");
const S = await import("../js/services/sync.js");
const { TEMPLATES } = await import("../js/templates.js");

// Local-date keys, as the app uses them.
const key = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const iso = (y, m, d) => new Date(y, m - 1, d, 8, 0, 0).toISOString();
const mk = (extra = {}) => ({ id: "h", name: "H", frequency: [0, 1, 2, 3, 4, 5, 6], type: "check", target: 1, createdAt: iso(2026, 11, 1), updatedAt: iso(2026, 11, 1), log: {}, completions: [], archivedAt: null, ...extra });
const doneOn = (h, ...keys) => keys.reduce((acc, k) => withDay(acc, k, { v: targetOf(acc) }, iso(2026, 11, 1)), h);

console.log("Daily log");
await test("check habit: done when v >= 1; counter: done at target", () => {
  let h = mk();
  assert.equal(isDone(h, "2026-11-02"), false);
  h = withDay(h, "2026-11-02", { v: 1 });
  assert.equal(isDone(h, "2026-11-02"), true);
  let c = mk({ type: "count", target: 8 });
  c = withDay(c, "2026-11-02", { v: 7 }); assert.equal(isDone(c, "2026-11-02"), false);
  c = withDay(c, "2026-11-02", { v: 8 }); assert.equal(isDone(c, "2026-11-02"), true);
  assert.equal(valueOn(c, "2026-11-02"), 8);
  assert.deepEqual(c.completions, ["2026-11-02"]);
});
await test("notes are stored per day and removed when emptied", () => {
  let h = withDay(mk(), "2026-11-02", { n: "felt great" });
  assert.equal(h.log["2026-11-02"].n, "felt great");
  h = withDay(h, "2026-11-02", { n: "" });
  assert.equal("n" in h.log["2026-11-02"], false);
});
await test("withDay never mutates its input", () => {
  const h = mk(); const copy = JSON.stringify(h);
  withDay(h, "2026-11-02", { v: 1 });
  assert.equal(JSON.stringify(h), copy);
});

console.log("Statistics (schedule-aware)");
await test("completion rate counts only scheduled days, not every day since creation", () => {
  // Scheduled Mon/Wed/Fri. Created Mon 2026-11-02. Today = Sun 2026-11-15.
  const h = mk({ frequency: [1, 3, 5], createdAt: iso(2026, 11, 2) });
  const scheduledKeys = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"];
  const full = doneOn(h, ...scheduledKeys);
  const r = stats.completionRate(full, "2026-11-15");
  assert.deepEqual([r.done, r.scheduled, r.percent], [6, 6, 100], "old formula would give 6/14 = 43%");
});
await test("streak ignores non-scheduled days and is not broken by an unfinished today", () => {
  const h = mk({ frequency: [1, 3, 5], createdAt: iso(2026, 11, 2) });
  const f = doneOn(h, "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11");
  // Today Fri 2026-11-13 is scheduled but not done yet → streak stays 5
  assert.equal(stats.currentStreak(f, "2026-11-13"), 5);
  // Once done → 6
  assert.equal(stats.currentStreak(doneOn(f, "2026-11-13"), "2026-11-13"), 6);
  // A missed scheduled day in the past breaks it
  const broken = doneOn(h, "2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-13");
  assert.equal(stats.currentStreak(broken, "2026-11-13"), 3);
  assert.equal(stats.bestStreak(broken, "2026-11-13"), 3, "longest run: Nov 9, 11, 13");
});
await test("best streak is kept even after the streak is lost", () => {
  const h = mk({ createdAt: iso(2026, 11, 1) });
  const f = doneOn(h, "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-07");
  assert.equal(stats.bestStreak(f, "2026-11-10"), 4);
  assert.equal(stats.currentStreak(f, "2026-11-10"), 0);
});
await test("a habit is not counted before it was created; archived habits stop counting", () => {
  const h = mk({ createdAt: iso(2026, 11, 10) });
  assert.equal(stats.isScheduled(h, "2026-11-05"), false);
  assert.equal(stats.isScheduled(h, "2026-11-10"), true);
  assert.equal(stats.isScheduled(h, "2026-11-05", { ignoreStart: true }), true, "day editor can back-fill");
  const a = mk({ archivedAt: iso(2026, 11, 12) });
  assert.equal(stats.isScheduled(a, "2026-11-11"), true);
  assert.equal(stats.isScheduled(a, "2026-11-12"), false);
});
await test("back-filling a day before the creation date moves the start of the habit", () => {
  const h = withDay(mk({ createdAt: iso(2026, 11, 10) }), "2026-11-08", { v: 1 });
  assert.equal(stats.isScheduled(h, "2026-11-08"), true);
});

console.log("Migration v2 → v3");
await test("v2 data gains log, type/target, reminder, archive fields", () => {
  const v2 = { schemaVersion: 2, habits: [{ id: "x", name: "Old", category: "Health", frequency: [1], completions: ["2026-11-02"], createdAt: iso(2026, 11, 1), updatedAt: iso(2026, 11, 1) }], deleted: {}, settings: {}, meta: {} };
  const r = migrate(v2);
  assert.equal(r.to, CURRENT_SCHEMA_VERSION);
  const h = r.data.habits[0];
  assert.deepEqual([h.type, h.target, h.reminderTime, h.archivedAt], ["check", 1, "", null]);
  assert.deepEqual(h.completions, ["2026-11-02"]);
  assert.equal(h.log["2026-11-02"].v, 1);
});
await test("custom categories survive migration", () => {
  const r = migrate({ schemaVersion: 2, habits: [{ id: "x", name: "A", category: "Fitness 💪", frequency: [1], completions: [], createdAt: iso(2026, 11, 1), updatedAt: iso(2026, 11, 1) }] });
  assert.equal(r.data.habits[0].category, "Fitness 💪");
});

console.log("Reminders");
await test("fires once, only when due, unfinished and scheduled", () => {
  const h = mk({ reminderTime: "09:00", createdAt: iso(2026, 11, 1) });
  const at = (hh, mm) => new Date(2026, 10, 15, hh, mm); // Sun 15 Nov 2026
  assert.equal(dueReminders({ habits: [h], now: at(8, 59) }).length, 0, "too early");
  const fired = new Set();
  const due = dueReminders({ habits: [h], now: at(9, 0), fired });
  assert.equal(due.length, 1); fired.add(due[0].id);
  assert.equal(dueReminders({ habits: [h], now: at(9, 1), fired }).length, 0, "already fired");
  assert.equal(dueReminders({ habits: [h], now: at(9, 30) }).length, 0, "missed window");
  assert.equal(dueReminders({ habits: [doneOn(h, "2026-11-15")], now: at(9, 0) }).length, 0, "already done");
  assert.equal(dueReminders({ habits: [mk({ reminderTime: "09:00", frequency: [1] })], now: at(9, 0) }).length, 0, "not scheduled on Sunday");
  assert.equal(dueReminders({ habits: [{ ...h, archivedAt: iso(2026, 11, 3) }], now: at(9, 0) }).length, 0, "archived");
  assert.equal(dueReminders({ habits: [mk()], now: at(9, 0) }).length, 0, "no reminder set");
});

console.log("Encryption");
await test("round-trips and hides the content", async () => {
  const doc = { habits: [{ id: "1", name: "Secret habit" }], deleted: {} };
  const env = await encryptJSON(doc, "correct horse");
  assert.ok(isEncrypted(env));
  assert.ok(!JSON.stringify(env).includes("Secret habit"));
  assert.deepEqual(await decryptJSON(env, "correct horse"), doc);
});
await test("wrong passphrase and tampering are rejected", async () => {
  const env = await encryptJSON({ a: 1 }, "right");
  await assert.rejects(decryptJSON(env, "wrong"));
  const bad = { ...env, data: env.data.slice(0, -4) + "AAAA" };
  await assert.rejects(decryptJSON(bad, "right"));
  await assert.rejects(decryptJSON({ ...env, iter: 99999999 }, "right"), /parameters/);
});
await test("each encryption uses a fresh salt/iv", async () => {
  const a = await encryptJSON({ x: 1 }, "p"), b = await encryptJSON({ x: 1 }, "p");
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.data, b.data);
});

console.log("Sync with encryption");
await test("syncNow encrypts the upload, and reads encrypted cloud data back", async () => {
  store.clear();
  store.set("habitflow_data", JSON.stringify({ schemaVersion: 3, habits: [{ id: "L", name: "Local habit", category: "Health", frequency: [1], completions: [], log: {}, createdAt: iso(2026, 11, 1), updatedAt: iso(2026, 11, 1), type: "check", target: 1 }], deleted: {}, settings: {}, meta: { deviceId: "d" } }));
  const { loadData } = await import("../js/storage.js");
  let cloud = await encryptJSON({ schemaVersion: 3, habits: [{ id: "R", name: "Remote habit", category: "Health", frequency: [1], completions: [], log: {}, createdAt: iso(2026, 11, 1), updatedAt: iso(2026, 11, 2), type: "check", target: 1 }], deleted: {} }, "pw");
  const adapter = { pull: async () => cloud, push: async p => { cloud = p; } };
  await S.syncNow(adapter, { passphrase: "pw" });
  assert.deepEqual(loadData().habits.map(h => h.name).sort(), ["Local habit", "Remote habit"]);
  assert.ok(isEncrypted(cloud) && !JSON.stringify(cloud).includes("Local habit"));
  await assert.rejects(S.syncNow(adapter, { passphrase: "" }), e => e.code === "ENC_REQUIRED");
  await assert.rejects(S.syncNow(adapter, { passphrase: "nope" }), e => e.code === "ENC_WRONG");
});

console.log("Backup import");
await test("imports a legacy (pre-versioning) export file", () => {
  const legacy = JSON.stringify({ app: "HabitFlow", version: "1.0.0", habits: [{ id: "a", name: "Read", category: "Learning", frequency: [1], completions: ["2026-11-02"], createdAt: iso(2026, 10, 1) }], settings: { language: "ar" } });
  const r = parseBackup(legacy, "2026-11-15T10:00:00.000Z");
  assert.equal(r.count, 1);
  assert.equal(r.habits[0].updatedAt, "2026-11-15T10:00:00.000Z", "restored habits beat older deletion records");
  assert.deepEqual(r.habits[0].completions, ["2026-11-02"]);
});
await test("rejects bad files with clear error codes", () => {
  const code = fn => { try { fn(); } catch (e) { return e.code; } };
  assert.equal(code(() => parseBackup("{nope")), "INVALID_JSON");
  assert.equal(code(() => parseBackup('{"hello":1}')), "INVALID_FILE");
  assert.equal(code(() => parseBackup("[]")), "INVALID_FILE");
  assert.equal(code(() => parseBackup('{"schemaVersion":99,"habits":[]}')), "NEWER");
});
await test("restore keeps habits that an old deletion record would otherwise remove", () => {
  const r = parseBackup(JSON.stringify({ schemaVersion: 3, habits: [{ id: "k", name: "Back", frequency: [1], completions: [], log: {}, createdAt: iso(2026, 10, 1) }], deleted: { k: "2026-11-01T00:00:00.000Z" } }), "2026-11-15T10:00:00.000Z");
  const merged = S.mergeStates({ habits: r.habits, deleted: r.deleted }, { habits: [], deleted: { k: "2026-11-10T00:00:00.000Z" } });
  assert.equal(merged.habits.length, 1);
});

console.log("Templates");
await test("templates are valid habits in both languages", () => {
  for (const tp of TEMPLATES) {
    assert.ok(tp.name.en && tp.name.ar && tp.icon && tp.frequency.length);
    assert.ok(["check", "count"].includes(tp.type));
  }
  assert.equal(new Set(TEMPLATES.map(t => t.key)).size, TEMPLATES.length);
});

console.log(`\n${passed} tests passed`);
