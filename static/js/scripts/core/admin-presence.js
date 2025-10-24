// Admin Presence Module
// Управление присутствием пользователей в админке

let presenceItems = [];
let lastPresenceNonEmptyAt = 0;
let presenceCache = {}; // key -> { item, lastSeen }
let presenceRealtimeEnabled = true;
let presenceLastUpdate = 0;

function isJsonResponse(r) {
  try {
    const ct =
      (r.headers && r.headers.get && r.headers.get("Content-Type")) || "";
    return ct.indexOf("application/json") !== -1;
  } catch (_) {
    return false;
  }
}

function isMainSocketConnected() {
  try {
    const s =
      (window.SyncManager &&
        typeof window.SyncManager.getSocket === "function" &&
        window.SyncManager.getSocket()) ||
      window.socket;
    return !!(s && s.connected);
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

    // Сначала попробовать Redis endpoint
    return fetch("/admin/presence/redis", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok || !isJsonResponse(r)) {
          return { status: "error" };
        }
        return r.json().catch(function () {
          return { status: "error" };
        });
      })
      .then((data) => {
        if (data && data.status === "success" && data.source === "redis") {
          // Данные из Redis - быстрее и точнее
          const now = Date.now();
          const items = Array.isArray(data.items) ? data.items : [];

          // Build new map from Redis
          const freshMap = {};
          for (let i = 0; i < items.length; i++) {
            const it = items[i] || {};
            const k = presenceKey(it);
            if (!k) continue;
            freshMap[k] = it;
          }

          // Update cache with Redis data
          presenceCache = {};
          const mergedItems = [];
          Object.keys(freshMap).forEach(function (k) {
            const it = freshMap[k];
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
          return;
        }

        // Fallback к обычному endpoint
        return fetch("/admin/presence", { credentials: "same-origin" });
      })
      .then(function (r) {
        if (!r || !r.ok || !isJsonResponse(r)) {
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
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function renderPresence() {
  try {
    const table = document.getElementById("presenceTable");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    if (!presenceItems || presenceItems.length === 0) {
      tbody.innerHTML =
        "<tr><td colspan='4' class='text-center'>Нет активных пользователей</td></tr>";
      return;
    }

    // Sort by user name alphabetically
    const sortedItems = [...presenceItems].sort((a, b) => {
      const userA = (a.user || "").toString().toLowerCase();
      const userB = (b.user || "").toString().toLowerCase();
      return userA.localeCompare(userB);
    });

    const html = sortedItems
      .map((item) => {
        const user = item.user || "Неизвестно";
        const ip = item.ip || "Неизвестно";
        const ua = item.ua || "Неизвестно";
        const page = item.page || "Неизвестно";
        const lastSeen = item.lastSeen || Date.now();
        const timeAgo = Math.round((Date.now() - lastSeen) / 1000);
        return `
          <tr class="table__body_row">
            <td class="table__body_item">${user}</td>
            <td class="table__body_item">${ip}</td>
            <td class="table__body_item">${ua}</td>
            <td class="table__body_item">${page}</td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = html;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderPresence");
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
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

/**
 * Update presence data in real-time from socket events
 */
function updatePresenceRealtime(data) {
  try {
    if (!data || !presenceRealtimeEnabled) return;

    const now = Date.now();

    // Prevent too frequent updates (max once per 500ms)
    if (now - presenceLastUpdate < 500) return;
    presenceLastUpdate = now;

    if (data.type === "full_update" && Array.isArray(data.items)) {
      // Full update from Redis cache
      presenceItems = data.items;
      renderPresence();
    } else if (data.type === "user_activity") {
      // Single user activity update
      handleUserActivityUpdate(data);
    } else if (data.type === "user_login") {
      // User logged in
      handleUserLoginUpdate(data);
    } else if (data.type === "user_logout") {
      // User logged out
      handleUserLogoutUpdate(data);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updatePresenceRealtime");
    }
  }
}

/**
 * Handle user activity heartbeat updates
 */
function handleUserHeartbeat(data) {
  try {
    if (!data || !data.user) return;

    const userKey = `${data.user}|${data.ip || ""}`;
    const now = Date.now();

    // Update cache
    presenceCache[userKey] = {
      item: {
        user: data.user,
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        page: data.page || "Неизвестно",
        lastSeen: now,
      },
      lastSeen: now,
    };

    // Update presence items
    const existingIndex = presenceItems.findIndex(
      (item) => item.user === data.user && item.ip === data.ip
    );

    if (existingIndex >= 0) {
      // Update existing user
      presenceItems[existingIndex] = {
        ...presenceItems[existingIndex],
        lastSeen: now,
        page: data.page || presenceItems[existingIndex].page,
      };
    } else {
      // Add new user
      presenceItems.push({
        user: data.user,
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        page: data.page || "Неизвестно",
        lastSeen: now,
      });
    }

    renderPresence();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserHeartbeat");
    }
  }
}

/**
 * Handle user login event
 */
function handleUserLogin(data) {
  try {
    if (!data || !data.user) return;

    const now = Date.now();
    const userKey = `${data.user}|${data.ip || ""}`;

    // Update cache
    presenceCache[userKey] = {
      item: {
        user: data.user,
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        page: data.page || "Неизвестно",
        lastSeen: now,
      },
      lastSeen: now,
    };

    // Add to presence items if not exists
    const existingIndex = presenceItems.findIndex(
      (item) => item.user === data.user && item.ip === data.ip
    );

    if (existingIndex < 0) {
      presenceItems.push({
        user: data.user,
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        page: data.page || "Неизвестно",
        lastSeen: now,
      });
      renderPresence();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserLogin");
    }
  }
}

/**
 * Handle user logout event
 */
function handleUserLogout(data) {
  try {
    if (!data || !data.user) return;

    // Remove from presence items
    presenceItems = presenceItems.filter(
      (item) => !(item.user === data.user && item.ip === data.ip)
    );

    // Remove from cache
    const userKey = `${data.user}|${data.ip || ""}`;
    delete presenceCache[userKey];

    renderPresence();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserLogout");
    }
  }
}

/**
 * Handle user activity update (heartbeat)
 */
function handleUserActivityUpdate(data) {
  try {
    if (!data || !data.user) return;

    const now = Date.now();
    const existingIndex = presenceItems.findIndex(
      (item) => item.user === data.user && item.ip === data.ip
    );

    if (existingIndex >= 0) {
      presenceItems[existingIndex] = {
        ...presenceItems[existingIndex],
        lastSeen: now,
        page: data.page || presenceItems[existingIndex].page,
      };
      renderPresence();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserActivityUpdate");
    }
  }
}

/**
 * Handle user login update
 */
function handleUserLoginUpdate(data) {
  try {
    if (!data || !data.user) return;

    const now = Date.now();
    const existingIndex = presenceItems.findIndex(
      (item) => item.user === data.user && item.ip === data.ip
    );

    if (existingIndex < 0) {
      presenceItems.push({
        user: data.user,
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        page: data.page || "Неизвестно",
        lastSeen: now,
      });
      renderPresence();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserLoginUpdate");
    }
  }
}

/**
 * Handle user logout update
 */
function handleUserLogoutUpdate(data) {
  try {
    if (!data || !data.user) return;

    presenceItems = presenceItems.filter(
      (item) => !(item.user === data.user && item.ip === data.ip)
    );
    renderPresence();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleUserLogoutUpdate");
    }
  }
}

/**
 * Enable/disable real-time updates
 */
function setRealtimeEnabled(enabled) {
  presenceRealtimeEnabled = enabled;
}

/**
 * Get presence statistics
 */
function getPresenceStats() {
  return {
    totalUsers: presenceItems.length,
    lastUpdate: presenceLastUpdate,
    realtimeEnabled: presenceRealtimeEnabled,
    cacheSize: Object.keys(presenceCache).length,
  };
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
  isMainSocketConnected,
  updatePresenceRealtime,
  handleUserHeartbeat,
  handleUserLogin,
  handleUserLogout,
  setRealtimeEnabled,
  getPresenceStats,
};
