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
        "&page_size=10" +
        (termGroups
          ? "&search=" + encodeURIComponent(termGroups) +
            "&q=" + encodeURIComponent(termGroups)
          : "")
    , { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then(function (r) {
      return r.json();
    }),
    fetch(
      "/api/users?page=" +
        (pageUsers || 1) +
        "&page_size=10" +
        (termUsers
          ? "&search=" + encodeURIComponent(termUsers) +
            "&q=" + encodeURIComponent(termUsers)
          : "")
    , { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then(function (r) {
      return r.json();
    }),
    fetch("/registrators/" + encodeURIComponent(rid) + "/permissions", { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then(
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

      // Use backend-enforced permissions as-is

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

      // Persist current pages per registrator
      try {
        var gid = String(window.currentRegistratorId || '0');
        if (groupsResp && (groupsResp.page || groupsResp.page === 1)) {
          localStorage.setItem('registrators:lastPage:groups:' + gid, String(groupsResp.page || 1));
        }
        if (usersResp && (usersResp.page || usersResp.page === 1)) {
          localStorage.setItem('registrators:lastPage:users:' + gid, String(usersResp.page || 1));
        }
      } catch(_) {}
      // Re-bind search inputs after DOM updates
      bindRegistratorsSearchbars();
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
    // Reflect actual state: force admin group to 1, otherwise use stored checked value
    regCurrentPermissionsDraft.group[String(group.id)] = (force ? 1 : (checked ? 1 : 0));
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
    var isAdminGroupUser = false;
    var forceUser = false;
    var groupAllows = false;

    // Determine group allow state
    if (user.gid) {
      var gidStr = String(user.gid);
      if (window.regGroupStates && window.regGroupStates[gidStr] === true) {
        groupAllows = true;
      } else if (regCurrentPermissionsDraft.group && regCurrentPermissionsDraft.group[gidStr] === 1) {
        groupAllows = true;
      } else if (regLastSavedPermissions && regLastSavedPermissions.group && regLastSavedPermissions.group[gidStr] === 1) {
        groupAllows = true;
      }
    }

    try {
      var permStr = String((user && user.permission) || "").trim();
      var login = String((user && user.login) || "").toLowerCase();
      if (login === "admin") {
        forceUser = true;
      } else {
        forceUser =
          permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
          permStr === "aef,a,abcdflm,ab,ab,ab" ||
          permStr.indexOf("z") !== -1 ||
          permStr.includes("полный доступ") ||
          permStr.includes("full access");
      }

      // Determine user selection: 'inherit' (default), 'none', 'all'
      var uidStr = String(user.id);
      var sel = 'inherit';
      var uby = (regCurrentPermissionsDraft.user_by_id && regCurrentPermissionsDraft.user_by_id[uidStr])
        || (regLastSavedPermissions && regLastSavedPermissions.user_by_id && regLastSavedPermissions.user_by_id[uidStr]) || {};
      if (uby && typeof uby === 'object') {
        var hasAnyAxisKey = ('inherit' in uby) || ('view_inherit' in uby) || ('view_all' in uby) || ('view_group' in uby) || ('view_own' in uby);
        if (!hasAnyAxisKey) {
          sel = 'inherit';
        } else {
          var inh = parseInt(uby.inherit || uby.view_inherit || 0, 10) || 0;
          if (inh === 1) {
            sel = 'inherit';
          } else if (parseInt(uby.view_all || 0, 10) === 1) {
            sel = 'all';
          } else if ((parseInt(uby.view_group || 0, 10) === 1) || (parseInt(uby.view_own || 0, 10) === 1)) {
            // collapse to all/none for registrators view toggle; treat any positive as allow
            sel = 'all';
          } else {
            // legacy allow via map
            var allowMap = (regCurrentPermissionsDraft.user && regCurrentPermissionsDraft.user[uidStr] === 1) ||
                           (regLastSavedPermissions && regLastSavedPermissions.user && regLastSavedPermissions.user[uidStr] === 1);
            sel = allowMap ? 'all' : 'none';
          }
        }
      } else {
        var allowMap2 = (regCurrentPermissionsDraft.user && regCurrentPermissionsDraft.user[uidStr] === 1) ||
                        (regLastSavedPermissions && regLastSavedPermissions.user && regLastSavedPermissions.user[uidStr] === 1);
        sel = allowMap2 ? 'all' : 'inherit';
      }

      // Keep actual selection (inherit/none/all) without visual forcing
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
      <td>
        <div class="d-flex flex-column align-items-start">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="reg-u_view_${user.id}" id="reg-u_view_inherit_${user.id}" value="inherit" ${ sel==='inherit'?'checked':'' } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateRegistratorUserLevel(${user.id}, this.value)">
            <label class="form-check-label" for="reg-u_view_inherit_${user.id}">Наследовать</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="reg-u_view_${user.id}" id="reg-u_view_none_${user.id}" value="none" ${ sel==='none'?'checked':'' } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateRegistratorUserLevel(${user.id}, this.value)">
            <label class="form-check-label" for="reg-u_view_none_${user.id}">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="reg-u_view_${user.id}" id="reg-u_view_all_${user.id}" value="all" ${ sel==='all'?'checked':'' } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateRegistratorUserLevel(${user.id}, this.value)">
            <label class="form-check-label" for="reg-u_view_all_${user.id}">Да</label>
          </div>
          
        </div>
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
window.updateRegistratorUserLevel = function (userId, level) {
  try {
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
      setTimeout(() => {
        var input = document.querySelector(
          `input[name="reg-u_view_${userId}"]#reg-u_view_all_${userId}`
        );
        if (input) input.checked = true;
      }, 0);
      return;
    }
    var uid = String(userId);
    if (!regCurrentPermissionsDraft.user_by_id) regCurrentPermissionsDraft.user_by_id = {};
    if (!regCurrentPermissionsDraft.user) regCurrentPermissionsDraft.user = {};
    var base = regCurrentPermissionsDraft.user_by_id[uid] || {};
    if (level === 'inherit') {
      base.inherit = 1;
      regCurrentPermissionsDraft.user[uid] = 0; // no explicit allow
    } else if (level === 'all') {
      base.inherit = 0;
      regCurrentPermissionsDraft.user[uid] = 1; // explicit allow
    } else if (level === 'none') {
      base.inherit = 0;
      regCurrentPermissionsDraft.user[uid] = 0; // explicit deny
    }
    regCurrentPermissionsDraft.user_by_id[uid] = base;

    // Save immediately only the changed user
    var rid = window.currentRegistratorId;
    if (!rid) return;
    var payload = { permissions: { user_by_id: {} } };
    payload.permissions.user_by_id[uid] = base;
    fetch("/registrators/" + encodeURIComponent(rid) + "/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function(r){ return r.json(); }).then(function(){
      // refresh saved snapshot
      try {
        if (!regLastSavedPermissions) regLastSavedPermissions = {};
        if (!regLastSavedPermissions.user_by_id) regLastSavedPermissions.user_by_id = {};
        regLastSavedPermissions.user_by_id[uid] = JSON.parse(JSON.stringify(base));
      } catch(_){}
    }).catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'updateRegistratorUserLevel'); });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateRegistratorUserLevel");
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
            // Also reset current draft's user map to DB snapshot to avoid drift
            if (!regCurrentPermissionsDraft) regCurrentPermissionsDraft = {};
            regCurrentPermissionsDraft.user = JSON.parse(
              JSON.stringify(prevUsers)
            );
            // Refresh users table to reflect visual changes only
            try {
              loadUsersPermissionsTable(
                window.currentUsersData || [],
                regCurrentPermissionsDraft.user || {}
              );
            } catch (_) {}
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
  if (!resp) return;
  var p = (resp && resp.pagination) || {};
  // Fallback to total/page/page_size if pagination object is absent
  var total = typeof resp.total === 'number' ? resp.total : (p.total || 0);
  var pageSize = typeof resp.page_size === 'number' ? resp.page_size : (p.page_size || 10);
  var pages = p.pages ? (parseInt(p.pages, 10) || 1) : Math.max(1, Math.ceil((total || 0) / (pageSize || 10)));
  var current = p.page ? (parseInt(p.page, 10) || 1) : (parseInt(resp.page, 10) || 1);
  current = Math.min(Math.max(1, current || 1), pages);
  // Render controls even for single page to keep consistent UI

  var getRegSearchValue = function(which){
    try {
      var inputId = which === 'groups' ? 'groups-search' : 'users-search';
      var input = document.getElementById(inputId);
      return ((input && input.value) || '').trim();
    } catch(_) { return ''; }
  };

  var mk = function (label, targetPage, disabled, active) {
    var li = document.createElement("li");
    li.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
    var a = document.createElement("a");
    a.className = "page-link";
    // Build explicit href on current path with separate params per list
    try {
      var u = new URL(window.location.href);
      var size = pageSize || 10;
      if (which === 'groups') {
        u.searchParams.set('page_groups', String(targetPage));
        u.searchParams.set('page_size_groups', String(size));
      } else {
        u.searchParams.set('page_users', String(targetPage));
        u.searchParams.set('page_size_users', String(size));
      }
      a.href = u.pathname + '?' + u.searchParams.toString();
    } catch(_) { a.href = '#'; }
    a.setAttribute("data-page", String(targetPage));
    a.textContent = String(label);
    a.onclick = function (e) {
      e.preventDefault();
      if (disabled) return;
      try {
        var key = 'registrators:lastPage:' + which + ':' + String(window.currentRegistratorId || '0');
        localStorage.setItem(key, String(targetPage));
      } catch(_) {}
      var q = getRegSearchValue(which);
      loadPage(which, targetPage, q);
      // Reflect in URL without reload
      try {
        var u2 = new URL(window.location.href);
        var size2 = pageSize || 10;
        if (which === 'groups') {
          u2.searchParams.set('page_groups', String(targetPage));
          u2.searchParams.set('page_size_groups', String(size2));
        } else {
          u2.searchParams.set('page_users', String(targetPage));
          u2.searchParams.set('page_size_users', String(size2));
        }
        window.history.replaceState(null, '', u2.pathname + '?' + u2.searchParams.toString());
      } catch(_) {}
    };
    li.appendChild(a);
    return li;
  };

  // Prev controls
  pagination.appendChild(mk("«", 1, current === 1, false));
  pagination.appendChild(mk("‹", Math.max(1, current - 1), current === 1, false));

  // Always first page
  pagination.appendChild(mk("1", 1, false, current === 1));

  // Middle window
  var windowSize = 3;
  var start = Math.max(2, current - 1);
  var end = Math.min(pages - 1, current + 1);
  while (end - start + 1 < windowSize && start > 2) start--;
  while (end - start + 1 < windowSize && end < pages - 1) end++;

  if (start > 2) {
    var li1 = document.createElement("li");
    li1.className = "page-item disabled";
    li1.innerHTML = '<span class="page-link">…</span>';
    pagination.appendChild(li1);
  }

  for (var i = start; i <= end; i++) {
    pagination.appendChild(mk(String(i), i, false, i === current));
  }

  if (end < pages - 1) {
    var li2 = document.createElement("li");
    li2.className = "page-item disabled";
    li2.innerHTML = '<span class="page-link">…</span>';
    pagination.appendChild(li2);
  }

  // Always last page
  if (pages > 1) {
    pagination.appendChild(mk(String(pages), pages, false, current === pages));
  }

  // Next controls
  pagination.appendChild(mk("›", Math.min(pages, current + 1), current === pages, false));
  pagination.appendChild(mk("»", pages, current === pages, false));
}

// Load page
function loadPage(which, page, q) {
  if (which === "groups") {
    loadRegPermissions(page, null, q, null);
  } else if (which === "users") {
    loadRegPermissions(null, page, null, q);
  }
}

// Bind searchbars (groups/users) to server-side filtering
function bindRegistratorsSearchbars() {
  try {
    var gx = document.getElementById('groups-search') || (function(){ var el = document.querySelector('#registrars-tab .searchbar input[name="groups-search"], #registrars-tab #groups-search, #registrars-tab .searchbar input, #registrars-tab input[type="text"]'); if (el && !el.id) el.id = 'groups-search'; if (el && !el.name) el.name = 'groups-search'; return el; })();
    var ux = document.getElementById('users-search') || (function(){ var el = document.querySelector('#registrars-tab .searchbar input[name="users-search"], #registrars-tab #users-search, #registrars-tab .searchbar input, #registrars-tab input[type="text"]'); if (el && !el.id) el.id = 'users-search'; if (el && !el.name) el.name = 'users-search'; return el; })();
    var debounce = function(fn, ms){
      var t;
      return function(){
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function(){ fn.apply(self, args); }, ms);
      };
    };
    if (gx && !gx._regBound) {
      gx._regBound = true;
      // Restore saved term
      try { var gid = String(window.currentRegistratorId || '0'); var skey = 'registrators:search:groups:' + gid; var saved = localStorage.getItem(skey) || ''; if (saved) gx.value = saved; } catch(_) {}
      var gHandler = debounce(function(){
        var val = (gx.value || '').trim();
        // Persist term
        try { var gid = String(window.currentRegistratorId || '0'); var skey = 'registrators:search:groups:' + gid; if (val) localStorage.setItem(skey, val); else localStorage.removeItem(skey); } catch(_) {}
        // Restore saved page on empty, otherwise go to 1
        var page = 1;
        if (!val) {
          try {
            var key = 'registrators:lastPage:groups:' + String(window.currentRegistratorId || '0');
            var saved = parseInt(localStorage.getItem(key) || '0', 10) || 0;
            if (saved > 0) page = saved;
          } catch(_) {}
        }
        loadPage('groups', page, val);
      }, 300);
      gx.addEventListener('input', gHandler);
      gx.addEventListener('change', gHandler);
      gx.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); gHandler(); }});
      // Ensure clear button exists next to input (inline, no wrap)
      try {
        var wrap = gx.parentElement;
        if (wrap) {
          try { wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.flexWrap = 'nowrap'; } catch(_) {}
        }
        var hasBtn = wrap && wrap.querySelector('button[data-role="clear-search-groups"]');
        if (!hasBtn && wrap) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-sm btn-outline-secondary ms-2';
          btn.setAttribute('data-role', 'clear-search-groups');
          btn.title = 'Очистить';
          btn.innerHTML = '<i class="bi bi-x"></i>';
          btn.addEventListener('click', function(){ gx.value=''; gHandler(); gx.focus(); });
          wrap.appendChild(btn);
        }
      } catch(_) {}
    }
    if (ux && !ux._regBound) {
      ux._regBound = true;
      // Restore saved term
      try { var gid2 = String(window.currentRegistratorId || '0'); var skey2 = 'registrators:search:users:' + gid2; var saved2 = localStorage.getItem(skey2) || ''; if (saved2) ux.value = saved2; } catch(_) {}
      var uHandler = debounce(function(){
        var val = (ux.value || '').trim();
        // Persist term
        try { var gid2 = String(window.currentRegistratorId || '0'); var skey2 = 'registrators:search:users:' + gid2; if (val) localStorage.setItem(skey2, val); else localStorage.removeItem(skey2); } catch(_) {}
        var page = 1;
        if (!val) {
          try {
            var key = 'registrators:lastPage:users:' + String(window.currentRegistratorId || '0');
            var saved = parseInt(localStorage.getItem(key) || '0', 10) || 0;
            if (saved > 0) page = saved;
          } catch(_) {}
        }
        loadPage('users', page, val);
      }, 300);
      ux.addEventListener('input', uHandler);
      ux.addEventListener('change', uHandler);
      ux.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); uHandler(); }});
      // Ensure clear button exists next to input (inline, no wrap)
      try {
        var wrap2 = ux.parentElement;
        if (wrap2) {
          try { wrap2.style.display = 'flex'; wrap2.style.alignItems = 'center'; wrap2.style.flexWrap = 'nowrap'; } catch(_) {}
        }
        var hasBtn2 = wrap2 && wrap2.querySelector('button[data-role="clear-search-users"]');
        if (!hasBtn2 && wrap2) {
          var btn2 = document.createElement('button');
          btn2.type = 'button';
          btn2.className = 'btn btn-sm btn-outline-secondary ms-2';
          btn2.setAttribute('data-role', 'clear-search-users');
          btn2.title = 'Очистить';
          btn2.innerHTML = '<i class="bi bi-x"></i>';
          btn2.addEventListener('click', function(){ ux.value=''; uHandler(); ux.focus(); });
          wrap2.appendChild(btn2);
        }
      } catch(_) {}
    }
  } catch(err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, 'bindRegistratorsSearchbars');
    }
  }
}

// Bind on DOM ready
(function(){
  function ensureUrlSizes(){
    try {
      var u = new URL(window.location.href);
      var changed = false;
      if (!u.searchParams.get('page_size_groups')) { u.searchParams.set('page_size_groups', '10'); changed = true; }
      if (!u.searchParams.get('page_size_users')) { u.searchParams.set('page_size_users', '10'); changed = true; }
      if (changed) {
        window.history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString());
      }
    } catch(_) {}
  }
  function run(){ ensureUrlSizes(); bindRegistratorsSearchbars(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

// Export functions to global scope
window.loadRegPermissions = loadRegPermissions;
window.loadGroupsPermissionsTable = loadGroupsPermissionsTable;
window.loadUsersPermissionsTable = loadUsersPermissionsTable;
window.updateUserPermissionsFromGroup = updateUserPermissionsFromGroup;
window.saveRegPermissions = saveRegPermissions;
window.renderPagination = renderPagination;
window.loadPage = loadPage;

