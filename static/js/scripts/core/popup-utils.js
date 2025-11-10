/**
 * Popup Utilities Module
 * Common functions for popup operations across the application
 */

/**
 * Populate form fields with values from a table row
 * @param {HTMLFormElement} form - Form element
 * @param {string} rowId - Row ID
 */
function popupValues(form, rowId) {
  if (!form || !rowId) return;

  const row = document.getElementById(rowId);
  if (!row) return;

  // Get all form inputs
  const inputs = form.querySelectorAll("input, select, textarea");

  inputs.forEach((input) => {
    const name = input.name;
    if (!name) return;

    // Try to find corresponding data attribute in the row
    let dataValue = row.getAttribute(`data-${name}`);
    // Special handling: group select expects numeric gid, while row stores data-gid and data-groupname
    if (dataValue === null && name === 'group') {
      const gid = row.getAttribute('data-gid');
      if (gid !== null && input.tagName === 'SELECT') {
        try {
          input.value = String(gid);
          return;
        } catch(_) {}
      }
    }
    if (dataValue !== null) {
      if (input.type === "checkbox") {
        input.checked = dataValue === "true" || dataValue === "1";
      } else {
        // Remove [Регистратор - XXX] marker from description for editing (robust spacing)
        if (name === "description" && typeof dataValue === 'string') {
          try { dataValue = dataValue.replace(/\s*\[Регистратор\s*-\s*[^\]]+\]\s*/g, ""); } catch(_) {}
        }
        input.value = dataValue;
      }
    }
  });


  // Update form action URL with row ID (robust: update existing id or 0)
  if (form.action) {
    try {
      // Generic: replace trailing /0 with /<id>
      if (form.action.includes('/0')) {
        const before = form.action;
        form.action = form.action.replace('/0', `/${rowId}`);
        try { if (form.id === 'perm') console.debug('[users:perm] popupValues:action-replace-0', { before, after: form.action, rowId }); } catch(_) {}
      } else {
        // Specific handlers: replace existing numeric id in path
        // files
        form.action = form.action.replace(/(\/files\/(?:delete|edit|move|note)\/)\d+/, `$1${rowId}`);
        // orders
        form.action = form.action.replace(/(\/orders\/(?:delete|note)\/)\d+/, `$1${rowId}`);
        // users
        form.action = form.action.replace(/(\/users\/(?:edit|reset|delete|toggle)\/)\d+/, `$1${rowId}`);
        // groups
        form.action = form.action.replace(/(\/groups\/(?:edit|delete)\/)\d+/, `$1${rowId}`);
        // fallback: if still unchanged and ends with numeric id, swap it
        const before2 = form.action;
        form.action = form.action.replace(/\/(\d+)(?=$|\D)/, `/${rowId}`);
        try { if (form.id === 'perm') console.debug('[users:perm] popupValues:action-replace-path', { before: before2, after: form.action, rowId }); } catch(_) {}
      }
    } catch(_) {}
  }

  // Reset submission state to allow repeated submits after first success
  try {
    if (form && form._submitting) {
      form._submitting = false;
    }
    const btns = form.querySelectorAll('button, [type="submit"]');
    btns.forEach(function(b){
      try { b.disabled = false; } catch(_) {}
      try { if (b.dataset && b.dataset.processing) delete b.dataset.processing; } catch(_) {}
    });
  } catch(_) {}

  // Persist current page for Users before opening any Users modal
  try {
    const isUsersAction = /\/users\/(?:edit|delete|reset)/.test(form.action) || form.id === 'perm';
    if (isUsersAction) {
      let curPage = 1;
      // Prefer URL param
      try {
        const u = new URL(window.location.href);
        curPage = parseInt(u.searchParams.get('page') || '0', 10) || 0;
      } catch(_) {}
      // Fallback: active pagination item with data-page
      if (!curPage) {
        const pager = document.getElementById('users-pagination');
        const activeLink = pager && pager.querySelector('.page-item.active [data-page]');
        if (activeLink) curPage = parseInt(activeLink.getAttribute('data-page') || '0', 10) || 0;
      }
      // Fallback: text content of active page item
      if (!curPage) {
        const pager = document.getElementById('users-pagination');
        const activeItem = pager && pager.querySelector('.page-item.active');
        const txt = activeItem ? (activeItem.textContent || '').trim() : '';
        const num = parseInt(txt, 10);
        if (isFinite(num) && num > 0) curPage = num;
      }
      if (!curPage) curPage = 1;
      try { localStorage.setItem('users:lastPage', String(curPage)); } catch(_) {}

      // Also bake current page into the form.action query string (server-aware)
      try {
        const a = new URL(form.action, window.location.origin);
        a.searchParams.set('page', String(curPage));
        // Page size: try to read from URL, else from localStorage, else default 10
        let ps = 0;
        try { ps = parseInt((new URL(window.location.href)).searchParams.get('page_size')||'0',10)||0; } catch(_) {}
        if (!ps) { try { ps = parseInt(localStorage.getItem('users:pageSize')||'0',10)||0; } catch(_) {}
        }
        if (!ps) ps = 10;
        a.searchParams.set('page_size', String(ps));
        const before = form.action;
        form.action = a.toString();
        try { console.debug('[users:perm] popupValues:action-final', { before, after: form.action, curPage, pageSize: ps }); } catch(_) {}
      } catch(_) {}
    }
  } catch(_) {}

  // Special handling for delete modal - update file name
  if (form.id === "delete") {
    const fileNameElement = document.getElementById("delete-file-name");
    if (fileNameElement) {
      const fileName =
        row.getAttribute("data-name") ||
        row.getAttribute("data-file-name") ||
        "неизвестный";
      fileNameElement.textContent = fileName;
    }
    
    // Find the modal popup container
    const modal = form.closest(".overlay-container");
    if (modal) {
      // Find the bold element with placeholder text in the modal body
      const nameElement = modal.querySelector(".popup__body p b");
      if (nameElement) {
        // Determine modal type by checking the modal ID or title
        const modalId = modal.id;
        const modalTitle = modal.querySelector(".popup__title");
        const titleText = modalTitle ? modalTitle.textContent.trim() : "";
        
        // Handle users delete modal
        if (modalId === "popup-delete" && titleText.includes("пользователя")) {
          const userName = row.getAttribute("data-name") || "";
          const userLogin = row.getAttribute("data-login") || "";
          if (userName && userLogin) {
            nameElement.textContent = `${userLogin} (${userName})`;
          } else {
            nameElement.textContent = userLogin || userName || "неизвестный";
          }
        }
        
        // Handle groups delete modal
        else if (modalId === "popup-delete" && titleText.includes("группу")) {
          const groupName = row.getAttribute("data-name") || "неизвестная";
          nameElement.textContent = groupName;
        }
        
        // Handle requests delete modal (placeholder is "rname")
        else if (modalId === "popup-delete" && titleText.includes("заявку")) {
          const requestName = row.getAttribute("data-name") || "неизвестный";
          nameElement.textContent = requestName;
        }
        
        // Handle orders delete modal (placeholder is "ordname")
        else if (modalId === "popup-delete" && titleText.includes("заказ")) {
          const orderName = row.getAttribute("data-name") || "неизвестный";
          nameElement.textContent = orderName;
        }
        
        // Fallback: try to detect by placeholder text (for backward compatibility)
        else {
          const placeholder = nameElement.textContent.trim();
          
          if (placeholder === "uname") {
            const userName = row.getAttribute("data-name") || "";
            const userLogin = row.getAttribute("data-login") || "";
            if (userName && userLogin) {
              nameElement.textContent = `${userLogin} (${userName})`;
            } else {
              nameElement.textContent = userLogin || userName || "неизвестный";
            }
          } else if (placeholder === "gname") {
            const groupName = row.getAttribute("data-name") || "неизвестная";
            nameElement.textContent = groupName;
          } else if (placeholder === "rname") {
            const requestName = row.getAttribute("data-name") || "неизвестный";
            nameElement.textContent = requestName;
          } else if (placeholder === "ordname") {
            const orderName = row.getAttribute("data-name") || "неизвестный";
            nameElement.textContent = orderName;
          }
        }
      }
    }
  }
}

