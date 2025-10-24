/**
 * Главная страница приложения
 * Обеспечивает управление состоянием и синхронизацию через Socket.IO
 *
 * @namespace IndexPage
 */

(function () {
  "use strict";

  /**
   * Получает уникальный идентификатор клиента для текущей сессии
   * @returns {string} - Уникальный ID клиента
   * @memberof IndexPage
   */
  function getClientId() {
    try {
      // ID для текущего окна
      let cid = sessionStorage.getItem("index:clientId:session") || "";
      if (!cid) {
        cid = Math.random().toString(36).slice(2) + Date.now();
        sessionStorage.setItem("index:clientId:session", cid);
      }
      return cid;
    } catch (error) {
      console.error("getClientId error:", error);
      return Math.random().toString(36).slice(2) + Date.now();
    }
  }

  /**
   * Отправляет команду переключения состояния на сервер
   * @param {boolean} [state] - Состояние для установки (опционально)
   * @returns {Promise<Object>} - Ответ сервера
   * @memberof IndexPage
   */
  function sendToggle(state) {
    const clientId = getClientId();
    const url = "/index/toggle";
    const payload = typeof state === "boolean" ? { state } : {};
    const opts = {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        Accept: "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify(payload),
    };

    // Обновляем UI с временной меткой отправки
    const ts = new Date().toISOString();
    const el = document.getElementById("indexSendTs");
    if (el) {
      el.textContent = ts;
      el.classList.remove("pulse-recv");
      el.classList.add("pulse-send");
      setTimeout(() => {
        el.classList.remove("pulse-send");
      }, 400);
    }

    return fetch(url, opts)
      .then(async (response) => {
        if (!response.ok) {
          const text = await response
            .text()
            .catch(() => String(response.status));
          showError(`HTTP ${response.status}: ${text}`);
        }
        return response.json().catch((err) => {
          if (window.showToast) {
            window.showToast("Ошибка парсинга JSON", "error");
          } else {
            console.error("Ошибка парсинга JSON", err);
          }
          return {};
        });
      })
      .catch((error) => {
        showError(`Fetch error: ${error?.message || String(error)}`);
        return {};
      });
  }

  /**
   * Настраивает Socket.IO соединение для главной страницы
   * @memberof IndexPage
   */
  function bindSocket() {
    if (!window.io) return;

    // Используем общий глобальный сокет; создаем если отсутствует
    let sock = window.socket;
    if (!(sock && (sock.connected || sock.connecting))) {
      sock = window.io(window.location.origin, {
        path: "/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
      });
      window.socket = sock;
    }

    // Join index room for force logout events
    if (sock && sock.connected) {
      sock.emit("join-room", "index");
    }

    // UI статуса соединения
    const status = document.getElementById("indexConnStatus");
    const btn = document.getElementById("indexToggleBtn");
    const setState = function (connected) {
      if (status) {
        status.textContent = connected ? "Подключено" : "Отключено";
        status.className = connected
          ? "badge text-bg-success"
          : "badge text-bg-secondary";
      }
      if (btn) btn.disabled = !connected;
    };

    sock.on("connect", function () {
      setState(true);

      // Присоединяемся к комнате для событий главной страницы
      sock.emit && sock.emit("index:join", { ts: Date.now() });
    });

    sock.on("disconnect", function () {
      setState(false);
    });

    // Обработчики ошибок Socket.IO
    sock.on("connect_error", function (err) {
      showError(`Socket connect_error: ${err?.message || err}`);
    });

    sock.on("error", function (err) {
      showError(`Socket error: ${err?.message || err}`);
    });

    // Трассировка событий index
    if (sock.onAny && !sock.__indexOnAnyTracer) {
      sock.__indexOnAnyTracer = true;
      sock.onAny(function (eventName) {
        if (eventName === "index:changed") {
        }
      });
    }

    // Очищаем предыдущие обработчики и устанавливаем новые
    sock.off && sock.off("index:changed");
    sock.off && sock.off("index:joined");

    sock.on("index:joined", function (data) {});

    sock.on("index:changed", function (evt) {
      const ts = new Date().toISOString();
      const el = document.getElementById("indexRecvTs");
      if (el) {
        el.textContent = ts;
        el.classList.remove("pulse-send");
        el.classList.add("pulse-recv");
        setTimeout(() => {
          el.classList.remove("pulse-recv");
        }, 400);
      }

      window.__indexLastRecvTs = Date.now();

      // Отправляем подтверждение с seq для диагностики
      sock.emit && sock.emit("index:ack", { seq: evt?.seq, t: Date.now() });
    });

    // Handle force logout
    sock.on("force-logout", function (data) {
      try {
        console.log("Force logout received on index page");
        // Redirect to logout
        window.location.replace("/logout");
      } catch (err) {
        console.error("Force logout error:", err);
      }
    });

    // Handle force refresh
    sock.on("force-refresh", function (data) {
      try {
        console.log("Force refresh received on index page", data);
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

    window.indexSocket = sock;
  }

  /**
   * Настраивает обработчики UI элементов
   * @memberof IndexPage
   */
  function bindUI() {
    const btn = document.getElementById("indexToggleBtn");
    if (btn) {
      btn.addEventListener("click", function () {
        sendToggle();
      });
    }
  }

  /**
   * Показывает ошибку в UI
   * @param {string} msg - Сообщение об ошибке
   * @memberof IndexPage
   */
  function showError(msg) {
    const el = document.getElementById("indexErrors");
    if (!el) return;

    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.prepend(line);

    // Оставляем только последние 10 записей
    while (el.childNodes.length > 10) {
      el.removeChild(el.lastChild);
    }
  }

  // Инициализация при загрузке DOM
  document.addEventListener("DOMContentLoaded", function () {
    bindUI();
    bindSocket();
  });
})();
