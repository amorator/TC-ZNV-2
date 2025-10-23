// Files Management Module
// Управление файлами

function updateMoveSubcategories(selectedCategoryId, subSelect) {
  try {
    if (!subSelect) return;

    // Clear existing options
    subSelect.innerHTML = '<option value="">Выберите подкатегорию</option>';

    if (!selectedCategoryId) return;

    fetch(`/api/categories/${selectedCategoryId}/subcategories`)
      .then((response) => response.json())
      .then((data) => {
        if (data.subcategories) {
          data.subcategories.forEach((sub) => {
            const option = document.createElement("option");
            option.value = sub.id;
            option.textContent = sub.name;
            subSelect.appendChild(option);
          });
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function popupValues(form, id) {
  try {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Store form data for later use
    window.formData = data;

    // Show popup with form values
    const popup = document.createElement("div");
    popup.className = "form-popup";
    popup.innerHTML = `
      <div class="popup-content">
        <h3>Данные формы</h3>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <button onclick="this.parentElement.parentElement.remove()">Закрыть</button>
      </div>
    `;

    document.body.appendChild(popup);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function startUploadWithProgress(form) {
  try {
    const formData = new FormData(form);
    const uploadId = Date.now().toString();
    const registratorName = formData.get("registrator_name") || "Неизвестно";
    const fileName = formData.get("file")?.name || "Файл";

    // Show progress indicator
    showPersistentProgressIndicator(uploadId, registratorName, fileName);

    // Start upload
    fetch("/api/upload", {
      method: "POST",
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          updatePersistentProgress(uploadId, 100, "Завершено");
          setTimeout(() => hidePersistentProgress(uploadId), 2000);
          window.showToast("Файл загружен успешно", "success");
        } else {
          hidePersistentProgress(uploadId);
          window.showToast("Ошибка загрузки файла", "error");
        }
      })
      .catch((err) => {
        hidePersistentProgress(uploadId);
        window.ErrorHandler.handleError(err, "unknown")
      });

    // Start monitoring progress
    monitorUploadProgress(uploadId, registratorName);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function renderCombinedProgress(loaded, total, fileIndex) {
  try {
    const progressContainer = document.getElementById("combined-progress");
    if (!progressContainer) return;

    const percentage = Math.round((loaded / total) * 100);
    const progressBar = progressContainer.querySelector(
      ".progress-bar .progress-fill"
    );
    const progressText = progressContainer.querySelector(".progress-text");

    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }

    if (progressText) {
      progressText.textContent = `Файл ${
        fileIndex + 1
      }: ${loaded}/${total} (${percentage}%)`;
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function handleUploadError(message) {
  try {
    window.ErrorHandler.handleError(err, "unknown")
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function cancelUploadRegular(uploadId) {
  try {
    fetch(`/api/cancel-upload/${uploadId}`, {
      method: "POST",
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          hidePersistentProgress(uploadId);
          window.showToast("Загрузка отменена", "info");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.FilesManagement = {
  updateMoveSubcategories,
  popupValues,
  startUploadWithProgress,
  renderCombinedProgress,
  handleUploadError,
  cancelUploadRegular,
};
