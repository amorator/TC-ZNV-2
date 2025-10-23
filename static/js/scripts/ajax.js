(function(){
  'use strict';

  /**
   * Submit a form via fetch with common UX hooks.
   *
   * Behavior:
   * - Disables the submit button and shows a sending label
   * - Sends the form via POST with credentials and AJAX header
   * - Parses JSON when provided, treats {status:"error"} as a failure
   * - Shows toast on error if window.showToast exists
   * - Restores the submit button and calls lifecycle hooks
   *
   * @param {HTMLFormElement} form - The form element to submit via AJAX
   * @param {{onSuccess?:Function,onFinally?:Function}} [opts] - Optional callbacks
   * @returns {Promise<any>} Resolves with parsed JSON (if any), rejects on error
   */
  function submitFormAjax(form, opts){
    opts = opts || {};
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"], button.btn-primary');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      try { submitBtn.dataset.originalText = originalText; } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';
    }
    return fetch(form.action, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
    .then(async response => {
      const contentType = response.headers.get('Content-Type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        try { data = await response.json(); } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
      }
      if (!response.ok || (data && data.status === 'error')) {
        const msg = (data && (data.message || data.error)) || `Ошибка: HTTP ${response.status}`;
        throw new Error(msg);
      }
      if (typeof opts.onSuccess === 'function') {
        try { opts.onSuccess(data); } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
      }
      return data;
    })
    .catch(err => {
      if (window.ErrorHandler) {
      window.ErrorHandler.handleError(err, "unknown");
    } else window.ErrorHandler.handleError(err, "unknown");
    }
      }
    });
  }

  try { window.submitFormAjax = submitFormAjax; } catch (err) {
      window.ErrorHandler.handleError(err, "unknown");
    }
})();

