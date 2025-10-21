/**
 * Модуль управления tooltips для таблиц
 * Обеспечивает автоматическое добавление tooltips для обрезанного текста
 *
 * @namespace TooltipsModule
 */

/**
 * Применяет tooltips для обрезанных ячеек таблиц
 * @param {Element} [scope] - Область поиска (по умолчанию document)
 * @memberof TooltipsModule
 */
function applyOverflowTooltips(scope) {
  const root = scope || document;
  const tables = root.querySelectorAll("table");

  for (let i = 0; i < tables.length; i++) {
    const tbodies = tables[i].tBodies;
    if (!tbodies || tbodies.length === 0) continue;

    const cells = tables[i].querySelectorAll("tbody td");
    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];
      if (cell.hasAttribute("data-tooltip-ignore")) continue;

      const text = (
        cell.getAttribute("data-title") ||
        cell.textContent ||
        ""
      ).trim();

      const needsTooltip = cell.scrollWidth > cell.clientWidth;

      if (needsTooltip && text) {
        cell.setAttribute("title", text);
      } else if (cell.hasAttribute("title")) {
        cell.removeAttribute("title");
      }
    }
  }
}

// Инициализация при загрузке DOM
document.addEventListener("DOMContentLoaded", function () {
  applyOverflowTooltips(document);
});

// Обновление при изменении размера окна
window.addEventListener("resize", function () {
  applyOverflowTooltips(document);
});

// Экспорт в глобальную область для обратной совместимости
window.applyOverflowTooltips = applyOverflowTooltips;
