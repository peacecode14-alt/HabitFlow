// Simulates two independent browser localStorage instances sharing one cloud document.
import assert from "node:assert/strict";

const makeStorage = (seed = new Map()) => new Proxy({
  getItem: key => seed.has(key) ? seed.get(key) : null,
  setItem: (key, value) => void seed.set(key, String(value)),
  removeItem: key => void seed.delete(key),
  key: index => [...seed.keys()][index] ?? null,
  get length() { return seed.size; }
}, {
  ownKeys: () => [...seed.keys()],
  getOwnPropertyDescriptor: (target, key) => seed.has(key)
    ? { enumerable: true, configurable: true, value: seed.get(key) }
    : Reflect.getOwnPropertyDescriptor(target, key)
});

const makeDevice = (id, habitName, updatedAt) => {
  const store = new Map();
  store.set("habitflow_data", JSON.stringify({
    schemaVersion: 3,
    habits: [{
      id, name: habitName, category: "Learning", icon: "📘", color: "#22D3EE",
      frequency: [0, 1, 2, 3, 4, 5, 6], type: "check", target: 1,
      createdAt: updatedAt, updatedAt, archivedAt: null, reminderTime: "",
      log: {}, completions: []
    }],
    deleted: {}, settings: { language: "en", theme: "dark" },
    meta: { deviceId: `device-${id}`, updatedAt, lastSyncedAt: null }
  }));
  return { store, storage: makeStorage(store) };
};

const deviceA = makeDevice("habit-a", "Read on device A", "2026-11-01T10:00:00.000Z");
const deviceB = makeDevice("habit-b", "Walk on device B", "2026-11-02T10:00:00.000Z");
let activeStorage = deviceA.storage;
Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => activeStorage });

const { syncNow } = await import("../js/services/sync.js");
let cloud = null;
let cloudWrites = 0;
const sharedCloud = {
  async pull() { return cloud; },
  async push(payload) { cloud = structuredClone(payload); cloudWrites++; }
};

// Device A creates its first cloud copy.
await syncNow(sharedCloud);
assert.deepEqual(cloud.habits.map(h => h.id), ["habit-a"]);

// Device B starts with its own local habit, pulls A, merges, then uploads both.
activeStorage = deviceB.storage;
await syncNow(sharedCloud);
assert.deepEqual(cloud.habits.map(h => h.id).sort(), ["habit-a", "habit-b"]);
assert.deepEqual(JSON.parse(deviceB.store.get("habitflow_data")).habits.map(h => h.id).sort(), ["habit-a", "habit-b"]);

// Device A returns later and receives B's habit without losing its own.
activeStorage = deviceA.storage;
await syncNow(sharedCloud);
assert.deepEqual(JSON.parse(deviceA.store.get("habitflow_data")).habits.map(h => h.id).sort(), ["habit-a", "habit-b"]);
assert.deepEqual(cloud.habits.map(h => h.id).sort(), ["habit-a", "habit-b"]);

console.log("  ✓ two independent devices merge local habits through one shared cloud document");
console.log(`\nMulti-device sync: passed (cloud writes: ${cloudWrites})`);
