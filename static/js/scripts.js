/**
 * Основной скрипт приложения
 * Содержит глобальные обработчики событий и инициализацию
 *
 * @namespace MainScript
 */

// Глобальная переменная для отслеживания текущего модального окна
var popup = null;

/**
 * Обработчик клавиатуры для модальных окон
 * - Enter: отправляет форму (кроме textarea)
 * - Escape: закрывает модальное окно
 * @memberof MainScript
 */
function popupKeys() {
  document.addEventListener("keydown", function (event) {
    if (popup && event.key === "Escape") {
      event.preventDefault();
      if (typeof closeModal === "function") closeModal(popup);
      else popupToggle(popup);
    }
  });
}

/**
 * Глобальный обработчик Enter для отправки активного модального окна
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }

    const target = event.target;
    if (target && target.tagName === "TEXTAREA") return;

    const overlay = document.querySelector(
      ".overlay-container.show, .overlay-container.visible"
    );
    if (!overlay) return;

    // Предпочитаем явную кнопку по умолчанию
    let defaultBtn = overlay.querySelector('[data-enter="default"]');
    if (!defaultBtn) {
      defaultBtn = overlay.querySelector(".popup__actions .btn-primary");
    }
    if (!defaultBtn) return;

    event.preventDefault();
    defaultBtn.click();
  },
  true
);

/**
 * Глобальные клавиатурные сокращения для модальных окон
 * - Enter: отправляет форму (кроме textarea)
 * - Escape: закрывает модальное окно
 * - Space/P: воспроизводит/приостанавливает медиа
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    if (!popup) return;

    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "TEXTAREA" ||
        active.tagName === "INPUT" ||
        active.isContentEditable);

    // Enter для отправки текущего модального окна (пропускаем textarea)
    if (event.key === "Enter" && !isTyping) {
      event.preventDefault();

      if (popup === "popup-rec") {
        const iframe = document.getElementById("rec-iframe");
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage({ type: "rec:save" }, "*");
          } catch (error) {
            console.error("Failed to send save message to recorder:", error);
          }
        }
        return;
      }

      const overlay = document.getElementById(popup);
      if (!overlay) return;

      // Предпочитаем кнопку отправки формы
      const form = overlay.querySelector("form");
      const submitBtn = overlay.querySelector(
        '.popup__actions .btn.btn-primary, .popup__actions [type="submit"]'
      );
      if (submitBtn) {
        try {
          submitBtn.click();
        } catch (error) {
          console.error("Failed to click submit button:", error);
        }
        return;
      }
    }

    // Escape для закрытия модального окна с существующими защитами
    if (event.key === "Escape") {
      try {
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.warn("Error preventing default:", error);
      }

      // Защищенное поведение для записи: не закрывать во время записи
      if (popup === "popup-rec") {
        try {
          const overlay = document.getElementById("popup-rec");
          if (
            overlay &&
            (overlay.classList.contains("show") ||
              overlay.classList.contains("visible"))
          ) {
            const iframe = document.getElementById("rec-iframe");
            if (iframe && iframe.contentWindow) {
              window.__recCloseRequested = true;
              window.__recCloseReason = "esc";

              if (window.__recStateTimer) {
                clearTimeout(window.__recStateTimer);
                window.__recStateTimer = null;
              }

              iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");

              // Не подтверждаем автоматически через fallback на ESC
              window.__recStateTimer = setTimeout(function () {
                window.__recCloseRequested = false;
                window.__recCloseReason = null;
                window.__recStateTimer = null;
              }, 300);
              return;
            }
          }
        } catch (error) {
          console.warn("Error handling recorder close:", error);
        }
      }

      try {
        popupClose(popup);
      } catch (error) {
        console.error("Failed to close popup:", error);
      }
    }
  },
  true
);

/**
 * Глобальная защита: блокирует Space когда любое видимое модальное окно присутствует
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    // Любое видимое модальное окно?
    const overlay = document.querySelector(
      ".overlay-container.show, .overlay-container.visible"
    );
    if (!overlay) return;

    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    ) {
      return;
    }

    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      // НЕ останавливаем stopImmediatePropagation, чтобы наш обработчик переключения мог работать дальше
      event.stopPropagation();
    }
  },
  true
);

/**
 * "p" и Space для переключения воспроизведения/паузы когда медиа модальные окна открыты
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    // Не срабатывать во время ввода
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    ) {
      return;
    }

    const isP =
      event.code === "KeyP" ||
      (event.key && event.key.toLowerCase && event.key.toLowerCase() === "p");
    const isSpace = event.code === "Space" || event.key === " ";
    if (!isP && !isSpace) return;

    // Определяем, какое медиа модальное окно действительно видимо
    const audioOverlay = document.getElementById("popup-audio");
    const videoOverlay = document.getElementById("popup-view");
    const audioOpen = !!(
      audioOverlay &&
      (audioOverlay.classList.contains("show") ||
        audioOverlay.classList.contains("visible"))
    );
    const videoOpen = !!(
      videoOverlay &&
      (videoOverlay.classList.contains("show") ||
        videoOverlay.classList.contains("visible"))
    );
    if (!audioOpen && !videoOpen) return;

    // Предотвращаем обработчики фоновой страницы и прокрутку
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      console.warn("Error preventing default:", error);
    }

    if (audioOpen) {
      const audio = document.getElementById("player-audio");
      if (audio) {
        if (audio.paused) {
          try {
            audio.play();
          } catch (error) {
            console.warn("Failed to play audio:", error);
          }
        } else {
          try {
            audio.pause();
          } catch (error) {
            console.warn("Failed to pause audio:", error);
          }
        }
      }
    } else if (videoOpen) {
      const video = document.getElementById("player-video");
      if (video) {
        if (video.paused) {
          try {
            video.play();
          } catch (error) {
            console.warn("Failed to play video:", error);
          }
        } else {
          try {
            video.pause();
          } catch (error) {
            console.warn("Failed to pause video:", error);
          }
        }
      }
    }
  },
  true
);

/**
 * Клик вне модального окна для закрытия любого открытого модального окна
 * @memberof MainScript
 */
