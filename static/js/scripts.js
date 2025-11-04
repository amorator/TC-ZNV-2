/**
 * Основной скрипт приложения
 * Содержит глобальные обработчики событий и инициализацию
 *
 * @namespace MainScript
 */

// Глобальная переменная для отслеживания текущего модального окна
var popup = null;

/**
 * Обработчик клавиатуры для модальных окон
 * - Enter: отправляет форму (кроме textarea)
 * - Escape: закрывает модальное окно
 * @memberof MainScript
 */
function popupKeys() {
  document.addEventListener("keydown", function (event) {
    if (popup && event.key === "Escape") {
      event.preventDefault();
      if (typeof closeModal === "function") closeModal(popup);
      else popupToggle(popup);
    }
  });
}

/**
 * Глобальный обработчик Enter для отправки активного модального окна
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }

    const target = event.target;
    if (target && target.tagName === "TEXTAREA") return;

    const overlay = document.querySelector(
      ".overlay-container.show, .overlay-container.visible"
    );
    if (!overlay) return;

    // Предпочитаем явную кнопку по умолчанию
    let defaultBtn = overlay.querySelector('[data-enter="default"]');
    if (!defaultBtn) {
      defaultBtn = overlay.querySelector(".popup__actions .btn-primary");
    }
    if (!defaultBtn) return;

    event.preventDefault();
    try { console.debug('[kbd] Enter pressed -> clicking default button', { id: defaultBtn.id, classes: defaultBtn.className, dataset: defaultBtn.dataset }); } catch(_) {}
    defaultBtn.click();
  },
  true
);

// Layout-independent hotkeys for media: F (fullscreen), M (mute)
document.addEventListener(
  "keydown",
  function (event) {
    // Only when a media modal is open
    const audioOverlay = document.getElementById("popup-audio");
    const videoOverlay = document.getElementById("popup-view");
    const audioOpen = !!(
      audioOverlay &&
      (audioOverlay.classList.contains("show") ||
        audioOverlay.classList.contains("visible"))
    );
    const videoOpen = !!(
      videoOverlay &&
      (videoOverlay.classList.contains("show") ||
        videoOverlay.classList.contains("visible"))
    );
    if (!audioOpen && !videoOpen) return;

    // Ignore when typing
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    ) {
      return;
    }

    // Use event.code so it works across keyboard layouts
    const code = event.code;
    if (code === "KeyF" && videoOpen) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const video = document.getElementById("player-video");
        // Request fullscreen on the video element itself (not the modal)
        if (!document.fullscreenElement) {
          if (video && video.requestFullscreen) video.requestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
        }
      } catch (err) {
        window.ErrorHandler && window.ErrorHandler.handleError(err, "video-fullscreen");
      }
      return;
    }
    if (code === "KeyM") {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (videoOpen) {
          const v = document.getElementById("player-video");
          if (v) v.muted = !v.muted;
        } else if (audioOpen) {
          const a = document.getElementById("player-audio");
          if (a) a.muted = !a.muted;
        }
      } catch (err) {
        window.ErrorHandler && window.ErrorHandler.handleError(err, "media-mute");
      }
    }
  },
  true
);

/**
 * Глобальные клавиатурные сокращения для модальных окон
 * - Enter: отправляет форму (кроме textarea)
 * - Escape: закрывает модальное окно
 * - Space/P: воспроизводит/приостанавливает медиа
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    if (!popup) return;

    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "TEXTAREA" ||
        active.tagName === "INPUT" ||
        active.isContentEditable);

    // Enter для отправки текущего модального окна (пропускаем textarea)
    if (event.key === "Enter" && !isTyping) {
      event.preventDefault();

      if (popup === "popup-rec") {
        const iframe = document.getElementById("rec-iframe");
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage({ type: "rec:save" }, "*");
          } catch (error) {
            window.ErrorHandler && window.ErrorHandler.handleError(error, "recorder-save");
          }
        }
        return;
      }

      const overlay = document.getElementById(popup);
      if (!overlay) return;

      // Предпочитаем кнопку отправки формы
      const form = overlay.querySelector("form");
      const submitBtn = overlay.querySelector(
        '.popup__actions .btn.btn-primary, .popup__actions [type="submit"]'
      );
      if (submitBtn) {
        try {
          submitBtn.click();
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError(error, "submit-click");
        }
        return;
      }
    }

    // Escape для закрытия модального окна с существующими защитами
    if (event.key === "Escape") {
      try {
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        window.ErrorHandler && window.ErrorHandler.handleError(error, "prevent-default");
      }

      // Защищенное поведение для записи: не закрывать во время записи
      if (popup === "popup-rec") {
        try {
          const overlay = document.getElementById("popup-rec");
          if (
            overlay &&
            (overlay.classList.contains("show") ||
              overlay.classList.contains("visible"))
          ) {
            const iframe = document.getElementById("rec-iframe");
            if (iframe && iframe.contentWindow) {
              window.__recCloseRequested = true;
              window.__recCloseReason = "esc";

              if (window.__recStateTimer) {
                clearTimeout(window.__recStateTimer);
                window.__recStateTimer = null;
              }

              iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");

              // Не подтверждаем автоматически через fallback на ESC
              window.__recStateTimer = setTimeout(function () {
                window.__recCloseRequested = false;
                window.__recCloseReason = null;
                window.__recStateTimer = null;
              }, 300);
              return;
            }
          }
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError(error, "recorder-close");
        }
      }

      try {
        popupClose(popup);
      } catch (error) {
        window.ErrorHandler && window.ErrorHandler.handleError(error, "popup-close-escape");
      }
    }
  },
  true
);

/**
 * Глобальная защита: блокирует Space когда любое видимое модальное окно присутствует
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    // Любое видимое модальное окно?
    const overlay = document.querySelector(
      ".overlay-container.show, .overlay-container.visible"
    );
    if (!overlay) return;

    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    ) {
      return;
    }

    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      // НЕ останавливаем stopImmediatePropagation, чтобы наш обработчик переключения мог работать дальше
      event.stopPropagation();
    }
  },
  true
);

/**
 * "p" и Space для переключения воспроизведения/паузы когда медиа модальные окна открыты
 * @memberof MainScript
 */
