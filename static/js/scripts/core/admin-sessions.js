// Admin Sessions Module
// Управление сессиями пользователей в админке

let sessionsItems = [];
// Suppress recently terminated sessions from reappearing due to server lag
const suppressedSessions = Object.create(null); // sid -> expireTs

function markSessionSuppressed(sid, ms) {
  try {
    if (!sid) return;
    suppressedSessions[sid] = Date.now() + Math.max(1000, ms || 30000);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "markSessionSuppressed");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
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
    return fetch("/admin/sessions", { credentials: "same-origin" })
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
          const items = Array.isArray(j.items) ? j.items : [];
          // Filter out suppressed sessions
          const filteredItems = items.filter((item) => {
            const sid = item.sid || item.session_id;
            return !isSessionSuppressed(sid);
          });
          sessionsItems = filteredItems;
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
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

function renderSessions() {
  try {
    const container = document.getElementById("sessions-container");
    if (!container) return;

    if (!sessionsItems || sessionsItems.length === 0) {
      container.innerHTML = "<p>Нет активных сессий</p>";
      return;
    }

    const html = sessionsItems
      .map((item) => {
        const user = item.user || "Неизвестно";
        const ip = item.ip || "Неизвестно";
        const sid = item.sid || item.session_id || "Неизвестно";
        const createdAt = item.created_at || Date.now();
        const timeAgo = Math.round((Date.now() - createdAt) / 1000);
        return `
          <div class="session-item" data-sid="${sid}">
            <span class="user-name">${user}</span>
            <span class="user-ip">${ip}</span>
            <span class="session-id">${sid}</span>
            <span class="created-at">${timeAgo}с назад</span>
            <button class="terminate-session" onclick="terminateSession('${sid}')">
              Завершить
            </button>
          </div>
        `;
      })
      .join("");

    container.innerHTML = html;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderSessions");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

function terminateSession(sid) {
  try {
    if (!sid) return;

    if (window.ApiClient) {
      window.ApiClient.apiPost(`/admin/sessions/${sid}/terminate`, {})
        .then(() => {
          markSessionSuppressed(sid, 30000);
          fetchSessions();
          if (window.showToast) {
            window.showToast("Сессия завершена", "success");
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "terminateSession");
          }
        });
    } else {
      // Fallback to direct fetch
      fetch(`/admin/sessions/${sid}/terminate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            markSessionSuppressed(sid, 30000);
            fetchSessions();
            if (window.showToast) {
              window.showToast("Сессия завершена", "success");
            }
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "terminateSession");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "terminateSession");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

// Export functions to global scope
window.AdminSessions = {
  sessionsItems,
  suppressedSessions,
  markSessionSuppressed,
  isSessionSuppressed,
  fetchSessions,
  renderSessions,
  terminateSession,
};
