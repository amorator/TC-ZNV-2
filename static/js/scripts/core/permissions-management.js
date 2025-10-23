// Permissions Management Module
// Управление правами доступа

function loadPermissions(subcategoryId) {
  try {
    return fetchWithTimeout(
      `/api/subcategories/${subcategoryId}/permissions`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      10000,
      "loadPermissions"
    )
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      })
      .then((data) => {
        try {
          // Load permissions tables
          if (data.groups) {
            loadGroupsPermissionsTable(data.groups, data.permissions);
          }
          if (data.users) {
            loadUsersPermissionsTable(data.users, data.permissions);
          }

          return data;
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function loadGroupsPermissionsTable(groups, permissions) {
  try {
    const tableBody = document.getElementById("groups-permissions-table-body");
    if (!tableBody) return;

    const rowsHtml = groups
      .map((group) => {
        const groupPermissions = permissions[group.id] || {};
        return `
        <tr>
          <td>${group.name}</td>
          <td>
            <select onchange="updateGroupPermission(${
              group.id
            }, 'read', 'scope', this.value)">
              <option value="allow" ${
                groupPermissions.read === "allow" ? "selected" : ""
              }>Разрешено</option>
              <option value="deny" ${
                groupPermissions.read === "deny" ? "selected" : ""
              }>Запрещено</option>
            </select>
          </td>
          <td>
            <select onchange="updateGroupPermission(${
              group.id
            }, 'write', 'scope', this.value)">
              <option value="allow" ${
                groupPermissions.write === "allow" ? "selected" : ""
              }>Разрешено</option>
              <option value="deny" ${
                groupPermissions.write === "deny" ? "selected" : ""
              }>Запрещено</option>
            </select>
          </td>
        </tr>
      `;
      })
      .join("");

    tableBody.innerHTML = rowsHtml;
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function loadUsersPermissionsTable(users, permissions) {
  try {
    const tableBody = document.getElementById("users-permissions-table-body");
    if (!tableBody) return;

    const rowsHtml = users
      .map((user) => {
        const userPermissions = permissions[user.id] || {};
        return `
        <tr>
          <td>${user.name}</td>
          <td>
            <select onchange="updateUserPermission(${
              user.id
            }, 'read', 'scope', this.value)">
              <option value="allow" ${
                userPermissions.read === "allow" ? "selected" : ""
              }>Разрешено</option>
              <option value="deny" ${
                userPermissions.write === "deny" ? "selected" : ""
              }>Запрещено</option>
            </select>
          </td>
          <td>
            <select onchange="updateUserPermission(${
              user.id
            }, 'write', 'scope', this.value)">
              <option value="allow" ${
                userPermissions.write === "allow" ? "selected" : ""
              }>Разрешено</option>
              <option value="deny" ${
                userPermissions.write === "deny" ? "selected" : ""
              }>Запрещено</option>
            </select>
          </td>
        </tr>
      `;
      })
      .join("");

    tableBody.innerHTML = rowsHtml;
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateGroupPermission(groupId, action, scope, value) {
  try {
    // Update local state
    if (!currentPermissionsDraft.group[groupId]) {
      currentPermissionsDraft.group[groupId] = {};
    }
    currentPermissionsDraft.group[groupId][action] = value;

    // Mark as dirty
    markDirty("group");
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateUserPermission(userId, action, scope, value) {
  try {
    // Update local state
    if (!currentPermissionsDraft.user[userId]) {
      currentPermissionsDraft.user[userId] = {};
    }
    currentPermissionsDraft.user[userId][action] = value;

    // Mark as dirty
    markDirty("user");
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function markDirty(which) {
  try {
    if (which === "group") {
      isDirtyGroups = true;
    } else if (which === "user") {
      isDirtyUsers = true;
    }

    updateSaveButtonsState();
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateSaveButtonsState(disabledExplicitWhich) {
  try {
    const groupSaveBtn = document.getElementById("save-group-permissions");
    const userSaveBtn = document.getElementById("save-user-permissions");

    if (groupSaveBtn) {
      groupSaveBtn.disabled =
        !isDirtyGroups || disabledExplicitWhich === "group";
    }
    if (userSaveBtn) {
      userSaveBtn.disabled = !isDirtyUsers || disabledExplicitWhich === "user";
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.PermissionsManagement = {
  loadPermissions,
  loadGroupsPermissionsTable,
  loadUsersPermissionsTable,
  updateGroupPermission,
  updateUserPermission,
  markDirty,
  updateSaveButtonsState,
};
