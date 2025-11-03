// Files Page - Modular Version
// Основной файл страницы файлов, использующий модули

// Initialize context menu for files page
function initFilesContextMenu() {
  try {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canManage = table.getAttribute("data-can-manage") === "1";
    const canAdd = table.getAttribute("data-can-add") === "1";
    const canMarkView = table.getAttribute("data-can-mark-view") === "1";
    const canNotes = table.getAttribute("data-can-notes") === "1";
    // Orders embed: disable move action
    const qs = new URLSearchParams(location.search || "");
    const disableMove = qs.get('no_move') === '1' || qs.get('embed') === '1';

    // Initialize unified context menu
    if (window.contextMenu && window.contextMenu.init) {
      window.contextMenu.init({
        page: "files",
        canManage: canManage,
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes,
        disableMove: disableMove,
      });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "initFilesContextMenu");
  }
}

// Setup double-click handlers for table rows
function setupDoubleClickHandlers() {
  try {
    const tableRows = document.querySelectorAll(
      "#maintable tbody tr.table__body_row"
    );

    tableRows.forEach((row) => {
      // Remove existing double-click listeners to avoid duplicates
      row.removeEventListener("dblclick", handleDoubleClick);
      // Add new double-click listener
      row.addEventListener("dblclick", handleDoubleClick);
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupDoubleClickHandlers");
  }
}

// Handle double-click on file row
function handleDoubleClick(event) {
  try {
    const url = this.getAttribute("data-url");

    if (url) {
      // Check if it's a media file that should open in modal
      const isMediaFile = isMediaFileUrl(url) || isMediaFileRow(this);

      if (isMediaFile) {
        openMediaFile(url);
      } else {
        // For non-media files, open in new tab
        window.open(url, "_blank");
      }
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "handleDoubleClick");
  }
}

// Check if URL is a media file
function isMediaFileUrl(url) {
  if (!url) return false;

  // First try to check by URL extension (for direct file URLs)
  const mediaExtensions = [
    ".m4a",
    ".mp3",
    ".wav",
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm",
  ];
  const lowerUrl = url.toLowerCase();

  const urlResult = mediaExtensions.some((ext) => lowerUrl.includes(ext));
  if (urlResult) {
    return urlResult;
  }

  // If URL doesn't contain extension, check by media_type in the row
  // This is a fallback for URLs like /files/file/24
  return false; // We'll implement this in the calling function
}

// Check if a table row contains a media file
function isMediaFileRow(row) {
  if (!row) return false;

  try {
    // Look for media_type in the row's second cell (index 1)
    const cells = row.querySelectorAll("td.table__body_item");
    if (cells.length > 1) {
      const mediaTypeCell = cells[1]; // Second cell contains media_type
      const mediaTypeText = mediaTypeCell.textContent.trim();

      // Check if it's a media type
      const mediaTypes = ["audio", "video", "Audio", "Video", "Аудио", "Видео"];
      const isMedia = mediaTypes.some((type) => mediaTypeText.includes(type));

      return isMedia;
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "isMediaFileRow");
  }

  return false;
}

// Open media file in modal player
function openMediaFile(url) {
  try {
    // Stop any existing media
    if (window.stopAllMedia) {
      window.stopAllMedia();
    }

    // Initialize media state
    if (!window.__mediaOpenState) {
      window.__mediaOpenState = { opening: false };
    }

    // Prevent multiple simultaneous opens
    if (window.__mediaOpenState.opening) return;
    window.__mediaOpenState.opening = true;

    const isAudio = url.toLowerCase().endsWith(".m4a");

    if (isAudio) {
      openAudioFile(url);
    } else {
      openVideoFile(url);
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "openMediaFile");
  }
}

// Open audio file in modal
function openAudioFile(url) {
  try {
    const audio = document.getElementById("player-audio");
    if (!audio) return;

    // Stop video player
    const video = document.getElementById("player-video");
    if (video) {
      try {
        video.pause && video.pause();
        video.onerror = null;
        video.removeAttribute("src");
      } catch (err) {
        window.ErrorHandler.handleError(err, "openAudioFile");
      }
    }

    // Configure audio player
    audio.muted = false;
    audio.volume = 1;
    audio.src = url;
    audio.currentTime = 0;

    // Set up event handlers
    audio.onerror = function onAudioErr() {
      try {
        audio.onerror = null;
        if (window.popupClose) {
          window.popupClose("popup-audio");
        }
        window.__mediaOpenState.opening = false;
      } catch (err) {
        window.ErrorHandler.handleError(err, "openAudioFile");
      }
    };

    audio.onloadeddata = function () {
      try {
        window.__mediaOpenState.opening = false;
      } catch (err) {
        window.ErrorHandler.handleError(err, "openAudioFile");
      }
    };

    // Open audio modal
    if (window.popupToggle) {
      window.popupToggle("popup-audio");
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "openAudioFile");
  }
}

// Open video file in modal
function openVideoFile(url) {
  try {
    const player = document.getElementById("player-video");
    if (!player) return;

    // Stop audio player
    const audio = document.getElementById("player-audio");
    if (audio) {
      try {
        audio.pause && audio.pause();
        audio.onerror = null;
        audio.removeAttribute("src");
      } catch (err) {
        window.ErrorHandler.handleError(err, "openVideoFile");
      }
    }

    // Configure video player
    player.muted = false;
    player.volume = 1;
    player.src = url;
    player.currentTime = 0;

    // Set up event handlers
    player.onerror = function onVideoErr() {
      try {
        player.onerror = null;
        if (window.popupClose) {
          window.popupClose("popup-view");
        }
        window.__mediaOpenState.opening = false;
      } catch (err) {
        window.ErrorHandler.handleError(err, "openVideoFile");
      }
    };

    player.onloadeddata = function () {
      try {
        window.__mediaOpenState.opening = false;
      } catch (err) {
        window.ErrorHandler.handleError(err, "openVideoFile");
      }
    };

    // Open video modal
    if (window.popupToggle) {
      window.popupToggle("popup-view");
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "openVideoFile");
  }
}

// Инициализация страницы
function initFilesPage() {
  try {
    // Initialize context menu for files page
    initFilesContextMenu();

    // Setup file upload forms
    setupFileUploadForms();

    // Setup file management
    setupFileManagement();

    // Setup form validation
    setupFormValidation();

    // Setup background progress
    setupBackgroundProgress();

    // Setup server-side search
    if (window.FilesSearch && typeof window.FilesSearch.setupFilesSearch === 'function') {
      window.FilesSearch.setupFilesSearch();
    }

    // Setup pagination click handler
    setupFilesPaginationClickHandler();

    // Initialize files pagination data on first load (when not searching)
    initFilesPagination();

    // Restore toasts from storage
    if (
      window.FilesUploadProgress &&
      window.FilesUploadProgress.restoreToastsFromStorage
    ) {
      window.FilesUploadProgress.restoreToastsFromStorage();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "initFilesPage");
  }
}

// Initialize files pagination from server (/files/page)
function initFilesPagination() {
  try {
    const input = document.getElementById('searchinp');
    const q = input && typeof input.value === 'string' ? input.value.trim() : '';
    if (q) return; // search module manages its own pagination

    const pager = document.getElementById('files-pagination');
    const table = document.getElementById('maintable');
    if (!pager || !table) return;

    // Ensure pager auto-recovers if cleared by other scripts
    try {
      if (!pager.__recoveryObserverAttached) {
        const recoveryObserver = new MutationObserver(function () {
          try {
            const htmlLen = (pager.innerHTML || '').trim().length;
            if (htmlLen === 0 && window.__filesPagerState) {
              const st = window.__filesPagerState;
              renderFilesPaginationControls(pager, st.total, st.page, st.pageSize);
              setupFilesPaginationClickHandler();
            }
          } catch (_) {}
        });
        recoveryObserver.observe(pager, { childList: true, subtree: true });
        pager.__recoveryObserverAttached = true;
      }
    } catch (_) {}

    const url = new URL(window.location);
    const catId = (window.current_category_id != null) ? window.current_category_id : (url.searchParams.get('cat_id'));
    const subId = (window.current_subcategory_id != null) ? window.current_subcategory_id : (url.searchParams.get('sub_id'));
    if (!catId || !subId) return;

    // Restore last page from localStorage if available
    let page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
    try {
      const key = `files:lastPage:${catId}:${subId}`;
      const saved = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      if (saved > 0) page = saved;
    } catch(_) {}
    fetchFilesPage(page, { catId, subId });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'initFilesPagination');
  }
}

// Fetch a page of files and render table + pagination
function fetchFilesPage(page, ids) {
  try {
    const table = document.getElementById('maintable');
    const pager = document.getElementById('files-pagination');
    if (!table || !pager) return;

    // Use backend JSON pagination endpoint
    const url = new URL('/files/page', window.location.origin);
    const pageSize = 10;
    const catId = (ids && ids.catId) || document.body.getAttribute('data-current-category-id') || window.current_category_id;
    const subId = (ids && ids.subId) || document.body.getAttribute('data-current-subcategory-id') || window.current_subcategory_id;
    if (!catId || !subId) return;

    url.searchParams.set('cat_id', String(catId));
    url.searchParams.set('sub_id', String(subId));
    url.searchParams.set('page', String(page || 1));
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('_t', Date.now());

    fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response.json();
      })
      .then((data) => {
        const tbody = table.tBodies && table.tBodies[0];
        if (tbody && typeof data.html === 'string') {
          const searchRow = tbody.querySelector('#search');
          const searchHTML = searchRow ? searchRow.outerHTML : '';
          tbody.innerHTML = searchHTML + data.html;
        }
        const total = data.total || 0;
        const pageNum = data.page || 1;
        const ps = data.page_size || pageSize;
        // Persist current page for this cat/sub
        try {
          const key = `files:lastPage:${catId}:${subId}`;
          localStorage.setItem(key, String(pageNum));
        } catch(_) {}
        renderFilesPaginationControls(pager, total, pageNum, ps);
        // Save last known pager state for recovery
        window.__filesPagerState = { total: total, page: pageNum, pageSize: ps };

        // Update URL page param (keep current path and other params)
        const cur = new URL(window.location);
        cur.searchParams.set('page', String(data.page || 1));
        window.history.pushState({}, '', cur.pathname + cur.search);

        // Rebind handlers
        setupFilesPaginationClickHandler();
        reinitializeContextMenu();
        if (window.rebindFilesTable) window.rebindFilesTable();
      })
      .catch((err) => {
        window.ErrorHandler && window.ErrorHandler.handleError(err, 'fetchFilesPage');
      });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'fetchFilesPage');
  }
}

