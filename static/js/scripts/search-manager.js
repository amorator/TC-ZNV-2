/**
 * Unified Search Management Module
 * Provides common search functionality for files and users pages
 */

(function () {
  "use strict";

  /**
   * Search Manager Class
   */
  class SearchManager {
    constructor() {
      this.searchInputs = new Map();
      this.searchHistory = new Map();
      this.currentQuery = "";
      this.init();
    }

    /**
     * Initialize search manager
     */
    init() {
      // Listen for global search events
      document.addEventListener("search-query", (e) => {
        this.handleSearch(e.detail.query, e.detail.options);
      });

      // Listen for clear search events
      document.addEventListener("search-clear", () => {
        this.clearSearch();
      });

      // Auto-register common search inputs on DOM ready
      const onReady = () => {
        try {
          // Generic id used on multiple pages
          const generic = document.getElementById("searchinp");
          if (generic) {
            this.registerSearchInput("searchinp");
          }
          // Users page
          const u = document.getElementById("users-search");
          if (u) {
            this.registerSearchInput("users-search", { tableId: "maintable" });
          }
          // Groups page
          const g = document.getElementById("groups-search");
          if (g) {
            this.registerSearchInput("groups-search", { tableId: "maintable" });
          }
        } catch (_) {}
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
      } else {
        onReady();
      }
    }

    /**
     * Register search input
     * @param {string} inputId - Search input element ID
     * @param {Object} options - Search options
     */
    registerSearchInput(inputId, options = {}) {
      const input = document.getElementById(inputId);
      if (!input) return false;

      const config = {
        tableId: options.tableId || "maintable",
        searchColumns: options.searchColumns || null,
        maxResults: options.maxResults || 30,
        caseSensitive: options.caseSensitive || false,
        debounceMs: options.debounceMs || 300,
        onSearch: options.onSearch || null,
        onClear: options.onClear || null,
        ...options,
      };

      this.searchInputs.set(inputId, {
        element: input,
        config: config,
        debounceTimer: null,
      });

      // Bind input events
      this.bindSearchInput(inputId);

      return true;
    }

    /**
     * Bind search input events
     * @param {string} inputId - Search input element ID
     */
    bindSearchInput(inputId) {
      const searchData = this.searchInputs.get(inputId);
      if (!searchData) return;

      const { element: input, config } = searchData;

      // Provide default onSearch for generic searchinp to call server-side handlers
      if (!config.onSearch && (inputId === 'searchinp')) {
        searchData.config.onSearch = (q) => {
          try {
            var query = (q || '').trim();
            // Files page
            if (window.FilesSearch && typeof window.FilesSearch.filterFilesTable === 'function') {
              if (query) return window.FilesSearch.filterFilesTable(query, 1);
              // On clear, restore server pagination
              if (typeof window.initFilesPagination === 'function') window.initFilesPagination();
              return;
            }
            // Users page
            if (typeof window.usersDoFilter === 'function') {
              return window.usersDoFilter(query);
            }
            // Groups page
            if (typeof window.groupsDoFilter === 'function') {
              return window.groupsDoFilter(query);
            }
          } catch (err) {
            if (window.ErrorHandler) window.ErrorHandler.handleError(err, 'SearchManager.onSearch');
          }
        };
      }

      // Input event with debouncing
      input.addEventListener("input", (e) => {
        clearTimeout(searchData.debounceTimer);
        searchData.debounceTimer = setTimeout(() => {
          this.handleSearch(e.target.value, config);
        }, config.debounceMs);
      });

      // Clear button
      const clearBtn = input.parentElement.querySelector(".search-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          this.clearSearch(inputId);
        });
      }

      // Enter key
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleSearch(e.target.value, config);
        }
      });
    }

    /**
     * Handle search query
     * @param {string} query - Search query
     * @param {Object} options - Search options
     */
    handleSearch(query, options = {}) {
      const {
        tableId = "maintable",
        searchColumns = null,
        maxResults = 30,
        caseSensitive = false,
        onSearch = null,
      } = options;

      this.currentQuery = query;

      // Store in history
      if (query) {
        this.addToHistory(query);
      }

      // Use table manager if available
      if (window.tableManager) {
        window.tableManager.filterTable(tableId, query, {
          maxResults,
          searchColumns,
          caseSensitive,
        });
      } else {
        // Fallback to direct DOM manipulation
        this.filterTableDirect(tableId, query, options);
      }

      // Call custom search handler
      if (onSearch) {
        onSearch(query, options);
      }

      // Trigger search event
      document.dispatchEvent(
        new CustomEvent("search-performed", {
          detail: { query, options },
        })
      );
    }

    /**
     * Filter table directly (fallback method)
     * @param {string} tableId - Table element ID
     * @param {string} query - Search query
     * @param {Object} options - Search options
     */
    filterTableDirect(tableId, query, options = {}) {
      const table = document.getElementById(tableId);
      if (!table) return;

      const {
        searchColumns = null,
        maxResults = 30,
        caseSensitive = false,
      } = options;

      const tbody = table.querySelector("tbody");
      if (!tbody) return;

      const rows = Array.from(tbody.querySelectorAll("tr.table__body_row"));
      const searchQuery = caseSensitive ? query : query.toUpperCase();
      let shown = 0;

      rows.forEach((row) => {
        let match = false;

        if (searchColumns) {
          // Search specific columns
          searchColumns.forEach((colIndex) => {
            const cell = row.children[colIndex];
            if (cell) {
              const cellText = caseSensitive
                ? cell.innerText
                : cell.innerText.toUpperCase();
              if (cellText.includes(searchQuery)) match = true;
            }
          });
        } else {
          // Search all columns
          Array.from(row.children).forEach((cell) => {
            const cellText = caseSensitive
              ? cell.innerText
              : cell.innerText.toUpperCase();
            if (cellText.includes(searchQuery)) match = true;
          });
        }

        if (match && shown < maxResults) {
          row.style.display = "table-row";
          shown++;
        } else {
          row.style.display = "none";
        }
      });

      // Update pagination if available
      if (window.tableManager) {
        window.tableManager.updatePaginationCounts(tableId);
      }
    }

    /**
     * Clear search
     * @param {string} inputId - Search input element ID (optional)
     */
    clearSearch(inputId = null) {
      if (inputId) {
        // Clear specific input
        const searchData = this.searchInputs.get(inputId);
        if (searchData) {
          searchData.element.value = "";
          this.handleSearch("", searchData.config);
        }
      } else {
        // Clear all registered inputs
        this.searchInputs.forEach((searchData, id) => {
          searchData.element.value = "";
          this.handleSearch("", searchData.config);
        });
      }

      this.currentQuery = "";

      // Trigger clear event
      document.dispatchEvent(new CustomEvent("search-cleared"));
    }

    /**
     * Add query to search history
     * @param {string} query - Search query
     */
    addToHistory(query) {
      if (!query.trim()) return;

      const history = this.searchHistory.get("global") || [];
      const trimmedQuery = query.trim();

      // Remove if already exists
      const index = history.indexOf(trimmedQuery);
      if (index > -1) {
        history.splice(index, 1);
      }

      // Add to beginning
      history.unshift(trimmedQuery);

      // Keep only last 10 queries
      if (history.length > 10) {
        history.splice(10);
      }

      this.searchHistory.set("global", history);
      this.saveHistory();
    }

    /**
     * Get search history
     * @param {string} key - History key (default: 'global')
     * @returns {Array} Search history
     */
    getHistory(key = "global") {
      return this.searchHistory.get(key) || [];
    }

    /**
     * Save search history to localStorage
     */
    saveHistory() {
      try {
        localStorage.setItem(
          "searchHistory",
          JSON.stringify(Array.from(this.searchHistory.entries()))
        );
      } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
    }

    /**
     * Load search history from localStorage
     */
    loadHistory() {
      try {
        const saved = localStorage.getItem("searchHistory");
        if (saved) {
          this.searchHistory = new Map(JSON.parse(saved));
        }
      } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
    }

    /**
     * Show search suggestions
     * @param {string} inputId - Search input element ID
     * @param {Array} suggestions - Suggestion list
     */
    showSuggestions(inputId, suggestions = []) {
      const searchData = this.searchInputs.get(inputId);
      if (!searchData) return;

      const { element: input } = searchData;
      const container = input.parentElement;

      // Remove existing suggestions
      const existing = container.querySelector(".search-suggestions");
      if (existing) {
        existing.remove();
      }

      if (suggestions.length === 0) return;

      // Create suggestions container
      const suggestionsEl = document.createElement("div");
      suggestionsEl.className = "search-suggestions";
      suggestionsEl.innerHTML = suggestions
        .map(
          (suggestion) =>
            `<div class="suggestion-item" data-value="${suggestion}">${suggestion}</div>`
        )
        .join("");

      // Add click handlers
      suggestionsEl.addEventListener("click", (e) => {
        const item = e.target.closest(".suggestion-item");
        if (item) {
          input.value = item.dataset.value;
          this.handleSearch(item.dataset.value, searchData.config);
          suggestionsEl.remove();
        }
      });

      container.appendChild(suggestionsEl);

      // Hide suggestions when clicking outside
      document.addEventListener("click", function hideSuggestions(e) {
        if (!container.contains(e.target)) {
          suggestionsEl.remove();
          document.removeEventListener("click", hideSuggestions);
        }
      });
    }

    /**
     * Get current search query
     * @returns {string} Current query
     */
    getCurrentQuery() {
      return this.currentQuery;
    }

    /**
     * Check if search is active
     * @returns {boolean} Search active status
     */
    isSearchActive() {
      return this.currentQuery.length > 0;
    }

    /**
     * Get search results count
     * @param {string} tableId - Table element ID
     * @returns {number} Number of visible rows
     */
    getResultsCount(tableId = "maintable") {
      const table = document.getElementById(tableId);
      if (!table) return 0;

      const tbody = table.querySelector("tbody");
      if (!tbody) return 0;

      return Array.from(tbody.querySelectorAll("tr.table__body_row")).filter(
        (row) => row.style.display !== "none"
      ).length;
    }
  }

  // Create global instance
  window.SearchManager = SearchManager;
  window.searchManager = new SearchManager();

  // Provide global clear function for templates using onclick="searchClean()"
  window.searchClean = function (btn) {
    try {
      // If a button element is passed, find nearest input within the searchbar
      if (btn && btn.closest) {
        const wrap = btn.closest('.searchbar');
        const input = wrap && wrap.querySelector('input[name="q"], .searchbar__input, input[type="search"], input');
        if (input) {
          input.value = '';
          const id = input.id || 'searchinp';
          // If registered, clear via manager; else dispatch input event
          if (window.searchManager && window.searchManager.searchInputs.has(id)) {
            window.searchManager.clearSearch(id);
          } else {
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return;
        }
      }
      // Fallback: clear all
      if (window.searchManager) window.searchManager.clearSearch();
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, 'searchClean');
      }
    }
  };

  // Load history on initialization
  window.searchManager.loadHistory();
})();
