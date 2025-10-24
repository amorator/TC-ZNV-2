/**
 * Groups Page - Modular Version
 * Основной файл страницы групп, использующий модули
 */

// Initialize client ID for socket synchronization
window.__groupsClientId =
  window.__groupsClientId ||
  `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Initialize unified context menu for groups page
 */
function initGroupsContextMenu() {
  const table = document.getElementById("maintable");
  if (!table) return;

  const canManage = table.getAttribute("data-can-manage") === "1";

  if (window.contextMenu && window.contextMenu.init) {
    window.contextMenu.init({
      page: "groups",
      canManage: canManage,
      canAdd: canManage,
      canMarkView: false,
      canNotes: false,
    });
  }

  setupGroupManagement();
  setupTableInteractions();

  if (
    window.GroupsPermissions &&
    window.GroupsPermissions.enforceSystemGroupCollapse
  ) {
    window.GroupsPermissions.enforceSystemGroupCollapse();
  }
}

/**
 * Setup group management forms and handlers
 */
function setupGroupManagement() {
  // Setup create group form
  const createForm = document.getElementById("add");
  if (createForm) {
    const submitButton = createForm.querySelector(
      'button[data-testid="groups-add-submit"]'
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

  // Setup edit group form
  const editForm = document.getElementById("edit");
  if (editForm) {
    const submitButton = editForm.querySelector(
      'button[data-testid="groups-edit-save"]'
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
      'button[data-testid="groups-delete-confirm"]'
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

  // Bind copy handlers for group names
  bindCopy(
    "#maintable tbody .groups-page__name",
    "Клик — скопировать название"
  );
}

/**
 * Initialize pagination (server-side)
 */
function initGroupsPagination() {
  const table = document.getElementById("maintable");
  if (!table) return;

  const pager = document.getElementById("groups-pagination");
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
    const url = new URL(window.location.origin + "/groups/page");
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
        if (window.rebindGroupsTable) window.rebindGroupsTable();
      })
      .catch((error) =>
        window.ErrorHandler.handleError(error, "groupsPager.render")
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

    // Expose groupsPager for external use
    window.groupsPager = {
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
if (!window.groupsDoFilter) {
  window.groupsDoFilter = function groupsDoFilter(query) {
    const tableEl = document.getElementById("maintable");
    if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0])
      return Promise.resolve(false);

    const tbodyEl = tableEl.tBodies[0];
    const pager = document.getElementById("groups-pagination");
    const q = (query || "").trim();

    if (q.length === 0) {
      if (pager) pager.classList.remove("d-none");
      if (
        window.groupsPager &&
        typeof window.groupsPager.renderPage === "function"
      ) {
        window.groupsPager.renderPage(1);
      }
      return Promise.resolve(true);
    }

    if (q.length > 0) {
      if (pager) pager.classList.add("d-none");
      const url = new URL(window.location.origin + "/groups/search");
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

          if (window.rebindGroupsTable) window.rebindGroupsTable();
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
(function bindGroupsSearchEarly() {
  const bind = function () {
    const input = document.getElementById("searchinp");
    if (!input || input._groupsEarlyBound) return;
    input._groupsEarlyBound = true;

    const trigger = function () {
      const val = (input.value || "").trim();
      if (window.groupsDoFilter) {
        window.groupsDoFilter(val);
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
(function initGroupsSearchPersistence() {
  const input = document.getElementById("searchinp");
  if (!input) return;

  const key = "groups:search";
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
 * Click-to-copy group name
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
window.rebindGroupsTable = function () {
  bindCopy(
    "#maintable tbody .groups-page__name",
    "Клик — скопировать название"
  );
};

/**
 * Reinitialize context menu after table update
 */
function reinitializeContextMenu() {
  if (
    window.GroupsManagement &&
    window.GroupsManagement.reinitializeContextMenu
  ) {
    window.GroupsManagement.reinitializeContextMenu();
  }
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
}

/**
 * Handle row click
 * @param {Event} event - Click event
 */
function handleRowClick(event) {
  const groupId = this.id;
  if (groupId && groupId !== "search") {
    selectGroup(groupId);
  }
}

/**
 * Select group
 * @param {string} groupId - Group ID
 */
function selectGroup(groupId) {
  document.querySelectorAll(".selected-group").forEach((row) => {
    row.classList.remove("selected-group");
  });

  const groupRow = document.getElementById(groupId);
  if (groupRow) {
    groupRow.classList.add("selected-group");
  }

  updateGroupDetails(groupId);
}

/**
 * Update group details
 * @param {string} groupId - Group ID
 */
function updateGroupDetails(groupId) {
  const groupRow = document.getElementById(groupId);
  if (!groupRow) return;

  const name = groupRow.dataset.name || "";
  const description = groupRow.dataset.description || "";
  const isSystem = groupRow.dataset.isSystem === "1";

  const detailsPanel = document.getElementById("groupDetails");
  if (detailsPanel) {
    detailsPanel.innerHTML = `
      <h3>${name}</h3>
      <p>Описание: ${description || "—"}</p>
      <p>Тип: ${isSystem ? "Системная группа" : "Пользовательская группа"}</p>
    `;
  }
}

/**
 * Update group row
 * @param {string} groupId - Group ID
 */
function updateGroupRow(groupId) {
  if (
    window.GroupsManagement &&
    window.GroupsManagement.softRefreshGroupsTable
  ) {
    window.GroupsManagement.softRefreshGroupsTable(true);
  } else {
    window.location.reload();
  }
}

/**
 * Remove group row
 * @param {string} groupId - Group ID
 */
function removeGroupRow(groupId) {
  const groupRow = document.getElementById(groupId);
  if (groupRow) {
    groupRow.remove();
  }
}

/**
 * Setup socket synchronization
 */
function setupSocketSync() {
  if (window._socketSyncInitialized) return;
  window._socketSyncInitialized = true;

  if (window.SyncManager && typeof window.SyncManager.on === "function") {
    if (!window.__groupsSyncBound) {
      window.__groupsSyncBound = true;

      const joinRoomWhenReady = () => {
        if (window.SyncManager && window.SyncManager.isConnected()) {
          window.SyncManager.joinRoom("groups");
        } else {
          setTimeout(joinRoomWhenReady, 100);
        }
      };

      joinRoomWhenReady();

      window.SyncManager.on("groups:changed", (data) => {
        if (
          data.originClientId &&
          data.originClientId === window.__groupsClientId
        ) {
          return;
        }

        if (window.GroupsManagement && window.GroupsManagement.debouncedSync) {
          window.GroupsManagement.debouncedSync();
        }
      });
    }
  }
}

// Initialize page when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  const mainTable = document.getElementById("maintable");
  const tbody = mainTable && mainTable.tBodies && mainTable.tBodies[0];

  if (tbody && tbody.querySelectorAll("tr.table__body_row").length > 0) {
    setupGroupManagement();
    setupTableInteractions();

    const table = document.getElementById("maintable");
    if (table && window.contextMenu && window.contextMenu.init) {
      const canManage = table.getAttribute("data-can-manage") === "1";
      window.contextMenu.init({
        page: "groups",
        canManage: canManage,
        canAdd: canManage,
        canMarkView: false,
        canNotes: false,
      });
    }

    const pager = document.getElementById("groups-pagination");
    if (pager && !pager.innerHTML) {
      initGroupsPagination();
    }

    setupSocketSync();
  } else {
    initGroupsContextMenu();
    setupSocketSync();
  }
});

// Export functions to global scope
window.GroupsPage = {
  init: initGroupsContextMenu,
  selectGroup,
  updateGroupDetails,
};
