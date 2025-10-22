(function () {
  "use strict";

  // Ensure push debug is enabled on admin page even if base.js loads later
  try {
    window.DEBUG_PUSH = true;
  } catch (_) {}

  // Debug helper for push flows (enable by setting localStorage.DEBUG_PUSH='1' or window.DEBUG_PUSH=true)
  function dlog() {
    try {
      var enabled =
        window.DEBUG_PUSH === true ||
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("DEBUG_PUSH") === "1");
      if (!enabled) return;
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[push]");
      console.log.apply(console, args);
    } catch (_) {}
  }

  let socket = null;
  let presenceItems = [];
  let lastPresenceNonEmptyAt = 0;
  let selectedUser = null; // for log filter
  let presenceCache = {}; // key -> { item, lastSeen }
  let isLogPaused = false; // pause auto-refresh for logs when selecting
  let lastContextRow = null; // remember row for context actions
  let sessionsItems = [];
  // Suppress recently terminated sessions from reappearing due to server lag
  const suppressedSessions = Object.create(null); // sid -> expireTs

  function markSessionSuppressed(sid, ms) {
    try {
      if (!sid) return;
      suppressedSessions[sid] = Date.now() + Math.max(1000, ms || 30000);
    } catch (_) {}
  }

  function isSessionSuppressed(sid) {
    try {
      if (!sid) return false;
      const exp = suppressedSessions[sid] || 0;
      if (!exp) return false;
      if (Date.now() > exp) {
        delete suppressedSessions[sid];
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function isJsonResponse(r) {
    try {
      const ct =
        (r.headers && r.headers.get && r.headers.get("Content-Type")) || "";
      return ct.indexOf("application/json") !== -1;
    } catch (_) {
      return false;
    }
  }

  // --- Connectivity and polling backoff guards -----------------------------
  function isMainSocketConnected() {
    try {
      var s =
        (window.SyncManager &&
          typeof window.SyncManager.getSocket === "function" &&
          window.SyncManager.getSocket()) ||
        window.socket;
      return !!(s && s.connected);
    } catch (_) {
      return false;
    }
  }
  const __pollBackoff = {};
  function runWithBackoff(name, fn) {
    try {
      if (!isMainSocketConnected()) return;
      var st = __pollBackoff[name] || { fails: 0, next: 0 };
      var now = Date.now();
      if (now < st.next) return;
      var p = Promise.resolve().then(function () {
        return fn();
      });
      p.then(function () {
        __pollBackoff[name] = { fails: 0, next: 0 };
      }).catch(function () {
        st.fails = (st.fails || 0) + 1;
        var delay = Math.min(
          30000,
          Math.max(1000, Math.pow(2, st.fails - 1) * 1000)
        );
        st.next = now + delay;
        __pollBackoff[name] = st;
      });
      return p;
    } catch (_) {}
  }

  function fetchPresence() {
    if (!isMainSocketConnected()) return Promise.resolve();
    return fetch("/admin/presence", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok || !isJsonResponse(r)) {
          return { status: "error" };
        }
        return r.json().catch(function () {
          return { status: "error" };
        });
      })
      .then((j) => {
        if (j && j.status === "success") {
          const now = Date.now();
          const items = Array.isArray(j.items) ? j.items : [];
          // Build new map from server
          const freshMap = {};
          for (let i = 0; i < items.length; i++) {
            const it = items[i] || {};
            const k = presenceKey(it);
            if (!k) continue;
            freshMap[k] = it;
          }
          // Merge with cache: keep recently seen entries even if temporarily missing (<=3s)
          const mergedMap = { ...freshMap };
          const keys = Object.keys(presenceCache);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (mergedMap[k]) continue;
            const cached = presenceCache[k];
            if (!cached) continue;
            const lastSeen = cached.lastSeen || 0;
            if (now - lastSeen <= 3000) {
              mergedMap[k] = cached.item;
            }
          }
          // Update cache timestamps for merged entries
          presenceCache = {};
          const mergedItems = [];
          Object.keys(mergedMap).forEach(function (k) {
            const it = mergedMap[k];
            presenceCache[k] = { item: it, lastSeen: now };
            mergedItems.push(it);
          });
          // Sort alphabetically by user name (case-insensitive)
          mergedItems.sort(function (a, b) {
            const an = (a.user || "").toString().toLowerCase();
            const bn = (b.user || "").toString().toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
          });
          presenceItems = mergedItems;
          renderPresence();
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  }

  // --- Push helpers ---------------------------------------------------------
  // Use shared helper from utils/push.js
  var urlBase64ToUint8Array =
    window.urlBase64ToUint8Array ||
    function (b64) {
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
    };

  async function silentEnsureSubscription() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        return false;
      if (!("Notification" in window) || Notification.permission !== "granted")
        return false;
      // Ensure SW is registered so .ready can resolve
      try {
        const existingReg = await navigator.serviceWorker.getRegistration();
        if (!existingReg) {
          await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        }
      } catch (_) {}
      const reg = await navigator.serviceWorker.ready;
      if (!reg || !reg.pushManager) return false;
      // If already subscribed, keep it; some browsers still require resave to server, so send if present
      let sub = await reg.pushManager.getSubscription();
      dlog("silentEnsureSubscription: existing=", !!sub);
      if (!sub) {
        // fetch VAPID key
        const resp = await fetch("/push/vapid_public", {
          credentials: "same-origin",
        });
        const j = await resp.json().catch(() => null);
        const publicKey = j && j.publicKey ? j.publicKey : "";
        dlog("vapid_public ok=", !!publicKey);
        if (!publicKey) return false;
        // subscribe
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        dlog(
          "subscribed: endpoint~=",
          sub && sub.endpoint ? sub.endpoint.slice(0, 32) + "..." : null
        );
      }
      if (!sub) return false;
      // Send/refresh on server
      const save = await fetch("/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      })
        .then((r) => r.json().catch(() => null))
        .catch(() => null);
      dlog("subscribe save result=", save);
      return !!(save && save.status === "success");
    } catch (_) {
      dlog("silentEnsureSubscription error", _ && (_.message || _));
      return false;
    }
  }

  async function forceRenewSubscription() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        return false;
      const reg = await navigator.serviceWorker.ready;
      if (!reg || !reg.pushManager) return false;
      try {
        const old = await reg.pushManager.getSubscription();
        if (old) {
          try {
            await fetch("/push/unsubscribe", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: old.endpoint }),
            });
          } catch (_) {}
          try {
            await old.unsubscribe();
          } catch (_) {}
        }
      } catch (_) {}
      const resp = await fetch("/push/vapid_public", {
        credentials: "same-origin",
      });
      const j = await resp.json().catch(() => null);
      const publicKey = j && j.publicKey ? j.publicKey : "";
      dlog("forceRenew: vapid ok=", !!publicKey);
      if (!publicKey) return false;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      dlog(
        "forceRenew: subscribed endpoint~=",
        sub && sub.endpoint ? sub.endpoint.slice(0, 32) + "..." : null
      );
      const save = await fetch("/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      })
        .then((r) => r.json().catch(() => null))
        .catch(() => null);
      dlog("forceRenew: save result=", save);
      return !!(save && save.status === "success");
    } catch (_) {
      dlog("forceRenewSubscription error", _ && (_.message || _));
      return false;
    }
  }

  function presenceKey(it) {
    try {
      const uid = it && (it.user_id != null ? String(it.user_id) : "");
      const user = it && it.user ? String(it.user) : "";
      const ip = it && it.ip ? String(it.ip).trim() : "";
      const ua = it && it.ua ? String(it.ua).slice(0, 64) : "";
      const left = uid || user;
      if (!left || !ip) return "";
      return left + ":" + ip + ":" + ua;
    } catch (_) {
      return "";
    }
  }

  function renderPresence() {
    const tbody = document.querySelector("#presenceTable tbody");
    if (!tbody) return;
    // Build HTML first to avoid flicker
    let html = "";
    for (let i = 0; i < presenceItems.length; i++) {
      const item = presenceItems[i] || {};
      html +=
        '<tr data-sid="' +
        (item.sid || "") +
        '" data-user-id="' +
        (item.user_id || "") +
        '">' +
        '<td class="user" title="' +
        escapeHtml(item.ua || "") +
        '">' +
        escapeHtml(item.user || "") +
        "</td>" +
        '<td class="ip">' +
        escapeHtml(item.ip || "") +
        "</td>" +
        '<td class="ua">' +
        escapeHtml(formatUA(item.ua) || "") +
        "</td>" +
        '<td class="page">' +
        escapeHtml(item.page || "") +
        "</td>" +
        "</tr>";
    }
    // If new list is empty, keep current table for a short grace period to avoid blinking
    if (presenceItems.length === 0) {
      if (
        lastPresenceNonEmptyAt &&
        Date.now() - lastPresenceNonEmptyAt < 3000
      ) {
        return; // skip swapping to empty state
      }
    } else {
      lastPresenceNonEmptyAt = Date.now();
    }
    tbody.innerHTML = html;
    // enable row context menu
    enablePresenceContextMenu();
  }

  function fetchSessions() {
    if (!isMainSocketConnected()) return Promise.resolve();
    return fetch("/admin/sessions", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok || !isJsonResponse(r)) {
          return { status: "error" };
        }
        return r.json().catch(function () {
          return { status: "error" };
        });
      })
      .then(function (j) {
        if (j && j.status === "success") {
          var raw = Array.isArray(j.items) ? j.items.slice() : [];
          // Filter out recently terminated sessions (client-side tombstones)
          sessionsItems = raw.filter(function (it) {
            try {
              var sid = it && it.sid ? String(it.sid) : "";
              return !isSessionSuppressed(sid);
            } catch (_) {
              return true;
            }
          });
          sessionsItems.sort(function (a, b) {
            return (b.last_seen || 0) - (a.last_seen || 0);
          });
          renderSessions();
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  }

  function renderSessions() {
    const tbody = document.querySelector("#sessionsTable tbody");
    if (!tbody) return;
    let html = "";
    for (let i = 0; i < sessionsItems.length; i++) {
      const it = sessionsItems[i] || {};
      const last = it.last_seen
        ? new Date(it.last_seen * 1000 || it.last_seen).toLocaleString()
        : "";
      html +=
        '<tr data-sid="' +
        (it.sid || "") +
        '" data-user-id="' +
        (it.user_id || "") +
        '">' +
        '<td class="user">' +
        escapeHtml(it.user || "") +
        "</td>" +
        '<td class="ip">' +
        escapeHtml(it.ip || "") +
        "</td>" +
        '<td class="ua">' +
        escapeHtml(formatUA(it.ua) || "") +
        "</td>" +
        '<td class="text-end">' +
        escapeHtml(last) +
        "</td>" +
        "</tr>";
    }
    tbody.innerHTML = html;
    enableSessionsContextMenu();
  }

  // Sessions table: context menu to force logout by session (top-level, bind once)
  function enableSessionsContextMenu() {
    const table = document.getElementById("sessionsTable");
    if (!table || table._ctxBound) return;
    table._ctxBound = true;
    // Header: only Refresh
    const thead = table.querySelector("thead");
    if (thead) {
      safeOn(thead, "contextmenu", function (e) {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, "sessions-header", null);
      });
    }
    safeOn(table, "contextmenu", function (e) {
      const row = e.target.closest("tbody tr");
      if (!row) return;
      e.preventDefault();
      lastContextRow = row;
      openContextMenuForSessions(e.clientX, e.clientY, row);
    });
  }

  function openContextMenuForSessions(x, y, row) {
    const menu = document.getElementById("context-menu");
    if (!menu) return;
    const canManage = !!window.ADMIN_CAN_MANAGE;
    // Reuse the same menu but show only relevant items
    toggleMenuItem(menu, "refresh", true);
    toggleMenuItem(menu, "kick", false);
    toggleMenuItem(menu, "message", false);
    toggleMenuItem(menu, "copy-selection", false);
    toggleMenuItem(menu, "copy-visible", false);
    toggleMenuItem(menu, "copy-all", false);
    toggleMenuItem(menu, "download", false);
    toggleMenuItem(menu, "download-all", false);
    // Only the single-session terminate item is relevant here
    let single = menu.querySelector('[data-action="session-terminate"]');
    if (single) single.style.display = canManage ? "" : "none";
    positionMenu(menu, x, y);
    menu.classList.remove("d-none");
    bindMenuAction(menu, "refresh", function () {
      fetchSessions();
    });
    if (single)
      single.onclick = function (ev) {
        ev.preventDefault();
        hideContextMenu();
        if (!canManage) return;
        if (!row) return;
        const sid = row.getAttribute("data-sid");
        if (!sid) return;
        const modalEl = document.getElementById("confirmForceLogoutOneModal");
        if (!modalEl) {
          forceLogoutSession(sid);
          return;
        }
        modalEl.setAttribute("data-sid", sid);
        const m = new bootstrap.Modal(modalEl);
        m.show();
      };
    // No mass-terminate action in context menu; use the button with its own modal
  }

  function escapeHtml(s) {
    try {
      var map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return String(s).replace(/[&<>"']/g, function (ch) {
        return map[ch] || ch;
      });
    } catch (_) {
      return s;
    }
  }

  function formatUA(ua) {
    try {
      if (!ua) return "";
      // Simple browser/version extraction
      const m = ua.match(/(Chrome|Firefox|Edg|Safari)\/?\s?(\d+[\.\d+]*)/i);
      if (m) return (m[1] + " " + m[2]).replace("Edg", "Edge");
      return ua.split(" ").slice(0, 2).join(" ");
    } catch (_) {
      return ua;
    }
  }

  function openNotifyModalFor(target) {
    try {
      var modalEl = document.getElementById("adminNotifyModal");
      if (!modalEl) return;
      // reset
      var textEl = document.getElementById("notifyTextM");
      if (textEl) textEl.value = "";
      var all = document.getElementById("notifyScopeAllM");
      var userR = document.getElementById("notifyScopeUserM");
      var groupR = document.getElementById("notifyScopeGroupM");
      var wrap = document.getElementById("notifyComboWrapM");
      var combo = document.getElementById("notifyComboM");
      if (all) all.checked = true;
      if (wrap) wrap.classList.add("d-none");
      modalEl.dataset.target = target || "all";
      var m = new bootstrap.Modal(modalEl);
      // If target was preselected from context menu, set proper scope and preload options
      if (target && typeof target === "string") {
        if (target.startsWith("user:")) {
          if (userR) userR.checked = true;
          if (wrap) wrap.classList.remove("d-none");
          if (combo) {
            combo.disabled = false;
            var uid = target.split(":", 1)[1] || target.replace("user:", "");
            loadUsersIntoCombo(combo);
            // apply value slightly later to allow options to load
            setTimeout(function () {
              try {
                combo.value = uid;
              } catch (_) {}
            }, 200);
          }
        } else if (target.startsWith("group:")) {
          if (groupR) groupR.checked = true;
          if (wrap) wrap.classList.remove("d-none");
          if (combo) {
            combo.disabled = false;
            var gid = target.split(":", 1)[1] || target.replace("group:", "");
            loadGroupsIntoCombo(combo);
            setTimeout(function () {
              try {
                combo.value = gid;
              } catch (_) {}
            }, 0);
          }
        }
      }
      m.show();
    } catch (_) {}
  }

  function closeNotifyModal() {
    try {
      var modalEl = document.getElementById("adminNotifyModal");
      if (!modalEl) return;
      // Blur focused element to avoid aria-hidden on focused node
      try {
        if (
          document.activeElement &&
          typeof document.activeElement.blur === "function"
        )
          document.activeElement.blur();
      } catch (__) {}
      var inst =
        bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      // After fully hidden, move focus to opener if available
      var opener = document.getElementById("btnOpenNotifyModal");
      var onHidden = function () {
        try {
          opener && opener.focus && opener.focus();
        } catch (__) {}
        modalEl.removeEventListener("hidden.bs.modal", onHidden);
      };
      modalEl.addEventListener("hidden.bs.modal", onHidden);
      inst.hide();
    } catch (_) {}
  }

  function forceLogout(sid, uid) {
    return fetch("/admin/force_logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sid, user_id: uid }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.status === "success") {
          window.showToast &&
            window.showToast("Пользователь отключён", "success");
          // Optimistically remove from local presence and re-render immediately
          try {
            if (Array.isArray(presenceItems)) {
              presenceItems = presenceItems.filter(function (it) {
                if (sid && it.sid && it.sid === sid) return false;
                if (uid && it.user_id == uid) return false;
                return true;
              });
            }
            // prune cache too
            try {
              const keys = Object.keys(presenceCache || {});
              for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const entry = presenceCache[k] && presenceCache[k].item;
                if (!entry) continue;
                if (
                  (sid && entry.sid === sid) ||
                  (uid && entry.user_id == uid)
                ) {
                  delete presenceCache[k];
                }
              }
            } catch (_) {}
            renderPresence();
          } catch (_) {}
          // also refresh from server shortly after to reconcile
          setTimeout(function () {
            try {
              fetchPresence();
            } catch (_) {}
          }, 500);
        } else {
          window.showToast && window.showToast(j.message || "Ошибка", "error");
        }
      })
      .catch(() => {
        window.showToast && window.showToast("Ошибка сети", "error");
      });
  }

  function sendMessage(target, message) {
    return fetchWithAutoPush("/admin/send_message", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: target, message: message }),
    })
      .then(function (res) {
        const j = res && res.data ? res.data : { status: "error" };
        if (res && res.ok && j.status === "success") {
          window.showToast &&
            window.showToast("Сообщение отправлено", "success");
        } else {
          window.showToast &&
            window.showToast((j && j.message) || "Ошибка", "error");
        }
        return j;
      })
      .catch(() => {
        window.showToast && window.showToast("Ошибка сети", "error");
      });
  }

  // Helper: auto-enable push silently on 400 No subscriptions, then retry original request
  function fetchWithAutoPush(input, init) {
    init = init || {};
    // Limit auto-retries to avoid loops (at most 2 per original request)
    var tries =
      typeof init._autoPushTries === "number" ? init._autoPushTries : 0;
    function doFetch() {
      return fetch(input, init).then(function (r) {
        return r
          .json()
          .then(function (j) {
            var out = { ok: r.ok, status: r.status, data: j };
            dlog("request", input, "status=", r.status, "data=", j);
            return out;
          })
          .catch(function () {
            dlog("request", input, "status=", r.status, "data=<?>");
            return { ok: r.ok, status: r.status, data: null };
          });
      });
    }
    return doFetch().then(function (res) {
      var msg =
        res && res.data && res.data.message ? String(res.data.message) : "";
      var shouldAutoEnable =
        res.status === 400 && /no subscriptions/i.test(msg);
      if (!shouldAutoEnable) return res;
      if (tries >= 2) {
        // Surface server message and stop retrying
        try {
          var finalMsg = msg || "Нет активной подписки на уведомления";
          window.showToast && window.showToast(finalMsg, "error");
        } catch (_) {}
        return res;
      }
      // Silently enable push and retry once
      return new Promise(function (resolve) {
        try {
          // Prefer built-in recovery; fallback to window.pushInit if present
          Promise.resolve(silentEnsureSubscription())
            .then(function (ok) {
              dlog("autoEnable result=", ok);
              if (!ok && window.pushInit) {
                return Promise.resolve(window.pushInit({ silent: true })).then(
                  function () {
                    return true;
                  },
                  function () {
                    return false;
                  }
                );
              }
              return ok;
            })
            .then(function () {
              setTimeout(function () {
                // bump attempt counter for the retry
                var nextInit = Object.assign({}, init, {
                  _autoPushTries: tries + 1,
                });
                fetch(input, nextInit)
                  .then(function (r) {
                    return r
                      .json()
                      .then(function (j) {
                        var out = { ok: r.ok, status: r.status, data: j };
                        dlog("retry1", input, "status=", r.status, "data=", j);
                        return out;
                      })
                      .catch(function () {
                        dlog("retry1", input, "status=", r.status, "data=<?>");
                        return { ok: r.ok, status: r.status, data: null };
                      });
                  })
                  .then(function (res2) {
                    var msg2 =
                      res2 && res2.data && res2.data.message
                        ? String(res2.data.message)
                        : "";
                    var stillNoSubs =
                      res2.status === 400 && /no subscriptions/i.test(msg2);
                    if (!stillNoSubs) {
                      resolve(res2);
                      return;
                    }
                    // Force renew subscription and retry once more
                    Promise.resolve(forceRenewSubscription())
                      .then(function () {
                        setTimeout(function () {
                          var finalInit = Object.assign({}, init, {
                            _autoPushTries: tries + 2,
                          });
                          fetch(input, finalInit)
                            .then(function (r) {
                              return r
                                .json()
                                .then(function (j) {
                                  dlog(
                                    "retry2",
                                    input,
                                    "status=",
                                    r.status,
                                    "data=",
                                    j
                                  );
                                  return {
                                    ok: r.ok,
                                    status: r.status,
                                    data: j,
                                  };
                                })
                                .catch(function () {
                                  dlog(
                                    "retry2",
                                    input,
                                    "status=",
                                    r.status,
                                    "data=<?>"
                                  );
                                  return {
                                    ok: r.ok,
                                    status: r.status,
                                    data: null,
                                  };
                                });
                            })
                            .then(resolve)
                            .catch(function () {
                              resolve(res);
                            });
                        }, 400);
                      })
                      .catch(function () {
                        resolve(res2);
                      });
                  })
                  .catch(function () {
                    resolve(res);
                  });
              }, 500);
            })
            .catch(function () {
              resolve(res);
            });
        } catch (_) {
          resolve(res);
        }
      });
    });
  }

  // Ensure a push subscription exists before sending; silent and best-effort
  function ensurePushSubscribed() {
    function withTimeout(p, ms) {
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          resolve();
        }
        setTimeout(finish, ms);
        Promise.resolve(p).then(finish).catch(finish);
      });
    }
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        return Promise.resolve();
      if (!("Notification" in window) || Notification.permission !== "granted")
        return Promise.resolve();
      var readyP = navigator.serviceWorker.ready
        .then(function (reg) {
          return reg && reg.pushManager
            ? reg.pushManager.getSubscription()
            : null;
        })
        .then(function (sub) {
          if (sub) return;
          try {
            if (window.pushInit) return window.pushInit({ silent: true });
          } catch (_) {}
        })
        .catch(function () {
          /* ignore */
        });
      return withTimeout(readyP, 800);
    } catch (_) {
      return Promise.resolve();
    }
  }

  function bindHandlers() {
    const table = document.getElementById("presenceTable");
    if (table) {
      table.addEventListener("click", function (e) {
        const tdUser = e.target.closest("td.user");
        if (!tdUser) return;
        selectedUser = tdUser.textContent.trim();
        loadLogs();
      });
    }

    const btnRefresh = document.getElementById("btnRefreshPresence");
    if (btnRefresh) safeOn(btnRefresh, "click", fetchPresence);

    const btnRefreshSessions = document.getElementById("btnRefreshSessions");
    if (btnRefreshSessions) safeOn(btnRefreshSessions, "click", fetchSessions);

    const btnOpenNotifyModal = document.getElementById("btnOpenNotifyModal");
    if (btnOpenNotifyModal)
      safeOn(btnOpenNotifyModal, "click", function () {
        openNotifyModalFor("all");
      });

    // Maintenance with confirmation modal
    const btnPushMaintain = document.getElementById("btnPushMaintain");
    if (btnPushMaintain)
      safeOn(btnPushMaintain, "click", function () {
        const modalEl = document.getElementById("confirmPushMaintainModal");
        if (!modalEl) {
          runPushMaintain();
          return;
        }
        const m = new bootstrap.Modal(modalEl);
        m.show();
      });
    const btnConfirmPushMaintain = document.getElementById(
      "btnConfirmPushMaintain"
    );
    if (btnConfirmPushMaintain)
      safeOn(btnConfirmPushMaintain, "click", function () {
        try {
          bootstrap.Modal.getInstance(
            document.getElementById("confirmPushMaintainModal")
          ).hide();
        } catch (_) {}
        runPushMaintain();
      });

    function runPushMaintain() {
      const trigger = document.getElementById("btnPushMaintain");
      try {
        if (trigger) trigger.disabled = true;
      } catch (_) {}
      fetch("/admin/push_maintain", {
        method: "POST",
        credentials: "same-origin",
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, data: j };
          });
        })
        .then(function (res) {
          if (res.ok && res.data && res.data.status === "success") {
            var m = res.data;
            window.showToast &&
              window.showToast(
                "Готово. Удалено: " +
                  (m.deleted || 0) +
                  ", проверено: " +
                  (m.tested || 0) +
                  ", очищено при проверке: " +
                  (m.removed || 0),
                "success"
              );
            // Apply cooldown immediately if provided
            try {
              const left = Number(m.seconds_left || 0);
              if (left > 0 && trigger) {
                trigger.disabled = true;
                trigger.title =
                  "Доступно через ~" + Math.ceil(left / 3600) + " ч";
              }
            } catch (_) {}
          } else {
            var msg =
              res.data && res.data.message
                ? res.data.message
                : "Ошибка обслуживания";
            window.showToast && window.showToast(msg, "error");
            // On 429, also reflect cooldown via status endpoint
            if (res.status === 429) {
              refreshMaintainCooldown();
            }
          }
        })
        .catch(function () {
          window.showToast && window.showToast("Ошибка сети", "error");
        })
        .finally(function () {
          try {
            // Don't re-enable here unconditionally; refresh status decides
            if (trigger) {
              // let status endpoint set the correct disabled state
            }
          } catch (_) {}
          // Update cooldown status after run
          refreshMaintainCooldown();
        });
    }

    const btnNotifyTest = document.getElementById("btnNotifyTest");
    if (btnNotifyTest)
      safeOn(btnNotifyTest, "click", function () {
        try {
          btnNotifyTest.disabled = true;
        } catch (_) {}
        var unlockTimer = setTimeout(function () {
          try {
            btnNotifyTest.disabled = false;
          } catch (_) {}
        }, 6000);
        function runTest() {
          // Ensure a fresh, server-saved subscription before sending
          return Promise.resolve(forceRenewSubscription())
            .then(function (ok) {
              if (!ok) {
                return Promise.resolve(silentEnsureSubscription());
              }
              return true;
            })
            .then(function (ok2) {
              if (!ok2) {
                window.showToast &&
                  window.showToast("Не удалось оформить подписку", "error");
                return {
                  ok: false,
                  data: { status: "error", message: "No subscriptions" },
                };
              }
              return fetchWithAutoPush("/push/test", {
                method: "POST",
                credentials: "same-origin",
              });
            });
        }
        // If permission undecided, request it inside this gesture before proceeding
        try {
          if (
            "Notification" in window &&
            typeof Notification.requestPermission === "function" &&
            Notification.permission === "default"
          ) {
            var rp = null;
            try {
              rp = Notification.requestPermission();
            } catch (_) {}
            if (rp && typeof rp.then === "function") {
              rp.then(function (perm) {
                if (perm !== "granted") {
                  throw new Error("permission denied");
                }
              })
                .then(runTest)
                .then(handleTestResult)
                .catch(function () {
                  handleTestResult({
                    ok: false,
                    data: { status: "error", message: "Permission denied" },
                  });
                })
                .finally(finish);
              return;
            }
            try {
              Notification.requestPermission(function (perm) {
                var p =
                  perm === "granted"
                    ? runTest()
                    : Promise.resolve({
                        ok: false,
                        data: { status: "error", message: "Permission denied" },
                      });
                p.then(handleTestResult).finally(finish);
              });
              return;
            } catch (_) {}
          }
        } catch (_) {}
        runTest().then(handleTestResult).finally(finish);

        function handleTestResult(res) {
          if (
            res.ok &&
            res.data &&
            res.data.status === "success" &&
            Number(res.data.sent || 0) > 0
          ) {
            window.showToast &&
              window.showToast("Тестовое уведомление отправлено", "success");
            return;
          }
          if (
            res.ok &&
            res.data &&
            res.data.status === "success" &&
            Number(res.data.sent || 0) === 0
          ) {
            // Likely race right after subscription; retry once after a short delay
            return new Promise(function (resolve) {
              setTimeout(function () {
                fetchWithAutoPush("/push/test", {
                  method: "POST",
                  credentials: "same-origin",
                })
                  .then(function (res2) {
                    if (
                      res2.ok &&
                      res2.data &&
                      res2.data.status === "success" &&
                      Number(res2.data.sent || 0) > 0
                    ) {
                      window.showToast &&
                        window.showToast(
                          "Тестовое уведомление отправлено",
                          "success"
                        );
                    } else {
                      var serverMsg2 =
                        res2.data && res2.data.message
                          ? String(res2.data.message)
                          : "";
                      var msg2 = serverMsg2 || "Ошибка отправки уведомления";
                      window.showToast && window.showToast(msg2, "error");
                    }
                    resolve();
                  })
                  .catch(function () {
                    window.showToast &&
                      window.showToast(
                        "Ошибка сети при отправке уведомления",
                        "error"
                      );
                    resolve();
                  });
              }, 800);
            });
          }
          var serverMsg =
            res.data && res.data.message ? String(res.data.message) : "";
          // Silent auto-subscribe already attempted inside fetchWithAutoPush
          if (res.status === 400 && /VAPID/i.test(serverMsg)) {
            window.showToast &&
              window.showToast("VAPID ключи не настроены на сервере", "error");
            return;
          }
          var msg = serverMsg || "Ошибка отправки уведомления";
          window.showToast && window.showToast(msg, "error");
        }
        function finish() {
          try {
            clearTimeout(unlockTimer);
          } catch (_) {}
          try {
            btnNotifyTest.disabled = false;
          } catch (_) {}
        }
      });

    const btnSendNotifyM = document.getElementById("btnSendNotifyM");
    if (btnSendNotifyM)
      safeOn(btnSendNotifyM, "click", function () {
        const scopeEl = document.querySelector(
          'input[name="notifyScopeM"]:checked'
        );
        const scope = scopeEl && scopeEl.value ? scopeEl.value : "all";
        const combo = document.getElementById("notifyComboM");
        const text = document.getElementById("notifyTextM")?.value || "";
        if (!text.trim()) {
          window.showToast &&
            window.showToast("Введите текст сообщения", "error");
          return;
        }
        let target = "all";
        if (scope === "user") {
          const uid = combo?.value;
          if (!uid) {
            window.showToast &&
              window.showToast("Выберите пользователя", "error");
            return;
          }
          target = "user:" + uid;
        } else if (scope === "group") {
          const gid = combo?.value;
          if (!gid) {
            window.showToast && window.showToast("Выберите группу", "error");
            return;
          }
          target = "group:" + gid;
        } else {
          // all, but if row-targeted was set
          const modalEl = document.getElementById("adminNotifyModal");
          const forced = modalEl ? modalEl.dataset.target || "" : "";
          if (forced && forced.startsWith("user:")) target = forced;
        }
        sendMessage(target, text).then(function (j) {
          if (j && j.status === "success") {
            closeNotifyModal();
          }
        });
      });

    const radiosM = document.querySelectorAll('input[name="notifyScopeM"]');
    radiosM.forEach(function (r) {
      safeOn(r, "change", onScopeChangeModal);
    });

    const search = document.getElementById("logSearch");
    if (search)
      safeOn(
        search,
        "input",
        debounce(function () {
          selectedUser = null;
          loadLogs();
        }, 300)
      );

    const btnLogsClear = document.getElementById("btnLogsClear");
    if (btnLogsClear)
      safeOn(btnLogsClear, "click", function () {
        try {
          selectedUser = null;
        } catch (_) {}
        try {
          const s = document.getElementById("logSearch");
          if (s) {
            s.value = "";
            s.focus();
          }
        } catch (_) {}
        loadLogs();
      });

    // Global Enter handling for open modal: submit default action
    safeOn(document, "keydown", function (e) {
      try {
        if (
          e.key !== "Enter" ||
          e.shiftKey ||
          e.ctrlKey ||
          e.altKey ||
          e.metaKey
        )
          return;
        // Don't interfere with textarea (allow newline)
        const tgt = e.target;
        if (tgt && tgt.tagName === "TEXTAREA") return;
        // If any modal is open, trigger its default button
        const openModal = document.querySelector(".modal.show");
        if (!openModal) return;
        const defBtn = openModal.querySelector(
          '[data-enter="default"], .modal-footer .btn-primary'
        );
        if (!defBtn) return;
        e.preventDefault();
        defBtn.click();
      } catch (_) {}
    });

    // logs context menu (copy)
    const logs = document.getElementById("logsView");
    if (logs) {
      safeOn(logs, "contextmenu", function (e) {
        e.preventDefault();
        lastContextRow = null;
        openContextMenu(e.clientX, e.clientY, "logs"); // journal
      });
      // Pause logs while selecting inside pre
      document.addEventListener("selectionchange", function () {
        try {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) {
            isLogPaused = false;
            return;
          }
          const range = sel.getRangeAt(0);
          isLogPaused =
            logs.contains(range.startContainer) &&
            logs.contains(range.endContainer) &&
            String(sel).trim().length > 0;
        } catch (_) {
          isLogPaused = false;
        }
      });
    }

    // Force logout all with confirmation
    const btnForceLogoutAll = document.getElementById("adminForceLogoutBtn");
    if (btnForceLogoutAll)
      safeOn(btnForceLogoutAll, "click", function () {
        const modalEl = document.getElementById("confirmForceLogoutAllModal");
        if (!modalEl) {
          runForceLogoutAll();
          return;
        }
        const m = new bootstrap.Modal(modalEl);
        m.show();
      });
    const btnConfirmForceLogoutAll = document.getElementById(
      "btnConfirmForceLogoutAll"
    );
    if (btnConfirmForceLogoutAll)
      safeOn(btnConfirmForceLogoutAll, "click", function () {
        try {
          bootstrap.Modal.getInstance(
            document.getElementById("confirmForceLogoutAllModal")
          ).hide();
        } catch (_) {}
        runForceLogoutAll();
      });

    function runForceLogoutAll() {
      const trigger = document.getElementById("adminForceLogoutBtn");
      try {
        if (trigger) trigger.disabled = true;
      } catch (_) {}
      fetch("/admin/force_logout_all", {
        method: "POST",
        credentials: "same-origin",
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, data: j };
          });
        })
        .then(function (res) {
          if (res.ok && res.data && res.data.status === "success") {
            window.showToast &&
              window.showToast("Все сессии завершены", "success");
            try {
              fetchPresence();
            } catch (_) {}
          } else {
            var msg =
              res.data && res.data.message
                ? res.data.message
                : "Ошибка принудительного выхода";
            window.showToast && window.showToast(msg, "error");
          }
        })
        .catch(function () {
          window.showToast && window.showToast("Ошибка сети", "error");
        })
        .finally(function () {
          try {
            if (trigger) trigger.disabled = false;
          } catch (_) {}
        });
    }

    // Page-wide context menu: only show Refresh when not on specific widgets
    safeOn(document, "contextmenu", function (e) {
      try {
        const logsEl = document.getElementById("logsView");
        const presEl = document.getElementById("presenceTable");
        const logsTable = document.getElementById("logsTable");
        const sessEl = document.getElementById("sessionsTable");
        if (
          (logsEl && logsEl.contains(e.target)) ||
          (presEl && presEl.contains(e.target)) ||
          (logsTable && logsTable.contains(e.target)) ||
          (sessEl && sessEl.contains(e.target))
        )
          return;
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, "page");
      } catch (_) {}
    });

    // Logs list table: context menu for download actions
    const logsTableEl = document.getElementById("logsTable");
    if (logsTableEl) {
      safeOn(logsTableEl, "contextmenu", function (e) {
        const row = e.target.closest("tr");
        if (!row) return;
        e.preventDefault();
        lastContextRow = row;
        openContextMenu(e.clientX, e.clientY, "logs-list", row);
      });
    }

    // Sessions table context menu is handled globally; no local definitions here

    // Bind confirm button for single-session termination (delegated once)
    (function bindConfirmOne() {
      const btn = document.getElementById("btnConfirmForceLogoutOne");
      if (!btn || btn._boundLogoutOne) return;
      btn._boundLogoutOne = true;
      safeOn(btn, "click", function () {
        try {
          const modalEl = document.getElementById("confirmForceLogoutOneModal");
          const sid = modalEl ? modalEl.getAttribute("data-sid") : "";
          if (!sid) return;
          try {
            bootstrap.Modal.getInstance(modalEl).hide();
          } catch (_) {}
          forceLogoutSession(sid);
          modalEl.removeAttribute("data-sid");
        } catch (_) {}
      });
    })();

    function forceLogoutSession(sid) {
      fetch("/admin/force_logout_session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: sid }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (j && j.status === "success") {
            window.showToast && window.showToast("Сессия разорвана", "success");
            // Optimistically remove the row from the table immediately
            try {
              const table = document.getElementById("sessionsTable");
              if (table) {
                const tr = table.querySelector(
                  'tbody tr[data-sid="' + sid + '"]'
                );
                if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
              }
            } catch (_) {}
            // Prevent re-appearing for a short grace period to cover server lag
            try {
              markSessionSuppressed(sid, 45000);
            } catch (_) {}
            // Refresh from server to reconcile
            fetchSessions();
          } else {
            window.showToast &&
              window.showToast((j && j.message) || "Ошибка", "error");
          }
        })
        .catch(function () {
          window.showToast && window.showToast("Ошибка сети", "error");
        });
    }

    // global click to hide context menu
    safeOn(document, "click", function () {
      hideContextMenu();
    });
    safeOn(window, "resize", function () {
      hideContextMenu();
    });

    // logs table: open in new tab on double click
    const logsTable2 = document.getElementById("logsTable");
    if (logsTable2) {
      safeOn(logsTable2, "dblclick", function (e) {
        const tr = e.target.closest("tr");
        if (!tr) return;
        const name = tr.getAttribute("data-name");
        if (!name) return;
        const url = "/admin/logs/view?name=" + encodeURIComponent(name);
        window.open(url, "_blank", "noopener");
      });
      // hover cursor pointer
      safeOn(logsTable2, "mousemove", function (e) {
        const tr = e.target.closest("tr");
        if (!tr) return;
        tr.style.cursor = "pointer";
      });
    }
  }

  // Cooldown UI for Push Maintain button (persists across reloads via server status)
  function refreshMaintainCooldown() {
    const btn = document.getElementById("btnPushMaintain");
    if (!btn) return;
    fetch("/admin/push_maintain_status", { credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () {
          return { status: "error" };
        });
      })
      .then(function (j) {
        if (!j || j.status !== "success") return;
        const left = Number(j.seconds_left || 0);
        if (left > 0) {
          btn.disabled = true;
          try {
            btn.title = "Доступно через ~" + Math.ceil(left / 3600) + " ч";
          } catch (_) {}
        } else {
          btn.disabled = false;
          try {
            btn.removeAttribute("title");
          } catch (_) {}
        }
      })
      .catch(function () {});
  }

  function enablePresenceContextMenu() {
    const table = document.getElementById("presenceTable");
    if (!table) return;
    // Header: only Refresh
    const thead = table.querySelector("thead");
    if (thead) {
      safeOn(thead, "contextmenu", function (e) {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, "presence-header", null);
      });
    }
    safeOn(table, "contextmenu", function (e) {
      const row = e.target.closest("tbody tr");
      if (!row) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, "presence", row);
    });
  }

  function openContextMenu(x, y, type, row) {
    const menu = document.getElementById("context-menu");
    if (!menu) return;
    // toggle admin actions by permission and target type
    const canManage = !!window.ADMIN_CAN_MANAGE;
    toggleMenuItem(menu, "refresh", true);
    toggleMenuItem(menu, "kick", canManage && type === "presence");
    toggleMenuItem(menu, "message", canManage && type === "presence");
    const isJournal = type === "logs"; // actions journal
    const isLogsList = type === "logs-list"; // files list
    toggleMenuItem(menu, "copy-selection", isJournal);
    toggleMenuItem(menu, "copy-visible", isJournal);
    toggleMenuItem(menu, "copy-all", isJournal);
    toggleMenuItem(menu, "download", isLogsList);
    toggleMenuItem(menu, "download-all", isLogsList);
    // If header (thead) was clicked: only allow refresh
    const isHeaderType =
      type === "presence-header" || type === "sessions-header";
    if (isHeaderType || type === "page") {
      toggleMenuItem(menu, "kick", false);
      toggleMenuItem(menu, "message", false);
      toggleMenuItem(menu, "copy-selection", false);
      toggleMenuItem(menu, "copy-visible", false);
      toggleMenuItem(menu, "copy-all", false);
      toggleMenuItem(menu, "download", false);
      toggleMenuItem(menu, "download-all", false);
    }
    // Ensure single-session terminate is hidden for non-sessions menus
    toggleMenuItem(menu, "session-terminate", false);
    positionMenu(menu, x, y);
    menu.classList.remove("d-none");

    // bind actions
    bindMenuAction(menu, "refresh", function () {
      softRefresh();
    });
    bindMenuAction(menu, "kick", function () {
      if (!canManage) return;
      if (!row) return;
      const sid = row.getAttribute("data-sid");
      const uid = row.getAttribute("data-user-id");
      forceLogout(sid || null, uid || null);
    });
    bindMenuAction(menu, "message", function () {
      if (!canManage) return;
      if (!row) return;
      const uid = row.getAttribute("data-user-id");
      openNotifyModalFor(uid ? "user:" + uid : "all");
    });
    bindMenuAction(menu, "copy-selection", function () {
      if (type === "logs") copySelection();
    });
    bindMenuAction(menu, "copy-visible", function () {
      if (type === "logs") copyVisible();
    });
    bindMenuAction(menu, "copy-all", function () {
      if (type === "logs") copyAll();
    });
    bindMenuAction(menu, "download", function () {
      if (type !== "logs-list") return;
      downloadSelectedLog();
    });
    bindMenuAction(menu, "download-all", function () {
      if (type !== "logs-list") return;
      downloadAllLogs();
    });
  }

  function hideContextMenu() {
    const menu = document.getElementById("context-menu");
    if (menu) menu.classList.add("d-none");
  }
  function downloadSelectedLog() {
    try {
      const table = document.getElementById("logsTable");
      if (!table) return;
      // Prefer the row captured when opening the context menu
      const rows = table.querySelectorAll("tbody tr");
      let targetName = "";
      if (lastContextRow) {
        targetName = lastContextRow.getAttribute("data-name") || "";
      }
      if (!targetName && rows && rows.length > 0)
        targetName = rows[0].getAttribute("data-name") || "";
      if (!targetName) return;
      const url = "/admin/logs/download?name=" + encodeURIComponent(targetName);
      window.open(url, "_blank", "noopener");
    } catch (_) {}
  }

  function downloadAllLogs() {
    try {
      const url = "/admin/logs/download_all";
      window.open(url, "_blank", "noopener");
    } catch (_) {}
  }

  function positionMenu(menu, x, y) {
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  }
  function toggleMenuItem(menu, action, show) {
    const el = menu.querySelector('[data-action="' + action + '"]');
    if (el) el.style.display = show ? "" : "none";
  }
  function bindMenuAction(menu, action, handler) {
    const el = menu.querySelector('[data-action="' + action + '"]');
    if (!el) return;
    el.onclick = function (ev) {
      ev.preventDefault();
      hideContextMenu();
      handler();
    };
  }

  function copySelection() {
    try {
      const selObj = window.getSelection && window.getSelection();
      const text = selObj ? String(selObj) : "";
      if (!text) {
        window.showToast &&
          window.showToast("Нет выделенного текста", "warning");
        return;
      }
      copyToClipboard(text);
    } catch (_) {}
  }
  function copyVisible() {
    const el = document.getElementById("logsView");
    if (!el) return;
    const full = el.textContent || "";
    const lines = full.split("\n");
    // Limit by Y (visible rows), do not clip by X
    const lh = getLineHeight(el);
    const start = Math.floor(el.scrollTop / lh);
    const count = Math.max(1, Math.floor(el.clientHeight / lh));
    const slice = lines.slice(start, start + count).join("\n");
    copyToClipboard(slice);
  }
  function copyAll() {
    fetch("/logs/actions", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(function (txt) {
        copyToClipboard(txt);
      });
  }
  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text);
      window.showToast && window.showToast("Скопировано", "success");
    } catch (_) {}
  }

  function getLineHeight(el) {
    try {
      const cs = window.getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight);
      if (!isNaN(lh)) return lh;
      const test = document.createElement("span");
      test.textContent = "A";
      el.appendChild(test);
      const h = test.getBoundingClientRect().height || 16.8;
      el.removeChild(test);
      return h;
    } catch (_) {
      return 16.8;
    }
  }

  function getCharWidth(el) {
    try {
      const test = document.createElement("span");
      test.textContent = "MMMMMMMMMM"; // 10 monospace chars
      test.style.visibility = "hidden";
      test.style.whiteSpace = "pre";
      el.appendChild(test);
      const w = test.getBoundingClientRect().width || 0;
      el.removeChild(test);
      return w / 10;
    } catch (_) {
      return 8;
    }
  }

  function softRefresh() {
    try {
      fetchPresence();
    } catch (_) {}
    try {
      loadLogs();
    } catch (_) {}
    try {
      loadLogsList();
    } catch (_) {}
  }

  function safeOn(el, type, handler) {
    try {
      // Use non-passive to allow preventDefault for contextmenu and similar
      el.addEventListener(type, handler);
    } catch (_) {
      try {
        el.addEventListener(type, handler);
      } catch (__) {}
    }
  }

  function onScopeChangeModal() {
    const scopeEl = document.querySelector(
      'input[name="notifyScopeM"]:checked'
    );
    const scope = scopeEl && scopeEl.value ? scopeEl.value : "all";
    const combo = document.getElementById("notifyComboM");
    const wrap =
      document.getElementById("notifyComboWrapM") ||
      (combo && combo.parentElement);
    if (wrap) {
      if (scope === "all") {
        wrap.classList.add("d-none");
      } else {
        wrap.classList.remove("d-none");
      }
    }
    if (!combo) return;
    if (scope === "all") {
      combo.disabled = true;
      combo.innerHTML = "";
      return;
    }
    combo.disabled = false;
    if (scope === "user") {
      loadUsersIntoCombo(combo);
    } else if (scope === "group") {
      loadGroupsIntoCombo(combo);
    }
  }

  function loadUsersIntoCombo(select) {
    return fetch("/admin/users_list", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j || j.status !== "success") return [];
        select.innerHTML = "";
        (j.items || []).forEach(function (it) {
          var opt = document.createElement("option");
          opt.value = it.id;
          opt.textContent = it.name;
          select.appendChild(opt);
        });
        return j.items || [];
      })
      .catch(function () {
        return [];
      });
  }

  function loadGroupsIntoCombo(select) {
    try {
      var el = document.getElementById("server-groups-json");
      var serverGroups = el ? JSON.parse(el.textContent || "null") : null;
      if (Array.isArray(serverGroups)) {
        select.innerHTML = "";
        serverGroups.forEach(function (g) {
          var opt = document.createElement("option");
          opt.value = g.id;
          opt.textContent = g.name;
          select.appendChild(opt);
        });
        return;
      }
    } catch (_) {}
    select.innerHTML = "";
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function loadLogs() {
    if (!isMainSocketConnected()) return;
    // Fetch the actions.log via a simple endpoint that streams file
    fetch("/logs/actions", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const view = document.getElementById("logsView");
        if (!view) return;
        const query = (document.getElementById("logSearch")?.value || "")
          .trim()
          .toLowerCase();
        let lines = (text || "").split("\n");
        if (selectedUser)
          lines = lines.filter((l) => l.includes(" user=" + selectedUser));
        if (query) lines = lines.filter((l) => l.toLowerCase().includes(query));
        // Reverse sort to show latest on top
        view.textContent = lines.reverse().join("\n");
      })
      .catch(() => {
        const view = document.getElementById("logsView");
        if (view) view.textContent = "Не удалось загрузить логи";
      });
  }

  function formatBytes(bytes) {
    try {
      const b = Number(bytes || 0);
      if (b < 1024) return b + " B";
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
      return (b / 1024 / 1024).toFixed(1) + " MB";
    } catch (_) {
      return String(bytes || 0);
    }
  }

  function loadLogsList() {
    if (!isMainSocketConnected()) return;
    fetch("/admin/logs_list", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok || !isJsonResponse(r)) {
          return { status: "error", items: [] };
        }
        return r.json().catch(function () {
          return { status: "error", items: [] };
        });
      })
      .then(function (j) {
        if (!j || j.status !== "success") return;
        const table = document.getElementById("logsTable");
        if (!table) return;
        const tbody = table.querySelector("tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        // Ensure sort by modification time descending
        const items = Array.isArray(j.items)
          ? j.items.slice().sort(function (a, b) {
              return (b.mtime || 0) - (a.mtime || 0);
            })
          : [];
        items.forEach(function (it) {
          var tr = document.createElement("tr");
          tr.className = "table__body_row logs-row";
          tr.setAttribute("data-name", it.name);
          // Tooltip with formatted mtime
          try {
            tr.title = new Date((it.mtime || 0) * 1000).toLocaleString();
          } catch (_) {}
          var tdName = document.createElement("td");
          tdName.className = "table__body_item";
          tdName.textContent = it.name;
          var tdSize = document.createElement("td");
          tdSize.className = "table__body_item text-end";
          tdSize.textContent = formatBytes(it.size);
          tr.appendChild(tdName);
          tr.appendChild(tdSize);
          tbody.appendChild(tr);
        });
      })
      .catch(function () {});
  }

  function initSocket() {
    try {
      if (!window.io) return;
      socket =
        window.socket ||
        window.io(window.location.origin, {
          transports: ["websocket", "polling"],
          path: "/socket.io",
          withCredentials: true,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });
      window.socket = socket;
      // Periodic presence updates with current page
      const emitPresence = function () {
        try {
          socket.emit("presence:update", { page: location.pathname });
        } catch (_) {}
      };
      socket.on("connect", function () {
        emitPresence();
      });
      socket.on("presence:changed", function () {
        fetchPresence();
      });
      socket.on("reconnect", function () {
        emitPresence();
        fetchPresence();
      });
      socket.on("reconnect_error", function () {
        /* ignore */
      });
      socket.on("reconnect_failed", function () {
        /* ignore */
      });
      setInterval(emitPresence, 5000);
    } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      if (
        window.SyncManager &&
        typeof window.SyncManager.joinRoom === "function"
      ) {
        window.SyncManager.joinRoom("admin");
      }
    } catch (_) {}
    bindHandlers();
    initSocket();
    runWithBackoff("presence:init", fetchPresence);
    runWithBackoff("sessions:init", fetchSessions);
    refreshMaintainCooldown();
    runWithBackoff("logs:init", loadLogs);
    runWithBackoff("logs_list:init", loadLogsList);
    let logsInterval, logsListInterval, presenceInterval, sessionsInterval;

    function startIntervals() {
      logsInterval = setInterval(function () {
        const connectionState = window.SyncManager.getConnectionState();
        if (!connectionState.connected) {
          return; // Пропускаем запросы при отсутствии соединения
        }
        runWithBackoff("logs", loadLogs);
      }, 10000);

      logsListInterval = setInterval(function () {
        const connectionState = window.SyncManager.getConnectionState();
        if (!connectionState.connected) {
          return; // Пропускаем запросы при отсутствии соединения
        }
        runWithBackoff("logs_list", loadLogsList);
      }, 20000);

      // Periodic polling to reconcile presence, gated by connectivity and backoff
      presenceInterval = setInterval(function () {
        const connectionState = window.SyncManager.getConnectionState();
        if (!connectionState.connected) {
          return; // Пропускаем запросы при отсутствии соединения
        }
        runWithBackoff("presence", fetchPresence);
      }, 5000);

      sessionsInterval = setInterval(function () {
        const connectionState = window.SyncManager.getConnectionState();
        if (!connectionState.connected) {
          return; // Пропускаем запросы при отсутствии соединения
        }
        runWithBackoff("sessions", fetchSessions);
      }, 7000);
    }

    // Запускаем интервалы
    startIntervals();

    // Возобновляем интервалы при восстановлении соединения
    window.addEventListener("socketConnected", function () {
      // Очищаем старые интервалы
      if (logsInterval) clearInterval(logsInterval);
      if (logsListInterval) clearInterval(logsListInterval);
      if (presenceInterval) clearInterval(presenceInterval);
      if (sessionsInterval) clearInterval(sessionsInterval);

      // Запускаем новые
      startIntervals();
    });
    onScopeChangeModal();
    // Idle guard: soft refresh admin presence/sessions if idle
    try {
      var idleSec = 30;
      try {
        idleSec =
          parseInt(
            (window.__config && window.__config.syncIdleSeconds) || idleSec,
            10
          ) || idleSec;
      } catch (_) {}
      if (
        window.SyncManager &&
        typeof window.SyncManager.startIdleGuard === "function"
      ) {
        window.SyncManager.startIdleGuard(function () {
          try {
            runWithBackoff("presence:idle", fetchPresence);
            runWithBackoff("sessions:idle", fetchSessions);
          } catch (_) {}
        }, idleSec);
      }
    } catch (_) {}
  });

  // Global resume: refresh presence and sessions, reload logs list
  try {
    if (
      window.SyncManager &&
      typeof window.SyncManager.onResume === "function"
    ) {
      window.SyncManager.onResume(function () {
        try {
          fetchPresence();
        } catch (_) {}
        try {
          fetchSessions();
        } catch (_) {}
        try {
          loadLogs();
        } catch (_) {}
        try {
          loadLogsList();
        } catch (_) {}
      });
    }
  } catch (_) {}

  // Listen for admin changes to sync button states across users
  try {
    if (window.SyncManager && typeof window.SyncManager.on === "function") {
      window.SyncManager.on("admin:changed", function (data) {
        try {
          console.debug("[admin] SyncManager received admin:changed", data);

          // Handle push maintain completion
          if (data && data.action === "push_maintain_completed") {
            const btn = document.getElementById("btnPushMaintain");
            if (btn) {
              const left = Number(data.seconds_left || 0);
              if (left > 0) {
                btn.disabled = true;
                btn.title = "Доступно через ~" + Math.ceil(left / 3600) + " ч";
              } else {
                btn.disabled = false;
                btn.removeAttribute("title");
              }
            }
          }
        } catch (e) {
          console.error("[admin] error in admin:changed handler", e);
        }
      });
    }
  } catch (_) {}

  // Also listen for direct socket events (fallback)
  try {
    if (window.socket && typeof window.socket.on === "function") {
      window.socket.on("admin:changed", function (data) {
        try {
          console.debug("[admin] socket received admin:changed", data);

          // Handle push maintain completion
          if (data && data.action === "push_maintain_completed") {
            const btn = document.getElementById("btnPushMaintain");
            if (btn) {
              const left = Number(data.seconds_left || 0);
              if (left > 0) {
                btn.disabled = true;
                btn.title = "Доступно через ~" + Math.ceil(left / 3600) + " ч";
              } else {
                btn.disabled = false;
                btn.removeAttribute("title");
              }
            }
          }
        } catch (e) {
          console.error("[admin] error in socket admin:changed handler", e);
        }
      });
    }
  } catch (_) {}
})();
