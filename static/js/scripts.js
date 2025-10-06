'use strict';

/**
 * Toggle popup visibility by ID.
 * @param {string} popupId - The ID of the popup to toggle
 */
function popupToggle(popupId) {
  const popup = document.getElementById(popupId);
  if (!popup) return;
  
  if (popup.classList.contains('visible')) {
    // Hide popup
    popup.classList.remove('visible');
    popup.style.display = 'none';
    document.body.style.overflow = ''; // Restore scrolling
    window.popup = null;
    // Stop any media playback inside the popup when hiding via toggle
    try {
      const mediaEls = popup.querySelectorAll('video, audio');
      mediaEls.forEach(function(el){
        try { el.pause && el.pause(); } catch(_) {}
        try { el.currentTime = 0; } catch(_) {}
        try {
          if (el.srcObject) {
            try { el.srcObject.getTracks().forEach(t => { try { t.stop && t.stop(); } catch(_) {} }); } catch(_) {}
            el.srcObject = null;
          }
        } catch(_) {}
        try { el.onerror = null; } catch(_) {}
        try { el.removeAttribute('src'); } catch(_) {}
        // do not set empty src or call load() here to avoid invalid URI logs
      });
    } catch(_) {}
    // Safety net: stop any other media on the page
    try { stopAllMedia(); } catch(_) {}
    try { if (window.__mediaOpenState) window.__mediaOpenState.opening = false; } catch(_) {}
  } else {
    // Show popup
    popup.style.display = 'flex';
    popup.classList.add('visible');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
    window.popup = popupId;
    try { if (!window.__mediaOpenState) window.__mediaOpenState = { opening: false }; else window.__mediaOpenState.opening = false; } catch(_) {}
    
    // Focus first input if available
    setTimeout(() => {
      const firstInput = popup.querySelector('input:not([type="hidden"]), textarea, select');
      if (firstInput) {
        firstInput.focus();
      }
    }, 100);

    // Ensure media is unmuted on open
    try {
      if (popupId === 'popup-audio') {
        const a = document.getElementById('player-audio');
        if (a) { a.muted = false; a.volume = 1; }
      } else if (popupId === 'popup-view') {
        const v = document.getElementById('player-video');
        if (v) { v.muted = false; v.volume = 1; }
      }
    } catch(_) {}
  }
}

// Function to force close popup (does not toggle)
function popupClose(popupId) {
  const popup = document.getElementById(popupId);
  if (!popup) return;
  
  // Force close regardless of current state (.show or .visible)
  popup.classList.remove('visible');
  popup.classList.remove('show');
  popup.style.display = 'none';
  document.body.style.overflow = '';
  window.popup = null;

  // Stop any media playback inside the popup
  try {
    const mediaEls = popup.querySelectorAll('video, audio');
    mediaEls.forEach(function(el){
      try { el.pause && el.pause(); } catch(_) {}
      try { el.currentTime = 0; } catch(_) {}
      try {
        if (el.srcObject) {
          try { el.srcObject.getTracks().forEach(t => { try { t.stop && t.stop(); } catch(_) {} }); } catch(_) {}
          el.srcObject = null;
        }
      } catch(_) {}
      try { el.muted = true; } catch(_) {}
      try { el.volume = 0; } catch(_) {}
      try { el.onerror = null; } catch(_) {}
      try { el.removeAttribute('src'); } catch(_) {}
      // Avoid calling load() when src is empty to prevent spurious URI errors
    });
  } catch(_) {}
  // Safety net: stop any other media on the page
  try { stopAllMedia(); } catch(_) {}
}

// Note: unified close handlers are defined below (to avoid duplicates)

// Stop all media in the document (audio/video), including live streams
function stopAllMedia() {
  try {
    const nodes = document.querySelectorAll('video, audio');
    nodes.forEach(function(el){
      try { el.pause && el.pause(); } catch(_) {}
      try { el.currentTime = 0; } catch(_) {}
      try {
        if (el.srcObject) {
          try { el.srcObject.getTracks().forEach(t => { try { t.stop && t.stop(); } catch(_) {} }); } catch(_) {}
          el.srcObject = null;
        }
      } catch(_) {}
      try { el.muted = true; } catch(_) {}
      try { el.volume = 0; } catch(_) {}
      try { el.onerror = null; } catch(_) {}
      try { el.removeAttribute('src'); } catch(_) {}
      // Avoid calling load() when src is empty to prevent spurious URI errors
    });
  } catch(_) {}
}

