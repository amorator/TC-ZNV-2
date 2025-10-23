// Admin Presence Module
// Управление присутствием пользователей в админке

let presenceItems = [];
let lastPresenceNonEmptyAt = 0;
let presenceCache = {}; // key -> { item, lastSeen }

function isJsonResponse(r) {
  try {
    const ct =
      (r.headers && r.headers.get && r.headers.get("Content-Type")) || "";
    return ct.indexOf("application/json") !== -1;
  } catch (_) {
    return false;
  }
}

function presenceKey(item) {
  try {
    if (!item || typeof item !== "object") return null;
    const user = item.user;
    const ip = item.ip;
    if (!user || !ip) return null;
    return user + "|" + ip;
  } catch (_) {
    return null;
  }
}

function fetchPresence() {
  try {
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
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchPresence");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

function renderPresence() {
  try {
    const container = document.getElementById("presence-container");
    if (!container) return;

    if (!presenceItems || presenceItems.length === 0) {
      container.innerHTML = "<p>Нет активных пользователей</p>";
      return;
    }

    const html = presenceItems
      .map((item) => {
        const user = item.user || "Неизвестно";
        const ip = item.ip || "Неизвестно";
        const lastSeen = item.lastSeen || Date.now();
        const timeAgo = Math.round((Date.now() - lastSeen) / 1000);
        return `
          <div class="presence-item">
            <span class="user-name">${user}</span>
            <span class="user-ip">${ip}</span>
            <span class="last-seen">${timeAgo}с назад</span>
          </div>
        `;
      })
      .join("");

    container.innerHTML = html;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderPresence");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

function emitPresence() {
  try {
    if (!isMainSocketConnected()) return;
    if (window.SyncManager && window.SyncManager.emit) {
      window.SyncManager.emit("admin_presence", { timestamp: Date.now() });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "emitPresence");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

// Export functions to global scope
window.AdminPresence = {
  presenceItems,
  presenceCache,
  fetchPresence,
  renderPresence,
  emitPresence,
  presenceKey,
  isJsonResponse,
};
