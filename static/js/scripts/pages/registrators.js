// Registrators Page - Modular Version
// Использует модули из core/ для функциональности

// Initialize page when DOM is ready
function initRegistratorsPage() {
  try {
    // Load registrators and select first one
    if (window.loadRegistrators) {
      window.loadRegistrators().then(function (items) {
        if (items && items.length && window.selectRegistrator) {
          window.selectRegistrator(items[0].id);
        }
        if (window.refreshLevels) {
          window.refreshLevels();
        }
      });
    }

    // Setup form validation
    setupFormValidation();

    // Setup socket synchronization
    if (window.setupRegistratorsSocket) {
      window.setupRegistratorsSocket();
    }

    // Context menu across whole page
    setupRegistratorsContextMenu();

    // Ensure dual-table pager defaults and load permissions lists
    try { ensureAdminDualPagerDefaults(); } catch(_) {}
    // Wire search bars exactly like Categories
    try { wireSearchbar('groups'); } catch(_) {}
    try { wireSearchbar('users'); } catch(_) {}
    // Initial load using URL q_* and paging
    try {
      var qg = getUrlParam('q_groups') || '';
      var qu = getUrlParam('q_users') || '';
      loadPage('groups', parseInt(getUrlParam('page_groups')||'1',10)||1, qg);
      loadPage('users', parseInt(getUrlParam('page_users')||'1',10)||1, qu);
    } catch(_) {}

    // Wire up Add Registrator modal submit
    try {
      var addBtn = document.getElementById('regAddSubmit');
      if (addBtn) {
        addBtn.addEventListener('click', function(){
          try {
            var nameEl = document.getElementById('regAddName');
            var urlEl = document.getElementById('regAddUrl');
            var name = nameEl ? String(nameEl.value || '').trim() : '';
            var urlTpl = urlEl ? String(urlEl.value || '').trim() : '';
            if (!name || !urlTpl) {
              if (window.showToast) window.showToast('Укажите название и шаблон ссылки', 'warning');
              return;
            }
            var payload = { name: name, url_template: urlTpl, enabled: 1 };
            fetch('/registrators', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              credentials: 'same-origin',
              body: JSON.stringify(payload)
            })
            .then(function(r){ return r.json(); })
            .then(function(j){
              if (j && j.status === 'success') {
                // Close modal
                var m = document.getElementById('addRegistratorModal');
                if (m && window.bootstrap && bootstrap.Modal) {
                  (bootstrap.Modal.getInstance(m) || new bootstrap.Modal(m)).hide();
                }
                // Clear inputs
                if (nameEl) nameEl.value = '';
                if (urlEl) urlEl.value = '';
                if (window.showToast) window.showToast('Регистратор создан', 'success');
                if (window.loadRegistrators) window.loadRegistrators();
              } else {
                var msg = (j && (j.message || j.error)) || 'Ошибка создания регистратора';
                if (window.showToast) window.showToast(msg, 'error');
              }
            })
            .catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'regAddSubmit'); });
          } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'regAddSubmit'); }
        }, false);
      }
    } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'wireAddModal'); }

    // Wire up Edit Registrator modal submit
    try {
      var editBtn = document.getElementById('regEditSubmit');
      if (editBtn) {
        editBtn.addEventListener('click', function(){
          try {
            var idEl = document.getElementById('regEditId');
            var nameEl = document.getElementById('regEditName');
            var urlEl = document.getElementById('regEditUrl');
            var rid = idEl ? parseInt(idEl.value || '0', 10) : 0;
            var name = nameEl ? String(nameEl.value || '').trim() : '';
            var urlTpl = urlEl ? String(urlEl.value || '').trim() : '';
            if (!rid) return;
            if (!name || !urlTpl) {
              if (window.showToast) window.showToast('Укажите название и шаблон ссылки', 'warning');
              return;
            }
            var payload = { name: name, url_template: urlTpl, enabled: 1 };
            fetch('/registrators/' + encodeURIComponent(rid), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              credentials: 'same-origin',
              body: JSON.stringify(payload)
            })
            .then(function(r){ return r.json(); })
            .then(function(j){
              if (j && j.status === 'success') {
                var m = document.getElementById('editRegistratorModal');
                if (m && window.bootstrap && bootstrap.Modal) {
                  (bootstrap.Modal.getInstance(m) || new bootstrap.Modal(m)).hide();
                }
                if (window.showToast) window.showToast('Сохранено', 'success');
                if (window.loadRegistrators) {
                  window.loadRegistrators().then(function(){
                    if (window.selectRegistrator) window.selectRegistrator(rid);
                  });
                }
              } else {
                var msg = (j && (j.message || j.error)) || 'Ошибка сохранения';
                if (window.showToast) window.showToast(msg, 'error');
              }
            })
            .catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'regEditSubmit'); });
          } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'regEditSubmit'); }
        }, false);
      }
    } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'wireEditModal'); }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initRegistratorsPage");
    }
  }
}

