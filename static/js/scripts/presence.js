(function () {
  "use strict";
  if (!window.io) return;
  try {
    var forced = false; // stop emission after forced logout
    var presenceTimer = null;
    var heartbeatTimer = null;
    var left = false; // prevent duplicate leave signals
    // Use SyncManager socket to avoid multiple connections
    function getSock() {
      try {
        if (
          window.SyncManager &&
          typeof window.SyncManager.getSocket === "function"
        ) {
          return window.SyncManager.getSocket();
        }
      } catch (_) {}
      return null;
    }
    var sock = getSock();
    if (!sock) {
      // Retry a few times until SyncManager initializes
      var attempts = 0;
      var waitTimer = setInterval(function () {
        attempts++;
        try {
          sock = getSock();
        } catch (_) {
          sock = null;
        }
        if (sock || attempts > 50) {
          clearInterval(waitTimer);
          if (sock) {
            try {
              bindSocketHandlers();
            } catch (_) {}
          }
        }
      }, 200);
    }

    function emitPresence() {
      if (forced || left) return;
      try {
        sock.emit("presence:update", {
          page: location.pathname + location.search + location.hash,
        });
      } catch (_) {}
    }

    function sendLeave() {
      if (left) return;
      left = true;
      try {
        sock.emit && sock.emit("presence:leave");
      } catch (_) {}
      try {
        var leaveUrl =
          (window.location && window.location.origin
            ? window.location.origin
            : "") + "/presence/leave";
        if (navigator.sendBeacon) {
          var data = new Blob(
            [
              JSON.stringify({
                page: location.pathname + location.search + location.hash,
              }),
            ],
            { type: "application/json" }
          );
          navigator.sendBeacon(leaveUrl, data);
        }
        // Fallback with short timeout and keepalive
        (function () {
          try {
            var ctrl =
              typeof AbortController !== "undefined"
                ? new AbortController()
                : null;
            if (ctrl)
              setTimeout(function () {
                try {
                  ctrl.abort();
                } catch (_) {}
              }, 2000);
            fetch(leaveUrl, {
              method: "POST",
              credentials: "same-origin",
              keepalive: true,
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                page: location.pathname + location.search + location.hash,
              }),
              signal: ctrl ? ctrl.signal : undefined,
            }).catch(function () {});
          } catch (_) {}
        })();
      } catch (_) {}
    }

    function bindSocketHandlers() {
      try {
        if (!sock || !sock.on) return;
        sock.on("connect", function () {
          emitPresence();
        });
        // Support admin-force logout for every open session
        sock.on("force-logout", function () {
          try {
            forced = true;
          } catch (_) {}
          try {
            if (presenceTimer) clearInterval(presenceTimer);
          } catch (_) {}
          try {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          } catch (_) {}
          try {
            sock && sock.disconnect && sock.disconnect();
          } catch (_) {}
          try {
            location.replace("/logout");
          } catch (_) {}
        });
      } catch (_) {}
    }

    if (sock) {
      bindSocketHandlers();
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") emitPresence();
    });
    window.addEventListener("focus", emitPresence);
    window.addEventListener("hashchange", emitPresence);
    window.addEventListener("popstate", emitPresence);
    presenceTimer = setInterval(emitPresence, 3000);

    // HTTP heartbeat for idle tabs (covers cases when socket events are throttled)
    function httpHeartbeat() {
      if (forced) return;
      // Reduce noisy errors when tab is hidden or offline
      try {
        if (document.visibilityState !== "visible") return;
      } catch (_) {}
      try {
        if (
          typeof navigator !== "undefined" &&
          navigator &&
          navigator.onLine === false
        )
          return;
      } catch (_) {}
      try {
        var hbUrl =
          (window.location && window.location.origin
            ? window.location.origin
            : "") + "/presence/heartbeat";
        var ctrl =
          typeof AbortController !== "undefined" ? new AbortController() : null;
        if (ctrl)
          setTimeout(function () {
            try {
              ctrl.abort();
            } catch (_) {}
          }, 5000);
        fetch(hbUrl, {
          method: "POST",
          credentials: "same-origin",
          // Keep the request alive across tab lifecycle events (Firefox-friendly)
          keepalive: true,
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: location.pathname + location.search + location.hash,
          }),
          signal: ctrl ? ctrl.signal : undefined,
        })
          .then(function (r) {
            try {
              if (r && (r.status === 401 || r.status === 403)) {
                forced = true;
                try {
                  if (presenceTimer) clearInterval(presenceTimer);
                } catch (_) {}
                try {
                  if (heartbeatTimer) clearInterval(heartbeatTimer);
                } catch (_) {}
                try {
                  sock && sock.disconnect && sock.disconnect();
                } catch (_) {}
                location.replace("/logout");
              }
            } catch (_) {}
          })
          .catch(function () {});
      } catch (_) {}
    }
    heartbeatTimer = setInterval(httpHeartbeat, 3000);

    // Best-effort leave on explicit logout click
    try {
      var logoutLinks = document.querySelectorAll(
        'a[href="/logout"], form[action="/logout"] button, #btnLogout'
      );
      logoutLinks.forEach(function (el) {
        el.addEventListener(
          "click",
          function () {
            try {
              sendLeave();
            } catch (_) {}
          },
          { capture: true }
        );
      });
    } catch (_) {}

    // Best-effort leave on unload
    window.addEventListener("beforeunload", function () {
      try {
        sendLeave();
      } catch (_) {}
    });

    // Initial
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", emitPresence);
    } else {
      emitPresence();
    }
  } catch (_) {}
})();
