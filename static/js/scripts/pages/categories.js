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
  setupCategoriesSocket();

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
      window.ErrorHandler && window.ErrorHandler.handleError("Error loading categories:", error, "app");
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
  fetch(`/api/subcategories/${categoryId}`)
    .then((response) => response.json())
    .then((subcategories) => {
      subcategoriesCache = Array.isArray(subcategories) ? subcategories : [];

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
      window.ErrorHandler && window.ErrorHandler.handleError("Error loading subcategories:", error, "app");
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
    fetch("/api/groups?page=1&page_size=5").then((r) => r.json()).catch((e)=>({ error:e && (e.message||String(e)) })),
    fetch("/api/users?page=1&page_size=5").then((r) => r.json()).catch((e)=>({ error:e && (e.message||String(e)) })),
    fetch(`/api/subcategory/${subcategoryId}/permissions`).then((r) => r.json()).catch((e)=>({ error:e && (e.message||String(e)) })),
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
      // Normalize per-user matrix holder
      if (!currentPermissionsDraft.user_by_id) currentPermissionsDraft.user_by_id = {};
      // Initialize group levels for visual inheritance
      try {
        window.catGroupLevels = { view: 'none', edit: 'none', delete: 'none' };
      } catch(_) {}
      isDirtyGroups = false;
      isDirtyUsers = false;
      updateSaveButtonsState();

      // Load groups permissions table
      loadGroupsPermissionsTable(
        (groupsResp && groupsResp.items) || [],
        currentPermissionsDraft.group || {}
      );
      // Cache groups and users for display and inheritance
      try { window.categoriesGroupsData = (groupsResp && groupsResp.items) || []; } catch(_) {}
      try { window.categoriesUsersData = (usersResp && usersResp.items) || []; } catch(_) {}
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
      window.ErrorHandler && window.ErrorHandler.handleError(error, "Error loading permissions");
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
    // Detect admin group by configured name
    let isAdminGroup = false;
    try {
      const adminName = (window.adminGroupName || "Программисты").toLowerCase();
      const gName = String(group && group.name ? group.name : "").toLowerCase();
      isAdminGroup = gName === adminName;
    } catch(_) {}
    // Prefer per-group matrix if present
    const gid = String(group.id);
    const gmatrix = (currentPermissionsDraft.group_by_id && currentPermissionsDraft.group_by_id[gid]) || permissions || {};
    function levelFrom(perms, action) {
      const own = !!perms[`${action}_own`];
      const grp = !!perms[`${action}_group`];
      const all = !!perms[`${action}_all`];
      if (all) return 'all';
      if (grp) return 'group';
      if (own) return 'own';
      // defaults: no permission
      return 'none';
    }
    let viewValue = levelFrom(gmatrix, 'view');
    let editValue = levelFrom(gmatrix, 'edit');
    let deleteValue = levelFrom(gmatrix, 'delete');
    if (isAdminGroup) {
      viewValue = 'all'; editValue = 'all'; deleteValue = 'all';
    }

    // Update global group levels for visual inheritance (use strongest across groups)
    try {
      if (!window.catGroupLevels) window.catGroupLevels = { view: 'none', edit: 'none', delete: 'none' };
      const order = { none: 0, own: 1, group: 2, all: 3 };
      const pick = (cur, next) => (order[next] > order[cur] ? next : cur);
      window.catGroupLevels.view = pick(window.catGroupLevels.view, viewValue);
      window.catGroupLevels.edit = pick(window.catGroupLevels.edit, editValue);
      window.catGroupLevels.delete = pick(window.catGroupLevels.delete, deleteValue);
    } catch(_) {}

    row.innerHTML = `
            <td>${group.name}</td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_view_${
                          group.id
                        }" id="cat-g_view_none_${group.id}" value="none" ${
      viewValue === "none" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="cat-g_view_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_view_${
                          group.id
                        }" id="cat-g_view_own_${group.id}" value="own" ${
      viewValue === "own" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="cat-g_view_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_view_${
                          group.id
                        }" id="cat-g_view_group_${group.id}" value="group" ${
      viewValue === "group" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="cat-g_view_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_view_${
                          group.id
                        }" id="cat-g_view_all_${group.id}" value="all" ${
      viewValue === "all" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'view', this.value)">
                        <label class="form-check-label" for="cat-g_view_all_${
                          group.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_edit_${
                          group.id
                        }" id="cat-g_edit_none_${group.id}" value="none" ${
      editValue === "none" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="cat-g_edit_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_edit_${
                          group.id
                        }" id="cat-g_edit_own_${group.id}" value="own" ${
      editValue === "own" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="cat-g_edit_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_edit_${
                          group.id
                        }" id="cat-g_edit_group_${group.id}" value="group" ${
      editValue === "group" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="cat-g_edit_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_edit_${
                          group.id
                        }" id="cat-g_edit_all_${group.id}" value="all" ${
      editValue === "all" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'edit', this.value)">
                        <label class="form-check-label" for="cat-g_edit_all_${
                          group.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_delete_${
                          group.id
                        }" id="cat-g_delete_none_${group.id}" value="none" ${
      deleteValue === "none" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="cat-g_delete_none_${
                          group.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_delete_${
                          group.id
                        }" id="cat-g_delete_own_${group.id}" value="own" ${
      deleteValue === "own" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="cat-g_delete_own_${
                          group.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_delete_${
                          group.id
                        }" id="cat-g_delete_group_${group.id}" value="group" ${
      deleteValue === "group" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="cat-g_delete_group_${
                          group.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-g_delete_${
                          group.id
                        }" id="cat-g_delete_all_${group.id}" value="all" ${
      deleteValue === "all" ? "checked" : ""
    } ${isAdminGroup ? 'disabled' : ''} onchange="updateGroupPermissionLevel(${group.id}, 'delete', this.value)">
                        <label class="form-check-label" for="cat-g_delete_all_${
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
    // Determine user's individual level from permissions map
    function levelFrom(perms, action) {
      const own = !!perms[`${action}_own`];
      const grp = !!perms[`${action}_group`];
      const all = !!perms[`${action}_all`];
      if (all) return 'all';
      if (grp) return 'group';
      if (own) return 'own';
      return 'none';
    }
    // Determine strongest of two levels
    function maxLevel(a, b) {
      const order = { none: 0, own: 1, group: 2, all: 3 };
      return (order[b] > order[a]) ? b : a;
    }
    // Prefer per-user matrix if present. If per-user explicitly sets NONE for action, it is a priority deny over group
    const uidStr = String(user.id);
    const perUser = (currentPermissionsDraft.user_by_id && currentPermissionsDraft.user_by_id[uidStr]) || {};
    // Per-axis inherit flags (default ON if absent)
    const inheritView = (perUser.hasOwnProperty('view_inherit')) ? Number(perUser.view_inherit) : 1;
    const inheritEdit = (perUser.hasOwnProperty('edit_inherit')) ? Number(perUser.edit_inherit) : 1;
    const inheritDelete = (perUser.hasOwnProperty('delete_inherit')) ? Number(perUser.delete_inherit) : 1;
    const uView = levelFrom(perUser, 'view');
    const uEdit = levelFrom(perUser, 'edit');
    const uDelete = levelFrom(perUser, 'delete');
    // Determine group level ONLY from the user's group, not globally
    let gView = 'none', gEdit = 'none', gDelete = 'none';
    let isAdminGroupUser = false;
    try {
      const gidStr = String(user.gid || '');
      const gmatrix = (currentPermissionsDraft.group_by_id && currentPermissionsDraft.group_by_id[gidStr]) || {};
      gView = levelFrom(gmatrix, 'view');
      gEdit = levelFrom(gmatrix, 'edit');
      gDelete = levelFrom(gmatrix, 'delete');
      // Admin group forces all
      const adminName = (window.adminGroupName || 'Программисты').toLowerCase();
      const gr = (window.categoriesGroupsData || []).find((g)=> String(g.id)===gidStr);
      if (gr && String(gr.name||'').toLowerCase() === adminName) {
        gView = 'all'; gEdit = 'all'; gDelete = 'all';
        isAdminGroupUser = true;
      }
    } catch(_) {}
    // Explicit user NONE denies over group. If per-user has any flag for action (including all zeros), treat that as explicit choice
    function hasExplicit(perms, action) {
      return (perms && (perms.hasOwnProperty(`${action}_own`) || perms.hasOwnProperty(`${action}_group`) || perms.hasOwnProperty(`${action}_all`)));
    }
    // If inherit ON → take group; if OFF → take user's own (per axis)
    const effView = inheritView === 1 ? gView : uView;
    const effEdit = inheritEdit === 1 ? gEdit : uEdit;
    const effDelete = inheritDelete === 1 ? gDelete : uDelete;

    // Determine locks: admin/full-access user, or inherited from group
    let forceUser = false;
    try {
      const permStr = String((user && user.permission) || '').trim();
      const login = String((user && user.login) || '').toLowerCase();
      if (login === 'admin') forceUser = true;
      else if (permStr) {
        forceUser = (
          permStr === 'aef,a,abcdflm,ab,ab,ab,abcd' ||
          permStr === 'aef,a,abcdflm,ab,ab,ab' ||
          permStr.indexOf('z') !== -1 ||
          permStr.includes('полный доступ') ||
          permStr.includes('full access')
        );
      }
    } catch(_) {}
    // Disable only for admin/forced, admin group members
    const inherited = { view: false, edit: false, delete: false };

    const groupLabel = (function() {
      let gn = user && (user.groupname || user.group_name || user.group || user.groupName);
      if (!gn) {
        try {
          const gid = user && (user.gid || user.group_id || user.groupId);
          const list = window.categoriesGroupsData || [];
          const g = list.find((it) => String(it && it.id) === String(gid));
          if (g && g.name) gn = g.name;
        } catch(_) {}
      }
      return gn ? ` (${String(gn)})` : "";
    })();

    row.innerHTML = `
            <td><span title="${user.name}" data-bs-toggle="tooltip">${
      user.login
    }${groupLabel}</span></td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_view_${user.id}" id="cat-u_view_inherit_${user.id}" value="inherit" ${inheritView===1?'checked':''} ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value, true)">
                        <label class="form-check-label" for="cat-u_view_inherit_${user.id}">Наследовать</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_view_${
                          user.id
                        }" id="cat-u_view_none_${user.id}" value="none" ${
      inheritView===1 ? '' : (effView === 'none' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value, true)">
                        <label class="form-check-label" for="cat-u_view_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_view_${
                          user.id
                        }" id="cat-u_view_own_${user.id}" value="own" ${
      inheritView===1 ? '' : (effView === 'own' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value, true)">
                        <label class="form-check-label" for="cat-u_view_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_view_${
                          user.id
                        }" id="cat-u_view_group_${user.id}" value="group" ${
      inheritView===1 ? '' : (effView === 'group' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value, true)">
                        <label class="form-check-label" for="cat-u_view_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_view_${
                          user.id
                        }" id="cat-u_view_all_${user.id}" value="all" ${
      inheritView===1 ? '' : (effView === 'all' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'view', this.value, true)">
                        <label class="form-check-label" for="cat-u_view_all_${
                          user.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_edit_${user.id}" id="cat-u_edit_inherit_${user.id}" value="inherit" ${inheritEdit===1?'checked':''} ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value, true)">
                        <label class="form-check-label" for="cat-u_edit_inherit_${user.id}">Наследовать</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_edit_${
                          user.id
                        }" id="cat-u_edit_none_${user.id}" value="none" ${
      inheritEdit===1 ? '' : (effEdit === 'none' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value, true)">
                        <label class="form-check-label" for="cat-u_edit_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_edit_${
                          user.id
                        }" id="cat-u_edit_own_${user.id}" value="own" ${
      inheritEdit===1 ? '' : (effEdit === 'own' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value, true)">
                        <label class="form-check-label" for="cat-u_edit_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_edit_${
                          user.id
                        }" id="cat-u_edit_group_${user.id}" value="group" ${
      inheritEdit===1 ? '' : (effEdit === 'group' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value, true)">
                        <label class="form-check-label" for="cat-u_edit_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_edit_${
                          user.id
                        }" id="cat-u_edit_all_${user.id}" value="all" ${
      inheritEdit===1 ? '' : (effEdit === 'all' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'edit', this.value, true)">
                        <label class="form-check-label" for="cat-u_edit_all_${
                          user.id
                        }">Все</label>
                    </div>
                </div>
            </td>
            <td>
                <div class="perm-stack">
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_delete_${user.id}" id="cat-u_delete_inherit_${user.id}" value="inherit" ${inheritDelete===1?'checked':''} ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value, true)">
                        <label class="form-check-label" for="cat-u_delete_inherit_${user.id}">Наследовать</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_delete_${
                          user.id
                        }" id="cat-u_delete_none_${user.id}" value="none" ${
      inheritDelete===1 ? '' : (effDelete === 'none' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value, true)">
                        <label class="form-check-label" for="cat-u_delete_none_${
                          user.id
                        }">Нет</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_delete_${
                          user.id
                        }" id="cat-u_delete_own_${user.id}" value="own" ${
      inheritDelete===1 ? '' : (effDelete === 'own' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value, true)">
                        <label class="form-check-label" for="cat-u_delete_own_${
                          user.id
                        }">Свои</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_delete_${
                          user.id
                        }" id="cat-u_delete_group_${user.id}" value="group" ${
      inheritDelete===1 ? '' : (effDelete === 'group' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value, true)">
                        <label class="form-check-label" for="cat-u_delete_group_${
                          user.id
                        }">Группы</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cat-u_delete_${
                          user.id
                        }" id="cat-u_delete_all_${user.id}" value="all" ${
      inheritDelete===1 ? '' : (effDelete === 'all' ? 'checked' : '')
    } ${ (forceUser || isAdminGroupUser) ? 'disabled' : '' } onchange="updateUserPermissionLevel(${user.id}, 'delete', this.value, true)">
                        <label class="form-check-label" for="cat-u_delete_all_${
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
  const base = `${action}_`;
  const updated = {
    [`${base}own`]: level === "own",
    [`${base}group`]: level === "group",
    [`${base}all`]: level === "all",
  };
  if (!currentPermissionsDraft.group_by_id) currentPermissionsDraft.group_by_id = {};
  const gid = String(groupId);
  const existing = currentPermissionsDraft.group_by_id[gid] || {};
  Object.entries(updated).forEach(([k, v]) => { existing[k] = v ? 1 : 0; });
  currentPermissionsDraft.group_by_id[gid] = existing;
  // Update visual inheritance levels
  try {
    if (!window.catGroupLevels) window.catGroupLevels = { view: 'none', edit: 'none', delete: 'none' };
    window.catGroupLevels[action] = level;
    // Re-render users table to reflect visual inheritance
    loadUsersPermissionsTable((window.categoriesUsersData || []), currentPermissionsDraft.user || {});
  } catch(_) {}
  // Save immediately only the changed group
  const payload = { permissions: { group_by_id: {} } };
  payload.permissions.group_by_id[gid] = existing;
  fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(r=>r.json()).then((data)=>{
    if (data && (data.success || data.status === 'success')) {
      try {
        if (!lastSavedPermissions.group_by_id) lastSavedPermissions.group_by_id = {};
        lastSavedPermissions.group_by_id[gid] = JSON.parse(JSON.stringify(existing));
      } catch(_) {}
      // Emit sync event analogous to registrators after successful save
      try {
        if (window.SyncManager && window.SyncManager.getSocket && window.SyncManager.isConnected && window.SyncManager.isConnected()) {
          const s = window.SyncManager.getSocket();
          s && s.emit && s.emit('subcategory_permissions_updated', { subcategory_id: currentSubcategoryId, which: 'groups' });
        } else if (window.socket && typeof window.socket.emit === 'function') {
          window.socket.emit('subcategory_permissions_updated', { subcategory_id: currentSubcategoryId, which: 'groups' });
        }
      } catch(_) {}
    } else {
      const msg = (data && (data.error || data.message)) || 'Save failed';
      window.ErrorHandler && window.ErrorHandler.handleError(new Error(msg), 'categories-save-group');
    }
  }).catch((e)=>{
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'categories-save-group');
  });
}