// Render pagination controls for files (non-search)
function renderFilesPaginationControls(pagerEl, total, currentPage, pageSize) {
  try {
    if (!pagerEl) return;
    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 10)));
  const cp = Math.min(Math.max(1, currentPage || 1), totalPages);

  const btn = (text, pageNum, disabled, active = false) =>
    `<li class="page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}">` +
    `<a class="page-link" href="#" data-page="${pageNum}">${text}</a>` +
    `</li>`;

  const items = [];
  items.push(btn('«', 1, cp === 1));
  items.push(btn('‹', Math.max(1, cp - 1), cp === 1));

  // Always show page 1
  items.push(btn('1', 1, false, cp === 1));

  // Calculate window around current page (excluding first and last)
  const windowSize = 3; // show up to 3 pages around current
  let start = Math.max(2, cp - 1);
  let end = Math.min(totalPages - 1, cp + 1);

  // Ensure at least windowSize pages in the middle when possible
  while ((end - start + 1) < windowSize && start > 2) start--;
  while ((end - start + 1) < windowSize && end < totalPages - 1) end++;

  // Ellipsis after first if needed
  if (start > 2) {
    items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
  }

  for (let i = start; i <= end; i++) {
    items.push(btn(String(i), i, false, i === cp));
  }

  // Ellipsis before last if needed
  if (end < totalPages - 1) {
    items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
  }

  // Always show last page if more than one page
  if (totalPages > 1) {
    items.push(btn(String(totalPages), totalPages, false, cp === totalPages));
  }

  items.push(btn('›', Math.min(totalPages, cp + 1), cp === totalPages));
  items.push(btn('»', totalPages, cp === totalPages));

    pagerEl.innerHTML = `<nav><ul class=\"pagination mb-0\">${items.join('')}</ul></nav>`;
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'renderFilesPaginationControls');
  }
}

function setupFileUploadForms() {
  try {
    const uploadForms = document.querySelectorAll("form[data-upload-form]");
    uploadForms.forEach((form) => {
      form.addEventListener("submit", function (e) {
        e.preventDefault();

        if (
          window.FilesFormValidation &&
          window.FilesFormValidation.validateFileUpload
        ) {
          if (!window.FilesFormValidation.validateFileUpload(form)) {
            return;
          }
        }

        if (
          window.FilesManagement &&
          window.FilesManagement.startUploadWithProgress
        ) {
          window.FilesManagement.startUploadWithProgress(form);
        }
      });
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function setupFileManagement() {
  try {
    // Setup category selection for file moves
    const categorySelects = document.querySelectorAll(
      'select[name="category_id"]'
    );
    categorySelects.forEach((select) => {
      select.addEventListener("change", function () {
        const subSelect = this.closest("form").querySelector(
          'select[name="subcategory_id"]'
        );
        if (
          subSelect &&
          window.FilesManagement &&
          window.FilesManagement.updateMoveSubcategories
        ) {
          window.FilesManagement.updateMoveSubcategories(this.value, subSelect);
        }
      });
    });

    // Setup file input change handler to auto-fill name field and handle multiple files
    const fileInput = document.getElementById("file");
    const nameInput = document.getElementById("add-name");
    const nameLabel = nameInput ? nameInput.closest(".form-control")?.querySelector("label") : null;
    
    function updateNameFieldForMultipleFiles() {
      if (!fileInput || !nameInput) return;
      
      const files = fileInput.files;
      const fileCount = files ? files.length : 0;
      
      if (fileCount > 1) {
        // Multiple files: disable name field and show message
        nameInput.disabled = true;
        nameInput.placeholder = "При множественной загрузке используются реальные имена файлов";
        if (nameLabel) {
          nameLabel.style.opacity = "0.6";
        }
        
        // Show or update message about real names
        let messageEl = document.getElementById("multiple-files-message");
        if (!messageEl) {
          messageEl = document.createElement("small");
          messageEl.id = "multiple-files-message";
          messageEl.className = "form-text text-muted d-block mt-1";
          nameInput.closest(".form-control")?.appendChild(messageEl);
        }
        messageEl.textContent = `Выбрано ${fileCount} файлов. Будут использованы реальные имена файлов.`;
      } else if (fileCount === 1) {
        // Single file: enable name field and auto-fill
        nameInput.disabled = false;
        nameInput.placeholder = "Имя файла...";
        if (nameLabel) {
          nameLabel.style.opacity = "1";
        }
        
        // Remove message about real names
        const messageEl = document.getElementById("multiple-files-message");
        if (messageEl) {
          messageEl.remove();
        }
        
        // Auto-fill if name field is empty
        if (!nameInput.value.trim()) {
          const fileName = files[0].name;
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
          nameInput.value = nameWithoutExt;
        }
      } else {
        // No files: enable and clear
        nameInput.disabled = false;
        nameInput.placeholder = "Имя файла...";
        if (nameLabel) {
          nameLabel.style.opacity = "1";
        }
        
        // Remove message about real names
        const messageEl = document.getElementById("multiple-files-message");
        if (messageEl) {
          messageEl.remove();
        }
      }
    }
    
    if (fileInput) {
      fileInput.addEventListener("change", updateNameFieldForMultipleFiles);
      // Also call on page load if files are already selected (e.g., after modal reopen)
      updateNameFieldForMultipleFiles();
    }
    
    // Reset form state when modal opens
    const addModal = document.getElementById("popup-add");
    if (addModal) {
      // Use MutationObserver to detect when modal is shown
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "attributes" && mutation.attributeName === "class") {
            const isVisible = addModal.classList.contains("active") || 
                             addModal.style.display === "block" ||
                             getComputedStyle(addModal).display !== "none";
            if (isVisible && !addModal.dataset.setup) {
              // Reset form state
              if (fileInput) {
                fileInput.value = "";
              }
              if (nameInput) {
                nameInput.value = "";
                nameInput.disabled = false;
                nameInput.placeholder = "Имя файла...";
              }
              if (nameLabel) {
                nameLabel.style.opacity = "1";
              }
              // Remove message about real names
              const messageEl = document.getElementById("multiple-files-message");
              if (messageEl) {
                messageEl.remove();
              }
              // Hide progress
              const progressContainer = document.getElementById("upload-progress");
              if (progressContainer) {
                progressContainer.classList.add("d-none");
                const progressBar = progressContainer.querySelector(".progress-bar");
                if (progressBar) {
                  progressBar.style.width = "0%";
                  progressBar.setAttribute("aria-valuenow", 0);
                }
              }
              // Call update function to set initial state
              updateNameFieldForMultipleFiles();
              addModal.dataset.setup = "true";
            } else if (!isVisible) {
              addModal.dataset.setup = "false";
            }
          }
        });
      });
      
      observer.observe(addModal, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
      
      // Also listen for click on open buttons
      document.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="files-upload"]') || 
            e.target.closest('[data-testid="files-upload"]') ||
            (e.target.closest("#filesUploadBtn"))) {
          setTimeout(() => {
            updateNameFieldForMultipleFiles();
          }, 100);
        }
      });
    }

    // Setup file actions
    const fileActions = document.querySelectorAll("[data-file-action]");
    fileActions.forEach((action) => {
      action.addEventListener("click", function () {
        const actionType = this.getAttribute("data-file-action");
        const fileId = this.getAttribute("data-file-id");
        handleFileAction(actionType, fileId);
      });
    });

    // Setup double-click to open files
    setupDoubleClickHandlers();
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileManagement");
  }
}

