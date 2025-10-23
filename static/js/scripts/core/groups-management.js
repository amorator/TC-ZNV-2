// Groups Management Module
// Управление группами пользователей

function createGroup(groupData) {
  try {
    if (window.ApiClient) {
      return window.ApiClient.apiPost("/api/groups", groupData).then((data) => {
        if (data.success) {
          if (window.showToast) {
            window.showToast("Группа создана", "success");
          }
          refreshGroupsTable();
        } else {
          if (window.showToast) {
            window.showToast("Ошибка создания группы", "error");
          }
        }
        return data;
      });
    } else {
      // Fallback to direct fetch
      return fetch("/api/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(groupData),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Группа создана", "success");
            }
            refreshGroupsTable();
          } else {
            if (window.showToast) {
              window.showToast("Ошибка создания группы", "error");
            }
          }
          return data;
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "createGroup");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "createGroup");
    }
  }
}

function updateGroup(groupId, groupData) {
  try {
    if (window.ApiClient) {
      return window.ApiClient.apiPut(`/api/groups/${groupId}`, groupData).then(
        (data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Группа обновлена", "success");
            }
            refreshGroupsTable();
          } else {
            if (window.showToast) {
              window.showToast("Ошибка обновления группы", "error");
            }
          }
          return data;
        }
      );
    } else {
      // Fallback to direct fetch
      return fetch(`/api/groups/${groupId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(groupData),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Группа обновлена", "success");
            }
            refreshGroupsTable();
          } else {
            if (window.showToast) {
              window.showToast("Ошибка обновления группы", "error");
            }
          }
          return data;
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "updateGroup");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateGroup");
    }
  }
}

function deleteGroup(groupId) {
  try {
    if (confirm("Вы уверены, что хотите удалить эту группу?")) {
      if (window.ApiClient) {
        return window.ApiClient.apiDelete(`/api/groups/${groupId}`).then(
          (data) => {
            if (data.success) {
              if (window.showToast) {
                window.showToast("Группа удалена", "success");
              }
              // Remove group from UI
              const groupRow = document.querySelector(
                `[data-group-id="${groupId}"]`
              );
              if (groupRow) {
                groupRow.remove();
              }
            } else {
              if (window.showToast) {
                window.showToast("Ошибка удаления группы", "error");
              }
            }
            return data;
          }
        );
      } else {
        // Fallback to direct fetch
        return fetch(`/api/groups/${groupId}`, {
          method: "DELETE",
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.success) {
              if (window.showToast) {
                window.showToast("Группа удалена", "success");
              }
              // Remove group from UI
              const groupRow = document.querySelector(
                `[data-group-id="${groupId}"]`
              );
              if (groupRow) {
                groupRow.remove();
              }
            } else {
              if (window.showToast) {
                window.showToast("Ошибка удаления группы", "error");
              }
            }
            return data;
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "deleteGroup");
            }
          });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "deleteGroup");
    }
  }
}

function refreshGroupsTable() {
  try {
    if (window.ApiClient) {
      window.ApiClient.apiGet("/api/groups")
        .then((data) => {
          if (data.groups) {
            renderGroupsTable(data.groups);
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "refreshGroupsTable");
          }
        });
    } else {
      // Fallback to direct fetch
      fetch("/api/groups")
        .then((response) => response.json())
        .then((data) => {
          if (data.groups) {
            renderGroupsTable(data.groups);
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "refreshGroupsTable");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "refreshGroupsTable");
    }
  }
}

function renderGroupsTable(groups) {
  try {
    const tableBody = document.querySelector("#maintable tbody");
    if (!tableBody) return;

    const rowsHtml = groups
      .map(
        (group) => `
        <tr data-group-id="${group.id}" class="table__body_row">
          <td>${group.name}</td>
          <td>${group.description || ""}</td>
          <td>${group.member_count || 0}</td>
          <td>
            <button onclick="editGroup(${
              group.id
            })" class="btn btn-sm btn-primary">
              Редактировать
            </button>
            <button onclick="deleteGroup(${
              group.id
            })" class="btn btn-sm btn-danger">
              Удалить
            </button>
          </td>
        </tr>
      `
      )
      .join("");

    tableBody.innerHTML = rowsHtml;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderGroupsTable");
    }
  }
}

function editGroup(groupId) {
  try {
    // Show edit group modal
    const modal = document.getElementById("editGroupModal");
    if (modal) {
      modal.style.display = "block";

      // Load group data
      if (window.ApiClient) {
        window.ApiClient.apiGet(`/api/groups/${groupId}`)
          .then((data) => {
            if (data.group) {
              // Populate form with group data
              const form = modal.querySelector("form");
              if (form) {
                form.querySelector('[name="name"]').value =
                  data.group.name || "";
                form.querySelector('[name="description"]').value =
                  data.group.description || "";
              }
            }
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "editGroup");
            }
          });
      } else {
        // Fallback to direct fetch
        fetch(`/api/groups/${groupId}`)
          .then((response) => response.json())
          .then((data) => {
            if (data.group) {
              // Populate form with group data
              const form = modal.querySelector("form");
              if (form) {
                form.querySelector('[name="name"]').value =
                  data.group.name || "";
                form.querySelector('[name="description"]').value =
                  data.group.description || "";
              }
            }
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "editGroup");
            }
          });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "editGroup");
    }
  }
}

// Export functions to global scope
window.GroupsManagement = {
  createGroup,
  updateGroup,
  deleteGroup,
  refreshGroupsTable,
  renderGroupsTable,
  editGroup,
};