// Toggle inherit for a user (default on)
window.updateUserInherit = function(userId, checked) {
  try {
    if (!currentSubcategoryId) return;
    const uid = String(userId);
    if (!currentPermissionsDraft.user_by_id) currentPermissionsDraft.user_by_id = {};
    const perUser = currentPermissionsDraft.user_by_id[uid] || {};
    perUser.inherit = checked ? 1 : 0;
    currentPermissionsDraft.user_by_id[uid] = perUser;
    const payload = { permissions: { user_by_id: {} } };
    payload.permissions.user_by_id[uid] = { inherit: perUser.inherit };
    fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(r=>r.json()).then((data)=>{
      if (!(data && (data.success || data.status==='success'))) {
        const msg = (data && (data.error || data.message)) || 'Save failed';
        window.ErrorHandler && window.ErrorHandler.handleError(new Error(msg), 'categories-save-inherit');
      }
      // Rerender to reflect enabled/disabled radios
      try { loadUsersPermissionsTable((window.categoriesUsersData||[]), currentPermissionsDraft.user||{}); } catch(_) {}
    }).catch((e)=>{
      window.ErrorHandler && window.ErrorHandler.handleError(e, 'categories-save-inherit');
    });
  } catch(e) {
    if (window.ErrorHandler) window.ErrorHandler.handleError(e, 'categories-inherit');
  }
};

