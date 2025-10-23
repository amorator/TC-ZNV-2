// Admin Page
// Основной файл страницы админки

// Global variables
let socket = null;
let presenceData = [];
let sessionsData = [];
let logsData = [];

// Admin functions
function fetchPresence() {
  return window.ApiClient.apiGet("/api/admin/presence");
}

function renderPresence(data) {
  presenceData = data;
  // Implementation for rendering presence
}

function emitPresence() {
  // Implementation for emitting presence
}

function fetchSessions() {
  return window.ApiClient.apiGet("/api/admin/sessions");
}

function renderSessions(data) {
  sessionsData = data;
  // Implementation for rendering sessions
}

function terminateSession(sessionId) {
  return window.ApiClient.apiDelete(`/api/admin/sessions/${sessionId}`);
}

function fetchLogs() {
  return window.ApiClient.apiGet("/api/admin/logs");
}

function renderLogs(data) {
  logsData = data;
  // Implementation for rendering logs
  console.log("Rendering logs data:", data);
}

function setLogFilter(filter) {
  // Implementation for setting log filter
}

function clearLogFilter() {
  // Implementation for clearing log filter
}

function setupLogContextMenu() {
  // Implementation for setting up log context menu
}

// Debug helper for push flows
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
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "dlog");
    }
  }
}

// Connectivity and polling backoff guards
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
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "runWithBackoff");
    }
  }
}

// Initialize admin page
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

function setupSocket() {
  try {
    if (!window.SyncManager) {
      console.warn("SyncManager not available");
      return;
    }

    socket = window.SyncManager.getSocket();
    if (!socket) return;

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
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupPresenceMonitoring");
    }
  }
}

function setupSessionsMonitoring() {
  try {
    // Setup sessions monitoring
    if (window.SocketOptimizer) {
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

function setupLogsMonitoring() {
  try {
    // Setup logs monitoring
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
      // Fallback to regular interval
      setInterval(() => {
        if (window.AdminLogs && window.AdminLogs.fetchLogs) {
          window.AdminLogs.fetchLogs();
        }
      }, 15000);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupLogsMonitoring");
    }
  }
}

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

// UI Event Handlers
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

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    // Defer heavy initialization to avoid blocking DOMContentLoaded
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => {
        initAdminPage();
      
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
              if (window.requestIdleCallback) {
                window.requestIdleCallback(() => {
                  initAdminPage();
                }, { timeout: 1000 });
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
window.initAdminPage = initAdminPage;
window.setupSocket = setupSocket;
window.setupPresenceMonitoring = setupPresenceMonitoring;
window.setupSessionsMonitoring = setupSessionsMonitoring;
window.setupLogsMonitoring = setupLogsMonitoring;
window.setupContextMenus = setupContextMenus;
window.loadInitialData = loadInitialData;
window.handlePresenceFilter = handlePresenceFilter;
window.handleSessionTerminate = handleSessionTerminate;
window.handleLogExport = handleLogExport;
window.dlog = dlog;
window.isMainSocketConnected = isMainSocketConnected;
window.runWithBackoff = runWithBackoff;
