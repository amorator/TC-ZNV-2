(function () {
  "use strict";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Expose helper globally to avoid duplicate implementations elsewhere
  try {
    if (!window.urlBase64ToUint8Array) {
      window.urlBase64ToUint8Array = urlBase64ToUint8Array;
    }
  } catch (_) {}

  async function getVapidPublicKey(retries) {
    retries = typeof retries === "number" ? retries : 2;
    try {
      const url =
        (window.location && window.location.origin
          ? window.location.origin
          : "") + "/push/vapid_public";
      const ctrl =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctrl) {
        setTimeout(function () {
          try {
            ctrl.abort();
          } catch (_) {}
        }, 5000);
      }
      const resp = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== "success")
        throw new Error(data.message || "VAPID key error");
      return data.publicKey;
    } catch (e) {
      if (retries > 0) {
        await new Promise(function (r) {
          setTimeout(r, 500);
        });
        return getVapidPublicKey(retries - 1);
      }
      throw e;
    }
  }

  async function registerSW() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      return null;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function subscribe(reg, opts) {
    opts = opts || {};
    try {
      const publicKey = await getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(sub),
      });
      if (!opts.silent && window.showToast)
        showToast("Уведомления включены", "success");
    } catch (e) {
      if (!opts.silent && window.showToast)
        showToast("Не удалось включить уведомления", "error");
    }
  }

  async function init(opts) {
    opts = opts || {};
    try {
      const reg = await registerSW();
      if (!reg) return;
      const existing = await reg.pushManager.getSubscription();
      if (!existing) {
        await subscribe(reg, opts);
      }
      // Если разрешения отозваны — попытаться отписаться на сервере для чистоты
      try {
        if (
          "Notification" in window &&
          Notification.permission === "denied" &&
          existing
        ) {
          fetch("/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ endpoint: existing.endpoint }),
          }).catch(function () {});
        }
      } catch (__) {}
    } catch (e) {}
  }

  // Expose controlled initializer
  window.pushInit = init;

  // Listen for force logout broadcast from admin (reuse shared socket if present)
  try {
    if (window.io) {
      var sock = window.socket;
      if (!sock) {
        try {
          sock = window.io(window.location.origin, {
            transports: ["websocket", "polling"],
            path: "/socket.io",
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
          });
          window.socket = sock;
        } catch (__) {}
      }
      sock &&
        sock.on &&
        sock.on("force-logout", function (data) {
          try {
            var title = (data && data.title) || "Сессия завершена";
            var body =
              (data && data.body) ||
              "Сессия разорвана администратором. Войдите снова.";
            if (window.Notification && Notification.permission === "granted") {
              try {
                new Notification(title, {
                  body: body,
                  icon: "/static/images/notification-icon.png",
                });
              } catch (__) {}
            }
            if (window.showToast)
              try {
                showToast(body, "warning");
              } catch (__) {}
          } catch (__) {}
          // Hard redirect to logout to invalidate session and refresh page
          try {
            location.replace("/logout");
          } catch (__) {
            try {
              location.href = "/logout";
            } catch (___) {}
          }
        });
    }
  } catch (_) {}
})();
