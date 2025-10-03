/**
 * Unified Table Management Module
 * Provides common table functionality for files and users pages
 */

(function() {
  'use strict';

  /**
   * Table Manager Class
   */
  class TableManager {
    constructor() {
      this.tables = new Map();
      this.refreshCallbacks = new Map();
    }

    /**
     * Register a table for management
     * @param {string} tableId - Table element ID
     * @param {Object} options - Configuration options
     */
    registerTable(tableId, options = {}) {
      const table = document.getElementById(tableId);
      if (!table) return false;

      const config = {
        pageType: options.pageType || 'files', // 'files' or 'users'
        refreshEndpoint: options.refreshEndpoint || null,
        refreshCallback: options.refreshCallback || null,
        smoothUpdate: options.smoothUpdate !== false,
        ...options
      };

      this.tables.set(tableId, {
        element: table,
        config: config,
        lastRefresh: Date.now()
      });

      if (config.refreshCallback) {
        this.refreshCallbacks.set(tableId, config.refreshCallback);
      }

      return true;
    }

    /**
     * Get table element by ID
     * @param {string} tableId - Table element ID
     * @returns {HTMLTableElement|null}
     */
    getTable(tableId = 'maintable') {
      const tableData = this.tables.get(tableId);
      return tableData ? tableData.element : document.getElementById(tableId);
    }

    /**
     * Get selected row from event target
     * @param {Element} target - Event target element
     * @returns {HTMLElement|null}
     */
    getSelectedRow(target) {
      const row = target.closest('tr.table__body_row');
      return row && row.id ? row : null;
    }

    /**
     * Smooth update table body content
     * @param {HTMLTableSectionElement} oldTbody - Old tbody element
     * @param {HTMLTableSectionElement} newTbody - New tbody element
     */
    smoothUpdateTableBody(oldTbody, newTbody) {
      if (!oldTbody || !newTbody) return;

      const oldRows = Array.from(oldTbody.querySelectorAll('tr'));
      const newRows = Array.from(newTbody.querySelectorAll('tr'));
      
      // Create maps for efficient lookup
      const oldRowMap = new Map();
      const newRowMap = new Map();
      
      oldRows.forEach(row => {
        const id = row.id || row.getAttribute('data-id');
        if (id) oldRowMap.set(id, row);
      });
      
      newRows.forEach(row => {
        const id = row.id || row.getAttribute('data-id');
        if (id) newRowMap.set(id, row);
      });

      // Update existing rows
      for (const [id, newRow] of newRowMap) {
        const oldRow = oldRowMap.get(id);
        if (oldRow) {
          // Update existing row in place
          oldRow.replaceWith(newRow);
        } else {
          // Add new row
          oldTbody.appendChild(newRow);
        }
      }

      // Remove deleted rows
      for (const [id, oldRow] of oldRowMap) {
        if (!newRowMap.has(id)) {
          oldRow.remove();
        }
      }
    }

    /**
     * Soft refresh table content
     * @param {string} tableId - Table element ID
     * @param {Object} options - Refresh options
     */
    async softRefreshTable(tableId = 'maintable', options = {}) {
      const tableData = this.tables.get(tableId);
      if (!tableData) return false;

      const { element: table, config } = tableData;
      const tbody = table.querySelector('tbody');
      if (!tbody) return false;

      try {
        // Use custom refresh callback if provided
        if (config.refreshCallback) {
          await config.refreshCallback();
          return true;
        }

        // Use default refresh endpoint
        if (config.refreshEndpoint) {
          const response = await fetch(config.refreshEndpoint, {
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });

          if (!response.ok) return false;

          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const newTbody = doc.querySelector(`#${tableId} tbody`);

          if (newTbody) {
            if (config.smoothUpdate) {
              this.smoothUpdateTableBody(tbody, newTbody);
            } else {
              tbody.innerHTML = newTbody.innerHTML;
            }
          }
        }

        // Update last refresh time
        tableData.lastRefresh = Date.now();
        return true;
      } catch (error) {
        console.error('Table refresh error:', error);
        return false;
      }
    }

    /**
     * Bind row click handlers
     * @param {string} tableId - Table element ID
     * @param {Function} clickHandler - Click handler function
     */
    bindRowHandlers(tableId = 'maintable', clickHandler) {
      const table = this.getTable(tableId);
      if (!table) return;

      // Remove existing handlers
      table.removeEventListener('click', this._rowClickHandler);
      
      // Add new handler
      this._rowClickHandler = (e) => {
        const row = this.getSelectedRow(e.target);
        if (row && clickHandler) {
          clickHandler(e, row);
        }
      };
      
      table.addEventListener('click', this._rowClickHandler);
    }

    /**
     * Update pagination counts
     * @param {string} tableId - Table element ID
     */
    updatePaginationCounts(tableId = 'maintable') {
      const table = this.getTable(tableId);
      if (!table) return;

      const tbody = table.querySelector('tbody');
      if (!tbody) return;

      const visibleRows = Array.from(tbody.querySelectorAll('tr.table__body_row'))
        .filter(row => row.style.display !== 'none');

      // Update count displays
      const countElements = document.querySelectorAll('.table-count, .pagination-count');
      countElements.forEach(el => {
        if (el.textContent.includes('файл') || el.textContent.includes('пользовател')) {
          el.textContent = el.textContent.replace(/\d+/, visibleRows.length);
        }
      });
    }

    /**
     * Search/filter table rows
     * @param {string} tableId - Table element ID
     * @param {string} query - Search query
     * @param {Object} options - Search options
     */
    filterTable(tableId = 'maintable', query, options = {}) {
      const table = this.getTable(tableId);
      if (!table) return;

      const {
        maxResults = 30,
        searchColumns = null, // null = search all columns
        caseSensitive = false
      } = options;

      const tbody = table.querySelector('tbody');
      if (!tbody) return;

      const rows = Array.from(tbody.querySelectorAll('tr.table__body_row'));
      const searchQuery = caseSensitive ? query : query.toUpperCase();
      let shown = 0;

      rows.forEach((row) => {
        let match = false;
        
        if (searchColumns) {
          // Search specific columns
          searchColumns.forEach(colIndex => {
            const cell = row.children[colIndex];
            if (cell) {
              const cellText = caseSensitive ? cell.innerText : cell.innerText.toUpperCase();
              if (cellText.includes(searchQuery)) match = true;
            }
          });
        } else {
          // Search all columns
          Array.from(row.children).forEach((cell) => {
            const cellText = caseSensitive ? cell.innerText : cell.innerText.toUpperCase();
            if (cellText.includes(searchQuery)) match = true;
          });
        }

        if (match && shown < maxResults) {
          row.style.display = 'table-row';
          shown++;
        } else {
          row.style.display = 'none';
        }
      });

      // Update pagination
      this.updatePaginationCounts(tableId);
    }

    /**
     * Clear table filters
     * @param {string} tableId - Table element ID
     */
    clearFilters(tableId = 'maintable') {
      const table = this.getTable(tableId);
      if (!table) return;

      const tbody = table.querySelector('tbody');
      if (!tbody) return;

      const rows = tbody.querySelectorAll('tr.table__body_row');
      rows.forEach(row => {
        row.style.display = 'table-row';
      });

      this.updatePaginationCounts(tableId);
    }

    /**
     * Get table data as array of objects
     * @param {string} tableId - Table element ID
     * @returns {Array} Array of row data objects
     */
    getTableData(tableId = 'maintable') {
      const table = this.getTable(tableId);
      if (!table) return [];

      const tbody = table.querySelector('tbody');
      if (!tbody) return [];

      const rows = tbody.querySelectorAll('tr.table__body_row');
      return Array.from(rows).map(row => {
        const data = {
          id: row.id || row.getAttribute('data-id'),
          cells: Array.from(row.children).map(cell => cell.innerText.trim())
        };

        // Add data attributes
        Array.from(row.attributes).forEach(attr => {
          if (attr.name.startsWith('data-')) {
            data[attr.name] = attr.value;
          }
        });

        return data;
      });
    }

    /**
     * Reinitialize table after updates
     * @param {string} tableId - Table element ID
     */
    reinitializeTable(tableId = 'maintable') {
      const tableData = this.tables.get(tableId);
      if (!tableData) return;

      const { config } = tableData;
      
      // Trigger context menu reinitialization
      if (window.contextMenu) {
        window.contextMenu.reinitialize();
      }

      // Trigger table update event
      document.dispatchEvent(new CustomEvent('table-updated', {
        detail: { tableId, timestamp: Date.now() }
      }));

      // Update pagination counts
      this.updatePaginationCounts(tableId);
    }
  }

  // Create global instance
  window.TableManager = TableManager;
  window.tableManager = new TableManager();
})();

