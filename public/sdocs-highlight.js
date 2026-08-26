// Syntax highlighting adapter for the canonical SmallDocs reader.
(function () {
  'use strict';
  var S = window.SDocs;
  var core = window.SDocHighlightCore;
  if (!S || !core) return;

  var VERSION = '11.11.1';
  var BASE = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@' + VERSION;
  var coreReady = null;
  var languageLoads = {};

  function loadScript(source) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = source;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('load failed: ' + source)); };
      document.head.appendChild(script);
    });
  }

  function loadCore() {
    if (coreReady) return coreReady;
    coreReady = loadScript(BASE + '/highlight.min.js').then(function () {
      if (!window.hljs) throw new Error('hljs global missing');
      window.hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });
      return window.hljs;
    });
    return coreReady;
  }

  function ensureLanguage(hljs, language) {
    if (hljs.getLanguage(language)) return Promise.resolve(true);
    if (languageLoads[language]) return languageLoads[language];
    languageLoads[language] = loadScript(BASE + '/languages/' + encodeURIComponent(language) + '.min.js')
      .then(function () { return Boolean(hljs.getLanguage(language)); })
      .catch(function () { return false; });
    return languageLoads[language];
  }

  function applyHTML(element, source) {
    var clean = window.DOMPurify
      ? window.DOMPurify.sanitize(source, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] })
      : source;
    element.innerHTML = clean;
  }

  var renderer = core.createRenderer({
    loadCore: loadCore,
    ensureLanguage: ensureLanguage,
    applyHTML: applyHTML,
  });

  S.processHighlight = renderer.processHighlight;
})();
