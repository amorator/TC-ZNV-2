/**
 * Users Page - Modular Version
 * Основной файл страницы пользователей, использующий модули
 */

// Initialize client ID for socket synchronization
window.__usersClientId =
  window.__usersClientId ||
  `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Initialize unified context menu for users page
 */
function initUsersContextMenu() {
  const table = document.getElementById("maintable");
  if (!table) return;

  const canManage = table.getAttribute("data-can-manage") === "1";

  if (window.contextMenu && window.contextMenu.init) {
    window.contextMenu.init({
      page: "users",
      canManage: canManage,
      canAdd: canManage,
      canMarkView: false,
      canNotes: false,
    });
  }

  setupUserManagement();
  setupPermissions();
  setupTableInteractions();

  if (window.UsersPermissions && window.UsersPermissions.enforceAdminCollapse) {
    window.UsersPermissions.enforceAdminCollapse();
  }
}

/**
 * Setup user management forms and handlers
 */
function setupUserManagement() {
  // Setup create user form
  const createForm = document.getElementById("add");
  if (createForm) {
    const submitButton = createForm.querySelector(
      'button[data-testid="users-add-submit"]'
    );
    if (submitButton) {
      submitButton.removeAttribute("onclick");
      submitButton.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.validateForm) {
          window.validateForm(this);
        }
      });
    }
  }

  // Setup edit user form
  const editForm = document.getElementById("edit");
  if (editForm) {
    const submitButton = editForm.querySelector(
      'button[data-testid="users-edit-save"]'
    );
    if (submitButton) {
      submitButton.removeAttribute("onclick");
      submitButton.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.validateForm) {
          window.validateForm(this);
        }
      });
    }
  }

  // Setup permission form
  const permForm = document.getElementById("perm");
  if (permForm) {
    const submitButton = permForm.querySelector(
      'button[data-testid="users-perm-save"]'
    );
    if (submitButton) {
      submitButton.removeAttribute("onclick");
      submitButton.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.validateForm) {
          window.validateForm(this);
        }
      });
    }
  }

  // Setup reset password form
  const resetForm = document.getElementById("reset");
  if (resetForm) {
    const submitButton = resetForm.querySelector(
      'button[data-testid="users-reset-save"]'
    );
    if (submitButton) {
      submitButton.removeAttribute("onclick");
      submitButton.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.validateForm) {
          window.validateForm(this);
        }
      });
    }
  }

  // Setup delete form
  const deleteForm = document.getElementById("delete");
  if (deleteForm) {
    const submitButton = deleteForm.querySelector(
      'button[data-testid="users-delete-confirm"]'
    );
    if (submitButton) {
      submitButton.removeAttribute("onclick");
      submitButton.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.validateForm) {
          window.validateForm(this);
        }
      });
    }
  }

  // Bind copy handlers for login and name
  bindCopy("#maintable tbody .users-page__login", "Клик — скопировать логин");
  bindCopy("#maintable tbody .users-page__name", "Клик — скопировать имя");
}

/**
 * Initialize pagination (server-side)
 */
function initUsersPagination() {
  const table = document.getElementById("maintable");
  if (!table) return;

  const pager = document.getElementById("users-pagination");
  const tbody = table.tBodies && table.tBodies[0];
  if (!pager || !tbody) return;

  // Don't reinitialize if table already has data and pagination is working
  if (
    pager.innerHTML &&
    tbody.querySelectorAll("tr.table__body_row").length > 0
  ) {
    return;
  }

  const pageSize = 15;

  function render(page) {
    const url = new URL(window.location.origin + "/users/page");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("t", String(Date.now()));

    fetch(String(url), {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then((r) => (r.ok ? r.json() : { html: "", total: 0, page: 1 }))
      .then((j) => {
        if (!j || typeof j.html !== "string") return;

        const searchRow = tbody.querySelector("tr#search");
        const temp = document.createElement("tbody");
        temp.innerHTML = j.html;

        Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
          if (!searchRow || tr !== searchRow) tr.remove();
        });

        Array.from(temp.children).forEach((tr) => {
          tbody.appendChild(tr);
        });

        // Verify that all new rows have proper CSS classes
        const allRows = tbody.querySelectorAll("tr");
        const rowsWithoutClass = Array.from(allRows).filter(
          (row) => !row.id && !row.classList.contains("table__body_row")
        );

        if (rowsWithoutClass.length > 0) {
          rowsWithoutClass.forEach((row) => {
            if (!row.id) {
              row.classList.add("table__body_row");
            }
          });
        }

        const total = j.total || 0;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const page = j.page || 1;

        const btn = (label, targetPage, disabled = false, extraClass = "") =>
          `<li class="page-item ${extraClass} ${
            disabled ? "disabled" : ""
          }"><a class="page-link" href="#" data-page="${targetPage}">${label}</a></li>`;

        const items = [];
        items.push(btn("⏮", 1, page === 1, "first"));
        items.push(btn("‹", Math.max(1, page - 1), page === 1, "prev"));
        items.push(
          `<li class="page-item ${
            page === 1 ? "active" : ""
          }"><a class="page-link" href="#" data-page="1">1</a></li>`
        );

        const leftStart = Math.max(2, page - 2);
        const leftGap = leftStart - 2;
        if (leftGap >= 1) {
          items.push(
            `<li class="page-item disabled"><span class="page-link">…</span></li>`
          );
        }

        const midStart = Math.max(2, page - 2);
        const midEnd = Math.min(pages - 1, page + 2);
        for (let p = midStart; p <= midEnd; p++) {
          items.push(
            `<li class="page-item ${
              p === page ? "active" : ""
            }"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`
          );
        }

        const rightEnd = Math.min(pages - 1, page + 2);
        const rightGap = pages - 1 - rightEnd;
        if (rightGap >= 1) {
          items.push(
            `<li class="page-item disabled"><span class="page-link">…</span></li>`
          );
        }

        if (pages > 1) {
          items.push(
            `<li class="page-item ${
              page === pages ? "active" : ""
            }"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`
          );
        }

        items.push(btn("›", Math.min(pages, page + 1), page === pages, "next"));
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

        reinitializeContextMenu();
        if (window.rebindUsersTable) window.rebindUsersTable();
      })
      .catch((error) =>
        window.ErrorHandler.handleError(error, "usersPager.render")
      );
  }

  // If table has data but no pagination, initialize pagination without reloading table
  if (tbody.querySelectorAll("tr.table__body_row").length > 0) {
    const total = tbody.querySelectorAll("tr.table__body_row").length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = 1;

    const btn = (label, targetPage, disabled = false, extraClass = "") =>
      `<li class="page-item ${extraClass} ${
        disabled ? "disabled" : ""
      }"><a class="page-link" href="#" data-page="${targetPage}">${label}</a></li>`;

    const items = [];
    items.push(btn("⏮", 1, page === 1, "first"));
    items.push(btn("‹", Math.max(1, page - 1), page === 1, "prev"));
    items.push(
      `<li class="page-item ${
        page === 1 ? "active" : ""
      }"><a class="page-link" href="#" data-page="1">1</a></li>`
    );

    const leftStart = Math.max(2, page - 2);
    const leftGap = leftStart - 2;
    if (leftGap >= 1) {
      items.push(
        `<li class="page-item disabled"><span class="page-link">…</span></li>`
      );
    }

    const midStart = Math.max(2, page - 2);
    const midEnd = Math.min(pages - 1, page + 2);
    for (let p = midStart; p <= midEnd; p++) {
      items.push(
        `<li class="page-item ${
          p === page ? "active" : ""
        }"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`
      );
    }

    const rightEnd = Math.min(pages - 1, page + 2);
    const rightGap = pages - 1 - rightEnd;
    if (rightGap >= 1) {
      items.push(
        `<li class="page-item disabled"><span class="page-link">…</span></li>`
      );
    }

    if (pages > 1) {
      items.push(
        `<li class="page-item ${
          page === pages ? "active" : ""
        }"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`
      );
    }

    items.push(btn("›", Math.min(pages, page + 1), page === pages, "next"));
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

    // Expose usersPager for external use
    window.usersPager = {
      renderPage: render,
      readPage: () => 1,
    };

    return;
  }

  render(1);
}

