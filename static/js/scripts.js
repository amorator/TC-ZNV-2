'use strict';

function popupKeys() {
  let x = document.getElementsByTagName('form');
  let target;
  /*for(let i = 0; i < x.length; i++) {
    target = x[i].parentElement.parentElement;
    target.addEventListener("click", function(event) {
      if (popup == event.target.id) {
        event.preventDefault();
        popupToggle(popup);
      }
    })
  };*/
  /*document.addEventListener("keypress", function(event) {
    if (popup && event.key == "Enter") {
      if (event.target.tagName.toUpperCase() == "TEXTAREA") return;
      event.preventDefault();
      document.querySelectorAll('[type="submit"]')[0].click();
      //validateForm(event.target.parentElement.parentElement);
    }
  });*/
  document.addEventListener('keydown', function (event) {
    if (popup && event.key == 'Escape') {
      event.preventDefault();
      popupToggle(popup);
    }
  });
}

/*function tableListener() {
  let table = document.getElementById('maintable');
  if (table != null) {
    let search = document.getElementById('searchinp');
    search.addEventListener('input', function (event) {
      filterTable(table, search.value);
    });
    Array.from(table.getElementsByTagName('th')).forEach((th) => {
      th.addEventListener('click', function (event) {
        sortTable(table, event.target);
      });
    });
  }
}*/

function displayName(name) {
  let target = document.getElementById('nav').getElementsByTagName('a');
  for (let i = target.length - 1; i >= 0; i--) {
    if (target[i].href.endsWith('logout')) {
      target[i].firstChild.data += ' (' + name + ')';
    }
  }
}

function popupToggle(x, id = 0) {
  const overlay = document.getElementById(x);
  let form = overlay.getElementsByTagName('form')[0];
  form.reset();
  if (!popup) {
    popupValues(form, id);
  }
  overlay.classList.toggle('show');
  popup = overlay.classList.contains('show') ? x : null;
  
  // Reset user typing flag when opening add popup
  if (x === 'popup-add') {
    const nameInput = document.getElementById("add-name");
    if (nameInput) {
      nameInput.userHasTyped = false;
    }
    
    // Reset upload progress
    const progressDiv = document.getElementById('upload-progress');
    const submitBtn = document.getElementById('add-submit-btn');
    const cancelBtn = document.getElementById('add-cancel-btn');
    
    if (progressDiv) {
      progressDiv.classList.add('d-none');
      const progressBar = progressDiv.querySelector('.progress-bar');
      const statusText = progressDiv.querySelector('.upload-status small');
      
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', 0);
      }
      
      if (statusText) {
        statusText.textContent = 'Загрузка файла...';
        statusText.style.color = '';
      }
    }
    
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Отмена';
      cancelBtn.onclick = function() {
        popupToggle('popup-add');
      };
    }
    
    // Clear any ongoing upload
    if (window.currentUploadXHR) {
      window.currentUploadXHR.abort();
      window.currentUploadXHR = null;
    }
  }
}

function trimIfExists(x) {
  if (x != null) {
    if (x.value == null || x.value.trim() == '') {
      return false;
    }
  }
  return true;
}

/*function searchClean() {
  document.getElementById('searchinp').value = '';
  filterTable(document.getElementById('maintable'), '');
}*/

/*function sortTable(table, th) {
  const getCellValue = (tr, idx) =>
    tr.children[idx] != null
      ? tr.children[idx].innerText || tr.children[idx].textContent
      : '';
  table.dataset.asc = !(table.dataset.asc === 'true');
  const comparer = (idx, asc) => (a, b) =>
    ((v1, v2) =>
      (v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2)) ||
      (/^\d+$/.test(v1) && /^\d+$/.test(value))
        ? v1 - v2
        : v1.toString().localeCompare(v2))(
      getCellValue(asc ? a : b, idx),
      getCellValue(asc ? b : a, idx)
    );
  Array.from(table.querySelectorAll('tr:nth-child(n+2)'))
    .slice(0)
    .sort(
      comparer(
        Array.from(th.parentNode.children).indexOf(th),
        table.dataset.asc === 'true'
      )
    )
    .forEach((tr) => table.appendChild(tr));
}

function filterTable(table, filter) {
  let tbody = table.getElementsByTagName('tbody')[0];
  filter = filter.toUpperCase();
  Array.from(tbody.children)
    .slice(1, tbody.children.length)
    .forEach((row) => {
      let res = false;
      Array.from(row.children).forEach((cell) => {
        if (cell.innerText.toUpperCase().includes(filter)) {
          res = true;
        }
      });
      if (res) {
        row.style.display = 'table-row';
      } else {
        row.style.display = 'none';
      }
    });
}*/

var popup = null;
/*$(document).ready(function () {
  popupKeys();
  tableListener();
});*/

function notifyTest() {
  if (!('Notification' in window)) {
    alert('Уведомления не поддерживаются!');
  } else if (Notification.permission === 'granted') {
    const notification = new Notification('Провер04ka', {
      body: 'Test\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest\nTest// NOTE: Test\n',
      icon: '/static/icons/notification_menu.png',
      requireInteraction: true,
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        const notification = new Notification('Hi there!');
      }
    });
  }
}
