/**
 * Модуль управления модальными окнами
 * Обеспечивает открытие/закрытие модальных окон и обработку медиа
 *
 * @namespace ModalModule
 */

/** @type {string|null} ID текущего открытого модального окна */
var popup = null;

/**
 * Останавливает все медиа элементы в документе
 * @memberof ModalModule
 */
function stopAllMedia() {
  const nodes = document.querySelectorAll("video, audio");
  nodes.forEach(function (element) {
    try {
      element.pause && element.pause();
      element.currentTime = 0;

      if (element.srcObject) {
        element.srcObject.getTracks().forEach((track) => {
          track.stop && track.stop();
        });
        element.srcObject = null;
      }

      element.muted = true;
      element.volume = 0;
      element.onerror = null;
      element.removeAttribute("src");
    } catch (error) {
      console.warn("Error stopping media element:", error);
    }
  });
}

/**
 * Переключает видимость модального окна по ID
 * @param {string} popupId - ID модального окна
 * @memberof ModalModule
 */
function popupToggle(popupId) {
  const popupElement = document.getElementById(popupId);
  if (!popupElement) return;

  try {
    window.modlog &&
      window.modlog("popupToggle", {
        id: popupId,
        hasClassVisible: popupElement.classList.contains("visible"),
        display: popupElement.style && popupElement.style.display,
      });
  } catch (_) {}

  if (popupElement.classList.contains("visible")) {
    // Скрываем модальное окно
    popupElement.classList.remove("visible");
    popupElement.style.display = "none";
    document.body.style.overflow = ""; // Восстанавливаем прокрутку
    window.popup = null;

    // Останавливаем медиа внутри модального окна
    const mediaElements = popupElement.querySelectorAll("video, audio");
    mediaElements.forEach(function (element) {
      try {
        element.pause && element.pause();
        element.currentTime = 0;

        if (element.srcObject) {
          element.srcObject.getTracks().forEach((track) => {
            track.stop && track.stop();
          });
          element.srcObject = null;
        }

        element.onerror = null;
        element.removeAttribute("src");
      } catch (error) {
        console.warn("Error stopping media:", error);
      }
    });

    // Дополнительная защита: останавливаем все медиа на странице
    stopAllMedia();

    if (window.__mediaOpenState) {
      window.__mediaOpenState.opening = false;
    }
    try {
      window.modlog && window.modlog("popupToggle -> hide", popupId);
    } catch (_) {}
  } else {
    // Показываем модальное окно
    popupElement.style.display = "flex";
    popupElement.classList.add("visible");
    // Добавляем класс 'show' для совместимости с CSS, управляющим непрозрачностью
    try {
      popupElement.classList.add("show");
    } catch (_) {}
    document.body.style.overflow = "hidden"; // Блокируем прокрутку фона
    window.popup = popupId;

    if (!window.__mediaOpenState) {
      window.__mediaOpenState = { opening: false };
    } else {
      window.__mediaOpenState.opening = false;
    }

    // Сбрасываем флаг сохранения записи при открытии
    if (popupId === "popup-rec") {
      window.__recHasSaved = false;
    }

    // Фокусируемся на первом поле ввода
    setTimeout(() => {
      const firstInput = popupElement.querySelector(
        'input:not([type="hidden"]), textarea, select'
      );
      if (firstInput) {
        firstInput.focus();
      }
    }, 100);

    // Убеждаемся, что медиа не заглушено при открытии
    if (popupId === "popup-audio") {
      const audio = document.getElementById("player-audio");
      if (audio) {
        audio.muted = false;
        audio.volume = 1;
      }
    } else if (popupId === "popup-view") {
      const video = document.getElementById("player-video");
      if (video) {
        video.muted = false;
        video.volume = 1;
      }
    }
    try {
      window.modlog && window.modlog("popupToggle -> show", popupId);
    } catch (_) {}
  }
}

/**
 * Принудительно закрывает модальное окно (без переключения)
 * @param {string} popupId - ID модального окна
 * @memberof ModalModule
 */
function popupClose(popupId) {
  const popupElement = document.getElementById(popupId);
  if (!popupElement) return;

  try {
    window.modlog && window.modlog("popupClose", popupId);
  } catch (_) {}

  // Принудительно закрываем независимо от текущего состояния
  popupElement.classList.remove("visible");
  popupElement.classList.remove("show");
  popupElement.style.display = "none";
  document.body.style.overflow = "";
  window.popup = null;

  // Останавливаем медиа внутри модального окна
  const mediaElements = popupElement.querySelectorAll("video, audio");
  mediaElements.forEach(function (element) {
    try {
      element.pause && element.pause();
      element.currentTime = 0;

      if (element.srcObject) {
        element.srcObject.getTracks().forEach((track) => {
          track.stop && track.stop();
        });
        element.srcObject = null;
      }

      element.muted = true;
      element.volume = 0;
      element.onerror = null;
      element.removeAttribute("src");
    } catch (error) {
      console.warn("Error stopping media:", error);
    }
  });

  // Дополнительная защита: останавливаем все медиа на странице
  stopAllMedia();
}

/**
 * Отображает имя пользователя в ссылке выхода
 * @param {string} name - Имя пользователя
 * @memberof ModalModule
 */
function displayName(name) {
  const nav = document.getElementById("nav");
  if (!nav) return;

  const links = nav.getElementsByTagName("a");
  for (let i = links.length - 1; i >= 0; i--) {
    if (links[i].href.endsWith("logout")) {
      links[i].firstChild.data += " (" + name + ")";
    }
  }
}

/**
 * Проверяет, что поле ввода имеет непустое значение после обрезки
 * @param {HTMLInputElement} element - Элемент для проверки
 * @returns {boolean} - true если поле валидно
 * @memberof ModalModule
 */
function trimIfExists(element) {
  if (element != null) {
    if (element.value == null || element.value.trim() == "") {
      return false;
    }
  }
  return true;
}

// Экспорт функций в глобальную область
window.popupToggle = popupToggle;
window.popupClose = popupClose;
window.stopAllMedia = stopAllMedia;
window.displayName = displayName;
window.trimIfExists = trimIfExists;
