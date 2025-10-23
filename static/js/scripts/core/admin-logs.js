// Admin Logs Module
// Управление логами в админке

let selectedUser = null; // for log filter
let isLogPaused = false; // pause auto-refresh for logs when selecting
let lastContextRow = null; // remember row for context actions

function fetchLogs() {
  try {
    if (!isMainSocketConnected()) return Promise.resolve();

    const url = selectedUser
      ? `/admin/logs?user=${encodeURIComponent(selectedUser)}`
      : "/admin/logs";

    return fetch(url, { credentials: "same-origin" })
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
          renderLogs(j.logs || []);
        }
      })
      .catch(function (e) {
        return Promise.reject(e);
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "fetchLogs");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
    }
  }
}

function renderLogs(logs) {
  try {
    const container = document.getElementById("logs-container");
    if (!container) return;

    if (!logs || logs.length === 0) {
      container.innerHTML = "<p>Нет записей в логах</p>";
      return;
    }

    const html = logs
      .map((log) => {
        const timestamp = new Date(
          log.timestamp || Date.now()
        ).toLocaleString();
        const user = log.user || "Система";
        const action = log.action || "Неизвестно";
        const details = log.details || "";
        const level = log.level || "info";

        return `
          <div class="log-item log-${level}" data-log-id="${log.id || ""}">
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-user">${user}</span>
            <span class="log-action">${action}</span>
            <span class="log-details">${details}</span>
          </div>
        `;
      })
      .join("");

    container.innerHTML = html;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderLogs");
    } else {
      window.ErrorHandler.handleError(err, "unknown")
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
      window.ErrorHandler.handleError(err, "unknown")
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
      window.ErrorHandler.handleError(err, "unknown")
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

// Export functions to global scope
window.AdminLogs = {
  selectedUser,
  isLogPaused,
  lastContextRow,
  fetchLogs,
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
