// Users Management Module
// Управление пользователями

function createUser(userData) {
  try {
    fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          window.showToast("Пользователь создан", "success");
          // Refresh users table
          refreshUsersTable();
        } else {
          window.showToast("Ошибка создания пользователя", "error");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function updateUser(userId, userData) {
  try {
    fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          window.showToast("Пользователь обновлен", "success");
          // Refresh users table
          refreshUsersTable();
        } else {
          window.showToast("Ошибка обновления пользователя", "error");
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function deleteUser(userId) {
  try {
    if (confirm("Вы уверены, что хотите удалить этого пользователя?")) {
      fetch(`/api/users/${userId}`, {
        method: "DELETE",
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            window.showToast("Пользователь удален", "success");
            // Remove user from UI
            const userRow = document.querySelector(
              `[data-user-id="${userId}"]`
            );
            if (userRow) {
              userRow.remove();
            }
          } else {
            window.showToast("Ошибка удаления пользователя", "error");
          }
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "unknown")
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function refreshUsersTable() {
  try {
    fetch("/api/users")
      .then((response) => response.json())
      .then((data) => {
        if (data.users) {
          renderUsersTable(data.users);
        }
      })
      .catch((err) => {
        window.ErrorHandler.handleError(err, "unknown")
      });
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function renderUsersTable(users) {
  try {
    const tableBody = document.querySelector("#maintable tbody");
    if (!tableBody) return;

    const rowsHtml = users
      .map(
        (user) => `
      <tr data-user-id="${user.id}" class="table__body_row">
        <td>${user.name}</td>
        <td>${user.email}</td>
        <td class="perms-cell">
          <div class="perms-cell__item">
            <span class="perms-cell__cat">${user.role}</span>
          </div>
        </td>
        <td>
          <button onclick="editUser(${user.id})">Редактировать</button>
          <button onclick="deleteUser(${user.id})">Удалить</button>
        </td>
      </tr>
    `
      )
      .join("");

    tableBody.innerHTML = rowsHtml;

    // Apply admin collapse
    if (
      window.UsersPermissions &&
      window.UsersPermissions.enforceAdminCollapse
    ) {
      window.UsersPermissions.enforceAdminCollapse();
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

function editUser(userId) {
  try {
    // Show edit user modal
    const modal = document.getElementById("editUserModal");
    if (modal) {
      modal.style.display = "block";

      // Load user data
      fetch(`/api/users/${userId}`)
        .then((response) => response.json())
        .then((data) => {
          if (data.user) {
            // Populate form with user data
            const form = modal.querySelector("form");
            if (form) {
              form.querySelector('[name="name"]').value = data.user.name || "";
              form.querySelector('[name="email"]').value =
                data.user.email || "";
              form.querySelector('[name="role"]').value = data.user.role || "";
            }
          }
        })
        .catch((err) => {
          window.ErrorHandler.handleError(err, "unknown")
        });
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown")
  }
}

// Export functions to global scope
window.UsersManagement = {
  createUser,
  updateUser,
  deleteUser,
  refreshUsersTable,
  renderUsersTable,
  editUser,
};
