// Context menu and actions for users page
// Provides: right-click actions, modal hydration, search, copy-to-clipboard, and inline toggling
(function () {
  /**
   * Return users table element or null
   * @returns {HTMLTableElement|null}
   */
  function getTable() {
    return document.getElementById('maintable');
  }

  /**
   * Find selected TR for given event target
   * @param {Element} target
   * @returns {HTMLTableRowElement|null}
   */
  function getSelectedRow(target) {
    const row = target.closest('tr.table__body_row');
    return row && row.id ? row : null;
  }

  /**
   * Show custom context menu at cursor position
   * @param {MouseEvent} e
   * @param {HTMLElement|null} row
   * @param {boolean} canManage
   */
  function showContextMenu(e, row, canManage) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    // Reset visibility
    menu.classList.remove('d-none');
    // Position with basic overflow handling
    const margin = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY;
    // If menu would overflow to the right/bottom, shift it
    if (x + rect.width + margin > vw) {
      x = Math.max(vw - rect.width - margin, margin);
    }
    if (y + rect.height + margin > vh) {
      y = Math.max(vh - rect.height - margin, margin);
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Configure items based on selection and manage rights
    const items = menu.querySelectorAll('.context-menu__item');
    items.forEach(i => (i.style.display = 'none'));

    const addItem = menu.querySelector('[data-action="add"]');
    addItem.style.display = canManage ? '' : 'none';

    if (row && canManage) {
      const enabled = row.dataset.enabled === '1';
      const toggle = menu.querySelector('[data-action="toggle"]');
      toggle.textContent = enabled ? 'Выключить' : 'Включить';
      const isAdmin = (row.dataset.login || '').toLowerCase() === 'admin';
      const actions = isAdmin ? ['reset'] : ['toggle','edit','perm','reset','delete'];
      actions.forEach(a => {
        const el = menu.querySelector(`[data-action="${a}"]`);
        if (el) el.style.display = '';
      });
    } else {
      // Clicked on empty space: only add
      addItem.style.display = canManage ? '' : 'none';
    }

    menu.dataset.targetId = row ? row.id : '';
  }

  function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.classList.add('d-none');
  }

  /**
   * Open a modal and hydrate the form from selected row
   * @param {('add'|'edit'|'perm'|'reset'|'delete')} modalId
   * @param {string=} rowId
   */
  function openModal(modalId, rowId) {
    let formId;
    let form;
    if (rowId) {
      const formMap = {
        'edit': 'edit',
        'reset': 'reset',
        'delete': 'delete',
        'perm': 'perm'
      };
      formId = formMap[modalId] || modalId;
      form = document.getElementById(formId);
      if (form) {
        popupValues(form, rowId);
        // Ensure permission checkboxes reflect current legacy string
        if (formId === 'perm') {
          syncPermFormFromRow(form, rowId);
          // In case layout needs time, re-sync on next tick
          setTimeout(function(){ syncPermFormFromRow(form, rowId); }, 0);
          // Store original permission string for change detection
          try {
            const row = document.getElementById(rowId);
            form.dataset.origPerm = (row && row.dataset && row.dataset.perm) ? row.dataset.perm : '';
            const hidden = form.querySelector('#perm-string-perm');
            form.dataset.origPermCurrent = hidden ? (hidden.value || '') : '';
          } catch (_) {}
        } else if (formId === 'edit') {
          // Store original field values for change detection
          try {
            const row = document.getElementById(rowId);
            form.dataset.rowId = rowId;
            form.dataset.origLogin = (row && row.dataset && row.dataset.login) ? row.dataset.login : '';
            form.dataset.origName = (row && row.dataset && row.dataset.name) ? row.dataset.name : '';
            form.dataset.origGid = (row && row.dataset && row.dataset.gid) ? row.dataset.gid : '';
            const enabled = (row && row.dataset && row.dataset.enabled) ? row.dataset.enabled : '';
            form.dataset.origEnabled = enabled;
          } catch (_) {}
        }
      }
    }
    popupToggle('popup-' + modalId, rowId || 0);
    // Ensure values are visible after modal render
    if (rowId && formId === 'edit' && form) {
      setTimeout(function(){ try { popupValues(form, rowId); } catch(_) {} }, 0);
    }
  }

  /**
   * Sync permissions checkboxes from legacy permission string on row dataset
   * and fill the left-side summary only.
   * @param {HTMLFormElement} form
   * @param {string} rowId
   */
  function syncPermFormFromRow(form, rowId) {
    const row = document.getElementById(rowId);
    if (!row || !form) return;
    // Only sync permissions; do NOT sync login/name/group/enabled in this modal

    // Fill left-side summary
    const loginBox = document.getElementById('perm-summary-login');
    const nameBox = document.getElementById('perm-summary-name');
    const groupBox = document.getElementById('perm-summary-group');
    const enabledBox = document.getElementById('perm-summary-enabled');
    const login = (row.dataset.login || '').trim();
    const name = (row.dataset.name || '').trim();
    const groupName = (row.dataset.groupname || '').trim();
    if (loginBox) loginBox.textContent = login;
    if (nameBox) nameBox.textContent = name;
    if (groupBox) groupBox.textContent = groupName;
    if (enabledBox) enabledBox.textContent = (row.dataset.enabled === '1') ? 'Да' : 'Нет';

    // Sync checkboxes from legacy string on row dataset
    const input = form.querySelector('#perm-string-perm');
    const legacy = (row.dataset.perm || '');
    if (input) input.value = legacy;
    const boxId = (input ? input.id : 'perm-string-perm') + '-box';
    const box = document.getElementById(boxId);
    if (!box) return;
    const parts = (legacy || '').split(',');
    while (parts.length < 4) parts.push('');
    const groups = box.querySelectorAll('.permissions-group');
    groups.forEach(function (group) {
      const page = parseInt(group.getAttribute('data-page'), 10);
      const letters = (parts[page - 1] || '').split('');
      const set = {};
      letters.forEach(function (ch) { if (ch) set[ch] = true; });
      group.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        const ch = cb.getAttribute('data-letter');
        cb.checked = !!set[ch];
      });
    });

    // Also populate hidden fields so backend validation passes
    try {
      const hidLogin = form.querySelector('input[name="login"]');
      const hidName = form.querySelector('input[name="name"]');
      const hidGroup = form.querySelector('input[name="group"]');
      const hidEnabled = form.querySelector('input[name="enabled"]');
      if (hidLogin) hidLogin.value = (row.dataset.login || '').trim();
      if (hidName) hidName.value = (row.dataset.name || '').trim();
      if (hidGroup) hidGroup.value = (row.dataset.gid || '').toString();
      if (hidEnabled) hidEnabled.value = (row.dataset.enabled === '1') ? '1' : '0';
    } catch (_) {}
  }

  /**
   * Handle clicks inside custom context menu
   * @param {MouseEvent} e
   */
  function handleMenuClick(e) {
    const item = e.target.closest('.context-menu__item');
    if (!item) return;
    const action = item.dataset.action;
    const menu = document.getElementById('context-menu');
    const rowId = menu.dataset.targetId;
    hideContextMenu();
    switch (action) {
      case 'add':
        openModal('add');
        break;
      case 'toggle':
        if (rowId) {
          const row = document.getElementById(rowId);
          const toggleUrl = `${window.location.origin}${window.location.pathname.replace(/\/srs.*/, '/srs')}/toggle/${rowId}`;
          // Use AJAX instead of page reload
          fetch(toggleUrl, {
            method: 'POST',
            credentials: 'include'
          })
          .then(response => {
            if (response.ok) {
              // Update row locally instead of full page refresh
              if (row) {
                const currentEnabled = row.dataset.enabled === '1';
                const newEnabled = !currentEnabled;
                
                // Update row data
                row.dataset.enabled = newEnabled ? '1' : '0';
                
                // Update toggle icon in the table
                const toggleIcon = row.querySelector('.bi-toggle-on, .bi-toggle-off');
                if (toggleIcon) {
                  toggleIcon.classList.remove('bi-toggle-on', 'bi-toggle-off');
                  toggleIcon.classList.add(newEnabled ? 'bi-toggle-on' : 'bi-toggle-off');
                }
              }
              
              // Emit socket event for other users
              if (window.usersSocket && window.usersSocket.emit) {
                window.usersSocket.emit('users:changed', { reason: 'toggle' });
              }
            } else {
              alert('Ошибка при изменении статуса пользователя');
            }
          })
          .catch(error => {
            console.error('Error:', error);
            alert('Ошибка при изменении статуса пользователя');
          });
        }
        break;
      case 'edit':
        if (rowId) openModal('edit', rowId);
        break;
      case 'perm':
        if (rowId) openModal('perm', rowId);
        break;
      case 'reset':
        if (rowId) openModal('reset', rowId);
        break;
      case 'delete':
        if (rowId) openModal('delete', rowId);
        break;
    }
  }

  /** Bind page-level handlers for context menu, search, toggles, and copy. */
  function attachHandlers() {
    const table = getTable();
    if (!table) return;
    const canManage = table.dataset.canManage === '1';

    // Mirror files.js approach: handle at document level when table exists
    document.addEventListener('contextmenu', function(e) {
      if (!document.getElementById('maintable')) return; // not on users page
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest && e.target.closest('tr.table__body_row');
      showContextMenu(e, row, canManage);
    });
    document.addEventListener('click', function(e){
      // Ignore right-click (contextmenu), hide on left click only
      if (e.button === 0) hideContextMenu();
    });
    const menu = document.getElementById('context-menu');
    if (menu) {
      // Avoid duplicate binding after soft refresh
      if (!menu._usersMenuBound) {
        menu._usersMenuBound = true;
        menu.addEventListener('click', handleMenuClick);
      }
      // Suppress native context menu over our custom menu as well
      menu.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    }
    // Hide on scroll or resize to avoid floating menu in wrong place
    window.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('resize', hideContextMenu);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hideContextMenu(); });

    // Search
    const search = document.getElementById('searchinp');
    if (search) {
      search.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('#maintable tbody tr.table__body_row').forEach(row => {
          const text = row.innerText.toLowerCase();
          row.style.display = text.includes(q) ? '' : 'none';
        });
      });
    }

    // Make Active column toggle on click
    table.addEventListener('click', function (e) {
      if (!canManage) return;
      const td = e.target.closest('td[data-enabled]');
      if (!td || !table.contains(td)) return;
      const row = td.closest('tr.table__body_row');
      if (!row) return;
      const isAdmin = (row.dataset.login || '').toLowerCase() === 'admin';
      if (isAdmin) return; // admin always enabled
      const id = row.id;
      if (!id) return;
      // prevent double toggles
      if (td._toggling) return;
      td._toggling = true;
      const url = `${window.location.origin}/srs/toggle/${id}`;

      fetch(url, { method: 'GET', credentials: 'same-origin' })
        .then(() => {
          // Flip state in UI
          const wasEnabled = (td.getAttribute('data-enabled') === '1' || td.dataset.enabled === '1');
          const nowEnabled = wasEnabled ? '0' : '1';
          td.setAttribute('data-enabled', nowEnabled);
          td.dataset.enabled = nowEnabled;
          row.dataset.enabled = nowEnabled;
          const icon = td.querySelector('.bi');
          if (icon) {
            icon.classList.remove('bi-toggle-on', 'bi-toggle-off');
            icon.classList.add(nowEnabled === '1' ? 'bi-toggle-on' : 'bi-toggle-off');
          }
        })
        .catch(() => { /* ignore, backend also redirects if blocked */ })
        .finally(() => { td._toggling = false; });
    });

    // Click-to-copy login similar to files name
    function bindCopy(selector, title) {
      document.querySelectorAll(selector).forEach((el) => {
        if (el._copyBound) return;
        el._copyBound = true;
        el.style.cursor = 'copy';
        el.title = title;
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          const text = (el.textContent || '').trim();
          if (!text) return;
          const onDone = () => {
            el.classList.add('copied');
            setTimeout(() => el.classList.remove('copied'), 220);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onDone).catch(function(){
              try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'absolute';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                onDone();
              } catch(_) {}
            });
          } else {
            try {
              const ta = document.createElement('textarea');
              ta.value = text;
              ta.setAttribute('readonly', '');
              ta.style.position = 'absolute';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
              onDone();
            } catch(_) {}
          }
        });
      });
    }
    bindCopy('#maintable tbody .users-page__login', 'Клик — скопировать логин');
    bindCopy('#maintable tbody .users-page__name', 'Клик — скопировать имя');

    // Expose a rebind helper to refresh per-row handlers after tbody replacement
    window.rebindUsersTable = function() {
      try {
        bindCopy('#maintable tbody .users-page__login', 'Клик — скопировать логин');
        bindCopy('#maintable tbody .users-page__name', 'Клик — скопировать имя');
      } catch (_) {}
    };
  }

  // Legacy popupValues function removed - using new implementation below

  // Legacy function removed - using new validateForm below
  
  function submitFormAjax(form) {
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';
    
    // Disable submit button during request
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';
    }
    
    fetch(form.action, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    })
    .then(response => {
      if (response.ok) {
        // Close modal and refresh table
        const modal = form.closest('.overlay-container');
        const modalId = modal ? modal.id : null;
        if (modalId) closeModal(modalId);
        refreshUsersPage();
        
        // Emit socket event for other users
        if (window.usersSocket && window.usersSocket.emit) {
          window.usersSocket.emit('users:changed', { reason: 'form-submit' });
        }
      } else {
        response.text().then(text => {
          alert('Ошибка: ' + (text || 'Неизвестная ошибка'));
        });
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Ошибка при отправке данных');
    })
    .finally(() => {
      // Re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', attachHandlers);

  // Live soft refresh via Socket.IO
  (function initUsersLiveUpdates() {
    try {
      if (!window.io) return;
      const socket = window.io(window.location.origin, {
        transports: ['websocket', 'polling'],
        upgrade: true,
        path: '/socket.io/',
        withCredentials: true
      });
      socket.on('connect', function(){ softRefreshUsersTable(); });
      socket.on('users:changed', function(){ softRefreshUsersTable(); });
      window.usersSocket = socket;
    } catch (e) {}

    function softRefreshUsersTable() {
      const table = document.getElementById('maintable');
      if (!table) return;
      const tbody = table.tBodies && table.tBodies[0];
      if (!tbody) return;
      const url = window.location.href;
      fetch(url, { credentials: 'include' })
        .then(r => r.text())
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const newTbody = doc.querySelector('#maintable tbody');
          if (!newTbody) return;
          tbody.innerHTML = newTbody.innerHTML;
          try { if (window.rebindUsersTable) window.rebindUsersTable(); } catch(_) {}
        })
        .catch(() => {});
    }
    // Expose globally for post-action refreshes
    try { window.softRefreshUsersTable = softRefreshUsersTable; } catch(_) {}
  })();

  // Change-detection helpers for edit and permissions forms (global scope)
  function closeModal(id) {
    try { popupClose(id); } catch(_) {}
  }

  window.isEditChanged = function(form) {
    try {
      const login = (form.querySelector('input[name="login"]').value || '').trim();
      const name = (form.querySelector('input[name="name"]').value || '').trim();
      const group = (form.querySelector('select[name="group"]').value || '').toString();
      const enabledEl = form.querySelector('input[name="enabled"]');
      const enabled = enabledEl ? (enabledEl.checked ? '1' : '0') : '';
      const oLogin = form.dataset.origLogin || '';
      const oName = form.dataset.origName || '';
      const oGid = (form.dataset.origGid || '').toString();
      const oEnabled = form.dataset.origEnabled || '';
      return (login !== oLogin) || (name !== oName) || (group !== oGid) || (enabled !== oEnabled);
    } catch (e) { return true; }
  };

  window.isPermChanged = function(form) {
    try {
      const hidden = form.querySelector('#perm-string-perm');
      const current = hidden ? (hidden.value || '') : '';
      const orig = form.dataset.origPerm || form.dataset.origPermCurrent || '';
      return (current.trim() !== (orig || '').trim());
    } catch (e) { return true; }
  };
  
  // Change-detection initialization
  (function initUsersChangeDetection() {

    document.addEventListener('DOMContentLoaded', function(){
      // Edit modal save
      const editForm = document.getElementById('edit');
      if (editForm) {
        const saveBtn = editForm.parentElement && editForm.parentElement.querySelector('.btn.btn-primary');
        // Fallback: find button inside form
        const btn = saveBtn || editForm.querySelector('button.btn.btn-primary');
        if (btn && !btn._usersEditBound) {
          btn._usersEditBound = true;
          btn.addEventListener('click', function(){
            if (!window.isEditChanged(editForm)) {
              closeModal('popup-edit');
    return;
  }
            submitUserFormAjax(editForm);
          });
        }
      }

      // Permissions modal save
      const permForm = document.getElementById('perm');
      if (permForm && !permForm._usersPermBound) {
        permForm._usersPermBound = true;
        permForm.addEventListener('submit', function(e){
          e.preventDefault();
          if (!window.isPermChanged(permForm)) {
            closeModal('popup-perm');
      return;
    }
          submitUserFormAjax(permForm);
        });
      }
    });
  })();

  // Function to refresh the users page after actions
  window.refreshUsersPage = function() {
    // For now, simply reload the page
    // TODO: Implement AJAX table refresh
    window.location.reload();
  };

  /**
   * Update user row in table locally without page refresh
   * @param {string|number} userId - The ID of the user to update
   * @param {Object} userData - Object containing user data to update
   * @param {string} [userData.name] - User's display name
   * @param {string} [userData.login] - User's login
   * @param {string} [userData.group] - User's group name
   * @param {boolean} [userData.enabled] - Whether user is enabled
   * @param {string} [userData.permissions] - User's permissions string
   */
  window.updateUserRowLocally = function(userId, userData) {
    try {
      const row = document.querySelector(`tr[data-id="${userId}"]`);
      if (!row) return;
      
      const cells = row.querySelectorAll('td');
      if (cells.length >= 6) {
        // Update name (column 0)
        if (userData.name !== undefined) {
          cells[0].textContent = userData.name;
        }
        
        // Update login (column 1) 
        if (userData.login !== undefined) {
          cells[1].textContent = userData.login;
        }
        
        // Update group (column 2)
        if (userData.group !== undefined) {
          cells[2].textContent = userData.group;
        }
        
        // Update enabled status (column 3)
        if (userData.enabled !== undefined) {
          const enabledCell = cells[3];
          const toggle = enabledCell.querySelector('.form-check-input');
          if (toggle) {
            toggle.checked = userData.enabled;
          }
        }
        
        // Update permissions (column 4)
        if (userData.permissions !== undefined) {
          cells[4].textContent = userData.permissions;
        }
      }
    } catch (e) {
      console.error('Error updating user row locally:', e);
    }
  };

  /**
   * Add new user row to table locally without page refresh
   * @param {Object} userData - Object containing new user data
   * @param {string|number} userData.id - User's ID
   * @param {string} userData.name - User's display name
   * @param {string} userData.login - User's login
   * @param {string} userData.group - User's group name
   * @param {boolean} userData.enabled - Whether user is enabled
   * @param {string} userData.permissions - User's permissions string
   */
  window.addUserRowLocally = function(userData) {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      
      const newRow = document.createElement('tr');
      newRow.setAttribute('data-id', userData.id);
      newRow.innerHTML = `
        <td>${userData.name || ''}</td>
        <td>${userData.login || ''}</td>
        <td>${userData.group || ''}</td>
        <td>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" ${userData.enabled ? 'checked' : ''} 
                   onclick="handleToggle(${userData.id}, this.checked)">
          </div>
        </td>
        <td>${userData.permissions || ''}</td>
        <td class="table__body_action">
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-edit" 
                  onclick="popupValues(document.getElementById('edit'), ${userData.id}); popupToggle('popup-edit');">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-perm" 
                  onclick="popupValues(document.getElementById('perm'), ${userData.id}); popupToggle('popup-perm');">
            <i class="bi bi-shield-check"></i>
          </button>
        </td>
      `;
      
      tbody.appendChild(newRow);
      
      // Update pagination if needed
      updatePaginationCounts();
    } catch (e) {
      console.error('Error adding user row locally:', e);
    }
  };

  /**
   * Remove user row from table locally without page refresh
   * @param {string|number} userId - The ID of the user to remove
   */
  window.removeUserRowLocally = function(userId) {
    try {
      const row = document.querySelector(`tr[data-id="${userId}"]`);
      if (row) {
        row.remove();
        // Update pagination if needed
        updatePaginationCounts();
      }
    } catch (e) {
      console.error('Error removing user row locally:', e);
    }
  };

  // Function to update pagination counts
  function updatePaginationCounts() {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      
      const totalRows = tbody.querySelectorAll('tr').length;
      const pageInfo = document.querySelector('.pagination-info');
      if (pageInfo) {
        // Update total count display
        pageInfo.textContent = `Всего записей: ${totalRows}`;
      }
    } catch (e) {
      console.error('Error updating pagination counts:', e);
    }
  }
  
  // Function to populate form with data from table row
  window.popupValues = function(form, rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    
    // Get data from row attributes
    const login = row.dataset.login || '';
    const name = row.dataset.name || '';
    const gid = row.dataset.gid || '';
    const enabled = row.dataset.enabled || '0';
    const perm = row.dataset.perm || '';
    
    // Fill form fields based on form ID
    if (form.id === 'edit') {
      const loginInput = form.querySelector('input[name="login"]');
      const nameInput = form.querySelector('input[name="name"]');
      const groupSelect = form.querySelector('select[name="group"]');
      const enabledInput = form.querySelector('input[name="enabled"]');
      
      if (loginInput) loginInput.value = login;
      if (nameInput) nameInput.value = name;
      if (groupSelect) groupSelect.value = gid;
      if (enabledInput) enabledInput.checked = (enabled === '1');
      
      // Update form action URL with correct ID
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
      try { form.dataset.rowId = rowId; } catch(_) {}
    } else if (form.id === 'perm') {
      // Ensure action URL targets selected user id
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
      try { form.dataset.rowId = rowId; } catch(_) {}
    } else if (form.id === 'reset') {
      // Update form action URL with correct ID
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
    } else if (form.id === 'delete') {
      // Update form action URL with correct ID
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
      
      // Update delete confirmation text
      const confirmText = form.querySelector('p');
      if (confirmText) {
        confirmText.innerHTML = `Вы действительно хотите удалить пользователя <b>${name}</b>?`;
      }
    }
  };
  
  // Function to validate and submit user forms via AJAX
  window.validateForm = function(formElement) {
    // Find the form element
    const form = formElement.closest ? formElement.closest('form') : 
                 formElement.querySelector ? formElement.querySelector('form') :
                 formElement.tagName === 'FORM' ? formElement : null;
    
    if (!form) {
      console.error('Form not found');
      return false;
    }
    
    // Client-side validation
    if (!validateUserForm(form)) {
      return false;
    }
    
    // For edit form, check if there are changes
    if (form.id === 'edit') {
      if (!window.isEditChanged(form)) {
        try { popupClose('popup-edit'); } catch(_) {}
        return false;
      }
    }
    
    // For permissions form, check if there are changes
    if (form.id === 'perm') {
      if (!window.isPermChanged(form)) {
        try { popupClose('popup-perm'); } catch(_) {}
        return false;
      }
    }
    
    // Submit form via AJAX
    submitUserFormAjax(form);
    return false; // Prevent default form submission
  };
  
  // Function to validate user form fields
  function validateUserForm(form) {
    // Trim all input fields
    const inputs = form.querySelectorAll('input[type="text"], input[type="password"], textarea');
    inputs.forEach(input => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });
    
    // Check login field (for add and edit forms only; skip for perm)
    const loginInput = form.querySelector('input[name="login"]');
    if (loginInput && form.id !== 'perm') {
      const login = loginInput.value.trim();
      if (!login || login.length === 0) {
        alert('Логин не может быть пустым');
        loginInput.focus();
        return false;
      }
    }
    
    // Check name field (for add and edit forms only; skip for perm)
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput && form.id !== 'perm') {
      const name = nameInput.value.trim();
      if (!name || name.length === 0) {
        alert('Имя не может быть пустым');
        nameInput.focus();
        return false;
      }
    }
    
    // Check password field (for add and reset forms)
    const passwordInput = form.querySelector('input[name="password"]');
    if (passwordInput && (form.id === 'add' || form.id === 'reset')) {
      const password = passwordInput.value;
      if (!password || password.length === 0) {
        alert('Пароль не может быть пустым');
        passwordInput.focus();
        return false;
      }
      
      // Get minimum password length from config (fallback to 1)
      const minLength = window.CONFIG?.min_password_length || 1;
      if (password.length < minLength) {
        alert(`Пароль должен быть не менее ${minLength} символов`);
        passwordInput.focus();
        return false;
      }
    }
    
    // Check password confirmation (for add form)
    if (form.id === 'add') {
      const passwordConfirmInput = form.querySelector('input[name="password_confirm"]');
      if (passwordConfirmInput && passwordInput) {
        const password = passwordInput.value;
        const confirmPassword = passwordConfirmInput.value;
        if (password !== confirmPassword) {
          alert('Пароли не совпадают');
          passwordConfirmInput.focus();
          return false;
        }
      }
    }
    
    return true;
  };
  
  // Function to submit user forms via AJAX
  window.submitUserFormAjax = function(form) {
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"], button.btn-primary');
    const originalText = submitBtn ? submitBtn.textContent : '';
    
    // Disable submit button during request
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';
    }
    
    fetch(form.action, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(async response => {
      const contentType = response.headers.get('Content-Type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        try { data = await response.json(); } catch(_) {}
      }
      if (!response.ok || (data && data.status === 'error')) {
        const msg = (data && (data.message || data.error)) || `Ошибка: HTTP ${response.status}`;
        alert(msg);
        throw new Error(msg);
      }
      return data;
    })
    .then(() => {
        // Close modal first
        const modal = form.closest('.overlay-container');
        if (modal) {
          const modalId = modal.id;
          try { popupClose(modalId); } catch(e) { console.error('Error closing modal:', e); }
        } else {
          console.warn('Modal not found for form:', form.id);
        }
        
        // Update table locally instead of full page refresh
        try {
          if (form.id === 'add') {
            // Soft refresh table to reflect new user
            try { window.softRefreshUsersTable && window.softRefreshUsersTable(); } catch(_) {}
          } else if (form.id === 'edit') {
            // Update existing row locally
            const userId = form.dataset.rowId;
            if (userId) {
              const loginInput = form.querySelector('input[name="login"]');
              const nameInput = form.querySelector('input[name="name"]');
              const groupSelect = form.querySelector('select[name="group"]');
              const enabledInput = form.querySelector('input[name="enabled"]');
              
              const userData = {
                login: loginInput ? loginInput.value.trim() : undefined,
                name: nameInput ? nameInput.value.trim() : undefined,
                group: groupSelect ? groupSelect.options[groupSelect.selectedIndex].text : undefined,
                enabled: enabledInput ? enabledInput.checked : undefined
              };
              
              updateUserRowLocally(userId, userData);
              // Also sync dataset attributes for consistency
              try {
                const row = document.querySelector(`tr[data-id="${userId}"]`);
                if (row) {
                  if (userData.login !== undefined) row.dataset.login = userData.login;
                  if (userData.name !== undefined) row.dataset.name = userData.name;
                  if (groupSelect) row.dataset.groupname = groupSelect.options[groupSelect.selectedIndex].text;
                  if (groupSelect) row.dataset.gid = groupSelect.value;
                  if (userData.enabled !== undefined) row.dataset.enabled = userData.enabled ? '1' : '0';
                }
              } catch(_) {}
            }
          } else if (form.id === 'perm') {
            // Soft refresh to update computed labels
            try { window.softRefreshUsersTable && window.softRefreshUsersTable(); } catch(_) {}
          } else if (form.id === 'reset') {
            // Password reset doesn't change visible data, no update needed
          } else if (form.id === 'delete') {
            // Remove the user row from table locally
            const userId = form.dataset.rowId || form.action.match(/\/(\d+)$/)?.[1];
            if (userId) {
              removeUserRowLocally(userId);
            } else {
              window.location.reload(); // Fallback if no user ID
            }
          } else {
            // Unknown form, full refresh
            window.location.reload();
          }
        } catch (e) {
          console.error('Error updating table locally:', e);
          window.location.reload(); // Fallback to full refresh
        }
        
        // Emit socket event for other users
        try { 
          if (window.socket && window.socket.emit) {
            window.socket.emit('users:changed', { reason: 'form-submit', formId: form.id });
          }
        } catch(e) {}
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Ошибка при отправке данных');
    })
    .finally(() => {
      // Re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  };

  // Global search cleaner handled by files.js
})();
