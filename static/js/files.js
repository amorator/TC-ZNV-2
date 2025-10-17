// Auto-enable debug logging for files sync (set early)
try {
  window.__syncDebug = true;
  console.debug("[files] debug logging enabled");
} catch (_) {}

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
    try {
      descVal = descVal
        .replace(/^\s*[\[(]?(видео|аудио)[)\]]?\s*[:\-–—]?\s*/i, "")
        .replace(/^\s*[–—\-]\s*/i, "")
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
          alert("Задайте корректное имя файла!");
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
        alert("Выберите файл(ы)!");
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
        alert(msg);
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
          alert(
            `Файл ${f.name} слишком большой. Максимальный размер: ${maxSizeMb}MB`
          );
        }
        return false;
      }
      if (f.size === 0) {
        if (window.showToast) {
          window.showToast(`Файл ${f.name} пустой!`, "error");
        } else {
          alert(`Файл ${f.name} пустой!`);
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
          alert(
            `Неподдерживаемый формат: ${
              f.name
            }. Разрешены: ${allowedExtensions.join(", ")}`
          );
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

  // Disable submit button, enable cancel button
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) {
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

    // Handle successful upload
    xhr.addEventListener("load", function () {
      if (xhr.status >= 200 && xhr.status < 400) {
        try {
          // Try to parse response to get file ID
          var response = JSON.parse(xhr.responseText);
          if (response && response.id) {
            // Initialize uploadedFileIds array if it doesn't exist
            if (!window.uploadedFileIds) {
              window.uploadedFileIds = [];
            }
            window.uploadedFileIds.push(response.id);
          }
        } catch (e) {
          // If response is not JSON, that's okay - we just can't track the ID
        }

        if (successCb) successCb();
      } else {
        if (errorCb) errorCb(`Ошибка загрузки: ${xhr.status}`);
      }
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

    // Store xhr for cancellation
    window.currentUploadXHR = xhr;

    // Send the request
    xhr.open("POST", form.action);
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
      popupToggle("popup-add");
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
      popupToggle("popup-add");
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
      popupToggle("popup-add");
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
      const did =
        window.currentDid != null
          ? window.currentDid
          : (function () {
              try {
                return (
                  parseInt(location.pathname.split("/")[2] || "0", 10) || 0
                );
              } catch (_) {
                return 0;
              }
            })();
      const sdid =
        window.currentSdid != null
          ? window.currentSdid
          : (function () {
              try {
                return (
                  parseInt(location.pathname.split("/")[3] || "1", 10) || 1
                );
              } catch (_) {
                return 1;
              }
            })();
      const tbody = table && table.tBodies && table.tBodies[0];
      const url = `/files/page/${did}/${sdid}?page=${page}&page_size=${pageSize}&t=${Date.now()}`;
      fetch(url, {
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data && data.html != null && tbody) {
            // Preserve the search row while updating table body
            const searchRow = tbody.querySelector("tr#search");
            const temp = document.createElement("tbody");
            temp.innerHTML = data.html;
            // Remove all rows except the search row
            Array.from(tbody.querySelectorAll("tr")).forEach(function (tr) {
              if (!searchRow || tr !== searchRow) tr.remove();
            });
            // Append new rows after search row if present, else directly
            const rows = Array.from(temp.children);
            if (searchRow) {
              const parent = searchRow.parentNode;
              rows.forEach(function (tr) {
                parent.insertBefore(tr, searchRow.nextSibling);
              });
            } else {
              rows.forEach(function (tr) {
                tbody.appendChild(tr);
              });
            }
            // Rebind interactions for the new rows
            try {
              reinitializeContextMenu();
            } catch (_) {}
            try {
              bindRowOpenHandlers();
            } catch (_) {}
            try {
              bindCopyNameHandlers();
            } catch (_) {}
            // Ensure client-side sort by date desc is applied
            try {
              sortFilesTableByDateDesc();
            } catch (_) {}
            writePage(data.page || page);
            renderControls(
              Math.max(1, data.page || page),
              Math.max(1, Math.ceil((data.total || 0) / pageSize))
            );
          }
        })
        .catch(() => {});
    } catch (_) {}
  }

  function renderControls(page, pages) {
    const btn = (label, targetPage, disabled = false, extraClass = "") =>
      `<li class="page-item ${extraClass} ${
        disabled ? "disabled" : ""
      }"><a class="page-link" href="#" data-page="${targetPage}">${label}</a></li>`;

    const items = [];
    items.push(btn("⏮", 1, page === 1, "first"));
    items.push(btn("‹", page - 1, page === 1, "prev"));

    // Always include first page
    items.push(
      `<li class="page-item ${
        page === 1 ? "active" : ""
      }"><a class="page-link" href="#" data-page="1">1</a></li>`
    );

    // Left ellipsis
    const leftStart = Math.max(2, page - 2);
    const leftGap = leftStart - 2;
    if (leftGap >= 1) {
      items.push(
        `<li class="page-item disabled"><span class="page-link">…</span></li>`
      );
    }

    // Middle window
    const midStart = Math.max(2, page - 2);
    const midEnd = Math.min(pages - 1, page + 2);
    for (let p = midStart; p <= midEnd; p++) {
      items.push(
        `<li class="page-item ${
          p === page ? "active" : ""
        }"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`
      );
    }

    // Right ellipsis
    const rightEnd = Math.min(pages - 1, page + 2);
    const rightGap = pages - 1 - rightEnd;
    if (rightGap >= 1) {
      items.push(
        `<li class="page-item disabled"><span class="page-link">…</span></li>`
      );
    }

    // Always include last page
    if (pages > 1) {
      items.push(
        `<li class="page-item ${
          page === pages ? "active" : ""
        }"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`
      );
    }

    items.push(btn("›", page + 1, page === pages, "next"));
    items.push(btn("⏭", pages, page === pages, "last"));

    pager.innerHTML = `<nav><ul class="pagination mb-0">${items.join(
      ""
    )}</ul></nav>`;

    // Add event delegation once to avoid accumulating handlers across renders
    if (!pager._clickBound) {
      const onPagerClick = (e) => {
        const target = e.target.closest("[data-page]");
        if (!target) return;

        e.preventDefault();
        const p = parseInt(target.getAttribute("data-page") || "1", 10);
        renderPage(p);
        const table = document.getElementById("maintable");
        if (table) {
          table.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
      if (!pager._clickBound) {
        pager.addEventListener("click", onPagerClick);
        pager._clickBound = true;
      }
      pager._clickBound = true;
    }
  }

  renderPage(readPage());

  // expose pager controls for integration with search clear/restore
  window.filesPager = {
    renderPage: renderPage,
    readPage: readPage,
  };
}

// Search integration: filter across all pages, restore page on clear
/**
 * Filter the files table rows by a query across all visible text.
 * Preserves pagination state and limits results while searching.
 * @param {string} query The search string
 */
window.filesDoFilter = function filesDoFilter(query) {
  const table = document.getElementById("maintable");
  if (!table || !table.tBodies || !table.tBodies[0])
    return Promise.resolve(false);
  const tbody = table.tBodies[0];
  const pager = document.getElementById("files-pagination");
  const did =
    window.currentDid != null
      ? window.currentDid
      : (function () {
          try {
            return parseInt(location.pathname.split("/")[2] || "0", 10) || 0;
          } catch (_) {
            return 0;
          }
        })();
  const sdid =
    window.currentSdid != null
      ? window.currentSdid
      : (function () {
          try {
            return parseInt(location.pathname.split("/")[3] || "1", 10) || 1;
          } catch (_) {
            return 1;
          }
        })();
  const q = (query || "").trim();
  if (q.length > 0) {
    if (pager) pager.classList.add("d-none");
    const url = `/files/search/${did}/${sdid}?q=${encodeURIComponent(
      q
    )}&page=1&page_size=30&t=${Date.now()}`;
    return fetch(url, {
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.html != null) {
          // Preserve the search row
          const searchRow = tbody.querySelector("tr#search");
          const temp = document.createElement("tbody");
          temp.innerHTML = data.html;
          // Clear all except search row
          Array.from(tbody.querySelectorAll("tr")).forEach(function (tr) {
            if (!searchRow || tr !== searchRow) tr.remove();
          });
          // Append new rows after the search row (if present) else into tbody
          const rows = Array.from(temp.children);
          if (searchRow) {
            const parent = searchRow.parentNode;
            rows.forEach(function (tr) {
              parent.insertBefore(tr, searchRow.nextSibling);
            });
          } else {
            rows.forEach(function (tr) {
              tbody.appendChild(tr);
            });
          }
          // If no rows returned, show an explicit 'no results' row
          if (rows.length === 0) {
            const empty = document.createElement("tr");
            empty.className = "table__body_row no-results";
            const td = document.createElement("td");
            td.className = "table__body_item";
            td.colSpan =
              table.tHead &&
              table.tHead.rows[0] &&
              table.tHead.rows[0].cells.length
                ? table.tHead.rows[0].cells.length
                : 7;
            td.textContent = "Нет результатов";
            empty.appendChild(td);
            if (searchRow && searchRow.parentNode) {
              searchRow.parentNode.insertBefore(empty, searchRow.nextSibling);
            } else {
              tbody.appendChild(empty);
            }
          }
          try {
            reinitializeContextMenu();
          } catch (_) {}
          try {
            bindRowOpenHandlers();
          } catch (_) {}
          try {
            bindCopyNameHandlers();
          } catch (_) {}
          // Ensure client-side sort by date desc is applied to search results
          try {
            sortFilesTableByDateDesc();
          } catch (_) {}
          // Re-apply missing banners if any rows already marked
          try {
            const missing = Array.from(
              tbody.querySelectorAll('tr[data-exists="0"]')
            );
            missing.forEach(function (tr) {
              const id = tr.getAttribute("data-id");
              if (id && window.markFileAsMissing) {
                window.markFileAsMissing(id);
              }
            });
          } catch (_) {}
          // keep the search value persisted explicitly after replacing rows
          try {
            const input = document.getElementById("searchinp");
            if (input && typeof input.value === "string") {
              const searchKey =
                "files_search:" + location.pathname + location.search;
              if (input.value.trim()) {
                localStorage.setItem(searchKey, input.value);
              }
            }
          } catch (_) {}
          return true;
        }
        return true;
      })
      .catch(() => {
        return false;
      });
  } else {
    if (pager) pager.classList.remove("d-none");
    if (
      window.filesPager &&
      typeof window.filesPager.readPage === "function" &&
      typeof window.filesPager.renderPage === "function"
    ) {
      window.filesPager.renderPage(window.filesPager.readPage());
    }
    return Promise.resolve(true);
  }
};

// Global clear handler used by inline onclick
window.searchClean = function () {
  const el = document.getElementById("searchinp");
  if (el) {
    el.value = "";
  }
  try {
    const searchKey = "files_search:" + location.pathname + location.search;
    localStorage.removeItem(searchKey);
  } catch (e) {}
  // restore pagination to saved page
  if (
    window.filesPager &&
    typeof window.filesPager.readPage === "function" &&
    typeof window.filesPager.renderPage === "function"
  ) {
    window.filesPager.renderPage(window.filesPager.readPage());
  } else {
    filesDoFilter("");
  }
};

document.addEventListener("DOMContentLoaded", function () {
  // Bind add modal name autofill from selected file if single and name empty
  (function initAddNameAutofill() {
    try {
      const nameInput = document.getElementById("add-name");
      const fileInput = document.getElementById("file");
      if (!nameInput || !fileInput) return;
      if (!nameInput._typedBound) {
        nameInput._typedBound = true;
        nameInput.addEventListener("input", function () {
          nameInput.userHasTyped = true;
        });
        nameInput.addEventListener("paste", function () {
          nameInput.userHasTyped = true;
        });
      }
      if (!fileInput._changeBound) {
        fileInput._changeBound = true;
        const handle = function () {
          const files = fileInput.files || [];
          if (files.length === 1) {
            // Enable and autofill if empty or user hasn't typed yet
            nameInput.disabled = false;
            nameInput.placeholder = "Имя файла...";
            nameInput.title = "";
            const fileName = files[0].name || "";
            if (
              !nameInput.value ||
              nameInput.value.trim() === "" ||
              !nameInput.userHasTyped
            ) {
              const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
              nameInput.value = nameWithoutExt;
              nameInput.userHasTyped = false;
            }
          } else if (files.length > 1) {
            // Multiple files: lock and clear name
            nameInput.disabled = true;
            nameInput.value = "";
            nameInput.placeholder = "Будут использованы реальные имена файлов";
            nameInput.title =
              "При загрузке нескольких файлов используются их реальные имена";
          } else {
            // No files selected
            nameInput.disabled = false;
            nameInput.placeholder = "Имя файла...";
            nameInput.title = "";
          }
        };
        fileInput.addEventListener("change", handle);
        // Apply once on load in case file input already has a file (e.g., reopening)
        handle();
      }
    } catch (_) {}
  })();

  // Initialize missing file banners for files that don't exist
  const rows = document.querySelectorAll('tr[data-exists="0"]');
  rows.forEach((row) => {
    const fileId = row.getAttribute("data-id");
    if (fileId) {
      // Inline function to mark file as missing (since markFileAsMissing is defined later)
      try {
        const targetRow =
          document.querySelector(`tr[data-id="${fileId}"]`) ||
          document.getElementById(String(fileId));
        if (!targetRow) return;
        targetRow.setAttribute("data-exists", "0");
        // Insert banner at the top of the notes column (last column)
        const tds = targetRow.querySelectorAll("td");
        const notesTd = tds[tds.length - 1];
        if (!notesTd) return;
        let banner = notesTd.querySelector(".file-missing-banner");
        if (!banner) {
          banner = document.createElement("div");
          banner.className = "file-missing-banner";
          banner.style.color = "var(--danger, #b00020)";
          banner.style.fontWeight = "600";
          banner.style.marginBottom = "4px";
          banner.textContent = "Файл не найден";
          notesTd.prepend(banner);
        } else {
          banner.textContent = "Файл не найден";
        }
      } catch (e) {
        /* noop */
      }
    }
  });

  // Run after other ready handlers
  sortFilesTableByDateDesc();
  initFilesPagination();
  const input = document.getElementById("searchinp");
  if (input) {
    const searchKey = "files_search:" + location.pathname + location.search;
    // restore previous search
    try {
      const saved = localStorage.getItem(searchKey);
      if (saved && typeof saved === "string") {
        input.value = saved;
        // defer filter to next tick to ensure DOM is ready
        setTimeout(function () {
          try {
            window.filesDoFilter && window.filesDoFilter(saved);
          } catch (_) {}
        }, 0);
        // and once more on window load to cover F5 partial-cache cases
        try {
          window.addEventListener("load", function () {
            setTimeout(function () {
              try {
                window.filesDoFilter && window.filesDoFilter(saved);
              } catch (_) {}
            }, 0);
          });
        } catch (_) {}
      }
    } catch (e) {}

    input.addEventListener("input", (e) => {
      const val = e.target.value || "";
      try {
        if (val.trim().length > 0) {
          localStorage.setItem(searchKey, val);
        } else {
          localStorage.removeItem(searchKey);
        }
      } catch (err) {}
      try {
        window.filesDoFilter && window.filesDoFilter(val);
      } catch (_) {}
    });
  }

  // Socket.IO live updates for files table
  try {
    if (window.io) {
      /**
       * @type {import('socket.io-client').Socket}
       */
      const socket =
        window.socket &&
        (window.socket.connected || window.socket.connecting) &&
        typeof window.socket.on === "function"
          ? window.socket
          : window.io(window.location.origin, {
              transports: ["websocket", "polling"],
              upgrade: true,
              path: "/socket.io",
              withCredentials: true,
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000,
            });

      // Preserve existing global socket; only set if absent
      if (!window.socket) {
        window.socket = socket;
      }

      // Robust reconnect handlers to survive idle time
      try {
        socket.on("reconnect", function () {
          try {
            if (typeof window.registerFilesSocketHandlers === "function")
              window.registerFilesSocketHandlers(socket);
          } catch (_) {}
        });
        socket.on("disconnect", function (reason) {
          if (reason !== "io client disconnect") {
            try {
              socket.connect();
            } catch (_) {}
          }
        });
        // Hard teardown and recreate socket on 400/invalid session or early WS close
        (function bindFilesReconnectHardening(sock) {
          if (sock._filesHardeningBound) return;
          sock._filesHardeningBound = true;
          let attemptedFallback = false;
          const recreate = function (options) {
            try {
              sock.off && sock.off("connect_error", onErr);
            } catch (_) {}
            try {
              sock.off && sock.off("error", onErr);
            } catch (_) {}
            try {
              sock.off && sock.off("reconnect_error", onErr);
            } catch (_) {}
            try {
              sock.disconnect && sock.disconnect();
            } catch (_) {}
            const next = window.io(
              window.location.origin,
              Object.assign(
                {
                  forceNew: true,
                  path: "/socket.io",
                  withCredentials: true,
                  reconnection: true,
                  reconnectionAttempts: Infinity,
                  reconnectionDelay: 1000,
                  reconnectionDelayMax: 5000,
                  timeout: 20000,
                  query: { ts: String(Date.now()) },
                },
                options || { transports: ["websocket"], upgrade: false }
              )
            );
            window.socket = next;
            // Minimal rebinds; existing code below will also set up listeners on current socket
            try {
              next.off && next.off("files:changed");
            } catch (_) {}
            try {
              next.on &&
                next.on("connect", function () {
                  try {
                    scheduleFilesRefreshFromSocket({ reason: "server-update" });
                  } catch (_) {}
                });
            } catch (_) {}
            // Rebind hardening to the new instance
            bindFilesReconnectHardening(next);
          };
          function onErr(err) {
            try {
              const code = (err && (err.code || err.status)) || 0;
              const msg = String(err && (err.message || err)) || "";
              const isEarlyWsClose =
                /WebSocket is closed before the connection is established/i.test(
                  msg
                );
              if (
                !attemptedFallback &&
                (code === 400 || isEarlyWsClose || !code)
              ) {
                attemptedFallback = true;
                // First recreate with WebSocket-only; if that fails, fallback to polling-only
                recreate({
                  transports: ["websocket"],
                  upgrade: false,
                  forceNew: true,
                });
              }
            } catch (_) {}
          }
          try {
            sock.on("connect_error", onErr);
          } catch (_) {}
          try {
            sock.on("error", onErr);
          } catch (_) {}
          try {
            sock.on("reconnect_error", onErr);
          } catch (_) {}
          // If the WS-only recreate also errors, switch to polling-only once
          try {
            sock.on("close", function () {
              if (!attemptedFallback) return;
              // Second stage: polling-only
              recreate({
                transports: ["polling"],
                upgrade: false,
                forceNew: true,
              });
            });
          } catch (_) {}
        })(socket);
      } catch (_) {}

      /**
       * Handle successful connection - refresh table to get latest data
       */
      if (!socket._filesBound) {
        socket._filesBound = true;
        console.debug("[files] binding direct socket handlers");
        socket.on("connect", function () {
          console.debug("[files] socket connected");
          // Re-register files:changed events on reconnect
          socket.off("files:changed");
          socket.on("files:changed", function (evt) {
            try {
              const fromSelf = !!(
                evt &&
                evt.originClientId &&
                window.__filesClientId &&
                evt.originClientId === window.__filesClientId
              );
              if (fromSelf) {
                return;
              }
            } catch (_) {}
            const serverReasons = [
              "conversion-complete",
              "processing-complete",
              "server-update",
              "note",
              "edited",
              "deleted",
              "uploaded",
              "init",
              "metadata",
              "recorded",
            ];
            const isServerReason = !!(
              evt &&
              evt.reason &&
              serverReasons.indexOf(String(evt.reason)) !== -1
            );
            if (isServerReason) {
              // If tab is hidden, run immediate refresh without debounce to keep background up-to-date
              if (document.hidden) {
                try {
                  window.__filesHadBackgroundEvent = true;
                } catch (_) {}
                try {
                  triggerImmediateFilesRefresh();
                } catch (_) {}
              } else {
                triggerImmediateFilesRefresh();
                scheduleFilesRefreshFromSocket(
                  evt || { reason: "server-update" }
                );
                setTimeout(function () {
                  try {
                    triggerImmediateFilesRefresh();
                  } catch (_) {}
                }, 250);
              }
            }
          });
          scheduleFilesRefreshFromSocket({ reason: "server-update" });
        });

        /**
         * Handle disconnection - Socket.IO will attempt automatic reconnection
         * @param {string} reason - Reason for disconnection
         */
        socket.on("disconnect", function (reason) {
          // Connection lost, will attempt reconnection
        });

        /**
         * Handle connection errors - Socket.IO will handle reconnection automatically
         * @param {Error} err - Connection error
         */
        socket.on("connect_error", function (err) {
          // Connection error, Socket.IO will handle reconnection automatically
        });

        /**
         * Handle successful reconnection - refresh table to get latest data
         * @param {number} attemptNumber - Number of reconnection attempts
         */
        socket.on("reconnect", function (attemptNumber) {
          // Re-register files:changed events on reconnect
          socket.off("files:changed");
          socket.on("files:changed", function (evt) {
            try {
              const fromSelf = !!(
                evt &&
                evt.originClientId &&
                window.__filesClientId &&
                evt.originClientId === window.__filesClientId
              );
              if (fromSelf) {
                return;
              }
            } catch (_) {}
            const serverReasons = [
              "conversion-complete",
              "processing-complete",
              "server-update",
              "note",
              "edited",
              "deleted",
              "uploaded",
              "init",
              "metadata",
              "recorded",
            ];
            const isServerReason = !!(
              evt &&
              evt.reason &&
              serverReasons.indexOf(String(evt.reason)) !== -1
            );
            if (isServerReason) {
              if (document.hidden) {
                try {
                  window.__filesHadBackgroundEvent = true;
                } catch (_) {}
                try {
                  triggerImmediateFilesRefresh();
                } catch (_) {}
              } else {
                triggerImmediateFilesRefresh();
                scheduleFilesRefreshFromSocket(
                  evt || { reason: "server-update" }
                );
                setTimeout(function () {
                  try {
                    triggerImmediateFilesRefresh();
                  } catch (_) {}
                }, 250);
              }
            }
          });
          scheduleFilesRefreshFromSocket({ reason: "server-update" });
        });

        /**
         * Handle reconnection errors - Socket.IO will continue trying
         * @param {Error} error - Reconnection error
         */
        socket.on("reconnect_error", function (error) {
          // Reconnection error, will continue trying
        });

        /**
         * Handle reconnection failure - create a completely new socket connection
         */
        socket.on("reconnect_failed", function () {
          // Avoid replacing global socket to preserve other modules' listeners (e.g., users page)
          // Let Socket.IO keep trying based on reconnection options.
        });

        /**
         * Handle files changed event - refresh table to show updates
         * @param {Object} evt - Event data
         */
        // Remove existing listeners to prevent duplicates
        socket.off("files:changed");

        // Force register events even if socket is already connected
        if (socket.connected) {
        }

        socket.on("files:changed", function (evt) {
          try {
            if (window.__syncDebug) {
              console.debug("[files-socket-recv] files:changed", evt);
            }
            const fromSelf = !!(
              evt &&
              evt.originClientId &&
              window.__filesClientId &&
              evt.originClientId === window.__filesClientId
            );
            if (fromSelf) {
              if (window.__syncDebug) {
                console.debug("[files-socket-ignore-self] files:changed", evt);
              }
              return;
            }
          } catch (_) {}
          // Handle file missing status updates
          if (
            (evt.reason === "metadata" || evt.reason === "moved") &&
            evt.id &&
            evt.file_exists !== undefined
          ) {
            if (evt.file_exists) {
              window.clearFileMissingStatus(evt.id);
            } else {
              window.markFileAsMissing(evt.id);
            }
          }
          // Always refresh for note/edited events (server-originated)
          const serverReasons = [
            "conversion-complete",
            "processing-complete",
            "server-update",
            "note",
            "edited",
            "deleted",
            "uploaded",
            "init",
            "metadata",
            "recorded",
          ];
          const isServerReason = !!(
            evt &&
            evt.reason &&
            serverReasons.indexOf(String(evt.reason)) !== -1
          );
          if (isServerReason) {
            try {
              if (document.hidden) {
                try {
                  window.__filesHadBackgroundEvent = true;
                } catch (_) {}
                triggerImmediateFilesRefresh();
              } else {
                // Debounce multiple rapid events
                if (refreshTimeout) {
                  clearTimeout(refreshTimeout);
                }
                refreshTimeout = setTimeout(function () {
                  triggerImmediateFilesRefresh();
                  scheduleFilesRefreshFromSocket(
                    evt || { reason: "server-update" }
                  );
                  refreshTimeout = null;
                }, 200);
              }
            } catch (e) {
              console.error("Error in files:changed handler:", e);
            }
          }
        });
      }
    }
  } catch (e) {
    // Socket.IO initialization failed, table will work without live updates
  }

  // Helper: smooth table update without flickering
  function smoothUpdateTableBody(oldTbody, newTbody) {
    const oldRows = Array.from(oldTbody.querySelectorAll("tr"));
    const newRows = Array.from(newTbody.querySelectorAll("tr"));

    // Create maps for efficient lookup
    const oldRowMap = new Map();
    const newRowMap = new Map();

    oldRows.forEach((row) => {
      const id = row.getAttribute("data-id") || row.id;
      if (id) oldRowMap.set(id, row);
    });

    newRows.forEach((row) => {
      const id = row.getAttribute("data-id") || row.id;
      if (id) newRowMap.set(id, row);
    });

    // Update existing rows
    for (const [id, newRow] of newRowMap) {
      const oldRow = oldRowMap.get(id);
      if (oldRow) {
        // Update existing row content without replacing the entire row
        const oldCells = oldRow.querySelectorAll("td");
        const newCells = newRow.querySelectorAll("td");

        if (oldCells.length === newCells.length) {
          // Update cell content
          for (let i = 0; i < oldCells.length; i++) {
            if (oldCells[i].innerHTML !== newCells[i].innerHTML) {
              oldCells[i].innerHTML = newCells[i].innerHTML;
            }
          }
          // Update row attributes
          Array.from(newRow.attributes).forEach((attr) => {
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
  try {
    window.tableManager &&
      window.tableManager.registerTable("maintable", {
        pageType: "files",
        refreshEndpoint: window.location.href,
        smoothUpdate: true,
      });
  } catch (_) {}
  // Per-tab client id to mark our own socket emissions (persist like users.js)
  try {
    if (!window.__filesClientId) {
      try {
        const saved = localStorage.getItem("files:clientId");
        if (saved && typeof saved === "string" && saved.trim()) {
          window.__filesClientId = saved.trim();
        }
      } catch (_) {}
      if (!window.__filesClientId) {
        window.__filesClientId =
          Math.random().toString(36).slice(2) + Date.now();
        try {
          localStorage.setItem("files:clientId", window.__filesClientId);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Auto-enable debug logging for files sync
  try {
    window.__syncDebug = true;
  } catch (_) {}
  // Prevent overlapping refreshes and recover from errors
  let __filesRefreshBusy = false;
  let __filesRefreshStartedAt = 0;
  let __filesRefreshDebounceTimer = null;
  let __filesLastRefreshAt = 0;
  const __filesMinRefreshIntervalMs = 10000; // hard throttle (10s)
  let __filesLastActive = Date.now();
  let __filesCooldownUntil = 0; // timestamp to defer refresh work during bursts
  let __filesIdleSuspended = false;
  function isRecorderOpen() {
    try {
      const el = document.getElementById("popup-rec");
      return !!(el && el.classList && el.classList.contains("show"));
    } catch (_) {
      return false;
    }
  }

  function markActive() {
    const now = Date.now();
    // Throttle updates to at most ~4x per second to avoid hot paths on mousemove
    if (now - __filesLastActive < 250) return;
    __filesLastActive = now;
    if (__filesIdleSuspended) {
      __filesIdleSuspended = false;
      // resume timers as needed
      try {
        if (typeof checkAndSchedule === "function") checkAndSchedule();
      } catch (_) {}
    }
  }
  try {
    document.addEventListener("mousemove", markActive, { passive: true });
  } catch (_) {}
  // Do not capture keydown globally; keep it light
  try {
    document.addEventListener("keydown", markActive);
  } catch (_) {}
  try {
    document.addEventListener("wheel", markActive, { passive: true });
  } catch (_) {}
  try {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        __filesCooldownUntil = Date.now() + 1500;
        markActive();
        try {
          if (window.socket && !window.socket.connected)
            window.socket.connect();
        } catch (_) {}
        try {
          if (typeof window.registerFilesSocketHandlers === "function")
            window.registerFilesSocketHandlers(window.socket);
        } catch (_) {}
        try {
          softRefreshFilesTable();
        } catch (_) {}
      }
    });
  } catch (_) {}
  // Consider OS app switching: window focus can occur while tab stayed visible
  try {
    window.addEventListener("focus", function () {
      __filesCooldownUntil = Date.now() + 1500;
      markActive();
      try {
        if (window.socket && !window.socket.connected) {
          try {
            window.socket.connect();
          } catch (_) {}
        }
        try {
          if (typeof window.registerFilesSocketHandlers === "function")
            window.registerFilesSocketHandlers(window.socket);
        } catch (_) {}
        try {
          softRefreshFilesTable();
        } catch (_) {}
      } catch (_) {}
    });
  } catch (_) {}

  // Register global resume soft refresh via SyncManager
  try {
    if (
      window.SyncManager &&
      typeof window.SyncManager.onResume === "function"
    ) {
      window.SyncManager.onResume(function () {
        try {
          scheduleFilesRefreshFromSocket({ reason: "resume" });
        } catch (_) {}
      });
    }
  } catch (_) {}

  function isIdle(maxMs) {
    return Date.now() - __filesLastActive > maxMs;
  }
  // Soft refresh: re-fetch current page or active search and rebind handlers
  function softRefreshFilesTable() {
    try {
      const input = document.getElementById("searchinp");
      const q =
        input && typeof input.value === "string" ? input.value.trim() : "";
      if (q && typeof window.filesDoFilter === "function") {
        return window
          .filesDoFilter(q)
          .then(function () {
            try {
              afterRefresh();
            } catch (_) {}
          })
          .catch(function () {
            try {
              afterRefresh();
            } catch (_) {}
          });
      }
      if (
        window.filesPager &&
        typeof window.filesPager.readPage === "function" &&
        typeof window.filesPager.renderPage === "function"
      ) {
        window.filesPager.renderPage(window.filesPager.readPage());
        try {
          afterRefresh();
        } catch (_) {}
        return;
      }
      // Fallback to TableManager if pager not available
      if (window.tableManager && window.tableManager.softRefreshTable) {
        return window.tableManager
          .softRefreshTable("maintable")
          .then(function () {
            try {
              afterRefresh();
            } catch (_) {}
          });
      }
    } catch (_) {}
  }

  // Immediate refresh that bypasses debouncing and wrappers, with fallback
  let isRefreshing = false;
  let refreshTimeout = null;
  function triggerImmediateFilesRefresh() {
    if (isRefreshing) {
      // suppressed debug log
      return;
    }

    // Clear any pending refresh
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }

    isRefreshing = true;
    // suppressed debug log
    try {
      const input = document.getElementById("searchinp");
      const q =
        input && typeof input.value === "string" ? input.value.trim() : "";
      // suppressed debug log
      if (q && typeof window.filesDoFilter === "function") {
        // suppressed debug log
        window
          .filesDoFilter(q)
          .then(function () {
            try {
              afterRefresh();
            } catch (_) {}
            isRefreshing = false;
            // suppressed debug log
          })
          .catch(function () {
            try {
              afterRefresh();
            } catch (_) {}
            isRefreshing = false;
            // suppressed debug log
          });
        return;
      }
      if (
        window.filesPager &&
        typeof window.filesPager.readPage === "function" &&
        typeof window.filesPager.renderPage === "function"
      ) {
        // suppressed debug log
        try {
          // Force reload page data from server instead of using cached data
          if (typeof window.filesPager.loadPage === "function") {
            // suppressed debug log
            window.filesPager
              .loadPage(window.filesPager.readPage())
              .then(function (pageData) {
                // suppressed debug log
                window.filesPager.renderPage(pageData);
                // suppressed debug log
                try {
                  afterRefresh();
                } catch (e) {
                  console.error("Error in afterRefresh:", e);
                }
                isRefreshing = false;
                // suppressed debug log
              })
              .catch(function (e) {
                console.error("Error loading fresh page data:", e);
                // Fallback to cached data
                const currentPage = window.filesPager.readPage();
                window.filesPager.renderPage(currentPage);
                // suppressed debug log
                try {
                  afterRefresh();
                } catch (e) {
                  console.error("Error in afterRefresh:", e);
                }
                isRefreshing = false;
                // suppressed debug log
              });
          } else {
            // No loadPage method, force AJAX refresh instead of using cached data
            // suppressed debug log
            const url = window.location.pathname + window.location.search;
            fetch(url, {
              method: "GET",
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                "Cache-Control": "no-cache",
              },
            })
              .then((response) => response.text())
              .then((html) => {
                // suppressed debug log
                // Parse and update table
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");

                // Try different selectors for the table
                const selectors = [
                  "#files-table tbody",
                  "table tbody",
                  ".table tbody",
                  "tbody",
                ];

                let newTable = null;
                let currentTable = null;

                for (const selector of selectors) {
                  newTable = doc.querySelector(selector);
                  currentTable = document.querySelector(selector);
                  if (newTable && currentTable) {
                    // suppressed debug log
                    break;
                  }
                }

                if (newTable && currentTable) {
                  // Force replace on socket-triggered refreshes to avoid FF diff glitches
                  currentTable.innerHTML = newTable.innerHTML;
                  // suppressed debug log
                  try {
                    afterRefresh();
                  } catch (e) {
                    console.error("Error in afterRefresh:", e);
                  }
                } else {
                  console.error(
                    "Could not find table elements for update. Tried selectors:",
                    selectors
                  );
                  // suppressed debug logs

                  // Fallback: try to update the entire page content
                  // suppressed debug log
                  const newBody = doc.querySelector("body");
                  if (newBody) {
                    // Find the main content area and update it
                    const newContent = newBody.querySelector(
                      ".container, main, #content, .content"
                    );
                    const currentContent = document.querySelector(
                      ".container, main, #content, .content"
                    );
                    if (newContent && currentContent) {
                      currentContent.innerHTML = newContent.innerHTML;
                      // suppressed debug log
                    } else {
                      // suppressed debug log
                    }
                  }
                }
                isRefreshing = false;
                // suppressed debug log
              })
              .catch((e) => {
                console.error("AJAX refresh failed:", e);
                // Ultimate fallback to cached data
                const currentPage = window.filesPager.readPage();
                window.filesPager.renderPage(currentPage);
                // suppressed debug log
                try {
                  afterRefresh();
                } catch (e) {
                  console.error("Error in afterRefresh:", e);
                }
                isRefreshing = false;
                // suppressed debug log
              });
          }
        } catch (e) {
          console.error("Error in filesPager.renderPage:", e);
        }
        return;
      }
      // suppressed debug log
      try {
        softRefreshFilesTable();
      } catch (e) {
        console.error("Error in softRefreshFilesTable fallback:", e);
      }

      // Ultimate fallback: force AJAX refresh
      // suppressed debug log
      try {
        const url = window.location.pathname + window.location.search;
        fetch(url, {
          method: "GET",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Cache-Control": "no-cache",
          },
        })
          .then((response) => response.text())
          .then((html) => {
            // suppressed debug log
            // Parse and update table
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const newTable = doc.querySelector("#files-table tbody");
            const currentTable = document.querySelector("#files-table tbody");
            if (newTable && currentTable) {
              currentTable.innerHTML = newTable.innerHTML;
              // suppressed debug log
            }
          })
          .catch((e) => console.error("AJAX fallback failed:", e));
      } catch (e) {
        console.error("Error in AJAX fallback:", e);
      }
    } catch (e) {
      console.error("Error in triggerImmediateFilesRefresh:", e);
    } finally {
      isRefreshing = false;
      // suppressed debug log
    }
  }

  // ==== DEV-ONLY START (TODO: remove in production) ==========================
  // Debounced public refresh to avoid storms from sockets/timers
  // TODO: remove in production — force strong refresh during development to defeat caches
  window.softRefreshFilesTable = function () {
    try {
      if (typeof softRefreshFilesTable === "function") {
        softRefreshFilesTable();
        // As a safety, append cache-busting parameter to any AJAX endpoints used by TableManager
        try {
          if (window.tableManager && window.tableManager.refreshEndpoint) {
            window.tableManager.refreshEndpoint +=
              (window.tableManager.refreshEndpoint.indexOf("?") === -1
                ? "?"
                : "&") +
              "t=" +
              Date.now();
          }
        } catch (_) {}
      }
    } catch (_) {}
  };
  // --- PROD: uncomment this version to disable cache-busting in production ---
  // window.softRefreshFilesTable = function() {
  //   try {
  //     if (typeof softRefreshFilesTable === 'function') {
  //       softRefreshFilesTable();
  //     }
  //   } catch(_) {}
  // };
  // ==== DEV-ONLY END =========================================================

  // Debounced scheduler for socket-triggered refreshes with idle guard
  let __filesSocketEventTimer = null;
  function scheduleFilesRefreshFromSocket(evt) {
    try {
      const fromSelf =
        evt &&
        evt.originClientId &&
        window.__filesClientId &&
        evt.originClientId === window.__filesClientId;
      // Treat these reasons as authoritative server/state changes that always warrant a refresh
      const serverReasons = [
        "conversion-complete",
        "processing-complete",
        "server-update",
        "note",
        "edited",
        "recorded",
        "uploaded",
        "init",
        "metadata",
        "added",
      ];
      const isServerReason = !!(
        evt &&
        evt.reason &&
        serverReasons.indexOf(String(evt.reason)) !== -1
      );
      const force = !!(evt && evt.force === true);
      // Always refresh on server reasons (e.g., conversion completed), even for the initiator
      if (fromSelf && !force && !isServerReason) return;
      if (__filesSocketEventTimer) {
        clearTimeout(__filesSocketEventTimer);
        __filesSocketEventTimer = null;
      }
      __filesSocketEventTimer = setTimeout(function () {
        try {
          softRefreshFilesTable();
        } catch (_) {}
      }, 300);
    } catch (_) {}
  }

  // Strong fallback refresh invokes the same logic immediately
  window.forceRefreshFilesTable = function () {
    try {
      softRefreshFilesTable();
    } catch (_) {}
  };

  // After-refresh hook: if there are processing rows, poll a few times
  function afterRefresh() {
    try {
      const table = document.getElementById("maintable");
      if (!table) return;
      const processing = Array.from(
        table.querySelectorAll("tbody tr.table__body_row")
      ).some(function (tr) {
        return (
          tr.getAttribute("data-is-ready") === "0" ||
          Array.from(tr.querySelectorAll("td.table__body_item")).some(function (
            td
          ) {
            const t = (td.innerText || td.textContent || "").toLowerCase();
            return t.indexOf("обрабатывается") !== -1;
          })
        );
      });
      if (processing) {
        // schedule a couple of follow-up refreshes to catch conversion completion
        try {
          if (window.__filesFollowUps == null) window.__filesFollowUps = 0;
        } catch (_) {}
        if (window.__filesFollowUps < 6) {
          // up to ~6 polls
          window.__filesFollowUps++;
          setTimeout(function () {
            try {
              softRefreshFilesTable();
            } catch (_) {}
          }, 5000);
        } else {
          try {
            window.__filesFollowUps = 0;
          } catch (_) {}
        }
      } else {
        try {
          window.__filesFollowUps = 0;
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Periodic refresh while there are rows in processing state
  (function setupProcessingWatcher() {
    // Reuse a single global timer across re-inits
    if (window.__filesProcessingWatcherInit) return;
    window.__filesProcessingWatcherInit = true;
    if (typeof window.__filesProcessTimer === "undefined")
      window.__filesProcessTimer = null;
    function checkAndSchedule() {
      const table = document.getElementById("maintable");
      if (!table) return;
      // Detect processing rows by explicit attribute or fallback by text
      const rows = Array.from(
        table.querySelectorAll("tbody tr.table__body_row")
      );
      const need =
        rows.some((tr) => tr.getAttribute("data-is-ready") === "0") ||
        Array.from(table.querySelectorAll("td.table__body_item")).some(
          (td) =>
            (td.innerText || td.textContent || "").indexOf("Обрабатывается") !==
            -1
        );
      if (window.__filesProcessTimer != null) {
        clearInterval(window.__filesProcessTimer);
        window.__filesProcessTimer = null;
      }
    }
    // Initial and on visibility change
    checkAndSchedule();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (window.__filesProcessTimer != null) {
          try {
            clearInterval(window.__filesProcessTimer);
          } catch (_) {}
          window.__filesProcessTimer = null;
        }
      } else {
        checkAndSchedule();
      }
    });
    // Also re-evaluate after each soft refresh, once
    if (!window.__filesSoftWrapped) {
      window.__filesSoftWrapped = true;
      // disabled
    }
  })();

  // removed debug fallback refresh

  // Global light fallback: periodic refresh every 20s to catch missed socket events
  (function setupLightAutoRefresh() {
    /* disabled */
  })();

  // Cleanup on unload (hard reload, navigation) to avoid leaks across Ctrl+F5
  (function setupFilesCleanup() {
    function cleanupFilesPage() {
      try {
        if (window.__filesLightTimer) {
          clearInterval(window.__filesLightTimer);
          window.__filesLightTimer = null;
        }
      } catch (_) {}
      try {
        if (window.__filesProcessTimer) {
          clearInterval(window.__filesProcessTimer);
          window.__filesProcessTimer = null;
        }
      } catch (_) {}
      try {
        if (
          typeof __filesSocketEventTimer !== "undefined" &&
          __filesSocketEventTimer
        ) {
          clearTimeout(__filesSocketEventTimer);
          __filesSocketEventTimer = null;
        }
      } catch (_) {}
      try {
        if (
          typeof __filesRefreshDebounceTimer !== "undefined" &&
          __filesRefreshDebounceTimer
        ) {
          clearTimeout(__filesRefreshDebounceTimer);
          __filesRefreshDebounceTimer = null;
        }
      } catch (_) {}
      try {
        if (
          window.socket &&
          (window.socket.connected || window.socket.connecting)
        ) {
          try {
            window.socket.off && window.socket.off();
          } catch (_) {}
          try {
            window.socket.disconnect && window.socket.disconnect();
          } catch (_) {}
        }
      } catch (_) {}
    }
    try {
      window.addEventListener("beforeunload", cleanupFilesPage);
    } catch (_) {}
    try {
      window.addEventListener("pagehide", cleanupFilesPage);
    } catch (_) {}
  })();

  // Initial bind for dblclick row open
  function bindRowOpenHandlers() {
    if (!window.__mediaOpenState) {
      window.__mediaOpenState = { opening: false };
    }
    try {
      const table = document.getElementById("maintable");
      if (!table) return;
      // Delegated handler (once) to ensure dblclick works for dynamically inserted rows
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && !tbody._dblDelegateBound) {
        tbody._dblDelegateBound = true;
        tbody.addEventListener("dblclick", function (e) {
          const tr =
            e.target &&
            e.target.closest &&
            e.target.closest("tr.table__body_row");
          if (!tr) return;
          // If a row-level handler exists, let it run. Otherwise, handle here.
          if (!tr._dblBound) {
            try {
              const url = tr.getAttribute("data-url");
              const exists = tr.getAttribute("data-exists");
              if (!url || exists === "0") return;
              const isAudio = (url || "").toLowerCase().endsWith(".m4a");
              if (isAudio) {
                if (window.__mediaOpenState.opening) return;
                window.__mediaOpenState.opening = true;
                const audio = document.getElementById("player-audio");
                if (audio) {
                  try {
                    audio.pause();
                  } catch (e) {}
                  audio.muted = false;
                  audio.volume = 1;
                  audio.src = url;
                  try {
                    audio.currentTime = 0;
                  } catch (e) {}
                  audio.onerror = function () {
                    try {
                      audio.onerror = null;
                      popupClose("popup-audio");
                    } catch (_) {
                    } finally {
                      try {
                        window.__mediaOpenState.opening = false;
                      } catch (_) {}
                    }
                  };
                  audio.onloadeddata = function () {
                    try {
                      window.__mediaOpenState.opening = false;
                    } catch (_) {}
                  };
                }
                popupToggle("popup-audio");
              } else {
                if (window.__mediaOpenState.opening) return;
                window.__mediaOpenState.opening = true;
                const player = document.getElementById("player-video");
                if (player) {
                  try {
                    player.pause();
                  } catch (e) {}
                  player.muted = false;
                  player.volume = 1;
                  player.src = url;
                  try {
                    player.currentTime = 0;
                  } catch (e) {}
                  player.onerror = function () {
                    try {
                      player.onerror = null;
                      popupClose("popup-view");
                    } catch (_) {
                    } finally {
                      try {
                        window.__mediaOpenState.opening = false;
                      } catch (_) {}
                    }
                  };
                  player.onloadeddata = function () {
                    try {
                      window.__mediaOpenState.opening = false;
                    } catch (_) {}
                  };
                }
                popupToggle("popup-view");
              }
            } catch (_) {}
          }
        });
      }
      const rows = table.querySelectorAll("tbody tr.table__body_row");
      rows.forEach((tr) => {
        if (tr._dblBound) return;
        tr._dblBound = true;
        tr.addEventListener("dblclick", function () {
          const url = tr.getAttribute("data-url");
          const exists = tr.getAttribute("data-exists");
          if (!url) return;

          // Don't open missing files
          if (exists === "0") {
            return;
          }

          const isAudio = (url || "").toLowerCase().endsWith(".m4a");
          // Always stop any existing media before opening a new one
          try {
            if (window.stopAllMedia) window.stopAllMedia();
          } catch (_) {}
          if (isAudio) {
            if (window.__mediaOpenState.opening) return;
            window.__mediaOpenState.opening = true;
            const audio = document.getElementById("player-audio");
            if (audio) {
              try {
                audio.pause();
              } catch (e) {}
              audio.muted = false;
              audio.volume = 1;
              audio.src = url;
              try {
                audio.currentTime = 0;
              } catch (e) {}
              // One-time error guard to avoid infinite loops when modal closes
              audio.onerror = function onAudioError() {
                try {
                  audio.onerror = null;
                } catch (_) {}
                const fileId = tr.getAttribute("data-id");
                console.error("Audio load error for file:", fileId);
                if (fileId) {
                  window.markFileAsMissing(fileId);
                }
                const modal = document.getElementById("popup-audio");
                if (modal) {
                  popupClose("popup-audio");
                }
                try {
                  window.__mediaOpenState.opening = false;
                } catch (_) {}
              };
              audio.onloadeddata = function () {
                try {
                  window.__mediaOpenState.opening = false;
                } catch (_) {}
              };
            }
            // Ensure only one media plays: stop video element if open (avoid load() without src)
            try {
              const v = document.getElementById("player-video");
              if (v) {
                try {
                  v.pause && v.pause();
                } catch (_) {}
                try {
                  v.onerror = null;
                } catch (_) {}
                try {
                  v.removeAttribute("src");
                } catch (_) {}
              }
            } catch (_) {}
            popupToggle("popup-audio");
          } else {
            if (window.__mediaOpenState.opening) return;
            window.__mediaOpenState.opening = true;
            const player = document.getElementById("player-video");
            if (player) {
              try {
                player.pause();
              } catch (e) {}
              player.muted = false;
              player.volume = 1;
              player.src = url;
              try {
                player.currentTime = 0;
              } catch (e) {}

              // Add error handler for missing files
              player.onerror = function onVideoError() {
                try {
                  player.onerror = null;
                } catch (_) {}
                const fileId = tr.getAttribute("data-id");
                console.error("Video load error for file:", fileId);
                if (fileId) {
                  window.markFileAsMissing(fileId);
                }
                // Close the player modal
                const modal = document.getElementById("popup-view");
                if (modal) {
                  popupClose("popup-view");
                }
                try {
                  window.__mediaOpenState.opening = false;
                } catch (_) {}
              };
              player.onloadeddata = function () {
                try {
                  window.__mediaOpenState.opening = false;
                } catch (_) {}
              };
            }
            // Ensure only one media plays: stop audio element if open (avoid load() without src)
            try {
              const a = document.getElementById("player-audio");
              if (a) {
                try {
                  a.pause && a.pause();
                } catch (_) {}
                try {
                  a.muted = true;
                  a.volume = 0;
                } catch (_) {}
                try {
                  a.onerror = null;
                } catch (_) {}
                try {
                  a.removeAttribute("src");
                } catch (_) {}
              }
            } catch (_) {}
            popupToggle("popup-view");
          }
        });
      });
    } catch (e) {}
  }
  bindRowOpenHandlers();

  // Change detection for edit, move, and note modals
  (function initFilesChangeDetection() {
    function closeModal(id) {
      try {
        popupClose(id);
      } catch (_) {}
    }

    // Edit: compare name/description
    const editForm = document.getElementById("edit");
    if (editForm && !editForm._changeBound) {
      editForm._changeBound = true;
      const saveBtn = editForm.querySelector("button.btn.btn-primary");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          try {
            const nameNow = (
              editForm.querySelector('input[name="name"]').value || ""
            ).trim();
            const descNow = (
              editForm.querySelector('textarea[name="description"]').value || ""
            ).trim();
            const nameOrig = editForm.dataset.origName || "";
            const descOrig = editForm.dataset.origDesc || "";
            if (nameNow === nameOrig && descNow === descOrig) {
              closeModal("popup-edit");
              return;
            }
          } catch (_) {}
          try {
            window.submitFileFormAjax(editForm);
          } catch (_) {}
        });
      }
    }

    // Move: setup category/subcategory dynamic updates
    const moveForm = document.getElementById("move");
    if (moveForm && !moveForm._changeBound) {
      moveForm._changeBound = true;

      // Setup category change handler to update subcategories
      const rootSel = document.getElementById("move-target-root");
      const subSel = document.getElementById("move-target-sub");

      if (rootSel && subSel) {
        rootSel.addEventListener("change", function () {
          updateMoveSubcategories(rootSel.value, subSel);
        });

        // Initialize subcategories for the first selected category on page load
        if (rootSel.value) {
          updateMoveSubcategories(rootSel.value, subSel);
        }
      }

      moveForm.addEventListener("submit", function (e) {
        try {
          const rootSel = document.getElementById("move-target-root");
          const subSel = document.getElementById("move-target-sub");
          const id = (moveForm.action.match(/\/(\d+)$/) || [])[1];
          const row = id ? document.getElementById(String(id)) : null;
          const currentRoot = row ? row.getAttribute("data-root") : null;
          const currentSub = row ? row.getAttribute("data-sub") : null;
          const targetRoot = rootSel ? rootSel.value : null;
          const targetSub = subSel ? subSel.value : null;
          if (
            currentRoot &&
            currentSub &&
            targetRoot === currentRoot &&
            targetSub === currentSub
          ) {
            e.preventDefault();
            closeModal("popup-move");
          }
          // If moving, perform AJAX submit and reinitialize table after
          e.preventDefault();
          const formData = new FormData(moveForm);
          fetch(moveForm.action, {
            method: "POST",
            body: formData,
            credentials: "include",
          })
            .then((r) => {
              if (!r.ok) throw new Error("HTTP " + r.status);
            })
            .finally(() => {
              try {
                closeModal("popup-move");
              } catch (_) {}
              try {
                softRefreshFilesTable();
              } catch (_) {}
            });
        } catch (_) {}
      });
    }

    // Note: require non-empty and changed text
    const noteForm = document.getElementById("note");
    if (noteForm && !noteForm._changeBound) {
      noteForm._changeBound = true;
      noteForm.addEventListener("submit", function (e) {
        try {
          const ta = noteForm.querySelector('textarea[name="note"]');
          const now = ta && ta.value ? ta.value.trim() : "";
          const orig = noteForm.dataset.origNote || "";
          if (!now || now === orig) {
            e.preventDefault();
            closeModal("popup-note");
          }
        } catch (_) {}
      });
    }
  })();

  // Bind click-to-copy on file name in the first column
  function bindCopyNameHandlers() {
    try {
      const links = document.querySelectorAll(
        "#maintable tbody .files-page__link"
      );
      links.forEach((el) => {
        // Avoid duplicate listeners
        if (el._copyBound) return;
        el._copyBound = true;
        el.style.cursor = "copy";
        el.title = "Клик — скопировать имя";
        el.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const text = (el.textContent || "").trim();
          if (!text) return;
          const onDone = () => {
            // brief visual feedback
            const prev = el.style.transition;
            const prevBg = el.style.backgroundColor;
            el.style.transition = "background-color 0.2s ease";
            el.style.backgroundColor = "rgba(255, 230, 150, 0.9)";
            setTimeout(() => {
              el.style.backgroundColor = prevBg || "";
              el.style.transition = prev || "";
            }, 200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(text)
              .then(onDone)
              .catch(function () {
                // Fallback
                try {
                  const ta = document.createElement("textarea");
                  ta.value = text;
                  ta.setAttribute("readonly", "");
                  ta.style.position = "absolute";
                  ta.style.left = "-9999px";
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  ta.remove();
                  onDone();
                } catch (_) {}
              });
          } else {
            // Legacy fallback
            try {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.setAttribute("readonly", "");
              ta.style.position = "absolute";
              ta.style.left = "-9999px";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              ta.remove();
              onDone();
            } catch (_) {}
          }
        });
      });
    } catch (e) {}
  }
  bindCopyNameHandlers();

  // Player hotkeys while popup-view is open
  document.addEventListener("keydown", function (e) {
    const overlay = document.getElementById("popup-view");
    if (!overlay || !overlay.classList.contains("show")) return;
    const video = document.getElementById("player-video");
    if (!video) return;
    const code = e.code || "";
    const key = (e.key || "").toLowerCase();
    const isF = code === "KeyF" || key === "f" || key === "а"; // RU layout 'ф' is same physical as 'a'; but F key on RU yields 'а'
    const isM = code === "KeyM" || key === "m" || key === "ь";
    if (isF) {
      e.preventDefault();
      try {
        if (!document.fullscreenElement) {
          video.requestFullscreen && video.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      } catch (_) {}
    } else if (isM) {
      e.preventDefault();
      try {
        video.muted = !video.muted;
      } catch (_) {}
    }
  });

  // Initialize unified context menu for files page
  function initFilesContextMenu() {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canAdd = table.getAttribute("data-can-add") === "1";
    const canMarkView = table.getAttribute("data-can-mark-view") === "1";
    const canNotes = table.getAttribute("data-can-notes") === "1";

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: "files",
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes,
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: "files",
            canAdd: canAdd,
            canMarkView: canMarkView,
            canNotes: canNotes,
          });
        }
      }, 100);
    }
  }

  // Initialize when DOM is ready (ensure single init)
  if (!window.__filesCtxMenuInit) {
    window.__filesCtxMenuInit = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initFilesContextMenu, {
        once: true,
      });
    } else {
      initFilesContextMenu();
    }
  }

  // Function to refresh the files page after actions
  window.refreshFilesPage = function () {
    // Use soft refresh instead of page reload
    try {
      if (window.softRefreshFilesTable) {
        window.softRefreshFilesTable();
      } else {
        // Fallback: reload current category/subcategory
        const currentCategory =
          document
            .querySelector(".category-nav .active")
            ?.getAttribute("data-category") || "0";
        const currentSubcategory =
          document
            .querySelector(".subcategory-nav .active")
            ?.getAttribute("data-subcategory") || "1";
        if (window.navigateToCategory) {
          window.navigateToCategory(currentCategory, currentSubcategory);
        }
      }
    } catch (e) {
      console.error("Error refreshing files page:", e);
    }
  };

  /**
   * Navigate to a different category/subcategory via AJAX
   * @param {number} did - Directory (category) ID
   * @param {number} sdid - Subdirectory (subcategory) ID
   * @param {boolean} updateHistory - Whether to update browser history
   */
  window.navigateToCategory = function (did, sdid, updateHistory = true) {
    // Add cache-busting query to avoid stale responses in some proxies/browsers
    const url = `/files/${did}/${sdid}?_=${Date.now()}`;

    fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest", // Indicate AJAX request
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((html) => {
        // Parse the response HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Update category navigation
        const newCatNav = doc.querySelector(".subbar.cat .subbar__group");
        const currentCatNav = document.querySelector(
          ".subbar.cat .subbar__group"
        );
        if (newCatNav && currentCatNav) {
          currentCatNav.innerHTML = newCatNav.innerHTML;
          // Re-attach navigation event listeners
          attachCategoryNavigationListeners();
        }

        // Update subcategory navigation
        const newSubcatNav = doc.querySelector(".subbar.subcat .subbar__group");
        const currentSubcatNav = document.querySelector(
          ".subbar.subcat .subbar__group"
        );
        if (newSubcatNav && currentSubcatNav) {
          currentSubcatNav.innerHTML = newSubcatNav.innerHTML;
          // Re-attach navigation event listeners
          attachSubcategoryNavigationListeners();
        }

        // Update table smoothly
        const newTable = doc.querySelector("#maintable");
        const currentTable = document.querySelector("#maintable");
        if (newTable && currentTable) {
          const newTbody = newTable.querySelector("tbody");
          const currentTbody = currentTable.querySelector("tbody");
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
          const newUrl = `/files/${did}/${sdid}`;
          history.pushState({ did: did, sdid: sdid }, "", newUrl);
        }

        // Update current page state
        window.currentDid = did;
        window.currentSdid = sdid;
      })
      .catch((error) => {
        console.error("Navigation error:", error);
        // Fallback to full page reload
        window.location.href = url;
      });
  };

  /**
   * Attach event listeners to category navigation links
   */
  function attachCategoryNavigationListeners() {
    const categoryLinks = document.querySelectorAll(".subbar.cat .topbtn");
    categoryLinks.forEach((link, index) => {
      // Remove href to prevent default navigation
      link.removeAttribute("href");
      // Add cursor pointer style
      link.style.cursor = "pointer";

      // Add click handler
      if (link._navBound) return;
      link._navBound = true;
      link.addEventListener("click", function (e) {
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
    const subcategoryLinks = document.querySelectorAll(
      ".subbar.subcat .topbtn"
    );
    subcategoryLinks.forEach((link, index) => {
      // Remove href to prevent default navigation
      link.removeAttribute("href");
      // Add cursor pointer style
      link.style.cursor = "pointer";

      // Add click handler
      if (link._navBound) return;
      link._navBound = true;
      link.addEventListener("click", function (e) {
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
    // Prevent frequent reinitializations that can cause timeouts
    const now = Date.now();
    if (
      window._lastContextMenuReinit &&
      now - window._lastContextMenuReinit < 500
    ) {
      return; // Skip if called less than 500ms ago
    }
    window._lastContextMenuReinit = now;

    try {
      // Use requestIdleCallback for non-blocking reinitialization
      if (window.requestIdleCallback) {
        window.requestIdleCallback(
          () => {
            try {
              // Trigger a custom event to reinitialize context menu
              const event = new CustomEvent("context-menu-reinit", {
                detail: { timestamp: Date.now() },
              });
              document.dispatchEvent(event);

              // Also trigger table update event for any other listeners
              document.dispatchEvent(new Event("table-updated"));
            } catch (e) {
              console.error("Context menu reinit failed:", e);
            }
          },
          { timeout: 1000 }
        );
      } else {
        // Fallback: use setTimeout with small delay
        setTimeout(() => {
          try {
            // Trigger a custom event to reinitialize context menu
            const event = new CustomEvent("context-menu-reinit", {
              detail: { timestamp: Date.now() },
            });
            document.dispatchEvent(event);

            // Also trigger table update event for any other listeners
            document.dispatchEvent(new Event("table-updated"));
          } catch (e) {
            console.error("Context menu reinit failed:", e);
          }
        }, 10);
      }
    } catch (e) {
      console.error("Context menu reinit failed:", e);
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
      document.dispatchEvent(new Event("table-updated"));

      // Re-attach double-click handlers for video opening
      bindRowOpenHandlers();

      // Restore missing file banners after navigation
      try {
        const missingRows = document.querySelectorAll('tr[data-exists="0"]');
        missingRows.forEach((row) => {
          const fileId = row.getAttribute("data-id");
          if (fileId) {
            // Use the global function if available, otherwise inline
            if (window.markFileAsMissing) {
              window.markFileAsMissing(fileId);
            } else {
              // Inline banner creation
              const tds = row.querySelectorAll("td");
              const notesTd = tds[tds.length - 1];
              if (notesTd && !notesTd.querySelector(".file-missing-banner")) {
                const banner = document.createElement("div");
                banner.className = "file-missing-banner";
                banner.style.color = "var(--danger, #b00020)";
                banner.style.fontWeight = "600";
                banner.style.marginBottom = "4px";
                banner.textContent = "Файл не найден";
                notesTd.prepend(banner);
              }
            }
          }
        });
      } catch (e) {}

      // Re-attach navigation listeners after content update
      attachCategoryNavigationListeners();
      attachSubcategoryNavigationListeners();

      // Reapply sort (desc by date) and pagination, then restore search
      try {
        sortFilesTableByDateDesc();
      } catch (e) {}
      try {
        initFilesPagination();
      } catch (e) {}
      try {
        const searchKey = "files_search:" + location.pathname + location.search;
        const saved = localStorage.getItem(searchKey) || "";
        if (saved && saved.trim().length > 0) {
          filesDoFilter(saved);
        } else if (
          window.filesPager &&
          typeof window.filesPager.readPage === "function" &&
          typeof window.filesPager.renderPage === "function"
        ) {
          window.filesPager.renderPage(window.filesPager.readPage());
        }
      } catch (e) {}
      // Context menu works via event delegation
    } catch (e) {
      console.error("Error reinitializing table:", e);
    }
  }

  // Initialize navigation on page load
  document.addEventListener("DOMContentLoaded", function () {
    // Get current did/sdid from URL or page data
    const urlParts = window.location.pathname.split("/");
    if (urlParts[1] === "files") {
      window.currentDid = parseInt(urlParts[2]) || 0;
      window.currentSdid = parseInt(urlParts[3]) || 1;
    }

    // Attach navigation listeners
    attachCategoryNavigationListeners();
    attachSubcategoryNavigationListeners();

    // Handle browser back/forward
    window.addEventListener("popstate", function (e) {
      if (e.state && e.state.did !== undefined && e.state.sdid !== undefined) {
        navigateToCategory(e.state.did, e.state.sdid, false);
      }
    });
  });

  // Function to update file row locally without page refresh
  window.updateFileRowLocally = function (fileId, fileData) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`);
      if (!row) return;

      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        // Update name (column 0)
        if (fileData.name !== undefined) {
          const linkSpan = cells[0].querySelector(".files-page__link");
          if (linkSpan) {
            linkSpan.textContent = fileData.name;
          } else {
            const span = document.createElement("span");
            span.className = "files-page__link";
            span.textContent = fileData.name;
            while (cells[0].firstChild)
              cells[0].removeChild(cells[0].firstChild);
            cells[0].appendChild(span);
          }
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
      console.error("Error updating file row locally:", e);
    }
  };

  // Mark a file row as missing on disk: show a non-editable banner and flag the row
  window.markFileAsMissing = function (fileId) {
    try {
      const row =
        document.querySelector(`tr[data-id="${fileId}"]`) ||
        document.getElementById(String(fileId));
      if (!row) return;
      row.setAttribute("data-exists", "0");
      // Insert banner at the top of the notes column (last column)
      const tds = row.querySelectorAll("td");
      const notesTd = tds[tds.length - 1];
      if (!notesTd) return;
      let banner = notesTd.querySelector(".file-missing-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.className = "file-missing-banner";
        banner.style.color = "var(--danger, #b00020)";
        banner.style.fontWeight = "600";
        banner.style.marginBottom = "4px";
        banner.textContent = "Файл не найден";
        notesTd.prepend(banner);
      } else {
        banner.textContent = "Файл не найден";
      }
    } catch (e) {
      /* noop */
    }
  };

  // Clear missing status from a file row
  window.clearFileMissingStatus = function (fileId) {
    try {
      const row =
        document.querySelector(`tr[data-id="${fileId}"]`) ||
        document.getElementById(String(fileId));
      if (!row) return;
      row.setAttribute("data-exists", "1");
      // Remove banner from notes column
      const tds = row.querySelectorAll("td");
      const notesTd = tds[tds.length - 1];
      if (notesTd) {
        const banner = notesTd.querySelector(".file-missing-banner");
        if (banner) {
          banner.remove();
        }
      }
    } catch (e) {
      /* noop */
    }
  };

  // Function to add new file row locally
  window.addFileRowLocally = function (fileData) {
    try {
      const tbody = document.querySelector("table tbody");
      if (!tbody) return;

      const newRow = document.createElement("tr");
      newRow.setAttribute("data-id", fileData.id);
      newRow.innerHTML = `
        <td><span class="files-page__link">${fileData.name || ""}</span></td>
        <td>${fileData.description || ""}</td>
        <td>${fileData.owner || ""}</td>
        <td>${fileData.date || ""}</td>
        <td class="table__body_action">
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-edit" 
                  onclick="popupValues(document.getElementById('edit'), ${
                    fileData.id
                  }); popupToggle('popup-edit');">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-delete" 
                  onclick="popupValues(document.getElementById('delete'), ${
                    fileData.id
                  }); popupToggle('popup-delete');">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      `;

      tbody.appendChild(newRow);

      // Update pagination if needed
      updateFilePaginationCounts();
    } catch (e) {
      console.error("Error adding file row locally:", e);
    }
  };

  // Function to remove file row locally
  window.removeFileRowLocally = function (fileId) {
    try {
      const row = document.querySelector(`tr[data-id="${fileId}"]`);
      if (row) {
        row.remove();
        // Update pagination if needed
        updateFilePaginationCounts();
      }
    } catch (e) {
      console.error("Error removing file row locally:", e);
    }
  };

  // Function to update file pagination counts
  function updateFilePaginationCounts() {
    try {
      const tbody = document.querySelector("table tbody");
      if (!tbody) return;

      const totalRows = tbody.querySelectorAll("tr").length;
      const pageInfo = document.querySelector(".pagination-info");
      if (pageInfo) {
        // Update total count display
        pageInfo.textContent = `Всего записей: ${totalRows}`;
      }
    } catch (e) {
      console.error("Error updating file pagination counts:", e);
    }
  }

  /**
   * Local function removed to avoid recursion - use window.refreshFilesPage directly
   */

  // Local AJAX submit helper (mirrors users.js) to ensure consistent UX
  function submitFormAjaxLocal(form) {
    const formData = new FormData(form);
    const submitBtn = form.querySelector(
      'button[type="submit"], button.btn-primary'
    );
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      try {
        submitBtn.dataset.originalText = originalText;
      } catch (_) {}
      submitBtn.disabled = true;
      submitBtn.textContent = "Отправка...";
    }
    return fetch(form.action, {
      method: "POST",
      body: formData,
      credentials: "include",
      headers: {
        "X-Requested-With": "fetch",
        Accept: "application/json",
        "X-Client-Id": window.__filesClientId || "",
      },
    })
      .then(async (response) => {
        const contentType = response.headers.get("Content-Type") || "";
        let data = null;
        if (contentType.includes("application/json")) {
          try {
            data = await response.json();
          } catch (_) {}
        }
        if (!response.ok || (data && data.status === "error")) {
          const msg =
            (data && (data.message || data.error)) ||
            `Ошибка: HTTP ${response.status}`;
          throw new Error(msg);
        }
        return data;
      })
      .catch((err) => {
        try {
          if (window.showToast)
            window.showToast(
              String((err && err.message) || err || "Ошибка отправки"),
              "error"
            );
        } catch (_) {}
        return Promise.reject(err);
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          const restored =
            submitBtn.dataset && submitBtn.dataset.originalText
              ? submitBtn.dataset.originalText
              : originalText;
          submitBtn.textContent = restored;
        }
      });
  }

  // Function to submit file forms via AJAX
  window.submitFileFormAjax = function (form) {
    // Prevent duplicate submissions
    if (form._submitting) {
      return;
    }
    form._submitting = true;

    // Ensure action URL carries the current rowId before any request
    try {
      const rowId = form && form.dataset ? form.dataset.rowId : "";
      if (rowId && form.action) {
        if (/\/\d+$/.test(form.action)) {
          form.action = form.action.replace(/\/\d+$/, "/" + rowId);
        } else if (/\/0$/.test(form.action)) {
          form.action = form.action.replace(/\/0$/, "/" + rowId);
        }
      }
    } catch (_) {}

    // Prefer local helper (restores button reliably and surfaces errors), fallback to global
    const submitter =
      typeof submitFormAjaxLocal === "function"
        ? submitFormAjaxLocal
        : window.submitFormAjax;
    // Check if there are changes for edit form
    if (form.id === "edit") {
      try {
        const nameInput = form.querySelector('input[name="name"]');
        const origName = form.dataset.origName || "";
        const origDesc = form.dataset.origDesc || "";
        const descInput = form.querySelector('textarea[name="description"]');
        const nowName = nameInput
          ? (nameInput.value || "").replace(/\u00a0/g, " ").trim()
          : "";
        const nowDesc = descInput ? (descInput.value || "").trim() : "";
        if (nowName === origName && nowDesc === origDesc) {
          // No changes, just close modal without refreshing table
          const modal = form.closest(".overlay-container");
          if (modal) {
            const modalId = modal.id;
            try {
              popupClose(modalId);
            } catch (e) {}
          }
          return;
        }
      } catch (e) {}
    }

    submitter(form)
      .then(() => {
        // Close modal first
        const modal = form.closest(".overlay-container");
        if (modal) {
          const modalId = modal.id;
          try {
            popupClose(modalId);
          } catch (e) {
            console.error("Error closing modal:", e);
          }
        } else {
          // silent if modal not found
        }

        // Update table locally instead of full page refresh for some actions
        try {
          if (form.id === "edit") {
            // Чтобы не мигали серверные бейджи (например, «Видео»), вместо локального патча — мягкое обновление таблицы
            if (window.softRefreshFilesTable) {
              window.softRefreshFilesTable();
            }
          } else if (form.id === "note") {
            // Avoid local DOM update to prevent mismatches; trigger immediate refresh
            try {
              if (typeof triggerImmediateFilesRefresh === "function")
                triggerImmediateFilesRefresh();
            } catch (_) {}
            // Extra: follow up with soft refresh for initiating tab repaint
            try {
              if (typeof softRefreshFilesTable === "function")
                softRefreshFilesTable();
            } catch (_) {}
          } else if (form.id === "delete") {
            // File delete - remove row locally
            const fileId = form.action.match(/\/(\d+)$/)?.[1];
            if (fileId) {
              removeFileRowLocally(fileId);
            } else {
              if (window.softRefreshFilesTable) {
                window.softRefreshFilesTable();
              }
            }
          } else if (form.id === "move") {
            // After move, soft refresh current category/subcategory
            if (window.softRefreshFilesTable) {
              window.softRefreshFilesTable();
            }
          } else {
            // Other forms - soft refresh
            if (window.softRefreshFilesTable) {
              window.softRefreshFilesTable();
            }
          }
        } catch (e) {
          console.error("Error updating table locally:", e);
          if (window.softRefreshFilesTable) {
            window.softRefreshFilesTable();
          }
        }

        // Emit socket event for other users
        try {
          if (window.socket && window.socket.emit) {
            const fileId =
              form.dataset.rowId || form.action.match(/\/(\d+)$/)?.[1];
            const reason =
              form.id === "edit"
                ? "edited"
                : form.id === "note"
                ? "note"
                : "form-submit";
            const payload = {
              reason: reason,
              originClientId: window.__filesClientId,
            };
            if (fileId) payload.id = fileId;
            // Server emits files:changed; no client-side emit
          }
        } catch (e) {
          console.error("Error emitting files:changed from client:", e);
        }
      })
      .catch((err) => {
        // Keep modal open to allow user to fix inputs; ensure no local updates applied
        try {
          if (window.showToast)
            window.showToast(
              String((err && err.message) || "Ошибка отправки"),
              "error"
            );
        } catch (_) {}
      })
      .finally(() => {
        // Reset submission flag
        form._submitting = false;
      });
  };

  // Initialize context menu for files page
  function initFilesContextMenu() {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canAdd = table.getAttribute("data-can-add") === "1";
    const canMarkView = table.getAttribute("data-can-mark-view") === "1";
    const canNotes = table.getAttribute("data-can-notes") === "1";

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: "files",
        canAdd: canAdd,
        canMarkView: canMarkView,
        canNotes: canNotes,
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: "files",
            canAdd: canAdd,
            canMarkView: canMarkView,
            canNotes: canNotes,
          });
        }
      }, 100);
    }
  }

  // Initialize when DOM is ready (ensure single init)
  if (!window.__filesCtxMenuInit2) {
    window.__filesCtxMenuInit2 = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initFilesContextMenu, {
        once: true,
      });
    } else {
      initFilesContextMenu();
    }
  }
});