// Global Enter to submit currently open overlay popup (not textarea)
document.addEventListener('keydown', function(e){
  try {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const tgt = e.target; if (tgt && tgt.tagName === 'TEXTAREA') return;
    const overlay = document.querySelector('.overlay-container.show, .overlay-container.visible');
    if (!overlay) return;
    // Prefer explicit default button if marked
    let defBtn = overlay.querySelector('[data-enter="default"]');
    if (!defBtn) defBtn = overlay.querySelector('.popup__actions .btn-primary');
    if (!defBtn) return;
    e.preventDefault();
    defBtn.click();
  } catch(_) {}
}, true);

/**
 * Common form validation functions
 */
window.CommonValidation = {
  /**
   * Validate that a field is not empty after trimming
   * @param {HTMLInputElement|HTMLTextAreaElement} field
   * @param {string} fieldName
   * @returns {boolean}
   */
  validateRequired: function(field, fieldName) {
    if (!field || !field.value || field.value.trim() === '') {
      alert(`${fieldName} не может быть пустым`);
      if (field && field.focus) field.focus();
      return false;
    }
    return true;
  },

  /**
   * Validate password length
   * @param {HTMLInputElement} passwordField
   * @param {number} minLength
   * @returns {boolean}
   */
  validatePasswordLength: function(passwordField, minLength) {
    if (!passwordField || !passwordField.value) {
      alert('Пароль не может быть пустым');
      if (passwordField && passwordField.focus) passwordField.focus();
      return false;
    }
    if (passwordField.value.length < minLength) {
      alert(`Пароль должен быть не менее ${minLength} символов`);
      if (passwordField.focus) passwordField.focus();
      return false;
    }
    return true;
  },

  /**
   * Validate password confirmation
   * @param {HTMLInputElement} passwordField
   * @param {HTMLInputElement} confirmField
   * @returns {boolean}
   */
  validatePasswordMatch: function(passwordField, confirmField) {
    if (!passwordField || !confirmField) return true;
    if (passwordField.value !== confirmField.value) {
      alert('Пароли не совпадают');
      if (confirmField.focus) confirmField.focus();
      return false;
    }
    return true;
  },

  /**
   * Trim all text inputs in a form
   * @param {HTMLFormElement} form
   */
  trimFormFields: function(form) {
    if (!form) return;
    const textFields = form.querySelectorAll('input[type="text"], input[type="password"], textarea');
    textFields.forEach(field => {
      if (field.value) {
        field.value = field.value.trim();
      }
    });
  }
};

/**
 * Common AJAX form submission with error handling
 * @param {HTMLFormElement} form
 * @param {Object} options
 * @param {function} options.onSuccess - Called when request succeeds
 * @param {function} options.onError - Called when request fails
 * @param {function} options.beforeSend - Called before sending request
 * @param {function} options.afterSend - Called after request completes
 */
