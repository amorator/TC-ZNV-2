/**
 * Hydrate popup forms with values derived from the selected row.
 * - For add: wires filename -> name autofill.
 * - For edit/delete/note: fills inputs from row with given id.
 * @param {HTMLElement} form The form or any element within the form
 * @param {number|string} id The numeric id of the target row (for non-add forms)
 */
function popupValues(form, id) {
  if (form.id != "add" && !id) {
    return;
  }
  if (form.id == "add") {
    const nameInput = document.getElementById("add-name");
    
    // Track if user has manually typed in the name field
    nameInput.addEventListener('input', function() {
      nameInput.userHasTyped = true;
    });
    
    // Track if user has manually typed (including paste)
    nameInput.addEventListener('paste', function() {
      nameInput.userHasTyped = true;
    });
    
    document.getElementById("file").addEventListener("change", function(event) {
      const files = event.target.files;
      
      if (files.length > 1) {
        // Multiple files selected - disable name field and show message
        nameInput.disabled = true;
        nameInput.value = '';
        nameInput.placeholder = 'Будут использованы имена файлов';
        nameInput.title = 'При загрузке нескольких файлов используются их реальные имена';
      } else if (files.length === 1) {
        // Single file selected - enable name field and auto-fill
        nameInput.disabled = false;
        nameInput.placeholder = 'Имя файла...';
        nameInput.title = '';
        
        const fileName = files[0].name;
        
        // Only auto-fill if the name field is empty or user hasn't typed anything
        if (!nameInput.value || nameInput.value.trim() === '' || !nameInput.userHasTyped) {
          // Remove extension from filename
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
          nameInput.value = nameWithoutExt;
          nameInput.userHasTyped = false; // Reset flag after auto-fill
        }
      } else {
        // No files selected - reset to default state
        nameInput.disabled = false;
        nameInput.placeholder = 'Имя файла...';
        nameInput.title = '';
      }
    });
    return;
  }
  let values = document.getElementById(id).getElementsByTagName("td");
  if (form.id == "edit") {
    const nameVal = (values[0].innerText || '').trim();
    let descVal = (values[1].innerText || '').trim();
    
    // Don't show "Нет описания..." in edit form - show empty field instead
    if (descVal === 'Нет описания...') {
      descVal = '';
    }
    
    form.getElementsByTagName("input")[0].value = nameVal;
    form.getElementsByTagName("textarea")[0].value = descVal;
    // Store originals for change detection
    try {
      form.dataset.rowId = String(id);
      form.dataset.origName = nameVal;
      form.dataset.origDesc = descVal; // Already cleaned from "Нет описания..."
    } catch (_) {}
    let select = form.getElementsByTagName("select")[0];
  } else if (form.id == "move") {
    // Ensure action URL targets the selected file id (replace any trailing /digits)
    if (form.action) {
      if (/\/\d+$/.test(form.action)) {
        form.action = form.action.replace(/\/\d+$/, '/' + id);
      } else if (/\/0$/.test(form.action)) {
        form.action = form.action.replace(/\/0$/, '/' + id);
      }
    }
    try { form.dataset.rowId = String(id); } catch(_) {}
  } else if (form.id == "delete") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[0].innerText;
  } else if (form.id == "note") {
    // Read note directly from row attribute to avoid mixing with viewers text
    const row = document.getElementById(id);
    const note = (row && row.getAttribute('data-note')) ? row.getAttribute('data-note') : '';
    form.getElementsByTagName("textarea")[0].value = note;
    try {
      form.dataset.rowId = String(id);
      form.dataset.origNote = note || '';
    } catch (_) {}
  }
  form.action = form.action.replace(new RegExp("0$"), id);
}

/**
 * Validate and submit forms on the files page.
 * For add: performs client-side validation and starts XHR upload with progress.
 * For others: submits normally.
 * @param {HTMLElement} x The element that triggered validation (inside a form)
 * @returns {boolean} Whether the native submit should proceed
 */
function validateForm(element) {
  
  // Find the form element
  const form = element.closest('form');
  if (!form) {
    console.error('Form not found');
    return false;
  }
  
  
  if (form.id == "add" || form.id == "edit") {
    // Trim all input fields first
    const inputs = form.querySelectorAll('input[type="text"], input[type="password"], textarea');
    inputs.forEach(input => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });
    
    // Find the name input field specifically
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) {
      let name = (nameInput.value || '').replace(/\u00a0/g, ' ').trim();
      
      // For multiple file uploads, skip name validation (real names will be used)
      const fileInput = form.querySelector('input[type="file"]');
      const isMultiple = fileInput && fileInput.files && fileInput.files.length > 1;
      
      if (!isMultiple && (name == undefined || name == "" || name.length < 1)) {
      if (window.showToast) { window.showToast('Задайте корректное имя файла!', 'error'); } else { alert('Задайте корректное имя файла!'); }
        nameInput.focus();
        return false;
      }
    } else {
      console.error('Name input not found');
      return false;
    }
    // For edit: block submit if no changes (name/description)
    if (form.id == "edit") {
      try {
        const origName = form.dataset.origName || '';
        const origDesc = form.dataset.origDesc || '';
        const descInput = form.querySelector('textarea[name="description"]');
        const nowName = (nameInput.value || '').replace(/\u00a0/g, ' ').trim();
        const nowDesc = descInput ? (descInput.value || '').trim() : '';
        if (nowName === origName && nowDesc === origDesc) {
          try { popupClose('popup-edit'); } catch(_) {}
          return false;
        }
      } catch (e) {}
    }
  }
  if (form.id == "add") {
    let fileInput = document.getElementById("file");
    let len = fileInput.files.length;
    if (len == undefined || len == 0) {
      if (window.showToast) { window.showToast('Выберите файл(ы)!', 'error'); } else { alert('Выберите файл(ы)!'); }
      return false;
    }
    if (len > 5) {
      if (window.showToast) { window.showToast('Можно выбрать максимум 5 файлов', 'error'); } else { alert('Можно выбрать максимум 5 файлов'); }
      return false;
    }
    // Client-side file validation for each file
    const files = Array.from(fileInput.files);
    const maxSizeMbElement = document.getElementById('max-file-size-mb');
    const maxSizeMb = maxSizeMbElement ? parseInt(maxSizeMbElement.value) : 500;
    const maxSize = maxSizeMb * 1024 * 1024;
    const allowedTypes = ['video/mp4', 'video/webm', 'video/avi', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/x-m4v'];
    const allowedExtensions = ['.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v'];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxSize) {
        if (window.showToast) { window.showToast(`Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`, 'error'); } else { alert(`Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`); }
        return false;
      }
      if (f.size === 0) {
        if (window.showToast) { window.showToast(`Файл ${f.name} пустой!`, 'error'); } else { alert(`Файл ${f.name} пустой!`); }
        return false;
      }
      let isValidType = allowedTypes.includes(f.type);
      if (!isValidType) {
        const fileName = f.name.toLowerCase();
        isValidType = allowedExtensions.some(ext => fileName.endsWith(ext));
      }
      if (!isValidType) {
        if (window.showToast) { window.showToast(`Неподдерживаемый формат: ${f.name}. Разрешены: ${allowedExtensions.join(', ')}`, 'error'); } else { alert(`Неподдерживаемый формат: ${f.name}. Разрешены: ${allowedExtensions.join(', ')}`); }
        return false;
      }
    }
    // Prevent native submit; start upload (single or multi handled inside)
    startUploadWithProgress(form);
    return false;
  }
  
  // For non-add forms, validate and submit via AJAX
  if (form.id !== "add") {
    // Trim all input fields for other forms too
    const inputs = form.querySelectorAll('input[type="text"], input[type="password"], textarea');
    inputs.forEach(input => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });
    
    submitFileFormAjax(form);
    return false; // Prevent default form submission
  }
  
  return true;
}

/**
 * Start file upload with progress bar and cancellation support.
 * Handles both single-phase and two-phase (init+upload) flows.
 * @param {HTMLFormElement} form The add form element
 */
