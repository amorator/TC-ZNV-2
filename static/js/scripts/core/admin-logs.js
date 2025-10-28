// Admin Logs Module
// Управление логами в админке

let selectedUser = null; // for log filter
let isLogPaused = false; // pause auto-refresh for logs when selecting
let lastContextRow = null; // remember row for context actions
let lastActionsFetch = 0; // prevent frequent actions fetching

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

function fetchLogs() {
  try {
    if (!isMainSocketConnected()) return Promise.resolve();

    const url = selectedUser
      ? `/admin/logs?user=${encodeURIComponent(selectedUser)}&full=true`
      : "/admin/logs?full=true";

    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) {
          return { status: "error" };
        }
        return r.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (_) {
            // If not JSON, treat as plain text log
            return {
              status: "success",
              logs: text.split("\n").filter((line) => line.trim()),
            };
          }
        });
      })
      .then((j) => {
        if (j && j.status === "success") {
          if (Array.isArray(j.logs)) {
            renderLogs(j.logs);
          } else if (typeof j.logs === "string") {
            renderLogs(j.logs.split("\n").filter((line) => line.trim()));
          }
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchLogs");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function renderLogs(logs) {
  try {
    const logsView = document.getElementById("logsView");
    if (!logsView) return;

    // Check if logsView contains actions log (starts with timestamp pattern)
    const currentContent = logsView.textContent;
    if (currentContent && currentContent.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
      return;
    }

    if (!logs || logs.length === 0) {
      logsView.textContent = "Нет записей в логах";
      return;
    }

    // If logs is already a string (from text response), use it directly
    if (typeof logs === "string") {
      // Escape HTML entities to prevent HTML rendering
      const escapedLogs = logs
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      logsView.textContent = escapedLogs;
      return;
    }

    // If logs is an array, format each entry
    const formattedLogs = logs
      .map((log) => {
        // If log is already a string, escape HTML and use it
        if (typeof log === "string") {
          return log
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        // If log is an object, format it
        if (typeof log === "object" && log !== null) {
          const timestamp = log.timestamp
            ? new Date(log.timestamp).toLocaleString()
            : new Date().toLocaleString();
          const user = log.user || "Система";
          const action = log.action || "Неизвестно";
          const details = log.details || "";
          const level = log.level || "info";

          // Escape HTML in all fields
          const escapedUser = String(user)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

          const escapedAction = String(action)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

          const escapedDetails = String(details)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

          return `${timestamp} | ${escapedUser} | ${escapedAction} | ${escapedDetails}`;
        }

        // Escape HTML in any other type
        return String(log)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      })
      .join("\n");

    logsView.textContent = formattedLogs;

    // Auto-scroll to bottom to show latest entries
    logsView.scrollTop = logsView.scrollHeight;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderLogs");
    }
  }
}

function setLogFilter(user) {
  try {
    selectedUser = user;
    isLogPaused = true;

    // Update UI
    const filterButtons = document.querySelectorAll(".log-filter-btn");
    filterButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    if (user) {
      const activeBtn = document.querySelector(`[data-user="${user}"]`);
      if (activeBtn) {
        activeBtn.classList.add("active");
      }
    }

    // Fetch filtered logs
    fetchLogs();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setLogFilter");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function clearLogFilter() {
  try {
    selectedUser = null;
    isLogPaused = false;

    // Update UI
    const filterButtons = document.querySelectorAll(".log-filter-btn");
    filterButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    // Fetch all logs
    fetchLogs();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "clearLogFilter");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function pauseLogRefresh() {
  try {
    isLogPaused = true;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "pauseLogRefresh");
    }
  }
}

function resumeLogRefresh() {
  try {
    isLogPaused = false;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "resumeLogRefresh");
    }
  }
}

function setupLogContextMenu() {
  try {
    const logItems = document.querySelectorAll(".log-item");
    logItems.forEach((item) => {
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        lastContextRow = item;
        showLogContextMenu(e.clientX, e.clientY, item);
      });
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupLogContextMenu");
    }
  }
}

