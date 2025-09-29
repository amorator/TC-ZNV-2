function popupValues(form, id) {
  if (!id) {
    return;
  }
  let values = document.getElementById(id).getElementsByTagName("td");
  if (form.id == "edit") {
    let target = form.getElementsByTagName("input");
    target[0].value = values[1].innerText;
    target[1].value = values[2].innerText;
    target[2].checked = values[5].dataset.enabled == "1";
    let select = form.getElementsByTagName("select")[0];
    for (let i = 0; i < select.length; i++) {
      if (select[i].textContent.trim() == values[3].innerText) {
        select[i].selected = true;
      }
    }
    let permission = values[4].innerText.split(",");
    let td = form.getElementsByTagName("td");
    let box;
    for (let i = 0; i < td.length; i++) {
      box = td[i].getElementsByTagName("input")[0];
      if (box != null) {
        if (permission[i % permission.length].indexOf(box.value) > -1) {
          box.checked = true;
        }
      }
    }
  } else if (form.id == "delete") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[1].innerText;
  } else if (form.id == "reset") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[1].innerText;
  }
  form.action = form.action.replace(new RegExp("0$"), values[0].innerText);
}

function validateForm(x) {
  let req =
    trimIfExists(x.elements["login"]) &&
    trimIfExists(x.elements["name"]) &&
    trimIfExists(x.elements["password"]) &&
    trimIfExists(x.elements["password2"]);
  if (!req) {
    alert("Заполните все поля!");
    return;
  }
  if (x.elements["password"] != null && x.elements["password2"] != null) {
    if (x.elements["password"].value != x.elements["password2"].value) {
      alert("Пароли не совпадают!");
      return;
    }
  }
  trimIfExists(x.elements["password"]);
  trimIfExists(x.elements["password2"]);
  let table = x.getElementsByClassName("permissions")[0];
  if (table != null) {
    let len = table.getElementsByTagName("tr")[0].childElementCount;
    let perm = Array.apply("", Array(len)).map((u, i) => "");
    let td = table.getElementsByTagName("td");
    let box;
    for (let i = 0; i < td.length; i++) {
      box = td[i].getElementsByTagName("input")[0];
      if (box != null && box.checked) {
        perm[i % len] += box.value;
      }
    }
    var permission = document.createElement("input");
    permission.setAttribute("name", "permission");
    permission.style.display = "none";
    for (let i = 0; i < len; i++) {
      permission.value += perm[i] + ",";
    }
    permission.value = permission.value.slice(0, -1);
    x.appendChild(permission);
  }
  x.submit();
}
