/**
 * Alert Modal Utility
 * Replaces native alert() with Bootstrap modal dialogs
 */

(function () {
  "use strict";

  // Create modal HTML if it doesn't exist
  function createAlertModal() {
    if (document.getElementById("alertModal")) return;

    const modalHTML = `
      <div class="modal fade" id="alertModal" tabindex="-1" aria-labelledby="alertModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="alertModalLabel">Уведомление</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Закрыть"></button>
            </div>
            <div class="modal-body" id="alertModalBody">
              <!-- Message will be inserted here -->
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
  }

  // Create confirm modal HTML if it doesn't exist
  function createConfirmModal() {
    if (document.getElementById("confirmModal")) return;

    const modalHTML = `
      <div class="modal fade" id="confirmModal" tabindex="-1" aria-labelledby="confirmModalLabel" aria-hidden="true" style="z-index: 10001;">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="confirmModalLabel">Подтверждение</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Закрыть"></button>
            </div>
            <div class="modal-body" id="confirmModalBody">
              <!-- Message will be inserted here -->
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="confirmCancel">Отмена</button>
              <button type="button" class="btn btn-primary" id="confirmOk">OK</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
  }

  // Initialize modals on DOM ready
  function init() {
    createAlertModal();
    createConfirmModal();
  }

  // Accessibility helpers for Bootstrap modals
  function attachA11yHandlers(modalElement) {
    // Ensure aria-hidden is correct during lifecycle
    modalElement.addEventListener("show.bs.modal", function () {
      modalElement.removeAttribute("aria-hidden");
    });
    modalElement.addEventListener("shown.bs.modal", function () {
      modalElement.removeAttribute("aria-hidden");
    });
    // Blur any focused descendant before hide so focus isn't inside aria-hidden
    modalElement.addEventListener("hide.bs.modal", function () {
      try {
        if (
          document.activeElement &&
          modalElement.contains(document.activeElement)
        ) {
          document.activeElement.blur();
        }
      } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
    });
    modalElement.addEventListener("hidden.bs.modal", function () {
      modalElement.setAttribute("aria-hidden", "true");
    });
  }

  // Show alert modal
  function showAlert(message, title = "Уведомление") {
    createAlertModal();

    const modalElement = document.getElementById("alertModal");
    const modal = new bootstrap.Modal(modalElement);
    const titleElement = document.getElementById("alertModalLabel");
    const bodyElement = document.getElementById("alertModalBody");

    titleElement.textContent = title;
    bodyElement.textContent = message;

    attachA11yHandlers(modalElement);

    modal.show();
  }

  // Show confirm modal
  function showConfirm(message, title = "Подтверждение") {
    return new Promise((resolve) => {
      createConfirmModal();

      const modalElement = document.getElementById("confirmModal");
      const modal = new bootstrap.Modal(modalElement);
      const titleElement = document.getElementById("confirmModalLabel");
      const bodyElement = document.getElementById("confirmModalBody");
      const okButton = document.getElementById("confirmOk");
      const cancelButton = document.getElementById("confirmCancel");

      titleElement.textContent = title;
      bodyElement.textContent = message;

      // Prevent double-open during fade-out by short-circuiting if already visible
      try {
        if (modalElement.classList.contains("show")) {
          return resolve(false);
        }
      } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }

      attachA11yHandlers(modalElement);

      // Remove existing event listeners
      const newOkButton = okButton.cloneNode(true);
      const newCancelButton = cancelButton.cloneNode(true);
      okButton.parentNode.replaceChild(newOkButton, okButton);
      cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);

      // Add new event listeners
      newOkButton.addEventListener("click", () => {
        modal.hide();
        resolve(true);
      });

      newCancelButton.addEventListener("click", () => {
        modal.hide();
        resolve(false);
      });

      // Handle modal close events
      const handleClose = () => {
        modalElement.removeEventListener("hidden.bs.modal", handleClose);
        resolve(false);
      };
      modalElement.addEventListener("hidden.bs.modal", handleClose);

      modal.show();
    });
  }

  // Replace native alert
  function replaceAlert() {
    window.alert = function (message) {
      showAlert(message, "Уведомление");
    };
  }

  // Replace native confirm
  function replaceConfirm() {
    window.confirm = function (message) {
      return showConfirm(message, "Подтверждение");
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Replace native functions
  replaceAlert();
  replaceConfirm();

  // Export functions for manual use
  window.showAlertModal = showAlert;
  window.showConfirmModal = showConfirm;
})();
