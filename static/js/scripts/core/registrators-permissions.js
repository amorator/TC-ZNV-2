// Registrators Permissions Module
// Управление правами доступа для регистраторов

// Load permissions for registrator
function loadRegPermissions(pageGroups, pageUsers, termGroups, termUsers) {
  var rid = window.currentRegistratorId;
  if (!rid) return;

  Promise.all([
    fetch(
      "/api/groups?page=" +
        (pageGroups || 1) +
        "&page_size=5" +
        (termGroups ? "&search=" + encodeURIComponent(termGroups) : "")
    ).then(function (r) {
      return r.json();
    }),
    fetch(
      "/api/users?page=" +
        (pageUsers || 1) +
        "&page_size=5" +
        (termUsers ? "&search=" + encodeURIComponent(termUsers) : "")
    ).then(function (r) {
      return r.json();
    }),
    fetch("/registrators/" + encodeURIComponent(rid) + "/permissions").then(
      function (r) {
        return r.json();
      }
    ),
  ])
    .then(function (arr) {
      var groupsResp = arr[0] || {};
      var usersResp = arr[1] || {};
      var permissionsData = arr[2] || {};
      var perms =
        permissionsData && permissionsData.permissions
          ? permissionsData.permissions
          : { user: {}, group: {} };

      // Enforce admin access for all registrators
      perms = enforceAdminAccess(
        perms,
        groupsResp.items || [],
        usersResp.items || []
      );

      regLastSavedPermissions = JSON.parse(JSON.stringify(perms));
      regCurrentPermissionsDraft = JSON.parse(JSON.stringify(perms));
      regOriginalUserPermissions = JSON.parse(JSON.stringify(perms));
      try {
        window.groupUserSnapshot = JSON.parse(
          JSON.stringify((perms && perms.user) || {})
        );
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "loadRegPermissions");
        }
        window.groupUserSnapshot = {};
      }

      // Store current users and groups data for cascade inheritance
      window.currentUsersData = usersResp.items || [];
      window.currentGroupsData = groupsResp.items || [];

      // Initialize group states for visual inheritance
      if (!window.regGroupStates) window.regGroupStates = {};
      if (perms && perms.group) {
        Object.keys(perms.group).forEach(function (groupId) {
          window.regGroupStates[groupId] = perms.group[groupId] === 1;
        });
      }

      // Track if user permissions were modified by group changes
      window.userPermissionsModifiedByGroup = false;
      loadGroupsPermissionsTable(
        groupsResp.items || [],
        regCurrentPermissionsDraft.group || {}
      );
      loadUsersPermissionsTable(
        usersResp.items || [],
        regCurrentPermissionsDraft.user || {}
      );
      renderPagination("groups", groupsResp);
      renderPagination("users", usersResp);
    })
    .catch(function (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "loadRegPermissions");
      }
    });
}

// Load groups permissions table
function loadGroupsPermissionsTable(groups, permissions) {
  var tbody = document.getElementById("groups-permissions");
  if (!tbody) return;
  tbody.innerHTML = "";
  (groups || []).forEach(function (group) {
    var row = document.createElement("tr");
    row.className = "small";
    var checked =
      permissions && permissions[group.id] ? !!permissions[group.id] : false;
    var force = false;
    try {
      var permStr = String((group && group.permission) || "").trim();
      var name = String((group && group.name) || "").toLowerCase();
      if (name === "программисты" || name === "admin") {
        force = true;
      } else {
        force =
          permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
          permStr === "aef,a,abcdflm,ab,ab,ab" ||
          permStr.indexOf("z") !== -1 ||
          permStr.includes("полный доступ") ||
          permStr.includes("full access");
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "loadGroupsPermissionsTable");
      }
    }
    if (!regCurrentPermissionsDraft.group)
      regCurrentPermissionsDraft.group = {};
    regCurrentPermissionsDraft.group[String(group.id)] = 1;
    var html = `
      <td>
        <span title="${group.name || ""}">${group.name || ""}</span>
        ${
          force
            ? '<i class="bi bi-shield-fill-check text-warning ms-1" title="Административная группа"></i>'
            : ""
        }
      </td>
      <td class="text-end">
        <label class="form-check form-switch mb-0 d-inline-flex align-items-center justify-content-end">
          <input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="group" data-id="${
            group.id
          }"
            ${checked || force ? "checked" : ""}
            ${force ? "disabled" : ""}
            onchange="updateRegistratorGroupPermission(${
              group.id
            }, this.checked)">
        </label>
        ${
          force
            ? '<small class="text-muted ms-1">(от настроек группы)</small>'
            : ""
        }
      </td>
    `;
    row.innerHTML = html;
    tbody.appendChild(row);
  });
}

