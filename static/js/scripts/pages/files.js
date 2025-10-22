// Auto-enable debug logging for files sync (set early)
window.__syncDebug = false;
/**
 * Function to update subcategories when category changes in move modal
 */
function updateMoveSubcategories(selectedCategory, subSelect) {
  try {
    if (!subSelect) return;
    const rootSel = document.getElementById("move-target-root");
    // Prefer data-subs injected into selected option
    let subsMap = null;
    try {
      const opt = rootSel && rootSel.options[rootSel.selectedIndex];
      if (opt && opt.dataset && opt.dataset.subs) {
        subsMap = JSON.parse(opt.dataset.subs);
      }
    } catch (_) {
      subsMap = null;
    }

    if (!subsMap) {
      // Fallback to global dirsData
      if (!window.dirsData || !Array.isArray(window.dirsData)) {
        subSelect.innerHTML =
          '<option value="" disabled>Данные недоступны</option>';
        return;
      }
      if (!selectedCategory) {
        subSelect.innerHTML =
          '<option value="" disabled>Выберите категорию</option>';
        return;
      }
      // Find the category in dirs data: match by display name or folder key
      let categoryData = null;
      for (let i = 0; i < window.dirsData.length; i++) {
        const categoryObj = window.dirsData[i];
        const values = Object.values(categoryObj);
        const keys = Object.keys(categoryObj);
        const categoryName = values[0];
        const categoryKey = keys[0];
        if (
          categoryName === selectedCategory ||
          categoryKey === selectedCategory
        ) {
          categoryData = categoryObj;
          break;
        }
      }
      if (!categoryData) {
        subSelect.innerHTML =
          '<option value="" disabled>Категория не найдена</option>';
        return;
      }
      subsMap = {};
      const keys = Object.keys(categoryData);
      for (let i = 1; i < keys.length; i++) {
        const k = keys[i];
        subsMap[k] = categoryData[k];
      }
    }

    const subKeys = Object.keys(subsMap || {});
    if (!subKeys.length) {
      subSelect.innerHTML =
        '<option value="" disabled>Нет подкатегорий</option>';
      return;
    }

    subSelect.innerHTML = "";
    subKeys.forEach(function (subKey) {
      const subName = subsMap[subKey];
      const option = document.createElement("option");
      option.value = subKey;
      option.textContent = subName;
      subSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Error updating move subcategories:", error);
    subSelect.innerHTML = '<option value="" disabled>Ошибка загрузки</option>';
  }
}

/**
 * Hydrate popup forms with values derived from the selected row.
 * - For add: wires filename -> name autofill.
 * - For edit/delete/note: fills inputs from row with given id.
 * @param {HTMLElement} form The form or any element within the form
 * @param {number|string} id The numeric id of the target row (for non-add forms)
 */
function popupValues(form, id) {
  try {
    if (!form) form = document.getElementById("add");
  } catch (_) {}
  if (!form) {
    return;
  }
  if (form.id != "add" && !id) {
    return;
  }
  if (form.id == "add") {
    const nameInput = document.getElementById("add-name");

    // Track if user has manually typed in the name field
    nameInput.addEventListener("input", function () {
      nameInput.userHasTyped = true;
    });

    // Track if user has manually typed (including paste)
    nameInput.addEventListener("paste", function () {
      nameInput.userHasTyped = true;
    });

    const fileInput = document.getElementById("file");
    fileInput.addEventListener("change", function (event) {
      const files = event.target.files;

      if (files.length > 1) {
        // Multiple files selected - disable name field and show message
        nameInput.disabled = true;
        nameInput.value = "";
        nameInput.placeholder = "Будут использованы реальные имена файлов";
        nameInput.title =
          "При загрузке нескольких файлов используются их реальные имена";
      } else if (files.length === 1) {
        // Single file selected - enable name field and auto-fill
        nameInput.disabled = false;
        nameInput.placeholder = "Имя файла...";
        nameInput.title = "";

        const fileName = files[0].name;

        // Only auto-fill if the name field is empty or user hasn't typed anything
        if (
          !nameInput.value ||
          nameInput.value.trim() === "" ||
          !nameInput.userHasTyped
        ) {
          // Remove extension from filename
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
          nameInput.value = nameWithoutExt;
          nameInput.userHasTyped = false; // Reset flag after auto-fill
        }
      } else {
        // No files selected - reset to default state
        nameInput.disabled = false;
        nameInput.placeholder = "Имя файла...";
        nameInput.title = "";
      }
    });
    // Also toggle name field immediately based on current selection (if any)
    try {
      const files = fileInput.files || [];
      if (files.length > 1) {
        nameInput.disabled = true;
        nameInput.value = "";
        nameInput.placeholder = "Будут использованы реальные имена файлов";
        nameInput.title =
          "При загрузке нескольких файлов используются их реальные имена";
      }
    } catch (_) {}
    return;
  }
  let values = document.getElementById(id).getElementsByTagName("td");
  if (form.id == "edit") {
    const nameVal = (values[0].innerText || "").trim();
    let descVal = (values[1].innerText || "").trim();
    // Strip media markers like "Видео", "Аудио", brackets and separators at the start
    // Also strip registrator info like "[Регистратор - ВМТЭЦ]"
    try {
      descVal = descVal
        .replace(/^\s*[\[(]?(видео|аудио)[)\]]?\s*[:\-–—]?\s*/i, "")
        .replace(/^\s*[–—\-]\s*/i, "")
        .replace(/^\s*\[Регистратор\s*-\s*[^\]]+\]\s*/i, "")
        .trim();
    } catch (_) {}

    // Don't show "Нет описания..." in edit form - show empty field instead
    if (descVal === "Нет описания...") {
      descVal = "";
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
    // Reset modal primary button label to default when opening
    try {
      const modal = form.closest(".overlay-container, .popup, .modal");
      if (modal) {
        const btn = modal.querySelector(".btn.btn-primary");
        if (btn) {
          const current = btn.textContent || "";
          if (
            !btn.dataset.defaultText &&
            current &&
            current.trim() &&
            current.trim() !== "Отправка..."
          ) {
            btn.dataset.defaultText = current.trim();
          }
          const restored =
            btn.dataset.defaultText ||
            btn.dataset.originalText ||
            current ||
            "Отправить";
          btn.textContent = restored;
          btn.disabled = false;
        }
      }
    } catch (_) {}
  } else if (form.id == "move") {
    // Ensure action URL targets the selected file id (replace any trailing /digits)
    if (form.action) {
      if (/\/\d+$/.test(form.action)) {
        form.action = form.action.replace(/\/\d+$/, "/" + id);
      } else if (/\/0$/.test(form.action)) {
        form.action = form.action.replace(/\/0$/, "/" + id);
      }
    }
    try {
      form.dataset.rowId = String(id);
    } catch (_) {}

    // Initialize subcategories for the first selected category
    try {
      const rootSel = document.getElementById("move-target-root");
      const subSel = document.getElementById("move-target-sub");
      if (rootSel && subSel && rootSel.value) {
        // Initialize subcategories for the currently selected category
        updateMoveSubcategories(rootSel.value, subSel);
      }
    } catch (_) {}
  } else if (form.id == "delete") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[0].innerText;
  } else if (form.id == "note") {
    // Read note directly from row attribute to avoid mixing with viewers text
    const row = document.getElementById(id);
    const note =
      row && row.getAttribute("data-note") ? row.getAttribute("data-note") : "";
    form.getElementsByTagName("textarea")[0].value = note;
    try {
      form.dataset.rowId = String(id);
      form.dataset.origNote = note || "";
    } catch (_) {}
  }
  // Ensure action ends with the correct file id (replace any trailing digits or 0)
  // Rebuild action to ensure correct trailing id for edit/note/delete forms
  try {
    if (form.action) {
      // Match base like /files/(edit|note|delete)/did/sdid
      var m = form.action.match(
        /^(.*\/(edit|note|delete)\/\d+\/\d+)(?:\/\d+)?(?:[?#].*)?$/
      );
      if (m && m[1]) {
        form.action = m[1] + "/" + id;
      } else {
        // Fallback: replace any trailing /digits or /0
        if (/\/\d+$/.test(form.action)) {
          form.action = form.action.replace(/\/\d+$/, "/" + id);
        } else if (/\/0$/.test(form.action)) {
          form.action = form.action.replace(/\/0$/, "/" + id);
        }
      }
    }
  } catch (_) {}
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
  const form = element.closest("form");
  if (!form) {
    console.error("Form not found");
    return false;
  }

  if (form.id == "add" || form.id == "edit") {
    // Trim all input fields first
    const inputs = form.querySelectorAll(
      'input[type="text"], input[type="password"], textarea'
    );
    inputs.forEach((input) => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });

    // Find the name input field specifically
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) {
      let name = (nameInput.value || "").replace(/\u00a0/g, " ").trim();

      // For multiple file uploads, skip name validation (real names will be used)
      const fileInput = form.querySelector('input[type="file"]');
      const isMultiple =
        fileInput && fileInput.files && fileInput.files.length > 1;

      if (!isMultiple && (name == undefined || name == "" || name.length < 1)) {
        if (window.showToast) {
          window.showToast("Задайте корректное имя файла!", "error");
        } else {
          if (window.showToast) {
            window.showToast("Задайте корректное имя файла!", "error");
          }
        }
        nameInput.focus();
        return false;
      }
    } else {
      console.error("Name input not found");
      return false;
    }
    // For edit: block submit if no changes (name/description)
    if (form.id == "edit") {
      try {
        const origName = form.dataset.origName || "";
        const origDesc = form.dataset.origDesc || "";
        const descInput = form.querySelector('textarea[name="description"]');
        const nowName = (nameInput.value || "").replace(/\u00a0/g, " ").trim();
        const nowDesc = descInput ? (descInput.value || "").trim() : "";
        if (nowName === origName && nowDesc === origDesc) {
          try {
            popupClose("popup-edit");
          } catch (_) {}
          return false;
        }
      } catch (e) {}
    }
  }
  if (form.id == "add") {
    let fileInput = document.getElementById("file");
    // no external filter selector; accept covers both audio and video
    let len = fileInput.files.length;
    if (len == undefined || len == 0) {
      if (window.showToast) {
        window.showToast("Выберите файл(ы)!", "error");
      } else {
        if (window.showToast) {
          window.showToast("Выберите файл(ы)!", "error");
        }
      }
      return false;
    }
    var maxUploadEl = document.getElementById("max-upload-files");
    var maxUpload = 5;
    try {
      maxUpload =
        parseInt(maxUploadEl && maxUploadEl.value ? maxUploadEl.value : "5") ||
        5;
    } catch (_) {}
    if (len > maxUpload) {
      var msg = "Можно выбрать максимум " + maxUpload + " файлов";
      if (window.showToast) {
        window.showToast(msg, "error");
      } else {
        if (window.showToast) {
          window.showToast(msg, "error");
        }
      }
      return false;
    }
    // Client-side file validation for each file
    const files = Array.from(fileInput.files);
    const maxSizeMbElement = document.getElementById("max-file-size-mb");
    const maxSizeMb = maxSizeMbElement ? parseInt(maxSizeMbElement.value) : 500;
    const maxSize = maxSizeMb * 1024 * 1024;
    const allowedTypes = [
      // video
      "video/mp4",
      "video/webm",
      "video/avi",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
      "video/x-flv",
      "video/x-m4v",
      // audio
      "audio/mpeg",
      "audio/wav",
      "audio/flac",
      "audio/aac",
      "audio/mp4",
      "audio/ogg",
      "audio/opus",
      "audio/x-ms-wma",
    ];
    const allowedExtensions = [
      ".mp4",
      ".webm",
      ".avi",
      ".mov",
      ".mkv",
      ".wmv",
      ".flv",
      ".m4v",
      ".mp3",
      ".wav",
      ".flac",
      ".aac",
      ".m4a",
      ".ogg",
      ".oga",
      ".wma",
      ".mka",
      ".opus",
    ];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxSize) {
        if (window.showToast) {
          window.showToast(
            `Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`,
            "error"
          );
        } else {
          if (window.showToast) {
            window.showToast(
              `Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`,
              "error"
            );
          }
        }
        return false;
      }
      if (f.size === 0) {
        if (window.showToast) {
          window.showToast(`Файл ${f.name} пустой!`, "error");
        } else {
          if (window.showToast) {
            window.showToast(`Файл ${f.name} пустой!`, "error");
          }
        }
        return false;
      }
      let isValidType = allowedTypes.includes(f.type);
      if (!isValidType) {
        const fileName = f.name.toLowerCase();
        isValidType = allowedExtensions.some((ext) => fileName.endsWith(ext));
      }
      if (!isValidType) {
        if (window.showToast) {
          window.showToast(
            `Неподдерживаемый формат: ${
              f.name
            }. Разрешены: ${allowedExtensions.join(", ")}`,
            "error"
          );
        } else {
          if (window.showToast) {
            window.showToast(
              `Неподдерживаемый формат: ${
                f.name
              }. Разрешены: ${allowedExtensions.join(", ")}`,
              "error"
            );
          }
        }
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
    const inputs = form.querySelectorAll(
      'input[type="text"], input[type="password"], textarea'
    );
    inputs.forEach((input) => {
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
  // Initialize uploaded file IDs tracking for potential cleanup
  window.uploadedFileIds = [];

  // Show progress bar and hide buttons
  const progressDiv = document.getElementById("upload-progress");
  const submitBtn = document.getElementById("add-submit-btn");
  const cancelBtn = document.getElementById("add-cancel-btn");

  if (!progressDiv) {
    return;
  }

  const progressBar = progressDiv.querySelector(".progress-bar");
  const statusText = progressDiv.querySelector(".upload-status small");

  if (!progressBar || !statusText) {
    return;
  }

  // Show progress bar
  progressDiv.classList.remove("d-none");

  // Upload modal overlay + guards
  try {
    var overlayEl = document.getElementById("upload-overlay");
    if (overlayEl) overlayEl.style.display = "block";
    var modalEl = document.getElementById("popup-add");
    if (modalEl) modalEl.dataset.uploading = "1";
    // ESC guard
    if (!window.__uploadEscGuard) {
      window.__uploadEscGuard = function (e) {
        try {
          if (
            e &&
            e.key === "Escape" &&
            modalEl &&
            modalEl.dataset.uploading === "1"
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        } catch (_) {}
      };
      document.addEventListener("keydown", window.__uploadEscGuard, true);
    }
    // Click outside guard
    if (modalEl && !modalEl.__uploadClickGuardBound) {
      modalEl.addEventListener(
        "click",
        function (e) {
          try {
            if (modalEl.dataset.uploading !== "1") return;
          } catch (_) {}
          if (e.target === modalEl) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true
      );
      modalEl.__uploadClickGuardBound = true;
    }
    // Guard closeModal for popup-add
    if (
      !window.__origCloseModalGuarded &&
      typeof window.closeModal === "function"
    ) {
      window.__origCloseModalGuarded = window.closeModal;
      window.closeModal = function (id) {
        try {
          if (
            id === "popup-add" &&
            modalEl &&
            modalEl.dataset.uploading === "1"
          ) {
            return;
          }
        } catch (_) {}
        return window.__origCloseModalGuarded(id);
      };
    }
    // Guard popupClose/popupToggle while uploading
    if (
      !window.__origPopupCloseGuarded &&
      typeof window.popupClose === "function"
    ) {
      window.__origPopupCloseGuarded = window.popupClose;
      window.popupClose = function (id) {
        try {
          if (
            id === "popup-add" &&
            modalEl &&
            modalEl.dataset.uploading === "1"
          ) {
            return;
          }
        } catch (_) {}
        return window.__origPopupCloseGuarded(id);
      };
    }
    if (
      !window.__origPopupToggleGuarded &&
      typeof window.popupToggle === "function"
    ) {
      window.__origPopupToggleGuarded = window.popupToggle;
      window.popupToggle = function (id) {
        try {
          if (
            id === "popup-add" &&
            modalEl &&
            modalEl.dataset.uploading === "1"
          ) {
            return;
          }
        } catch (_) {}
        return window.__origPopupToggleGuarded(id);
      };
    }
    // beforeunload warning
    if (!window.__uploadBeforeUnload) {
      window.__uploadBeforeUnload = function (e) {
        try {
          if (modalEl && modalEl.dataset.uploading === "1") {
            var msg =
              "Загрузка ещё выполняется. Уйти со страницы и отменить загрузку?";
            (e || window.event).returnValue = msg;
            return msg;
          }
        } catch (_) {}
      };
      window.addEventListener("beforeunload", window.__uploadBeforeUnload);
    }
  } catch (_) {}

  // Disable submit button, enable cancel button
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) {
    try {
      cancelBtn.removeAttribute("onclick");
    } catch (_) {}
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Отменить загрузку";
    cancelBtn.onclick = function () {
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
      nameInput.placeholder = "Будут использованы имена файлов";
      nameInput.value = "";
    } else {
      nameInput.placeholder = "Загрузка...";
    }
  }
  if (descriptionInput) descriptionInput.disabled = true;
  if (fileInput) fileInput.disabled = true;
  const multi = files.length > 1;
  if (multi && nameInput) {
    nameInput.value = "";
    nameInput.placeholder =
      "При множественной загрузке используются реальные имена файлов";
  }

  // Reset add form to initial state after successful upload
  function resetAfterUpload() {
    try {
      // Clear uploaded file IDs tracking since upload completed successfully
      window.uploadedFileIds = [];

      const form = document.getElementById("add");
      if (!form) return;
      // Native reset first to restore pristine state
      try {
        form.reset();
      } catch (_) {}
      const nameInput = form.querySelector('input[name="name"]');
      const descInput = form.querySelector('textarea[name="description"]');
      const fileInput = form.querySelector('input[type="file"]');
      const progressDiv = document.getElementById("upload-progress");
      const submitBtn = document.getElementById("add-submit-btn");
      const cancelBtn = document.getElementById("add-cancel-btn");
      const fileNameLabel = document.getElementById("file-name");
      // Clear inputs
      if (nameInput) {
        nameInput.disabled = false;
        nameInput.value = "";
        nameInput.placeholder = "Имя файла...";
        nameInput.title = "";
        nameInput.userHasTyped = false;
      }
      if (descInput) {
        descInput.disabled = false;
        descInput.value = "";
      }
      if (fileInput) {
        try {
          fileInput.disabled = false;
          fileInput.removeAttribute("disabled");
          fileInput.value = "";
        } catch (_) {}
        // Also clear any CSS classes that may visually disable the control
        try {
          fileInput.classList.remove("disabled");
        } catch (_) {}
        // In case a wrapper mimics disabled state
        try {
          const wrapper = fileInput.closest(".form-control");
          if (wrapper) wrapper.classList.remove("disabled");
        } catch (_) {}
      }
      if (fileNameLabel) {
        fileNameLabel.textContent = "";
      }
      // Re-run autofill logic, if available
      try {
        if (typeof popupValues === "function") popupValues();
      } catch (_) {}
      // Fire change for listeners bound to file input (to update UI hints)
      try {
        if (fileInput)
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {}
      // Hide progress UI
      if (progressDiv) {
        progressDiv.classList.add("d-none");
        const statusText = progressDiv.querySelector(".upload-status small");
        if (statusText) {
          statusText.style.color = "";
          statusText.textContent = "Загрузка файла...";
        }
        const bar = progressDiv.querySelector(".progress-bar");
        if (bar) {
          bar.style.width = "0%";
          bar.setAttribute("aria-valuenow", 0);
        }
      }
      // Buttons
      if (submitBtn) submitBtn.disabled = false;
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = "Отмена";
        cancelBtn.onclick = function () {
          popupToggle("popup-add");
        };
      }
    } catch (_) {}
  }

  // Ensure recorder iframe inherits current theme (update data-src lazily)
  (function ensureRecorderIframeTheme() {
    try {
      const iframe = document.getElementById("rec-iframe");
      if (!iframe) return;
      const getTheme = () =>
        document.documentElement.getAttribute("data-theme") ||
        (document.body && document.body.getAttribute("data-theme")) ||
        (function () {
          try {
            const cls = document.documentElement.className || "";
            const m = cls.match(/theme-([\w-]+)/);
            return m ? m[1] : "";
          } catch (_) {
            return "";
          }
        })() ||
        (function () {
          try {
            return localStorage.getItem("theme") || "";
          } catch (_) {
            return "";
          }
        })() ||
        "light";
      const themeAttr = getTheme();
      // Prefer updating data-src to avoid triggering a load during navigation
      try {
        const ds = iframe.getAttribute("data-src");
        if (ds) {
          try {
            const u = new URL(ds, window.location.origin);
            u.searchParams.set("embed", "1");
            if (!u.searchParams.has("theme"))
              u.searchParams.set("theme", themeAttr);
            iframe.setAttribute("data-src", u.toString());
          } catch (_) {
            if (ds.indexOf("theme=") === -1) {
              const join = ds.indexOf("?") !== -1 ? "&" : "?";
              iframe.setAttribute(
                "data-src",
                ds + join + "theme=" + encodeURIComponent(themeAttr)
              );
            }
          }
        }
      } catch (_) {}
      // Also send theme via postMessage after iframe loads
      const sendTheme = () => {
        try {
          iframe.contentWindow &&
            iframe.contentWindow.postMessage(
              { type: "theme", value: getTheme() },
              "*"
            );
        } catch (_) {}
      };
      iframe.addEventListener("load", sendTheme, { once: true });
      // Observe theme changes on the parent and forward to iframe
      try {
        const observer = new MutationObserver(function () {
          sendTheme();
        });
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
        if (document.body)
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
          });
      } catch (_) {}
    } catch (_) {}
  })();

  // Combined progress accounting
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let uploadedBytesSoFar = 0;

  // Helper to render combined progress
  function renderCombinedProgress(currentFileLoaded, currentFileTotal, index) {
    const loaded = uploadedBytesSoFar + currentFileLoaded;
    const percent = totalBytes > 0 ? (loaded / totalBytes) * 100 : 100;
    progressBar.style.width = percent + "%";
    progressBar.setAttribute("aria-valuenow", percent);
    const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    statusText.textContent = multi
      ? `Загрузка файлов (${index + 1}/${
          files.length
        })... ${loadedMB}MB / ${totalMB}MB (${Math.round(percent)}%)`
      : `Загрузка файла... ${loadedMB}MB / ${totalMB}MB (${Math.round(
          percent
        )}%)`;
  }

  // Upload a single file (reusing single/two-phase logic)
  function uploadOne(file, index, doneCb, errCb) {
    const nameVal = form.querySelector('input[name="name"]').value;
    const descVal =
      form.querySelector('textarea[name="description"]').value || "";

    const xhr = new XMLHttpRequest();
    window.currentUploadXHR = xhr;
    try {
      xhr.withCredentials = true;
    } catch (e) {}

    xhr.upload.addEventListener("progress", function (e) {
      if (e.lengthComputable) {
        renderCombinedProgress(e.loaded, e.total, index);
      }
    });
    xhr.upload.addEventListener("load", function () {
      try {
        statusText.textContent = multi
          ? "Отправлено, выполняется обработка..."
          : "Файл загружен, выполняется обработка...";
      } catch (e) {}
    });

    xhr.addEventListener("error", function () {
      errCb("Ошибка соединения");
    });
    xhr.addEventListener("abort", function () {
      errCb("Загрузка отменена");
    });
    xhr.addEventListener("load", function () {
      if (xhr.status >= 200 && xhr.status < 400) {
        uploadedBytesSoFar += file.size;
        doneCb();
      } else {
        errCb("Ошибка загрузки файла");
      }
    });

    // Determine flow (two-phase if >= 1.5GB)
    const threshold = 1024 * 1024 * 1024 * 1.5;
    const isLarge = file.size >= threshold;

    if (isLarge) {
      // init
      const initXhr = new XMLHttpRequest();
      try {
        initXhr.withCredentials = true;
      } catch (e) {}
      initXhr.open("POST", form.action.replace("/add/", "/add/init/"));
      initXhr.onload = function () {
        try {
          const resp = JSON.parse(initXhr.responseText || "{}");
          if (resp && resp.upload_url) {
            // upload
            const fd = new FormData();
            fd.append("file", file, file.name);
            xhr.open("POST", resp.upload_url);
            xhr.send(fd);
          } else {
            errCb("Не удалось инициализировать загрузку");
          }
        } catch (e) {
          errCb("Ошибка инициализации загрузки");
        }
      };
      initXhr.onerror = function () {
        errCb("Ошибка соединения при инициализации");
      };
      const initData = new FormData();
      initData.append("name", nameVal);
      initData.append("description", descVal);
      initXhr.send(initData);
    } else {
      // single-phase POST to add endpoint with this one file
      const fd = new FormData();
      fd.append("name", nameVal);
      fd.append("description", descVal);
      fd.append("file", file, file.name);
      xhr.open("POST", form.action);
      xhr.send(fd);
    }
  }

  // If single file, fall back to old behavior via the same helper
  if (files.length <= 1) {
    if (files.length === 1) {
      renderCombinedProgress(0, files[0].size, 0);
      uploadOne(
        files[0],
        0,
        function onDone() {
          // success UI
          progressBar.style.width = "100%";
          progressBar.setAttribute("aria-valuenow", 100);
          statusText.textContent = "Загрузка завершена! Обновление таблицы...";
          setTimeout(() => {
            popupToggle("popup-add");
            try {
              var overlayEl = document.getElementById("upload-overlay");
              if (overlayEl) overlayEl.style.display = "none";
            } catch (_) {}
            try {
              var modalEl = document.getElementById("popup-add");
              if (modalEl) modalEl.dataset.uploading = "0";
            } catch (_) {}
            try {
              if (window.__uploadEscGuard)
                document.removeEventListener(
                  "keydown",
                  window.__uploadEscGuard,
                  true
                );
            } catch (_) {}
            try {
              if (window.__uploadBeforeUnload) {
                window.removeEventListener(
                  "beforeunload",
                  window.__uploadBeforeUnload
                );
                window.__uploadBeforeUnload = null;
              }
            } catch (_) {}
            try {
              if (window.__origCloseModalGuarded) {
                window.closeModal = window.__origCloseModalGuarded;
                window.__origCloseModalGuarded = null;
              }
            } catch (_) {}
            // Reset form after successful upload
            try {
              resetAfterUpload();
            } catch (e) {}
            // Use AJAX refresh instead of page reload
            try {
              window.softRefreshFilesTable && window.softRefreshFilesTable();
            } catch (e) {}
            // Server emits files:changed; no client-side emit
          }, 1000);
        },
        function onErr(msg) {
          handleUploadError(msg);
        }
      );
    }
    return;
  }

  // Multiple files: upload sequentially
  let index = 0;
  function next() {
    if (index >= files.length) {
      progressBar.style.width = "100%";
      progressBar.setAttribute("aria-valuenow", 100);
      statusText.textContent = "Все файлы загружены! Обновление таблицы...";
      setTimeout(() => {
        popupToggle("popup-add");
        try {
          var overlayEl2 = document.getElementById("upload-overlay");
          if (overlayEl2) overlayEl2.style.display = "none";
        } catch (_) {}
        try {
          var modalEl2 = document.getElementById("popup-add");
          if (modalEl2) modalEl2.dataset.uploading = "0";
        } catch (_) {}
        try {
          if (window.__uploadEscGuard)
            document.removeEventListener(
              "keydown",
              window.__uploadEscGuard,
              true
            );
        } catch (_) {}
        try {
          if (window.__uploadBeforeUnload) {
            window.removeEventListener(
              "beforeunload",
              window.__uploadBeforeUnload
            );
            window.__uploadBeforeUnload = null;
          }
        } catch (_) {}
        try {
          if (window.__origCloseModalGuarded) {
            window.closeModal = window.__origCloseModalGuarded;
            window.__origCloseModalGuarded = null;
          }
        } catch (_) {}
        // Reset form after successful upload
        try {
          resetAfterUpload();
        } catch (e) {}
        try {
          window.softRefreshFilesTable && window.softRefreshFilesTable();
        } catch (e) {}
        // Server emits files:changed; no client-side emit
      }, 1000);
      return;
    }
    renderCombinedProgress(0, files[index].size, index);
    uploadOne(
      files[index],
      index,
      function () {
        index++;
        next();
      },
      function (msg) {
        handleUploadError(msg);
      }
    );
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
    xhr.upload.addEventListener("progress", function (e) {
      if (e.lengthComputable) {
        renderCombinedProgress(e.loaded, e.total, index);
      }
    });

    // Handle response
    xhr.addEventListener("load", function () {
      var isSuccess = xhr.status >= 200 && xhr.status < 300;
      var message = "";
      var data = null;
      try {
        data = JSON.parse(xhr.responseText || "");
      } catch (_) {}

      if (isSuccess && data && (data.status === "error" || data.error)) {
        // Server signaled error within JSON despite 2xx
        isSuccess = false;
      }

      if (isSuccess) {
        // Track id if provided
        try {
          if (data && data.id) {
            if (!window.uploadedFileIds) window.uploadedFileIds = [];
            window.uploadedFileIds.push(data.id);
          }
        } catch (_) {}
        if (successCb) successCb();
        return;
      }

      // Build error message
      if (data && (data.message || data.error)) {
        message = String(data.message || data.error);
      } else if (xhr.status === 302) {
        message =
          "Ошибка загрузки: получен редирект (302). Попробуйте ещё раз.";
      } else if (xhr.status) {
        message = `Ошибка загрузки: ${xhr.status}`;
      } else {
        message = "Ошибка загрузки";
      }
      if (errorCb) errorCb(message);
    });

    // Handle errors
    xhr.addEventListener("error", function () {
      if (errorCb) errorCb("Ошибка соединения");
    });

    xhr.addEventListener("abort", function () {
      if (errorCb) errorCb("Загрузка отменена");
    });

    // Prepare form data
    const formData = new FormData();
    formData.append("file", file);

    // Get files array from the form
    const fileInput = form.querySelector('input[type="file"]');
    const allFiles =
      fileInput && fileInput.files ? Array.from(fileInput.files) : [];

    // For multiple files, always use the real file name (without extension)
    if (allFiles.length > 1) {
      formData.append("name", file.name.replace(/\.[^/.]+$/, "")); // Remove extension
    } else {
      // For single file, use the name from input field if available
      const nameInput = form.querySelector('input[name="name"]');
      const inputName = nameInput ? nameInput.value.trim() : "";
      formData.append("name", inputName || file.name.replace(/\.[^/.]+$/, ""));
    }

    const descInput = form.querySelector('textarea[name="description"]');
    formData.append("description", descInput ? descInput.value.trim() : "");

    // Ensure destination IDs are sent (server accepts from form or query)
    try {
      const catId = (window.current_category_id || 0) | 0;
      const subId = (window.current_subcategory_id || 0) | 0;
      if (catId > 0 && subId > 0) {
        formData.append("cat_id", String(catId));
        formData.append("sub_id", String(subId));
      }
    } catch (_) {}

    // Store xhr for cancellation
    window.currentUploadXHR = xhr;

    // Send the request
    xhr.open("POST", form.action);
    try {
      // Mark as AJAX to get JSON instead of redirect
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      xhr.setRequestHeader("Accept", "application/json");
      // Propagate client id for sync origin filtering
      const clientId =
        (typeof localStorage !== "undefined" &&
          (localStorage.getItem("__filesClientId") ||
            localStorage.getItem("__clientId"))) ||
        window.__filesClientId ||
        window.__clientId ||
        "";
      if (clientId) xhr.setRequestHeader("X-Client-Id", clientId);
    } catch (_) {}
    try {
      xhr.withCredentials = true;
    } catch (_) {}
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
  const progressBar = document.querySelector("#upload-progress .progress-bar");
  const statusText = document.querySelector(
    "#upload-progress .upload-status small"
  );

  if (!progressBar || !statusText) return;

  // Calculate overall progress across all files
  const files = document.getElementById("file").files;
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
  const percentage =
    totalSize > 0 ? Math.round((loadedSize / totalSize) * 100) : 0;
  progressBar.style.width = percentage + "%";
  progressBar.setAttribute("aria-valuenow", percentage);

  // Update status text
  const currentFileNum = fileIndex + 1;
  const totalFiles = files.length;
  const fileName = files[fileIndex] ? files[fileIndex].name : "";

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
  const progressDiv = document.getElementById("upload-progress");
  const statusText = progressDiv.querySelector(".upload-status small");
  const submitBtn = document.getElementById("add-submit-btn");
  const cancelBtn = document.getElementById("add-cancel-btn");

  // Show error message
  if (statusText) {
    statusText.textContent = message || "Ошибка загрузки";
    statusText.style.color = "var(--danger-color, #dc3545)";
  }

  // Re-enable form
  if (submitBtn) submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Закрыть";
    cancelBtn.onclick = function () {
      // Do not auto-close; leave popup open so user decides
    };
  }

  // Clear guards and warnings to avoid F5 prompt after error
  clearUploadGuards();

  // Re-enable input fields
  const form = document.getElementById("add");
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');

    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = "Имя файла...";
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }

  // Clear upload reference
  window.currentUploadXHR = null;

  // Clear overlay and guards
  try {
    var overlayEl = document.getElementById("upload-overlay");
    if (overlayEl) overlayEl.style.display = "none";
    var modalEl = document.getElementById("popup-add");
    if (modalEl) modalEl.dataset.uploading = "0";
    if (window.__uploadEscGuard) {
      document.removeEventListener("keydown", window.__uploadEscGuard, true);
    }
    if (window.__uploadBeforeUnload) {
      window.removeEventListener("beforeunload", window.__uploadBeforeUnload);
      window.__uploadBeforeUnload = null;
    }
    if (window.__origCloseModalGuarded) {
      window.closeModal = window.__origCloseModalGuarded;
      window.__origCloseModalGuarded = null;
    }
    if (window.__origPopupCloseGuarded) {
      window.popupClose = window.__origPopupCloseGuarded;
      window.__origPopupCloseGuarded = null;
    }
    if (window.__origPopupToggleGuarded) {
      window.popupToggle = window.__origPopupToggleGuarded;
      window.__origPopupToggleGuarded = null;
    }
  } catch (_) {}
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

  // Clean up any already uploaded files if they exist
  if (window.uploadedFileIds && window.uploadedFileIds.length > 0) {
    cleanupUploadedFiles(window.uploadedFileIds);
    window.uploadedFileIds = []; // Clear the array
  }

  // Reset UI
  const progressDiv = document.getElementById("upload-progress");
  const submitBtn = document.getElementById("add-submit-btn");
  const cancelBtn = document.getElementById("add-cancel-btn");
  const statusText = progressDiv.querySelector(".upload-status small");

  if (statusText) {
    statusText.textContent =
      "Загрузка отменена. Уже загруженные файлы удалены.";
    statusText.style.color = "var(--danger-color, #dc3545)";
  }

  // Re-enable submit button, reset cancel button
  if (submitBtn) submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Отмена";
    cancelBtn.onclick = function () {
      // Do not auto-close; leave popup open so user decides
    };
  }

  // Clear guards and warnings so click outside can close again and no F5 prompt
  clearUploadGuards();

  // Re-enable input fields
  const form = document.getElementById("add");
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');

    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = "Имя файла...";
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }

  // Hide progress after delay
  setTimeout(() => {
    progressDiv.classList.add("d-none");
    if (statusText) {
      statusText.style.color = "";
      statusText.textContent = "Загрузка файла...";
    }
  }, 2000);
}

