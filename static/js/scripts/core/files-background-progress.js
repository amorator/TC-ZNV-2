// Files Background Progress Module
// Фоновый прогресс загрузки

function showAllBackgroundProgress() {
  try {
    const progressContainer = document.getElementById("background-progress");
    if (!progressContainer) return;

    progressContainer.style.display = "block";
    updateBackgroundProgress();
  } catch (err) {
    window.ErrorHandler.handleError(err, "showAllBackgroundProgress");
  }
}

function showBackgroundProgressForUpload(state, uploadKey, index) {
  try {
    const progressContainer = document.getElementById("background-progress");
    if (!progressContainer) return;

    const progressItem = document.createElement("div");
    progressItem.className = "background-progress-item";
    progressItem.id = `bg-progress-${uploadKey}`;
    progressItem.innerHTML = `
      <div class="progress-info">
        <span class="upload-key">${uploadKey}</span>
        <span class="upload-state">${state}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    `;

    progressContainer.appendChild(progressItem);
  } catch (err) {
    window.ErrorHandler.handleError(err, "showBackgroundProgressForUpload");
  }
}

function showBackgroundProgress() {
  try {
    const progressContainer = document.getElementById("background-progress");
    if (!progressContainer) return;

    progressContainer.style.display = "block";
    updateBackgroundProgress();
  } catch (err) {
    window.ErrorHandler.handleError(err, "showBackgroundProgress");
  }
}

function updateBackgroundProgress() {
  try {
    // Get all background uploads
    fetch("/api/background-uploads", {
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
        if (data.uploads) {
          data.uploads.forEach((upload) => {
            const progressItem = document.getElementById(
              `bg-progress-${upload.key}`
            );
            if (progressItem) {
              const progressFill = progressItem.querySelector(".progress-fill");
              const progressState = progressItem.querySelector(".upload-state");

              if (progressFill) {
                progressFill.style.width = `${upload.progress}%`;
              }

              if (progressState) {
                progressState.textContent = upload.state;
              }
            }
          });
        }
        return data;
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "updateBackgroundProgress");
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "updateBackgroundProgress");
  }
}

function hideBackgroundProgress() {
  try {
    const progressContainer = document.getElementById("background-progress");
    if (progressContainer) {
      progressContainer.style.display = "none";
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "hideBackgroundProgress");
  }
}

function removeBackgroundProgressItem(uploadKey) {
  try {
    const progressItem = document.getElementById(`bg-progress-${uploadKey}`);
    if (progressItem) {
      progressItem.remove();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "removeBackgroundProgressItem");
  }
}

// Export functions to global scope
window.FilesBackgroundProgress = {
  showAllBackgroundProgress,
  showBackgroundProgressForUpload,
  showBackgroundProgress,
  updateBackgroundProgress,
  hideBackgroundProgress,
  removeBackgroundProgressItem,
};
