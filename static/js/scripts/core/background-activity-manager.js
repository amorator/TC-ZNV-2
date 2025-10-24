/**
 * Background Activity Manager
 * Manages background activities based on main socket connection state
 */

(function () {
  "use strict";

  // Background activity registry
  const backgroundActivities = new Map();
  let isMainSocketConnected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isReconnecting = false;

  // Get reconnect interval from config, fallback to 5 seconds
  function getReconnectInterval() {
    try {
      // Try to get from window.Config or use fallback
      if (window.Config && window.Config.getReconnectInterval) {
        return window.Config.getReconnectInterval() * 1000; // Convert to milliseconds
      }
      return 5000; // Fallback: 5 seconds
    } catch (err) {
      return 5000; // Fallback: 5 seconds
    }
  }

  /**
   * Register a background activity
   * @param {string} name - Activity name
   * @param {Object} config - Activity configuration
   * @param {Function} config.start - Function to start activity
   * @param {Function} config.stop - Function to stop activity
   * @param {number} config.interval - Activity interval in ms
   * @param {boolean} config.autoStart - Whether to start automatically when socket connects
   */
  function registerActivity(name, config) {
    try {
      if (!name || typeof config !== "object") {
        throw new Error("Invalid activity registration");
      }

      const activity = {
        name,
        config,
        isRunning: false,
        intervalId: null,
        startTime: null,
      };

      backgroundActivities.set(name, activity);

      // If socket is connected and autoStart is true, start the activity
      if (isMainSocketConnected && config.autoStart !== false) {
        startActivity(name);
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "registerActivity");
      }
    }
  }

  /**
   * Unregister a background activity
   * @param {string} name - Activity name
   */
  function unregisterActivity(name) {
    try {
      if (backgroundActivities.has(name)) {
        stopActivity(name);
        backgroundActivities.delete(name);
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "unregisterActivity");
      }
    }
  }

  /**
   * Start a background activity
   * @param {string} name - Activity name
   */
  function startActivity(name) {
    try {
      const activity = backgroundActivities.get(name);
      if (!activity) return;

      if (activity.isRunning) return;

      // Stop existing interval if any
      if (activity.intervalId) {
        clearInterval(activity.intervalId);
      }

      // Start the activity
      if (typeof activity.config.start === "function") {
        activity.config.start();
      }

      // Set up interval if specified
      if (activity.config.interval && activity.config.interval > 0) {
        activity.intervalId = setInterval(() => {
          try {
            if (typeof activity.config.start === "function") {
              activity.config.start();
            }
          } catch (err) {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(
                err,
                `backgroundActivity:${name}`
              );
            }
          }
        }, activity.config.interval);
      }

      activity.isRunning = true;
      activity.startTime = Date.now();
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "startActivity");
      }
    }
  }

  /**
   * Stop a background activity
   * @param {string} name - Activity name
   */
  function stopActivity(name) {
    try {
      const activity = backgroundActivities.get(name);
      if (!activity) return;

      if (!activity.isRunning) return;

      // Clear interval
      if (activity.intervalId) {
        clearInterval(activity.intervalId);
        activity.intervalId = null;
      }

      // Stop the activity
      if (typeof activity.config.stop === "function") {
        activity.config.stop();
      }

      activity.isRunning = false;
      activity.startTime = null;
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "stopActivity");
      }
    }
  }

  /**
   * Start all registered activities
   */
  function startAllActivities() {
    try {
      for (const [name, activity] of backgroundActivities) {
        if (activity.config.autoStart !== false) {
          startActivity(name);
        }
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "startAllActivities");
      }
    }
  }

  /**
   * Stop all registered activities
   */
  function stopAllActivities() {
    try {
      for (const [name] of backgroundActivities) {
        stopActivity(name);
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "stopAllActivities");
      }
    }
  }

  /**
   * Check if main socket is connected
   */
  function checkSocketConnection() {
    try {
      if (window.SyncManager && window.SyncManager.getSocket) {
        const socket = window.SyncManager.getSocket();
        return socket && socket.connected;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * Force reconnect the main socket
   */
  function forceReconnectSocket() {
    try {
      // Try to reconnect via SyncManager if available
      if (window.SyncManager && window.SyncManager.getSocket) {
        const socket = window.SyncManager.getSocket();
        if (socket) {
          // Only reconnect if not already connected
          if (!socket.connected) {
            if (socket.disconnect) {
              socket.disconnect();
            }
            if (socket.connect) {
              socket.connect();
            }
            return true;
          }
        }
      }

      // Try to reconnect via global socket
      if (window.socket) {
        // Only reconnect if not already connected
        if (!window.socket.connected) {
          if (window.socket.disconnect) {
            window.socket.disconnect();
          }
          if (window.socket.connect) {
            window.socket.connect();
          }
          return true;
        }
      }

      // Try to create new socket connection only if no socket exists
      if (window.io && !window.socket) {
        try {
          const newSocket = window.io(window.location.origin, {
            path: "/socket.io",
            withCredentials: true,
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
          });
          window.socket = newSocket;
          return true;
        } catch (err) {
          console.error("Failed to create new socket:", err);
        }
      }

      return false;
    } catch (err) {
      console.error("Force reconnect error:", err);
      return false;
    }
  }

  /**
   * Handle socket connection state changes
   */
  function handleSocketStateChange(connected) {
    try {
      const wasConnected = isMainSocketConnected;
      isMainSocketConnected = connected;

      if (connected && !wasConnected) {
        // Socket connected - start all activities
        if (reconnectAttempts > 0) {
          console.log(
            `Reconnection successful after ${reconnectAttempts} attempts`
          );
        }
        startAllActivities();
        reconnectAttempts = 0;
        isReconnecting = false; // Reset reconnection flag
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      } else if (!connected && wasConnected) {
        // Socket disconnected - stop all activities
        stopAllActivities();
        startReconnectAttempts();
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "handleSocketStateChange");
      }
    }
  }

  /**
   * Start reconnection attempts (infinite retry)
   */
  function startReconnectAttempts() {
    try {
      // Prevent multiple reconnection attempts
      if (isReconnecting) {
        return;
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      reconnectAttempts++;
      const reconnectDelay = getReconnectInterval();
      console.log(
        `Reconnection attempt ${reconnectAttempts} (next in ${
          reconnectDelay / 1000
        }s)`
      );

      reconnectTimer = setTimeout(() => {
        try {
          if (checkSocketConnection()) {
            handleSocketStateChange(true);
          } else {
            // Set flag to prevent multiple attempts
            isReconnecting = true;

            // Try to force reconnect the socket
            const reconnectSuccess = forceReconnectSocket();

            if (reconnectSuccess) {
              // Give it a moment to connect, then check again
              setTimeout(() => {
                isReconnecting = false; // Reset flag
                if (checkSocketConnection()) {
                  handleSocketStateChange(true);
                } else {
                  startReconnectAttempts();
                }
              }, 1000);
            } else {
              isReconnecting = false; // Reset flag
              startReconnectAttempts();
            }
          }
        } catch (err) {
          isReconnecting = false; // Reset flag
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "reconnectAttempt");
          }
          startReconnectAttempts();
        }
      }, reconnectDelay);
    } catch (err) {
      isReconnecting = false; // Reset flag
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "startReconnectAttempts");
      }
    }
  }

  /**
   * Initialize the background activity manager
   */
  function init() {
    try {
      // Check initial connection state
      isMainSocketConnected = checkSocketConnection();

      // Set up socket state monitoring
      if (window.SyncManager) {
        // Monitor socket connection state
        setInterval(() => {
          const connected = checkSocketConnection();
          if (connected !== isMainSocketConnected) {
            handleSocketStateChange(connected);
          }
        }, 1000);
      }

      // Start activities if socket is already connected
      if (isMainSocketConnected) {
        startAllActivities();
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "BackgroundActivityManager.init");
      }
    }
  }

  // Public API
  window.BackgroundActivityManager = {
    register: registerActivity,
    unregister: unregisterActivity,
    start: startActivity,
    stop: stopActivity,
    startAll: startAllActivities,
    stopAll: stopAllActivities,
    isConnected: () => isMainSocketConnected,
    getActivities: () => Array.from(backgroundActivities.keys()),
    init: init,
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