/**
 * Show an error message in the upload UI and restore controls.
 * @param {string} message Error message for the user
 */
function handleUploadError(message) {
  const progressDiv = document.getElementById("upload-progress");
  const submitBtn = document.getElementById("add-submit-btn");
  const cancelBtn = document.getElementById("add-cancel-btn");
  const statusText = progressDiv.querySelector(".upload-status small");

  statusText.textContent = message;
  statusText.style.color = "var(--danger-color, #dc3545)";

  // Re-enable submit button, reset cancel button
  submitBtn.disabled = false;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Отмена";
    cancelBtn.onclick = function () {
      // Do not auto-close; leave popup open so user decides
    };
  }

  // Re-enable input fields
  const form = document.getElementById("add");
  if (form) {
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const fileInput = form.querySelector('input[type="file"]');

    if (nameInput) {
      nameInput.disabled = false;
      nameInput.placeholder = "Имя файла...";
    }
    if (descriptionInput) descriptionInput.disabled = false;
    if (fileInput) fileInput.disabled = false;
  }

  // Clear global xhr reference
  window.currentUploadXHR = null;

  // Hide progress after delay
  setTimeout(() => {
    progressDiv.classList.add("d-none");
    statusText.style.color = "";
    statusText.textContent = "Загрузка файла...";
  }, 3000);
}

