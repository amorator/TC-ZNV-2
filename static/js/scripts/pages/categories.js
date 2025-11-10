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
  

  // Initialize Notification API bridge for categories events
  try { initCategoriesNotifications(); } catch(_) {}

  // Wire shared searchbars
  wireSearchbar("groups");
  wireSearchbar("users");

  // Wire header save buttons
  const delCat = document.getElementById("delete-category-btn");
  const delSub = document.getElementById("delete-subcategory-btn");
  if (delCat) delCat.onclick = function(){ openConfirmDeleteCategory(); };
  if (delSub) delSub.onclick = function(){ openConfirmDeleteSubcategory(); };

  initCategoriesContextMenu();
}
// Notifications: request permission, show, and fetch queued items from server
function initCategoriesNotifications() {
  // Disabled browser notifications by request
  return;
}

function showNotificationSafe(title, body, icon) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    var options = {};
    if (body) options.body = String(body);
    if (icon) options.icon = String(icon);
    var n = new Notification(String(title || 'Уведомление'), options);
    setTimeout(function(){ try { n && n.close && n.close(); } catch(_) {} }, 6000);
  } catch(_) {}
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

// (removed) local modal hide workaround; global modal-manager now handles focus/aria

// Toast notification helper
function notify(message, variant) {
  try {
    const container = document.getElementById("toastContainer");
    if (!container) {
      alert(message);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `toast align-items-center text-bg-${variant || "primary"} border-0`;
    wrapper.setAttribute("role", "alert");
    wrapper.setAttribute("aria-live", "assertive");
    wrapper.setAttribute("aria-atomic", "true");
    wrapper.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>`;
    container.appendChild(wrapper);
    try {
      if (window.bootstrap && bootstrap.Toast) {
        const t = new bootstrap.Toast(wrapper, { delay: 3000 });
        t.show();
        wrapper.addEventListener("hidden.bs.toast", () => { try { wrapper.remove(); } catch (_) {} });
      } else {
        // Fallback: just show and auto-remove
        wrapper.classList.add('show');
        setTimeout(()=>{ try { wrapper.remove(); } catch(_) {} }, 3000);
      }
    } catch (e) {
      alert(message);
    }
  } catch (e) {
    try { alert(message); } catch (__) {}
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
      try { if (window.__categoriesSilentReload) return; } catch(_) {}
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
  // Sync empty-state toggle button text
  try { updateEmptyStateToggleTexts(); } catch(_) {}

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
      try { if (window.__categoriesSilentReload) return; } catch(_) {}
      window.ErrorHandler && window.ErrorHandler.handleError("Error loading subcategories:", error, "app");
      showEmptySubcategories();
    });
}

// Show empty subcategories state
function showEmptySubcategories() {
  // Reset current subcategory so context menu does not think a sub is selected
  try { currentSubcategoryId = null; } catch(_) {}
  showSubcategoryTabs([]);
  const emptySubcategories = document.getElementById("empty-subcategories");
  const permissionsContent = document.getElementById("permissions-content");

  if (emptySubcategories) emptySubcategories.style.display = "block";
  if (permissionsContent) permissionsContent.style.display = "none";
  // Ensure toggle button text reflects current category state
  try { updateEmptyStateToggleTexts(); } catch(_) {}
}

// Show subcategory tabs
function showSubcategoryTabs(subcategories) {
  const subcategoryTabs = document.getElementById("subcategory-tabs");
  const subcategoryNav = document.getElementById("subcategory-nav");

  if (!subcategoryNav) return;

  subcategoryNav.innerHTML = "";

  if (subcategories.length === 0) {
    // Ensure no stale subcategory selection remains
    try { currentSubcategoryId = null; } catch(_) {}
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
  // Keep empty-state action texts in sync whenever tabs render
  try { updateEmptyStateToggleTexts(); } catch(_) {}
}

// Update texts for empty-subcategories action buttons depending on current category state
function updateEmptyStateToggleTexts() {
  try {
    const cont = document.getElementById('empty-subcategories-actions');
    if (!cont) return;
    const btnToggle = Array.from(cont.querySelectorAll('button'))
      .find((b) => (b.getAttribute('onclick') || '').includes('openConfirmToggleCategory'));
    if (!btnToggle) return;
    const cat = (categoriesCache || []).find((c)=> String(c.id) === String(currentCategoryId));
    const enabled = !!(cat && cat.enabled);
    btnToggle.textContent = enabled ? 'Отключить категорию' : 'Включить категорию';
  } catch(_) {}
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
  // Derive initial pages/sizes from URL (?page_groups, ?page_size_groups, ?page_users, ?page_size_users)
  const url0 = new URL(window.location.href);
  const pG = parseInt(url0.searchParams.get('page_groups') || '1', 10) || 1;
  const sG = parseInt(url0.searchParams.get('page_size_groups') || '10', 10) || 10;
  const pU = parseInt(url0.searchParams.get('page_users') || '1', 10) || 1;
  const sU = parseInt(url0.searchParams.get('page_size_users') || '10', 10) || 10;
  const qG = url0.searchParams.get('q_groups') || '';
  const qU = url0.searchParams.get('q_users') || '';
  const qsG = qG ? `&search=${encodeURIComponent(qG)}&q=${encodeURIComponent(qG)}` : '';
  const qsU = qU ? `&search=${encodeURIComponent(qU)}&q=${encodeURIComponent(qU)}` : '';
  Promise.all([
    fetch(`/api/groups?page=${pG}&page_size=${sG}${qsG}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then((r) => r.json()).catch((e)=>({ error:e && (e.message||String(e)) })),
    fetch(`/api/users?page=${pU}&page_size=${sU}${qsU}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then((r) => r.json()).catch((e)=>({ error:e && (e.message||String(e)) })),
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
        // Save search query to URL parameter
        try {
          const u = new URL(window.location.href);
          if (term) {
            u.searchParams.set('q', term);
          } else {
            u.searchParams.delete('q');
          }
          window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
        } catch(_) {}

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
    // Restore saved term from URL parameter (per table)
    try {
      const url = new URL(window.location.href);
      const paramName = (which === 'groups') ? 'q_groups' : 'q_users';
      const urlQ = url.searchParams.get(paramName) || '';
      if (urlQ && !input._restored) {
        input._restored = true;
        input.value = urlQ;
      } else {
      // No fallback to localStorage - search is only in URL now
      }
    } catch(_) {}
    if (!input._catBound) {
      input._catBound = true;
      let t = null;
      const handler = function(){
        const val = (input.value || '').trim();
        // No longer using localStorage, search is stored in URL parameter q=
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
  // Update URL with search query (per table)
  try {
    const u = new URL(window.location.href);
    const paramName = (which === 'groups') ? 'q_groups' : 'q_users';
    if (term) u.searchParams.set(paramName, term); else u.searchParams.delete(paramName);
    window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
  } catch(_) {}
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
  // Remove search query from URL (per table)
  try {
    const u = new URL(window.location.href);
    const paramName = (which === 'groups') ? 'q_groups' : 'q_users';
    u.searchParams.delete(paramName);
    window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
  } catch(_) {}
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
  // Backend expects 'q' (keep 'search' for compatibility)
  const qs = q ? `&search=${encodeURIComponent(q)}&q=${encodeURIComponent(q)}` : "";
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
    // Build explicit href with page params in URL
    const cur = new URL(window.location.href);
    if (which === 'groups') {
      cur.searchParams.set('page_groups', String(targetPage));
      cur.searchParams.set('page_size_groups', String(size));
    } else {
      cur.searchParams.set('page_users', String(targetPage));
      cur.searchParams.set('page_size_users', String(size));
    }
    const qParam = (q ? `&${which}_q=${encodeURIComponent(q)}` : '');
    a.href = `${cur.pathname}?${cur.searchParams.toString()}${qParam}`;
    a.textContent = label;
    a.setAttribute('data-page', String(targetPage));
    a.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
      if (disabled) return;
      // Persist page per subcategory
      try {
        const sid = String(currentSubcategoryId || '0');
        const pkey = `categories:lastPage:${which}:${sid}`;
        localStorage.setItem(pkey, String(targetPage));
      } catch(_) {}
      loadPage(which, targetPage, q);
      // Reflect in URL without reload
      try {
        const u = new URL(window.location.href);
        if (which === 'groups') {
          u.searchParams.set('page_groups', String(targetPage));
          u.searchParams.set('page_size_groups', String(size));
        } else {
          u.searchParams.set('page_users', String(targetPage));
          u.searchParams.set('page_size_users', String(size));
        }
        // Preserve search query in URL
        if (q) {
          u.searchParams.set('q', q);
        }
        window.history.replaceState(null, '', `${u.pathname}?${u.searchParams.toString()}`);
      } catch(_) {}
    }, true);
    li.appendChild(a);
    return li;
  };

  ul.appendChild(mk("⏮", 1, page === 1));
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
  ul.appendChild(mk("⏭", pages, page === pages));
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

      // Handle force refresh (AJAX soft reload instead of hard refresh)
      socket.on("force-refresh", function () {
        try {
          if (window.showToast) {
            window.showToast("Обновление данных…", "info");
          }
          const savedCat = currentCategoryId;
          const savedSub = currentSubcategoryId;
          loadCategories();
          if (savedCat) {
            setTimeout(() => { try { selectCategory(savedCat); } catch(_) {} }, 50);
          }
          if (savedCat) {
            setTimeout(() => { try { loadSubcategories(savedCat); } catch(_) {} }, 100);
          }
          if (savedSub) {
            setTimeout(() => { try { selectSubcategory(savedSub); } catch(_) {} }, 150);
          }
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
          try { window.__categoriesSilentReload = true; } catch(_) {}
          try { loadCategories(); } catch(e) { }
          try { if (currentCategoryId) { loadSubcategories(currentCategoryId); } } catch(e) { }
          try { window.__categoriesSilentReload = false; } catch(_) {}
          // NOTE: Server HTML replacement disabled on categories page to avoid wiping client-rendered nav
          
        });
        const reloadGroups = debounce(function(){
          const qg = (getSearchInput('groups')?.value || '').trim();
          loadPage('groups', 1, qg);
        });
        const reloadUsers = debounce(function(){
          const qu = (getSearchInput('users')?.value || '').trim();
          loadPage('users', 1, qu);
        });

        window.SyncManager.on('categories:changed', function(data){ reloadLists(); });
        window.SyncManager.on('subcategories:changed', function(data){ reloadLists(); });
        // NEW: handle legacy event names some endpoints emit
        window.SyncManager.on('category_updated', function(data){ reloadLists(); });
        window.SyncManager.on('subcategory_updated', function(data){ reloadLists(); });

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
        if (window.SyncManager.joinRoom) { window.SyncManager.joinRoom('categories'); }
        // Idle-guard: refresh lists if долго нет событий (30s по умолчанию)
        // idle-guard запускается глобально в core/base.js
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

  function setItemVisible(action, visible) {
    const el = menu.querySelector(
      '.context-menu__item[data-action="' + action + '"]'
    );
    if (!el) return;
    try { el.style.display = visible ? "" : "none"; } catch(_) {}
    try {
      if (visible) el.classList.remove('d-none'); else el.classList.add('d-none');
    } catch(_) {}
    // aria-hidden toggling is managed globally by modal-manager focus guards
  }

  // Hard remove/restore helpers for subcategory items to avoid CSS overrides
  function ensureSubItemsPresent() {
    try {
      const list = menu.querySelector('.context-menu__list');
      // Ensure separator
      let sep = menu.querySelector('.context-menu__separator');
      if (!sep) {
        sep = document.createElement('li');
        sep.className = 'context-menu__separator';
        list.appendChild(sep);
      }
      // Ensure each sub-item exists
      const defs = [
        ['edit-subcategory', 'Изменить подкатегорию'],
        ['delete-subcategory', 'Удалить подкатегорию'],
        ['toggle-subcategory', 'Отключить подкатегорию']
      ];
      defs.forEach(([action, label]) => {
        let el = menu.querySelector('.context-menu__item[data-action="' + action + '"]');
        if (!el) {
          el = document.createElement('li');
          el.className = 'context-menu__item';
          el.setAttribute('data-action', action);
          el.textContent = label;
          list.appendChild(el);
        }
      });
    } catch(_) {}
  }

  function hardHideSubItems() {
    try {
      const list = menu.querySelector('.context-menu__list');
      ['edit-subcategory','delete-subcategory','toggle-subcategory'].forEach((a)=>{
        const el = menu.querySelector('.context-menu__item[data-action="' + a + '"]');
        if (el && el.parentNode === list) list.removeChild(el);
      });
      const sep = menu.querySelector('.context-menu__separator');
      if (sep && sep.parentNode === list) list.removeChild(sep);
    } catch(_) {}
  }

  function configureForCategory(catId) {
    ctx.targetType = "category";
    ctx.targetId = catId;
    const subsOfCat = catId ? (subcategoriesCache || []).filter(
      (s) => String(s.category_id) === String(catId)
    ) : [];
    // More reliable: derive presence of subcategories from DOM too
    let hasAnySubs = !!catId && subsOfCat.length > 0;
    try {
      const domSubs = document.querySelectorAll('#subcategory-nav .topbtn[data-subcategory-id]');
      if (domSubs && domSubs.length >= 0 && catId) {
        hasAnySubs = hasAnySubs || domSubs.length > 0;
      }
    } catch(_) {}
    // Do not disable actions: allow click to show blocking toast in handlers
    setItemEnabled("add-category", true);
    setItemEnabled("edit-category", !!catId);
    setItemEnabled("delete-category", !!catId);
    setItemEnabled("toggle-category", !!catId);

    const cat = (categoriesCache || []).find(
      (c) => String(c.id) === String(catId)
    );
    const toggleCat = menu.querySelector(
      '.context-menu__item[data-action="toggle-category"]'
    );
    if (toggleCat)
      toggleCat.textContent =
        cat && cat.enabled ? "Отключить категорию" : "Включить категорию";

    // Async refresh to ensure freshest enabled state across clients
    try {
      fetch('/api/categories', { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' }})
        .then(function(r){ return r && r.ok ? r.json() : null; })
        .then(function(list){
          if (!list) { return; }
          categoriesCache = Array.isArray(list)
            ? list.slice().sort(function(a,b){ return Number(a && a.display_order || 0) - Number(b && b.display_order || 0); })
            : [];
          const fresh = categoriesCache.find(function(c){ return String(c && c.id) === String(catId); });
          const el = menu && menu.querySelector('.context-menu__item[data-action="toggle-category"]');
          if (el) {
            el.textContent = fresh && fresh.enabled ? 'Отключить категорию' : 'Включить категорию';
          }
        }).catch(function(err){ });
    } catch(e) { }

    setItemEnabled("add-subcategory", !!catId);
    // When no subcategories for this category, remove subcategory actions entirely
    if (!hasAnySubs) {
      hardHideSubItems();
    } else {
      // Ensure items exist but keep them disabled until a specific sub is targeted
      ensureSubItemsPresent();
    setItemEnabled("edit-subcategory", false);
    setItemEnabled("delete-subcategory", false);
    setItemEnabled("toggle-subcategory", false);
    }
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
    // Keep category actions enabled; handlers enforce blocking with toasts
    setItemEnabled("delete-category", !!catId);
    setItemEnabled("toggle-category", !!catId);

    setItemEnabled("add-subcategory", !!catId);
    // Subcategory is targeted: ensure sub-actions exist and are enabled
    ensureSubItemsPresent();
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

  // Fallback: open context menu over any other part of the page body not covered above
  try {
    document.body.addEventListener("contextmenu", function (e) {
      try { if (!menu || menu.contains(e.target)) return; } catch(_) {}
      // Ignore if right-click on form fields to keep native menu behavior
      const isEditable = e.target && (e.target.closest('input, textarea, select, [contenteditable="true"]'));
      if (isEditable) return;
      // If event already handled by more specific handlers, skip
      if (e.target.closest('#category-nav, #subcategory-nav, #content-area')) return;
      e.preventDefault();
      hideMenu();
      if (currentSubcategoryId) {
        configureForSubcategory(currentSubcategoryId);
      } else if (currentCategoryId) {
        configureForCategory(currentCategoryId);
      } else {
        configureForCategory(null);
      }
      showMenu(e.clientX, e.clientY);
    }, false);
  } catch(_) {}

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
  try {
    const catId = arguments && arguments[0] ? arguments[0] : currentCategoryId;
    if (!catId) return;
    const cat = (categoriesCache || []).find((c) => String(c.id) === String(catId));
    if (!cat) return;

    // Set form action
    const form = document.getElementById('category-edit-form');
    if (form) {
      form.setAttribute('action', `/categories/edit/${catId}`);
      form.setAttribute('method', 'POST');
    }

    // Populate fields
    const nameInput = document.getElementById('edit_category_display_name');
    if (nameInput) nameInput.value = String(cat.display_name || '');
    const enabledInput = document.getElementById('edit_category_enabled');
    if (enabledInput) enabledInput.checked = !!cat.enabled;

    // Populate order options based on number of categories
    const orderSelect = document.getElementById('edit_category_display_order');
    if (orderSelect) {
      const count = (categoriesCache || []).length;
      orderSelect.innerHTML = '';
      for (let i = 1; i <= Math.max(1, count); i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        if (Number(cat.display_order || 0) === i) opt.selected = true;
        orderSelect.appendChild(opt);
      }
    }

    // Show modal
    const modalEl = document.getElementById('editCategoryModal');
    if (modalEl && window.bootstrap && bootstrap.Modal) {
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    }
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'category-edit-open');
  }
}

function showEditSubcategoryModal() {
  try {
    const subId = arguments && arguments[0] ? arguments[0] : currentSubcategoryId;
    if (!subId) return;
    const sub = (subcategoriesCache || []).find((s) => String(s.id) === String(subId));
    if (!sub) return;

    // Set form action
    const form = document.getElementById('subcategory-edit-form');
    if (form) {
      form.setAttribute('action', `/subcategories/edit/${subId}`);
      form.setAttribute('method', 'POST');
    }

    // Populate fields
    const nameInput = document.getElementById('edit_subcategory_display_name');
    if (nameInput) nameInput.value = String(sub.display_name || '');
    const enabledInput = document.getElementById('edit_subcategory_enabled');
    if (enabledInput) enabledInput.checked = !!sub.enabled;

    // Populate order options based on number of subcategories in the same category
    const orderSelect = document.getElementById('edit_subcategory_display_order');
    if (orderSelect) {
      const inCat = (subcategoriesCache || []).filter((s) => String(s.category_id) === String(sub.category_id));
      const count = inCat.length;
      orderSelect.innerHTML = '';
      for (let i = 1; i <= Math.max(1, count); i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        if (Number(sub.display_order || 0) === i) opt.selected = true;
        orderSelect.appendChild(opt);
      }
    }

    // Show modal
    const modalEl = document.getElementById('editSubcategoryModal');
    if (modalEl && window.bootstrap && bootstrap.Modal) {
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    }
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'subcategory-edit-open');
  }
}

function openConfirmDeleteCategory() {
  try {
    const catId = arguments && arguments[0] ? arguments[0] : currentCategoryId;
    if (!catId) { return; }
    // Disallow when there are subcategories (verify via cache, fallback to API)
    try {
      const subsOfCat = (subcategoriesCache || []).filter((s) => String(s.category_id) === String(catId));
      if (subsOfCat.length > 0) {
        notify("Нельзя удалить категорию с подкатегориями", "warning");
        return;
      }
    } catch (_) {}
    // If cache is empty or unknown, check server
    if (!Array.isArray(subcategoriesCache) || (subcategoriesCache.filter((s)=> String(s.category_id)===String(catId)).length===0)) {
      fetch(`/api/subcategories/${catId}`, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
        .then(r=> r.json().catch(()=>({ items: [] })))
        .then((data)=>{
          const list = (data && (data.items || data)) || [];
          if (Array.isArray(list) && list.length > 0) {
            notify("Нельзя удалить категорию с подкатегориями", "warning");
            return;
          }
          // No subcategories: proceed with modal/native confirm flow again
          const modalEl = document.getElementById("confirmDeleteCategoryModal");
          if (modalEl && window.bootstrap && bootstrap.Modal) {
            modalEl.dataset.targetId = String(catId);
            const bindConfirm = () => {
              const btn = document.getElementById('confirmDeleteCategoryBtn') || modalEl.querySelector('[data-action="confirm"], .btn-primary, .btn-danger');
              if (!btn) return;
              const handler = function(ev) {
                try { ev && ev.preventDefault && ev.preventDefault(); } catch(_) {}
                try { btn.removeEventListener('click', handler); } catch(_) {}
                try { const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); inst.hide(); } catch(_) {}
                tryDeleteCategory(modalEl.dataset.targetId);
              };
              btn.addEventListener('click', handler, { once: true });
            };
            modalEl.addEventListener('shown.bs.modal', bindConfirm, { once: true });
            const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            inst.show();
            return;
          }
          if (!confirm("Удалить категорию?")) return;
          tryDeleteCategory(catId);
        })
        .catch(()=>{ notify('Не удалось проверить подкатегории категории', 'danger'); });
      return;
    }
    const modalEl = document.getElementById("confirmDeleteCategoryModal");
    if (modalEl && window.bootstrap && bootstrap.Modal) {
      modalEl.dataset.targetId = String(catId);
      // Wire one-time confirm handler
      const bindConfirm = () => {
        const btn = document.getElementById('confirmDeleteCategoryBtn') || modalEl.querySelector('[data-action="confirm"], .btn-primary, .btn-danger');
        if (!btn) return;
        const handler = function(ev) {
          try { ev && ev.preventDefault && ev.preventDefault(); } catch(_) {}
          try { btn.removeEventListener('click', handler); } catch(_) {}
          try { const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); inst.hide(); } catch(_) {}
          tryDeleteCategory(modalEl.dataset.targetId);
        };
        btn.addEventListener('click', handler, { once: true });
      };
      // Ensure rebind each time it's shown
      modalEl.addEventListener('shown.bs.modal', bindConfirm, { once: true });
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
      return;
    }
    // Fallback: native confirm
    if (!confirm("Удалить категорию?")) return;
    tryDeleteCategory(catId);
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, "category-delete-confirm");
  }
}

function openConfirmDeleteSubcategory() {
  try {
    const subId = arguments && arguments[0] ? arguments[0] : currentSubcategoryId;
    if (!subId) return;
    const modalEl = document.getElementById("confirmDeleteSubcategoryModal");
    if (modalEl && window.bootstrap && bootstrap.Modal) {
      modalEl.dataset.targetId = String(subId);
      const bindConfirm = () => {
        const btn = document.getElementById('confirmDeleteSubcategoryBtn') || modalEl.querySelector('[data-action="confirm"], .btn-primary, .btn-danger');
        if (!btn) return;
        const handler = function(ev) {
          try { ev && ev.preventDefault && ev.preventDefault(); } catch(_) {}
          try { btn.removeEventListener('click', handler); } catch(_) {}
          try { const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); inst.hide(); } catch(_) {}
          tryDeleteSubcategory(modalEl.dataset.targetId);
        };
        btn.addEventListener('click', handler, { once: true });
      };
      modalEl.addEventListener('shown.bs.modal', bindConfirm, { once: true });
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
      return;
    }
    // Fallback: native confirm
    if (!confirm("Удалить подкатегорию? Файлы будут недоступны из этой подкатегории.")) return;
    tryDeleteSubcategory(subId);
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, "subcategory-delete-confirm");
  }
}

function openConfirmToggleCategory(catId) {
  if (!catId) { catId = currentCategoryId; }
  if (!catId) { return; }
  const cat = (categoriesCache || []).find((c)=> String(c.id)===String(catId));
  const desired = !(cat && (cat.enabled ? true : false));
  // If we are disabling a category, ensure there are no enabled subcategories
  if (!desired) {
    const proceed = () => {
      const fd = new FormData();
      fd.append('enabled', desired ? '1' : '');
      fetch(`/categories/edit/${catId}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
        .then(r=>r.json().catch(()=>({})).then((j)=>({ ok: r.ok, status: r.status, body: j })))
        .then((resp)=>{
          if (!resp.ok || (resp.body && resp.body.error)) {
            notify((resp.body && (resp.body.error||resp.body.message)) || 'Ошибка', 'danger');
            return;
          }
          try {
            const idx = (categoriesCache||[]).findIndex((c)=> String(c.id)===String(catId));
            if (idx>=0) categoriesCache[idx].enabled = desired ? 1 : 0;
          } catch(_) {}
          showCategoryTabs(categoriesCache||[]);
          notify(desired ? 'Категория включена' : 'Категория отключена', 'success');
          // Client-side emit to sync other clients (fallback)
          try {
            const sock = window.SyncManager && window.SyncManager.getSocket && window.SyncManager.getSocket();
            const payload = { reason: 'category-toggled', category_id: catId, enabled: desired ? 1 : 0, originClientId: window.__categoriesClientId };
            if (sock && sock.emit) {
              try { sock.emit('categories:changed', payload); } catch(_) {}
              try { sock.emit('category_updated', payload); } catch(_) {}
            }
          } catch(_) {}
        })
        .catch((e)=>{ window.ErrorHandler && window.ErrorHandler.handleError(e, 'category-toggle'); });
    };
    const subsOfCat = (subcategoriesCache || []).filter((s) => String(s.category_id) === String(catId));
    if (subsOfCat.length > 0) {
      const anyEnabled = subsOfCat.some((s)=> s && (s.enabled ? true : false));
      if (anyEnabled) {
        notify('Сначала отключите или удалите все подкатегории', 'warning');
        return;
      }
    } else {
      // Double-check via API if subs not cached
      fetch(`/api/subcategories/${catId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' })
        .then((r)=>r.json()).then((data)=>{
          const list = (data && (data.items || data)) || [];
          if (Array.isArray(list) && list.some((s)=> s && (s.enabled ? true : false))) {
            notify('Сначала отключите или удалите все подкатегории', 'warning');
            return;
          }
          proceed();
        }).catch(()=> proceed());
      return;
    }
    proceed();
    return;
  }
  const fd = new FormData();
  // Always include 'enabled' key so backend lightweight toggle path is used
  fd.append('enabled', desired ? '1' : '');
  fetch(`/categories/edit/${catId}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
    .then(r=>r.json().catch(()=>({})).then((j)=>({ ok: r.ok, body: j })))
    .then((resp)=>{
      if (!resp.ok || (resp.body && resp.body.error)) {
        notify((resp.body && (resp.body.error||resp.body.message)) || 'Ошибка', 'danger');
        return;
      }
      try {
        const idx = (categoriesCache||[]).findIndex((c)=> String(c.id)===String(catId));
        if (idx>=0) categoriesCache[idx].enabled = desired ? 1 : 0;
      } catch(_) {}
      showCategoryTabs(categoriesCache||[]);
      notify(desired ? 'Категория включена' : 'Категория отключена', 'success');
      // Client-side emit to sync other clients (fallback)
      try {
        const sock = window.SyncManager && window.SyncManager.getSocket && window.SyncManager.getSocket();
        const payload = { reason: 'category-toggled', category_id: catId, enabled: desired ? 1 : 0, originClientId: window.__categoriesClientId };
        if (sock && sock.emit) {
          try { sock.emit('categories:changed', payload); } catch(_) {}
          try { sock.emit('category_updated', payload); } catch(_) {}
        }
      } catch(_) {}
    })
    .catch((e)=>{ window.ErrorHandler && window.ErrorHandler.handleError(e, 'category-toggle'); });
}

function openConfirmToggleSubcategory() {
  try {
    const subId = arguments && arguments[0] ? arguments[0] : currentSubcategoryId;
    if (!subId) return;
    const sub = (subcategoriesCache || []).find((s)=> String(s.id)===String(subId));
    const desired = !(sub && (sub.enabled ? true : false));
    
    const fd = new FormData();
    // Always include 'enabled' key so backend lightweight toggle path is used
    fd.append('enabled', desired ? '1' : '');
    fetch(`/subcategories/edit/${subId}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then(r=>r.json().catch(()=>({})).then((j)=>({ ok: r.ok, body: j })))
      .then((resp)=>{
        
        if (!resp.ok || (resp.body && resp.body.error)) {
          notify((resp.body && (resp.body.error||resp.body.message)) || 'Ошибка', 'danger');
          return;
        }
        try {
          const idx = (subcategoriesCache||[]).findIndex((s)=> String(s.id)===String(subId));
          if (idx>=0) subcategoriesCache[idx].enabled = desired ? 1 : 0;
        } catch(_) {}
        showSubcategoryTabs(subcategoriesCache||[]);
        notify(desired ? 'Подкатегория включена' : 'Подкатегория отключена', 'success');
        // Client-side emit to sync other clients (fallback)
        try {
          const payload = { reason: 'sub-toggled', subcategory_id: subId, category_id: (sub && sub.category_id) || currentCategoryId, enabled: desired ? 1 : 0, originClientId: window.__categoriesClientId };
          const sock1 = window.SyncManager && window.SyncManager.getSocket && window.SyncManager.getSocket();
          const sock2 = window.socket;
          
          if (sock1 && sock1.emit) {
            try { sock1.emit('categories:changed', payload); } catch(_) {}
            try { sock1.emit('subcategories:changed', payload); } catch(_) {}
            try { sock1.emit('subcategory_updated', payload); } catch(_) {}
          }
          if (sock2 && typeof sock2.emit === 'function') {
            try { sock2.emit('categories:changed', payload); } catch(_) {}
            try { sock2.emit('subcategories:changed', payload); } catch(_) {}
            try { sock2.emit('subcategory_updated', payload); } catch(_) {}
          }
          // As a last resort, self-refresh local lists immediately
          try { if (typeof reloadLists === 'function') reloadLists(); } catch(_) {}
        } catch(_) {}
      })
      .catch((e)=>{ window.ErrorHandler && window.ErrorHandler.handleError(e, 'subcategory-toggle'); });
  } catch(e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'subcategory-toggle');
  }
}

function tryDeleteCategory() {
  try {
    const catId = arguments && arguments[0] ? arguments[0] : currentCategoryId;
    if (!catId) { notify('Сначала выберите категорию', 'warning'); return; }
    fetch(`/categories/delete/${catId}`, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, status: r.status, body: j })))
      .then((res) => {
        if (!res.ok || (res.body && (res.body.error || res.body.status === 'error'))) {
          const msg = (res.body && (res.body.error || res.body.message)) || `Не удалось удалить категорию (HTTP ${res.status || '-'})`;
          notify(msg, 'danger');
          return;
        }
        // Remove from cache and refresh UI
        try {
          categoriesCache = (categoriesCache || []).filter((c) => String(c.id) !== String(catId));
        } catch (_) {}
        showCategoryTabs(categoriesCache || []);
        // Reset selection
        const next = (categoriesCache && categoriesCache[0]) ? categoriesCache[0].id : null;
        if (next) selectCategory(next); else showEmptyCategories();
        notify('Категория удалена', 'success');
      })
      .catch((e) => {
        window.ErrorHandler && window.ErrorHandler.handleError(e, 'category-delete');
        notify('Ошибка сети при удалении категории', 'danger');
      });
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'category-delete');
    notify('Внутренняя ошибка при удалении категории', 'danger');
  }
}

function tryDeleteSubcategory() {
  try {
    const subId = arguments && arguments[0] ? arguments[0] : currentSubcategoryId;
    if (!subId) { notify('Сначала выберите подкатегорию', 'warning'); return; }
    fetch(`/subcategories/delete/${subId}`, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, status: r.status, body: j })))
      .then((res) => {
        if (!res.ok || (res.body && (res.body.error || res.body.status === 'error'))) {
          const msg = (res.body && (res.body.error || res.body.message)) || `Не удалось удалить подкатегорию (HTTP ${res.status || '-'})`;
          notify(msg, 'danger');
          return;
        }
        // Remove from cache and refresh UI
        try {
          subcategoriesCache = (subcategoriesCache || []).filter((s) => String(s.id) !== String(subId));
        } catch (_) {}
        showSubcategoryTabs(subcategoriesCache || []);
        // Reset selection
        const next = (subcategoriesCache && subcategoriesCache[0]) ? subcategoriesCache[0].id : null;
        if (next) selectSubcategory(next); else showEmptySubcategories();
        notify('Подкатегория удалена', 'success');
      })
      .catch((e) => {
        window.ErrorHandler && window.ErrorHandler.handleError(e, 'subcategory-delete');
        notify('Ошибка сети при удалении подкатегории', 'danger');
      });
  } catch (e) {
    window.ErrorHandler && window.ErrorHandler.handleError(e, 'subcategory-delete');
    notify('Внутренняя ошибка при удалении подкатегории', 'danger');
  }
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
  openConfirmToggleCategory,
  openConfirmToggleSubcategory,
  openConfirmDeleteCategory,
  openConfirmDeleteSubcategory,
};

// Backward-compatible global functions used by inline onclick handlers
try { window.openConfirmToggleCategory = openConfirmToggleCategory; } catch(_) {}
try { window.openConfirmToggleSubcategory = openConfirmToggleSubcategory; } catch(_) {}
try { window.openConfirmDeleteCategory = openConfirmDeleteCategory; } catch(_) {}
try { window.openConfirmDeleteSubcategory = openConfirmDeleteSubcategory; } catch(_) {}

(function(){
  try {
    var __origLog = console && console.log;
    var __origDebug = console && console.debug;
    if (__origLog) {
      console.log = function(){
        try {
          var first = arguments && arguments[0];
          if (typeof first === 'string' && (first.indexOf('[categories]') === 0 || first.indexOf('[sync:event]') === 0)) return;
        } catch(_) {}
        return __origLog.apply(console, arguments);
      };
    }
    if (__origDebug) {
      console.debug = function(){
        try {
          var first = arguments && arguments[0];
          if (typeof first === 'string' && (first.indexOf('[categories]') === 0 || first.indexOf('[sync:event]') === 0)) return;
        } catch(_) {}
        return __origDebug.apply(console, arguments);
      };
    }
  } catch(_) {}
})();