window.CommonAjax = {
  submitForm: function(form, options = {}) {
    if (!form || !form.action) {
      console.error('Invalid form or missing action');
      return;
    }

    // Trim form fields
    window.CommonValidation.trimFormFields(form);

    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent || submitBtn.value : '';

    // Before send callback
    if (options.beforeSend) {
      options.beforeSend(form, submitBtn);
    } else {
      // Default: disable submit button
      if (submitBtn) {
        submitBtn.disabled = true;
        if (submitBtn.textContent !== undefined) {
          submitBtn.textContent = 'Отправка...';
        } else if (submitBtn.value !== undefined) {
          submitBtn.value = 'Отправка...';
        }
      }
    }

    fetch(form.action, {
      method: form.method || 'POST',
      body: formData,
      credentials: 'include'
    })
    .then(response => {
      if (response.ok) {
        if (options.onSuccess) {
          options.onSuccess(response, form);
        } else {
          // Default success: close modal without page reload
          const modal = form.closest('.overlay-container, .popup, .modal');
          if (modal) {
            const modalId = modal.id;
            try { popupToggle(modalId); } catch(e) {}
          }
          // No default page reload - let individual handlers decide
        }
      } else {
        response.text().then(text => {
          const errorMsg = text || 'Неизвестная ошибка';
          if (options.onError) {
            options.onError(errorMsg, response, form);
          } else {
            alert('Ошибка: ' + errorMsg);
          }
        });
      }
    })
    .catch(error => {
      console.error('AJAX Error:', error);
      const errorMsg = 'Ошибка при отправке данных';
      if (options.onError) {
        options.onError(errorMsg, null, form);
      } else {
        alert(errorMsg);
      }
    })
    .finally(() => {
      // After send callback
      if (options.afterSend) {
        options.afterSend(form, submitBtn, originalText);
      } else {
        // Default: re-enable submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtn.textContent !== undefined) {
            submitBtn.textContent = originalText;
          } else if (submitBtn.value !== undefined) {
            submitBtn.value = originalText;
          }
        }
      }
    });
  }
};

/**
 * Global popup keyboard helpers: Esc closes, Enter submits active modal.
 * Guarded to avoid unintended submits from textareas.
 */
function popupKeys() {
  let x = document.getElementsByTagName('form');
  let target;
  /*for(let i = 0; i < x.length; i++) {
    target = x[i].parentElement.parentElement;
    target.addEventListener("click", function(event) {
      if (popup == event.target.id) {
        event.preventDefault();
        popupToggle(popup);
      }
    })
  };*/
  /*document.addEventListener("keypress", function(event) {
    if (popup && event.key == "Enter") {
      if (event.target.tagName.toUpperCase() == "TEXTAREA") return;
      event.preventDefault();
      document.querySelectorAll('[type="submit"]')[0].click();
      //validateForm(event.target.parentElement.parentElement);
    }
  });*/
  document.addEventListener('keydown', function (event) {
    if (popup && event.key == 'Escape') {
      event.preventDefault();
      popupToggle(popup);
    }
  });
}

/*function tableListener() {
  let table = document.getElementById('maintable');
  if (table != null) {
    let search = document.getElementById('searchinp');
    search.addEventListener('input', function (event) {
      filterTable(table, search.value);
    });
    Array.from(table.getElementsByTagName('th')).forEach((th) => {
      th.addEventListener('click', function (event) {
        sortTable(table, event.target);
      });
    });
  }
}*/

/**
 * Append current username to logout link in top navigation.
 * @param {string} name
 */
function displayName(name) {
  let target = document.getElementById('nav').getElementsByTagName('a');
  for (let i = target.length - 1; i >= 0; i--) {
    if (target[i].href.endsWith('logout')) {
      target[i].firstChild.data += ' (' + name + ')';
    }
  }
}

/**
 * Toggle a modal overlay by id. Supports guarded closing of recorder popup.
 * Resets and prepares form state and upload progress on open/close.
 * @param {string} x overlay id
 * @param {number} [id=0] optional entity id for form hydration
 */
