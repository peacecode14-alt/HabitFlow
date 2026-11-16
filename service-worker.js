const CACHE_PREFIX = "habitflow-";
const CACHE_NAME = `${CACHE_PREFIX}v5`;

// Keep this list limited to files that are present in the repository.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./css/dashboard.css",
  "./css/responsive.css",
  "./js/app.js",
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
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Sync requests must always reach the network and never be cached.
  if (request.cache === "no-store" || request.headers.has("Authorization"))
    return;

  const requestURL = new URL(request.url);
  if (requestURL.origin !== self.location.origin) return;

  // Do not intercept requests outside this Service Worker's scope.
  const scopeURL = new URL(self.registration.scope);
  if (!requestURL.href.startsWith(scopeURL.href)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match("./index.html");
          return cachedPage || Response.error();
        }),
    );
    return;
  }

  // App-shell assets use cache-first. New releases get a new CACHE_NAME.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// Clicking a reminder notification brings the app to the front.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) =>
        clients.length ? clients[0].focus() : self.clients.openWindow("./"),
      ),
  );
});
