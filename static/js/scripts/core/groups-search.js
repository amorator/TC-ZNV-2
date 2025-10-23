// Groups Search Module
// Поиск и фильтрация групп

function initGroupsSearchPersistence() {
  try {
    const input = document.getElementById("searchinp");
    if (!input) return;
    const key = "groups:search";
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
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "initGroupsSearchPersistence");
        }
      }
      try {
        window.addEventListener("load", function () {
          setTimeout(function () {
            try {
              input.dispatchEvent(new Event("input", { bubbles: true }));
            } catch (err) {
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(
                  err,
                  "initGroupsSearchPersistence"
                );
              }
            }
          }, 0);
        });
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "initGroupsSearchPersistence");
        }
      }
    }
    input.addEventListener("input", function (e) {
      const v = (e.target.value || "").trim();
      try {
        localStorage.setItem(key, v);
      } catch (_) {
        // Ignore localStorage errors
      }
      filterGroupsTable(v);
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "initGroupsSearchPersistence");
    }
  }
}

function filterGroupsTable(searchTerm) {
  try {
    const table = document.getElementById("maintable");
    if (!table) return;

    const rows = table.querySelectorAll("tbody tr.table__body_row");
    const term = searchTerm.toLowerCase();

    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      const matches = text.includes(term);
      row.style.display = matches ? "" : "none";
    });

    // Update results count
    updateSearchResults(rows, term);
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "filterGroupsTable");
    }
  }
}

function updateSearchResults(rows, term) {
  try {
    const visibleRows = Array.from(rows).filter(
      (row) => row.style.display !== "none"
    );
    const totalRows = rows.length;
    const visibleCount = visibleRows.length;

    // Update search results indicator
    const resultsIndicator = document.getElementById("search-results");
    if (resultsIndicator) {
      if (term) {
        resultsIndicator.textContent = `Показано ${visibleCount} из ${totalRows} групп`;
        resultsIndicator.style.display = "block";
      } else {
        resultsIndicator.style.display = "none";
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateSearchResults");
    }
  }
}

function clearGroupsSearch() {
  try {
    const input = document.getElementById("searchinp");
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "clearGroupsSearch");
    }
  }
}

function setupGroupsSearch() {
  try {
    // Initialize search persistence
    initGroupsSearchPersistence();

    // Setup clear button
    const clearBtn = document.getElementById("clear-search-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", clearGroupsSearch);
    }

    // Setup search shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        const input = document.getElementById("searchinp");
        if (input) {
          input.focus();
        }
      }
    });
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "setupGroupsSearch");
    }
  }
}

// Export functions to global scope
window.GroupsSearch = {
  initGroupsSearchPersistence,
  filterGroupsTable,
  updateSearchResults,
  clearGroupsSearch,
  setupGroupsSearch,
};
