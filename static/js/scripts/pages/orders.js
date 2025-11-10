// Orders page client logic: filters + table render
(function () {
  function applyOverdueHighlight(){
    try {
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      var now = new Date();
      tb.querySelectorAll('tr.table__body_row').forEach(function(tr){
        // Do not highlight overdue only for finalized orders
        try {
          var finalized = (tr.getAttribute('data-finalized') || '') === '1';
          if (finalized) { tr.classList.remove('order-overdue'); return; }
        } catch(_) {}
        var endStr = (tr.getAttribute('data-end') || '').trim();
        if (!endStr) {
          // fallback to visible cell text (6th column)
          try {
            var tds = tr.querySelectorAll('td');
            endStr = (tds[5] && (tds[5].textContent || '').trim()) || '';
          } catch(_) {}
        }
        if (!endStr) { tr.classList.remove('order-overdue'); return; }
        var parsed = new Date(String(endStr).replace(' ', 'T'));
        if (isNaN(parsed.getTime())) { tr.classList.remove('order-overdue'); return; }
        var isOverdue = parsed.getTime() < now.getTime();
        if (isOverdue) tr.classList.add('order-overdue');
        else tr.classList.remove('order-overdue');
      });
    } catch(_) {}
  }
  function fmtDate(s) {
    if (!s) return '';
    try {
      const d = new Date(s.replace(' ', 'T'));
      if (isNaN(d.getTime())) return s;
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) {
      return s;
    }
  }

  function statusText(st) {
    return st === 'in_progress' ? 'Работы ведутся' : st === 'stopped' ? 'Работы не ведутся' : 'Работы завершены';
  }
  function statusBtnClass(st) {
    // Map to Bootstrap button colors, matching filter chips
    if (st === 'in_progress') return 'btn-success';
    if (st === 'stopped') return 'btn-danger';
    if (st === 'done') return 'btn-info'; // голубой как в фильтре (#0dcaf0)
    return 'btn-secondary';
  }

  function toastFromError(res, fallback) {
    var body = res && res.body ? res.body : {};
    var reason = body.reason || body.error || '';
    var map = {
      approved_locked: 'Действие запрещено: наряд согласован',
      delete_permission_required: 'Недостаточно прав для удаления',
      edit_permission_required: 'Недостаточно прав для изменения',
      status_change_permission_required: 'Недостаточно прав для изменения статуса/сроков',
      not_approved: 'Действие доступно только для согласованных нарядов',
      done_with_all_dates_locked: 'Заблокировано: статус "завершены" и все сроки заполнены',
      validation: 'Заполните обязательные поля',
      dates_required: 'Заполните все три поля сроков: Выдан, Начало, Окончание',
      dates_order: 'Неверная последовательность дат: Окончание > Начало > Выдан',
      issued_too_early: 'Дата "Выдан" не может быть раньше сегодняшнего дня',
      already_extended: 'Продление уже выполнено ранее',
      forbidden: 'Недостаточно прав'
    };
    var msg = map[String(reason)] || fallback || 'Операция отклонена';
    return { msg: msg, level: (String(reason) === 'validation') ? 'warning' : 'warning' };
  }

  function currentMonthRange() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const d2 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { from: d2(from), to: d2(to) };
  }

  // --- localStorage keys for orders page (page only, search now in URL) ---
  const ORDERS_LASTPAGE_KEY = 'orders:lastPage';

  // --- Save/load search from URL, page state from localStorage ---
  function saveOrdersSearch(val) {
    // Update URL with search query
    try {
      const url = new URL(window.location.href);
      if (val) {
        url.searchParams.set('q', val);
      } else {
        url.searchParams.delete('q');
      }
      window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
    } catch (e) {
    }
    // Remove old localStorage usage (no longer needed)
    try {
      localStorage.removeItem('orders:search');
    } catch (_) {}
  }
  function getOrdersSearch() {
    // Get search from URL parameter q=
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get('q') || '';
      return q;
    } catch (e) {
      return '';
    }
  }
  function saveOrdersLastPage(page) { if (page > 0) localStorage.setItem(ORDERS_LASTPAGE_KEY, String(page)); }
  function getOrdersLastPage() { const pg = parseInt(localStorage.getItem(ORDERS_LASTPAGE_KEY) || '1', 10); return (+pg > 0 ? +pg : 1); }
  function resetOrdersPage() { localStorage.removeItem(ORDERS_LASTPAGE_KEY); }

  // --- Improved load function: uses search API if q, otherwise normal list ---
  async function load(page, opts = {}) {
    try {
      const st = [];
      if (document.getElementById('flt-st-inp').checked) st.push('in_progress');
      if (document.getElementById('flt-st-stp').checked) st.push('stopped');
      if (document.getElementById('flt-st-done').checked) st.push('done');
      const df = document.getElementById('flt-from').value;
      const dt = document.getElementById('flt-to').value;
      // Get service filter, but ignore it if user doesn't have view_all permission or admin group membership
      const hasViewAll = (window.OrdersPerms && window.OrdersPerms.view_all) || false;
      let isAdminGroupMember = false;
      try {
        const adminGroupId = (window.AdminGroupId !== null && window.AdminGroupId !== undefined) ? window.AdminGroupId : null;
        const userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
        if (adminGroupId !== null && userGid !== null && parseInt(adminGroupId) === parseInt(userGid)) {
          isAdminGroupMember = true;
        }
      } catch(_) {}
      const hasAccess = hasViewAll || isAdminGroupMember;
      const service = hasAccess ? ((document.getElementById('flt-service')?.value || '').trim()) : '';
      const q = (document.getElementById('searchinp')?.value || '').trim();
      // Save search to storage
      saveOrdersSearch(q);
      // page persistence (restore if not set and not search)
      let usePage = (typeof page === 'number' && page > 0) ? page : 1;
      const lastPage = getOrdersLastPage();
      if (!q && !opts.manualPage) {
        usePage = lastPage;
      }
      if (!usePage) usePage = 1;
      // Params
      const params = new URLSearchParams();
      params.set('status_in', st.join(','));
      if (df) params.set('date_from', df);
      if (dt) params.set('date_to', dt);
      if (service) params.set('service', service); // всегда ключ 'service' (а не service_in)
      if (q) params.set('q', q);
      params.set('page', String(usePage));
      params.set('page_size', '10');
      // Route: use /api/orders/search if q, else /api/orders
      const apiUrl = q ? `/api/orders/search?${params.toString()}` : `/api/orders?${params.toString()}`;
      const resp = await fetch(apiUrl, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
      if (!resp.ok || ct.indexOf('application/json') === -1) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`orders.api: non-JSON or HTTP ${resp.status}. Body starts with: ${String(txt).slice(0,120)}`);
      }
      const data = await resp.json();
      const items = data && Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
      render(items);
      const pager = document.getElementById('orders-pagination');
      if (pager && data && typeof data.total === 'number') {
        renderOrdersPaginationControls(pager, data.total, data.page || 1, data.page_size || 10);
        setupOrdersPaginationClickHandler();
      } else {
        
      }
      // Save lastPage if not searching and update URL with page/page_size
      if (!q) {
        const savedPage = data.page || 1;
        saveOrdersLastPage(savedPage);
        
        // Update URL with current page and page_size
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('page', String(savedPage));
          url.searchParams.set('page_size', String(data.page_size || 10));
          // Remove q if it exists
          url.searchParams.delete('q');
          window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
        } catch(e) {
          
        }
      }
      if (q && !items.length) {
        resetOrdersPage();
      }
    } catch (e) {
      if (opts && opts.silent) {
        // тихий режим: не тревожим пользователя и не затираем таблицу
        return;
      }
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.load');
      render([]);
    }
  }
  window.load = load;

  function render(rows) {
    const tb = document.getElementById('orders-tbody');
    if (!tb) return;
    // Preserve search row at top
    const existingSearch = tb.querySelector('#search');
    const searchHTML = existingSearch ? existingSearch.outerHTML : '';
    const oldInput = document.getElementById('searchinp');
    const wasFocused = document.activeElement === oldInput;
    const oldVal = oldInput ? oldInput.value : '';
    if (!rows.length) {
      tb.innerHTML = `${searchHTML}<tr><td colspan="10" class="text-muted py-3">Нет данных за выбранный период</td></tr>`;
      // fix: восстановление значения и фокуса поиска при отсутствии результатов
      const newInput = document.getElementById('searchinp');
      if (newInput) {
          newInput.value = oldVal;
          if (wasFocused) {
              try { newInput.focus(); const len = newInput.value.length; newInput.setSelectionRange(len, len); } catch(_) {}
          }
      }
      bindCreateButton();
      return;
    }
    var canApprove = !!(window.OrdersPerms && window.OrdersPerms.approve);
    function canLeaveNote(){
      var p = window.OrdersPerms || {};
      return !!(p.admin || p.notes);
    }
    function canSeeNoteFor(serviceName){
      var perms = window.OrdersPerms || {};
      if (perms.admin || perms.notes) return true;
      var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
      var map = window.OrdersGroups || {};
      var srv = String(serviceName || '').trim();
      var gid = map[srv];
      return !!(gid && userGid && gid === userGid);
    }
    tb.innerHTML = searchHTML + rows.map((r) => `
      <tr class="table__body_row" id="order-${r.id}"
          data-service="${(r.service||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"
          data-note="${ (r.note || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;') }"
          data-status="${(r.status||'').replace(/"/g,'&quot;')}"
          data-issued="${(r.issued||'').replace(/"/g,'&quot;')}"
          data-start="${(r.start||'').replace(/"/g,'&quot;')}"
          data-end="${(r.end||'').replace(/"/g,'&quot;')}"
          data-extended="${r.extended ? '1' : '0'}"
          data-finalized="${r.finalized ? '1' : '0'}">
        <td class="table__body_item">${(r.service || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${ (function(){
            // Render badge (if finalized) above the status button
            var st = (r.status || 'stopped');
            var text = statusText(st);
            var cls = statusBtnClass(st);
            var badge = r.finalized ? '<div class="mb-0 text-center p-0" style="margin:0;padding:0;"><span class="badge bg-info text-dark text-lowercase d-inline-block" style="font-size:.75rem;padding:.15rem .4rem;border-radius:.2rem;margin-left:0;">завершен</span></div>' : '';
            return badge + `<button type="button" class="btn btn-sm ${cls}" data-action="toggle-status" data-id="${r.id}" data-status="${st}">${text}</button>`;
          })() }</td>
        <td class="table__body_item">${(r.number || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${fmtDate(r.issued)}</td>
        <td class="table__body_item">${fmtDate(r.start)}</td>
        <td class="table__body_item">${fmtDate(r.end)}</td>
        <td class="table__body_item">${(r.responsible || '')}</td>
        <td class="table__body_item">${(function(){
            var wn = (r.work_name || '');
            var badges = [];
            if (r.extended) badges.push('<span class="badge bg-warning text-dark order-badge-extended">продлён</span>');
            var hd = badges.length ? ('<div class="mb-1">' + badges.join(' ') + '</div>') : '';
            return hd + '<div>' + wn + '</div>';
          })()}</td>
        <td class="table__body_item">${(function(){
            // Always render the approve toggle button so everyone sees it;
            // clicking is only bound for users with approve permission
            var disabled = canApprove ? '' : ' disabled';
            return `<button type="button" class="btn btn-sm ${r.approved ? 'btn-success' : 'btn-danger'}" data-action="toggle-approved" data-id="${r.id}" data-approved="${r.approved ? '1':'0'}"${disabled}>${r.approved ? 'Да' : 'Нет'}</button>`;
          })()}</td>
        <td class="table__body_item">${ (function(){
            var note = (r.note || '').replace(/</g, '&lt;');
            var canLeave = canLeaveNote();
            var canSee = canSeeNoteFor(r.service);
            if (canLeave) {
              return `<span class="note-badge${ note ? ' note-badge--has' : '' }" data-order-id="${r.id}">${ note ? note : '&lt;оставить примечание&gt;' }</span>`;
            }
            if (canSee) {
              return note ? note : '—';
            }
            return '—';
          })() }</td>
      </tr>
    `).join('');
    applyOverdueHighlight();
    const newInput = document.getElementById('searchinp');
    if (newInput) {
      newInput.value = oldVal;
      if (wasFocused) {
        try { newInput.focus(); const len = newInput.value.length; newInput.setSelectionRange(len, len); } catch(_) {}
      }
    }
    bindCreateButton();
    bindApprovedToggles();
    bindStatusToggles();
    bindRowDoubleClickForFiles();
    // edit/delete кнопки не отображаются в UI по требованию
    if (window.OrdersSearch && typeof window.OrdersSearch.setupOrdersSearch === 'function') {
      window.OrdersSearch.setupOrdersSearch();
    }
    bindNoteBadges(); // Обеспечить bind, даже если не через renderWithNoteBind
    bindOrdersContextMenu();
    bindDeleteButtons();
    setupOrdersHeaderTooltips();
  }
  function bindRowDoubleClickForFiles(){
    try {
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      tb.querySelectorAll('tr.table__body_row').forEach(function(tr){
        if (tr.dataset.dblBound === '1') return;
        tr.dataset.dblBound = '1';
        tr.addEventListener('dblclick', function(e){
          try {
            // Ignore if dblclick happens on interactive elements (buttons, inputs)
            var t = e.target;
            if (t && (t.closest('button') || t.closest('a') || t.closest('input') || t.closest('textarea') || t.closest('select'))) return;
            var idStr = String(this.id || '').replace('order-','');
            var oid = parseInt(idStr || '0', 10) || 0;
            // Permissions: require files_view OR membership in the service group (same as context menu)
            var svc = this.getAttribute('data-service') || '';
            var canFilesUI = !!(window.OrdersPerms && window.OrdersPerms.files_view);
            var canFilesByGroup = (function(){
              try {
                var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
                var map = window.OrdersGroups || {};
                var srv = String(svc || '').trim();
                var gid = map[srv] || map[srv.toLowerCase()] || map[srv.toUpperCase()];
                return !!(gid && userGid && gid === userGid);
              } catch(_) { return false; }
            })();
            if (!(canFilesUI || canFilesByGroup)) {
              if (window.showToast) window.showToast('Недостаточно прав для просмотра файлов', 'warning');
              return;
            }
            if (oid && typeof window.openOrderFilesModal === 'function') { window.openOrderFilesModal(oid); }
          } catch(_) {}
        });
      });
    } catch(_) {}
  }

  // --- search input persistence and clear button ---
  // --- убираем bindOrdersSearch полностью ---

  // Заменяем на интеграцию с files-search.js
  window.ordersDoFilter = function(q, page) { load(page || 1); };

  // Setup search clear button handler for Orders page
  (function setupOrdersSearchClearButton() {
    const setupClearButton = () => {
      const searchInput = document.getElementById('searchinp');
      if (!searchInput) { return; }
      
      // Find clear button (next sibling or parent's button)
      const searchbar = searchInput.closest('.searchbar');
      if (!searchbar) { return; }
      
      const clearBtn = searchbar.querySelector('button[onclick*="searchClean"], button[aria-label*="Очистить"], button:has(+ input)');
      if (!clearBtn) { return; }
      
      
      
      // Remove existing handler to avoid duplicates
      if (clearBtn.__ordersClearBound) { return; }
      clearBtn.__ordersClearBound = true;
      
      // Remove inline onclick to prevent conflicts
      const originalOnclick = clearBtn.getAttribute('onclick');
      if (originalOnclick) { clearBtn.removeAttribute('onclick'); }
      
      // Add event listener that will handle everything
      clearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const input = document.getElementById('searchinp');
        if (!input) { return; }
        
        const currentValue = input.value;
        
        if (!currentValue || !currentValue.trim()) { return; }
        
        // Clear input and dispatch events so input listeners react
        input.value = '';
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
        
        // Get current page and page_size from URL or use last saved page
        let restorePage = 1;
        let pageSize = 10;
        try {
          const url = new URL(window.location.href);
          const urlPage = url.searchParams.get('page');
          const urlPageSize = url.searchParams.get('page_size');
          if (urlPage) restorePage = parseInt(urlPage, 10) || 1;
          if (urlPageSize) pageSize = parseInt(urlPageSize, 10) || 10;
          
          // If no page in URL, try to get from localStorage
          if (!urlPage) {
            const lastPage = parseInt(localStorage.getItem('orders:lastPage') || '1', 10) || 1;
            restorePage = lastPage;
          }
          
          // Update URL to remove q parameter but keep page and page_size
          url.searchParams.delete('q');
          url.searchParams.set('page', String(restorePage));
          url.searchParams.set('page_size', String(pageSize));
          window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
        } catch(e) {
          
        }
        
        // Trigger load to restore pagination
        if (typeof window.load === 'function') { window.load(restorePage, { manualPage: false }); }
      }, true); // Use capture phase to run before other handlers
      
      
    };
    
    // Try to setup immediately
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupClearButton);
    } else {
      setupClearButton();
    }
    
    // Also try after delays (in case DOM is not ready)
    setTimeout(setupClearButton, 100);
    setTimeout(setupClearButton, 500);
    setTimeout(setupClearButton, 1000);
  })();

  // Delegated click handler to survive DOM rerenders of the search row
  (function delegateOrdersSearchClear(){
    try {
      if (window.__ordersClearDelegated) return;
      window.__ordersClearDelegated = true;
      document.addEventListener('click', function(e){
        try {
          // Work only within Orders section
          var ordersSection = document.querySelector("section[data-testid='orders-section']");
          if (!ordersSection) return;
          var btn = e.target && (e.target.closest && e.target.closest("section[data-testid='orders-section'] .searchbar button"));
          if (!btn) return;
          // Heuristic: clear button has aria-label 'Очистить поиск' or contains the X icon
          var isClear = (btn.getAttribute('aria-label')||'').indexOf('Очистить') !== -1;
          if (!isClear) return;
          // Prevent default and handle
          e.preventDefault();
          // Clear input and dispatch events
          var input = ordersSection.querySelector('#searchinp');
          if (!input) return;
          var hadValue = !!(input.value && input.value.trim());
          input.value = '';
          try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
          try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
          // Keep page and page_size in URL; remove q
          try {
            var url = new URL(window.location.href);
            var restorePage = parseInt(url.searchParams.get('page')||'0',10) || parseInt(localStorage.getItem('orders:lastPage')||'1',10) || 1;
            var pageSize = parseInt(url.searchParams.get('page_size')||'10',10) || 10;
            url.searchParams.delete('q');
            url.searchParams.set('page', String(restorePage));
            url.searchParams.set('page_size', String(pageSize));
            window.history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
          } catch(_) {}
          // Trigger load as a fallback if value actually changed
          if (hadValue && typeof window.load === 'function') {
            window.load(1, { manualPage: false });
          }
        } catch(_) {}
      }, true); // capture to run early
    } catch(_) {}
  })();

  function init() {
    const rng = currentMonthRange();
    const df = document.getElementById('flt-from');
    const dt = document.getElementById('flt-to');
    if (df && !df.value) df.value = rng.from;
    if (dt && !dt.value) dt.value = rng.to;
    // Block service filter if user doesn't have view_all permission
    // Also check if user is member of admin group
    try {
      var sel = document.getElementById('flt-service');
      if (sel) {
        var hasViewAll = (window.OrdersPerms && window.OrdersPerms.view_all) || false;
        var isAdminGroupMember = false;
        try {
          var adminGroupId = (window.AdminGroupId !== null && window.AdminGroupId !== undefined) ? window.AdminGroupId : null;
          var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
          if (adminGroupId !== null && userGid !== null && parseInt(adminGroupId) === parseInt(userGid)) {
            isAdminGroupMember = true;
          }
        } catch(_) {}
        var hasAccess = hasViewAll || isAdminGroupMember;
        if (!hasAccess) {
          // Disable filter
          sel.disabled = true;
          // Set to user's service if not already set
          if (!sel.value) {
            var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
            var map = window.OrdersGroups || {};
            var serviceName = null;
            // find service name with matching gid
            for (var name in map) {
              if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
              if (map[name] === userGid) { serviceName = name; break; }
            }
            if (serviceName) {
              // set exact option value match
              sel.value = serviceName;
            }
          }
        }
      }
    } catch(_) {}
    const applyBtn = document.getElementById('flt-apply');
    if (applyBtn) applyBtn.addEventListener('click', function () { load(1); });
    ['flt-st-inp', 'flt-st-stp', 'flt-st-done', 'flt-from', 'flt-to', 'flt-service'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { resetOrdersPage(); load(1); });
    });
    // restore search & page
    let pg = getOrdersLastPage();
    let q = getOrdersSearch();
    // Restore search input value from URL
    const searchInput = document.getElementById('searchinp');
    if (searchInput && q) {
      searchInput.value = q;
    }
    if (q) {
      load(1);
    } else {
      load(pg);
    }
    setupOrdersHeaderTooltips();
  }

  // ===== Header tooltips for truncated content =====
  function setupOrdersHeaderTooltips(){
    var table = document.getElementById('maintable');
    if (!table) return;
    var ths = table.querySelectorAll('thead th');
    function apply(){
      ths.forEach(function(th){
        var txt = (th.textContent || '').trim();
        if (!txt) { th.removeAttribute('title'); return; }
        var overflowing = th.scrollWidth > th.clientWidth;
        if (overflowing) th.setAttribute('title', txt);
        else th.removeAttribute('title');
      });
    }
    apply();
    if (!table._headerTooltipBound) {
      table._headerTooltipBound = true;
      var to = null;
      window.addEventListener('resize', function(){
        if (to) clearTimeout(to);
        to = setTimeout(apply, 120);
      }, true);
    }
  }

  function bindCreateButton(){
      var perms = (window.OrdersPerms || null);
      var canCreate = perms && typeof perms.create !== 'undefined' ? !!perms.create : null;
      var createBtn = document.getElementById('orders-create');
      if (!createBtn) return;
      if (canCreate === false) {
        createBtn.classList.add('d-none');
        createBtn.disabled = true;
        return;
      }
      if (createBtn.dataset.bound === '1') return;
      createBtn.dataset.bound = '1';
      createBtn.addEventListener('click', function (e) {
        e.preventDefault();
      if (window.openModal) window.openModal('orderCreateModal');
      // Ensure submit handlers are (re)bound when modal opens
      try { bindOrderCreateSubmitHandlers(); } catch(_) {}
      // Service selection removed; backend enforces user's service
    });
  }

  

  function bindOrderCreateSubmitHandlers(){
    try {
      var submitBtn = document.getElementById('order-create-submit');
      var form = document.getElementById('order-create-form');
      if (submitBtn && submitBtn.dataset.bound !== '1') {
        submitBtn.dataset.bound = '1';
        submitBtn.addEventListener('click', handleOrderCreateSubmit);
      }
      if (form && form.dataset.keybound !== '1') {
        form.dataset.keybound = '1';
        form.addEventListener('keydown', function(e){
          try {
            var isCtrl = e.ctrlKey || e.metaKey;
            var isEnter = (e.key === 'Enter');
            var isEsc = (e.key === 'Escape');
            if ((isCtrl && isEnter) || (isCtrl && (e.key.toLowerCase() === 's'))) {
              e.preventDefault();
              handleOrderCreateSubmit();
              return;
            }
            if (isEnter && e.target && e.target.tagName !== 'TEXTAREA') {
              e.preventDefault();
              handleOrderCreateSubmit();
              return;
            }
            if (isEsc) {
              try { if (window.closeModal) window.closeModal('orderCreateModal'); } catch(_) {}
            }
          } catch(_) {}
        });
      }
    } catch(_) {}
  }

  function handleOrderCreateSubmit(){
    try {
      var form = document.getElementById('order-create-form');
      if (!form) return;
      var fields = {
        number: document.getElementById('oc-number')?.value || '',
        responsible: document.getElementById('oc-responsible')?.value || '',
        work_name: document.getElementById('oc-work')?.value || ''
      };
      ['oc-number','oc-responsible','oc-work'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.classList.remove('is-invalid');
      });
      var missing = Object.keys(fields).filter(function(k){ return !String(fields[k]).trim(); });
      if (missing.length) {
        missing.forEach(function(k){ var el = document.getElementById('oc-' + (k === 'work_name' ? 'work' : k)); if (el) el.classList.add('is-invalid'); });
        if (window.showToast) window.showToast('Заполните обязательные поля', 'warning');
        return;
      }
        // Validate dates: all required; end > start > issued; (temporary: allow issued < today)
      (function validateCreateDates(){
        var ids = { issued: 'oc-issued', start: 'oc-start', end: 'oc-end' };
        Object.values(ids).forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
        function toDate(v){ if (!v) return null; var d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; }
        var vi = document.getElementById(ids.issued)?.value || '';
        var vs = document.getElementById(ids.start)?.value || '';
        var ve = document.getElementById(ids.end)?.value || '';
        var di = toDate(vi), ds = toDate(vs), de = toDate(ve);
        function mark(id){ var el = document.getElementById(id); if (el) el.classList.add('is-invalid'); }
        // Required all three
        if (!di || !ds || !de) {
          if (!di) mark(ids.issued); if (!ds) mark(ids.start); if (!de) mark(ids.end);
          if (window.showToast) window.showToast('Заполните все три поля сроков: Выдан, Начало, Окончание', 'warning');
          throw new Error('dates-required');
        }
        if (di && ds && di > ds) { mark(ids.issued); mark(ids.start); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Начала работ"', 'warning'); throw new Error('date-seq'); }
        if (ds && de && ds > de) { mark(ids.start); mark(ids.end); if (window.showToast) window.showToast('"Начало работ" должно быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
        if (di && de && di > de) { mark(ids.issued); mark(ids.end); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
          // Temporarily disabled: allow "Выдан" earlier than today
      })();
      var payload = {
        number: fields.number.trim(),
        responsible: fields.responsible.trim(),
        work_name: fields.work_name.trim(),
        status: 'stopped',
        issued: document.getElementById('oc-issued')?.value || '',
        start: document.getElementById('oc-start')?.value || '',
        end: document.getElementById('oc-end')?.value || ''
      };
      fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, status: r.status, body: j }; }); })
        .then(function(res){
          if (!res.ok || !res.body || res.body.ok === false) {
            var t = toastFromError(res, 'Ошибка сохранения');
            if (window.showToast) window.showToast(t.msg, t.level);
            return;
          }
          var modalEl = document.getElementById('orderCreateModal');
          try { if (window.closeModal) window.closeModal('orderCreateModal'); } catch(_) {}
          if (window.showToast) window.showToast('Наряд создан', 'success');
          load(1);
        }).catch(function(){ if (window.showToast) window.showToast('Сбой сети при сохранении', 'danger'); });
    } catch(e) {
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.create.submit');
    }
  }

  // Submit handler with validation and POST
  (function(){
    try {
      var submitBtn = document.getElementById('order-create-submit');
      if (submitBtn && !submitBtn.dataset.bound) {
        submitBtn.dataset.bound = '1';
        submitBtn.addEventListener('click', function(){
          try {
            var form = document.getElementById('order-create-form');
            if (!form) return;
            var fields = {
              number: document.getElementById('oc-number')?.value || '',
              responsible: document.getElementById('oc-responsible')?.value || '',
              work_name: document.getElementById('oc-work')?.value || ''
            };
            // Clear previous invalids
            ['oc-number','oc-responsible','oc-work'].forEach(function(id){
              var el = document.getElementById(id);
              if (el) el.classList.remove('is-invalid');
            });
            var missing = Object.keys(fields).filter(function(k){ return !String(fields[k]).trim(); });
            if (missing.length) {
              missing.forEach(function(k){ var el = document.getElementById('oc-' + (k === 'work_name' ? 'work' : k)); if (el) el.classList.add('is-invalid'); });
              if (window.showToast) window.showToast('Заполните обязательные поля', 'warning');
              return;
            }
            var payload = {
              number: fields.number.trim(),
              responsible: fields.responsible.trim(),
              work_name: fields.work_name.trim(),
              status: 'stopped',
              issued: document.getElementById('oc-issued')?.value || '',
              start: document.getElementById('oc-start')?.value || '',
              end: document.getElementById('oc-end')?.value || ''
            };
            fetch('/api/orders', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              body: JSON.stringify(payload)
            }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, status: r.status, body: j }; }); })
              .then(function(res){
                if (!res.ok || !res.body || res.body.ok === false) {
                  var t = toastFromError(res, 'Ошибка сохранения');
                  if (window.showToast) window.showToast(t.msg, t.level);
                  return;
                }
                // success
                var modalEl = document.getElementById('orderCreateModal');
                try { if (window.closeModal) window.closeModal('orderCreateModal'); } catch(_) {}
                if (window.showToast) window.showToast('Наряд создан', 'success');
                load(1);
              }).catch(function(){ if (window.showToast) window.showToast('Сбой сети при сохранении', 'danger'); });
          } catch(e) {
            window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.create.submit');
          }
        });
      }
    } catch(_) {}
  })();

  function renderOrdersPaginationControls(pagerEl, total, currentPage, pageSize) {
    try {
      if (!pagerEl) return;
      const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 10)));
      const cp = Math.min(Math.max(1, currentPage || 1), totalPages);
      const btn = (text, pageNum, disabled, active = false) =>
        `<li class="page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}">` +
        `<a class="page-link" href="#" data-page="${pageNum}">${text}</a>` +
        `</li>`;
      const items = [];
      items.push(btn('⏮', 1, cp === 1));
      items.push(btn('‹', Math.max(1, cp - 1), cp === 1));
      items.push(btn('1', 1, false, cp === 1));
      const windowSize = 3;
      let start = Math.max(2, cp - 1);
      let end = Math.min(totalPages - 1, cp + 1);
      while ((end - start + 1) < windowSize && start > 2) start--;
      while ((end - start + 1) < windowSize && end < totalPages - 1) end++;
      if (start > 2) items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
      for (let i = start; i <= end; i++) items.push(btn(String(i), i, false, i === cp));
      if (end < totalPages - 1) items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
      if (totalPages > 1) items.push(btn(String(totalPages), totalPages, false, cp === totalPages));
      items.push(btn('›', Math.min(totalPages, cp + 1), cp === totalPages));
      items.push(btn('⏭', totalPages, cp === totalPages));
      pagerEl.innerHTML = `<nav><ul class="pagination mb-0">${items.join('')}</ul></nav>`;
    } catch (e) {
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.renderPagination');
    }
  }

  // --- pagination: click handler saves page ---
  function setupOrdersPaginationClickHandler() {
    try {
      const pager = document.getElementById('orders-pagination');
      if (!pager) return;
      const links = pager.querySelectorAll('a.page-link[data-page]');
      links.forEach((a) => {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          const p = parseInt(this.getAttribute('data-page') || '1', 10) || 1;
          load(p, {manualPage:true});
        });
      });
    } catch (e) {
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.bindPagination');
    }
  }

  // ===== Context menu for orders =====
  function bindOrdersContextMenu(){
    try {
      var tb = document.getElementById('orders-tbody');
      var menu = document.getElementById('orders-context-menu');
      var targetInput = document.getElementById('orders-context-target-id');
      if (!tb || !menu || !targetInput) return;
      function hide(){ menu.classList.add('d-none'); }
      function showAt(x,y){ menu.style.left = x+'px'; menu.style.top = y+'px'; menu.classList.remove('d-none'); }
      document.addEventListener('click', hide, true);
      window.addEventListener('scroll', hide, true);
      window.addEventListener('resize', hide, true);
      tb.querySelectorAll('tr.table__body_row').forEach(function(tr){
        if (tr.dataset.cmBound === '1') return;
        tr.dataset.cmBound = '1';
        tr.addEventListener('contextmenu', function(e){
          try {
            e.preventDefault();
            var id = String(this.id||'').replace('order-','');
            if (!id) return;
            targetInput.value = id;
            // Permissions-based show/hide
            var svc = this.getAttribute('data-service') || '';
            var canEdit = canEditOrderFor(svc);
            var canTimeline = canEditStatusFor(svc);
            var canDelete = canDeleteOrderFor(svc);
            var canApproveUI = !!(window.OrdersPerms && window.OrdersPerms.approve);
            var canCreateUI = !!(window.OrdersPerms && window.OrdersPerms.create);
            var canFilesUI = !!(window.OrdersPerms && window.OrdersPerms.files_view);
            // Allow service group members to access files even without explicit orders.files_view
            var canFilesByGroup = (function(){
              try {
                var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
                var map = window.OrdersGroups || {};
                var srv = String(svc || '').trim();
                var gid = map[srv];
                return !!(gid && userGid && gid === userGid);
              } catch(_) { return false; }
            })();
            function setVis(action, visible){ var el = menu.querySelector('[data-action="'+action+'"]'); if (el) el.classList.toggle('d-none', !visible); }
            setVis('files', canFilesUI || canFilesByGroup);
            setVis('edit', canEdit);
            setVis('timeline', canTimeline);
            setVis('extend', canTimeline);
            setVis('delete', canDelete);
            setVis('create', canCreateUI);
            setVis('note', !!(window.OrdersPerms && (window.OrdersPerms.notes || window.OrdersPerms.admin)));
            setVis('approve', canApproveUI);
            setVis('unapprove', canApproveUI);
            var approveItem = menu.querySelector('[data-action="approve"]');
            var unapproveItem = menu.querySelector('[data-action="unapprove"]');
            var btn = this.querySelector('button[data-action="toggle-approved"]');
            var isApproved = btn ? (btn.getAttribute('data-approved') === '1') : false;
            var isExtended = (this.getAttribute('data-extended') === '1');
            var isFinalized = (this.getAttribute('data-finalized') === '1');
            if (canApproveUI && approveItem && unapproveItem) {
              approveItem.classList.toggle('d-none', isApproved);
              unapproveItem.classList.toggle('d-none', !isApproved);
            }
            // Business rules:
            // - Completion UI: when approved, rename to "Завершить наряд" and allow only timeline action
            // - After completion (status == done): show only files and note; hide edit/delete/timeline/approve
            // - If finalized: hide timeline (completion) action completely
            var st = (this.getAttribute('data-status') || '').trim();
            var issued = (this.getAttribute('data-issued') || '').trim();
            var start = (this.getAttribute('data-start') || '').trim();
            var end = (this.getAttribute('data-end') || '').trim();
            var isAdminOverride = (function(){
              var perms = window.OrdersPerms || {};
              if (perms.admin) return true;
              try { var agid = window.AdminGroupId, ugid = (window.CurrentUser && window.CurrentUser.gid) || null; if (agid && ugid && agid === ugid) return true; } catch(_) {}
              return false;
            })();
            if (st === 'done' && !isAdminOverride) {
              setVis('edit', false);
              setVis('delete', false);
              // If finalized, hide timeline completely; otherwise keep visible if approved
              if (isFinalized) {
                setVis('timeline', false);
              } else {
                setVis('timeline', canTimeline && isApproved);
                var tl = menu.querySelector('[data-action="timeline"]');
                if (tl && isApproved) tl.textContent = 'Завершить наряд';
              }
              setVis('extend', false);
              setVis('approve', false);
              setVis('unapprove', false);
            } else {
              if (!isApproved || isFinalized) {
                setVis('timeline', false);
                setVis('extend', false);
              } else {
                // ensure edit/delete hidden when approved
                if (!isAdminOverride) {
                  setVis('edit', false);
                  setVis('delete', false);
                }
                // Rename timeline action to "Завершить наряд" when approved and not finalized
                var tl = menu.querySelector('[data-action="timeline"]');
                if (tl) tl.textContent = 'Завершить наряд';
                // Hide extend after first extension
                setVis('extend', !isExtended);
              }
            }
            showAt(e.clientX, e.clientY);
          } catch(_) {}
        });
      });
      if (!menu.dataset.bound) {
        menu.dataset.bound = '1';
        menu.addEventListener('click', function(e){
          var li = e.target.closest('.context-menu__item');
          if (!li) return;
          var action = li.getAttribute('data-action');
          var id = parseInt(targetInput.value || '0', 10) || 0;
          hide();
          if (!action) return;
          switch(action){
            case 'files':
              if (id && window.openOrderFilesModal) window.openOrderFilesModal(id);
              break;
            case 'edit':
              if (id) openOrderEditModal(id);
              break;
            case 'timeline':
              if (id) openOrderTimelineModal(id);
              break;
            case 'extend':
              if (id) openOrderExtendModal(id);
              break;
            case 'delete':
              if (id) {
                var form = document.getElementById('delete');
                if (form) form.action = '/orders/delete/' + id;
                var row = document.getElementById('order-' + id);
                var numCell = row && row.children && row.children[2];
                var num = (numCell && numCell.textContent) || String(id);
                var nameEl = document.getElementById('order-delete-name');
                if (nameEl) nameEl.textContent = num.trim();
                if (window.openModal) window.openModal('orderDeleteModal');
              }
              break;
            case 'note':
              if (id) { if (window.openOrderNoteModal) window.openOrderNoteModal(id); }
              break;
            case 'approve':
            case 'unapprove':
              if (id) {
                var btn = document.querySelector('#order-' + id + ' button[data-action="toggle-approved"]');
                if (btn) btn.click();
              }
              break;
            case 'create':
              if (window.openModal) window.openModal('orderCreateModal');
              // Bind submit handlers
              try { if (typeof bindOrderCreateSubmitHandlers === 'function') bindOrderCreateSubmitHandlers(); } catch(_) {}
              break;
          }
        });
      }

      // Global context menu: anywhere on the orders page (outside rows) show only "Создать" if permitted
      var section = document.querySelector('section[data-testid="orders-section"]') || document.body;
      if (section && !section._cmGlobalBound) {
        section._cmGlobalBound = true;
        section.addEventListener('contextmenu', function(e){
          try {
            // Ignore if right-click originates within a table body row (row handler will manage it)
            var tr = e.target && (e.target.closest && e.target.closest('tr.table__body_row'));
            if (tr) return;
            e.preventDefault();
            e.stopPropagation();
            // Permissions: only show if can create
            var canCreateUI = !!(window.OrdersPerms && window.OrdersPerms.create);
            if (!canCreateUI) return;
            targetInput.value = '0';
            // Hide all items except create
            ['files','edit','timeline','extend','delete','approve','unapprove','note'].forEach(function(a){ var el = menu.querySelector('[data-action="'+a+'"]'); if (el) el.classList.add('d-none'); });
            var createEl = menu.querySelector('[data-action="create"]');
            if (createEl) createEl.classList.remove('d-none');
            showAt(e.clientX, e.clientY);
          } catch(_) {}
        }, true);
      }

      // Document-wide fallback within orders section scope
      if (!document._ordersBodyContextBound) {
        document._ordersBodyContextBound = true;
        document.addEventListener('contextmenu', function(e){
          try {
            // Only on orders section
            var inOrders = !!(e.target && e.target.closest && e.target.closest('section[data-testid="orders-section"]'));
            if (!inOrders) return;
            // Skip table rows (handled already) and open modals
            if (e.target.closest('tr.table__body_row')) return;
            if (e.target.closest('.modal.show')) return;
            e.preventDefault();
            e.stopPropagation();
            var canCreateUI = !!(window.OrdersPerms && window.OrdersPerms.create);
            if (!canCreateUI) return;
            targetInput.value = '0';
            ['files','edit','timeline','extend','delete','approve','unapprove','note'].forEach(function(a){ var el = menu.querySelector('[data-action="'+a+'"]'); if (el) el.classList.add('d-none'); });
            var createEl = menu.querySelector('[data-action="create"]');
            if (createEl) createEl.classList.remove('d-none');
            showAt(e.clientX, e.clientY);
          } catch(_) {}
        }, true);
      }
    } catch(_) {}
  }

  function bindApprovedToggles(){
    try {
      if (!(window.OrdersPerms && window.OrdersPerms.approve)) return;
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      tb.querySelectorAll('button[data-action="toggle-approved"]').forEach(function(btn){
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', function(){
          var id = parseInt(this.getAttribute('data-id') || '0', 10) || 0;
          var current = this.getAttribute('data-approved') === '1';
          var next = !current;
          var el = this;
          fetch('/api/orders/' + id + '/approved', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({ approved: next })
          }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
            .then(function(res){
              if (!res.ok || !res.body || res.body.ok === false) { var t = toastFromError(res, 'Не удалось изменить статус'); if (window.showToast) window.showToast(t.msg, t.level); return; }
              var val = !!res.body.approved;
              el.setAttribute('data-approved', val ? '1' : '0');
              el.classList.toggle('btn-success', val);
              el.classList.toggle('btn-danger', !val);
              el.textContent = val ? 'Да' : 'Нет';
              emitOrdersChanged('approve', { id: id, approved: val ? 1 : 0 });
            }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
        });
      });
    } catch(_) {}
  }

  function canEditStatusFor(serviceName){
    var perms = window.OrdersPerms || {};
    // Admin, explicit status_change, or member of admin group
    if (perms.admin || perms.status_change) return true;
    // Full-access users (view_all/edit_any imply ability to change status)
    if (perms.view_all || perms.edit_any) return true;
    try {
      var agid = (typeof window.AdminGroupId !== 'undefined') ? window.AdminGroupId : null;
      var ugid = (window.CurrentUser && window.CurrentUser.gid) || null;
      if (agid && ugid && agid === ugid) return true;
    } catch(_) {}
    // Service group members can change status for their service
    if (canEditOrderFor(serviceName)) return true;
    return false;
  }

  function canEditOrderFor(serviceName){
    var perms = window.OrdersPerms || {};
    if (perms.admin || perms.edit_any) return true;
    var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
    var map = window.OrdersGroups || {};
    var srv = String(serviceName || '').trim();
    var gid = map[srv] || map[srv.toLowerCase()] || map[srv.toUpperCase()];
    return !!(gid && userGid && gid === userGid);
  }

  function canDeleteOrderFor(serviceName){
    var perms = window.OrdersPerms || {};
    if (perms.admin || perms.delete_any) return true;
    var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
    var map = window.OrdersGroups || {};
    var srv = String(serviceName || '').trim();
    var gid = map[srv] || map[srv.toLowerCase()] || map[srv.toUpperCase()];
    return !!(gid && userGid && gid === userGid);
  }

  function bindEditButtons(){
    try {
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      tb.querySelectorAll('button[data-action="edit-order"]').forEach(function(btn){
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', function(){
          var id = parseInt(this.getAttribute('data-id') || '0', 10) || 0;
          if (id) openOrderEditModal(id);
        });
      });
    } catch(_) {}
  }

  function bindDeleteButtons(){
    try {
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      tb.querySelectorAll('button[data-action="delete-order"]').forEach(function(btn){
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', function(){
          var id = parseInt(this.getAttribute('data-id') || '0', 10) || 0;
          var num = this.getAttribute('data-number') || '';
          var form = document.getElementById('delete');
          if (form) form.action = '/orders/delete/' + id;
          var nameEl = document.getElementById('order-delete-name');
          if (nameEl) nameEl.textContent = num || String(id);
          if (window.openModal) window.openModal('orderDeleteModal');
        });
      });
      // AJAX delete submit
      var delBtn = document.getElementById('order-delete-submit');
      var delForm = document.getElementById('delete');
      if (delBtn && delForm && !delBtn.dataset.bound) {
        delBtn.dataset.bound = '1';
        delBtn.addEventListener('click', function(){
          try {
            var url = delForm.action || '';
            var m = url.match(/\/orders\/delete\/(\d+)/);
            var id = m ? parseInt(m[1], 10) : 0;
            fetch(url, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
              .then(function(r){ return r.json().catch(function(){return {}}).then(function(j){ return { ok: r.ok, body: j }; }); })
              .then(function(res){
                if (!res.ok || (res.body && res.body.ok === false)) { if (window.showToast) window.showToast('Ошибка удаления', 'danger'); return; }
                if (window.closeModal) window.closeModal('orderDeleteModal');
                if (window.showToast) window.showToast('Наряд удалён', 'success');
                emitOrdersChanged('delete', { id: id });
                softReloadOrders();
              }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
          } catch(_) {}
        });
      }
    } catch(_) {}
  }

  function fillEditForm(order){
    try {
      document.getElementById('oe-number').value = order.number || '';
      document.getElementById('oe-responsible').value = order.responsible || '';
      // Service selection removed
      document.getElementById('oe-work').value = order.work_name || '';
      function toInputDt(v){
        if (!v) return '';
        try {
          var d = new Date((v||'').replace(' ', 'T'));
          if (isNaN(d.getTime())) return '';
          var pad = function(n){return String(n).padStart(2,'0')};
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch(_) { return ''; }
      }
      document.getElementById('oe-issued').value = toInputDt(order.issued);
      document.getElementById('oe-start').value = toInputDt(order.start);
      document.getElementById('oe-end').value = toInputDt(order.end);
    } catch(_) {}
  }

  window.openOrderEditModal = function(orderId){
    fetch('/api/orders/' + orderId, { headers: { 'Accept': 'application/json' } })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Не удалось загрузить наряд', 'danger'); return; }
        var order = res.body.order || {};
        fillEditForm(order);
        var form = document.getElementById('order-edit-form');
        if (form) form.setAttribute('data-id', String(orderId));
        if (window.openModal) window.openModal('orderEditModal');
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
  }

  function toInputDt(v){
    if (!v) return '';
    try {
      var d = new Date((v||'').replace(' ', 'T'));
      if (isNaN(d.getTime())) return '';
      var pad = function(n){return String(n).padStart(2,'0')};
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch(_) { return ''; }
  }

  function openOrderTimelineModal(orderId){
    fetch('/api/orders/' + orderId, { headers: { 'Accept': 'application/json' } })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Не удалось загрузить наряд', 'danger'); return; }
        var o = res.body.order || {};
        document.getElementById('ot-issued').value = toInputDt(o.issued);
        document.getElementById('ot-start').value = toInputDt(o.start);
        document.getElementById('ot-end').value = toInputDt(o.end);
        var st = (o.status || 'stopped');
        var idMap = { stopped: 'ot-stopped', in_progress: 'ot-inp', done: 'ot-done' };
        var rid = idMap[st] || 'ot-stopped';
        var radio = document.getElementById(rid);
        if (radio) radio.checked = true;
        var form = document.getElementById('order-timeline-form');
        if (form) form.setAttribute('data-id', String(orderId));
        // If approved: allow only completion -> enable only end, lock issued/start and status to done
        try {
          var row = document.getElementById('order-' + orderId);
          var apprBtn = row ? row.querySelector('button[data-action="toggle-approved"]') : null;
          var isApproved = apprBtn ? (apprBtn.getAttribute('data-approved') === '1') : false;
          var titleEl = document.getElementById('orderTimelineModalTitle');
          var submitBtn = document.getElementById('order-timeline-submit');
          var issuedEl = document.getElementById('ot-issued');
          var startEl = document.getElementById('ot-start');
          var endEl = document.getElementById('ot-end');
          var stStopped = document.getElementById('ot-stopped');
          var stInp = document.getElementById('ot-inp');
          var stDone = document.getElementById('ot-done');
          if (isApproved) {
            if (titleEl) titleEl.textContent = 'Завершить наряд';
            if (submitBtn) submitBtn.textContent = 'Завершить';
            if (issuedEl) { issuedEl.disabled = true; }
            if (startEl) { startEl.disabled = true; }
            if (stStopped) stStopped.disabled = true;
            if (stInp) stInp.disabled = true;
            if (stDone) { stDone.checked = true; stDone.disabled = true; }
            if (endEl) { endEl.disabled = false; }
          } else {
            if (titleEl) titleEl.textContent = 'Изменение сроков и статуса';
            if (submitBtn) submitBtn.textContent = 'Сохранить';
            if (issuedEl) issuedEl.disabled = false;
            if (startEl) startEl.disabled = false;
            if (stStopped) stStopped.disabled = false;
            if (stInp) stInp.disabled = false;
            if (stDone) stDone.disabled = false;
          }
        } catch(_) {}
        if (window.openModal) window.openModal('orderTimelineModal');
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
  }

  function openOrderExtendModal(orderId){
    try {
      // Immediate prefill from the current table row (UI is already up-to-date)
      var row = document.getElementById('order-' + orderId);
      if (row) {
        var s = (row.getAttribute('data-start') || '').trim();
        var e = (row.getAttribute('data-end') || '').trim();
        // Fallback: read from visible cells if dataset empty
        if (!s || !e) {
          try {
            var tds = row.querySelectorAll('td');
            // indexes: 0 service,1 status,2 number,3 issued,4 start,5 end
            var sTxt = (tds[4] && (tds[4].textContent || '').trim()) || '';
            var eTxt = (tds[5] && (tds[5].textContent || '').trim()) || '';
            // Convert like "YYYY-MM-DD HH:MM" to input format; Date can parse
            if (!s && sTxt) s = sTxt.replace(' ', 'T');
            if (!e && eTxt) e = eTxt.replace(' ', 'T');
          } catch(_){}
        }
        var st = (row.getAttribute('data-status') || 'stopped').trim();
        var set = function(id, v){ var el = document.getElementById(id); if (el) el.value = v; };
        set('oe2-start', toInputDt(s));
        set('oe2-end', toInputDt(e));
        var idMap0 = { stopped: 'oe2-stopped', in_progress: 'oe2-inp', done: 'oe2-done' };
        var rid0 = idMap0[st] || 'oe2-stopped';
        var radio0 = document.getElementById(rid0);
        if (radio0) radio0.checked = true;
      }
      var form = document.getElementById('order-extend-form');
      if (form) form.setAttribute('data-id', String(orderId));
      if (window.openModal) window.openModal('orderExtendModal');
      // Reinforce after open (timing with Bootstrap transitions)
      setTimeout(function(){
        try {
          var set = function(id, v){ var el = document.getElementById(id); if (el && v) el.value = v; };
          set('oe2-start', toInputDt(s));
          set('oe2-end', toInputDt(e));
          var idMap1 = { stopped: 'oe2-stopped', in_progress: 'oe2-inp', done: 'oe2-done' };
          var rid1 = idMap1[st] || 'oe2-stopped';
          var radio1 = document.getElementById(rid1);
          if (radio1) radio1.checked = true;
        } catch(_) {}
      }, 50);
    } catch(_) {}

    fetch('/api/orders/' + orderId, { headers: { 'Accept': 'application/json' } })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Не удалось загрузить наряд', 'danger'); return; }
        var o = res.body.order || {};
        var set = function(id, v){ var el = document.getElementById(id); if (el) el.value = v; };
        set('oe2-start', toInputDt(o.start));
        set('oe2-end', toInputDt(o.end));
        // status
        var idMap = { stopped: 'oe2-stopped', in_progress: 'oe2-inp', done: 'oe2-done' };
        var rid = idMap[(o.status||'stopped')] || 'oe2-stopped';
        var radio = document.getElementById(rid);
        if (radio) radio.checked = true;
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
  }

  function handleOrderExtendSubmit(){
    var form = document.getElementById('order-extend-form');
    if (!form) return;
    var id = parseInt(form.getAttribute('data-id') || '0', 10) || 0;
    var inpStart = document.getElementById('oe2-start');
    var inpEnd = document.getElementById('oe2-end');
    var rawStart = (inpStart && inpStart.value) || '';
    var rawEnd = (inpEnd && inpEnd.value) || '';
    // If inputs are empty, fallback to row dataset / cells
    if ((!rawStart || !rawEnd) && id) {
      try {
        var row = document.getElementById('order-' + id);
        if (row) {
          var ds = (row.getAttribute('data-start') || '').trim();
          var de = (row.getAttribute('data-end') || '').trim();
          if ((!ds || !de)) {
            var tds = row.querySelectorAll('td');
            ds = ds || ((tds[4] && (tds[4].textContent || '').trim()) || '');
            de = de || ((tds[5] && (tds[5].textContent || '').trim()) || '');
          }
          if (!rawStart && ds) rawStart = ds.replace(' ', 'T');
          if (!rawEnd && de) rawEnd = de.replace(' ', 'T');
        }
      } catch(_) {}
    }
    // Normalize to server-expected format 'YYYY-MM-DD HH:MM'
    function toServerDt(v){ if (!v) return ''; return String(v).replace('T', ' ').slice(0,16); }
    var statusVal = (document.querySelector('input[name="oe2-status"]:checked')?.value || '').trim();
    var payload = {
      start: toServerDt(rawStart),
      end: toServerDt(rawEnd),
      status: statusVal
    };
    // simple client validation: require start/end and end > start
    var toDate = function(v){ if (!v) return null; var d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };
    var ds = toDate(payload.start.replace(' ', 'T')), de = toDate(payload.end.replace(' ', 'T'));
    ['oe2-start','oe2-end'].forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
    if (!ds || !de || (ds && de && ds > de)){
      if (!ds) { var es = document.getElementById('oe2-start'); if (es) es.classList.add('is-invalid'); }
      if (!de) { var ee = document.getElementById('oe2-end'); if (ee) ee.classList.add('is-invalid'); }
      if (window.showToast) window.showToast('Проверьте даты начала/окончания', 'warning');
      return;
    }
    fetch('/api/orders/' + id + '/extend', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) {
          var t = (function(){ return { msg: 'Ошибка продления', level: 'danger' }; })();
          if (window.showToast) window.showToast(t.msg, t.level);
          return;
        }
        if (window.closeModal) window.closeModal('orderExtendModal');
        if (window.showToast) window.showToast('Наряд продлён', 'success');
        load(1);
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети при продлении', 'danger'); });
  }

  function handleOrderTimelineSubmit(){
    var form = document.getElementById('order-timeline-form');
    if (!form) return;
    var id = parseInt(form.getAttribute('data-id') || '0', 10) || 0;
    var st = (document.querySelector('input[name="ot-status"]:checked')?.value || '').trim();
    // Normalize inputs to server format 'YYYY-MM-DD HH:MM'
    function toServerDt(v){ if (!v) return ''; return String(v).replace('T', ' ').slice(0,16); }
    // Validate according to mode (approved -> only completion)
    (function validateTimelineDates(){
      var ids = { issued: 'ot-issued', start: 'ot-start', end: 'ot-end' };
      Object.values(ids).forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
      function toDate(v){ if (!v) return null; var d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; }
      var vi = document.getElementById(ids.issued)?.value || '';
      var vs = document.getElementById(ids.start)?.value || '';
      var ve = document.getElementById(ids.end)?.value || '';
      var di = toDate(vi), ds = toDate(vs), de = toDate(ve);
      function mark(id){ var el = document.getElementById(id); if (el) el.classList.add('is-invalid'); }
      var row = document.getElementById('order-' + id);
      var apprBtn = row ? row.querySelector('button[data-action="toggle-approved"]') : null;
      var isApproved = apprBtn ? (apprBtn.getAttribute('data-approved') === '1') : false;
      if (isApproved) {
        if (!de) { mark(ids.end); if (window.showToast) window.showToast('Укажите "Окончание работ"', 'warning'); throw new Error('date-end-required'); }
        if (di && de && di > de) { mark(ids.end); if (window.showToast) window.showToast('"Окончание" должно быть позже даты выдачи', 'warning'); throw new Error('date-seq'); }
        if (ds && de && ds > de) { mark(ids.end); if (window.showToast) window.showToast('"Окончание" должно быть позже начала работ', 'warning'); throw new Error('date-seq'); }
        st = 'done';
      } else {
        if (di && ds && di > ds) { mark(ids.issued); mark(ids.start); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Начала работ"', 'warning'); throw new Error('date-seq'); }
        if (ds && de && ds > de) { mark(ids.start); mark(ids.end); if (window.showToast) window.showToast('"Начало работ" должно быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
        if (di && de && di > de) { mark(ids.issued); mark(ids.end); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
      }
    })();
    var rawIssued = document.getElementById('ot-issued')?.value || '';
    var rawStart = document.getElementById('ot-start')?.value || '';
    var rawEnd = document.getElementById('ot-end')?.value || '';
    
    var payload = {
      issued: toServerDt(rawIssued),
      start: toServerDt(rawStart),
      end: toServerDt(rawEnd),
      status: st
    };
    fetch('/api/orders/' + id + '/timeline', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Ошибка сохранения', 'danger'); return; }
        if (window.closeModal) window.closeModal('orderTimelineModal');
        if (window.showToast) window.showToast('Сроки и статус обновлены', 'success');
        // Immediately reflect "done" in row to hide extend/timeline in context menu
        try {
          var row = document.getElementById('order-' + id);
          if (row && payload && payload.status) {
            row.setAttribute('data-status', String(payload.status));
            var btn = row.querySelector('button[data-action="toggle-status"]');
            if (btn) {
              var st = String(payload.status);
              btn.textContent = (st === 'in_progress') ? 'Работы ведутся' : (st === 'stopped') ? 'Работы не ведутся' : 'Работы завершены';
              btn.classList.remove('btn-success','btn-danger','btn-info','btn-secondary');
              btn.classList.add((st === 'in_progress') ? 'btn-success' : (st === 'stopped') ? 'btn-danger' : 'btn-info');
            }
          }
        } catch(_) {}
        load(1);
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети при сохранении', 'danger'); });
  }

  function handleOrderEditSubmit(){
    var form = document.getElementById('order-edit-form');
    if (!form) return;
    var id = parseInt(form.getAttribute('data-id') || '0', 10) || 0;
    var payload = {
      number: document.getElementById('oe-number')?.value || '',
      responsible: document.getElementById('oe-responsible')?.value || '',
      work_name: document.getElementById('oe-work')?.value || '',
      issued: document.getElementById('oe-issued')?.value || '',
      start: document.getElementById('oe-start')?.value || '',
      end: document.getElementById('oe-end')?.value || ''
    };
    var missing = ['number','responsible','work_name'].filter(function(k){ return !String(payload[k]).trim(); });
    ['oe-number','oe-responsible','oe-work'].forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
    if (missing.length){
      missing.forEach(function(k){ var el = document.getElementById('oe-' + (k === 'work_name' ? 'work' : k)); if (el) el.classList.add('is-invalid'); });
      if (window.showToast) window.showToast('Заполните обязательные поля', 'warning');
      return;
    }
    (function validateEditDates(){
      var ids = { issued: 'oe-issued', start: 'oe-start', end: 'oe-end' };
      Object.values(ids).forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
      function toDate(v){ if (!v) return null; var d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; }
      var vi = document.getElementById(ids.issued)?.value || '';
      var vs = document.getElementById(ids.start)?.value || '';
      var ve = document.getElementById(ids.end)?.value || '';
      var di = toDate(vi), ds = toDate(vs), de = toDate(ve);
      function mark(id){ var el = document.getElementById(id); if (el) el.classList.add('is-invalid'); }
      if (di && ds && di > ds) { mark(ids.issued); mark(ids.start); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Начала работ"', 'warning'); throw new Error('date-seq'); }
      if (ds && de && ds > de) { mark(ids.start); mark(ids.end); if (window.showToast) window.showToast('"Начало работ" должно быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
      if (di && de && di > de) { mark(ids.issued); mark(ids.end); if (window.showToast) window.showToast('"Выдан" должен быть раньше "Окончания"', 'warning'); throw new Error('date-seq'); }
    })();
    fetch('/api/orders/' + id, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false){
          if (res.body && res.body.error === 'validation') { if (window.showToast) window.showToast('Заполните обязательные поля', 'warning'); return; }
          if (window.showToast) window.showToast('Ошибка сохранения', 'danger');
          return;
        }
        if (window.closeModal) window.closeModal('orderEditModal');
        if (window.showToast) window.showToast('Наряд обновлён', 'success');
        load(1);
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети при сохранении', 'danger'); });
  }

  function bindStatusToggles(){
    try {
      var tb = document.getElementById('orders-tbody');
      if (!tb) return;
      tb.querySelectorAll('button[data-action="toggle-status"]').forEach(function(btn){
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', function(){
          var id = parseInt(this.getAttribute('data-id') || '0', 10) || 0;
          // Enforce client-side rules: only if approved == yes and user has status_change/admin
          var row = this.closest('tr');
          var apprBtn = row ? row.querySelector('button[data-action="toggle-approved"]') : null;
          var isApproved = apprBtn ? (apprBtn.getAttribute('data-approved') === '1') : false;
          var svc = row ? (row.getAttribute('data-service') || '') : '';
          // Current status value (may be 'stopped' | 'in_progress' | 'done')
          var st = row ? (row.getAttribute('data-status') || '') : '';
          var issued = row ? (row.getAttribute('data-issued') || '') : '';
          var start = row ? (row.getAttribute('data-start') || '') : '';
          var end = row ? (row.getAttribute('data-end') || '') : '';
          // Do not block on client when completed; let server enforce locks
          if (!isApproved || !canEditStatusFor(svc)) {
            if (window.showToast) window.showToast('Недостаточно прав или не согласовано', 'warning');
            return;
          }
          // Cycle on server; we just POST without payload
          fetch('/api/orders/' + id + '/status', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({})
          }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
            .then(function(res){
              if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Не удалось изменить состояние', 'danger'); return; }
              var st = res.body.status || 'stopped';
              // Update button text/class optimistically
              btn.setAttribute('data-status', st);
              btn.textContent = statusText(st);
              btn.classList.remove('btn-danger','btn-warning','btn-success','btn-secondary','btn-info');
              btn.classList.add(statusBtnClass(st));
            })
            .catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
        });
      });
    } catch(_) {}
  }

  // ===== MODAL: Примечание к наряду, полностью синхронизирован как в files =====

  // [1] Функция открытия popup и заполнения textarea, используем одну popup #note и textarea #note-text, строка таблицы с id "order-<orderId>"
  // Функция, снимающая фокус с элементов внутри данного modalElement
  function blurIfActiveInside(modalEl) {
    try {
      if (!modalEl) return;
      if (modalEl.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    } catch(_){}
  }
  window.openOrderNoteModal = function(orderId) {
    if (!orderId) return;
    var form = document.getElementById('note');
    if (!form) return;
    // Проставить корректный action на серверный endpoint (ожидает form-data)
    try { form.action = '/orders/note/' + String(orderId); } catch(_) {}
    // Заполнить textarea текущим значением примечания из строки таблицы
    try {
      var row = document.getElementById('order-' + orderId);
      var noteVal = (row && row.getAttribute('data-note')) || '';
      var noteArea = document.getElementById('note-text');
      if (noteArea) { noteArea.value = noteVal; }
    } catch(_) {}
    // Страховка: ещё раз принудительно action
    try { form.action = '/orders/note/' + String(orderId); } catch(_) {}
    window.openModal && window.openModal('orderNoteModal');
    setTimeout(function(){
      const noteArea = document.getElementById('note-text');
      if (noteArea) noteArea.focus();
    }, 250);
  };

  // [2] Биндим открытие примечания из таблицы
  function bindNoteBadges() {
    try {
      document.querySelectorAll('span.note-badge[data-order-id]').forEach(function(el) {
        if (el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        el.addEventListener('click', function(e){
          var oid = this.dataset.orderId;
          window.openOrderNoteModal && window.openOrderNoteModal(oid);
        });
      });
    } catch(_){}
  }

  // [3] Сохранение примечания — унифицируем с Files через validateForm(this) на кнопке

  // [5] Рендер таблицы: после отрисовки — снова биндить badge
  const origRender = typeof render === 'function' ? render : null;
  function renderWithNoteBind(rows) {
    if (origRender) origRender(rows);
    bindNoteBadges();
  }
  window.render = renderWithNoteBind;

  function ensureFocusLeavesModal(modalEl) {
    if (!modalEl) return;
    if (modalEl.contains(document.activeElement) || document.activeElement === modalEl) {
      document.body.focus();
    }
  }

  

  

  function setupModalOverlayClose(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal || modal._overlayBound) return;
    modal._overlayBound = true;
    function onOverlay(e){
      if (e.target === modal) {
        if (typeof window.closeModal === 'function') window.closeModal(modalId);
      }
    }
    modal.addEventListener('mousedown', onOverlay);
    modal.addEventListener('click', onOverlay);
  }

  

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      init();
      setupModalOverlayClose('orderNoteModal');
      setupModalOverlayClose('orderCreateModal');
      setupModalOverlayClose('orderEditModal');
      setupModalOverlayClose('orderDeleteModal');
      setupModalOverlayClose('orderTimelineModal');
      setupModalOverlayClose('orderExtendModal');
      var tlBtn = document.getElementById('order-timeline-submit');
      if (tlBtn) tlBtn.addEventListener('click', handleOrderTimelineSubmit);
      var editBtn = document.getElementById('order-edit-submit');
      if (editBtn) editBtn.addEventListener('click', handleOrderEditSubmit);
      var extBtn = document.getElementById('order-extend-submit');
      if (extBtn) extBtn.addEventListener('click', handleOrderExtendSubmit);
      // Periodic overdue re-check for soft refresh visibility
      try { if (!window._ordersOverdueTimer) { window._ordersOverdueTimer = setInterval(applyOverdueHighlight, 30000); } } catch(_) {}
    });
  } else {
    init();
    setupModalOverlayClose('orderNoteModal');
    setupModalOverlayClose('orderCreateModal');
    setupModalOverlayClose('orderEditModal');
    setupModalOverlayClose('orderDeleteModal');
    setupModalOverlayClose('orderTimelineModal');
    setupModalOverlayClose('orderExtendModal');
    var tlBtn2 = document.getElementById('order-timeline-submit');
    if (tlBtn2) tlBtn2.addEventListener('click', handleOrderTimelineSubmit);
    var editBtn2 = document.getElementById('order-edit-submit');
    if (editBtn2) editBtn2.addEventListener('click', handleOrderEditSubmit);
    var extBtn2 = document.getElementById('order-extend-submit');
    if (extBtn2) extBtn2.addEventListener('click', handleOrderExtendSubmit);
    try { if (!window._ordersOverdueTimer) { window._ordersOverdueTimer = setInterval(applyOverdueHighlight, 30000); } } catch(_) {}
  }
  if (window.OrdersSearch && typeof window.OrdersSearch.setupFilesSearch === 'function') {
    window.OrdersSearch.setupFilesSearch();
  }

  // ===== Realtime sync (orders) =====
  function softReloadOrders(){
    try {
      var q = (document.getElementById('searchinp')?.value || '').trim();
      if (q) { load(1, { silent: true }); return; }
      var pg = getOrdersLastPage();
      load(pg || 1, { manualPage: true, silent: true });
    } catch(_) { try { load(1, { silent: true }); } catch(_e){} }
  }
  function setupOrdersSocket(){
    try {
      if (window.SyncManager && typeof window.SyncManager.on === 'function') {
        if (!window.__ordersSyncBound) {
          window.__ordersSyncBound = true;
          window.SyncManager.on('orders:changed', function(data){ softReloadOrders(); });
          if (window.SyncManager.joinRoom) { window.SyncManager.joinRoom('orders'); }
          // idle-guard запускается глобально в core/base.js
        }
        return;
      }
    } catch(e) { }
  }

  // Hook into existing success paths to emit orders:changed (client-side fallback)
  function emitOrdersChanged(reason, extra){
    try {
      var payload = Object.assign({ reason: reason || 'updated', originClientId: window.__ordersClientId || (window.__categoriesClientId || '') }, extra||{});
      var s1 = window.SyncManager && window.SyncManager.getSocket && window.SyncManager.getSocket();
      var s2 = window.socket;
      if (s1 && s1.emit) { try { s1.emit('orders:changed', payload); } catch(e){ } }
      if (s2 && typeof s2.emit === 'function') { try { s2.emit('orders:changed', payload); } catch(e2){ } }
    } catch(err) { }
  }

  // augment existing success handlers
  var __origHandleOrderCreateSubmit = handleOrderCreateSubmit;
  handleOrderCreateSubmit = function(){
    __origHandleOrderCreateSubmit.apply(this, arguments);
    // emit after slight delay to ensure backend commit
    setTimeout(function(){ emitOrdersChanged('create'); }, 150);
  };

  // Approve toggle augmentation happens inside bindApprovedToggles success
  var __origBindApprovedToggles = bindApprovedToggles;
  bindApprovedToggles = function(){
    try {
      if (!(window.OrdersPerms && window.OrdersPerms.approve)) return __origBindApprovedToggles();
      var tb = document.getElementById('orders-tbody');
      if (!tb) return __origBindApprovedToggles();
      tb.querySelectorAll('button[data-action="toggle-approved"]').forEach(function(btn){
        if (btn.__ordersAugmented === '1') return;
        btn.__ordersAugmented = '1';
        btn.addEventListener('click', function onClick(){
          var id = parseInt(this.getAttribute('data-id') || '0', 10) || 0;
          var current = this.getAttribute('data-approved') === '1';
          var next = !current;
          // attach a one-time listener to emit on success by polling attribute change
          var el = this;
          var prev = el.getAttribute('data-approved');
          setTimeout(function(){
            var now = el.getAttribute('data-approved');
            if (now !== prev) emitOrdersChanged('approve', { id: id, approved: now === '1' ? 1 : 0 });
          }, 250);
        }, true);
      });
    } catch(_) {}
    return __origBindApprovedToggles();
  };

  var __origHandleOrderEditSubmit = handleOrderEditSubmit;
  handleOrderEditSubmit = function(){
    __origHandleOrderEditSubmit.apply(this, arguments);
    setTimeout(function(){ emitOrdersChanged('edit'); }, 150);
  };

  var __origHandleOrderExtendSubmit = handleOrderExtendSubmit;
  handleOrderExtendSubmit = function(){
    __origHandleOrderExtendSubmit.apply(this, arguments);
    setTimeout(function(){ emitOrdersChanged('extend'); }, 150);
  };

  var __origHandleOrderTimelineSubmit = handleOrderTimelineSubmit;
  handleOrderTimelineSubmit = function(){
    __origHandleOrderTimelineSubmit.apply(this, arguments);
    setTimeout(function(){ emitOrdersChanged('timeline'); }, 150);
  };

  // Note save via AJAX + emit
  (function bindOrderNoteSave(){
    try {
      var btn = document.getElementById('order-note-save');
      var form = document.getElementById('note');
      var area = document.getElementById('note-text');
      if (btn && form && area && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', function(){
          try {
            var m = (form.action || '').match(/\/orders\/note\/(\d+)/);
            var id = m ? parseInt(m[1], 10) : 0;
            var note = area.value || '';
            var fd = new FormData();
            fd.append('note', note);
            fetch(form.action, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
              .then(function(r){ return r.json().catch(function(){return {}}).then(function(j){ return { ok: r.ok, body: j }; }); })
              .then(function(res){
                if (!res.ok || (res.body && res.body.ok === false)) { if (window.showToast) window.showToast('Ошибка сохранения примечания', 'danger'); return; }
                if (window.closeModal) window.closeModal('orderNoteModal');
                if (window.showToast) window.showToast('Примечание сохранено', 'success');
                // update row attribute so UI shows new note without reload
                try { var row = document.getElementById('order-' + id); if (row) row.setAttribute('data-note', note); } catch(_){}
                emitOrdersChanged('note', { id: id });
                softReloadOrders();
              }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
          } catch(_) {}
        });
        // Enter/Esc shortcuts
        form.addEventListener('keydown', function(e){
          if (e.target && e.target.id === 'note-text') {
            if ((e.ctrlKey && e.key === 'Enter') || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); btn.click(); }
            if (e.key === 'Escape') { e.preventDefault(); window.closeModal && window.closeModal('orderNoteModal'); }
          }
        });
      }
    } catch(_) {}
  })();

  // Init sync
  try { if (!window.__ordersClientId) { window.__ordersClientId = Math.random().toString(36).slice(2)+'-'+Date.now(); } } catch(_) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupOrdersSocket);
  } else {
    setupOrdersSocket();
  }
})();



