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
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
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
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown");
            }
          }
        }
      }, 200);
    }

    function isSocketConnected() {
      try {
        return !!(sock && sock.connected);
      } catch (_) {
        return false;
      }
    }

    function emitPresence() {
      if (forced || left) return;
      // Refresh socket reference in case SyncManager recreated it
      try {
        var cur = getSock();
        if (cur && cur !== sock) {
          sock = cur;
          bindSocketHandlers();
        }
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
      if (!isSocketConnected()) return; // pause when main socket is down
      try {
        sock.emit("presence:update", {
          page: location.pathname + location.search + location.hash,
        });
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
    }

    function sendLeave() {
      if (left) return;
      left = true;
      try {
        // try latest socket
        var s = getSock() || sock;
        s && s.emit && s.emit("presence:leave");
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
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
                } catch (err) {
                  window.ErrorHandler.handleError(err, "unknown");
                }
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
            }).catch(function (err) {
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "unknown");
              } else window.ErrorHandler.handleError(err, "unknown")
            });
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
        })();
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
    }

    function bindSocketHandlers() {
      try {
        if (!sock || !sock.on) return;
        if (sock.__presenceBound) return;
        sock.__presenceBound = true;
        sock.on("connect", function () {
          emitPresence();
        });
        // Support admin-force logout for every open session
        sock.on("force-logout", function () {
          try {
            forced = true;
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
          try {
            if (presenceTimer) clearInterval(presenceTimer);
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
          try {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
          try {
            sock && sock.disconnect && sock.disconnect();
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
          try {
            location.replace("/logout");
          } catch (err) {
            window.ErrorHandler.handleError(err, "unknown");
          }
        });
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
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
    // Используем оптимизированный мониторинг присутствия
    if (window.SocketOptimizer) {
      presenceTimer =
        window.SocketOptimizer.createPresenceMonitor(emitPresence);
    } else {
      presenceTimer = setInterval(emitPresence, 3000);
    }

    // HTTP heartbeat for idle tabs (covers cases when socket events are throttled)
    function httpHeartbeat() {
      if (forced) return;
      // Refresh socket reference; if not connected, skip
      try {
        var cur = getSock();
        if (cur && cur !== sock) {
          sock = cur;
          bindSocketHandlers();
        }
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
      // Do not send background HTTP heartbeat if socket is disconnected
      if (!isSocketConnected()) return;
      // Reduce noisy errors when tab is hidden or offline
      try {
        if (document.visibilityState !== "visible") return;
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
      try {
        if (
          typeof navigator !== "undefined" &&
          navigator &&
          navigator.onLine === false
        )
          return;
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
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
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown");
            }
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
                } catch (err) {
                  window.ErrorHandler.handleError(err, "unknown");
                }
                try {
                  if (heartbeatTimer) clearInterval(heartbeatTimer);
                } catch (err) {
                  window.ErrorHandler.handleError(err, "unknown");
                }
                try {
                  sock && sock.disconnect && sock.disconnect();
                } catch (err) {
                  window.ErrorHandler.handleError(err, "unknown");
                }
                location.replace("/logout");
              }
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown");
            }
          })
          .catch(function (err) {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "unknown");
            } else window.ErrorHandler.handleError(err, "unknown")
          });
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
    }
    // Используем оптимизированный heartbeat
    if (window.SocketOptimizer) {
      heartbeatTimer =
        window.SocketOptimizer.createHeartbeatMonitor(httpHeartbeat);
    } else {
      heartbeatTimer = setInterval(httpHeartbeat, 3000);
    }

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
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown");
            }
          },
          { capture: true }
        );
      });
    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }

    // Best-effort leave on unload
    window.addEventListener("beforeunload", function () {
      try {
        sendLeave();
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
    });

    // Initial
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", emitPresence);
    } else {
      emitPresence();
    }

    // Also react to SyncManager resume hook if available
    try {
      if (
        window.SyncManager &&
        typeof window.SyncManager.onResume === "function"
      ) {
        window.SyncManager.onResume(function () {
          emitPresence();
        });
      }
    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
})();
