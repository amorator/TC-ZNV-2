// Categories Page
// Основной файл страницы категорий

// Categories.js loaded

// Global variables
let categoriesData = [];
let subcategoriesData = [];
let initRetryCount = 0;
const MAX_INIT_RETRIES = 50; // 5 seconds max

// Retry mechanism for API calls
async function apiGetWithRetry(url, maxRetries = 3, delay = 1000) {
  if (!window.ApiClient) {
    throw new Error("ApiClient not available");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`API request attempt ${attempt}/${maxRetries} for ${url}`);
      const result = await window.ApiClient.apiGet(url);
      console.log(`API request successful on attempt ${attempt}`);
      return result;
    } catch (err) {
      console.warn(`API request failed on attempt ${attempt}:`, err.message);

      if (attempt === maxRetries) {
        console.error(`All ${maxRetries} attempts failed for ${url}`);
        throw err;
      }

      // Wait before retry
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

// Categories functions
function loadCategories() {
  console.log("loadCategories called");

  if (!window.ApiClient) {
    console.error("ApiClient not available");
    return Promise.resolve();
  }

  console.log("Loading categories from API");
  return apiGetWithRetry("/api/categories")
    .then((data) => {
      console.log("Categories data received:", data);
      console.log("Categories data type:", typeof data);
      console.log(
        "Categories data length:",
        Array.isArray(data) ? data.length : "not array"
      );

      // Check if data is valid
      if (!data) {
        console.error("No data received from API");
        return;
      }

      if (!Array.isArray(data)) {
        console.error("Data is not an array:", data);
        return;
      }

      if (data.length === 0) {
        console.warn("Empty categories array received");
      }

      categoriesData = data;
      console.log("Set categoriesData to:", categoriesData);
      renderCategories();
    })
    .catch((err) => {
      console.error("Error loading categories:", err);
      console.error("Error details:", {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });

      // If it's a JSON parse error (HTML response), show empty state
      if (err.message && err.message.includes("Unexpected token '<'")) {
        console.log("API returned HTML instead of JSON, showing empty state");
        // Show empty categories state
        const emptyCategories = document.getElementById("empty-categories");
        if (emptyCategories) {
          emptyCategories.style.display = "block";
        }
        const categoryTabs = document.getElementById("category-tabs");
        if (categoryTabs) {
          categoryTabs.style.display = "none";
        }
      }

      window.ErrorHandler.handleError(err, "loadCategories");
    });
}

function renderCategories() {
  console.log("renderCategories called, categoriesData:", categoriesData);
  console.log("categoriesData type:", typeof categoriesData);
  console.log("categoriesData is array:", Array.isArray(categoriesData));
  console.log(
    "categoriesData length:",
    categoriesData ? categoriesData.length : "null/undefined"
  );

  const categoryNav = document.getElementById("category-nav");
  const categoryTabs = document.getElementById("category-tabs");

  console.log("category-nav element:", categoryNav);
  console.log("category-tabs element:", categoryTabs);

  if (!categoryNav) {
    console.error("category-nav element not found!");
    return;
  }

  if (!categoryTabs) {
    console.error("category-tabs element not found!");
    return;
  }

  if (
    !categoriesData ||
    !Array.isArray(categoriesData) ||
    categoriesData.length === 0
  ) {
    console.log("No categories data to render");
    return;
  }

  console.log("Creating buttons for", categoriesData.length, "categories");

  // Clear existing content
  categoryNav.innerHTML = "";

  // Create category buttons
  categoriesData.forEach((category, index) => {
    console.log(`Processing category ${index}:`, category);
    console.log("Category display_name:", category.display_name);
    console.log("Category id:", category.id);

    const button = document.createElement("button");
    button.className = "topbtn";
    button.textContent = category.display_name || `Category ${category.id}`;
    button.dataset.categoryId = category.id;
    button.onclick = () => selectCategory(category.id);
    categoryNav.appendChild(button);
    console.log(
      "Created button for category:",
      category.display_name || `Category ${category.id}`,
      "ID:",
      category.id
    );
  });

  // Show category tabs
  categoryTabs.style.display = "block";
  console.log("Showed category tabs");

  // Hide empty state
  const emptyCategories = document.getElementById("empty-categories");
  if (emptyCategories) {
    emptyCategories.style.display = "none";
    console.log("Hidden empty-categories");
  }

  // Select first category if available
  if (categoriesData.length > 0) {
    console.log("Auto-selecting first category:", categoriesData[0].id);
    selectCategory(categoriesData[0].id);
  }
}

function loadSubcategories(categoryId) {
  console.log("loadSubcategories called with categoryId:", categoryId);

  if (!window.ApiClient) {
    console.log("ApiClient not available, setting empty subcategories data");
    subcategoriesData = [];
    renderSubcategories();
    return Promise.resolve();
  }

  console.log("Loading subcategories from API for category:", categoryId);
  return apiGetWithRetry(`/api/subcategories/${categoryId}`)
    .then((data) => {
      console.log("Subcategories data received:", data);
      console.log("Subcategories data type:", typeof data);
      console.log(
        "Subcategories data length:",
        Array.isArray(data) ? data.length : "not array"
      );

      // Check if data is valid
      if (!data) {
        console.warn("No subcategories data received, using empty array");
        subcategoriesData = [];
        renderSubcategories();
        return;
      }

      if (!Array.isArray(data)) {
        console.warn("Subcategories data is not an array:", data);
        subcategoriesData = [];
        renderSubcategories();
        return;
      }

      subcategoriesData = data;
      console.log("Set subcategoriesData to:", subcategoriesData);
      renderSubcategories();
    })
    .catch((err) => {
      console.error("Error loading subcategories:", err);
      console.error("Error details:", {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });

      // If it's a JSON parse error (HTML response), treat as empty subcategories
      if (err.message && err.message.includes("Unexpected token '<'")) {
        console.log(
          "API returned HTML instead of JSON, treating as empty subcategories"
        );
      }

      // Set empty subcategories data and render empty list
      subcategoriesData = [];
      renderSubcategories();
    });
}

function renderSubcategories() {
  console.log(
    "renderSubcategories called, subcategoriesData:",
    subcategoriesData
  );

  const subcategoryNav = document.getElementById("subcategory-nav");
  const subcategoryTabs = document.getElementById("subcategory-tabs");

  if (!subcategoryNav) {
    console.error("subcategory-nav element not found");
    return;
  }
  console.log("subcategory-nav found:", subcategoryNav);

  // Clear existing content
  subcategoryNav.innerHTML = "";

  if (
    !subcategoriesData ||
    !Array.isArray(subcategoriesData) ||
    subcategoriesData.length === 0
  ) {
    console.log("No subcategories data, hiding subcategory tabs");
    if (subcategoryTabs) {
      subcategoryTabs.style.display = "none";
    }

    // Show empty subcategories state
    const emptySubcategories = document.getElementById("empty-subcategories");
    if (emptySubcategories) {
      emptySubcategories.style.display = "block";
      console.log("Showed empty-subcategories");
    }
    return;
  }

  console.log(
    "Creating buttons for",
    subcategoriesData.length,
    "subcategories"
  );

  // Create subcategory buttons
  subcategoriesData.forEach((subcategory) => {
    const button = document.createElement("button");
    button.className = "topbtn";
    button.textContent = subcategory.display_name;
    button.dataset.subcategoryId = subcategory.id;
    button.onclick = () => selectSubcategory(subcategory.id);
    subcategoryNav.appendChild(button);
    console.log(
      "Created button for subcategory:",
      subcategory.display_name,
      "ID:",
      subcategory.id
    );
  });

  // Show subcategory tabs
  if (subcategoryTabs) {
    subcategoryTabs.style.display = "block";
    console.log("Showed subcategory tabs");
  }

  // Hide empty state
  const emptySubcategories = document.getElementById("empty-subcategories");
  if (emptySubcategories) {
    emptySubcategories.style.display = "none";
    console.log("Hidden empty-subcategories");
  }

  // Select first subcategory if available
  if (subcategoriesData.length > 0) {
    console.log("Auto-selecting first subcategory:", subcategoriesData[0].id);
    selectSubcategory(subcategoriesData[0].id);
  }
}

// Selection functions
function selectCategory(categoryId) {
  console.log("selectCategory called with categoryId:", categoryId);

  // Update active state
  const buttons = document.querySelectorAll("#category-nav .topbtn");
  buttons.forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.querySelector(
    `#category-nav .topbtn[data-category-id="${categoryId}"]`
  );
  if (activeBtn) {
    activeBtn.classList.add("active");
    console.log("Set active button for category:", categoryId);
  }

  // Hide permissions content when selecting category
  const permissionsContent = document.getElementById("permissions-content");
  if (permissionsContent) {
    permissionsContent.style.display = "none";
    console.log("Hidden permissions content");
  }

  // Load subcategories for this category
  console.log("Calling loadSubcategories for category:", categoryId);
  loadSubcategories(categoryId)
    .then(() => {
      // If no subcategories were loaded, show permissions for the category itself
      if (!subcategoriesData || subcategoriesData.length === 0) {
        console.log(
          "No subcategories found, showing permissions for category:",
          categoryId
        );
        loadSubcategoryContent(categoryId);
      }
    })
    .catch((err) => {
      console.error(
        "Error loading subcategories, showing permissions for category:",
        categoryId
      );
      loadSubcategoryContent(categoryId);
    });
}

function selectSubcategory(subcategoryId) {
  console.log("selectSubcategory called with subcategoryId:", subcategoryId);

  // Update active state
  const buttons = document.querySelectorAll("#subcategory-nav .topbtn");
  buttons.forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.querySelector(
    `#subcategory-nav .topbtn[data-subcategory-id="${subcategoryId}"]`
  );
  if (activeBtn) {
    activeBtn.classList.add("active");
    console.log("Set active button for subcategory:", subcategoryId);
  }

  // Load content for this subcategory
  console.log("Calling loadSubcategoryContent for subcategory:", subcategoryId);
  loadSubcategoryContent(subcategoryId);
}

function loadSubcategoryContent(subcategoryId) {
  console.log(
    "loadSubcategoryContent called with subcategoryId:",
    subcategoryId
  );

  try {
    if (!window.ApiClient) {
      console.log(
        "ApiClient not available, calling renderSubcategoryPermissions anyway"
      );
    }

    // Show permissions content structure
    console.log("Calling renderSubcategoryPermissions");
    renderSubcategoryPermissions(subcategoryId);
  } catch (err) {
    console.error("Error in loadSubcategoryContent:", err);
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function renderSubcategoryContent(files) {
  const contentArea = document.getElementById("content-area");
  if (!contentArea) {
    return;
  }

  // Hide empty states
  const emptyCategories = document.getElementById("empty-categories");
  const emptySubcategories = document.getElementById("empty-subcategories");
  if (emptyCategories) emptyCategories.style.display = "none";
  if (emptySubcategories) emptySubcategories.style.display = "none";

  if (!files || files.length === 0) {
    contentArea.innerHTML = `
      <div class="empty-state">
        <p>Нет файлов в этой подкатегории</p>
      </div>
    `;
    return;
  }

  // Render files list
  let html = '<div class="files-list">';
  files.forEach((file) => {
    html += `
      <div class="file-item">
        <span class="file-name">${file.name}</span>
        <span class="file-size">${file.size}</span>
      </div>
    `;
  });
  html += "</div>";

  contentArea.innerHTML = html;
}

// This function is no longer needed since the endpoint doesn't exist
// function loadSubcategoryPermissions(subcategoryId) {
//   // Load permissions for this subcategory
//   window.ApiClient.apiGet(`/api/subcategories/${subcategoryId}/permissions`)
//     .then((data) => {
//       renderSubcategoryPermissions(data);
//     })
//     .catch((err) => {
//       // If no permissions endpoint exists, show empty state
//       renderEmptySubcategory();
//     });
// }

function renderSubcategoryPermissions(subcategoryId) {
  console.log(
    "renderSubcategoryPermissions called with subcategoryId:",
    subcategoryId
  );

  const contentArea = document.getElementById("content-area");
  if (!contentArea) {
    console.error("content-area element not found");
    return;
  }
  console.log("content-area found:", contentArea);

  // Hide empty states
  const emptyCategories = document.getElementById("empty-categories");
  const emptySubcategories = document.getElementById("empty-subcategories");
  if (emptyCategories) {
    emptyCategories.style.display = "none";
    console.log("Hidden empty-categories");
  }
  if (emptySubcategories) {
    emptySubcategories.style.display = "none";
    console.log("Hidden empty-subcategories");
  }

  // Show existing permissions content
  const permissionsContent = document.getElementById("permissions-content");
  console.log("permissions-content element:", permissionsContent);
  if (permissionsContent) {
    permissionsContent.style.display = "block";
    console.log("Showed permissions-content");

    // Add test data to tables to see if they're visible
    const groupsTbody = document.getElementById("groups-permissions");
    const usersTbody = document.getElementById("users-permissions");

    if (groupsTbody) {
      groupsTbody.innerHTML = `
        <tr>
          <td>Тестовая группа</td>
          <td class="text-center"><input type="radio" name="group-view" value="own"></td>
          <td class="text-center"><input type="radio" name="group-upload" value="own"></td>
          <td class="text-center"><input type="radio" name="group-edit" value="own"></td>
          <td class="text-center"><input type="radio" name="group-delete" value="own"></td>
        </tr>
      `;
      console.log("Added test data to groups table");
    }

    if (usersTbody) {
      usersTbody.innerHTML = `
        <tr>
          <td>Тестовый пользователь</td>
          <td class="text-center"><input type="radio" name="user-view" value="own"></td>
          <td class="text-center"><input type="radio" name="user-upload" value="own"></td>
          <td class="text-center"><input type="radio" name="user-edit" value="own"></td>
          <td class="text-center"><input type="radio" name="user-delete" value="own"></td>
        </tr>
      `;
      console.log("Added test data to users table");
    }

    // Check CSS styles that might be hiding the tables
    const computedStyle = window.getComputedStyle(permissionsContent);
    console.log("permissions-content computed styles:", {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      height: computedStyle.height,
      opacity: computedStyle.opacity,
      position: computedStyle.position,
      zIndex: computedStyle.zIndex,
    });

    // Check if tables are visible
    const tables = permissionsContent.querySelectorAll("table");
    console.log("Found tables:", tables.length);
    tables.forEach((table, index) => {
      const tableStyle = window.getComputedStyle(table);
      console.log(`Table ${index} styles:`, {
        display: tableStyle.display,
        visibility: tableStyle.visibility,
        height: tableStyle.height,
        opacity: tableStyle.opacity,
      });
    });
  } else {
    console.error("permissions-content element not found!");
  }

  // Clear any other content in content area
  const otherContent = contentArea.querySelectorAll(
    ":not(#permissions-content)"
  );
  otherContent.forEach((el) => {
    if (el.id !== "empty-categories" && el.id !== "empty-subcategories") {
      el.style.display = "none";
    }
  });

  // Check parent element visibility
  const contentAreaStyle = window.getComputedStyle(contentArea);
  console.log("content-area computed styles:", {
    display: contentAreaStyle.display,
    visibility: contentAreaStyle.visibility,
    height: contentAreaStyle.height,
    opacity: contentAreaStyle.opacity,
    position: contentAreaStyle.position,
    zIndex: contentAreaStyle.zIndex,
  });

  // Check if content-area is visible
  const contentAreaRect = contentArea.getBoundingClientRect();
  console.log("content-area bounding rect:", {
    top: contentAreaRect.top,
    left: contentAreaRect.left,
    width: contentAreaRect.width,
    height: contentAreaRect.height,
    visible: contentAreaRect.width > 0 && contentAreaRect.height > 0,
  });
}

function renderEmptySubcategory() {
  const contentArea = document.getElementById("content-area");
  if (!contentArea) {
    return;
  }

  // Hide permissions content
  const permissionsContent = document.getElementById("permissions-content");
  if (permissionsContent) {
    permissionsContent.style.display = "none";
  }

  // Show empty subcategories state
  const emptySubcategories = document.getElementById("empty-subcategories");
  if (emptySubcategories) {
    emptySubcategories.style.display = "block";
  }
}

// Socket functions
function setupSocket() {
  // Implementation for socket setup
}

// Инициализация страницы
function initCategoriesPage() {
  console.log("initCategoriesPage called, retry count:", initRetryCount);

  try {
    // Wait for ApiClient to be available
    if (!window.ApiClient) {
      console.log("ApiClient not available, retrying...");
      initRetryCount++;
      if (initRetryCount > MAX_INIT_RETRIES) {
        console.error(
          "ApiClient not available after",
          MAX_INIT_RETRIES,
          "retries"
        );
        return;
      }
      setTimeout(() => {
        initCategoriesPage();
      }, 100);
      return;
    }

    console.log("ApiClient available, initializing categories page");
    console.log("ApiClient object:", window.ApiClient);
    console.log("ApiClient.apiGet method:", typeof window.ApiClient.apiGet);

    // Test ApiClient
    if (window.ApiClient && window.ApiClient.apiGet) {
      console.log("Testing ApiClient with a simple request...");
      try {
        window.ApiClient.apiGet("/api/categories")
          .then((data) => {
            console.log("Test request successful:", data);
          })
          .catch((err) => {
            console.error("Test request failed:", err);
          });
      } catch (err) {
        console.error("Error in test request:", err);
      }
    } else {
      console.error("ApiClient or apiGet method not available!");
    }

    // Setup socket connection
    setupSocket();

    // Load initial data
    console.log("About to call loadCategories");
    try {
      const loadResult = loadCategories();
      console.log("loadCategories result:", loadResult);
      if (loadResult && typeof loadResult.then === "function") {
        loadResult
          .then(() => {
            console.log("loadCategories completed successfully");
          })
          .catch((err) => {
            console.error("loadCategories failed:", err);
          });
      }
    } catch (err) {
      console.error("Error calling loadCategories:", err);
    }

    // Setup UI components
    setupModalAccessibility();
    setupTabNavigation();
    setupSaveCancelButtons();
    wireSearchbar("group");
    wireSearchbar("user");
    wireInlineEditForms();
    updateDeleteButtonsState();
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

// UI Setup Functions
function setupModalAccessibility() {
  try {
    // Setup modal accessibility
    const modals = document.querySelectorAll(".modal");
    modals.forEach((modal) => {
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function setupTabNavigation() {
  try {
    // Setup tab navigation
    const tabs = document.querySelectorAll(".tab-button");
    tabs.forEach((tab) => {
      tab.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          tab.click();
        }
      });
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function setupSaveCancelButtons() {
  try {
    // Setup save/cancel buttons
    const saveGroupBtn = document.getElementById("save-group-permissions");
    const saveUserBtn = document.getElementById("save-user-permissions");
    const cancelGroupBtn = document.getElementById("cancel-group-permissions");
    const cancelUserBtn = document.getElementById("cancel-user-permissions");

    if (saveGroupBtn) {
      saveGroupBtn.addEventListener("click", () => savePermissions("group"));
    }
    if (saveUserBtn) {
      saveUserBtn.addEventListener("click", () => savePermissions("user"));
    }
    if (cancelGroupBtn) {
      cancelGroupBtn.addEventListener("click", () => cancelChanges("group"));
    }
    if (cancelUserBtn) {
      cancelUserBtn.addEventListener("click", () => cancelChanges("user"));
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function wireSearchbar(which) {
  try {
    const container = getSearchContainer(which);
    if (!container) return;

    const input = getSearchInput(which);
    if (!input) return;

    input.addEventListener("input", (e) => {
      filterTable(which);
    });

    const clearBtn = container.querySelector(".clear-search");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        clearSearch(which);
      });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function wireInlineEditForms() {
  try {
    // Setup inline edit forms
    const editForms = document.querySelectorAll(".inline-edit-form");
    editForms.forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        // Handle form submission
      });
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

// Utility Functions
function getSearchContainer(which) {
  try {
    return document.getElementById(`${which}-search-container`);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function getSearchInput(which) {
  try {
    return document.getElementById(`${which}-search-input`);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function filterTable(which) {
  try {
    const input = getSearchInput(which);
    if (!input) return;

    const searchTerm = input.value.toLowerCase();
    const table = document.getElementById(`${which}-permissions-table`);
    if (!table) return;

    const rows = table.querySelectorAll("tbody tr");
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(searchTerm) ? "" : "none";
    });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function clearSearch(which) {
  try {
    const input = getSearchInput(which);
    if (input) {
      input.value = "";
      filterTable(which);
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function updateDeleteButtonsState() {
  try {
    // Update delete buttons state based on current selection
    const deleteCategoryBtn = document.getElementById("delete-category-btn");
    const deleteSubcategoryBtn = document.getElementById(
      "delete-subcategory-btn"
    );

    if (deleteCategoryBtn) {
      deleteCategoryBtn.disabled = !currentCategoryId;
    }
    if (deleteSubcategoryBtn) {
      deleteSubcategoryBtn.disabled = !currentSubcategoryId;
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

// Permission Management Functions
function savePermissions(which) {
  try {
    const permissions =
      which === "group"
        ? currentPermissionsDraft.group
        : currentPermissionsDraft.user;
    const subcategoryId = currentSubcategoryId;

    if (!subcategoryId) {
      notify("Выберите подкатегорию", "warning");
      return;
    }

    return fetchWithTimeout(
      `/api/subcategories/${subcategoryId}/permissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: which,
          permissions: permissions,
        }),
      },
      10000,
      "savePermissions"
    )
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      })
      .then((data) => {
        try {
          // Update last saved permissions
          lastSavedPermissions[which] = deepClone(permissions);

          // Mark as not dirty
          if (which === "group") {
            isDirtyGroups = false;
          } else if (which === "user") {
            isDirtyUsers = false;
          }

          // Update save buttons
          updateSaveButtonsState();

          notify("Права сохранены", "success");
        } catch (err) {
          window.ErrorHandler.handleError(err, "savePermissions");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown");
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

function cancelChanges(which) {
  try {
    // Reset to last saved state
    if (which === "group") {
      currentPermissionsDraft.group = deepClone(lastSavedPermissions.group);
      isDirtyGroups = false;
    } else if (which === "user") {
      currentPermissionsDraft.user = deepClone(lastSavedPermissions.user);
      isDirtyUsers = false;
    }

    // Update save buttons
    updateSaveButtonsState();

    // Reload permissions
    if (currentSubcategoryId) {
      loadPermissions(currentSubcategoryId);
    }

    notify("Изменения отменены", "info");
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}

// Initialize page when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    try {
      setTimeout(() => {
        initCategoriesPage();
      }, 100);
    } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
  });
} else {
  // DOM is already ready, initialize immediately
  setTimeout(() => {
    initCategoriesPage();
  }, 100);
}

// Global functions for inline handlers
window.editPermission = function (permissionId) {
  console.log("Edit permission:", permissionId);
  // TODO: Implement permission editing
};

window.deletePermission = function (permissionId) {
  console.log("Delete permission:", permissionId);
  // TODO: Implement permission deletion
};

window.addContent = function () {
  console.log("Add content");
  // TODO: Implement content addition
};

window.managePermissions = function (subcategoryId) {
  console.log("Manage permissions for subcategory:", subcategoryId);
  // TODO: Implement permissions management
};

window.showAddCategoryModal = function () {
  console.log("Show add category modal");
  // TODO: Implement add category modal
};

window.showAddSubcategoryModal = function () {
  console.log("Show add subcategory modal");
  // TODO: Implement add subcategory modal
};

window.openConfirmToggleCategory = function () {
  console.log("Open confirm toggle category");
  // TODO: Implement toggle category confirmation
};

window.openConfirmDeleteCategory = function () {
  console.log("Open confirm delete category");
  // TODO: Implement delete category confirmation
};

// Export functions to global scope
window.CategoriesPage = {
  initCategoriesPage,
  setupModalAccessibility,
  setupTabNavigation,
  setupSaveCancelButtons,
  wireSearchbar,
  wireInlineEditForms,
  getSearchContainer,
  getSearchInput,
  filterTable,
  clearSearch,
  updateDeleteButtonsState,
  savePermissions,
  cancelChanges,
};
