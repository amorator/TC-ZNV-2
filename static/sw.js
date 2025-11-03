self.addEventListener("install", (event) => {
  // Activate updated SW immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of uncontrolled clients as soon as SW activates
  event.waitUntil(self.clients.claim());
});
// Service Worker for aggressive caching of static assets
const CACHE_NAME = "znf-static-v1";
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
        await self.clients.claim();
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
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Push notification handlers removed (deprecated)