function startUploadWithProgress(form) {
  // Show progress bar and hide buttons
  const progressDiv = document.getElementById('upload-progress');
  const submitBtn = document.getElementById('add-submit-btn');
  const cancelBtn = document.getElementById('add-cancel-btn');
  
  if (!progressDiv) { return; }
  
  const progressBar = progressDiv.querySelector('.progress-bar');
  const statusText = progressDiv.querySelector('.upload-status small');
  
  if (!progressBar || !statusText) { return; }
  
  // Show progress bar
  progressDiv.classList.remove('d-none');
  
  // Disable submit button, enable cancel button
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Отменить загрузку';
    cancelBtn.onclick = function() {
      cancelUpload();
    };
  }
  
  // Lock text input fields during upload
  const nameInput = form.querySelector('input[name="name"]');
  const descriptionInput = form.querySelector('textarea[name="description"]');
  const fileInput = form.querySelector('input[type="file"]');
  
  // Get files array first
  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  
  if (nameInput) {
    nameInput.disabled = true;
    // For multiple files, show that names will be used from files
    if (files.length > 1) {
      nameInput.placeholder = 'Будут использованы имена файлов';
      nameInput.value = '';
    } else {
      nameInput.placeholder = 'Загрузка...';
    }
  }
  if (descriptionInput) descriptionInput.disabled = true;
  if (fileInput) fileInput.disabled = true;
  const multi = files.length > 1;
  if (multi && nameInput) {
    nameInput.value = '';
    nameInput.placeholder = 'При множественной загрузке используются реальные имена файлов';
  }

  // Combined progress accounting
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let uploadedBytesSoFar = 0;

  // Helper to render combined progress
  function renderCombinedProgress(currentFileLoaded, currentFileTotal, index) {
    const loaded = uploadedBytesSoFar + currentFileLoaded;
    const percent = totalBytes > 0 ? (loaded / totalBytes) * 100 : 100;
    progressBar.style.width = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    statusText.textContent = multi
      ? `Загрузка файлов (${index+1}/${files.length})... ${loadedMB}MB / ${totalMB}MB (${Math.round(percent)}%)`
      : `Загрузка файла... ${loadedMB}MB / ${totalMB}MB (${Math.round(percent)}%)`;
  }

  // Upload a single file (reusing single/two-phase logic)
  function uploadOne(file, index, doneCb, errCb) {
    const nameVal = form.querySelector('input[name="name"]').value;
    const descVal = (form.querySelector('textarea[name="description"]').value || '');

    const xhr = new XMLHttpRequest();
    window.currentUploadXHR = xhr;
    try { xhr.withCredentials = true; } catch(e) {}

    xhr.upload.addEventListener('progress', function(e) {
      if (e.lengthComputable) {
        renderCombinedProgress(e.loaded, e.total, index);
      }
    });
    xhr.upload.addEventListener('load', function() {
      try { statusText.textContent = multi ? 'Отправлено, выполняется обработка...' : 'Файл загружен, выполняется обработка...'; } catch(e) {}
    });

    xhr.addEventListener('error', function() { errCb('Ошибка соединения'); });
    xhr.addEventListener('abort', function() { errCb('Загрузка отменена'); });
    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 400) {
        uploadedBytesSoFar += file.size;
        doneCb();
      } else {
        errCb('Ошибка загрузки файла');
      }
    });

    // Determine flow (two-phase if >= 1.5GB)
    const threshold = (1024*1024*1024*1.5);
    const isLarge = file.size >= threshold;

    if (isLarge) {
      // init
      const initXhr = new XMLHttpRequest();
      try { initXhr.withCredentials = true; } catch(e) {}
      initXhr.open('POST', form.action.replace('/add/', '/add/init/'));
      initXhr.onload = function(){
        try {
          const resp = JSON.parse(initXhr.responseText || '{}');
          if (resp && resp.upload_url) {
            // upload
            const fd = new FormData();
            fd.append('file', file, file.name);
            xhr.open('POST', resp.upload_url);
            xhr.send(fd);
          } else {
            errCb('Не удалось инициализировать загрузку');
          }
        } catch(e) { errCb('Ошибка инициализации загрузки'); }
      };
      initXhr.onerror = function(){ errCb('Ошибка соединения при инициализации'); };
      const initData = new FormData();
      initData.append('name', nameVal);
      initData.append('description', descVal);
      initXhr.send(initData);
    } else {
      // single-phase POST to add endpoint with this one file
      const fd = new FormData();
      fd.append('name', nameVal);
      fd.append('description', descVal);
      fd.append('file', file, file.name);
      xhr.open('POST', form.action);
      xhr.send(fd);
    }
  }

  // If single file, fall back to old behavior via the same helper
  if (files.length <= 1) {
    if (files.length === 1) {
      renderCombinedProgress(0, files[0].size, 0);
      uploadOne(files[0], 0, function onDone() {
        // success UI
        progressBar.style.width = '100%';
        progressBar.setAttribute('aria-valuenow', 100);
        statusText.textContent = 'Загрузка завершена! Обновление таблицы...';
        setTimeout(() => { 
          popupToggle('popup-add'); 
          // Reset form after successful upload
          try { resetAfterUpload(); } catch(e) {}
          // Use AJAX refresh instead of page reload
          try { window.refreshFilesPage(); } catch(e) {}
          // Emit socket event for other users
          try { 
            if (window.socket && window.socket.emit) {
              window.socket.emit('files:changed', { reason: 'upload-complete' });
            }
          } catch(e) {}
        }, 1000);
      }, function onErr(msg){ handleUploadError(msg); });
    }
      return;
    }

  // Multiple files: upload sequentially
  let index = 0;
  function next() {
    if (index >= files.length) {
      progressBar.style.width = '100%';
      progressBar.setAttribute('aria-valuenow', 100);
      statusText.textContent = 'Все файлы загружены! Обновление таблицы...';
      setTimeout(() => { 
        popupToggle('popup-add'); 
        // Reset form after successful upload
        try { resetAfterUpload(); } catch(e) {}
        try { window.refreshFilesPage(); } catch(e) {}
        // Emit socket event for other users
        try { 
          if (window.socket && window.socket.emit) {
            window.socket.emit('files:changed', { reason: 'upload-complete' });
          }
        } catch(e) {}
      }, 1000);
      return;
    }
    renderCombinedProgress(0, files[index].size, index);
    uploadOne(files[index], index, function(){ index++; next(); }, function(msg){ handleUploadError(msg); });
  }
  next();

  /**
   * Helper function to upload a single file with progress tracking
   * @param {File} file - File to upload
   * @param {number} index - Index of the file in the upload queue
   * @param {function} successCb - Success callback
   * @param {function} errorCb - Error callback
   */
  function uploadOne(file, index, successCb, errorCb) {
    const xhr = new XMLHttpRequest();
    
    // Track progress
    xhr.upload.addEventListener('progress', function(e) {
      if (e.lengthComputable) {
        renderCombinedProgress(e.loaded, e.total, index);
      }
    });
    
    // Handle successful upload
    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 400) {
        if (successCb) successCb();
      } else {
        if (errorCb) errorCb(`Ошибка загрузки: ${xhr.status}`);
      }
    });
    
    // Handle errors
    xhr.addEventListener('error', function() {
      if (errorCb) errorCb('Ошибка соединения');
    });
    
    xhr.addEventListener('abort', function() {
      if (errorCb) errorCb('Загрузка отменена');
    });
    
    // Prepare form data
    const formData = new FormData();
    formData.append('file', file);
    
    // Get files array from the form
    const fileInput = form.querySelector('input[type="file"]');
    const allFiles = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    
    // For multiple files, always use the real file name (without extension)
    if (allFiles.length > 1) {
      formData.append('name', file.name.replace(/\.[^/.]+$/, "")); // Remove extension
    } else {
      // For single file, use the name from input field if available
      const nameInput = form.querySelector('input[name="name"]');
      const inputName = nameInput ? nameInput.value.trim() : '';
      formData.append('name', inputName || file.name.replace(/\.[^/.]+$/, ""));
    }
    
    const descInput = form.querySelector('textarea[name="description"]');
    formData.append('description', descInput ? descInput.value.trim() : '');
    
    // Store xhr for cancellation
    window.currentUploadXHR = xhr;
    
    // Send the request
    xhr.open('POST', form.action);
    xhr.send(formData);
  }
}

