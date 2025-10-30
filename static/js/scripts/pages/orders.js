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

  function statusPill(st) {
    const cls = st === 'in_progress' ? 'status-in_progress' : st === 'stopped' ? 'status-stopped' : 'status-done';
    const text = st === 'in_progress' ? 'Работы ведутся' : st === 'stopped' ? 'Работы не ведутся' : 'Работы завершены';
    return `<span class="status-pill ${cls}">${text}</span>`;
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
  function saveOrdersSearch(val) {
    try { if (val) localStorage.setItem(ORDERS_SEARCH_KEY, val); else localStorage.removeItem(ORDERS_SEARCH_KEY); } catch(_) {}
  }
  function getOrdersSearch() {
    try { return localStorage.getItem(ORDERS_SEARCH_KEY) || ''; } catch(_) { return ''; }
  }
  function saveOrdersLastPage(page) {
    try { if (page > 0) localStorage.setItem(ORDERS_LASTPAGE_KEY, String(page)); } catch(_) {}
  }
  function getOrdersLastPage() {
    try { const pg = parseInt(localStorage.getItem(ORDERS_LASTPAGE_KEY) || '1', 10); return (+pg > 0 ? +pg : 1); } catch(_) { return 1; }
  }
  function resetOrdersPage() {
    try { localStorage.removeItem(ORDERS_LASTPAGE_KEY); } catch(_) {}
  }

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
    tb.innerHTML = searchHTML + rows.map((r) => `
      <tr class="table__body_row" data-id="${r.id}">
        <td class="table__body_item">${(r.service || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${statusPill(r.status)}</td>
        <td class="table__body_item">${(r.number || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${fmtDate(r.issued)}</td>
        <td class="table__body_item">${fmtDate(r.start)}</td>
        <td class="table__body_item">${fmtDate(r.end)}</td>
        <td class="table__body_item">${(r.responsible || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${(r.work_name || '').replace(/</g, '&lt;')}</td>
        <td class="table__body_item">${canApprove ? (`<button type="button" class="btn btn-sm ${r.approved ? 'btn-success' : 'btn-danger'}" data-action="toggle-approved" data-id="${r.id}" data-approved="${r.approved ? '1':'0'}">${r.approved ? 'Да' : 'Нет'}</button>`) : (r.approved ? 'Да' : 'Нет')}</td>
        <td class="table__body_item">${(r.notes || '').replace(/</g, '&lt;')}</td>
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
    if (window.OrdersSearch && typeof window.OrdersSearch.setupOrdersSearch === 'function') {
      window.OrdersSearch.setupOrdersSearch();
    }
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
  }

  function bindCreateButton(){
    // Permissions-aware Create button handling; rebind after table re-render
    try {
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
        try {
          var el = document.getElementById('orderCreateModal');
          if (!el) { if (window.showToast) window.showToast('Модалка создания недоступна', 'warning'); return; }
          var m = (window.bootstrap && window.bootstrap.Modal) ? new window.bootstrap.Modal(el) : null;
          if (m) m.show();
        } catch(err) {
          window.ErrorHandler && window.ErrorHandler.handleError(err, 'orders.openCreateModal');
        }
      });
    } catch (_) {}
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
              try { var el = document.getElementById('orderCreateModal'); var m = (window.bootstrap && window.bootstrap.Modal) ? bootstrap.Modal.getInstance(el) : null; if (m) m.hide(); } catch(_) {}
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
      var payload = {
        number: fields.number.trim(),
        responsible: fields.responsible.trim(),
        service: fields.service.trim(),
        work_name: fields.work_name.trim(),
        status: 'in_progress',
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
            var msg = 'Ошибка сохранения';
            if (res.body && res.body.error === 'validation') msg = 'Заполните обязательные поля';
            if (window.showToast) window.showToast(msg, 'danger');
            return;
          }
          var modalEl = document.getElementById('orderCreateModal');
          try { var m = (window.bootstrap && window.bootstrap.Modal) ? bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl) : null; if (m) m.hide(); } catch(_) {}
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
              status: 'in_progress',
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
                  var msg = 'Ошибка сохранения';
                  if (res.body && res.body.error === 'validation') msg = 'Заполните обязательные поля';
                  if (window.showToast) window.showToast(msg, 'danger');
                  return;
                }
                // success
                var modalEl = document.getElementById('orderCreateModal');
                try { var m = (window.bootstrap && window.bootstrap.Modal) ? bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl) : null; if (m) m.hide(); } catch(_) {}
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
              if (!res.ok || !res.body || res.body.ok === false) { if (window.showToast) window.showToast('Не удалось изменить статус', 'danger'); return; }
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  if (window.OrdersSearch && typeof window.OrdersSearch.setupFilesSearch === 'function') {
    window.OrdersSearch.setupFilesSearch();
  }
})();