// Update user permission by level (radio)
function updateUserPermissionLevel(userId, action, level, perUserOnly) {
  if (!currentSubcategoryId) return;
  if (!currentPermissionsDraft.user_by_id) currentPermissionsDraft.user_by_id = {};
  const uid = String(userId);
  const existing = currentPermissionsDraft.user_by_id[uid] || {};
  const base = `${action}_`;
  if (level === 'inherit') {
    // Mark inherit for axis and clear explicit flags
    existing[`${action}_inherit`] = 1;
    existing[`${base}own`] = 0;
    existing[`${base}group`] = 0;
    existing[`${base}all`] = 0;
  } else {
    // Explicit user choice: disable inherit and set chosen flag
    existing[`${action}_inherit`] = 0;
    existing[`${base}own`] = (level === 'own') ? 1 : 0;
    existing[`${base}group`] = (level === 'group') ? 1 : 0;
    existing[`${base}all`] = (level === 'all') ? 1 : 0;
    // Explicit 'none'
    if (level === 'none') {
      existing[`${base}own`] = 0;
      existing[`${base}group`] = 0;
      existing[`${base}all`] = 0;
    }
  }
  currentPermissionsDraft.user_by_id[uid] = existing;
  // Save immediately only the changed user
  const payload = { permissions: { user_by_id: {} } };
  payload.permissions.user_by_id[uid] = existing;
  fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(r=>r.json()).then((data)=>{
    if (data && (data.success || data.status === 'success')) {
      // update last saved snapshot for this user only
      try {
        if (!lastSavedPermissions.user_by_id) lastSavedPermissions.user_by_id = {};
        lastSavedPermissions.user_by_id[uid] = JSON.parse(JSON.stringify(existing));
      } catch(_) {}
      // Emit sync event analogous to registrators after successful save
      try {
        if (window.SyncManager && window.SyncManager.getSocket && window.SyncManager.isConnected && window.SyncManager.isConnected()) {
          const s = window.SyncManager.getSocket();
          s && s.emit && s.emit('subcategory_permissions_updated', { subcategory_id: currentSubcategoryId, which: 'users' });
        } else if (window.socket && typeof window.socket.emit === 'function') {
          window.socket.emit('subcategory_permissions_updated', { subcategory_id: currentSubcategoryId, which: 'users' });
        }
      } catch(_) {}
    } else {
      const msg = (data && (data.error || data.message)) || 'Save failed';
      window.ErrorHandler && window.ErrorHandler.handleError(new Error(msg), 'categories-save-user');
    }
  }).catch((e)=>{
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'categories-save-user');
  });
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

  // Buttons removed; instant apply mode

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

  // Send only the changed part (groups or users)
  const draft = deepClone(currentPermissionsDraft);
  if (which === 'groups') {
    try { delete draft.user; } catch(_) {}
  } else if (which === 'users') {
    try { delete draft.group; } catch(_) {}
  }
  const payload = { permissions: draft };
  fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data && (data.success || data.status === 'success')) {
        lastSavedPermissions = deepClone(currentPermissionsDraft);
        if (which === "groups") {
          isDirtyGroups = false;
        } else if (which === "users") {
          isDirtyUsers = false;
        }
        const term = (getSearchInput(which)?.value || "").trim();
        loadPage(which, 1, term);

        // Soft refresh files list for current subcategory
        try {
          if (window.SyncManager && window.SyncManager.getSocket && window.SyncManager.isConnected && window.SyncManager.isConnected()) {
            const s = window.SyncManager.getSocket();
            s && s.emit && s.emit('files:changed', { reason: 'subcategory-permissions', subcategory_id: currentSubcategoryId });
          }
        } catch(_) {}

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
        const msg = (data && (data.error || data.message)) || 'Save failed';
        window.ErrorHandler && window.ErrorHandler.handleError(new Error(msg), "categories-save");
      }
    })
    .catch((e) => window.ErrorHandler && window.ErrorHandler.handleError("Save error", e, "app"))
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
  // Prefer explicit IDs used in templates
  let inp = null;
  try {
    inp = document.getElementById(which === 'groups' ? 'groups-search' : 'users-search');
  } catch(_) {}
  if (!inp) {
    // Fallbacks to common patterns inside the container
    inp = cont.querySelector('#groups-search, #users-search, .searchbar__input, input[type="text"], input');
  }
  // Ensure accessibility: keep or set stable id and name
  if (inp) {
    const desiredId = which === 'groups' ? 'groups-search' : 'users-search';
    try {
      if (!inp.id) inp.id = desiredId;
    } catch(_) {}
    try {
      if (!inp.name) inp.name = desiredId;
    } catch(_) {}
  }
  return inp;
}