/**
 * Toggle popup modal with optional row ID
 * @param {string} popupId - Popup element ID
 * @param {string} rowId - Row ID (optional)
 */
function popupToggle(popupId, rowId) {
  try {
    if (window.openModal) {
      window.openModal(popupId, rowId);
    } else if (window.modalManager && window.modalManager.openModal) {
      window.modalManager.openModal(popupId);
    } else {
      // Fallback to direct modal manipulation
      const popupElement = document.getElementById(popupId);
      if (!popupElement) {
        return;
      }

      // Show modal
      popupElement.style.display = "block";
      popupElement.classList.add("active");

      // Add backdrop
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.id = `${popupId}-backdrop`;
      document.body.appendChild(backdrop);
    }
    // After opening, run any popup-specific initializers
    try {
      if (popupId === 'popup-move' && window.FilesMoveHandler) {
        if (typeof window.FilesMoveHandler.setupMoveModal === 'function') {
          window.FilesMoveHandler.setupMoveModal();
        }
        if (typeof window.FilesMoveHandler.setupMovePopupValues === 'function') {
          window.FilesMoveHandler.setupMovePopupValues();
        }
      }
    } catch(_) {}
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in popupToggle:", error, "app");
  }
}

// Export functions to global scope
window.popupValues = popupValues;
window.popupToggle = popupToggle;

// Also export as module if using ES6 modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    popupValues,
    popupToggle,
  };
}
