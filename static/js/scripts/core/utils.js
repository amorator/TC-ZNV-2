/**
 * Общие утилиты для всех страниц приложения
 * Содержит дублирующиеся функции, вынесенные из отдельных модулей
 */

window.Utils = (function () {
  "use strict";

  /**
   * Показать уведомление (toast)
   * @param {string} message - Текст сообщения
   * @param {string} type - Тип уведомления: 'success', 'error', 'warning'
   */
  function showToast(message, type) {
    var container = document.getElementById("toast-container");
    if (!container) return;
    var id = "t" + Date.now() + Math.random().toString(16).slice(2);
    var cls =
      type === "success"
        ? "text-bg-success"
        : type === "error"
        ? "text-bg-danger"
        : "text-bg-warning";
    var html =
      '\n<div id="' +
      id +
      '" class="toast align-items-center ' +
      cls +
      ' border-0" role="alert" aria-live="assertive" aria-atomic="true">\n  <div class="d-flex">\n    <div class="toast-body">' +
      (message || "") +
      '</div>\n    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>\n  </div>\n</div>';
    container.insertAdjacentHTML("beforeend", html);
    var el = document.getElementById(id);
    var t = new bootstrap.Toast(el, { delay: 5000 });
    t.show();
    el.addEventListener("hidden.bs.toast", function () {
      el.remove();
    });
  }

  /**
   * Мягкое обновление страницы (soft refresh)
   * @param {string} pageName - Имя страницы для логирования
   * @param {Function} refreshFn - Функция обновления данных
   */
  function softRefresh(pageName, refreshFn) {
    if (typeof refreshFn === "function") {
      refreshFn();
    } else {
      // Fallback: полная перезагрузка
      window.location.reload();
    }
  }

  /**
   * Валидация формы с показом ошибок
   * @param {HTMLFormElement} form - Форма для валидации
   * @param {Object} rules - Правила валидации
   * @returns {boolean} - true если форма валидна
   */
  function validateForm(form, rules) {
    if (!form) {
      showToast("Форма не найдена", "error");
      return false;
    }

    for (const [fieldName, rule] of Object.entries(rules)) {
      const field = form.querySelector(`[name="${fieldName}"]`);
      if (!field) continue;

      const value = field.value.trim();

      if (rule.required && (!value || value.length === 0)) {
        showToast(
          rule.message || `Поле ${fieldName} обязательно для заполнения`,
          "error"
        );
        field.focus();
        return false;
      }

      if (rule.minLength && value.length < rule.minLength) {
        showToast(
          rule.message || `Минимальная длина: ${rule.minLength} символов`,
          "error"
        );
        field.focus();
        return false;
      }

      if (rule.pattern && !rule.pattern.test(value)) {
        showToast(
          rule.message || `Некорректный формат поля ${fieldName}`,
          "error"
        );
        field.focus();
        return false;
      }
    }

    return true;
  }

  /**
   * AJAX запрос с обработкой ошибок
   * @param {string} url - URL для запроса
   * @param {Object} options - Опции запроса
   * @returns {Promise} - Promise с результатом
   */
  function fetchWithErrorHandling(url, options = {}) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      ...options,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .catch((error) => {
        console.error("Fetch error:", error);
        showToast("Ошибка сети: " + error.message, "error");
        throw error;
      });
  }

  /**
   * Копирование текста в буфер обмена
   * @param {string} text - Текст для копирования
   */
  function copyToClipboard(text) {
    if (!text) {
      showToast("Нет текста для копирования", "warning");
      return;
    }

    try {
      navigator.clipboard.writeText(text);
      showToast("Скопировано", "success");
    } catch (err) {
      // Fallback для старых браузеров
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        showToast("Скопировано", "success");
      } catch (fallbackErr) {
        showToast("Не удалось скопировать", "error");
      }
      document.body.removeChild(textArea);
    }
  }

  /**
   * Дебаунс функция
   * @param {Function} func - Функция для дебаунса
   * @param {number} wait - Задержка в миллисекундах
   * @returns {Function} - Дебаунсированная функция
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Публичный API
  return {
    showToast,
    softRefresh,
    validateForm,
    fetchWithErrorHandling,
    copyToClipboard,
    debounce,
  };
})();

// Глобальные алиасы для обратной совместимости
window.showToast = window.Utils.showToast;
