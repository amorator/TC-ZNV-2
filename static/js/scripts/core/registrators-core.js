// Registrators Core Module
// Основные функции для работы с регистраторами

// Global variables
window.currentRegistratorId = null;
window.regLastSavedPermissions = { user: {}, group: {} };
window.regCurrentPermissionsDraft = { user: {}, group: {} };
window.regOriginalUserPermissions = { user: {}, group: {} };
window.regGroupStates = {};

// Utility functions
function safeOn(el, type, h) {
  try {
    if (el && el.addEventListener) el.addEventListener(type, h);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "safeOn");
    }
  }
}

// Load registrators list
function loadRegistrators(page = 1) {
  const ts = Date.now();
  const url = `/api/registrators?page=${page}&page_size=10&_ts=${ts}`;

  if (window.ApiClient) {
    return window.ApiClient.apiGet(url)
      .then(function (j) {
        const wrap = document.getElementById("registrators-nav");
        if (!wrap) return [];
        wrap.innerHTML = "";
        var items = (j.items || []).slice();
        var prevActiveId = 0;
        try {
          prevActiveId = parseInt(window.currentRegistratorId || 0, 10) || 0;
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "loadRegistrators");
          }
        }
        if (items.length === 0) {
          const addBtn = document.createElement("button");
          addBtn.className = "topbtn";
          addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
          addBtn.title = "Добавить регистратор";
          addBtn.onclick = function () {
            if (window.openAddRegistratorModalUI)
              return window.openAddRegistratorModalUI();
          };
          wrap.appendChild(addBtn);
          return [];
        }
        var foundActive = false;
        items.forEach(function (item) {
          const btn = document.createElement("button");
          btn.className = "topbtn";
          btn.setAttribute("data-registrator-id", item.id);
          btn.innerHTML = item.name || "Unnamed";
          btn.title = item.name || "Unnamed";
          btn.onclick = function () {
            selectRegistrator(item.id);
          };
          if (item.id == prevActiveId) {
            btn.classList.add("active");
            foundActive = true;
          }
          wrap.appendChild(btn);
        });
        const addBtn = document.createElement("button");
        addBtn.className = "topbtn";
        addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
        addBtn.title = "Добавить регистратор";
        addBtn.onclick = function () {
          if (window.openAddRegistratorModalUI)
            return window.openAddRegistratorModalUI();
        };
        wrap.appendChild(addBtn);
        if (!foundActive && items.length > 0) {
          selectRegistrator(items[0].id);
        }
        return items;
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "loadRegistrators");
        }
        return [];
      });
  } else {
    // Fallback to direct fetch
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        const wrap = document.getElementById("registrators-nav");
        if (!wrap) return [];
        wrap.innerHTML = "";
        var items = (j.items || []).slice();
        var prevActiveId = 0;
        try {
          prevActiveId = parseInt(window.currentRegistratorId || 0, 10) || 0;
        } catch (err) {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "loadRegistrators");
          }
        }
        if (items.length === 0) {
          const addBtn = document.createElement("button");
          addBtn.className = "topbtn";
          addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
          addBtn.title = "Добавить регистратор";
          addBtn.onclick = function () {
            if (window.openAddRegistratorModalUI)
              return window.openAddRegistratorModalUI();
          };
          wrap.appendChild(addBtn);
          return [];
        }
        var foundActive = false;
        items.forEach(function (item) {
          const btn = document.createElement("button");
          btn.className = "topbtn";
          btn.setAttribute("data-registrator-id", item.id);
          btn.innerHTML = item.name || "Unnamed";
          btn.title = item.name || "Unnamed";
          btn.onclick = function () {
            selectRegistrator(item.id);
          };
          if (item.id == prevActiveId) {
            btn.classList.add("active");
            foundActive = true;
          }
          wrap.appendChild(btn);
        });
        const addBtn = document.createElement("button");
        addBtn.className = "topbtn";
        addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
        addBtn.title = "Добавить регистратор";
        addBtn.onclick = function () {
          if (window.openAddRegistratorModalUI)
            return window.openAddRegistratorModalUI();
        };
        wrap.appendChild(addBtn);
        if (!foundActive && items.length > 0) {
          selectRegistrator(items[0].id);
        }
        return items;
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "loadRegistrators");
        }
        return [];
      });
  }
}

// Select registrator
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
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "selectRegistrator");
    }
  }
  try {
    var perm = document.getElementById("permissions-content");
    if (perm) perm.style.display = "block";
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "selectRegistrator");
    }
  }
  if (window.loadRegPermissions) {
    window.loadRegPermissions();
  }
  var tbody = document.getElementById("registratorFilesTbody");
  if (tbody) tbody.innerHTML = "";
}

// Enforce admin access
function enforceAdminAccess(permissions, groups, users) {
  try {
    if (!permissions) permissions = {};
    if (!permissions.group) permissions.group = {};
    groups.forEach(function (group) {
      if (group && group.id) {
        permissions.group[String(group.id)] = 1;
      }
    });
    return permissions;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "enforceAdminAccess");
    }
    return permissions || {};
  }
}

// Export functions to global scope
window.loadRegistrators = loadRegistrators;
window.selectRegistrator = selectRegistrator;
window.enforceAdminAccess = enforceAdminAccess;
