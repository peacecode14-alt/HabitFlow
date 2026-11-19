import { db } from "../firebase-client.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// Stay safely below Firestore's 1,048,576-byte document limit (multi-byte text and field names add overhead).
const MAX_PAYLOAD_CHARS = 900_000;

/** Firestore stores one sync document per authenticated Firebase user. */
export function createFirestoreAdapter(uid) {
  if (!uid || typeof uid !== "string")
    throw new Error("A signed-in Firebase user is required.");
  const stateRef = doc(db, "users", uid, "sync", "state");

  return {
    name: "firestore",
    async pull() {
      const snapshot = await getDoc(stateRef);
      if (!snapshot.exists()) return null;
      const record = snapshot.data();
      if (!record || !Object.prototype.hasOwnProperty.call(record, "payload")) {
        const error = new Error(
          "The cloud sync document has an invalid format.",
        );
        error.code = "BAD_REMOTE";
        throw error;
      }
      return record.payload;
    },
    async push(payload) {
      // A single Firestore document is capped at 1 MiB; fail early with a clear, translatable error.
      if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) {
        const error = new Error(
          "The cloud copy would exceed Firestore's 1 MiB document limit.",
        );
        error.code = "TOO_LARGE";
        throw error;
      }
      await setDoc(stateRef, {
        payload,
        updatedAt: serverTimestamp(),
      });
    },
    async remove() {
      await deleteDoc(stateRef);
    },
    listen(onChange, onError) {
      return onSnapshot(
        stateRef,
        () => onChange(),
        (error) => {
          if (onError) onError(error);
        },
      );
    },
  };
}
