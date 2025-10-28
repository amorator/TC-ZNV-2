// Files Search Module
// Поиск и фильтрация файлов через серверный API

// Debug helper (enable via window.__FILES_SEARCH_DEBUG = true or localStorage.setItem('debug:files','1'))
(function initFilesSearchDebug(){
  try {
    if (typeof window.__FILES_SEARCH_DEBUG === 'undefined') {
      try { window.__FILES_SEARCH_DEBUG = (localStorage.getItem('debug:files') === '1'); } catch(_) { window.__FILES_SEARCH_DEBUG = false; }
    }
    if (!window.__fsDbg) {
      window.__fsDbg = function(){
        if (!window.__FILES_SEARCH_DEBUG) return;
        try { console.log.apply(console, ['[files:search]'].concat(Array.prototype.slice.call(arguments))); } catch(_) {}
      };
    }
  } catch(_) {}
})();

// In-flight request control to avoid races on fast typing/clearing
var __filesSearchSeq = 0;
var __filesSearchActiveSeq = 0;
var __filesSearchAbortController = null;

// Shared reset logic to restore first page when search is empty
async function __filesResetToFirstPage() {
  try {
    // Cancel any in-flight search and invalidate stale responses
    try { if (__filesSearchAbortController) { __filesSearchAbortController.abort(); } } catch(_) {}
    try { __filesSearchActiveSeq = ++__filesSearchSeq; } catch(_) {}
    // Remove saved value and hide results
    try { localStorage.removeItem('files:search'); } catch(_) {}
    try { updateSearchResults(0, ''); } catch(_) {}
    const url = new URL(window.location);
    let catId = url.searchParams.get("cat_id") || url.searchParams.get("did");
    let subId = url.searchParams.get("sub_id") || url.searchParams.get("sdid");
    if (!catId) { try { catId = document.body && document.body.getAttribute('data-current-category-id'); } catch(_) {} }
    if (!subId) { try { subId = document.body && document.body.getAttribute('data-current-subcategory-id'); } catch(_) {} }
    if (!catId && typeof window.current_category_id !== 'undefined') { catId = String(window.current_category_id); }
    if (!subId && typeof window.current_subcategory_id !== 'undefined') { subId = String(window.current_subcategory_id); }
    if (!catId || !subId) return;
    const pageUrl = new URL('/files/page', window.location.origin);
    pageUrl.searchParams.set('cat_id', catId);
    pageUrl.searchParams.set('sub_id', subId);
    // Try to restore last visited page for this cat/sub
    let restorePage = 1;
    try {
      const key = `files:lastPage:${catId}:${subId}`;
      const saved = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      if (saved > 0) restorePage = saved;
    } catch(_) {}
    pageUrl.searchParams.set('page', String(restorePage));
    pageUrl.searchParams.set('page_size', '10');
    pageUrl.searchParams.set('_t', Date.now());
    const resp = await fetch(pageUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
    if (!resp.ok) return;
    const data = await resp.json();
    const table = document.getElementById('maintable');
    const pager = document.getElementById('files-pagination');
    if (table && typeof data.html === 'string') {
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody) {
        const searchRow = tbody.querySelector('#search');
        const searchHTML = searchRow ? searchRow.outerHTML : '';
        tbody.innerHTML = searchHTML + data.html;
      }
    }
    if (pager) {
      renderSearchPaginationControls(pager, data.total || 0, data.page || 1, data.page_size || 10, '');
    }
    // Maintain URL (remove q, reset page)
    try {
      const u = new URL(window.location);
      u.searchParams.delete('q');
      u.searchParams.set('page', '1');
      window.history.pushState({}, '', u.pathname + u.search);
    } catch(_) {}
    // Rebind
    reinitializeContextMenu();
    if (window.rebindFilesTable) window.rebindFilesTable();
    // Restore focus
    const input = document.getElementById('searchinp');
    if (input) { input.focus(); try { input.setSelectionRange(0,0); } catch(_) {} }
  } catch(_) {}
}

