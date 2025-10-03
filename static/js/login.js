/**
 * Trim input field if it exists
 * @param {HTMLInputElement} input
 */
function trimIfExists(input) {
  if (input && input.value) {
    input.value = input.value.trim();
  }
}

/**
 * Validate login form minimally and submit.
 * @param {HTMLFormElement} x
 */
function validateForm(x) {
  // Resolve form element whether x is a button inside the form or the form itself
  var form = (x && x.tagName === 'FORM') ? x : (x && (x.form || (x.closest && x.closest('form'))));
  if (!form) { return false; }
  try { console.debug('Login: validateForm called'); } catch(_) {}
  // Briefly disable submit button to avoid double clicks
  var btn = form.querySelector('button[type="submit"], .login__button');
  var originalText = btn && (btn.textContent || btn.value);
  if (btn) { try { btn.disabled = true; } catch(_) {} }
  try { trimIfExists(form.elements["login"]); } catch(_) {}
  try { trimIfExists(form.elements["password"]); } catch(_) {}
  try {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
  } catch(_) {
    if (btn) { try { btn.disabled = false; if (originalText !== undefined) { if (btn.textContent !== undefined) btn.textContent = originalText; else if (btn.value !== undefined) btn.value = originalText; } } catch(_) {} }
    return false;
  }
  return true;
}