function popupToggle(x, id = 0) {
  const overlay = document.getElementById(x);
  // Intercept recorder popup close attempts
  if (x === 'popup-rec' && overlay && (overlay.classList.contains('show') || overlay.classList.contains('visible'))) {
    // about to close; ask iframe for state
    try {
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        window.__recCloseRequested = true;
        // Clear any previous timer
        try { if (window.__recStateTimer) { clearTimeout(window.__recStateTimer); window.__recStateTimer = null; } } catch(_) {}
        iframe.contentWindow.postMessage({ type: 'rec:state?' }, '*');
        // Fallback: if iframe doesn't respond in time, show confirm dialog conservatively
        window.__recStateTimer = setTimeout(function() {
          try { window.__recCloseRequested = false; } catch(_) {}
          try { showRecConfirmDialog(); } catch(_) {}
          try { window.__recStateTimer = null; } catch(_) {}
        }, 300);
        // actual close will be decided in message handler below
        return;
      }
    } catch(e) {}
  }
  const form = overlay ? overlay.querySelector('form') : null;
  const isOpen = overlay && overlay.classList.contains('show');
  if (!isOpen) {
    // Opening
    if (form) {
      try { form.reset(); } catch(e) {}
      try { popupValues(form, id); } catch(e) {}
    }
    // Ensure recorder iframe loads fresh content on open (bypass cache)
    if (x === 'popup-rec') {
      try {
        const iframe = document.getElementById('rec-iframe');
        if (iframe) {
          let ds = iframe.getAttribute('data-src');
          // Fallback if data-src missing
          if (!ds || ds === 'about:blank') {
            try {
              const parts = (location.pathname || '/').split('/');
              const did = (window.currentDid != null) ? window.currentDid : (parseInt(parts[2]||'0',10)||0);
              const sdid = (window.currentSdid != null) ? window.currentSdid : (parseInt(parts[3]||'1',10)||1);
              ds = `/files/rec/${did}/${sdid}?embed=1`;
            } catch(_) { ds = '/files/rec/0/1?embed=1'; }
          }
          let urlStr = ds;
          try {
            const u = new URL(ds, window.location.origin);
            const theme = (function(){
              try {
                return document.documentElement.getAttribute('data-theme')
                  || (document.body && document.body.getAttribute('data-theme'))
                  || localStorage.getItem('selectedTheme')
                  || localStorage.getItem('theme')
                  || 'light';
              } catch(_) { return 'light'; }
            })();
            if (!u.searchParams.has('embed')) u.searchParams.set('embed', '1');
            if (!u.searchParams.has('theme')) u.searchParams.set('theme', theme);
            u.searchParams.set('t', String(Date.now()));
            urlStr = u.toString();
          } catch(_) {}
          iframe.src = urlStr;
          // Retry setting src if the browser didn't kick off a request yet
          try {
            let attempts = 0;
            const ensureSrc = function(){
              try {
                if (!iframe.src || iframe.src === 'about:blank') {
                  attempts++;
                  iframe.src = urlStr;
                  if (attempts < 5) setTimeout(ensureSrc, 50);
                }
              } catch(_) {}
            };
            setTimeout(ensureSrc, 0);
          } catch(_) {}
        }
      } catch(_) {}
    }
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    overlay.classList.add('visible');
    try { if (!window.__mediaOpenState) { window.__mediaOpenState = { opening: false }; } else { window.__mediaOpenState.opening = false; } } catch(_) {}
    
    // Restore z-index for modal and overlay
    overlay.style.zIndex = '1050';
    overlay.style.pointerEvents = 'auto';
    
    // Also restore popup inside overlay
    const popupElement = overlay.querySelector('.popup');
    if (popupElement) {
      popupElement.style.zIndex = '1050';
      popupElement.style.pointerEvents = 'auto';
    }
    
    popup = x;
  } else {
    // Closing
    overlay.classList.remove('show');
    overlay.classList.remove('visible');
    overlay.style.display = 'none';
    try { if (window.__mediaOpenState) { window.__mediaOpenState.opening = false; } } catch(_) {}
    // Aggressively tear down recorder iframe to avoid background activity
    if (x === 'popup-rec') {
      try {
        const iframe = document.getElementById('rec-iframe');
        if (iframe) {
          // clear src to abort any loads, then reset to blank
          iframe.src = 'about:blank';
          // also post a stop message to be safe
          try { iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'rec:stop-all' }, '*'); } catch(_) {}
        }
      } catch(_) {}
    }
    popup = null;
  }
  
  // Reset user typing flag when opening add popup
  if (x === 'popup-add') {
    const nameInput = document.getElementById("add-name");
    if (nameInput) {
      nameInput.userHasTyped = false;
    }
    
    // Reset upload progress
    const progressDiv = document.getElementById('upload-progress');
    const submitBtn = document.getElementById('add-submit-btn');
    const cancelBtn = document.getElementById('add-cancel-btn');
    
    if (progressDiv) {
      progressDiv.classList.add('d-none');
      const progressBar = progressDiv.querySelector('.progress-bar');
      const statusText = progressDiv.querySelector('.upload-status small');
      
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', 0);
      }
      
      if (statusText) {
        statusText.textContent = 'Загрузка файла...';
        statusText.style.color = '';
      }
    }
    
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Отмена';
      cancelBtn.onclick = function() {
        popupToggle('popup-add');
      };
    }
    
    // Clear any ongoing upload
    if (window.currentUploadXHR) {
      window.currentUploadXHR.abort();
      window.currentUploadXHR = null;
    }
  }
}

