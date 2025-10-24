// Registrators Page - Modular Version
// Использует модули из core/ для функциональности

// Initialize page when DOM is ready
function initRegistratorsPage() {
  try {
    // Load registrators and select first one
    if (window.loadRegistrators) {
      window.loadRegistrators().then(function (items) {
        if (items && items.length && window.selectRegistrator) {
          window.selectRegistrator(items[0].id);
        }
        if (window.refreshLevels) {
          window.refreshLevels();
        }
      });
    }

    // Setup form validation
    setupFormValidation();

    // Setup socket synchronization
    if (window.setupRegistratorsSocket) {
      window.setupRegistratorsSocket();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initRegistratorsPage");
    }
  }
}

// Setup form validation
function setupFormValidation() {
  try {
    // Date select
    var dateSelect = document.getElementById("dateSelect");
    if (dateSelect) {
      safeOn(dateSelect, "change", function () {
        if (window.onDate) window.onDate();
      });
    }

    // User select
    var userSelect = document.getElementById("userSelect");
    if (userSelect) {
      safeOn(userSelect, "change", function () {
        if (window.onUser) window.onUser();
      });
    }

    // Time select
    var timeSelect = document.getElementById("timeSelect");
    if (timeSelect) {
      safeOn(timeSelect, "change", function () {
        if (window.onTime) window.onTime();
      });
    }

    // Type select
    var typeSelect = document.getElementById("typeSelect");
    if (typeSelect) {
      safeOn(typeSelect, "change", function () {
        if (window.onType) window.onType();
      });
    }

    // Files list
    var filesList = document.getElementById("filesList");
    if (filesList) {
      safeOn(filesList, "change", function () {
        if (window.updateImportButton) window.updateImportButton();
      });
    }

    // Import button
    var btnImport = document.getElementById("btnImportSelected");
    if (btnImport) {
      safeOn(btnImport, "click", function () {
        if (window.importSelected) window.importSelected();
      });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupFormValidation");
    }
  }
}

// Utility function for safe event binding
function safeOn(el, type, h) {
  try {
    if (el && el.addEventListener) el.addEventListener(type, h);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "safeOn");
    }
  }
}

// Form validation handlers
function onDate() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onDate");
    }
  }
}

function onUser() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onUser");
    }
  }
}

function onTime() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onTime");
    }
  }
}

function onType() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onType");
    }
  }
}

// Refresh levels function
function refreshLevels() {
  try {
    var dateSelect = document.getElementById("dateSelect");
    var userSelect = document.getElementById("userSelect");
    var timeSelect = document.getElementById("timeSelect");
    var typeSelect = document.getElementById("typeSelect");

    if (!dateSelect || !userSelect || !timeSelect || !typeSelect) return;

    var date = dateSelect.value;
    var user = userSelect.value;
    var time = timeSelect.value;
    var type = typeSelect.value;

    if (!date || !user || !time || !type) return;

    var rid = window.currentRegistratorId;
    if (!rid) return;

    var url =
      "/registrators/" +
      encodeURIComponent(rid) +
      "/browse?" +
      "date=" +
      encodeURIComponent(date) +
      "&user=" +
      encodeURIComponent(user) +
      "&time=" +
      encodeURIComponent(time) +
      "&type=" +
      encodeURIComponent(type);

    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.files) {
          var filesList = document.getElementById("filesList");
          if (filesList) {
            filesList.innerHTML = "";
            data.files.forEach(function (file) {
              var option = document.createElement("option");
              option.value = file.name;
              option.textContent = file.name;
              filesList.appendChild(option);
            });
          }
          if (window.updateImportButton) {
            window.updateImportButton();
          }
        }
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "refreshLevels");
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "refreshLevels");
    }
  }
}

// Update import button state
function updateImportButton() {
  try {
    var filesList = document.getElementById("filesList");
    var btnImport = document.getElementById("btnImportSelected");

    if (!filesList || !btnImport) return;

    var hasSelection = false;
    for (var i = 0; i < filesList.options.length; i++) {
      if (filesList.options[i].selected) {
        hasSelection = true;
        break;
      }
    }

    btnImport.disabled = !hasSelection;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateImportButton");
    }
  }
}

// Import selected files
function importSelected() {
  try {
    var filesList = document.getElementById("filesList");
    if (!filesList) return;

    var selectedFiles = [];
    for (var i = 0; i < filesList.options.length; i++) {
      if (filesList.options[i].selected) {
        selectedFiles.push(filesList.options[i].value);
      }
    }

    if (selectedFiles.length === 0) return;

    var rid = window.currentRegistratorId;
    if (!rid) return;

    var dateSelect = document.getElementById("dateSelect");
    var userSelect = document.getElementById("userSelect");
    var timeSelect = document.getElementById("timeSelect");
    var typeSelect = document.getElementById("typeSelect");

    if (!dateSelect || !userSelect || !timeSelect || !typeSelect) return;

    var payload = {
      files: selectedFiles,
      date: dateSelect.value,
      user: userSelect.value,
      time: timeSelect.value,
      type: typeSelect.value,
    };

    var url = "/registrators/" + encodeURIComponent(rid) + "/import";

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.success) {
          if (window.showToast) {
            window.showToast("Файлы импортированы", "success");
          }
          if (window.refreshLevels) {
            window.refreshLevels();
          }
        } else {
          if (window.showToast) {
            window.showToast("Ошибка импорта файлов", "error");
          }
        }
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "importSelected");
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "importSelected");
    }
  }
}

// Export functions to global scope
window.initRegistratorsPage = initRegistratorsPage;
window.refreshLevels = refreshLevels;
window.updateImportButton = updateImportButton;
window.importSelected = importSelected;
window.onDate = onDate;
window.onUser = onUser;
window.onTime = onTime;
window.onType = onType;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRegistratorsPage);
} else {
  initRegistratorsPage();
}
