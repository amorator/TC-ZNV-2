// Subcategories Management Module
// Управление подкатегориями

function loadSubcategories(categoryId) {
  try {
    return fetchWithTimeout(
      `/api/categories/${categoryId}/subcategories`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      10000,
      "loadSubcategories"
    )
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      })
      .then((data) => {
        try {
          subcategoriesCache = data.subcategories || [];
          showSubcategoryTabs(subcategoriesCache);
          return data;
        } catch (err) {
          window.ErrorHandler.handleError(err, "unknown");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown");
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function showEmptySubcategories() {
  try {
    const tabsContainer = document.getElementById("subcategory-tabs");
    if (!tabsContainer) {
      console.warn("Element 'subcategory-tabs' not found in DOM");
      return;
    }
    tabsContainer.innerHTML = "<p>Нет подкатегорий</p>";
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function showSubcategoryTabs(subcategories) {
  try {
    if (!subcategories || subcategories.length === 0) {
      showEmptySubcategories();
      return;
    }

    const tabsContainer = document.getElementById("subcategory-tabs");
    if (!tabsContainer) return;

    const tabsHtml = subcategories
      .map((subcat) => {
        const isActive = currentSubcategoryId === subcat.id ? "active" : "";
        const enabledClass = subcat.enabled ? "" : "disabled";
        return `
          <button 
            class="tab-button ${isActive} ${enabledClass}" 
            data-subcategory-id="${subcat.id}"
            onclick="selectSubcategory(${subcat.id})"
          >
            ${subcat.name}
          </button>
        `;
      })
      .join("");

    tabsContainer.innerHTML = tabsHtml;
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function selectSubcategory(subcategoryId) {
  try {
    currentSubcategoryId = subcategoryId;

    // Update UI
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });

    const selectedBtn = document.querySelector(
      `[data-subcategory-id="${subcategoryId}"]`
    );
    if (selectedBtn) {
      selectedBtn.classList.add("active");
    }

    // Load permissions
    loadPermissions(subcategoryId);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

// Export functions to global scope
window.SubcategoriesManagement = {
  loadSubcategories,
  showEmptySubcategories,
  showSubcategoryTabs,
  selectSubcategory,
};
