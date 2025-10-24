// Admin Sessions Module
// Управление сессиями пользователей в админке

let sessionsItems = [];
// Suppress recently terminated sessions from reappearing due to server lag
const suppressedSessions = Object.create(null); // sid -> expireTs
let sessionsRealtimeEnabled = true;
let sessionsLastUpdate = 0;

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

function markSessionSuppressed(sid, ms) {
  try {
    if (!sid) return;
    suppressedSessions[sid] = Date.now() + Math.max(1000, ms || 30000);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "markSessionSuppressed");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
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

function fetchSessions() {
  try {
    if (!isMainSocketConnected()) return Promise.resolve();

    // Сначала попробовать Redis endpoint
    return fetch("/admin/sessions/redis", { credentials: "same-origin" })
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
          const items = Array.isArray(data.items) ? data.items : [];

          // Filter out suppressed sessions
          const filteredItems = items.filter((item) => {
            const sid = item.sid || item.session_id;
            return !isSessionSuppressed(sid);
          });

          // Remove duplicates by sid and user+ip combination
          const uniqueItems = [];
          const seenSids = new Set();
          const seenUserIp = new Set();

          for (const item of filteredItems) {
            const sid = item.sid || item.session_id;
            const userIp = `${item.user || ""}|${item.ip || ""}`;

            // Check both sid and user+ip combination to prevent duplicates
            if (sid && !seenSids.has(sid) && !seenUserIp.has(userIp)) {
              seenSids.add(sid);
              seenUserIp.add(userIp);
              uniqueItems.push(item);
            }
          }

          sessionsItems = uniqueItems;
          renderSessions();
          return;
        }

        // Fallback к обычному endpoint
        return fetch("/admin/sessions", { credentials: "same-origin" });
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
          const items = Array.isArray(j.items) ? j.items : [];

          // Filter out suppressed sessions
          const filteredItems = items.filter((item) => {
            const sid = item.sid || item.session_id;
            return !isSessionSuppressed(sid);
          });

          // Remove duplicates by sid and user+ip combination
          const uniqueItems = [];
          const seenSids = new Set();
          const seenUserIp = new Set();

          for (const item of filteredItems) {
            const sid = item.sid || item.session_id;
            const userIp = `${item.user || ""}|${item.ip || ""}`;

            // Check both sid and user+ip combination to prevent duplicates
            if (sid && !seenSids.has(sid) && !seenUserIp.has(userIp)) {
              seenSids.add(sid);
              seenUserIp.add(userIp);
              uniqueItems.push(item);
            }
          }

          sessionsItems = uniqueItems;
          renderSessions();
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchSessions");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function renderSessions() {
  try {
    const table = document.getElementById("sessionsTable");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    if (!sessionsItems || sessionsItems.length === 0) {
      tbody.innerHTML =
        "<tr><td colspan='4' class='text-center'>Нет активных сессий</td></tr>";
      return;
    }

    // Sort by user name alphabetically
    const sortedItems = [...sessionsItems].sort((a, b) => {
      const userA = (a.user || "").toString().toLowerCase();
      const userB = (b.user || "").toString().toLowerCase();
      return userA.localeCompare(userB);
    });

    const html = sortedItems
      .map((item) => {
        const user = item.user || "Неизвестно";
        const ip = item.ip || "Неизвестно";
        const ua = item.ua || "Неизвестно";
        const sid = item.sid || item.session_id || "Неизвестно";

        // Calculate time ago properly
        let timeAgo = "Неизвестно";

        if (item.last_activity) {
          let lastActivity;

          if (typeof item.last_activity === "number") {
            // Check if timestamp is in seconds or milliseconds
            if (item.last_activity > 1000000000000) {
              // Already in milliseconds
              lastActivity = item.last_activity;
            } else {
              // Convert from seconds to milliseconds
              lastActivity = item.last_activity * 1000;
            }
          } else if (typeof item.last_activity === "string") {
            // Try to parse string timestamp
            const parsed = new Date(item.last_activity).getTime();
            if (!isNaN(parsed)) {
              lastActivity = parsed;
            }
          }

          if (lastActivity && lastActivity > 0) {
            const now = Date.now();
            const diffMs = now - lastActivity;
            const diffSeconds = Math.floor(diffMs / 1000);

            if (diffSeconds < 60) {
              timeAgo = `${diffSeconds}с назад`;
            } else if (diffSeconds < 3600) {
              const minutes = Math.floor(diffSeconds / 60);
              timeAgo = `${minutes}м назад`;
            } else {
              const hours = Math.floor(diffSeconds / 3600);
              timeAgo = `${hours}ч назад`;
            }
          } else {
            timeAgo = "Неизвестно";
          }
        } else {
          timeAgo = "Неизвестно";
        }

        return `
          <tr class="table__body_row" data-sid="${sid}">
            <td class="table__body_item">${user}</td>
            <td class="table__body_item">${ip}</td>
            <td class="table__body_item">${ua}</td>
            <td class="table__body_item text-end">
              ${timeAgo}
              <button class="btn btn-sm btn-outline-danger ms-2" onclick="terminateSession('${sid}')">
                Завершить
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = html;

    // Update time display every second for real-time updates
    if (sessionsItems.length > 0) {
      // Clear existing interval if any
      if (window._sessionsTimeUpdateInterval) {
        clearInterval(window._sessionsTimeUpdateInterval);
      }

      // Use Background Activity Manager for time updates
      if (window.BackgroundActivityManager) {
        // Check if activity is already registered to avoid duplicates
        if (
          !window.BackgroundActivityManager.getActivities().includes(
            "admin-sessions-time-updates"
          )
        ) {
          window.BackgroundActivityManager.register(
            "admin-sessions-time-updates",
            {
              start: () => {
                updateSessionsTimeDisplay();
              },
              stop: () => {
                if (window._sessionsTimeUpdateInterval) {
                  clearInterval(window._sessionsTimeUpdateInterval);
                  window._sessionsTimeUpdateInterval = null;
                }
              },
              interval: 1000,
              autoStart: true,
            }
          );
        }
      } else {
        // Fallback to direct interval
        if (!window._sessionsTimeUpdateInterval) {
          window._sessionsTimeUpdateInterval = setInterval(() => {
            updateSessionsTimeDisplay();
          }, 1000);
        }
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderSessions");
    }
  }
}

/**
 * Update time display for sessions without re-fetching data
 */
function updateSessionsTimeDisplay() {
  try {
    const table = document.getElementById("sessionsTable");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr.table__body_row");
    rows.forEach((row) => {
      const sid = row.getAttribute("data-sid");
      if (!sid) return;

      const sessionItem = sessionsItems.find(
        (item) => (item.sid || item.session_id) === sid
      );

      if (sessionItem && sessionItem.last_activity) {
        let lastActivity;

        if (typeof sessionItem.last_activity === "number") {
          // Check if timestamp is in seconds or milliseconds
          if (sessionItem.last_activity > 1000000000000) {
            // Already in milliseconds
            lastActivity = sessionItem.last_activity;
          } else {
            // Convert from seconds to milliseconds
            lastActivity = sessionItem.last_activity * 1000;
          }
        } else if (typeof sessionItem.last_activity === "string") {
          // Try to parse string timestamp
          const parsed = new Date(sessionItem.last_activity).getTime();
          if (!isNaN(parsed)) {
            lastActivity = parsed;
          }
        }

        let timeAgo = "Неизвестно";

        if (lastActivity && lastActivity > 0) {
          const now = Date.now();
          const diffMs = now - lastActivity;
          const diffSeconds = Math.floor(diffMs / 1000);

          if (diffSeconds < 60) {
            timeAgo = `${diffSeconds}с назад`;
          } else if (diffSeconds < 3600) {
            const minutes = Math.floor(diffSeconds / 60);
            timeAgo = `${minutes}м назад`;
          } else {
            const hours = Math.floor(diffSeconds / 3600);
            timeAgo = `${hours}ч назад`;
          }
        }

        const timeCell = row.querySelector("td:last-child");
        if (timeCell) {
          const button = timeCell.querySelector("button");
          if (button) {
            timeCell.innerHTML = `${timeAgo} <button class="btn btn-sm btn-outline-danger ms-2" onclick="terminateSession('${sid}')">Завершить</button>`;
          }
        }
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateSessionsTimeDisplay");
    }
  }
}

function terminateSession(sid) {
  try {
    if (!sid) return;

    // Immediately remove session from UI and mark as suppressed
    markSessionSuppressed(sid, 60000); // 60 seconds suppression
    removeSessionFromUI(sid);

    if (window.ApiClient) {
      window.ApiClient.apiPost("/admin/force_logout_session", { sid: sid })
        .then((response) => {
          if (response.status === "success") {
            if (window.showToast) {
              window.showToast("Сессия завершена", "success");
            }
            // Trigger hard refresh for the user
            triggerUserHardRefresh(sid);
          } else {
            if (window.showToast) {
              window.showToast(
                response.message || "Ошибка при завершении сессии",
                "error"
              );
            }
            // Restore session in UI if error
            fetchSessions();
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "terminateSession");
          }
          if (window.showToast) {
            window.showToast("Ошибка при завершении сессии", "error");
          }
          // Restore session in UI if error
          fetchSessions();
        });
    } else {
      // Fallback to direct fetch
      fetch("/admin/force_logout_session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sid: sid }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.status === "success") {
            if (window.showToast) {
              window.showToast("Сессия завершена", "success");
            }
            // Trigger hard refresh for the user
            triggerUserHardRefresh(sid);
          } else {
            if (window.showToast) {
              window.showToast(
                data.message || "Ошибка при завершении сессии",
                "error"
              );
            }
            // Restore session in UI if error
            fetchSessions();
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "terminateSession");
          }
          if (window.showToast) {
            window.showToast("Ошибка при завершении сессии", "error");
          }
          // Restore session in UI if error
          fetchSessions();
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "terminateSession");
    }
    if (window.showToast) {
      window.showToast("Ошибка при завершении сессии", "error");
    }
  }
}

/**
 * Remove session from UI immediately
 */
function removeSessionFromUI(sid) {
  try {
    // Remove from sessionsItems array
    sessionsItems = sessionsItems.filter(
      (item) => (item.sid || item.session_id) !== sid
    );

    // Remove from DOM
    const table = document.getElementById("sessionsTable");
    if (table) {
      const tbody = table.querySelector("tbody");
      if (tbody) {
        const row = tbody.querySelector(`tr[data-sid="${sid}"]`);
        if (row) {
          row.remove();
        }
      }
    }

    // If no sessions left, show empty message
    if (sessionsItems.length === 0) {
      const table = document.getElementById("sessionsTable");
      if (table) {
        const tbody = table.querySelector("tbody");
        if (tbody) {
          tbody.innerHTML =
            "<tr><td colspan='4' class='text-center'>Нет активных сессий</td></tr>";
        }
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "removeSessionFromUI");
    }
  }
}

/**
 * Trigger hard refresh for the user whose session was terminated
 */
function triggerUserHardRefresh(sid) {
  try {
    // Find the session item to get user info
    const sessionItem = sessionsItems.find(
      (item) => (item.sid || item.session_id) === sid
    );

    if (sessionItem && sessionItem.user) {
      console.log(`Triggering hard refresh for user: ${sessionItem.user}`);

      // Send socket event to force user logout and hard refresh
      if (window.SyncManager && window.SyncManager.getSocket) {
        const socket = window.SyncManager.getSocket();
        if (socket) {
          socket.emit("force-user-refresh", {
            user: sessionItem.user,
            reason: "session_terminated",
            message:
              "Ваша сессия была завершена администратором. Страница будет обновлена.",
          });
        }
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "triggerUserHardRefresh");
    }
  }
}

/**
 * Update sessions data in real-time from socket events
 */
function updateSessionsRealtime(data) {
  try {
    if (!data || !sessionsRealtimeEnabled) return;

    const now = Date.now();

    // Prevent too frequent updates (max once per 500ms)
    if (now - sessionsLastUpdate < 500) return;
    sessionsLastUpdate = now;

    if (data.type === "full_update" && Array.isArray(data.items)) {
      // Full update from Redis cache
      sessionsItems = data.items;
      renderSessions();
    } else if (data.type === "session_created") {
      // New session created
      handleSessionCreated(data);
    } else if (data.type === "session_terminated") {
      // Session terminated
      handleSessionTerminated(data);
    } else if (data.type === "session_activity") {
      // Session activity update
      handleSessionActivity(data);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateSessionsRealtime");
    }
  }
}

/**
 * Handle session created event
 */
function handleSessionCreated(data) {
  try {
    if (!data || !data.sid) return;

    const now = Date.now();

    // Check if session already exists
    const existingIndex = sessionsItems.findIndex(
      (item) => (item.sid || item.session_id) === data.sid
    );

    if (existingIndex < 0) {
      // Add new session
      sessionsItems.push({
        sid: data.sid,
        session_id: data.sid,
        user: data.user || "Неизвестно",
        ip: data.ip || "Неизвестно",
        ua: data.ua || "Неизвестно",
        last_activity: data.last_activity || now,
      });
      renderSessions();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleSessionCreated");
    }
  }
}

/**
 * Handle session terminated event
 */
function handleSessionTerminated(data) {
  try {
    if (!data || !data.sid) return;

    // Mark as suppressed
    markSessionSuppressed(data.sid, 60000);

    // Remove from UI immediately
    removeSessionFromUI(data.sid);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleSessionTerminated");
    }
  }
}

/**
 * Handle session activity update
 */
function handleSessionActivity(data) {
  try {
    if (!data || !data.sid) return;

    const now = Date.now();
    const existingIndex = sessionsItems.findIndex(
      (item) => (item.sid || item.session_id) === data.sid
    );

    if (existingIndex >= 0) {
      // Update existing session
      sessionsItems[existingIndex] = {
        ...sessionsItems[existingIndex],
        last_activity: data.last_activity || now,
        user: data.user || sessionsItems[existingIndex].user,
        ip: data.ip || sessionsItems[existingIndex].ip,
        ua: data.ua || sessionsItems[existingIndex].ua,
      };
      renderSessions();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleSessionActivity");
    }
  }
}

/**
 * Handle force logout all event
 */
function handleForceLogoutAll(data) {
  try {
    if (!data) return;

    // Clear all sessions immediately
    sessionsItems = [];
    renderSessions();

    // Don't show toast here - it will be shown by the main handler after confirmation
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleForceLogoutAll");
    }
  }
}

/**
 * Enable/disable real-time updates
 */
function setSessionsRealtimeEnabled(enabled) {
  sessionsRealtimeEnabled = enabled;
}

/**
 * Get sessions statistics
 */
function getSessionsStats() {
  return {
    totalSessions: sessionsItems.length,
    lastUpdate: sessionsLastUpdate,
    realtimeEnabled: sessionsRealtimeEnabled,
    suppressedCount: Object.keys(suppressedSessions).length,
  };
}

// Export functions to global scope
window.AdminSessions = {
  sessionsItems,
  suppressedSessions,
  markSessionSuppressed,
  isSessionSuppressed,
  fetchSessions,
  renderSessions,
  updateSessionsTimeDisplay,
  terminateSession,
  removeSessionFromUI,
  triggerUserHardRefresh,
  updateSessionsRealtime,
  handleSessionCreated,
  handleSessionTerminated,
  handleSessionActivity,
  handleForceLogoutAll,
  setSessionsRealtimeEnabled,
  getSessionsStats,
};
