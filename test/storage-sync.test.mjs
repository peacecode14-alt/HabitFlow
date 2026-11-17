// Run: node test/storage-sync.test.mjs   (Node 18+)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
// Object.keys(localStorage) support used by clearData()
globalThis.localStorage = new Proxy(globalThis.localStorage, {
  ownKeys: () => [...store.keys()],
  getOwnPropertyDescriptor: (t, k) =>
    store.has(k)
      ? { enumerable: true, configurable: true, value: store.get(k) }
      : Reflect.getOwnPropertyDescriptor(t, k),
});

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log("  ✓", name);
};
const reset = () => store.clear();
const quiet = (fn) => {
  const e = console.error,
    w = console.warn,
    i = console.info;
  console.error = console.warn = console.info = () => {};
  try {
    return fn();
  } finally {
    console.error = e;
    console.warn = w;
    console.info = i;
  }
};

const { loadData, saveData, clearData } = await import("../js/storage.js");
const { migrate, detectVersion, CURRENT_SCHEMA_VERSION } =
  await import("../js/migrations.js");

console.log("Migrations & storage");

const legacy = {
  habits: [
    {
      id: "a",
      name: "  Read  ",
      category: "Reading??",
      icon: "📚",
      color: "#A78BFA",
      frequency: [1, 3, 9, "x"],
      completions: ["2026-11-02", "2026-11-02", "bad", "2026-11-01"],
      createdAt: "2026-10-01T08:00:00.000Z",
    },
    { id: "a", name: "Duplicate id", frequency: [], completions: null },
    { name: "No id", category: "Health" },
    { id: "z", name: "   " },
    null,
  ],
  settings: { language: "ar", theme: "light" },
};

await test("legacy data (no schemaVersion) is detected as v1", () =>
  assert.equal(detectVersion(legacy), 1));

