/**
 * Модуль AJAX запросов
 * Предоставляет общие функции для отправки форм через AJAX
 *
 * @namespace AjaxModule
 */

/**
 * Общие AJAX функции
 * @memberof AjaxModule
 */
window.CommonAjax = {
  /**
   * Отправляет форму через AJAX с обработкой ошибок
   * @param {HTMLFormElement} form - Форма для отправки
   * @param {Object} options - Опции обработки
   * @param {function} options.onSuccess - Вызывается при успешной отправке
   * @param {function} options.onError - Вызывается при ошибке
   * @param {function} options.beforeSend - Вызывается перед отправкой
   * @param {function} options.afterSend - Вызывается после завершения
   */
  submitForm: function (form, options = {}) {
    if (!form || !form.action) {
      console.error("Invalid form or missing action");
      return;
    }

    // Обрезаем поля формы
    window.CommonValidation.trimFormFields(form);

    const formData = new FormData(form);
    const submitBtn = form.querySelector(
      'button[type="submit"], input[type="submit"]'
    );
    const originalText = submitBtn
      ? submitBtn.textContent || submitBtn.value
      : "";

    // Callback перед отправкой
    if (options.beforeSend) {
      options.beforeSend(form, submitBtn);
    } else {
      // По умолчанию: отключаем кнопку отправки
      if (submitBtn) {
        submitBtn.disabled = true;
        if (submitBtn.textContent !== undefined) {
          submitBtn.textContent = "Отправка...";
        } else if (submitBtn.value !== undefined) {
          submitBtn.value = "Отправка...";
        }
      }
    }

    fetch(form.action, {
      method: form.method || "POST",
      body: formData,
      credentials: "include",
    })
      .then((response) => {
        if (response.ok) {
          if (options.onSuccess) {
            options.onSuccess(response, form);
          } else {
            // По умолчанию: закрываем модальное окно без перезагрузки
            const modal = form.closest(".overlay-container, .popup, .modal");
            if (modal) {
              const modalId = modal.id;
              try {
                if (typeof closeModal === "function") closeModal(modalId);
                else if (typeof popupClose === "function") popupClose(modalId);
                else popupToggle(modalId);
              } catch (e) {
                console.error("Failed to close modal:", e);
              }
            }
          }
        } else {
          response.text().then((text) => {
            const errorMsg = text || "Неизвестная ошибка";
            if (options.onError) {
              options.onError(errorMsg, response, form);
            } else {
              window.showAlertModal("Ошибка: " + errorMsg, "Ошибка");
            }
          });
        }
      })
      .catch((error) => {
        console.error("AJAX Error:", error);
        const errorMsg = "Ошибка при отправке данных";
        if (options.onError) {
          options.onError(errorMsg, null, form);
        } else {
          window.showAlertModal(errorMsg, "Ошибка");
        }
      })
      .finally(() => {
        // Callback после отправки
        if (options.afterSend) {
          options.afterSend(form, submitBtn, originalText);
        } else {
          // По умолчанию: включаем кнопку отправки обратно
          if (submitBtn) {
            submitBtn.disabled = false;
            if (submitBtn.textContent !== undefined) {
              submitBtn.textContent = originalText;
            } else if (submitBtn.value !== undefined) {
              submitBtn.value = originalText;
            }
          }
        }
      });
  },
};
