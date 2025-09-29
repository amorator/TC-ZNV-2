$(document).keypress(function(e){
    if (e.which == 13){
        $("#submit").click();
    }
});

function validateForm(x) {
  trimIfExists(x.elements["login"]);
  trimIfExists(x.elements["password"]);
  x.submit();
}
