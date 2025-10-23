// Categories page functionality
// Restored from commit 9dfd60d and adapted for modular structure

// Global variables
let currentCategoryId = null;
let currentSubcategoryId = null;
let currentPermissionsDraft = { user: {}, group: {} };
let lastSavedPermissions = { user: {}, group: {} };
let isDirtyGroups = false;
let isDirtyUsers = false;
let categoriesCache = [];
let subcategoriesCache = [];

// Initialize page
function initCategoriesPage() {
  try {
    if (!window.__categoriesClientId) {
      window.__categoriesClientId =
        Math.random().toString(36).slice(2) + "-" + Date.now();
    }
  } catch (_) {}

  setupTabNavigation();
  setupModalAccessibility();

  // Show categories tab by default and load categories
  const categoriesTab = document.getElementById("categories-tab");
  if (categoriesTab) {
    categoriesTab.style.display = "block";
  }

  loadCategories();
  setupSaveCancelButtons();
  setupSocket();

  // Wire shared searchbars
  wireSearchbar("groups");
  wireSearchbar("users");

  // Wire header save buttons
  const delCat = document.getElementById("delete-category-btn");
  const delSub = document.getElementById("delete-subcategory-btn");
  if (delCat) delCat.onclick = tryDeleteCategory;
  if (delSub) delSub.onclick = tryDeleteSubcategory;

  initCategoriesContextMenu();
}

// Setup modal accessibility and focus trapping
function setupModalAccessibility() {
  const modals = [
    "addCategoryModal",
    "addSubcategoryModal",
    "editCategoryModal",
    "editSubcategoryModal",
    "confirmDeleteCategoryModal",
    "confirmDeleteSubcategoryModal",
    "confirmToggleCategoryModal",
    "confirmToggleSubcategoryModal",
  ];

  modals.forEach((modalId) => {
    const modalElement = document.getElementById(modalId);
    if (!modalElement) return;

    modalElement.addEventListener("shown.bs.modal", function () {
      const firstInput = this.querySelector(
        "input, select, textarea, button.btn-primary"
      );
      if (firstInput) {
        try {
          firstInput.focus();
        } catch (_) {}
      }
    });

    // Simple focus trap: keep tab focus inside modal while open
    modalElement.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      const focusables = this.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  });
}

// Safer modal hide to avoid aria-hidden/focus warning
function hideModalSafely(modalId) {
  try {
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }
  } catch (_) {}

  try {
    const el = document.getElementById(modalId);
    if (!el) return;
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
  } catch (_) {}
}