function showLogContextMenu(x, y, logItem) {
  try {
    // Remove existing context menu
    const existingMenu = document.querySelector(".log-context-menu");
    if (existingMenu) {
      existingMenu.remove();
    }

    // Create context menu
    const menu = document.createElement("div");
    menu.className = "log-context-menu";
    menu.style.position = "fixed";
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.zIndex = "1000";

    const logId = logItem.dataset.logId;
    const user = logItem.querySelector(".log-user").textContent;

    menu.innerHTML = `
      <div class="context-menu-item" onclick="filterLogsByUser('${user}')">
        Фильтр по пользователю
      </div>
      <div class="context-menu-item" onclick="copyLogDetails('${logId}')">
        Копировать детали
      </div>
      <div class="context-menu-item" onclick="exportLogs()">
        Экспорт логов
      </div>
    `;

    document.body.appendChild(menu);

    // Close menu when clicking outside
    setTimeout(() => {
      document.addEventListener(
        "click",
        () => {
          menu.remove();
        },
        { once: true }
      );
    }, 100);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "showLogContextMenu");
    }
  }
}

function filterLogsByUser(user) {
  try {
    setLogFilter(user);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "filterLogsByUser");
    }
  }
}

function copyLogDetails(logId) {
  try {
    const logItem = document.querySelector(`[data-log-id="${logId}"]`);
    if (!logItem) return;

    const timestamp = logItem.querySelector(".log-timestamp").textContent;
    const user = logItem.querySelector(".log-user").textContent;
    const action = logItem.querySelector(".log-action").textContent;
    const details = logItem.querySelector(".log-details").textContent;

    const logText = `${timestamp} | ${user} | ${action} | ${details}`;

    navigator.clipboard
      .writeText(logText)
      .then(() => {
        if (window.showToast) {
          window.showToast("Детали лога скопированы", "success");
        }
      })
      .catch(() => {
        if (window.showToast) {
          window.showToast("Ошибка копирования", "error");
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "copyLogDetails");
    }
  }
}

function exportLogs() {
  try {
    if (window.ApiClient) {
      window.ApiClient.apiGet("/admin/logs/export")
        .then((data) => {
          if (data.success && data.downloadUrl) {
            window.open(data.downloadUrl, "_blank");
            if (window.showToast) {
              window.showToast("Экспорт логов начат", "success");
            }
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "exportLogs");
          }
        });
    } else {
      if (window.showToast) {
        window.showToast("Функция экспорта недоступна", "warning");
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "exportLogs");
    }
  }
}

function fetchFullLogs() {
  try {
    if (!isMainSocketConnected()) return Promise.resolve();

    const url = selectedUser
      ? `/admin/logs?user=${encodeURIComponent(
          selectedUser
        )}&full=true&from_start=true`
      : "/admin/logs?full=true&from_start=true";

    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) {
          return { status: "error" };
        }
        return r.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (_) {
            // If not JSON, treat as plain text log
            return {
              status: "success",
              logs: text.split("\n").filter((line) => line.trim()),
            };
          }
        });
      })
      .then((j) => {
        if (j && j.status === "success") {
          if (Array.isArray(j.logs)) {
            renderLogs(j.logs);
          } else if (typeof j.logs === "string") {
            renderLogs(j.logs.split("\n").filter((line) => line.trim()));
          }
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchFullLogs");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

function fetchActions() {
  try {
    // Prevent frequent fetching (max once per 2 seconds)
    const now = Date.now();
    if (now - lastActionsFetch < 2000) {
      return Promise.resolve();
    }
    lastActionsFetch = now;

    return fetch("/logs/actions", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) {
          return { status: "error" };
        }
        return r.text();
      })
      .then(function (text) {
        // Display actions log in logsView element
        const logsView = document.getElementById("logsView");
        if (logsView) {
          if (text && text.trim()) {
            // Split into lines and reverse order (newest first)
            const lines = text.split('\n').filter(line => line.trim());
            const reversedLines = lines.reverse();
            const sortedText = reversedLines.join('\n');
            
            // Escape HTML entities to prevent HTML rendering
            const escapedText = sortedText
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;");
            
            logsView.textContent = escapedText;
          } else {
            logsView.textContent = "Нет записей в журнале действий";
          }
        }
      })
      .catch(function (e) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(e, "fetchActions");
        }
        return Promise.reject(e);
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchActions");
    } else {
      window.ErrorHandler.handleError(err, "unknown");
    }
  }
}

// Export functions to global scope
window.AdminLogs = {
  selectedUser,
  isLogPaused,
  lastContextRow,
  fetchLogs,
  fetchFullLogs,
  fetchActions,
  renderLogs,
  setLogFilter,
  clearLogFilter,
  pauseLogRefresh,
  resumeLogRefresh,
  setupLogContextMenu,
  showLogContextMenu,
  filterLogsByUser,
  copyLogDetails,
  exportLogs,
};