function setupFormValidation() {
  try {
    const forms = document.querySelectorAll("form");
    forms.forEach((form) => {
      form.addEventListener("submit", function (e) {
        if (
          window.FilesFormValidation &&
          window.FilesFormValidation.validateForm
        ) {
          if (!window.FilesFormValidation.validateForm(this)) {
            e.preventDefault();
            return false;
          }
        }
      });
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function setupBackgroundProgress() {
  try {
    // Setup background progress monitoring with Background Activity Manager
    if (
      window.FilesBackgroundProgress &&
      window.FilesBackgroundProgress.updateBackgroundProgress
    ) {
      if (window.BackgroundActivityManager) {
        window.BackgroundActivityManager.register("files-background-progress", {
          start: () => {
            if (
              window.FilesBackgroundProgress &&
              window.FilesBackgroundProgress.updateBackgroundProgress
            ) {
              window.FilesBackgroundProgress.updateBackgroundProgress();
            }
          },
          stop: () => {
            // No specific stop action needed
          },
          interval: 5000,
          autoStart: true,
        });
      } else {
        // Fallback to direct interval
        setInterval(() => {
          window.FilesBackgroundProgress.updateBackgroundProgress();
        }, 5000);
      }
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function handleFileAction(actionType, fileId) {
  try {
    switch (actionType) {
      case "download":
        downloadFile(fileId);
        break;
      case "delete":
        deleteFile(fileId);
        break;
      case "move":
        moveFile(fileId);
        break;
      case "rename":
        renameFile(fileId);
        break;
      default:
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function downloadFile(fileId) {
  try {
    window.location.href = `/api/files/${fileId}/download`;
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}


function moveFile(fileId) {
  try {
    const newCategory = prompt("Введите ID новой категории:");
    if (newCategory) {
      fetch(`/files/move/${fileId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Client-Id": window.__filesClientId || "unknown",
        },
        body: JSON.stringify({ category_id: newCategory }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || data.status !== "success") {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
          }
          if (window.showToast) {
            window.showToast("Файл перемещен", "success");
          }
          return data;
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "moveFile");
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "moveFile");
  }
}

function renameFile(fileId) {
  try {
    const newName = prompt("Введите новое имя файла:");
    if (newName) {
      fetch(`/files/edit/${fileId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Client-Id": window.__filesClientId || "unknown",
        },
        body: JSON.stringify({ display_name: newName }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || data.status !== "success") {
            throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
          }
          if (window.showToast) {
            window.showToast("Файл переименован", "success");
          }
          return data;
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "renameFile");
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "renameFile");
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    initFilesPage();
    
    // Force apply media-info styles on initial page load
    if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
      window.FilesManagement.enforceMediaInfoColumnLayout();
      // Also apply after a short delay to catch any late-rendered content
      setTimeout(() => {
        if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
          window.FilesManagement.enforceMediaInfoColumnLayout();
        }
      }, 100);
    }
    
    // Setup MutationObserver to enforce styles when table content changes
    const table = document.getElementById("maintable");
    if (table) {
      const observer = new MutationObserver((mutations) => {
        let shouldEnforce = false;
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // Check if any added nodes contain media-info elements
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // Element node
                if (node.classList && node.classList.contains('files-page__media-info')) {
                  shouldEnforce = true;
                } else if (node.querySelector && node.querySelector('.files-page__media-info')) {
                  shouldEnforce = true;
                }
              }
            });
          }
        });
        if (shouldEnforce && window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
          // Debounce enforcement
          setTimeout(() => {
            window.FilesManagement.enforceMediaInfoColumnLayout();
          }, 10);
        }
      });
      
      observer.observe(table, {
        childList: true,
        subtree: true
      });
    }
    
    // Initialize files pagination if table has data
    const mainTable = document.getElementById("maintable");
    const tbody = mainTable && mainTable.tBodies && mainTable.tBodies[0];
    
    if (tbody && tbody.querySelectorAll("tr.table__body_row").length > 0) {
      const pager = document.getElementById("files-pagination");
      if (pager && !pager.innerHTML) {
        // Re-render current page to initialize pagination
        const url = new URL(window.location);
        const params = new URLSearchParams(url.search);
        params.set("_t", Date.now());
        
        fetch(`${url.pathname}?${params.toString()}`, {
          method: "GET",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            Accept: "text/html",
          },
        })
          .then((response) => {
            if (!response.ok) return;
            return response.text();
          })
          .then((html) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const newPagination = doc.getElementById("files-pagination");
            const curPagination = document.getElementById("files-pagination");
            if (newPagination && curPagination) {
              curPagination.innerHTML = newPagination.innerHTML;
              setupFilesPaginationClickHandler();
            }
            // Enforce styles after pagination update
            if (window.FilesManagement && window.FilesManagement.enforceMediaInfoColumnLayout) {
              setTimeout(() => {
                window.FilesManagement.enforceMediaInfoColumnLayout();
              }, 50);
            }
          })
          .catch(() => {});
      }
    }

    // Strong override for Add modal Cancel: bind directly on the button to preempt inline handlers
    function bindAddCancelOverride() {
      try {
        const btn = document.getElementById('add-cancel-btn');
        if (!btn || btn._cancelOverrideBound) return;
        btn._cancelOverrideBound = true;
        try { btn.onclick = null; } catch(_) {}
        const handler = async function(e) {
          try {
            e.preventDefault();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            e.stopPropagation();
          } catch(_) {}
          try {
            if (window.__uploadInProgress === true) {
              const proceed = (typeof window.confirm === 'function')
                ? await window.confirm('Отменить загрузку? Частично загруженные файлы будут удалены.')
                : true;
              if (!proceed) return false;
              if (window.FilesManagement && typeof window.FilesManagement.cancelCurrentUploadAndCloseModal === 'function') {
                window.FilesManagement.cancelCurrentUploadAndCloseModal();
              }
              return false;
            } else {
              if (typeof window.closeModal === 'function') {
                window.closeModal('popup-add');
                return false;
              }
            }
          } catch(err) {
            window.ErrorHandler && window.ErrorHandler.handleError(err, 'files-cancel-override');
          }
          return false;
        };
        // Attach both capture and bubble to be safest
        btn.addEventListener('click', handler, true);
        btn.addEventListener('click', handler, false);
      } catch(err) {
        window.ErrorHandler && window.ErrorHandler.handleError(err, 'bindAddCancelOverride');
      }
    }

    // Bind immediately and also when modal shows
    bindAddCancelOverride();
    try {
      const addModal = document.getElementById('popup-add');
      if (addModal) {
        const obs = new MutationObserver(() => bindAddCancelOverride());
        obs.observe(addModal, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    } catch(_) {}

    // Intercept cancel in Add File popup to confirm and properly abort upload
    document.addEventListener('click', async function (e) {
      const btn = e.target && e.target.closest('button#add-cancel-btn');
      if (!btn) return;
      try {
        if (window.__uploadInProgress === true) {
          e.preventDefault();
          e.stopPropagation();
          const proceed = (typeof window.confirm === 'function')
            ? await window.confirm('Отменить загрузку? Частично загруженные файлы будут удалены.')
            : true;
          if (!proceed) return;
          if (window.FilesManagement && typeof window.FilesManagement.cancelCurrentUploadAndCloseModal === 'function') {
            window.FilesManagement.cancelCurrentUploadAndCloseModal();
          }
          return;
        }
        // Not uploading: close modal normally
        if (typeof window.closeModal === 'function') {
          e.preventDefault();
          e.stopPropagation();
          window.closeModal('popup-add');
        }
      } catch (err) {
        window.ErrorHandler && window.ErrorHandler.handleError(err, 'files-cancel-click');
      }
    }, true);
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
});

/**
 * Remove file row
 * @param {string} fileId - File ID
 */
function removeFileRow(fileId) {
  const fileRow = document.getElementById(fileId);
  if (fileRow) {
    fileRow.remove();
  }
}

/**
 * Setup files pagination click handler
 */
function setupFilesPaginationClickHandler() {
  try {
    const pager = document.getElementById("files-pagination");
    if (!pager) return;

    // Remove existing handler if any
    if (pager._clickBound) {
      pager.removeEventListener("click", pager._onPagerClick);
      pager._clickBound = false;
    }

    const onPagerClick = (e) => {
      const a = e.target && e.target.closest("[data-page]");
      if (!a) return;
      e.preventDefault();

      const nextPage = parseInt(a.getAttribute("data-page"), 10) || 1;
      // If search is active, delegate to search pager
      const input = document.getElementById("searchinp");
      const q = input && typeof input.value === "string" ? input.value.trim() : "";
      if (q && typeof window.filesDoFilter === 'function') {
        window.filesDoFilter(q, nextPage);
        return;
      }
      // Otherwise use files page pager
      const url = new URL(window.location);
      const catId = (window.current_category_id != null) ? window.current_category_id : (url.searchParams.get('cat_id'));
      const subId = (window.current_subcategory_id != null) ? window.current_subcategory_id : (url.searchParams.get('sub_id'));
      fetchFilesPage(nextPage, { catId, subId });
    };

    pager.addEventListener("click", onPagerClick);
    pager._clickBound = true;
    pager._onPagerClick = onPagerClick;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupFilesPaginationClickHandler");
    }
  }
}

// Export functions to global scope
window.FilesPage = {
  initFilesPage,
  initFilesContextMenu,
  setupFileUploadForms,
  setupFileManagement,
  setupFormValidation,
  setupBackgroundProgress,
  setupDoubleClickHandlers,
  handleDoubleClick,
  isMediaFileUrl,
  isMediaFileRow,
  openMediaFile,
  openAudioFile,
  openVideoFile,
  handleFileAction,
  downloadFile,
  deleteFile,
  moveFile,
  renameFile,
  removeFileRow,
  setupFilesPaginationClickHandler,
};

// Global function to reinitialize double-click handlers (for use after table updates)
window.reinitFilesDoubleClick = function () {
  try {
    if (window.FilesPage && window.FilesPage.setupDoubleClickHandlers) {
      window.FilesPage.setupDoubleClickHandlers();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "reinitFilesDoubleClick");
  }
};

// Alias for rebindFilesTable (for consistency with other pages)
window.rebindFilesTable = window.reinitFilesDoubleClick;

/**
 * Setup socket synchronization for files page
 */
function setupFilesSocketSync() {
  if (window._filesSocketSyncInitialized) return;
  window._filesSocketSyncInitialized = true;

  if (window.SyncManager && typeof window.SyncManager.on === "function") {
    if (!window.__filesSyncBound) {
      window.__filesSyncBound = true;

      let joinAttempts = 0;
      const maxJoinAttempts = 50;
      const joinRoomWhenReady = () => {
        if (window.SyncManager && window.SyncManager.isConnected()) {
          window.SyncManager.joinRoom("files");
        } else if (joinAttempts < maxJoinAttempts) {
          joinAttempts++;
          setTimeout(joinRoomWhenReady, 100);
        }
      };

      joinRoomWhenReady();

      // Handle files:changed event for general file updates
      window.SyncManager.on("files:changed", (data) => {
        if (
          data.originClientId &&
          data.originClientId === window.__filesClientId
        ) {
          return;
        }

        if (window.FilesManagement && window.FilesManagement.debouncedSync) {
          window.FilesManagement.debouncedSync();
        }
      });

      // Handle files:maintenance_completed event for maintenance completion
      window.SyncManager.on("files:maintenance_completed", (data) => {
        try {

          if (window.showToast) {
            window.showToast(
              `Обслуживание файлов завершено. Обновлено: ${data.updated}, Создано: ${data.created}, Ошибок: ${data.errors}`,
              "success"
            );
          }

          // Force refresh the files table
          if (
            window.FilesManagement &&
            window.FilesManagement.softRefreshFilesTable
          ) {
            setTimeout(() => {
              window.FilesManagement.softRefreshFilesTable(true);
            }, 1000);
          }
        } catch (err) {
          window.ErrorHandler && window.ErrorHandler.handleError("Error handling files:maintenance_completed:", err, "files");
        }
      });

      // Handle files:metadata_updated event for metadata updates
      window.SyncManager.on("files:metadata_updated", (data) => {
        try {

          if (window.showToast) {
            window.showToast("Метаданные файлов обновлены", "info");
          }

          // Soft refresh the files table
          if (window.FilesManagement && window.FilesManagement.debouncedSync) {
            window.FilesManagement.debouncedSync();
          }
        } catch (err) {
          window.ErrorHandler && window.ErrorHandler.handleError("Error handling files:metadata_updated:", err, "files");
        }
      });
    }
  }
}

// Initialize socket sync when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    // Use requestAnimationFrame for better performance
    requestAnimationFrame(() => {
      // Delay to ensure other scripts are loaded
      setTimeout(setupFilesSocketSync, 500); // Reduced from 1000ms
    });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error initializing files socket sync:", err, "files");
  }
});