function initFilesSearchPersistence() {
  try {
    const input = document.getElementById("searchinp");
    if (!input) return;
    __fsDbg('initFilesSearchPersistence: input found');
    const key = "files:search";
    const saved = (function () {
      try {
        return localStorage.getItem(key) || "";
      } catch (_) {
        return "";
      }
    })();
    if (saved) {
      const restored = String(saved).trim();
      __fsDbg('initFilesSearchPersistence: restore saved', restored);
      input.value = restored;
      // Kick off server-side search immediately
      try { window.filesDoFilter && window.filesDoFilter(restored); } catch(_) {}
    }
    input.addEventListener("input", function (e) {
      __fsDbg('input event', e && e.target && e.target.value);
      const v = String(e.target && e.target.value || "").trim();
      try {
        if (v) localStorage.setItem(key, v); else localStorage.removeItem(key);
      } catch (_) {
        // Ignore localStorage errors
      }
      if (v) {
        __fsDbg('input->filesDoFilter', v);
        window.filesDoFilter(v);
      } else {
        // Clear search manually (not button) — reset UI and storage, fetch first page
        __fsDbg('input->clear: fetch first page');
        __filesResetToFirstPage();
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initFilesSearchPersistence");
    }
  }
}

async function filterFilesTable(searchTerm, page = 1) {
  try {
    const searchValue = String(searchTerm || '').trim();
    __fsDbg('filterFilesTable:start', { searchTerm: searchValue, page: page });
    // Abort previous request
    try { if (__filesSearchAbortController) { __filesSearchAbortController.abort(); } } catch(_) {}
    __filesSearchAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const mySeq = ++__filesSearchSeq; __filesSearchActiveSeq = mySeq;
    const url = new URL(window.location);
    // Try multiple sources for IDs: URL (cat_id/sub_id or did/sdid) → body data attributes → globals
    let catId = url.searchParams.get("cat_id") || url.searchParams.get("did");
    let subId = url.searchParams.get("sub_id") || url.searchParams.get("sdid");
    if (!catId) {
      try { catId = document.body && document.body.getAttribute('data-current-category-id'); } catch(_) {}
    }
    if (!subId) {
      try { subId = document.body && document.body.getAttribute('data-current-subcategory-id'); } catch(_) {}
    }
    if (!catId && typeof window.current_category_id !== 'undefined') { catId = String(window.current_category_id); }
    if (!subId && typeof window.current_subcategory_id !== 'undefined') { subId = String(window.current_subcategory_id); }
    
    if (!catId || !subId) {
      __fsDbg('filterFilesTable: missing ids', { catId: catId, subId: subId });
      return;
    }

    const searchUrl = new URL("/files/search", window.location.origin);
    searchUrl.searchParams.set("q", searchValue);
    searchUrl.searchParams.set("cat_id", catId);
    searchUrl.searchParams.set("sub_id", subId);
    searchUrl.searchParams.set("page", String(page || 1));
    searchUrl.searchParams.set("page_size", "10");
    searchUrl.searchParams.set("_t", Date.now());
    __fsDbg('filterFilesTable:fetch', String(searchUrl));

    const response = await fetch(searchUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
      signal: (__filesSearchAbortController && __filesSearchAbortController.signal) || undefined,
    });

    if (!response.ok) {
      __fsDbg('filterFilesTable:response:not ok', response && response.status);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    // Drop stale responses
    if (mySeq !== __filesSearchActiveSeq) { __fsDbg('filterFilesTable:stale response dropped'); return; }
    __fsDbg('filterFilesTable:response:ok', { total: data && data.total, page: data && data.page, len: data && data.html && data.html.length });
    const table = document.getElementById("maintable");
    const pager = document.getElementById("files-pagination");

    if (table && typeof data.html === 'string') {
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody) {
        // Preserve search row if present
        const searchRow = tbody.querySelector('#search');
        const searchHTML = searchRow ? searchRow.outerHTML : '';
        tbody.innerHTML = searchHTML + data.html;
        __fsDbg('filterFilesTable:update tbody');
        try {
          const input = document.getElementById('searchinp');
          if (input) {
            const val = String(searchTerm || '').trim();
            input.value = val;
            // Restore focus and caret at end
            input.focus();
            try { const n = val.length; input.setSelectionRange(n, n); } catch(_) {}
          }
        } catch(_) {}
      }
    }

    if (pager) {
      renderSearchPaginationControls(pager, data.total || 0, data.page || 1, data.page_size || 10, searchValue);
      __fsDbg('filterFilesTable:render pager', { total: data.total, page: data.page });
    }

    // Update results count
    updateSearchResults(data.total, searchValue);

    // Update URL
    url.searchParams.set("q", searchValue);
    url.searchParams.set("page", String(page || 1));
    window.history.pushState({}, "", url.pathname + url.search);

    // Reinitialize context menu and handlers
    reinitializeContextMenu();
    if (window.rebindFilesTable) window.rebindFilesTable();
    __fsDbg('filterFilesTable:done');
  } catch (err) {
    // Ignore abort errors
    if (err && (err.name === 'AbortError' || String(err).indexOf('AbortError') !== -1)) { __fsDbg('filterFilesTable:aborted'); return; }
    __fsDbg('filterFilesTable:error', err && (err.message || err));
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "filterFilesTable");
    }
  }
}

