// Files Form Validation Module
// Валидация форм

// Files Form Validation Module
// Валидация форм

async function validateForm(element) {
  try {
    const form = element.closest("form");
    if (!form) return false;

    const formData = new FormData(form);
    const errors = [];

    // Load configuration
    await window.Config.loadConfig();
    const maxSize = window.Config.getMaxFileSizeBytes();
    const allowedTypes = window.Config.getAllowedFileTypes();

    // Validate required fields
    const requiredFields = form.querySelectorAll("[required]");
    requiredFields.forEach((field) => {
      if (!field.value.trim()) {
        errors.push(
          `Поле "${
            field.getAttribute("name") || field.id
          }" обязательно для заполнения`
        );
        field.classList.add("is-invalid");
      } else {
        field.classList.remove("is-invalid");
      }
    });

    // Validate file fields
    const fileFields = form.querySelectorAll('input[type="file"]');
    fileFields.forEach((field) => {
      if (field.files && field.files.length > 0) {
        const file = field.files[0];

        if (file.size > maxSize) {
          const maxSizeMB = Math.round(maxSize / (1024 * 1024));
          errors.push(
            `Файл "${file.name}" слишком большой (максимум ${maxSizeMB}MB)`
          );
          field.classList.add("is-invalid");
        } else {
          field.classList.remove("is-invalid");
        }

        if (!allowedTypes.includes(file.type)) {
          errors.push(`Тип файла "${file.name}" не поддерживается`);
          field.classList.add("is-invalid");
        } else {
          field.classList.remove("is-invalid");
        }
      }
    });

    // Validate email fields
    const emailFields = form.querySelectorAll('input[type="email"]');
    emailFields.forEach((field) => {
      if (field.value && !isValidEmail(field.value)) {
        errors.push(`Некорректный email: ${field.value}`);
        field.classList.add("is-invalid");
      } else {
        field.classList.remove("is-invalid");
      }
    });

    // Validate number fields
    const numberFields = form.querySelectorAll('input[type="number"]');
    numberFields.forEach((field) => {
      if (field.value && isNaN(field.value)) {
        errors.push(`Некорректное число: ${field.value}`);
        field.classList.add("is-invalid");
      } else {
        field.classList.remove("is-invalid");
      }
    });

    // Show errors if any
    if (errors.length > 0) {
      showValidationErrors(errors);
      return false;
    }

    // Clear any previous errors
    clearValidationErrors();
    return true;
  } catch (err) {
    window.ErrorHandler.handleError(err, "validateForm");
    return false;
  }
}

function isValidEmail(email) {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  } catch (err) {
    return false;
  }
}

function showValidationErrors(errors) {
  try {
    // Remove existing error messages
    clearValidationErrors();

    // Create error container
    const errorContainer = document.createElement("div");
    errorContainer.id = "validation-errors";
    errorContainer.className = "alert alert-danger";
    errorContainer.innerHTML = `
      <h5>Ошибки валидации:</h5>
      <ul>
        ${errors.map((error) => `<li>${error}</li>`).join("")}
      </ul>
    `;

    // Insert at the top of the form
    const form = document.querySelector("form");
    if (form) {
      form.insertBefore(errorContainer, form.firstChild);
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "showValidationErrors");
  }
}

function clearValidationErrors() {
  try {
    const errorContainer = document.getElementById("validation-errors");
    if (errorContainer) {
      errorContainer.remove();
    }

    // Remove invalid classes from all fields
    const invalidFields = document.querySelectorAll(".is-invalid");
    invalidFields.forEach((field) => {
      field.classList.remove("is-invalid");
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "clearValidationErrors");
  }
}

async function validateFileUpload(form) {
  try {
    const fileInput = form.querySelector('input[type="file"]');
    if (!fileInput || !fileInput.files.length) {
      window.ErrorHandler.handleError(
        new Error("Выберите файл для загрузки"),
        "validateFileUpload"
      );
      return false;
    }

    // Load configuration
    await window.Config.loadConfig();
    const maxSize = window.Config.getMaxFileSizeBytes();
    const allowedTypes = window.Config.getAllowedFileTypes();

    const file = fileInput.files[0];

    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      window.ErrorHandler.handleError(
        new Error(`Файл слишком большой (максимум ${maxSizeMB}MB)`),
        "validateFileUpload"
      );
      return false;
    }

    if (!allowedTypes.includes(file.type)) {
      window.ErrorHandler.handleError(
        new Error(`Тип файла не поддерживается`),
        "validateFileUpload"
      );
      return false;
    }

    return true;
  } catch (err) {
    window.ErrorHandler.handleError(err, "validateFileUpload");
    return false;
  }
}

// Export functions to global scope
window.FilesFormValidation = {
  validateForm,
  isValidEmail,
  showValidationErrors,
  clearValidationErrors,
  validateFileUpload,
};
// Backward compatibility for inline handlers
window.validateForm = validateForm;
window.validateFileUpload = validateFileUpload;