/**
 * Global search function
 */
if (!window.usersDoFilter) {
  window.usersDoFilter = function usersDoFilter(query) {
    const tableEl = document.getElementById("maintable");
    if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0])
      return Promise.resolve(false);

    const tbodyEl = tableEl.tBodies[0];
    const pager = document.getElementById("users-pagination");
    const q = (query || "").trim();

    if (q.length === 0) {
      if (pager) pager.classList.remove("d-none");
      if (
        window.usersPager &&
        typeof window.usersPager.renderPage === "function"
      ) {
        window.usersPager.renderPage(1);
      }
      return Promise.resolve(true);
    }

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

          Array.from(tbodyEl.querySelectorAll("tr")).forEach((tr) => {
            if (!searchRow || tr !== searchRow) tr.remove();
          });

          Array.from(temp.children).forEach((tr) => {
            tbodyEl.appendChild(tr);
          });

          if (window.rebindUsersTable) window.rebindUsersTable();
          if (typeof reinitializeContextMenu === "function")
            reinitializeContextMenu();

          return true;
        })
        .catch(() => false);
    }
  };
}

/**
 * Bind search input early
 */
(function bindUsersSearchEarly() {
  const bind = function () {
    const input = document.getElementById("searchinp");
    if (!input || input._usersEarlyBound) return;
    input._usersEarlyBound = true;

    const trigger = function () {
      const val = (input.value || "").trim();
      if (window.usersDoFilter) {
        window.usersDoFilter(val);
      }
    };

    input.addEventListener("input", trigger);
    input.addEventListener("keyup", trigger);
    input.addEventListener("change", trigger);

    setTimeout(trigger, 0);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("load", () => setTimeout(bind, 0));
  document.addEventListener("table-updated", () => setTimeout(bind, 0));

  let attempts = 0;
  const iv = setInterval(() => {
    attempts += 1;
    bind();
    if (attempts >= 10) clearInterval(iv);
  }, 200);
})();

/**
 * Search persistence and clear button
 */
(function initUsersSearchPersistence() {
  const input = document.getElementById("searchinp");
  if (!input) return;

  const key = "users:search";
  const saved = (() => {
    try {
      return localStorage.getItem(key) || "";
    } catch (_) {
      return "";
    }
  })();

  if (saved) {
    input.value = saved;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    window.addEventListener("load", () => {
      setTimeout(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 0);
    });
  }

  input.addEventListener("input", (e) => {
    const v = (e.target.value || "").trim();
    try {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch (_) {}
  });

  window.searchClean = function () {
    const el = document.getElementById("searchinp");
    if (el) {
      el.value = "";
      el.focus();
    }
    try {
      localStorage.removeItem(key);
    } catch (_) {}
    if (el) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
})();

/**
 * Click-to-copy login similar to files name
 * @param {string} selector - CSS selector
 * @param {string} title - Tooltip title
 */
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
          .catch(() => {
            try {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.setAttribute("readonly", "");
              ta.style.position = "absolute";
              ta.style.left = "-9999px";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
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
          document.body.removeChild(ta);
          onDone();
        } catch (_) {}
      }
    });
  });
}