// Mark file as viewed
window.markViewedAjax = function (fileId) {
  try {

    // Get view URL from row data (same as context menu)
    const row = document.querySelector(`tr[data-id="${fileId}"]`) || document.getElementById(String(fileId));
    const url = row && row.getAttribute("data-view-url");
    
    if (!url) {
      throw new Error("View URL not found for this file");
    }

    // Send GET request to mark file as viewed (same as context menu)
    fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Client-Id": window.__filesClientId || "unknown",
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Refresh the files table to update the UI after a short delay
        setTimeout(() => {
          if (
            window.FilesManagement &&
            window.FilesManagement.softRefreshFilesTable
          ) {
            window.FilesManagement.softRefreshFilesTable(true);
          }
        }, 50);
      })
      .catch((error) => {
        window.ErrorHandler && window.ErrorHandler.handleError("Error marking file as viewed:", error, "files");
        window.ErrorHandler.handleError(error, "markViewedAjax");
      });
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in markViewedAjax:", error, "files");
    window.ErrorHandler.handleError(error, "markViewedAjax");
  }
};

// Open registrator import modal
window.openRegistratorImport = function () {
  try {
    // Open the modal
    openModal('popup-import-registrator');
    
    // Reset all parameter fields
    for (let i = 1; i <= 5; i++) {
      const wrap = document.getElementById(`reg-param-${i}-wrap`);
      const select = document.getElementById(`reg-param-${i}`);
      if (wrap && select) {
        wrap.classList.add('d-none');
        select.innerHTML = '';
      }
    }
    
    // Hide and reset files list
    const filesWrap = document.getElementById('reg-files-wrap');
    const filesList = document.getElementById('reg-files-list');
    if (filesWrap) filesWrap.classList.add('d-none');
    if (filesList) filesList.innerHTML = '<div class="text-muted text-center">Выберите параметры для отображения файлов</div>';
    
    // Load registrators list into the picker
    const picker = document.getElementById('reg-picker');
    if (!picker) {
      window.ErrorHandler && window.ErrorHandler.handleError("Registrator picker not found", "files");
      return;
    }
    
    // Reset picker value
    picker.value = '';
    
    // Remove old change handler to avoid duplicates
    picker.onchange = null;

    // Fetch registrators from API
    fetch('/api/registrators', {
      credentials: 'same-origin'
    })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        const registrators = data.items || [];
        
        // Clear and populate picker
        picker.innerHTML = '<option value="">Выберите регистратор</option>';
        
        if (registrators.length > 0) {
          registrators.forEach(function(r) {
            const option = document.createElement('option');
            option.value = r.id;
            option.textContent = r.name || 'Unnamed';
            // Store url_template for buildFileUrl function
            if (r.url_template) {
              option.setAttribute('data-template', r.url_template);
            }
            picker.appendChild(option);
          });
          
          // Set up change handler
          picker.onchange = function() {
            if (!picker.value) return;
            loadRegistratorLevel(parseInt(picker.value), 1);
          };
        } else {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'Нет доступных регистраторов';
          picker.appendChild(option);
        }
      })
      .catch(function(err) {
        window.ErrorHandler && window.ErrorHandler.handleError("Error loading registrators:", err, "files");
        window.ErrorHandler && window.ErrorHandler.handleError(err, "openRegistratorImport");
        picker.innerHTML = '<option value="">Ошибка загрузки регистраторов</option>';
      });
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error opening registrator import modal:", error, "files");
    window.ErrorHandler.handleError(error, "openRegistratorImport");
  }
};

