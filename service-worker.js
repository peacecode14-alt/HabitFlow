const CACHE_PREFIX = "habitflow-";
const CACHE_NAME = `${CACHE_PREFIX}v13`;

// Firebase Cloud Messaging background support
importScripts(
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyAs6iYOHedal4YRBypuosZPWjLCzkScz1w",
  authDomain: "habitflow-aed6b.firebaseapp.com",
  projectId: "habitflow-aed6b",
  storageBucket: "habitflow-aed6b.firebasestorage.app",
  messagingSenderId: "884332517564",
  appId: "1:884332517564:web:5047b72b81748578e058b9"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.data?.title || "HabitFlow";
  const options = {
    body: payload.data?.body || "حان وقت عادتك",
    icon: "./assets/icons/icon-192.png",
    tag: payload.data?.tag || "habitflow-reminder",
    data: { url: "./" }
  };

  self.registration.showNotification(title, options);
});

// Keep this list limited to files that are present in the repository.
const APP_SHELL = [
  "./",
  "./index.html",
  "./auth.html",
  "./manifest.json",
  "./css/style.css",
  "./css/dashboard.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/firebase-client.js",
  "./js/config.js",
  "./js/habits.js",
  "./js/migrations.js",
  "./js/storage.js",
  "./js/templates.js",
  "./js/translations.js",
  "./js/services/backup.js",
  "./js/services/crypto.js",
  "./js/services/date.js",
  "./js/services/log.js",
  "./js/services/reminders.js",
  "./js/services/stats.js",
  "./js/services/sync.js",
  "./js/services/firestore-sync.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Sync requests must always reach the network and never be cached.
  if (request.cache === "no-store" || request.headers.has("Authorization")) return;

  const requestURL = new URL(request.url);
  if (requestURL.origin !== self.location.origin) return;

  // Do not intercept requests outside this Service Worker's scope.
  const scopeURL = new URL(self.registration.scope);
  if (!requestURL.href.startsWith(scopeURL.href)) return;

  if (request.mode === "navigate") {
    // Keep each page under its own key so visiting auth.html never replaces the cached dashboard.
    const cacheKey = requestURL.pathname.endsWith("/auth.html") ? "./auth.html" : "./index.html";
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(cacheKey)) || Response.error())
    );
    return;
  }

  // App-shell assets use cache-first. New releases get a new CACHE_NAME.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// Clicking a reminder notification brings the app to the front.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients =>
      clients.length ? clients[0].focus() : self.clients.openWindow("./")
    )
  );
});
