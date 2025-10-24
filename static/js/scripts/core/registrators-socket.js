// Registrators Socket Module
// Синхронизация регистраторов через Socket.IO

// Generate unique client ID for socket synchronization
if (!window.__registratorsClientId) {
  window.__registratorsClientId =
    "reg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

// Setup socket synchronization
function setupRegistratorsSocket() {
  try {
    // Prefer SyncManager for unified handling
    try {
      if (window.SyncManager && typeof window.SyncManager.on === "function") {
        if (!window.__registratorsSyncBound) {
          window.__registratorsSyncBound = true;
          // Debounce: coalesce multiple socket events
          if (!window.__registratorsDebounceTimer)
            window.__registratorsDebounceTimer = null;
          function debouncedLoad() {
            if (window.__registratorsDebounceTimer) {
              clearTimeout(window.__registratorsDebounceTimer);
            }
            window.__registratorsDebounceTimer = setTimeout(function () {
              try {
                if (window.loadRegistrators) {
                  window.loadRegistrators();
                }
              } catch (err) {
                if (window.ErrorHandler) {
                  window.ErrorHandler.handleError(err, "debouncedLoad");
                }
              }
            }, 300);
          }

          window.SyncManager.on("registrators:changed", function (data) {
            try {
              // SyncManager received registrators:changed
              if (!document.hidden) debouncedLoad();
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации регистраторов", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "registrators:changed");
              }
            }
          });

          // Also listen for users and groups changes to update permissions tables
          window.SyncManager.on("users:changed", function (data) {
            try {
              // SyncManager received users:changed
              if (!document.hidden) {
                debouncedLoad();
                if (window.currentRegistratorId && window.loadRegPermissions) {
                  // Force reload permissions to get updated user data
                  window.loadRegPermissions(1, 1);
                }
              }
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации пользователей", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "users:changed");
              }
            }
          });

          window.SyncManager.on("groups:changed", function (data) {
            try {
              // SyncManager received groups:changed
              if (
                !document.hidden &&
                window.currentRegistratorId &&
                window.loadRegPermissions
              ) {
                window.loadRegPermissions();
              }
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации групп", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "groups:changed");
              }
            }
          });

          // Listen for categories and subcategories changes
          window.SyncManager.on("categories:changed", function (data) {
            try {
              // SyncManager received categories:changed
              if (!document.hidden) {
                debouncedLoad();
              }
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации категорий", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "categories:changed");
              }
            }
          });

          window.SyncManager.on("subcategories:changed", function (data) {
            try {
              // SyncManager received subcategories:changed
              if (!document.hidden) {
                debouncedLoad();
              }
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации подкатегорий", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "subcategories:changed");
              }
            }
          });

          // Listen for files changes
          window.SyncManager.on("files:changed", function (data) {
            try {
              // SyncManager received files:changed
              if (!document.hidden) {
                debouncedLoad();
              }
            } catch (err) {
              if (window.showToast) {
                window.showToast("Ошибка синхронизации файлов", "error");
              }
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "files:changed");
              }
            }
          });

          // Listen for registrator permissions updates via SyncManager
          window.SyncManager.on(
            "registrator_permissions_updated",
            function (data) {
              try {
                // SyncManager received registrator_permissions_updated
                if (
                  !document.hidden &&
                  window.currentRegistratorId &&
                  data &&
                  data.registrator_id == window.currentRegistratorId &&
                  window.loadRegPermissions
                ) {
                  window.loadRegPermissions();
                }
              } catch (err) {
                if (window.ErrorHandler) {
                  window.ErrorHandler.handleError(
                    err,
                    "registrator_permissions_updated"
                  );
                }
              }
            }
          );

          // Listen for subcategory permissions updates to refresh permissions tables
          window.SyncManager.on(
            "subcategory_permissions_updated",
            function (data) {
              try {
                // SyncManager received subcategory_permissions_updated
                if (
                  !document.hidden &&
                  window.currentRegistratorId &&
                  window.loadRegPermissions
                ) {
                  window.loadRegPermissions();
                }
              } catch (err) {
                if (window.ErrorHandler) {
                  window.ErrorHandler.handleError(
                    err,
                    "subcategory_permissions_updated"
                  );
                }
              }
            }
          );
        }
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "setupRegistratorsSocket");
      }
    }

    if (!window.io) return;
    const sock =
      window.socket && typeof window.socket.on === "function"
        ? window.socket
        : window.io(window.location.origin, {
            path: "/socket.io",
            withCredentials: true,
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
          });
    try {
      sock.on &&
        sock.on("connect", function () {
          try {
            // Socket connected
          } catch (err) {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "socket connect");
            }
          }
        });
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "socket connect");
      }
    }
    try {
      sock.on &&
        sock.on("disconnect", function (reason) {
          try {
            // Socket disconnected
          } catch (err) {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "socket disconnect");
            }
          }
          if (reason !== "io client disconnect") {
            try {
              sock.connect();
            } catch (err) {
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "socket reconnect");
              }
            }
          }
        });
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "socket disconnect");
      }
    }
    if (!window.socket) window.socket = sock;
    try {
      sock.off && sock.off("registrators:changed");
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "socket off");
      }
    }
    sock.on &&
      sock.on("registrators:changed", function (data) {
        try {
          // Socket received registrators:changed
          if (!document.hidden && window.loadRegistrators) {
            window.loadRegistrators();
          }
        } catch (err) {
          if (window.showToast) {
            window.showToast(
              "Ошибка обработки изменений регистраторов",
              "error"
            );
          }
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "registrators:changed");
          }
        }
      });
    // Also reflect users changes (permissions and visibility) to reload list/permissions
    sock.on &&
      sock.on("users:changed", function () {
        try {
          if (!document.hidden) {
            if (window.loadRegistrators) {
              window.loadRegistrators();
            }
            // Also reload permissions tables if they're visible
            if (window.currentRegistratorId && window.loadRegPermissions) {
              // Force reload permissions to get updated user data
              window.loadRegPermissions(1, 1);
            }
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "users:changed");
          }
        }
      });
    // Also reload permissions tables when groups change
    sock.on &&
      sock.on("groups:changed", function () {
        try {
          if (
            !document.hidden &&
            window.currentRegistratorId &&
            window.loadRegPermissions
          ) {
            window.loadRegPermissions();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "groups:changed");
          }
        }
      });
    // Listen for categories and subcategories changes
    sock.on &&
      sock.on("categories:changed", function () {
        try {
          if (!document.hidden && window.loadRegistrators) {
            window.loadRegistrators();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "categories:changed");
          }
        }
      });
    sock.on &&
      sock.on("subcategories:changed", function () {
        try {
          if (!document.hidden && window.loadRegistrators) {
            window.loadRegistrators();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "subcategories:changed");
          }
        }
      });
    // Listen for files changes
    sock.on &&
      sock.on("files:changed", function () {
        try {
          if (!document.hidden && window.loadRegistrators) {
            window.loadRegistrators();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "files:changed");
          }
        }
      });
    // Listen for specific registrator permissions updates
    sock.on &&
      sock.on("registrator_permissions_updated", function (data) {
        try {
          // Socket received registrator_permissions_updated
          if (
            !document.hidden &&
            window.currentRegistratorId &&
            data &&
            data.registrator_id == window.currentRegistratorId &&
            window.loadRegPermissions
          ) {
            window.loadRegPermissions();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(
              err,
              "registrator_permissions_updated"
            );
          }
        }
      });
    // Listen for subcategory permissions updates
    sock.on &&
      sock.on("subcategory_permissions_updated", function (data) {
        try {
          // Socket received subcategory_permissions_updated
          if (
            !document.hidden &&
            window.currentRegistratorId &&
            window.loadRegPermissions
          ) {
            window.loadRegPermissions();
          }
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(
              err,
              "subcategory_permissions_updated"
            );
          }
        }
      });

    // Join registrators room for force logout events
    if (window.SyncManager && window.SyncManager.joinRoom) {
      window.SyncManager.joinRoom("registrators");
    }

    // Handle force logout
    if (window.SyncManager && window.SyncManager.getSocket) {
      const socket = window.SyncManager.getSocket();
      if (socket) {
        socket.on("force-logout", function (data) {
          try {
            console.log("Force logout received on registrators page");
            // Redirect to logout
            window.location.replace("/logout");
          } catch (err) {
            console.error("Force logout error:", err);
          }
        });

        socket.on("force-refresh", function (data) {
          try {
            console.log("Force refresh received on registrators page", data);
            // Show notification before refresh
            if (window.showToast) {
              window.showToast(
                "Страница будет обновлена администратором",
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
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupRegistratorsSocket");
    }
  }
}

// Export function to global scope
window.setupRegistratorsSocket = setupRegistratorsSocket;
