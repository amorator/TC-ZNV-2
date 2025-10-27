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
    const dataValue = row.getAttribute(`data-${name}`);
    if (dataValue !== null) {
      if (input.type === "checkbox") {
        input.checked = dataValue === "true" || dataValue === "1";
      } else {
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
        console.warn(`Modal element not found: ${popupId}`);
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
    console.error("Error in popupToggle:", error);
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
