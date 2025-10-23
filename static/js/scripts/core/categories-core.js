// Categories Core Module
// Базовые функции для работы с категориями

// Глобальные переменные
let currentCategoryId = null;
let currentSubcategoryId = null;
let currentPermissionsDraft = { user: {}, group: {} };
let lastSavedPermissions = { user: {}, group: {} };
let isDirtyGroups = false;
let isDirtyUsers = false;
let categoriesCache = [];
let subcategoriesCache = [];

// Generate a short per-tab id to distinguish logs between tabs
try {
  if (!window.__categoriesTabId) {
    const r = Math.random().toString(36).slice(2, 6);
    const t = Date.now().toString(36).slice(-4);
    window.__categoriesTabId = r + t;
  }
} catch (err) {
  window.ErrorHandler.handleError(err, "unknown")
}

// Utility functions
function fetchWithTimeout(url, options, timeoutMs, dbgLabel) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  return fetch(url, { ...(options || {}), signal: controller.signal })
    .then((resp) => {
      try {
        // Response received
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown")
      }
      clearTimeout(id);
      return resp;
    })
    .catch((e) => {
      clearTimeout(id);
      try {
        // Error occurred
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown")
      }
      throw e;
    });
}

function notify(message, variant) {
  try {
    if (window.showToast) {
      window.showToast(message, variant || "info");
    } else {
      console.log(`[${variant || "info"}] ${message}`);
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Export functions to global scope
window.CategoriesCore = {
  currentCategoryId,
  currentSubcategoryId,
  currentPermissionsDraft,
  lastSavedPermissions,
  isDirtyGroups,
  isDirtyUsers,
  categoriesCache,
  subcategoriesCache,
  fetchWithTimeout,
  notify,
  deepClone,
};
