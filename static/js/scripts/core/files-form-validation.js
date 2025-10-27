// Files Form Validation Module
// Валидация форм

// Files Form Validation Module
// Валидация форм

async function validateForm(element) {
  try {
    const form = element.closest("form");
    if (!form) return false;
    
    // Special handling for delete form
    if (form.id === "delete" && form.action.includes('/files/delete/') && element) {
      const formAction = form.action;
      
      // Extract ID from URL like /files/delete/123
      const match = formAction.match(/\/files\/delete\/(\d+)/);
      if (match) {
        const fileId = match[1];
        
        // Close modal and call deleteFile
        closeModal('popup-delete');
        setTimeout(() => {
          if (window.FilesManagement && window.FilesManagement.deleteFile) {
            window.FilesManagement.deleteFile(fileId);
          }
        }, 100);
        return false;
      }
      return false;
    }

    // Special handling for note form
    if (form.id === "note" && form.action.includes('/files/note/') && element) {
      const formAction = form.action;
      
      // Extract ID from URL like /files/note/123
      const match = formAction.match(/\/files\/note\/(\d+)/);
      if (match) {
        const fileId = match[1];
        
        // Submit the note form via fetch
        submitNoteForm(form, fileId);
        return false;
      }
      return false;
    }

    // Special handling for edit form
    if (form.id === "edit" && form.action.includes('/files/edit/') && element) {
      const formAction = form.action;
      
      // Extract ID from URL like /files/edit/123
      const match = formAction.match(/\/files\/edit\/(\d+)/);
      if (match) {
        const fileId = match[1];
        
        // Submit the edit form via fetch
        submitEditForm(form, fileId);
        return false;
      }
      return false;
    }

    // Special handling for move form
    if (form.id === "move" && form.action.includes('/files/move/') && element) {
      const formAction = form.action;
      
      // Extract ID from URL like /files/move/123
      const match = formAction.match(/\/files\/move\/(\d+)/);
      if (match) {
        const fileId = match[1];
        
        // Submit the move form via fetch
        submitMoveForm(form, fileId);
        return false;
      }
      return false;
    }

    // For all other forms, delegate to modal-manager's validateForm if available
    // This ensures backward compatibility
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

/**
 * Submit note form
 * @param {HTMLFormElement} form - Form element
 * @param {string} fileId - File ID
 */
async function submitNoteForm(form, fileId) {
  try {
    const formData = new FormData(form);
    
    const response = await fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-Client-Id': window.__filesClientId || 'unknown',
      },
    });

    const data = await response.json();
    
    if (!response.ok || data.status !== 'success') {
      throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    if (window.showToast) {
      window.showToast('Примечание сохранено', 'success');
    }
    
    // Close modal
    closeModal('popup-note');
    
    // Trigger refresh
    if (window.FilesManagement && window.FilesManagement.debouncedSync) {
      window.FilesManagement.debouncedSync();
    }
    
    return data;
  } catch (err) {
    window.ErrorHandler.handleError(err, 'submitNoteForm');
  }
}

/**
 * Submit edit form
 * @param {HTMLFormElement} form - Form element
 * @param {string} fileId - File ID
 */
async function submitEditForm(form, fileId) {
  try {
    const formData = new FormData(form);
    
    const response = await fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-Client-Id': window.__filesClientId || 'unknown',
      },
    });

    const data = await response.json();
    
    if (!response.ok || data.status !== 'success') {
      throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    if (window.showToast) {
      window.showToast('Файл обновлен', 'success');
    }
    
    // Close modal
    closeModal('popup-edit');
    
    // Trigger refresh
    if (window.FilesManagement && window.FilesManagement.debouncedSync) {
      window.FilesManagement.debouncedSync();
    }
    
    return data;
  } catch (err) {
    window.ErrorHandler.handleError(err, 'submitEditForm');
  }
}

/**
 * Submit move form
 * @param {HTMLFormElement} form - Form element
 * @param {string} fileId - File ID
 */
async function submitMoveForm(form, fileId) {
  try {
    const formData = new FormData(form);
    
    const response = await fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-Client-Id': window.__filesClientId || 'unknown',
      },
    });

    const data = await response.json();
    
    if (!response.ok || data.status !== 'success') {
      throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    if (window.showToast) {
      window.showToast('Файл перемещен', 'success');
    }
    
    // Close modal
    closeModal('popup-move');
    
    // Trigger refresh
    if (window.FilesManagement && window.FilesManagement.debouncedSync) {
      window.FilesManagement.debouncedSync();
    }
    
    return data;
  } catch (err) {
    window.ErrorHandler.handleError(err, 'submitMoveForm');
  }
}

// Export functions to global scope
window.FilesFormValidation = {
  validateForm,
  isValidEmail,
  showValidationErrors,
  clearValidationErrors,
  validateFileUpload,
  submitNoteForm,
  submitEditForm,
  submitMoveForm,
};
// Backward compatibility for inline handlers
window.validateForm = validateForm;
window.validateFileUpload = validateFileUpload;
window.submitNoteForm = submitNoteForm;
window.submitEditForm = submitEditForm;
window.submitMoveForm = submitMoveForm;
