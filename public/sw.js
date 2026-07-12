const CACHE_NAME = "mul-nexus-shell-v1";

const SHELL_FILES = [
  "/icon-192.png",
  "/icon-512.png",
  "/manifest-live.json",
  "/manifest-admin.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Network-first for everything - app code (JS/HTML/CSS) must always be the
// latest version when online. Cache is only a fallback for when the
// network request fails (offline / flaky connection), never used to skip
// a fresh fetch. This deliberately avoids agents getting stuck on an old
// cached version of admin.js/live.js after a deploy.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
