// Initialize unified context menu for groups page
function initGroupsContextMenu() {
  const table = document.getElementById('maintable');
  if (!table) return;

  // Get table permissions
  const canManage = table.getAttribute('data-can-manage') === '1';

  // Initialize unified context menu
  if (window.contextMenu) {
    window.contextMenu.init({
      page: 'groups',
      canManage: canManage
    });
  } else {
    // Fallback: retry after a short delay
    setTimeout(() => {
      if (window.contextMenu) {
        window.contextMenu.init({
          page: 'groups',
          canManage: canManage
        });
      } else {
        console.warn('Context menu module not loaded');
      }
    }, 100);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGroupsContextMenu);
} else {
  initGroupsContextMenu();
}

// Additional groups page functionality
(function () {
  // Persist and auto-apply search like files page
  (function initGroupsSearchPersistence(){
    try {
      const input = document.getElementById('searchinp');
      if (!input) return;
      const key = 'groups:search';
      const saved = (function(){ try { return localStorage.getItem(key) || ''; } catch(_) { return ''; } })();
      if (saved) {
        input.value = saved;
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        try { window.addEventListener('load', function(){ setTimeout(function(){ try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {} }, 0); }); } catch(_) {}
      }
      input.addEventListener('input', function(e){
        const v = (e.target.value || '').trim();
        try {
          if (v) localStorage.setItem(key, v); else localStorage.removeItem(key);
        } catch(_) {}
      });
      // Provide clear handler for shared searchbar button
      try { window.searchClean = function(){
        const el = document.getElementById('searchinp');
        if (el) { el.value = ''; try { el.focus(); } catch(_) {} }
        try { localStorage.removeItem(key); } catch(_) {}
        try {
          if (typeof window.groupsDoFilter === 'function') {
            window.groupsDoFilter('');
          } else {
            el && el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch(_) {}
      }; } catch(_) {}
    } catch(_) {}
  })();

  // Bind search input early and resiliently (like users)
  (function bindGroupsSearchEarly(){
    const bind = function(){
      try {
        const input = document.getElementById('searchinp');
        if (!input || input._groupsEarlyBound) return;
        input._groupsEarlyBound = true;
        const trigger = function(){
          try {
            const val = (input.value || '').trim();
            if (window.groupsDoFilter) window.groupsDoFilter(val);
          } catch(_) {}
        };
        input.addEventListener('input', trigger);
        input.addEventListener('keyup', trigger);
        input.addEventListener('change', trigger);
        setTimeout(trigger, 0);
      } catch(_) {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
    try { window.addEventListener('load', function(){ setTimeout(bind, 0); }); } catch(_) {}
    try { document.addEventListener('table-updated', function(){ setTimeout(bind, 0); }); } catch(_) {}
    try {
      let attempts = 0;
      const iv = setInterval(function(){ attempts += 1; bind(); if (attempts >= 10) clearInterval(iv); }, 200);
    } catch(_) {}
  })();
  /**
   * Return groups table element or null
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
   * Open a modal and hydrate the form from selected row
   * @param {('add'|'edit'|'delete')} modalId
   * @param {string=} rowId
   */
  function openModal(modalId, rowId) {
    let formId;
    let form;
    if (rowId) {
      const formMap = {
        'edit': 'edit',
        'delete': 'delete'
      };
      formId = formMap[modalId] || modalId;
      form = document.getElementById(formId);
      if (form) {
        popupValues(form, rowId);
        // Store original field values for change detection
        if (formId === 'edit') {
          try {
            const row = document.getElementById(rowId);
            form.dataset.rowId = rowId;
            form.dataset.origName = (row && row.dataset && row.dataset.name) ? row.dataset.name : '';
            form.dataset.origDescription = (row && row.dataset && row.dataset.description) ? row.dataset.description : '';
          } catch (_) {}
        }
      }
    }
    popupToggle('popup-' + modalId, rowId || 0);
    // Ensure values are visible after modal render
    if (rowId && formId === 'edit' && form) {
      setTimeout(function(){ try { popupValues(form, rowId); } catch(_) {} }, 0);
    }
    // Reset modal primary button label to default on open
    try {
      const modal = document.getElementById('popup-' + modalId);
      if (modal) {
        const btn = modal.querySelector('.btn.btn-primary');
        if (btn) {
          const current = btn.textContent || '';
          if (!btn.dataset.defaultText && current && current.trim() && current.trim() !== 'Отправка...') {
            btn.dataset.defaultText = current.trim();
          }
          const restored = btn.dataset.defaultText || btn.dataset.originalText || current || 'Отправить';
          btn.textContent = restored;
          btn.disabled = false;
        }
      }
    } catch(_) {}
  }

  /** Bind page-level handlers for context menu, search, and copy. */
  function attachHandlers() {
    const table = getTable();
    if (!table) return;
    const canManage = table.dataset.canManage === '1';

    // Initialize pagination (server-side, like files page)
    (function initGroupsPagination(){
      const pager = document.getElementById('groups-pagination');
      const tbody = table.tBodies && table.tBodies[0];
      if (!pager || !tbody) return;
      const pageSize = 15;
      function render(page){
        const url = new URL(window.location.origin + '/groups/page');
        url.searchParams.set('page', String(page));
        url.searchParams.set('page_size', String(pageSize));
        url.searchParams.set('t', String(Date.now()));
        fetch(String(url), { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : { html: '', total: 0, page: 1 })
          .then(j => {
            if (!j || typeof j.html !== 'string') return;
            const searchRow = tbody.querySelector('tr#search');
            const temp = document.createElement('tbody');
            temp.innerHTML = j.html;
            Array.from(tbody.querySelectorAll('tr')).forEach(function(tr){ if (!searchRow || tr !== searchRow) tr.remove(); });
            Array.from(temp.children).forEach(function(tr){ tbody.appendChild(tr); });
            // build pager like files
            const total = j.total || 0;
            const pages = Math.max(1, Math.ceil(total / pageSize));
            const pageCur = j.page || 1;
            const btn = (label, targetPage, disabled = false, extraClass = '') =>
              `<li class=\"page-item ${extraClass} ${disabled ? 'disabled' : ''}\"><a class=\"page-link\" href=\"#\" data-page=\"${targetPage}\">${label}</a></li>`;
            const items = [];
            items.push(btn('⏮', 1, pageCur === 1, 'first'));
            items.push(btn('‹', Math.max(1, pageCur - 1), pageCur === 1, 'prev'));
            items.push(`<li class=\"page-item ${pageCur === 1 ? 'active' : ''}\"><a class=\"page-link\" href=\"#\" data-page=\"1\">1</a></li>`);
            const leftStart = Math.max(2, pageCur - 2);
            const leftGap = leftStart - 2;
            if (leftGap >= 1) items.push(`<li class=\"page-item disabled\"><span class=\"page-link\">…</span></li>`);
            const midStart = Math.max(2, pageCur - 2);
            const midEnd = Math.min(pages - 1, pageCur + 2);
            for (let p = midStart; p <= midEnd; p++) items.push(`<li class=\"page-item ${p === pageCur ? 'active' : ''}\"><a class=\"page-link\" href=\"#\" data-page=\"${p}\">${p}</a></li>`);
            const rightEnd = Math.min(pages - 1, pageCur + 2);
            const rightGap = (pages - 1) - rightEnd;
            if (rightGap >= 1) items.push(`<li class=\"page-item disabled\"><span class=\"page-link\">…</span></li>`);
            if (pages > 1) items.push(`<li class=\"page-item ${pageCur === pages ? 'active' : ''}\"><a class=\"page-link\" href=\"#\" data-page=\"${pages}\">${pages}</a></li>`);
            items.push(btn('›', Math.min(pages, pageCur + 1), pageCur === pages, 'next'));
            items.push(btn('⏭', pages, pageCur === pages, 'last'));
            pager.innerHTML = `<nav><ul class=\"pagination mb-0\">${items.join('')}</ul></nav>`;
            if (!pager._clickBound) {
              pager.addEventListener('click', function(e){
                const a = e.target && e.target.closest('[data-page]');
                if (!a) return;
                e.preventDefault();
                const p = parseInt(a.getAttribute('data-page'), 10) || 1;
                render(p);
              });
              pager._clickBound = true;
            }
            try { reinitializeContextMenu(); } catch(_) {}
            try { if (window.rebindGroupsTable) window.rebindGroupsTable(); } catch(_) {}
          })
          .catch(function(){});
      }
      window.groupsPager = { renderPage: render, readPage: function(){ return 1; } };
      render(1);
    })();

    // Search (modeled after filesDoFilter)
    window.groupsDoFilter = function groupsDoFilter(query) {
      const tableEl = document.getElementById('maintable');
      if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0]) return Promise.resolve(false);
      const tbodyEl = tableEl.tBodies[0];
      const pager = document.getElementById('groups-pagination');
      const q = (query || '').trim();
      if (q.length > 0) {
        if (pager) pager.classList.add('d-none');
        const url = new URL(window.location.origin + '/groups/search');
        url.searchParams.set('q', q);
        url.searchParams.set('page', '1');
        url.searchParams.set('page_size', '30');
        url.searchParams.set('t', String(Date.now()));
        return fetch(String(url), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
          .then(r => r.ok ? r.json() : { html: '' })
          .then(j => {
            if (!j || !j.html) return false;
            const searchRow = tbodyEl.querySelector('tr#search');
            const temp = document.createElement('tbody');
            temp.innerHTML = j.html;
            Array.from(tbodyEl.querySelectorAll('tr')).forEach(function(tr){ if (!searchRow || tr !== searchRow) tr.remove(); });
            Array.from(temp.children).forEach(function(tr){ tbodyEl.appendChild(tr); });
            try { if (window.rebindGroupsTable) window.rebindGroupsTable(); } catch(_) {}
            try { reinitializeContextMenu(); } catch(_) {}
            return true;
          })
          .catch(function(){ return false; });
      } else {
        if (pager) pager.classList.remove('d-none');
        if (window.groupsPager && typeof window.groupsPager.renderPage === 'function') {
          window.groupsPager.renderPage(1);
        }
        return Promise.resolve(true);
      }
    };

    const search = document.getElementById('searchinp');
    if (search) {
      const debounced = debounce(function(q){ window.groupsDoFilter(q); }, 280);
      search.addEventListener('input', function () { debounced(this.value); });
    }

    // Click-to-copy group name
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
    bindCopy('#maintable tbody .groups-page__name', 'Клик — скопировать название');

    // Expose a rebind helper to refresh per-row handlers after tbody replacement
    window.rebindGroupsTable = function() {
      try {
        bindCopy('#maintable tbody .groups-page__name', 'Клик — скопировать название');
      } catch (_) {}
    };
  }

  // Change-detection helpers for edit forms (global scope)
  function closeModal(id) {
    try { popupClose(id); } catch(_) {}
  }

  window.isEditChanged = function(form) {
    try {
      const name = (form.querySelector('input[name="name"]').value || '').trim();
      const description = (form.querySelector('textarea[name="description"]').value || '').trim();
      const oName = form.dataset.origName || '';
      const oDescription = form.dataset.origDescription || '';
      return (name !== oName) || (description !== oDescription);
    } catch (e) { return true; }
  };

  // Check if group is system group (for client-side validation)
  window.isSystemGroup = function(groupName, adminGroupName) {
    if (!groupName || !adminGroupName) return false;
    return groupName.toLowerCase() === adminGroupName.toLowerCase();
  };
  
  // Change-detection initialization
  (function initGroupsChangeDetection() {

    document.addEventListener('DOMContentLoaded', function(){
      // Edit modal save
      const editForm = document.getElementById('edit');
      if (editForm) {
        const saveBtn = editForm.parentElement && editForm.parentElement.querySelector('.btn.btn-primary');
        // Fallback: find button inside form
        const btn = saveBtn || editForm.querySelector('button.btn.btn-primary');
        if (btn && !btn._groupsEditBound) {
          btn._groupsEditBound = true;
          btn.addEventListener('click', function(){
            if (!window.isEditChanged(editForm)) {
              closeModal('popup-edit');
              return;
            }
            submitGroupFormAjax(editForm);
          });
        }
      }
    });
  })();

  // Function to refresh the groups page after actions
  window.refreshGroupsPage = function() {
    // Use soft refresh instead of full reload to avoid navigation logs
    try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
  };

  /**
   * Update group row in table locally without page refresh
   * @param {string|number} groupId - The ID of the group to update
   * @param {Object} groupData - Object containing group data to update
   * @param {string} [groupData.name] - Group's display name
   * @param {string} [groupData.description] - Group's description
   */
  window.updateGroupRowLocally = function(groupId, groupData) {
    try {
      const row = document.querySelector(`tr[data-id="${groupId}"]`);
      if (!row) return;
      
      const cells = row.querySelectorAll('td');
      if (cells.length >= 4) {
        // Update name (column 0)
        if (groupData.name !== undefined) {
          cells[0].textContent = groupData.name;
          row.dataset.name = groupData.name;
        }
        
        // Update description (column 1) 
        if (groupData.description !== undefined) {
          cells[1].textContent = groupData.description || '—';
          row.dataset.description = groupData.description;
        }
      }
    } catch (e) {
      console.error('Error updating group row locally:', e);
    }
  };

  /**
   * Add new group row to table locally without page refresh
   * @param {Object} groupData - Object containing new group data
   * @param {string|number} groupData.id - Group's ID
   * @param {string} groupData.name - Group's display name
   * @param {string} groupData.description - Group's description
   */
  window.addGroupRowLocally = function(groupData) {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      
      const newRow = document.createElement('tr');
      newRow.setAttribute('data-id', groupData.id);
      newRow.className = 'table__body_row';
      newRow.innerHTML = `
        <td class="table__body_item">
          <span class="groups-page__name">${groupData.name || ''}</span>
        </td>
        <td class="table__body_item">${groupData.description || '—'}</td>
        <td class="table__body_item">
          <span class="groups-page__user-count">0</span>
        </td>
        <td class="table__body_item">—</td>
      `;
      
      tbody.appendChild(newRow);
      
      // Update pagination if needed
      updatePaginationCounts();
    } catch (e) {
      console.error('Error adding group row locally:', e);
    }
  };

  /**
   * Remove group row from table locally without page refresh
   * @param {string|number} groupId - The ID of the group to remove
   */
  window.removeGroupRowLocally = function(groupId) {
    try {
      const row = document.querySelector(`tr[data-id="${groupId}"]`);
      if (row) {
        row.remove();
        // Update pagination if needed
        updatePaginationCounts();
      }
    } catch (e) {
      console.error('Error removing group row locally:', e);
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
    const name = row.dataset.name || '';
    const description = row.dataset.description || '';
    
    // Fill form fields based on form ID
    if (form.id === 'edit') {
      const nameInput = form.querySelector('input[name="name"]');
      const descriptionInput = form.querySelector('textarea[name="description"]');
      
      if (nameInput) nameInput.value = name;
      if (descriptionInput) descriptionInput.value = description;
      
      // Update form action URL with correct ID
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
      try { form.dataset.rowId = rowId; } catch(_) {}
    } else if (form.id === 'delete') {
      // Update form action URL with correct ID
      if (form.action && form.action.includes('/0')) {
        form.action = form.action.replace('/0', '/' + rowId);
      }
      try { form.dataset.rowId = rowId; } catch(_) {}
      
      // Update delete confirmation text (paragraph is outside the form)
      let confirmText = null;
      try {
        const popup = form.closest('.popup');
        if (popup) {
          confirmText = popup.querySelector('.popup__body > p');
        }
      } catch(_) {}
      if (!confirmText) {
        confirmText = form.querySelector('p');
      }
      if (confirmText) {
        confirmText.innerHTML = `Вы действительно хотите удалить группу <b>${name}</b>?`;
      }
    }
  };
  
  // Function to validate and submit group forms via AJAX
  window.validateForm = function(formElement) {
    // Find the form element
    const form = formElement.closest ? formElement.closest('form') : 
                 formElement.querySelector ? formElement.querySelector('form') :
                 formElement.tagName === 'FORM' ? formElement : null;
    
    if (!form) {
      console.error('Form not found');
      if (window.showToast) { window.showToast('Форма не найдена', 'error'); }
      return false;
    }
    
    // Client-side validation
    if (!validateGroupForm(form)) {
      return false;
    }
    
    // For edit form, check if there are changes
    if (form.id === 'edit') {
      if (!window.isEditChanged(form)) {
        try { popupClose('popup-edit'); } catch(_) {}
        return false;
      }
    }
    
    // Submit form via AJAX
    submitGroupFormAjax(form);
    return false; // Prevent default form submission
  };
  
  // Function to validate group form fields
  function validateGroupForm(form) {
    // Trim all input fields
    const inputs = form.querySelectorAll('input[type="text"], textarea');
    inputs.forEach(input => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });
    
    // Check name field
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) {
      const name = nameInput.value.trim();
      if (!name || name.length === 0) {
        if (window.showToast) { window.showToast('Название группы не может быть пустым', 'error'); } else { alert('Название группы не может быть пустым'); }
        nameInput.focus();
        return false;
      }
      
      // For edit form, check if trying to change system group name
      if (form.id === 'edit') {
        const rowId = form.dataset.rowId;
        if (rowId) {
          const row = document.getElementById(rowId);
          if (row) {
            const originalName = row.dataset.name;
            const adminGroupName = window.adminGroupName || 'Программисты';
            
            // If original name was admin group and trying to change it
            if (window.isSystemGroup(originalName, adminGroupName) && name.toLowerCase() !== originalName.toLowerCase()) {
              if (window.showToast) { window.showToast('Название системной группы нельзя изменять', 'error'); } else { alert('Название системной группы нельзя изменять'); }
              nameInput.focus();
              return false;
            }
          }
        }
      }
    }
    
    return true;
  };
  
  // Function to submit group forms via AJAX
  window.submitGroupFormAjax = function(form) {
    if (!window.submitFormAjax) {
      console.error('submitFormAjax helper not found');
      if (window.showToast) { window.showToast('Внутренняя ошибка: нет AJAX помощника', 'error'); }
      return false;
    }
    
    // For edit form, check if there are changes before submitting
    if (form.id === 'edit' && !window.isEditChanged(form)) {
      // No changes detected, just close modal
      const modal = form.closest('.overlay-container');
      if (modal) {
        const modalId = modal.id;
        try { popupClose(modalId); } catch(e) { console.error('Error closing modal:', e); }
      }
      return;
    }
    
    window.submitFormAjax(form)
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
            // Soft refresh table to reflect new group
            try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
          } else if (form.id === 'edit') {
            // Update existing row locally
            const groupId = form.dataset.rowId;
            if (groupId) {
              const nameInput = form.querySelector('input[name="name"]');
              const descriptionInput = form.querySelector('textarea[name="description"]');
              
              const groupData = {
                name: nameInput ? nameInput.value.trim() : undefined,
                description: descriptionInput ? descriptionInput.value.trim() : undefined
              };
              
              updateGroupRowLocally(groupId, groupData);
              // Also sync dataset attributes for consistency
              try {
                const row = document.querySelector(`tr[data-id="${groupId}"]`);
                if (row) {
                  if (groupData.name !== undefined) row.dataset.name = groupData.name;
                  if (groupData.description !== undefined) row.dataset.description = groupData.description;
                }
              } catch(_) {}
              // Ensure table is refreshed (sorting/pagination) after edit
              try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
            }
          } else if (form.id === 'delete') {
            // Remove the group row from table locally
            const groupId = form.dataset.rowId || form.action.match(/\/(\d+)$/)?.[1];
            if (groupId) {
              removeGroupRowLocally(groupId);
            } else {
              try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
            }
          } else {
            // Unknown form: prefer soft refresh over full reload
            try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
          }
        } catch (e) {
          console.error('Error updating table locally:', e);
          try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
        }
        
        // Emit socket event for other users
        try { 
          if (window.socket && window.socket.emit) {
            window.socket.emit('groups:changed', { reason: 'form-submit', formId: form.id, originClientId: (window.__groupsClientId || (window.__groupsClientId = Math.random().toString(36).slice(2) + Date.now())) });
          }
        } catch(e) {}
    })
    .catch((err) => {
      // Close modal on error as well (e.g., attempt to delete non-empty or system group)
      try {
        const modal = form.closest('.overlay-container');
        if (modal) {
          const modalId = modal.id;
          popupClose(modalId);
        }
      } catch(_) {}
    });
  };

  // Live soft refresh via Socket.IO
  (function initGroupsLiveUpdates() {
    // Reuse global socket (like files/users) to avoid breaking other listeners
    try {
      if (!window.io) return;
      // Ensure a stable per-tab client id for deduplicating our own events
      try { if (!window.__groupsClientId) window.__groupsClientId = (Math.random().toString(36).slice(2) + Date.now()); } catch(_) {}
      let socket = window.socket;
      if (!(socket && (socket.connected || socket.connecting))) {
        try {
          socket = window.io(window.location.origin, {
            transports: ['websocket','polling'],
            path: '/socket.io/',
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
          });
          window.socket = socket;
        } catch(__) {}
      }
      if (socket) {
        // Always (re)bind listeners for the current socket instance
        try { socket.off && socket.off('groups:changed'); } catch(_) {}
        try { socket.off && socket.off('/groups:changed'); } catch(_) {}
        socket.on('connect', function(){ try { softRefreshGroupsTable(); } catch(_) {} });
        socket.on('disconnect', function(){ /* no-op */ });
        socket.on('groups:changed', function(evt){ 
          try {
            const fromSelf = !!(evt && evt.originClientId && window.__groupsClientId && evt.originClientId === window.__groupsClientId);
            if (fromSelf) return;
          } catch(_) {}
          if (document.hidden) {
            try { window.__groupsHadBackgroundEvent = true; } catch(_) {}
            try { softRefreshGroupsTable(); } catch(_) {}
          } else {
            try { softRefreshGroupsTable(); } catch(_) {}
          }
        });
        window.groupsSocket = socket;
      }
    } catch (e) {}

    // Register and unify soft refresh using TableManager.
    // Rebinds context menu and per-row handlers after DOM replacement.
    try { window.tableManager && window.tableManager.registerTable('maintable', { pageType: 'groups', refreshEndpoint: window.location.href, smoothUpdate: true }); } catch(_) {}

    function softRefreshGroupsTable() {
      try {
        // If a search is active, re-run it; otherwise, re-render current page
        const input = document.getElementById('searchinp');
        const q = (input && typeof input.value === 'string') ? input.value.trim() : '';
        if (q) {
          if (typeof window.groupsDoFilter === 'function') {
            window.groupsDoFilter(q);
            return;
          }
        }
        // No search: use pager if available
        if (window.groupsPager && typeof window.groupsPager.renderPage === 'function' && typeof window.groupsPager.readPage === 'function') {
          try { return void window.groupsPager.renderPage(window.groupsPager.readPage()); } catch(_) {}
        }
        // Fallback to TableManager soft refresh
        if (window.tableManager && window.tableManager.softRefreshTable) {
          window.tableManager.softRefreshTable('maintable').then(function(){
            try { reinitializeContextMenu(); } catch(_) {}
            try { if (window.rebindGroupsTable) window.rebindGroupsTable(); } catch(_) {}
            try { setTimeout(reinitializeContextMenu, 0); } catch(_) {}
          });
        }
      } catch(_) {}
    }
    try { window.softRefreshGroupsTable = softRefreshGroupsTable; } catch(_) {}
  })();

  // Focus/visibility: reconnect and one soft refresh on return
  try {
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) {
        try { if (window.socket && !window.socket.connected) window.socket.connect(); } catch(_) {}
        try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
      }
    });
  } catch(_) {}
  try {
    window.addEventListener('focus', function(){
      try { if (window.socket && !window.socket.connected) window.socket.connect(); } catch(_) {}
      try { window.softRefreshGroupsTable && window.softRefreshGroupsTable(); } catch(_) {}
    });
  } catch(_) {}

  /**
   * Reinitialize context menu after table update
   */
  function reinitializeContextMenu() {
    // Prevent frequent reinitializations that can cause timeouts
    const now = Date.now();
    if (window._lastContextMenuReinit && (now - window._lastContextMenuReinit) < 500) {
      return; // Skip if called less than 500ms ago
    }
    window._lastContextMenuReinit = now;
    
    try {
      // Use requestIdleCallback for non-blocking reinitialization
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => {
          try {
            // Trigger a custom event to reinitialize context menu
            const event = new CustomEvent('context-menu-reinit', {
              detail: { timestamp: Date.now() }
            });
            document.dispatchEvent(event);
            
            // Also trigger table update event for any other listeners
            document.dispatchEvent(new Event('table-updated'));
          } catch(e) {
            console.error('Context menu reinit failed:', e);
          }
        }, { timeout: 1000 });
      } else {
        // Fallback: use setTimeout with small delay
        setTimeout(() => {
          try {
            // Trigger a custom event to reinitialize context menu
            const event = new CustomEvent('context-menu-reinit', {
              detail: { timestamp: Date.now() }
            });
            document.dispatchEvent(event);
            
            // Also trigger table update event for any other listeners
            document.dispatchEvent(new Event('table-updated'));
          } catch(e) {
            console.error('Context menu reinit failed:', e);
          }
        }, 10);
      }
    } catch(e) {
      console.error('Context menu reinit failed:', e);
    }
  }

  // Simple debounce helper
  function debounce(fn, ms){ let t; return function(){ clearTimeout(t); const args = arguments; t = setTimeout(()=>fn.apply(null,args), ms); } }

  document.addEventListener('DOMContentLoaded', attachHandlers);

  // Global search cleaner handled by files.js
})();