await test("v1 → v2 migration repairs and upgrades data", () => {
  reset();
  store.set("habitflow_data", JSON.stringify(legacy));
  const d = loadData();
  assert.equal(d.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(d.habits.length, 3, "blank-name and null entries dropped");
  const [a, dup, noId] = d.habits;
  assert.equal(a.name, "Read");
  assert.equal(a.category, "Personal", "unknown category falls back");
  assert.deepEqual(a.frequency, [1, 3]);
  assert.deepEqual(a.completions, ["2026-11-01", "2026-11-02"]);
  assert.equal(a.updatedAt, a.createdAt);
  assert.notEqual(dup.id, "a", "duplicate id re-issued");
  assert.deepEqual(
    dup.frequency,
    [0, 1, 2, 3, 4, 5, 6],
    "empty frequency → every day",
  );
  assert.ok(noId.id && noId.category === "Health");
  assert.equal(a.type, "check");
  assert.equal(a.target, 1);
  assert.equal(a.archivedAt, null);
  assert.deepEqual(
    Object.keys(a.log),
    ["2026-11-01", "2026-11-02"],
    "completions become a per-day log",
  );
  assert.equal(d.settings.language, "ar");
  assert.ok(d.meta.deviceId);
  assert.deepEqual(d.deleted, {});
});

await test("original data is backed up before migrating", () => {
  const backup = JSON.parse(store.get("habitflow_data_backup_v1"));
  assert.equal(backup.habits.length, 5);
  assert.equal(
    JSON.parse(store.get("habitflow_data")).schemaVersion,
    CURRENT_SCHEMA_VERSION,
  );
});

await test("loading again is a no-op (idempotent)", () => {
  const before = store.get("habitflow_data");
  loadData();
  loadData();
  assert.equal(store.get("habitflow_data"), before);
});

await test("migrate() does not mutate its input", () => {
  const input = JSON.parse(JSON.stringify(legacy));
  migrate(input);
  assert.deepEqual(input, legacy);
});

await test("data from a NEWER app version is left untouched", () => {
  reset();
  const future = {
    schemaVersion: 99,
    habits: [{ id: "f", name: "Future", extra: true }],
    newField: { keep: 1 },
  };
  store.set("habitflow_data", JSON.stringify(future));
  const d = quiet(() => loadData());
  assert.equal(d.habits[0].extra, true);
  assert.equal(
    store.get("habitflow_data"),
    JSON.stringify(future),
    "not rewritten by load",
  );
  quiet(() => saveData({ habits: d.habits }));
  const saved = JSON.parse(store.get("habitflow_data"));
  assert.equal(saved.schemaVersion, 99, "version is never downgraded");
  assert.deepEqual(saved.newField, { keep: 1 }, "unknown fields preserved");
});

await test("corrupted JSON is kept for recovery and the app starts clean", () => {
  reset();
  store.set("habitflow_data", "{not json");
  const d = quiet(() => loadData());
  assert.deepEqual(d.habits, []);
  const k = [...store.keys()].find((k) =>
    k.startsWith("habitflow_data_corrupt_"),
  );
  assert.ok(k && store.get(k) === "{not json");
});

await test("saveData only bumps meta.updatedAt when content really changes", () => {
  reset();
  saveData({ habits: [], settings: { language: "en", theme: "dark" } });
  const t1 = loadData().meta.updatedAt;
  assert.ok(t1);
  saveData({ habits: [], settings: { language: "en", theme: "dark" } });
  assert.equal(loadData().meta.updatedAt, t1);
  saveData({ habits: [{ id: "1", name: "x" }] });
  assert.notEqual(loadData().meta.updatedAt, undefined);
});

await test("clearData removes data and backups", () => {
  store.set("habitflow_data_backup_v1", "{}");
  store.set("other_key", "keep");
  clearData();
  assert.equal(store.has("habitflow_data"), false);
  assert.equal(store.has("habitflow_data_backup_v1"), false);
  assert.equal(store.get("other_key"), "keep");
});

console.log("Habit operations (timestamps & deletion records)");
reset();
const H = await import("../js/habits.js?ops");
await test("edits set updatedAt; day changes only touch the log; delete leaves a record", async () => {
  assert.ok(H.addHabit({ name: "Run", frequency: [1], category: "Health" }));
  const h = H.getAllHabits()[0];
  assert.ok(h.updatedAt && h.createdAt);
  await new Promise((r) => setTimeout(r, 5));
  H.toggleCompletion(h.id, "2026-11-10");
  const after = H.getAllHabits()[0];
  assert.equal(
    after.updatedAt,
    h.updatedAt,
    "toggling a day must not override settings edits made elsewhere",
  );
  assert.deepEqual(after.completions, ["2026-11-10"]);
  assert.ok(after.log["2026-11-10"].t);
  H.deleteHabit(h.id);
  assert.equal(H.getAllHabits().length, 0);
  assert.ok(loadData().deleted[h.id]);
  assert.ok(H.restoreHabit(after), "undo delete");
  assert.equal(H.getAllHabits().length, 1);
  assert.equal(
    loadData().deleted[h.id],
    undefined,
    "deletion record removed on undo",
  );
});

console.log("Cloud sync");
reset();
// Seed local state BEFORE sync.js is imported (habits.js reads storage at import time).
const T = (n) => new Date(Date.UTC(2026, 10, n)).toISOString();
store.set(
  "habitflow_data",
  JSON.stringify({
    schemaVersion: 2,
    habits: [
      {
        id: "shared",
        name: "Shared (local newer)",
        category: "Health",
        icon: "✦",
        color: "#42D9F5",
        frequency: [0],
        completions: [],
        createdAt: T(1),
        updatedAt: T(10),
      },
      {
        id: "localOnly",
        name: "Local only",
        category: "Health",
        icon: "✦",
        color: "#42D9F5",
        frequency: [0],
        completions: [],
        createdAt: T(1),
        updatedAt: T(5),
      },
      {
        id: "deletedRemote",
        name: "Deleted on other device",
        category: "Health",
        icon: "✦",
        color: "#42D9F5",
        frequency: [0],
        completions: [],
        createdAt: T(1),
        updatedAt: T(2),
      },
    ],
    deleted: {},
    settings: { language: "en", theme: "dark" },
    meta: { deviceId: "dev-local", updatedAt: T(10), lastSyncedAt: null },
  }),
);
const S = await import("../js/services/sync.js");

await test("mergeStates: newest wins, deletions propagate, newer edit beats older deletion", () => {
  const local = {
    habits: [
      { id: "a", updatedAt: T(5), name: "local" },
      { id: "b", updatedAt: T(9), name: "edited after delete" },
      { id: "c", updatedAt: T(2) },
    ],
    deleted: {},
  };
  const remote = {
    habits: [
      { id: "a", updatedAt: T(6), name: "remote" },
      { id: "d", updatedAt: T(1) },
    ],
    deleted: { c: T(3), b: T(4) },
  };
  const m = S.mergeStates(local, remote, Date.parse(T(12)));
  const byId = Object.fromEntries(m.habits.map((h) => [h.id, h]));
  assert.equal(byId.a.name, "remote");
  assert.ok(byId.b, "b was edited after its deletion → kept");
  assert.ok(!byId.c, "c deleted remotely after last edit → removed");
  assert.ok(byId.d);
  assert.ok(!("b" in m.deleted) && "c" in m.deleted);
});

await test("mergeStates: old deletion records expire", () => {
  const m = S.mergeStates(
    { habits: [], deleted: { x: T(1) } },
    null,
    Date.parse(T(1)) + 100 * 864e5,
  );
  assert.deepEqual(m.deleted, {});
});

await test("syncNow merges a LEGACY (v1) cloud document, then pushes v2", async () => {
  let pushed = null;
  const adapter = {
    async pull() {
      return {
        habits: [
          {
            id: "shared",
            name: "Shared (remote older)",
            createdAt: T(1),
            updatedAt: T(3),
          },
          { id: "remoteOnly", name: "Remote only", category: "Learning" },
          { id: "deletedRemote", name: "x", createdAt: T(1), updatedAt: T(2) },
        ],
        deleted: { deletedRemote: T(8) },
      };
    },
    async push(p) {
      pushed = p;
    },
  };
  const r = await S.syncNow(adapter);
  const names = H_names();
  assert.deepEqual(names.sort(), [
    "Local only",
    "Remote only",
    "Shared (local newer)",
  ]);
  assert.equal(pushed.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(pushed.habits.length, 3);
  assert.ok(pushed.deleted.deletedRemote);
  assert.equal(pushed.deviceId, "dev-local");
  assert.equal(S.hasUnsyncedChanges(), false);
  assert.equal(loadData().meta.lastSyncedAt, r.syncedAt);
});
function H_names() {
  return loadData().habits.map((h) => h.name);
}

await test("sync merges different days recorded on two devices without losing either", () => {
  const log = (d, v, t) => ({ [d]: { v, t } });
  const a = {
    id: "h",
    updatedAt: T(1),
    target: 1,
    log: { ...log("2026-11-01", 1, T(5)), ...log("2026-11-03", 1, T(5)) },
  };
  const b = {
    id: "h",
    updatedAt: T(1),
    target: 1,
    log: { ...log("2026-11-02", 1, T(6)), ...log("2026-11-03", 0, T(7)) },
  };
  const m = S.mergeStates(
    { habits: [a], deleted: {} },
    { habits: [b], deleted: {} },
  ).habits[0];
  assert.deepEqual(
    m.completions,
    ["2026-11-01", "2026-11-02"],
    "day 1 + day 2 kept; newer un-mark of day 3 wins",
  );
});

await test("hasUnsyncedChanges turns true after a local change", async () => {
  await new Promise((r) => setTimeout(r, 5));
  saveData({ habits: [...loadData().habits, { id: "n", name: "New" }] });
  assert.equal(S.hasUnsyncedChanges(), true);
});

await test("syncNow refuses cloud data from a newer app version and changes nothing", async () => {
  const before = store.get("habitflow_data");
  await assert.rejects(
    S.syncNow({
      pull: async () => ({ schemaVersion: 99, habits: [] }),
      push: async () => {
        throw new Error("must not push");
      },
    }),
    (e) => e.code === "REMOTE_NEWER",
  );
  assert.equal(store.get("habitflow_data"), before);
});

await test("isValidSyncUrl: https or localhost only", () => {
  assert.ok(S.isValidSyncUrl("https://example.com/sync"));
  assert.ok(S.isValidSyncUrl("http://localhost:8787/sync"));
  assert.ok(!S.isValidSyncUrl("http://example.com/sync"));
  assert.ok(!S.isValidSyncUrl("not a url"));
});

console.log("REST adapter against the reference server");
const dir = path.dirname(fileURLToPath(import.meta.url));
const port = 18000 + Math.floor(Math.random() * 1000);
const server = spawn("node", [path.join(dir, "../server/sync-server.js")], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: path.join("/tmp", "hf-sync-" + port),
  },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) => server.stdout.once("data", r));
