(function () {
  document.addEventListener("DOMContentLoaded", function () {
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
      // find key class
      var key = Object.keys(map).find(function (k) {
        return el.classList.contains(k);
      });
      if (!key) return;
      // clear legacy background/img usage
      el.style.background = "none";
      el.style.webkitMaskImage = "none";
      el.style.maskImage = "none";
      el.innerHTML = '<i class="bi ' + map[key] + '"></i>';
      el.classList.add(
        "btn",
        "btn-link",
        "p-0",
        "d-inline-flex",
        "align-items-center"
      );
    });
  });
})();