// Load registrator level
function loadRegistratorLevel(rid, level) {
  try {
    const levels = ['date', 'user', 'time', 'type'];
    const levelNames = ['Дата', 'Пользователь', 'Время', 'Тип'];
    const currentLevel = levels[level - 1];
    
    if (!currentLevel) return;
    
    // Build parent path from previous selections
    const parent = [];
    for (let i = 1; i < level; i++) {
      const prevSelect = document.getElementById(`reg-param-${i}`);
      if (prevSelect && prevSelect.value) {
        parent.push(prevSelect.value);
      }
    }
    
    // Show current level wrapper
    const wrap = document.getElementById(`reg-param-${level}-wrap`);
    const select = document.getElementById(`reg-param-${level}`);
    const label = document.getElementById(`reg-param-${level}-label`);
    
    if (!wrap || !select || !label) return;
    
    // Update label
    label.textContent = levelNames[level - 1];
    
    // Fetch entries
    const url = `/registrators/${rid}/browse?level=${currentLevel}&parent=${parent.join('/')}`;
    
    fetch(url, {
      credentials: 'same-origin'
    })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        if (data.status === 'success' && data.entries) {
          // Populate select
          select.innerHTML = '<option value="">Выберите...</option>';
          const filteredEntries = [];
          data.entries.forEach(function(entry) {
            // Filter out LOG/ entries for 'type' level
            if (currentLevel === 'type' && entry.startsWith('LOG')) {
              return;
            }
            filteredEntries.push(entry);
            const option = document.createElement('option');
            option.value = entry;
            option.textContent = entry;
            select.appendChild(option);
          });
          
          // Show wrapper immediately
          wrap.classList.remove('d-none');
          
          // If only one entry, auto-select it and proceed to next level
          if (filteredEntries.length === 1) {
            select.value = filteredEntries[0];
            // If this is the 'type' level, load files after auto-selecting
            if (currentLevel === 'type') {
              setTimeout(function() {
                loadRegistratorFiles(rid);
              }, 100);
            } else {
              setTimeout(function() {
                loadRegistratorLevel(rid, level + 1);
              }, 100);
            }
          } else {
            // Hide and reset all subsequent levels
            for (let i = level + 1; i <= 4; i++) {
              const nextWrap = document.getElementById(`reg-param-${i}-wrap`);
              const nextSelect = document.getElementById(`reg-param-${i}`);
              if (nextWrap && nextSelect) {
                nextWrap.classList.add('d-none');
                nextSelect.innerHTML = '<option value="">Выберите...</option>';
                nextSelect.onchange = null;
              }
            }
            
            // Hide files list when parameters change (unless this is the last level)
            if (currentLevel !== 'type') {
              const filesWrap = document.getElementById('reg-files-wrap');
              if (filesWrap) {
                filesWrap.classList.add('d-none');
              }
            }
            
            // Check if this is the last level (type) and load files if so
            if (currentLevel === 'type') {
              loadRegistratorFiles(rid);
            }
            
            // Set up change handler for next level if not last
            if (currentLevel !== 'type') {
              select.onchange = function() {
                loadRegistratorLevel(rid, level + 1);
              };
            } else {
              // For type level, trigger file load on change
              select.onchange = function() {
                // Hide previous files list
                const filesWrap = document.getElementById('reg-files-wrap');
                if (filesWrap) {
                  filesWrap.classList.add('d-none');
                }
                // Load new files
                loadRegistratorFiles(rid);
              };
            }
          }
        }
      })
      .catch(function(err) {
        window.ErrorHandler && window.ErrorHandler.handleError("Error loading level:", err, "files");
        window.ErrorHandler && window.ErrorHandler.handleError(err, "loadRegistratorLevel");
      });
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in loadRegistratorLevel:", error, "files");
    window.ErrorHandler.handleError(error, "loadRegistratorLevel");
  }
}

