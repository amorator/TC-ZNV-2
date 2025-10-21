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
      } catch (e) {
        /* ignore */
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
          console.error("Fetch failed:", error);
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

self.addEventListener("push", (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || "Сообщение";
    const body = data.body || "";
    const icon = data.icon || "/static/images/notification-icon.png";
    const options = {
      body,
      icon,
      data,
      requireInteraction: true,
      renotify: true,
      // Use unique tag to avoid OS collapsing notifications silently
      tag:
        data && (data.tag || data.id)
          ? String(data.tag || data.id)
          : String(Date.now()),
      // badge is optional; ignore if missing
      badge: (data && data.badge) || undefined,
      vibrate: [80, 40, 80],
    };
    event.waitUntil(
      (async () => {
        try {
          // Debug trace to detect whether SW receives the push
          if (typeof console !== "undefined" && console.debug) {
            console.debug("[sw] push received", { title, data });
          }
        } catch (_) {}
        try {
          await self.registration.showNotification(title, options);
        } catch (e) {
          // Fallback minimal notification
          try {
            await self.registration.showNotification(title, { body });
          } catch (_) {}
        }
        // Report delivery for diagnostics (best-effort)
        try {
          await fetch("/push/delivered", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, body }),
          });
        } catch (_) {}
      })()
    );
  } catch (e) {
    // Fallback for non-JSON payloads
    const text = event.data ? event.data.text() : "";
    event.waitUntil(
      self.registration.showNotification("Сообщение", { body: text })
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification &&
      event.notification.data &&
      event.notification.data.url) ||
    "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

// Auto-recover push subscription if the browser rotates/invalidates it
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Helper: base64url -> Uint8Array
        function b64urlToUint8Array(b64) {
          try {
            b64 = String(b64 || "")
              .replace(/-/g, "+")
              .replace(/_/g, "/");
            const pad = "=".repeat((4 - (b64.length % 4)) % 4);
            const raw = atob(b64 + pad);
            const out = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
            return out;
          } catch (_) {
            return new Uint8Array();
          }
        }

        const reg = await self.registration;
        // Fetch current VAPID public key
        const resp = await fetch("/push/vapid_public", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await resp.json().catch(() => null);
        const publicKey = data && data.publicKey ? data.publicKey : "";
        if (!publicKey || !reg || !reg.pushManager) return;
        // Re-subscribe and notify server
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64urlToUint8Array(publicKey),
        });
        try {
          await fetch("/push/subscribe", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub),
          });
        } catch (_) {}
      } catch (_) {}
    })()
  );
});
