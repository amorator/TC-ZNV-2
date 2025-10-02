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
  try { trimIfExists(x.elements["login"]); } catch(_) {}
  try { trimIfExists(x.elements["password"]); } catch(_) {}
  x.submit();
}