/**
 * Update progress bar for combined upload progress
 * @param {number} loaded - Bytes loaded for current file
 * @param {number} total - Total bytes for current file  
 * @param {number} fileIndex - Index of current file being uploaded
 */
function renderCombinedProgress(loaded, total, fileIndex) {
  const progressBar = document.querySelector('#upload-progress .progress-bar');
  const statusText = document.querySelector('#upload-progress .upload-status small');
  
  if (!progressBar || !statusText) return;
  
  // Calculate overall progress across all files
  const files = document.getElementById('file').files;
  if (!files || files.length === 0) return;
  
  let totalSize = 0;
  let loadedSize = 0;
  
  // Calculate total size of all files
  for (let i = 0; i < files.length; i++) {
    totalSize += files[i].size;
  }
  
  // Calculate loaded size (completed files + current file progress)
  for (let i = 0; i < fileIndex; i++) {
    loadedSize += files[i].size;
  }
  loadedSize += loaded;
  
  // Update progress bar
  const percentage = totalSize > 0 ? Math.round((loadedSize / totalSize) * 100) : 0;
  progressBar.style.width = percentage + '%';
  progressBar.setAttribute('aria-valuenow', percentage);
  
  // Update status text
  const currentFileNum = fileIndex + 1;
  const totalFiles = files.length;
  const fileName = files[fileIndex] ? files[fileIndex].name : '';
  
  if (totalFiles > 1) {
    statusText.textContent = `Загрузка файла ${currentFileNum} из ${totalFiles}: ${fileName} (${percentage}%)`;
  } else {
    statusText.textContent = `Загрузка файла: ${fileName} (${percentage}%)`;
  }
}

/**
 * Handle upload error and restore UI state
 * @param {string} message - Error message to display
 */
function handleUploadError(message) {
  const progressDiv = document.getElementById('upload-progress');
  const statusText = progressDiv.querySelector('.upload-status small');
  const submitBtn = document.getElementById('add-submit-btn');
  const cancelBtn = document.getElementById('add-cancel-btn');
  
  // Show error message
  if (statusText) {
    statusText.textContent = message || 'Ошибка загрузки';
    statusText.style.color = 'var(--danger-color, #dc3545)';
  }
  
  // Re-enable form
  if (submitBtn) submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Закрыть';
    cancelBtn.onclick = function() {
      popupToggle('popup-add');
    };
  }
  
  // Re-enable input fields
  const form = document.getElementById('add');
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');
    
    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = 'Имя файла...';
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }
  
  // Clear upload reference
  window.currentUploadXHR = null;
}

/**
 * Abort the current upload request and restore UI state.
 */
function cancelUpload() {
  
  
  // Abort the current upload
  if (window.currentUploadXHR) {
    window.currentUploadXHR.abort();
    window.currentUploadXHR = null;
  }
  
  // Reset UI
  const progressDiv = document.getElementById('upload-progress');
  const submitBtn = document.getElementById('add-submit-btn');
  const cancelBtn = document.getElementById('add-cancel-btn');
  const statusText = progressDiv.querySelector('.upload-status small');
  
  if (statusText) {
    statusText.textContent = 'Загрузка отменена';
    statusText.style.color = 'var(--danger-color, #dc3545)';
  }
  
  // Re-enable submit button, reset cancel button
  if (submitBtn) submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = function() {
      popupToggle('popup-add');
    };
  }
  
  // Re-enable input fields
  const form = document.getElementById('add');
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');
    
    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = 'Имя файла...';
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }
  
  // Hide progress after delay
  setTimeout(() => {
    progressDiv.classList.add('d-none');
    if (statusText) {
      statusText.style.color = '';
      statusText.textContent = 'Загрузка файла...';
    }
  }, 2000);
}

/**
 * Show an error message in the upload UI and restore controls.
 * @param {string} message Error message for the user
 */
function handleUploadError(message) {
  const progressDiv = document.getElementById('upload-progress');
  const submitBtn = document.getElementById('add-submit-btn');
  const cancelBtn = document.getElementById('add-cancel-btn');
  const statusText = progressDiv.querySelector('.upload-status small');
  
  statusText.textContent = message;
  statusText.style.color = 'var(--danger-color, #dc3545)';
  
  // Re-enable submit button, reset cancel button
  submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = function() {
      popupToggle('popup-add');
    };
  }
  
  // Re-enable input fields
  const form = document.getElementById('add');
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');
    
    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = 'Имя файла...';
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }
  
  // Clear global xhr reference
  window.currentUploadXHR = null;
  
  // Hide progress after delay
  setTimeout(() => {
    progressDiv.classList.add('d-none');
    statusText.style.color = '';
    statusText.textContent = 'Загрузка файла...';
  }, 3000);
}

// Default sort by "Дата создания" (descending) for files table
/**
 * Sort the files table by the "Дата создания" column in descending order.
 */
function sortFilesTableByDateDesc() {
  try {
    const table = document.getElementById('maintable');
    if (!table) return;
    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    // Fixed column index for "Дата создания": 3 (0-based)
    const dateHeaderIndex = 3;

    // Select all data rows (skip the search/actions row)
    const dataRows = Array.from(tbody.querySelectorAll('tr:not(.table__body_actions)'));
    if (!dataRows.length) return;

    const toTimestamp = (s) => {
      if (!s) return 0;
      s = s.replace(/\u00a0/g, ' ').trim();
      const iso = s.replace(' ', 'T');
      let t = Date.parse(iso);
      if (isNaN(t)) t = Date.parse(iso + ':00');
      return isNaN(t) ? 0 : t;
    };

    const fallbackCompare = (a, b) => {
      const ta = toTimestamp(a);
      const tb = toTimestamp(b);
      if (ta === 0 && tb === 0) {
        // Fallback to string comparison if both dates are invalid
        return b.localeCompare(a);
      }
      return tb - ta;
    };

    dataRows
      .sort((a, b) => {
        const va = (a.children[dateHeaderIndex]?.innerText || a.children[dateHeaderIndex]?.textContent || '').trim();
        const vb = (b.children[dateHeaderIndex]?.innerText || b.children[dateHeaderIndex]?.textContent || '').trim();
        return fallbackCompare(va, vb); // DESC with fallback
      })
      .forEach((tr) => tbody.appendChild(tr));
  } catch (e) {}
}

// Pagination (15 rows per page), persists current page in localStorage
/**
 * Initialize client-side pagination for files table.
 * Exposes window.filesPager with readPage/renderPage helpers.
 */
