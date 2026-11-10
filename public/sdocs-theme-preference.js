// Shared viewer preference for document, library and settings pages.
// Load before stylesheets. View-only overrides do not replace the saved choice.
(function (exports) {
  'use strict';
  exports.sun = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  exports.moon = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  exports.buttonMarkup = '<button class="workspace-button library-theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true" data-theme-moon>' + exports.moon + '</svg>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true" data-theme-sun>' + exports.sun + '</svg></button>';
  if (typeof window === 'undefined') return;
  var key = 'sdocs-theme', memory = null, storageUnavailable = false, listeners = [];
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function saved() {
    if (storageUnavailable) return memory;
    try { var value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : null; }
    catch (_) { storageUnavailable = true; return memory; }
  }
  function preferred() { return saved() || (media.matches ? 'dark' : 'light'); }
  var lastPreference = preferred();
  function apply(theme, persist) {
    if (theme !== 'light' && theme !== 'dark') return;
    if (persist) {
      memory = theme;
      lastPreference = theme;
      try { localStorage.setItem(key, theme); } catch (_) { storageUnavailable = true; }
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    listeners.slice().forEach(function (listener) { listener(theme); });
  }
  function sync() {
    var theme = preferred();
    if (theme === lastPreference) return;
    lastPreference = theme; apply(theme, false);
  }
  function subscribe(listener) { listeners.push(listener); }
  function bindButton(button) {
    if (!button || button.dataset.themeBound) return;
    button.dataset.themeBound = 'true';
    function update(theme) {
      var label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.title = label; button.setAttribute('aria-label', label);
    }
    button.addEventListener('click', function () {
      apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
    subscribe(update); update(document.documentElement.dataset.theme);
  }
  exports.preferred = preferred; exports.apply = apply;
  exports.subscribe = subscribe; exports.bindButton = bindButton;
  window.addEventListener('storage', function (event) { if (event.key === key || event.key === null) sync(); });
  window.addEventListener('pageshow', sync);
  window.addEventListener('focus', sync);
  media.addEventListener('change', function () { if (!saved()) sync(); });
  apply(lastPreference, false);
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsThemePreference = {}));
