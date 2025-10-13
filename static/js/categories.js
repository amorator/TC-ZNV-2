let currentCategoryId = null;
let currentSubcategoryId = null;
let currentPermissionsDraft = { user: {}, group: {} };
let lastSavedPermissions = { user: {}, group: {} };
let isDirtyGroups = false;
let isDirtyUsers = false;
let categoriesCache = [];
let subcategoriesCache = [];

document.addEventListener("DOMContentLoaded", function () {
  try {
    if (!window.__categoriesClientId)
      window.__categoriesClientId =
        Math.random().toString(36).slice(2) + "-" + Date.now();
  } catch (_) {}
  setupTabNavigation();
  setupModalAccessibility();
  document.getElementById("categories-tab").style.display = "block";
  loadCategories();
  setupSaveCancelButtons();
  setupSocket();
  wireSearchbar("groups");
  wireSearchbar("users");
  const delCat = document.getElementById("delete-category-btn");
  const delSub = document.getElementById("delete-subcategory-btn");
  if (delCat) delCat.onclick = tryDeleteCategory;
  if (delSub) delSub.onclick = tryDeleteSubcategory;
  initCategoriesContextMenu();
});

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
    modalElement.addEventListener("hide.bs.modal", function () {
      try {
        if (
          document.activeElement &&
          typeof document.activeElement.blur === "function"
        )
          document.activeElement.blur();
      } catch (_) {}
    });
  });
}

function hideModalSafely(modalId) {
  try {
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    )
      document.activeElement.blur();
  } catch (_) {}
  try {
    const el = document.getElementById(modalId);
    if (!el) return;
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
  } catch (_) {}
}

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

function setupTabNavigation() {
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", function () {
      const tabName = this.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((content) => {
        content.style.display = "none";
      });
      if (tabName === "categories") {
        document.getElementById("categories-tab").style.display = "block";
      } else if (tabName === "registrars") {
        document.getElementById("registrars-tab").style.display = "block";
      }
    });
  });
}

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
        const savedCat = localStorage.getItem("admin_cat_active_category_id");
        const toSelect =
          categoriesCache.find((c) => String(c.id) === String(savedCat)) ||
          categoriesCache[0];
        selectCategory(toSelect.id);
      }
    })
    .catch(() => {
      showEmptyCategories();
    });
}

function showEmptyCategories() {
  showCategoryTabs([]);
  document.getElementById("empty-categories").style.display = "block";
  document.getElementById("subcategory-tabs").style.display = "none";
  document.getElementById("permissions-content").style.display = "none";
}

function showCategoryTabs(categories) {
  const categoryTabs = document.getElementById("category-tabs");
  const categoryNav = document.getElementById("category-nav");
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
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить категорию";
    addBtn.onclick = () => showAddCategoryModal();
    categoryNav.appendChild(addBtn);
  }
  categoryTabs.style.display = "block";
  document.getElementById("empty-categories").style.display = "none";
}

function selectCategory(categoryId) {
  currentCategoryId = categoryId;
  try {
    localStorage.setItem("admin_cat_active_category_id", String(categoryId));
  } catch (e) {}
  document.querySelectorAll("#category-nav .topbtn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-category-id") == categoryId) {
      btn.classList.add("active");
    }
  });
  loadSubcategories(categoryId);
  const cat = (categoriesCache || []).find(
    (c) => String(c.id) === String(categoryId)
  );
  setActiveNames(cat ? cat.display_name : "—", null);
  updateDeleteButtonsState();
}

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
        const savedSub = localStorage.getItem(
          "admin_cat_active_subcategory_id"
        );
        const toSelect =
          subcategories.find((s) => String(s.id) === String(savedSub)) ||
          subcategories[0];
        selectSubcategory(toSelect.id);
      }
    })
    .catch(() => {
      showEmptySubcategories();
    });
}

function showEmptySubcategories() {
  showSubcategoryTabs([]);
  document.getElementById("empty-subcategories").style.display = "block";
  document.getElementById("permissions-content").style.display = "none";
}

function showSubcategoryTabs(subcategories) {
  const subcategoryTabs = document.getElementById("subcategory-tabs");
  const subcategoryNav = document.getElementById("subcategory-nav");
  subcategoryNav.innerHTML = "";
  if (subcategories.length === 0) {
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
    const addBtn = document.createElement("button");
    addBtn.className = "topbtn";
    addBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
    addBtn.title = "Добавить подкатегорию";
    addBtn.onclick = () => showAddSubcategoryModal();
    subcategoryNav.appendChild(addBtn);
  }
  subcategoryTabs.style.display = "block";
  document.getElementById("empty-subcategories").style.display = "none";
}

function selectSubcategory(subcategoryId) {
  currentSubcategoryId = subcategoryId;
  try {
    localStorage.setItem(
      "admin_cat_active_subcategory_id",
      String(subcategoryId)
    );
  } catch (e) {}
  document.querySelectorAll("#subcategory-nav .topbtn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-subcategory-id") == subcategoryId) {
      btn.classList.add("active");
    }
  });
  loadPermissions(subcategoryId);
  const sub = (subcategoriesCache || []).find(
    (s) => String(s.id) === String(subcategoryId)
  );
  setActiveNames(null, sub ? sub.display_name : "—");
  updateDeleteButtonsState();
}

