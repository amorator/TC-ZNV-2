/**
 * Unified Modal Management Module
 * Provides common modal functionality for files and users pages
 */

(function () {
  "use strict";

  /**
   * Modal Manager Class
   */
  class ModalManager {
    constructor() {
      this.modals = new Map();
      this.activeModal = null;
      this.init();
    }

    /**
     * Initialize modal manager
     */
    init() {
      // Listen for escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.activeModal) {
          // Intercept recorder ESC to guard close
          if (this.activeModal === "popup-rec") {
            try {
              const iframe = document.getElementById("rec-iframe");
              if (iframe && iframe.contentWindow) {
                window.__recCloseRequested = true;
                try {
                  if (window.__recStateTimer) {
                    clearTimeout(window.__recStateTimer);
                    window.__recStateTimer = null;
                  }
                } catch (_) {}
                iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");
                window.__recStateTimer = setTimeout(function () {
                  // No fallback confirm for recorder on ESC; do nothing if iframe silent
                  try {
                    window.__recCloseRequested = false;
                  } catch (_) {}
                  try {
                    window.__recStateTimer = null;
                  } catch (_) {}
                }, 300);
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            } catch (_) {}
          }
          this.closeModal(this.activeModal);
        }
      });

      // Listen for clicks outside modal
      document.addEventListener("click", (e) => {
        if (
          this.activeModal &&
          e.target.classList &&
          e.target.classList.contains("popup-overlay")
        ) {
          // Intercept recorder overlay click to guard close
          if (this.activeModal === "popup-rec") {
            try {
              const iframe = document.getElementById("rec-iframe");
              if (iframe && iframe.contentWindow) {
                window.__recCloseRequested = true;
                try {
                  if (window.__recStateTimer) {
                    clearTimeout(window.__recStateTimer);
                    window.__recStateTimer = null;
                  }
                } catch (_) {}
                iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");
                window.__recStateTimer = setTimeout(function () {
                  // No fallback confirm for recorder on overlay click; do nothing if iframe silent
                  try {
                    window.__recCloseRequested = false;
                  } catch (_) {}
                  try {
                    window.__recStateTimer = null;
                  } catch (_) {}
                }, 300);
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            } catch (_) {}
          }
          this.closeModal(this.activeModal);
        }
      });
    }

    /**
     * Register a modal for management
     * @param {string} modalId - Modal element ID
     * @param {Object} options - Configuration options
     */
    registerModal(modalId, options = {}) {
      const modal = document.getElementById(modalId);
      if (!modal) return false;

      const config = {
        autoClose: options.autoClose !== false,
        closeOnEscape: options.closeOnEscape !== false,
        closeOnOverlay: options.closeOnOverlay !== false,
        onOpen: options.onOpen || null,
        onClose: options.onClose || null,
        ...options,
      };

      this.modals.set(modalId, {
        element: modal,
        config: config,
      });

      return true;
    }

    /**
     * Open modal by ID
     * @param {string} modalId - Modal element ID
     * @param {Object} data - Data to populate modal
     * @param {string|number} rowId - Row ID for data binding
     */
    openModal(modalId, data = null, rowId = null) {
      const modalData = this.modals.get(modalId);
      const modal = modalData
        ? modalData.element
        : document.getElementById(modalId);

      if (!modal) {
        console.error(`Modal ${modalId} not found`);
        return false;
      }

      // Close any active modal
      if (this.activeModal && this.activeModal !== modalId) {
        this.closeModal(this.activeModal);
      }

      // Populate modal with data if provided
      if (data || rowId) {
        this.populateModal(modal, data, rowId);
      }

      // Show modal: support both custom overlays (.overlay-container) and Bootstrap (.modal)
      try {
        window.modlog &&
          window.modlog("openModal start", {
            modalId,
            hasBootstrap: !!window.bootstrap,
            classes: modal.className,
          });
      } catch (_) {}
      if (modal.classList.contains("modal")) {
        try {
          var inst = bootstrap.Modal.getOrCreateInstance(modal);
          inst.show();
          try {
            window.modlog &&
              window.modlog("openModal bootstrap.show()", modal.id);
          } catch (_) {}
        } catch (_) {
          // Fallback display if bootstrap not available
          modal.classList.add("show");
          modal.classList.remove("d-none");
          modal.style.display = "block";
          try {
            window.modlog &&
              window.modlog(
                "openModal bootstrap fallback display:block",
                modal.id
              );
          } catch (_) {}
        }
      } else {
        // Custom overlay
        modal.classList.add("show");
        modal.classList.add("visible");
        modal.classList.remove("d-none");
        modal.style.display = "flex";
        // Recorder iframe lazy-load: assign data-src -> src on first open
        try {
          if (modalId === "popup-rec") {
            const iframe = document.getElementById("rec-iframe");
            if (iframe) {
              const currentSrc = (iframe.getAttribute("src") || "").trim();
              const dataSrc = (iframe.getAttribute("data-src") || "").trim();
              if (
                (currentSrc === "" || currentSrc === "about:blank") &&
                dataSrc
              ) {
                iframe.setAttribute("src", dataSrc);
              }
            }
          }
        } catch (_) {}
        try {
          document.body.style.overflow = "hidden";
        } catch (_) {}
        try {
          window.modlog && window.modlog("openModal overlay show", modal.id);
        } catch (_) {}
      }

      // Focus first input
      const firstInput = modal.querySelector("input, textarea, select");
      if (firstInput) {
        setTimeout(() => {
          try {
            firstInput.focus();
          } catch (_) {}
        }, 100);
      }

      // Update active modal
      this.activeModal = modalId;

      // Call onOpen callback
      const config = modalData ? modalData.config : {};
      if (config.onOpen) {
        config.onOpen(modal, data, rowId);
      }

      // Trigger custom event
      try {
        window.modlog && window.modlog("modal-opened event", modalId);
      } catch (_) {}
      document.dispatchEvent(
        new CustomEvent("modal-opened", {
          detail: { modalId, data, rowId },
        })
      );

      return true;
    }

    /**
     * Close modal by ID
     * @param {string} modalId - Modal element ID
     */
    closeModal(modalId) {
      const modalData = this.modals.get(modalId);
      const modal = modalData
        ? modalData.element
        : document.getElementById(modalId);

      if (!modal) return false;

      // Hide modal: support Bootstrap and custom overlay
      try {
        window.modlog && window.modlog("closeModal start", { modalId });
      } catch (_) {}
      if (modal.classList.contains("modal")) {
        try {
          var inst =
            bootstrap.Modal.getInstance(modal) ||
            bootstrap.Modal.getOrCreateInstance(modal);
          inst.hide();
          try {
            window.modlog &&
              window.modlog("closeModal bootstrap.hide()", modal.id);
          } catch (_) {}
        } catch (_) {
          modal.classList.remove("show");
          modal.classList.add("d-none");
          modal.style.display = "none";
          try {
            window.modlog &&
              window.modlog("closeModal bootstrap fallback hide", modal.id);
          } catch (_) {}
        }
      } else {
        modal.classList.remove("show");
        modal.classList.remove("visible");
        modal.classList.add("d-none");
        modal.style.display = "none";
        try {
          document.body.style.overflow = "";
        } catch (_) {}
        try {
          window.modlog && window.modlog("closeModal overlay hide", modal.id);
        } catch (_) {}
      }

      // Clear form if it's a form modal
      const form = modal.querySelector("form");
      if (form) {
        form.reset();
      }

      // Update active modal
      if (this.activeModal === modalId) {
        this.activeModal = null;
      }

      // Call onClose callback
      const config = modalData ? modalData.config : {};
      if (config.onClose) {
        config.onClose(modal);
      }

      // Trigger custom event
      try {
        window.modlog && window.modlog("modal-closed event", modalId);
      } catch (_) {}
      document.dispatchEvent(
        new CustomEvent("modal-closed", {
          detail: { modalId },
        })
      );

      return true;
    }

    /**
     * Populate modal with data from row
     * @param {HTMLElement} modal - Modal element
     * @param {Object} data - Data object
     * @param {string|number} rowId - Row ID
     */
    populateModal(modal, data = null, rowId = null) {
      if (rowId && !data) {
        // Get data from row
        const row =
          document.getElementById(rowId) ||
          document.querySelector(`tr[data-id="${rowId}"]`);
        if (row) {
          data = this.extractRowData(row);
        }
      }

      if (!data) return;

      // Populate form fields
      const form = modal.querySelector("form");
      if (form) {
        this.populateForm(form, data);
      }

      // Set modal title if data has name/title
      const titleElement = modal.querySelector(".modal-title, .popup-title");
      if (titleElement && data.name) {
        titleElement.textContent = data.name;
      }

      // Set hidden ID field if exists
      const idField = modal.querySelector(
        'input[name="id"], input[name="row_id"]'
      );
      if (idField && rowId) {
        idField.value = rowId;
      }
    }

    /**
     * Extract data from table row
     * @param {HTMLElement} row - Table row element
     * @returns {Object} Extracted data
     */
    extractRowData(row) {
      const data = {};
      const cells = Array.from(row.children);

      // Extract text content from cells
      cells.forEach((cell, index) => {
        const text = cell.innerText.trim();
        if (text) {
          data[`cell_${index}`] = text;
        }
      });

      // Extract data attributes
      Array.from(row.attributes).forEach((attr) => {
        if (attr.name.startsWith("data-")) {
          const key = attr.name
            .replace("data-", "")
            .replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          data[key] = attr.value;
        }
      });

      // Common field mappings
      if (data.cell0) data.name = data.cell0;
      if (data.cell1) data.description = data.cell1;
      if (data.cell2) data.creator = data.cell2;
      if (data.cell3) data.date = data.cell3;

      return data;
    }

    /**
     * Populate form with data
     * @param {HTMLFormElement} form - Form element
     * @param {Object} data - Data object
     */
    populateForm(form, data) {
      Object.keys(data).forEach((key) => {
        const field = form.querySelector(`[name="${key}"]`);
        if (field) {
          if (field.type === "checkbox" || field.type === "radio") {
            field.checked =
              data[key] === "1" || data[key] === "true" || data[key] === true;
          } else {
            field.value = data[key];
          }
        }
      });

      // Special handling for select elements
      const selects = form.querySelectorAll("select");
      selects.forEach((select) => {
        const value = data[select.name];
        if (value) {
          select.value = value;
        }
      });
    }

    /**
     * Validate form
     * @param {HTMLFormElement} form - Form element
     * @param {Object} rules - Validation rules
     * @returns {boolean} Validation result
     */
    validateForm(form, rules = {}) {
      if (!form) return false;

      let isValid = true;
      const errors = [];

      // Trim all text inputs
      const textInputs = form.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="password"], textarea'
      );
      textInputs.forEach((input) => {
        if (input.value) {
          input.value = input.value.trim();
        }
      });

      // Apply custom validation rules
      Object.keys(rules).forEach((fieldName) => {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (!field) return;

        const rule = rules[fieldName];
        const value = field.value.trim();

        if (rule.required && !value) {
          errors.push(`${rule.label || fieldName} is required`);
          isValid = false;
        }

        if (value && rule.minLength && value.length < rule.minLength) {
          errors.push(
            `${rule.label || fieldName} must be at least ${
              rule.minLength
            } characters`
          );
          isValid = false;
        }

        if (value && rule.maxLength && value.length > rule.maxLength) {
          errors.push(
            `${rule.label || fieldName} must be no more than ${
              rule.maxLength
            } characters`
          );
          isValid = false;
        }

        if (value && rule.pattern && !rule.pattern.test(value)) {
          errors.push(`${rule.label || fieldName} format is invalid`);
          isValid = false;
        }
      });

      // Show errors if any
      if (!isValid) {
        this.showValidationErrors(form, errors);
      } else {
        this.clearValidationErrors(form);
      }

      return isValid;
    }

    /**
     * Show validation errors
     * @param {HTMLFormElement} form - Form element
     * @param {Array} errors - Error messages
     */
    showValidationErrors(form, errors) {
      // Clear existing errors
      this.clearValidationErrors(form);

      // Create error container
      let errorContainer = form.querySelector(".validation-errors");
      if (!errorContainer) {
        errorContainer = document.createElement("div");
        errorContainer.className = "validation-errors alert alert-danger";
        form.insertBefore(errorContainer, form.firstChild);
      }

      // Add error messages
      errorContainer.innerHTML = errors
        .map((error) => `<div>${error}</div>`)
        .join("");
    }

    /**
     * Clear validation errors
     * @param {HTMLFormElement} form - Form element
     */
    clearValidationErrors(form) {
      const errorContainer = form.querySelector(".validation-errors");
      if (errorContainer) {
        errorContainer.remove();
      }
    }

    /**
     * Submit form via AJAX
     * @param {HTMLFormElement} form - Form element
     * @param {Object} options - Submit options
     */
    async submitForm(form, options = {}) {
      if (!form) return false;

      const {
        method = "POST",
        endpoint = form.action || window.location.href,
        onSuccess = null,
        onError = null,
        onComplete = null,
      } = options;

      try {
        const formData = new FormData(form);

        const response = await fetch(endpoint, {
          method: method,
          body: formData,
          credentials: "include",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (onSuccess) onSuccess(result);
          return result;
        } else {
          const error = await response.text();
          if (onError) onError(error);
          throw new Error(error);
        }
      } catch (error) {
        console.error("Form submission error:", error);
        if (onError) onError(error);
        throw error;
      } finally {
        if (onComplete) onComplete();
      }
    }

    /**
     * Get active modal ID
     * @returns {string|null}
     */
    getActiveModal() {
      return this.activeModal;
    }

    /**
     * Check if modal is open
     * @param {string} modalId - Modal element ID
     * @returns {boolean}
     */
    isModalOpen(modalId) {
      // Check both internal state and DOM state
      const isActive = this.activeModal === modalId;
      const modal = document.getElementById(modalId);
      const isVisible =
        modal &&
        modal.classList.contains("show") &&
        modal.style.display !== "none";

      // If internal state says it's open but DOM says it's closed, sync the state
      if (isActive && !isVisible) {
        this.activeModal = null;
        return false;
      }

      return isActive && isVisible;
    }
  }

  // Create global instance
  window.ModalManager = ModalManager;
  window.modalManager = new ModalManager();

  // Sync state on page load
  document.addEventListener("DOMContentLoaded", () => {
    // Reset any stale modal states
    window.modalManager.activeModal = null;
  });

  // Legacy compatibility functions
  window.openModal = (modalId, rowId = null, data = null) => {
    return window.modalManager.openModal(modalId, data, rowId);
  };

  window.closeModal = (modalId) => {
    return window.modalManager.closeModal(modalId);
  };

  window.popupToggle = (modalId, rowId = null, data = null) => {
    const isOpen = window.modalManager.isModalOpen(modalId);
    // Intercept recorder modal close to query iframe state and confirm
    if (modalId === "popup-rec" && isOpen) {
      try {
        const iframe = document.getElementById("rec-iframe");
        if (iframe && iframe.contentWindow) {
          window.__recCloseRequested = true;
          try {
            if (window.__recStateTimer) {
              clearTimeout(window.__recStateTimer);
              window.__recStateTimer = null;
            }
          } catch (_) {}
          iframe.contentWindow.postMessage({ type: "rec:state?" }, "*");
          // Fallback if no response arrives
          window.__recStateTimer = setTimeout(function () {
            try {
              window.__recCloseRequested = false;
            } catch (_) {}
            try {
              if (window.showRecConfirmDialog) window.showRecConfirmDialog();
            } catch (_) {}
            try {
              window.__recStateTimer = null;
            } catch (_) {}
          }, 300);
          return true;
        }
      } catch (_) {}
      // If no iframe, just close
      return window.modalManager.closeModal(modalId);
    }
    // Default toggle
    if (isOpen) {
      return window.modalManager.closeModal(modalId);
    } else {
      return window.modalManager.openModal(modalId, data, rowId);
    }
  };

  // Recorder close control (mirror of legacy handler) but using modalManager
  window.addEventListener("message", function (ev) {
    try {
      const data = ev.data || {};
      if (!data || typeof data !== "object") return;
      if (data.type === "rec:state" && window.__recCloseRequested) {
        window.__recCloseRequested = false;
        try {
          if (window.__recStateTimer) {
            clearTimeout(window.__recStateTimer);
            window.__recStateTimer = null;
          }
        } catch (_) {}
        const st = data.state || {};
        const isRecording = !!st.recording;
        const isPaused = !!st.paused;
        const hasData = !!st.hasData;
        if (isRecording) {
          window.showAlertModal(
            "Остановите запись перед закрытием окна.",
            "Предупреждение"
          );
          return;
        }
        if (!window.__recSaving && (hasData || isPaused)) {
          if (window.showRecConfirmDialog) window.showRecConfirmDialog();
          return;
        }
        // Safe to close: notify iframe to cleanup then close via manager
        try {
          const iframe = document.getElementById("rec-iframe");
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: "rec:close" }, "*");
          }
        } catch (_) {}
        try {
          window.modalManager.closeModal("popup-rec");
        } catch (_) {}
      } else if (data.type === "rec:discarded") {
        try {
          window.modalManager.closeModal("popup-rec");
        } catch (_) {}
        window.__recSaving = false;
      } else if (data.type === "rec:saved") {
        window.__recSaving = false;
        try {
          window.softRefreshFilesTable && window.softRefreshFilesTable();
        } catch (e) {}
      }
    } catch (_) {}
  });
})();