// Context menu for registrators page (works on entire body)
function setupRegistratorsContextMenu() {
  try {
    const menu = document.getElementById('registrators-context-menu');
    if (!menu) return;

    function hideMenu() { try { menu.classList.add('d-none'); } catch(_) {} }
    function showMenu(x, y) {
      try {
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight; const m=4;
        let px = x, py = y;
        if (px + rect.width + m > vw) px = Math.max(vw - rect.width - m, m);
        if (py + rect.height + m > vh) py = Math.max(vh - rect.height - m, m);
        menu.style.left = px + 'px';
        menu.style.top = py + 'px';
        menu.classList.remove('d-none');
      } catch(_) {}
    }

    function configureForRow(row) {
      const id = row && (row.getAttribute('data-registrator-id') || row.dataset.registratorId);
      // Toggle visibility
      toggle('add', true);
      toggle('edit', !!id);
      toggle('delete', !!id);
      toggle('toggle', !!id);
      // Store target id
      if (id) menu.dataset.targetId = String(id); else delete menu.dataset.targetId;
    // Update toggle text to reflect current enabled state
    if (id) updateToggleMenuText(id);
    }

    function configureGeneral() {
      toggle('add', true);
      // If a registrator is currently selected, enable edit/delete for it
      var curId = null;
      try { curId = window.currentRegistratorId ? String(window.currentRegistratorId) : null; } catch(_) { curId = null; }
      toggle('edit', !!curId);
      toggle('delete', !!curId);
      toggle('toggle', !!curId);
      if (curId) { menu.dataset.targetId = curId; } else { delete menu.dataset.targetId; }
    if (curId) updateToggleMenuText(curId);
    }

  function updateToggleMenuText(id){
    try {
      const item = menu.querySelector('.context-menu__item[data-action="toggle"]');
      if (!item) return;
      item.textContent = 'Переключить';
      fetch('/api/registrators/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }})
        .then(function(r){ return r.json(); })
        .then(function(j){
          var rec = j && (j.item || j.registrator || j.data);
          if (!rec) return;
          item.textContent = rec.enabled ? 'Отключить' : 'Включить';
          // Optional: add muted style when disabled
          if (rec.enabled) { item.classList.remove('text-muted'); }
          else { item.classList.add('text-muted'); }
        })
        .catch(function(_){});
    } catch(_) {}
  }

    function toggle(action, show) {
      const el = menu.querySelector('.context-menu__item[data-action="' + action + '"]');
      if (!el) return; el.style.display = show ? '' : 'none';
    }

    document.addEventListener('contextmenu', function(e){
      // Only on registrators page
      if (!document.querySelector('.registrators-page')) return;
      if (menu.contains(e.target)) return;
      // Ignore inputs
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault(); e.stopPropagation(); hideMenu();
      const row = e.target.closest('tr.table__body_row,[data-registrator-id]');
      if (row) configureForRow(row); else configureGeneral();
      showMenu(e.clientX, e.clientY);
    }, false);

    document.addEventListener('click', hideMenu);
    window.addEventListener('resize', hideMenu);

    menu.addEventListener('click', function(e){
      const item = e.target.closest('.context-menu__item');
      if (!item) return; const action = item.getAttribute('data-action');
      hideMenu();
      const id = menu.dataset.targetId;
      switch(action){
        case 'add': {
          const m = document.getElementById('addRegistratorModal');
          if (m && window.bootstrap && bootstrap.Modal) (bootstrap.Modal.getInstance(m) || new bootstrap.Modal(m)).show();
          break;
        }
        case 'edit': {
          if (id && window.editRegistrator) window.editRegistrator(id);
          break;
        }
        case 'delete': {
          if (!id) break;
          // Open confirmation modal instead of immediate delete
          var dm = document.getElementById('deleteRegistratorModal');
          if (dm && window.bootstrap && bootstrap.Modal) {
            // Fill name if available
            try {
              fetch('/api/registrators/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
                .then(function(r){ return r.json(); })
                .then(function(j){
                  var item = j && (j.item || j.registrator);
                  var nameEl = document.getElementById('regDelName');
                  if (nameEl) nameEl.textContent = item && item.name ? item.name : ('#' + id);
                })
                .catch(function(){});
            } catch(_) {}
            var modal = (bootstrap.Modal.getInstance(dm) || new bootstrap.Modal(dm));
            modal.show();
            // Bind one-time confirm
            var btn = document.getElementById('regDelConfirm');
            if (btn) {
              var handler = function(){
                btn.removeEventListener('click', handler);
                try {
                  fetch('/registrators/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
                    .then(function(r){ return r.json(); })
                    .then(function(j){
                      if (j && j.status === 'success') {
                        modal.hide();
                        if (window.showToast) window.showToast('Удалено', 'success');
                        if (window.loadRegistrators) window.loadRegistrators();
                      } else {
                        if (window.showToast) window.showToast((j && (j.message||j.error)) || 'Ошибка удаления', 'error');
                      }
                    })
                    .catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'deleteRegistrator'); });
                } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'deleteRegistrator'); }
              };
              btn.addEventListener('click', handler, false);
            }
          } else if (window.deleteRegistrator) {
            // Fallback to old flow
            window.deleteRegistrator(id);
          }
          break;
        }
        case 'toggle': {
          if (!id) break;
          // Load current state first
          fetch('/api/registrators/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }})
            .then(function(r){ return r.json(); })
            .then(function(j){
              var item = j && (j.item || j.registrator || j.data);
              if (!item) { if (window.showToast) window.showToast('Не удалось получить данные регистратора', 'error'); return; }
              var desired = item.enabled ? 0 : 1;
              var payload = { name: item.name, url_template: item.url_template, enabled: desired };
              return fetch('/registrators/' + encodeURIComponent(id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
              })
              .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(body){ return { ok: r.ok, status: r.status, body: body }; }); })
              .then(function(res){
                if (!res.ok || (res.body && res.body.status !== 'success')) {
                  var msg = (res.body && (res.body.message || res.body.error)) || ('Ошибка переключения (HTTP ' + (res.status||'-') + ')');
                  if (window.showToast) window.showToast(msg, 'error');
                  return;
                }
                if (window.showToast) window.showToast(desired ? 'Регистратор включен' : 'Регистратор отключен', 'success');
                if (window.loadRegistrators) window.loadRegistrators();
              });
            })
            .catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'registrators-toggle'); });
          break;
        }
      }
    });
  } catch(err) {
    if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'setupRegistratorsContextMenu');
  }
}

