// Global base initializations extracted from base.j2.html
(function () {
  "use strict";

  // Fallback toast shim to avoid runtime errors if utils.js didn't load yet
  try {
    if (typeof window.showToast !== "function") {
      window.showToast = function (message, level) {
        try {
          var tag =
            level === "error" ? "error" : level === "warning" ? "warn" : "log";
          console[tag]("[toast]", message);
        } catch (__) {}
      };
    }
  } catch (__) {}

  // Suppress native context menu; allow page-level custom menus
  document.addEventListener(
    "contextmenu",
    function (e) {
      e.preventDefault();
      var inBsModal = !!(
        e.target &&
        e.target.closest &&
        e.target.closest(".modal.show")
      );
      var inOverlay = !!(
        e.target &&
        e.target.closest &&
        e.target.closest(".overlay-container")
      );
      if (inBsModal || inOverlay) {
        e.stopPropagation();
        return;
      }
    },
    { capture: true }
  );

  // Bootstrap tooltip init
  function initTooltips() {
    try {
      var elms = [].slice.call(
        document.querySelectorAll('[data-bs-toggle="tooltip"]')
      );
      elms.forEach(function (el) {
        new bootstrap.Tooltip(el, { container: "body" });
      });
    } catch (_) {}
  }

  // Initialize tooltips immediately if DOM is ready
  initTooltips();

  // Also initialize on DOMContentLoaded if not ready yet
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTooltips);
  }

  // Global Enter handler within modals/overlays
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)
        return;
      var tgt = e.target;
      if (tgt && tgt.tagName === "TEXTAREA") return;
      var openModal = document.querySelector(
        '.modal.show, .overlay-container:target, .overlay-container[style*="display: block"], .overlay-container.active'
      );
      if (!openModal) return;
      var defBtn = openModal.querySelector('[data-enter="default"]');
      if (!defBtn)
        defBtn = openModal.querySelector(
          ".modal-footer .btn-primary, .popup__actions .btn-primary"
        );
      if (!defBtn) return;
      e.preventDefault();
      defBtn.click();
    },
    true
  );

  // Push consent modal logic (show once after login)
  (function () {
    function cleanupModalArtifacts() {
      try {
        var backs = document.querySelectorAll(".modal-backdrop");
        backs &&
          backs.forEach &&
          backs.forEach(function (b) {
            if (b && b.parentElement) b.parentElement.removeChild(b);
          });
      } catch (__) {}
      try {
        document.body &&
          document.body.classList &&
          document.body.classList.remove("modal-open");
      } catch (__) {}
      try {
        if (document && document.body && document.body.style) {
          document.body.style.removeProperty("padding-right");
          document.body.style.removeProperty("overflow");
        }
      } catch (__) {}
    }
    function getCookie(name) {
      var v = document.cookie.split("; ").find(function (row) {
        return row.startsWith(name + "=");
      });
      return v ? decodeURIComponent(v.split("=")[1]) : null;
    }
    function delCookie(name) {
      document.cookie = name + "=; Max-Age=0; path=/; samesite=Lax";
    }
    function shouldAsk() {
      if (!("Notification" in window)) return false;
      if (Notification.permission !== "default") return false;
      return getCookie("just_logged_in") === "1";
    }
    function showModal() {
      var el = document.getElementById("pushConsentModal");
      if (!el) return;
      var m = new bootstrap.Modal(el);
      el.addEventListener("hidden.bs.modal", function () {
        delCookie("just_logged_in");
        try {
          var inst = bootstrap.Modal.getInstance(el);
          if (inst && inst.dispose) inst.dispose();
        } catch (__) {}
        // Remove any lingering backdrops/body classes to re-enable page interaction
        cleanupModalArtifacts();
      });
      var btn = document.getElementById("btnAllowPush");
      if (btn) {
        btn.onclick = function () {
          try {
            if (
              "Notification" in window &&
              typeof Notification.requestPermission === "function"
            ) {
              // Request browser permission inside the user gesture
              var req = null;
              try {
                req = Notification.requestPermission();
              } catch (__) {}
              // Promise-based (modern browsers)
              if (req && typeof req.then === "function") {
                req
                  .then(function (perm) {
                    try {
                      if (perm === "granted" && window.pushInit) {
                        window.pushInit({ silent: true });
                      }
                    } catch (__) {}
                  })
                  .finally(function () {
                    try {
                      m.hide();
                    } catch (__) {}
                    setTimeout(function () {
                      try {
                        cleanupModalArtifacts();
                      } catch (__) {}
                    }, 60);
                  });
                return;
              }
              // Callback-based fallback
              try {
                Notification.requestPermission(function (perm) {
                  try {
                    if (perm === "granted" && window.pushInit) {
                      window.pushInit({ silent: true });
                    }
                  } catch (__) {}
                  try {
                    m.hide();
                  } catch (__) {}
                  setTimeout(function () {
                    try {
                      cleanupModalArtifacts();
                    } catch (__) {}
                  }, 60);
                });
                return;
              } catch (__) {}
            }
          } catch (__) {}
          // Fallback: just try to init silently if permission was pre-granted
          try {
            window.pushInit && window.pushInit({ silent: true });
          } catch (__) {}
          try {
            m.hide();
          } catch (__) {}
          // Extra cleanup shortly after hide to cover animation timing
          setTimeout(function () {
            try {
              cleanupModalArtifacts();
            } catch (__) {}
          }, 60);
        };
      }
      m.show();
    }
    if (shouldAsk()) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showModal);
      } else {
        showModal();
      }
    } else {
      delCookie("just_logged_in");
    }
  })();

  // Auto-initialize push if permission granted
  (function () {
    async function ensurePushFresh() {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window))
          return;
        if (
          !("Notification" in window) ||
          Notification.permission !== "granted"
        )
          return;
        // Ensure SW is registered so .ready resolves even after hard reloads
        try {
          const reg0 = await navigator.serviceWorker.getRegistration();
          if (!reg0) {
            await navigator.serviceWorker.register("/sw.js", { scope: "/" });
          }
        } catch (__) {}
        const reg = await navigator.serviceWorker.ready;
        if (!reg || !reg.pushManager) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // Refresh subscription on server if changed or once per day
          try {
            var keys = (sub && sub.toJSON && sub.toJSON().keys) || {};
            var fp = [
              sub.endpoint || "",
              keys.p256dh || "",
              keys.auth || "",
            ].join("|");
            var lastFp = null;
            var lastAt = 0;
            try {
              lastFp = localStorage.getItem("push.last.sent") || null;
              lastAt =
                parseInt(localStorage.getItem("push.last.at") || "0", 10) || 0;
            } catch (__) {}
            var now = Date.now();
            var shouldSend =
              fp !== lastFp || now - lastAt > 24 * 60 * 60 * 1000;
            if (shouldSend) {
              await fetch("/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(sub),
              });
              try {
                localStorage.setItem("push.last.sent", fp);
                localStorage.setItem("push.last.at", String(now));
              } catch (__) {}
            }
          } catch (__) {}
        } else {
          // No subscription: initialize silently
          try {
            window.pushInit && window.pushInit({ silent: true });
          } catch (__) {}
        }
      } catch (__) {}
    }

    function tryInit() {
      if (!("Notification" in window)) return;
      if (Notification.permission === "granted") {
        window.pushInit && window.pushInit({ silent: true });
        // Also ensure current subscription is saved on server
        try {
          ensurePushFresh();
        } catch (__) {}
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        if (window.requestIdleCallback) {
          window.requestIdleCallback(
            () => {
              setTimeout(() => {
                tryInit();
                setTimeout(() => {
                  ensurePushFresh();
                }, 0);
              }, 0);
            },
            { timeout: 1000 }
          );
        } else {
          setTimeout(() => {
            setTimeout(() => {
              tryInit();
              setTimeout(() => {
                ensurePushFresh();
              }, 0);
            }, 0);
          }, 0);
        }
      });
    } else {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(
          () => {
            setTimeout(() => {
              tryInit();
              setTimeout(() => {
                ensurePushFresh();
              }, 0);
            }, 0);
          },
          { timeout: 1000 }
        );
      } else {
        setTimeout(() => {
          setTimeout(() => {
            tryInit();
            setTimeout(() => {
              ensurePushFresh();
            }, 0);
          }, 0);
        }, 0);
      }
    }

    // Periodic background refresh to keep subscriptions updated for all users
    try {
      setTimeout(() => {
        if (window.BackgroundActivityManager) {
          window.BackgroundActivityManager.register(
            "base-subscription-refresh",
            {
              start: () => {
                try {
                  // Only refresh while page is visible to avoid unnecessary work
                  if (
                    typeof document !== "undefined" &&
                    document.visibilityState === "visible"
                  ) {
                    ensurePushFresh();
                  }
                } catch (__) {}
              },
              stop: () => {
                // No specific stop action needed
              },
              interval: 30 * 60 * 1000, // every 30 minutes
              autoStart: true,
            }
          );
        } else {
          // Fallback to direct interval
          setInterval(function () {
            try {
              // Only refresh while page is visible to avoid unnecessary work
              if (
                typeof document !== "undefined" &&
                document.visibilityState === "visible"
              ) {
                ensurePushFresh();
              }
            } catch (__) {}
          }, 30 * 60 * 1000); // every 30 minutes
        }
      }, 0);
    } catch (__) {}

    // Refresh on tab visibility gain
    try {
      setTimeout(() => {
        document.addEventListener("visibilitychange", function () {
          try {
            if (document.visibilityState === "visible") ensurePushFresh();
          } catch (__) {}
        });
      }, 0);
    } catch (__) {}
  })();
})();
