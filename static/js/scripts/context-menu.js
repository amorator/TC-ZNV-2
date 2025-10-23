/**
 * Unified Context Menu Module
 * Provides consistent context menu functionality across files and users pages
 */

(function () {
  "use strict";

  /**
   * Unified context menu manager
   */
  class ContextMenuManager {
    constructor() {
      this.menu = null;
      this.currentRow = null;
      this.actionHandlers = new Map();
      this.isInitialized = false;
    }

    /**
     * Initialize the context menu system
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
      // Prevent double initialization
      if (this.isInitialized) {
        this.updateOptions(options);
        return true;
      }

      try {
        this.menu = document.getElementById("context-menu");
        if (!this.menu) {
          return false;
        }

        this.options = {
          page: options.page || "files", // 'files' or 'users'
          canManage: options.canManage || false,
          canAdd: options.canAdd || false,
          canMarkView: options.canMarkView || false,
          canNotes: options.canNotes || false,
          ...options,
        };

        this.setupEventListeners();
        this.isInitialized = true;
        return true;
      } catch (e) {
        console.error("Context menu initialization failed:", e);
        return false;
      }
    }

    /**
     * Setup event listeners for context menu
     */
    setupEventListeners() {
      // Prevent multiple setups
      if (this._listenersSetup) return;
      this._listenersSetup = true;

      // Context menu trigger
      document.addEventListener("contextmenu", (e) => {
        if (!this.isInitialized) return;
        this.handleContextMenuEvent(e);
      });

      // Hide menu on click outside
      document.addEventListener("click", (e) => {
        if (e.button === 0) this.hideMenu();
      });

      // Hide menu on escape
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.hideMenu();
      });

      // Hide menu on scroll/resize
      window.addEventListener("scroll", () => this.hideMenu(), true);
      window.addEventListener("resize", () => this.hideMenu());

      // Menu item clicks
      this.menu.addEventListener("click", (e) => {
        this.handleMenuClick(e);
      });

      // Prevent native context menu on our menu
      this.menu.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      // Listen for reinitialization events
      document.addEventListener("context-menu-reinit", () => {
        this.reinitialize();
      });

      // Listen for modal close events to reinitialize context menu
      document.addEventListener("click", (e) => {
        // Check if modal close button was clicked
        if (
          e.target.classList.contains("btn-secondary") &&
          e.target.textContent.includes("Отмена")
        ) {
          setTimeout(() => {
            this.reinitialize();
          }, 100);
        }
      });

      // Listen for form submission events
      document.addEventListener("submit", (e) => {
        setTimeout(() => {
          this.reinitialize();
        }, 100);
      });
    }

    /**
     * Handle context menu trigger
     * @param {MouseEvent} e - Mouse event
     */
    handleContextMenuEvent(e) {
      if (!document.getElementById("maintable")) {
        return; // not on correct page
      }

      e.preventDefault();
      e.stopPropagation();

      const row = e.target.closest("tr.table__body_row");
      this.showMenu(e, row);
    }

    /**
     * Show context menu at cursor position
     * @param {MouseEvent} e - Mouse event
     * @param {HTMLElement|null} row - Table row element
     */
    showMenu(e, row) {
      this.currentRow = row;

      // Configure menu items based on row and permissions
      this.configureMenuItems(row);

      // Position menu
      this.positionMenu(e.clientX, e.clientY);

      // Show menu
      this.menu.classList.remove("d-none");
    }

    /**
     * Configure menu items visibility and state
     * @param {HTMLElement|null} row - Table row element
     */
    configureMenuItems(row) {
      const items = this.menu.querySelectorAll(".context-menu__item");

      // Hide all items first
      items.forEach((item) => (item.style.display = "none"));

      if (row) {
        // Configure items for specific row
        this.configureRowItems(row);
      } else {
        // Configure items for general actions (add, record)
        this.configureGeneralItems();
      }

      // If after configuration no visible items left, show a disabled info item
      const anyVisible = Array.from(
        this.menu.querySelectorAll(".context-menu__item")
      ).some((el) => el.style.display !== "none");
      if (!anyVisible) {
        this.showNoPermissionsItem();
      }
    }

    /**
     * Configure menu items for a specific row
     * @param {HTMLElement} row - Table row element
     */
    configureRowItems(row) {
      const isEnabled = row.dataset.enabled === "1";
      const canEdit = row.dataset.canEdit === "1";
      const canDelete = row.dataset.canDelete === "1";
      const canNote = row.dataset.canNote === "1" && this.options.canNotes;
      const isReady = row.dataset.isReady !== "0";
      const hasDownload = !!row.dataset.download;
      const isMissing = row.dataset.exists === "0";
      const alreadyViewed = row.dataset.alreadyViewed === "1";
      const canRefresh = canEdit || canDelete;

      // Page-specific configuration
      if (this.options.page === "files") {
        this.configureFilesRowItems(row, {
          isEnabled,
          canEdit,
          canDelete,
          canNote,
          isReady,
          hasDownload,
          isMissing,
          alreadyViewed,
          canRefresh,
        });
      } else if (this.options.page === "users") {
        this.configureUsersRowItems(row, {
          isEnabled,
          canEdit,
          canDelete,
          canRefresh,
        });
      } else if (this.options.page === "groups") {
        this.configureGroupsRowItems(row, {
          canEdit,
          canDelete,
        });
      }
    }

    /**
     * Configure menu items for files page
     * @param {HTMLElement} row - Table row element
     * @param {Object} permissions - Permission flags
     */
    configureFilesRowItems(row, permissions) {
      const {
        isEnabled,
        canEdit,
        canDelete,
        canNote,
        isReady,
        hasDownload,
        isMissing,
        alreadyViewed,
        canRefresh,
      } = permissions;

      if (isMissing) {
        // Only allow refresh and delete when file missing
        this.toggleItem("open", false);
        this.toggleItem("download", false);
        this.toggleItem("edit", false);
        this.toggleItem("move", false);
        this.toggleItem("delete", canDelete);
        this.toggleItem("note", false);
        this.toggleItem("mark-viewed", false);
        this.toggleItem("refresh", canRefresh);
      } else {
        this.toggleItem("open", isReady);
        this.toggleItem("download", hasDownload || isReady);
        this.toggleItem("edit", canEdit);
        this.toggleItem("move", isReady && canEdit);
        this.toggleItem("delete", canDelete);
        this.toggleItem(
          "mark-viewed",
          isReady && this.options.canMarkView && !alreadyViewed
        );
        this.toggleItem("note", isReady && canNote);
        this.toggleItem("refresh", canRefresh);
      }

      // For processing files
      if (!isMissing && !isReady) {
        this.toggleItem("open", false);
        this.toggleItem("download", hasDownload);
        this.toggleItem("move", false);
        this.toggleItem("delete", canDelete);
        this.toggleItem("note", false);
        this.toggleItem("mark-viewed", false);
        this.toggleItem("edit", false);
      }

      this.toggleItem("add", this.options.canAdd);
      this.toggleItem("record", this.options.canAdd);
      this.toggleSeparator(true);
    }

    /**
     * Configure menu items for users page
     * @param {HTMLElement} row - Table row element
     * @param {Object} permissions - Permission flags
     */
    configureUsersRowItems(row, permissions) {
      const loginVal = (row.dataset.login || "").toLowerCase();
      // Only protect the built-in admin user; others are editable even if they have admin rights
      const isProtectedAdmin = loginVal === "admin";
      const canManage = !!this.options.canManage;
      const canEdit = canManage && !isProtectedAdmin;
      const canPerm = canManage && !isProtectedAdmin;
      const canDelete = canManage && !isProtectedAdmin;

      // Toggle visibility for protected admin
      this.toggleItem("toggle", canManage && !isProtectedAdmin);

      // Update toggle text based on current state (non-admin only)
      if (canManage && !isProtectedAdmin) {
        const toggleElement = this.menu.querySelector('[data-action="toggle"]');
        if (toggleElement) {
          const enabledNow = row.dataset.enabled === "1";
          toggleElement.textContent = enabledNow ? "Выключить" : "Включить";
        }
      }

      // Admin: only allow reset + keep standard Add available
      if (isProtectedAdmin) {
        this.toggleItem("edit", false);
        this.toggleItem("perm", false);
        this.toggleItem("reset", canManage);
        this.toggleItem("delete", false);
        this.toggleItem("add", canManage);
        this.toggleSeparator(true);
        return;
      }

      // Regular users
      this.toggleItem("edit", canEdit);
      this.toggleItem("perm", canPerm);
      this.toggleItem("reset", canManage);
      this.toggleItem("delete", canDelete);
      this.toggleItem("add", canManage);
      this.toggleSeparator(true);
    }

    /**
     * Configure menu items for groups page
     * @param {HTMLElement} row - Table row element
     * @param {Object} permissions - Permission flags
     */
    configureGroupsRowItems(row, permissions) {
      const isSystem = row.dataset.isSystem === "1";
      const canManage = !!this.options.canManage;
      const canEdit = canManage && !isSystem;
      const canDelete = canManage && !isSystem;

      // System groups cannot be edited or deleted
      this.toggleItem("edit", canEdit);
      this.toggleItem("delete", canDelete);
      this.toggleItem("add", canManage);
      this.toggleSeparator(true);

      // Show message if no actions available
      if (!canEdit && !canDelete && !canManage) {
        this.toggleItem("no-permissions", true);
      }
    }

    /**
     * Configure general menu items (no row selected)
     */
    configureGeneralItems() {
      if (this.options.page === "files") {
        this.toggleItem("open", false);
        this.toggleItem("download", false);
        this.toggleItem("edit", false);
        this.toggleItem("move", false);
        this.toggleItem("delete", false);
        this.toggleItem("mark-viewed", false);
        this.toggleItem("note", false);
        this.toggleItem("refresh", false);
        this.toggleItem("add", this.options.canAdd);
        this.toggleItem("record", this.options.canAdd);
        // Optional: import from registrator (rendered only when available)
        const hasImport = !!this.menu.querySelector(
          '[data-action="import-registrator"]'
        );
        this.toggleItem("import-registrator", hasImport && this.options.canAdd);
        this.toggleSeparator(false);
      } else if (this.options.page === "users") {
        this.toggleItem("toggle", false);
        this.toggleItem("edit", false);
        this.toggleItem("perm", false);
        this.toggleItem("reset", false);
        this.toggleItem("delete", false);
        this.toggleItem("add", this.options.canManage);
        this.toggleSeparator(false);
      } else if (this.options.page === "groups") {
        this.toggleItem("edit", false);
        this.toggleItem("delete", false);
        this.toggleItem("add", this.options.canManage);
        this.toggleSeparator(false);
      }
    }

    /**
     * Toggle visibility of a menu item
     * @param {string} action - Action name
     * @param {boolean} show - Show or hide
     */
    toggleItem(action, show) {
      const element = this.menu.querySelector(`[data-action="${action}"]`);
      if (element) {
        element.style.display = show ? "block" : "none";
      }
    }

    /**
     * Toggle visibility of separator
     * @param {boolean} show - Show or hide
     */
    toggleSeparator(show) {
      const separator = this.menu.querySelector(".context-menu__separator");
      if (separator) {
        separator.style.display = show ? "block" : "none";
      }
    }

    /**
     * Ensure a single disabled item indicating no permissions is visible
     */
    showNoPermissionsItem() {
      let infoItem = this.menu.querySelector('[data-action="no-perms"]');
      if (!infoItem) {
        infoItem = document.createElement("li");
        infoItem.className = "context-menu__item disabled";
        infoItem.setAttribute("data-action", "no-perms");
        infoItem.style.pointerEvents = "none";
        infoItem.style.opacity = "0.7";
        infoItem.textContent = "Нет разрешений вносить изменения";
        const list =
          this.menu.querySelector(".context-menu__list") || this.menu;
        list.appendChild(infoItem);
      }
      infoItem.style.display = "block";
      this.toggleSeparator(false);
    }

    /**
     * Position menu at cursor coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    positionMenu(x, y) {
      const margin = 4;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = this.menu.getBoundingClientRect();

      let px = x;
      let py = y;

      // Adjust if menu would overflow
      if (px + rect.width + margin > vw) {
        px = Math.max(vw - rect.width - margin, margin);
      }
      if (py + rect.height + margin > vh) {
        py = Math.max(vh - rect.height - margin, margin);
      }

      this.menu.style.left = px + "px";
      this.menu.style.top = py + "px";
    }

    /**
     * Handle menu item clicks
     * @param {Event} e - Click event
     */
    handleMenuClick(e) {
      const item = e.target.closest(".context-menu__item");
      if (!item) {
        return;
      }

      const action = item.dataset.action;
      if (!action) {
        return;
      }
      // Store current row before hiding menu
      const currentRow = this.currentRow;
      this.hideMenu();
      this.executeAction(action, currentRow);
    }

    /**
     * Execute context menu action
     * @param {string} action - Action name
     * @param {HTMLElement|null} row - Table row element
     */
    executeAction(action, row) {
      // Store current row ID for action handlers
      if (row) {
        this.menu.dataset.targetId = row.id || row.dataset.id;
      }

      // Execute action based on page type
      if (this.options.page === "files") {
        this.executeFilesAction(action, row);
      } else if (this.options.page === "users") {
        this.executeUsersAction(action, row);
      } else if (this.options.page === "groups") {
        this.executeGroupsAction(action, row);
      }
    }

    /**
     * Execute files page actions
     * @param {string} action - Action name
     * @param {HTMLElement|null} row - Table row element
     */
    executeFilesAction(action, row) {
      const id = row?.getAttribute("data-id");
      const url = row?.getAttribute("data-url");
      const download = row?.getAttribute("data-download");

      switch (action) {
        case "open":
          if (url) {
            try {
              if (window.stopAllMedia) window.stopAllMedia();
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            if (!window.__mediaOpenState) {
              window.__mediaOpenState = { opening: false };
            }
            if (window.__mediaOpenState.opening) return;
            window.__mediaOpenState.opening = true;
            const isAudio = (url || "").toLowerCase().endsWith(".m4a");
            if (isAudio) {
              const audio = document.getElementById("player-audio");
              if (audio) {
                try {
                  audio.pause();
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                try {
                  const v = document.getElementById("player-video");
                  if (v) {
                    try {
                      v.pause && v.pause();
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      v.onerror = null;
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      v.removeAttribute("src");
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                audio.muted = false;
                audio.volume = 1;
                // Stop any video that may be playing (avoid setting empty src)
                try {
                  const v = document.getElementById("player-video");
                  if (v) {
                    try {
                      v.pause && v.pause();
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      v.onerror = null;
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      v.removeAttribute("src");
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                audio.src = url;
                try {
                  audio.currentTime = 0;
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                audio.onerror = function onAudioErr() {
                  try {
                    audio.onerror = null;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  if (window.popupClose) {
                    window.popupClose("popup-audio");
                  }
                  try {
                    window.__mediaOpenState.opening = false;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                };
                audio.onloadeddata = function () {
                  try {
                    window.__mediaOpenState.opening = false;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                };
                if (window.popupToggle) {
                  window.popupToggle("popup-audio");
                }
              }
            } else {
              const player = document.getElementById("player-video");
              if (player) {
                try {
                  player.pause();
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                try {
                  const a = document.getElementById("player-audio");
                  if (a) {
                    try {
                      a.pause && a.pause();
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      a.onerror = null;
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      a.removeAttribute("src");
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                player.muted = false;
                player.volume = 1;
                // Stop any audio that may be playing (avoid setting empty src)
                try {
                  const a = document.getElementById("player-audio");
                  if (a) {
                    try {
                      a.pause && a.pause();
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      a.onerror = null;
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                    try {
                      a.removeAttribute("src");
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                player.src = url;
                try {
                  player.currentTime = 0;
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                player.onerror = function onVideoErr() {
                  try {
                    player.onerror = null;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  if (window.popupClose) {
                    window.popupClose("popup-view");
                  }
                  try {
                    window.__mediaOpenState.opening = false;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                };
                player.onloadeddata = function () {
                  try {
                    window.__mediaOpenState.opening = false;
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                };
                if (window.popupToggle) {
                  window.popupToggle("popup-view");
                }
              }
            }
          }
          break;

        case "download":
          if (download) {
            // Create a temporary link element for download
            const link = document.createElement("a");
            link.href = download;
            link.download = ""; // This forces download instead of opening
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
          break;

        case "edit":
          if (id && window.popupToggle && window.popupValues) {
            const form = document.getElementById("edit");
            if (form) {
              try {
                window.popupValues(form, id);
              } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            }
            try {
              window.popupToggle("popup-edit", id);
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
          } else {
            // Missing required functions or ID
          }
          break;

        case "delete":
          if (id && window.popupToggle && window.popupValues) {
            const form = document.getElementById("delete");
            if (form) {
              window.popupValues(form, id);
            }
            window.popupToggle("popup-delete", id);
          }
          break;

        case "move":
          if (id && window.popupToggle && window.popupValues) {
            const form = document.getElementById("move");
            if (form) {
              window.popupValues(form, id);
            }
            window.popupToggle("popup-move", id);
          }
          break;

        case "import-registrator":
          try {
            window.openRegistratorImport && window.openRegistratorImport();
          } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
          break;

        case "refresh":
          if (id) {
            const refreshUrl = `/files/refresh/${id}`;
            fetch(refreshUrl, {
              method: "POST",
              credentials: "include",
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                Accept: "application/json",
              },
            })
              .then(async (response) => {
                let data = null;
                try {
                  data = await response.json();
                } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                if (
                  data &&
                  data.file_exists === false &&
                  typeof window.markFileAsMissing === "function"
                ) {
                  try {
                    const input = document.getElementById("searchinp");
                    const q =
                      input && typeof input.value === "string"
                        ? input.value.trim()
                        : "";
                    if (q && typeof window.filesDoFilter === "function") {
                      // wait for DOM to update with search results, then mark
                      try {
                        await window.filesDoFilter(q);
                        window.markFileAsMissing(id);
                      } catch (_) {
                        window.markFileAsMissing(id);
                      }
                    } else {
                      window.markFileAsMissing(id);
                    }
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                }
                if (response.ok) {
                  // After server refresh, respect active search; otherwise re-render current page
                  setTimeout(() => {
                    this.currentRow = null;
                    this.isInitialized = true;
                    try {
                      const input = document.getElementById("searchinp");
                      const q =
                        input && typeof input.value === "string"
                          ? input.value.trim()
                          : "";
                      if (q && typeof window.filesDoFilter === "function") {
                        window.filesDoFilter(q);
                      } else if (
                        window.filesPager &&
                        typeof window.filesPager.readPage === "function" &&
                        typeof window.filesPager.renderPage === "function"
                      ) {
                        window.filesPager.renderPage(
                          window.filesPager.readPage()
                        );
                      } else if (
                        typeof window.softRefreshFilesTable === "function"
                      ) {
                        window.softRefreshFilesTable();
                      }
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }, 100);
                }
              })
              .catch((error) => {
                console.error("Refresh error:", error);
              });
          }
          break;

        case "mark-viewed":
          if (id) {
            // Use row-provided view URL (GET route) for consistency
            const row =
              document.querySelector(`tr[data-id="${id}"]`) ||
              document.getElementById(String(id));
            const url = row && row.getAttribute("data-view-url");
            if (url) {
              fetch(url, { method: "GET", credentials: "include" })
                .then(() => {
                  setTimeout(() => {
                    this.currentRow = null;
                    this.isInitialized = true;
                    try {
                      window.softRefreshFilesTable &&
                        window.softRefreshFilesTable();
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }, 50);
                })
                .catch((error) => {
                  console.error("Mark viewed error:", error);
                });
            }
          }
          break;

        case "note":
          if (id && window.popupToggle && window.popupValues) {
            const form = document.getElementById("note");
            if (form) {
              window.popupValues(form, id);
            }
            window.popupToggle("popup-note", id);
          }
          break;

        case "add":
          if (window.openModal) {
            try {
              if (window.modalManager) window.modalManager.activeModal = null;
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            window.openModal("popup-add");
          } else if (window.popupToggle) {
            window.popupToggle("popup-add");
          }
          break;

        case "record":
          // Always use popupToggle so recorder iframe src is initialized lazily
          if (window.popupToggle) {
            try {
              if (window.modalManager) window.modalManager.activeModal = null;
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            window.popupToggle("popup-rec");
          }
          break;
      }
    }

    /**
     * Execute users page actions
     * @param {string} action - Action name
     * @param {HTMLElement|null} row - Table row element
     */
    executeUsersAction(action, row) {
      const rowId = row?.id;

      switch (action) {
        case "add":
          // Use openModal to avoid stale activeModal toggle issues
          if (window.openModal) {
            try {
              if (window.modalManager) {
                window.modalManager.activeModal = null;
              }
              const addModal = document.getElementById("popup-add");
              if (addModal) {
                const addForm = addModal.querySelector("form");
                if (addForm && typeof addForm.reset === "function") {
                  addForm.reset();
                }
              }
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            window.openModal("popup-add");
          } else if (window.popupToggle) {
            window.popupToggle("popup-add");
          }
          break;

        case "toggle":
          if (rowId) {
            const toggleUrl = `${window.location.origin}/users/toggle/${rowId}`;
            const clientId = window.__usersClientId || "";
            fetch(toggleUrl, {
              method: "GET",
              credentials: "same-origin",
              headers: {
                "X-Requested-With": "fetch",
                Accept: "application/json",
                "X-Client-Id": clientId,
              },
            })
              .then((response) => {
                if (response.ok) {
                  if (row) {
                    const currentEnabled = row.dataset.enabled === "1";
                    const newEnabled = !currentEnabled;
                    row.dataset.enabled = newEnabled ? "1" : "0";

                    const toggleCell = row.querySelector("td[data-enabled]");
                    if (toggleCell) {
                      toggleCell.setAttribute(
                        "data-enabled",
                        newEnabled ? "1" : "0"
                      );
                      toggleCell.dataset.enabled = newEnabled ? "1" : "0";

                      // Update icon classes
                      const icon = toggleCell.querySelector(".bi");
                      if (icon) {
                        icon.classList.remove("bi-toggle-on", "bi-toggle-off");
                        icon.classList.add(
                          newEnabled ? "bi-toggle-on" : "bi-toggle-off"
                        );
                      }
                    }
                  }

                  // Reinitialize context menu after state change
                  setTimeout(() => {
                    if (this.reinitialize) {
                      this.reinitialize();
                    }
                  }, 100);
                }
              })
              .catch((error) => {
                console.error("Toggle error:", error);
              });
          }
          break;

        case "edit":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("edit");
            if (form) {
              window.popupValues(form, rowId);
            }
            window.popupToggle("popup-edit", rowId);
          }
          break;

        case "perm":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("perm");
            if (form) {
              window.popupValues(form, rowId);
              try {
                if (window.syncPermFormFromRow) {
                  window.syncPermFormFromRow(form, rowId);
                  // re-sync on next tick after modal layout
                  setTimeout(function () {
                    try {
                      window.syncPermFormFromRow(form, rowId);
                    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                  }, 0);
                }
                // Ensure Full Access checkbox reflects hidden value
                setTimeout(function () {
                  try {
                    if (window.refreshPermissionUI) {
                      window.refreshPermissionUI("perm-string-perm");
                    } else if (window["refreshPermUI_perm-string-perm"]) {
                      window["refreshPermUI_perm-string-perm"]();
                    }
                  } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
                }, 0);
              } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            }
            window.popupToggle("popup-perm", rowId);
          }
          break;

        case "reset":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("reset");
            if (form) {
              window.popupValues(form, rowId);
            }
            window.popupToggle("popup-reset", rowId);
          }
          break;

        case "delete":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("delete");
            if (form) {
              window.popupValues(form, rowId);
            }
            window.popupToggle("popup-delete", rowId);
          }
          break;
      }
    }

    /**
     * Execute groups page actions
     * @param {string} action - Action name
     * @param {HTMLElement|null} row - Table row element
     */
    executeGroupsAction(action, row) {
      const rowId = row?.id;

      switch (action) {
        case "add":
          // Use openModal to avoid stale activeModal toggle issues
          if (window.openModal) {
            try {
              if (window.modalManager) {
                window.modalManager.activeModal = null;
              }
              const addModal = document.getElementById("popup-add");
              if (addModal) {
                const addForm = addModal.querySelector("form");
                if (addForm && typeof addForm.reset === "function") {
                  addForm.reset();
                }
              }
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
            window.openModal("popup-add");
          } else if (window.popupToggle) {
            window.popupToggle("popup-add");
          }
          break;

        case "edit":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("edit");
            if (form) {
              window.popupValues(form, rowId);
            }
            window.popupToggle("popup-edit", rowId);
          }
          break;

        case "delete":
          if (rowId && window.popupToggle && window.popupValues) {
            const form = document.getElementById("delete");
            if (form) {
              window.popupValues(form, rowId);
            }
            window.popupToggle("popup-delete", rowId);
          }
          break;
      }
    }

    /**
     * Hide context menu
     */
    hideMenu() {
      if (this.menu) {
        this.menu.classList.add("d-none");
      }
      this.currentRow = null;
    }

    /**
     * Reinitialize context menu after table updates
     */
    reinitialize() {
      if (!this.isInitialized) {
        return;
      }

      // Prevent multiple simultaneous reinitializations
      if (this._reinitializing) {
        return;
      }
      this._reinitializing = true;

      try {
        // Reset state
        this.currentRow = null;
        this.hideMenu();

        // Reset listeners setup flag to allow re-setup
        this._listenersSetup = false;

        // Use requestIdleCallback for non-blocking reinitialization
        if (window.requestIdleCallback) {
          window.requestIdleCallback(
            () => {
              try {
                this.setupEventListeners();
              } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    } finally {
                this._reinitializing = false;
              }
            },
            { timeout: 1000 }
          );
        } else {
          // Fallback: use setTimeout with small delay
          setTimeout(() => {
            try {
              this.setupEventListeners();
            } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    } finally {
              this._reinitializing = false;
            }
          }, 10);
        }
      } catch (e) {
        console.error("Context menu reinitialization failed:", e);
        this._reinitializing = false;
      }
    }

    /**
     * Remove event listeners to prevent duplicates
     */
    removeEventListeners() {
      // Note: We can't remove anonymous event listeners easily
      // The reinitialize function will work by just re-adding listeners
      // This is a simplified approach - in production you'd want to store references
    }

    /**
     * Update options (permissions, etc.)
     * @param {Object} options - New options
     */
    updateOptions(options) {
      this.options = { ...this.options, ...options };
    }
  }

  // Create global instance
  window.ContextMenuManager = ContextMenuManager;
  window.contextMenu = new ContextMenuManager();
})();
