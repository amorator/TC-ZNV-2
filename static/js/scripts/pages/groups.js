// Groups Page
// Основной файл страницы групп

// Global variables
let groupsData = [];
let currentGroupId = null;
let isEditing = false;

// Group management functions
function createGroup(groupData) {
  return window.ApiClient.apiPost("/api/groups", groupData);
}

function updateGroup(groupId, groupData) {
  return window.ApiClient.apiPut(`/api/groups/${groupId}`, groupData);
}

function deleteGroup(groupId) {
  return window.ApiClient.apiDelete(`/api/groups/${groupId}`);
}

function refreshGroupsTable() {
  return window.ApiClient.apiGet("/api/groups").then((data) => {
    groupsData = data;
    renderGroupsTable();
  });
}

function renderGroupsTable() {
  // Implementation for rendering groups table
  console.log("Rendering groups table with data:", groupsData);
}

function editGroup(groupId) {
  currentGroupId = groupId;
  isEditing = true;
  // Implementation for editing group
}

// Search functions
function initGroupsSearchPersistence() {
  // Implementation for search persistence
}

function filterGroupsTable(searchTerm) {
  // Implementation for filtering table
}

function clearGroupsSearch() {
  // Implementation for clearing search
}

function setupGroupsSearch() {
  // Implementation for setting up search
}

// Initialize unified context menu for groups page
function initGroupsContextMenu() {
  try {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canManage = table.getAttribute("data-can-manage") === "1";

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: "groups",
        canManage: canManage,
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: "groups",
            canManage: canManage,
          });
        }
      }, 100);
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initGroupsContextMenu");
    }
  }
}

// Initialize groups page
function initGroupsPage() {
  try {
    // Setup context menu
    initGroupsContextMenu();

    // Setup search functionality
    if (window.GroupsSearch && window.GroupsSearch.setupGroupsSearch) {
      window.GroupsSearch.setupGroupsSearch();
    }

    // Setup UI components
    setupGroupsModals();
    setupGroupsButtons();

    // Load initial data
    if (window.GroupsManagement && window.GroupsManagement.refreshGroupsTable) {
      window.GroupsManagement.refreshGroupsTable();
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initGroupsPage");
    }
  }
}

function setupGroupsModals() {
  try {
    // Setup create group modal
    const createModal = document.getElementById("createGroupModal");
    if (createModal) {
      const form = createModal.querySelector("form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          handleCreateGroup(form);
        });
      }
    }

    // Setup edit group modal
    const editModal = document.getElementById("editGroupModal");
    if (editModal) {
      const form = editModal.querySelector("form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          handleEditGroup(form);
        });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupGroupsModals");
    }
  }
}

function setupGroupsButtons() {
  try {
    // Setup create group button
    const createBtn = document.getElementById("create-group-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        showCreateGroupModal();
      });
    }

    // Setup refresh button
    const refreshBtn = document.getElementById("refresh-groups-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        if (
          window.GroupsManagement &&
          window.GroupsManagement.refreshGroupsTable
        ) {
          window.GroupsManagement.refreshGroupsTable();
        }
      });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupGroupsButtons");
    }
  }
}

function showCreateGroupModal() {
  try {
    const modal = document.getElementById("createGroupModal");
    if (modal) {
      modal.style.display = "block";

      // Clear form
      const form = modal.querySelector("form");
      if (form) {
        form.reset();
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "showCreateGroupModal");
    }
  }
}

function handleCreateGroup(form) {
  try {
    const formData = new FormData(form);
    const groupData = {
      name: formData.get("name"),
      description: formData.get("description"),
    };

    createGroup(groupData).then(() => {
      // Close modal
      const modal = document.getElementById("createGroupModal");
      if (modal) {
        modal.style.display = "none";
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleCreateGroup");
    }
  }
}

function handleEditGroup(form) {
  try {
    const formData = new FormData(form);
    const groupId = formData.get("groupId");
    const groupData = {
      name: formData.get("name"),
      description: formData.get("description"),
    };

    updateGroup(groupId, groupData).then(() => {
      // Close modal
      const modal = document.getElementById("editGroupModal");
      if (modal) {
        modal.style.display = "none";
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "handleEditGroup");
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    // Defer heavy initialization to avoid blocking DOMContentLoaded
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => {
        initGroupsPage();
      
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
              if (window.requestIdleCallback) {
                window.requestIdleCallback(() => {
                  initGroupsPage();
                }, { timeout: 1000 });
              } else {
                initGroupsPage();
              }
            }, 0);
    }
  });
} else {
  initGroupsPage();
}

// Export functions to global scope for inline event handlers
window.initGroupsContextMenu = initGroupsContextMenu;
window.initGroupsPage = initGroupsPage;
window.setupGroupsModals = setupGroupsModals;
window.setupGroupsButtons = setupGroupsButtons;
window.showCreateGroupModal = showCreateGroupModal;
window.handleCreateGroup = handleCreateGroup;
window.handleEditGroup = handleEditGroup;