document.addEventListener(
  "keydown",
  function (event) {
    // Не срабатывать во время ввода
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    ) {
      return;
    }

    const isP =
      event.code === "KeyP" ||
      (event.key && event.key.toLowerCase && event.key.toLowerCase() === "p");
    const isSpace = event.code === "Space" || event.key === " ";
    if (!isP && !isSpace) return;

    // Определяем, какое медиа модальное окно действительно видимо
    const audioOverlay = document.getElementById("popup-audio");
    const videoOverlay = document.getElementById("popup-view");
    const audioOpen = !!(
      audioOverlay &&
      (audioOverlay.classList.contains("show") ||
        audioOverlay.classList.contains("visible"))
    );
    const videoOpen = !!(
      videoOverlay &&
      (videoOverlay.classList.contains("show") ||
        videoOverlay.classList.contains("visible"))
    );
    if (!audioOpen && !videoOpen) return;

    // Предотвращаем обработчики фоновой страницы и прокрутку
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      window.ErrorHandler && window.ErrorHandler.handleError(error, "prevent-default-escape");
    }

    if (audioOpen) {
      const audio = document.getElementById("player-audio");
      if (audio) {
        if (audio.paused) {
          try {
            audio.play();
          } catch (error) {
            window.ErrorHandler && window.ErrorHandler.handleError(error, "audio-play");
          }
        } else {
          try {
            audio.pause();
          } catch (error) {
            window.ErrorHandler && window.ErrorHandler.handleError(error, "audio-pause");
          }
        }
      }
    } else if (videoOpen) {
      const video = document.getElementById("player-video");
      if (video) {
        if (video.paused) {
          try {
            video.play();
          } catch (error) {
            window.ErrorHandler && window.ErrorHandler.handleError(error, "video-play");
          }
        } else {
          try {
            video.pause();
          } catch (error) {
            window.ErrorHandler && window.ErrorHandler.handleError(error, "video-pause");
          }
        }
      }
    }
  },
  true
);

/**
 * Клик вне модального окна для закрытия любого открытого модального окна
 * @memberof MainScript
 */
document.addEventListener(
  "click",
  function (event) {
    const overlay = event.target.closest(".overlay-container");
    if (!overlay) return;

    if (
      event.target === overlay &&
      (overlay.classList.contains("show") ||
        overlay.classList.contains("visible"))
    ) {
      const id = overlay.id;
      if (!id) return;

      // Guard: prevent closing files add modal during active upload
      try {
        if (id === 'popup-add' && window.__uploadInProgress === true) {
          event.preventDefault();
          event.stopPropagation();
          if (window.showToast) {
            window.showToast('Загрузка идет. Используйте Отмена для остановки и закрытия.', 'warning');
          }
          return;
        }
      } catch (error) {
        window.ErrorHandler && window.ErrorHandler.handleError(error, 'popup-overlay-guard');
      }

      if (id === "popup-rec") {
        try {
          const iframe = document.getElementById("rec-iframe");
          if (iframe && iframe.contentWindow) {
            window.__recCloseRequested = true;
            window.__recCloseReason = "esc";

            if (window.__recStateTimer) {
              clearTimeout(window.__recStateTimer);
              window.__recStateTimer = null;
            }

            iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");
            window.__recStateTimer = setTimeout(function () {
              window.__recCloseRequested = false;
              window.__recCloseReason = null;
              window.__recStateTimer = null;
            }, 300);
            return;
          }
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError(error, "recorder-close");
        }
      }

      try {
        popupClose(id);
      } catch (error) {
        overlay.classList.remove("show");
        window.ErrorHandler && window.ErrorHandler.handleError(error, "popup-close-overlay");
      }

      try {
        stopAllMedia();
      } catch (error) {
        window.ErrorHandler && window.ErrorHandler.handleError(error, "media-stop");
      }
    }
  },
  true
);