// Helper to open Add Registrator modal
try {
  window.openAddRegistratorModalUI = function(){
    var m = document.getElementById('addRegistratorModal');
    if (m && window.bootstrap && bootstrap.Modal) {
      (bootstrap.Modal.getInstance(m) || new bootstrap.Modal(m)).show();
      try { var inp = document.getElementById('regAddName'); if (inp) inp.focus(); } catch(_) {}
      return true;
    }
    return false;
  };
} catch (_) {}

// Open Edit modal and populate by id
try {
  window.editRegistrator = function(rid){
    try {
      rid = parseInt(rid || '0', 10) || 0;
      if (!rid) return false;
      var m = document.getElementById('editRegistratorModal');
      if (!(m && window.bootstrap && bootstrap.Modal)) return false;
      (bootstrap.Modal.getInstance(m) || new bootstrap.Modal(m)).show();
      var idEl = document.getElementById('regEditId'); if (idEl) idEl.value = String(rid);
      // Clear fields before load
      var nameEl = document.getElementById('regEditName'); if (nameEl) nameEl.value = '';
      var urlEl = document.getElementById('regEditUrl'); if (urlEl) urlEl.value = '';
      fetch('/api/registrators/' + encodeURIComponent(rid), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
        .then(function(r){ return r.json(); })
        .then(function(j){
          var item = j && (j.item || j.registrator || j.data);
          if (item) {
            if (nameEl) nameEl.value = item.name || '';
            if (urlEl) urlEl.value = item.url_template || '';
            try { if (nameEl) nameEl.focus(); } catch(_) {}
          } else {
            if (window.showToast) window.showToast('Не удалось загрузить данные', 'error');
          }
        })
        .catch(function(err){ if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'editRegistratorLoad'); });
      return true;
    } catch (err) { if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'editRegistrator'); return false; }
  };
} catch (_) {}

