// Files Upload Progress Module
// Управление прогрессом загрузки файлов

function showPersistentProgressIndicator(uploadId, registratorName, fileName) {
  try {
    const indicator = document.getElementById(`progress-${uploadId}`);
    if (indicator) return;

    const progressContainer = document.getElementById("progress-container");
    if (!progressContainer) return;

    const progressDiv = document.createElement("div");
    progressDiv.id = `progress-${uploadId}`;
    progressDiv.className = "persistent-progress";
    progressDiv.innerHTML = `
      <div class="progress-header">
        <span class="registrator-name">${registratorName}</span>
        <span class="file-name">${fileName}</span>
        <button class="cancel-btn" onclick="cancelUploadRegular('${uploadId}')">×</button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="progress-text">0%</div>
    `;

    progressContainer.appendChild(progressDiv);
    recalculateIndicatorPositions();
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updatePersistentProgress(uploadId, percentage, statusText) {
  try {
    const indicator = document.getElementById(`progress-${uploadId}`);
    if (!indicator) return;

    const progressFill = indicator.querySelector(".progress-fill");
    const progressText = indicator.querySelector(".progress-text");

    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }

    if (progressText) {
      progressText.textContent = statusText || `${percentage}%`;
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function hidePersistentProgress(uploadId) {
  try {
    const indicator = document.getElementById(`progress-${uploadId}`);
    if (indicator) {
      indicator.remove();
      recalculateIndicatorPositions();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function recalculateIndicatorPositions() {
  try {
    const indicators = document.querySelectorAll(".persistent-progress");
    indicators.forEach((indicator, index) => {
      indicator.style.top = `${index * 80 + 20}px`;
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function removeToastFromStorage(uploadId) {
  try {
    const storageKey = `upload_toast_${uploadId}`;
    localStorage.removeItem(storageKey);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateImportProgress(current, total, fileName) {
  try {
    const progressContainer = document.getElementById("import-progress");
    if (!progressContainer) return;

    const percentage = Math.round((current / total) * 100);
    const progressBar = progressContainer.querySelector(
      ".progress-bar .progress-fill"
    );
    const progressText = progressContainer.querySelector(".progress-text");

    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }

    if (progressText) {
      progressText.textContent = `${current}/${total} - ${fileName}`;
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function hideImportProgress() {
  try {
    const progressContainer = document.getElementById("import-progress");
    if (progressContainer) {
      progressContainer.style.display = "none";
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function monitorUploadProgress(uploadId, registratorName) {
  try {
    const interval = setInterval(() => {
      fetch(`/api/upload-progress/${uploadId}`)
        .then((response) => response.json())
        .then((data) => {
          if (data.completed) {
            clearInterval(interval);
            hidePersistentProgress(uploadId);
            if (data.success) {
              window.showToast("Файл загружен успешно", "success");
            } else {
              window.showToast("Ошибка загрузки файла", "error");
            }
          } else {
            updatePersistentProgress(uploadId, data.percentage, data.status);
          }
        })
        .catch((err) => {
          clearInterval(interval);
          hidePersistentProgress(uploadId);
          window.ErrorHandler.handleError(err, "unknown")
        });
    }, 1000);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function restoreToastsFromStorage() {
  try {
    const keys = Object.keys(localStorage);
    const toastKeys = keys.filter((key) => key.startsWith("upload_toast_"));

    toastKeys.forEach((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      if (data && data.uploadId) {
        showPersistentProgressIndicator(
          data.uploadId,
          data.registratorName,
          data.fileName
        );
      }
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.FilesUploadProgress = {
  showPersistentProgressIndicator,
  updatePersistentProgress,
  hidePersistentProgress,
  recalculateIndicatorPositions,
  removeToastFromStorage,
  updateImportProgress,
  hideImportProgress,
  monitorUploadProgress,
  restoreToastsFromStorage,
};