// Mark viewed via AJAX and update row locally without full reload
window.markViewedAjax = function (fileId) {
  try {
    if (!fileId) return;
    const row =
      document.querySelector(`tr[data-id="${fileId}"]`) ||
      document.getElementById(String(fileId));
    const markUrl =
      row && row.getAttribute("data-view-url")
        ? row.getAttribute("data-view-url")
        : `${window.location.origin}${
            window.location.pathname
          }/view/${fileId}/${
            document
              .querySelector("#maintable")
              ?.getAttribute("data-category") || "0"
          }/${
            document
              .querySelector("#maintable")
              ?.getAttribute("data-subcategory") || "1"
          }`;
    fetch(markUrl, {
      method: "GET",
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "X-Client-Id": window.__filesClientId || "",
      },
    })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
      })
      .then(() => {
        // Update row attributes and visuals
        if (row) {
          row.setAttribute("data-already-viewed", "1");
          row.setAttribute("data-viewed", "1");
          // Update viewers text by appending current user
          try {
            const currentUser =
              document
                .getElementById("maintable")
                ?.getAttribute("data-current-user") || "";
            const viewersSpan = row.querySelector(".file-viewers span");
            if (viewersSpan) {
              const prev = (viewersSpan.textContent || "").trim();
              if (!prev || prev === "—") {
                viewersSpan.textContent = currentUser || prev;
              } else if (currentUser && prev.indexOf(currentUser) === -1) {
                viewersSpan.textContent = prev + ", " + currentUser;
              }
            }
          } catch (_) {}
          // Recompute others-viewed flag: if there is any viewer other than current user
          try {
            const viewersSpan = row.querySelector(".file-viewers span");
            const currentUser =
              document
                .getElementById("maintable")
                ?.getAttribute("data-current-user") || "";
            const txt = ((viewersSpan && viewersSpan.textContent) || "").trim();
            if (txt) {
              const names = txt
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const others = names.filter((n) => n && n !== currentUser);
              row.setAttribute(
                "data-others-viewed",
                others.length > 0 ? "1" : "0"
              );
            } else {
              row.setAttribute("data-others-viewed", "0");
            }
          } catch (_) {}
          // Remove the "Отметить просмотренным" link
          try {
            const tds = row.querySelectorAll("td");
            const notesTd = tds[tds.length - 1];
            const link = notesTd && notesTd.querySelector("span");
            if (
              link &&
              link.textContent &&
              link.textContent.indexOf("Отметить просмотренным") !== -1
            ) {
              link.remove();
            }
          } catch (_) {}
        }
        // Server emits files:changed; no client-side emit
        try {
          window.softRefreshFilesTable && window.softRefreshFilesTable();
        } catch (_) {}
      })
      .catch((e) => {
        console.error("Mark viewed error:", e);
      });
  } catch (e) {
    console.error("Mark viewed error:", e);
  }
};