// Setup form validation
function setupFormValidation() {
  try {
    // Date select
    var dateSelect = document.getElementById("dateSelect");
    if (dateSelect) {
      safeOn(dateSelect, "change", function () {
        if (window.onDate) window.onDate();
      });
    }

    // User select
    var userSelect = document.getElementById("userSelect");
    if (userSelect) {
      safeOn(userSelect, "change", function () {
        if (window.onUser) window.onUser();
      });
    }

    // Time select
    var timeSelect = document.getElementById("timeSelect");
    if (timeSelect) {
      safeOn(timeSelect, "change", function () {
        if (window.onTime) window.onTime();
      });
    }

    // Type select
    var typeSelect = document.getElementById("typeSelect");
    if (typeSelect) {
      safeOn(typeSelect, "change", function () {
        if (window.onType) window.onType();
      });
    }

    // Files list
    var filesList = document.getElementById("filesList");
    if (filesList) {
      safeOn(filesList, "change", function () {
        if (window.updateImportButton) window.updateImportButton();
      });
    }

    // Import button
    var btnImport = document.getElementById("btnImportSelected");
    if (btnImport) {
      safeOn(btnImport, "click", function () {
        if (window.importSelected) window.importSelected();
      });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupFormValidation");
    }
  }
}

// Utility function for safe event binding
function safeOn(el, type, h) {
  try {
    if (el && el.addEventListener) el.addEventListener(type, h);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "safeOn");
    }
  }
}

// Form validation handlers
function onDate() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onDate");
    }
  }
}

function onUser() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onUser");
    }
  }
}

function onTime() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onTime");
    }
  }
}

function onType() {
  try {
    if (window.refreshLevels) window.refreshLevels();
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "onType");
    }
  }
}

// Refresh levels function
function refreshLevels() {
  try {
    var dateSelect = document.getElementById("dateSelect");
    var userSelect = document.getElementById("userSelect");
    var timeSelect = document.getElementById("timeSelect");
    var typeSelect = document.getElementById("typeSelect");

    if (!dateSelect || !userSelect || !timeSelect || !typeSelect) return;

    var date = dateSelect.value;
    var user = userSelect.value;
    var time = timeSelect.value;
    var type = typeSelect.value;

    if (!date || !user || !time || !type) return;

    var rid = window.currentRegistratorId;
    if (!rid) return;

    var url =
      "/registrators/" +
      encodeURIComponent(rid) +
      "/browse?" +
      "date=" +
      encodeURIComponent(date) +
      "&user=" +
      encodeURIComponent(user) +
      "&time=" +
      encodeURIComponent(time) +
      "&type=" +
      encodeURIComponent(type);

    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.files) {
          var filesList = document.getElementById("filesList");
          if (filesList) {
            filesList.innerHTML = "";
            data.files.forEach(function (file) {
              var option = document.createElement("option");
              option.value = file.name;
              option.textContent = file.name;
              filesList.appendChild(option);
            });
          }
          if (window.updateImportButton) {
            window.updateImportButton();
          }
        }
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "refreshLevels");
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "refreshLevels");
    }
  }
}

// Update import button state
function updateImportButton() {
  try {
    var filesList = document.getElementById("filesList");
    var btnImport = document.getElementById("btnImportSelected");

    if (!filesList || !btnImport) return;

    var hasSelection = false;
    for (var i = 0; i < filesList.options.length; i++) {
      if (filesList.options[i].selected) {
        hasSelection = true;
        break;
      }
    }

    btnImport.disabled = !hasSelection;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateImportButton");
    }
  }
}

// Import selected files
function importSelected() {
  try {
    var filesList = document.getElementById("filesList");
    if (!filesList) return;

    var selectedFiles = [];
    for (var i = 0; i < filesList.options.length; i++) {
      if (filesList.options[i].selected) {
        selectedFiles.push(filesList.options[i].value);
      }
    }

    if (selectedFiles.length === 0) return;

    var rid = window.currentRegistratorId;
    if (!rid) return;

    var dateSelect = document.getElementById("dateSelect");
    var userSelect = document.getElementById("userSelect");
    var timeSelect = document.getElementById("timeSelect");
    var typeSelect = document.getElementById("typeSelect");

    if (!dateSelect || !userSelect || !timeSelect || !typeSelect) return;

    var payload = {
      files: selectedFiles,
      date: dateSelect.value,
      user: userSelect.value,
      time: timeSelect.value,
      type: typeSelect.value,
    };

    var url = "/registrators/" + encodeURIComponent(rid) + "/import";

    fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Client-Id": window.__filesClientId || "unknown",
      },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        }
        if (window.showToast) {
          window.showToast("Файлы импортированы", "success");
        }
        if (window.refreshLevels) {
          window.refreshLevels();
        }
        return data;
      })
      .catch(function (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "importSelected");
        }
      });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "importSelected");
    }
  }
}