// Toast notification helper
function notify(message, variant) {
  try {
    const container = document.getElementById("toastContainer");
    if (!container) {
      alert(message);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `toast align-items-center text-bg-${
      variant || "primary"
    } border-0`;
    wrapper.setAttribute("role", "alert");
    wrapper.setAttribute("aria-live", "assertive");
    wrapper.setAttribute("aria-atomic", "true");
    wrapper.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>`;
    container.appendChild(wrapper);
    const t = new bootstrap.Toast(wrapper, { delay: 3000 });
    t.show();
    wrapper.addEventListener("hidden.bs.toast", () => {
      try {
        wrapper.remove();
      } catch (_) {}
    });
  } catch (_) {
    try {
      alert(message);
    } catch (__) {}
  }
}

// Tab navigation
function setupTabNavigation() {
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", function (e) {
      const tabName = this.dataset.tab;

      // Update active tab
      document
        .querySelectorAll("[data-tab]")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");

      // Show/hide content
      document.querySelectorAll(".tab-content").forEach((content) => {
        content.style.display = "none";
      });

      if (tabName === "categories") {
        const categoriesTab = document.getElementById("categories-tab");
        if (categoriesTab) {
          categoriesTab.style.display = "block";
        }
      } else if (tabName === "registrars") {
        const registrarsTab = document.getElementById("registrars-tab");
        if (registrarsTab) {
          registrarsTab.style.display = "block";
        }
      }
    });
  });
}

// Load categories
function loadCategories() {
  fetch("/api/categories")
    .then((response) => response.json())
    .then((categories) => {
      categoriesCache = Array.isArray(categories)
        ? categories.slice().sort((a, b) => {
            const ao = Number((a && a.display_order) || 0);
            const bo = Number((b && b.display_order) || 0);
            if (ao !== bo) return ao - bo;
            const an = String((a && a.display_name) || "");
            const bn = String((b && b.display_name) || "");
            return an.localeCompare(bn);
          })
        : [];

      if (categoriesCache.length === 0) {
        showEmptyCategories();
        return;
      }

      showCategoryTabs(categoriesCache);
      if (categoriesCache.length > 0) {
        // Try restore from localStorage
        const savedCat = localStorage.getItem("admin_cat_active_category_id");
        const toSelect =
          categoriesCache.find((c) => String(c.id) === String(savedCat)) ||
          categoriesCache[0];
        selectCategory(toSelect.id);
      }
    })
    .catch((error) => {
      console.error("Error loading categories:", error);
      showEmptyCategories();
    });
}

// Show empty categories state
function showEmptyCategories() {
  showCategoryTabs([]);
  const emptyCategories = document.getElementById("empty-categories");
  const subcategoryTabs = document.getElementById("subcategory-tabs");
  const permissionsContent = document.getElementById("permissions-content");

  if (emptyCategories) emptyCategories.style.display = "block";
  if (subcategoryTabs) subcategoryTabs.style.display = "none";
  if (permissionsContent) permissionsContent.style.display = "none";
}

// Show category tabs
function showCategoryTabs(categories) {
  const categoryTabs = document.getElementById("category-tabs");
  const categoryNav = document.getElementById("category-nav");

  if (!categoryNav) return;

  categoryNav.innerHTML = "";

  const sorted = (categories || []).slice().sort((a, b) => {
    const ao = Number((a && a.display_order) || 0);
    const bo = Number((b && b.display_order) || 0);
    if (ao !== bo) return ao - bo;
    const an = String((a && a.display_name) || "");
    const bn = String((b && b.display_name) || "");
    return an.localeCompare(bn);
  });

  if (sorted.length === 0) {
    // Show "Add category" button when no categories exist
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить категорию";
    addBtn.onclick = () => showAddCategoryModal();
    categoryNav.appendChild(addBtn);
  } else {
    sorted.forEach((category) => {
      const btn = document.createElement("button");
      btn.className = "topbtn" + (!category.enabled ? " is-disabled" : "");
      btn.innerHTML = category.display_name;
      btn.setAttribute("data-category-id", category.id);
      btn.onclick = () => selectCategory(category.id);
      categoryNav.appendChild(btn);
    });

    // Add "Add category" button
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить категорию";
    addBtn.onclick = () => showAddCategoryModal();
    categoryNav.appendChild(addBtn);
  }

  if (categoryTabs) {
    categoryTabs.style.display = "block";
  }

  const emptyCategories = document.getElementById("empty-categories");
  if (emptyCategories) {
    emptyCategories.style.display = "none";
  }
}

// Select category
function selectCategory(categoryId) {
  currentCategoryId = categoryId;
  try {
    localStorage.setItem("admin_cat_active_category_id", String(categoryId));
  } catch (e) {}

  // Update active category tab
  document.querySelectorAll("#category-nav .topbtn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-category-id") == categoryId) {
      btn.classList.add("active");
    }
  });

  // Load subcategories
  loadSubcategories(categoryId);

  // Update header category name
  const cat = (categoriesCache || []).find(
    (c) => String(c.id) === String(categoryId)
  );
  setActiveNames(cat ? cat.display_name : "—", null);
  updateDeleteButtonsState();
}

// Load subcategories
function loadSubcategories(categoryId) {
  console.log("Loading subcategories for category:", categoryId);
  fetch(`/api/subcategories/${categoryId}`)
    .then((response) => response.json())
    .then((subcategories) => {
      subcategoriesCache = Array.isArray(subcategories) ? subcategories : [];
      console.log("Subcategories loaded:", subcategories);

      if (subcategories.length === 0) {
        showEmptySubcategories();
        return;
      }

      showSubcategoryTabs(subcategories);
      if (subcategories.length > 0) {
        // Try restore from localStorage
        const savedSub = localStorage.getItem(
          "admin_cat_active_subcategory_id"
        );
        const toSelect =
          subcategories.find((s) => String(s.id) === String(savedSub)) ||
          subcategories[0];
        selectSubcategory(toSelect.id);
      }
    })
    .catch((error) => {
      console.error("Error loading subcategories:", error);
      showEmptySubcategories();
    });
}

// Show empty subcategories state
function showEmptySubcategories() {
  showSubcategoryTabs([]);
  const emptySubcategories = document.getElementById("empty-subcategories");
  const permissionsContent = document.getElementById("permissions-content");

  if (emptySubcategories) emptySubcategories.style.display = "block";
  if (permissionsContent) permissionsContent.style.display = "none";
}

// Show subcategory tabs
function showSubcategoryTabs(subcategories) {
  const subcategoryTabs = document.getElementById("subcategory-tabs");
  const subcategoryNav = document.getElementById("subcategory-nav");

  if (!subcategoryNav) return;

  subcategoryNav.innerHTML = "";
  console.log("Rendering subcategory tabs, count:", subcategories.length);

  if (subcategories.length === 0) {
    // Show "Add subcategory" button when no subcategories exist
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить подкатегорию";
    addBtn.onclick = () => showAddSubcategoryModal();
    subcategoryNav.appendChild(addBtn);
  } else {
    subcategories.forEach((subcategory) => {
      const btn = document.createElement("button");
      btn.className = "topbtn" + (!subcategory.enabled ? " is-disabled" : "");
      btn.innerHTML = subcategory.display_name;
      btn.setAttribute("data-subcategory-id", subcategory.id);
      btn.onclick = () => selectSubcategory(subcategory.id);
      subcategoryNav.appendChild(btn);
    });

    // Add "Add subcategory" button
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить подкатегорию";
    addBtn.onclick = () => showAddSubcategoryModal();
    subcategoryNav.appendChild(addBtn);
  }

  if (subcategoryTabs) {
    subcategoryTabs.style.display = "block";
  }

  const emptySubcategories = document.getElementById("empty-subcategories");
  if (emptySubcategories) {
    emptySubcategories.style.display = "none";
  }
}

// Select subcategory
function selectSubcategory(subcategoryId) {
  currentSubcategoryId = subcategoryId;
  try {
    localStorage.setItem(
      "admin_cat_active_subcategory_id",
      String(subcategoryId)
    );
  } catch (e) {}

  // Update active subcategory tab
  document.querySelectorAll("#subcategory-nav .topbtn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-subcategory-id") == subcategoryId) {
      btn.classList.add("active");
    }
  });

  // Load permissions
  loadPermissions(subcategoryId);

  // Update header subcategory name
  const sub = (subcategoriesCache || []).find(
    (s) => String(s.id) === String(subcategoryId)
  );
  setActiveNames(null, sub ? sub.display_name : "—");
  updateDeleteButtonsState();
}

// Initialize page when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCategoriesPage);
} else {
  initCategoriesPage();
}

// Load permissions
function loadPermissions(subcategoryId) {
  // Load groups and users data
  Promise.all([
    fetch("/api/groups?page=1&page_size=5").then((response) => response.json()),
    fetch("/api/users?page=1&page_size=5").then((response) => response.json()),
    fetch(`/api/subcategory/${subcategoryId}/permissions`).then((response) =>
      response.json()
    ),
  ])
    .then(([groupsResp, usersResp, permissionsData]) => {
      // Fallback if permissions API failed
      const perms =
        permissionsData && permissionsData.permissions
          ? permissionsData.permissions
          : { group: {}, user: {} };
      // Initialize draft and lastSaved snapshots
      lastSavedPermissions = deepClone(perms);
      currentPermissionsDraft = deepClone(perms);
      isDirtyGroups = false;
      isDirtyUsers = false;
      updateSaveButtonsState();

      // Load groups permissions table
      loadGroupsPermissionsTable(
        (groupsResp && groupsResp.items) || [],
        currentPermissionsDraft.group || {}
      );
      renderPagination("groups", groupsResp);

      // Load users permissions table
      loadUsersPermissionsTable(
        (usersResp && usersResp.items) || [],
        currentPermissionsDraft.user || {}
      );
      renderPagination("users", usersResp);

      // Show permissions content
      const permissionsContent = document.getElementById("permissions-content");
      const emptySubcategories = document.getElementById("empty-subcategories");

      if (permissionsContent) permissionsContent.style.display = "block";
      if (emptySubcategories) emptySubcategories.style.display = "none";

      // Ensure searchbars wired after content shown
      wireSearchbar("groups");
      wireSearchbar("users");

      // Ensure header buttons state reflects dirty flags
      updateSaveButtonsState();
      updateDeleteButtonsState();
    })
    .catch((error) => {
      console.error("Error loading permissions:", error);
      // Still show empty tables with headers and search
      lastSavedPermissions = { user: {}, group: {} };
      currentPermissionsDraft = { user: {}, group: {} };
      isDirtyGroups = false;
      isDirtyUsers = false;
      updateSaveButtonsState();
      loadGroupsPermissionsTable([], currentPermissionsDraft.group);
      loadUsersPermissionsTable([], currentPermissionsDraft.user);

      const permissionsContent = document.getElementById("permissions-content");
      const emptySubcategories = document.getElementById("empty-subcategories");

      if (permissionsContent) permissionsContent.style.display = "block";
      if (emptySubcategories) emptySubcategories.style.display = "none";
    });
}

// Load groups permissions table
function loadGroupsPermissionsTable(groups, permissions) {
  const tbody = document.getElementById("groups-permissions");
  if (!tbody) return;

  tbody.innerHTML = "";

  (groups || []).forEach((group) => {
    const row = document.createElement("tr");
    const viewValue =
      permissions.view_all || permissions.view_group || permissions.view_own
        ? permissions.view_all
          ? "all"
          : permissions.view_group
          ? "group"
          : "own"
        : "none";
    const editValue =
      permissions.edit_all || permissions.edit_group || permissions.edit_own
        ? permissions.edit_all
          ? "all"
          : permissions.edit_group
          ? "group"
          : "own"
        : "none";
    const deleteValue =
      permissions.delete_all ||
      permissions.delete_group ||
      permissions.delete_own
        ? permissions.delete_all
          ? "all"
          : permissions.delete_group
          ? "group"
          : "own"
        : "none";

    row.innerHTML = `
            <td>${group.name}</td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_view_${
                          group.id
                        }" id="group_view_none_${group.id}" value="none" ${
      viewValue === "none" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="group_view_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_view_${
                          group.id
                        }" id="group_view_own_${group.id}" value="own" ${
      viewValue === "own" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="group_view_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_view_${
                          group.id
                        }" id="group_view_group_${group.id}" value="group" ${
      viewValue === "group" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="group_view_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_view_${
                          group.id
                        }" id="group_view_all_${group.id}" value="all" ${
      viewValue === "all" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="group_view_all_${
                          group.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_edit_${
                          group.id
                        }" id="group_edit_none_${group.id}" value="none" ${
      editValue === "none" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="group_edit_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_edit_${
                          group.id
                        }" id="group_edit_own_${group.id}" value="own" ${
      editValue === "own" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="group_edit_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_edit_${
                          group.id
                        }" id="group_edit_group_${group.id}" value="group" ${
      editValue === "group" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="group_edit_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_edit_${
                          group.id
                        }" id="group_edit_all_${group.id}" value="all" ${
      editValue === "all" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="group_edit_all_${
                          group.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_delete_${
                          group.id
                        }" id="group_delete_none_${group.id}" value="none" ${
      deleteValue === "none" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="group_delete_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_delete_${
                          group.id
                        }" id="group_delete_own_${group.id}" value="own" ${
      deleteValue === "own" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="group_delete_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_delete_${
                          group.id
                        }" id="group_delete_group_${group.id}" value="group" ${
      deleteValue === "group" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="group_delete_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="group_delete_${
                          group.id
                        }" id="group_delete_all_${group.id}" value="all" ${
      deleteValue === "all" ? "checked" : ""
    } onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="group_delete_all_${
                          group.id
                        }">Все</label>
                    </div>
                </div>
            </td>
        `;
    tbody.appendChild(row);
  });
}

// Load users permissions table
function loadUsersPermissionsTable(users, permissions) {
  const tbody = document.getElementById("users-permissions");
  if (!tbody) return;

  tbody.innerHTML = "";

  (users || []).forEach((user) => {
    const row = document.createElement("tr");
    const viewValue =
      permissions.view_all || permissions.view_group || permissions.view_own
        ? permissions.view_all
          ? "all"
          : permissions.view_group
          ? "group"
          : "own"
        : "none";
    const editValue =
      permissions.edit_all || permissions.edit_group || permissions.edit_own
        ? permissions.edit_all
          ? "all"
          : permissions.edit_group
          ? "group"
          : "own"
        : "none";
    const deleteValue =
      permissions.delete_all ||
      permissions.delete_group ||
      permissions.delete_own
        ? permissions.delete_all
          ? "all"
          : permissions.delete_group
          ? "group"
          : "own"
        : "none";

    row.innerHTML = `
            <td><span title="${user.name}" data-bs-toggle="tooltip">${
      user.login
    }</span></td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_view_${
                          user.id
                        }" id="user_view_none_${user.id}" value="none" ${
      viewValue === "none" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value)">
                        <label class="form-check-label" for="user_view_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_view_${
                          user.id
                        }" id="user_view_own_${user.id}" value="own" ${
      viewValue === "own" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value)">
                        <label class="form-check-label" for="user_view_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_view_${
                          user.id
                        }" id="user_view_group_${user.id}" value="group" ${
      viewValue === "group" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value)">
                        <label class="form-check-label" for="user_view_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_view_${
                          user.id
                        }" id="user_view_all_${user.id}" value="all" ${
      viewValue === "all" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value)">
                        <label class="form-check-label" for="user_view_all_${
                          user.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_edit_${
                          user.id
                        }" id="user_edit_none_${user.id}" value="none" ${
      editValue === "none" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value)">
                        <label class="form-check-label" for="user_edit_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_edit_${
                          user.id
                        }" id="user_edit_own_${user.id}" value="own" ${
      editValue === "own" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value)">
                        <label class="form-check-label" for="user_edit_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_edit_${
                          user.id
                        }" id="user_edit_group_${user.id}" value="group" ${
      editValue === "group" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value)">
                        <label class="form-check-label" for="user_edit_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_edit_${
                          user.id
                        }" id="user_edit_all_${user.id}" value="all" ${
      editValue === "all" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value)">
                        <label class="form-check-label" for="user_edit_all_${
                          user.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_delete_${
                          user.id
                        }" id="user_delete_none_${user.id}" value="none" ${
      deleteValue === "none" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value)">
                        <label class="form-check-label" for="user_delete_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_delete_${
                          user.id
                        }" id="user_delete_own_${user.id}" value="own" ${
      deleteValue === "own" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value)">
                        <label class="form-check-label" for="user_delete_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_delete_${
                          user.id
                        }" id="user_delete_group_${user.id}" value="group" ${
      deleteValue === "group" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value)">
                        <label class="form-check-label" for="user_delete_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="user_delete_${
                          user.id
                        }" id="user_delete_all_${user.id}" value="all" ${
      deleteValue === "all" ? "checked" : ""
    } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value)">
                        <label class="form-check-label" for="user_delete_all_${
                          user.id
                        }">Все</label>
                    </div>
                </div>
            </td>
        `;
    tbody.appendChild(row);
  });
}

// Update group permission by level (radio)
function updateGroupPermissionLevel(groupId, action, level) {
  if (!currentSubcategoryId) return;
  const base = `group_${action}_`;
  const updated = {
    [`${base}own`]: level === "own",
    [`${base}group`]: level === "group",
    [`${base}all`]: level === "all",
  };
  Object.entries(updated).forEach(([k, v]) => {
    const key = k.replace("group_", "");
    currentPermissionsDraft.group[key] = v;
  });
  markDirty("groups");
}

// Update user permission by level (radio)
function updateUserPermissionLevel(userId, action, level) {
  if (!currentSubcategoryId) return;
  const base = `user_${action}_`;
  const updated = {
    [`${base}own`]: level === "own",
    [`${base}group`]: level === "group",
    [`${base}all`]: level === "all",
  };
  Object.entries(updated).forEach(([k, v]) => {
    const key = k.replace("user_", "");
    currentPermissionsDraft.user[key] = v;
  });
  markDirty("users");
}

// Mark dirty state
function markDirty(which) {
  if (which === "groups") {
    isDirtyGroups = true;
  } else if (which === "users") {
    isDirtyUsers = true;
  } else {
    isDirtyGroups = true;
    isDirtyUsers = true;
  }
  updateSaveButtonsState();
}

// Deep clone helper
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

// Setup save/cancel buttons
function setupSaveCancelButtons() {
  const groupsSave = document.getElementById("groups-save-btn");
  const groupsCancel = document.getElementById("groups-cancel-btn");
  const usersSave = document.getElementById("users-save-btn");
  const usersCancel = document.getElementById("users-cancel-btn");

  if (groupsSave) groupsSave.onclick = () => savePermissions("groups");
  if (usersSave) usersSave.onclick = () => savePermissions("users");
  if (groupsCancel) groupsCancel.onclick = () => cancelChanges("groups");
  if (usersCancel) usersCancel.onclick = () => cancelChanges("users");

  updateSaveButtonsState();
}

// Update save buttons state
function updateSaveButtonsState(disabledExplicitWhich) {
  const gb = document.getElementById("groups-save-btn");
  const gcb = document.getElementById("groups-cancel-btn");
  const ub = document.getElementById("users-save-btn");
  const ucb = document.getElementById("users-cancel-btn");

  const forceDisableGroups = disabledExplicitWhich === "groups";
  const forceDisableUsers = disabledExplicitWhich === "users";

  if (gb)
    gb.disabled = forceDisableGroups || !currentSubcategoryId || !isDirtyGroups;
  if (gcb)
    gcb.disabled =
      forceDisableGroups || !currentSubcategoryId || !isDirtyGroups;
  if (ub)
    ub.disabled = forceDisableUsers || !currentSubcategoryId || !isDirtyUsers;
  if (ucb)
    ucb.disabled = forceDisableUsers || !currentSubcategoryId || !isDirtyUsers;
}

// Save permissions
function savePermissions(which) {
  if (!currentSubcategoryId) return;
  updateSaveButtonsState(which);

  const payload = { permissions: currentPermissionsDraft };
  fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data && data.success) {
        lastSavedPermissions = deepClone(currentPermissionsDraft);
        if (which === "groups") {
          isDirtyGroups = false;
        } else if (which === "users") {
          isDirtyUsers = false;
        }
        const term = (getSearchInput(which)?.value || "").trim();
        loadPage(which, 1, term);

        try {
          if (window.socket && typeof window.socket.emit === "function") {
            window.socket.emit("subcategory_permissions_updated", {
              subcategory_id: currentSubcategoryId,
              which: which,
              originClientId: window.__categoriesClientId,
            });
          }
        } catch (_) {}
      } else {
        console.error("Save failed", data && data.error);
      }
    })
    .catch((e) => console.error("Save error", e))
    .finally(() => updateSaveButtonsState());
}

// Cancel changes
function cancelChanges(which) {
  if (which === "groups") {
    currentPermissionsDraft.group = deepClone(lastSavedPermissions.group);
    isDirtyGroups = false;
    const qg = (getSearchInput("groups")?.value || "").trim();
    loadPage("groups", 1, qg);
  } else if (which === "users") {
    currentPermissionsDraft.user = deepClone(lastSavedPermissions.user);
    isDirtyUsers = false;
    const qu = (getSearchInput("users")?.value || "").trim();
    loadPage("users", 1, qu);
  }
  updateSaveButtonsState();
}

// Search functionality
function getSearchContainer(which) {
  try {
    const table =
      which === "groups"
        ? document.querySelector("#groups-permissions")?.closest("table")
        : document.querySelector("#users-permissions")?.closest("table");
    if (!table) return null;
    return table.querySelector("thead tr:nth-child(2) .searchbar");
  } catch (_) {
    return null;
  }
}

function getSearchInput(which) {
  const cont = getSearchContainer(which);
  if (!cont) return null;
  const inp = cont.querySelector(".searchbar__input");
  if (inp && inp.id) {
    try {
      inp.removeAttribute("id");
    } catch (_) {}
  }
  return inp;
}

function wireSearchbar(which) {
  const cont = getSearchContainer(which);
  if (!cont) return;

  const input = getSearchInput(which);
  const clearBtn = cont.querySelector("button");

  if (input) {
    input.placeholder =
      which === "groups" ? "Поиск по группам..." : "Поиск по пользователям...";
    input.oninput = function () {
      filterTable(which);
    };
  }
  if (clearBtn) {
    clearBtn.onclick = function () {
      clearSearch(which);
    };
  }
}

function filterTable(which) {
  const term = (getSearchInput(which)?.value || "").trim();
  loadPage(which, 1, term);
}

function clearSearch(which) {
  const input = getSearchInput(which);
  if (!input) return;
  input.value = "";
  loadPage(which, 1, "");
  input.focus();
}

function loadPage(which, page, q) {
  const url = which === "groups" ? "/api/groups" : "/api/users";
  fetch(
    `${url}?page=${page}&page_size=5${q ? `&q=${encodeURIComponent(q)}` : ""}`
  )
    .then((r) => r.json())
    .then((resp) => {
      if (which === "groups") {
        loadGroupsPermissionsTable(
          resp.items || [],
          currentPermissionsDraft.group || {}
        );
      } else {
        loadUsersPermissionsTable(
          resp.items || [],
          currentPermissionsDraft.user || {}
        );
      }
      renderPagination(which, resp);
      wireSearchbar("groups");
      wireSearchbar("users");
    })
    .catch((err) => console.error("Error loading page", which, err));
}

function renderPagination(which, resp) {
  if (!resp) return;
  const total = resp.total || 0;
  const page = resp.page || 1;
  const size = resp.page_size || 5;
  const pages = Math.max(1, Math.ceil(total / size));
  const q = (getSearchInput(which)?.value || "").trim();
  const ul = document.getElementById(which + "-pagination");

  if (!ul) return;

  ul.innerHTML = "";

  const mk = (label, targetPage, disabled = false, active = false) => {
    const li = document.createElement("li");
    li.className = `page-item${disabled ? " disabled" : ""}${
      active ? " active" : ""
    }`;
    const a = document.createElement("a");
    a.className = "page-link";
    a.href = "javascript:void(0)";
    a.textContent = label;
    a.onclick = () => !disabled && loadPage(which, targetPage, q);
    li.appendChild(a);
    return li;
  };

  ul.appendChild(mk("«", 1, page === 1));
  ul.appendChild(mk("‹", Math.max(1, page - 1), page === 1));

  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let p = start; p <= end; p++) {
    ul.appendChild(mk(String(p), p, false, p === page));
  }

  ul.appendChild(mk("›", Math.min(pages, page + 1), page === pages));
  ul.appendChild(mk("»", pages, page === pages));
}

// Helper functions
function setActiveNames(categoryName, subcategoryName) {
  if (categoryName !== null && categoryName !== undefined) {
    const el = document.getElementById("active-category-name");
    if (el) el.textContent = String(categoryName || "—");
  }
  if (subcategoryName !== null && subcategoryName !== undefined) {
    const el2 = document.getElementById("active-subcategory-name");
    if (el2) el2.textContent = String(subcategoryName || "—");
  }
}

function updateDeleteButtonsState() {
  const delCat = document.getElementById("delete-category-btn");
  const delSub = document.getElementById("delete-subcategory-btn");

  if (delCat) {
    try {
      const subsOfCat = (subcategoriesCache || []).filter(
        (s) => String(s.category_id) === String(currentCategoryId)
      );
      const blocked = currentCategoryId && subsOfCat.length > 0;
      delCat.style.display = blocked
        ? "none"
        : currentCategoryId
        ? "inline-block"
        : "none";
      delCat.disabled = !currentCategoryId || blocked;
    } catch (_) {
      delCat.disabled = !currentCategoryId;
    }
  }
  if (delSub) delSub.disabled = !currentSubcategoryId;
}

// Modal functions
function showAddCategoryModal() {
  populateDisplayOrderCombo("add_display_order");

  const modal = new bootstrap.Modal(
    document.getElementById("addCategoryModal")
  );

  // Attach one-time submit guard for case-insensitive duplicate names
  try {
    const form = document.querySelector("#addCategoryModal form");
    if (form && !form._dupGuardBound) {
      form._dupGuardBound = true;
      form.addEventListener(
        "submit",
        function (e) {
          try {
            const nameInput = document.getElementById("add_display_name");
            const val = ((nameInput && nameInput.value) || "").trim();
            if (!val) return;
            e.preventDefault();
            fetch("/api/categories")
              .then((r) => r.json())
              .then((cats) => {
                const exists = (cats || []).some(
                  (c) =>
                    String(c.display_name || "").toLowerCase() ===
                    val.toLowerCase()
                );
                if (exists) {
                  alert("Категория с таким названием уже существует");
                  try {
                    nameInput && nameInput.focus();
                  } catch (_) {}
                } else {
                  form.submit();
                }
              })
              .catch(() => {
                form.submit();
              });
          } catch (_) {}
        },
        true
      );
    }
  } catch (_) {}
  modal.show();
}

function populateDisplayOrderCombo(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  fetch("/api/categories")
    .then((response) => response.json())
    .then((categories) => {
      const count = categories.length;
      select.innerHTML = "";

      for (let i = 1; i <= count + 1; i++) {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = i;
        if (i === count + 1) {
          option.selected = true;
        }
        select.appendChild(option);
      }
    })
    .catch((error) => {
      console.error("Error loading categories for display order:", error);
      select.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = i;
        if (i === 5) option.selected = true;
        select.appendChild(option);
      }
    });
}

function showAddSubcategoryModal() {
  if (currentCategoryId) {
    const categoryInput = document.getElementById("add_subcategory_category");
    if (categoryInput) {
      categoryInput.value = currentCategoryId;
    }
  }

  populateSubcategoryDisplayOrderCombo("add_subcategory_display_order");

  const modal = new bootstrap.Modal(
    document.getElementById("addSubcategoryModal")
  );
  modal.show();
}

function populateSubcategoryDisplayOrderCombo(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  if (currentCategoryId) {
    fetch(`/api/subcategories/${currentCategoryId}`)
      .then((response) => response.json())
      .then((subcategories) => {
        const count = subcategories.length;
        select.innerHTML = "";

        for (let i = 1; i <= count + 1; i++) {
          const option = document.createElement("option");
          option.value = i;
          option.textContent = i;
          if (i === count + 1) {
            option.selected = true;
          }
          select.appendChild(option);
        }
      })
      .catch((error) => {
        console.error("Error loading subcategories for display order:", error);
        select.innerHTML = "";
        for (let i = 1; i <= 5; i++) {
          const option = document.createElement("option");
          option.value = i;
          option.textContent = i;
          if (i === 5) option.selected = true;
          select.appendChild(option);
        }
      });
  } else {
    select.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = i;
      if (i === 5) option.selected = true;
      select.appendChild(option);
    }
  }
}

// Socket setup
function setupSocket() {
  try {
    if (window.io) {
      const existing =
        window.socket && typeof window.socket.on === "function"
          ? window.socket
          : null;
      const socket =
        existing ||
        window.io("/", {
          path: "/socket.io",
          withCredentials: true,
          transports: ["websocket", "polling"],
        });
      if (!existing) {
        try {
          window.socket = socket;
        } catch (_) {}
      }

      socket.on("connect_error", (err) => {
        console.warn("Socket.IO connect_error:", err && (err.message || err));
        try {
          socket.close();
        } catch (_) {}
      });
      socket.on("error", (err) => {
        console.warn("Socket.IO error:", err && (err.message || err));
      });

      try {
        socket.off && socket.off("subcategory_permissions_updated");
        socket.off && socket.off("category_updated");
        socket.off && socket.off("subcategory_updated");
      } catch (_) {}

      socket.on("subcategory_permissions_updated", (data) => {
        if (!data || !data.subcategory_id) return;
        try {
          const fromSelf = !!(
            data.originClientId &&
            window.__categoriesClientId &&
            data.originClientId === window.__categoriesClientId
          );
          if (fromSelf) return;
        } catch (_) {}
        if (String(data.subcategory_id) !== String(currentSubcategoryId))
          return;
        if (isDirtyGroups || isDirtyUsers) {
          console.log(
            "Remote update received but local changes are pending; skipping auto-refresh"
          );
          return;
        }
        const which =
          data.which === "groups" || data.which === "users" ? data.which : null;
        if (which === "groups") {
          const qg = (getSearchInput("groups")?.value || "").trim();
          loadPage("groups", 1, qg);
        } else if (which === "users") {
          const qu = (getSearchInput("users")?.value || "").trim();
          loadPage("users", 1, qu);
        } else {
          const qg = (getSearchInput("groups")?.value || "").trim();
          const qu = (getSearchInput("users")?.value || "").trim();
          loadPage("groups", 1, qg);
          loadPage("users", 1, qu);
        }
      });

      socket.on("category_updated", (data) => {
        try {
          const fromSelf = !!(
            data &&
            data.originClientId &&
            window.__categoriesClientId &&
            data.originClientId === window.__categoriesClientId
          );
          if (fromSelf) return;
        } catch (_) {}
        loadCategories();
      });

      socket.on("subcategory_updated", (data) => {
        try {
          const fromSelf = !!(
            data &&
            data.originClientId &&
            window.__categoriesClientId &&
            data.originClientId === window.__categoriesClientId
          );
          if (fromSelf) return;
        } catch (_) {}
        if (currentCategoryId) loadSubcategories(currentCategoryId);
      });
    }
  } catch (e) {
    console.warn("Socket.IO not available:", e);
  }
}

// Context menu initialization
function initCategoriesContextMenu() {
  const menu = document.getElementById("categories-context-menu");
  if (!menu) return;
  let ctx = { targetType: null, targetId: null };

  function hideMenu() {
    try {
      menu.classList.add("d-none");
    } catch (_) {}
  }

  function showMenu(x, y) {
    const menuRect = menu.getBoundingClientRect();
    const menuW = menuRect.width || 220;
    const menuH = menuRect.height || 160;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + menuW > vw) left = Math.max(0, vw - menuW - 4);
    if (top + menuH > vh) top = Math.max(0, vh - menuH - 4);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.classList.remove("d-none");
  }

  function setItemEnabled(action, enabled) {
    const el = menu.querySelector(
      '.context-menu__item[data-action="' + action + '"]'
    );
    if (!el) return;
    if (enabled) {
      el.classList.remove("disabled");
    } else {
      el.classList.add("disabled");
    }
  }

  function configureForCategory(catId) {
    ctx.targetType = "category";
    ctx.targetId = catId;
    const subsOfCat = (subcategoriesCache || []).filter(
      (s) => String(s.category_id) === String(catId)
    );
    const canDelete = subsOfCat.length === 0;
    setItemEnabled("add-category", true);
    setItemEnabled("edit-category", !!catId);
    setItemEnabled("delete-category", !!catId && canDelete);
    const hasEnabledSub = subsOfCat.some((s) => !!s.enabled);
    setItemEnabled("toggle-category", !!catId && !hasEnabledSub);

    const cat = (categoriesCache || []).find(
      (c) => String(c.id) === String(catId)
    );
    const toggleCat = menu.querySelector(
      '.context-menu__item[data-action="toggle-category"]'
    );
    if (toggleCat)
      toggleCat.textContent =
        cat && cat.enabled ? "Отключить категорию" : "Включить категорию";

    setItemEnabled("add-subcategory", !!catId);
    setItemEnabled("edit-subcategory", false);
    setItemEnabled("delete-subcategory", false);
    setItemEnabled("toggle-subcategory", false);
  }

  function configureForSubcategory(subId) {
    ctx.targetType = "subcategory";
    ctx.targetId = subId;
    const sub = (subcategoriesCache || []).find(
      (s) => String(s.id) === String(subId)
    );
    const catId = sub ? sub.category_id : currentCategoryId;
    setItemEnabled("add-category", true);
    setItemEnabled("edit-category", !!catId);
    const subsOfCat = (subcategoriesCache || []).filter(
      (s) => String(s.category_id) === String(catId)
    );
    const canDeleteCat = subsOfCat.length === 0;
    setItemEnabled("delete-category", !!catId && canDeleteCat);
    const hasEnabledSub = subsOfCat.some((s) => !!s.enabled);
    setItemEnabled("toggle-category", !!catId && !hasEnabledSub);

    setItemEnabled("add-subcategory", !!catId);
    setItemEnabled("edit-subcategory", !!subId);
    setItemEnabled("delete-subcategory", !!subId);
    setItemEnabled("toggle-subcategory", !!subId);

    const toggleSub = menu.querySelector(
      '.context-menu__item[data-action="toggle-subcategory"]'
    );
    if (toggleSub)
      toggleSub.textContent =
        sub && sub.enabled ? "Отключить подкатегорию" : "Включить подкатегорию";

    try {
      fetch(`/api/subcategory/${subId}/stats`, { credentials: "include" })
        .then((r) => r.json())
        .then((stats) => {
          const files = (stats && stats.files_count) || 0;
          setItemEnabled("delete-subcategory", !!subId && files === 0);
        })
        .catch(() => {});
    } catch (_) {}
  }

  function onContextMenuCategory(e) {
    const btn = e.target.closest("#category-nav .topbtn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    hideMenu();
    const id = btn.getAttribute("data-category-id");
    if (id) configureForCategory(id);
    else configureForCategory(currentCategoryId);
    showMenu(e.clientX, e.clientY);
  }

  function onContextMenuSubcategory(e) {
    const btn = e.target.closest("#subcategory-nav .topbtn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    hideMenu();
    const id = btn.getAttribute("data-subcategory-id");
    if (id) configureForSubcategory(id);
    else configureForSubcategory(currentSubcategoryId);
    showMenu(e.clientX, e.clientY);
  }

  document
    .getElementById("category-nav")
    ?.addEventListener("contextmenu", onContextMenuCategory);
  document
    .getElementById("subcategory-nav")
    ?.addEventListener("contextmenu", onContextMenuSubcategory);

  document
    .getElementById("content-area")
    ?.addEventListener("contextmenu", function (e) {
      if (e.target.closest("#categories-context-menu")) return;
      e.preventDefault();
      e.stopPropagation();
      hideMenu();
      if (currentSubcategoryId) {
        configureForSubcategory(currentSubcategoryId);
      } else if (currentCategoryId) {
        configureForCategory(currentCategoryId);
      } else {
        configureForCategory(null);
      }
      showMenu(e.clientX, e.clientY);
    });

  document.addEventListener("click", hideMenu);
  window.addEventListener("resize", hideMenu);

  menu.addEventListener("click", function (e) {
    const item = e.target.closest(".context-menu__item");
    if (!item || item.classList.contains("disabled")) return;
    const action = item.getAttribute("data-action");
    hideMenu();
    const targetType = ctx && ctx.targetType;
    const targetId = ctx && ctx.targetId;

    switch (action) {
      case "add-category":
        showAddCategoryModal();
        break;
      case "edit-category":
        if (targetType === "category" && targetId) {
          showEditCategoryModal(targetId);
        } else {
          showEditCategoryModal();
        }
        break;
      case "delete-category":
        if (targetType === "category" && targetId) {
          openConfirmDeleteCategory(targetId);
        } else {
          openConfirmDeleteCategory();
        }
        break;
      case "toggle-category":
        if (targetType === "category" && targetId) {
          openConfirmToggleCategory(targetId);
        } else {
          openConfirmToggleCategory();
        }
        break;
      case "add-subcategory":
        showAddSubcategoryModal();
        break;
      case "edit-subcategory":
        if (targetType === "subcategory" && targetId) {
          showEditSubcategoryModal(targetId);
        } else {
          showEditSubcategoryModal();
        }
        break;
      case "delete-subcategory":
        if (targetType === "subcategory" && targetId) {
          openConfirmDeleteSubcategory(targetId);
        } else {
          openConfirmDeleteSubcategory();
        }
        break;
      case "toggle-subcategory":
        if (targetType === "subcategory" && targetId) {
          openConfirmToggleSubcategory(targetId);
        } else {
          openConfirmToggleSubcategory();
        }
        break;
    }
  });
}

// Placeholder functions for modal operations
function showEditCategoryModal() {
  // Implementation needed
  console.log("Edit category modal not implemented yet");
}

function showEditSubcategoryModal() {
  // Implementation needed
  console.log("Edit subcategory modal not implemented yet");
}

function openConfirmDeleteCategory() {
  // Implementation needed
  console.log("Delete category confirmation not implemented yet");
}

function openConfirmDeleteSubcategory() {
  // Implementation needed
  console.log("Delete subcategory confirmation not implemented yet");
}

function openConfirmToggleCategory() {
  // Implementation needed
  console.log("Toggle category confirmation not implemented yet");
}

function openConfirmToggleSubcategory() {
  // Implementation needed
  console.log("Toggle subcategory confirmation not implemented yet");
}

function tryDeleteCategory() {
  // Implementation needed
  console.log("Delete category not implemented yet");
}

function tryDeleteSubcategory() {
  // Implementation needed
  console.log("Delete subcategory not implemented yet");
}

// Export for global access
window.CategoriesPage = {
  init: initCategoriesPage,
  loadCategories,
  selectCategory,
  selectSubcategory,
  updateGroupPermissionLevel,
  updateUserPermissionLevel,
  showAddCategoryModal,
  showAddSubcategoryModal,
};
