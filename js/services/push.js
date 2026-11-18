import { app } from "../firebase-client.js";

import {
  getMessaging,
  getToken,
  isSupported
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging.js";

const VAPID_PUBLIC_KEY =
  "BBrZ93QihODB8sGzBHisf6_gN9ENkFd3Lvm-EmS80iLs32P4t5xvMBwGH4YmC0h9D3rIfZ_QY3Rllo5N1bfk2m4";

export async function registerPushToken() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker is not supported.");
  }

  if (!(await isSupported())) {
    throw new Error("Firebase Messaging is not supported.");
  }

  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);

  const token = await getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration
  });

  if (!token) {
    throw new Error("Could not obtain FCM token.");
  }

  return token;
}