// Default sort by "Дата создания" (descending) for files table
/**
 * Sort the files table by the "Дата создания" column in descending order.
 */
function sortFilesTableByDateDesc() {
  try {
    const table = document.getElementById("maintable");
    if (!table) return;
    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    // Fixed column index for "Дата создания": 3 (0-based)
    const dateHeaderIndex = 3;

    // Select all data rows (skip the search/actions row)
    const dataRows = Array.from(
      tbody.querySelectorAll("tr:not(.table__body_actions)")
    );
    if (!dataRows.length) return;

    const toTimestamp = (s) => {
      if (!s) return 0;
      s = s.replace(/\u00a0/g, " ").trim();
      const iso = s.replace(" ", "T");
      let t = Date.parse(iso);
      if (isNaN(t)) t = Date.parse(iso + ":00");
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
        const va = (
          a.children[dateHeaderIndex]?.innerText ||
          a.children[dateHeaderIndex]?.textContent ||
          ""
        ).trim();
        const vb = (
          b.children[dateHeaderIndex]?.innerText ||
          b.children[dateHeaderIndex]?.textContent ||
          ""
        ).trim();
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
  const table = document.getElementById("maintable");
  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  // Include both ready rows and processing rows; exclude only the actions/search row
  const rows = Array.from(
    tbody.querySelectorAll("tr:not(.table__body_actions)")
  );
  const pager = document.getElementById("files-pagination");
  if (!pager) return;
  const pageSize = 15;
  const key = "files_page:" + location.pathname + location.search;

  function getPageCount() {
    return Math.max(1, Math.ceil(rows.length / pageSize));
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function readPage() {
    const saved = parseInt(localStorage.getItem(key) || "1", 10);
    return clamp(isNaN(saved) ? 1 : saved, 1, getPageCount());
  }

  function writePage(p) {
    localStorage.setItem(key, String(p));
  }

  function renderPage(page) {
    const pages = getPageCount();
    page = clamp(page, 1, pages);
    // Switch to server-side paging fetch
    try {
      const table = document.getElementById("maintable");
    } catch (_) {}
  }
}

// Initialize filename autofill for add form on load
try {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      try {
        popupValues(document.getElementById("add"));
      } catch (_) {}
    });
  } else {
    try {
      popupValues(document.getElementById("add"));
    } catch (_) {}
  }
} catch (_) {}

