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

  async function load(page) {
    try {
      const st = [];
      if (document.getElementById('flt-st-inp').checked) st.push('in_progress');
      if (document.getElementById('flt-st-stp').checked) st.push('stopped');
      if (document.getElementById('flt-st-done').checked) st.push('done');
      const df = document.getElementById('flt-from').value;
      const dt = document.getElementById('flt-to').value;
      const q = (document.getElementById('orders-search')?.value || '').trim();
      const params = new URLSearchParams();
      params.set('status_in', st.join(','));
      if (df) params.set('date_from', df);
      if (dt) params.set('date_to', dt);
      if (q) params.set('q', q);
      params.set('page', String(page || 1));
      params.set('page_size', '10');
      const resp = await fetch(`/api/orders?${params.toString()}`, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
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
    } catch (e) {
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'orders.load');
      render([]);
    }
  }

  function render(rows) {
    const tb = document.getElementById('orders-tbody');
    if (!tb) return;
    // Preserve search row at top
    const existingSearch = tb.querySelector('#search');
    const searchHTML = existingSearch ? existingSearch.outerHTML : '';
    if (!rows.length) {
      tb.innerHTML = `${searchHTML}<tr><td colspan="10" class="text-muted py-3">Нет данных за выбранный период</td></tr>`;
      bindSearch();
      bindCreateButton();
      return;
    }
    var canApprove = !!(window.OrdersPerms && window.OrdersPerms.approve);
    tb.innerHTML = searchHTML + rows.map((r) => `
      <tr data-id="${r.id}">
        <td>${(r.service || '').replace(/</g, '&lt;')}</td>
        <td>${statusPill(r.status)}</td>
        <td>${(r.number || '').replace(/</g, '&lt;')}</td>
        <td>${fmtDate(r.issued)}</td>
        <td>${fmtDate(r.start)}</td>
        <td>${fmtDate(r.end)}</td>
        <td>${(r.responsible || '').replace(/</g, '&lt;')}</td>
        <td>${(r.work_name || '').replace(/</g, '&lt;')}</td>
        <td>${canApprove ? (`<button type="button" class="btn btn-sm ${r.approved ? 'btn-success' : 'btn-danger'}" data-action="toggle-approved" data-id="${r.id}" data-approved="${r.approved ? '1':'0'}">${r.approved ? 'Да' : 'Нет'}</button>`) : (r.approved ? 'Да' : 'Нет')}</td>
        <td>${(r.notes || '').replace(/</g, '&lt;')}</td>
      </tr>
    `).join('');
    bindSearch();
    bindCreateButton();
    bindApprovedToggles();
  }

  function bindSearch() {
    const search = document.getElementById('orders-search');
    if (!search) return;
    if (search.dataset.bound === '1') return; // avoid double-binding
    search.dataset.bound = '1';
    const debounce = (fn, ms) => { let t; return function() { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); }; };
    search.addEventListener('input', debounce(() => load(1), 250));
    search.addEventListener('keydown', function(e){ if (e.key === 'Escape') { this.value=''; load(1); } });
    // clear button next to input
    const clearBtn = search.parentElement && search.parentElement.querySelector('.search-clear');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = '1';
      clearBtn.addEventListener('click', function(){ try { search.value=''; } catch(_){} load(1); });
    }
  }

  function init() {
    const rng = currentMonthRange();
    const df = document.getElementById('flt-from');
    const dt = document.getElementById('flt-to');
    if (df && !df.value) df.value = rng.from;
    if (dt && !dt.value) dt.value = rng.to;
    const applyBtn = document.getElementById('flt-apply');
    if (applyBtn) applyBtn.addEventListener('click', function () { load(1); });
    ['flt-st-inp', 'flt-st-stp', 'flt-st-done', 'flt-from', 'flt-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => load(1));
    });
    bindSearch();
    bindCreateButton();
    attachOrderModalA11yHandlers();
    bindOrderCreateSubmitHandlers();
    load(1);
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

  function setupOrdersPaginationClickHandler() {
    try {
      const pager = document.getElementById('orders-pagination');
      if (!pager) return;
      pager.querySelectorAll('a.page-link[data-page]').forEach((a) => {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          const p = parseInt(this.getAttribute('data-page') || '1', 10) || 1;
          load(p);
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
})();



