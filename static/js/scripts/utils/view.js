/**
 * Модуль просмотра файлов
 * Обеспечивает навигацию по директориям и сортировку таблиц
 *
 * @namespace ViewModule
 */

/**
 * Инициализация обработчиков событий при загрузке DOM
 * @memberof ViewModule
 */
$(document).ready(function () {
  $("#dir").change(function () {
    const selectedValue = $(this).val();
    if (selectedValue !== "") {
      window.location.href = selectedValue;
    }
  });
});

/**
 * Сортирует таблицу по указанной колонке
 * @param {number} n - Индекс колонки для сортировки
 * @memberof ViewModule
 */
function sortTable(n) {
  const table = document.getElementById("table");
  if (!table) {
    console.warn("Table with id 'table' not found");
    return;
  }

  let switching = true;
  let direction = "ascending";
  let count = 0;

  while (switching) {
    switching = false;
    const rows = table.rows;

    for (let i = 1; i < rows.length - 1; i++) {
      let shouldSwitch = false;
      const x = rows[i].getElementsByTagName("TD")[n];
      let y = rows[i + 1].getElementsByTagName("TD")[n];

      if (!x) continue;
      if (!y) {
        y = rows[i + 2]?.getElementsByTagName("TD")[n];
        if (!y) continue;
      }

      const xText = x.innerHTML.toLowerCase();
      const yText = y.innerHTML.toLowerCase();

      if (direction === "ascending") {
        if (xText > yText) {
          shouldSwitch = true;
          break;
        }
      } else if (direction === "descending") {
        if (xText < yText) {
          shouldSwitch = true;
          break;
        }
      }
    }

    if (shouldSwitch) {
      rows[shouldSwitch ? i : i + 1].parentNode.insertBefore(
        rows[i + 1],
        rows[i]
      );
      switching = true;
      count++;
    } else {
      if (count === 0 && direction === "ascending") {
        direction = "descending";
        switching = true;
      }
    }
  }
}
