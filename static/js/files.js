function popupValues(form, id) {
  if (form.id != "add" && !id) {
    return;
  }
  if (form.id == "add") {
    document.getElementById("file").addEventListener("change", function(event) {
      if (event.target.files.length > 0) {
        document.getElementById("name").value = event.target.files[0].name;
      }
    });
    return;
  }
  let values = document.getElementById(id).getElementsByTagName("td");
  if (form.id == "edit") {
    form.getElementsByTagName("input")[0].value = values[0].innerText;
    form.getElementsByTagName("textarea")[0].value = values[1].innerText;
    let select = form.getElementsByTagName("select")[0];
  } else if (form.id == "delete") {
    let target = form.parentElement.getElementsByTagName("b");
    target[0].innerText = values[0].innerText;
  } else if (form.id == "note") {
    let data = values[4].innerText;
    let note;
    if (data.indexOf(':') > -1) {
      note = data.split(':')[1].substring(1);
    } else {
      note = '';
    }
    form.getElementsByTagName("textarea")[0].value = note;
  }
  form.action = form.action.replace(new RegExp("0$"), id);
}

function validateForm(x) {
  if (x.id == "add" || x.id == "edit") {
    let name = x.getElementsByTagName("input")[0].value.trim();
    if (name == undefined || name == "" || name.indexOf(".") <= 0) {
      alert("Задайте корректное имя файла!");
      return;
    }
  }
  if (x.id == "add") {
    let len = document.getElementById("file").files.length;
    if (len == undefined || len == 0) {
      alert("Выберите файл!");
      return;
    }
  }
  x.submit();
}
