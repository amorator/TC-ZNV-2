/** Persisted key in localStorage for selected theme */
const THEME_KEY = "selectedTheme";
/** Order of available themes for the toggle button */
const themeOrder = ["light", "dark", "dark-hc"];
/** Mapping from theme id to applied CSS class on <html> */
const themeMap = {
  light: "theme-light",
  dark: "theme-dark",
  "dark-hc": "theme-dark-hc",
};
/** Icon mapping for the navbar theme button */
const themeIcons = {
  light: "bi-sun",
  dark: "bi-moon-fill",
  "dark-hc": "bi-memory",
};

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    // Defer theme initialization to avoid blocking DOMContentLoaded
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => {
        initTheme();
      
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
              if (window.requestIdleCallback) {
                window.requestIdleCallback(() => {
                  initTheme();
                }, { timeout: 1000 });
              } else {
                initTheme();
              }
            }, 0);
    }
  });

  function initTheme() {
    var themeBtn =
      document.getElementById("theme-toggle") ||
      document.querySelector('[data-action="toggle-theme"]') ||
      document.getElementById("btntheme");
    if (!themeBtn) return;
    var savedTheme = (function () {
      // Try localStorage first
      var t = safeGet(THEME_KEY);
      if (t && themeOrder.indexOf(t) !== -1) return t;
      // Fallback to current DOM attributes
      try {
        var html = document.documentElement;
        var a =
          html.getAttribute("data-bs-theme") ||
          (document.body && document.body.getAttribute("data-theme"));
        if (a && themeOrder.indexOf(a) !== -1) return a;
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
      return "light";
    })();
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
  }
  // Expose for programmatic theme changes
  window.applyTheme = applyTheme;
})();

/**
 * Apply theme by id: toggles class on <html> and updates the theme icon.
 * Also notifies same-origin iframes via postMessage for embedded UIs.
 * @param {"light"|"dark"|"dark-hc"} theme Theme identifier
 */
function applyTheme(theme) {
  var cls = themeMap[theme] || themeMap.light;
  var root = document.documentElement;
  root.classList.remove(...Object.values(themeMap));
  root.classList.add(cls);
  // Also set semantic attributes for frameworks/tests and embedded UIs
  try {
    root.setAttribute("data-bs-theme", theme);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
  try {
    if (document.body) document.body.setAttribute("data-theme", theme);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
  try {
    // Notify same-origin iframes about theme change
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentWindow) {
          frames[i].contentWindow.postMessage(
            { type: "theme:changed", className: cls },
            "*"
          );
        }
      } catch (err) {
        window.ErrorHandler.handleError(err, "unknown");
      }
    }
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
  var iconEl =
    document.getElementById("theme-toggle") ||
    document.querySelector('[data-action="toggle-theme"]') ||
    document.getElementById("btntheme");
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

/**
 * Safe localStorage getter (guards against privacy/storage errors).
 * @param {string} key
 * @returns {string|null}
 */
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

/**
 * Safe localStorage setter (guards against privacy/storage errors).
 * @param {string} key
 * @param {string} val
 */
function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (err) {
    window.ErrorHandler.handleError(err, "unknown");
  }
}
