/**
 * Files Management Module
 * Управление файлами
 */

// Debouncing for sync events
let syncTimeout = null;
let pendingSync = false;

/**
 * Create new file
 * @param {Object} fileData - File data object
 */
function createFile(fileData) {
  const formData = new FormData();
  formData.append("display_name", fileData.display_name || "");
  formData.append("file_name", fileData.file_name || "");
  formData.append("description", fileData.description || "");
  formData.append("category_id", fileData.category_id || "");
  formData.append("subcategory_id", fileData.subcategory_id || "");
  formData.append("note", fileData.note || "");

  fetch("/files/add", {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__filesClientId || "unknown",
    },
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      if (window.showToast) {
        window.showToast("Файл создан", "success");
      }
      return data;
    })
    .catch((err) => window.ErrorHandler.handleError(err, "createFile"));
}

/**
 * Update existing file
 * @param {string} fileId - File ID
 * @param {Object} fileData - File data object
 */
function updateFile(fileId, fileData) {
  const formData = new FormData();
  formData.append("display_name", fileData.display_name || "");
  formData.append("description", fileData.description || "");
  formData.append("category_id", fileData.category_id || "");
  formData.append("subcategory_id", fileData.subcategory_id || "");
  formData.append("note", fileData.note || "");

  fetch(`/files/edit/${fileId}`, {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__filesClientId || "unknown",
    },
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      if (window.showToast) {
        window.showToast("Файл обновлен", "success");
      }
      return data;
    })
    .catch((err) => window.ErrorHandler.handleError(err, "updateFile"));
}

/**
 * Delete file
 * @param {string} fileId - File ID
 */
function deleteFile(fileId) {
  if (!fileId) {
    window.ErrorHandler.handleError(
      new Error("Некорректный ID файла"),
      "deleteFile"
    );
    return;
  }

  const fileRow = document.getElementById(fileId);
  
  fetch(`/files/delete/${fileId}`, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__filesClientId || "unknown",
    },
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      if (window.showToast) {
        window.showToast("Файл удален", "success");
      }
      // Remove file row from UI
      if (fileRow) {
        fileRow.remove();
      }
      // Trigger soft refresh to sync with other clients
      if (window.FilesManagement && window.FilesManagement.debouncedSync) {
        window.FilesManagement.debouncedSync();
      }
      return data;
    })
    .catch((err) => {
      window.ErrorHandler.handleError(err, "deleteFile");
    });
}

/**
 * Start files maintenance
 */
function startFilesMaintenance() {
  if (
    confirm(
      "Начать обслуживание таблицы файлов? Это может занять некоторое время."
    )
  ) {
    fetch("/admin/files_maintain", {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Client-Id": window.__filesClientId || "unknown",
      },
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        if (window.showToast) {
          window.showToast(
            `Обслуживание завершено. Обновлено: ${data.updated}, Создано: ${data.created}, Ошибок: ${data.errors}`,
            "success"
          );
        }
        return data;
      })
      .catch((err) =>
        window.ErrorHandler.handleError(err, "startFilesMaintenance")
      );
  }
}

/**
 * Debounced sync function to prevent multiple simultaneous refreshes
 */
function debouncedSync() {
  if (pendingSync) return;

  pendingSync = true;

  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(() => {
    pendingSync = false;
    softRefreshFilesTable(true);
  }, 100);
}

/**
 * Soft refresh files table with proper search and pagination support
 * @param {boolean} force - Force refresh even if table has data
 */
