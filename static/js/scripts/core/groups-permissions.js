/**
 * Groups Permissions Module
 * Управление разрешениями и отображением групп
 */

/**
 * Apply system group styling and behavior
 * Добавляет CSS класс system-group к системным группам
 */
function enforceSystemGroupCollapse() {
  const systemGroups = document.querySelectorAll('[data-is-system="1"]');
  systemGroups.forEach((group) => {
    group.classList.add("system-group");
  });
}

/**
 * Check if group is system group
 * @param {string} groupId - Group ID
 * @returns {boolean} True if system group
 */
function isSystemGroup(groupId) {
  const groupRow = document.getElementById(groupId);
  return groupRow && groupRow.dataset.isSystem === "1";
}

/**
 * Get group permissions and metadata
 * @param {string} groupId - Group ID
 * @returns {Object} Group permissions object
 */
function getGroupPermissions(groupId) {
  const groupRow = document.getElementById(groupId);
  if (!groupRow) return {};

  return {
    name: groupRow.dataset.name || "",
    description: groupRow.dataset.description || "",
    isSystem: groupRow.dataset.isSystem === "1",
    canEdit: groupRow.dataset.canEdit === "1",
    canDelete: groupRow.dataset.canDelete === "1",
  };
}

/**
 * Update group permissions display in table
 * @param {string} groupId - Group ID
 * @param {Object} permissions - New permissions object
 */
function updateGroupPermissions(groupId, permissions) {
  const groupRow = document.getElementById(groupId);
  if (!groupRow) return;

  if (permissions.name) {
    groupRow.dataset.name = permissions.name;
    const nameCell = groupRow.querySelector(".groups-page__name");
    if (nameCell) {
      nameCell.textContent = permissions.name;
    }
  }

  if (permissions.description !== undefined) {
    groupRow.dataset.description = permissions.description;
    const descCell = groupRow.querySelector(".groups-page__description");
    if (descCell) {
      descCell.textContent = permissions.description;
    }
  }
}

// Export functions to global scope
window.GroupsPermissions = {
  enforceSystemGroupCollapse,
  isSystemGroup,
  getGroupPermissions,
  updateGroupPermissions,
};