function initFilesPagination() {
  const table = document.getElementById('maintable');
  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  // Include both ready rows and processing rows; exclude only the actions/search row
  const rows = Array.from(tbody.querySelectorAll('tr:not(.table__body_actions)'));
  const pager = document.getElementById('files-pagination');
  if (!pager) return;
  const pageSize = 15;
  const key = 'files_page:' + location.pathname + location.search;

  function getPageCount() {
    return Math.max(1, Math.ceil(rows.length / pageSize));
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function readPage() {
    const saved = parseInt(localStorage.getItem(key) || '1', 10);
    return clamp(isNaN(saved) ? 1 : saved, 1, getPageCount());
  }

  function writePage(p) {
    localStorage.setItem(key, String(p));
  }

  function renderPage(page) {
    const pages = getPageCount();
    page = clamp(page, 1, pages);
    rows.forEach((tr, idx) => {
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      tr.style.display = idx >= start && idx < end ? 'table-row' : 'none';
    });
    writePage(page);
    renderControls(page, pages);
  }

  function renderControls(page, pages) {
    const btn = (label, targetPage, disabled = false, extraClass = '') =>
      `<li class="page-item ${extraClass} ${disabled ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${targetPage}">${label}</a></li>`;

    const items = [];
    items.push(btn('⏮', 1, page === 1, 'first'));
    items.push(btn('‹', page - 1, page === 1, 'prev'));

    // Always include first page
    items.push(`<li class="page-item ${page === 1 ? 'active' : ''}"><a class="page-link" href="#" data-page="1">1</a></li>`);

    // Left ellipsis
    const leftStart = Math.max(2, page - 2);
    const leftGap = leftStart - 2;
    if (leftGap >= 1) {
      items.push(`<li class="page-item disabled"><span class="page-link">…</span></li>`);
    }

    // Middle window
    const midStart = Math.max(2, page - 2);
    const midEnd = Math.min(pages - 1, page + 2);
    for (let p = midStart; p <= midEnd; p++) {
      items.push(`<li class="page-item ${p === page ? 'active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`);
    }

    // Right ellipsis
    const rightEnd = Math.min(pages - 1, page + 2);
    const rightGap = (pages - 1) - rightEnd;
    if (rightGap >= 1) {
      items.push(`<li class="page-item disabled"><span class="page-link">…</span></li>`);
    }

    // Always include last page
    if (pages > 1) {
      items.push(`<li class="page-item ${page === pages ? 'active' : ''}"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`);
    }

    items.push(btn('›', page + 1, page === pages, 'next'));
    items.push(btn('⏭', pages, page === pages, 'last'));

    pager.innerHTML = `<nav><ul class="pagination mb-0">${items.join('')}</ul></nav>`;
    
    // Add event delegation for better performance
    pager.addEventListener('click', (e) => {
      const target = e.target.closest('[data-page]');
      if (!target) return;
      
      e.preventDefault();
      const p = parseInt(target.getAttribute('data-page') || '1', 10);
      renderPage(p);
      const table = document.getElementById('maintable');
      if (table) {
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  renderPage(readPage());

  // expose pager controls for integration with search clear/restore
  window.filesPager = {
    renderPage: renderPage,
    readPage: readPage
  };
}

// Search integration: filter across all pages, restore page on clear
/**
 * Filter the files table rows by a query across all visible text.
 * Preserves pagination state and limits results while searching.
 * @param {string} query The search string
 */
function filesDoFilter(query) {
  const table = document.getElementById('maintable');
  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  const pager = document.getElementById('files-pagination');
  // Include both ready rows and processing rows; exclude only the actions/search row
  const rows = Array.from(tbody.querySelectorAll('tr:not(.table__body_actions)'));

  const q = (query || '').trim().toUpperCase();
  const active = q.length > 0;

  if (active) {
    let shown = 0;
    const maxResults = 30;
    rows.forEach((row) => {
      let match = false;
      Array.from(row.children).forEach((cell) => {
        if ((cell.innerText || cell.textContent || '').toUpperCase().includes(q)) match = true;
      });
      if (match && shown < maxResults) {
        row.style.display = 'table-row';
        shown++;
      } else {
        row.style.display = 'none';
      }
    });
    if (pager) {
      pager.classList.add('d-none');
    }
  } else {
    if (pager) {
      pager.classList.remove('d-none');
    }
    if (window.filesPager && typeof window.filesPager.readPage === 'function' && typeof window.filesPager.renderPage === 'function') {
      window.filesPager.renderPage(window.filesPager.readPage());
    } else {
      rows.forEach((row) => (row.style.display = 'table-row'));
    }
  }
}

// Global clear handler used by inline onclick
window.searchClean = function () {
  const el = document.getElementById('searchinp');
  if (el) {
    el.value = '';
  }
  try {
    const searchKey = 'files_search:' + location.pathname + location.search;
    localStorage.removeItem(searchKey);
  } catch (e) {}
  // restore pagination to saved page
  if (window.filesPager && typeof window.filesPager.readPage === 'function' && typeof window.filesPager.renderPage === 'function') {
    window.filesPager.renderPage(window.filesPager.readPage());
  } else {
    filesDoFilter('');
  }
};

document.addEventListener('DOMContentLoaded', function () {
  // Initialize missing file banners for files that don't exist
  const rows = document.querySelectorAll('tr[data-exists="0"]');
  rows.forEach(row => {
    const fileId = row.getAttribute('data-id');
    if (fileId) {
      // Inline function to mark file as missing (since markFileAsMissing is defined later)
      try {
        const targetRow = document.querySelector(`tr[data-id="${fileId}"]`) || document.getElementById(String(fileId));
        if (!targetRow) return;
        targetRow.setAttribute('data-exists', '0');
        // Insert banner at the top of the notes column (last column)
        const tds = targetRow.querySelectorAll('td');
        const notesTd = tds[tds.length - 1];
        if (!notesTd) return;
        let banner = notesTd.querySelector('.file-missing-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.className = 'file-missing-banner';
          banner.style.color = 'var(--danger, #b00020)';
          banner.style.fontWeight = '600';
          banner.style.marginBottom = '4px';
          banner.textContent = 'Файл не найден';
          notesTd.prepend(banner);
        } else {
          banner.textContent = 'Файл не найден';
        }
      } catch (e) { /* noop */ }
    }
  });
  
  // Run after other ready handlers
  sortFilesTableByDateDesc();
  initFilesPagination();
  const input = document.getElementById('searchinp');
  if (input) {
    const searchKey = 'files_search:' + location.pathname + location.search;
    // restore previous search
    try {
      const saved = localStorage.getItem(searchKey);
      if (saved && typeof saved === 'string') {
        input.value = saved;
        filesDoFilter(saved);
      }
    } catch (e) {}

    input.addEventListener('input', (e) => {
      const val = e.target.value || '';
      try {
        if (val.trim().length > 0) {
          localStorage.setItem(searchKey, val);
        } else {
          localStorage.removeItem(searchKey);
        }
      } catch (err) {}
      filesDoFilter(val);
    });
  }

  // Socket.IO live updates for files table
  try {
    if (window.io) {
      /**
       * @type {import('socket.io-client').Socket}
       */
      const socket = window.io(window.location.origin, {
        // Allow both transports for better compatibility
        transports: ['websocket', 'polling'],
        upgrade: true,
        path: '/socket.io/',
        withCredentials: true,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      });
      
      // Store socket globally for potential replacement
      window.socket = socket;
      
      /**
       * Handle successful connection - refresh table to get latest data
       */
      socket.on('connect', function() {
        softRefreshFilesTable();
      });
      
      /**
       * Handle disconnection - Socket.IO will attempt automatic reconnection
       * @param {string} reason - Reason for disconnection
       */
      socket.on('disconnect', function(reason) {
        // Connection lost, will attempt reconnection
      });
      
      /**
       * Handle connection errors - Socket.IO will handle reconnection automatically
       * @param {Error} err - Connection error
       */
      socket.on('connect_error', function(err) {
        // Connection error, Socket.IO will handle reconnection automatically
      });
      
      /**
       * Handle successful reconnection - refresh table to get latest data
       * @param {number} attemptNumber - Number of reconnection attempts
       */
      socket.on('reconnect', function(attemptNumber) {
        softRefreshFilesTable();
      });
      
      /**
       * Handle reconnection errors - Socket.IO will continue trying
       * @param {Error} error - Reconnection error
       */
      socket.on('reconnect_error', function(error) {
        // Reconnection error, will continue trying
      });
      
      /**
       * Handle reconnection failure - create a completely new socket connection
       */
      socket.on('reconnect_failed', function() {
        setTimeout(() => {
          try {
            /**
             * @type {import('socket.io-client').Socket}
             */
            const newSocket = window.io(window.location.origin, {
              transports: ['websocket', 'polling'],
              upgrade: true,
              path: '/socket.io/',
              withCredentials: true,
              forceNew: true,
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000
            });
            
            // Copy event handlers to new socket
            newSocket.on('connect', function() {
              softRefreshFilesTable();
            });
            
            newSocket.on('disconnect', function(reason) {
              // Connection lost, will attempt reconnection
            });
            
            newSocket.on('connect_error', function(err) {
              // Connection error, Socket.IO will handle reconnection automatically
            });
            
            newSocket.on('reconnect', function(attemptNumber) {
              softRefreshFilesTable();
            });
            
            newSocket.on('reconnect_error', function(error) {
              // Reconnection error, will continue trying
            });
            
            newSocket.on('reconnect_failed', function() {
              // Will create another new connection
            });
            
            newSocket.on('files:changed', function(evt) {
              softRefreshFilesTable();
            });
            
            newSocket.on('/files:changed', function(evt) {
              softRefreshFilesTable();
            });
            
            // Replace the old socket
            socket.disconnect();
            window.socket = newSocket;
          } catch (e) {
            // Error creating new socket, will retry on next reconnect_failed
          }
        }, 2000);
      });
      
      /**
       * Handle files changed event - refresh table to show updates
       * @param {Object} evt - Event data
       */
      socket.on('files:changed', function(evt) {
        // Handle file missing status updates
        if ((evt.reason === 'metadata' || evt.reason === 'moved') && evt.id && evt.file_exists !== undefined) {
          if (evt.file_exists) {
            window.clearFileMissingStatus(evt.id);
          } else {
            window.markFileAsMissing(evt.id);
          }
        }
        softRefreshFilesTable();
      });
      
      /**
       * Handle files changed event on default namespace - refresh table to show updates
       * @param {Object} evt - Event data
       */
      socket.on('/files:changed', function(evt) {
        // Handle file missing status updates
        if ((evt.reason === 'metadata' || evt.reason === 'moved') && evt.id && evt.file_exists !== undefined) {
          if (evt.file_exists) {
            window.clearFileMissingStatus(evt.id);
          } else {
            window.markFileAsMissing(evt.id);
          }
        }
        softRefreshFilesTable();
      });
    }
  } catch (e) {
    // Socket.IO initialization failed, table will work without live updates
  }

  // Helper: smooth table update without flickering
  function smoothUpdateTableBody(oldTbody, newTbody) {
    const oldRows = Array.from(oldTbody.querySelectorAll('tr'));
    const newRows = Array.from(newTbody.querySelectorAll('tr'));
    
    // Create maps for efficient lookup
    const oldRowMap = new Map();
    const newRowMap = new Map();
    
    oldRows.forEach(row => {
      const id = row.getAttribute('data-id') || row.id;
      if (id) oldRowMap.set(id, row);
    });
    
    newRows.forEach(row => {
      const id = row.getAttribute('data-id') || row.id;
      if (id) newRowMap.set(id, row);
    });
    
    // Update existing rows
    for (const [id, newRow] of newRowMap) {
      const oldRow = oldRowMap.get(id);
      if (oldRow) {
        // Update existing row content without replacing the entire row
        const oldCells = oldRow.querySelectorAll('td');
        const newCells = newRow.querySelectorAll('td');
        
        if (oldCells.length === newCells.length) {
          // Update cell content
          for (let i = 0; i < oldCells.length; i++) {
            if (oldCells[i].innerHTML !== newCells[i].innerHTML) {
              oldCells[i].innerHTML = newCells[i].innerHTML;
            }
          }
          // Update row attributes
          Array.from(newRow.attributes).forEach(attr => {
            if (oldRow.getAttribute(attr.name) !== attr.value) {
              oldRow.setAttribute(attr.name, attr.value);
            }
          });
        } else {
          // Row structure changed, replace it
          oldRow.replaceWith(newRow.cloneNode(true));
        }
      } else {
        // Add new row
        oldTbody.appendChild(newRow.cloneNode(true));
      }
    }
    
    // Remove rows that no longer exist
    for (const [id, oldRow] of oldRowMap) {
      if (!newRowMap.has(id)) {
        oldRow.remove();
      }
    }
  }

  // Register with TableManager and unify soft refresh.
  // Preserves search/pagination and rebinds page-specific handlers after refresh.
  try { window.tableManager && window.tableManager.registerTable('maintable', { pageType: 'files', refreshEndpoint: window.location.href, smoothUpdate: true }); } catch(_) {}
  function softRefreshFilesTable() {
    const table = document.getElementById('maintable');
    if (!table) return;
    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    // Keep current search and page
    const searchKey = 'files_search:' + location.pathname + location.search;
    let savedSearch = '';
    try { savedSearch = localStorage.getItem(searchKey) || ''; } catch(e) {}

    const currentPage = (window.filesPager && typeof window.filesPager.readPage === 'function')
      ? window.filesPager.readPage()
      : 1;

    // Use tableManager refresh then run page-specific rebinds
    if (window.tableManager && window.tableManager.softRefreshTable) {
      window.tableManager.softRefreshTable('maintable').then(function(){
        const newTbody = document.querySelector('#maintable tbody');
        if (!newTbody) return;

        // Ensure context menu reflects new row states/actions after refresh
        try { reinitializeContextMenu(); } catch(e) {}

        // Rebind dblclick handlers for opening player
        try { bindRowOpenHandlers(); } catch(e) {}
        // Rebind copy handlers for names
        try { bindCopyNameHandlers(); } catch(e) {}

        // Restore missing file banners after table refresh
        try {
          const missingRows = document.querySelectorAll('tr[data-exists="0"]');
          missingRows.forEach(row => {
            const fileId = row.getAttribute('data-id');
            if (fileId) {
              // Use the global function if available, otherwise inline
              if (window.markFileAsMissing) {
                window.markFileAsMissing(fileId);
              } else {
                // Inline banner creation
                const tds = row.querySelectorAll('td');
                const notesTd = tds[tds.length - 1];
                if (notesTd && !notesTd.querySelector('.file-missing-banner')) {
                  const banner = document.createElement('div');
                  banner.className = 'file-missing-banner';
                  banner.style.color = 'var(--danger, #b00020)';
                  banner.style.fontWeight = '600';
                  banner.style.marginBottom = '4px';
                  banner.textContent = 'Файл не найден';
                  notesTd.prepend(banner);
                }
              }
            }
          });
        } catch(e) {}

        // Reapply sort (desc by date)
        try { sortFilesTableByDateDesc(); } catch(e) {}

        // Reinit pagination to bind to new rows
        try { initFilesPagination(); } catch(e) {}

        // Reapply search filter if any, otherwise show the same page
        if (savedSearch && savedSearch.trim().length > 0) {
          filesDoFilter(savedSearch);
        } else if (window.filesPager && typeof window.filesPager.renderPage === 'function') {
          window.filesPager.renderPage(currentPage);
        }

        // Final safety: reinitialize context menu once more after all adjustments
        try { reinitializeContextMenu(); } catch(e) {}
      });
    }
  }

  // Periodic refresh while there are rows in processing state
  (function setupProcessingWatcher() {
    let timer = null;
    function checkAndSchedule() {
      const table = document.getElementById('maintable');
      if (!table) return;
      // Check by scanning text content (no :contains in querySelector)
      const need = Array.from(table.querySelectorAll('td.table__body_item')).some(td => (td.innerText || td.textContent || '').indexOf('Обрабатывается') !== -1);
      if (need && timer == null) {
        timer = setInterval(softRefreshFilesTable, 10000);
      } else if (!need && timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }
    // Initial and on visibility change
    checkAndSchedule();
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        checkAndSchedule();
      }
    });
    // Also re-evaluate after each soft refresh
    const origSoft = softRefreshFilesTable;
    softRefreshFilesTable = function() {
      origSoft();
      setTimeout(checkAndSchedule, 1000);
    };
  })();

  // Initial bind for dblclick row open
  function bindRowOpenHandlers() {
    try {
      const table = document.getElementById('maintable');
      if (!table) return;
      const rows = table.querySelectorAll('tbody tr.table__body_row');
      rows.forEach(tr => {
        tr.addEventListener('dblclick', function() {
          const url = tr.getAttribute('data-url');
          const exists = tr.getAttribute('data-exists');
          if (!url) return;
          
          // Don't open missing files
          if (exists === '0') {
            return;
          }
          
          const player = document.getElementById('player-video');
          if (player) {
            try { player.pause(); } catch(e) {}
            player.src = url;
            try { player.currentTime = 0; } catch(e) {}
            
            // Add error handler for missing files
            player.onerror = function() {
              const fileId = tr.getAttribute('data-id');
              console.error('Video load error for file:', fileId);
              if (fileId) {
                window.markFileAsMissing(fileId);
              }
              // Close the player modal
              const modal = document.getElementById('popup-view');
              if (modal) {
                popupClose('popup-view');
              }
            };
          }
          popupToggle('popup-view');
        });
      });
    } catch (e) {}
  }
  bindRowOpenHandlers();

  // Change detection for edit, move, and note modals
  (function initFilesChangeDetection(){
    function closeModal(id){ try { popupClose(id); } catch(_) {} }

    // Edit: compare name/description
    const editForm = document.getElementById('edit');
    if (editForm && !editForm._changeBound) {
      editForm._changeBound = true;
      const saveBtn = editForm.querySelector('button.btn.btn-primary');
      if (saveBtn) {
        saveBtn.addEventListener('click', function(){
          try {
            const nameNow = (editForm.querySelector('input[name="name"]').value || '').trim();
            const descNow = (editForm.querySelector('textarea[name="description"]').value || '').trim();
            const nameOrig = editForm.dataset.origName || '';
            const descOrig = editForm.dataset.origDesc || '';
            if (nameNow === nameOrig && descNow === descOrig) {
              closeModal('popup-edit');
              return;
            }
          } catch(_) {}
          try { window.submitFileFormAjax(editForm); } catch(_) {}
        });
      }
    }

    // Move: compare selects to row data-root/data-sub
    const moveForm = document.getElementById('move');
        if (moveForm && !moveForm._changeBound) {
      moveForm._changeBound = true;
      moveForm.addEventListener('submit', function(e){
        try {
          const rootSel = document.getElementById('move-target-root');
          const subSel = document.getElementById('move-target-sub');
          const id = (moveForm.action.match(/\/(\d+)$/) || [])[1];
          const row = id ? document.getElementById(String(id)) : null;
          const currentRoot = row ? row.getAttribute('data-root') : null;
          const currentSub = row ? row.getAttribute('data-sub') : null;
          const targetRoot = rootSel ? rootSel.value : null;
          const targetSub = subSel ? subSel.value : null;
          if (currentRoot && currentSub && targetRoot === currentRoot && targetSub === currentSub) {
            e.preventDefault();
            closeModal('popup-move');
          }
            // If moving, perform AJAX submit and reinitialize table after
            e.preventDefault();
            const formData = new FormData(moveForm);
            fetch(moveForm.action, { method: 'POST', body: formData, credentials: 'include' })
              .then(r => {
                if (!r.ok) throw new Error('HTTP '+r.status);
              })
              .finally(() => {
                try { closeModal('popup-move'); } catch(_) {}
                try { softRefreshFilesTable(); } catch(_) {}
              });
        } catch(_) {}
      });
    }

    // Note: require non-empty and changed text
    const noteForm = document.getElementById('note');
    if (noteForm && !noteForm._changeBound) {
      noteForm._changeBound = true;
      noteForm.addEventListener('submit', function(e){
        try {
          const ta = noteForm.querySelector('textarea[name="note"]');
          const now = (ta && ta.value ? ta.value.trim() : '');
          const orig = noteForm.dataset.origNote || '';
          if (!now || now === orig) {
            e.preventDefault();
            closeModal('popup-note');
          }
        } catch(_) {}
      });
    }
  })();

  // Bind click-to-copy on file name in the first column
  function bindCopyNameHandlers() {
    try {
      const links = document.querySelectorAll('#maintable tbody .files-page__link');
      links.forEach((el) => {
        // Avoid duplicate listeners
        if (el._copyBound) return;
        el._copyBound = true;
        el.style.cursor = 'copy';
        el.title = 'Клик — скопировать имя';
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          const text = (el.textContent || '').trim();
          if (!text) return;
          const onDone = () => {
            // brief visual feedback
            const prev = el.style.transition;
            const prevBg = el.style.backgroundColor;
            el.style.transition = 'background-color 0.2s ease';
            el.style.backgroundColor = 'rgba(255, 230, 150, 0.9)';
            setTimeout(() => { el.style.backgroundColor = prevBg || ''; el.style.transition = prev || ''; }, 200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onDone).catch(function(){
              // Fallback
              try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'absolute';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                onDone();
              } catch(_) {}
            });
          } else {
            // Legacy fallback
            try {
              const ta = document.createElement('textarea');
              ta.value = text;
              ta.setAttribute('readonly', '');
              ta.style.position = 'absolute';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
              onDone();
            } catch(_) {}
          }
        });
      });
    } catch (e) {}
  }
  bindCopyNameHandlers();

  // Player hotkeys while popup-view is open
  document.addEventListener('keydown', function(e) {
    const overlay = document.getElementById('popup-view');
    if (!overlay || !overlay.classList.contains('show')) return;
    const video = document.getElementById('player-video');
    if (!video) return;
    if (e.code === 'KeyF') {
      e.preventDefault();
      try {
        if (!document.fullscreenElement) {
          video.requestFullscreen && video.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      } catch(_) {}
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      try { video.muted = !video.muted; } catch(_) {}
    }
  });

  // Initialize unified context menu for files page
  function initFilesContextMenu() {
    const table = document.getElementById('maintable');
    if (!table) return;

    // Get table permissions
    const canAdd = table.getAttribute('data-can-add') === '1';
    const canMarkView = table.getAttribute('data-can-mark-view') === '1';
    const canNotes = table.getAttribute('data-can-notes') === '1';

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: 'files',
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: 'files',
            canAdd: canAdd,
            canMarkView: canMarkView,
            canNotes: canNotes
          });
        }
      }, 100);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilesContextMenu);
  } else {
    initFilesContextMenu();
  }

  // Function to refresh the files page after actions
  window.refreshFilesPage = function() {
    // Use soft refresh instead of page reload
    try {
      if (window.softRefreshFilesTable) {
        window.softRefreshFilesTable();
      } else {
        // Fallback: reload current category/subcategory
        const currentCategory = document.querySelector('.category-nav .active')?.getAttribute('data-category') || '0';
        const currentSubcategory = document.querySelector('.subcategory-nav .active')?.getAttribute('data-subcategory') || '1';
        if (window.navigateToCategory) {
          window.navigateToCategory(currentCategory, currentSubcategory);
        }
      }
    } catch(e) {
      console.error('Error refreshing files page:', e);
    }
  };

  /**
   * Navigate to a different category/subcategory via AJAX
   * @param {number} did - Directory (category) ID
   * @param {number} sdid - Subdirectory (subcategory) ID
   * @param {boolean} updateHistory - Whether to update browser history
   */
  window.navigateToCategory = function(did, sdid, updateHistory = true) {
    const url = `/fls/${did}/${sdid}`;
    
    
    fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest' // Indicate AJAX request
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    })
    .then(html => {
      // Parse the response HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Update category navigation
      const newCatNav = doc.querySelector('.subbar.cat .subbar__group');
      const currentCatNav = document.querySelector('.subbar.cat .subbar__group');
      if (newCatNav && currentCatNav) {
        currentCatNav.innerHTML = newCatNav.innerHTML;
        // Re-attach navigation event listeners
        attachCategoryNavigationListeners();
      }
      
      // Update subcategory navigation
      const newSubcatNav = doc.querySelector('.subbar.subcat .subbar__group');
      const currentSubcatNav = document.querySelector('.subbar.subcat .subbar__group');
      if (newSubcatNav && currentSubcatNav) {
        currentSubcatNav.innerHTML = newSubcatNav.innerHTML;
        // Re-attach navigation event listeners
        attachSubcategoryNavigationListeners();
      }
      
      // Update table smoothly
      const newTable = doc.querySelector('#maintable');
      const currentTable = document.querySelector('#maintable');
      if (newTable && currentTable) {
        const newTbody = newTable.querySelector('tbody');
        const currentTbody = currentTable.querySelector('tbody');
        if (newTbody && currentTbody) {
          // Use smooth update for table body
          smoothUpdateTableBody(currentTbody, newTbody);
        } else {
          // Fallback to full replacement if structure is different
          currentTable.innerHTML = newTable.innerHTML;
        }
        // Re-initialize table functionality
        reinitializeTableAfterNavigation();
      }
      
      // Update browser history
      if (updateHistory) {
        const newUrl = `/fls/${did}/${sdid}`;
        history.pushState({ did: did, sdid: sdid }, '', newUrl);
      }
      
      // Update current page state
      window.currentDid = did;
      window.currentSdid = sdid;
      
    })
    .catch(error => {
      console.error('Navigation error:', error);
      // Fallback to full page reload
      window.location.href = url;
    });
  };

  /**
   * Attach event listeners to category navigation links
   */
  function attachCategoryNavigationListeners() {
    const categoryLinks = document.querySelectorAll('.subbar.cat .topbtn');
    categoryLinks.forEach((link, index) => {
      // Remove href to prevent default navigation
      link.removeAttribute('href');
      // Add cursor pointer style
      link.style.cursor = 'pointer';
      
      // Add click handler
      link.addEventListener('click', function(e) {
        
        e.preventDefault();
        e.stopPropagation();
        const did = index;
        const sdid = 1; // Default to first subcategory
        
        navigateToCategory(did, sdid);
        return false;
      });
    });
  }

  /**
   * Attach event listeners to subcategory navigation links
   */
  function attachSubcategoryNavigationListeners() {
    const subcategoryLinks = document.querySelectorAll('.subbar.subcat .topbtn');
    subcategoryLinks.forEach((link, index) => {
      // Remove href to prevent default navigation
      link.removeAttribute('href');
      // Add cursor pointer style
      link.style.cursor = 'pointer';
      
      // Add click handler
      link.addEventListener('click', function(e) {
        
        e.preventDefault();
        e.stopPropagation();
        const did = window.currentDid || 0;
        const sdid = index + 1; // Subcategories start from 1
        
        navigateToCategory(did, sdid);
        return false;
      });
    });
  }

  /**
   * Reinitialize context menu after table update
   */
  function reinitializeContextMenu() {
    try {
      // Trigger a custom event to reinitialize context menu
      // The existing IIFE will handle the reinitialization
      const event = new CustomEvent('context-menu-reinit', {
        detail: { timestamp: Date.now() }
      });
      document.dispatchEvent(event);
      
      // Also trigger table update event for any other listeners
      document.dispatchEvent(new Event('table-updated'));
      
    } catch(e) {
      // Silent fail
    }
  }

  /**
   * Reinitialize table functionality after navigation
   */
  function reinitializeTableAfterNavigation() {
    try {
      // Re-initialize context menu after table update
      reinitializeContextMenu();
      
      // Trigger table update event
      document.dispatchEvent(new Event('table-updated'));
      
      // Re-attach double-click handlers for video opening
      bindRowOpenHandlers();
      
      // Restore missing file banners after navigation
      try {
        const missingRows = document.querySelectorAll('tr[data-exists="0"]');
        missingRows.forEach(row => {
          const fileId = row.getAttribute('data-id');
          if (fileId) {
            // Use the global function if available, otherwise inline
            if (window.markFileAsMissing) {
              window.markFileAsMissing(fileId);
            } else {
              // Inline banner creation
              const tds = row.querySelectorAll('td');
              const notesTd = tds[tds.length - 1];
              if (notesTd && !notesTd.querySelector('.file-missing-banner')) {
                const banner = document.createElement('div');
                banner.className = 'file-missing-banner';
                banner.style.color = 'var(--danger, #b00020)';
                banner.style.fontWeight = '600';
                banner.style.marginBottom = '4px';
                banner.textContent = 'Файл не найден';
                notesTd.prepend(banner);
              }
            }
          }
        });
      } catch(e) {}
      
      // Re-attach navigation listeners after content update
      attachCategoryNavigationListeners();
      attachSubcategoryNavigationListeners();
      
      // Reapply sort (desc by date) and pagination, then restore search
      try { sortFilesTableByDateDesc(); } catch(e) {}
      try { initFilesPagination(); } catch(e) {}
      try {
        const searchKey = 'files_search:' + location.pathname + location.search;
        const saved = localStorage.getItem(searchKey) || '';
        if (saved && saved.trim().length > 0) {
          filesDoFilter(saved);
        } else if (window.filesPager && typeof window.filesPager.readPage === 'function' && typeof window.filesPager.renderPage === 'function') {
          window.filesPager.renderPage(window.filesPager.readPage());
        }
      } catch(e) {}
      // Context menu works via event delegation
      
    } catch (e) {
      console.error('Error reinitializing table:', e);
    }
  }

  // Initialize navigation on page load
  document.addEventListener('DOMContentLoaded', function() {
    // Get current did/sdid from URL or page data
    const urlParts = window.location.pathname.split('/');
    if (urlParts[1] === 'fls') {
      window.currentDid = parseInt(urlParts[2]) || 0;
      window.currentSdid = parseInt(urlParts[3]) || 1;
    }
    
    // Attach navigation listeners
    attachCategoryNavigationListeners();
    attachSubcategoryNavigationListeners();
    
    // Handle browser back/forward
    window.addEventListener('popstate', function(e) {
      if (e.state && e.state.did !== undefined && e.state.sdid !== undefined) {
        navigateToCategory(e.state.did, e.state.sdid, false);
      }
    });
  });

  // Function to update file row locally without page refresh
  window.updateFileRowLocally = function(fileId, fileData) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`);
      if (!row) return;
      
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        // Update name (column 0)
        if (fileData.name !== undefined) {
          cells[0].textContent = fileData.name;
        }
        
        // Update description (column 1)
        if (fileData.description !== undefined) {
          cells[1].textContent = fileData.description;
        }
        
        // Update other fields if provided
        if (fileData.owner !== undefined && cells[2]) {
          cells[2].textContent = fileData.owner;
        }
        
        if (fileData.date !== undefined && cells[3]) {
          cells[3].textContent = fileData.date;
        }
      }
    } catch (e) {
      console.error('Error updating file row locally:', e);
    }
  };

  // Mark a file row as missing on disk: show a non-editable banner and flag the row
  window.markFileAsMissing = function(fileId) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`) || document.getElementById(String(fileId));
      if (!row) return;
      row.setAttribute('data-exists', '0');
      // Insert banner at the top of the notes column (last column)
      const tds = row.querySelectorAll('td');
      const notesTd = tds[tds.length - 1];
      if (!notesTd) return;
      let banner = notesTd.querySelector('.file-missing-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'file-missing-banner';
        banner.style.color = 'var(--danger, #b00020)';
        banner.style.fontWeight = '600';
        banner.style.marginBottom = '4px';
        banner.textContent = 'Файл не найден';
        notesTd.prepend(banner);
      } else {
        banner.textContent = 'Файл не найден';
      }
    } catch (e) { /* noop */ }
  };

  // Clear missing status from a file row
  window.clearFileMissingStatus = function(fileId) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`) || document.getElementById(String(fileId));
      if (!row) return;
      row.setAttribute('data-exists', '1');
      // Remove banner from notes column
      const tds = row.querySelectorAll('td');
      const notesTd = tds[tds.length - 1];
      if (notesTd) {
        const banner = notesTd.querySelector('.file-missing-banner');
        if (banner) {
          banner.remove();
        }
      }
    } catch (e) { /* noop */ }
  };

  // Function to add new file row locally
  window.addFileRowLocally = function(fileData) {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      
      const newRow = document.createElement('tr');
      newRow.setAttribute('data-id', fileData.id);
      newRow.innerHTML = `
        <td>${fileData.name || ''}</td>
        <td>${fileData.description || ''}</td>
        <td>${fileData.owner || ''}</td>
        <td>${fileData.date || ''}</td>
        <td class="table__body_action">
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-edit" 
                  onclick="popupValues(document.getElementById('edit'), ${fileData.id}); popupToggle('popup-edit');">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-delete" 
                  onclick="popupValues(document.getElementById('delete'), ${fileData.id}); popupToggle('popup-delete');">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      `;
      
      tbody.appendChild(newRow);
      
      // Update pagination if needed
      updateFilePaginationCounts();
    } catch (e) {
      console.error('Error adding file row locally:', e);
    }
  };

  // Function to remove file row locally
  window.removeFileRowLocally = function(fileId) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`);
      if (row) {
        row.remove();
        // Update pagination if needed
        updateFilePaginationCounts();
      }
    } catch (e) {
      console.error('Error removing file row locally:', e);
    }
  };

  // Function to update file pagination counts
  function updateFilePaginationCounts() {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      
      const totalRows = tbody.querySelectorAll('tr').length;
      const pageInfo = document.querySelector('.pagination-info');
      if (pageInfo) {
        // Update total count display
        pageInfo.textContent = `Всего записей: ${totalRows}`;
      }
    } catch (e) {
      console.error('Error updating file pagination counts:', e);
    }
  }
  
  /**
   * Local function removed to avoid recursion - use window.refreshFilesPage directly
   */
  
  /**
   * Soft refresh files table without page reload
   */
  window.softRefreshFilesTable = function() {
    // Get current category and subcategory
    const currentCategory = document.querySelector('.category-nav .active')?.getAttribute('data-category') || '0';
    const currentSubcategory = document.querySelector('.subcategory-nav .active')?.getAttribute('data-subcategory') || '1';
    
    // Use AJAX navigation to refresh current view
    if (window.navigateToCategory) {
      window.navigateToCategory(currentCategory, currentSubcategory);
    } else {
      console.warn('navigateToCategory not available, cannot soft refresh');
    }
  };
  
  // Function to submit file forms via AJAX
  window.submitFileFormAjax = function(form) {
    // Check if there are changes for edit form
    if (form.id === 'edit') {
      try {
        const nameInput = form.querySelector('input[name="name"]');
        const origName = form.dataset.origName || '';
        const origDesc = form.dataset.origDesc || '';
        const descInput = form.querySelector('textarea[name="description"]');
        const nowName = nameInput ? (nameInput.value || '').replace(/\u00a0/g, ' ').trim() : '';
        const nowDesc = descInput ? (descInput.value || '').trim() : '';
        if (nowName === origName && nowDesc === origDesc) {
          // No changes, just close modal without refreshing table
          const modal = form.closest('.overlay-container');
          if (modal) {
            const modalId = modal.id;
            try { popupClose(modalId); } catch(e) {}
          }
          return;
        }
      } catch (e) {}
    }
    
    submitFormAjax(form)
    .then(() => {
      // Close modal first
      const modal = form.closest('.overlay-container');
      if (modal) {
        const modalId = modal.id;
        try { popupClose(modalId); } catch(e) { console.error('Error closing modal:', e); }
      } else {
        console.warn('Modal not found for form:', form.id);
      }
      
      // Update table locally instead of full page refresh for some actions
      try {
        if (form.id === 'edit') {
          // File edit - update file name and description locally
          const fileId = form.action.match(/\/(\d+)$/)?.[1];
          if (fileId) {
            updateFileRowLocally(fileId, {
              name: form.querySelector('input[name="name"]')?.value?.trim(),
              description: form.querySelector('textarea[name="description"]')?.value?.trim()
            });
          } else {
            window.refreshFilesPage(); // Fallback
          }
        } else if (form.id === 'note') {
          // Update note locally to avoid refresh delay
          try {
            const fileId = form.dataset.rowId || (form.action.match(/\/(\d+)$/) || [])[1];
            const newNote = (form.querySelector('textarea[name="note"]').value || '').trim();
            if (fileId) {
              const row = document.getElementById(String(fileId));
              if (row) {
                // Update dataset
                row.setAttribute('data-note', newNote);
                // Update note text in the notes column (last column)
                const tds = row.querySelectorAll('td');
                const notesTd = tds[tds.length - 1];
                if (notesTd) {
                  const mt1s = notesTd.querySelectorAll('.mt-1');
                  const noteContainer = mt1s[mt1s.length - 1] || notesTd; // fallback
                  const span = noteContainer.querySelector('span') || noteContainer;
                  const display = newNote ? ('Примечание: ' + newNote) : '<оставить примечание>';
                  if (span) {
                    if (display === '<оставить примечание>') {
                      span.textContent = '<оставить примечание>';
                    } else {
                      span.textContent = display;
                    }
                  }
                }
              }
            }
          } catch (_) {}
        } else if (form.id === 'delete') {
          // File delete - remove row locally
          const fileId = form.action.match(/\/(\d+)$/)?.[1];
          if (fileId) {
            removeFileRowLocally(fileId);
          } else {
            window.refreshFilesPage(); // Fallback
          }
        } else if (form.id === 'move') {
          // After move, soft refresh current category/subcategory
          window.refreshFilesPage();
        } else {
          // Other forms - soft refresh
          window.refreshFilesPage();
        }
      } catch (e) {
        console.error('Error updating table locally:', e);
        window.refreshFilesPage(); // Fallback to soft refresh
      }
      
      // Emit socket event for other users
      try { 
        if (window.socket && window.socket.emit) {
          window.socket.emit('files:changed', { reason: 'form-submit', formId: form.id });
        }
      } catch(e) {}
    })
    .catch(() => {});
  };

  // Initialize context menu for files page
  function initFilesContextMenu() {
    const table = document.getElementById('maintable');
    if (!table) return;

    // Get table permissions
    const canAdd = table.getAttribute('data-can-add') === '1';
    const canMarkView = table.getAttribute('data-can-mark-view') === '1';
    const canNotes = table.getAttribute('data-can-notes') === '1';

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: 'files',
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: 'files',
            canAdd: canAdd,
            canMarkView: canMarkView,
            canNotes: canNotes
          });
        }
      }, 100);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilesContextMenu);
  } else {
    initFilesContextMenu();
  }
});

