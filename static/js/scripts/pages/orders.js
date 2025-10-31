// Orders page client logic: filters + table render
(function () {
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

  // --- localStorage keys for orders page ---
  const ORDERS_SEARCH_KEY = 'orders:search';
  const ORDERS_LASTPAGE_KEY = 'orders:lastPage';

  // --- Save/load search and page state ---
  function saveOrdersSearch(val) { if (val) localStorage.setItem(ORDERS_SEARCH_KEY, val); else localStorage.removeItem(ORDERS_SEARCH_KEY); }
  function getOrdersSearch() { return localStorage.getItem(ORDERS_SEARCH_KEY) || ''; }
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
      const service = (document.getElementById('flt-service')?.value || '').trim();
      const q = (document.getElementById('searchinp')?.value || '').trim();
      // Save search to storage
      saveOrdersSearch(q);
      // page persistence (restore if not set and not search)
      let usePage = (typeof page === 'number' && page > 0) ? page : 1;
      if (!q && !opts.manualPage) usePage = getOrdersLastPage();
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
      }
      // Save lastPage if not searching
      if (!q) saveOrdersLastPage(data.page || 1);
      if (q && !items.length) resetOrdersPage();
    } catch (e) {
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
          data-end="${(r.end||'').replace(/"/g,'&quot;')}">
        <td class="table__body_item">${(r.service || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${ (function(){
            // Render as button with color and data attributes
            var st = (r.status || 'stopped');
            var text = statusText(st);
            var cls = statusBtnClass(st);
            return `<button type="button" class="btn btn-sm ${cls}" data-action="toggle-status" data-id="${r.id}" data-status="${st}">${text}</button>`;
          })() }</td>
        <td class="table__body_item">${(r.number || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${fmtDate(r.issued)}</td>
        <td class="table__body_item">${fmtDate(r.start)}</td>
        <td class="table__body_item">${fmtDate(r.end)}</td>
        <td class="table__body_item">${(r.responsible || '')}</td>
        <td class="table__body_item">${(r.work_name || '')}</td>
        <td class="table__body_item">${(function(){
            if (canApprove) {
              return `<button type="button" class="btn btn-sm ${r.approved ? 'btn-success' : 'btn-danger'}" data-action="toggle-approved" data-id="${r.id}" data-approved="${r.approved ? '1':'0'}">${r.approved ? 'Да' : 'Нет'}</button>`;
            }
            return (r.approved ? 'Да' : 'Нет');
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
    // edit/delete кнопки не отображаются в UI по требованию
    if (window.OrdersSearch && typeof window.OrdersSearch.setupOrdersSearch === 'function') {
      window.OrdersSearch.setupOrdersSearch();
    }
    bindNoteBadges(); // Обеспечить bind, даже если не через renderWithNoteBind
    bindOrdersContextMenu();
    setupOrdersHeaderTooltips();
  }

  // --- search input persistence and clear button ---
  // --- убираем bindOrdersSearch полностью ---

  // Заменяем на интеграцию с files-search.js
  window.ordersDoFilter = function(q, page) { load(page || 1); };

  function init() {
    const rng = currentMonthRange();
    const df = document.getElementById('flt-from');
    const dt = document.getElementById('flt-to');
    if (df && !df.value) df.value = rng.from;
    if (dt && !dt.value) dt.value = rng.to;
    const applyBtn = document.getElementById('flt-apply');
    if (applyBtn) applyBtn.addEventListener('click', function () { load(1); });
    ['flt-st-inp', 'flt-st-stp', 'flt-st-done', 'flt-from', 'flt-to', 'flt-service'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { resetOrdersPage(); load(1); });
    });
    // restore search & page
    let pg = getOrdersLastPage();
    let q = getOrdersSearch();
    if (q) load(1);
    else load(pg);
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
    });
  }

  function attachOrderModalA11yHandlers(){
    try {
      var el = document.getElementById('orderCreateModal');
      if (!el || el.dataset.a11yBound === '1') return;
      el.dataset.a11yBound = '1';
      el.addEventListener('show.bs.modal', function(){
        try { el.removeAttribute('aria-hidden'); } catch(_) {}
      });
      el.addEventListener('shown.bs.modal', function(){
        try { el.removeAttribute('aria-hidden'); } catch(_) {}
        // Ensure submit handlers are bound when modal becomes visible
        try { bindOrderCreateSubmitHandlers(); } catch(_) {}
      });
      el.addEventListener('hide.bs.modal', function(){
        try { if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur(); } catch(_) {}
      });
      el.addEventListener('hidden.bs.modal', function(){
        try { el.setAttribute('aria-hidden', 'true'); } catch(_) {}
      });
    } catch(_) {}
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
        service: document.getElementById('oc-service')?.value || '',
        work_name: document.getElementById('oc-work')?.value || ''
      };
      ['oc-number','oc-responsible','oc-service','oc-work'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.classList.remove('is-invalid');
      });
      var missing = Object.keys(fields).filter(function(k){ return !String(fields[k]).trim(); });
      if (missing.length) {
        missing.forEach(function(k){ var el = document.getElementById('oc-' + (k === 'work_name' ? 'work' : k)); if (el) el.classList.add('is-invalid'); });
        if (window.showToast) window.showToast('Заполните обязательные поля', 'warning');
        return;
      }
      // Validate date sequence: issued < start < end (each may be empty)
      (function validateCreateDates(){
        var ids = { issued: 'oc-issued', start: 'oc-start', end: 'oc-end' };
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
      var payload = {
        number: fields.number.trim(),
        responsible: fields.responsible.trim(),
        service: fields.service.trim(),
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
              service: document.getElementById('oc-service')?.value || '',
              work_name: document.getElementById('oc-work')?.value || ''
            };
            // Clear previous invalids
            ['oc-number','oc-responsible','oc-service','oc-work'].forEach(function(id){
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
              service: fields.service.trim(),
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
      items.push(btn('«', 1, cp === 1));
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
      items.push(btn('»', totalPages, cp === totalPages));
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
      pager.querySelectorAll('a.page-link[data-page]').forEach((a) => {
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
            function setVis(action, visible){ var el = menu.querySelector('[data-action="'+action+'"]'); if (el) el.classList.toggle('d-none', !visible); }
            setVis('files', canFilesUI);
            setVis('edit', canEdit);
            setVis('timeline', canTimeline);
            setVis('delete', canDelete);
            setVis('create', canCreateUI);
            setVis('note', !!(window.OrdersPerms && (window.OrdersPerms.notes || window.OrdersPerms.admin)));
            setVis('approve', canApproveUI);
            setVis('unapprove', canApproveUI);
            var approveItem = menu.querySelector('[data-action="approve"]');
            var unapproveItem = menu.querySelector('[data-action="unapprove"]');
            var btn = this.querySelector('button[data-action="toggle-approved"]');
            var isApproved = btn ? (btn.getAttribute('data-approved') === '1') : false;
            if (approveItem && unapproveItem) {
              approveItem.classList.toggle('d-none', isApproved);
              unapproveItem.classList.toggle('d-none', !isApproved);
            }
            // Business rules:
            // - Timeline/status change available only if approved and user has status_change/admin
            // - When approved == yes: edit/delete are not available
            if (!isApproved) {
              setVis('timeline', false);
            } else {
              // ensure edit/delete hidden when approved
              setVis('edit', false);
              setVis('delete', false);
            }
            // Additional lock: if status == done and issued/start/end are all filled -> disable timeline, status, and UNAPPROVE
            var st = (this.getAttribute('data-status') || '').trim();
            var issued = (this.getAttribute('data-issued') || '').trim();
            var start = (this.getAttribute('data-start') || '').trim();
            var end = (this.getAttribute('data-end') || '').trim();
            var lockComplete = (st === 'done' && issued && start && end);
            if (lockComplete) {
              setVis('timeline', false);
              // hide unapprove option when locked complete
              setVis('unapprove', false);
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
            ['files','edit','timeline','delete','approve','unapprove'].forEach(function(a){ var el = menu.querySelector('[data-action="'+a+'"]'); if (el) el.classList.add('d-none'); });
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
            ['files','edit','timeline','delete','approve','unapprove'].forEach(function(a){ var el = menu.querySelector('[data-action="'+a+'"]'); if (el) el.classList.add('d-none'); });
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
          fetch('/api/orders/' + id + '/approved', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({ approved: next })
          }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
            .then(function(res){
              if (!res.ok || !res.body || res.body.ok === false) { var t = toastFromError(res, 'Не удалось изменить статус'); if (window.showToast) window.showToast(t.msg, t.level); return; }
              var val = !!res.body.approved;
              btn.setAttribute('data-approved', val ? '1' : '0');
              btn.classList.toggle('btn-success', val);
              btn.classList.toggle('btn-danger', !val);
              btn.textContent = val ? 'Да' : 'Нет';
            }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
        });
      });
    } catch(_) {}
  }

  function canEditStatusFor(serviceName){
    var perms = window.OrdersPerms || {};
    // Only admin or explicit status_change permission may change timeline/status
    return !!(perms.admin || perms.status_change);
  }

  function canEditOrderFor(serviceName){
    var perms = window.OrdersPerms || {};
    if (perms.admin || perms.edit_any) return true;
    var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
    var map = window.OrdersGroups || {};
    var srv = String(serviceName || '').trim();
    var gid = map[srv];
    return !!(gid && userGid && gid === userGid);
  }

  function canDeleteOrderFor(serviceName){
    var perms = window.OrdersPerms || {};
    if (perms.admin || perms.delete_any) return true;
    var userGid = (window.CurrentUser && window.CurrentUser.gid) || null;
    var map = window.OrdersGroups || {};
    var srv = String(serviceName || '').trim();
    var gid = map[srv];
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
    } catch(_) {}
  }

  function fillEditForm(order){
    try {
      document.getElementById('oe-number').value = order.number || '';
      document.getElementById('oe-responsible').value = order.responsible || '';
      var sel = document.getElementById('oe-service');
      if (sel) sel.value = order.service || '';
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
        if (window.openModal) window.openModal('orderTimelineModal');
      }).catch(function(){ if (window.showToast) window.showToast('Сбой сети', 'danger'); });
  }

  function handleOrderTimelineSubmit(){
    var form = document.getElementById('order-timeline-form');
    if (!form) return;
    var id = parseInt(form.getAttribute('data-id') || '0', 10) || 0;
    var st = (document.querySelector('input[name="ot-status"]:checked')?.value || '').trim();
    // Validate date sequence
    (function validateTimelineDates(){
      var ids = { issued: 'ot-issued', start: 'ot-start', end: 'ot-end' };
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
    var payload = {
      issued: document.getElementById('ot-issued')?.value || '',
      start: document.getElementById('ot-start')?.value || '',
      end: document.getElementById('ot-end')?.value || '',
      status: st
    };
    fetch('/api/orders/' + id + '/timeline', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Ошибка сохранения', 'danger'); return; }
        if (window.closeModal) window.closeModal('orderTimelineModal');
        if (window.showToast) window.showToast('Сроки и статус обновлены', 'success');
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
      service: document.getElementById('oe-service')?.value || '',
      work_name: document.getElementById('oe-work')?.value || '',
      issued: document.getElementById('oe-issued')?.value || '',
      start: document.getElementById('oe-start')?.value || '',
      end: document.getElementById('oe-end')?.value || ''
    };
    var missing = ['number','responsible','service','work_name'].filter(function(k){ return !String(payload[k]).trim(); });
    ['oe-number','oe-responsible','oe-service','oe-work'].forEach(function(id){ var el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
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
          // Additional complete lock: status=done and all three dates set
          var st = row ? (row.getAttribute('data-status') || '') : '';
          var issued = row ? (row.getAttribute('data-issued') || '') : '';
          var start = row ? (row.getAttribute('data-start') || '') : '';
          var end = row ? (row.getAttribute('data-end') || '') : '';
          var lockComplete = (st === 'done' && issued && start && end);
          if (lockComplete) {
            if (window.showToast) window.showToast('Изменение статуса запрещено: завершено и сроки заполнены', 'warning');
            return;
          }
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

  function setupAccessibilityModalBlurFix() {
    var modals = [
      document.getElementById('orderNoteModal'),
      document.getElementById('orderCreateModal')
    ];
    modals.forEach(function(modalEl) {
      if (!modalEl) return;
      modalEl.addEventListener('hidden.bs.modal', function() {
        ensureFocusLeavesModal(modalEl);
      });
    });
  }

  function fixBootstrapFocusLeak() {
    var modals = [
      document.getElementById('orderNoteModal'),
      document.getElementById('orderCreateModal')
    ];
    modals.forEach(function(modalEl) {
      if (!modalEl) return;
      modalEl.addEventListener('hide.bs.modal', function(){
        if (this.contains(document.activeElement)) {
          document.body.focus();
        }
      });
    });
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

  function setupAriaHiddenFocusWatcher(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal || modal._ariaWatcherBound) return;
    modal._ariaWatcherBound = true;
    try {
      var mo = new MutationObserver(function(list){
        for (var i=0; i<list.length; i++) {
          var m = list[i];
          if (m.type === 'attributes' && m.attributeName === 'aria-hidden') {
            var hidden = modal.getAttribute('aria-hidden') === 'true';
            if (hidden) {
              // Если фокус внутри скрытой модалки — убрать
              if (modal.contains(document.activeElement)) {
                try { document.activeElement.blur(); } catch(_) {}
                try { document.body.focus(); } catch(_) {}
              }
              // Подстраховка таймером (асинхронные гонки Bootstrap)
              setTimeout(function(){
                if (modal.contains(document.activeElement)) {
                  try { document.activeElement.blur(); } catch(_) {}
                  try { document.body.focus(); } catch(_) {}
                }
              }, 30);
            }
          }
        }
      });
      mo.observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });
    } catch(_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      init();
      fixBootstrapFocusLeak();
      setupAccessibilityModalBlurFix();
      setupModalOverlayClose('orderNoteModal');
      setupModalOverlayClose('orderCreateModal');
      setupModalOverlayClose('orderEditModal');
      setupModalOverlayClose('orderDeleteModal');
      setupModalOverlayClose('orderTimelineModal');
      setupAriaHiddenFocusWatcher('orderNoteModal');
      setupAriaHiddenFocusWatcher('orderCreateModal');
      setupAriaHiddenFocusWatcher('orderEditModal');
      setupAriaHiddenFocusWatcher('orderDeleteModal');
      setupAriaHiddenFocusWatcher('orderTimelineModal');
      var tlBtn = document.getElementById('order-timeline-submit');
      if (tlBtn) tlBtn.addEventListener('click', handleOrderTimelineSubmit);
      var editBtn = document.getElementById('order-edit-submit');
      if (editBtn) editBtn.addEventListener('click', handleOrderEditSubmit);
    });
  } else {
    init();
    fixBootstrapFocusLeak();
    setupAccessibilityModalBlurFix();
    setupModalOverlayClose('orderNoteModal');
    setupModalOverlayClose('orderCreateModal');
    setupModalOverlayClose('orderEditModal');
    setupModalOverlayClose('orderDeleteModal');
    setupModalOverlayClose('orderTimelineModal');
    setupAriaHiddenFocusWatcher('orderNoteModal');
    setupAriaHiddenFocusWatcher('orderCreateModal');
    setupAriaHiddenFocusWatcher('orderEditModal');
    setupAriaHiddenFocusWatcher('orderDeleteModal');
    setupAriaHiddenFocusWatcher('orderTimelineModal');
    var tlBtn2 = document.getElementById('order-timeline-submit');
    if (tlBtn2) tlBtn2.addEventListener('click', handleOrderTimelineSubmit);
    var editBtn2 = document.getElementById('order-edit-submit');
    if (editBtn2) editBtn2.addEventListener('click', handleOrderEditSubmit);
  }
  if (window.OrdersSearch && typeof window.OrdersSearch.setupFilesSearch === 'function') {
    window.OrdersSearch.setupFilesSearch();
  }
})();