function loadPermissions(subcategoryId) {
  Promise.all([
    fetch("/api/groups?page=1&page_size=5").then((response) => response.json()),
    fetch("/api/users?page=1&page_size=5").then((response) => response.json()),
    fetch(`/api/subcategory/${subcategoryId}/permissions`).then((response) =>
      response.json()
    ),
  ])
    .then(([groupsResp, usersResp, permissionsData]) => {
      const perms =
        permissionsData && permissionsData.permissions
          ? permissionsData.permissions
          : { group: {}, user: {} };
      lastSavedPermissions = deepClone(perms);
      currentPermissionsDraft = deepClone(perms);
      isDirtyGroups = false;
      isDirtyUsers = false;
      updateSaveButtonsState();
      loadGroupsPermissionsTable(
        (groupsResp && groupsResp.items) || [],
        currentPermissionsDraft.group || {}
      );
      renderPagination("groups", groupsResp);
      loadUsersPermissionsTable(
        (usersResp && usersResp.items) || [],
        currentPermissionsDraft.user || {}
      );
      renderPagination("users", usersResp);
      document.getElementById("permissions-content").style.display = "block";
      document.getElementById("empty-subcategories").style.display = "none";
      wireSearchbar("groups");
      wireSearchbar("users");
      updateSaveButtonsState();
      updateDeleteButtonsState();
    })
    .catch(() => {
      lastSavedPermissions = { user: {}, group: {} };
      currentPermissionsDraft = { user: {}, group: {} };
      isDirtyGroups = false;
      isDirtyUsers = false;
      updateSaveButtonsState();
      loadGroupsPermissionsTable([], currentPermissionsDraft.group);
      loadUsersPermissionsTable([], currentPermissionsDraft.user);
      document.getElementById("permissions-content").style.display = "block";
      document.getElementById("empty-subcategories").style.display = "none";
    });
}

function loadGroupsPermissionsTable(groups, permissions) {
  const tbody = document.getElementById("groups-permissions");
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
    const adminName = String(
      window.adminGroupName || "Программисты"
    ).toLowerCase();
    const isAdminGroup = String(group.name || "").toLowerCase() === adminName;
    const uploadVal =
      Number(permissions.group_upload || 0) === 1 ? "yes" : "no";
    row.innerHTML = `
      <td data-admin="${isAdminGroup}">${group.name}</td>
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
      isAdminGroup || viewValue === "all" ? "checked" : ""
    } ${isAdminGroup ? "disabled" : ""} onchange="updateGroupPermissionLevel(${
      group.id
    }, 'view', this.value)">
            <label class="form-check-label" for="group_view_all_${
              group.id
            }">Все</label>
          </div>
        </div>
      </td>
      <td>
        <div class="perm-stack">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="group_upload_${
              group.id
            }" id="group_upload_no_${group.id}" value="no" ${
      isAdminGroup ? "" : uploadVal === "no" ? "checked" : ""
    } ${
      isAdminGroup ? "disabled" : ""
    } onchange="updatePermission('group_upload', 0)">
            <label class="form-check-label" for="group_upload_no_${
              group.id
            }">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="group_upload_${
              group.id
            }" id="group_upload_yes_${group.id}" value="yes" ${
      isAdminGroup ? "checked" : uploadVal === "yes" ? "checked" : ""
    } ${
      isAdminGroup ? "disabled" : ""
    } onchange="updatePermission('group_upload', 1)">
            <label class="form-check-label" for="group_upload_yes_${
              group.id
            }">Да</label>
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
      isAdminGroup || editValue === "all" ? "checked" : ""
    } ${isAdminGroup ? "disabled" : ""} onchange="updateGroupPermissionLevel(${
      group.id
    }, 'edit', this.value)">
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
      isAdminGroup || deleteValue === "all" ? "checked" : ""
    } ${isAdminGroup ? "disabled" : ""} onchange="updateGroupPermissionLevel(${
      group.id
    }, 'delete', this.value)">
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

function loadUsersPermissionsTable(users, permissions) {
  const tbody = document.getElementById("users-permissions");
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
    const permStr = String(
      (user &&
        (user.permissions_string ||
          user.permission_string ||
          user.permission)) ||
        ""
    ).trim();
    const isFull =
      permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
      permStr === "aef,a,abcdflm,ab,ab,ab" ||
      permStr.indexOf("z") !== -1 ||
      String((user && user.login) || "").toLowerCase() === "admin";
    const fileFlags = checkFilePermissions(permStr);
    const viewLocked = isFull || fileFlags.viewAll;
    const editLocked = isFull || fileFlags.editAny;
    const deleteLocked = isFull || fileFlags.deleteAny;
    const uploadLocked = isFull || fileFlags.uploadAny;
    const uploadValue =
      Number((permissions && permissions.user_upload) || 0) === 1;
    row.innerHTML = `
      <td><span title="${
        user.name
      }" data-bs-toggle="tooltip" data-permission="${permStr}">${
      user.login
    }</span></td>
      <td>
        <div class="perm-stack">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_view_${
              user.id
            }" id="user_view_none_${user.id}" value="none" ${
      viewValue === "none" ? "checked" : ""
    } ${viewLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'view', this.value)">
            <label class="form-check-label" for="user_view_none_${
              user.id
            }">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_view_${
              user.id
            }" id="user_view_own_${user.id}" value="own" ${
      viewValue === "own" ? "checked" : ""
    } ${viewLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'view', this.value)">
            <label class="form-check-label" for="user_view_own_${
              user.id
            }">Свои</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_view_${
              user.id
            }" id="user_view_group_${user.id}" value="group" ${
      viewValue === "group" ? "checked" : ""
    } ${viewLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'view', this.value)">
            <label class="form-check-label" for="user_view_group_${
              user.id
            }">Группы</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_view_${
              user.id
            }" id="user_view_all_${user.id}" value="all" ${
      viewLocked || viewValue === "all" ? "checked" : ""
    } ${viewLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'view', this.value)">
            <label class="form-check-label" for="user_view_all_${
              user.id
            }">Все</label>
          </div>
        </div>
      </td>
      <td>
        <div class="perm-stack">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_upload_${
              user.id
            }" id="user_upload_no_${user.id}" value="no" ${
      !uploadValue ? "checked" : ""
    } ${
      uploadLocked ? "disabled" : ""
    } onchange="updatePermission('user_upload', 0)">
            <label class="form-check-label" for="user_upload_no_${
              user.id
            }">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_upload_${
              user.id
            }" id="user_upload_yes_${user.id}" value="yes" ${
      uploadLocked || uploadValue ? "checked" : ""
    } ${
      uploadLocked ? "disabled" : ""
    } onchange="updatePermission('user_upload', 1)">
            <label class="form-check-label" for="user_upload_yes_${
              user.id
            }">Да</label>
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
    } ${editLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'edit', this.value)">
            <label class="form-check-label" for="user_edit_none_${
              user.id
            }">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_edit_${
              user.id
            }" id="user_edit_own_${user.id}" value="own" ${
      editValue === "own" ? "checked" : ""
    } ${editLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'edit', this.value)">
            <label class="form-check-label" for="user_edit_own_${
              user.id
            }">Свои</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_edit_${
              user.id
            }" id="user_edit_group_${user.id}" value="group" ${
      editValue === "group" ? "checked" : ""
    } ${editLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'edit', this.value)">
            <label class="form-check-label" for="user_edit_group_${
              user.id
            }">Группы</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_edit_${
              user.id
            }" id="user_edit_all_${user.id}" value="all" ${
      editLocked || editValue === "all" ? "checked" : ""
    } ${editLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'edit', this.value)">
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
    } ${deleteLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'delete', this.value)">
            <label class="form-check-label" for="user_delete_none_${
              user.id
            }">Нет</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_delete_${
              user.id
            }" id="user_delete_own_${user.id}" value="own" ${
      deleteValue === "own" ? "checked" : ""
    } ${deleteLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'delete', this.value)">
            <label class="form-check-label" for="user_delete_own_${
              user.id
            }">Свои</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_delete_${
              user.id
            }" id="user_delete_group_${user.id}" value="group" ${
      deleteValue === "group" ? "checked" : ""
    } ${deleteLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'delete', this.value)">
            <label class="form-check-label" for="user_delete_group_${
              user.id
            }">Группы</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="user_delete_${
              user.id
            }" id="user_delete_all_${user.id}" value="all" ${
      deleteLocked || deleteValue === "all" ? "checked" : ""
    } ${deleteLocked ? "disabled" : ""} onchange="updateUserPermissionLevel(${
      user.id
    }, 'delete', this.value)">
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
  const info = document.getElementById(which + "-pagination-info");
  if (!ul) return;
  if (info) info.textContent = "";
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
  for (let p = start; p <= end; p++)
    ul.appendChild(mk(String(p), p, false, p === page));
  ul.appendChild(mk("›", Math.min(pages, page + 1), page === pages));
  ul.appendChild(mk("»", pages, page === pages));
}

