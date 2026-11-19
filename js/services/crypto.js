/**
 * End-to-end encryption for cloud sync (optional).
 * AES-256-GCM, key derived from the user's passphrase with PBKDF2-SHA256.
 * The server only ever sees the encrypted envelope.
 */
const ITERATIONS = 250000;
const MAX_ITERATIONS = 1000000;
const enc = new TextEncoder(),
  dec = new TextDecoder();

const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const isEncrypted = (doc) =>
  Boolean(doc) && doc.enc === 1 && typeof doc.data === "string";

export async function encryptJSON(value, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(value)),
    ),
  );
  return {
    enc: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iter: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  };
}

export async function decryptJSON(envelope, passphrase) {
  const iterations = Number(envelope.iter);
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS
  )
    throw new Error("Invalid encryption parameters");
  const key = await deriveKey(passphrase, fromB64(envelope.salt), iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(envelope.iv) },
    key,
    fromB64(envelope.data),
  );
  return JSON.parse(dec.decode(plain));
}
