/**
 * Users Management Module
 * Управление пользователями
 */

// Debouncing for sync events
let syncTimeout = null;
let pendingSync = false;

/**
 * Create new user
 * @param {Object} userData - User data object
 */
function createUser(userData) {
  const formData = new FormData();
  formData.append("name", userData.name || "");
  formData.append("login", userData.login || "");
  formData.append("password", userData.password || "");
  formData.append("group", userData.group || "");
  formData.append("enabled", userData.enabled ? "1" : "0");
  formData.append("permission", userData.permission || "");

  fetch("/users/add", {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__usersClientId || "unknown",
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
          window.notify("Пользователь создан", "success");
        }
      } else {
        throw new Error(data.message || "Ошибка создания пользователя");
      }
    })
    .catch((err) => window.ErrorHandler.handleError(err, "createUser"));
}

/**
 * Update existing user
 * @param {string} userId - User ID
 * @param {Object} userData - User data object
 */
function updateUser(userId, userData) {
  const formData = new FormData();
  formData.append("name", userData.name || "");
  formData.append("login", userData.login || "");
  formData.append("group", userData.group || "");
  formData.append("enabled", userData.enabled ? "1" : "0");
  formData.append("permission", userData.permission || "");

  fetch(`/users/edit/${userId}`, {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__usersClientId || "unknown",
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
          window.notify("Пользователь обновлен", "success");
        }
      } else {
        throw new Error(data.message || "Ошибка обновления пользователя");
      }
    })
    .catch((err) => window.ErrorHandler.handleError(err, "updateUser"));
}

/**
 * Delete user with confirmation dialog
 * @param {string} userId - User ID
 */
function deleteUser(userId) {
  const userRow = document.getElementById(userId);
  const userLogin = userRow
    ? userRow.dataset.login || "неизвестный"
    : "неизвестный";
  const userName = userRow ? userRow.dataset.name || "" : "";
  const displayName = userName ? `${userLogin} (${userName})` : userLogin;

  if (confirm(`Вы действительно хотите удалить пользователя ${displayName}?`)) {
    fetch(`/users/delete/${userId}`, {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Client-Id": window.__usersClientId || "unknown",
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
            window.notify("Пользователь удален", "success");
          }
        } else {
          throw new Error(data.message || "Ошибка удаления пользователя");
        }
      })
      .catch((err) => window.ErrorHandler.handleError(err, "deleteUser"));
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
    softRefreshUsersTable(true);
  }, 100);
}

/**
 * Soft refresh users table with proper search and pagination support
 * @param {boolean} force - Force refresh even if table has data
 */
function softRefreshUsersTable(force = false) {
  const input = document.getElementById("searchinp");
  const q = input && typeof input.value === "string" ? input.value.trim() : "";

  if (q && typeof window.usersDoFilter === "function") {
    return window.usersDoFilter(q).then(() => {
      reinitializeContextMenu();
      if (window.rebindUsersTable) window.rebindUsersTable();
    });
  }

  const table = document.getElementById("maintable");
  const tbody = table && table.tBodies && table.tBodies[0];
  const pager = document.getElementById("users-pagination");

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

  if (window.usersPager && typeof window.usersPager.renderPage === "function") {
    window.usersPager.renderPage(1);
    reinitializeContextMenu();
    if (window.rebindUsersTable) window.rebindUsersTable();
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

// Export functions to global scope
window.UsersManagement = {
  createUser,
  updateUser,
  deleteUser,
  softRefreshUsersTable,
  debouncedSync,
  reinitializeContextMenu,
};