// Export functions to global scope
window.initRegistratorsPage = initRegistratorsPage;
window.refreshLevels = refreshLevels;
window.updateImportButton = updateImportButton;
window.importSelected = importSelected;
window.onDate = onDate;
window.onUser = onUser;
window.onTime = onTime;
window.onType = onType;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRegistratorsPage);
} else {
  initRegistratorsPage();
}

// --- Admin dual lists (groups/users) for Registrators & Categories: minimal loader using q_groups/q_users ---
function ensureAdminDualPagerDefaults(){
  try {
    var url = new URL(window.location.href);
    var changed = false;
    if (!url.searchParams.get('page_groups')) { url.searchParams.set('page_groups','1'); changed = true; }
    if (!url.searchParams.get('page_size_groups')) { url.searchParams.set('page_size_groups','10'); changed = true; }
    if (!url.searchParams.get('page_users')) { url.searchParams.set('page_users','1'); changed = true; }
    if (!url.searchParams.get('page_size_users')) { url.searchParams.set('page_size_users','10'); changed = true; }
    if (changed) { try { window.history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString()); } catch(_) {} }
  } catch(_) {}
}

function getUrlParam(name){ try { return (new URL(window.location.href)).searchParams.get(name) || ''; } catch(_) { return ''; } }
function setUrlParams(obj){
  try {
    var url = new URL(window.location.href);
    Object.keys(obj||{}).forEach(function(k){ var v = obj[k]; if (v === null || v === undefined || v === '') url.searchParams.delete(k); else url.searchParams.set(k, String(v)); });
    // keep dual params only; remove generic q if present
    url.searchParams.delete('q');
    window.history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
  } catch(_) {}
}

function loadAdminPermissionsLists(){
  try {
    loadGroupsPermissions();
    loadUsersPermissions();
  } catch(_) {}
}

function loadGroupsPermissions(){
  try {
    var p = parseInt(getUrlParam('page_groups')||'1',10) || 1;
    var s = parseInt(getUrlParam('page_size_groups')||'10',10) || 10;
    var qg = getUrlParam('q_groups') || '';
    var qs = qg ? ('&q=' + encodeURIComponent(qg)) : '';
    fetch('/api/groups?page=' + p + '&page_size=' + s + qs, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(j){ renderGroupsPermissions(j); })
      .catch(function(_){ renderGroupsPermissions({ items: [], page: 1, total_pages: 1 }); });
  } catch(_) {}
}

function renderGroupsPermissions(data){
  try {
    var tbody = document.getElementById('groups-permissions');
    if (tbody) {
      var rows = (data && data.items ? data.items : []).map(function(it){
        var name = (it && (it.name||it.login||it.display_name)) || '';
        return '<tr class="table__body_row"><td>' + escapeHtml(name) + '</td><td class="text-center"></td></tr>';
      }).join('');
      tbody.innerHTML = rows || '';
    }
    buildPager('groups-pagination', data && data.page, data && data.total_pages, 'groups');
  } catch(_) {}
}

function loadUsersPermissions(){
  try {
    var p = parseInt(getUrlParam('page_users')||'1',10) || 1;
    var s = parseInt(getUrlParam('page_size_users')||'10',10) || 10;
    var qu = getUrlParam('q_users') || '';
    var qs = qu ? ('&q=' + encodeURIComponent(qu)) : '';
    fetch('/api/users?page=' + p + '&page_size=' + s + qs, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(j){ renderUsersPermissions(j); })
      .catch(function(_){ renderUsersPermissions({ items: [], page: 1, total_pages: 1 }); });
  } catch(_) {}
}

function renderUsersPermissions(data){
  try {
    var tbody = document.getElementById('users-permissions');
    if (tbody) {
      var rows = (data && data.items ? data.items : []).map(function(it){
        var name = (it && (it.name||it.login||it.display_name)) || '';
        return '<tr class="table__body_row"><td>' + escapeHtml(name) + '</td><td class="text-center"></td></tr>';
      }).join('');
      tbody.innerHTML = rows || '';
    }
    buildPager('users-pagination', data && data.page, data && data.total_pages, 'users');
  } catch(_) {}
}

