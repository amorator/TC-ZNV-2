/**
 * Socket Optimizer - Оптимизация работы сокетов
 * Уменьшает частоту запросов при отсутствии основного сокета
 */

(function () {
  "use strict";

  // Глобальное состояние соединения
  let isConnected = false;
  let connectionState = "disconnected";
  let lastConnectionCheck = 0;
  let connectionCheckInterval = null;

  // Интервалы для разных типов операций
  const INTERVALS = {
    CONNECTED: {
      presence: 5000, // 5 секунд при подключении
      upload: 2000, // 2 секунды для загрузки
      heartbeat: 10000, // 10 секунд для heartbeat
      watchdog: 30000, // 30 секунд для watchdog
    },
    DISCONNECTED: {
      presence: 30000, // 30 секунд при отключении
      upload: 10000, // 10 секунд для загрузки
      heartbeat: 60000, // 60 секунд для heartbeat
      watchdog: 120000, // 2 минуты для watchdog
    },
  };

  // Кэш активных интервалов
  const activeIntervals = new Map();

  /**
   * Получить оптимальный интервал для типа операции
   */
  function getOptimalInterval(operationType) {
    const intervals = isConnected
      ? INTERVALS.CONNECTED
      : INTERVALS.DISCONNECTED;
    return intervals[operationType] || intervals.presence;
  }

  /**
   * Создать адаптивный интервал
   */
  function createAdaptiveInterval(operationType, callback, context = null) {
    const intervalId = setInterval(() => {
      try {
        // Проверяем состояние соединения
        updateConnectionState();

        // Выполняем операцию
        if (typeof callback === "function") {
          callback.call(context);
        }
      } catch (err) {
        if (window.showToast) {
          window.showToast(
            `Ошибка в ${operationType}: ${err.message}`,
            "error"
          );
        } else {
          console.error(`Ошибка в ${operationType}:`, err);
        }
      }
    }, getOptimalInterval(operationType));

    // Сохраняем интервал для возможной очистки
    activeIntervals.set(operationType, intervalId);
    return intervalId;
  }

  /**
   * Обновить интервал при изменении состояния соединения
   */
  function updateInterval(operationType) {
    const currentInterval = activeIntervals.get(operationType);
    if (currentInterval) {
      clearInterval(currentInterval);
      activeIntervals.delete(operationType);
    }
  }

  /**
   * Обновить состояние соединения
   */
  function updateConnectionState() {
    const now = Date.now();

    // Проверяем не чаще раза в секунду
    if (now - lastConnectionCheck < 1000) {
      return;
    }

    lastConnectionCheck = now;

    let newState = "disconnected";
    let newConnected = false;

    try {
      // Проверяем SyncManager
      if (
        window.SyncManager &&
        typeof window.SyncManager.getConnectionState === "function"
      ) {
        const syncState = window.SyncManager.getConnectionState();
        if (syncState && syncState.connected) {
          newState = "connected";
          newConnected = true;
        }
      }

      // Проверяем глобальный сокет
      if (!newConnected && window.socket) {
        if (window.socket.connected || window.socket.connecting) {
          newState = "connected";
          newConnected = true;
        }
      }

      // Проверяем io соединение
      if (!newConnected && window.io) {
        // Дополнительная проверка через ping
        if (navigator.onLine !== false) {
          newState = "connected";
          newConnected = true;
        }
      }
    } catch (err) {
      // Игнорируем ошибки проверки
    }

    // Обновляем состояние только при изменении
    if (newConnected !== isConnected) {
      isConnected = newConnected;
      connectionState = newState;

      // Уведомляем о изменении состояния
      window.dispatchEvent(
        new CustomEvent("socketStateChanged", {
          detail: { connected: isConnected, state: connectionState },
        })
      );

      // Обновляем все активные интервалы
      updateAllIntervals();
    }
  }

  /**
   * Обновить все активные интервалы
   */
  function updateAllIntervals() {
    for (const [operationType, intervalId] of activeIntervals) {
      clearInterval(intervalId);
      activeIntervals.delete(operationType);
    }
  }

  /**
   * Создать мониторинг загрузки с адаптивным интервалом
   */
  function createUploadMonitor(uploadId, registratorName, callback) {
    const operationType = "upload";

    return createAdaptiveInterval(operationType, () => {
      // Проверяем состояние соединения
      if (!isConnected) {
        return; // Пропускаем при отключении
      }

      // Выполняем мониторинг
      if (typeof callback === "function") {
        callback(uploadId, registratorName);
      }
    });
  }

  /**
   * Создать мониторинг присутствия с адаптивным интервалом
   */
  function createPresenceMonitor(callback) {
    const operationType = "presence";

    return createAdaptiveInterval(operationType, () => {
      // Проверяем состояние соединения
      if (!isConnected) {
        return; // Пропускаем при отключении
      }

      // Выполняем обновление присутствия
      if (typeof callback === "function") {
        callback();
      }
    });
  }

  /**
   * Создать heartbeat с адаптивным интервалом
   */
  function createHeartbeatMonitor(callback) {
    const operationType = "heartbeat";

    return createAdaptiveInterval(operationType, () => {
      // Выполняем heartbeat независимо от состояния соединения
      if (typeof callback === "function") {
        callback();
      }
    });
  }

  /**
   * Создать watchdog с адаптивным интервалом
   */
  function createWatchdogMonitor(callback) {
    const operationType = "watchdog";

    return createAdaptiveInterval(operationType, () => {
      // Проверяем состояние соединения
      if (!isConnected) {
        return; // Пропускаем при отключении
      }

      // Выполняем watchdog
      if (typeof callback === "function") {
        callback();
      }
    });
  }

  /**
   * Очистить все интервалы
   */
  function clearAllIntervals() {
    for (const [operationType, intervalId] of activeIntervals) {
      clearInterval(intervalId);
    }
    activeIntervals.clear();
  }

  /**
   * Получить текущее состояние соединения
   */
  function getConnectionState() {
    updateConnectionState();
    return {
      connected: isConnected,
      state: connectionState,
      lastCheck: lastConnectionCheck,
    };
  }

  /**
   * Инициализация оптимизатора
   */
  function init() {
    // Запускаем проверку состояния соединения
    connectionCheckInterval = setInterval(updateConnectionState, 1000);

    // Очищаем интервалы при выгрузке страницы
    window.addEventListener("beforeunload", clearAllIntervals);

    // Очищаем интервалы при потере фокуса
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // Увеличиваем интервалы при скрытой вкладке
        updateAllIntervals();
      }
    });
  }

  // Экспортируем API
  window.SocketOptimizer = {
    init,
    getConnectionState,
    createUploadMonitor,
    createPresenceMonitor,
    createHeartbeatMonitor,
    createWatchdogMonitor,
    clearAllIntervals,
    getOptimalInterval,
    isConnected: () => isConnected,
    connectionState: () => connectionState,
  };

  // Автоинициализация
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