function wireSearchbar(which) {
  const cont = getSearchContainer(which);
  if (!cont) return;

  const input = getSearchInput(which);
  let clearBtn = cont.querySelector("button");

  if (input) {
    input.placeholder =
      which === "groups" ? "Поиск по группам..." : "Поиск по пользователям...";
    // Restore saved term
    try {
      const sid = String(currentSubcategoryId || '0');
      const skey = `categories:search:${which}:${sid}`;
      const saved = localStorage.getItem(skey) || '';
      if (saved && !input._restored) { input._restored = true; input.value = saved; }
    } catch(_) {}
    if (!input._catBound) {
      input._catBound = true;
      let t = null;
      const handler = function(){
        const val = (input.value || '').trim();
        try { const sid = String(currentSubcategoryId || '0'); const skey = `categories:search:${which}:${sid}`; if (val) localStorage.setItem(skey, val); else localStorage.removeItem(skey); } catch(_) {}
        filterTable(which);
      };
      input.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(handler, 250); });
      input.addEventListener('change', handler);
      input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(t); handler(); }});
    }
  }
  if (clearBtn) {
    clearBtn.onclick = function () {
      clearSearch(which);
    };
  } else {
    // Inject clear button if missing
    try {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline-secondary ms-2';
      btn.innerHTML = '<i class="bi bi-x"></i>';
      btn.title = 'Очистить';
      btn.addEventListener('click', function(){ clearSearch(which); });
      cont.appendChild(btn);
    } catch(_) {}
  }
}