(function () {
  try {
    if (window.SyncManager && typeof window.SyncManager.on === "function") {
      // React to files updates via SyncManager (debounced)
      try {
        if (!window.__filesSyncBound) {
          window.__filesSyncBound = true;
          console.debug("[files] binding SyncManager handlers");
          window.SyncManager.on("files:changed", function (evt) {
            try {
              if (window.__syncDebug) {
                console.debug("[files-sync-recv] files:changed", evt);
              }
              const fromSelf = !!(
                evt &&
                evt.originClientId &&
                window.__filesClientId &&
                evt.originClientId === window.__filesClientId
              );
              const serverReasons = [
                "conversion-complete",
                "processing-complete",
                "server-update",
                "note",
                "edited",
                "deleted",
                "uploaded",
                "init",
                "metadata",
                "recorded",
              ];
              const isServerReason = !!(
                evt &&
                evt.reason &&
                serverReasons.indexOf(String(evt.reason)) !== -1
              );
              if (fromSelf && !isServerReason) {
                if (window.__syncDebug) {
                  console.debug("[files-sync-ignore-self] files:changed", evt);
                }
                return;
              }
              if (document.hidden) {
                window.__filesHadBackgroundEvent = true;
                triggerImmediateFilesRefresh();
              } else {
                triggerImmediateFilesRefresh();
                scheduleFilesRefreshFromSocket(
                  evt || { reason: "server-update" }
                );
              }
            } catch (_) {}
          });
        }
      } catch (_) {}
      window.SyncManager.on("categories:changed", function (evt) {
        try {
          var did =
            (document.querySelector("#maintable") &&
              document
                .querySelector("#maintable")
                .getAttribute("data-category")) ||
            "0";
          var sdid =
            (document.querySelector("#maintable") &&
              document
                .querySelector("#maintable")
                .getAttribute("data-subcategory")) ||
            "1";
          if (window.navigateToCategory) {
            window.navigateToCategory(did, sdid, false);
            setTimeout(function () {
              try {
                window.navigateToCategory(did, sdid, false);
              } catch (_) {}
            }, 400);
          }
        } catch (_) {}
      });
      window.SyncManager.on("subcategories:changed", function (evt) {
        try {
          var did =
            (document.querySelector("#maintable") &&
              document
                .querySelector("#maintable")
                .getAttribute("data-category")) ||
            "0";
          var sdid =
            (document.querySelector("#maintable") &&
              document
                .querySelector("#maintable")
                .getAttribute("data-subcategory")) ||
            "1";
          if (window.navigateToCategory) {
            window.navigateToCategory(did, sdid, false);
            setTimeout(function () {
              try {
                window.navigateToCategory(did, sdid, false);
              } catch (_) {}
            }, 400);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
})();

(function () {
  if (typeof window.submitRegistratorImport === "function") return;
  window.submitRegistratorImport = function () {
    try {
      var ridEl = document.getElementById("reg-picker");
      var rid = ridEl && ridEl.value ? parseInt(ridEl.value, 10) : 0;
      var parentEl = document.getElementById("reg-parent");
      var filesEl = document.getElementById("reg-files");
      if (!rid) {
        if (window.appNotify) window.appNotify("Выберите регистратор");
        return;
      }
      var did =
        typeof window.currentDid !== "undefined" && window.currentDid != null
          ? parseInt(window.currentDid, 10)
          : 0;
      var sdid =
        typeof window.currentSdid !== "undefined" && window.currentSdid != null
          ? parseInt(window.currentSdid, 10)
          : 0;
      if (!did || !sdid) {
        if (window.appNotify)
          window.appNotify("Не выбрана категория/подкатегория");
        return;
      }
      var baseParts = { date: "", user: "", time: "", type: "" };
      var parent = parentEl && parentEl.value ? String(parentEl.value) : "";
      if (parent) {
        var pp = parent.split("/");
        var keys = ["date", "user", "time", "type"];
        for (var i = 0; i < pp.length && i < keys.length; i++)
          baseParts[keys[i]] = pp[i];
      }
      var files = Array.from(
        (
          document.getElementById("reg-file-list") || document.body
        ).querySelectorAll('input[type="checkbox"]:checked')
      ).map(function (b) {
        return b.value;
      });
      if (!files.length) {
        if (window.appNotify) window.appNotify("Выберите хотя бы один файл");
        return;
      }
      var payload = {
        category_id: did,
        subcategory_id: sdid,
        base_parts: baseParts,
        files: files,
      };
      var url = "/registrators/" + encodeURIComponent(rid) + "/import";
      var doNotify = function (ok, msg) {
        if (window.appNotify)
          window.appNotify(ok ? "Импорт начат" : msg || "Ошибка импорта");
      };
      if (typeof window.postJson === "function") {
        window
          .postJson(url, payload)
          .then(function (j) {
            doNotify(j && j.status === "success", j && j.message);
            if (
              j &&
              j.status === "success" &&
              typeof window.popupToggle === "function"
            )
              window.popupToggle("popup-import-registrator");
          })
          .catch(function () {
            doNotify(false);
          });
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            doNotify(j && j.status === "success", j && j.message);
            if (
              j &&
              j.status === "success" &&
              typeof window.popupToggle === "function"
            )
              window.popupToggle("popup-import-registrator");
          })
          .catch(function () {
            doNotify(false);
          });
      }
    } catch (e) {
      try {
        if (window.appNotify) window.appNotify("Ошибка импорта");
      } catch (_) {}
    }
  };
})();

(function () {
  // Registrar modal helper: preload registrators, browse, enforce max files
  if (window.__registratorInit) return;
  window.__registratorInit = true;
  function q(id) {
    return document.getElementById(id);
  }
  function getDidSdid() {
    var did =
      (document.querySelector("#maintable") &&
        document.querySelector("#maintable").getAttribute("data-category")) ||
      (typeof window.currentDid !== "undefined"
        ? String(window.currentDid)
        : "0");
    var sdid =
      (document.querySelector("#maintable") &&
        document
          .querySelector("#maintable")
          .getAttribute("data-subcategory")) ||
      (typeof window.currentSdid !== "undefined"
        ? String(window.currentSdid)
        : "0");
    return {
      did: parseInt(did || "0", 10) || 0,
      sdid: parseInt(sdid || "0", 10) || 0,
    };
  }
  function ensureMaxFilesLimit() {
    var maxHidden = document.getElementById("max-upload-files");
    var maxFiles = 5;
    try {
      maxFiles =
        parseInt(maxHidden && maxHidden.value ? maxHidden.value : "5", 10) || 5;
    } catch (_) {}
    var span = document.getElementById("reg-max-files");
    if (span) span.textContent = String(maxFiles);
    return maxFiles;
  }
  function enforceSelectionLimit() {
    var maxFiles = ensureMaxFilesLimit();
    var list = q("reg-file-list");
    if (!list) return;
    var boxes = list.querySelectorAll('input[type="checkbox"]');
    var checked = Array.from(boxes).filter(function (b) {
      return b.checked;
    });
    if (checked.length > maxFiles) {
      // Uncheck the last toggled one
      var last = checked[checked.length - 1];
      last.checked = false;
      if (window.showToast)
        window.showToast(
          "Можно выбрать максимум " + maxFiles + " файлов",
          "error"
        );
    }
  }
  function fillSelect(selectEl, names) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— выберите —";
    selectEl.appendChild(ph);
    (names || []).forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
  }
  function renderFiles(entries) {
    var wrap = q("reg-file-list");
    if (!wrap) return;
    wrap.innerHTML = "";
    var allowed = ensureMaxFilesLimit();
    (entries || []).forEach(function (e, idx) {
      if (!e || !e.name) return;
      var row = document.createElement("label");
      row.className = "d-flex align-items-center gap-2";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = e.name;
      cb.addEventListener("change", enforceSelectionLimit);
      if (idx < allowed) cb.checked = true; // preselect up to allowed
      var span = document.createElement("span");
      span.textContent = e.name;
      row.appendChild(cb);
      row.appendChild(span);
      wrap.appendChild(row);
    });
    // Mirror to textarea
    syncCheckedToTextarea();
  }
  function syncCheckedToTextarea() {
    /* removed manual textarea sync */
  }
  // Build base host/path from selected registrator url_template, up to first '{'
  function getBaseFromTemplate() {
    var sel = q("reg-picker");
    if (!sel) return "";
    var opt = sel.options && sel.options[sel.selectedIndex];
    var tpl = (opt && opt.getAttribute("data-template")) || "";
    if (!tpl) return "";
    try {
      var noScheme = tpl.replace(/^https?:\/\//i, "");
      var i1 = noScheme.indexOf("{");
      var i2 = noScheme.indexOf("<");
      var cutIdx = -1;
      if (i1 !== -1 && i2 !== -1) cutIdx = Math.min(i1, i2);
      else if (i1 !== -1) cutIdx = i1;
      else if (i2 !== -1) cutIdx = i2;
      var base = cutIdx !== -1 ? noScheme.slice(0, cutIdx) : noScheme;
      // ensure ends with '/'
      if (base[base.length - 1] !== "/") base += "/";
      return base;
    } catch (_) {
      return "";
    }
  }
  // Progressive browse via /proxy: fetch anchor texts from remote HTML through proxy
  function browse(level) {
    var base = getBaseFromTemplate();
    if (!base) return;
    var parent = (q("reg-parent") && q("reg-parent").value) || "";
    // Compose full path and convert slashes to '!'
    var full = base + (parent ? parent.replace(/^\/+|\/+$/g, "") + "/" : "");
    var prox = "/proxy/" + encodeURIComponent(full.replace(/\//g, "!"));
    fetch(prox, { headers: { Accept: "text/plain" } })
      .then(function (r) {
        return r.text();
      })
      .then(function (txt) {
        var names = (txt || "")
          .split("|")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        // Heuristic: if items look like filenames (contain a dot and not end with '/') -> render files
        var isFiles = names.some(function (n) {
          return /\.[a-z0-9]{2,5}$/i.test(n);
        });
        if (isFiles) {
          renderFiles(
            names.map(function (n) {
              return { name: n };
            })
          );
          // Set level to 'file' for UI consistency
          try {
            if (q("reg-level")) q("reg-level").value = "file";
          } catch (_) {}
        } else {
          // Determine which select to fill next based on already chosen parts
          var parentVal = (q("reg-parent") && q("reg-parent").value) || "";
          var parts = parentVal.split("/").filter(Boolean);
          var order = ["date", "user", "time", "type"];
          var nextIdx = Math.min(parts.length, order.length - 1);
          var nextId = "reg-opt-" + order[nextIdx];
          fillSelect(q(nextId), names);
        }
      })
      .catch(function () {
        /* ignore */
      });
  }
  function loadRegistrators() {
    var sel = q("reg-picker");
    if (!sel) return;
    fetch("/api/registrators", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var items = (j && j.items) || [];
        sel.innerHTML = "";
        // Placeholder empty option first
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "— Выберите регистратор —";
        placeholder.selected = true;
        placeholder.disabled = true;
        sel.appendChild(placeholder);

        items.forEach(function (it) {
          if (!it || !it.enabled) return;
          var opt = document.createElement("option");
          opt.value = String(it.id);
          opt.textContent = it.name;
          opt.setAttribute("data-template", it.url_template || "");
          sel.appendChild(opt);
        });
        // Clear param labels and hide all param wraps initially
        try {
          [1, 2, 3, 4, 5].forEach(function (i) {
            var wrap = q("reg-param-" + i + "-wrap");
            var lab = q("reg-param-" + i + "-label");
            var selp = q("reg-param-" + i);
            if (wrap) wrap.classList.add("d-none");
            if (lab) lab.textContent = "—";
            if (selp) selp.innerHTML = "";
          });
          // Make sure first param stays hidden until registrator is explicitly chosen
          var p1wrap = q("reg-param-1-wrap");
          if (p1wrap) p1wrap.classList.add("d-none");
        } catch (_) {}
      })
      .catch(function () {
        /* ignore */
      });
  }
  // Global helper function for ensuring placeholder options
  function ensurePlaceholder(selectEl, labelText) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = labelText
      ? "— Выберите " + labelText + " —"
      : "— Выберите —";
    opt.selected = true;
    opt.disabled = true;
    selectEl.appendChild(opt);
  }

  // Wire interactions when modal opens
  function onOpen() {
    ensureMaxFilesLimit();
    loadRegistrators();
    // Initialize import button as disabled
    updateImportButton();
  }
  // Expose to open button
  if (!window.openRegistratorImport) {
    window.openRegistratorImport = function () {
      try {
        onOpen();
      } catch (_) {}
      if (window.popupToggle) window.popupToggle("popup-import-registrator");
    };
  }
  // Handlers
  try {
    q("reg-picker").addEventListener("change", function () {
      // When registrator changes, parse its template and set param labels
      var sel = q("reg-picker");
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      var tpl = (opt && opt.getAttribute("data-template")) || "";
      // Extract placeholders like {date}, {user}, <date>, <user>, etc.
      var names = [];
      // Safer, do two passes
      try {
        (tpl.match(/\{\s*([a-zA-Z0-9_\-]+)\s*\}/g) || []).forEach(function (m) {
          var n = m.replace(/^[^{]*\{\s*|\s*\}[^}]*$/g, "");
          if (n && names.indexOf(n) === -1) names.push(n);
        });
        (tpl.match(/<\s*([a-zA-Z0-9_\-]+)\s*>/g) || []).forEach(function (m) {
          var n = m.replace(/^[^<]*<\s*|\s*>[^>]*$/g, "");
          if (n && names.indexOf(n) === -1) names.push(n);
        });
      } catch (_) {}
      // Map known placeholders to RU labels
      function toRuLabel(n) {
        var k = String(n || "").toLowerCase();
        if (k === "date") return "Дата";
        if (k === "user") return "Пользователь";
        if (k === "time") return "Время";
        if (k === "type") return "Тип";
        return n || "—";
      }
      function hideFrom(index) {
        [index, index + 1, index + 2, index + 3, index + 4].forEach(function (
          i
        ) {
          if (i < 1 || i > 5) return;
          var wrap = q("reg-param-" + i + "-wrap");
          var lab = q("reg-param-" + i + "-label");
          var selp = q("reg-param-" + i);
          if (wrap) wrap.classList.add("d-none");
          if (selp)
            ensurePlaceholder(
              selp,
              lab && lab.textContent !== "—" ? lab.textContent : ""
            );
        });
      }
      // Update labels in order of appearance; show only the FIRST param initially
      [1, 2, 3, 4, 5].forEach(function (i) {
        var wrap = q("reg-param-" + i + "-wrap");
        var lab = q("reg-param-" + i + "-label");
        var selp = q("reg-param-" + i);
        if (!wrap || !lab || !selp) return;
        if (names[i - 1]) {
          lab.textContent = toRuLabel(names[i - 1]);
          console.log("[DEBUG] Set param", i, "label to:", lab.textContent);
          // only the first param should be visible right after choosing registrator
          if (i === 1) wrap.classList.remove("d-none");
          else wrap.classList.add("d-none");
          ensurePlaceholder(selp, lab.textContent);
        } else {
          wrap.classList.add("d-none");
          lab.textContent = "—";
          ensurePlaceholder(selp, "");
        }
      });
      // After changing registrator, ensure deeper params are hidden beyond the first
      hideFrom(2);

      // Populate the FIRST param options from the base URL via proxy
      try {
        var base = getBaseFromTemplate();
        var firstWrap = q("reg-param-1-wrap");
        var firstSel = q("reg-param-1");
        var firstLab = q("reg-param-1-label");
        if (base && firstWrap && firstSel && firstLab) {
          var prox =
            "/proxy/" +
            encodeURIComponent(base.replace(/\/+$/g, "/").replace(/\//g, "!"));
          console.log("[DEBUG] Base URL:", base);
          console.log("[DEBUG] Proxy URL:", prox);
          // Reset to placeholder before fetch
          ensurePlaceholder(
            firstSel,
            firstLab.textContent && firstLab.textContent !== "—"
              ? firstLab.textContent
              : ""
          );
          fetch(prox, {
            headers: {
              Accept: "text/plain",
              "X-Registrator-Import": "1", // Special header to identify registrator import requests
            },
          })
            .then(function (r) {
              return r.text();
            })
            .then(function (txt) {
              console.log("[DEBUG] Proxy response:", txt);
              var names = (txt || "")
                .split("|")
                .map(function (s) {
                  return s.trim();
                })
                .filter(Boolean);
              console.log("[DEBUG] Parsed names:", names);
              // Keep placeholder, then append options
              names.forEach(function (n) {
                var optEl = document.createElement("option");
                optEl.value = n;
                optEl.textContent = n;
                firstSel.appendChild(optEl);
              });
              // Show only the first parameter select
              firstWrap.classList.remove("d-none");
            })
            .catch(function () {
              /* ignore */
            });
        }
      } catch (_) {}
    });
  } catch (_) {}
  function wireParamChain() {
    function onParamChange(i) {
      var sel = q("reg-param-" + i);
      if (!sel) return;
      sel.addEventListener("change", function () {
        var val = sel.value || "";
        console.log("[DEBUG] Param", i, "changed to:", val);
        // Hide all following selects and reset them to placeholder
        for (var j = i + 1; j <= 5; j++) {
          var wrapJ = q("reg-param-" + j + "-wrap");
          var labJ = q("reg-param-" + j + "-label");
          var selJ = q("reg-param-" + j);
          if (wrapJ) wrapJ.classList.add("d-none");
          if (selJ)
            ensurePlaceholder(
              selJ,
              labJ && labJ.textContent !== "—" ? labJ.textContent : ""
            );
        }
        // If current has value and next label exists, show next with placeholder
        var nextIdx = i + 1;
        var nextWrap = q("reg-param-" + nextIdx + "-wrap");
        var nextLab = q("reg-param-" + nextIdx + "-label");
        var nextSel = q("reg-param-" + nextIdx);
        console.log("[DEBUG] Next param", nextIdx, "elements:", {
          wrap: !!nextWrap,
          lab: !!nextLab,
          sel: !!nextSel,
          labText: nextLab ? nextLab.textContent : "no lab",
        });
        if (
          val &&
          nextWrap &&
          nextLab &&
          nextSel &&
          nextLab.textContent &&
          nextLab.textContent !== "—"
        ) {
          console.log("[DEBUG] Showing next param", nextIdx);

          // Check if this is the last parameter (should show files)
          if (nextIdx >= 5) {
            // This is the last parameter - show files
            nextLab.textContent = "Файлы";
            ensurePlaceholder(nextSel, "Файлы");
            nextWrap.classList.remove("d-none");
            // Fetch files for the last parameter
            fetchNextParamOptions(i, val, nextSel);
          } else {
            ensurePlaceholder(nextSel, nextLab.textContent);
            nextWrap.classList.remove("d-none");
            // Fetch options for the next parameter
            fetchNextParamOptions(i, val, nextSel);
          }
        } else {
          console.log("[DEBUG] Not showing next param", nextIdx, "because:", {
            hasVal: !!val,
            hasWrap: !!nextWrap,
            hasLab: !!nextLab,
            hasSel: !!nextSel,
            labText: nextLab ? nextLab.textContent : "no lab",
            labNotDash: nextLab ? nextLab.textContent !== "—" : false,
          });
        }
      });
    }
    [1, 2, 3, 4, 5].forEach(onParamChange);
  }

  function fetchNextParamOptions(paramIndex, selectedValue, nextSelect) {
    try {
      var sel = q("reg-picker");
      if (!sel) return;
      var opt = sel.options && sel.options[sel.selectedIndex];
      var tpl = (opt && opt.getAttribute("data-template")) || "";
      if (!tpl) return;

      // Get all selected values from previous parameters
      var selectedValues = [];
      for (var i = 1; i <= paramIndex; i++) {
        var paramSel = q("reg-param-" + i);
        if (paramSel && paramSel.value) {
          selectedValues.push(paramSel.value);
        }
      }

      // Extract placeholders from template
      var names = [];
      try {
        (tpl.match(/\{\s*([a-zA-Z0-9_\-]+)\s*\}/g) || []).forEach(function (m) {
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
      for (var j = 0; j < Math.min(selectedValues.length, names.length); j++) {
        var placeholder = "{" + names[j] + "}";
        var altPlaceholder = "<" + names[j] + ">";
        url = url.replace(placeholder, selectedValues[j]);
        url = url.replace(altPlaceholder, selectedValues[j]);
      }

      // Cut URL at the next placeholder
      var nextPlaceholderIdx = -1;
      for (var k = selectedValues.length; k < names.length; k++) {
        var nextPlaceholder = "{" + names[k] + "}";
        var altNextPlaceholder = "<" + names[k] + ">";
        var idx1 = url.indexOf(nextPlaceholder);
        var idx2 = url.indexOf(altNextPlaceholder);
        if (idx1 !== -1) nextPlaceholderIdx = idx1;
        if (
          idx2 !== -1 &&
          (nextPlaceholderIdx === -1 || idx2 < nextPlaceholderIdx)
        ) {
          nextPlaceholderIdx = idx2;
        }
        if (nextPlaceholderIdx !== -1) break;
      }

      if (nextPlaceholderIdx !== -1) {
        url = url.slice(0, nextPlaceholderIdx);
      }

      // Remove scheme and ensure URL ends with '/'
      url = url.replace(/^https?:\/\//i, "");
      if (url[url.length - 1] !== "/") url += "/";

      console.log("[DEBUG] Next param URL:", url);

      // Fetch via proxy
      var prox = "/proxy/" + encodeURIComponent(url.replace(/\//g, "!"));
      console.log("[DEBUG] Next param proxy URL:", prox);

      fetch(prox, {
        headers: {
          Accept: "text/plain",
          "X-Registrator-Import": "1", // Special header to identify registrator import requests
        },
      })
        .then(function (r) {
          return r.text();
        })
        .then(function (txt) {
          console.log("[DEBUG] Next param response:", txt);
          var names = (txt || "")
            .split("|")
            .map(function (s) {
              return s.trim();
            })
            .filter(Boolean);
          console.log("[DEBUG] Next param parsed names:", names);

          // Check if this is the last parameter and items look like files
          var isLastParam = paramIndex + 1 >= 5; // Assuming max 5 params
          var isFiles = names.some(function (n) {
            return /\.[a-z0-9]{2,5}$/i.test(n);
          });

          if (isLastParam || isFiles) {
            // This is the files level - show file list with checkboxes
            showFileList(names, nextSelect);
          } else {
            // Keep placeholder, then append options
            names.forEach(function (n) {
              var optEl = document.createElement("option");
              optEl.value = n;
              optEl.textContent = n;
              nextSelect.appendChild(optEl);
            });
          }
        })
        .catch(function (err) {
          console.log("[DEBUG] Next param fetch error:", err);
        });
    } catch (err) {
      console.log("[DEBUG] Next param error:", err);
    }
  }

  function showFileList(fileNames, nextSelect) {
    try {
      // Hide the select and show file list instead
      var nextWrap = nextSelect.closest(".d-none")
        ? nextSelect.parentElement
        : nextSelect.parentElement;
      if (nextWrap) {
        nextWrap.classList.remove("d-none");

        // Change label to "Файлы"
        var label = nextWrap.querySelector("label");
        if (label) {
          label.textContent = "Файлы";
        }

        // Hide the select
        nextSelect.style.display = "none";

        // Create file list container if it doesn't exist
        var fileListId =
          "reg-file-list-" + nextSelect.id.replace("reg-param-", "");
        var fileListContainer = document.getElementById(fileListId);
        if (!fileListContainer) {
          fileListContainer = document.createElement("div");
          fileListContainer.id = fileListId;
          fileListContainer.className = "reg-file-list";
          fileListContainer.style.maxHeight = "200px";
          fileListContainer.style.overflowY = "auto";
          fileListContainer.style.border = "1px solid #ccc";
          fileListContainer.style.padding = "8px";
          fileListContainer.style.marginTop = "4px";
          nextWrap.appendChild(fileListContainer);
        }

        // Clear and populate file list
        fileListContainer.innerHTML = "";

        // Add instruction text
        var instructionDiv = document.createElement("div");
        instructionDiv.className = "mb-2 text-muted small";
        instructionDiv.textContent =
          "Отметьте файлы для загрузки (макс. " +
          (window.maxFilesLimit || 5) +
          ").";
        fileListContainer.appendChild(instructionDiv);

        fileNames.forEach(function (fileName) {
          var checkboxDiv = document.createElement("div");
          checkboxDiv.className = "form-check";

          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "form-check-input reg-file-checkbox";
          checkbox.value = fileName;
          checkbox.id = "file-" + fileName.replace(/[^a-zA-Z0-9]/g, "-");

          var label = document.createElement("label");
          label.className = "form-check-label";
          label.htmlFor = checkbox.id;
          label.textContent = fileName;

          checkboxDiv.appendChild(checkbox);
          checkboxDiv.appendChild(label);
          fileListContainer.appendChild(checkboxDiv);
        });

        // Add change listeners to checkboxes for limit enforcement
        var checkboxes =
          fileListContainer.querySelectorAll(".reg-file-checkbox");
        checkboxes.forEach(function (checkbox) {
          checkbox.addEventListener("change", function () {
            enforceFileLimit();
            updateImportButton();
          });
        });

        console.log("[DEBUG] Showed file list with", fileNames.length, "files");
      }
    } catch (err) {
      console.log("[DEBUG] Error showing file list:", err);
    }
  }

  function enforceFileLimit() {
    try {
      var maxFiles = window.maxFilesLimit || 5;
      var checkedBoxes = document.querySelectorAll(
        ".reg-file-checkbox:checked"
      );

      if (checkedBoxes.length >= maxFiles) {
        // Disable unchecked boxes
        var uncheckedBoxes = document.querySelectorAll(
          ".reg-file-checkbox:not(:checked)"
        );
        uncheckedBoxes.forEach(function (checkbox) {
          checkbox.disabled = true;
        });
      } else {
        // Enable all boxes
        var allBoxes = document.querySelectorAll(".reg-file-checkbox");
        allBoxes.forEach(function (checkbox) {
          checkbox.disabled = false;
        });
      }
    } catch (err) {
      console.log("[DEBUG] Error enforcing file limit:", err);
    }
  }

  function updateImportButton() {
    try {
      var checkedBoxes = document.querySelectorAll(
        ".reg-file-checkbox:checked"
      );
      var importButton = document.querySelector(
        'button[onclick*="submitRegistratorImport"]'
      );

      if (importButton) {
        if (checkedBoxes.length > 0) {
          importButton.disabled = false;
          importButton.classList.remove("btn-secondary");
          importButton.classList.add("btn-primary");
        } else {
          importButton.disabled = true;
          importButton.classList.remove("btn-primary");
          importButton.classList.add("btn-secondary");
        }
      }
    } catch (err) {
      console.log("[DEBUG] Error updating import button:", err);
    }
  }

  // Submit selected files for import
  window.submitRegistratorImport = function () {
    try {
      var checkedBoxes = document.querySelectorAll(
        ".reg-file-checkbox:checked"
      );
      if (checkedBoxes.length === 0) {
        alert("Выберите хотя бы один файл для загрузки");
        return;
      }

      var selectedFiles = Array.from(checkedBoxes).map(function (cb) {
        return cb.value;
      });

      // Get registrator info
      var sel = q("reg-picker");
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      var registratorName = opt ? opt.textContent : "Неизвестный регистратор";

      // Build full URLs for selected files
      var fileUrls = selectedFiles.map(function (fileName) {
        return buildFileUrl(fileName);
      });

      // Show progress and block modal
      showImportProgress(selectedFiles.length);

      // Start downloading files
      downloadFiles(fileUrls, selectedFiles, registratorName);
    } catch (err) {
      console.log("[DEBUG] Error in submitRegistratorImport:", err);
      alert("Ошибка при загрузке файлов");
    }
  };

  function buildFileUrl(fileName) {
    try {
      var sel = q("reg-picker");
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      var tpl = (opt && opt.getAttribute("data-template")) || "";
      if (!tpl) return "";

      // Get all selected values from parameters
      var selectedValues = [];
      for (var i = 1; i <= 5; i++) {
        var paramSel = q("reg-param-" + i);
        if (paramSel && paramSel.value) {
          selectedValues.push(paramSel.value);
        }
      }

      // Extract placeholders from template
      var names = [];
      try {
        (tpl.match(/\{\s*([a-zA-Z0-9_\-]+)\s*\}/g) || []).forEach(function (m) {
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
      for (var j = 0; j < Math.min(selectedValues.length, names.length); j++) {
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
      console.log("[DEBUG] Error building file URL:", err);
      return "";
    }
  }

  function showImportProgress(totalFiles) {
    try {
      // Block modal closing
      var modal = document.getElementById("popup-import-registrator");
      var cancelBtn = modal.querySelector('button[onclick*="popupToggle"]');
      var importBtn = modal.querySelector(
        'button[onclick*="submitRegistratorImport"]'
      );

      if (cancelBtn) cancelBtn.disabled = true;
      if (importBtn) importBtn.disabled = true;

      // Create progress container
      var progressContainer = document.createElement("div");
      progressContainer.id = "import-progress-container";
      progressContainer.className = "mt-3";
      progressContainer.innerHTML = `
        <div class="mb-2">
          <small class="text-muted">Загрузка файлов: <span id="import-progress-text">0/${totalFiles}</span></small>
        </div>
        <div class="progress" style="height: 20px;">
          <div id="import-progress-bar" class="progress-bar" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
        <div class="mt-2">
          <small id="import-current-file" class="text-muted">Подготовка...</small>
        </div>
        <div class="mt-2">
          <button type="button" class="btn btn-danger btn-sm" onclick="cancelImport()">Отменить загрузку</button>
        </div>
      `;

      // Insert progress after the last parameter
      var lastParam = document.getElementById("reg-param-5-wrap");
      if (lastParam && lastParam.parentElement) {
        lastParam.parentElement.appendChild(progressContainer);
      } else {
        modal.querySelector(".popup__body").appendChild(progressContainer);
      }
    } catch (err) {
      console.log("[DEBUG] Error showing import progress:", err);
    }
  }

  function updateImportProgress(current, total, fileName) {
    try {
      var progressText = document.getElementById("import-progress-text");
      var progressBar = document.getElementById("import-progress-bar");
      var currentFile = document.getElementById("import-current-file");

      if (progressText) progressText.textContent = `${current}/${total}`;
      if (progressBar) {
        var percentage = Math.round((current / total) * 100);
        progressBar.style.width = percentage + "%";
        progressBar.setAttribute("aria-valuenow", percentage);
      }
      if (currentFile) currentFile.textContent = fileName || "Обработка...";
    } catch (err) {
      console.log("[DEBUG] Error updating import progress:", err);
    }
  }

  function downloadFiles(fileUrls, fileNames, registratorName) {
    try {
      var totalFiles = fileUrls.length;
      var completedFiles = 0;
      var cancelled = false;
      var uploadedFileIds = []; // Track uploaded file IDs for cleanup

      // Store cancellation function globally
      window.cancelImport = function () {
        cancelled = true;

        // Clean up already uploaded files
        if (uploadedFileIds.length > 0) {
          cleanupUploadedFiles(uploadedFileIds);
        }

        hideImportProgress();
        alert("Загрузка отменена. Уже загруженные файлы удалены.");
      };

      // Process files sequentially
      function processNextFile(index) {
        if (cancelled || index >= fileUrls.length) {
          if (!cancelled) {
            hideImportProgress();
            alert("Все файлы успешно загружены!");
            // Close modal
            if (window.popupToggle)
              window.popupToggle("popup-import-registrator");
          }
          return;
        }

        var fileUrl = fileUrls[index];
        var fileName = fileNames[index];

        updateImportProgress(completedFiles, totalFiles, fileName);

        // Download file via proxy
        fetch(
          "/proxy/" +
            encodeURIComponent(
              fileUrl.replace(/^https?:\/\//, "").replace(/\//g, "!")
            ),
          {
            method: "GET",
            headers: {
              Accept: "application/octet-stream",
              "X-Registrator-Import": "1",
            },
          }
        )
          .then(function (response) {
            if (!response.ok) throw new Error("Download failed");
            return response.blob();
          })
          .then(function (blob) {
            // Create FormData for file upload
            var formData = new FormData();
            formData.append("file", blob, fileName);
            formData.append(
              "description",
              "[Регистратор - " + registratorName + "]"
            );

            // Upload file to server
            // Get current directory context from the page
            var did = window.location.pathname.match(/\/files\/(\d+)\/(\d+)/);
            var currentDid = did ? did[1] : "0";
            var currentSdid = did ? did[2] : "1";

            return fetch("/files/add/" + currentDid + "/" + currentSdid, {
              method: "POST",
              headers: { "X-Requested-With": "XMLHttpRequest" },
              body: formData,
            });
          })
          .then(function (response) {
            if (!response.ok) throw new Error("Upload failed");
            return response.json();
          })
          .then(function (result) {
            // Track uploaded file ID for potential cleanup
            if (result && result.id) {
              uploadedFileIds.push(result.id);
            }

            completedFiles++;
            updateImportProgress(completedFiles, totalFiles, fileName + " ✓");

            // Process next file after a short delay
            setTimeout(function () {
              processNextFile(index + 1);
            }, 500);
          })
          .catch(function (err) {
            completedFiles++;
            updateImportProgress(completedFiles, totalFiles, fileName + " ✗");

            // Continue with next file
            setTimeout(function () {
              processNextFile(index + 1);
            }, 500);
          });
      }

      // Start processing
      processNextFile(0);
    } catch (err) {
      hideImportProgress();
      alert("Ошибка при загрузке файлов");
    }
  }

  function cleanupUploadedFiles(fileIds) {
    try {
      // Get current directory context from the page
      var did = window.location.pathname.match(/\/files\/(\d+)\/(\d+)/);
      var currentDid = did ? did[1] : "0";
      var currentSdid = did ? did[2] : "1";

      // Delete each uploaded file
      fileIds.forEach(function (fileId) {
        fetch(
          "/files/delete/" + currentDid + "/" + currentSdid + "/" + fileId,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Upload-Cleanup": "1",
            },
          }
        )
          .then(function (response) {})
          .catch(function (err) {});
      });
    } catch (err) {}
  }

  function hideImportProgress() {
    try {
      var progressContainer = document.getElementById(
        "import-progress-container"
      );
      if (progressContainer) {
        progressContainer.remove();
      }

      // Re-enable modal controls
      var modal = document.getElementById("popup-import-registrator");
      var cancelBtn = modal.querySelector('button[onclick*="popupToggle"]');
      var importBtn = modal.querySelector(
        'button[onclick*="submitRegistratorImport"]'
      );

      if (cancelBtn) cancelBtn.disabled = false;
      if (importBtn) importBtn.disabled = false;
    } catch (err) {}
  }

  try {
    wireParamChain();
  } catch (_) {}
  function onStepChange(stepId) {
    var sel = q(stepId);
    if (!sel) return;
    sel.addEventListener("change", function () {
      var val = sel.value || "";
      var parent = q("reg-parent");
      if (!parent) return;
      var parts = (parent.value || "").split("/").filter(Boolean);
      var idxMap = {
        "reg-opt-date": 0,
        "reg-opt-user": 1,
        "reg-opt-time": 2,
        "reg-opt-type": 3,
      };
      var idx = idxMap[stepId];
      while (parts.length > idx) parts.pop();
      if (val) parts[idx] = val;
      parent.value = parts.filter(Boolean).join("/");
      // Clear deeper selects
      if (stepId === "reg-opt-date") {
        fillSelect(q("reg-opt-user"), []);
        fillSelect(q("reg-opt-time"), []);
        fillSelect(q("reg-opt-type"), []);
      } else if (stepId === "reg-opt-user") {
        fillSelect(q("reg-opt-time"), []);
        fillSelect(q("reg-opt-type"), []);
      } else if (stepId === "reg-opt-time") {
        fillSelect(q("reg-opt-type"), []);
      }
      // Fetch next level or files
      browse("next");
    });
  }
  try {
    onStepChange("reg-opt-date");
  } catch (_) {}
  try {
    onStepChange("reg-opt-user");
  } catch (_) {}
  try {
    onStepChange("reg-opt-time");
  } catch (_) {}
  try {
    onStepChange("reg-opt-type");
  } catch (_) {}
  try {
    q("reg-file-list").addEventListener("change", syncCheckedToTextarea);
  } catch (_) {}
})();
