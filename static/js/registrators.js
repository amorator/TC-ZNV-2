(function () {
  "use strict";

  function q(id) {
    return document.getElementById(id);
  }
  function safeOn(el, type, h) {
    try {
      el && el.addEventListener(type, h);
    } catch (_) {}
  }
  function fetchJson(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      return r.json();
    });
  }
  function postJson(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(data),
    }).then(function (r) {
      return r.json();
    });
  }

  function loadRegistrators(page = 1) {
    return fetchJson(`/api/registrators?page=${page}&page_size=10`).then(
      function (j) {
        const wrap = document.getElementById("registrators-nav");
        if (!wrap) return [];
        wrap.innerHTML = "";
        var items = (j.items || []).slice();
        if (items.length === 0) {
          const addBtn = document.createElement("button");
          addBtn.className = "topbtn";
          addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
          addBtn.title = "Добавить регистратор";
          addBtn.onclick = function () {
            if (window.openAddRegistratorModalUI)
              return window.openAddRegistratorModalUI();
            openAddRegistratorModal();
          };
          wrap.appendChild(addBtn);
          try {
            var perm = document.getElementById("permissions-content");
            if (perm) perm.style.display = "none";
          } catch (_) {}
        } else {
          items.forEach(function (it) {
            const btn = document.createElement("button");
            btn.className = "topbtn" + (!it.enabled ? " is-disabled" : "");
            btn.innerHTML = it.name;
            btn.setAttribute("data-registrator-id", it.id);
            btn.onclick = function () {
              selectRegistrator(it.id);
            };
            // Right-click context menu
            btn.addEventListener("contextmenu", function (e) {
              try {
                e.preventDefault();
                e.stopPropagation();
              } catch (_) {}
              const cx =
                typeof e.clientX === "number" ? e.clientX : e.pageX || 0;
              const cy =
                typeof e.clientY === "number" ? e.clientY : e.pageY || 0;
              openRegContextMenu(cx, cy, it);
            });
            // also handle long-press on touch to open context menu
            let tId;
            btn.addEventListener(
              "touchstart",
              function (ev) {
                try {
                  ev.stopPropagation();
                } catch (_) {}
                const touch = ev.touches && ev.touches[0];
                const cx = touch ? touch.clientX : 0;
                const cy = touch ? touch.clientY : 0;
                tId = setTimeout(function () {
                  openRegContextMenu(cx, cy, it);
                }, 500);
              },
              { passive: true }
            );
            ["touchend", "touchcancel", "touchmove"].forEach(function (n) {
              btn.addEventListener(n, function () {
                if (tId) {
                  clearTimeout(tId);
                  tId = null;
                }
              });
            });
            wrap.appendChild(btn);
          });
          const addBtn = document.createElement("button");
          addBtn.className = "topbtn";
          addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
          addBtn.title = "Добавить регистратор";
          addBtn.onclick = function () {
            if (window.openAddRegistratorModalUI)
              return window.openAddRegistratorModalUI();
            openAddRegistratorModal();
          };
          wrap.appendChild(addBtn);
        }
        return items;
      }
    );
  }

  function openRegContextMenu(x, y, item) {
    var menu = document.getElementById("registrators-context-menu");
    if (!menu) return;
    try {
      menu.style.position = "fixed";
      menu.style.zIndex = "2000";
      const vw = Math.max(
        document.documentElement.clientWidth || 0,
        window.innerWidth || 0
      );
      const vh = Math.max(
        document.documentElement.clientHeight || 0,
        window.innerHeight || 0
      );
      const rect = menu.getBoundingClientRect();
      const mw = rect && rect.width ? rect.width : 180;
      const mh = rect && rect.height ? rect.height : 140;
      const left = Math.max(0, Math.min(x, vw - mw - 4));
      const top = Math.max(0, Math.min(y, vh - mh - 4));
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    } catch (_) {
      menu.style.left = x + "px";
      menu.style.top = y + "px";
    }
    menu.classList.remove("d-none");
    menu.style.display = "block";
    var hide = function () {
      menu.classList.add("d-none");
      menu.style.display = "none";
      document.removeEventListener("mousedown", hide, true);
    };
    setTimeout(function () {
      document.addEventListener(
        "mousedown",
        function onDown(ev) {
          try {
            if (ev.button === 2) return;
            const inside =
              ev.target && (ev.target === menu || menu.contains(ev.target));
            if (!inside) hide();
          } catch (_) {
            hide();
          }
        },
        true
      );
    }, 0);
    menu.onclick = function (ev) {
      var actionEl = ev.target.closest("[data-action]");
      if (!actionEl) return;
      var action = actionEl.getAttribute("data-action");
      if (action === "edit") {
        editRegistrator(item);
      } else if (action === "delete") {
        confirmDeleteRegistrator(item);
      } else if (action === "add") {
        if (window.openAddRegistratorModalUI)
          return window.openAddRegistratorModalUI();
        openAddRegistratorModal();
      }
      hide();
    };
  }

  // Wire Add modal submit
  (function bindAddModal() {
    try {
      const btn = document.getElementById("regAddSubmit");
      if (!btn || btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", function () {
        try {
          const name =
            (document.getElementById("regAddName") || {}).value || "";
          const url = (document.getElementById("regAddUrl") || {}).value || "";
          if (!name || !url) return;
          postJson("/registrators", {
            name: name.trim(),
            url_template: url.trim(),
            enabled: 1,
          }).then(function (r) {
            if (r && r.status === "success") {
              try {
                const modalEl = document.getElementById("addRegistratorModal");
                if (modalEl) {
                  // remove focus from inputs before hiding to avoid aria-hidden focus issue
                  try {
                    document.activeElement &&
                      document.activeElement.blur &&
                      document.activeElement.blur();
                  } catch (_) {}
                  try {
                    let m =
                      bootstrap.Modal.getInstance(modalEl) ||
                      new bootstrap.Modal(modalEl);
                    m.hide();
                  } catch (_) {
                    modalEl.setAttribute("aria-hidden", "true");
                    modalEl.style.display = "none";
                    modalEl.classList.remove("show");
                  }
                }
              } catch (_) {}
              loadRegistrators();
            } else if (r && r.message) {
              alert(r.message);
            }
          });
        } catch (_) {}
      });
    } catch (_) {}
  })();

  function editRegistrator(item) {
    var name = prompt("Название регистратора", item.name || "");
    if (!name && name !== "") return;
    var urlTemplate = prompt(
      "Прототип ссылки (используйте <date>, <user>, <time>, <type>, <file>)",
      item.url_template || ""
    );
    if (!urlTemplate && urlTemplate !== "") return;
    postJson("/registrators/" + encodeURIComponent(item.id), {
      name: name,
      url_template: urlTemplate,
      enabled: item.enabled,
    }).then(function (r) {
      if (r && r.status === "success") loadRegistrators();
      else if (r && r.message) alert(r.message);
    });
  }

  function toggleRegistrator(item) {
    var next = item.enabled ? 0 : 1;
    postJson("/registrators/" + encodeURIComponent(item.id), {
      name: item.name,
      url_template: item.url_template,
      enabled: next,
    }).then(function (r) {
      if (r && r.status === "success") loadRegistrators();
    });
  }

  function deleteRegistrator(item) {
    fetch("/registrators/" + encodeURIComponent(item.id), {
      method: "DELETE",
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.status === "success") loadRegistrators();
        else if (j && j.message) alert(j.message);
      });
  }

  function confirmDeleteRegistrator(item) {
    try {
      var m = document.getElementById("deleteRegistratorModal");
      var nameEl = document.getElementById("regDelName");
      var btn = document.getElementById("regDelConfirm");
      if (!m || !btn) return deleteRegistrator(item);
      if (nameEl) nameEl.textContent = item.name || "";
      // rebind click
      if (btn.__bound) btn.removeEventListener("click", btn.__handler);
      btn.__handler = function () {
        try {
          bootstrap.Modal.getInstance(m)?.hide();
        } catch (_) {
          m.style.display = "none";
          m.classList.remove("show");
        }
        deleteRegistrator(item);
      };
      btn.addEventListener("click", btn.__handler);
      btn.__bound = true;
      try {
        new bootstrap.Modal(m).show();
      } catch (_) {
        m.style.display = "block";
        m.classList.add("show");
      }
    } catch (_) {
      deleteRegistrator(item);
    }
  }

  function selectRegistrator(id) {
    window.currentRegistratorId = id;
    try {
      document
        .querySelectorAll("#registrators-nav .topbtn")
        .forEach(function (btn) {
          btn.classList.remove("active");
          if (btn.getAttribute("data-registrator-id") == String(id)) {
            btn.classList.add("active");
          }
        });
    } catch (_) {}
    try {
      var perm = document.getElementById("permissions-content");
      if (perm) perm.style.display = "block";
    } catch (_) {}
    loadRegPermissions();
    var tbody = document.getElementById("registratorFilesTbody");
    if (tbody) tbody.innerHTML = "";
  }

  var regLastSavedPermissions = { user: {}, group: {} };
  var regCurrentPermissionsDraft = { user: {}, group: {} };
  var regDirtyUsers = false;
  var regDirtyGroups = false;

  function enforceAdminAccess(permissions, groups, users) {
    // Force admin group access
    if (groups && groups.length > 0) {
      var adminName = (window.adminGroupName || "Программисты").toLowerCase();
      groups.forEach(function (group) {
        if (String(group.name || "").toLowerCase() === adminName) {
          if (!permissions.group) permissions.group = {};
          permissions.group[String(group.id)] = 1;
        }
      });
    }

    // Force admin and full-access users access
    if (users && users.length > 0) {
      users.forEach(function (user) {
        var force = false;
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
        } catch (_) {}

        if (force) {
          if (!permissions.user) permissions.user = {};
          permissions.user[String(user.id)] = 1;
        }
      });
    }

    return permissions;
  }

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
    ]).then(function (arr) {
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
      regDirtyGroups = false;
      regDirtyUsers = false;
      updateSaveButtonsState();
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
      wireSearchbar("groups");
      wireSearchbar("users");
    });
  }

  function loadGroupsPermissionsTable(groups, permissions) {
    var tbody = document.getElementById("groups-permissions");
    if (!tbody) return;
    tbody.innerHTML = "";
    (groups || []).forEach(function (group) {
      var row = document.createElement("tr");
      var checked =
        permissions && permissions[group.id] ? !!permissions[group.id] : false;
      var isAdminGroup = false;
      try {
        var adminName = (window.adminGroupName || "Программисты").toLowerCase();
        isAdminGroup = String(group.name || "").toLowerCase() === adminName;
      } catch (_) {}
      // Force-enable and lock admin group in draft too
      try {
        if (isAdminGroup) {
          if (!regCurrentPermissionsDraft.group)
            regCurrentPermissionsDraft.group = {};
          regCurrentPermissionsDraft.group[String(group.id)] = 1;
          checked = true; // Force checked state for admin group
        }
      } catch (_) {}
      var html = `
        <td>${group.name || ""}</td>
        <td class="text-end">
          <label class="form-check form-switch mb-0 d-inline-flex align-items-center justify-content-end">
            <input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="group" data-id="${
              group.id
            }" 
              ${checked || isAdminGroup ? "checked" : ""} 
              ${isAdminGroup ? "disabled" : ""} 
              onchange="updateRegistratorGroupPermission(${
                group.id
              }, this.checked)">
          </label>
        </td>
      `;

      row.innerHTML = html;

      // Force disable state after HTML is set
      if (isAdminGroup) {
        var input = row.querySelector('input[type="checkbox"]');
        if (input) {
          input.disabled = true;
          input.checked = true;
          console.log(
            "Forced disabled state for group",
            group.name,
            "input.disabled:",
            input.disabled
          );
        }
      }

      tbody.appendChild(row);
    });
  }

  // Global functions for onchange handlers (like in categories.js)
  window.updateRegistratorGroupPermission = function (groupId, checked) {
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
    } catch (_) {}

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
    regDirtyGroups = true;
    updateSaveButtonsState();
  };

  window.updateRegistratorUserPermission = function (userId, checked) {
    // Check if this is admin or full-access user - prevent disabling
    var userRow = document.querySelector(
      `input[data-entity="user"][data-id="${userId}"]`
    );
    if (userRow) {
      var userCell = userRow.closest("tr").querySelector("td:first-child span");
      var login = ((userCell && userCell.textContent) || "").toLowerCase();

      // Check if admin user
      if (login === "admin" && !checked) {
        setTimeout(() => {
          userRow.checked = true;
        }, 0);
        return;
      }

      // Check if full-access user (we need to get permission string from somewhere)
      // For now, we'll rely on the server-side enforcement
    }

    if (!regCurrentPermissionsDraft.user) regCurrentPermissionsDraft.user = {};
    regCurrentPermissionsDraft.user[String(userId)] = checked ? 1 : 0;
    regDirtyUsers = true;
    updateSaveButtonsState();
  };

  function loadUsersPermissionsTable(users, permissions) {
    var tbody = document.getElementById("users-permissions");
    if (!tbody) return;
    tbody.innerHTML = "";
    (users || []).forEach(function (user) {
      var row = document.createElement("tr");
      var checked =
        permissions && permissions[user.id] ? !!permissions[user.id] : false;
      var force = false;
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

        if (force) {
          if (!regCurrentPermissionsDraft.user)
            regCurrentPermissionsDraft.user = {};
          regCurrentPermissionsDraft.user[String(user.id)] = 1;
          checked = true; // Force checked state for admin/full-access users
        }
      } catch (_) {}
      // Force-enable and lock full-access/admin users in draft too
      try {
        if (force) {
          if (!regCurrentPermissionsDraft.user)
            regCurrentPermissionsDraft.user = {};
          regCurrentPermissionsDraft.user[String(user.id)] = 1;
          checked = true; // Force checked state for admin/full-access users
        }
      } catch (_) {}
      var html = `
        <td><span title="${user.name || ""}">${user.login || ""}</span></td>
        <td class="text-end">
          <label class="form-check form-switch mb-0 d-inline-flex align-items-center justify-content-end">
            <input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="user" data-id="${
              user.id
            }" 
              ${checked || force ? "checked" : ""} 
              ${force ? "disabled" : ""} 
              onchange="updateRegistratorUserPermission(${
                user.id
              }, this.checked)">
          </label>
        </td>
      `;

      row.innerHTML = html;

      // Force disable state after HTML is set
      if (force) {
        var input = row.querySelector('input[type="checkbox"]');
        if (input) {
          input.disabled = true;
          input.checked = true;
        }
      }

      tbody.appendChild(row);
    });
  }

  // radios removed (view-only toggles now)

  function renderPagination(which, resp) {
    try {
      var el = document.getElementById(
        which === "groups" ? "groups-pagination" : "users-pagination"
      );
      if (!el) return;
      el.innerHTML = "";
      var totalPages = parseInt(resp.total_pages || 1, 10);
      var currentPage = parseInt(resp.page || 1, 10);
      for (var i = 1; i <= totalPages; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.className =
          "btn btn-sm " +
          (i === currentPage ? "btn-primary" : "btn-outline-primary");
        b.textContent = i;
        (function (page) {
          b.addEventListener("click", function () {
            if (which === "groups") loadRegPermissions(page, null);
            else loadRegPermissions(null, page);
          });
        })(i);
        el.appendChild(b);
      }
    } catch (_) {}
  }

  function wireSearchbar(which) {
    try {
      var input = document.getElementById(
        which === "groups" ? "groups-search" : "users-search"
      );
      if (!input) return;
      var timeout;
      input.addEventListener("input", function () {
        clearTimeout(timeout);
        timeout = setTimeout(function () {
          if (which === "groups")
            loadRegPermissions(1, null, input.value, null);
          else loadRegPermissions(null, 1, null, input.value);
        }, 250);
      });
    } catch (_) {}
  }

  function updateSaveButtonsState() {
    var g = document.getElementById("save-groups");
    var u = document.getElementById("save-users");
    if (g) g.disabled = !regDirtyGroups;
    if (u) u.disabled = !regDirtyUsers;
  }

  function saveRegPermissions(which) {
    var rid = window.currentRegistratorId;
    if (!rid) return;

    // Ensure admin access is always enforced before saving
    var payload = {
      permissions: JSON.parse(JSON.stringify(regCurrentPermissionsDraft)),
    };

    fetch("/registrators/" + encodeURIComponent(rid) + "/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function () {
        if (which === "groups") regDirtyGroups = false;
        else if (which === "users") regDirtyUsers = false;
        else {
          regDirtyGroups = false;
          regDirtyUsers = false;
        }
        updateSaveButtonsState();
      });
  }

  function openAddRegistratorModal() {
    var name = prompt("Название регистратора");
    if (!name) return;
    var localFolder = prompt("Папка на диске (a-z, A-Z, 0-9, -, _)");
    if (!localFolder) return;
    var urlTemplate = prompt(
      "Прототип ссылки, например: https://host/{date}/{user}/{time}/{type}/{file} (обязательно {file})"
    );
    if (!urlTemplate) return;
    postJson("/registrators", {
      name: name,
      local_folder: localFolder,
      url_template: urlTemplate,
      enabled: 1,
    }).then(function (j) {
      if (j && j.status === "success") loadRegistrators();
      else if (j && j.message) alert(j.message);
    });
  }

  function enableLevel(selectId, enable) {
    var el = q(selectId);
    if (el) {
      el.disabled = !enable;
      el.innerHTML = "";
    }
  }

  function browse(rid, level, parent) {
    var url =
      "/registrators/" +
      encodeURIComponent(rid) +
      "/browse?level=" +
      encodeURIComponent(level);
    if (parent) url += "&parent=" + encodeURIComponent(parent);
    return fetchJson(url).then(function (j) {
      return j.entries || [];
    });
  }

  function fillSelect(el, items) {
    el.innerHTML = "";
    items.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      el.appendChild(o);
    });
  }

  function refreshLevels() {
    const rid = q("regSelect")?.value;
    if (!rid) return;
    browse(rid, "date", "").then(function (items) {
      fillSelect(q("dateSelect"), items);
      enableLevel("dateSelect", true);
    });
  }

  function onDate() {
    const rid = q("regSelect")?.value;
    const date = q("dateSelect")?.value;
    if (!rid || !date) return;
    browse(rid, "user", date).then(function (items) {
      fillSelect(q("userSelect"), items);
      enableLevel("userSelect", true);
      enableLevel("timeSelect", false);
      enableLevel("typeSelect", false);
      q("filesList").innerHTML = "";
    });
  }
  function onUser() {
    const rid = q("regSelect")?.value;
    const date = q("dateSelect")?.value;
    const user = q("userSelect")?.value;
    if (!rid || !date || !user) return;
    browse(rid, "time", date + "/" + user).then(function (items) {
      fillSelect(q("timeSelect"), items);
      enableLevel("timeSelect", true);
      enableLevel("typeSelect", false);
      q("filesList").innerHTML = "";
    });
  }
  function onTime() {
    const rid = q("regSelect")?.value;
    const date = q("dateSelect")?.value;
    const user = q("userSelect")?.value;
    const time = q("timeSelect")?.value;
    if (!rid || !date || !user || !time) return;
    browse(rid, "type", date + "/" + user + "/" + time).then(function (items) {
      fillSelect(q("typeSelect"), items);
      enableLevel("typeSelect", true);
      q("filesList").innerHTML = "";
    });
  }
  function onType() {
    const rid = q("regSelect")?.value;
    const date = q("dateSelect")?.value;
    const user = q("userSelect")?.value;
    const time = q("timeSelect")?.value;
    const type = q("typeSelect")?.value;
    if (!rid || !date || !user || !time || !type) return;
    browse(rid, "file", date + "/" + user + "/" + time + "/" + type).then(
      function (items) {
        const wrap = q("filesList");
        wrap.innerHTML = "";
        (items || []).forEach(function (n) {
          var id = "f_" + Math.random().toString(36).slice(2);
          var lbl = document.createElement("label");
          lbl.className = "form-check form-check-inline";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "form-check-input";
          cb.value = n;
          cb.id = id;
          var sp = document.createElement("span");
          sp.className = "form-check-label";
          sp.textContent = n;
          sp.htmlFor = id;
          lbl.appendChild(cb);
          lbl.appendChild(sp);
          wrap.appendChild(lbl);
        });
        updateImportButton();
      }
    );
  }

  function updateImportButton() {
    const wrap = q("filesList");
    const btn = q("btnImportSelected");
    if (!wrap || !btn) return;
    const checked = wrap.querySelectorAll('input[type="checkbox"]:checked');
    btn.disabled = checked.length === 0;
  }

  function currentParts() {
    return {
      date: q("dateSelect")?.value || "",
      user: q("userSelect")?.value || "",
      time: q("timeSelect")?.value || "",
      type: q("typeSelect")?.value || "",
    };
  }

  function importSelected() {
    const rid = q("regSelect")?.value;
    if (!rid) return;
    const parts = currentParts();
    const wrap = q("filesList");
    const files = Array.prototype.map.call(
      wrap.querySelectorAll('input[type="checkbox"]:checked'),
      function (cb) {
        return cb.value;
      }
    );
    if (!files.length) return;
    var catId = parseInt(window.currentCategoryId || 0, 10) || 0;
    var subId = parseInt(window.currentSubcategoryId || 0, 10) || 0;
    if (!catId || !subId) {
      if (window.regDefaultCatId)
        catId = parseInt(window.regDefaultCatId, 10) || catId;
      if (window.regDefaultSubId)
        subId = parseInt(window.regDefaultSubId, 10) || subId;
    }
    const payload = {
      category_id: catId,
      subcategory_id: subId,
      base_parts: parts,
      files: files,
    };
    const url = "/registrators/" + encodeURIComponent(rid) + "/import";
    const btn = q("btnImportSelected");
    if (btn) btn.disabled = true;
    postJson(url, payload)
      .then(function (j) {
        try {
          if (window.appNotify)
            window.appNotify(
              j.status === "success"
                ? "Импорт начат"
                : j.message || "Ошибка импорта"
            );
        } catch (_) {}
        if (btn) btn.disabled = false;
      })
      .catch(function () {
        if (btn) btn.disabled = false;
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadRegistrators().then(function (items) {
      if (items && items.length) selectRegistrator(items[0].id);
      refreshLevels();
    });
    safeOn(document.getElementById("save-groups"), "click", function () {
      saveRegPermissions("groups");
    });
    safeOn(document.getElementById("save-users"), "click", function () {
      saveRegPermissions("users");
    });
    safeOn(q("dateSelect"), "change", onDate);
    safeOn(q("userSelect"), "change", onUser);
    safeOn(q("timeSelect"), "change", onTime);
    safeOn(q("typeSelect"), "change", onType);
    safeOn(q("filesList"), "change", updateImportButton);
    safeOn(q("btnImportSelected"), "click", importSelected);
  });
})();