document.addEventListener(
  "click",
  function (event) {
    const overlay = event.target.closest(".overlay-container");
    if (!overlay) return;

    if (
      event.target === overlay &&
      (overlay.classList.contains("show") ||
        overlay.classList.contains("visible"))
    ) {
      const id = overlay.id;
      if (!id) return;

      if (id === "popup-rec") {
        try {
          const iframe = document.getElementById("rec-iframe");
          if (iframe && iframe.contentWindow) {
            window.__recCloseRequested = true;
            window.__recCloseReason = "esc";

            if (window.__recStateTimer) {
              clearTimeout(window.__recStateTimer);
              window.__recStateTimer = null;
            }

            iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");
            window.__recStateTimer = setTimeout(function () {
              window.__recCloseRequested = false;
              window.__recCloseReason = null;
              window.__recStateTimer = null;
            }, 300);
            return;
          }
        } catch (error) {
          console.warn("Error handling recorder close:", error);
        }
      }

      try {
        popupClose(id);
      } catch (error) {
        overlay.classList.remove("show");
        console.error("Failed to close popup:", error);
      }

      try {
        stopAllMedia();
      } catch (error) {
        console.warn("Failed to stop media:", error);
      }
    }
  },
  true
);

/**
 * Останавливает все медиа когда вкладка становится скрытой (безопасность)
 * @memberof MainScript
 */
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    if (typeof stopAllMedia === "function") {
      stopAllMedia();
    }
  }
});

/**
 * Тестовая функция уведомлений для проверки разрешений браузера
 * @memberof MainScript
 */
function notifyTest() {
  if (!("Notification" in window)) {
    alert("Уведомления не поддерживаются!");
  } else if (Notification.permission === "granted") {
    const notification = new Notification("Проверка", {
      body: "Тестовое уведомление",
      icon: "/static/icons/notification_menu.png",
      requireInteraction: true,
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        const notification = new Notification("Привет!");
      }
    });
  }
}

// Инициализация при загрузке DOM
document.addEventListener("DOMContentLoaded", function () {
  popupKeys();
});
