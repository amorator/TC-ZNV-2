(function(){
  'use strict';

  let socket = null;
  let presenceItems = [];
  let lastPresenceNonEmptyAt = 0;
  let selectedUser = null; // for log filter
  let presenceCache = {}; // key -> { item, lastSeen }
  let isLogPaused = false; // pause auto-refresh for logs when selecting
  let lastContextRow = null; // remember row for context actions

  function isJsonResponse(r){
    try { const ct = (r.headers && r.headers.get && r.headers.get('Content-Type')) || ''; return ct.indexOf('application/json') !== -1; } catch(_) { return false; }
  }

  function fetchPresence(){
    return fetch('/admin/presence', { credentials: 'same-origin' })
      .then(function(r){ if (!r.ok || !isJsonResponse(r)) { return { status: 'error' }; } return r.json().catch(function(){ return { status: 'error' }; }); })
      .then(j => {
        if (j && j.status === 'success') {
          const now = Date.now();
          const items = Array.isArray(j.items) ? j.items : [];
          // Build new map from server
          const freshMap = {};
          for (let i = 0; i < items.length; i++) {
            const it = items[i] || {};
            const k = presenceKey(it);
            if (!k) continue;
            freshMap[k] = it;
          }
          // Merge with cache: keep recently seen entries even if temporarily missing (<=15s)
          const mergedMap = { ...freshMap };
          const keys = Object.keys(presenceCache);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (mergedMap[k]) continue;
            const cached = presenceCache[k];
            if (!cached) continue;
            const lastSeen = cached.lastSeen || 0;
            if ((now - lastSeen) <= 15000) {
              mergedMap[k] = cached.item;
            }
          }
          // Update cache timestamps for merged entries
          presenceCache = {};
          const mergedItems = [];
          Object.keys(mergedMap).forEach(function(k){
            const it = mergedMap[k];
            presenceCache[k] = { item: it, lastSeen: now };
            mergedItems.push(it);
          });
          // Sort alphabetically by user name (case-insensitive)
          mergedItems.sort(function(a,b){
            const an = (a.user||'').toString().toLowerCase();
            const bn = (b.user||'').toString().toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
          });
          presenceItems = mergedItems;
          renderPresence();
        }
      }).catch(function(){ /* ignore */ });
  }

  function presenceKey(it){
    try {
      const uid = it && (it.user_id != null ? String(it.user_id) : '');
      const user = (it && it.user) ? String(it.user) : '';
      const ip = (it && it.ip) ? String(it.ip).trim() : '';
      const ua = (it && it.ua) ? String(it.ua).slice(0,64) : '';
      const left = uid || user; if (!left || !ip) return '';
      return left + ':' + ip + ':' + ua;
    } catch(_) { return ''; }
  }

  function renderPresence(){
    const tbody = document.querySelector('#presenceTable tbody');
    if (!tbody) return;
    // Build HTML first to avoid flicker
    let html = '';
    for (let i = 0; i < presenceItems.length; i++) {
      const item = presenceItems[i] || {};
      html += '<tr data-sid="'+(item.sid||'')+'" data-user-id="'+(item.user_id||'')+'">'
           +   '<td class="user" title="'+escapeHtml(item.ua||'')+'">'+escapeHtml(item.user||'')+'</td>'
           +   '<td class="ip">'+escapeHtml(item.ip||'')+'</td>'
           +   '<td class="ua">'+escapeHtml(formatUA(item.ua)||'')+'</td>'
           +   '<td class="page">'+escapeHtml(item.page||'')+'</td>'
           + '</tr>';
    }
    // If new list is empty, keep current table for a short grace period to avoid blinking
    if (presenceItems.length === 0) {
      if (lastPresenceNonEmptyAt && (Date.now() - lastPresenceNonEmptyAt) < 15000) {
        return; // skip swapping to empty state
      }
    } else {
      lastPresenceNonEmptyAt = Date.now();
    }
    tbody.innerHTML = html;
    // enable row context menu
    enablePresenceContextMenu();
  }

  function escapeHtml(s){
    try {
      var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return String(s).replace(/[&<>"']/g, function(ch){ return map[ch] || ch; });
    } catch(_) { return s; }
  }

  function formatUA(ua){
    try {
      if (!ua) return '';
      // Simple browser/version extraction
      const m = ua.match(/(Chrome|Firefox|Edg|Safari)\/?\s?(\d+[\.\d+]*)/i);
      if (m) return (m[1] + ' ' + m[2]).replace('Edg', 'Edge');
      return ua.split(' ').slice(0,2).join(' ');
    } catch(_) { return ua; }
  }

  function openNotifyModalFor(target){
    try {
      var modalEl = document.getElementById('adminNotifyModal');
      if (!modalEl) return;
      // reset
      var textEl = document.getElementById('notifyTextM'); if (textEl) textEl.value = '';
      var all = document.getElementById('notifyScopeAllM'); if (all) all.checked = true;
      var wrap = document.getElementById('notifyComboWrapM'); if (wrap) wrap.classList.add('d-none');
      modalEl.dataset.target = target || 'all';
      var m = new bootstrap.Modal(modalEl);
      m.show();
    } catch(_) {}
  }

  function closeNotifyModal(){
    try {
      var modalEl = document.getElementById('adminNotifyModal');
      if (!modalEl) return;
      // Blur focused element to avoid aria-hidden on focused node
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(__) {}
      var inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      // After fully hidden, move focus to opener if available
      var opener = document.getElementById('btnOpenNotifyModal');
      var onHidden = function(){ try { opener && opener.focus && opener.focus(); } catch(__) {} modalEl.removeEventListener('hidden.bs.modal', onHidden); };
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      inst.hide();
    } catch(_) {}
  }

  function forceLogout(sid, uid){
    return fetch('/admin/force_logout', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid, user_id: uid })
    }).then(r => r.json()).then(j => {
      if (j.status === 'success') {
        window.showToast && window.showToast('Пользователь отключён', 'success');
        // Optimistically remove from local presence and re-render immediately
        try {
          if (Array.isArray(presenceItems)) {
            presenceItems = presenceItems.filter(function(it){
              if (sid && it.sid && it.sid === sid) return false;
              if (uid && (it.user_id == uid)) return false;
              return true;
            });
          }
          // prune cache too
          try {
            const keys = Object.keys(presenceCache||{});
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              const entry = presenceCache[k] && presenceCache[k].item;
              if (!entry) continue;
              if ((sid && entry.sid === sid) || (uid && (entry.user_id == uid))) {
                delete presenceCache[k];
              }
            }
          } catch(_) {}
          renderPresence();
        } catch(_) {}
        // also refresh from server shortly after to reconcile
        setTimeout(function(){ try { fetchPresence(); } catch(_) {} }, 500);
      }
      else { window.showToast && window.showToast(j.message||'Ошибка', 'error'); }
    }).catch(()=>{ window.showToast && window.showToast('Ошибка сети', 'error'); });
  }

  function sendMessage(target, message){
    return fetch('/admin/send_message', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target, message: message })
    }).then(r => r.json()).then(j => {
      if (j.status === 'success') { window.showToast && window.showToast('Сообщение отправлено', 'success'); }
      else { window.showToast && window.showToast(j.message||'Ошибка', 'error'); }
      return j;
    }).catch(()=>{ window.showToast && window.showToast('Ошибка сети', 'error'); });
  }

  function bindHandlers(){
    const table = document.getElementById('presenceTable');
    if (table) {
      table.addEventListener('click', function(e){
        const tdUser = e.target.closest('td.user');
        if (!tdUser) return;
        selectedUser = tdUser.textContent.trim();
        loadLogs();
      });
    }

    const btnRefresh = document.getElementById('btnRefreshPresence');
    if (btnRefresh) safeOn(btnRefresh, 'click', fetchPresence);

    const btnOpenNotifyModal = document.getElementById('btnOpenNotifyModal');
    if (btnOpenNotifyModal) safeOn(btnOpenNotifyModal, 'click', function(){ openNotifyModalFor('all'); });

    const btnNotifyTest = document.getElementById('btnNotifyTest');
    if (btnNotifyTest) safeOn(btnNotifyTest, 'click', function(){
      try { btnNotifyTest.disabled = true; } catch(_) {}
      fetch('/push/test', { method: 'POST', credentials: 'same-origin' })
        .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, data: j }; }); })
        .then(function(res){
          if (res.ok && res.data && res.data.status === 'success') {
            window.showToast && window.showToast('Тестовое уведомление отправлено', 'success');
          } else {
            var msg = (res.data && res.data.message) ? res.data.message : 'Ошибка отправки уведомления';
            window.showToast && window.showToast(msg, 'error');
          }
        })
        .catch(function(){ window.showToast && window.showToast('Ошибка сети при отправке уведомления', 'error'); })
        .finally(function(){ try { btnNotifyTest.disabled = false; } catch(_) {} });
    });

    const btnSendNotifyM = document.getElementById('btnSendNotifyM');
    if (btnSendNotifyM) safeOn(btnSendNotifyM, 'click', function(){
      const scopeEl = document.querySelector('input[name="notifyScopeM"]:checked');
      const scope = (scopeEl && scopeEl.value) ? scopeEl.value : 'all';
      const combo = document.getElementById('notifyComboM');
      const text = document.getElementById('notifyTextM')?.value || '';
      if (!text.trim()) { window.showToast && window.showToast('Введите текст сообщения', 'error'); return; }
      let target = 'all';
      if (scope === 'user') {
        const uid = combo?.value; if (!uid) { window.showToast && window.showToast('Выберите пользователя', 'error'); return; }
        target = 'user:'+uid;
      } else if (scope === 'group') {
        const gid = combo?.value; if (!gid) { window.showToast && window.showToast('Выберите группу', 'error'); return; }
        target = 'group:'+gid;
      } else {
        // all, but if row-targeted was set
        const modalEl = document.getElementById('adminNotifyModal');
        const forced = modalEl ? (modalEl.dataset.target || '') : '';
        if (forced && forced.startsWith('user:')) target = forced;
      }
      sendMessage(target, text).then(function(j){
        if (j && j.status === 'success') { closeNotifyModal(); }
      });
    });

    const radiosM = document.querySelectorAll('input[name="notifyScopeM"]');
    radiosM.forEach(function(r){ safeOn(r, 'change', onScopeChangeModal); });

    const search = document.getElementById('logSearch');
    if (search) safeOn(search, 'input', debounce(loadLogs, 300));

    // Global Enter handling for open modal: submit default action
    safeOn(document, 'keydown', function(e){
      try {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        // Don't interfere with textarea (allow newline)
        const tgt = e.target;
        if (tgt && tgt.tagName === 'TEXTAREA') return;
        // If any modal is open, trigger its default button
        const openModal = document.querySelector('.modal.show');
        if (!openModal) return;
        const defBtn = openModal.querySelector('[data-enter="default"], .modal-footer .btn-primary');
        if (!defBtn) return;
        e.preventDefault();
        defBtn.click();
      } catch(_) {}
    });

    // logs context menu (copy)
    const logs = document.getElementById('logsView');
    if (logs) {
      safeOn(logs, 'contextmenu', function(e){
        e.preventDefault();
        lastContextRow = null;
        openContextMenu(e.pageX, e.pageY, 'logs'); // journal
      });
      // Pause logs while selecting inside pre
      document.addEventListener('selectionchange', function(){
        try {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) { isLogPaused = false; return; }
          const range = sel.getRangeAt(0);
          isLogPaused = logs.contains(range.startContainer) && logs.contains(range.endContainer) && String(sel).trim().length > 0;
        } catch(_) { isLogPaused = false; }
      });
    }

    // Page-wide context menu: only show Refresh when not on specific widgets
    safeOn(document, 'contextmenu', function(e){
      try {
        const logsEl = document.getElementById('logsView');
        const presEl = document.getElementById('presenceTable');
        const logsTable = document.getElementById('logsTable');
        if ((logsEl && logsEl.contains(e.target)) || (presEl && presEl.contains(e.target)) || (logsTable && logsTable.contains(e.target))) return;
        e.preventDefault();
        openContextMenu(e.pageX, e.pageY, 'page');
      } catch(_) {}
    });

    // Logs list table: context menu for download actions
    const logsTableEl = document.getElementById('logsTable');
    if (logsTableEl) {
      safeOn(logsTableEl, 'contextmenu', function(e){
        const row = e.target.closest('tr');
        if (!row) return;
        e.preventDefault();
        lastContextRow = row;
        openContextMenu(e.pageX, e.pageY, 'logs-list', row);
      });
    }

    // global click to hide context menu
    safeOn(document, 'click', function(){ hideContextMenu(); });
    safeOn(window, 'resize', function(){ hideContextMenu(); });

    // logs table: open in new tab on double click
    const logsTable2 = document.getElementById('logsTable');
    if (logsTable2) {
      safeOn(logsTable2, 'dblclick', function(e){
        const tr = e.target.closest('tr');
        if (!tr) return;
        const name = tr.getAttribute('data-name');
        if (!name) return;
        const url = '/admin/logs/view?name=' + encodeURIComponent(name);
        window.open(url, '_blank', 'noopener');
      });
      // hover cursor pointer
      safeOn(logsTable2, 'mousemove', function(e){ const tr = e.target.closest('tr'); if (!tr) return; tr.style.cursor = 'pointer'; });
    }
  }

  function enablePresenceContextMenu(){
    const table = document.getElementById('presenceTable');
    if (!table) return;
    safeOn(table, 'contextmenu', function(e){
      const row = e.target.closest('tr');
      if (!row) return;
      e.preventDefault();
      openContextMenu(e.pageX, e.pageY, 'presence', row);
    });
  }

  function openContextMenu(x, y, type, row){
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    // toggle admin actions by permission and target type
    const canManage = !!window.ADMIN_CAN_MANAGE;
    toggleMenuItem(menu, 'refresh', true);
    toggleMenuItem(menu, 'kick', canManage && type === 'presence');
    toggleMenuItem(menu, 'message', canManage && type === 'presence');
    const isJournal = (type === 'logs'); // actions journal
    const isLogsList = (type === 'logs-list'); // files list
    toggleMenuItem(menu, 'copy-selection', isJournal);
    toggleMenuItem(menu, 'copy-visible', isJournal);
    toggleMenuItem(menu, 'copy-all', isJournal);
    toggleMenuItem(menu, 'download', isLogsList);
    toggleMenuItem(menu, 'download-all', isLogsList);
    positionMenu(menu, x, y);
    menu.classList.remove('d-none');

    // bind actions
    bindMenuAction(menu, 'refresh', function(){ softRefresh(); });
    bindMenuAction(menu, 'kick', function(){
      if (!canManage) return; if (!row) return;
      const sid = row.getAttribute('data-sid');
      const uid = row.getAttribute('data-user-id');
      forceLogout(sid || null, uid || null);
    });
    bindMenuAction(menu, 'message', function(){ if (!canManage) return; if (!row) return; const uid = row.getAttribute('data-user-id'); openNotifyModalFor(uid ? ('user:'+uid) : 'all'); });
    bindMenuAction(menu, 'copy-selection', function(){ if (type === 'logs') copySelection(); });
    bindMenuAction(menu, 'copy-visible', function(){ if (type === 'logs') copyVisible(); });
    bindMenuAction(menu, 'copy-all', function(){ if (type === 'logs') copyAll(); });
    bindMenuAction(menu, 'download', function(){ if (type !== 'logs-list') return; downloadSelectedLog(); });
    bindMenuAction(menu, 'download-all', function(){ if (type !== 'logs-list') return; downloadAllLogs(); });
  }

  function hideContextMenu(){ const menu = document.getElementById('context-menu'); if (menu) menu.classList.add('d-none'); }
  function downloadSelectedLog(){
    try {
      const table = document.getElementById('logsTable'); if (!table) return;
      // Prefer the row captured when opening the context menu
      const rows = table.querySelectorAll('tbody tr');
      let targetName = '';
      if (lastContextRow) { targetName = lastContextRow.getAttribute('data-name')||''; }
      if (!targetName && rows && rows.length > 0) targetName = rows[0].getAttribute('data-name')||'';
      if (!targetName) return;
      const url = '/admin/logs/download?name=' + encodeURIComponent(targetName);
      window.open(url, '_blank', 'noopener');
    } catch(_) {}
  }

  function downloadAllLogs(){
    try {
      const url = '/admin/logs/download_all';
      window.open(url, '_blank', 'noopener');
    } catch(_) {}
  }
  function positionMenu(menu, x, y){ menu.style.left = x+'px'; menu.style.top = y+'px'; }
  function toggleMenuItem(menu, action, show){ const el = menu.querySelector('[data-action="'+action+'"]'); if (el) el.style.display = show ? '' : 'none'; }
  function bindMenuAction(menu, action, handler){ const el = menu.querySelector('[data-action="'+action+'"]'); if (!el) return; el.onclick = function(ev){ ev.preventDefault(); hideContextMenu(); handler(); }; }

  function copySelection(){
    try {
      const selObj = window.getSelection && window.getSelection();
      const text = selObj ? String(selObj) : '';
      if (!text) { window.showToast && window.showToast('Нет выделенного текста', 'warning'); return; }
      copyToClipboard(text);
    } catch(_) {}
  }
  function copyVisible(){
    const el = document.getElementById('logsView');
    if (!el) return;
    const full = el.textContent || '';
    const lines = full.split('\n');
    // Limit by Y (visible rows), do not clip by X
    const lh = getLineHeight(el);
    const start = Math.floor(el.scrollTop / lh);
    const count = Math.max(1, Math.floor(el.clientHeight / lh));
    const slice = lines.slice(start, start + count).join('\n');
    copyToClipboard(slice);
  }
  function copyAll(){
    fetch('/logs/actions', { credentials: 'same-origin' }).then(r=>r.ok?r.text():'').then(function(txt){ copyToClipboard(txt); });
  }
  function copyToClipboard(text){ try { navigator.clipboard.writeText(text); window.showToast && window.showToast('Скопировано', 'success'); } catch(_) {}
  }

  function getLineHeight(el){
    try {
      const cs = window.getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight);
      if (!isNaN(lh)) return lh;
      const test = document.createElement('span');
      test.textContent = 'A';
      el.appendChild(test);
      const h = test.getBoundingClientRect().height || 16.8;
      el.removeChild(test);
      return h;
    } catch(_) { return 16.8; }
  }

  function getCharWidth(el){
    try {
      const test = document.createElement('span');
      test.textContent = 'MMMMMMMMMM'; // 10 monospace chars
      test.style.visibility = 'hidden';
      test.style.whiteSpace = 'pre';
      el.appendChild(test);
      const w = test.getBoundingClientRect().width || 0;
      el.removeChild(test);
      return w / 10;
    } catch(_) { return 8; }
  }

  function softRefresh(){
    try { fetchPresence(); } catch(_) {}
    try { loadLogs(); } catch(_) {}
    try { loadLogsList(); } catch(_) {}
  }

  function safeOn(el, type, handler){
    try {
      // Use non-passive to allow preventDefault for contextmenu and similar
      el.addEventListener(type, handler);
    } catch(_) {
      try { el.addEventListener(type, handler); } catch(__) {}
    }
  }

  function onScopeChangeModal(){
    const scopeEl = document.querySelector('input[name="notifyScopeM"]:checked');
    const scope = (scopeEl && scopeEl.value) ? scopeEl.value : 'all';
    const combo = document.getElementById('notifyComboM');
    const wrap = document.getElementById('notifyComboWrapM') || (combo && combo.parentElement);
    if (wrap) { if (scope === 'all') { wrap.classList.add('d-none'); } else { wrap.classList.remove('d-none'); } }
    if (!combo) return;
    if (scope === 'all') { combo.disabled = true; combo.innerHTML = ''; return; }
    combo.disabled = false;
    if (scope === 'user') { loadUsersIntoCombo(combo); }
    else if (scope === 'group') { loadGroupsIntoCombo(combo); }
  }

  function loadUsersIntoCombo(select){
    fetch('/admin/users_list', { credentials: 'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || j.status !== 'success') return;
        select.innerHTML = '';
        (j.items || []).forEach(function(it){
          var opt = document.createElement('option');
          opt.value = it.id; opt.textContent = it.name; select.appendChild(opt);
        });
      })
      .catch(function(){});
  }

  function loadGroupsIntoCombo(select){
    try {
      var el = document.getElementById('server-groups-json');
      var serverGroups = el ? JSON.parse(el.textContent || 'null') : null;
      if (Array.isArray(serverGroups)) {
        select.innerHTML = '';
        serverGroups.forEach(function(g){ var opt = document.createElement('option'); opt.value = g.id; opt.textContent = g.name; select.appendChild(opt); });
        return;
      }
    } catch(_) {}
    select.innerHTML = '';
  }

  function debounce(fn, ms){ let t; return function(){ clearTimeout(t); const args = arguments; t = setTimeout(()=>fn.apply(null,args), ms); } }

  function loadLogs(){
    // Fetch the actions.log via a simple endpoint that streams file
    fetch('/logs/actions', { credentials: 'same-origin' })
      .then(r => r.ok ? r.text() : '')
      .then(text => {
        const view = document.getElementById('logsView'); if (!view) return;
        const query = (document.getElementById('logSearch')?.value || '').trim().toLowerCase();
        let lines = (text || '').split('\n');
        if (selectedUser) lines = lines.filter(l => l.includes(' user='+selectedUser));
        if (query) lines = lines.filter(l => l.toLowerCase().includes(query));
        // Reverse sort to show latest on top
        view.textContent = lines.reverse().join('\n');
      })
      .catch(()=>{
        const view = document.getElementById('logsView'); if (view) view.textContent = 'Не удалось загрузить логи';
      });
  }

  function formatBytes(bytes){
    try {
      const b = Number(bytes || 0);
      if (b < 1024) return b + ' B';
      if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
      return (b/1024/1024).toFixed(1) + ' MB';
    } catch(_) { return String(bytes||0); }
  }

  function loadLogsList(){
    fetch('/admin/logs_list', { credentials: 'same-origin' })
      .then(function(r){ if (!r.ok || !isJsonResponse(r)) { return { status: 'error', items: [] }; } return r.json().catch(function(){ return { status: 'error', items: [] }; }); })
      .then(function(j){
        if (!j || j.status !== 'success') return;
        const table = document.getElementById('logsTable'); if (!table) return;
        const tbody = table.querySelector('tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        // Ensure sort by modification time descending
        const items = Array.isArray(j.items) ? j.items.slice().sort(function(a,b){ return (b.mtime||0) - (a.mtime||0); }) : [];
        items.forEach(function(it){
          var tr = document.createElement('tr');
          tr.className = 'table__body_row logs-row';
          tr.setAttribute('data-name', it.name);
          // Tooltip with formatted mtime
          try { tr.title = new Date((it.mtime||0) * 1000).toLocaleString(); } catch(_) {}
          var tdName = document.createElement('td'); tdName.className = 'table__body_item'; tdName.textContent = it.name;
          var tdSize = document.createElement('td'); tdSize.className = 'table__body_item text-end'; tdSize.textContent = formatBytes(it.size);
          tr.appendChild(tdName); tr.appendChild(tdSize);
          tbody.appendChild(tr);
        });
      })
      .catch(function(){});
  }

  function initSocket(){
    try {
      if (!window.io) return;
      socket = window.socket || window.io(window.location.origin, { transports: ['websocket','polling'], path: '/socket.io/', withCredentials: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
      window.socket = socket;
      // Periodic presence updates with current page
      const emitPresence = function(){ try { socket.emit('presence:update', { page: location.pathname }); } catch(_) {} };
      socket.on('connect', function(){ emitPresence(); });
      socket.on('presence:changed', function(){ fetchPresence(); });
      socket.on('reconnect', function(){ emitPresence(); fetchPresence(); });
      socket.on('reconnect_error', function(){ /* ignore */ });
      socket.on('reconnect_failed', function(){ /* ignore */ });
      setInterval(emitPresence, 5000);
    } catch(_) {}
  }

  document.addEventListener('DOMContentLoaded', function(){
    bindHandlers();
    initSocket();
    fetchPresence();
    loadLogs();
    loadLogsList();
    setInterval(loadLogs, 10000);
    setInterval(loadLogsList, 20000);
    // Periodic polling to reconcile presence even if sockets idle
    setInterval(fetchPresence, 5000);
    onScopeChangeModal();
  });
})();


