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

  if (window.requestIdleCallback) {
    window.requestIdleCallback(
      () => {
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
      const event = new CustomEvent("context-menu-reinit", {
        detail: { timestamp: Date.now() },
      });
      document.dispatchEvent(event);
      document.dispatchEvent(new Event("table-updated"));
    }, 10);
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
};

// Export key functions globally
window.softRefreshFilesTable = softRefreshFilesTable;
window.deleteFile = deleteFile;
