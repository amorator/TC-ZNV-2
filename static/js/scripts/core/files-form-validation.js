// Files Form Validation Module
// Валидация форм

// Files Form Validation Module
// Валидация форм

async function validateForm(element) {
  try {
    const form = element.closest("form");
    if (!form) return false;
    
    // Special handling for delete form (Files)
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

    // Special handling for delete form (Orders)
    if (form.id === "delete" && form.action.includes('/orders/delete/') && element) {
      const formAction = form.action;
      const match = formAction.match(/\/orders\/delete\/(\d+)/);
      if (match) {
        const orderId = match[1];
        submitOrdersDeleteForm(form, orderId);
        return false;
      }
      return false;
    }

    // Special handling for note form (Files)
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

    // Special handling for note form (Orders)
    if (form.id === "note" && form.action.includes('/orders/note/') && element) {
      const formAction = form.action;
      const match = formAction.match(/\/orders\/note\/(\d+)/);
      if (match) {
        const orderId = match[1];
        submitOrdersNoteForm(form, orderId);
        return false;
      }
      return false;
    }

    // Special handling for Orders create form
    if (form.id === 'order-create-form' && form.action.includes('/orders/create') && element) {
      try {
        // Client-side required fields
        var required = ['number','responsible','service','work_name'];
        var missing = required.filter(function(k){
          var el = form.querySelector('[name="'+k+'"]');
          return !el || !String((el.value||'')).trim();
        });
        required.forEach(function(k){ var el = form.querySelector('[name="'+k+'"]'); if (el) el.classList.remove('is-invalid'); });
        if (missing.length) {
          missing.forEach(function(k){ var el = form.querySelector('[name="'+k+'"]'); if (el) el && el.classList.add('is-invalid'); });
          if (window.showToast) window.showToast('Заполните обязательные поля', 'warning');
          return false;
        }
        // Date sequence: issued < start < end (each may be empty)
        function toDate(v){ if (!v) return null; var d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; }
        var fi = form.querySelector('[name="issued"]');
        var fs = form.querySelector('[name="start"]');
        var fe = form.querySelector('[name="end"]');
        [fi,fs,fe].forEach(function(el){ if (el) el.classList.remove('is-invalid'); });
        var di = toDate(fi && fi.value);
        var ds = toDate(fs && fs.value);
        var de = toDate(fe && fe.value);
        function mark(el){ if (el) el.classList.add('is-invalid'); }
        if (di && ds && di > ds) { mark(fi); mark(fs); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Начала работ"', 'warning'); return false; }
        if (ds && de && ds > de) { mark(fs); mark(fe); if (window.showToast) window.showToast('"Начало работ" должно быть раньше "Окончания"', 'warning'); return false; }
        if (di && de && di > de) { mark(fi); mark(fe); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Окончания"', 'warning'); return false; }
        // Submit via fetch (FormData)
        (async function(){
          const fd = new FormData(form);
          const resp = await fetch(form.action, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          const data = await resp.json();
          if (!resp.ok || !(data && data.ok === true)) {
            if (data && data.error === 'validation') { if (window.showToast) window.showToast('Заполните обязательные поля', 'warning'); return; }
            if (window.showToast) window.showToast('Ошибка сохранения', 'danger');
            return;
          }
          try { window.closeModal && window.closeModal('orderCreateModal'); } catch(_) {}
          if (window.showToast) window.showToast('Наряд создан', 'success');
          try { if (typeof window.load === 'function') window.load(1); } catch(_) {}
        })();
        return false;
      } catch (e) {
        window.ErrorHandler && window.ErrorHandler.handleError(e, 'validateForm:orders-create');
        return false;
      }
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

    // Special handling for file upload form
    if (form.hasAttribute('data-upload-form') && form.action.includes('/files/add')) {
      // Validate file upload first
      if (window.FilesFormValidation && window.FilesFormValidation.validateFileUpload) {
        const isValid = await window.FilesFormValidation.validateFileUpload(form);
        if (!isValid) {
          return false;
        }
      }
      
      // If validation passed, start upload
      if (window.FilesManagement && window.FilesManagement.startUploadWithProgress) {
        window.FilesManagement.startUploadWithProgress(form);
        return false;
      }
      
      // Fallback: if startUploadWithProgress not available, return true to allow default submit
      return true;
    }

    // For all other forms, delegate to modal-manager's validateForm if available
    // This ensures backward compatibility
    const formData = new FormData(form);
    const errors = [];

    // Load configuration
    await window.Config.loadConfig();
    const maxSize = window.Config.getMaxFileSizeBytes();
    const allowedTypes = window.Config.getAllowedFileTypes();
    function isTypeAllowed(mime){
      try {
        if (!mime) return true; // be permissive if browser doesn't provide type
        if (Array.isArray(allowedTypes)) {
          for (var i=0;i<allowedTypes.length;i++){
            var t = String(allowedTypes[i]||'').trim();
            if (!t) continue;
            if (t === mime) return true;
            if (t.endsWith('/*')) {
              var pref = t.slice(0, t.length-1); // keep slash
              if (mime.startsWith(pref)) return true;
            }
          }
        }
      } catch(_) {}
      return false;
    }

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

        if (!isTypeAllowed(file.type)) {
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
    if (!fileInput) {
      if (window.showToast) {
        window.showToast("Поле выбора файлов не найдено", "error");
      }
      return false;
    }

    if (!fileInput.files || fileInput.files.length === 0) {
      if (window.showToast) {
        window.showToast("Выберите файл для загрузки", "warning");
      }
      return false;
    }

    // Check max files limit
    const maxFilesInput = document.getElementById("max-upload-files");
    const maxFiles = maxFilesInput ? parseInt(maxFilesInput.value, 10) : 5;
    
    if (fileInput.files.length > maxFiles) {
      if (window.showToast) {
        window.showToast(`Можно загрузить максимум ${maxFiles} файлов. Выбрано: ${fileInput.files.length}`, "error");
      }
      return false;
    }

    // Load configuration
    await window.Config.loadConfig();
    const maxSize = window.Config.getMaxFileSizeBytes();
    const allowedTypes = window.Config.getAllowedFileTypes();
    
    function isTypeAllowed2(mime){
      try {
        if (!mime) return true;
        if (Array.isArray(allowedTypes)) {
          for (var i=0;i<allowedTypes.length;i++){
            var t = String(allowedTypes[i]||'').trim();
            if (!t) continue;
            if (t === mime) return true;
            if (t.endsWith('/*')) {
              var pref = t.slice(0, t.length-1);
              if (mime.startsWith(pref)) return true;
            }
          }
        }
      } catch(_) {}
      return false;
    }

    // Validate all files
    const maxSizeMB = Math.round(maxSize / (1024 * 1024));
    for (let i = 0; i < fileInput.files.length; i++) {
      const file = fileInput.files[i];
      
      if (file.size > maxSize) {
        if (window.showToast) {
          window.showToast(`Файл "${file.name}" слишком большой (максимум ${maxSizeMB}MB)`, "error");
        }
        return false;
      }

      if (!isTypeAllowed2(file.type)) {
        if (window.showToast) {
          window.showToast(`Тип файла "${file.name}" не поддерживается`, "error");
        }
        return false;
      }
    }

    return true;
  } catch (err) {
    window.ErrorHandler.handleError(err, "validateFileUpload");
    if (window.showToast) {
      window.showToast("Ошибка валидации файлов", "error");
    }
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
 * Submit orders note form
 * @param {HTMLFormElement} form - Form element
 * @param {string} orderId - Order ID
 */
async function submitOrdersNoteForm(form, orderId) {
  try {
    const formData = new FormData(form);
    const response = await fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const data = await response.json();
    if (!response.ok || !(data && (data.ok === true))) {
      throw new Error((data && data.error) || `HTTP ${response.status}: ${response.statusText}`);
    }
    if (window.showToast) window.showToast('Примечание сохранено', 'success');
    // Close Orders modal and refresh list
    try { closeModal('orderNoteModal'); } catch(_) {}
    try { if (typeof window.load === 'function') window.load(1); } catch(_) {}
    return data;
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'submitOrdersNoteForm');
  }
}

/**
 * Submit orders delete form
 * @param {HTMLFormElement} form
 * @param {string} orderId
 */
async function submitOrdersDeleteForm(form, orderId) {
  try {
    const formData = new FormData(form);
    const response = await fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const data = await response.json();
    if (!response.ok || !(data && (data.ok === true))) {
      throw new Error((data && data.error) || `HTTP ${response.status}: ${response.statusText}`);
    }
    if (window.showToast) window.showToast('Наряд удалён', 'success');
    try { closeModal('orderDeleteModal'); } catch(_) {}
    try { if (typeof window.load === 'function') window.load(1); } catch(_) {}
    return data;
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'submitOrdersDeleteForm');
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
  submitOrdersNoteForm,
  submitOrdersDeleteForm,
  submitEditForm,
  submitMoveForm,
};
// Backward compatibility for inline handlers
window.validateForm = validateForm;
window.validateFileUpload = validateFileUpload;
window.submitNoteForm = submitNoteForm;
window.submitEditForm = submitEditForm;
window.submitMoveForm = submitMoveForm;
