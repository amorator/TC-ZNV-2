// Modal Helpers Module
// Универсальные функции для работы с модальными окнами

// Prevent multiple installations
if (window.__modalHelpersInstalled) {
  // Already installed, skip
} else {
  window.__modalHelpersInstalled = true;

  window.showModalEl = function (el) {
    try {
      // Ensure aria-hidden is cleared before show (avoid focused hidden ancestor)
      try {
        el.removeAttribute("aria-hidden");
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "showModalEl");
        }
      }
      // Blur focus, let Bootstrap manage aria attributes
      try {
        document.activeElement &&
          document.activeElement.blur &&
          document.activeElement.blur();
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "showModalEl");
        }
      }
      try {
        (bootstrap.Modal.getInstance(el) || new bootstrap.Modal(el)).show();
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "showModalEl");
        }
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "showModalEl");
      }
    }
  };

  window.hideModalEl = function (el) {
    try {
      // Blur any focused element inside to avoid aria-hidden focus trap
      try {
        var ae = document.activeElement;
        if (ae && (ae === el || el.contains(ae))) {
          ae.blur && ae.blur();
        }
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "hideModalEl");
        }
      }
      // Proactively move focus away before Bootstrap toggles aria-hidden
      try {
        document.body &&
          typeof document.body.focus === "function" &&
          document.body.focus();
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "hideModalEl");
        }
      }
      // Hide on next tick to ensure focus change is committed
      try {
        var inst =
          bootstrap && bootstrap.Modal && bootstrap.Modal.getInstance(el);
        if (!inst && bootstrap && bootstrap.Modal)
          inst = new bootstrap.Modal(el);
        if (inst && inst.hide) {
          setTimeout(function () {
            try {
              inst.hide();
            } catch (err) {
              if (window.ErrorHandler) {
                window.ErrorHandler.handleError(err, "hideModalEl");
              }
            }
          }, 0);
        }
      } catch (err) {
        if (window.ErrorHandler) {
          window.ErrorHandler.handleError(err, "hideModalEl");
        }
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "hideModalEl");
      }
    }
  };

  window.toggleModalEl = function (el) {
    try {
      var inst =
        bootstrap && bootstrap.Modal && bootstrap.Modal.getInstance(el);
      if (inst) {
        if (inst._isShown) {
          window.hideModalEl(el);
        } else {
          window.showModalEl(el);
        }
      } else {
        window.showModalEl(el);
      }
    } catch (err) {
      if (window.ErrorHandler) {
        window.ErrorHandler.handleError(err, "toggleModalEl");
      }
    }
  };
}

// Export functions to global scope
window.ModalHelpers = {
  showModalEl: window.showModalEl,
  hideModalEl: window.hideModalEl,
  toggleModalEl: window.toggleModalEl,
};
