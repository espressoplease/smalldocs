(function (exports) {
  'use strict';

  var RESERVED = {
    chart: 1,
    mermaid: 1,
    cells: 1,
    video: 1,
    form: 1,
    math: 1,
    slide: 1,
    slides: 1,
    'sdoc-app': 1,
  };
  var SOURCE_MAX_CHARS = 200 * 1024;
  var DOC_BLOCK_CAP = 120;

  function languageOf(codeElement) {
    var match = (codeElement.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
    return match ? match[1].toLowerCase() : '';
  }

  function createRenderer(environment) {
    var env = environment || {};
    var loadCore = env.loadCore;
    var ensureLanguage = env.ensureLanguage;
    var applyHTML = env.applyHTML;
    var isActive = typeof env.isActive === 'function' ? env.isActive : function () { return true; };
    var isNodeActive = typeof env.isNodeActive === 'function'
      ? env.isNodeActive
      : function () { return true; };

    function highlightOne(hljs, entry) {
      var codeElement = entry.element;
      if (!codeElement || codeElement.dataset.hlDone || !isActive() || !isNodeActive(codeElement)) {
        return Promise.resolve();
      }
      if (entry.source.length > SOURCE_MAX_CHARS) {
        codeElement.dataset.hlDone = '1';
        return Promise.resolve();
      }
      return Promise.resolve(ensureLanguage(hljs, entry.language)).then(function (available) {
        if (!available || !isActive() || !isNodeActive(codeElement) || codeElement.dataset.hlDone) return;
        var output;
        try {
          output = hljs.highlight(entry.source, {
            language: entry.language,
            ignoreIllegals: true,
          });
        } catch (_) {
          codeElement.dataset.hlDone = '1';
          return;
        }
        applyHTML(codeElement, output.value);
        codeElement.classList.add('hljs');
        codeElement.dataset.hlDone = '1';
      }).catch(function () {
        if (isNodeActive(codeElement)) codeElement.dataset.hlDone = '1';
      });
    }

    function processHighlight(container) {
      if (!container) return Promise.resolve();
      var nodes = container.querySelectorAll('pre code[class*="language-"]');
      if (!nodes.length) return Promise.resolve();

      var pending = [];
      for (var index = 0; index < nodes.length && pending.length < DOC_BLOCK_CAP; index += 1) {
        var codeElement = nodes[index];
        if (codeElement.dataset.hlDone) continue;
        var language = languageOf(codeElement);
        if (!language || RESERVED[language]) continue;
        pending.push({
          element: codeElement,
          language: language,
          source: codeElement.textContent || '',
        });
      }
      if (!pending.length || typeof loadCore !== 'function'
        || typeof ensureLanguage !== 'function' || typeof applyHTML !== 'function') {
        return Promise.resolve();
      }
      return Promise.resolve(loadCore()).then(function (hljs) {
        if (!hljs || !isActive()) return;
        return Promise.all(pending.map(function (entry) { return highlightOne(hljs, entry); }));
      }).catch(function () {});
    }

    return { processHighlight: processHighlight };
  }

  exports.RESERVED = RESERVED;
  exports.SOURCE_MAX_CHARS = SOURCE_MAX_CHARS;
  exports.DOC_BLOCK_CAP = DOC_BLOCK_CAP;
  exports.languageOf = languageOf;
  exports.createRenderer = createRenderer;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocHighlightCore = {}));
