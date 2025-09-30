'use strict';

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
  if (x === 'popup-rec' && overlay && overlay.classList.contains('show')) {
    // about to close; ask iframe for state
    try {
      const iframe = document.getElementById('rec-iframe');
      if (iframe && iframe.contentWindow) {
        window.__recCloseRequested = true;
        iframe.contentWindow.postMessage({ type: 'rec:state?' }, '*');
        // actual close will be decided in message handler below
        return;
      }
    } catch(e) {}
  }
  const form = overlay ? overlay.querySelector('form') : null;
  if (form) {
    try { form.reset(); } catch(e) {}
    if (!popup) {
      try { popupValues(form, id); } catch(e) {}
    }
  }
  overlay.classList.toggle('show');
  popup = overlay.classList.contains('show') ? x : null;
  
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
    // Safe to close
    const overlay = document.getElementById('popup-rec');
    if (overlay) overlay.classList.remove('show');
    popup = null;
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
  const isTextarea = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
  // Enter to submit current modal (skip inside textarea)
  if (event.key === 'Enter' && !isTextarea) {
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
    if (form) { try { form.submit(); } catch(e) {} return; }
  }
  // Esc to close modal with existing guards
  if (event.key === 'Escape') {
    event.preventDefault();
    try { popupToggle(popup); } catch(e) {}
  }
});

// Click outside to close any open modal
document.addEventListener('click', function (e) {
  try {
    const overlay = e.target.closest('.overlay-container');
    if (!overlay) return;
    // Only when clicking directly on the overlay background, not inside the popup
    if (e.target === overlay && overlay.classList.contains('show')) {
      const id = overlay.id;
      if (!id) return;
      try { popupToggle(id); } catch(err) { overlay.classList.remove('show'); }
    }
  } catch (_) {}
}, true);
