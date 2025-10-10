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

  function loadRegistrators() {
    return fetchJson("/api/registrators").then(function (j) {
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
            e.preventDefault();
            e.stopPropagation();
            openRegContextMenu(e.clientX, e.clientY, it);
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
    });
  }

  function openRegContextMenu(x, y, item) {
    var menu = document.getElementById("registrators-context-menu");
    if (!menu) return;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.classList.remove("d-none");
    var hide = function () {
      menu.classList.add("d-none");
      document.removeEventListener("click", hide, { capture: true });
    };
    document.addEventListener("click", hide, { capture: true });
    menu.onclick = function (ev) {
      var actionEl = ev.target.closest("[data-action]");
      if (!actionEl) return;
      var action = actionEl.getAttribute("data-action");
      if (action === "edit") {
        editRegistrator(item);
      } else if (action === "toggle") {
        toggleRegistrator(item);
      } else if (action === "delete") {
        deleteRegistrator(item);
      }
      hide();
    };
  }

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
    fetch("/registrators/" + encodeURIComponent(item.id) + "/stats", {
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (s) {
        var cnt = s && s.files_count ? s.files_count : 0;
        if (cnt > 0) {
          alert("Нельзя удалить: есть скачанные файлы (" + cnt + ")");
          return;
        }
        if (!confirm('Удалить регистратор "' + (item.name || "") + '"?'))
          return;
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
      });
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
      row.innerHTML =
        "\n        <td>" +
        (group.name || "") +
        '</td>\n        <td class="text-center">' +
        '<label class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="group" data-id="' +
        group.id +
        '" ' +
        (checked ? "checked" : "") +
        '> <span class="form-check-label">Просмотр</span></label>' +
        "</td>\n      ";
      tbody.appendChild(row);
    });
    tbody.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || t.name !== "reg-perm-view") return;
      var gid = String(t.dataset.id || "");
      if (!regCurrentPermissionsDraft.group)
        regCurrentPermissionsDraft.group = {};
      regCurrentPermissionsDraft.group[gid] = t.checked ? 1 : 0;
      regDirtyGroups = true;
      updateSaveButtonsState();
    });
  }

  function loadUsersPermissionsTable(users, permissions) {
    var tbody = document.getElementById("users-permissions");
    if (!tbody) return;
    tbody.innerHTML = "";
    (users || []).forEach(function (user) {
      var row = document.createElement("tr");
      var checked =
        permissions && permissions[user.id] ? !!permissions[user.id] : false;
      row.innerHTML =
        '\n        <td><span title="' +
        (user.name || "") +
        '">' +
        (user.login || "") +
        '</span></td>\n        <td class="text-center">' +
        '<label class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" name="reg-perm-view" data-entity="user" data-id="' +
        user.id +
        '" ' +
        (checked ? "checked" : "") +
        '> <span class="form-check-label">Просмотр</span></label>' +
        "</td>\n      ";
      tbody.appendChild(row);
    });
    tbody.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || t.name !== "reg-perm-view") return;
      var uid = String(t.dataset.id || "");
      if (!regCurrentPermissionsDraft.user)
        regCurrentPermissionsDraft.user = {};
      regCurrentPermissionsDraft.user[uid] = t.checked ? 1 : 0;
      regDirtyUsers = true;
      updateSaveButtonsState();
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
    var payload = { permissions: regCurrentPermissionsDraft };
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
