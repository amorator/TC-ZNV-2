// Initialize unified context menu for users page
function initUsersContextMenu() {
  const table = document.getElementById("maintable");
  if (!table) return;

  // Get table permissions
  const canManage = table.getAttribute("data-can-manage") === "1";

  // Helper: detect full access by legacy permission string
  function isFullAccessLegacy(legacy) {
    try {
      const sRaw = String(legacy || "");
      const s = sRaw.replace(/\s+/g, "");
      if (!s) return false;
      if (s.indexOf("z") !== -1) return true;
      if (/полныйдоступ/i.test(sRaw) || /fullaccess/i.test(sRaw)) return true;
      // Accept known full strings and minor variants with empty segments
      // Examples: aef,a,abcdflm,ab,ab,ab,abcd OR aef,a,abcdflm,ab,ab,,abcd
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

  // Ensure admin/full-access rows show only a single line and do not expand
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
          // Replace content and mark as collapsed to survive future updates
          if (
            !cell.hasAttribute("data-collapsed-admin") ||
            !already ||
            (already && already.textContent !== "Админ")
          ) {
            cell.innerHTML =
              '<div class="perms-cell__item"><span class="perms-cell__cat">Админ</span>: <span class="perms-cell__rights">полный доступ</span></div>';
            cell.setAttribute("data-collapsed-admin", "1");
          }
        } catch (_) {}
      });
    } catch (_) {}
  }
  // Run once on load
  enforceAdminCollapse(document);

  // Observe tbody mutations and enforce collapse continuously
  function setupAdminCollapseObserver() {
    try {
      const tableEl = document.getElementById("maintable");
      if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0]) return;
      const tbody = tableEl.tBodies[0];
      if (tbody.__adminCollapseObserver) return; // avoid duplicates
      const obs = new MutationObserver(function () {
        try {
          enforceAdminCollapse(document);
        } catch (_) {}
      });
      obs.observe(tbody, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      tbody.__adminCollapseObserver = obs;
    } catch (_) {}
  }
  setupAdminCollapseObserver();

  // Global body observer as fallback to reapply after full tbody swaps
  try {
    const bodyObs = new MutationObserver(function () {
      try {
        enforceAdminCollapse(document);
        setupAdminCollapseObserver();
      } catch (_) {}
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}

  // Initialize unified context menu
  if (window.contextMenu) {
    window.contextMenu.init({
      page: "users",
      canManage: canManage,
    });
  } else {
    // Fallback: retry after a short delay
    setTimeout(() => {
      if (window.contextMenu) {
        window.contextMenu.init({
          page: "users",
          canManage: canManage,
        });
      } else {
        console.warn("Context menu module not loaded");
      }
    }, 100);
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUsersContextMenu);
} else {
  initUsersContextMenu();
}

// Additional users page functionality
(function () {
  // Persist and auto-apply search like files page
  (function initUsersSearchPersistence() {
    try {
      const input = document.getElementById("searchinp");
      if (!input) return;
      const key = "users:search";
      const saved = (function () {
        try {
          return localStorage.getItem(key) || "";
        } catch (_) {
          return "";
        }
      })();
      if (saved) {
        input.value = saved;
        try {
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } catch (_) {}
        try {
          window.addEventListener("load", function () {
            setTimeout(function () {
              try {
                input.dispatchEvent(new Event("input", { bubbles: true }));
              } catch (_) {}
            }, 0);
          });
        } catch (_) {}
      }
      input.addEventListener("input", function (e) {
        const v = (e.target.value || "").trim();
        try {
          if (v) localStorage.setItem(key, v);
          else localStorage.removeItem(key);
        } catch (_) {}
      });
      // Provide clear handler for shared searchbar button
      try {
        window.searchClean = function () {
          const el = document.getElementById("searchinp");
          if (el) {
            el.value = "";
            try {
              el.focus();
            } catch (_) {}
          }
          try {
            localStorage.removeItem(key);
          } catch (_) {}
          try {
            el && el.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (_) {}
        };
      } catch (_) {}
    } catch (_) {}
  })();
  /**
   * Return users table element or null
   * @returns {HTMLTableElement|null}
   */
  function getTable() {
    return document.getElementById("maintable");
  }

  // Ensure Add User modal starts with unlocked permissions (not inherited from previous full-access user)
  function resetAddPermissionsUI() {
    try {
      const input = document.getElementById("perm-string-add");
      if (input) {
        input.value = "";
        if (window.refreshPermissionUI) {
          try {
            window.refreshPermissionUI("perm-string-add");
          } catch (_) {}
        }
      }
      const box = document.getElementById("perm-string-add-box");
      if (box) {
        const adminToggle = box.querySelector('[data-admin-toggle="1"]');
        if (adminToggle) adminToggle.checked = false;
        box.querySelectorAll(".permissions-group").forEach(function (group) {
          if (group.getAttribute("data-page") !== "admin") {
            group
              .querySelectorAll('input[type="checkbox"]')
              .forEach(function (cb) {
                cb.disabled = false;
              });
          }
          const viewCb = group.querySelector(
            'input[type="checkbox"][data-letter="f"]'
          );
          if (viewCb) viewCb.disabled = false;
        });
      }
    } catch (_) {}
  }
  try {
    const addBtn = document.getElementById("add-user-button");
    if (addBtn && !addBtn.__resetBound) {
      addBtn.__resetBound = true;
      addBtn.addEventListener("click", function () {
        setTimeout(resetAddPermissionsUI, 0);
      });
    }
  } catch (_) {}

  // Also observe the Add modal visibility toggles to reset state on open/close from any trigger
  (function observeAddModalVisibility() {
    try {
      const modal = document.getElementById("popup-add");
      if (!modal || modal.__permObsBound) return;
      modal.__permObsBound = true;
      const apply = function () {
        try {
          const cs = window.getComputedStyle(modal);
          // On show: ensure UI is clean and unlocked
          if (cs && cs.display !== "none") {
            setTimeout(resetAddPermissionsUI, 0);
          } else {
            // On hide: clear any disabled states just in case
            setTimeout(resetAddPermissionsUI, 0);
          }
        } catch (_) {}
      };
      const mo = new MutationObserver(function () {
        apply();
      });
      mo.observe(modal, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      // Initial pass
      apply();
    } catch (_) {}
  })();

  // Utility: set disabled state consistently (property, class, aria)
  function setDisabled(el, disabled) {
    try {
      if (!el) return;
      el.disabled = !!disabled;
      // Ensure attribute reflects state for CSS [disabled] selectors
      try {
        if (disabled) el.setAttribute("disabled", "");
        else el.removeAttribute("disabled");
      } catch (_) {}
      const label = el.closest("label");
      if (disabled) {
        el.setAttribute("aria-disabled", "true");
        el.classList.add("disabled");
        if (label) {
          label.classList.add("disabled");
          label.style.pointerEvents = "none";
          label.style.opacity = label.style.opacity || "0.65";
        }
      } else {
        el.removeAttribute("aria-disabled");
        el.classList.remove("disabled");
        if (label) {
          label.classList.remove("disabled");
          label.style.pointerEvents = "";
          if (label.style.opacity === "0.65") label.style.opacity = "";
        }
      }
    } catch (_) {}
  }

  // Enforce dependency: if any non-view permission is checked in a category, force 'f' (view) and lock it.
  // Additionally for Files group (data-page="3"): if user is in admin group and any Files permission besides 'a'/'f' is set,
  // then auto-enable and lock 'f' (Отображать все записи).
  function enforceViewRuleInBox(box, onlyGroup) {
    try {
      if (!box) return;
      // Categories rule
      (onlyGroup
        ? [onlyGroup]
        : box.querySelectorAll('.permissions-group[data-page="7"]')
      ).forEach(function (group) {
        if (
          group &&
          group.getAttribute &&
          group.getAttribute("data-page") !== "7"
        )
          return;
        const checks = Array.from(
          group.querySelectorAll('input[type="checkbox"]')
        );
        const viewCb = group.querySelector(
          'input[type="checkbox"][data-letter="f"]'
        );
        const hasNonView = checks.some(function (cb) {
          return cb.getAttribute("data-letter") !== "f" && cb.checked;
        });
        if (viewCb) {
          if (hasNonView) {
            viewCb.checked = true;
            setDisabled(viewCb, true);
          } else {
            setDisabled(viewCb, false);
          }
        }
      });
      // If scoped update was used, also re-apply to all other category groups to keep visual consistency
      if (onlyGroup) {
        try {
          // Removed global re-application to avoid clearing disabled styles in other groups
        } catch (_) {}
      }

      // Files rule for admin-group users: auto-enable 'f' if any other Files permission is set
      (onlyGroup
        ? [onlyGroup]
        : box.querySelectorAll('.permissions-group[data-page="3"]')
      ).forEach(function (group) {
        if (
          group &&
          group.getAttribute &&
          group.getAttribute("data-page") !== "3"
        )
          return;
        // Only manage 'a' (Просмотр); do not force or disable 'm'
        const viewACb = group.querySelector(
          'input[type="checkbox"][data-letter="a"]'
        );
        if (!viewACb) return;
        // Early: if admin toggle is ON in this form, hard-lock 'a' only
        try {
          const form = group.closest("form");
          const adminToggle =
            form && form.querySelector('[data-admin-toggle="1"]');
          if (adminToggle && adminToggle.checked) {
            viewACb.checked = true;
            setDisabled(viewACb, true);
            return;
          }
        } catch (_) {}
        // Compute context (no actions for 'm')
        const checks = Array.from(
          group.querySelectorAll('input[type="checkbox"]')
        );
        const hasNonView = checks.some(function (cb) {
          const ch = cb.getAttribute("data-letter");
          return ch !== "a" && cb.checked;
        });
        // Determine admin/full-access
        let isAdminGroupUser = false;
        let isFullAccessUser = false;
        try {
          const form = group.closest("form");
          if (form) {
            const hid =
              form.querySelector("#perm-string-perm") ||
              form.querySelector("#perm-string-add");
            const legacyStr =
              hid && typeof hid.value === "string" ? hid.value : "";
            isFullAccessUser = isFullAccessLegacy(legacyStr);
            const adminName = (window.adminGroupName || "").toLowerCase();
            if (adminName) {
              if (form.id === "perm") {
                const rid = (window.__permRowId || "").trim();
                const row = rid ? document.getElementById(rid) : null;
                const gname =
                  row && row.dataset && row.dataset.groupname
                    ? row.dataset.groupname.toLowerCase()
                    : "";
                isAdminGroupUser = !!gname && gname === adminName;
              } else if (form.id === "add") {
                const sel = document.getElementById("add-group");
                const txt =
                  sel && sel.options && sel.options[sel.selectedIndex]
                    ? String(
                        sel.options[sel.selectedIndex].text || ""
                      ).toLowerCase()
                    : "";
                isAdminGroupUser = !!txt && txt === adminName;
              } else if (form.id === "edit") {
                const sel = document.getElementById("edit-group");
                const txt =
                  sel && sel.options && sel.options[sel.selectedIndex]
                    ? String(
                        sel.options[sel.selectedIndex].text || ""
                      ).toLowerCase()
                    : "";
                isAdminGroupUser = !!txt && txt === adminName;
              }
            }
          }
        } catch (_) {}
        // For full-access or admin-group users: lock 'a' ON
        if (isFullAccessUser || isAdminGroupUser) {
          viewACb.checked = true;
          setDisabled(viewACb, true);
          return;
        }
        // Otherwise, 'a' stays enabled
        setDisabled(viewACb, false);
      });
    } catch (_) {}
  }

  // Wire change handlers for both Add and Edit permission boxes
  (function wirePermBoxes() {
    try {
      const addBox = document.getElementById("perm-string-add-box");
      if (addBox && !addBox.__viewRuleBound) {
        addBox.__viewRuleBound = true;
        const handler = function (e) {
          const grp =
            e && e.target && e.target.closest
              ? e.target.closest(".permissions-group")
              : null;
          enforceViewRuleInBox(addBox, grp || undefined);
        };
        addBox.addEventListener("change", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
        // Immediate visual feedback on click/input as well
        addBox.addEventListener("click", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
        addBox.addEventListener("input", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
      }
    } catch (_) {}
    try {
      const permBox = document.getElementById("perm-string-perm-box");
      if (permBox && !permBox.__viewRuleBound) {
        permBox.__viewRuleBound = true;
        const handler = function (e) {
          const grp =
            e && e.target && e.target.closest
              ? e.target.closest(".permissions-group")
              : null;
          enforceViewRuleInBox(permBox, grp || undefined);
        };
        permBox.addEventListener("change", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
        // Immediate visual feedback on click/input as well
        permBox.addEventListener("click", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
        permBox.addEventListener("input", function (e) {
          if (e && e.target && e.target.matches('input[type="checkbox"]')) {
            handler(e);
          }
        });
        // Also re-enforce when group select changes in the Edit form while perm box is open
        try {
          const editSel = document.getElementById("edit-group");
          if (editSel && !editSel.__viewRuleRebind) {
            editSel.__viewRuleRebind = true;
            editSel.addEventListener("change", function () {
              enforceViewRuleInBox(permBox);
            });
          }
        } catch (_) {}
        // Re-apply when admin toggle changes
        try {
          const adminToggle = permBox.querySelector('[data-admin-toggle="1"]');
          if (adminToggle && !adminToggle.__filesRebind) {
            adminToggle.__filesRebind = true;
            const applyFiles = function () {
              try {
                const filesGroup = permBox.querySelector(
                  '.permissions-group[data-page="3"]'
                );
                enforceViewRuleInBox(permBox, filesGroup || undefined);
              } catch (_) {}
            };
            adminToggle.addEventListener("change", applyFiles);
            adminToggle.addEventListener("click", applyFiles);
            setTimeout(applyFiles, 0);
          }
        } catch (_) {}
        // Re-apply when hidden permission input changes value
        try {
          const hid = permBox.querySelector("#perm-string-perm");
          if (hid && !hid.__filesRebind) {
            hid.__filesRebind = true;
            const applyFiles = function () {
              try {
                const filesGroup = permBox.querySelector(
                  '.permissions-group[data-page="3"]'
                );
                enforceViewRuleInBox(permBox, filesGroup || undefined);
              } catch (_) {}
            };
            hid.addEventListener("change", applyFiles);
            hid.addEventListener("input", applyFiles);
          }
        } catch (_) {}
      }
    } catch (_) {}
  })();

  // Observe Edit (permissions) modal to enforce rule on open/close
  (function observePermModalVisibility() {
    try {
      const modal = document.getElementById("popup-perm");
      if (!modal || modal.__permRefreshObsBound) return;
      modal.__permRefreshObsBound = true;
      const lastState = { visible: false };
      const apply = function () {
        try {
          const cs = window.getComputedStyle(modal);
          const isVisible = cs && cs.display !== "none";
          // On show -> enforce view rules immediately
          if (!lastState.visible && isVisible) {
            try {
              const box = document.getElementById("perm-string-perm-box");
              if (box) enforceViewRuleInBox(box);
            } catch (_) {}
          }
          // On hide -> refresh users table and re-apply collapses
          if (lastState.visible && !isVisible) {
            try {
              if (window.refreshUsersPage) window.refreshUsersPage();
            } catch (_) {}
            try {
              enforceAdminCollapse(document);
            } catch (_) {}
          }
          lastState.visible = isVisible;
        } catch (_) {}
      };
      // Polling observer (since overlay isn't Bootstrap modal)
      setInterval(apply, 150);
    } catch (_) {}
  })();

  /**
   * Find selected TR for given event target
   * @param {Element} target
   * @returns {HTMLTableRowElement|null}
   */
  function getSelectedRow(target) {
    const row = target.closest("tr.table__body_row");
    return row && row.id ? row : null;
  }

  /**
   * Open a modal and hydrate the form from selected row
   * @param {('add'|'edit'|'perm'|'reset'|'delete')} modalId
   * @param {string=} rowId
   */
  function openModal(modalId, rowId) {
    let formId;
    let form;
    if (rowId) {
      const formMap = {
        edit: "edit",
        reset: "reset",
        delete: "delete",
        perm: "perm",
      };
      formId = formMap[modalId] || modalId;
      form = document.getElementById(formId);
      if (form) {
        popupValues(form, rowId);
        // Ensure permission checkboxes reflect current legacy string
        if (formId === "perm") {
          syncPermFormFromRow(form, rowId);
          // In case layout needs time, re-sync on next tick
          setTimeout(function () {
            syncPermFormFromRow(form, rowId);
          }, 0);
          // Store original permission string for change detection
          try {
            const row = document.getElementById(rowId);
            form.dataset.origPerm =
              row && row.dataset && row.dataset.perm ? row.dataset.perm : "";
            const hidden = form.querySelector("#perm-string-perm");
            form.dataset.origPermCurrent = hidden ? hidden.value || "" : "";
          } catch (_) {}
        } else if (formId === "edit") {
          // Store original field values for change detection
          try {
            const row = document.getElementById(rowId);
            form.dataset.rowId = rowId;
            form.dataset.origLogin =
              row && row.dataset && row.dataset.login ? row.dataset.login : "";
            form.dataset.origName =
              row && row.dataset && row.dataset.name ? row.dataset.name : "";
            form.dataset.origGid =
              row && row.dataset && row.dataset.gid ? row.dataset.gid : "";
            const enabled =
              row && row.dataset && row.dataset.enabled
                ? row.dataset.enabled
                : "";
            form.dataset.origEnabled = enabled;
          } catch (_) {}
        }
      }
    }
    popupToggle("popup-" + modalId, rowId || 0);
    // Ensure values are visible after modal render
    if (rowId && formId === "edit" && form) {
      setTimeout(function () {
        try {
          popupValues(form, rowId);
        } catch (_) {}
      }, 0);
    }
    // Reset modal primary button label to default on open
    try {
      const modal = document.getElementById("popup-" + modalId);
      if (modal) {
        const btn = modal.querySelector(".btn.btn-primary");
        if (btn) {
          const current = btn.textContent || "";
          if (
            !btn.dataset.defaultText &&
            current &&
            current.trim() &&
            current.trim() !== "Отправка..."
          ) {
            btn.dataset.defaultText = current.trim();
          }
          const restored =
            btn.dataset.defaultText ||
            btn.dataset.originalText ||
            current ||
            "Отправить";
          btn.textContent = restored;
          btn.disabled = false;
        }
      }
    } catch (_) {}
  }

  /**
   * Sync permissions checkboxes from legacy permission string on row dataset
   * and fill the left-side summary only.
   * @param {HTMLFormElement} form
   * @param {string} rowId
   */
  function syncPermFormFromRow(form, rowId) {
    const row = document.getElementById(rowId);
    if (!row || !form) return;
    // Only sync permissions; do NOT sync login/name/group/enabled in this modal

    // Fill left-side summary
    const loginBox = document.getElementById("perm-summary-login");
    const nameBox = document.getElementById("perm-summary-name");
    const groupBox = document.getElementById("perm-summary-group");
    const enabledBox = document.getElementById("perm-summary-enabled");
    const login = (row.dataset.login || "").trim();
    const name = (row.dataset.name || "").trim();
    const groupName = (row.dataset.groupname || "").trim();
    if (loginBox) loginBox.textContent = login;
    if (nameBox) nameBox.textContent = name;
    if (groupBox) groupBox.textContent = groupName;
    if (enabledBox)
      enabledBox.textContent = row.dataset.enabled === "1" ? "Да" : "Нет";

    // Sync checkboxes from legacy string on row dataset
    const input = form.querySelector("#perm-string-perm");
    const legacy = row.dataset.perm || "";
    if (input) input.value = legacy;
    // Normalize UI (convert legacy with 'z' to full-access string, set boxes including 'f')
    try {
      if (input && window.refreshPermissionUI) {
        window.refreshPermissionUI(input.id);
      }
    } catch (_) {}
    const boxId = (input ? input.id : "perm-string-perm") + "-box";
    const box = document.getElementById(boxId);
    if (!box) return;
    // If legacy equals full admin string, enable admin toggle and lock others
    try {
      const partsForZ = (legacy || "").split(",");
      while (partsForZ.length < 4) partsForZ.push("");
      const hasZAnywhere = partsForZ.some(function (seg) {
        return (seg || "").indexOf("z") !== -1;
      });
      const isFullAdmin =
        hasZAnywhere || legacy === "aef,a,abcdflm,ab,ab,ab,abcd";
      const adminToggle = box.querySelector('[data-admin-toggle="1"]');
      if (adminToggle) {
        adminToggle.checked = isFullAdmin;
      }
      box.querySelectorAll(".permissions-group").forEach(function (group) {
        if (group.getAttribute("data-page") !== "admin") {
          group
            .querySelectorAll('input[type="checkbox"]')
            .forEach(function (cb) {
              cb.disabled = isFullAdmin;
            });
        }
      });
    } catch (_) {}
    const parts = (legacy || "").split(",");
    while (parts.length < 4) parts.push("");
    const groups = box.querySelectorAll(".permissions-group");
    groups.forEach(function (group) {
      const page = parseInt(group.getAttribute("data-page"), 10);
      const letters = (parts[page - 1] || "").split("");
      const set = {};
      letters.forEach(function (ch) {
        if (ch) set[ch] = true;
      });
      group.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        const ch = cb.getAttribute("data-letter");
        cb.checked = !!set[ch];
      });
      // Rule: if any non-view permission in this category is set, force 'f' (view) and lock it
      try {
        const hasNonView = Object.keys(set).some(function (k) {
          return k && k !== "f";
        });
        const viewCb = group.querySelector(
          'input[type="checkbox"][data-letter="f"]'
        );
        if (viewCb) {
          if (hasNonView) {
            viewCb.checked = true;
            setDisabled(viewCb, true);
          } else {
            setDisabled(viewCb, false);
          }
        }
      } catch (_) {}
    });
    // If full access detected, lock Files page ('a' only) immediately
    try {
      const isFull = isFullAccessLegacy(legacy);
      // Also detect admin-group
      let isAdminGroup = false;
      try {
        const row = document.getElementById(rowId);
        const adminName = (window.adminGroupName || "").toLowerCase();
        const gname =
          row && row.dataset && row.dataset.groupname
            ? row.dataset.groupname.toLowerCase()
            : "";
        isAdminGroup = !!adminName && !!gname && gname === adminName;
      } catch (_) {}
      if (isFull || isAdminGroup) {
        const filesGroup = box.querySelector(
          '.permissions-group[data-page="3"]'
        );
        if (filesGroup) {
          const aCb = filesGroup.querySelector(
            'input[type="checkbox"][data-letter="a"]'
          );
          if (aCb) {
            aCb.checked = true;
            setDisabled(aCb, true);
          }
        }
      }
    } catch (_) {}
    // Immediately enforce cross-group rules (Files admin-group rule, Categories view rule)
    try {
      enforceViewRuleInBox(box);
    } catch (_) {}

    // Also populate hidden fields so backend validation passes
    try {
      const hidLogin = form.querySelector('input[name="login"]');
      const hidName = form.querySelector('input[name="name"]');
      const hidGroup = form.querySelector('input[name="group"]');
      const hidEnabled = form.querySelector('input[name="enabled"]');
      if (hidLogin) hidLogin.value = (row.dataset.login || "").trim();
      if (hidName) hidName.value = (row.dataset.name || "").trim();
      if (hidGroup) hidGroup.value = (row.dataset.gid || "").toString();
      if (hidEnabled)
        hidEnabled.value = row.dataset.enabled === "1" ? "1" : "0";
    } catch (_) {}
  }

  // Expose for other modules (e.g., context-menu)
  try {
    window.syncPermFormFromRow = syncPermFormFromRow;
  } catch (_) {}

  /**
   * Global search function (modeled after filesDoFilter) — exposed early so
   * other initializers can call it even if attachHandlers hasn't run yet.
   */
  if (!window.usersDoFilter) {
    window.usersDoFilter = function usersDoFilter(query) {
      try {
        const tableEl = document.getElementById("maintable");
        if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0])
          return Promise.resolve(false);
        const tbodyEl = tableEl.tBodies[0];
        const pager = document.getElementById("users-pagination");
        const q = (query || "").trim();
        if (q.length > 0) {
          if (pager) pager.classList.add("d-none");
          const url = new URL(window.location.origin + "/users/search");
          url.searchParams.set("q", q);
          url.searchParams.set("page", "1");
          url.searchParams.set("page_size", "30");
          url.searchParams.set("t", String(Date.now()));
          return fetch(String(url), {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" },
          })
            .then((r) => (r.ok ? r.json() : { html: "" }))
            .then((j) => {
              if (!j || !j.html) return false;
              const searchRow = tbodyEl.querySelector("tr#search");
              const temp = document.createElement("tbody");
              temp.innerHTML = j.html;
              Array.from(tbodyEl.querySelectorAll("tr")).forEach(function (tr) {
                if (!searchRow || tr !== searchRow) tr.remove();
              });
              Array.from(temp.children).forEach(function (tr) {
                tbodyEl.appendChild(tr);
              });
              try {
                if (window.rebindUsersTable) window.rebindUsersTable();
              } catch (_) {}
              try {
                if (typeof reinitializeContextMenu === "function")
                  reinitializeContextMenu();
              } catch (_) {}
              return true;
            })
            .catch(function () {
              return false;
            });
        } else {
          if (pager) pager.classList.remove("d-none");
          if (
            window.usersPager &&
            typeof window.usersPager.renderPage === "function"
          ) {
            window.usersPager.renderPage(1);
          }
          return Promise.resolve(true);
        }
      } catch (_) {
        return Promise.resolve(false);
      }
    };
  }

  // Bind search input early as well (independent of attachHandlers lifecycle)
  (function bindUsersSearchEarly() {
    const bind = function () {
      try {
        const input = document.getElementById("searchinp");
        if (!input || input._usersEarlyBound) return;
        input._usersEarlyBound = true;
        const trigger = function (src) {
          try {
            const val = (input.value || "").trim();
            if (window.usersDoFilter) {
              window.usersDoFilter(val);
            }
          } catch (_) {}
        };
        input.addEventListener("input", function () {
          trigger("input");
        });
        input.addEventListener("keyup", function () {
          trigger("keyup");
        });
        input.addEventListener("change", function () {
          trigger("change");
        });
        // In case the input was prefilled from persistence, kick once after bind
        setTimeout(function () {
          try {
            trigger("kick");
          } catch (_) {}
        }, 0);
      } catch (_) {}
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
    // Also rebind on window load and after table updates
    try {
      window.addEventListener("load", function () {
        setTimeout(function () {
          bind();
          try {
            enforceAdminCollapse(document);
          } catch (_) {}
        }, 0);
      });
    } catch (_) {}
    try {
      document.addEventListener("table-updated", function () {
        setTimeout(function () {
          bind();
          try {
            enforceAdminCollapse(document);
          } catch (_) {}
        }, 0);
      });
    } catch (_) {}
    // Safety: attempt a few times in case of slow DOM hydration
    try {
      let attempts = 0;
      const iv = setInterval(function () {
        attempts += 1;
        bind();
        if (attempts >= 10) clearInterval(iv);
      }, 200);
    } catch (_) {}
  })();

  /** Bind page-level handlers for context menu, search, toggles, and copy. */
  function attachHandlers() {
    const table = getTable();
    if (!table) return;
    const canManage = table.dataset.canManage === "1";

    // Block permissions modal for admin and admin-group
    try {
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && canManage) {
        tbody.addEventListener("contextmenu", function (e) {
          const row =
            e.target &&
            e.target.closest &&
            e.target.closest("tr.table__body_row");
          if (!row) return;
          const isAdminLogin =
            (row.dataset.login || "").toLowerCase() === "admin";
          // Only hide permissions item for the protected admin user; full-access users may edit permissions
          if (isAdminLogin) {
            try {
              const item = document.querySelector(
                '#context-menu [data-action="perm"]'
              );
              if (item) item.classList.add("d-none");
            } catch (_) {}
          } else {
            try {
              const item = document.querySelector(
                '#context-menu [data-action="perm"]'
              );
              if (item) item.classList.remove("d-none");
            } catch (_) {}
          }
        });
      }
    } catch (_) {}

    // Initialize pagination (server-side, like files page)
    (function initUsersPagination() {
      const pager = document.getElementById("users-pagination");
      const tbody = table.tBodies && table.tBodies[0];
      if (!pager || !tbody) return;
      const pageSize = 15;
      function render(page) {
        const url = new URL(window.location.origin + "/users/page");
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(pageSize));
        url.searchParams.set("t", String(Date.now()));
        fetch(String(url), { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : { html: "", total: 0, page: 1 }))
          .then((j) => {
            if (!j || typeof j.html !== "string") return;
            const searchRow = tbody.querySelector("tr#search");
            const temp = document.createElement("tbody");
            temp.innerHTML = j.html;
            Array.from(tbody.querySelectorAll("tr")).forEach(function (tr) {
              if (!searchRow || tr !== searchRow) tr.remove();
            });
            Array.from(temp.children).forEach(function (tr) {
              tbody.appendChild(tr);
            });
            // build pager like files (first/prev, window with ellipses, next/last)
            const total = j.total || 0;
            const pages = Math.max(1, Math.ceil(total / pageSize));
            const page = j.page || 1;
            const btn = (
              label,
              targetPage,
              disabled = false,
              extraClass = ""
            ) =>
              `<li class="page-item ${extraClass} ${
                disabled ? "disabled" : ""
              }"><a class="page-link" href="#" data-page="${targetPage}">${label}</a></li>`;
            const items = [];
            items.push(btn("⏮", 1, page === 1, "first"));
            items.push(btn("‹", Math.max(1, page - 1), page === 1, "prev"));
            // Always include first page
            items.push(
              `<li class="page-item ${
                page === 1 ? "active" : ""
              }"><a class="page-link" href="#" data-page="1">1</a></li>`
            );
            // Left ellipsis
            const leftStart = Math.max(2, page - 2);
            const leftGap = leftStart - 2;
            if (leftGap >= 1) {
              items.push(
                `<li class="page-item disabled"><span class="page-link">…</span></li>`
              );
            }
            // Middle window
            const midStart = Math.max(2, page - 2);
            const midEnd = Math.min(pages - 1, page + 2);
            for (let p = midStart; p <= midEnd; p++) {
              items.push(
                `<li class="page-item ${
                  p === page ? "active" : ""
                }"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`
              );
            }
            // Right ellipsis
            const rightEnd = Math.min(pages - 1, page + 2);
            const rightGap = pages - 1 - rightEnd;
            if (rightGap >= 1) {
              items.push(
                `<li class="page-item disabled"><span class="page-link">…</span></li>`
              );
            }
            // Always include last page
            if (pages > 1) {
              items.push(
                `<li class="page-item ${
                  page === pages ? "active" : ""
                }"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`
              );
            }
            items.push(
              btn("›", Math.min(pages, page + 1), page === pages, "next")
            );
            items.push(btn("⏭", pages, page === pages, "last"));
            pager.innerHTML = `<nav><ul class="pagination mb-0">${items.join(
              ""
            )}</ul></nav>`;
            if (!pager._clickBound) {
              const onPagerClick = (e) => {
                const a = e.target && e.target.closest("[data-page]");
                if (!a) return;
                e.preventDefault();
                const nextPage = parseInt(a.getAttribute("data-page"), 10) || 1;
                render(nextPage);
              };
              pager.addEventListener("click", onPagerClick);
              pager._clickBound = true;
            }
            try {
              reinitializeContextMenu();
            } catch (_) {}
            try {
              if (window.rebindUsersTable) window.rebindUsersTable();
            } catch (_) {}
          })
          .catch(function () {});
      }
      // expose like filesPager
      window.usersPager = {
        renderPage: render,
        readPage: function () {
          return 1;
        },
      };
      render(1);
    })();

    // Search (modeled after filesDoFilter)
    window.usersDoFilter = function usersDoFilter(query) {
      const tableEl = document.getElementById("maintable");
      if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0])
        return Promise.resolve(false);
      const tbodyEl = tableEl.tBodies[0];
      const pager = document.getElementById("users-pagination");
      const q = (query || "").trim();
      if (q.length > 0) {
        if (pager) pager.classList.add("d-none");
        const url = new URL(window.location.origin + "/users/search");
        url.searchParams.set("q", q);
        url.searchParams.set("page", "1");
        url.searchParams.set("page_size", "30");
        url.searchParams.set("t", String(Date.now()));
        return fetch(String(url), {
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        })
          .then((r) => (r.ok ? r.json() : { html: "" }))
          .then((j) => {
            if (!j || !j.html) return false;
            const searchRow = tbodyEl.querySelector("tr#search");
            const temp = document.createElement("tbody");
            temp.innerHTML = j.html;
            Array.from(tbodyEl.querySelectorAll("tr")).forEach(function (tr) {
              if (!searchRow || tr !== searchRow) tr.remove();
            });
            Array.from(temp.children).forEach(function (tr) {
              tbodyEl.appendChild(tr);
            });
            try {
              if (window.rebindUsersTable) window.rebindUsersTable();
            } catch (_) {}
            try {
              reinitializeContextMenu();
            } catch (_) {}
            return true;
          })
          .catch(function () {
            return false;
          });
      } else {
        if (pager) pager.classList.remove("d-none");
        if (
          window.usersPager &&
          typeof window.usersPager.renderPage === "function"
        ) {
          window.usersPager.renderPage(1);
        }
        return Promise.resolve(true);
      }
    };

    const search = document.getElementById("searchinp");
    if (search) {
      const debounced = debounce(function (q) {
        window.usersDoFilter(q);
      }, 280);
      search.addEventListener("input", function () {
        debounced(this.value);
      });
    }

    // Inline toggle on click for non-admin users (mirrors context-menu toggle)
    try {
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && canManage) {
        tbody.addEventListener("click", function (e) {
          const cell =
            e.target &&
            e.target.closest &&
            e.target.closest("td[data-enabled]");
          if (!cell) return;
          const row = cell.closest("tr.table__body_row");
          if (!row) return;
          const loginVal = (row.dataset.login || "").toLowerCase();
          const isAdmin = row.dataset.isAdmin === "1" || loginVal === "admin";
          if (isAdmin) {
            // Protected admin: do not toggle
            return;
          }
          const rowId = row.id;
          if (!rowId) return;
          const toggleUrl = `${window.location.origin}/users/toggle/${rowId}`;
          fetch(toggleUrl, { method: "GET", credentials: "same-origin" })
            .then(function (response) {
              if (!response.ok) return;
              const currentEnabled = row.dataset.enabled === "1";
              const newEnabled = !currentEnabled;
              row.dataset.enabled = newEnabled ? "1" : "0";
              // sync cell data-enabled attribute
              try {
                cell.setAttribute("data-enabled", newEnabled ? "1" : "0");
              } catch (_) {}
              // update icon classes
              const icon = cell.querySelector(".bi");
              if (icon) {
                icon.classList.remove("bi-toggle-on", "bi-toggle-off");
                icon.classList.add(
                  newEnabled ? "bi-toggle-on" : "bi-toggle-off"
                );
              }
              // Reinitialize context menu after state change
              try {
                setTimeout(function () {
                  const evt = new CustomEvent("context-menu-reinit", {
                    detail: { timestamp: Date.now() },
                  });
                  document.dispatchEvent(evt);
                }, 0);
              } catch (_) {}
            })
            .catch(function (_) {});
        });
      }
    } catch (_) {}

    // Click-to-copy login similar to files name
    function bindCopy(selector, title) {
      document.querySelectorAll(selector).forEach((el) => {
        if (el._copyBound) return;
        el._copyBound = true;
        el.style.cursor = "copy";
        el.title = title;
        el.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const text = (el.textContent || "").trim();
          if (!text) return;
          const onDone = () => {
            el.classList.add("copied");
            setTimeout(() => el.classList.remove("copied"), 220);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(text)
              .then(onDone)
              .catch(function () {
                try {
                  const ta = document.createElement("textarea");
                  ta.value = text;
                  ta.setAttribute("readonly", "");
                  ta.style.position = "absolute";
                  ta.style.left = "-9999px";
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  ta.remove();
                  onDone();
                } catch (_) {}
              });
          } else {
            try {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.setAttribute("readonly", "");
              ta.style.position = "absolute";
              ta.style.left = "-9999px";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              ta.remove();
              onDone();
            } catch (_) {}
          }
        });
      });
    }
    bindCopy("#maintable tbody .users-page__login", "Клик — скопировать логин");
    bindCopy("#maintable tbody .users-page__name", "Клик — скопировать имя");

    // Expose a rebind helper to refresh per-row handlers after tbody replacement
    window.rebindUsersTable = function () {
      try {
        bindCopy(
          "#maintable tbody .users-page__login",
          "Клик — скопировать логин"
        );
        bindCopy(
          "#maintable tbody .users-page__name",
          "Клик — скопировать имя"
        );
      } catch (_) {}
    };
  }

  // Legacy popupValues function removed - using new implementation below

  // Legacy function removed - using new validateForm below

  // NOTE: keep name different to avoid shadowing global window.submitFormAjaxAjax
  function submitFormAjaxLocal(form) {
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      try {
        submitBtn.dataset.originalText = originalText;
      } catch (_) {}
      submitBtn.disabled = true;
      submitBtn.textContent = "Отправка...";
    }
    return fetch(form.action, {
      method: "POST",
      body: formData,
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) {
          return response.text().then((text) => {
            throw new Error(text || "Неизвестная ошибка");
          });
        }
        return response;
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          const restored =
            submitBtn.dataset && submitBtn.dataset.originalText
              ? submitBtn.dataset.originalText
              : originalText;
          submitBtn.textContent = restored;
        }
      });
  }

  document.addEventListener("DOMContentLoaded", attachHandlers);

  // Live soft refresh via Socket.IO
  (function initUsersLiveUpdates() {
    try {
      if (!window.io) return;
      // Ensure a stable per-tab client id for deduplicating our own events
      try {
        if (!window.__usersClientId)
          window.__usersClientId =
            Math.random().toString(36).slice(2) + Date.now();
      } catch (_) {}
      // Initialize a dedicated socket for Users page to avoid cross-page interference
      function destroyUsersSocket() {
        try {
          if (window.usersSocket) {
            const s = window.usersSocket;
            try {
              s.off && s.off();
            } catch (_) {}
            try {
              s.disconnect && s.disconnect();
            } catch (_) {}
          }
        } catch (_) {}
        try {
          window.usersSocket = null;
        } catch (_) {}
      }
      // Do not destroy shared global socket used by other pages
      // destroyUsersSocket();
      let socket =
        window.socket &&
        (window.socket.connected || window.socket.connecting) &&
        typeof window.socket.on === "function"
          ? window.socket
          : window.io(window.location.origin, {
              transports: ["websocket", "polling"],
              upgrade: true,
              path: "/socket.io",
              withCredentials: true,
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 20000,
            });
      window.usersSocket = socket;
      if (!window.socket) window.socket = socket;
      // Always (re)bind to current socket instance
      try {
        socket.off && socket.off("users:changed");
      } catch (_) {}
      try {
        socket.off && socket.off("/users:changed");
      } catch (_) {}
      // Helper to rebuild socket on hard errors (e.g., 400 due to stale sid)
      function rebuildSocket() {
        // Recreate similar to files.js and reuse global
        try {
          if (socket && socket.off) {
            try {
              socket.off("connect");
            } catch (_) {}
            try {
              socket.off("disconnect");
            } catch (_) {}
            try {
              socket.off("connect_error");
            } catch (_) {}
            try {
              socket.off("error");
            } catch (_) {}
            try {
              socket.off("reconnect_error");
            } catch (_) {}
            try {
              socket.off("users:changed");
            } catch (_) {}
          }
        } catch (_) {}
        try {
          socket && socket.disconnect && socket.disconnect();
        } catch (_) {}
        const next = window.io(window.location.origin, {
          transports: ["websocket", "polling"],
          upgrade: true,
          path: "/socket.io",
          withCredentials: true,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000,
        });
        socket = next;
        window.usersSocket = next;
        if (!window.socket) window.socket = next;
        bindSocketHandlers(next);
      }
      function bindSocketHandlers(sock) {
        sock.on("connect", function () {
          try {
            softRefreshUsersTable();
          } catch (_) {}
        });
        sock.on("disconnect", function (reason) {
          // No-op; reconnection is handled by client. If server restarted, 400s may occur on old session
        });
        // If we see 400 or transport errors after restart, rebuild with fresh ts and possibly polling-only first
        const onConnErr = function (err) {
          try {
            const code = (err && (err.code || err.status)) || 0;
            const msg = String(err && (err.message || err)) || "";
            const is400 = code === 400 || /400/i.test(msg);
            const stale = /session|sid|bad request/i.test(msg);
            if (is400 || stale) {
              setTimeout(rebuildSocket, 500);
              return;
            }
          } catch (_) {}
        };
        try {
          sock.on("connect_error", onConnErr);
        } catch (_) {}
        try {
          sock.on("error", onConnErr);
        } catch (_) {}
        try {
          sock.on("reconnect_error", onConnErr);
        } catch (_) {}
        // Engine-level guards: close/error/upgradeError
        try {
          const eng = sock && sock.io && sock.io.engine;
          if (eng && !eng.__usersEngineBound) {
            eng.__usersEngineBound = true;
            eng.on &&
              eng.on("close", function (reason, desc) {
                try {
                  const msg = String(desc || reason || "");
                  if (/400|bad request|sid|session/i.test(msg)) {
                    setTimeout(rebuildSocket, 500);
                  }
                } catch (_) {}
              });
            eng.on &&
              eng.on("error", function (err) {
                try {
                  const code = (err && (err.code || err.status)) || 0;
                  const msg = String(err && (err.message || err)) || "";
                  if (
                    code === 400 ||
                    /400|bad request|sid|session/i.test(msg)
                  ) {
                    setTimeout(rebuildSocket, 500);
                  }
                } catch (_) {}
              });
            // Do not attempt upgrade; polling-only
          }
        } catch (_) {}
        sock.on("users:changed", function (evt) {
          try {
            const fromSelf = !!(
              evt &&
              evt.originClientId &&
              window.__usersClientId &&
              evt.originClientId === window.__usersClientId
            );
            if (fromSelf) return;
          } catch (_) {}
          if (document.hidden) {
            try {
              window.__usersHadBackgroundEvent = true;
            } catch (_) {}
            try {
              backgroundImmediateUsersRefresh();
            } catch (_) {}
          } else {
            try {
              softRefreshUsersTable();
            } catch (_) {}
          }
        });
      }
      bindSocketHandlers(socket);
      window.usersSocket = socket;
    } catch (e) {}

    // Transport fallback: if initial connection errors persist, retry once with polling-only
    try {
      if (window.usersSocket && !window.__usersTransportFallbackBound) {
        window.__usersTransportFallbackBound = true;
        let attemptedFallback = false;
        const bindFallback = function (sock) {
          const onError = function (err) {
            try {
              const code = (err && (err.code || err.status)) || 0;
              const msg = String(err && (err.message || err)) || "";
              const isEarlyWsClose =
                /WebSocket is closed before the connection is established/i.test(
                  msg
                );
              if (
                !attemptedFallback &&
                (code === 400 || isEarlyWsClose || !code)
              ) {
                attemptedFallback = true;
                try {
                  sock.off && sock.off("connect_error", onError);
                } catch (_) {}
                try {
                  sock.off && sock.off("error", onError);
                } catch (_) {}
                try {
                  sock.disconnect && sock.disconnect();
                } catch (_) {}
                // Recreate with polling-only and no upgrade
                const fallback = window.io(window.location.origin, {
                  transports: ["polling"],
                  upgrade: false,
                  forceNew: true,
                  path: "/socket.io",
                  withCredentials: true,
                  query: { ts: String(Date.now()) },
                  reconnection: true,
                  reconnectionAttempts: Infinity,
                  reconnectionDelay: 1000,
                  reconnectionDelayMax: 5000,
                  timeout: 20000,
                });
                window.usersSocket = fallback;
                // Rebind page handlers to the new socket instance
                try {
                  fallback.off && fallback.off("users:changed");
                } catch (_) {}
                try {
                  fallback.on("connect", function () {
                    try {
                      softRefreshUsersTable();
                    } catch (_) {}
                  });
                } catch (_) {}
                try {
                  fallback.on("users:changed", function (evt) {
                    try {
                      const fromSelf = !!(
                        evt &&
                        evt.originClientId &&
                        window.__usersClientId &&
                        evt.originClientId === window.__usersClientId
                      );
                      if (fromSelf) return;
                    } catch (_) {}
                    try {
                      softRefreshUsersTable();
                    } catch (_) {}
                  });
                } catch (_) {}
              }
            } catch (_) {}
          };
          try {
            sock.on("connect_error", onError);
          } catch (_) {}
          try {
            sock.on("error", onError);
          } catch (_) {}
          try {
            sock.on("reconnect_error", onError);
          } catch (_) {}
        };
        bindFallback(window.usersSocket);
      }
    } catch (_) {}

    // Focus/visibility: force reconnect and one soft refresh when tab returns
    try {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
          try {
            if (window.socket && !window.socket.connected)
              window.socket.connect();
          } catch (_) {}
          try {
            softRefreshUsersTable();
          } catch (_) {}
        }
      });
    } catch (_) {}
    try {
      window.addEventListener("focus", function () {
        try {
          if (window.socket && !window.socket.connected)
            window.socket.connect();
        } catch (_) {}
        try {
          softRefreshUsersTable();
        } catch (_) {}
      });
    } catch (_) {}

    // Helper: smooth table update without flickering
    function smoothUpdateUsersTableBody(oldTbody, newTbody) {
      const oldRows = Array.from(oldTbody.querySelectorAll("tr"));
      const newRows = Array.from(newTbody.querySelectorAll("tr"));

      // Create maps for efficient lookup
      const oldRowMap = new Map();
      const newRowMap = new Map();

      oldRows.forEach((row) => {
        const id = row.getAttribute("data-id") || row.id;
        if (id) oldRowMap.set(id, row);
      });

      newRows.forEach((row) => {
        const id = row.getAttribute("data-id") || row.id;
        if (id) newRowMap.set(id, row);
      });

      // Update existing rows
      for (const [id, newRow] of newRowMap) {
        const oldRow = oldRowMap.get(id);
        if (oldRow) {
          // Update existing row content without replacing the entire row
          const oldCells = oldRow.querySelectorAll("td");
          const newCells = newRow.querySelectorAll("td");

          if (oldCells.length === newCells.length) {
            // Update cell content
            for (let i = 0; i < oldCells.length; i++) {
              if (oldCells[i].innerHTML !== newCells[i].innerHTML) {
                oldCells[i].innerHTML = newCells[i].innerHTML;
              }
            }
            // Update row attributes
            Array.from(newRow.attributes).forEach((attr) => {
              if (oldRow.getAttribute(attr.name) !== attr.value) {
                oldRow.setAttribute(attr.name, attr.value);
              }
            });
          } else {
            // Row structure changed, replace it
            oldRow.replaceWith(newRow.cloneNode(true));
          }
        } else {
          // Add new row
          oldTbody.appendChild(newRow.cloneNode(true));
        }
      }

      // Remove rows that no longer exist
      for (const [id, oldRow] of oldRowMap) {
        if (!newRowMap.has(id)) {
          oldRow.remove();
        }
      }
    }

    // Register and unify soft refresh using TableManager.
    // Rebinds context menu and per-row handlers after DOM replacement.
    try {
      window.tableManager &&
        window.tableManager.registerTable("maintable", {
          pageType: "users",
          refreshEndpoint: window.location.href,
          smoothUpdate: true,
        });
    } catch (_) {}
    function softRefreshUsersTable() {
      try {
        const input = document.getElementById("searchinp");
        const q =
          input && typeof input.value === "string" ? input.value.trim() : "";
        if (q && typeof window.usersDoFilter === "function") {
          return window
            .usersDoFilter(q)
            .then(function () {
              try {
                reinitializeContextMenu();
              } catch (_) {}
              try {
                if (window.rebindUsersTable) window.rebindUsersTable();
              } catch (_) {}
            })
            .catch(function () {
              try {
                reinitializeContextMenu();
              } catch (_) {}
            });
        }
        if (
          window.usersPager &&
          typeof window.usersPager.renderPage === "function"
        ) {
          window.usersPager.renderPage(1);
          try {
            reinitializeContextMenu();
          } catch (_) {}
          try {
            if (window.rebindUsersTable) window.rebindUsersTable();
          } catch (_) {}
          return;
        }
        if (window.tableManager && window.tableManager.softRefreshTable) {
          window.tableManager.softRefreshTable("maintable").then(function () {
            try {
              reinitializeContextMenu();
            } catch (_) {}
            try {
              if (window.rebindUsersTable) window.rebindUsersTable();
            } catch (_) {}
            try {
              setTimeout(reinitializeContextMenu, 0);
            } catch (_) {}
          });
        }
      } catch (_) {}
    }
    try {
      window.softRefreshUsersTable = softRefreshUsersTable;
    } catch (_) {}

    // removed debug fallback refresh
  })();

  /**
   * Reinitialize context menu after table update
   */
  function reinitializeContextMenu() {
    // Prevent frequent reinitializations that can cause timeouts
    const now = Date.now();
    if (
      window._lastContextMenuReinit &&
      now - window._lastContextMenuReinit < 500
    ) {
      return; // Skip if called less than 500ms ago
    }
    window._lastContextMenuReinit = now;

    try {
      // Use requestIdleCallback for non-blocking reinitialization
      if (window.requestIdleCallback) {
        window.requestIdleCallback(
          () => {
            try {
              // Trigger a custom event to reinitialize context menu
              const event = new CustomEvent("context-menu-reinit", {
                detail: { timestamp: Date.now() },
              });
              document.dispatchEvent(event);

              // Also trigger table update event for any other listeners
              document.dispatchEvent(new Event("table-updated"));
            } catch (e) {
              console.error("Context menu reinit failed:", e);
            }
          },
          { timeout: 1000 }
        );
      } else {
        // Fallback: use setTimeout with small delay
        setTimeout(() => {
          try {
            // Trigger a custom event to reinitialize context menu
            const event = new CustomEvent("context-menu-reinit", {
              detail: { timestamp: Date.now() },
            });
            document.dispatchEvent(event);

            // Also trigger table update event for any other listeners
            document.dispatchEvent(new Event("table-updated"));
          } catch (e) {
            console.error("Context menu reinit failed:", e);
          }
        }, 10);
      }
    } catch (e) {
      console.error("Context menu reinit failed:", e);
    }
  }

  // Simple debounce helper for this module
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // Change-detection helpers for edit and permissions forms (global scope)
  function closeModal(id) {
    try {
      popupClose(id);
    } catch (_) {}
  }

  window.isEditChanged = function (form) {
    try {
      const login = (
        form.querySelector('input[name="login"]').value || ""
      ).trim();
      const name = (
        form.querySelector('input[name="name"]').value || ""
      ).trim();
      const group = (
        form.querySelector('select[name="group"]').value || ""
      ).toString();
      const enabledEl = form.querySelector('input[name="enabled"]');
      const enabled = enabledEl ? (enabledEl.checked ? "1" : "0") : "";
      const oLogin = form.dataset.origLogin || "";
      const oName = form.dataset.origName || "";
      const oGid = (form.dataset.origGid || "").toString();
      const oEnabled = form.dataset.origEnabled || "";
      return (
        login !== oLogin ||
        name !== oName ||
        group !== oGid ||
        enabled !== oEnabled
      );
    } catch (e) {
      return true;
    }
  };

  window.isPermChanged = function (form) {
    try {
      const hidden = form.querySelector("#perm-string-perm");
      const current = hidden ? hidden.value || "" : "";
      const orig = form.dataset.origPerm || form.dataset.origPermCurrent || "";
      return current.trim() !== (orig || "").trim();
    } catch (e) {
      return true;
    }
  };

  // Change-detection initialization
  (function initUsersChangeDetection() {
    document.addEventListener("DOMContentLoaded", function () {
      // Edit modal save
      const editForm = document.getElementById("edit");
      if (editForm) {
        const saveBtn =
          editForm.parentElement &&
          editForm.parentElement.querySelector(".btn.btn-primary");
        // Fallback: find button inside form
        const btn = saveBtn || editForm.querySelector("button.btn.btn-primary");
        if (btn && !btn._usersEditBound) {
          btn._usersEditBound = true;
          btn.addEventListener("click", function () {
            if (!window.isEditChanged(editForm)) {
              closeModal("popup-edit");
              return;
            }
            submitUserFormAjax(editForm);
          });
        }
      }

      // Permissions modal save
      const permForm = document.getElementById("perm");
      if (permForm && !permForm._usersPermBound) {
        permForm._usersPermBound = true;
        permForm.addEventListener("submit", function (e) {
          e.preventDefault();
          if (!window.isPermChanged(permForm)) {
            closeModal("popup-perm");
            return;
          }
          // Ensure hidden fields are populated to satisfy backend (gid/integer)
          try {
            const rowId = permForm.dataset.rowId;
            const row = rowId ? document.getElementById(String(rowId)) : null;
            if (row) {
              const hidLogin = permForm.querySelector('input[name="login"]');
              const hidName = permForm.querySelector('input[name="name"]');
              const hidGroup = permForm.querySelector('input[name="group"]');
              const hidEnabled = permForm.querySelector(
                'input[name="enabled"]'
              );
              if (hidLogin) hidLogin.value = (row.dataset.login || "").trim();
              if (hidName) hidName.value = (row.dataset.name || "").trim();
              if (hidGroup) hidGroup.value = (row.dataset.gid || "").toString();
              if (hidEnabled)
                hidEnabled.value = row.dataset.enabled === "1" ? "1" : "0";
            }
          } catch (_) {}
          submitUserFormAjax(permForm);
          // Notify others explicitly (mirror files page pattern)
          try {
            if (window.socket && window.socket.emit) {
              window.socket.emit("users:changed", {
                reason: "perm",
                originClientId:
                  window.__usersClientId ||
                  (window.__usersClientId =
                    Math.random().toString(36).slice(2) + Date.now()),
              });
            }
          } catch (_) {}
        });
      }
    });
  })();

  // Function to refresh the users page after actions
  window.refreshUsersPage = function () {
    // Use soft refresh instead of full reload to avoid navigation logs
    try {
      window.softRefreshUsersTable && window.softRefreshUsersTable();
    } catch (_) {}
  };

  // Background-safe immediate refresh: fetch current page and replace tbody
  function backgroundImmediateUsersRefresh() {
    try {
      const table = document.getElementById("maintable");
      if (!table || !table.tBodies || !table.tBodies[0]) return;
      const tbodyEl = table.tBodies[0];
      const url = window.location.pathname + window.location.search;
      fetch(url, {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Cache-Control": "no-cache",
        },
      })
        .then(function (r) {
          return r.text();
        })
        .then(function (html) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const newTbody =
            doc.querySelector("#maintable tbody") ||
            doc.querySelector("table tbody") ||
            doc.querySelector("tbody");
          if (newTbody) {
            // Preserve search row if present
            const searchRow = tbodyEl.querySelector("tr#search");
            tbodyEl.innerHTML = newTbody.innerHTML;
            if (searchRow && !tbodyEl.querySelector("tr#search")) {
              tbodyEl.insertBefore(searchRow, tbodyEl.firstChild);
            }
            try {
              if (window.rebindUsersTable) window.rebindUsersTable();
            } catch (_) {}
            try {
              if (typeof reinitializeContextMenu === "function")
                reinitializeContextMenu();
            } catch (_) {}
          }
        })
        .catch(function () {});
    } catch (_) {}
  }

  // Passive polling when backgrounded (hidden or not-focused): refresh periodically
  (function setupUsersPassivePolling() {
    try {
      if (window.__usersPassivePollInit) return;
      window.__usersPassivePollInit = true;
      let pollTimer = null;
      function start() {
        if (pollTimer) return;
        pollTimer = setInterval(
          function () {
            try {
              backgroundImmediateUsersRefresh();
            } catch (_) {}
          },
          window.PASSIVE_POLL_SECONDS
            ? Number(window.PASSIVE_POLL_SECONDS) * 1000
            : 20000
        );
      }
      function stop() {
        if (!pollTimer) return;
        try {
          clearInterval(pollTimer);
        } catch (_) {}
        pollTimer = null;
      }
      function shouldPoll() {
        try {
          return document.hidden || !document.hasFocus();
        } catch (_) {
          return document.hidden;
        }
      }
      function handle() {
        if (shouldPoll()) start();
        else stop();
      }
      document.addEventListener("visibilitychange", handle);
      window.addEventListener("blur", handle);
      window.addEventListener("focus", handle);
      window.addEventListener("pagehide", stop);
      window.addEventListener("beforeunload", stop);
      // Initialize state
      handle();
    } catch (_) {}
  })();

  /**
   * Update user row in table locally without page refresh
   * @param {string|number} userId - The ID of the user to update
   * @param {Object} userData - Object containing user data to update
   * @param {string} [userData.name] - User's display name
   * @param {string} [userData.login] - User's login
   * @param {string} [userData.group] - User's group name
   * @param {boolean} [userData.enabled] - Whether user is enabled
   * @param {string} [userData.permissions] - User's permissions string
   */
  window.updateUserRowLocally = function (userId, userData) {
    try {
      const row = document.querySelector(`tr[data-id="${userId}"]`);
      if (!row) return;

      const cells = row.querySelectorAll("td");
      if (cells.length >= 6) {
        // Update name (column 0)
        if (userData.name !== undefined) {
          const nameSpan = cells[0].querySelector(".users-page__name");
          if (nameSpan) {
            nameSpan.textContent = userData.name;
          } else {
            const span = document.createElement("span");
            span.className = "users-page__name";
            span.textContent = userData.name;
            while (cells[0].firstChild)
              cells[0].removeChild(cells[0].firstChild);
            cells[0].appendChild(span);
          }
        }

        // Update login (column 1)
        if (userData.login !== undefined) {
          const loginSpan = cells[1].querySelector(".users-page__login");
          if (loginSpan) {
            loginSpan.textContent = userData.login;
          } else {
            const span = document.createElement("span");
            span.className = "users-page__login";
            span.textContent = userData.login;
            while (cells[1].firstChild)
              cells[1].removeChild(cells[1].firstChild);
            cells[1].appendChild(span);
          }
        }

        // Update group (column 2)
        if (userData.group !== undefined) {
          cells[2].textContent = userData.group;
        }

        // Update enabled status (column 3)
        if (userData.enabled !== undefined) {
          const enabledCell = cells[3];
          const toggle = enabledCell.querySelector(".form-check-input");
          if (toggle) {
            toggle.checked = userData.enabled;
          }
        }

        // Update permissions (column 4)
        if (userData.permissions !== undefined) {
          cells[4].textContent = userData.permissions;
        }
      }
    } catch (e) {
      console.error("Error updating user row locally:", e);
    }
  };

  /**
   * Add new user row to table locally without page refresh
   * @param {Object} userData - Object containing new user data
   * @param {string|number} userData.id - User's ID
   * @param {string} userData.name - User's display name
   * @param {string} userData.login - User's login
   * @param {string} userData.group - User's group name
   * @param {boolean} userData.enabled - Whether user is enabled
   * @param {string} userData.permissions - User's permissions string
   */
  window.addUserRowLocally = function (userData) {
    try {
      const tbody = document.querySelector("table tbody");
      if (!tbody) return;

      const newRow = document.createElement("tr");
      newRow.setAttribute("data-id", userData.id);
      newRow.innerHTML = `
        <td><span class="users-page__name">${userData.name || ""}</span></td>
        <td><span class="users-page__login">${userData.login || ""}</span></td>
        <td>${userData.group || ""}</td>
        <td>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" ${
              userData.enabled ? "checked" : ""
            } 
                   onclick="handleToggle(${userData.id}, this.checked)">
          </div>
        </td>
        <td>${userData.permissions || ""}</td>
        <td class="table__body_action">
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-edit" 
                  onclick="popupValues(document.getElementById('edit'), ${
                    userData.id
                  }); popupToggle('popup-edit');">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="topbtn d-inline-flex align-items-center table__body_action-perm" 
                  onclick="popupValues(document.getElementById('perm'), ${
                    userData.id
                  }); popupToggle('popup-perm');">
            <i class="bi bi-shield-check"></i>
          </button>
        </td>
      `;

      tbody.appendChild(newRow);

      // Update pagination if needed
      updatePaginationCounts();
    } catch (e) {
      console.error("Error adding user row locally:", e);
    }
  };

  /**
   * Remove user row from table locally without page refresh
   * @param {string|number} userId - The ID of the user to remove
   */
  window.removeUserRowLocally = function (userId) {
    try {
      const row = document.querySelector(`tr[data-id="${userId}"]`);
      if (row) {
        row.remove();
        // Update pagination if needed
        updatePaginationCounts();
      }
    } catch (e) {
      console.error("Error removing user row locally:", e);
    }
  };

  // Function to update pagination counts
  function updatePaginationCounts() {
    try {
      const tbody = document.querySelector("table tbody");
      if (!tbody) return;

      const totalRows = tbody.querySelectorAll("tr").length;
      const pageInfo = document.querySelector(".pagination-info");
      if (pageInfo) {
        // Update total count display
        pageInfo.textContent = `Всего записей: ${totalRows}`;
      }
    } catch (e) {
      console.error("Error updating pagination counts:", e);
    }
  }

  // Function to populate form with data from table row
  window.popupValues = function (form, rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    // Get data from row attributes
    const login = row.dataset.login || "";
    const name = row.dataset.name || "";
    const gid = row.dataset.gid || "";
    const enabled = row.dataset.enabled || "0";
    const perm = row.dataset.perm || "";

    // Fill form fields based on form ID
    if (form.id === "edit") {
      const loginInput = form.querySelector('input[name="login"]');
      const nameInput = form.querySelector('input[name="name"]');
      const groupSelect = form.querySelector('select[name="group"]');
      const enabledInput = form.querySelector('input[name="enabled"]');

      if (loginInput) loginInput.value = login;
      if (nameInput) nameInput.value = name;
      if (groupSelect) groupSelect.value = gid;
      if (enabledInput) enabledInput.checked = enabled === "1";

      // Update form action URL with correct ID (always replace trailing /<id>)
      if (form.action) {
        try {
          form.action = form.action.replace(/\/(\d+)$|\/0$/, "/" + rowId);
        } catch (_) {}
      }
      try {
        form.dataset.rowId = rowId;
      } catch (_) {}
    } else if (form.id === "perm") {
      // Ensure action URL targets selected user id
      if (form.action) {
        try {
          form.action = form.action.replace(/\/(\d+)$|\/0$/, "/" + rowId);
        } catch (_) {}
      }
      try {
        form.dataset.rowId = rowId;
      } catch (_) {}
    } else if (form.id === "reset") {
      // Update form action URL with correct ID
      if (form.action) {
        try {
          form.action = form.action.replace(/\/(\d+)$|\/0$/, "/" + rowId);
        } catch (_) {}
      }
      // Update reset confirmation text to show login
      try {
        const p = form.parentElement && form.parentElement.querySelector("p");
        if (p) {
          p.innerHTML = `Установить новый пароль для <b>${login}</b>`;
        }
      } catch (_) {}
    } else if (form.id === "delete") {
      // Update form action URL with correct ID
      if (form.action) {
        try {
          form.action = form.action.replace(/\/(\d+)$|\/0$/, "/" + rowId);
        } catch (_) {}
      }

      // Update delete confirmation text (show login). The <p> is a sibling outside the form
      try {
        const confirmText =
          form.parentElement && form.parentElement.querySelector("p");
        if (confirmText) {
          confirmText.innerHTML = `Вы действительно хотите удалить пользователя <b>${login}</b>?`;
        }
      } catch (_) {}
      // Ensure we store rowId for submit handler paths
      try {
        form.dataset.rowId = rowId;
      } catch (_) {}
    }
  };

  // Function to validate and submit user forms via AJAX
  window.validateForm = function (formElement) {
    // Find the form element
    const form = formElement.closest
      ? formElement.closest("form")
      : formElement.querySelector
      ? formElement.querySelector("form")
      : formElement.tagName === "FORM"
      ? formElement
      : null;

    if (!form) {
      console.error("Form not found");
      if (window.showToast) {
        window.showToast("Форма не найдена", "error");
      }
      return false;
    }

    // Client-side validation
    if (!validateUserForm(form)) {
      return false;
    }

    // For edit form, check if there are changes; force re-read original values from row
    if (form.id === "edit") {
      try {
        if (form.dataset.rowId) {
          // Refresh original values to allow consecutive edits
          const row = document.getElementById(String(form.dataset.rowId));
          if (row) {
            form.dataset.origLogin =
              row && row.dataset && row.dataset.login ? row.dataset.login : "";
            form.dataset.origName =
              row && row.dataset && row.dataset.name ? row.dataset.name : "";
            form.dataset.origGid =
              row && row.dataset && row.dataset.gid ? row.dataset.gid : "";
            const enabled =
              row && row.dataset && row.dataset.enabled
                ? row.dataset.enabled
                : "";
            form.dataset.origEnabled = enabled;
          }
        }
      } catch (_) {}
      if (!window.isEditChanged(form)) {
        try {
          popupClose("popup-edit");
        } catch (_) {}
        return false;
      }
    } else if (form.id === "perm") {
      // For permissions form, avoid submit if nothing changed
      if (!window.isPermChanged(form)) {
        try {
          popupClose("popup-perm");
        } catch (_) {}
        return false;
      }
      // Ensure hidden fields are populated (backend requires these)
      try {
        const rowId = form.dataset.rowId;
        const row = rowId ? document.getElementById(String(rowId)) : null;
        if (row) {
          const hidLogin = form.querySelector('input[name="login"]');
          const hidName = form.querySelector('input[name="name"]');
          const hidGroup = form.querySelector('input[name="group"]');
          const hidEnabled = form.querySelector('input[name="enabled"]');
          if (hidLogin) hidLogin.value = (row.dataset.login || "").trim();
          if (hidName) hidName.value = (row.dataset.name || "").trim();
          if (hidGroup) hidGroup.value = (row.dataset.gid || "").toString();
          if (hidEnabled)
            hidEnabled.value = row.dataset.enabled === "1" ? "1" : "0";
        }
      } catch (_) {}
    }

    // For permissions form, check if there are changes
    if (form.id === "perm") {
      if (!window.isPermChanged(form)) {
        try {
          popupClose("popup-perm");
        } catch (_) {}
        return false;
      }
      // Ensure required hidden fields are populated for backend
      try {
        const rowId = form.dataset.rowId;
        const row = rowId ? document.getElementById(String(rowId)) : null;
        if (row) {
          const hidLogin = form.querySelector('input[name="login"]');
          const hidName = form.querySelector('input[name="name"]');
          const hidGroup = form.querySelector('input[name="group"]');
          const hidEnabled = form.querySelector('input[name="enabled"]');
          if (hidLogin) hidLogin.value = (row.dataset.login || "").trim();
          if (hidName) hidName.value = (row.dataset.name || "").trim();
          if (hidGroup) hidGroup.value = (row.dataset.gid || "").toString();
          if (hidEnabled)
            hidEnabled.value = row.dataset.enabled === "1" ? "1" : "0";
        }
      } catch (_) {}
    }

    // Submit form via AJAX
    submitUserFormAjax(form);
    return false; // Prevent default form submission
  };

  // Function to validate user form fields
  function validateUserForm(form) {
    // Trim all input fields
    const inputs = form.querySelectorAll(
      'input[type="text"], input[type="password"], textarea'
    );
    inputs.forEach((input) => {
      if (input.value) {
        input.value = input.value.trim();
      }
    });

    // Check login field (for add and edit forms only; skip for perm)
    const loginInput = form.querySelector('input[name="login"]');
    if (loginInput && form.id !== "perm") {
      const login = loginInput.value.trim();
      if (!login || login.length === 0) {
        if (window.showToast) {
          window.showToast("Логин не может быть пустым", "error");
        } else {
          alert("Логин не может быть пустым");
        }
        loginInput.focus();
        return false;
      }
    }

    // Check name field (for add and edit forms only; skip for perm)
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput && form.id !== "perm") {
      const name = nameInput.value.trim();
      if (!name || name.length === 0) {
        if (window.showToast) {
          window.showToast("Имя не может быть пустым", "error");
        } else {
          alert("Имя не может быть пустым");
        }
        nameInput.focus();
        return false;
      }
    }

    // Check password field (for add and reset forms)
    const passwordInput = form.querySelector('input[name="password"]');
    if (passwordInput && (form.id === "add" || form.id === "reset")) {
      const password = passwordInput.value;
      if (!password || password.length === 0) {
        if (window.showToast) {
          window.showToast("Пароль не может быть пустым", "error");
        } else {
          alert("Пароль не может быть пустым");
        }
        passwordInput.focus();
        return false;
      }

      // Get minimum password length from config (fallback to 1)
      const minLength = window.CONFIG?.min_password_length || 1;
      if (password.length < minLength) {
        if (window.showToast) {
          window.showToast(
            `Пароль должен быть не менее ${minLength} символов`,
            "error"
          );
        } else {
          alert(`Пароль должен быть не менее ${minLength} символов`);
        }
        passwordInput.focus();
        return false;
      }
    }

    // Check password confirmation (for add and reset forms)
    if (form.id === "add" || form.id === "reset") {
      const passwordConfirmInput = form.querySelector(
        'input[name="password2"]'
      );
      if (passwordConfirmInput && passwordInput) {
        const password = passwordInput.value;
        const confirmPassword = passwordConfirmInput.value;
        if (password !== confirmPassword) {
          if (window.showToast) {
            window.showToast("Пароли не совпадают", "error");
          } else {
            alert("Пароли не совпадают");
          }
          passwordConfirmInput.focus();
          return false;
        }
      }
    }

    return true;
  }

  // Function to submit user forms via AJAX
  window.submitUserFormAjax = function (form) {
    // Use local helper that manages button disable/restore and throws on non-OK
    const submitter =
      typeof submitFormAjaxLocal === "function"
        ? submitFormAjaxLocal
        : window.submitFormAjax;
    if (typeof submitter !== "function") {
      console.error("No AJAX submit helper available");
      if (window.showToast) {
        window.showToast("Внутренняя ошибка: нет AJAX помощника", "error");
      }
      return false;
    }
    submitter(form)
      .then(() => {
        // Close modal first
        const modal = form.closest(".overlay-container");
        if (modal) {
          const modalId = modal.id;
          try {
            popupClose(modalId);
          } catch (e) {
            console.error("Error closing modal:", e);
          }
        } else {
          console.warn("Modal not found for form:", form.id);
        }

        // Update table locally instead of full page refresh
        try {
          if (form.id === "add") {
            // Soft refresh table to reflect new user
            try {
              window.softRefreshUsersTable && window.softRefreshUsersTable();
            } catch (_) {}
            // Emit users:changed with group for groups counter update
            try {
              const groupSelect = form.querySelector('select[name="group"]');
              const gid = groupSelect ? String(groupSelect.value) : undefined;
              if (window.socket && window.socket.emit) {
                window.socket.emit("users:changed", {
                  reason: "user-added",
                  gid: gid,
                  originClientId:
                    window.__usersClientId ||
                    (window.__usersClientId =
                      Math.random().toString(36).slice(2) + Date.now()),
                });
              }
            } catch (_) {}
          } else if (form.id === "edit") {
            // Update existing row locally and dataset to reflect latest changes
            const userId = form.dataset.rowId;
            if (userId) {
              const loginInput = form.querySelector('input[name="login"]');
              const nameInput = form.querySelector('input[name="name"]');
              const groupSelect = form.querySelector('select[name="group"]');
              const enabledInput = form.querySelector('input[name="enabled"]');

              const userData = {
                login: loginInput ? loginInput.value.trim() : undefined,
                name: nameInput ? nameInput.value.trim() : undefined,
                group: groupSelect
                  ? groupSelect.options[groupSelect.selectedIndex].text
                  : undefined,
                enabled: enabledInput ? enabledInput.checked : undefined,
              };

              updateUserRowLocally(userId, userData);
              // Also sync dataset attributes for consistency
              try {
                const row = document.querySelector(`tr[data-id="${userId}"]`);
                if (row) {
                  if (userData.login !== undefined)
                    row.dataset.login = userData.login;
                  if (userData.name !== undefined)
                    row.dataset.name = userData.name;
                  if (groupSelect)
                    row.dataset.groupname =
                      groupSelect.options[groupSelect.selectedIndex].text;
                  if (groupSelect) row.dataset.gid = groupSelect.value;
                  if (userData.enabled !== undefined)
                    row.dataset.enabled = userData.enabled ? "1" : "0";
                  // Also update orig* to enable immediate subsequent edits without reopening
                  try {
                    form.dataset.origLogin = row.dataset.login || "";
                    form.dataset.origName = row.dataset.name || "";
                    form.dataset.origGid = row.dataset.gid || "";
                    form.dataset.origEnabled = row.dataset.enabled || "";
                  } catch (_) {}
                }
              } catch (_) {}
              // Ensure table is refreshed (sorting/pagination) after edit
              try {
                window.softRefreshUsersTable && window.softRefreshUsersTable();
              } catch (_) {}
              // Emit detailed users:changed if group changed to update groups counters
              try {
                if (
                  groupSelect &&
                  String(form.dataset.origGid || "") !==
                    String(groupSelect.value || "")
                ) {
                  if (window.socket && window.socket.emit) {
                    window.socket.emit("users:changed", {
                      reason: "user-moved",
                      prevGid: String(form.dataset.origGid || ""),
                      newGid: String(groupSelect.value || ""),
                      originClientId:
                        window.__usersClientId ||
                        (window.__usersClientId =
                          Math.random().toString(36).slice(2) + Date.now()),
                    });
                  }
                }
              } catch (_) {}
            }
          } else if (form.id === "perm") {
            // Soft refresh to update computed labels
            try {
              window.softRefreshUsersTable && window.softRefreshUsersTable();
            } catch (_) {}
          } else if (form.id === "reset") {
            // Password reset doesn't change visible data, no update needed
          } else if (form.id === "delete") {
            // Remove the user row from table locally
            const userId =
              form.dataset.rowId || form.action.match(/\/(\d+)$/)?.[1];
            if (userId) {
              // Read gid before row removal to notify groups counters
              let gidForDelete;
              try {
                const row =
                  document.querySelector(`tr[data-id="${userId}"]`) ||
                  document.getElementById(String(userId));
                gidForDelete = row ? String(row.dataset.gid || "") : undefined;
              } catch (_) {}
              removeUserRowLocally(userId);
              // Emit users:changed with gid for groups counter update
              try {
                if (window.socket && window.socket.emit) {
                  window.socket.emit("users:changed", {
                    reason: "user-deleted",
                    gid: gidForDelete,
                    originClientId:
                      window.__usersClientId ||
                      (window.__usersClientId =
                        Math.random().toString(36).slice(2) + Date.now()),
                  });
                }
              } catch (_) {}
            } else {
              try {
                window.softRefreshUsersTable && window.softRefreshUsersTable();
              } catch (_) {}
            }
          } else {
            // Unknown form: prefer soft refresh over full reload
            try {
              window.softRefreshUsersTable && window.softRefreshUsersTable();
            } catch (_) {}
          }
        } catch (e) {
          console.error("Error updating table locally:", e);
          try {
            window.softRefreshUsersTable && window.softRefreshUsersTable();
          } catch (_) {}
        }

        // Generic emit for other cases (perm etc.)
        try {
          if (window.socket && window.socket.emit) {
            window.socket.emit("users:changed", {
              reason: "form-submit",
              formId: form.id,
              originClientId:
                window.__usersClientId ||
                (window.__usersClientId =
                  Math.random().toString(36).slice(2) + Date.now()),
            });
          }
        } catch (e) {}
      })
      .catch((err) => {
        try {
          const msg =
            err && err.message ? err.message : "Не удалось выполнить запрос";
          if (window.showToast) {
            window.showToast(msg, "error");
          } else {
            alert(msg);
          }
        } catch (_) {}
      });
  };

  // Initialize context menu for users page
  function initUsersContextMenu() {
    const table = document.getElementById("maintable");
    if (!table) return;

    // Get table permissions
    const canManage = table.getAttribute("data-can-manage") === "1";

    // Initialize unified context menu
    if (window.contextMenu) {
      window.contextMenu.init({
        page: "users",
        canManage: canManage,
      });
    } else {
      // Fallback: retry after a short delay
      setTimeout(() => {
        if (window.contextMenu) {
          window.contextMenu.init({
            page: "users",
            canManage: canManage,
          });
        }
      }, 100);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUsersContextMenu);
  } else {
    initUsersContextMenu();
  }

  // Global search cleaner handled by files.js
})();