function renderSearchPaginationControls(pagerEl, total, currentPage, pageSize, searchTerm) {
  try {
    __fsDbg('renderSearchPaginationControls', { total: total, currentPage: currentPage, pageSize: pageSize });
    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 10)));
    const cp = Math.min(Math.max(1, currentPage || 1), totalPages);

    const btn = (text, pageNum, disabled, active = false) =>
      `<li class="page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}">\n         <a class="page-link" href="#" data-page="${pageNum}">${text}</a>\n       </li>`;

    const items = [];
    items.push(btn('«', 1, cp === 1));
    items.push(btn('‹', Math.max(1, cp - 1), cp === 1));

    // Always show page 1
    items.push(btn('1', 1, false, cp === 1));

    // Middle window
    const windowSize = 3;
    let start = Math.max(2, cp - 1);
    let end = Math.min(totalPages - 1, cp + 1);
    while ((end - start + 1) < windowSize && start > 2) start--;
    while ((end - start + 1) < windowSize && end < totalPages - 1) end++;

    if (start > 2) {
      items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
    }
    for (let i = start; i <= end; i++) {
      items.push(btn(String(i), i, false, i === cp));
    }
    if (end < totalPages - 1) {
      items.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
    }

    if (totalPages > 1) {
      items.push(btn(String(totalPages), totalPages, false, cp === totalPages));
    }

    items.push(btn('›', Math.min(totalPages, cp + 1), cp === totalPages));
    items.push(btn('»', totalPages, cp === totalPages));

    pagerEl.innerHTML = `<nav><ul class="pagination mb-0">${items.join('')}</ul></nav>`;

    // Bind click for search pagination
    pagerEl.addEventListener('click', function onClick(e) {
      const a = e.target && e.target.closest('[data-page]');
      if (!a) return;
      e.preventDefault();
      const nextPage = parseInt(a.getAttribute('data-page'), 10) || 1;
      if (!nextPage || nextPage === cp) return;
      __fsDbg('pager:click', nextPage);
      filterFilesTable(searchTerm, nextPage);
    }, { once: true });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, 'renderSearchPaginationControls');
    }
  }
}