// Recorder close control via postMessage
window.addEventListener('message', function(ev) {
  const data = ev.data || {};
  if (!data || typeof data !== 'object') return;
  if (data.type === 'rec:state' && window.__recCloseRequested) {
    window.__recCloseRequested = false;
    try { if (window.__recStateTimer) { clearTimeout(window.__recStateTimer); window.__recStateTimer = null; } } catch(_) {}
    const st = data.state || {};
    const isRecording = !!st.recording;
    const isPaused = !!st.paused;
    const hasData = !!st.hasData;
    if (isRecording) {
      // do not allow close while recording
      alert('Остановите запись перед закрытием окна.');
      return;
    }
    if (!window.__recSaving && (hasData || isPaused)) {
      // show confirm modal with Yes/No/Cancel
      showRecConfirmDialog();
      return;
    }
    // Safe to close: instruct iframe to cleanup then hide modal
    try {
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'rec:close' }, '*');
      }
    } catch(_) {}
    const overlay = document.getElementById('popup-rec');
    if (overlay) {
      overlay.classList.remove('show');
      overlay.classList.remove('visible');
      overlay.style.display = 'none';
    }
    popup = null;
    try { if (window.modalManager && window.modalManager.activeModal === 'popup-rec') { window.modalManager.activeModal = null; } } catch(_) {}
  } else if (data.type === 'rec:discarded') {
    // after discard in iframe, close popup
    const overlay = document.getElementById('popup-rec');
    if (overlay) overlay.classList.remove('show');
    popup = null;
    window.__recSaving = false;
  } else if (data.type === 'rec:saved') {
    window.__recSaving = false;
    try { window.softRefreshFilesTable && window.softRefreshFilesTable(); } catch(e) {}
  }
});

/**
 * Show a confirmation dialog to save/discard recorder data on close.
 */
function showRecConfirmDialog() {
  let box = document.getElementById('rec-confirm');
  if (!box) {
    box = document.createElement('div');
    box.id = 'rec-confirm';
    box.className = 'overlay-container show';
    box.innerHTML = '\
      <div class="popup">\
        <h1 class="popup__title">Сохранить запись?</h1>\
        <div class="popup__actions">\
          <button type="button" class="btn btn-primary" id="rec-confirm-yes">Да</button>\
          <button type="button" class="btn btn-danger" id="rec-confirm-no">Нет</button>\
          <button type="button" class="btn btn-secondary" id="rec-confirm-cancel">Отмена</button>\
        </div>\
      </div>';
    document.body.appendChild(box);
    document.getElementById('rec-confirm-yes').onclick = function() {
      window.__recSaving = true;
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'rec:save' }, '*');
      }
      box.classList.remove('show');
      setTimeout(() => box.remove(), 150);
    };
    document.getElementById('rec-confirm-no').onclick = function() {
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'rec:discard' }, '*');
      }
      box.classList.remove('show');
      setTimeout(() => box.remove(), 150);
    };
    document.getElementById('rec-confirm-cancel').onclick = function() {
      box.classList.remove('show');
      setTimeout(() => box.remove(), 150);
    };
  } else {
    box.classList.add('show');
  }
}

/**
 * Ensure input has non-empty trimmed value if element exists.
 * @param {HTMLInputElement} x
 * @returns {boolean}
 */
function trimIfExists(x) {
  if (x != null) {
    if (x.value == null || x.value.trim() == '') {
      return false;
    }
  }
  return true;
}

