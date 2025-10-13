function popupValues(form, id) {
  if (!id) {
    return;
  }
  let _id = Math.abs(id);
  let values = document.getElementById(_id).getElementsByTagName('td');
  if (form.id == 'edit1') {
    let t = values[2].innerText.split('\n');
    form.getElementsByTagName('input')[0].value = t.length > 0 ? t[1] : '';
    form.getElementsByTagName('textarea')[0].value = values[1].innerHTML.trim();
  } else if (form.id == 'edit2') {
    let target = form.getElementsByTagName('input');
    target[0].value = values[6].innerText.replace(' ', 'T');
    target[1].value = values[7].innerText.replace(' ', 'T');
    target[2].value = values[8].innerText.replace(' ', 'T');
  } else if (form.id == 'delete') {
    let target = form.parentElement.getElementsByTagName('b');
    target[0].innerText = values[0].innerText;
  }
  form.action = form.action.replace(new RegExp('0$'), id);
}

function validateForm(x) {
  let req = trimIfExists(x.elements['description']);
  if (!req) {
    alert('Заполните описание ремонта!');
    return;
  }
  x.submit();
}

function sendFiles(id) {
  let form = document.createElement('form');
  form.method = 'POST';
  form.action = '/requests/file_add/' + id.toString();
  form.enctype = 'multipart/form-data';
  form.append(event.target);
  document.body.appendChild(form);
  form.submit();
}
