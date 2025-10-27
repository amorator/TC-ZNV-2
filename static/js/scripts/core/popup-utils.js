/**
 * Popup Utilities Module
 * Common functions for popup operations across the application
 */

/**
 * Populate form fields with values from a table row
 * @param {HTMLFormElement} form - Form element
 * @param {string} rowId - Row ID
 */
function popupValues(form, rowId) {
  if (!form || !rowId) return;

  const row = document.getElementById(rowId);
  if (!row) return;

  // Get all form inputs
  const inputs = form.querySelectorAll("input, select, textarea");

  inputs.forEach((input) => {
    const name = input.name;
    if (!name) return;

    // Try to find corresponding data attribute in the row
    let dataValue = row.getAttribute(`data-${name}`);
    if (dataValue !== null) {
      if (input.type === "checkbox") {
        input.checked = dataValue === "true" || dataValue === "1";
      } else {
        // Remove [Регистратор - XXX] from description for editing
        if (name === "description" && dataValue.includes("[Регистратор - ")) {
          dataValue = dataValue.replace(/\s*\[Регистратор - [^\]]+\]\s*/, "");
        }
        input.value = dataValue;
      }
    }
  });


  // Update form action URL with row ID
  if (form.action && form.action.includes("/0")) {
    form.action = form.action.replace("/0", `/${rowId}`);
  }

  // Special handling for delete modal - update file name
  if (form.id === "delete") {
    const fileNameElement = document.getElementById("delete-file-name");
    if (fileNameElement) {
      const fileName =
        row.getAttribute("data-name") ||
        row.getAttribute("data-file-name") ||
        "неизвестный";
      fileNameElement.textContent = fileName;
    }
    
    // Find the modal popup container
    const modal = form.closest(".overlay-container");
    if (modal) {
      // Find the bold element with placeholder text in the modal body
      const nameElement = modal.querySelector(".popup__body p b");
      if (nameElement) {
        // Determine modal type by checking the modal ID or title
        const modalId = modal.id;
        const modalTitle = modal.querySelector(".popup__title");
        const titleText = modalTitle ? modalTitle.textContent.trim() : "";
        
        // Handle users delete modal
        if (modalId === "popup-delete" && titleText.includes("пользователя")) {
          const userName = row.getAttribute("data-name") || "";
          const userLogin = row.getAttribute("data-login") || "";
          if (userName && userLogin) {
            nameElement.textContent = `${userLogin} (${userName})`;
          } else {
            nameElement.textContent = userLogin || userName || "неизвестный";
          }
        }
        
        // Handle groups delete modal
        else if (modalId === "popup-delete" && titleText.includes("группу")) {
          const groupName = row.getAttribute("data-name") || "неизвестная";
          nameElement.textContent = groupName;
        }
        
        // Handle requests delete modal (placeholder is "rname")
        else if (modalId === "popup-delete" && titleText.includes("заявку")) {
          const requestName = row.getAttribute("data-name") || "неизвестный";
          nameElement.textContent = requestName;
        }
        
        // Handle orders delete modal (placeholder is "ordname")
        else if (modalId === "popup-delete" && titleText.includes("заказ")) {
          const orderName = row.getAttribute("data-name") || "неизвестный";
          nameElement.textContent = orderName;
        }
        
        // Fallback: try to detect by placeholder text (for backward compatibility)
        else {
          const placeholder = nameElement.textContent.trim();
          
          if (placeholder === "uname") {
            const userName = row.getAttribute("data-name") || "";
            const userLogin = row.getAttribute("data-login") || "";
            if (userName && userLogin) {
              nameElement.textContent = `${userLogin} (${userName})`;
            } else {
              nameElement.textContent = userLogin || userName || "неизвестный";
            }
          } else if (placeholder === "gname") {
            const groupName = row.getAttribute("data-name") || "неизвестная";
            nameElement.textContent = groupName;
          } else if (placeholder === "rname") {
            const requestName = row.getAttribute("data-name") || "неизвестный";
            nameElement.textContent = requestName;
          } else if (placeholder === "ordname") {
            const orderName = row.getAttribute("data-name") || "неизвестный";
            nameElement.textContent = orderName;
          }
        }
      }
    }
  }
}

/**
 * Toggle popup modal with optional row ID
 * @param {string} popupId - Popup element ID
 * @param {string} rowId - Row ID (optional)
 */
function popupToggle(popupId, rowId) {
  try {
    if (window.openModal) {
      window.openModal(popupId, rowId);
    } else if (window.modalManager && window.modalManager.openModal) {
      window.modalManager.openModal(popupId);
    } else {
      // Fallback to direct modal manipulation
      const popupElement = document.getElementById(popupId);
      if (!popupElement) {
        return;
      }

      // Show modal
      popupElement.style.display = "block";
      popupElement.classList.add("active");

      // Add backdrop
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.id = `${popupId}-backdrop`;
      document.body.appendChild(backdrop);
    }
  } catch (error) {
    window.ErrorHandler && window.ErrorHandler.handleError("Error in popupToggle:", error, "app");
  }
}

// Export functions to global scope
window.popupValues = popupValues;
window.popupToggle = popupToggle;

// Also export as module if using ES6 modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    popupValues,
    popupToggle,
  };
}
