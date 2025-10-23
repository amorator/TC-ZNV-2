// Users Permissions Module
// Управление правами пользователей

function isFullAccessLegacy(legacy) {
  try {
    const sRaw = String(legacy || "");
    const s = sRaw.replace(/\s+/g, "");
    if (!s) return false;
    if (s.indexOf("z") !== -1) return true;
    if (/полныйдоступ/i.test(sRaw) || /fullaccess/i.test(sRaw)) return true;

    // Accept known full strings and minor variants with empty segments
    const fullPattern = /^aef,a,[a-z]*abcdflm[a-z]*,ab,ab,(ab|),abcd?$/i;
    if (fullPattern.test(s)) return true;

    // Fallback: heuristic across 7 segments
    const parts = s.split(",");
    if (parts.length >= 6) {
      const p1 = parts[0] || ""; // page 1
      const p2 = parts[1] || ""; // page 2
      const p3 = parts[2] || ""; // page 3 (Files)
      const ok1 = /a/.test(p1) && /e/.test(p1) && /f/.test(p1);
      const ok2 = p2 === "a";
      const ok3 =
        /a/.test(p3) &&
        /b/.test(p3) &&
        /c/.test(p3) &&
        /d/.test(p3) &&
        /f/.test(p3) &&
        /l/.test(p3) &&
        /m/.test(p3);
      if (ok1 && ok2 && ok3) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function enforceAdminCollapse(scope) {
  try {
    const root = scope || document;
    const rows =
      root.querySelectorAll &&
      root.querySelectorAll("#maintable tbody tr.table__body_row");
    if (!rows || !rows.length) return;

    rows.forEach(function (tr) {
      try {
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
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown")
      }
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateUserPermissions(userId, permissions) {
  try {
    fetch(`/api/users/${userId}/permissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permissions }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          window.showToast("Права пользователя обновлены", "success");
          // Refresh permissions display
          enforceAdminCollapse();
        } else {
          window.showToast("Ошибка обновления прав", "error");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.UsersPermissions = {
  isFullAccessLegacy,
  enforceAdminCollapse,
  updateUserPermissions,
};