const url = `http://localhost:${port}/sync`;
try {
  await test("404 → null, PUT then GET round-trips, wrong token is isolated", async () => {
    const a = S.createRestAdapter({ url, token: "token-aaaaaaaa" });
    assert.equal(await a.pull(), null);
    await a.push({
      schemaVersion: 2,
      habits: [{ id: "1", name: "Over HTTP" }],
      deleted: {},
    });
    assert.equal((await a.pull()).habits[0].name, "Over HTTP");
    assert.equal(
      await S.createRestAdapter({ url, token: "token-bbbbbbbb" }).pull(),
      null,
    );
  });
  await test("missing/short token → AUTH error", async () => {
    await assert.rejects(
      S.createRestAdapter({ url, token: "" }).pull(),
      (e) => e.code === "AUTH",
    );
  });
  await test("invalid document rejected by server", async () => {
    const r = await fetch(url, {
      method: "PUT",
      headers: { Authorization: "Bearer token-aaaaaaaa" },
      body: "{}",
    });
    assert.equal(r.status, 400);
  });
  await test("full syncNow through HTTP", async () => {
    const adapter = S.createRestAdapter({ url, token: "token-cccccccc" });
    await S.syncNow(adapter);
    const remote = await adapter.pull();
    assert.equal(remote.habits.length, loadData().habits.length);
    assert.equal(remote.schemaVersion, CURRENT_SCHEMA_VERSION);
  });
} finally {
  server.kill();
}

console.log(`\n${passed} tests passed`);