// Load registrator files list
function loadRegistratorFiles(rid) {
  try {
    // Get all parameter values (only first 4 parameters)
    const params = [];
    for (let i = 1; i <= 4; i++) {
      const paramEl = document.getElementById(`reg-param-${i}`);
      if (paramEl && paramEl.value) {
        params.push(paramEl.value);
      }
    }
    
    if (params.length < 4) {
      // Not all parameters selected yet
      const filesWrap = document.getElementById('reg-files-wrap');
      if (filesWrap) {
        filesWrap.classList.add('d-none');
      }
      return;
    }
    
    // Build parent path
    const parent = params.slice(0, 4).join('/');
    
    // Fetch files
    const url = `/registrators/${rid}/browse?level=file&parent=${parent}`;
    
    fetch(url, {
      credentials: 'same-origin'
    })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        const filesWrap = document.getElementById('reg-files-wrap');
        const filesList = document.getElementById('reg-files-list');
        
        if (!filesWrap || !filesList) {
          return;
        }
        
        if (data.status === 'success' && data.entries && data.entries.length > 0) {
          // Show files list
          filesWrap.classList.remove('d-none');
          
          // Populate files list
          filesList.innerHTML = '';
          data.entries.forEach(function(file) {
            const checkbox = document.createElement('div');
            checkbox.className = 'form-check';
            checkbox.innerHTML = `
              <input class="form-check-input" type="checkbox" value="${file}" id="reg-file-${file}" data-reg-file="${file}">
              <label class="form-check-label" for="reg-file-${file}">
                ${file}
              </label>
            `;
            filesList.appendChild(checkbox);
          });
          
          // Add change listeners to enforce max selection
          const checkboxes = filesList.querySelectorAll('input[type="checkbox"]');
          const maxFiles = parseInt(document.getElementById('max-upload-files')?.value || '5') || 5;
          checkboxes.forEach(function(checkbox) {
            checkbox.addEventListener('change', function() {
              const checked = filesList.querySelectorAll('input[type="checkbox"]:checked').length;
              if (checked >= maxFiles) {
                checkboxes.forEach(function(cb) {
                  if (!cb.checked) {
                    cb.disabled = true;
                  }
                });
              } else {
                checkboxes.forEach(function(cb) {
                  cb.disabled = false;
                });
              }
            });
          });
        } else {
          // Show "no files" message
          filesWrap.classList.remove('d-none');
          filesList.innerHTML = '<div class="text-muted text-center">Файлы не найдены</div>';
        }
      })
      .catch(function(err) {
        window.ErrorHandler && window.ErrorHandler.handleError("Error loading files:", err, "files");
        window.ErrorHandler && window.ErrorHandler.handleError(err, "loadRegistratorFiles");
      });
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in loadRegistratorFiles:", error, "files");
    window.ErrorHandler.handleError(error, "loadRegistratorFiles");
  }
}

// Submit registrator import
window.submitRegistratorImport = function () {
  try {
    var checkedBoxes = document.querySelectorAll(
      "#reg-files-list input[type='checkbox']:checked"
    );
    if (checkedBoxes.length === 0) {
          if (window.showToast) {
        window.showToast(
          "Выберите хотя бы один файл для загрузки",
          "error"
        );
      }
      return;
    }

    var selectedFiles = Array.from(checkedBoxes).map(function (cb) {
      return cb.value;
    });

    // Get registrator info
    var sel = document.getElementById("reg-picker");
    var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    var registratorName = opt ? opt.textContent : "Неизвестный регистратор";
    var registratorId = opt ? opt.value : null;

    // Build full URLs for selected files
    var fileUrls = selectedFiles.map(function (fileName) {
      return buildFileUrl(fileName);
    });

    // Check if we can start new upload
    fetch("/api/active-uploads")
      .then((response) => response.json())
      .then((data) => {
        if (!data.can_start_new) {
          if (window.showToast) {
            window.showToast(
              `Достигнут лимит одновременных загрузок (${data.active_uploads}/${data.max_parallel}). Дождитесь завершения одной из загрузок.`,
              "warning"
            );
          }
          // Don't return here - allow user to configure parameters
          // The actual upload will be blocked later
        }

        // Start background upload only if we can start new uploads
        if (data.can_start_new) {
          startBackgroundUpload(
            fileUrls,
            selectedFiles,
            registratorName,
            registratorId
          );
        }
      })
      .catch((err) => {
        window.ErrorHandler && window.ErrorHandler.handleError("Error checking upload limit:", err, "files");
        if (window.showToast) {
          window.showToast("Ошибка при проверке лимита загрузок", "error");
        }
      });
  } catch (err) {
    if (window.showToast) {
      window.showToast("Ошибка при загрузке файлов", "error");
    }
  }
};

function buildFileUrl(fileName) {
  try {
    var sel = document.getElementById("reg-picker");
    var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    var tpl = (opt && opt.getAttribute("data-template")) || "";
    if (!tpl) return "";

    // Get all selected values from parameters
    var selectedValues = [];
    for (var i = 1; i <= 5; i++) {
      var paramSel = document.getElementById("reg-param-" + i);
      if (paramSel && paramSel.value) {
        selectedValues.push(paramSel.value);
      }
    }

    // Extract placeholders from template
    var names = [];
    try {
      (tpl.match(/\{\s*([a-zA-Z0-9_\-]+)\s*\}/g) || []).forEach(function (
        m
      ) {
        var n = m.replace(/^[^{]*\{\s*|\s*\}[^}]*$/g, "");
        if (n && names.indexOf(n) === -1) names.push(n);
      });
      (tpl.match(/<\s*([a-zA-Z0-9_\-]+)\s*>/g) || []).forEach(function (m) {
        var n = m.replace(/^[^<]*<\s*|\s*>[^>]*$/g, "");
        if (n && names.indexOf(n) === -1) names.push(n);
      });
    } catch (_) {}

    // Build URL by replacing placeholders with selected values
    var url = tpl;
    for (
      var j = 0;
      j < Math.min(selectedValues.length, names.length);
      j++
    ) {
      var placeholder = "{" + names[j] + "}";
      var altPlaceholder = "<" + names[j] + ">";
      url = url.replace(placeholder, selectedValues[j]);
      url = url.replace(altPlaceholder, selectedValues[j]);
    }

    // Replace file placeholder with actual filename
    var filePlaceholder = "{file}";
    var altFilePlaceholder = "<file>";
    if (url.includes(filePlaceholder)) {
      url = url.replace(filePlaceholder, fileName);
    } else if (url.includes(altFilePlaceholder)) {
      url = url.replace(altFilePlaceholder, fileName);
    } else {
      // If no file placeholder, append filename
      url = url.replace(/\/+$/, "") + "/" + fileName;
    }

    return url;
  } catch (err) {
    return "";
  }
}

function startBackgroundUpload(
  fileUrls,
  fileNames,
  registratorName,
  registratorId
) {
  try {
    // Check upload limit before starting
    fetch("/api/active-uploads")
      .then((response) => response.json())
      .then((data) => {
        if (!data.can_start_new) {
          if (window.showToast) {
            window.showToast(
              `Достигнут лимит одновременных загрузок (${data.active_uploads}/${data.max_parallel}). Дождитесь завершения одной из загрузок.`,
              "warning"
            );
          }
          return;
        }

        // Proceed with upload
        proceedWithUpload(
          fileUrls,
          fileNames,
          registratorName,
          registratorId
        );
      })
      .catch((err) => {
        window.ErrorHandler && window.ErrorHandler.handleError("Error checking upload limit:", err, "files");
        if (window.showToast) {
          window.showToast("Ошибка при проверке лимита загрузок", "error");
        }
      });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in startBackgroundUpload:", err, "files");
    if (window.showToast) {
      window.showToast("Ошибка при запуске загрузки", "error");
    }
  }
}

