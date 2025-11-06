self.addEventListener("install", (event) => {
  // Activate updated SW immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of uncontrolled clients as soon as SW activates
  event.waitUntil(self.clients.claim());
});
// Service Worker for aggressive caching of static assets
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'znf-static-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const STATIC_CACHE_URLS = [
  "/static/js/record.js",
  "/static/js/scripts.js",
  "/static/js/scripts/modal-manager.js",
  "/static/js/files.js",
  "/static/js/users.js",
  "/static/js/groups.js",
  "/static/js/scripts/context-menu.js",
  "/static/css/pages/record.css",
  "/static/css/core/app.css",
  "/static/css/core/base.css",
  "/static/css/core/themes.css",
  "/static/css/components/context-menu.css",
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Claim clients so the new SW controls pages immediately
        await self.clients.claim();
        // Remove old versioned caches
        const keys = await caches.keys();
        const deletions = keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k));
        await Promise.allSettled(deletions);
      } catch (err) {
        // silent
      }
    })()
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  // Only handle GET requests for static files
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // Only cache static files
  if (!url.pathname.startsWith("/static/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      // If not in cache, fetch from network
      return fetch(event.request)
        .then((response) => {
          // Don't cache if not a valid response
          if (
            !response ||
            response.status !== 200 ||
            response.type !== "basic"
          ) {
            return response;
          }

          // Clone the response for caching
          const responseToCache = response.clone();

          // Cache the response for future use
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch((error) => {
          // Return a fallback response if available
          return caches.match("/static/js/record.js");
        });
    })
  );
});

// Handle messages from the main thread
self.addEventListener("message", (event) => {
  try {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === "SKIP_WAITING") {
      self.skipWaiting();
      return;
    }
    if (data.type === 'SHOW_NOTIFICATION') {
      const title = String(data.title || 'Уведомление');
      const options = Object.assign({
        body: String(data.body || ''),
        icon: String(data.icon || '/static/icons/notification_menu.png'),
        badge: String(data.badge || '/static/icons/notification_menu.png'),
        tag: String(data.tag || 'znf'),
        renotify: data.renotify === true,
        requireInteraction: !!data.requireInteraction,
        data: { url: String(data.url || '/') }
      }, data.options || {});
      event.waitUntil(self.registration.showNotification(title, options));
    }
  } catch (_) {}
});

// Focus tab on notification click
self.addEventListener('notificationclick', function (event) {
  try { event.notification && event.notification.close && event.notification.close(); } catch(_) {}
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    try {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try {
          if (client.url && client.url.indexOf(url) !== -1) {
            client.focus && client.focus();
            return;
          }
        } catch (_) {}
      }
      await self.clients.openWindow(url);
    } catch (_) {}
  })());
});

// Push notification handlers removed (deprecated)