function filterTable(which) {
  const term = (getSearchInput(which)?.value || "").trim();
  if (!term) {
    // Restore last page if available
    let restorePage = 1;
    try {
      const sid = String(currentSubcategoryId || '0');
      const pkey = `categories:lastPage:${which}:${sid}`;
      const saved = parseInt(localStorage.getItem(pkey) || '0', 10) || 0;
      if (saved > 0) restorePage = saved;
    } catch(_) {}
    loadPage(which, restorePage, "");
  } else {
    loadPage(which, 1, term);
  }
}

function clearSearch(which) {
  const input = getSearchInput(which);
  if (!input) return;
  input.value = "";
  try { const sid = String(currentSubcategoryId || '0'); const skey = `categories:search:${which}:${sid}`; localStorage.removeItem(skey); } catch(_) {}
  // Restore last page if available
  let restorePage = 1;
  try {
    const sid = String(currentSubcategoryId || '0');
    const pkey = `categories:lastPage:${which}:${sid}`;
    const saved = parseInt(localStorage.getItem(pkey) || '0', 10) || 0;
    if (saved > 0) restorePage = saved;
  } catch(_) {}
  loadPage(which, restorePage, "");
  input.focus();
}

function loadPage(which, page, q) {
  const url = which === "groups" ? "/api/groups" : "/api/users";
  // Backend expects 'search' param; keep 'q' fallback if supported
  const qs = q
    ? `&search=${encodeURIComponent(q)}&q=${encodeURIComponent(q)}`
    : "";
  fetch(`${url}?page=${page}&page_size=10${qs}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
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
    .catch((err) => window.ErrorHandler && window.ErrorHandler.handleError("Error loading page", which, err, "app"));
}

function renderPagination(which, resp) {
  if (!resp) return;
  const total = resp.total || 0;
  const page = resp.page || 1;
  const size = resp.page_size || 10;
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
    a.onclick = () => {
      if (disabled) return;
      // Persist page per subcategory
      try {
        const sid = String(currentSubcategoryId || '0');
        const pkey = `categories:lastPage:${which}:${sid}`;
        localStorage.setItem(pkey, String(targetPage));
      } catch(_) {}
      loadPage(which, targetPage, q);
    };
    li.appendChild(a);
    return li;
  };

  ul.appendChild(mk("«", 1, page === 1));
  ul.appendChild(mk("‹", Math.max(1, page - 1), page === 1));

  // Always show first page
  ul.appendChild(mk("1", 1, false, page === 1));

  // Middle window of pages
  const windowSize = 3;
  let start = Math.max(2, page - 1);
  let end = Math.min(pages - 1, page + 1);
  while (end - start + 1 < windowSize && start > 2) start--;
  while (end - start + 1 < windowSize && end < pages - 1) end++;

  if (start > 2) {
    const li = document.createElement("li");
    li.className = "page-item disabled";
    li.innerHTML = '<span class="page-link">…</span>';
    ul.appendChild(li);
  }

  for (let p = start; p <= end; p++) {
    ul.appendChild(mk(String(p), p, false, p === page));
  }

  if (end < pages - 1) {
    const li = document.createElement("li");
    li.className = "page-item disabled";
    li.innerHTML = '<span class="page-link">…</span>';
    ul.appendChild(li);
  }

  // Always show last page if > 1
  if (pages > 1) {
    ul.appendChild(mk(String(pages), pages, false, page === pages));
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
      window.ErrorHandler && window.ErrorHandler.handleError("Error loading categories for display order:", error, "app");
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
        window.ErrorHandler && window.ErrorHandler.handleError("Error loading subcategories for display order:", error, "app");
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
        try {
          socket.close();
        } catch (_) {}
      });
      socket.on("error", (err) => {
      });

      try {
        socket.off && socket.off("subcategory_permissions_updated");
        socket.off && socket.off("category_updated");
        socket.off && socket.off("subcategory_updated");
        socket.off && socket.off("categories:changed");
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
          window.ErrorHandler && window.ErrorHandler.handleError(
            new Error("Remote update received but local changes are pending; skipping auto-refresh"),
            "categories-sync"
          );
          return;
        }
        // Refetch full permissions to sync state precisely
        try { loadPermissions(currentSubcategoryId); } catch (_) {
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

      // Backward-compat: some server paths emit 'categories:changed'
      socket.on("categories:changed", (data) => {
        try {
          const fromSelf = !!(
            data &&
            data.originClientId &&
            window.__categoriesClientId &&
            data.originClientId === window.__categoriesClientId
          );
          if (fromSelf) return;
        } catch (_) {}
        try {
          const kind = (data && data.kind) || (data && data.type) || "";
          if (kind === "category") {
            loadCategories();
            return;
          }
          if (kind === "subcategory") {
            if (currentCategoryId) loadSubcategories(currentCategoryId);
            return;
          }
          // Fallback: refresh both lists
          loadCategories();
          if (currentCategoryId) loadSubcategories(currentCategoryId);
        } catch(_) {}
      });

      // Soft refresh files on permissions change affecting current subcategory
      socket.on("files:changed", (data) => {
        try {
          if (!data) return;
          if (String(data.subcategory_id || "") !== String(currentSubcategoryId || "")) return;
          // Try global soft refresh function if available
          if (typeof window.softRefreshFiles === "function") {
            window.softRefreshFiles({ reason: "subcategory-permissions", subcategory_id: currentSubcategoryId });
            return;
          }
          // Fallback: emit a DOM event other modules can listen to
          try {
            const evt = new CustomEvent("files:soft-refresh", { detail: { reason: "subcategory-permissions", subcategory_id: currentSubcategoryId } });
            window.dispatchEvent(evt);
          } catch(_) {}
        } catch (_) {}
      });

      // Join categories room for force logout events
      if (socket && socket.connected) {
        socket.emit("join-room", "categories");
      }

      // Handle force logout
      socket.on("force-logout", function (data) {
        try {
          // Redirect to logout
          window.location.replace("/logout");
        } catch (err) {
          window.ErrorHandler && window.ErrorHandler.handleError("Force logout error:", err, "app");
        }
      });

      // Handle force refresh
      socket.on("force-refresh", function (data) {
        try {
          // Show notification before refresh
          if (window.showToast) {
            window.showToast(
              "Страница будет обновлена администратором",
              "warning"
            );
          }
          // Hard refresh the page
          setTimeout(() => {
            // Force refresh all pages - use hard refresh for complete reset
            const url = new URL(window.location);
            url.searchParams.set("_refresh", Date.now());
            window.location.href = url.toString();
          }, 1000);
        } catch (err) {
          window.ErrorHandler && window.ErrorHandler.handleError("Force refresh error:", err, "app");
        }
      });
    }
  } catch (e) {
  }
}

// Registrators-like socket setup for categories (SyncManager-first with fallback)
function setupCategoriesSocket() {
  try {
    // Prefer SyncManager
    if (window.SyncManager && typeof window.SyncManager.on === 'function') {
      if (!window.__categoriesSyncBound) {
        window.__categoriesSyncBound = true;
        // Debouncers
        if (!window.__categoriesDebounceTimer) window.__categoriesDebounceTimer = null;
        function debounce(fn, ms){
          return function(){
            clearTimeout(window.__categoriesDebounceTimer);
            var self=this, args=arguments;
            window.__categoriesDebounceTimer = setTimeout(function(){ fn.apply(self, args); }, ms||300);
          };
        }
        const reloadLists = debounce(function(){
          loadCategories();
          if (currentCategoryId) loadSubcategories(currentCategoryId);
        });
        const reloadGroups = debounce(function(){
          const qg = (getSearchInput('groups')?.value || '').trim();
          loadPage('groups', 1, qg);
        });
        const reloadUsers = debounce(function(){
          const qu = (getSearchInput('users')?.value || '').trim();
          loadPage('users', 1, qu);
        });

        window.SyncManager.on('categories:changed', function(){ if (!document.hidden) reloadLists(); });
        window.SyncManager.on('subcategories:changed', function(){ if (!document.hidden) reloadLists(); });
        window.SyncManager.on('subcategory_permissions_updated', function(data){
          if (document.hidden) return;
          if (!data || String(data.subcategory_id||'') !== String(currentSubcategoryId||'')) return;
          if (isDirtyGroups || isDirtyUsers) return;
          // Refetch permissions to get latest state from server, then re-render tables
          try { loadPermissions(currentSubcategoryId); } catch(_) {
            reloadGroups();
            reloadUsers();
          }
        });
        window.SyncManager.on('files:changed', function(data){
          if (!data) return;
          if (String(data.subcategory_id || '') !== String(currentSubcategoryId || '')) return;
          try {
            if (typeof window.softRefreshFiles === 'function') {
              window.softRefreshFiles({ reason: 'subcategory-permissions', subcategory_id: currentSubcategoryId });
            } else {
              const evt = new CustomEvent('files:soft-refresh', { detail: { reason: 'subcategory-permissions', subcategory_id: currentSubcategoryId } });
              window.dispatchEvent(evt);
            }
          } catch(_) {}
        });
        if (window.SyncManager.joinRoom) window.SyncManager.joinRoom('categories');
      }
      return;
    }
  } catch(_) {}
  // Fallback to page-local socket
  setupSocket();
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
}

function showEditSubcategoryModal() {
  // Implementation needed
}

function openConfirmDeleteCategory() {
  // Implementation needed
}

function openConfirmDeleteSubcategory() {
  // Implementation needed
}

function openConfirmToggleCategory() {
  // Implementation needed
}

function openConfirmToggleSubcategory() {
  // Implementation needed
}

function tryDeleteCategory() {
  // Implementation needed
}

function tryDeleteSubcategory() {
  // Implementation needed
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
