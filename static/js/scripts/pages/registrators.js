// Registrators Page
// Основной файл страницы регистраторов

// Global variables
let registratorsData = [];
let currentRegistratorId = null;
let isEditing = false;

// Registrator management functions
function createRegistrator(registratorData) {
  return window.ApiClient.apiPost("/api/registrators", registratorData);
}

function updateRegistrator(registratorId, registratorData) {
  return window.ApiClient.apiPut(
    `/api/registrators/${registratorId}`,
    registratorData
  );
}

function deleteRegistrator(registratorId) {
  return window.ApiClient.apiDelete(`/api/registrators/${registratorId}`);
}

function refreshRegistratorsTable() {
  return window.ApiClient.apiGet("/api/registrators").then((data) => {
    registratorsData = data;
    renderRegistratorsTable();
  });
}

function renderRegistratorsTable() {
  // Implementation for rendering registrators table
}

function editRegistrator(registratorId) {
  currentRegistratorId = registratorId;
  isEditing = true;
  // Implementation for editing registrator
}

function testRegistrator(registratorId) {
  return window.ApiClient.apiPost(`/api/registrators/${registratorId}/test`);
}

// Modal helper functions
function showModalEl(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = "block";
}

function hideModalEl(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = "none";
}

function toggleModalEl(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = modal.style.display === "none" ? "block" : "none";
  }
}

// Initialize registrators page
function initRegistratorsPage() {
  try {
    // Setup UI components
    setupRegistratorsModals();
    setupRegistratorsButtons();
    setupRegistratorsTable();

    // Load initial data
    if (
      window.RegistratorsManagement &&
      window.RegistratorsManagement.refreshRegistratorsTable
    ) {
      window.RegistratorsManagement.refreshRegistratorsTable();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initRegistratorsPage");
    }
  }
}

function setupRegistratorsModals() {
  try {
    // Setup create registrator modal
    const createModal = document.getElementById("createRegistratorModal");
    if (createModal) {
      const form = createModal.querySelector("form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          handleCreateRegistrator(form);
        });
      }
    }

    // Setup edit registrator modal
    const editModal = document.getElementById("editRegistratorModal");
    if (editModal) {
      const form = editModal.querySelector("form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          handleEditRegistrator(form);
        });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupRegistratorsModals");
    }
  }
}

function setupRegistratorsButtons() {
  try {
    // Setup create registrator button
    const createBtn = document.getElementById("create-registrator-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        showCreateRegistratorModal();
      });
    }

    // Setup refresh button
    const refreshBtn = document.getElementById("refresh-registrators-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        if (
          window.RegistratorsManagement &&
          window.RegistratorsManagement.refreshRegistratorsTable
        ) {
          window.RegistratorsManagement.refreshRegistratorsTable();
        }
      });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupRegistratorsButtons");
    }
  }
}

function setupRegistratorsTable() {
  try {
    // Setup table event listeners
    const table = document.getElementById("maintable");
    if (table) {
      // Setup context menu
      if (window.contextMenu) {
        window.contextMenu.init({
          page: "registrators",
          canManage: true,
        });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupRegistratorsTable");
    }
  }
}

function showCreateRegistratorModal() {
  try {
    const modal = document.getElementById("createRegistratorModal");
    if (modal) {
      showModalEl(modal);

      // Clear form
      const form = modal.querySelector("form");
      if (form) {
        form.reset();
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "showCreateRegistratorModal");
    }
  }
}

function handleCreateRegistrator(form) {
  try {
    const formData = new FormData(form);
    const registratorData = {
      name: formData.get("name"),
      ip_address: formData.get("ip_address"),
      description: formData.get("description"),
    };

    if (
      window.RegistratorsManagement &&
      window.RegistratorsManagement.createRegistrator
    ) {
      window.RegistratorsManagement.createRegistrator(registratorData).then(
        () => {
          // Close modal
          const modal = document.getElementById("createRegistratorModal");
          if (modal) {
            hideModalEl(modal);
          }
        }
      );
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleCreateRegistrator");
    }
  }
}

function handleEditRegistrator(form) {
  try {
    const formData = new FormData(form);
    const registratorId = formData.get("registratorId");
    const registratorData = {
      name: formData.get("name"),
      ip_address: formData.get("ip_address"),
      description: formData.get("description"),
    };

    if (
      window.RegistratorsManagement &&
      window.RegistratorsManagement.updateRegistrator
    ) {
      window.RegistratorsManagement.updateRegistrator(
        registratorId,
        registratorData
      ).then(() => {
        // Close modal
        const modal = document.getElementById("editRegistratorModal");
        if (modal) {
          hideModalEl(modal);
        }
      });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleEditRegistrator");
    }
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    // Defer heavy initialization to avoid blocking DOMContentLoaded
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => {
        initRegistratorsPage();
      
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
              if (window.requestIdleCallback) {
                window.requestIdleCallback(() => {
                  initRegistratorsPage();
                }, { timeout: 1000 });
              } else {
                initRegistratorsPage();
              }
            }, 0);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "DOMContentLoaded");
    }
  }
});

// Export functions to global scope for inline event handlers
window.initRegistratorsPage = initRegistratorsPage;
window.setupRegistratorsModals = setupRegistratorsModals;
window.setupRegistratorsButtons = setupRegistratorsButtons;
window.setupRegistratorsTable = setupRegistratorsTable;
window.showCreateRegistratorModal = showCreateRegistratorModal;
window.handleCreateRegistrator = handleCreateRegistrator;
window.handleEditRegistrator = handleEditRegistrator;
