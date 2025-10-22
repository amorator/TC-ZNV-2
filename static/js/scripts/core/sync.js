/**
 * Универсальный модуль синхронизации для клиентской части
 * Обеспечивает единообразную обработку событий синхронизации для всех страниц
 *
 * Архитектура синхронизации:
 * - Сервер эмитит события в комнаты (rooms) для таргетированной доставки
 * - Клиенты подписываются только на нужные им комнаты
 * - События содержат унифицированные поля: reason, seq, worker, scope
 * - Поддерживается мягкое обновление (soft refresh) с дебаунсом
 * - Автоматический idle-guard для обновления после периодов неактивности
 *
 * Комнаты (rooms):
 * - index: главная страница
 * - files: страница файлов
 * - users: страница пользователей
 * - groups: страница групп
 * - categories: страница категорий
 * - registrators: страница регистраторов
 * - admin: административная страница
 *
 * @namespace SyncManager
 */

window.SyncManager = (function () {
  "use strict";

  let socket = null;
  let lastTransportMode = "auto"; // auto | ws | polling
  let refreshCallbacks = {};
  let debugEnabled = false;
  let isConnecting = false; // Защита от множественных соединений

  /**
   * Инициализация менеджера синхронизации
   * Настраивает Socket.IO соединение и обработчики событий
   * @memberof SyncManager
   */
  function init() {
    // Enable verbose debug only on index page and when explicitly requested
    debugEnabled =
      /\/index\b/.test(window.location.pathname || "") && !!window.__syncDebug;
    // Авто-включение дебага, если выставлен глобальный флаг до загрузки
    if (typeof window.__syncDebug !== "undefined") {
      debugEnabled = !!window.__syncDebug;
    }
    setupSocket();
  }

  /**
   * Настройка Socket.IO соединения
   * Создает соединение с адаптивным выбором транспорта (WebSocket/polling)
   * @memberof SyncManager
   * @private
   */
  function setupSocket() {
    if (!window.io) {
      if (debugEnabled) {
        console.warn("[sync] Socket.IO not available");
      }
      return;
    }

    // Защита от множественных соединений
    if (isConnecting || (socket && socket.connected)) {
      if (debugEnabled) {
        console.debug("[sync] Connection already exists or in progress");
      }
      return;
    }

    isConnecting = true;

    // Build connection options with adaptive transport
    let opts = {
      path: "/socket.io",
      withCredentials: true,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      // Exponential backoff for reconnects with longer delays
      reconnectionDelay: 5000, // Start with 5 seconds minimum
      reconnectionDelayMax: 120000, // Max 2 minutes
      timeout: 45000, // 45 second timeout
      // Add randomization to prevent thundering herd
      randomizationFactor: 0.8, // More randomization
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
        console.warn("[sync] socket connect_error:", msg);
      }
      // Adaptive fallback on 400/xhr errors
      if (/400|bad request|xhr/i.test(String(msg))) {
        // Toggle transport mode
        if (lastTransportMode === "auto") {
          lastTransportMode = "ws"; // try websocket-only first
        } else if (lastTransportMode === "ws") {
          lastTransportMode = "polling"; // then fallback to polling-only
        } else {
          lastTransportMode = "auto"; // cycle back
        }
        socket.close && socket.close();
        socket = null;
        setTimeout(function () {
          setupSocket();
        }, 300);
        return;
      }
      socket.connect();
    });

    socket.on("error", (err) => {
      if (debugEnabled) {
        console.warn("[sync] socket error:", err && (err.message || err));
      }
    });

    // Обработка подключения
    socket.on("connect", function () {
      isConnecting = false;
      if (debugEnabled) {
        console.debug("[sync] socket connected");
      }
      bindHandlers();

      // Уведомляем о восстановлении соединения для возобновления фоновых задач
      window.dispatchEvent(
        new CustomEvent("socketConnected", {
          detail: { socket: socket },
        })
      );
    });

    // Обработка отключения
    socket.on("disconnect", function (reason) {
      isConnecting = false;
      if (debugEnabled) {
        console.debug("[sync] socket disconnect:", reason);
      }
      // Backoff before attempting rebuild - увеличиваем задержку
      try {
        const delay = Math.min(
          60000, // Увеличиваем максимальную задержку до 1 минуты
          Math.max(
            5000, // Минимальная задержка 5 секунд
            (socket &&
              socket.io &&
              socket.io.backoff &&
              socket.io.backoff.duration()) ||
              10000 // Увеличиваем базовую задержку до 10 секунд
          )
        );
        setTimeout(function () {
          try {
            socket && socket.close && socket.close();
          } catch (_) {}
          socket = null;
          setupSocket();
        }, delay);
      } catch (_) {
        socket && socket.close && socket.close();
        socket = null;
        setTimeout(setupSocket, 2000);
      }
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
   * Регистрирует обработчики для всех событий синхронизации
   * @memberof SyncManager
   * @private
   */
  function bindHandlers() {
    if (!socket) return;
    if (debugEnabled) {
      console.debug("[sync] binding handlers");
    }

    // Debug: log any incoming event if debug enabled
    if (socket.onAny && !socket.__syncOnAnyBound) {
      socket.__syncOnAnyBound = true;
      socket.onAny(function (eventName, payload) {
        // Log core sync events, but do not forward to avoid duplicate handling
        // Only log when debug is enabled; never forward
        if (debugEnabled) {
          console.debug("[sync] onAny:", eventName, payload);
        }
        return;
        // Ignore presence and other non-sync chatter unless explicitly needed
      });
    }

    // Универсальный обработчик для всех событий синхронизации
    const syncEvents = [
      "categories:changed",
      "subcategories:changed",
      "files:changed",
      "users:changed",
      "groups:changed",
      "registrators:changed",
      "registrator_permissions_updated",
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
   * Регистрация callback'а для события синхронизации
   * @param {string} eventName - Название события (например, 'files:changed')
   * @param {Function} callback - Функция обратного вызова, получает payload события
   * @memberof SyncManager
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
   * Присоединение к комнате для получения событий
   * @param {string} room - Название комнаты (например, 'files', 'users')
   * @memberof SyncManager
   */
  function joinRoom(room) {
    try {
      if (!socket || !socket.emit) return;
      socket.emit(room + ":join", { ts: Date.now() });
    } catch (_) {}
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

  /**
   * Проверяет, доступно ли соединение с сервером
   * @returns {boolean}
   */
  function isConnected() {
    return socket && socket.connected;
  }

  /**
   * Получает состояние соединения для оптимизации запросов
   * @returns {object} {connected: boolean, reconnectDelay: number, reconnecting: boolean}
   */
  function getConnectionState() {
    const connected = isConnected();
    const reconnecting = socket && socket.connecting;
    const reconnectDelay = connected ? 1000 : reconnecting ? 10000 : 15000; // Увеличиваем задержку при переподключении
    return { connected, reconnectDelay, reconnecting };
  }

  /**
   * Простой debounce-хелпер
   * @param {Function} fn
   * @param {number} waitMs
   */
  function debounce(fn, waitMs) {
    let tid = null;
    return function () {
      const ctx = this;
      const args = arguments;
      if (tid) clearTimeout(tid);
      tid = setTimeout(function () {
        try {
          fn.apply(ctx, args);
        } catch (_) {}
      }, waitMs || 200);
    };
  }

  /**
   * Зарегистрировать soft-refresh с дебаунсом для события
   * @param {string} eventName
   * @param {Function} callback
   * @param {number} waitMs
   */
  function onSoftRefresh(eventName, callback, waitMs) {
    try {
      const wrapped = debounce(function (data) {
        try {
          callback(data);
        } catch (_) {}
      }, waitMs || 200);
      on(eventName, wrapped);
    } catch (_) {}
  }

  /**
   * Авто-guard: если не было событий N секунд — выполнить мягкое обновление
   * @param {Function} refreshFn
   * @param {number} idleSeconds
   */
  function startIdleGuard(refreshFn, idleSeconds) {
    try {
      if (typeof refreshFn !== "function") return;
      let lastTs = Date.now();
      try {
        // обновлять метку при любых синхро-событиях
        const events = [
          "categories:changed",
          "subcategories:changed",
          "files:changed",
          "users:changed",
          "groups:changed",
          "registrators:changed",
          "admin:changed",
        ];
        events.forEach(function (ev) {
          on(ev, function () {
            try {
              lastTs = Date.now();
            } catch (_) {}
          });
        });
      } catch (_) {}
      const periodMs = Math.max(5, idleSeconds || 30) * 1000;
      setInterval(function () {
        try {
          if (Date.now() - lastTs >= periodMs) {
            refreshFn();
            lastTs = Date.now();
          }
        } catch (_) {}
      }, Math.min(5000, Math.max(1000, periodMs / 3)));
    } catch (_) {}
  }

  // Публичный API
  return {
    init: init,
    on: on,
    off: off,
    joinRoom: joinRoom,
    debounce: debounce,
    onSoftRefresh: onSoftRefresh,
    startIdleGuard: startIdleGuard,
    setDebug: setDebug,
    getSocket: getSocket,
    onResume: onResume,
    isConnected: isConnected,
    getConnectionState: getConnectionState,
  };
})();

// Автоматическая инициализация при загрузке DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", window.SyncManager.init);
} else {
  window.SyncManager.init();
}