/**
 * Expose a rebind helper to refresh per-row handlers after tbody replacement
 */
window.rebindUsersTable = function () {
  bindCopy("#maintable tbody .users-page__login", "Клик — скопировать логин");
  bindCopy("#maintable tbody .users-page__name", "Клик — скопировать имя");
};

/**
 * Reinitialize context menu after table update
 */
function reinitializeContextMenu() {
  if (
    window.UsersManagement &&
    window.UsersManagement.reinitializeContextMenu
  ) {
    window.UsersManagement.reinitializeContextMenu();
  }
}

/**
 * Setup permissions
 */
function setupPermissions() {
  const permissionSelects = document.querySelectorAll(".permission-select");
  permissionSelects.forEach((select) => {
    select.addEventListener("change", function () {
      const userId = this.getAttribute("data-user-id");
      const permission = this.getAttribute("data-permission");
      const value = this.value;

      if (
        window.UsersPermissions &&
        window.UsersPermissions.updateUserPermissions
      ) {
        window.UsersPermissions.updateUserPermissions(userId, {
          [permission]: value,
        });
      }
    });
  });
}

/**
 * Setup table interactions
 */
function setupTableInteractions() {
  const tableRows = document.querySelectorAll("#maintable tbody tr[id]");
  tableRows.forEach((row) => {
    row.removeEventListener("click", handleRowClick);
    row.addEventListener("click", handleRowClick);
  });

  setupToggleHandlers();
}

/**
 * Handle row click
 * @param {Event} event - Click event
 */
function handleRowClick(event) {
  const userId = this.id;
  if (userId && userId !== "search") {
    selectUser(userId);
  }
}

/**
 * Setup toggle handlers
 */
function setupToggleHandlers() {
  const toggleIcons = document.querySelectorAll(
    "#maintable tbody tr td[data-enabled] i"
  );
  toggleIcons.forEach((icon) => {
    icon.removeEventListener("click", handleToggleClick);
    icon.addEventListener("click", handleToggleClick);
  });
}

/**
 * Handle toggle click
 * @param {Event} e - Click event
 */
function handleToggleClick(e) {
  e.stopPropagation();

  const row = this.closest("tr");
  if (!row) return;

  const userId = row.id;
  const currentEnabled = row.dataset.enabled === "1";
  const newEnabled = !currentEnabled;

  toggleUserStatus(userId, newEnabled);
}

/**
 * Toggle user status
 * @param {string} userId - User ID
 * @param {boolean} enabled - New enabled state
 */
