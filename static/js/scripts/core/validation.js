/**
 * Модуль валидации форм
 * Предоставляет общие функции валидации для всех форм приложения
 *
 * @namespace ValidationModule
 */

/**
 * Общие функции валидации форм
 * @memberof ValidationModule
 */
window.CommonValidation = {
  /**
   * Проверяет, что поле не пустое после обрезки пробелов
   * @param {HTMLInputElement|HTMLTextAreaElement} field - Поле для проверки
   * @param {string} fieldName - Название поля для сообщения об ошибке
   * @returns {boolean} - true если поле валидно
   */
  validateRequired: function (field, fieldName) {
    if (!field || !field.value || field.value.trim() === "") {
      alert(`${fieldName} не может быть пустым`);
      if (field && field.focus) field.focus();
      return false;
    }
    return true;
  },

  /**
   * Проверяет длину пароля
   * @param {HTMLInputElement} passwordField - Поле пароля
   * @param {number} minLength - Минимальная длина
   * @returns {boolean} - true если пароль валиден
   */
  validatePasswordLength: function (passwordField, minLength) {
    if (!passwordField || !passwordField.value) {
      alert("Пароль не может быть пустым");
      if (passwordField && passwordField.focus) passwordField.focus();
      return false;
    }
    if (passwordField.value.length < minLength) {
      alert(`Пароль должен быть не менее ${minLength} символов`);
      if (passwordField.focus) passwordField.focus();
      return false;
    }
    return true;
  },

  /**
   * Проверяет совпадение паролей
   * @param {HTMLInputElement} passwordField - Поле пароля
   * @param {HTMLInputElement} confirmField - Поле подтверждения пароля
   * @returns {boolean} - true если пароли совпадают
   */
  validatePasswordMatch: function (passwordField, confirmField) {
    if (!passwordField || !confirmField) return true;
    if (passwordField.value !== confirmField.value) {
      alert("Пароли не совпадают");
      if (confirmField.focus) confirmField.focus();
      return false;
    }
    return true;
  },

  /**
   * Обрезает пробелы во всех текстовых полях формы
   * @param {HTMLFormElement} form - Форма для обработки
   */
  trimFormFields: function (form) {
    if (!form) return;
    const textFields = form.querySelectorAll(
      'input[type="text"], input[type="password"], textarea'
    );
    textFields.forEach((field) => {
      if (field.value) {
        field.value = field.value.trim();
      }
    });
  },
};
