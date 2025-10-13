function popupValues(form, id) {
  if (!id) {
    return;
  }
  let _id = Math.abs(id);
  let values = document.getElementById(_id).getElementsByTagName('td');
  if (form.id == 'edit') {
    form.elements['number'].value = values[3].innerHTML;
    form.elements['responsible'].value = values[7].innerHTML;
    form.elements['description'].value = values[8].innerHTML;
    form.elements['iss_date'].value = values[4].innerText.replace(' ', 'T');
    form.elements['start_date'].value = values[5].innerText.replace(' ', 'T');
    form.elements['end_date'].value = values[6].innerText.replace(' ', 'T');
    let comp_date = values[1].innerText.split('\n');
    if (comp_date.length > 1) {
      form.elements['comp_date'].value = comp_date[1].replace(' ', 'T');
    }
    let select = form.elements['department'];
    for (let i = 0; i < select.length; i++) {
      if (select[i].textContent.trim() == values[0].innerText) {
        select[i].selected = true;
      }
    }
  } else if (form.id == 'delete') {
    let target = form.parentElement.getElementsByTagName('b');
    target[0].innerText = values[3].innerText;
  } else if (form.id == 'status') {
    if (values[1].innerText.trim() == 'Работы не ведутся') {
      form.elements['status'][0].checked = true;
    } else if (values[1].innerText.trim() == 'Работы ведутся') {
      form.elements['status'][1].checked = true;
    } else {
      form.elements['status'][2].checked = true;
      form.elements['comp_date'].style.display = 'block';
      let t = values[1].innerText.search('-');
      if (t > -1) {
        let dt = values[1].innerText.substring(t - 4);
        form.elements['comp_date'].value = dt;
      }
    }
  } else if (form.id == "note") {
    let data = values[10].innerText;
    /* removed debug logging */
    let note;
    if (data.indexOf(':') > -1) {
      note = data.split(':')[1].substring(1);
    } else {
      note = '';
    }
    form.getElementsByTagName("textarea")[0].value = note;
  }
  form.action = form.action.replace(new RegExp('0$'), id);
}

function popupFileDeleteToggle(id, name) {
  const overlay = document.getElementById('popup-delete-file');
  let form = overlay.getElementsByTagName('form')[0];
  form.reset();
  if (!popup) {
    popupFileDeleteValues(form, id, name);
  }
  overlay.classList.toggle('show');
  popup = overlay.classList.contains('show') ? 'popup-delete-file' : null;
}

function popupFileDeleteValues(form, id, name) {
  let _id = Math.abs(id);
  let target = form.parentElement.getElementsByTagName('b');
  let values = document.getElementById(_id).getElementsByTagName('td');
  target[1].innerText = values[3].innerText;
  target[0].innerText = name;
  form.action = form.action.replace(new RegExp('/0/'), '/' + id.toString() + '/').replace(new RegExp('xxx'), name);
}

function validateForm(x) {
  let res = trimIfExists(x.elements['responsible']);
  if (!res) {
    alert('Не указан ответственный!');
    return;
  }
  let number = trimIfExists(x.elements['number']);
  if (!number) {
    alert('Заполните номер наряда!');
    return;
  }
  let sd = trimIfExists(x.elements['start_date']);
  if (!sd) {
    alert('Заполните время начала работ!');
    return;
  }
  let ed = trimIfExists(x.elements['end_date']);
  if (!ed) {
    alert('Заполните время окончания работ!');
    return;
  }
  let id = trimIfExists(x.elements['iss_date']);
  if (!id) {
    alert('Заполните время выдачи наряда!');
    return;
  }
  let des = trimIfExists(x.elements['description']);
  if (!des) {
    alert('Заполните наименование работ!');
    return;
  }
  x.submit();
}

function sendFiles(id) {
  let form = document.createElement('form');
  form.method = 'POST';
  form.action = '/orders/file_add/' + id.toString();
  form.enctype = 'multipart/form-data';
  form.append(event.target);
  document.body.appendChild(form);
  form.submit();
}

function httpGet(step) {
  if (step == 6){
    return;
  }
  let url = "";
  for(let i = 0; i <= step; i++) {
    let el = document.getElementById("s" + i.toString());
    url += el.value;
  }
  document.getElementById("s" + step.toString()).disabled = true;
  url = url.replaceAll("/", "!");
  xmlhttp = new XMLHttpRequest();
  xmlhttp.onreadystatechange = function()
  {
      if (xmlhttp.readyState == 4 && xmlhttp.status == 200)
      {
        let div = document.createElement("div");
        div.classList.add("popup__form-control", "form-control")
        div.id = "d" + (step + 1).toString();

        let sel = document.createElement("select");
        sel.id = "s" + (step + 1).toString();
        sel.name = "s" + (step + 1).toString();
        sel.onchange = () => httpGet(step + 1);
        sel.classList.add("form-control__control", "select");
        div.appendChild(sel);

        let a = xmlhttp.responseText.split('|');
        let form = document.getElementById("add-file");
        let opt = document.createElement("option");
        opt.classList.add("select__option");
        opt.text = '';
        opt.value = '';
        opt.selected = true;
        opt.disabled = true;
        sel.add(opt);
        a.forEach((x) => {
          let opt = document.createElement("option");
          opt.classList.add("select__option");
          opt.text = x;
          opt.value = x;
          sel.add(opt);
        })
        form.insertBefore(div, form.childNodes[form.childElementCount]);
      }
  }
  xmlhttp.open("GET", "https://znv.vts.vitebsk.energo.net/proxy/" + url, false );
  xmlhttp.send();
}

function addFileReset() {
  let form = document.getElementById("add-file");
  form.reset();
  document.getElementById("s0").disabled = false;
  for(let i = 1; i <= 6; i++) {
    let el = document.getElementById("d" + i.toString());
    if (el) {
      form.removeChild(el);
    }
  }
}

function addFileSubmit() {
  let form = document.getElementById("add-file");
  for(let i = 0; i <= 6; i++) {
    let el = document.getElementById("s" + i.toString());
    el.disabled = false;
  }
  form.submit();
}