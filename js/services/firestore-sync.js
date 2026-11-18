import { db } from "../firebase-client.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

/** Firestore stores one sync document per authenticated Firebase user. */
export function createFirestoreAdapter(uid) {
  if (!uid || typeof uid !== "string") throw new Error("A signed-in Firebase user is required.");
  const stateRef = doc(db, "users", uid, "sync", "state");

  return {
    name: "firestore",
    async pull() {
      const snapshot = await getDoc(stateRef);
      if (!snapshot.exists()) return null;
      const record = snapshot.data();
      if (!record || !Object.prototype.hasOwnProperty.call(record, "payload")) {
        const error = new Error("The cloud sync document has an invalid format.");
        error.code = "BAD_REMOTE";
        throw error;
      }
      return record.payload;
    },
    async push(payload) {
      await setDoc(stateRef, {
        payload,
        updatedAt: serverTimestamp()
      });
    },
    listen(onChange, onError) {
      return onSnapshot(
        stateRef,
        () => onChange(),
        error => {
          if (onError) onError(error);
        }
      );
    }
  };
}