function buildPager(containerId, page, totalPages, scope){
  try {
    var cont = document.getElementById(containerId);
    if (!cont) return;
    page = parseInt(page||'1',10) || 1; totalPages = parseInt(totalPages||'1',10) || 1;
    var html = '';
    function li(p, lbl, active){
      return '<li class="page-item' + (active?' active':'') + '"><a class="page-link" href="#" data-page="' + p + '" data-scope="' + scope + '">' + lbl + '</a></li>';
    }
    html += li(Math.max(1, page-1), '&laquo;', false);
    for (var i=Math.max(1, page-2); i<=Math.min(totalPages, page+2); i++) { html += li(i, String(i), i===page); }
    html += li(Math.min(totalPages, page+1), '&raquo;', false);
    cont.innerHTML = html;
    // bind clicks
    cont.querySelectorAll('a[data-page]').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        var p = parseInt(this.getAttribute('data-page')||'1',10)||1;
        if (scope==='groups') { setUrlParams({ page_groups: p }); loadPage('groups', p, getUrlParam('q_groups')||''); }
        else { setUrlParams({ page_users: p }); loadPage('users', p, getUrlParam('q_users')||''); }
      }, false);
    });
  } catch(_) {}
}

// --- Full categories-like search mechanics ---
function wireSearchbar(which){
  try {
    var inputId = (which === 'groups') ? 'groups-search' : 'users-search';
    var input = document.getElementById(inputId);
    if (!input) return;
    if (input.__wired) return; input.__wired = true;
    // restore from URL
    var v = getUrlParam(which === 'groups' ? 'q_groups' : 'q_users') || '';
    if (v) {
      input.value = v;
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
    }
    // debounce input, update URL param and reload table
    var t = null;
    input.addEventListener('input', function(){ if (t) clearTimeout(t); t = setTimeout(function(){ filterTable(which); }, 200); });
    input.addEventListener('change', function(){ filterTable(which); });
    // clear button inside same .searchbar (delegated is already global, but make it explicit)
    var bar = input.closest('.searchbar');
    if (bar) {
      var btn = bar.querySelector('button');
      if (btn && !btn.__wired){
        btn.__wired = true;
        btn.addEventListener('click', function(e){ try { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } catch(_) {}
          clearSearch(which);
        }, true);
      }
    }
  } catch(_) {}
}

function filterTable(which){
  try {
    var inputId = (which === 'groups') ? 'groups-search' : 'users-search';
    var input = document.getElementById(inputId);
    var term = (input && input.value) ? String(input.value).trim() : '';
    // persist its own q_* and reset its own page to 1
    if (which === 'groups') setUrlParams({ q_groups: term, page_groups: 1 });
    else setUrlParams({ q_users: term, page_users: 1 });
    loadPage(which, 1, term);
  } catch(_) {}
}

function clearSearch(which){
  try {
    var inputId = (which === 'groups') ? 'groups-search' : 'users-search';
    var input = document.getElementById(inputId);
    if (input) { input.value = ''; try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {} try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {} }
    if (which === 'groups') setUrlParams({ q_groups: '', page_groups: 1 }); else setUrlParams({ q_users: '', page_users: 1 });
    loadPage(which, 1, '');
  } catch(_) {}
}

function loadPage(which, page, q){
  try {
    var isGroups = (which === 'groups');
    var pageSize = parseInt(getUrlParam(isGroups ? 'page_size_groups' : 'page_size_users') || '10', 10) || 10;
    var qs = q ? ('&q=' + encodeURIComponent(q)) : '';
    var url = isGroups ? ('/api/groups?page=' + (page||1) + '&page_size=' + pageSize + qs)
                       : ('/api/users?page=' + (page||1) + '&page_size=' + pageSize + qs);
    fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(j){ if (isGroups) renderGroupsPermissions(j); else renderUsersPermissions(j); })
      .catch(function(_){ if (isGroups) renderGroupsPermissions({ items: [], page: 1, total_pages: 1 }); else renderUsersPermissions({ items: [], page: 1, total_pages: 1 }); });
  } catch(_) {}
}

function debounce(fn, ms){ var t=null; return function(){ var ctx=this, args=arguments; if (t) clearTimeout(t); t=setTimeout(function(){ t=null; try{ fn.apply(ctx, args); }catch(_){ } }, ms||200); }; }
function escapeHtml(s){ try { return String(s).replace(/[&<>"']/g, function(ch){ return ({'&':'&amp;','<':'&lt;','>':'&gt','"':'&quot;','\'':'&#39;'}[ch]); }); } catch(_){ return s; } }
