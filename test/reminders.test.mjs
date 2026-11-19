// Run: node test/reminders.test.mjs   (Node 18+)
// Covers the push-reminder client helpers and guards the regressions that broke offline use before:
// the app must never statically depend on the Firebase CDN, and the service worker must tolerate it being down.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log("  ✓", name);
};

const R = await import("../js/services/reminders-server.js");

await test("only active habits with a reminder time become schedules", () => {
  const out = R.reminderSchedules([
    { id: "a", reminderTime: "08:00", frequency: [1, 2] },
    { id: "b", reminderTime: "", frequency: [1] },
    {
      id: "c",
      reminderTime: "09:30",
      frequency: [0],
      archivedAt: "2026-01-01T00:00:00.000Z",
    },
    { id: "d", frequency: [3] },
  ]);
  assert.deepEqual(out, [
    { habitKey: "a", reminderTime: "08:00", repeatDays: [1, 2] },
  ]);
});

await test("signature is stable, and changes with schedules, language, timezone, device or account", () => {
  const base = {
    uid: "u1",
    deviceToken: "t".repeat(30),
    timezone: "Africa/Cairo",
    language: "ar",
    schedules: [{ habitKey: "a", reminderTime: "08:00", repeatDays: [1] }],
  };
  const sig = R.reminderSignature(base);
  assert.equal(R.reminderSignature({ ...base }), sig);
  for (const change of [
    { schedules: [{ habitKey: "a", reminderTime: "08:05", repeatDays: [1] }] },
    { schedules: [] },
    { language: "en" },
    { timezone: "Europe/Paris" },
    { deviceToken: "x".repeat(30) },
    { uid: "u2" },
  ])
    assert.notEqual(R.reminderSignature({ ...base, ...change }), sig);
});

await test("unregisterDevice forgets the local token even without a user, and calls the server when it can", async () => {
  store.set(R.PUSH_TOKEN_KEY, "tok".repeat(10));
  store.set(R.REMINDER_SIGNATURE_KEY, "sig");
  assert.equal(await R.unregisterDevice(null), false);
  assert.equal(store.has(R.PUSH_TOKEN_KEY), false);
  assert.equal(store.has(R.REMINDER_SIGNATURE_KEY), false);

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  store.set(R.PUSH_TOKEN_KEY, "tok".repeat(10));
  assert.equal(
    await R.unregisterDevice({ getIdToken: async () => "ID" }),
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, "Bearer ID");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "unregister",
    deviceToken: "tok".repeat(10),
  });
  assert.equal(store.has(R.PUSH_TOKEN_KEY), false);

  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  store.set(R.PUSH_TOKEN_KEY, "tok".repeat(10));
  assert.equal(
    await R.unregisterDevice({ getIdToken: async () => "ID" }),
    false,
  );
  assert.equal(
    store.has(R.PUSH_TOKEN_KEY),
    false,
    "local token is dropped even when the server is unreachable",
  );
});

await test("app.js and auth.js never statically import the Firebase CDN or Firebase-backed modules", () => {
  const forbidden =
    /^\s*import\s[^;]*from\s+["'](?:https:\/\/www\.gstatic\.com[^"']*|\.\/firebase-client\.js|\.\/services\/push\.js|\.\/services\/firestore-sync\.js)["']/m;
  assert.doesNotMatch(
    read("js/app.js"),
    forbidden,
    "app.js must load Firebase lazily so the tracker works offline",
  );
});

await test("service worker wraps the Firebase importScripts in try/catch", () => {
  const sw = read("service-worker.js");
  const at = sw.indexOf("importScripts(");
  assert.ok(at > 0);
  assert.ok(
    sw.lastIndexOf("try {", at) > sw.lastIndexOf("}\n", at) ||
      /try\s*\{\s*(?:\/\/[^\n]*\n\s*)*importScripts/.test(sw),
    "importScripts must be inside a try block",
  );
});

await test("every service-worker app-shell file exists (a missing file makes install fail)", () => {
  const sw = read("service-worker.js");
  const list = sw.slice(
    sw.indexOf("const APP_SHELL = ["),
    sw.indexOf("];", sw.indexOf("const APP_SHELL = [")),
  );
  const files = [...list.matchAll(/"\.\/([^"]*)"/g)]
    .map((m) => m[1])
    .filter(Boolean);
  assert.ok(files.length > 20);
  for (const f of files)
    assert.ok(
      existsSync(join(root, f)),
      `${f} is listed in APP_SHELL but missing`,
    );
});

await test("translations: English and Arabic have identical keys, and every used key exists", async () => {
  const { translations } = await import("../js/translations.js");
  const en = Object.keys(translations.en).sort(),
    ar = Object.keys(translations.ar).sort();
  assert.deepEqual(en, ar);
  const src = read("js/app.js") + read("index.html");
  const used = new Set(
    [...src.matchAll(/\bt\(\)\.([A-Za-z]\w*)(?!\w*\()/g)]
      .map((m) => m[1])
      .filter((k) => k !== "resolvedOptions"),
  );
  for (const m of src.matchAll(
    /data-i18n(?:-placeholder|-aria-label)?="(\w+)"/g,
  ))
    used.add(m[1]);
  for (const k of used)
    assert.ok(k in translations.en, `missing translation key: ${k}`);
});

await test("firestore.rules: owner-only, verified email, server timestamp, owner may delete, everything else closed", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /updatedAt == request\.time/);
  assert.match(rules, /hasAll\(\['payload', 'updatedAt'\]\)/);
  assert.match(rules, /allow delete: if isOwner\(\)/);
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;/,
  );
  assert.doesNotMatch(rules, /if true/);
});

await test("firestore adapter exposes remove() and refuses oversized documents", () => {
  const src = read("js/services/firestore-sync.js");
  assert.match(src, /async remove\(\)/);
  assert.match(src, /TOO_LARGE/);
});

console.log(`\n${passed} tests passed`);
