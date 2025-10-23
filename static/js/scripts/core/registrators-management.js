// Registrators Management Module
// Управление регистраторами

function createRegistrator(registratorData) {
  try {
    if (window.ApiClient) {
      return window.ApiClient.apiPost(
        "/api/registrators",
        registratorData
      ).then((data) => {
        if (data.success) {
          if (window.showToast) {
            window.showToast("Регистратор создан", "success");
          }
          refreshRegistratorsTable();
        } else {
          if (window.showToast) {
            window.showToast("Ошибка создания регистратора", "error");
          }
        }
        return data;
      });
    } else {
      // Fallback to direct fetch
      return fetch("/api/registrators", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registratorData),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Регистратор создан", "success");
            }
            refreshRegistratorsTable();
          } else {
            if (window.showToast) {
              window.showToast("Ошибка создания регистратора", "error");
            }
          }
          return data;
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "createRegistrator");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "createRegistrator");
    }
  }
}

function updateRegistrator(registratorId, registratorData) {
  try {
    if (window.ApiClient) {
      return window.ApiClient.apiPut(
        `/api/registrators/${registratorId}`,
        registratorData
      ).then((data) => {
        if (data.success) {
          if (window.showToast) {
            window.showToast("Регистратор обновлен", "success");
          }
          refreshRegistratorsTable();
        } else {
          if (window.showToast) {
            window.showToast("Ошибка обновления регистратора", "error");
          }
        }
        return data;
      });
    } else {
      // Fallback to direct fetch
      return fetch(`/api/registrators/${registratorId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registratorData),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Регистратор обновлен", "success");
            }
            refreshRegistratorsTable();
          } else {
            if (window.showToast) {
              window.showToast("Ошибка обновления регистратора", "error");
            }
          }
          return data;
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "updateRegistrator");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "updateRegistrator");
    }
  }
}

function deleteRegistrator(registratorId) {
  try {
    if (confirm("Вы уверены, что хотите удалить этого регистратора?")) {
      if (window.ApiClient) {
        return window.ApiClient.apiDelete(
          `/api/registrators/${registratorId}`
        ).then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Регистратор удален", "success");
            }
            // Remove registrator from UI
            const registratorRow = document.querySelector(
              `[data-registrator-id="${registratorId}"]`
            );
            if (registratorRow) {
              registratorRow.remove();
            }
          } else {
            if (window.showToast) {
              window.showToast("Ошибка удаления регистратора", "error");
            }
          }
          return data;
        });
      } else {
        // Fallback to direct fetch
        return fetch(`/api/registrators/${registratorId}`, {
          method: "DELETE",
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.success) {
              if (window.showToast) {
                window.showToast("Регистратор удален", "success");
              }
              // Remove registrator from UI
              const registratorRow = document.querySelector(
                `[data-registrator-id="${registratorId}"]`
              );
              if (registratorRow) {
                registratorRow.remove();
              }
            } else {
              if (window.showToast) {
                window.showToast("Ошибка удаления регистратора", "error");
              }
            }
            return data;
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "deleteRegistrator");
            }
          });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "deleteRegistrator");
    }
  }
}

function refreshRegistratorsTable() {
  try {
    if (window.ApiClient) {
      window.ApiClient.apiGet("/api/registrators")
        .then((data) => {
          if (data.registrators) {
            renderRegistratorsTable(data.registrators);
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "refreshRegistratorsTable");
          }
        });
    } else {
      // Fallback to direct fetch
      fetch("/api/registrators")
        .then((response) => response.json())
        .then((data) => {
          if (data.registrators) {
            renderRegistratorsTable(data.registrators);
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "refreshRegistratorsTable");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "refreshRegistratorsTable");
    }
  }
}

function renderRegistratorsTable(registrators) {
  try {
    const tableBody = document.querySelector("#maintable tbody");
    if (!tableBody) return;

    const rowsHtml = registrators
      .map(
        (registrator) => `
        <tr data-registrator-id="${registrator.id}" class="table__body_row">
          <td>${registrator.name}</td>
          <td>${registrator.ip_address || ""}</td>
          <td>${registrator.status || "Неизвестно"}</td>
          <td>${registrator.last_seen || "Никогда"}</td>
          <td>
            <button onclick="editRegistrator(${
              registrator.id
            })" class="btn btn-sm btn-primary">
              Редактировать
            </button>
            <button onclick="deleteRegistrator(${
              registrator.id
            })" class="btn btn-sm btn-danger">
              Удалить
            </button>
            <button onclick="testRegistrator(${
              registrator.id
            })" class="btn btn-sm btn-info">
              Тест
            </button>
          </td>
        </tr>
      `
      )
      .join("");

    tableBody.innerHTML = rowsHtml;
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "renderRegistratorsTable");
    }
  }
}

function editRegistrator(registratorId) {
  try {
    // Show edit registrator modal
    const modal = document.getElementById("editRegistratorModal");
    if (modal) {
      modal.style.display = "block";

      // Load registrator data
      if (window.ApiClient) {
        window.ApiClient.apiGet(`/api/registrators/${registratorId}`)
          .then((data) => {
            if (data.registrator) {
              // Populate form with registrator data
              const form = modal.querySelector("form");
              if (form) {
                form.querySelector('[name="name"]').value =
                  data.registrator.name || "";
                form.querySelector('[name="ip_address"]').value =
                  data.registrator.ip_address || "";
                form.querySelector('[name="description"]').value =
                  data.registrator.description || "";
              }
            }
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "editRegistrator");
            }
          });
      } else {
        // Fallback to direct fetch
        fetch(`/api/registrators/${registratorId}`)
          .then((response) => response.json())
          .then((data) => {
            if (data.registrator) {
              // Populate form with registrator data
              const form = modal.querySelector("form");
              if (form) {
                form.querySelector('[name="name"]').value =
                  data.registrator.name || "";
                form.querySelector('[name="ip_address"]').value =
                  data.registrator.ip_address || "";
                form.querySelector('[name="description"]').value =
                  data.registrator.description || "";
              }
            }
          })
          .catch((err) => {
            if (window.ErrorHandler) {
              window.ErrorHandler.handleError(err, "editRegistrator");
            }
          });
      }
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "editRegistrator");
    }
  }
}

function testRegistrator(registratorId) {
  try {
    if (window.ApiClient) {
      window.ApiClient.apiPost(`/api/registrators/${registratorId}/test`, {})
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Тест регистратора выполнен успешно", "success");
            }
          } else {
            if (window.showToast) {
              window.showToast("Ошибка тестирования регистратора", "error");
            }
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "testRegistrator");
          }
        });
    } else {
      // Fallback to direct fetch
      fetch(`/api/registrators/${registratorId}/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            if (window.showToast) {
              window.showToast("Тест регистратора выполнен успешно", "success");
            }
          } else {
            if (window.showToast) {
              window.showToast("Ошибка тестирования регистратора", "error");
            }
          }
        })
        .catch((err) => {
          if (window.ErrorHandler) {
            window.ErrorHandler.handleError(err, "testRegistrator");
          }
        });
    }
  } catch (err) {
    if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "testRegistrator");
    }
  }
}

// Export functions to global scope
window.RegistratorsManagement = {
  createRegistrator,
  updateRegistrator,
  deleteRegistrator,
  refreshRegistratorsTable,
  renderRegistratorsTable,
  editRegistrator,
  testRegistrator,
};