function toggleUserStatus(userId, enabled) {
  const row = document.getElementById(userId);
  if (!row) return;

  const toggleIcon = row.querySelector("td[data-enabled] i");
  if (toggleIcon) {
    toggleIcon.className = "bi bi-hourglass-split";
  }

  const formData = new FormData();
  formData.append("enabled", enabled ? "1" : "0");

  fetch(`/users/toggle/${userId}`, {
    method: "POST",
    body: formData,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-Client-Id": window.__usersClientId || "unknown",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.status === "success") {
        row.dataset.enabled = enabled ? "1" : "0";
        if (toggleIcon) {
          toggleIcon.className = enabled
            ? "bi bi-toggle-on"
            : "bi bi-toggle-off";
        }

        if (window.notify) {
          window.notify(
            `Пользователь ${enabled ? "включен" : "отключен"}`,
            "success"
          );
        }
      } else {
        throw new Error(
          data.message || "Ошибка при изменении статуса пользователя"
        );
      }
    })
    .catch((err) => {
      const currentEnabled = row.dataset.enabled === "1";
      if (toggleIcon) {
        toggleIcon.className = currentEnabled
          ? "bi bi-toggle-on"
          : "bi bi-toggle-off";
      }
      window.ErrorHandler.handleError(err, "toggleUserStatus");
    });
}

/**
 * Setup socket synchronization
 */
function setupSocketSync() {
  if (window._socketSyncInitialized) return;
  window._socketSyncInitialized = true;

  if (window.SyncManager && typeof window.SyncManager.on === "function") {
    if (!window.__usersSyncBound) {
      window.__usersSyncBound = true;

      let joinAttempts = 0;
      const maxJoinAttempts = 50;
      const joinRoomWhenReady = () => {
        if (window.SyncManager && window.SyncManager.isConnected()) {
          window.SyncManager.joinRoom("users");
        } else if (joinAttempts < maxJoinAttempts) {
          joinAttempts++;
          setTimeout(joinRoomWhenReady, 100);
        }
      };

      joinRoomWhenReady();

      window.SyncManager.on("users:changed", (data) => {
        if (
          data.originClientId &&
          data.originClientId === window.__usersClientId
        ) {
          return;
        }

        if (window.UsersManagement && window.UsersManagement.debouncedSync) {
          window.UsersManagement.debouncedSync();
        }
      });
    }
  }
}

/**
 * Select user
 * @param {string} userId - User ID
 */
function selectUser(userId) {
  document.querySelectorAll(".selected-user").forEach((row) => {
    row.classList.remove("selected-user");
  });

  const userRow = document.getElementById(userId);
  if (userRow) {
    userRow.classList.add("selected-user");
  }

  updateUserDetails(userId);
}

/**
 * Update user details
 * @param {string} userId - User ID
 */
function updateUserDetails(userId) {
  const userRow = document.getElementById(userId);
  if (!userRow) return;

  const login = userRow.dataset.login || "";
  const name = userRow.dataset.name || "";
  const group = userRow.dataset.groupname || "";
  const enabled = userRow.dataset.enabled === "1";
  const isAdmin = userRow.dataset.isAdmin === "1";
  const fullAccess = userRow.dataset.fullAccess === "1";

  const detailsPanel = document.getElementById("userDetails");
  if (detailsPanel) {
    detailsPanel.innerHTML = `
      <h3>${name}</h3>
      <p>Логин: ${login}</p>
      <p>Группа: ${group}</p>
      <p>Статус: ${enabled ? "Активен" : "Отключен"}</p>
      <p>Права: ${
        isAdmin
          ? "Администратор"
          : fullAccess
          ? "Полный доступ"
          : "Обычные права"
      }</p>
    `;
  }
}

/**
 * Update user row
 * @param {string} userId - User ID
 */
function updateUserRow(userId) {
  if (window.UsersManagement && window.UsersManagement.softRefreshUsersTable) {
    window.UsersManagement.softRefreshUsersTable(true);
  }
}

/**
 * Remove user row
 * @param {string} userId - User ID
 */
function removeUserRow(userId) {
  const userRow = document.getElementById(userId);
  if (userRow) {
    userRow.remove();
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  const mainTable = document.getElementById("maintable");
  const tbody = mainTable && mainTable.tBodies && mainTable.tBodies[0];

  if (tbody && tbody.querySelectorAll("tr.table__body_row").length > 0) {
    setupUserManagement();
    setupPermissions();
    setupTableInteractions();

    const table = document.getElementById("maintable");
    if (table && window.contextMenu && window.contextMenu.init) {
      const canManage = table.getAttribute("data-can-manage") === "1";
      window.contextMenu.init({
        page: "users",
        canManage: canManage,
        canAdd: canManage,
        canMarkView: false,
        canNotes: false,
      });
    }

    const pager = document.getElementById("users-pagination");
    if (pager && !pager.innerHTML) {
      initUsersPagination();
    }

    setupSocketSync();
    return;
  }

  initUsersContextMenu();
  setupSocketSync();
});

// Export functions to global scope
window.UsersPage = {
  init: initUsersContextMenu,
  selectUser,
  updateUserDetails,
  toggleUserStatus,
};
