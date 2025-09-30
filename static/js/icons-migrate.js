/**
 * Migrates legacy ".mask" icon elements to Bootstrap Icons <i> tags.
 * Converts known mask classes to appropriate BI classes and normalizes styling.
 */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    /** @type {Record<string, string>} */
    var map = {
      "add-mask": "bi-plus-lg",
      "edit-mask": "bi-pencil-square",
      "trash-mask": "bi-trash3",
      "download-mask": "bi-download",
      "cross-mask": "bi-x-lg",
      "record-mask": "bi-camera-video",
      "allow-mask": "bi-check2-circle",
      "on-mask": "bi-toggle-on",
      "off-mask": "bi-toggle-off",
      "refresh-mask": "bi-arrow-clockwise",
    };

    var nodes = Array.prototype.slice.call(document.querySelectorAll(".mask"));
    nodes.forEach(function (el) {
      var key = Object.keys(map).find(function (k) {
        return el.classList.contains(k);
      });
      if (!key) return;
      // Clear legacy background/mask and inject <i>
      el.style.background = "none";
      el.style.webkitMaskImage = "none";
      el.style.maskImage = "none";
      el.innerHTML = '<i class="bi ' + map[key] + '"></i>';
      el.classList.add("btn", "btn-link", "p-0", "d-inline-flex", "align-items-center");
    });
  });
})();
