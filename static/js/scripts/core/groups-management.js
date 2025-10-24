/**
 * Groups Management Module
 * Управление группами пользователей
 */

// Debouncing for sync events
let syncTimeout = null;
let pendingSync = false;

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
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.status === "success") {
        if (window.notify) {
          window.notify("Группа создана", "success");
        }
      } else {
        throw new Error(data.message || "Ошибка создания группы");
      }
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
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.status === "success") {
        if (window.notify) {
          window.notify("Группа обновлена", "success");
        }
      } else {
        throw new Error(data.message || "Ошибка обновления группы");
      }
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
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then((data) => {
        if (data.status === "success") {
          if (window.notify) {
            window.notify("Группа удалена", "success");
          }
        } else {
          throw new Error(data.message || "Ошибка удаления группы");
        }
      })
      .catch((err) => window.ErrorHandler.handleError(err, "deleteGroup"));
  }
}

/**
 * Debounced sync function to prevent multiple simultaneous refreshes
 */
function debouncedSync() {
  if (pendingSync) return;

  pendingSync = true;

  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(() => {
    pendingSync = false;
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
    window.location.reload();
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

/**
 * Fill form with group data from table row
 * @param {HTMLFormElement} form - Form element
 * @param {string} rowId - Row ID
 */
function popupValues(form, rowId) {
  if (!form || !rowId) return;

  const row = document.getElementById(rowId);
  if (!row) return;

  const name = row.dataset.name || "";
  const description = row.dataset.description || "";

  // Fill form fields
  const nameInput = form.querySelector('input[name="name"]');
  const descriptionInput = form.querySelector(
    'input[name="description"], textarea[name="description"]'
  );

  if (nameInput) nameInput.value = name;
  if (descriptionInput) descriptionInput.value = description;

  // Update form action URL with group ID
  form.action = form.action.replace("/0", `/${rowId}`);

  // Update delete confirmation text
  if (form.id === "delete") {
    const popupBody = form.closest(".popup__body");
    const gnameElement = popupBody ? popupBody.querySelector("b") : null;
    if (gnameElement) {
      gnameElement.textContent = name;
    }
  }
}

/**
 * Toggle popup modal
 * @param {string} popupId - Popup ID
 * @param {string} rowId - Row ID (optional)
 */
function popupToggle(popupId, rowId) {
  if (window.openModal) {
    window.openModal(popupId);
  } else if (window.popupToggle) {
    window.popupToggle(popupId, rowId);
  }
}

// Export functions to global scope
window.GroupsManagement = {
  createGroup,
  updateGroup,
  deleteGroup,
  softRefreshGroupsTable,
  debouncedSync,
  reinitializeContextMenu,
  popupValues,
  popupToggle,
};

// Also make key functions globally available
window.popupValues = popupValues;
window.popupToggle = popupToggle;