function softRefreshFilesTable(force = false) {
  const input = document.getElementById("searchinp");
  const q = input && typeof input.value === "string" ? input.value.trim() : "";

  if (q && typeof window.filesDoFilter === "function") {
    return window.filesDoFilter(q).then(() => {
      // Ensure layout after filtering updates DOM
      if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
        window.FilesManagement.enforceMediaInfoColumnLayout();
        setTimeout(() => {
          window.FilesManagement.enforceMediaInfoColumnLayout();
        }, 50);
      }
      reinitializeContextMenu();
      if (window.rebindFilesTable) window.rebindFilesTable();
    });
  }

  const table = document.getElementById("maintable");
  const tbody = table && table.tBodies && table.tBodies[0];
  const pager = document.getElementById("files-pagination");

  if (!force) {
    if (
      tbody &&
      pager &&
      tbody.querySelectorAll("tr.table__body_row").length > 0 &&
      pager.innerHTML
    ) {
      return;
    }
    if (tbody && tbody.querySelectorAll("tr.table__body_row").length > 0) {
      return;
    }
  }

  if (window.filesPager && typeof window.filesPager.renderPage === "function") {
    window.filesPager.renderPage(1);
    // Enforce layout immediately and after a short delay to catch async rendering
    if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
      window.FilesManagement.enforceMediaInfoColumnLayout();
      setTimeout(() => {
        window.FilesManagement.enforceMediaInfoColumnLayout();
      }, 50);
    }
    reinitializeContextMenu();
    if (window.rebindFilesTable) window.rebindFilesTable();
  } else {
    // Use AJAX to refresh the table
    refreshTableWithAjax().then(() => {
      reinitializeContextMenu();
      if (window.rebindFilesTable) window.rebindFilesTable();
    });
  }
}

/**
 * Refresh table with AJAX request
 */
function refreshTableWithAjax() {
  return new Promise((resolve, reject) => {
    try {
      const table = document.getElementById("maintable");
      if (!table) {
        resolve();
        return;
      }

      // Get current page parameters
      const url = new URL(window.location);
      const params = new URLSearchParams(url.search);

      // Add timestamp to prevent caching
      params.set("_t", Date.now());

      fetch(`${url.pathname}?${params.toString()}`, {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "text/html",
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.text();
        })
        .then((html) => {
          // Parse the response and update the table
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const newTable = doc.getElementById("maintable");

          if (newTable) {
            const tbody = table.tBodies[0];
            const newTbody = newTable.tBodies[0];

            if (tbody && newTbody) {
              tbody.innerHTML = newTbody.innerHTML;
              
              // Force apply media-info styles immediately after innerHTML update
              if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
                window.FilesManagement.enforceMediaInfoColumnLayout();
              }
              
              // Update pagination (preserve if incoming is empty)
              const newPagination = doc.getElementById("files-pagination");
              const curPagination = document.getElementById("files-pagination");
              if (newPagination && curPagination) {
                var incoming = (newPagination.innerHTML || "").trim();
                if (incoming.length > 0) {
                  curPagination.innerHTML = newPagination.innerHTML;
                }
                if (typeof window.FilesPage === 'object' && typeof window.FilesPage.setupFilesPaginationClickHandler === 'function') {
                  try { window.FilesPage.setupFilesPaginationClickHandler(); } catch(_) {}
                }
              }
              
              // Re-enforce styles after a short delay to catch any late updates
              setTimeout(() => {
                if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
                  window.FilesManagement.enforceMediaInfoColumnLayout();
                }
              }, 50);
              
              reinitializeContextMenu();
              if (window.rebindFilesTable) window.rebindFilesTable();
            }
          }
          resolve();
        })
        .catch((error) => {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to refresh files table:", error, "app");
          reject(error);
        });
    } catch (error) {
      window.ErrorHandler && window.ErrorHandler.handleError("Error in refreshTableWithAjax:", error, "app");
      reject(error);
    }
  });
}

/**
 * Force apply media-info column layout styles after table update
 */
function enforceMediaInfoColumnLayout() {
  try {
    const mediaInfoElements = document.querySelectorAll('.files-page__media-info');
    mediaInfoElements.forEach((el) => {
      if (el.style) {
        el.style.setProperty('display', 'flex', 'important');
        el.style.setProperty('flex-direction', 'column', 'important');
        el.style.setProperty('gap', '4px', 'important');
        el.style.setProperty('align-items', 'flex-start', 'important');
        el.style.setProperty('flex-wrap', 'nowrap', 'important');
      }
    });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'enforceMediaInfoColumnLayout');
  }
}

/**
 * Reinitialize context menu after table update
 */
