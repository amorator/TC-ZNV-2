const THEME_KEY = "selectedTheme";
const themeOrder = ["light", "dark", "dark-hc"];
const themeMap = {
  light: "theme-light",
  dark: "theme-dark",
  "dark-hc": "theme-dark-hc",
};
const themeIcons = {
  light: "bi-sun",
  dark: "bi-moon-fill",
  "dark-hc": "bi-memory",
};

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var themeBtn = document.getElementById("btntheme");
    if (!themeBtn) return;
    var savedTheme = safeGet(THEME_KEY) || "light";
    applyTheme(savedTheme);
    themeBtn.addEventListener("click", function (e) {
      var idx = themeOrder.indexOf(savedTheme);
      idx = (idx + 1) % themeOrder.length;
      savedTheme = themeOrder[idx];
      applyTheme(savedTheme);
      safeSet(THEME_KEY, savedTheme);
      if (e && e.currentTarget && typeof e.currentTarget.blur === "function")
        e.currentTarget.blur();
    });
  });
  window.applyTheme = applyTheme;
})();

function applyTheme(theme) {
  var cls = themeMap[theme] || themeMap.light;
  var root = document.documentElement;
  root.classList.remove(...Object.values(themeMap));
  root.classList.add(cls);
  var iconEl = document.getElementById("btntheme");
  if (iconEl) {
    var i = iconEl.querySelector("i");
    if (!i) {
      i = document.createElement("i");
      iconEl.appendChild(i);
    }
    i.className = "bi " + (themeIcons[theme] || themeIcons.light);
    // make sure button is visible on navbar
    iconEl.style.display = "inline-flex";
  }
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {}
}
