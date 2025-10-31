/**
 * Users Permissions Module
 * Управление правами пользователей
 */

/**
 * Check if legacy permissions string represents full access
 * @param {string} legacy - Legacy permissions string
 * @returns {boolean} True if full access
 */
function isFullAccessLegacy(legacy) {
  const sRaw = String(legacy || "");
  const s = sRaw.replace(/\s+/g, "");
  if (!s) return false;
  if (s.indexOf("z") !== -1) return true;
  if (/полныйдоступ/i.test(sRaw) || /fullaccess/i.test(sRaw)) return true;

  // Accept known full strings
  const fullExact = /^aef,abcdefglmn,abcdflm,ab,ab,ab,abcd$/i;
  if (fullExact.test(s)) return true;

  // Fallback: heuristic across 7 segments
  const parts = s.split(",");
  if (parts.length >= 6) {
    const p1 = parts[0] || ""; // requests
    const p2 = parts[1] || ""; // orders
    const p3 = parts[2] || ""; // files
    const ok1 = /a/.test(p1) && /e/.test(p1) && /f/.test(p1);
    const ok2 = /a/.test(p2) && /b/.test(p2) && /c/.test(p2) && /d/.test(p2) && /e/.test(p2) && /f/.test(p2) && /g/.test(p2) && /l/.test(p2) && /m/.test(p2) && /n/.test(p2);
    const ok3 = /a/.test(p3) && /b/.test(p3) && /c/.test(p3) && /d/.test(p3) && /f/.test(p3) && /l/.test(p3) && /m/.test(p3);
    if (ok1 && ok2 && ok3) return true;
  }
  return false;
}

/**
 * Enforce admin collapse display for full access users
 * @param {Element} scope - DOM scope to search in
 */
function enforceAdminCollapse(scope) {
  const root = scope || document;
  const rows = root.querySelectorAll("#maintable tbody tr.table__body_row");
  if (!rows || !rows.length) return;

  rows.forEach((tr) => {
    const full =
      (tr.getAttribute("data-full-access") || "0") === "1" ||
      isFullAccessLegacy(tr.getAttribute("data-perm"));
    if (!full) return;

    const cell = tr.querySelector("td.perms-cell");
    if (!cell) return;

    const already = cell.querySelector(".perms-cell__cat");
    if (
      !cell.hasAttribute("data-collapsed-admin") ||
      !already ||
      (already && already.textContent !== "Админ")
    ) {
      cell.innerHTML =
        '<div class="perms-cell__item"><span class="perms-cell__cat">Админ</span>: <span class="perms-cell__rights">полный доступ</span></div>';
      cell.setAttribute("data-collapsed-admin", "1");
    }
  });
}

/**
 * Update user permissions via API
 * @param {string} userId - User ID
 * @param {Object} permissions - Permissions object
 */
function updateUserPermissions(userId, permissions) {
  fetch(`/api/users/${userId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        window.showToast("Права пользователя обновлены", "success");
        enforceAdminCollapse();
      } else {
        window.showToast("Ошибка обновления прав", "error");
      }
    })
    .catch((err) =>
      window.ErrorHandler.handleError(err, "updateUserPermissions")
    );
}

// popupValues function moved to popup-utils.js

/**
 * Sync permission form from row data
 * @param {HTMLFormElement} form - Form element
 * @param {string} rowId - Row ID
 */
function syncPermFormFromRow(form, rowId) {
  if (!form || !rowId) return;

  const row = document.getElementById(rowId);
  if (!row) return;

  const login = row.dataset.login || "";
  const name = row.dataset.name || "";
  const group = row.dataset.groupname || "";
  const enabled = row.dataset.enabled === "1";

  // Fill hidden fields
  const loginInput = form.querySelector('input[name="login"]');
  const nameInput = form.querySelector('input[name="name"]');
  const groupInput = form.querySelector('input[name="group"]');
  const enabledInput = form.querySelector('input[name="enabled"]');

  if (loginInput) loginInput.value = login;
  if (nameInput) nameInput.value = name;
  if (groupInput) groupInput.value = group;
  if (enabledInput) enabledInput.value = enabled ? "1" : "0";

  // Update form action URL with user ID
  form.action = form.action.replace("/0", `/${rowId}`);
}

/**
 * Refresh permission UI
 * @param {string} permInputId - Permission input ID
 */
function refreshPermissionUI(permInputId) {
  if (!permInputId) return;

  const permInput = document.getElementById(permInputId);
  if (!permInput) return;

  if (permInput.style.display === "none") {
    permInput.style.display = "block";
  }
  permInput.focus();
}

// Export functions to global scope
window.UsersPermissions = {
  isFullAccessLegacy,
  enforceAdminCollapse,
  updateUserPermissions,
  syncPermFormFromRow,
  refreshPermissionUI,
};

// Also make key functions globally available
// Note: popupValues is now provided by popup-utils.js
window.syncPermFormFromRow = syncPermFormFromRow;
window.refreshPermissionUI = refreshPermissionUI;