function reinitializeContextMenu() {
  const now = Date.now();
  if (
    window._lastContextMenuReinit &&
    now - window._lastContextMenuReinit < 500
  ) {
    return;
  }
  window._lastContextMenuReinit = now;

  // Enforce media-info layout before other initialization
  enforceMediaInfoColumnLayout();

  if (window.requestIdleCallback) {
    window.requestIdleCallback(
      () => {
        // Re-enforce styles after a delay (in case DOM is still updating)
        enforceMediaInfoColumnLayout();
        const event = new CustomEvent("context-menu-reinit", {
          detail: { timestamp: Date.now() },
        });
        document.dispatchEvent(event);
        document.dispatchEvent(new Event("table-updated"));
      },
      { timeout: 1000 }
    );
  } else {
    setTimeout(() => {
      // Re-enforce styles after a delay
      enforceMediaInfoColumnLayout();
      const event = new CustomEvent("context-menu-reinit", {
        detail: { timestamp: Date.now() },
      });
      document.dispatchEvent(event);
      document.dispatchEvent(new Event("table-updated"));
    }, 10);
  }
}

/**
 * Start file upload with progress tracking
 * @param {HTMLFormElement} form - Form element containing file input
 */
async function startUploadWithProgress(form) {
  try {
    const fileInput = form.querySelector('input[type="file"]');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      if (window.showToast) {
        window.showToast("Выберите файл для загрузки", "warning");
      }
      return;
    }

    const files = Array.from(fileInput.files);
    const nameInput = document.getElementById("add-name");
    const descriptionInput = document.getElementById("add-description");
    const categorySelect = form.querySelector('select[name="category_id"]');
    const subcategorySelect = form.querySelector('select[name="subcategory_id"]');
    
    // Get category/subcategory IDs from multiple sources
    let did = null;
    let sdid = null;
    
    // 1. Try URL path parameters (e.g., /files/0/1)
    const pathMatch = window.location.pathname.match(/\/files\/(\d+)(?:\/(\d+))?/);
    if (pathMatch) {
      did = pathMatch[1];
      if (pathMatch[2]) {
        sdid = pathMatch[2];
      }
    }
    
    // 2. Try URL query parameters (e.g., ?did=0&sdid=1)
    if (!did || !sdid) {
      const urlParams = new URLSearchParams(window.location.search);
      if (!did) did = urlParams.get('did');
      if (!sdid) sdid = urlParams.get('sdid');
    }
    
    // 3. Try active category buttons on the page
    if (!did) {
      const activeCategoryBtn = document.querySelector('.subbar.cat .topbtn.active');
      if (activeCategoryBtn) {
        const href = activeCategoryBtn.getAttribute('href');
        if (href) {
          const hrefMatch = href.match(/did=(\d+)/);
          if (hrefMatch) {
            did = hrefMatch[1];
          }
        }
      }
    }
    
    if (!sdid) {
      const activeSubcategoryBtn = document.querySelector('.subbar.subcat .topbtn.active');
      if (activeSubcategoryBtn) {
        const href = activeSubcategoryBtn.getAttribute('href');
        if (href) {
          const hrefMatch = href.match(/sdid=(\d+)/);
          if (hrefMatch) {
            sdid = hrefMatch[1];
          }
        }
      }
    }
    
    // 4. Fallback to form selects if available
    if (!did && categorySelect && categorySelect.value) {
      did = categorySelect.value;
    }
    if (!sdid && subcategorySelect && subcategorySelect.value) {
      sdid = subcategorySelect.value;
    }
    
    // 5. Default values if still not found (from backend defaults: did=0, sdid=1)
    if (did === null || did === undefined || did === '') {
      did = '0';
    }
    if (sdid === null || sdid === undefined || sdid === '') {
      sdid = '1';
    }
    
    // Convert to integers (server expects type=int)
    did = parseInt(did, 10);
    sdid = parseInt(sdid, 10);
    
    // Validate: should be numbers (0 is a valid value for did)
    if (isNaN(did) || isNaN(sdid)) {
      throw new Error("Не удалось определить категорию или подкатегорию");
    }
    
    // Ensure we have valid values (0 is valid for category, but we need both to be defined)
    if (did === null || did === undefined || sdid === null || sdid === undefined) {
      throw new Error("Не удалось определить категорию или подкатегорию");
    }
    
    // (no console output)

    // Show progress bar
    const progressContainer = document.getElementById("upload-progress");
    const progressBar = progressContainer?.querySelector(".progress-bar");
    const progressStatus = progressContainer?.querySelector(".upload-status small");
    
    if (progressContainer) {
      progressContainer.classList.remove("d-none");
    }

    // Disable submit button during upload
    const submitBtn = form.querySelector('button[type="button"][id="add-submit-btn"]');
    const cancelBtn = form.querySelector('button[type="button"][id="add-cancel-btn"]');
    if (submitBtn) submitBtn.disabled = true;
    // keep cancel enabled to allow abort
    if (cancelBtn) cancelBtn.disabled = false;

    // Disable inputs (name, description, file chooser) during upload and remember their previous state
    const originalDisabledState = {
      name: !!(nameInput && nameInput.disabled),
      desc: !!(descriptionInput && descriptionInput.disabled),
      file: !!(fileInput && fileInput.disabled),
    };
    try { window.__uploadOriginalDisabled = originalDisabledState; } catch(_) {}
    if (nameInput) nameInput.disabled = true;
    if (descriptionInput) descriptionInput.disabled = true;
    if (fileInput) fileInput.disabled = true;

    // Guard: mark upload in progress
    try { window.__uploadInProgress = true; } catch(_) {}
    try { window.__uploadCancelled = false; } catch(_) {}

    let uploadedCount = 0;
    const totalFiles = files.length;

    // Upload files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        // Stop if user requested cancel
        if (window.__uploadCancelled === true) {
          break;
        }
        // Update status
        if (progressStatus) {
          progressStatus.textContent = `Загрузка файла ${i + 1}/${totalFiles}: ${file.name}...`;
        }
        if (progressBar) {
          const fileProgress = Math.round((uploadedCount / totalFiles) * 100);
          progressBar.style.width = `${fileProgress}%`;
          progressBar.setAttribute("aria-valuenow", fileProgress);
        }

        // Determine file name: use form input for single file, or real file name for multiple
        let fileName = "";
        if (files.length === 1 && nameInput && nameInput.value.trim()) {
          fileName = nameInput.value.trim();
        } else {
          // For multiple files or when name is empty, use file name without extension
          const fileNameFull = file.name;
          fileName = fileNameFull.replace(/\.[^/.]+$/, "");
        }
        
        if (!fileName) {
          throw new Error("Не указано имя файла");
        }

        // Create FormData for init phase (file is NOT needed in init, only in upload phase)
        const formData = new FormData();
        formData.append("name", fileName);
        
        if (descriptionInput && descriptionInput.value.trim()) {
          formData.append("description", descriptionInput.value.trim());
        }

    // Prefer explicit cat_id/sub_id from URL (embed in orders) over did/sdid resolution
    let catId, subId;
    try {
      const urlParamsAll = new URLSearchParams(window.location.search);
      const qCatId = urlParamsAll.get('cat_id');
      const qSubId = urlParamsAll.get('sub_id');
      if (qCatId && qSubId) {
        catId = parseInt(String(qCatId), 10);
        subId = parseInt(String(qSubId), 10);
      }
    } catch(_) {}
    if (!(catId && subId)) {
      // Resolve did/sdid indices to real category_id/subcategory_id via API
      try {
        const resolveUrl = `/api/files/resolve-ids?did=${did}&sdid=${sdid}`;
        const resolveResponse = await fetch(resolveUrl, {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Client-Id": window.__filesClientId || "unknown",
          },
        });
        if (!resolveResponse.ok) {
          throw new Error(`Ошибка получения ID категории: HTTP ${resolveResponse.status}`);
        }
        const resolveData = await resolveResponse.json();
        if (resolveData.status !== 'success' || !resolveData.category_id || !resolveData.subcategory_id) {
          throw new Error(resolveData.message || "Не удалось получить ID категории");
        }
        catId = resolveData.category_id;
        subId = resolveData.subcategory_id;
      } catch (err) {
        window.ErrorHandler.handleError(err, "startUploadWithProgress:resolveIds");
        throw new Error(`Не удалось определить категорию: ${err.message}`);
      }
    }
    // (no console output)

        // Build URL with query parameters (cat_id and sub_id must be in URL, not FormData)
        const urlParams = new URLSearchParams();
        urlParams.append("cat_id", String(catId));
        urlParams.append("sub_id", String(subId));
        
        const initUrl = "/files/add/init?" + urlParams.toString();
        
        // (no console output)

        // Phase 1: Initialize upload
        const initResponse = await fetch(initUrl, {
          method: "POST",
          body: formData,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Client-Id": window.__filesClientId || "unknown",
          },
        });

        const initData = await initResponse.json();
        
        if (!initResponse.ok) {
          throw new Error(initData.error || initData.message || `Ошибка инициализации загрузки: HTTP ${initResponse.status}`);
        }

        // Server returns 'id', not 'file_id'
        const fileId = initData.id || initData.file_id;
        if (!fileId) {
          throw new Error("Не получен ID файла от сервера");
        }
        try { window.__lastInitFileId = fileId; } catch(_) {}

        // Phase 2: Upload binary with progress
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          try { window.__currentUploadXhr = xhr; } catch(_) {}
          
          // Track upload progress
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable && progressBar) {
              const fileProgress = Math.round(((uploadedCount + (e.loaded / e.total)) / totalFiles) * 100);
              progressBar.style.width = `${fileProgress}%`;
              progressBar.setAttribute("aria-valuenow", fileProgress);
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 400) {
              try {
                // Server might return JSON or empty response
                const responseText = xhr.responseText.trim();
                if (responseText) {
                  const data = JSON.parse(responseText);
                  // Accept responses with or without status field
                  if (data.error) {
                    reject(new Error(data.error || data.message || "Ошибка загрузки файла"));
                  } else {
                    resolve(data);
                  }
                } else {
                  // Empty response is also OK for successful upload
                  resolve({});
                }
              } catch (e) {
                // If response is not JSON, but status is 200, it's probably OK
                if (xhr.status === 200) {
                  resolve({});
                } else {
                  reject(new Error("Ошибка парсинга ответа сервера: " + e.message));
                }
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                reject(new Error(errorData.error || errorData.message || `Ошибка загрузки: HTTP ${xhr.status}`));
              } catch (e) {
                reject(new Error(`Ошибка загрузки: HTTP ${xhr.status}`));
              }
            }
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Ошибка сети при загрузке файла"));
          });

          xhr.addEventListener("abort", () => {
            reject(new Error("Загрузка отменена"));
          });

          // Create FormData for binary upload
          const uploadFormData = new FormData();
          uploadFormData.append("file", file);

          xhr.open("POST", `/files/upload/${fileId}`);
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
          xhr.setRequestHeader("X-Client-Id", window.__filesClientId || "unknown");
          xhr.send(uploadFormData);
        });

        uploadedCount++;
        
      } catch (err) {
        window.ErrorHandler.handleError(err, "startUploadWithProgress");
        if (window.showToast) {
          window.showToast(`Ошибка загрузки файла "${file.name}": ${err.message}`, "error");
        }
        // Continue with next file
      }
    }

    // Update final progress
    if (progressBar) {
      progressBar.style.width = "100%";
      progressBar.setAttribute("aria-valuenow", 100);
    }
    if (progressStatus) {
      progressStatus.textContent = uploadedCount === totalFiles 
        ? `Загружено файлов: ${uploadedCount}/${totalFiles}` 
        : `Загружено: ${uploadedCount}/${totalFiles} (ошибок: ${totalFiles - uploadedCount})`;
    }

    // Re-enable buttons
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;

    // Show success message
    if (uploadedCount === totalFiles) {
      if (window.showToast) {
        window.showToast(
          totalFiles === 1 ? "Файл загружен успешно" : `Загружено файлов: ${uploadedCount}`,
          "success"
        );
      }
      
      // Close modal and clear form
      setTimeout(() => {
        try { window.__uploadInProgress = false; } catch(_) {}
        try { window.__currentUploadXhr = null; } catch(_) {}
        // Restore inputs disabled state before closing
        try {
          const st = window.__uploadOriginalDisabled || {};
          if (nameInput) nameInput.disabled = !!st.name;
          if (descriptionInput) descriptionInput.disabled = !!st.desc;
          if (fileInput) fileInput.disabled = !!st.file;
        } catch(_) {}
        if (window.closeModal) {
          window.closeModal("popup-add");
        }
        form.reset();
        fileInput.value = "";
        if (nameInput) nameInput.value = "";
        if (descriptionInput) descriptionInput.value = "";
        
        // Hide progress
        if (progressContainer) {
          progressContainer.classList.add("d-none");
        }
        
        // Trigger refresh
        if (window.FilesManagement && window.FilesManagement.debouncedSync) {
          window.FilesManagement.debouncedSync();
        }
      }, 1000);
    } else {
      // Some files failed
      if (window.showToast && uploadedCount > 0) {
        window.showToast(
          `Загружено ${uploadedCount} из ${totalFiles} файлов`,
          uploadedCount > totalFiles / 2 ? "warning" : "error"
        );
      }
    }

  } catch (err) {
    window.ErrorHandler.handleError(err, "startUploadWithProgress");
    if (window.showToast) {
      window.showToast("Ошибка загрузки файлов", "error");
    }
    
    // Re-enable buttons
    const submitBtn = form.querySelector('button[type="button"][id="add-submit-btn"]');
    const cancelBtn = form.querySelector('button[type="button"][id="add-cancel-btn"]');
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    
    // Hide progress
    const progressContainer = document.getElementById("upload-progress");
    if (progressContainer) {
      progressContainer.classList.add("d-none");
    }
  } finally {
    try { window.__uploadInProgress = false; } catch(_) {}
    try { window.__currentUploadXhr = null; } catch(_) {}
    // Restore inputs disabled state (in any termination path)
    try {
      const st = window.__uploadOriginalDisabled || {};
      if (nameInput) nameInput.disabled = !!st.name;
      if (descriptionInput) descriptionInput.disabled = !!st.desc;
      if (fileInput) fileInput.disabled = !!st.file;
    } catch(_) {}
  }
}

