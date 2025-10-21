/**
 * Страница входа в систему
 * Обрабатывает валидацию и отправку формы входа
 *
 * @namespace LoginPage
 */

/**
 * Обрезает пробелы в поле ввода, если оно существует
 * @param {HTMLInputElement} input - Поле ввода для обработки
 * @memberof LoginPage
 */
function trimIfExists(input) {
  if (input && input.value) {
    input.value = input.value.trim();
  }
}

/**
 * Валидирует и отправляет форму входа
 * @param {HTMLFormElement|HTMLElement} x - Форма или элемент внутри формы
 * @returns {boolean} - true если форма отправлена успешно
 * @memberof LoginPage
 */
function validateForm(x) {
  // Определяем форму: либо переданная форма, либо форма элемента
  var form =
    x && x.tagName === "FORM"
      ? x
      : x && (x.form || (x.closest && x.closest("form")));
  if (!form) {
    return false;
  }

  // Кратковременно отключаем кнопку отправки для предотвращения двойных кликов
  var btn = form.querySelector('button[type="submit"], .login__button');
  var originalText = btn && (btn.textContent || btn.value);

  if (btn) {
    btn.disabled = true;
  }

  // Обрезаем пробелы в полях
  trimIfExists(form.elements["login"]);
  trimIfExists(form.elements["password"]);

  try {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.submit();
    }
  } catch (error) {
    // Восстанавливаем кнопку при ошибке
    if (btn) {
      btn.disabled = false;
      if (originalText !== undefined) {
        if (btn.textContent !== undefined) {
          btn.textContent = originalText;
        } else if (btn.value !== undefined) {
          btn.value = originalText;
        }
      }
    }
    console.error("Login form submission error:", error);
    return false;
  }

  return true;
}