/*function searchClean() {
  document.getElementById('searchinp').value = '';
  filterTable(document.getElementById('maintable'), '');
}*/

/*function sortTable(table, th) {
  const getCellValue = (tr, idx) =>
    tr.children[idx] != null
      ? tr.children[idx].innerText || tr.children[idx].textContent
      : '';
  table.dataset.asc = !(table.dataset.asc === 'true');
  const comparer = (idx, asc) => (a, b) =>
    ((v1, v2) =>
      (v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2)) ||
      (/^\d+$/.test(v1) && /^\d+$/.test(value))
        ? v1 - v2
        : v1.toString().localeCompare(v2))(
      getCellValue(asc ? a : b, idx),
      getCellValue(asc ? b : a, idx)
    );
  Array.from(table.querySelectorAll('tr:nth-child(n+2)'))
    .slice(0)
    .sort(
      comparer(
        Array.from(th.parentNode.children).indexOf(th),
        table.dataset.asc === 'true'
      )
    )
    .forEach((tr) => table.appendChild(tr));
}

function filterTable(table, filter) {
  let tbody = table.getElementsByTagName('tbody')[0];
  filter = filter.toUpperCase();
  Array.from(tbody.children)
    .slice(1, tbody.children.length)
    .forEach((row) => {
      let res = false;
      Array.from(row.children).forEach((cell) => {
        if (cell.innerText.toUpperCase().includes(filter)) {
          res = true;
        }
      });
      if (res) {
        row.style.display = 'table-row';
      } else {
        row.style.display = 'none';
      }
    });
}*/

/** @type {string|null} id of the currently open popup overlay */
var popup = null;
/*$(document).ready(function () {
  popupKeys();
  tableListener();
});*/

/** Demo notification to verify browser permissions */
function notifyTest() {
  if (!('Notification' in window)) {
    alert('Уведомления не поддерживаются!');
  } else if (Notification.permission === 'granted') {
    const notification = new Notification('Провер04ka', {
      body: 'Test\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest// NOTE: Test\n',
      icon: '/static/icons/notification_menu.png',
      requireInteraction: true,
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        const notification = new Notification('Hi there!');
      }
    });
  }
}

// Global keyboard shortcuts for modals
document.addEventListener('keydown', function (event) {
  if (!popup) return;
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
  // Enter to submit current modal (skip inside textarea)
  if (event.key === 'Enter' && !isTyping) {
    event.preventDefault();
    if (popup === 'popup-rec') {
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        try { iframe.contentWindow.postMessage({ type: 'rec:save' }, '*'); } catch(e) {}
      }
      return;
    }
    const overlay = document.getElementById(popup);
    if (!overlay) return;
    // Prefer form submit button
    const form = overlay.querySelector('form');
    const submitBtn = overlay.querySelector('.popup__actions .btn.btn-primary, .popup__actions [type="submit"]');
    if (submitBtn) { try { submitBtn.click(); } catch(e) {} return; }
    // No fallback to form.submit() - all forms should have proper button handlers
  }
  // Esc to close modal with existing guards
  if (event.key === 'Escape') {
    try { event.preventDefault(); event.stopPropagation(); } catch(_) {}
    // Guarded behavior for recorder: do not close while recording; no fallback confirm on ESC
    if (popup === 'popup-rec') {
      try {
        const overlay = document.getElementById('popup-rec');
        if (overlay && (overlay.classList.contains('show') || overlay.classList.contains('visible'))) {
          const iframe = document.getElementById('rec-iframe');
          if (iframe && iframe.contentWindow) {
            window.__recCloseRequested = true;
            try { if (window.__recStateTimer) { clearTimeout(window.__recStateTimer); window.__recStateTimer = null; } } catch(_) {}
            iframe.contentWindow.postMessage({ type: 'rec:state?' }, '*');
            // Do not auto-confirm via fallback on ESC; if no response, just ignore
            window.__recStateTimer = setTimeout(function() {
              try { window.__recCloseRequested = false; } catch(_) {}
              try { window.__recStateTimer = null; } catch(_) {}
            }, 300);
            return;
          }
        }
      } catch(_) {}
    }
    try { popupClose(popup); } catch(e) {}
  }
}, true);

