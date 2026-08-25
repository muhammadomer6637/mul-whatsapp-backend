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

// Push Notifications - payload is a JSON string {title, body, url} sent
// by the server via web-push. Falls back to a generic notification if the
// payload is missing/unparseable rather than silently doing nothing.
self.addEventListener("push", (event) => {
  let data = { title: "MUL Nexus", body: "You have a new update.", url: "/" };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    // Non-JSON payload - keep the generic fallback above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" }
    })
  );
});

// Clicking the notification focuses an already-open tab on the same
// origin if one exists, otherwise opens a new one - avoids piling up
// duplicate tabs every time an agent taps a notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
