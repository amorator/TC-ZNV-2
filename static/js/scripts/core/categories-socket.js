// Categories Socket Module
// Работа с сокетами для синхронизации

function setupSocket() {
  try {
    if (!window.SyncManager) {
      console.warn("SyncManager not available");
      return;
    }

    // Bind categories sync
    if (!window.__categoriesSyncBound) {
      window.__categoriesSyncBound = true;

      window.SyncManager.on("categories:changed", function (data) {
        try {
          // Handle categories changed event
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }

        // Ignore own-origin events to avoid re-entrant refresh in the initiating tab
        try {
          if (
            data &&
            data.originClientId &&
            window.__categoriesClientId &&
            String(data.originClientId) === String(window.__categoriesClientId)
          ) {
            try {
              // Ignore own events
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown")
            }
            return;
          }
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }

        // Refresh categories
        try {
          if (typeof loadCategories === "function") {
            try {
              // Load categories
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown")
            }
            loadCategories();
          }
          if (typeof currentCategoryId !== "undefined" && currentCategoryId) {
            if (typeof loadSubcategories === "function") {
              try {
                // Load subcategories
              } catch (err) {
                window.ErrorHandler.handleError(err, "unknown")
              }
              loadSubcategories(currentCategoryId);
            }
          }
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }
      });

      // Bind subcategories sync
      window.SyncManager.on("subcategories:changed", function (data) {
        try {
          // Handle subcategories changed event
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }

        // Ignore own-origin events to avoid re-entrant refresh in the initiating tab
        try {
          if (
            data &&
            data.originClientId &&
            window.__categoriesClientId &&
            String(data.originClientId) === String(window.__categoriesClientId)
          ) {
            try {
              // Ignore own events
            } catch (err) {
              window.ErrorHandler.handleError(err, "unknown")
            }
            return;
          }
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }

        // Refresh subcategories
        try {
          if (typeof currentCategoryId !== "undefined" && currentCategoryId) {
            if (typeof loadSubcategories === "function") {
              try {
                // Load subcategories
              } catch (err) {
                window.ErrorHandler.handleError(err, "unknown")
              }
              loadSubcategories(currentCategoryId);
            }
          }
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown")
        }
      });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.CategoriesSocket = {
  setupSocket,
};
