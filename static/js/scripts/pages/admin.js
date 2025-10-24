/**
 * Admin Page - Modular Version
 * Основной файл страницы администрирования, использующий модули
 */

// Initialize client ID for socket synchronization
window.__adminClientId =
  window.__adminClientId ||
  `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Initialize admin page
 */
function initAdminPage() {
  try {
    // Ensure push debug is enabled
    window.DEBUG_PUSH = true;

    // Setup socket connection
    setupSocket();

    // Setup UI components
    setupPresenceMonitoring();
    setupSessionsMonitoring();
    setupLogsMonitoring();
    setupContextMenus();

    // Start initial data loading
    loadInitialData();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initAdminPage");
    }
  }
}

/**
 * Setup socket connection
 */
function setupSocket() {
  try {
    if (!window.SyncManager) {
      console.warn("SyncManager not available");
      return;
    }

    const socket = window.SyncManager.getSocket();
    if (!socket) return;

    // Join admin room for real-time updates
    socket.emit("join-room", "admin");

    // Setup real-time event listeners
    setupRealtimeListeners(socket);

    // Setup socket event listeners
    socket.on("admin_presence_update", () => {
      if (window.AdminPresence && window.AdminPresence.fetchPresence) {
        window.AdminPresence.fetchPresence();
      }
    });

    socket.on("admin_sessions_update", () => {
      if (window.AdminSessions && window.AdminSessions.fetchSessions) {
        window.AdminSessions.fetchSessions();
      }
    });

    socket.on("admin_logs_update", () => {
      if (window.AdminLogs && window.AdminLogs.fetchLogs) {
        window.AdminLogs.fetchLogs();
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupSocket");
    }
  }
}

/**
 * Setup real-time event listeners for instant updates
 */
function setupRealtimeListeners(socket) {
  try {
    // Real-time presence updates
    socket.on("admin:presence:update", (data) => {
      if (window.AdminPresence && window.AdminPresence.updatePresenceRealtime) {
        window.AdminPresence.updatePresenceRealtime(data);
      }
    });

    // Real-time sessions updates
    socket.on("admin:sessions:update", (data) => {
      if (window.AdminSessions && window.AdminSessions.updateSessionsRealtime) {
        window.AdminSessions.updateSessionsRealtime(data);
      }
    });

    // Real-time logs updates
    socket.on("admin:logs:update", (data) => {
      if (window.AdminLogs && window.AdminLogs.updateLogsRealtime) {
        window.AdminLogs.updateLogsRealtime(data);
      }
    });

    // User session terminated event
    socket.on("admin:session:terminated", (data) => {
      if (
        window.AdminSessions &&
        window.AdminSessions.handleSessionTerminated
      ) {
        window.AdminSessions.handleSessionTerminated(data);
      }
    });

    // Force logout all event
    socket.on("admin:force_logout_all", (data) => {
      if (window.AdminSessions && window.AdminSessions.handleForceLogoutAll) {
        window.AdminSessions.handleForceLogoutAll(data);
      }
    });

    // User activity heartbeat
    socket.on("user:heartbeat", (data) => {
      if (window.AdminPresence && window.AdminPresence.handleUserHeartbeat) {
        window.AdminPresence.handleUserHeartbeat(data);
      }
    });

    // User login/logout events
    socket.on("user:login", (data) => {
      if (window.AdminPresence && window.AdminPresence.handleUserLogin) {
        window.AdminPresence.handleUserLogin(data);
      }
    });

    socket.on("user:logout", (data) => {
      if (window.AdminPresence && window.AdminPresence.handleUserLogout) {
        window.AdminPresence.handleUserLogout(data);
      }
    });

    // Force refresh event
    socket.on("force-refresh", (data) => {
      try {
        console.log("Force refresh received on admin page", data);
        // Show notification before refresh
        if (window.showToast) {
          window.showToast(
            "Админ-панель будет обновлена администратором",
            "warning"
          );
        }
        // Hard refresh the page
        setTimeout(() => {
          // Force hard refresh by adding cache-busting parameter
          const url = new URL(window.location);
          url.searchParams.set("_refresh", Date.now());
          window.location.href = url.toString();
        }, 1000);
      } catch (err) {
        console.error("Force refresh error:", err);
      }
    });

    // Files refresh event
    socket.on("files-refresh", (data) => {
      try {
        console.log("Files refresh received on admin page", data);
        // Show notification
        if (window.showToast) {
          window.showToast(
            `Обслуживание файлов завершено. Обновлено: ${data.updated}, Создано: ${data.created}`,
            "success"
          );
        }
      } catch (err) {
        console.error("Files refresh error:", err);
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupRealtimeListeners");
    }
  }
}

/**
 * Setup presence monitoring
 */
function setupPresenceMonitoring() {
  try {
    // Setup presence monitoring with SocketOptimizer
    if (window.SocketOptimizer) {
      window.SocketOptimizer.createPresenceMonitor(() => {
        if (window.AdminPresence && window.AdminPresence.emitPresence) {
          window.AdminPresence.emitPresence();
        }
      });
    } else {
      // Fallback to regular interval
      setInterval(() => {
        if (window.AdminPresence && window.AdminPresence.emitPresence) {
          window.AdminPresence.emitPresence();
        }
      }, 5000);
    }

    // Setup automatic presence data fetching with Background Activity Manager
    if (window.BackgroundActivityManager) {
      window.BackgroundActivityManager.register("admin-presence-polling", {
        start: () => {
          if (window.AdminPresence && window.AdminPresence.fetchPresence) {
            window.AdminPresence.fetchPresence();
          }
        },
        stop: () => {
          // No specific stop action needed
        },
        interval: 10000,
        autoStart: true,
      });
    } else if (window.SocketOptimizer) {
      window.SocketOptimizer.createAdaptiveInterval(
        "presence",
        () => {
          if (window.AdminPresence && window.AdminPresence.fetchPresence) {
            window.AdminPresence.fetchPresence();
          }
        },
        null
      );
    } else {
      // Fallback to regular interval for presence data
      setInterval(() => {
        if (window.AdminPresence && window.AdminPresence.fetchPresence) {
          window.AdminPresence.fetchPresence();
        }
      }, 10000); // Update every 10 seconds
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupPresenceMonitoring");
    }
  }
}

/**
 * Setup sessions monitoring
 */
function setupSessionsMonitoring() {
  try {
    // Setup sessions monitoring with Background Activity Manager
    if (window.BackgroundActivityManager) {
      window.BackgroundActivityManager.register("admin-sessions-polling", {
        start: () => {
          if (window.AdminSessions && window.AdminSessions.fetchSessions) {
            window.AdminSessions.fetchSessions();
          }
        },
        stop: () => {
          // No specific stop action needed
        },
        interval: 10000,
        autoStart: true,
      });
    } else if (window.SocketOptimizer) {
      window.SocketOptimizer.createAdaptiveInterval(
        "sessions",
        () => {
          if (window.AdminSessions && window.AdminSessions.fetchSessions) {
            window.AdminSessions.fetchSessions();
          }
        },
        null
      );
    } else {
      // Fallback to regular interval
      setInterval(() => {
        if (window.AdminSessions && window.AdminSessions.fetchSessions) {
          window.AdminSessions.fetchSessions();
        }
      }, 10000);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupSessionsMonitoring");
    }
  }
}

/**
 * Setup logs monitoring
 */
function setupLogsMonitoring() {
  try {
    // Setup logs monitoring with more frequent updates
    if (window.SocketOptimizer) {
      window.SocketOptimizer.createAdaptiveInterval(
        "logs",
        () => {
          if (window.AdminLogs && window.AdminLogs.fetchLogs) {
            window.AdminLogs.fetchLogs();
          }
        },
        null
      );
    } else {
      // Fallback to regular interval - more frequent for real-time logs
      setInterval(() => {
        if (window.AdminLogs && window.AdminLogs.fetchLogs) {
          window.AdminLogs.fetchLogs();
        }
      }, 5000); // Update every 5 seconds for real-time logs
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupLogsMonitoring");
    }
  }
}

/**
 * Setup context menus
 */
function setupContextMenus() {
  try {
    // Setup context menus for logs
    if (window.AdminLogs && window.AdminLogs.setupLogContextMenu) {
      window.AdminLogs.setupLogContextMenu();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupContextMenus");
    }
  }
}

/**
 * Load initial data
 */
function loadInitialData() {
  try {
    // Load presence data
    if (window.AdminPresence && window.AdminPresence.fetchPresence) {
      window.AdminPresence.fetchPresence();
    }

    // Load sessions data
    if (window.AdminSessions && window.AdminSessions.fetchSessions) {
      window.AdminSessions.fetchSessions();
    }

    // Load logs data
    if (window.AdminLogs && window.AdminLogs.fetchLogs) {
      window.AdminLogs.fetchLogs();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "loadInitialData");
    }
  }
}

/**
 * Setup button handlers
 */
function setupButtonHandlers() {
  try {
    // Refresh presence button
    const btnRefreshPresence = document.getElementById("btnRefreshPresence");
    if (btnRefreshPresence) {
      btnRefreshPresence.addEventListener("click", () => {
        if (window.AdminPresence && window.AdminPresence.fetchPresence) {
          window.AdminPresence.fetchPresence();
        }
      });
    }

    // Refresh sessions button
    const btnRefreshSessions = document.getElementById("btnRefreshSessions");
    if (btnRefreshSessions) {
      btnRefreshSessions.addEventListener("click", () => {
        if (window.AdminSessions && window.AdminSessions.fetchSessions) {
          window.AdminSessions.fetchSessions();
        }
      });
    }

    // Force logout all sessions button
    const adminForceLogoutBtn = document.getElementById("adminForceLogoutBtn");
    if (adminForceLogoutBtn) {
      adminForceLogoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log("Force logout button clicked");

        // Use async/await to properly wait for confirmation
        const confirmed = await new Promise((resolve) => {
          const result = confirm(
            "Вы уверены, что хотите разорвать все сессии? Все пользователи будут принудительно разлогинены."
          );
          resolve(result);
        });

        if (confirmed) {
          console.log("User confirmed force logout");
          handleForceLogoutAll();
        } else {
          console.log("User cancelled force logout");
        }
      });
    }

    // Force refresh all pages button
    const adminForceRefreshBtn = document.getElementById(
      "adminForceRefreshBtn"
    );
    if (adminForceRefreshBtn) {
      adminForceRefreshBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log("Force refresh button clicked");

        // Use async/await to properly wait for confirmation
        const confirmed = await new Promise((resolve) => {
          const result = confirm(
            "Вы уверены, что хотите принудительно обновить все страницы? Все пользователи получат хард рефреш."
          );
          resolve(result);
        });

        if (confirmed) {
          console.log("User confirmed force refresh");
          handleForceRefreshAll();
        } else {
          console.log("User cancelled force refresh");
        }
      });
    }

    // Push maintenance button
    const btnPushMaintain = document.getElementById("btnPushMaintain");
    if (btnPushMaintain) {
      btnPushMaintain.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Use async/await to properly wait for confirmation
        const confirmed = await new Promise((resolve) => {
          const result = confirm(
            "Начать обслуживание таблицы подписок на уведомления? Это может занять некоторое время."
          );
          resolve(result);
        });

        if (confirmed) {
          handlePushMaintenance();
        }
      });
    }

    // Files maintenance button
    const btnFilesMaintain = document.getElementById("btnFilesMaintain");
    if (btnFilesMaintain) {
      btnFilesMaintain.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Use async/await to properly wait for confirmation
        const confirmed = await new Promise((resolve) => {
          const result = confirm(
            "Начать обслуживание таблицы файлов? Это обновит размеры, длительности и создаст записи для новых файлов. Это может занять некоторое время."
          );
          resolve(result);
        });

        if (confirmed) {
          handleFilesMaintenance();
        }
      });
    }

    // Log search input
    const logSearch = document.getElementById("logSearch");
    if (logSearch) {
      logSearch.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        if (query) {
          if (window.AdminLogs && window.AdminLogs.setLogFilter) {
            window.AdminLogs.setLogFilter(query);
          }
        } else {
          if (window.AdminLogs && window.AdminLogs.clearLogFilter) {
            window.AdminLogs.clearLogFilter();
          }
        }
      });
    }

    // Clear log search button
    const btnLogsClear = document.getElementById("btnLogsClear");
    if (btnLogsClear) {
      btnLogsClear.addEventListener("click", () => {
        if (logSearch) {
          logSearch.value = "";
          logSearch.dispatchEvent(new Event("input"));
        }
      });
    }

    // Add refresh logs button and toggle if it doesn't exist
    const logsCard = document.querySelector(".logs-card");
    if (logsCard) {
      const cardHeader = logsCard.querySelector(".card-header");
      if (cardHeader && !cardHeader.querySelector("#btnRefreshLogs")) {
        const refreshBtn = document.createElement("button");
        refreshBtn.id = "btnRefreshLogs";
        refreshBtn.className = "btn btn-sm btn-outline-secondary";
        refreshBtn.textContent = "Обновить";
        refreshBtn.style.marginLeft = "10px";

        refreshBtn.addEventListener("click", () => {
          if (window.AdminLogs && window.AdminLogs.fetchLogs) {
            window.AdminLogs.fetchLogs();
          }
        });

        cardHeader.appendChild(refreshBtn);
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupButtonHandlers");
    }
  }
}

/**
 * Handle presence filter
 * @param {string} user - User name to filter by
 */
function handlePresenceFilter(user) {
  try {
    if (window.AdminLogs && window.AdminLogs.setLogFilter) {
      window.AdminLogs.setLogFilter(user);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handlePresenceFilter");
    }
  }
}

/**
 * Handle session termination
 * @param {string} sid - Session ID
 */
function handleSessionTerminate(sid) {
  try {
    if (window.AdminSessions && window.AdminSessions.terminateSession) {
      window.AdminSessions.terminateSession(sid);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleSessionTerminate");
    }
  }
}

/**
 * Handle log export
 */
function handleLogExport() {
  try {
    if (window.AdminLogs && window.AdminLogs.exportLogs) {
      window.AdminLogs.exportLogs();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleLogExport");
    }
  }
}

/**
 * Handle force logout all sessions
 */
function handleForceLogoutAll() {
  try {
    console.log(
      "handleForceLogoutAll called - this should only happen after confirmation"
    );

    // Show loading state
    const btn = document.getElementById("adminForceLogoutBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Разрываем сессии...";
    }

    fetch("/admin/force_logout_all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        if (data.status === "success") {
          // Refresh sessions and presence data first
          if (window.AdminSessions && window.AdminSessions.fetchSessions) {
            window.AdminSessions.fetchSessions();
          }
          if (window.AdminPresence && window.AdminPresence.fetchPresence) {
            window.AdminPresence.fetchPresence();
          }
          // Show success toast after data refresh
          setTimeout(() => {
            window.showToast("Все сессии успешно разорваны", "success");
          }, 500);
        } else {
          window.showToast(
            data.message || "Ошибка при разрыве сессий",
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Force logout error:", error);
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(error, "handleForceLogoutAll");
        }
        window.showToast(
          "Ошибка при разрыве сессий: " + error.message,
          "error"
        );
      })
      .finally(() => {
        // Restore button state
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Разорвать все сессии";
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleForceLogoutAll");
    }
    window.showToast("Ошибка при разрыве сессий", "error");

    // Restore button state
    const btn = document.getElementById("adminForceLogoutBtn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Разорвать все сессии";
    }
  }
}

/**
 * Handle force refresh all pages
 */
function handleForceRefreshAll() {
  try {
    console.log(
      "handleForceRefreshAll called - this should only happen after confirmation"
    );

    // Show loading state
    const btn = document.getElementById("adminForceRefreshBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Обновляем страницы...";
    }

    fetch("/admin/force_refresh_all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Force refresh all response:", data);
        if (data.status === "success") {
          // Show success toast after a delay
          setTimeout(() => {
            window.showToast("Все страницы принудительно обновлены", "success");

            // Also refresh the admin page itself after a delay
            setTimeout(() => {
              console.log("Refreshing admin page...");
              if (window.showToast) {
                window.showToast("Админ-панель будет обновлена", "warning");
              }
              setTimeout(() => {
                // Force hard refresh by adding cache-busting parameter
                const url = new URL(window.location);
                url.searchParams.set("_refresh", Date.now());
                window.location.href = url.toString();
              }, 1000);
            }, 2000);
          }, 500);
        } else {
          window.showToast(
            data.message || "Ошибка при обновлении страниц",
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Force refresh error:", error);
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(error, "handleForceRefreshAll");
        }
        window.showToast(
          "Ошибка при обновлении страниц: " + error.message,
          "error"
        );
      })
      .finally(() => {
        // Restore button state
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Принудительно обновить все страницы";
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleForceRefreshAll");
    }
    window.showToast("Ошибка при обновлении страниц", "error");

    // Restore button state
    const btn = document.getElementById("adminForceRefreshBtn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Принудительно обновить все страницы";
    }
  }
}

/**
 * Handle push maintenance
 */
function handlePushMaintenance() {
  try {
    // Show loading state
    const btn = document.getElementById("btnPushMaintain");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Запускаем обслуживание...";
    }

    fetch("/admin/push_maintain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Push maintenance response:", data);
        if (data.status === "success") {
          // Show success toast after a delay to ensure it appears after confirmation
          console.log("Showing success toast...");
          setTimeout(() => {
            console.log("Executing showToast...");
            console.log("window.showToast:", typeof window.showToast);
            console.log(
              "toast-container element:",
              document.getElementById("toast-container")
            );
            if (window.showToast) {
              try {
                window.showToast("Обслуживание подписок запущено", "success");
                console.log("showToast called successfully");
              } catch (err) {
                console.error("Error calling showToast:", err);
              }
            } else {
              console.error("window.showToast is not defined");
            }
          }, 500);
        } else {
          console.log("Showing error toast...");
          window.showToast(
            data.message || "Ошибка при запуске обслуживания",
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Push maintenance error:", error);
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(error, "handlePushMaintenance");
        }
        window.showToast(
          "Ошибка при запуске обслуживания: " + error.message,
          "error"
        );
      })
      .finally(() => {
        // Restore button state
        if (btn) {
          btn.disabled = false;
          btn.textContent =
            "Начать обслуживание таблицы подписок на уведомления";
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handlePushMaintenance");
    }
    window.showToast("Ошибка при запуске обслуживания", "error");

    // Restore button state
    const btn = document.getElementById("btnPushMaintain");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Начать обслуживание таблицы подписок на уведомления";
    }
  }
}

/**
 * Handle files maintenance
 */
function handleFilesMaintenance() {
  try {
    // Show loading state
    const btn = document.getElementById("btnFilesMaintain");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Запускаем обслуживание...";
    }

    fetch("/admin/files_maintain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Files maintenance response:", data);
        if (data.status === "success") {
          // Show success toast after a delay to ensure it appears after confirmation
          console.log("Showing success toast...");
          setTimeout(() => {
            console.log("Executing showToast...");
            console.log("window.showToast:", typeof window.showToast);
            console.log(
              "toast-container element:",
              document.getElementById("toast-container")
            );
            if (window.showToast) {
              try {
                window.showToast(
                  `Обслуживание файлов завершено. Обновлено: ${data.updated}, Создано: ${data.created}, Ошибок: ${data.errors}`,
                  "success"
                );
                console.log("showToast called successfully");
              } catch (err) {
                console.error("Error calling showToast:", err);
              }
            } else {
              console.error("window.showToast is not defined");
            }
          }, 500);
        } else {
          console.log("Showing error toast...");
          window.showToast(
            data.message || "Ошибка при запуске обслуживания файлов",
            "error"
          );
        }
      })
      .catch((error) => {
        console.error("Files maintenance error:", error);
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(error, "handleFilesMaintenance");
        }
        window.showToast(
          "Ошибка при запуске обслуживания файлов: " + error.message,
          "error"
        );
      })
      .finally(() => {
        // Restore button state
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Начать обслуживание таблицы файлов";
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleFilesMaintenance");
    }
    window.showToast("Ошибка при запуске обслуживания файлов", "error");

    // Restore button state
    const btn = document.getElementById("btnFilesMaintain");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Начать обслуживание таблицы файлов";
    }
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    // Setup button handlers
    setupButtonHandlers();

    // Defer heavy initialization to avoid blocking DOMContentLoaded
    if (window.requestIdleCallback) {
      window.requestIdleCallback(
        () => {
          initAdminPage();
        },
        { timeout: 2000 }
      );
    } else {
      setTimeout(() => {
        if (window.requestIdleCallback) {
          window.requestIdleCallback(
            () => {
              initAdminPage();
            },
            { timeout: 1000 }
          );
        } else {
          initAdminPage();
        }
      }, 0);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "DOMContentLoaded");
    }
  }
});

// Export functions to global scope for inline event handlers
window.AdminPage = {
  init: initAdminPage,
  setupSocket,
  setupPresenceMonitoring,
  setupSessionsMonitoring,
  setupLogsMonitoring,
  setupContextMenus,
  loadInitialData,
  handlePresenceFilter,
  handleSessionTerminate,
  handleLogExport,
  handleForceLogoutAll,
  handlePushMaintenance,
};