// Space to toggle play/pause when media modals are open
document.addEventListener('keydown', function (event) {
  try {
    if (!popup) return;
    // Allow Space even when focus is outside players but not while typing
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (event.code !== 'Space' && event.key !== ' ') return;
    // Prevent background page handlers and scrolling
    try { event.preventDefault(); event.stopPropagation(); } catch(_) {}
    if (popup === 'popup-audio') {
      const a = document.getElementById('player-audio');
      if (a) {
        if (a.paused) { try { a.play(); } catch(_) {} } else { try { a.pause(); } catch(_) {} }
      }
    } else if (popup === 'popup-view') {
      const v = document.getElementById('player-video');
      if (v) {
        if (v.paused) { try { v.play(); } catch(_) {} } else { try { v.pause(); } catch(_) {} }
      }
    }
  } catch(_) {}
}, true);

// Click outside to close any open modal (unified)
document.addEventListener('click', function (e) {
  try {
    const overlay = e.target.closest('.overlay-container');
    if (!overlay) return;
    if (e.target === overlay && (overlay.classList.contains('show') || overlay.classList.contains('visible'))) {
      const id = overlay.id;
      if (!id) return;
      if (id === 'popup-rec') {
        try {
          const iframe = document.getElementById('rec-iframe');
          if (iframe && iframe.contentWindow) {
            window.__recCloseRequested = true;
            try { if (window.__recStateTimer) { clearTimeout(window.__recStateTimer); window.__recStateTimer = null; } } catch(_) {}
            iframe.contentWindow.postMessage({ type: 'rec:state?' }, '*');
            window.__recStateTimer = setTimeout(function() {
              try { window.__recCloseRequested = false; } catch(_) {}
              try { window.__recStateTimer = null; } catch(_) {}
            }, 300);
            return;
          }
        } catch(_) {}
      }
      try { popupClose(id); } catch(err) { overlay.classList.remove('show'); }
      try { stopAllMedia(); } catch(_) {}
    }
  } catch (_) {}
}, true);

// Ensure recorder iframe src is set when modal becomes visible (observer)
(function observeRecorder(){
  try {
    const overlay = document.getElementById('popup-rec');
    if (!overlay || overlay._observerBound) return;
    overlay._observerBound = true;
    const ensure = function(){
      try {
        const iframe = document.getElementById('rec-iframe');
        if (!iframe) return;
        if (iframe.src && iframe.src !== 'about:blank') return;
        let ds = iframe.getAttribute('data-src');
        if (!ds || ds === 'about:blank') {
          try {
            const parts = (location.pathname || '/').split('/');
            const did = (window.currentDid != null) ? window.currentDid : (parseInt(parts[2]||'0',10)||0);
            const sdid = (window.currentSdid != null) ? window.currentSdid : (parseInt(parts[3]||'1',10)||1);
            ds = `/files/rec/${did}/${sdid}?embed=1`;
          } catch(_) { ds = '/files/rec/0/1?embed=1'; }
        }
        try {
          const u = new URL(ds, window.location.origin);
          if (!u.searchParams.has('embed')) u.searchParams.set('embed', '1');
          u.searchParams.set('t', String(Date.now()));
          iframe.src = u.toString();
        } catch(_) { iframe.src = ds + (ds.includes('?') ? '&' : '?') + 't=' + Date.now(); }
      } catch(_) {}
    };
    const mo = new MutationObserver(function(){
      try {
        const vis = overlay.classList.contains('show') || overlay.classList.contains('visible') || overlay.style.display === 'flex';
        if (vis) setTimeout(ensure, 0);
      } catch(_) {}
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class','style'] });
  } catch(_) {}
})();

// Stop all media when tab becomes hidden (safety)
document.addEventListener('visibilitychange', function(){
  try {
    if (document.hidden) {
      if (typeof stopAllMedia === 'function') stopAllMedia();
    }
  } catch(_) {}
});