// Initialize unified context menu for Files page
try {
  function initFilesContextMenu() {
    try {
      if (!window.contextMenu) return;
      var menuEl = document.getElementById("context-menu");
      if (!menuEl) return;
      window.contextMenu.init({
        page: "files",
        canAdd: true,
        canNotes: true,
        canMarkView: true,
      });
    } catch (_) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initFilesContextMenu();
    });
  } else {
    initFilesContextMenu();
  }
  // Reinitialize after dynamic table updates (if such events are emitted)
  document.addEventListener("files-table-rendered", function () {
    try {
      document.dispatchEvent(new Event("context-menu-reinit"));
    } catch (_) {}
  });
} catch (_) {}

// Helper to clear guards and warnings after upload end/cancel/error
function clearUploadGuards() {
  try {
    var modalEl = document.getElementById("popup-add");
    if (modalEl) modalEl.dataset.uploading = "0";
    var overlayEl = document.getElementById("upload-overlay");
    if (overlayEl) overlayEl.style.display = "none";
    if (window.__uploadEscGuard) {
      document.removeEventListener("keydown", window.__uploadEscGuard, true);
      window.__uploadEscGuard = null;
    }
    if (window.__uploadBeforeUnload) {
      window.removeEventListener("beforeunload", window.__uploadBeforeUnload);
      window.__uploadBeforeUnload = null;
    }
    if (window.__origCloseModalGuarded) {
      window.closeModal = window.__origCloseModalGuarded;
      window.__origCloseModalGuarded = null;
    }
    if (window.__origPopupCloseGuarded) {
      window.popupClose = window.__origPopupCloseGuarded;
      window.__origPopupCloseGuarded = null;
    }
    if (window.__origPopupToggleGuarded) {
      window.popupToggle = window.__origPopupToggleGuarded;
      window.__origPopupToggleGuarded = null;
    }
  } catch (_) {}
}