function proceedWithUpload(
  fileUrls,
  fileNames,
  registratorName,
  registratorId
) {
  try {
    // Get category and subcategory IDs
    var catId = window.current_category_id || 0;
    var subId = window.current_subcategory_id || 0;

    // If not set, try to get from URL parameters
    if (!catId || !subId) {
      var urlParams = new URLSearchParams(window.location.search);
      catId = catId || parseInt(urlParams.get("cat_id")) || 0;
      subId = subId || parseInt(urlParams.get("sub_id")) || 0;
    }

    // If still not set, try to get from data attributes
    if (!catId || !subId) {
      var modal = document.getElementById("popup-import-registrator");
      if (modal) {
        catId = catId || parseInt(modal.dataset.catId) || 0;
        subId = subId || parseInt(modal.dataset.subId) || 0;
      }
    }

    if (!catId || !subId) {
      if (window.showToast) {
        window.showToast(
          "Не удалось определить категорию и подкатегорию для загрузки",
          "error"
        );
      }
      return;
    }

    // Start background upload asynchronously to avoid blocking UI
    setTimeout(() => {
      fetch("/api/registrator-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
          file_urls: fileUrls,
          file_names: fileNames,
          registrator_name: registratorName,
          registrator_id: registratorId,
          cat_id: catId,
          sub_id: subId,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "success") {
            
            // Reset form
            resetRegistratorForm();
            
            // Close modal properly using modal manager
            if (typeof window.closeModal === "function") {
              window.closeModal("popup-import-registrator");
            } else {
              // Fallback: manual close
              var modal = document.getElementById("popup-import-registrator");
              if (modal) {
                modal.style.display = "none";
                modal.classList.remove("active");
                // Remove backdrop if exists
                var backdrop = document.getElementById("popup-import-registrator-backdrop");
                if (backdrop) {
                  backdrop.remove();
                }
              }
            }
            
            // Ensure scroll is restored after modal close
            setTimeout(function() {
              document.body.style.overflow = "";
              document.documentElement.style.overflow = "";
            }, 100);

            // Start monitoring upload progress
            monitorUploadProgress(data.upload_id, registratorName);

            // Show persistent progress indicator
            showPersistentProgressIndicator(
              data.upload_id,
              registratorName,
              fileNames.length
            );
          } else {
          if (window.showToast) {
              // Проверяем, является ли это ошибкой лимита загрузок
              if (
                data.error &&
                data.error.includes(
                  "Maximum parallel uploads limit reached"
                )
              ) {
                window.showToast(
                  `Достигнут лимит одновременных загрузок (${data.active_uploads}/${data.max_parallel}). Попробуйте позже или очистите неактивные загрузки.`,
                  "warning"
                );

                // Добавляем кнопку очистки в тост
                setTimeout(() => {
                  const toast = document.querySelector(".toast.show");
                  if (toast) {
                    const toastBody = toast.querySelector(".toast-body");
                    if (toastBody) {
                      const cleanupBtn = document.createElement("button");
                      cleanupBtn.className =
                        "btn btn-sm btn-outline-warning ms-2";
                      cleanupBtn.textContent = "Очистить";
                      cleanupBtn.onclick = () => {
                        cleanupInactiveUploads();
                        toast.remove();
                      };
                      toastBody.appendChild(cleanupBtn);
                    }
                  }
                }, 100);
              } else {
                window.showToast(
                  data.error || "Ошибка при запуске загрузки",
                  "error"
                );
              }
            }
          }
        })
        .catch((err) => {
          window.ErrorHandler && window.ErrorHandler.handleError("Error starting upload:", err, "files");
          if (window.showToast) {
            window.showToast("Ошибка при запуске загрузки", "error");
          }
        });
    }, 100);
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in proceedWithUpload:", err, "files");
    if (window.showToast) {
      window.showToast("Ошибка при загрузке файлов", "error");
    }
  }
}

function resetRegistratorForm() {
  try {
    // Reset registrator picker
    var regPicker = document.getElementById("reg-picker");
    if (regPicker) {
      regPicker.selectedIndex = 0;
    }

    // Hide all parameter fields
    for (var i = 1; i <= 5; i++) {
      var wrap = document.getElementById("reg-param-" + i + "-wrap");
      if (wrap) {
        wrap.classList.add("d-none");
        wrap.style.display = "";
      }
    }

    // Clear file list
    var fileList = document.getElementById("reg-file-list");
    if (fileList) {
      fileList.innerHTML = "";
    }

    // Clear textarea
    var textarea = document.getElementById("reg-files-textarea");
    if (textarea) {
      textarea.value = "";
    }

    // Reset all checkboxes
    var checkboxes = document.querySelectorAll("#reg-files-list input[type='checkbox']");
    checkboxes.forEach(function (cb) {
      cb.checked = false;
    });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error resetting registrator form:", err, "files");
  }
}

function showPersistentProgressIndicator(
  uploadId,
  registratorName,
  totalFiles
) {
  try {
    
    // Create persistent progress indicator
    var progressId = "persistent-progress-" + uploadId;
    var existingIndicator = document.getElementById(progressId);
    if (existingIndicator) {
      existingIndicator.remove();
    }

    var indicator = document.createElement("div");
    indicator.id = progressId;
    indicator.className = "persistent-progress-indicator";
    
    // Add to DOM first, then calculate position
    document.body.appendChild(indicator);
    
    // Set CSS styles first
    indicator.style.cssText = `
      position: fixed;
      right: 20px;
      background: var(--modal-bg, #ffffff);
      border: 1px solid var(--control-border, #dee2e6);
      border-radius: 6px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      z-index: 10000;
      min-width: 280px;
      max-width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--body-text, #000000);
    `;
    
    // Check if indicator is visible
    var rect = indicator.getBoundingClientRect();
    
    // Recalculate all toast positions to ensure proper spacing
    recalculateToastPositions();

    indicator.innerHTML = `
      <div class="progress-header">
        <div class="progress-icon"></div>
        <div class="progress-title">Загрузка с регистратора &quot;${registratorName}&quot;</div>
        <div class="progress-actions">
          <button class="progress-btn" onclick="window.cancelUpload('${uploadId}')">Отменить</button>
          <button class="progress-btn" onclick="this.parentElement.parentElement.remove()">&times;</button>
        </div>
      </div>
      <div class="progress-text">
        <div style="display: flex; justify-content: space-between;">
          <span>Файлов: <span id="progress-files-${uploadId}">0/${totalFiles}</span></span>
          <span id="progress-percent-${uploadId}">0%</span>
        </div>
        <div class="progress-bar">
          <div id="progress-bar-${uploadId}" class="progress-fill" style="width: 0%;"></div>
        </div>
      </div>
      <div class="progress-status">
        <div id="progress-status-${uploadId}">Подготовка...</div>
      </div>
    `;

    // Store upload info in localStorage for persistence across page reloads
    var uploadInfo = {
      upload_id: uploadId,
      registrator_name: registratorName,
      total_files: totalFiles,
      start_time: Date.now(),
    };
    localStorage.setItem("upload_" + uploadId, JSON.stringify(uploadInfo));
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error showing persistent progress indicator:", err, "files");
  }
}