// Load users permissions table
function loadUsersPermissionsTable(users, permissions) {
  var tbody = document.getElementById("users-permissions");
  if (!tbody) return;
  tbody.innerHTML = "";
  (users || []).forEach(function (user) {
    var row = document.createElement("tr");
    row.className = "small";
    var checked =
      permissions && permissions[user.id] ? !!permissions[user.id] : false;
    var force = false;
    var inheritedFromGroup = false;
    var isAdminGroupUser = false;

    try {
      var permStr = String((user && user.permission) || "").trim();
      var login = String((user && user.login) || "").toLowerCase();

      // Always force for admin user
      if (login === "admin") {
        force = true;
      } else {
        // Check for full access patterns
        force =
          permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
          permStr === "aef,a,abcdflm,ab,ab,ab" ||
          permStr.indexOf("z") !== -1 ||
          permStr.includes("полный доступ") ||
          permStr.includes("full access");
      }

      // Determine source of permission: group, individual, or force
      var hasIndividualPermission = false;
      var hasGroupPermission = false;

      // Check group permission first (has priority) - use current group states
      if (user.gid) {
        if (
          window.regGroupStates &&
          window.regGroupStates[String(user.gid)] === true
        ) {
          hasGroupPermission = true;
        } else if (
          regCurrentPermissionsDraft.group &&
          regCurrentPermissionsDraft.group[String(user.gid)] === 1
        ) {
          hasGroupPermission = true;
        } else if (
          regLastSavedPermissions &&
          regLastSavedPermissions.group &&
          regLastSavedPermissions.group[String(user.gid)] === 1
        ) {
          hasGroupPermission = true;
        }
      }

      // Check individual user permission only if no group permission
      if (!hasGroupPermission) {
        if (
          regCurrentPermissionsDraft.user &&
          regCurrentPermissionsDraft.user[String(user.id)] === 1
        ) {
          hasIndividualPermission = true;
        } else if (
          regLastSavedPermissions &&
          regLastSavedPermissions.user &&
          regLastSavedPermissions.user[String(user.id)] === 1
        ) {
          hasIndividualPermission = true;
        }
      }

      // Determine final state
      if (force) {
        // Force overrides everything: checked and non-editable
        inheritedFromGroup = false;
        checked = true;
      } else if (hasGroupPermission) {
        inheritedFromGroup = true;
        checked = true;
      } else if (hasIndividualPermission) {
        inheritedFromGroup = false;
        checked = true;
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "loadUsersPermissionsTable");
      }
    }

    // Get group name for display and check if user is from admin group
    var groupName = "";
    if (user.gid && window.currentGroupsData) {
      var group = window.currentGroupsData.find((g) => g.id == user.gid);
      if (group) {
        groupName = " (" + group.name + ")";
        // Check if user is from admin group
        try {
          var adminName = (
            window.adminGroupName || "Программисты"
          ).toLowerCase();
          isAdminGroupUser =
            String(group.name || "").toLowerCase() === adminName;
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "loadUsersPermissionsTable");
          }
        }
      }
    }

    var html = `
      <td>
        <span title="${user.name || ""}">${user.login || ""}${groupName}</span>
        ${
          isAdminGroupUser
            ? '<i class="bi bi-shield-fill-check text-warning ms-1" title="Участник административной группы"></i>'
            : ""
        }
      </td>
      <td class="text-end">
        <label class="form-check form-switch mb-0 d-inline-flex align-items-center justify-content-end">
          <input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="user" data-id="${
            user.id
          }"
            ${checked || force ? "checked" : ""}
            ${force || inheritedFromGroup ? "disabled" : ""}
            onchange="updateRegistratorUserPermission(${
              user.id
            }, this.checked)">
        </label>
        ${
          inheritedFromGroup
            ? '<small class="text-muted ms-1">(от группы)</small>'
            : force
            ? '<small class="text-muted ms-1">(от настроек пользователя)</small>'
            : ""
        }
      </td>
    `;
    row.innerHTML = html;
    tbody.appendChild(row);
  });
}

