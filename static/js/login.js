// Submit on Enter anywhere on the login page
$(document).on('keypress', function(e){
  if (e.which === 13){
    $("#submit").trigger('click');
  }
});

/**
 * Validate login form minimally and submit.
 * @param {HTMLFormElement} x
 */
function validateForm(x) {
  try { trimIfExists(x.elements["login"]); } catch(_) {}
  try { trimIfExists(x.elements["password"]); } catch(_) {}
  x.submit();
}
