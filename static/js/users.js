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
          const link = (row && row.querySelector('[data-enabled]')) ? `${window.location.origin}${window.location.pathname.replace(/\/srs.*/, '/srs')}/toggle/${rowId}` : '';
          if (link) window.location.href = link;
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
      menu.addEventListener('click', handleMenuClick);
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
  }

  // Preserve existing globals used by forms
  window.popupValues = window.popupValues || function (form, id) {
    if (!id) return;
    const row = document.getElementById(id);
    const cells = row ? row.getElementsByTagName('td') : [];
    if (form.id === 'edit') {
      // Prefer dataset values; fallback to cell text
      const loginInput = form.querySelector('input[name="login"]');
      const nameInput = form.querySelector('input[name="name"]');
      const rowLogin = (row.dataset.login || (cells[0] ? cells[0].innerText : '')).trim();
      const rowName = (row.dataset.name || (cells[1] ? cells[1].innerText : '')).trim();
      if (loginInput) loginInput.value = rowLogin;
      if (nameInput) nameInput.value = rowName;
      const active = form.querySelector('.checkbox-active');
      if (active) {
        // Determine enabled from dataset or icon state
        let enabled = row && row.dataset ? row.dataset.enabled : null;
        if (enabled == null || enabled === '') {
          const td = row.querySelector('td[data-enabled]');
          enabled = td && (td.getAttribute('data-enabled') || td.dataset.enabled);
        }
        const isEnabled = String(enabled) === '1' || enabled === true;
        active.checked = !!isEnabled;
        // Lock admin
        const isAdmin = (row.dataset.login || '').toLowerCase() === 'admin';
        active.disabled = !!isAdmin;
        // ensure style updates after DOM paint
        setTimeout(function(){ active.dispatchEvent(new Event('change', {bubbles:true})); }, 0);
      }
      const select = form.querySelector('select[name="group"]');
      const rowGid = (row.dataset.gid || '').toString();
      if (select) {
        if (rowGid) {
          select.value = rowGid;
        } else if (cells[2]) {
          // Fallback by text match
          const currentText = (row.dataset.groupname || cells[2].innerText || '').trim();
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].textContent.trim() === currentText) {
              select.selectedIndex = i;
              break;
            }
          }
        }
      }
    } else if (form.id === 'delete' || form.id === 'reset') {
      const b = form.parentElement.getElementsByTagName('b');
      if (b[0]) b[0].innerText = cells[0].innerText;
    }
    form.action = form.action.replace(/0$/, row.id);
  };

  window.validateForm = window.validateForm || function (form) {
    const pwd = form.elements['password'];
    const pwd2 = form.elements['password2'];
    if (pwd && pwd2) {
      if (pwd.value !== pwd2.value) {
        alert('Пароли не совпадают!');
        return false;
      }
    }
    return true;
  };

  document.addEventListener('DOMContentLoaded', attachHandlers);

  // Global search cleaner used by searchbar component
  window.searchClean = window.searchClean || function () {
    var input = document.getElementById('searchinp');
    if (!input) return;
    input.value = '';
    var evt = new Event('input', { bubbles: true });
    input.dispatchEvent(evt);
  };
})();
