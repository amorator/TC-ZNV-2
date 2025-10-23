// Categories Management Module
// Управление категориями

function loadCategories() {
  try {
    return fetchWithTimeout(
      "/api/categories",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      10000,
      "loadCategories"
    )
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      })
      .then((data) => {
        try {
          categoriesCache = data.categories || [];
          showCategoryTabs(categoriesCache);
          return data;
        } catch (err) {
          window.ErrorHandler.handleError(err, "loadCategories");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "loadCategories");
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "loadCategories");
  }
}

function showEmptyCategories() {
  try {
    const tabsContainer = document.getElementById("category-tabs");
    if (!tabsContainer) {
      console.warn("Element 'category-tabs' not found in DOM");
      return;
    }
    tabsContainer.innerHTML = "<p>Нет категорий</p>";
  } catch (err) {
    window.ErrorHandler.handleError(err, "showEmptyCategories");
  }
}

function showCategoryTabs(categories) {
  try {
    if (!categories || categories.length === 0) {
      showEmptyCategories();
      return;
    }

    const tabsContainer = document.getElementById("category-tabs");
    if (!tabsContainer) return;

    const tabsHtml = categories
      .map((cat) => {
        const isActive = currentCategoryId === cat.id ? "active" : "";
        const enabledClass = cat.enabled ? "" : "disabled";
        return `
          <button 
            class="tab-button ${isActive} ${enabledClass}" 
            data-category-id="${cat.id}"
            onclick="selectCategory(${cat.id})"
          >
            ${cat.name}
          </button>
        `;
      })
      .join("");

    tabsContainer.innerHTML = tabsHtml;
  } catch (err) {
    window.ErrorHandler.handleError(err, "showCategoryTabs");
  }
}

function selectCategory(categoryId) {
  try {
    currentCategoryId = categoryId;
    currentSubcategoryId = null;

    // Update UI
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });

    const selectedBtn = document.querySelector(
      `[data-category-id="${categoryId}"]`
    );
    if (selectedBtn) {
      selectedBtn.classList.add("active");
    }

    // Load subcategories
    loadSubcategories(categoryId);
  } catch (err) {
    window.ErrorHandler.handleError(err, "selectCategory");
  }
}

// Export functions to global scope
window.CategoriesManagement = {
  loadCategories,
  showEmptyCategories,
  showCategoryTabs,
  selectCategory,
};
