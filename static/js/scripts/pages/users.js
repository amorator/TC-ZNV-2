// Users Page - Modular Version
// Основной файл страницы пользователей, использующий модули

// Initialize unified context menu for users page
function initUsersContextMenu() {
  try {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canManage = table.getAttribute("data-can-manage") === "1";

    // Initialize unified context menu
    if (window.contextMenu && window.contextMenu.init) {
      window.contextMenu.init({
        page: "users",
        canManage: canManage,
        canAdd: canManage,
        canMarkView: false,
        canNotes: false,
      });
    }

    // Setup user management
    setupUserManagement();

    // Setup permissions
    setupPermissions();

    // Setup table interactions
    setupTableInteractions();

    // Apply admin collapse
    if (
      window.UsersPermissions &&
      window.UsersPermissions.enforceAdminCollapse
    ) {
      window.UsersPermissions.enforceAdminCollapse();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "initUsersContextMenu");
  }
}

function setupUserManagement() {
  try {
    // Setup create user form
    const createForm = document.getElementById("createUserForm");
    if (createForm) {
      createForm.addEventListener("submit", function (e) {
        e.preventDefault();

        const formData = new FormData(this);
        const userData = {
          name: formData.get("name"),
          email: formData.get("email"),
          role: formData.get("role"),
        };

        if (window.UsersManagement && window.UsersManagement.createUser) {
          window.UsersManagement.createUser(userData);
        }
      });
    }

    // Setup edit user form
    const editForm = document.getElementById("editUserForm");
    if (editForm) {
      editForm.addEventListener("submit", function (e) {
        e.preventDefault();

        const formData = new FormData(this);
        const userId = this.getAttribute("data-user-id");
        const userData = {
          name: formData.get("name"),
          email: formData.get("email"),
          role: formData.get("role"),
        };

        if (window.UsersManagement && window.UsersManagement.updateUser) {
          window.UsersManagement.updateUser(userId, userData);
        }
      });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupUserManagement");
  }
}

function setupPermissions() {
  try {
    // Setup permission change handlers
    const permissionSelects = document.querySelectorAll(".permission-select");
    permissionSelects.forEach((select) => {
      select.addEventListener("change", function () {
        const userId = this.getAttribute("data-user-id");
        const permission = this.getAttribute("data-permission");
        const value = this.value;

        if (
          window.UsersPermissions &&
          window.UsersPermissions.updateUserPermissions
        ) {
          window.UsersPermissions.updateUserPermissions(userId, {
            [permission]: value,
          });
        }
      });
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupPermissions");
  }
}

function setupTableInteractions() {
  try {
    // Setup row click handlers
    const tableRows = document.querySelectorAll("#maintable tbody tr");
    tableRows.forEach((row) => {
      row.addEventListener("click", function () {
        const userId = this.getAttribute("data-user-id");
        if (userId) {
          selectUser(userId);
        }
      });
    });

    // Context menu is now handled by unified ContextMenuManager
  } catch (err) {
    window.ErrorHandler.handleError(err, "setupTableInteractions");
  }
}

function selectUser(userId) {
  try {
    // Remove previous selection
    document.querySelectorAll(".selected-user").forEach((row) => {
      row.classList.remove("selected-user");
    });

    // Add selection to current row
    const userRow = document.querySelector(`[data-user-id="${userId}"]`);
    if (userRow) {
      userRow.classList.add("selected-user");
    }

    // Update UI for selected user
    updateUserDetails(userId);
  } catch (err) {
    window.ErrorHandler.handleError(err, "selectUser");
  }
}

function updateUserDetails(userId) {
  try {
    fetch(`/api/users/${userId}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.user) {
          // Update user details panel
          const detailsPanel = document.getElementById("userDetails");
          if (detailsPanel) {
            detailsPanel.innerHTML = `
              <h3>${data.user.name}</h3>
              <p>Email: ${data.user.email}</p>
              <p>Role: ${data.user.role}</p>
              <p>Permissions: ${data.user.permissions}</p>
            `;
          }
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "updateUserDetails");
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "updateUserDetails");
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    initUsersContextMenu();
  } catch (err) {
    window.ErrorHandler.handleError(err, "DOMContentLoaded");
  }
});

// Export functions to global scope
window.UsersPage = {
  initUsersContextMenu,
  setupUserManagement,
  setupPermissions,
  setupTableInteractions,
  selectUser,
  updateUserDetails,
};
