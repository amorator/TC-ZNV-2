/**
 * Универсальный модуль синхронизации для клиентской части
 * Обеспечивает единообразную обработку событий синхронизации для всех страниц
 */

window.SyncManager = (function () {
  "use strict";

  let socket = null;
  let lastTransportMode = "auto"; // auto | ws | polling
  let refreshCallbacks = {};
  let debugEnabled = false;

  /**
   * Инициализация менеджера синхронизации
   */
  function init() {
    try {
      if (debugEnabled) {
        try {
          console.debug("[sync] initializing");
        } catch (_) {}
      }
      // Always log initialization for debugging
      try {
        console.debug("[sync] SyncManager initializing...");
      } catch (_) {}
      // Авто-включение дебага, если выставлен глобальный флаг до загрузки
      try {
        if (typeof window.__syncDebug !== "undefined") {
          debugEnabled = !!window.__syncDebug;
        }
      } catch (_) {}
      setupSocket();
    } catch (e) {
      try {
        console.error("[sync] init error:", e);
      } catch (_) {}
    }
  }

  /**
   * Настройка Socket.IO соединения
   */
  function setupSocket() {
    if (!window.io) {
      try {
        console.warn("[sync] Socket.IO not available");
      } catch (_) {}
      return;
    }

    // Build connection options with adaptive transport
    let opts = {
      path: "/socket.io",
      withCredentials: true,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    };
    if (lastTransportMode === "ws") {
      opts.transports = ["websocket"]; // prefer websocket only
      opts.upgrade = false;
    } else if (lastTransportMode === "polling") {
      opts.transports = ["polling"]; // polling only
      opts.upgrade = false;
    } else {
      // auto: allow websocket first with downgrade to polling
      opts.transports = ["websocket", "polling"];
      opts.upgrade = true;
    }

    // Create independent socket; do not reuse or override globals
    socket = window.io(window.location.origin, opts);
    // do not assign to window.socket to avoid SID conflicts

    // Обработка ошибок соединения
    socket.on("connect_error", (err) => {
      const msg = (err && (err.message || err)) || "";
      if (debugEnabled) {
        try {
          console.warn("[sync] socket connect_error:", msg);
        } catch (_) {}
      }
      // Adaptive fallback on 400/xhr errors
      try {
        if (/400|bad request|xhr/i.test(String(msg))) {
          // Toggle transport mode
          if (lastTransportMode === "auto") {
            lastTransportMode = "ws"; // try websocket-only first
          } else if (lastTransportMode === "ws") {
            lastTransportMode = "polling"; // then fallback to polling-only
          } else {
            lastTransportMode = "auto"; // cycle back
          }
          try {
            socket.close && socket.close();
          } catch (_) {}
          try {
            socket = null;
          } catch (_) {}
          setTimeout(function () {
            try {
              setupSocket();
            } catch (_) {}
          }, 300);
          return;
        }
      } catch (_) {}
      try {
        socket.connect();
      } catch (_) {}
    });

    socket.on("error", (err) => {
      if (debugEnabled) {
        try {
          console.warn("[sync] socket error:", err && (err.message || err));
        } catch (_) {}
      }
    });

    // Обработка подключения
    socket.on("connect", function () {
      if (debugEnabled) {
        try {
          console.debug("[sync] socket connected");
        } catch (_) {}
      }
      bindHandlers();
    });

    // Обработка отключения
    socket.on("disconnect", function (reason) {
      if (debugEnabled) {
        try {
          console.debug("[sync] socket disconnect:", reason);
        } catch (_) {}
      }
      // Aggressively rebuild polling-only socket on any disconnect
      try {
        socket.close && socket.close();
      } catch (_) {}
      try {
        socket = null;
      } catch (_) {}
      try {
        setupSocket();
      } catch (_) {}
    });

    // Engine-level guards similar to users.js
    try {
      const eng = socket && socket.io && socket.io.engine;
      if (eng && !eng.__syncEngineBound) {
        eng.__syncEngineBound = true;
        const rebuild = () => {
          try {
            if (window.socket && window.socket !== socket) {
              try {
                window.socket.close && window.socket.close();
              } catch (_) {}
            }
          } catch (_) {}
          try {
            // Recreate socket with current adaptive mode
            const next = window.io(window.location.origin, {
              path: "/socket.io",
              withCredentials: true,
              forceNew: true,
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000,
              upgrade: lastTransportMode === "auto" ? true : false,
              transports:
                lastTransportMode === "ws"
                  ? ["websocket"]
                  : lastTransportMode === "polling"
                  ? ["polling"]
                  : ["websocket", "polling"],
            });
            socket = next;
            // Rebind handlers
            try {
              bindHandlers();
            } catch (_) {}
          } catch (_) {}
        };
        eng.on &&
          eng.on("close", function (reason, desc) {
            try {
              const msg = String(desc || reason || "");
              if (/400|bad request|sid|session/i.test(msg)) {
                // on SID/400 errors, switch mode to attempt recovery
                if (lastTransportMode === "auto") lastTransportMode = "ws";
                setTimeout(rebuild, 500);
              }
            } catch (_) {}
          });
        eng.on &&
          eng.on("error", function (err) {
            try {
              const code = (err && (err.code || err.status)) || 0;
              const msg = String(err && (err.message || err)) || "";
              if (code === 400 || /400|bad request|sid|session/i.test(msg)) {
                if (lastTransportMode === "auto") lastTransportMode = "ws";
                setTimeout(rebuild, 500);
              }
            } catch (_) {}
          });
      }
    } catch (_) {}
  }

  /**
   * Привязка обработчиков событий
   */
  function bindHandlers() {
    if (!socket) return;
    if (debugEnabled) {
      try {
        console.debug("[sync] binding handlers");
      } catch (_) {}
    }

    // Debug: log any incoming event if debug enabled
    try {
      if (socket.onAny && !socket.__syncOnAnyBound) {
        socket.__syncOnAnyBound = true;
        socket.onAny(function (eventName, payload) {
          try {
            // Log core sync events, but do not forward to avoid duplicate handling
            // Only log when debug is enabled; never forward
            if (debugEnabled) {
              try {
                console.debug("[sync] onAny:", eventName, payload);
              } catch (_) {}
            }
            return;
            // Ignore presence and other non-sync chatter unless explicitly needed
          } catch (_) {}
        });
      }
    } catch (_) {}

    // Универсальный обработчик для всех событий синхронизации
    const syncEvents = [
      "categories:changed",
      "subcategories:changed",
      "files:changed",
      "users:changed",
      "groups:changed",
      "registrators:changed",
      "admin:changed",
    ];

    syncEvents.forEach((eventName) => {
      socket.off(eventName);
      socket.on(eventName, function (data) {
        if (debugEnabled) {
          try {
            console.debug(`[sync] socket.on fired for ${eventName}`, data);
          } catch (_) {}
        }
        handleSyncEvent(eventName, data);
      });
    });
  }

  /**
   * Обработка события синхронизации
   */
  function handleSyncEvent(eventName, data) {
    if (debugEnabled) {
      try {
        const count = (refreshCallbacks[eventName] || []).length;
        console.debug(
          `[sync] received ${eventName}:`,
          data,
          `(callbacks=${count})`
        );
      } catch (_) {}
    }

    // Вызываем зарегистрированные callback'и
    const callbacks = refreshCallbacks[eventName] || [];
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (e) {
        console.error(`[sync] callback error for ${eventName}:`, e);
      }
    });
  }

  /**
   * Регистрация callback'а для события
   */
  function on(eventName, callback) {
    if (!refreshCallbacks[eventName]) {
      refreshCallbacks[eventName] = [];
    }
    refreshCallbacks[eventName].push(callback);

    if (debugEnabled) {
      try {
        console.debug(`[sync] registered callback for ${eventName}`);
      } catch (_) {}
    }
  }

  /**
   * Отмена регистрации callback'а
   */
  function off(eventName, callback) {
    if (!refreshCallbacks[eventName]) return;

    const index = refreshCallbacks[eventName].indexOf(callback);
    if (index > -1) {
      refreshCallbacks[eventName].splice(index, 1);
    }
  }

  /**
   * Включение/выключение отладочного режима
   */
  function setDebug(enabled) {
    debugEnabled = enabled;
  }

  // --- Global soft refresh on tab resume ---
  let resumeCallbacks = [];
  function onResume(callback) {
    try {
      if (typeof callback === "function") {
        resumeCallbacks.push(callback);
      }
    } catch (_) {}
  }
  try {
    document.addEventListener("visibilitychange", function () {
      try {
        if (!document.hidden) {
          // Reconnect socket if needed
          try {
            if (socket && !socket.connected) socket.connect();
          } catch (_) {}
          // Fire registered resume callbacks
          const list = resumeCallbacks.slice();
          list.forEach(function (cb) {
            try {
              cb();
            } catch (_) {}
          });
        }
      } catch (_) {}
    });
  } catch (_) {}

  /**
   * Получение Socket.IO экземпляра
   */
  function getSocket() {
    return socket;
  }

  // Публичный API
  return {
    init: init,
    on: on,
    off: off,
    setDebug: setDebug,
    getSocket: getSocket,
    onResume: onResume,
  };
})();

// Автоматическая инициализация при загрузке DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", window.SyncManager.init);
} else {
  window.SyncManager.init();
}