// Update group permission
window.updateRegistratorGroupPermission = function (groupId, checked) {
  try {
    // Check if this is admin group - prevent disabling
    var adminName = (window.adminGroupName || "Программисты").toLowerCase();
    var groupName = "";
    try {
      var groupRow = document.querySelector(
        `input[data-entity="group"][data-id="${groupId}"]`
      );
      if (groupRow) {
        var groupCell = groupRow.closest("tr").querySelector("td:first-child");
        groupName = ((groupCell && groupCell.textContent) || "").toLowerCase();
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(
          err,
          "updateRegistratorGroupPermission"
        );
      }
    }

    if (groupName === adminName && !checked) {
      // Re-check the checkbox
      setTimeout(() => {
        var input = document.querySelector(
          `input[data-entity="group"][data-id="${groupId}"]`
        );
        if (input) input.checked = true;
      }, 0);
      return;
    }

    if (!regCurrentPermissionsDraft.group)
      regCurrentPermissionsDraft.group = {};
    regCurrentPermissionsDraft.group[String(groupId)] = checked ? 1 : 0;

    // Store group state for visual inheritance (without affecting user permissions in DB)
    if (!window.regGroupStates) window.regGroupStates = {};
    window.regGroupStates[String(groupId)] = checked;

    // Apply changes immediately
    try {
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(
          err,
          "updateRegistratorGroupPermission"
        );
      }
    }
    saveRegPermissions("groups");

    // Update user permissions UI based on group changes (visual only)
    updateUserPermissionsFromGroup(groupId, checked);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateRegistratorGroupPermission");
    }
  }
};

// Update user permission
window.updateRegistratorUserPermission = function (userId, checked) {
  try {
    // Check if this user has force permission (admin or full access)
    var isForceUser = false;
    var userData = window.currentUsersData
      ? window.currentUsersData.find((u) => u.id == userId)
      : null;
    if (userData) {
      var login = String((userData && userData.login) || "").toLowerCase();
      if (login === "admin") {
        isForceUser = true;
      } else if (userData.permission) {
        var permStr = String(userData.permission).trim();
        isForceUser =
          permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
          permStr === "aef,a,abcdflm,ab,ab,ab" ||
          permStr.indexOf("z") !== -1 ||
          permStr.includes("полный доступ") ||
          permStr.includes("full access");
      }
    }
    if (isForceUser) {
      // Re-check the checkbox
      setTimeout(() => {
        var input = document.querySelector(
          `input[data-entity="user"][data-id="${userId}"]`
        );
        if (input) input.checked = true;
      }, 0);
      return;
    }
    if (!regCurrentPermissionsDraft.user) regCurrentPermissionsDraft.user = {};
    regCurrentPermissionsDraft.user[String(userId)] = checked ? 1 : 0;
    saveRegPermissions("users");
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateRegistratorUserPermission");
    }
  }
};

// Update user permissions from group (visual only)
function updateUserPermissionsFromGroup(groupId, enabled) {
  try {
    if (!window.currentUsersData) return;

    // Update UI with current group states (visual inheritance only)
    loadUsersPermissionsTable(
      window.currentUsersData,
      regCurrentPermissionsDraft.user || {}
    );
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateUserPermissionsFromGroup");
    }
  }
}