function updateSearchResults(total, searchTerm) {
  try {
    const resultsIndicator = document.getElementById("search-results");
    if (resultsIndicator) {
      if (searchTerm) {
        resultsIndicator.textContent = `Найдено файлов: ${total}`;
        resultsIndicator.style.display = "block";
      } else {
        resultsIndicator.style.display = "none";
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateSearchResults");
    }
  }
}

function clearFilesSearch() {
  try {
    const input = document.getElementById("searchinp");
    if (input) {
      input.value = "";
      const url = new URL(window.location);
      url.searchParams.delete("q");
      url.searchParams.set("page", "1");
      window.location.search = url.search;
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "clearFilesSearch");
    }
  }
}

function setupFilesSearch() {
  try {
    __fsDbg('setupFilesSearch:start');
    // Initialize search persistence
    initFilesSearchPersistence();

    // Bind direct server-side search on input/Enter with debounce
    (function bindDirectFilesSearch(){
      try {
        var ensureBind = function(){
          var input = document.getElementById('searchinp');
          if (!input) { __fsDbg('bindDirectFilesSearch: no input yet'); return; }
          if (input._filesSearchBound) return;
          input._filesSearchBound = true;
          __fsDbg('bindDirectFilesSearch:bound');
          var timer = null;
          var trigger = function(){
            var val = (input.value || '').trim();
            if (val) {
              __fsDbg('trigger->filterFilesTable', val);
              window.FilesSearch && window.FilesSearch.filterFilesTable && window.FilesSearch.filterFilesTable(val, 1);
            }
          };
          input.addEventListener('input', function(){
            __fsDbg('input (direct)');
            clearTimeout(timer);
            var v = (input.value || '').trim();
            if (!v) {
              // Immediate clear reset handled by persistence handler as well, but ensure debounce is flushed
              try { if (__filesSearchAbortController) { __filesSearchAbortController.abort(); } } catch(_) {}
              // Let initFilesSearchPersistence's input handler perform the reset
              __filesResetToFirstPage();
              return;
            }
            timer = setTimeout(trigger, 250);
          });
          input.addEventListener('keydown', function(e){
            if (e.key === 'Enter') { __fsDbg('enter'); e.preventDefault(); clearTimeout(timer); trigger(); }
          });
        };

        // Initial attempt
        ensureBind();
        // Rebind after table updates
        document.addEventListener('table-updated', function(){ __fsDbg('table-updated -> rebind'); ensureBind(); });
        // Observe tbody mutations to rebind when search row replaced
        try {
          var table = document.getElementById('maintable');
          var tbody = table && table.tBodies && table.tBodies[0];
          if (tbody && !tbody._filesSearchObserver) {
            var mo = new MutationObserver(function(){ ensureBind(); });
            mo.observe(tbody, { childList: true, subtree: true });
            tbody._filesSearchObserver = mo;
            __fsDbg('bindDirectFilesSearch:observer attached');
          }
        } catch(_) {}
      } catch(err) {
        if (window.ErrorHandler) { window.ErrorHandler.handleError(err, 'bindDirectFilesSearch'); }
      }
    })();

    // Setup clear button
    const clearBtn = document.getElementById("clear-search-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", clearFilesSearch);
    }

    // Setup search shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        const input = document.getElementById("searchinp");
        if (input) {
          input.focus();
          __fsDbg('focus searchinp (Ctrl+F)');
        }
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupFilesSearch");
    }
  }
}

// Export to global scope
window.filesDoFilter = filterFilesTable;

// Export functions to global scope
window.FilesSearch = {
  initFilesSearchPersistence,
  filterFilesTable,
  updateSearchResults,
  clearFilesSearch,
  setupFilesSearch,
};

// Auto-initialize on DOM ready as a safety net
(function autoInitFilesSearch(){
  try {
    var init = function(){
      if (window.FilesSearch && typeof window.FilesSearch.setupFilesSearch === 'function') {
        window.FilesSearch.setupFilesSearch();
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch(err) {
    if (window.ErrorHandler) { window.ErrorHandler.handleError(err, 'autoInitFilesSearch'); }
  }
})();