function monitorUploadProgress(uploadId, registratorName) {
  var progressInterval = setInterval(function () {
    // Проверяем состояние соединения для оптимизации запросов
    const connectionState = window.SyncManager.getConnectionState();
    if (!connectionState.connected) {
      // Если сокет не подключен, пропускаем этот цикл, но не останавливаем мониторинг
      return;
    }

    fetch(`/api/upload-status/${uploadId}`)
      .then((response) => {
        if (response.status === 404) {
          // Upload job not found (server restart), stop monitoring
          clearInterval(progressInterval);
          hideImportProgress();
          hidePersistentProgress(uploadId);
          removeToastFromStorage(uploadId);

          if (window.showToast) {
            window.showToast(
              "Загрузка была прервана из-за перезагрузки сервера",
              "warning"
            );
          }
          return null; // Stop processing
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data) return; // Skip if 404 was handled
        if (data.status === "success") {
          var upload = data.upload;

          // Update progress indicators
          updateProgressIndicators(uploadId, upload);

          if (upload.status === "completed") {
            // Upload completed successfully
            clearInterval(progressInterval);
            hideImportProgress();
            hidePersistentProgress(uploadId);
            removeToastFromStorage(uploadId);

            if (window.showToast) {
              window.showToast(
                `Загрузка завершена: ${upload.completed_files} файлов`,
                "success"
              );
            }

            // Refresh files table
            setTimeout(function () {
          if (
            window.FilesManagement &&
            window.FilesManagement.softRefreshFilesTable
          ) {
            window.FilesManagement.softRefreshFilesTable(true);
              }
            }, 1000);
          } else if (upload.status === "failed") {
            // Upload failed
            clearInterval(progressInterval);
            hideImportProgress();
            hidePersistentProgress(uploadId);
            removeToastFromStorage(uploadId);

            if (window.showToast) {
              window.showToast(
                `Загрузка не удалась: ${upload.error || "Неизвестная ошибка"}`,
                "error"
              );
            }
          }
        }
      })
      .catch((err) => {
        window.ErrorHandler && window.ErrorHandler.handleError(`[DEBUG] Error checking upload status:`, err, "files");
        // Don't stop monitoring on network errors, just log them
      });
  }, 2000); // Check every 2 seconds
}

function updateProgressIndicators(uploadId, upload) {
  try {
    
    // Update persistent progress indicator
    var filesSpan = document.getElementById("progress-files-" + uploadId);
    var percentSpan = document.getElementById("progress-percent-" + uploadId);
    var barDiv = document.getElementById("progress-bar-" + uploadId);
    var statusDiv = document.getElementById("progress-status-" + uploadId);

    if (filesSpan) {
      filesSpan.textContent = `${upload.completed_files}/${upload.total_files}`;
    }
    // Calculate progress: completed files + current file progress
    var completed = upload.completed_files || 0;
    var total = upload.total_files || 1;
    var currentFileProgress = upload.current_file_progress || 0;
    
    // Add current file's progress (0-100) to completed files count
    var totalProgress = completed + (currentFileProgress / 100);
    var percent = Math.round((totalProgress / total) * 100);
    
    if (percentSpan) {
      percentSpan.textContent = percent + "%";
    }
    if (barDiv) {
      barDiv.style.width = percent + "%";
    }
    if (statusDiv) {
      statusDiv.textContent = upload.current_file || "Обработка...";
    }
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error updating progress indicators:", err, "files");
  }
}

function hideImportProgress() {
  try {
    var progressContainer = document.getElementById("import-progress-container");
    if (progressContainer) {
      progressContainer.remove();
    }
  } catch (err) {}
}

function hidePersistentProgress(uploadId) {
  try {
    var indicator = document.getElementById("persistent-progress-" + uploadId);
    if (indicator) {
      indicator.remove();
      // Recalculate positions of remaining toasts
      recalculateToastPositions();
    }
  } catch (err) {}
}

function recalculateToastPositions() {
  try {
    var indicators = document.querySelectorAll(".persistent-progress-indicator");
    
    indicators.forEach(function(indicator, index) {
      var topOffset = 10 + index * 80; // 80px spacing between indicators
      indicator.style.top = topOffset + "px";
    });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error recalculating toast positions:", err, "files");
  }
}

function removeToastFromStorage(uploadId) {
  try {
    localStorage.removeItem("upload_" + uploadId);
  } catch (err) {}
}

function cleanupInactiveUploads() {
  try {
    fetch("/api/cleanup-inactive-uploads", {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "success") {
          if (window.showToast) {
            window.showToast(
              `Очищено неактивных загрузок: ${data.cleaned_count}`,
              "success"
            );
          }
        } else {
          if (window.showToast) {
            window.showToast("Ошибка при очистке загрузок", "error");
          }
        }
      })
      .catch((err) => {
        window.ErrorHandler && window.ErrorHandler.handleError("Error cleaning up uploads:", err, "files");
        if (window.showToast) {
          window.showToast("Ошибка при очистке загрузок", "error");
        }
      });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in cleanupInactiveUploads:", err, "files");
  }
}

// Restore upload progress indicators after page reload
function restoreUploadProgressFromStorage() {
  try {
    var keys = Object.keys(localStorage);
    var uploadKeys = keys.filter(function(key) {
      return key.startsWith('upload_');
    });
    
    
    // Check if uploads are still active on server
    if (uploadKeys.length > 0) {
      // First, cleanup inactive uploads on server
      fetch('/api/cleanup-inactive-uploads', {
        method: 'POST',
        credentials: 'include'
      }).catch(function(err) {
      });
      
      fetch('/api/active-uploads-list')
        .then(function(response) {
          return response.json();
        })
        .then(function(data) {
          if (data && data.active_uploads) {
            var activeUploadIds = data.active_uploads.map(function(upload) {
              return upload.id;
            });
            
            // Only restore uploads that are still active on server
            uploadKeys.forEach(function(key) {
              try {
                var uploadInfo = JSON.parse(localStorage.getItem(key));
                if (uploadInfo && uploadInfo.upload_id) {
                  if (activeUploadIds.includes(uploadInfo.upload_id)) {
                    
                    // Restore the progress indicator
                    showPersistentProgressIndicator(
                      uploadInfo.upload_id,
                      uploadInfo.registrator_name,
                      uploadInfo.total_files
                    );
                    
                    // Start monitoring progress
                    monitorUploadProgress(uploadInfo.upload_id, uploadInfo.registrator_name);
                  } else {
                    // Upload is no longer active, remove from localStorage
                    localStorage.removeItem(key);
                  }
                }
              } catch (err) {
                window.ErrorHandler && window.ErrorHandler.handleError('Error restoring upload from localStorage:', key, err, "files");
                // Remove corrupted entry
                localStorage.removeItem(key);
              }
            });
            
            // Recalculate positions after restoring all toasts
            recalculateToastPositions();
          }
        })
        .catch(function(err) {
          window.ErrorHandler && window.ErrorHandler.handleError('Error checking active uploads:', err, "files");
        });
    }
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError('Error restoring upload progress:', err, "files");
  }
}

// Call restore function when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreUploadProgressFromStorage);
} else {
  // DOM already loaded
  restoreUploadProgressFromStorage();
}

// Cancel upload function
window.cancelUpload = async function(uploadId) {
  try {
    // Confirm cancellation (async confirm modal)
    const ok = (typeof window.confirm === 'function')
      ? await window.confirm('Вы уверены, что хотите отменить загрузку? Частично загруженные файлы будут удалены.')
      : true;
    if (!ok) return;
    
    // Send cancel request to server
    fetch('/api/cancel-upload/' + uploadId, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(function(data) {
        if (data.success) {
          // Hide progress indicator
          hidePersistentProgress(uploadId);
          
          // Remove from localStorage
          removeToastFromStorage(uploadId);
          
          // Show success toast
          if (window.showToast) {
            window.showToast('Загрузка отменена', 'success');
          }
        } else {
          if (window.showToast) {
            window.showToast('Ошибка при отмене загрузки: ' + (data.error || 'Unknown error'), 'error');
          }
        }
      })
      .catch(function(err) {
        if (window.showToast) {
          window.showToast('Ошибка при отмене загрузки', 'error');
        }
      });
  } catch (err) {
    if (window.showToast) {
      window.showToast('Ошибка при отмене загрузки', 'error');
    }
  }
};
