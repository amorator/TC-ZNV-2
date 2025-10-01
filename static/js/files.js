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
      if (event.target.files.length > 0) {
        const fileName = event.target.files[0].name;
        
        // Only auto-fill if the name field is empty or user hasn't typed anything
        if (!nameInput.value || nameInput.value.trim() === '' || !nameInput.userHasTyped) {
          // Remove extension from filename
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
          nameInput.value = nameWithoutExt;
          nameInput.userHasTyped = false; // Reset flag after auto-fill
        }
      }
    });
    return;
  }
  let values = document.getElementById(id).getElementsByTagName("td");
  if (form.id == "edit") {
    form.getElementsByTagName("input")[0].value = values[0].innerText;
    form.getElementsByTagName("textarea")[0].value = values[1].innerText;
    let select = form.getElementsByTagName("select")[0];
  } else if (form.id == "delete") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[0].innerText;
  } else if (form.id == "note") {
    // Read note directly from row attribute to avoid mixing with viewers text
    const row = document.getElementById(id);
    const note = (row && row.getAttribute('data-note')) ? row.getAttribute('data-note') : '';
    form.getElementsByTagName("textarea")[0].value = note;
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
function validateForm(x) {
  
  // Find the form element
  const form = x.closest('form');
  if (!form) {
    console.error('Form not found');
    return false;
  }
  
  
  if (form.id == "add" || form.id == "edit") {
    // Find the name input field specifically
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) {
      let name = nameInput.value.trim();
      if (name == undefined || name == "" || name.length < 1) {
      alert("Задайте корректное имя файла!");
        return false;
      }
    } else {
      console.error('Name input not found');
      return false;
    }
  }
  if (form.id == "add") {
    let fileInput = document.getElementById("file");
    let len = fileInput.files.length;
    if (len == undefined || len == 0) {
      alert("Выберите файл(ы)!");
      return false;
    }
    if (len > 5) {
      alert("Можно выбрать максимум 5 файлов");
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
        alert(`Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`);
        return false;
      }
      if (f.size === 0) {
        alert(`Файл ${f.name} пустой!`);
        return false;
      }
      let isValidType = allowedTypes.includes(f.type);
      if (!isValidType) {
        const fileName = f.name.toLowerCase();
        isValidType = allowedExtensions.some(ext => fileName.endsWith(ext));
      }
      if (!isValidType) {
        alert(`Неподдерживаемый формат: ${f.name}. Разрешены: ${allowedExtensions.join(', ')}`);
        return false;
      }
    }
    // Prevent native submit; start upload (single or multi handled inside)
    startUploadWithProgress(form);
    return false;
  }
  
  // For non-add forms, submit normally
  if (form.id !== "add") {
    form.submit();
    return true;
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
  
  // Read selected files
  const fileInput = form.querySelector('input[type="file"]');
  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  const multi = files.length > 1;

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
        statusText.textContent = 'Загрузка завершена! Перенаправление...';
        setTimeout(() => { popupToggle('popup-add'); window.location.reload(); }, 1000);
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
      statusText.textContent = 'Все файлы загружены! Обновление...';
      setTimeout(() => { popupToggle('popup-add'); window.location.reload(); }, 1000);
      return;
    }
    renderCombinedProgress(0, files[index].size, index);
    uploadOne(files[index], index, function(){ index++; next(); }, function(msg){ handleUploadError(msg); });
  }
  next();

  // When upload finished sending to server (server may still be processing)
  xhr.upload.addEventListener('load', function() {
    try {
      statusText.textContent = 'Файл загружен, выполняется обработка...';
    } catch (e) {}
    // Do NOT navigate here; wait for server response (xhr.load)
  });
  // Treat 2xx/3xx as success (redirects included)
  const handleSuccess = function() {
      progressBar.style.width = '100%';
      progressBar.setAttribute('aria-valuenow', 100);
      statusText.textContent = 'Загрузка завершена! Перенаправление...';
      
      // Close popup after a short delay
      setTimeout(() => {
        popupToggle('popup-add');
        // Reload page to show new file
        window.location.reload();
      }, 1000);
  };

  xhr.addEventListener('load', function() {
    if (xhr.status >= 200 && xhr.status < 400) {
      handleSuccess();
    } else {
      handleUploadError('Ошибка загрузки файла');
    }
  });

  xhr.addEventListener('loadend', function() {
    // As a safety net: if readyState DONE and success-like code was missed but status OK, proceed
    try {
      if (xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 400) {
        handleSuccess();
      }
    } catch (e) {}
  });

  // Also guard by timeout
  // Disable artificial timeout-based success; allow long server processing
  xhr.timeout = 0; // no timeout
  xhr.ontimeout = function() {};
  
  // Handle upload errors
  xhr.addEventListener('error', function() {
    handleUploadError('Ошибка соединения');
  });
  
  xhr.addEventListener('abort', function() {
    handleUploadError('Загрузка отменена');
  });
  
  // Note: per-file upload logic implemented above
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
        softRefreshFilesTable();
      });
      
      /**
       * Handle files changed event on default namespace - refresh table to show updates
       * @param {Object} evt - Event data
       */
      socket.on('/files:changed', function(evt) {
        softRefreshFilesTable();
      });
    }
  } catch (e) {
    // Socket.IO initialization failed, table will work without live updates
  }

  // Helper: soft refresh table body without losing search/pagination
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

    // Fetch same URL and parse tbody
    fetch(window.location.href, { credentials: 'include' })
      .then(r => r.text())
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newTbody = doc.querySelector('#maintable tbody');
        if (!newTbody) return;
        tbody.innerHTML = newTbody.innerHTML;

        // Rebind dblclick handlers for opening player
        try { bindRowOpenHandlers(); } catch(e) {}
        // Rebind copy handlers for names
        try { bindCopyNameHandlers(); } catch(e) {}

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
      })
      .catch(() => {});
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
          if (!url) return;
          const player = document.getElementById('player-video');
          if (player) {
            try { player.pause(); } catch(e) {}
            player.src = url;
            try { player.currentTime = 0; } catch(e) {}
          }
          popupToggle('popup-view');
        });
      });
    } catch (e) {}
  }
  bindRowOpenHandlers();

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

  // Custom context menu for table rows
  (function initContextMenu() {
    const table = document.getElementById('maintable');
    const menu = document.getElementById('context-menu');
    if (!table || !menu) return;

    // Disable native context menu and show custom across the whole files page
    document.addEventListener('contextmenu', function(e) {
      // Only override on files page (when table exists)
      if (!document.getElementById('maintable')) return;
      e.preventDefault();
      const row = e.target.closest && e.target.closest('tr.table__body_row');
      if (row) {
        buildAndShowMenu(row, e.pageX, e.pageY);
      } else {
        buildAndShowMenu(null, e.pageX, e.pageY);
      }
    });

    // Hide on click elsewhere or Esc
    document.addEventListener('click', function(e) {
      if (menu.classList.contains('d-none')) return;
      if (!e.target.closest('#context-menu')) {
        menu.classList.add('d-none');
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !menu.classList.contains('d-none')) {
        menu.classList.add('d-none');
      }
    });

    function buildAndShowMenu(row, x, y) {
      const tableCanAdd = table.getAttribute('data-can-add') === '1';
      const canMarkView = table.getAttribute('data-can-mark-view') === '1';

      if (row) {
        const canEdit = row.getAttribute('data-can-edit') === '1';
        const canDelete = row.getAttribute('data-can-delete') === '1';
        const canNote = row.getAttribute('data-can-note') === '1';
        const isReady = row.getAttribute('data-is-ready') !== '0';
        const hasDownload = !!row.getAttribute('data-download');

        // Toggle visibility of items based on permissions
        toggleItem('open', isReady);
        toggleItem('download', hasDownload || isReady);
        toggleItem('edit', canEdit);
        toggleItem('move', canEdit);
        toggleItem('delete', canDelete);
        // If already viewed by current user, hide mark-viewed
        const alreadyViewed = row.getAttribute('data-already-viewed') === '1';
        toggleItem('mark-viewed', isReady && canMarkView && !alreadyViewed);
        toggleItem('note', isReady && canNote);
        toggleItem('add', tableCanAdd);
        toggleItem('record', tableCanAdd);
        toggleSeparator(true);

        // Bind actions for row
        bindActions(row);
      } else {
        // Outside data rows: only add/record depending on permissions
        toggleItem('open', false);
        toggleItem('download', false);
        toggleItem('edit', false);
        toggleItem('move', false);
        toggleItem('delete', false);
        toggleItem('mark-viewed', false);
        toggleItem('note', false);
        toggleItem('add', tableCanAdd);
        toggleItem('record', tableCanAdd);
        toggleSeparator(false);

        // Bind actions without row context
        bindActions(null);
      }

      // Position menu
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.remove('d-none');
    }

    function toggleItem(action, show) {
      const el = menu.querySelector(`.context-menu__item[data-action="${action}"]`);
      if (el) el.style.display = show ? 'block' : 'none';
    }

    function bindActions(row) {
      const openEl = menu.querySelector('[data-action="open"]');
      const downloadEl = menu.querySelector('[data-action="download"]');
      const editEl = menu.querySelector('[data-action="edit"]');
      const deleteEl = menu.querySelector('[data-action="delete"]');
      const moveEl = menu.querySelector('[data-action="move"]');
      const markViewedEl = menu.querySelector('[data-action="mark-viewed"]');
      const noteEl = menu.querySelector('[data-action="note"]');
      const addEl = menu.querySelector('[data-action="add"]');
      const recordEl = menu.querySelector('[data-action="record"]');

      if (row) {
        const id = row.getAttribute('data-id');
        const url = row.getAttribute('data-url');
        const download = row.getAttribute('data-download');

        if (openEl) openEl.onclick = function() {
          const player = document.getElementById('player-video');
          if (player && url) {
            try { player.pause(); } catch(e) {}
            player.src = url;
            try { player.currentTime = 0; } catch(e) {}
            popupToggle('popup-view');
          }
          menu.classList.add('d-none');
        };

        if (downloadEl) downloadEl.onclick = function() {
          if (download) {
            const a = document.createElement('a');
            a.href = download;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          menu.classList.add('d-none');
        };

        if (editEl) editEl.onclick = function() {
          popupToggle('popup-edit', parseInt(id, 10));
          menu.classList.add('d-none');
        };

        if (deleteEl) deleteEl.onclick = function() {
          popupToggle('popup-delete', parseInt(id, 10));
          menu.classList.add('d-none');
        };

        if (moveEl) moveEl.onclick = function() {
        // Preselect current root/sub in move modal
        const rootSel = document.getElementById('move-target-root');
        const subSel = document.getElementById('move-target-sub');
        if (rootSel && subSel) {
          const currentRoot = row.getAttribute('data-root');
          const currentSub = row.getAttribute('data-sub');
          try { rootSel.value = currentRoot; } catch(e) {}
          try { subSel.value = currentSub; } catch(e) {}
        }
        popupToggle('popup-move', parseInt(id, 10));
          menu.classList.add('d-none');
        };

        if (markViewedEl) markViewedEl.onclick = function() {
          const viewUrl = row.getAttribute('data-view-url');
          if (viewUrl) {
            window.location.href = viewUrl;
          }
          menu.classList.add('d-none');
        };

        if (noteEl) noteEl.onclick = function() {
          popupToggle('popup-note', parseInt(id, 10));
          menu.classList.add('d-none');
        };
      } else {
        // Clear row-specific handlers
        if (openEl) openEl.onclick = null;
        if (downloadEl) downloadEl.onclick = null;
        if (editEl) editEl.onclick = null;
        if (deleteEl) deleteEl.onclick = null;
        if (markViewedEl) markViewedEl.onclick = null;
        if (noteEl) noteEl.onclick = null;
      }

      if (addEl) addEl.onclick = function() {
        popupToggle('popup-add');
        menu.classList.add('d-none');
      };
      if (recordEl) recordEl.onclick = function() {
        popupToggle('popup-rec');
        menu.classList.add('d-none');
      };
    }

    function toggleSeparator(show) {
      const sep = menu.querySelector('.context-menu__separator');
      if (sep) sep.style.display = show ? 'block' : 'none';
    }
  })();
});