// Mark viewed via AJAX and update row locally without full reload
window.markViewedAjax = function(fileId) {
  try {
    if (!fileId) return;
    const row = document.querySelector(`tr[data-id="${fileId}"]`) || document.getElementById(String(fileId));
    const markUrl = row && row.getAttribute('data-view-url')
      ? row.getAttribute('data-view-url')
      : `${window.location.origin}${window.location.pathname}/view/${fileId}/${(document.querySelector('#maintable')?.getAttribute('data-category'))||'0'}/${(document.querySelector('#maintable')?.getAttribute('data-subcategory'))||'1'}`;
    fetch(markUrl, { method: 'GET', credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP '+r.status);
      })
      .then(() => {
        // Update row attributes and visuals
        if (row) {
          row.setAttribute('data-already-viewed', '1');
          row.setAttribute('data-viewed', '1');
          // Update viewers text by appending current user
          try {
            const currentUser = document.getElementById('maintable')?.getAttribute('data-current-user') || '';
            const viewersSpan = row.querySelector('.file-viewers span');
            if (viewersSpan) {
              const prev = (viewersSpan.textContent || '').trim();
              if (!prev || prev === '—') {
                viewersSpan.textContent = currentUser || prev;
              } else if (currentUser && prev.indexOf(currentUser) === -1) {
                viewersSpan.textContent = prev + ', ' + currentUser;
              }
            }
          } catch(_) {}
          // Recompute others-viewed flag: if there is any viewer other than current user
          try {
            const viewersSpan = row.querySelector('.file-viewers span');
            const currentUser = document.getElementById('maintable')?.getAttribute('data-current-user') || '';
            const txt = (viewersSpan && viewersSpan.textContent || '').trim();
            if (txt) {
              const names = txt.split(',').map(s => s.trim()).filter(Boolean);
              const others = names.filter(n => n && n !== currentUser);
              row.setAttribute('data-others-viewed', others.length > 0 ? '1' : '0');
            } else {
              row.setAttribute('data-others-viewed', '0');
            }
          } catch(_) {}
          // Remove the "Отметить просмотренным" link
          try {
            const tds = row.querySelectorAll('td');
            const notesTd = tds[tds.length - 1];
            const link = notesTd && notesTd.querySelector('span');
            if (link && link.textContent && link.textContent.indexOf('Отметить просмотренным') !== -1) {
              link.remove();
            }
          } catch(_) {}
        }
        // Notify others and optionally soft refresh
        try {
          if (window.socket && window.socket.emit) {
            window.socket.emit('files:changed', { reason: 'mark-viewed', id: fileId });
          }
        } catch(_) {}
        try { window.softRefreshFilesTable && window.softRefreshFilesTable(); } catch(_) {}
      })
      .catch((e) => {
        console.error('Mark viewed error:', e);
      });
  } catch (e) {
    console.error('Mark viewed error:', e);
  }
};