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

    // Initialize unified context menu
    if (window.contextMenu && window.contextMenu.init) {
      window.contextMenu.init({
        page: "files",
        canManage: canManage,
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes,
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
    // Setup background progress monitoring
    if (
      window.FilesBackgroundProgress &&
      window.FilesBackgroundProgress.updateBackgroundProgress
    ) {
      setInterval(() => {
        window.FilesBackgroundProgress.updateBackgroundProgress();
      }, 5000);
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
        console.warn("Unknown file action:", actionType);
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

function deleteFile(fileId) {
  try {
    if (confirm("Вы уверены, что хотите удалить этот файл?")) {
      fetch(`/api/files/${fileId}`, {
        method: "DELETE",
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.showToast("Файл удален", "success");
            // Remove file from UI
            const fileElement = document.querySelector(
              `[data-file-id="${fileId}"]`
            );
            if (fileElement) {
              fileElement.remove();
            }
          } else {
            window.showToast("Ошибка удаления файла", "error");
          }
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "unknown");
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function moveFile(fileId) {
  try {
    const newCategory = prompt("Введите ID новой категории:");
    if (newCategory) {
      fetch(`/api/files/${fileId}/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ category_id: newCategory }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.showToast("Файл перемещен", "success");
          } else {
            window.showToast("Ошибка перемещения файла", "error");
          }
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "unknown");
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

function renameFile(fileId) {
  try {
    const newName = prompt("Введите новое имя файла:");
    if (newName) {
      fetch(`/api/files/${fileId}/rename`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.showToast("Файл переименован", "success");
          } else {
            window.showToast("Ошибка переименования файла", "error");
          }
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "unknown");
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    initFilesPage();
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupFileUploadForms");
  }
});

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