function updateGroupPermission(groupId, action, scope, value) {
  if (!currentSubcategoryId) return;
  const fieldName = `group_${action}_${scope}`;
  updatePermission(fieldName, value);
}

function updateUserPermission(userId, action, scope, value) {
  if (!currentSubcategoryId) return;
  const fieldName = `user_${action}_${scope}`;
  updatePermission(fieldName, value);
}

function updateGroupPermissionLevel(groupId, action, level) {
  if (!currentSubcategoryId) return;

  // Check if this is admin group - prevent disabling
  const groupRow = document.querySelector(
    `input[name="group_${action}_${groupId}"]`
  );
  if (groupRow) {
    const groupCell = groupRow.closest("tr").querySelector("td:first-child");
    const isAdminGroup =
      groupCell && groupCell.getAttribute("data-admin") === "true";

    console.log("Group permission check:", {
      groupId: groupId,
      isAdminGroup: isAdminGroup,
      level: level,
    });

    if (isAdminGroup && level !== "all") {
      console.log("Preventing admin group from being disabled");
      // Re-check the "all" radio button
      setTimeout(() => {
        const allRadio = document.querySelector(
          `input[name="group_${action}_${groupId}"][value="all"]`
        );
        if (allRadio) allRadio.checked = true;
      }, 0);
      return;
    }
  }

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

function checkFilePermissions(permStr) {
  // Returns fine-grained file permission flags from the permission string.
  // Files page (index 2): 'c' = edit_any, 'd' = delete_any, 'f' = display_all
  const result = {
    viewAll: false,
    editAny: false,
    deleteAny: false,
    uploadAny: false,
  };
  if (!permStr) return result;
  const pages = permStr.split(",");
  if (pages.length > 2) {
    const filePermissions = pages[2] || "";
    result.editAny = filePermissions.includes("c");
    result.deleteAny = filePermissions.includes("d");
    result.viewAll = filePermissions.includes("f");
    result.uploadAny = filePermissions.includes("b");
  }
  return result;
}

function updateUserPermissionLevel(userId, action, level) {
  if (!currentSubcategoryId) return;

  // Check if this is admin or full-access user - prevent disabling
  const userRow = document.querySelector(
    `input[name="user_${action}_${userId}"]`
  );
  if (userRow) {
    const userCell = userRow.closest("tr").querySelector("td:first-child span");
    const login = ((userCell && userCell.textContent) || "").toLowerCase();
    const permStr =
      (userCell && userCell.getAttribute("data-permission")) || "";

    console.log("Debug userCell:", {
      userCell: userCell,
      textContent: userCell ? userCell.textContent : "no cell",
      dataPermission: userCell
        ? userCell.getAttribute("data-permission")
        : "no cell",
      login: login,
      permStr: permStr,
    });

    // Check if admin user
    if (login === "admin" && level !== "all") {
      console.log("Preventing admin user from being disabled");
      // Re-check the "all" radio button
      setTimeout(() => {
        const allRadio = document.querySelector(
          `input[name="user_${action}_${userId}"][value="all"]`
        );
        if (allRadio) allRadio.checked = true;
      }, 0);
      return;
    }

    // Check if full-access user
    const isFullAccess =
      permStr === "aef,a,abcdflm,ab,ab,ab,abcd" ||
      permStr === "aef,a,abcdflm,ab,ab,ab" ||
      permStr.indexOf("z") !== -1 ||
      permStr.includes("полный доступ") ||
      permStr.includes("full access");

    // Check if user has file permissions that affect categories
    const hasFilePermissions = checkFilePermissions(permStr);

    console.log("User permission check:", {
      login: login,
      permStr: permStr,
      level: level,
      isFullAccess: isFullAccess,
      hasFilePermissions: hasFilePermissions,
    });

    if (isFullAccess && level !== "all") {
      console.log("Preventing full-access user from being disabled");
      // Re-check the "all" radio button
      setTimeout(() => {
        const allRadio = document.querySelector(
          `input[name="user_${action}_${userId}"][value="all"]`
        );
        if (allRadio) allRadio.checked = true;
      }, 0);
      return;
    }

    // Block users with file permissions that affect categories
    if (hasFilePermissions && level !== "all") {
      console.log("Preventing user with file permissions from being disabled");
      // Re-check the "all" radio button
      setTimeout(() => {
        const allRadio = document.querySelector(
          `input[name="user_${action}_${userId}"][value="all"]`
        );
        if (allRadio) allRadio.checked = true;
      }, 0);
      return;
    }
  }

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

function updatePermissionGroupBatch(updatedFields) {
  fetch(`/api/subcategory/${currentSubcategoryId}/permissions`)
    .then((response) => response.json())
    .then((data) => {
      const permissions = data.permissions;
      Object.entries(updatedFields).forEach(([key, val]) => {
        if (key.startsWith("group_")) {
          const k = key.replace("group_", "");
          permissions.group[k] = val;
        } else if (key.startsWith("user_")) {
          const k = key.replace("user_", "");
          permissions.user[k] = val;
        }
      });
      return fetch(`/api/subcategory/${currentSubcategoryId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
    })
    .then((r) => r.json())
    .then((data) => {
      if (!data.success) {
        console.error("Error updating permission batch:", data.error);
      }
    })
    .catch((err) => console.error("Error updating permission batch:", err));
}

function updatePermission(fieldName, value) {
  if (!currentSubcategoryId) return;
  if (fieldName.startsWith("group_")) {
    const key = fieldName.replace("group_", "");
    currentPermissionsDraft.group[key] = value;
    markDirty("groups");
  } else if (fieldName.startsWith("user_")) {
    const key = fieldName.replace("user_", "");
    currentPermissionsDraft.user[key] = value;
    markDirty("users");
  }
}

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

function updateSaveButtonsState(disabledExplicitWhich) {
  const gb = document.getElementById("groups-save-btn");
  const gcb = document.getElementById("groups-cancel-btn");
  const ub = document.getElementById("users-save-btn");
  const ucb = document.getElementById("users-cancel-btn");
  const hgb = document.getElementById("header-groups-save");
  const hub = document.getElementById("header-users-save");
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
  if (hgb)
    hgb.disabled =
      forceDisableGroups || !currentSubcategoryId || !isDirtyGroups;
  if (hub)
    hub.disabled = forceDisableUsers || !currentSubcategoryId || !isDirtyUsers;
}

function markDirty(which) {
  if (which === "groups") isDirtyGroups = true;
  else if (which === "users") isDirtyUsers = true;
  else {
    isDirtyGroups = true;
    isDirtyUsers = true;
  }
  updateSaveButtonsState();
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

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
      socket.on("category_updated", () => {
        loadCategories();
      });
      socket.on("subcategory_updated", () => {
        if (currentCategoryId) loadSubcategories(currentCategoryId);
      });
    }
  } catch (e) {
    console.warn("Socket.IO not available:", e);
  }
}

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

function wireInlineEditForms() {
  try {
    const catForm = document.getElementById("category-edit-form");
    const catName = document.getElementById("edit_category_display_name");
    const catOrder = document.getElementById("edit_category_display_order");
    const catEnabled = document.getElementById("edit_category_enabled");
    if (catForm) {
      if (catName) {
        catName.addEventListener("change", function () {
          if (!currentCategoryId) return;
          catForm.action = `/categories/edit/${currentCategoryId}`;
          catForm.submit();
        });
      }
      if (catOrder) {
        catOrder.addEventListener("change", function () {
          if (!currentCategoryId) return;
          catForm.action = `/categories/edit/${currentCategoryId}`;
          catForm.submit();
        });
      }
      if (catEnabled) {
        catEnabled.addEventListener("change", function () {
          toggleCategoryEnabled(
            typeof catEnabled.checked === "boolean"
              ? catEnabled.checked
              : undefined
          );
        });
      }
    }
    const subForm = document.getElementById("subcategory-edit-form");
    const subName = document.getElementById("edit_subcategory_display_name");
    const subOrder = document.getElementById("edit_subcategory_display_order");
    const subEnabled = document.getElementById("edit_subcategory_enabled");
    if (subForm) {
      if (subName) {
        subName.addEventListener("change", function () {
          if (!currentSubcategoryId) return;
          subForm.action = `/admin/subcategories/edit/${currentSubcategoryId}`;
          subForm.submit();
        });
      }
      if (subOrder) {
        subOrder.addEventListener("change", function () {
          if (!currentSubcategoryId) return;
          subForm.action = `/admin/subcategories/edit/${currentSubcategoryId}`;
          subForm.submit();
        });
      }
      if (subEnabled) {
        subEnabled.addEventListener("change", function () {
          toggleSubcategoryEnabled(
            typeof subEnabled.checked === "boolean"
              ? subEnabled.checked
              : undefined
          );
        });
      }
    }
  } catch (_) {}
}

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

function tryDeleteCategory() {
  if (!currentCategoryId) return;
  fetch(`/api/category/${currentCategoryId}/stats`, { credentials: "include" })
    .then((r) => r.json())
    .then((stats) => {
      const cnt = (stats && stats.subcategory_count) || 0;
      if (cnt > 0) {
        alert(
          "Нельзя удалить категорию: в ней есть подкатегории. Сначала удалите или перенесите подкатегории."
        );
        throw new Error("blocked");
      }
      return fetch(`/categories/delete/${currentCategoryId}`, {
        method: "POST",
        credentials: "include",
      });
    })
    .then(() => {
      try {
        if (window.socket)
          window.socket.emit("category_updated", {
            id: currentCategoryId,
            action: "deleted",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      loadCategories();
    })
    .catch((e) => {
      if (String(e && e.message) !== "blocked") loadCategories();
    });
}

function tryDeleteSubcategory() {
  if (!currentSubcategoryId) return;
  fetch(`/api/subcategory/${currentSubcategoryId}/stats`, {
    credentials: "include",
  })
    .then((r) => r.json())
    .then((stats) => {
      const cnt = (stats && stats.files_count) || 0;
      if (cnt > 0) {
        alert(
          "Нельзя удалить подкатегорию: в ней есть файлы. Сначала удалите или перенесите файлы."
        );
        throw new Error("blocked");
      }
      return fetch(`/subcategories/delete/${currentSubcategoryId}`, {
        method: "POST",
        credentials: "include",
      });
    })
    .then(() => {
      try {
        if (window.socket)
          window.socket.emit("subcategory_updated", {
            id: currentSubcategoryId,
            action: "deleted",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      if (currentCategoryId) loadSubcategories(currentCategoryId);
    })
    .catch((e) => {
      if (String(e && e.message) !== "blocked") {
        if (currentCategoryId) loadSubcategories(currentCategoryId);
      }
    });
}

function showAddCategoryModal() {
  populateDisplayOrderCombo("add_display_order");
  const modal = new bootstrap.Modal(
    document.getElementById("addCategoryModal")
  );
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
    .catch(() => {
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
    document.getElementById("add_subcategory_category").value =
      currentCategoryId;
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
      .catch(() => {
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
  function applyContextPermissions(target) {
    const canCats = !!window.__canCatsManage;
    const canSubs = !!window.__canSubsManage;
    if (target === "category") {
      if (!canCats) {
        setItemEnabled("add-category", false);
        setItemEnabled("edit-category", false);
        setItemEnabled("delete-category", false);
        setItemEnabled("toggle-category", false);
      }
      if (!canSubs) {
        setItemEnabled("add-subcategory", false);
        setItemEnabled("edit-subcategory", false);
        setItemEnabled("delete-subcategory", false);
        setItemEnabled("toggle-subcategory", false);
      }
    } else if (target === "subcategory") {
      if (!canCats) {
        setItemEnabled("add-category", false);
        setItemEnabled("edit-category", false);
        setItemEnabled("delete-category", false);
        setItemEnabled("toggle-category", false);
      }
      if (!canSubs) {
        setItemEnabled("add-subcategory", false);
        setItemEnabled("edit-subcategory", false);
        setItemEnabled("delete-subcategory", false);
        setItemEnabled("toggle-subcategory", false);
      }
    }
  }
  function configureForCategory(catId) {
    ctx.targetType = "category";
    ctx.targetId = catId;
    const subsOfCat = (subcategoriesCache || []).filter(
      (s) => String(s.category_id) === String(catId)
    );
    const canDelete = subsOfCat.length === 0;
    const cat = (categoriesCache || []).find(
      (c) => String(c.id) === String(catId)
    );
    const isRegistrators = !!(
      cat && String(cat.folder_name || "").toLowerCase() === "registrators"
    );
    setItemEnabled("add-category", true);
    setItemEnabled("edit-category", !!catId);
    setItemEnabled("delete-category", !!catId && canDelete && !isRegistrators);
    const hasEnabledSub = subsOfCat.some((s) => !!s.enabled);
    setItemEnabled(
      "toggle-category",
      !!catId && !hasEnabledSub && !isRegistrators
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
    applyContextPermissions("category");
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
    applyContextPermissions("subcategory");
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
  const catNav = document.getElementById("category-nav");
  const subNav = document.getElementById("subcategory-nav");
  if (catNav)
    catNav.addEventListener("contextmenu", onContextMenuCategory, {
      capture: true,
    });
  if (subNav)
    subNav.addEventListener("contextmenu", onContextMenuSubcategory, {
      capture: true,
    });
  document.querySelectorAll(".subbar.cat, .subbar.subcat").forEach((el) => {
    el.addEventListener(
      "contextmenu",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideMenu();
        if (e.currentTarget.classList.contains("cat")) {
          configureForCategory(currentCategoryId);
        } else {
          configureForSubcategory(currentSubcategoryId);
        }
        showMenu(e.clientX, e.clientY);
      },
      { capture: true }
    );
  });
  document.querySelectorAll(".subbar.cat [data-tab]").forEach((btn) => {
    btn.addEventListener(
      "contextmenu",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideMenu();
        const tab = (this && this.getAttribute("data-tab")) || "";
        if (tab === "categories") {
          configureForCategory(currentCategoryId);
        } else {
          configureForCategory(currentCategoryId);
        }
        showMenu(e.clientX, e.clientY);
      },
      { capture: true }
    );
  });
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
  document.addEventListener(
    "contextmenu",
    function (e) {
      const pageRoot = document.querySelector('[data-testid="categories-tab"]');
      if (!pageRoot) return;
      if (e.target.closest("#categories-context-menu")) return;
      if (
        !e.target.closest(
          '[data-testid="categories-tab"], .subbar.cat, .subbar.subcat, #category-nav, #subcategory-nav, #content-area'
        )
      )
        return;
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
    },
    { capture: true }
  );
  const header = document.querySelector(".app-topbar");
  if (header) {
    header.addEventListener(
      "contextmenu",
      function (e) {
        const pageRoot = document.querySelector(
          '[data-testid="categories-tab"]'
        );
        if (!pageRoot) return;
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
      },
      { capture: true }
    );
    header.querySelectorAll(".topbtn").forEach(function (btn) {
      btn.addEventListener(
        "contextmenu",
        function (e) {
          const pageRoot = document.querySelector(
            '[data-testid="categories-tab"]'
          );
          if (!pageRoot) return;
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
        },
        { capture: true }
      );
    });
  }
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

function toggleCategoryEnabled(explicitState) {
  if (!currentCategoryId) return;
  const cb = document.getElementById("edit_category_enabled");
  if (!cb) return;
  if (typeof explicitState === "boolean") cb.checked = explicitState;
  else cb.checked = !cb.checked;
  const targetEnabled = !!cb.checked;
  confirmToggleCategory(targetEnabled);
}

function toggleSubcategoryEnabled(explicitState) {
  if (!currentSubcategoryId) return;
  const cb = document.getElementById("edit_subcategory_enabled");
  if (!cb) return;
  if (typeof explicitState === "boolean") cb.checked = explicitState;
  else cb.checked = !cb.checked;
  const targetEnabled = !!cb.checked;
  confirmToggleSubcategory(targetEnabled);
}

function showEditCategoryModal() {
  if (!currentCategoryId) return;
  if (!window.__canCatsManage) return;
  const cat = (categoriesCache || []).find(
    (c) => String(c.id) === String(currentCategoryId)
  );
  const nameInput = document.getElementById("edit_category_display_name");
  const orderSelect = document.getElementById("edit_category_display_order");
  const enabledCb = document.getElementById("edit_category_enabled");
  if (nameInput)
    nameInput.value = cat && cat.display_name ? cat.display_name : "";
  if (enabledCb) enabledCb.checked = !!(cat && cat.enabled);
  if (orderSelect) {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((cats) => {
        const count = (cats || []).length || 0;
        orderSelect.innerHTML = "";
        for (let i = 1; i <= Math.max(1, count); i++) {
          const opt = document.createElement("option");
          opt.value = i;
          opt.textContent = i;
          if (cat && Number(cat.display_order) === i) opt.selected = true;
          orderSelect.appendChild(opt);
        }
      })
      .catch(() => {
        orderSelect.innerHTML = '<option value="1">1</option>';
      });
  }
  const form = document.getElementById("category-edit-form");
  if (form) {
    form.action = `/categories/edit/${currentCategoryId}`;
    if (!form._ajaxBound) {
      form._ajaxBound = true;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitEditCategoryAjax();
      });
    }
  }
  new bootstrap.Modal(document.getElementById("editCategoryModal")).show();
}

function showEditSubcategoryModal() {
  if (!currentSubcategoryId) return;
  if (!window.__canSubsManage) return;
  const sub = (subcategoriesCache || []).find(
    (s) => String(s.id) === String(currentSubcategoryId)
  );
  const nameInput = document.getElementById("edit_subcategory_display_name");
  const orderSelect = document.getElementById("edit_subcategory_display_order");
  const enabledCb = document.getElementById("edit_subcategory_enabled");
  if (nameInput)
    nameInput.value = sub && sub.display_name ? sub.display_name : "";
  if (enabledCb) enabledCb.checked = !!(sub && sub.enabled);
  if (orderSelect && currentCategoryId) {
    fetch(`/api/subcategories/${currentCategoryId}`)
      .then((r) => r.json())
      .then((subs) => {
        const count = (subs || []).length || 0;
        orderSelect.innerHTML = "";
        for (let i = 1; i <= Math.max(1, count); i++) {
          const opt = document.createElement("option");
          opt.value = i;
          opt.textContent = i;
          if (sub && Number(sub.display_order) === i) opt.selected = true;
          orderSelect.appendChild(opt);
        }
      })
      .catch(() => {
        orderSelect.innerHTML = '<option value="1">1</option>';
      });
  }
  const form = document.getElementById("subcategory-edit-form");
  if (form) {
    form.action = `/subcategories/edit/${currentSubcategoryId}`;
    if (!form._ajaxBound) {
      form._ajaxBound = true;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitEditSubcategoryAjax();
      });
    }
  }
  new bootstrap.Modal(document.getElementById("editSubcategoryModal")).show();
}

function submitEditCategoryAjax() {
  if (!currentCategoryId) return;
  const name = (
    document.getElementById("edit_category_display_name")?.value || ""
  ).trim();
  const order =
    document.getElementById("edit_category_display_order")?.value || "";
  const enabled = !!document.getElementById("edit_category_enabled")?.checked;
  const orig = (categoriesCache || []).find(
    (c) => String(c.id) === String(currentCategoryId)
  );
  if (orig) {
    const sameName = String(orig.display_name || "").trim() === name;
    const sameOrder = String(orig.display_order || "") === String(order || "");
    const sameEnabled = !!orig.enabled === enabled;
    if (sameName && sameOrder && sameEnabled) {
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("editCategoryModal")
        )?.hide();
      } catch (_) {}
      return;
    }
  }
  if (!enabled) {
    const hasEnabledSub = (subcategoriesCache || []).some(
      (s) => String(s.category_id) === String(currentCategoryId) && !!s.enabled
    );
    if (hasEnabledSub) {
      alert("Нельзя отключить категорию: в ней есть включённые подкатегории");
      return;
    }
  }
  const body = new URLSearchParams();
  if (name) body.set("display_name", name);
  if (order) body.set("display_order", String(order));
  if (enabled) body.set("enabled", "on");
  fetch(`/categories/edit/${currentCategoryId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "fetch",
    },
    body,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Ошибка сохранения категории";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify("Категория обновлена", "success");
      try {
        if (window.socket)
          window.socket.emit("category_updated", {
            id: currentCategoryId,
            action: "edited",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      loadCategories();
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("editCategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch(() => {});
}

function submitEditSubcategoryAjax() {
  if (!currentSubcategoryId) return;
  const name = (
    document.getElementById("edit_subcategory_display_name")?.value || ""
  ).trim();
  const order =
    document.getElementById("edit_subcategory_display_order")?.value || "";
  const enabled = !!document.getElementById("edit_subcategory_enabled")
    ?.checked;
  const orig = (subcategoriesCache || []).find(
    (s) => String(s.id) === String(currentSubcategoryId)
  );
  if (orig) {
    const sameName = String(orig.display_name || "").trim() === name;
    const sameOrder = String(orig.display_order || "") === String(order || "");
    const sameEnabled = !!orig.enabled === enabled;
    if (sameName && sameOrder && sameEnabled) {
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("editSubcategoryModal")
        )?.hide();
      } catch (_) {}
      return;
    }
  }
  const body = new URLSearchParams();
  if (name) body.set("display_name", name);
  if (order) body.set("display_order", String(order));
  if (enabled) body.set("enabled", "on");
  fetch(`/subcategories/edit/${currentSubcategoryId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "fetch",
    },
    body,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Ошибка сохранения подкатегории";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify("Подкатегория обновлена", "success");
      try {
        if (window.socket)
          window.socket.emit("subcategory_updated", {
            id: currentSubcategoryId,
            action: "edited",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      if (currentCategoryId) loadSubcategories(currentCategoryId);
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("editSubcategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch(() => {});
}

function openConfirmDeleteCategory() {
  if (!currentCategoryId) return;
  if (!window.__canCatsManage) return;
  const btn = document.getElementById("confirmDeleteCategoryBtn");
  if (btn) btn.onclick = confirmDeleteCategory;
  new bootstrap.Modal(
    document.getElementById("confirmDeleteCategoryModal")
  ).show();
}
function openConfirmDeleteSubcategory() {
  if (!currentSubcategoryId) return;
  if (!window.__canSubsManage) return;
  const btn = document.getElementById("confirmDeleteSubcategoryBtn");
  if (btn) btn.onclick = confirmDeleteSubcategory;
  new bootstrap.Modal(
    document.getElementById("confirmDeleteSubcategoryModal")
  ).show();
}
function openConfirmToggleCategory() {
  if (!currentCategoryId) return;
  const cat = (categoriesCache || []).find(
    (c) => String(c.id) === String(currentCategoryId)
  );
  if (cat && String(cat.folder_name || "").toLowerCase() === "registrators") {
    notify("Системную категорию «Регистраторы» нельзя отключать", "warning");
    return;
  }
  const willDisable = !!(cat && cat.enabled);
  const title = document.getElementById("confirmToggleCategoryTitle");
  const body = document.getElementById("confirmToggleCategoryBody");
  if (title)
    title.textContent = willDisable
      ? "Отключить категорию"
      : "Включить категорию";
  if (body)
    body.textContent = willDisable
      ? "Вы уверены, что хотите отключить категорию?"
      : "Вы уверены, что хотите включить категорию?";
  const btn = document.getElementById("confirmToggleCategoryBtn");
  if (btn) btn.onclick = () => confirmToggleCategory(!willDisable);
  new bootstrap.Modal(
    document.getElementById("confirmToggleCategoryModal")
  ).show();
}
function openConfirmToggleSubcategory() {
  if (!currentSubcategoryId) return;
  const sub = (subcategoriesCache || []).find(
    (s) => String(s.id) === String(currentSubcategoryId)
  );
  const willDisable = !!(sub && sub.enabled);
  const title = document.getElementById("confirmToggleSubcategoryTitle");
  const body = document.getElementById("confirmToggleSubcategoryBody");
  if (title)
    title.textContent = willDisable
      ? "Отключить подкатегорию"
      : "Включить подкатегорию";
  if (body)
    body.textContent = willDisable
      ? "Вы уверены, что хотите отключить подкатегорию?"
      : "Вы уверены, что хотите включить подкатегорию?";
  const btn = document.getElementById("confirmToggleSubcategoryBtn");
  if (btn) btn.onclick = () => confirmToggleSubcategory(!willDisable);
  new bootstrap.Modal(
    document.getElementById("confirmToggleSubcategoryModal")
  ).show();
}

function confirmDeleteCategory() {
  fetch(`/api/category/${currentCategoryId}/stats`, { credentials: "include" })
    .then((r) => r.json())
    .then((stats) => {
      const cnt = (stats && stats.subcategory_count) || 0;
      if (cnt > 0) throw new Error("blocked");
      return fetch(`/admin/categories/delete/${currentCategoryId}`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "fetch" },
      });
    })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Не удалось удалить категорию";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify("Категория удалена", "success");
      try {
        if (window.socket)
          window.socket.emit("category_updated", {
            id: currentCategoryId,
            action: "deleted",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      loadCategories();
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("confirmDeleteCategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch((e) => {
      if (String(e && e.message) === "blocked")
        notify("Нельзя удалить категорию: есть подкатегории", "warning");
      loadCategories();
    });
}

function confirmDeleteSubcategory() {
  fetch(`/api/subcategory/${currentSubcategoryId}/stats`, {
    credentials: "include",
  })
    .then((r) => r.json())
    .then((stats) => {
      const cnt = (stats && stats.files_count) || 0;
      if (cnt > 0) throw new Error("blocked");
      return fetch(`/admin/subcategories/delete/${currentSubcategoryId}`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "fetch" },
      });
    })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Не удалось удалить подкатегорию";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify("Подкатегория удалена", "success");
      try {
        if (window.socket)
          window.socket.emit("subcategory_updated", {
            id: currentSubcategoryId,
            action: "deleted",
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      if (currentCategoryId) loadSubcategories(currentCategoryId);
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("confirmDeleteSubcategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch((e) => {
      if (String(e && e.message) === "blocked")
        notify("Нельзя удалить подкатегорию: в ней есть файлы", "warning");
      if (currentCategoryId) loadSubcategories(currentCategoryId);
    });
}

function confirmToggleCategory(targetEnabled) {
  const body = new URLSearchParams();
  if (targetEnabled) body.set("enabled", "on");
  fetch(`/admin/categories/edit/${currentCategoryId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "fetch",
    },
    body,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Не удалось изменить состояние категории";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify(
        targetEnabled ? "Категория включена" : "Категория отключена",
        "success"
      );
      try {
        if (window.socket)
          window.socket.emit("category_updated", {
            id: currentCategoryId,
            action: "toggled",
            enabled: targetEnabled,
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      loadCategories();
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("confirmToggleCategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch(() => {});
}

function confirmToggleSubcategory(targetEnabled) {
  const body = new URLSearchParams();
  if (targetEnabled) body.set("enabled", "on");
  fetch(`/admin/subcategories/edit/${currentSubcategoryId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "fetch",
    },
    body,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        let msg = "Не удалось изменить состояние подкатегории";
        try {
          const j = await resp.json();
          if (j && j.error) msg = j.error;
        } catch (_) {
          try {
            const t = await resp.text();
            if (t) msg = t;
          } catch (__) {}
        }
        notify(msg, "danger");
        throw new Error("request-failed");
      }
      notify(
        targetEnabled ? "Подкатегория включена" : "Подкатегория отключена",
        "success"
      );
      try {
        if (window.socket)
          window.socket.emit("subcategory_updated", {
            id: currentSubcategoryId,
            action: "toggled",
            enabled: targetEnabled,
            originClientId: window.__categoriesClientId,
          });
      } catch (_) {}
      if (currentCategoryId) loadSubcategories(currentCategoryId);
      try {
        bootstrap.Modal.getInstance(
          document.getElementById("confirmToggleSubcategoryModal")
        )?.hide();
      } catch (_) {}
    })
    .catch(() => {});
}
