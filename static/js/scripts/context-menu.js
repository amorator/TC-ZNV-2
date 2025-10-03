/**
 * Unified Context Menu Module
 * Provides consistent context menu functionality across files and users pages
 */

(function() {
  'use strict';

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
      try {
        this.menu = document.getElementById('context-menu');
        if (!this.menu) return false;

        this.options = {
          page: options.page || 'files', // 'files' or 'users'
          canManage: options.canManage || false,
          canAdd: options.canAdd || false,
          canMarkView: options.canMarkView || false,
          canNotes: options.canNotes || false,
          ...options
        };

        this.setupEventListeners();
        this.isInitialized = true;
        return true;
      } catch (e) {
        console.error('Context menu initialization failed:', e);
        return false;
      }
    }

    /**
     * Setup event listeners for context menu
     */
    setupEventListeners() {
      // Context menu trigger
      document.addEventListener('contextmenu', (e) => {
        if (!this.isInitialized) return;
        this.handleContextMenu(e);
      });

      // Hide menu on click outside
      document.addEventListener('click', (e) => {
        if (e.button === 0) this.hideMenu();
      });

      // Hide menu on escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.hideMenu();
      });

      // Hide menu on scroll/resize
      window.addEventListener('scroll', () => this.hideMenu(), true);
      window.addEventListener('resize', () => this.hideMenu());

      // Menu item clicks
      this.menu.addEventListener('click', (e) => {
        this.handleMenuClick(e);
      });

      // Prevent native context menu on our menu
      this.menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      // Listen for reinitialization events
      document.addEventListener('context-menu-reinit', () => {
        this.reinitialize();
      });
    }

    /**
     * Handle context menu trigger
     * @param {MouseEvent} e - Mouse event
     */
    handleContextMenu(e) {
      if (!document.getElementById('maintable')) return; // not on correct page
      
      e.preventDefault();
      e.stopPropagation();
      
      const row = e.target.closest('tr.table__body_row');
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
      this.menu.classList.remove('d-none');
    }

    /**
     * Configure menu items visibility and state
     * @param {HTMLElement|null} row - Table row element
     */
    configureMenuItems(row) {
      const items = this.menu.querySelectorAll('.context-menu__item');
      
      // Hide all items first
      items.forEach(item => item.style.display = 'none');
      
      if (row) {
        // Configure items for specific row
        this.configureRowItems(row);
      } else {
        // Configure items for general actions (add, record)
        this.configureGeneralItems();
      }
    }

    /**
     * Configure menu items for a specific row
     * @param {HTMLElement} row - Table row element
     */
    configureRowItems(row) {
      const isEnabled = row.dataset.enabled === '1';
      const canEdit = row.dataset.canEdit === '1';
      const canDelete = row.dataset.canDelete === '1';
      const canNote = row.dataset.canNote === '1' && this.options.canNotes;
      const isReady = row.dataset.isReady !== '0';
      const hasDownload = !!row.dataset.download;
      const isMissing = row.dataset.exists === '0';
      const alreadyViewed = row.dataset.alreadyViewed === '1';
      const canRefresh = canEdit || canDelete;

      // Page-specific configuration
      if (this.options.page === 'files') {
        this.configureFilesRowItems(row, {
          isEnabled, canEdit, canDelete, canNote, isReady, 
          hasDownload, isMissing, alreadyViewed, canRefresh
        });
      } else if (this.options.page === 'users') {
        this.configureUsersRowItems(row, {
          isEnabled, canEdit, canDelete, canRefresh
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
        isEnabled, canEdit, canDelete, canNote, isReady, 
        hasDownload, isMissing, alreadyViewed, canRefresh
      } = permissions;

      if (isMissing) {
        // Only allow refresh and delete when file missing
        this.toggleItem('open', false);
        this.toggleItem('download', false);
        this.toggleItem('edit', false);
        this.toggleItem('move', false);
        this.toggleItem('delete', canDelete);
        this.toggleItem('note', false);
        this.toggleItem('mark-viewed', false);
        this.toggleItem('refresh', canRefresh);
      } else {
        this.toggleItem('open', isReady);
        this.toggleItem('download', hasDownload || isReady);
        this.toggleItem('edit', canEdit);
        this.toggleItem('move', isReady && canEdit);
        this.toggleItem('delete', canDelete);
        this.toggleItem('mark-viewed', isReady && this.options.canMarkView && !alreadyViewed);
        this.toggleItem('note', isReady && canNote);
        this.toggleItem('refresh', canRefresh);
      }

      // For processing files
      if (!isMissing && !isReady) {
        this.toggleItem('open', false);
        this.toggleItem('download', hasDownload);
        this.toggleItem('move', false);
        this.toggleItem('delete', canDelete);
        this.toggleItem('note', false);
        this.toggleItem('mark-viewed', false);
        this.toggleItem('edit', false);
      }

      this.toggleItem('add', this.options.canAdd);
      this.toggleItem('record', this.options.canAdd);
      this.toggleSeparator(true);
    }

    /**
     * Configure menu items for users page
     * @param {HTMLElement} row - Table row element
     * @param {Object} permissions - Permission flags
     */
    configureUsersRowItems(row, permissions) {
      const { isEnabled, canEdit, canDelete, canRefresh } = permissions;

      this.toggleItem('toggle', this.options.canManage);
      this.toggleItem('edit', canEdit);
      this.toggleItem('perm', canEdit);
      this.toggleItem('reset', canEdit);
      this.toggleItem('delete', canDelete);
      this.toggleItem('add', this.options.canManage);
      this.toggleSeparator(true);
    }

    /**
     * Configure general menu items (no row selected)
     */
    configureGeneralItems() {
      if (this.options.page === 'files') {
        this.toggleItem('open', false);
        this.toggleItem('download', false);
        this.toggleItem('edit', false);
        this.toggleItem('move', false);
        this.toggleItem('delete', false);
        this.toggleItem('mark-viewed', false);
        this.toggleItem('note', false);
        this.toggleItem('refresh', false);
        this.toggleItem('add', this.options.canAdd);
        this.toggleItem('record', this.options.canAdd);
        this.toggleSeparator(false);
      } else if (this.options.page === 'users') {
        this.toggleItem('toggle', false);
        this.toggleItem('edit', false);
        this.toggleItem('perm', false);
        this.toggleItem('reset', false);
        this.toggleItem('delete', false);
        this.toggleItem('add', this.options.canManage);
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
        element.style.display = show ? 'block' : 'none';
      }
    }

    /**
     * Toggle visibility of separator
     * @param {boolean} show - Show or hide
     */
    toggleSeparator(show) {
      const separator = this.menu.querySelector('.context-menu__separator');
      if (separator) {
        separator.style.display = show ? 'block' : 'none';
      }
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
      
      this.menu.style.left = px + 'px';
      this.menu.style.top = py + 'px';
    }

    /**
     * Handle menu item clicks
     * @param {Event} e - Click event
     */
    handleMenuClick(e) {
      const item = e.target.closest('.context-menu__item');
      if (!item) return;
      
      const action = item.dataset.action;
      if (!action) return;
      
      this.hideMenu();
      this.executeAction(action, this.currentRow);
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
      if (this.options.page === 'files') {
        this.executeFilesAction(action, row);
      } else if (this.options.page === 'users') {
        this.executeUsersAction(action, row);
      }
    }

    /**
     * Execute files page actions
     * @param {string} action - Action name
     * @param {HTMLElement|null} row - Table row element
     */
    executeFilesAction(action, row) {
      const id = row?.getAttribute('data-id');
      const url = row?.getAttribute('data-url');
      const download = row?.getAttribute('data-download');

      switch (action) {
        case 'open':
          if (url) {
            const player = document.getElementById('player-video');
            if (player) {
              try { player.pause(); } catch(e) {}
              player.src = url;
              try { player.currentTime = 0; } catch(e) {}
              
              player.onerror = function() {
                console.error('Video load error for file:', id);
                if (window.markFileAsMissing) {
                  window.markFileAsMissing(id);
                }
                const modal = document.getElementById('popup-view');
                if (modal && window.popupClose) {
                  window.popupClose('popup-view');
                }
              };
              
              if (window.popupToggle) {
                window.popupToggle('popup-view');
              }
            }
          }
          break;

        case 'download':
          if (download) {
            fetch(download, { method: 'HEAD' })
              .then(response => {
                if (response.ok) {
                  window.open(download, '_blank');
                } else {
                  console.error('Download error for file:', id);
                  if (window.markFileAsMissing) {
                    window.markFileAsMissing(id);
                  }
                }
              })
              .catch(error => {
                console.error('Download fetch error:', error);
              });
          }
          break;

        case 'edit':
          if (id && window.openModal) {
            window.openModal('edit', id);
          }
          break;

        case 'delete':
          if (id && window.openModal) {
            window.openModal('delete', id);
          }
          break;

        case 'move':
          if (id && window.openModal) {
            window.openModal('move', id);
          }
          break;

        case 'refresh':
          if (id) {
            const refreshUrl = `${window.location.origin}${window.location.pathname}/refresh/${id}`;
            fetch(refreshUrl, { method: 'POST' })
              .then(response => {
                if (response.ok) {
                  if (window.softRefreshFilesTable) {
                    window.softRefreshFilesTable();
                  }
                }
              })
              .catch(error => {
                console.error('Refresh error:', error);
              });
          }
          break;

        case 'mark-viewed':
          if (id) {
            const markUrl = `${window.location.origin}${window.location.pathname}/mark-viewed/${id}`;
            fetch(markUrl, { method: 'POST' })
              .then(response => {
                if (response.ok) {
                  if (window.softRefreshFilesTable) {
                    window.softRefreshFilesTable();
                  }
                }
              })
              .catch(error => {
                console.error('Mark viewed error:', error);
              });
          }
          break;

        case 'note':
          if (id && window.openModal) {
            window.openModal('note', id);
          }
          break;

        case 'add':
          if (window.openModal) {
            window.openModal('add');
          }
          break;

        case 'record':
          if (window.openModal) {
            window.openModal('record');
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
        case 'add':
          if (window.openModal) {
            window.openModal('add');
          }
          break;

        case 'toggle':
          if (rowId) {
            const toggleUrl = `${window.location.origin}${window.location.pathname.replace(/\/srs.*/, '/srs')}/toggle/${rowId}`;
            fetch(toggleUrl, { method: 'POST', credentials: 'include' })
              .then(response => {
                if (response.ok) {
                  if (row) {
                    const currentEnabled = row.dataset.enabled === '1';
                    const newEnabled = !currentEnabled;
                    row.dataset.enabled = newEnabled ? '1' : '0';
                    
                    const toggleCell = row.querySelector('td[data-enabled]');
                    if (toggleCell) {
                      toggleCell.textContent = newEnabled ? 'Да' : 'Нет';
                      toggleCell.dataset.enabled = newEnabled ? '1' : '0';
                    }
                  }
                }
              })
              .catch(error => {
                console.error('Toggle error:', error);
              });
          }
          break;

        case 'edit':
          if (rowId && window.openModal) {
            window.openModal('edit', rowId);
          }
          break;

        case 'perm':
          if (rowId && window.openModal) {
            window.openModal('perm', rowId);
          }
          break;

        case 'reset':
          if (rowId && window.openModal) {
            window.openModal('reset', rowId);
          }
          break;

        case 'delete':
          if (rowId && window.openModal) {
            window.openModal('delete', rowId);
          }
          break;
      }
    }

    /**
     * Hide context menu
     */
    hideMenu() {
      if (this.menu) {
        this.menu.classList.add('d-none');
      }
      this.currentRow = null;
    }

    /**
     * Reinitialize context menu after table updates
     */
    reinitialize() {
      if (!this.isInitialized) return;
      
      try {
        // Re-bind event listeners
        this.setupEventListeners();
      } catch (e) {
        console.error('Context menu reinitialization failed:', e);
      }
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
  
  // Auto-initialize if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.contextMenu = new ContextMenuManager();
    });
  } else {
    window.contextMenu = new ContextMenuManager();
  }
})();
