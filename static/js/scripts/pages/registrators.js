(function modalHelpers() {
  if (window.__modalHelpersInstalled) return;
  window.__modalHelpersInstalled = true;
  window.showModalEl = function (el) {
    try {
      // Ensure aria-hidden is cleared before show (avoid focused hidden ancestor)
      try {
        el.removeAttribute("aria-hidden");
      } catch (_) {}
      // Blur focus, let Bootstrap manage aria attributes (match categories.js behavior)
      try {
        document.activeElement &&
          document.activeElement.blur &&
          document.activeElement.blur();
      } catch (_) {}
      try {
        (bootstrap.Modal.getInstance(el) || new bootstrap.Modal(el)).show();
      } catch (_) {}
    } catch (_) {}
  };
  window.hideModalEl = function (el) {
    try {
      // Blur any focused element inside to avoid aria-hidden focus trap
      try {
        var ae = document.activeElement;
        if (ae && (ae === el || el.contains(ae))) {
          ae.blur && ae.blur();
        }
      } catch (_) {}
      // Proactively move focus away before Bootstrap toggles aria-hidden
      try {
        document.body &&
          typeof document.body.focus === "function" &&
          document.body.focus();
      } catch (_) {}
      // Hide on next tick to ensure focus change is committed
      try {
        var inst =
          bootstrap && bootstrap.Modal && bootstrap.Modal.getInstance(el);
        if (!inst && bootstrap && bootstrap.Modal)
          inst = new bootstrap.Modal(el);
        if (inst && inst.hide) {
          setTimeout(function () {
            try {
              inst.hide();
            } catch (_) {}
          }, 0);
        }
      } catch (_) {}
    } catch (_) {}
  };
})();
(function () {
  "use strict";

  // Ensure focus leaves the modal before Bootstrap applies aria-hidden on hide
  (function installModalFocusGuards() {
    try {
      if (window.__regModalGuardsInstalled) return;
      window.__regModalGuardsInstalled = true;
      document.addEventListener(
        "hide.bs.modal",
        function (ev) {
          try {
            var el = ev && ev.target;
            var ae = document.activeElement;
            if (el && ae && (ae === el || el.contains(ae))) {
              if (typeof ae.blur === "function") ae.blur();
              if (document.body && typeof document.body.focus === "function")
                document.body.focus();
            }
          } catch (_) {}
        },
        true
      );
    } catch (_) {}
  })();

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
  function putJson(url, data) {
    return fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(data),
    }).then(function (r) {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      }
      const contentType = r.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected JSON response, got: ${contentType}`);
      }
      return r.json();
    });
  }

  function loadRegistrators(page = 1) {
    const ts = Date.now();
    return fetchJson(
      `/api/registrators?page=${page}&page_size=10&_ts=${ts}`
    ).then(function (j) {
      const wrap = document.getElementById("registrators-nav");
      if (!wrap) return [];
      wrap.innerHTML = "";
      var items = (j.items || []).slice();
      var prevActiveId = 0;
      try {
        prevActiveId = parseInt(window.currentRegistratorId || 0, 10) || 0;
      } catch (_) {}
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
            const cx = typeof e.clientX === "number" ? e.clientX : 0;
            const cy = typeof e.clientY === "number" ? e.clientY : 0;
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
            btn.addEventListener(
              n,
              function () {
                if (tId) {
                  clearTimeout(tId);
                  tId = null;
                }
              },
              { passive: true }
            );
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
      // Restore selection: prefer previously active id if it still exists; else first enabled; else first
      try {
        var toSelectId = 0;
        if (prevActiveId) {
          var stillExists = items.some(function (it) {
            return String(it.id) === String(prevActiveId);
          });
          if (stillExists) toSelectId = prevActiveId;
        }
        if (!toSelectId) {
          var firstEnabled = items.find(function (it) {
            return it && (it.enabled === 1 || it.enabled === true);
          });
          if (firstEnabled) toSelectId = firstEnabled.id;
          else if (items[0]) toSelectId = items[0].id;
        }
        if (toSelectId) {
          window.currentRegistratorId = toSelectId;
          try {
            // Apply active class visually
            var btns = wrap.querySelectorAll(".topbtn");
            btns.forEach(function (b) {
              b.classList.remove("active");
            });
            var selBtn = wrap.querySelector(
              '[data-registrator-id="' + String(toSelectId) + '"]'
            );
            if (selBtn) selBtn.classList.add("active");
          } catch (_) {}
        }
      } catch (_) {}
      // Cache items globally for context menu lookup
      try {
        window.__registratorsItems = Array.isArray(items) ? items.slice() : [];
      } catch (_) {}
      return items;
    });
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
    // Set toggle item label
    try {
      var list = menu.querySelector(".context-menu__list");
      var tgl = list && list.querySelector('[data-action="toggle"]');
      if (tgl)
        tgl.textContent = item && item.enabled ? "Отключить" : "Включить";
    } catch (_) {}
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
      } else if (action === "toggle") {
        toggleRegistrator(item);
      }
      hide();
    };
  }

  // Helper to get currently selected registrator from the UI
  function getCurrentRegistratorItem() {
    try {
      var activeBtn = document.querySelector(
        "#registrators-nav .topbtn.active"
      );
      if (!activeBtn) return null;
      var id = parseInt(
        activeBtn.getAttribute("data-registrator-id") || "0",
        10
      );
      if (!id) {
        // Fallback to window.currentRegistratorId
        id = parseInt(window.currentRegistratorId || 0, 10) || 0;
      }
      if (!id) return null;
      var name = (activeBtn.textContent || "").trim();
      var enabled = activeBtn.classList.contains("is-disabled") ? 0 : 1;
      var url_template = "";
      if (Array.isArray(window.__registratorsItems)) {
        try {
          var found = window.__registratorsItems.find(function (it) {
            return String(it.id) === String(id);
          });
          if (found) {
            name = name || found.name || "";
            if (typeof found.enabled !== "undefined") enabled = found.enabled;
            if (found.url_template) url_template = found.url_template;
          }
        } catch (_) {}
      }
      return {
        id: id,
        name: name,
        enabled: enabled,
        url_template: url_template,
      };
    } catch (_) {
      return null;
    }
  }

  // Initialize global context menu for registrators page (open anywhere on page)
  (function initRegistratorsContextMenu() {
    function bindHandlers() {
      try {
        var menu = document.getElementById("registrators-context-menu");
        if (!menu) return;

        function handler(e) {
          // Only act on registrators page, ignore clicks inside menu itself
          if (!document.getElementById("registrators-context-menu")) return;
          if (
            e.target &&
            e.target.closest &&
            e.target.closest("#registrators-context-menu")
          )
            return;
          // Don't interfere with inputs in modals
          if (e.target && e.target.closest && e.target.closest(".modal.show"))
            return;
          e.preventDefault();
          e.stopPropagation();
          var current = getCurrentRegistratorItem();
          if (!current) return;
          var x = typeof e.clientX === "number" ? e.clientX : 0;
          var y = typeof e.clientY === "number" ? e.clientY : 0;
          openRegContextMenu(x, y, current);
        }

        // Bind on header like categories and also on document to allow anywhere
        var header = document.querySelector(".app-topbar");
        if (header && !header.__regCtxBound) {
          header.__regCtxBound = true;
          header.addEventListener("contextmenu", handler, { capture: true });
          try {
            header.querySelectorAll(".topbtn").forEach(function (btn) {
              btn.addEventListener("contextmenu", handler, { capture: true });
            });
          } catch (_) {}
        }
        if (!document.__regCtxBound) {
          document.__regCtxBound = true;
          document.addEventListener("contextmenu", handler, true);
        }

        // Also bind to main content container if present for extra reliability
        try {
          var pageRoot = document.querySelector("body");
          if (pageRoot && !pageRoot.__regCtxBound) {
            pageRoot.__regCtxBound = true;
            pageRoot.addEventListener("contextmenu", handler, true);
          }
        } catch (_) {}
      } catch (_) {}
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function once() {
        document.removeEventListener("DOMContentLoaded", once);
        bindHandlers();
      });
    } else {
      bindHandlers();
    }
  })();

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
                if (modalEl) hideModalEl(modalEl);
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
    if (window.openEditRegistratorModalUI)
      return window.openEditRegistratorModalUI(item);
    // Fallback to prompt if modal not available
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
    try {
      if (!item || !item.id) return;
      var newEnabled = !(item.enabled === 1 || item.enabled === true);
      putJson("/registrators/" + encodeURIComponent(item.id), {
        name: item.name || "",
        url_template: item.url_template || "",
        enabled: newEnabled ? 1 : 0,
      })
        .then(function (r) {
          if (r && r.status === "success") {
            loadRegistrators();
          } else if (r && r.message) {
            if (window.showToast) window.showToast(r.message, "error");
            else alert(r.message);
          }
        })
        .catch(function (e) {
          if (window.showToast)
            window.showToast("Ошибка переключения: " + e.message, "error");
          else alert("Ошибка переключения: " + e.message);
        });
    } catch (e) {
      if (window.showToast)
        window.showToast("Ошибка переключения: " + e.message, "error");
      else alert("Ошибка переключения: " + e.message);
    }
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
        if (j && j.status === "success") {
          loadRegistrators();
          // Server emits registrators:changed; no client-side emit
        } else if (j && j.message) alert(j.message);
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
        hideModalEl(m);
        deleteRegistrator(item);
      };
      btn.addEventListener("click", btn.__handler);
      btn.__bound = true;
      showModalEl(m);
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
  var regOriginalUserPermissions = { user: {}, group: {} }; // Store original state before group changes
  // Snapshot of user permissions captured at the moment a group is enabled, used to restore later
  window.groupUserSnapshot = {};
  // Removed dirty flags - changes are applied immediately

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
      regOriginalUserPermissions = JSON.parse(JSON.stringify(perms)); // Store original state
      try {
        window.groupUserSnapshot = JSON.parse(
          JSON.stringify((perms && perms.user) || {})
        );
      } catch (_) {
        window.groupUserSnapshot = {};
      }

      // Store current users and groups data for cascade inheritance
      window.currentUsersData = usersResp.items || [];
      window.currentGroupsData = groupsResp.items || [];

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
      row.className = "small";
      var checked =
        permissions && permissions[group.id] ? !!permissions[group.id] : false;
      var isAdminGroup = false;
      try {
        var adminName = (window.adminGroupName || "Программисты").toLowerCase();
        isAdminGroup = String(group.name || "").toLowerCase() === adminName;
      } catch (_) {}

      // Add admin group styling attribute
      if (isAdminGroup) {
        row.setAttribute("data-is-admin-group", "1");
        // Admin group styling applied
      }
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
        <td>
          ${group.name || ""}
          ${
            isAdminGroup
              ? '<i class="bi bi-shield-fill-check text-danger ms-1" title="Административная группа"></i>'
              : ""
          }
        </td>
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
        }
      }

      tbody.appendChild(row);
    });
  }

  // Global functions for onchange handlers (like in categories.js)
  window.updateRegistratorGroupPermission = function (groupId, checked) {
    try {
    } catch (_) {}
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

    // If enabling group: capture pre-toggle snapshot of user permissions
    try {
      if (checked) {
        window.regUsersBeforeGroupToggle = JSON.parse(
          JSON.stringify(
            (regLastSavedPermissions && regLastSavedPermissions.user) || {}
          )
        );
      }
    } catch (_) {}

    // Apply changes immediately
    try {
    } catch (_) {}
    saveRegPermissions("groups");

    // Update user permissions based on group changes
    if (checked) {
      // Only update UI when group is enabled
      updateUserPermissionsFromGroup(groupId, checked);
    } else {
      // When group is disabled, restore user permissions from pre-toggle snapshot immediately
      try {
        if (window.regUsersBeforeGroupToggle) {
          if (!regCurrentPermissionsDraft)
            regCurrentPermissionsDraft = { user: {}, group: {} };
          regCurrentPermissionsDraft.user = JSON.parse(
            JSON.stringify(window.regUsersBeforeGroupToggle)
          );
          if (!regLastSavedPermissions)
            regLastSavedPermissions = { user: {}, group: {} };
          regLastSavedPermissions.user = JSON.parse(
            JSON.stringify(window.regUsersBeforeGroupToggle)
          );
          // Re-render users immediately with restored state
          loadUsersPermissionsTable(
            window.currentUsersData || [],
            regCurrentPermissionsDraft.user || {}
          );

          // Persist restored user snapshot to the server to keep other tabs in sync
          try {
            var rid2 = window.currentRegistratorId;
            if (rid2) {
              var persistPayload = {
                permissions: {
                  user: JSON.parse(
                    JSON.stringify(window.regUsersBeforeGroupToggle)
                  ),
                  group: JSON.parse(
                    JSON.stringify(
                      (regCurrentPermissionsDraft &&
                        regCurrentPermissionsDraft.group) ||
                        {}
                    )
                  ),
                },
              };
              fetch(
                "/registrators/" + encodeURIComponent(rid2) + "/permissions",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(persistPayload),
                }
              ).catch(function () {});
            }
          } catch (_) {}
        }
      } catch (_) {}

      // Additionally, reload from server and enforce the snapshot in case server echoes stale state
      setTimeout(function () {
        // Reload permissions from server to get fresh data
        var rid = window.currentRegistratorId;
        if (rid) {
          try {
          } catch (_) {}
          fetch("/registrators/" + encodeURIComponent(rid) + "/permissions")
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data && data.permissions) {
                // Update saved permissions with fresh data from DB
                try {
                  // Frontend override: ensure the just-disabled group is cleared locally
                  if (data.permissions && data.permissions.group) {
                    data.permissions.group[String(groupId)] = 0;
                  }
                  // Enforce pre-toggle users snapshot if available
                  if (window.regUsersBeforeGroupToggle) {
                    data.permissions.user = JSON.parse(
                      JSON.stringify(window.regUsersBeforeGroupToggle)
                    );
                  }
                } catch (_) {}
                regLastSavedPermissions = JSON.parse(
                  JSON.stringify(data.permissions)
                );
                regCurrentPermissionsDraft = JSON.parse(
                  JSON.stringify(data.permissions)
                );
                try {
                  var usersMap =
                    (data.permissions && data.permissions.user) || {};
                  var enabledUsers = Object.keys(usersMap).filter(function (k) {
                    return usersMap[k] === 1 || String(usersMap[k]) === "1";
                  });
                  var grpMap =
                    (data.permissions && data.permissions.group) || {};
                  var enabledGroups = Object.keys(grpMap).filter(function (k) {
                    return grpMap[k] === 1 || String(grpMap[k]) === "1";
                  });
                } catch (_) {}

                // Reload user table with fresh data
                loadUsersPermissionsTable(
                  window.currentUsersData || [],
                  data.permissions.user || {}
                );
                try {
                } catch (_) {}
              }
            })
            .catch(function () {
              // Fallback: just unlock checkboxes without changing state
              try {
              } catch (_) {}
              document
                .querySelectorAll('input[data-entity="user"]')
                .forEach(function (userInput) {
                  var userRow = userInput.closest("tr");
                  var userId = userInput.getAttribute("data-id");
                  var userData = window.currentUsersData
                    ? window.currentUsersData.find((u) => u.id == userId)
                    : null;
                  if (userData && userData.gid == groupId) {
                    userInput.disabled = false;
                    var inh =
                      userRow && userRow.querySelector("small.text-muted");
                    if (inh) inh.remove();
                  }
                });
            });
        }
      }, 100);
    }
  };

  function updateUserPermissionsFromGroup(groupId, checked) {
    // Find all users in this group and update their permissions in real-time
    var userRows = document.querySelectorAll('input[data-entity="user"]');
    userRows.forEach(function (userInput) {
      var userId = userInput.getAttribute("data-id");
      var userRow = userInput.closest("tr");

      // Check if this user belongs to the group by looking at user data
      // We need to get the user's group ID from the data
      var userData = window.currentUsersData
        ? window.currentUsersData.find((u) => u.id == userId)
        : null;
      if (userData && userData.gid == groupId) {
        // This user belongs to the group, update their permission
        if (!regCurrentPermissionsDraft.user)
          regCurrentPermissionsDraft.user = {};

        // Don't modify regCurrentPermissionsDraft.user for group inheritance
        // The permission will be determined by group permission in loadUsersPermissionsTable
        // When group is enabled, user gets permission from group
        // When group is disabled, user permission depends on individual settings

        // Update the UI based on group state
        if (checked) {
          // Group enabled: show as checked and disabled
          userInput.checked = true;
          userInput.disabled = true;
        } else {
          // Group disabled: reload permissions from DB to restore original state
          userInput.disabled = false;
          // Don't set checked state here - let loadRegPermissions reload from DB
        }

        // Update the inheritance indicator
        var inheritanceText = userRow.querySelector("small.text-muted");
        if (checked) {
          if (!inheritanceText) {
            var label = userRow.querySelector("label");
            if (label) {
              var indicator = document.createElement("small");
              indicator.className = "text-muted ms-1";
              indicator.textContent = "(от группы)";
              label.appendChild(indicator);
            }
          } else {
            // Update existing indicator
            inheritanceText.textContent = "(от группы)";
          }
        } else {
          if (inheritanceText) {
            inheritanceText.remove();
          }
        }

        // Update the group name display if needed
        var userSpan = userRow.querySelector("td:first-child span");
        if (userSpan && window.currentGroupsData) {
          var group = window.currentGroupsData.find((g) => g.id == groupId);
          if (group) {
            var currentText = userSpan.textContent;
            var login = userData.login || "";
            var groupName = " (" + group.name + ")";

            // Remove existing group name if any
            var existingGroupMatch = currentText.match(/^(.+?)\s+\([^)]+\)$/);
            if (existingGroupMatch) {
              currentText = existingGroupMatch[1];
            }

            // Add new group name
            userSpan.textContent = currentText + groupName;
          }
        }
      }
    });

    // No need to save user permissions here - they are determined by group permissions
  }

  window.updateRegistratorUserPermission = function (userId, checked) {
    // Check if this is admin or full-access user - prevent disabling
    var userRow = document.querySelector(
      `input[data-entity="user"][data-id="${userId}"]`
    );
    // If checkbox is disabled (blocked by group), do nothing and don't save
    if (userRow && userRow.disabled) {
      return;
    }
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

      // Check if user inherits permission from group
      var userRowElement = userRow.closest("tr");
      if (userRowElement) {
        var inheritedText = userRowElement.querySelector("small.text-muted");
        if (inheritedText && inheritedText.textContent.includes("от группы")) {
          // User inherits from group, don't allow individual changes
          setTimeout(() => {
            userRow.checked = true;
          }, 0);
          return;
        }
      }

      // Check if full-access user (we need to get permission string from somewhere)
      // For now, we'll rely on the server-side enforcement
    }

    // Individual user permissions are visual only - server determines final permissions
    // based on group and individual settings from the database

    // Update the indicator for individual permissions (only for force users)
    var userRowElement = userRow.closest("tr");
    if (userRowElement) {
      var inheritanceText = userRowElement.querySelector("small.text-muted");

      // Check if this is a force user (admin or full access)
      var isForceUser = false;
      var login = ((userCell && userCell.textContent) || "").toLowerCase();
      if (login === "admin") {
        isForceUser = true;
      } else {
        // Check if user has full access permission
        var userData = window.currentUsersData
          ? window.currentUsersData.find((u) => u.id == userId)
          : null;
        if (userData && userData.permission) {
          var permStr = String(userData.permission).trim();
          isForceUser =
            permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
            permStr === "aef,a,abcdflm,ab,ab,ab" ||
            permStr.indexOf("z") !== -1 ||
            permStr.includes("полный доступ") ||
            permStr.includes("full access");
        }
      }

      if (checked && isForceUser) {
        if (!inheritanceText) {
          var label = userRowElement.querySelector("label");
          if (label) {
            var indicator = document.createElement("small");
            indicator.className = "text-muted ms-1";
            indicator.textContent = "(от настроек пользователя)";
            label.appendChild(indicator);
          }
        } else {
          // Update existing indicator
          inheritanceText.textContent = "(от настроек пользователя)";
        }
      } else {
        if (inheritanceText) {
          inheritanceText.remove();
        }
      }
    }

    // Persist individual user permission change
    try {
      if (!regCurrentPermissionsDraft.user)
        regCurrentPermissionsDraft.user = {};
      regCurrentPermissionsDraft.user[String(userId)] = checked ? 1 : 0;
      // Individual save
      saveRegPermissions("users");
    } catch (_) {}
  };

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

        // Check group permission first (has priority)
        if (user.gid) {
          if (
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
      } catch (_) {}

      // No extra mutation here; state already computed above
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
          } catch (_) {}
        }
      }

      var html = `
        <td>
          <span title="${user.name || ""}">${
        user.login || ""
      }${groupName}</span>
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

      // Add admin group user styling attribute
      if (isAdminGroupUser) {
        row.setAttribute("data-is-admin-group-user", "1");
        // Admin group user styling applied
      }

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
      var total = parseInt(resp.total || 0, 10);
      var size = parseInt(resp.page_size || 5, 10);
      var totalPages = Math.max(1, Math.ceil(total / (size || 1)));
      var currentPage = parseInt(resp.page || 1, 10);

      // Prev controls
      var mk = function (label, target, disabled, active) {
        var li = document.createElement("li");
        li.className =
          "page-item" +
          (disabled ? " disabled" : "") +
          (active ? " active" : "");
        var a = document.createElement("a");
        a.href = "#";
        a.className = "page-link";
        a.textContent = label;
        a.addEventListener("click", function (e) {
          e.preventDefault();
          if (disabled) return;
          if (which === "groups") loadRegPermissions(target, null);
          else loadRegPermissions(null, target);
        });
        li.appendChild(a);
        return li;
      };

      el.appendChild(mk("«", 1, currentPage === 1, false));
      el.appendChild(
        mk("‹", Math.max(1, currentPage - 1), currentPage === 1, false)
      );

      for (var i = 1; i <= totalPages; i++) {
        var li = document.createElement("li");
        li.className = "page-item" + (i === currentPage ? " active" : "");
        var a = document.createElement("a");
        a.href = "#";
        a.className = "page-link";
        a.textContent = i;
        (function (page) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            if (which === "groups") loadRegPermissions(page, null);
            else loadRegPermissions(null, page);
          });
        })(i);
        li.appendChild(a);
        el.appendChild(li);
      }

      el.appendChild(
        mk(
          "›",
          Math.min(totalPages, currentPage + 1),
          currentPage === totalPages,
          false
        )
      );
      el.appendChild(mk("»", totalPages, currentPage === totalPages, false));
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

  // Removed save buttons - changes are applied immediately

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
      } catch (_) {}
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
          } catch (_) {
            // Fallback: keep existing snapshot
          }
        } else {
          // For user changes, update saved permissions
          regLastSavedPermissions = JSON.parse(
            JSON.stringify(regCurrentPermissionsDraft)
          );
        }
      })
      .catch(function (error) {
        window.showToast("Ошибка сохранения прав доступа", "error");
      });
  }

  function openAddRegistratorModal() {
    if (window.openAddRegistratorModalUI)
      return window.openAddRegistratorModalUI();
    // Fallback to prompt if modal not available
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

  // UI modal openers
  window.openAddRegistratorModalUI = function () {
    var modalEl = document.getElementById("addRegistratorModal");
    if (!modalEl) return;
    showModalEl(modalEl);
  };

  window.openEditRegistratorModalUI = function (item) {
    var modalEl = document.getElementById("editRegistratorModal");
    if (!modalEl) return;
    var idEl = document.getElementById("regEditId");
    var nameEl = document.getElementById("regEditName");
    var urlEl = document.getElementById("regEditUrl");
    var enabledEl = document.getElementById("regEditEnabled");
    if (idEl) idEl.value = item.id;
    if (nameEl) nameEl.value = item.name || "";
    if (urlEl) urlEl.value = item.url_template || "";
    if (enabledEl)
      enabledEl.checked =
        String(item.enabled || 0) === "1" || item.enabled === true;
    // If url_template is not provided on the list item, fetch details
    if ((!item.url_template || !String(item.url_template).trim()) && item.id) {
      try {
        fetch("/registrators/" + encodeURIComponent(item.id), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "same-origin",
        })
          .then(function (r) {
            try {
              return r.json();
            } catch (_) {
              return null;
            }
          })
          .then(function (j) {
            if (!j || typeof j !== "object") return;
            try {
              var tpl = j.url_template || (j.item && j.item.url_template);
              var nm = j.name || (j.item && j.item.name);
              var en = j.enabled;
              if (typeof en === "undefined") en = j.item && j.item.enabled;
              if (urlEl && tpl) urlEl.value = tpl;
              if (nameEl && nm && !nameEl.value) nameEl.value = nm;
              if (enabledEl && typeof en !== "undefined")
                enabledEl.checked = String(en) === "1" || en === true;
            } catch (_) {}
          })
          .catch(function () {});
      } catch (_) {}
    }
    // Ensure Save button is bound even if initial bind happened before DOM existed
    try {
      var btnSave = document.getElementById("regEditSubmit");
      if (btnSave && !btnSave.__boundDynamic) {
        btnSave.__boundDynamic = true;
        btnSave.addEventListener("click", function () {
          try {
            var id = (document.getElementById("regEditId") || {}).value;
            var name =
              (document.getElementById("regEditName") || {}).value || "";
            var url = (document.getElementById("regEditUrl") || {}).value || "";
            if (!id) return;
            putJson("/registrators/" + encodeURIComponent(id), {
              name: name.trim(),
              url_template: url.trim(),
            }).then(function (r) {
              if (r && r.status === "success") {
                try {
                  var modalEl2 = document.getElementById(
                    "editRegistratorModal"
                  );
                  if (modalEl2) hideModalEl(modalEl2);
                } catch (_) {}
                loadRegistrators();
              } else if (r && r.message) {
                alert(r.message);
              }
            });
          } catch (_) {}
        });
      }
    } catch (_) {}
    showModalEl(modalEl);
  };

  // Save from Edit modal
  (function bindEditModal() {
    try {
      var btn = document.getElementById("regEditSubmit");
      if (!btn || btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", function () {
        try {
          var id = (document.getElementById("regEditId") || {}).value;
          var name = (document.getElementById("regEditName") || {}).value || "";
          var url = (document.getElementById("regEditUrl") || {}).value || "";
          if (!id) return;
          putJson("/registrators/" + encodeURIComponent(id), {
            name: name.trim(),
            url_template: url.trim(),
          }).then(function (r) {
            if (r && r.status === "success") {
              try {
                var modalEl = document.getElementById("editRegistratorModal");
                if (modalEl) hideModalEl(modalEl);
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
    try {
      if (
        window.SyncManager &&
        typeof window.SyncManager.joinRoom === "function"
      ) {
        window.SyncManager.joinRoom("registrators");
      }
    } catch (_) {}
    // Idle guard: soft refresh registrators if idle
    try {
      var idleSec = 30;
      try {
        idleSec =
          parseInt(
            (window.__config && window.__config.syncIdleSeconds) || idleSec,
            10
          ) || idleSec;
      } catch (_) {}
      if (
        window.SyncManager &&
        typeof window.SyncManager.startIdleGuard === "function"
      ) {
        window.SyncManager.startIdleGuard(function () {
          try {
            typeof loadRegistrators === "function" && loadRegistrators();
          } catch (_) {}
        }, idleSec);
      }
    } catch (_) {}
    loadRegistrators().then(function (items) {
      if (items && items.length) selectRegistrator(items[0].id);
      refreshLevels();
    });
    // Removed save button handlers - changes are applied immediately
    safeOn(q("dateSelect"), "change", onDate);
    safeOn(q("userSelect"), "change", onUser);
    safeOn(q("timeSelect"), "change", onTime);
    safeOn(q("typeSelect"), "change", onType);
    safeOn(q("filesList"), "change", updateImportButton);
    safeOn(q("btnImportSelected"), "click", importSelected);
  });

  // Socket-based soft refresh similar to files
  (function setupRegistratorsSocket() {
    try {
      // Prefer SyncManager for unified handling
      try {
        if (window.SyncManager && typeof window.SyncManager.on === "function") {
          if (!window.__registratorsSyncBound) {
            window.__registratorsSyncBound = true;
            // Debounce: coalesce multiple socket events
            if (!window.__registratorsDebounceTimer)
              window.__registratorsDebounceTimer = null;
            function debouncedLoad() {
              if (window.__registratorsDebounceTimer) {
                clearTimeout(window.__registratorsDebounceTimer);
              }
              window.__registratorsDebounceTimer = setTimeout(function () {
                try {
                  loadRegistrators();
                } catch (_) {}
              }, 300);
            }
            window.SyncManager.on("registrators:changed", function (data) {
              try {
                // SyncManager received registrators:changed
                if (!document.hidden) debouncedLoad();
              } catch (e) {
                window.showToast("Ошибка синхронизации регистраторов", "error");
              }
            });
            // Also listen for users and groups changes to update permissions tables
            window.SyncManager.on("users:changed", function (data) {
              try {
                // SyncManager received users:changed
                if (!document.hidden) {
                  debouncedLoad();
                  if (window.currentRegistratorId) {
                    loadRegPermissions();
                  }
                }
              } catch (e) {
                window.showToast("Ошибка синхронизации пользователей", "error");
              }
            });
            window.SyncManager.on("groups:changed", function (data) {
              try {
                // SyncManager received groups:changed
                if (!document.hidden && window.currentRegistratorId) {
                  loadRegPermissions();
                }
              } catch (e) {
                window.showToast("Ошибка синхронизации групп", "error");
              }
            });
            // Listen for registrator permissions updates via SyncManager
            window.SyncManager.on(
              "registrator_permissions_updated",
              function (data) {
                try {
                  // SyncManager received registrator_permissions_updated
                  if (
                    !document.hidden &&
                    window.currentRegistratorId &&
                    data &&
                    data.registrator_id == window.currentRegistratorId
                  ) {
                    loadRegPermissions();
                  }
                } catch (e) {
                  console.error(
                    "[registrators] error in SyncManager registrator_permissions_updated handler",
                    e
                  );
                }
              }
            );
          }
        }
      } catch (_) {}
      if (!window.io) return;
      const sock =
        window.socket && typeof window.socket.on === "function"
          ? window.socket
          : window.io(window.location.origin, {
              path: "/socket.io",
              withCredentials: true,
              transports: ["websocket", "polling"],
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000,
            });
      try {
        sock.on &&
          sock.on("connect", function () {
            try {
              // Socket connected
            } catch (_) {}
          });
      } catch (_) {}
      try {
        sock.on &&
          sock.on("disconnect", function (reason) {
            try {
              // Socket disconnected
            } catch (_) {}
            if (reason !== "io client disconnect") {
              try {
                sock.connect();
              } catch (_) {}
            }
          });
      } catch (_) {}
      if (!window.socket) window.socket = sock;
      try {
        sock.off && sock.off("registrators:changed");
      } catch (_) {}
      sock.on &&
        sock.on("registrators:changed", function (data) {
          try {
            // Socket received registrators:changed
            if (!document.hidden) loadRegistrators();
          } catch (e) {
            window.showToast(
              "Ошибка обработки изменений регистраторов",
              "error"
            );
          }
        });
      // Also reflect users changes (permissions and visibility) to reload list/permissions
      sock.on &&
        sock.on("users:changed", function () {
          try {
            if (!document.hidden) {
              loadRegistrators();
              // Also reload permissions tables if they're visible
              if (window.currentRegistratorId) {
                loadRegPermissions();
              }
            }
          } catch (_) {}
        });
      // Also reload permissions tables when groups change
      sock.on &&
        sock.on("groups:changed", function () {
          try {
            if (!document.hidden && window.currentRegistratorId) {
              loadRegPermissions();
            }
          } catch (_) {}
        });
      // Listen for specific registrator permissions updates
      sock.on &&
        sock.on("registrator_permissions_updated", function (data) {
          try {
            // Socket received registrator_permissions_updated
            if (
              !document.hidden &&
              window.currentRegistratorId &&
              data &&
              data.registrator_id == window.currentRegistratorId
            ) {
              loadRegPermissions();
            }
          } catch (e) {
            console.error(
              "[registrators] error in registrator_permissions_updated handler",
              e
            );
          }
        });
    } catch (_) {}
  })();

  // Global resume soft refresh
  try {
    if (
      window.SyncManager &&
      typeof window.SyncManager.onResume === "function"
    ) {
      window.SyncManager.onResume(function () {
        try {
          if (typeof window.__registratorsDebounceTimer !== "undefined") {
            if (window.__registratorsDebounceTimer)
              clearTimeout(window.__registratorsDebounceTimer);
            window.__registratorsDebounceTimer = setTimeout(function () {
              try {
                loadRegistrators();
              } catch (_) {}
            }, 300);
          } else {
            loadRegistrators();
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
})();