/**
 * Останавливает все медиа когда вкладка становится скрытой (безопасность)
 * @memberof MainScript
 */
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    if (typeof stopAllMedia === "function") {
      stopAllMedia();
    }
  }
});

/**
 * Тестовая функция уведомлений для проверки разрешений браузера
 * @memberof MainScript
 */
function notifyTest() {
  if (!("Notification" in window)) {
    window.showAlertModal("Уведомления не поддерживаются!", "Ошибка");
  } else if (Notification.permission === "granted") {
    const notification = new Notification("Проверка", {
      body: "Тестовое уведомление",
      icon: "/static/icons/notification_menu.png",
      requireInteraction: true,
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        const notification = new Notification("Привет!");
      }
    });
  }
}

// Инициализация при загрузке DOM
document.addEventListener("DOMContentLoaded", function () {
  popupKeys();
  try {
    // Initialize saved pagination state from URL on first load (Users/Groups)
    (function initSavedPagination(){
      try {
        const url = new URL(window.location.href);
        const page = parseInt(url.searchParams.get('page') || '0', 10);
        const pageSize = parseInt(url.searchParams.get('page_size') || '0', 10);
        if (document.querySelector("section[data-testid='users-section']")) {
          const saved = (function(){ try { return JSON.parse(localStorage.getItem('tableState:users') || 'null') || {}; } catch(_) { return {}; }})();
          const state = { page: page || saved.page || 1, pageSize: pageSize || saved.pageSize || 10 };
          try { localStorage.setItem('tableState:users', JSON.stringify(state)); } catch(_) {}
          try { if (pageSize) localStorage.setItem('users:pageSize', String(pageSize)); } catch(_) {}
        }
        if (document.querySelector("section[data-testid='groups-section']")) {
          const saved = (function(){ try { return JSON.parse(localStorage.getItem('tableState:groups') || 'null') || {}; } catch(_) { return {}; }})();
          const state = { page: page || saved.page || 1, pageSize: pageSize || saved.pageSize || 10 };
          try { localStorage.setItem('tableState:groups', JSON.stringify(state)); } catch(_) {}
          try { if (pageSize) localStorage.setItem('groups:pageSize', String(pageSize)); } catch(_) {}
        }
      } catch(_) {}
    })();

    // Ensure explicit ?page and ?page_size in URL on initial section open
    (function ensureInitialPagerParams(){
      try {
        const url = new URL(window.location.href);
        const hasPage = !!url.searchParams.get('page');
        const hasPageSize = !!url.searchParams.get('page_size');
        const inUsers = !!document.querySelector("section[data-testid='users-section']");
        const inGroups = !!document.querySelector("section[data-testid='groups-section']");
        if (!inUsers && !inGroups) return;
        let page = parseInt(url.searchParams.get('page') || '0', 10);
        let pageSize = parseInt(url.searchParams.get('page_size') || '0', 10);
        if (inUsers) {
          const saved = (function(){ try { return JSON.parse(localStorage.getItem('tableState:users') || 'null') || {}; } catch(_) { return {}; } })();
          if (!page) page = saved.page || 1;
          if (!pageSize) pageSize = saved.pageSize || 10;
          try { if (!localStorage.getItem('users:pageSize')) localStorage.setItem('users:pageSize', String(pageSize)); } catch(_) {}
        }
        if (inGroups) {
          const saved = (function(){ try { return JSON.parse(localStorage.getItem('tableState:groups') || 'null') || {}; } catch(_) { return {}; } })();
          if (!page) page = saved.page || 1;
          if (!pageSize) pageSize = saved.pageSize || 10;
          try { if (!localStorage.getItem('groups:pageSize')) localStorage.setItem('groups:pageSize', String(pageSize)); } catch(_) {}
        }
        if (!hasPage || !hasPageSize) {
          url.searchParams.set('page', String(page || 1));
          url.searchParams.set('page_size', String(pageSize || 10));
          try { window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`); } catch(_) {}
        }
      } catch(_) {}
    })();

    // Ensure explicit params on Categories and Registrators admin pages
    (function ensureInitialAdminPagerParams(){
      try {
        const path = (window.location && window.location.pathname) || '';
        const inCategories = path.indexOf('/categories') !== -1;
        const inRegistrators = path.indexOf('/registrators') !== -1 && !document.querySelector("section[data-testid='users-section']");
        if (!inCategories && !inRegistrators) return;
        const url = new URL(window.location.href);
        // Categories: two independent lists (groups/users)
        if (inCategories) {
          const hasPg = !!url.searchParams.get('page_groups');
          const hasSg = !!url.searchParams.get('page_size_groups');
          const hasPu = !!url.searchParams.get('page_users');
          const hasSu = !!url.searchParams.get('page_size_users');
          // Defaults 1/10
          if (!hasPg) url.searchParams.set('page_groups', '1');
          if (!hasSg) url.searchParams.set('page_size_groups', '10');
          if (!hasPu) url.searchParams.set('page_users', '1');
          if (!hasSu) url.searchParams.set('page_size_users', '10');
          if (!hasPg || !hasSg || !hasPu || !hasSu) {
            try { window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`); } catch(_) {}
          }
        }
        // Registrators: two independent lists (groups/users) in permissions panel
        if (inRegistrators) {
          const hasPg = !!url.searchParams.get('page_groups');
          const hasSg = !!url.searchParams.get('page_size_groups');
          const hasPu = !!url.searchParams.get('page_users');
          const hasSu = !!url.searchParams.get('page_size_users');
          if (!hasPg) url.searchParams.set('page_groups', '1');
          if (!hasSg) url.searchParams.set('page_size_groups', '10');
          if (!hasPu) url.searchParams.set('page_users', '1');
          if (!hasSu) url.searchParams.set('page_size_users', '10');
          if (!hasPg || !hasSg || !hasPu || !hasSu) {
            try { window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`); } catch(_) {}
          }
        }
      } catch(_) {}
    })();

    // --- Users page: open permissions on row double-click ---
    const usersSection = document.querySelector("section[data-testid='users-section']");
    if (usersSection) {
      const usersTable = document.querySelector('[data-testid="users-table"]');
      const canManage = !!(usersTable && usersTable.getAttribute('data-can-manage') === '1');
      if (canManage) {
        usersSection.addEventListener('dblclick', function (e) {
          const row = e.target && e.target.closest && e.target.closest('tr.table__body_row');
          if (!row) return;
          const login = (row.getAttribute('data-login') || '').toLowerCase();
          if (login === 'admin') return; // do not open perms for protected admin
          // Mirror context menu: users -> perm
          try {
            if (window.contextMenu && typeof window.contextMenu.executeUsersAction === 'function') {
              e.preventDefault();
              e.stopPropagation();
              window.contextMenu.executeUsersAction('perm', row);
              return;
            }
          } catch(_) {}
          // Fallback direct open if contextMenu unavailable
          const rowId = row.id || row.getAttribute('data-id');
          if (!rowId) return;
          try {
            const form = document.getElementById('perm');
            if (form && window.popupValues) {
              window.popupValues(form, rowId);
            }
            if (window.popupToggle) {
              window.popupToggle('popup-perm', rowId);
            }
          } catch(_) {}
        }, true);
      }
    }

    // --- Files page: prevent opening player on dblclick when file missing ---
    const filesSection = document.querySelector('section.files-page, .files-page');
    if (filesSection) {
      filesSection.addEventListener('dblclick', function (e) {
        const row = e.target && e.target.closest && e.target.closest('tr.table__body_row');
        if (!row) return;
        const exists = row.getAttribute('data-exists');
        const url = row.getAttribute('data-url') || '';
        // Ignore if file missing or no open URL
        if (exists === '0' || !url) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Mirror context menu "open"
        try {
          if (window.contextMenu && typeof window.contextMenu.executeFilesAction === 'function') {
            e.preventDefault();
            e.stopPropagation();
            window.contextMenu.executeFilesAction('open', row);
          }
        } catch(_) {}
      }, true);
    }
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError(error, 'dom-ready-init');
  }
  // Global error diagnostics (noisy, but only for current debugging)
  try {
    if (!window.__globalDebugHandlersInstalled) {
      window.__globalDebugHandlersInstalled = true;
      window.addEventListener('error', function(e){ try { console.debug('[global-error]', e && (e.error && (e.error.stack || e.error) || e.message)); } catch(_) {} });
      window.addEventListener('unhandledrejection', function(e){ try { console.debug('[global-rejection]', e && (e.reason && (e.reason.stack || e.reason) || e)); } catch(_) {} });
    }
  } catch(_) {}
  try { ensurePagerLinks('users'); ensurePagerLinks('groups'); } catch(_) {}
  try {
    // Observe pagination containers for dynamic changes and normalize links
    const observePager = function(id, scope){
      const el = document.getElementById(id);
      if (!el) return;
      if (el._pagerObserved) return; el._pagerObserved = true;
      const mo = new MutationObserver(function(){ try { ensurePagerLinks(scope); } catch(_) {} });
      mo.observe(el, { childList: true, subtree: true });
    };
    observePager('users-pagination', 'users');
    observePager('groups-pagination', 'groups');
    // Also normalize and observe admin pages (categories/registrators) pagers using current path
    (function(){
      const path = (window.location && window.location.pathname) || '';
      const inCategories = path.indexOf('categories') !== -1;
      const inRegistrators = path.indexOf('registrators') !== -1;
      if (inCategories || inRegistrators) {
        try { ensurePagerLinksForContainer('users-pagination', 'users:pageSize'); } catch(_) {}
        try { ensurePagerLinksForContainer('groups-pagination', 'groups:pageSize'); } catch(_) {}
        const observeGeneric = function(id, lsKey){
          const el = document.getElementById(id);
          if (!el) return;
          if (el._pagerObserved2) return; el._pagerObserved2 = true;
          const mo = new MutationObserver(function(){ try { ensurePagerLinksForContainer(id, lsKey); } catch(_) {} });
          mo.observe(el, { childList: true, subtree: true });
        };
        observeGeneric('users-pagination', 'users:pageSize');
        observeGeneric('groups-pagination', 'groups:pageSize');
      }
    })();
  } catch(_) {}
});

// Soft refresh for Users table preserving current page and pagination
function softRefreshUsersTable() {
  try {
    if (window.__usersSoftRefreshing) { try { console.debug('[users][softRefresh] skipped (already refreshing)'); } catch(_) {} return; }
    window.__usersSoftRefreshing = true;
    const table = document.querySelector("section[data-testid='users-section'] #maintable");
    if (!table) return;
    try { console.debug('[users][softRefresh] start'); } catch(_) {}
    // Read persisted state or current DOM state
    const lsKey = 'tableState:users';
    const domState = (function() {
      const pager = document.getElementById('users-pagination');
      const activeLink = pager && pager.querySelector('.page-item.active [data-page]');
      let page = activeLink ? parseInt(activeLink.getAttribute('data-page') || '1', 10) : 0;
      if (!page) {
        const activeItem = pager && pager.querySelector('.page-item.active');
        const txt = activeItem ? (activeItem.textContent || '').trim() : '';
        const num = parseInt(txt, 10);
        page = (isFinite(num) && num > 0) ? num : 1;
      }
      const sizeEl = document.querySelector("section[data-testid='users-section'] select[name='page_size']");
      const pageSize = sizeEl ? parseInt(sizeEl.value || '10', 10) : 10;
      return { page: page, pageSize: pageSize };
    })();
    const saved = (function(){ try { return JSON.parse(localStorage.getItem(lsKey) || 'null') || {}; } catch(_) { return {}; } })();
    const state = { page: saved.page || domState.page || 1, pageSize: saved.pageSize || domState.pageSize || 10 };
    try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch(_) {}

    const url = new URL(window.location.href);
    const params = new URLSearchParams({ page: String(state.page), page_size: String(state.pageSize), _t: String(Date.now()) });
    fetch(`/users/page?${params.toString()}`, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    }).then((data) => {
      try { console.debug('[users][softRefresh] response', { total: data.total, page: data.page, page_size: data.page_size }); } catch(_) {}
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && data && typeof data.html === 'string') {
        // Preserve search row if present
        let searchRow = null;
        try { searchRow = tbody.querySelector('tr#search'); } catch(_) { searchRow = null; }
        tbody.innerHTML = data.html;
        if (searchRow) {
          try { tbody.insertBefore(searchRow, tbody.firstChild); } catch(_) {}
        }
      }
      // Use server-provided pager HTML when available
      try {
        const pager = document.getElementById('users-pagination');
        if (pager && typeof data.pager_html === 'string' && data.pager_html) {
          pager.innerHTML = data.pager_html;
        } else {
          const total = parseInt(data.total || 0, 10);
          const page = parseInt(data.page || 1, 10);
          const pageSize = parseInt(data.page_size || 10, 10);
          renderPagination('users-pagination', page, pageSize, total, 'users');
        }
        try { ensurePagerLinks('users'); } catch(_) {}
        // Persist and reflect in URL
        const page = parseInt(data.page || 1, 10);
        const pageSize = parseInt(data.page_size || 10, 10);
        const stateNow = { page: page, pageSize: pageSize };
        try { localStorage.setItem(lsKey, JSON.stringify(stateNow)); } catch(_) {}
        const newQs = new URLSearchParams(url.search);
        newQs.set('page', String(page)); newQs.set('page_size', String(pageSize));
        try { window.history.replaceState(null, '', `${url.pathname}?${newQs.toString()}`); } catch(_) {}
      } catch(_) {}
      // Notify listeners that table content was updated (to rebind search etc.)
      try { document.dispatchEvent(new Event('table-updated', { bubbles: true })); } catch(_) {}
      // Reinitialize UI bindings explicitly for Users page
      try {
        if (window.reinitializeContextMenu) {
          window.reinitializeContextMenu();
        } else {
          const event = new CustomEvent('context-menu-reinit', { detail: { timestamp: Date.now() } });
          document.dispatchEvent(event);
        }
        if (window.UsersPage && typeof window.UsersPage.selectUser === 'function') {
          // no-op, just verify module loaded
        }
        if (typeof setupUserManagement === 'function') setupUserManagement();
        if (typeof setupPermissions === 'function') setupPermissions();
        if (typeof setupTableInteractions === 'function') setupTableInteractions();
        if (typeof window.rebindUsersTable === 'function') window.rebindUsersTable();
      } catch(_) {}
      try { const pagerEl = document.getElementById('users-pagination'); if (pagerEl) pagerEl.classList.remove('d-none'); } catch(_) {}
      try { console.debug('[users][softRefresh] done'); } catch(_) {}
    }).catch((err) => {
      window.ErrorHandler && window.ErrorHandler.handleError(err, 'softRefreshUsersTable');
    }).finally(() => { try { window.__usersSoftRefreshing = false; } catch(_) {} });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'softRefreshUsersTable');
    try { window.__usersSoftRefreshing = false; } catch(_) {}
  }
}

// Export
window.softRefreshUsersTable = softRefreshUsersTable;

// Soft refresh for Groups table preserving current page and pagination
function softRefreshGroupsTable() {
  try {
    const table = document.querySelector("section[data-testid='groups-section'] #maintable");
    if (!table) return;
    // Read persisted state or current DOM state
    const lsKey = 'tableState:groups';
    const domState = (function() {
      const pager = document.getElementById('groups-pagination');
      const activeLink = pager && pager.querySelector('.page-item.active [data-page]');
      let page = activeLink ? parseInt(activeLink.getAttribute('data-page') || '1', 10) : 0;
      if (!page) {
        const activeItem = pager && pager.querySelector('.page-item.active');
        const txt = activeItem ? (activeItem.textContent || '').trim() : '';
        const num = parseInt(txt, 10);
        page = (isFinite(num) && num > 0) ? num : 1;
      }
      const sizeEl = document.querySelector("section[data-testid='groups-section'] select[name='page_size']");
      const pageSize = sizeEl ? parseInt(sizeEl.value || '10', 10) : 10;
      return { page: page, pageSize: pageSize };
    })();
    const saved = (function(){ try { return JSON.parse(localStorage.getItem(lsKey) || 'null') || {}; } catch(_) { return {}; } })();
    const state = { page: saved.page || domState.page || 1, pageSize: saved.pageSize || domState.pageSize || 10 };
    try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch(_) {}

    const url = new URL(window.location.href);
    const params = new URLSearchParams({ page: String(state.page), page_size: String(state.pageSize), _t: String(Date.now()) });
    fetch(`/groups/page?${params.toString()}`, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    }).then((data) => {
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && data && typeof data.html === 'string') {
        tbody.innerHTML = data.html;
      }
      // Use server-provided pager HTML when available
      try {
        const pager = document.getElementById('groups-pagination');
        if (pager && typeof data.pager_html === 'string' && data.pager_html) {
          pager.innerHTML = data.pager_html;
        } else {
          const total = parseInt(data.total || 0, 10);
          const page = parseInt(data.page || 1, 10);
          const pageSize = parseInt(data.page_size || 10, 10);
          renderPagination('groups-pagination', page, pageSize, total, 'groups');
        }
        try { ensurePagerLinks('groups'); } catch(_) {}
        const stateNow = { page: page, pageSize: pageSize };
        try { localStorage.setItem(lsKey, JSON.stringify(stateNow)); } catch(_) {}
        const newQs = new URLSearchParams(url.search);
        newQs.set('page', String(page)); newQs.set('page_size', String(pageSize));
        try { window.history.replaceState(null, '', `${url.pathname}?${newQs.toString()}`); } catch(_) {}
      } catch(_) {}
      // Reinitialize context menu
      if (window.reinitializeContextMenu) {
        window.reinitializeContextMenu();
      } else {
        const event = new CustomEvent('context-menu-reinit', { detail: { timestamp: Date.now() } });
        document.dispatchEvent(event);
      }
    }).catch((err) => {
      window.ErrorHandler && window.ErrorHandler.handleError(err, 'softRefreshGroupsTable');
    });
  } catch (err) {
    window.ErrorHandler && window.ErrorHandler.handleError(err, 'softRefreshGroupsTable');
  }
}

// Export
window.softRefreshGroupsTable = softRefreshGroupsTable;

// Renders a simple Bootstrap-like pagination into a container
function renderPagination(containerId, page, pageSize, total, scope) {
  try {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize || 1)));
    const cur = Math.min(Math.max(1, page || 1), totalPages);
    const basePath = (scope === 'groups') ? '/groups' : '/users';
    function pageItem(p, label, active, disabled) {
      const href = `${basePath}?page=${p}&page_size=${pageSize}`;
      const aAttrs = disabled ? '' : ` href="${href}" data-page="${p}"`;
      const cls = ["page-item", active ? "active" : "", disabled ? "disabled" : ""].join(' ').trim();
      return `<li class="${cls}"><a class="page-link"${aAttrs}>${label}</a></li>`;
    }
    const parts = [];
    parts.push('<ul class="pagination mb-0">');
    parts.push(pageItem(1, '««', false, cur <= 1));
    parts.push(pageItem(cur - 1, '«', false, cur <= 1));
    const start = Math.max(1, cur - 3);
    const end = Math.min(totalPages, cur + 3);
    for (let p = start; p <= end; p++) parts.push(pageItem(p, String(p), p === cur, false));
    parts.push(pageItem(cur + 1, '»', false, cur >= totalPages));
    parts.push(pageItem(totalPages, '»»', false, cur >= totalPages));
    parts.push('</ul>');
    container.innerHTML = parts.join('');
  } catch(_) {}
}

// Normalize pager links to ensure explicit href with page params
function ensurePagerLinks(scope) {
  try {
    const containerId = (scope === 'groups') ? 'groups-pagination' : 'users-pagination';
    const pager = document.getElementById(containerId);
    if (!pager) return;
    const lsKey = (scope === 'groups') ? 'groups:pageSize' : 'users:pageSize';
    let pageSize = 10;
    try { pageSize = parseInt(localStorage.getItem(lsKey) || '0', 10) || pageSize; } catch(_) {}
    const basePath = (scope === 'groups') ? '/groups' : '/users';
    pager.querySelectorAll('a.page-link').forEach(function(a){
      // Derive page from data-page or text content
      let p = 0;
      try { p = parseInt(a.getAttribute('data-page') || '0', 10) || 0; } catch(_) { p = 0; }
      if (!p) {
        const txt = (a.textContent || '').trim();
        const num = parseInt(txt, 10);
        p = (isFinite(num) && num > 0) ? num : 0;
      }
      if (!p) {
        // For « and » infer from siblings
        const li = a.closest('li.page-item');
        if (li && a.textContent) {
          const isPrev = a.textContent.indexOf('«') !== -1 || a.textContent.indexOf('‹') !== -1;
          const isNext = a.textContent.indexOf('»') !== -1 || a.textContent.indexOf('›') !== -1;
          if (isPrev || isNext) {
            const active = pager.querySelector('.page-item.active a.page-link');
            let cur = 1;
            if (active) {
              const t = (active.textContent || '').trim();
              const n = parseInt(active.getAttribute('data-page') || t, 10);
              cur = (isFinite(n) && n > 0) ? n : 1;
            }
            p = isPrev ? Math.max(1, cur - 1) : (cur + 1);
          }
        }
      }
      if (!p) p = 1;
      a.setAttribute('href', `${basePath}?page=${p}&page_size=${pageSize}`);
      a.setAttribute('data-page', String(p));
    });
  } catch(_) {}
}

// Generic normalizer for arbitrary pagination containers on current page
function ensurePagerLinksForContainer(containerId, lsKey) {
  try {
    const pager = document.getElementById(containerId);
    if (!pager) return;
    const basePath = window.location && window.location.pathname ? window.location.pathname : '';
    let pageSize = 10;
    try { pageSize = parseInt(localStorage.getItem(lsKey) || '0', 10) || pageSize; } catch(_) {}
    pager.querySelectorAll('a.page-link').forEach(function(a){
      let p = 0;
      try { p = parseInt(a.getAttribute('data-page') || '0', 10) || 0; } catch(_) { p = 0; }
      if (!p) {
        const txt = (a.textContent || '').trim();
        const num = parseInt(txt, 10);
        p = (isFinite(num) && num > 0) ? num : 0;
      }
      if (!p) {
        const li = a.closest('li.page-item');
        if (li && a.textContent) {
          const isPrev = a.textContent.indexOf('«') !== -1 || a.textContent.indexOf('‹') !== -1;
          const isNext = a.textContent.indexOf('»') !== -1 || a.textContent.indexOf('›') !== -1;
          if (isPrev || isNext) {
            const active = pager.querySelector('.page-item.active a.page-link');
            let cur = 1;
            if (active) {
              const t = (active.textContent || '').trim();
              const n = parseInt(active.getAttribute('data-page') || t, 10);
              cur = (isFinite(n) && n > 0) ? n : 1;
            }
            p = isPrev ? Math.max(1, cur - 1) : (cur + 1);
          }
        }
      }
      if (!p) p = 1;
      a.setAttribute('href', `${basePath}?page=${p}&page_size=${pageSize}`);
      a.setAttribute('data-page', String(p));
    });
  } catch(_) {}
}

// Global: persist pagination interactions to localStorage for Users and Groups
document.addEventListener('click', function (e) {
  try {
    const a = e.target && e.target.closest && e.target.closest('a[data-page]');
    if (!a) return;
    const page = parseInt(a.getAttribute('data-page') || '1', 10);
    if (document.querySelector("section[data-testid='users-section']") && a.closest('#users-pagination')) {
      const sizeEl = document.querySelector("section[data-testid='users-section'] select[name='page_size']");
      const pageSize = sizeEl ? parseInt(sizeEl.value || '10', 10) : 10;
      try { localStorage.setItem('tableState:users', JSON.stringify({ page: page, pageSize: pageSize })); } catch(_) {}
    }
    if (document.querySelector("section[data-testid='groups-section']") && a.closest('#groups-pagination')) {
      const sizeEl = document.querySelector("section[data-testid='groups-section'] select[name='page_size']");
      const pageSize = sizeEl ? parseInt(sizeEl.value || '10', 10) : 10;
      try { localStorage.setItem('tableState:groups', JSON.stringify({ page: page, pageSize: pageSize })); } catch(_) {}
    }
  } catch(_) {}
}, true);

document.addEventListener('change', function (e) {
  try {
    const sel = e.target && e.target.closest && e.target.closest("select[name='page_size']");
    if (!sel) return;
    const pageSize = parseInt(sel.value || '10', 10);
    if (sel.closest("section[data-testid='users-section']")) {
      try { localStorage.setItem('tableState:users', JSON.stringify({ page: 1, pageSize: pageSize })); } catch(_) {}
      try { localStorage.setItem('users:pageSize', String(pageSize)); } catch(_) {}
      try { ensurePagerLinks('users'); } catch(_) {}
    }
    if (sel.closest("section[data-testid='groups-section']")) {
      try { localStorage.setItem('tableState:groups', JSON.stringify({ page: 1, pageSize: pageSize })); } catch(_) {}
      try { localStorage.setItem('groups:pageSize', String(pageSize)); } catch(_) {}
      try { ensurePagerLinks('groups'); } catch(_) {}
    }
  } catch(_) {}
}, true);

// Global clear search handler used by components/searchbar.html
if (!window.searchClean) {
  window.searchClean = function(btn){
    try {
      try { console.debug('[search][global] searchClean invoked', { pageUsers: !!document.querySelector("section[data-testid='users-section']") }); } catch(_) {}
      var scope = (btn && btn.closest && btn.closest('.searchbar')) || document;
      var input = scope.querySelector ? scope.querySelector('#searchinp') : document.getElementById('searchinp');
      if (input) {
        input.value = '';
        try { console.debug('[search][global] dispatch input/change'); } catch(_) {}
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
        try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
      }
      // Remove persisted search where applicable
      try { localStorage.removeItem('users:search'); } catch(_) {}
      try { localStorage.removeItem('groups:search'); } catch(_) {}
      // Page-specific fallbacks
      if (document.querySelector("section[data-testid='users-section']")) {
        try { console.debug('[search][global] users-section detected; calling usersDoFilter("")'); } catch(_) {}
        try { if (window.usersDoFilter) window.usersDoFilter(''); } catch(_) {}
      }
      if (typeof window.GroupsSearch !== 'undefined' && window.GroupsSearch.filterGroupsTable) {
        try { window.GroupsSearch.filterGroupsTable(''); } catch(_) {}
      }
    } catch(_) {}
    return false;
  };
}

// Ensure top menu links for Categories/Registrators include pagination params
(function ensureTopMenuPagingLinks(){
  try {
    function withParams(url, params){
      try {
        var u = new URL(url, window.location.origin);
        Object.keys(params).forEach(function(k){ if (!u.searchParams.get(k)) u.searchParams.set(k, String(params[k])); });
        return u.pathname + (u.search ? u.search : '');
      } catch(_) {
        return url;
      }
    }
    function rewriteAnchor(anchor, params){
      if (!anchor || !anchor.href) return;
      var newHref = withParams(anchor.href, params);
      if (newHref && anchor.getAttribute('href') !== newHref) {
        anchor.setAttribute('href', newHref);
      }
      if (!anchor.__pagingBound) {
        anchor.__pagingBound = true;
        anchor.addEventListener('click', function(ev){
          try {
            var href = withParams(anchor.href, params);
            if (href !== anchor.href) {
              ev.preventDefault();
              window.location.assign(href);
            }
          } catch(_) {}
        }, { capture: true });
      }
    }
    function apply(){
      // Keep URL minimal: only set sizes (defaults to 10), do not add page indexes
      var defaultsGroups = { page_size_groups: 10 };
      var defaultsUsers = { page_size_users: 10 };
      var defaultsAll = Object.assign({}, defaultsGroups, defaultsUsers);
      var links = document.querySelectorAll('a.topbtn[href]');
      links.forEach(function(a){
        try {
          var href = a.getAttribute('href') || '';
          if (!href) return;
          if (href.includes('/categories')) {
            rewriteAnchor(a, defaultsAll);
          } else if (href.includes('/registrators')) {
            rewriteAnchor(a, defaultsAll);
          }
        } catch(_) {}
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
  } catch(_) {}
})();