// Allow cancel from UI: cancels current XHR and closes modal
function cancelCurrentUploadAndCloseModal() {
  try {
    try { window.__uploadCancelled = true; } catch(_) {}
    if (window.__currentUploadXhr && typeof window.__currentUploadXhr.abort === 'function') {
      try { window.__currentUploadXhr.abort(); } catch(_) {}
    }
    // Restore UI immediately
    try {
      const form = document.getElementById('add');
      if (form) {
        const nameInput = document.getElementById('add-name');
        const descriptionInput = document.getElementById('add-description');
        const fileInput = form.querySelector('input[type="file"]');
        const submitBtn = form.querySelector('button[type="button"][id="add-submit-btn"]');
        const cancelBtn = form.querySelector('button[type="button"][id="add-cancel-btn"]');
        const progressContainer = document.getElementById('upload-progress');

        // Restore disabled states from snapshot
        const st = (window.__uploadOriginalDisabled || {});
        if (nameInput) nameInput.disabled = !!st.name === true ? true : false;
        if (descriptionInput) descriptionInput.disabled = !!st.desc === true ? true : false;
        if (fileInput) fileInput.disabled = !!st.file === true ? true : false;

        // Re-enable buttons
        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;

        // Hide progress UI
        if (progressContainer) {
          progressContainer.classList.add('d-none');
          const pb = progressContainer.querySelector('.progress-bar');
          if (pb) { pb.style.width = '0%'; pb.setAttribute('aria-valuenow', 0); }
          const ps = progressContainer.querySelector('.upload-status small');
          if (ps) { ps.textContent = 'Загрузка файла...'; }
        }
      }
    } catch(_) {}
    // Try to delete last created file record if exists
    try {
      const fid = window.__lastInitFileId;
      if (fid) {
        fetch(`/files/delete/${fid}`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'X-Client-Id': window.__filesClientId || 'unknown'
          }
        }).catch(() => {});
      }
    } catch(_) {}
    setTimeout(() => {
      try { window.__uploadInProgress = false; } catch(_) {}
      try { window.__currentUploadXhr = null; } catch(_) {}
      if (typeof window.closeModal === 'function') {
        window.closeModal('popup-add');
      }
    }, 50);
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'cancelCurrentUploadAndCloseModal');
  }
}

// Export functions to global scope
window.FilesManagement = {
  createFile,
  updateFile,
  deleteFile,
  startFilesMaintenance,
  softRefreshFilesTable,
  refreshTableWithAjax,
  debouncedSync,
  reinitializeContextMenu,
  startUploadWithProgress,
  cancelCurrentUploadAndCloseModal,
  enforceMediaInfoColumnLayout,
};

// Export key functions globally
window.softRefreshFilesTable = softRefreshFilesTable;
window.deleteFile = deleteFile;
