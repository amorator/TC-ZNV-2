/**
 * Groups Management Module
 * Управление группами пользователей
 */

// Debouncing for sync events
let groupsSyncTimeout = null;
let groupsPendingSync = false;

/**
 * Create new group
 * @param {Object} groupData - Group data object
 */
function createGroup(groupData) {
  const formData = new FormData();
  formData.append("name", groupData.name || "");
  formData.append("description", groupData.description || "");

  fetch("/groups/add", {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__groupsClientId || "unknown",
    },
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      if (window.notify) {
        window.notify("Группа создана", "success");
      }
      return data;
    })
    .catch((err) => window.ErrorHandler.handleError(err, "createGroup"));
}

/**
 * Update existing group
 * @param {string} groupId - Group ID
 * @param {Object} groupData - Group data object
 */
function updateGroup(groupId, groupData) {
  const formData = new FormData();
  formData.append("name", groupData.name || "");
  formData.append("description", groupData.description || "");

  fetch(`/groups/edit/${groupId}`, {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__groupsClientId || "unknown",
    },
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }
      if (window.notify) {
        window.notify("Группа обновлена", "success");
      }
      return data;
    })
    .catch((err) => window.ErrorHandler.handleError(err, "updateGroup"));
}

/**
 * Delete group with confirmation dialog
 * @param {string} groupId - Group ID
 */
function deleteGroup(groupId) {
  const groupRow = document.getElementById(groupId);
  const groupName = groupRow
    ? groupRow.dataset.name || "неизвестная"
    : "неизвестная";

  if (confirm(`Вы действительно хотите удалить группу ${groupName}?`)) {
    fetch(`/groups/delete/${groupId}`, {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Client-Id": window.__groupsClientId || "unknown",
      },
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        if (window.notify) {
          window.notify("Группа удалена", "success");
        }
        return data;
      })
      .catch((err) => window.ErrorHandler.handleError(err, "deleteGroup"));
  }
}

/**
 * Debounced sync function to prevent multiple simultaneous refreshes
 */
function debouncedSync() {
  if (groupsPendingSync) return;

  groupsPendingSync = true;

  if (groupsSyncTimeout) {
    clearTimeout(groupsSyncTimeout);
  }

  groupsSyncTimeout = setTimeout(() => {
    groupsPendingSync = false;
    softRefreshGroupsTable(true);
  }, 100);
}

/**
 * Soft refresh groups table with proper search and pagination support
 * @param {boolean} force - Force refresh even if table has data
 */
function softRefreshGroupsTable(force = false) {
  const input = document.getElementById("searchinp");
  const q = input && typeof input.value === "string" ? input.value.trim() : "";

  if (q && typeof window.groupsDoFilter === "function") {
    return window.groupsDoFilter(q).then(() => {
      reinitializeContextMenu();
      if (window.rebindGroupsTable) window.rebindGroupsTable();
    });
  }

  const table = document.getElementById("maintable");
  const tbody = table && table.tBodies && table.tBodies[0];
  const pager = document.getElementById("groups-pagination");

  if (!force) {
    if (
      tbody &&
      pager &&
      tbody.querySelectorAll("tr.table__body_row").length > 0 &&
      pager.innerHTML
    ) {
      return;
    }
    if (tbody && tbody.querySelectorAll("tr.table__body_row").length > 0) {
      return;
    }
  }

  if (
    window.groupsPager &&
    typeof window.groupsPager.renderPage === "function"
  ) {
    window.groupsPager.renderPage(1);
    reinitializeContextMenu();
    if (window.rebindGroupsTable) window.rebindGroupsTable();
  } else {
    // Always use soft refresh
    if (window.softRefreshGroupsTable) {
      window.softRefreshGroupsTable(true);
    }
  }
}

/**
 * Reinitialize context menu after table update
 */
function reinitializeContextMenu() {
  const now = Date.now();
  if (
    window._lastContextMenuReinit &&
    now - window._lastContextMenuReinit < 500
  ) {
    return;
  }
  window._lastContextMenuReinit = now;

  if (window.requestIdleCallback) {
    window.requestIdleCallback(
      () => {
        const event = new CustomEvent("context-menu-reinit", {
          detail: { timestamp: Date.now() },
        });
        document.dispatchEvent(event);
        document.dispatchEvent(new Event("table-updated"));
      },
      { timeout: 1000 }
    );
  } else {
    setTimeout(() => {
      const event = new CustomEvent("context-menu-reinit", {
        detail: { timestamp: Date.now() },
      });
      document.dispatchEvent(event);
      document.dispatchEvent(new Event("table-updated"));
    }, 10);
  }
}

// popupValues and popupToggle functions moved to popup-utils.js

// Export functions to global scope
window.GroupsManagement = {
  createGroup,
  updateGroup,
  deleteGroup,
  softRefreshGroupsTable,
  debouncedSync,
  reinitializeContextMenu,
};

// Also make key functions globally available
// Note: popupValues and popupToggle are now provided by popup-utils.js
