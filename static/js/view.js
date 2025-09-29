$(document).ready(function () {
  $("#dir").change(function () {
    if ($(this).val() != "") {
      window.location.href = $(this).val();
    }
  });
});

function sortTable(n) {
  let table;
  table = document.getElementById("table");
  let rows,
    i,
    x,
    y,
    count = 0;
  let switching = true;
  let direction = "ascending";
  while (switching) {
    switching = false;
    let rows = table.rows;
    for (i = 1; i < rows.length; i++) {
      var Switch = false;
      x = rows[i].getElementsByTagName("TD")[n];
      y = rows[i + 1].getElementsByTagName("TD")[n];
      if (x === undefined) {
        continue;
      }
      if (y === undefined) {
        y = rows[i + 2].getElementsByTagName("TD")[n];
      }
      if (direction == "ascending") {
        if (x.innerHTML.toLowerCase() > y.innerHTML.toLowerCase()) {
          Switch = true;
          break;
        }
      } else if (direction == "descending") {
        if (x.innerHTML.toLowerCase() < y.innerHTML.toLowerCase()) {
          Switch = true;
          break;
        }
      }
    }
    if (Switch) {
      rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
      switching = true;
      count++;
    } else {
      if (count == 0 && direction == "ascending") {
        direction = "descending";
        switching = true;
      }
    }
  }
}