// Save permissions
function saveRegPermissions(which) {
  var rid = window.currentRegistratorId;
  if (!rid) return;

  // Ensure admin access is always enforced before saving
  var payload = {
    permissions: JSON.parse(JSON.stringify(regCurrentPermissionsDraft)),
  };

  // If saving groups, don't send user permissions at all - they remain unchanged in DB
  if (which === "groups") {
    try {
      if (payload && payload.permissions) {
        delete payload.permissions.user; // Don't send user permissions
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "saveRegPermissions");
      }
    }
  }

  fetch("/registrators/" + encodeURIComponent(rid) + "/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function () {
      // Changes applied successfully - update saved permissions snapshot
      if (which === "groups") {
        // Preserve last-saved user permissions; only update groups
        try {
          var prevUsers =
            (regLastSavedPermissions && regLastSavedPermissions.user) || {};
          var next = JSON.parse(
            JSON.stringify(
              regCurrentPermissionsDraft || { user: {}, group: {} }
            )
          );
          next.user = prevUsers; // keep existing users as they were in DB
          regLastSavedPermissions = next;
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "saveRegPermissions");
          }
          // Fallback: keep existing snapshot
        }
      } else {
        // For user changes, update saved permissions
        regLastSavedPermissions = JSON.parse(
          JSON.stringify(regCurrentPermissionsDraft)
        );
      }

      // Emit socket event for synchronization
      try {
        if (window.socket && typeof window.socket.emit === "function") {
          window.socket.emit("registrator_permissions_updated", {
            registrator_id: rid,
            which: which,
            originClientId: window.__registratorsClientId || "unknown",
          });
        }
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "saveRegPermissions");
        }
      }
    })
    .catch(function (error) {
      if (window.showToast) {
        window.showToast("Ошибка сохранения прав доступа", "error");
      }
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(error, "saveRegPermissions");
      }
    });
}

// Render pagination
function renderPagination(which, resp) {
  var pagination = document.getElementById(which + "-pagination");
  if (!pagination) return;
  pagination.innerHTML = "";
  if (!resp || !resp.pagination) return;
  var p = resp.pagination;
  if (p.pages <= 1) return;
  var current = p.page || 1;
  var pages = p.pages || 1;
  var start = Math.max(1, current - 2);
  var end = Math.min(pages, current + 2);
  if (current > 1) {
    var prev = document.createElement("li");
    prev.className = "page-item";
    prev.innerHTML =
      '<a class="page-link" href="#" data-page="' + (current - 1) + '">‹</a>';
    prev.onclick = function (e) {
      e.preventDefault();
      loadPage(which, current - 1);
    };
    pagination.appendChild(prev);
  }
  for (var i = start; i <= end; i++) {
    var li = document.createElement("li");
    li.className = "page-item" + (i === current ? " active" : "");
    li.innerHTML =
      '<a class="page-link" href="#" data-page="' + i + '">' + i + "</a>";
    li.onclick = function (e) {
      e.preventDefault();
      loadPage(which, parseInt(e.target.getAttribute("data-page")));
    };
    pagination.appendChild(li);
  }
  if (current < pages) {
    var next = document.createElement("li");
    next.className = "page-item";
    next.innerHTML =
      '<a class="page-link" href="#" data-page="' + (current + 1) + '">›</a>';
    next.onclick = function (e) {
      e.preventDefault();
      loadPage(which, current + 1);
    };
    pagination.appendChild(next);
  }
}

// Load page
function loadPage(which, page, q) {
  if (which === "groups") {
    loadRegPermissions(page, null, q, null);
  } else if (which === "users") {
    loadRegPermissions(null, page, null, q);
  }
}

// Export functions to global scope
window.loadRegPermissions = loadRegPermissions;
window.loadGroupsPermissionsTable = loadGroupsPermissionsTable;
window.loadUsersPermissionsTable = loadUsersPermissionsTable;
window.updateUserPermissionsFromGroup = updateUserPermissionsFromGroup;
window.saveRegPermissions = saveRegPermissions;
window.renderPagination = renderPagination;
window.loadPage = loadPage;

