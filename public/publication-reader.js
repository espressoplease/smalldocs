/* Progressive public reading features. No account, document fetch, or app bootstrap. */
(function () {
  'use strict';
  var article = document.getElementById('_sd_rendered');
  if (!article) return;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');
  var themeButton = document.querySelector('.publication-theme');
  var charts;
  var diagrams;
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (themeButton) themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  applyTheme(dark.matches ? 'dark' : 'light');
  if (themeButton) {
    themeButton.hidden = false;
    themeButton.addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      if (charts) charts.refreshChartColors();
      if (diagrams) diagrams.rethemeMermaid();
    });
  }

  function keepSource(figure, source, label) {
    if (figure.querySelector('.publication-rich-stage pre')) return;
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = label;
    details.appendChild(summary);
    details.appendChild(source);
    figure.appendChild(details);
  }

  var chartFigures = Array.prototype.slice.call(article.querySelectorAll('[data-publication-feature="chart"]'));
  if (chartFigures.length && window.SDocCharts && window.SDocStyles) {
    charts = window.SDocCharts.create({
      window: window, document: document, root: article, styleRoot: article,
      styles: window.SDocStyles, controls: { copy: false, download: false }, blockCap: 50,
    });
    var sources = chartFigures.map(function (figure) { return figure.querySelector('pre').cloneNode(true); });
    // The native renderer's existing per-document cap bounds chart work.
    charts.processCharts(article).then(function () {
      chartFigures.forEach(function (figure, i) {
        var canvas = figure.querySelector('canvas');
        if (canvas) {
          canvas.setAttribute('role', 'img');
          var caption = figure.querySelector('caption');
          canvas.setAttribute('aria-label', caption ? caption.textContent : 'Chart');
        }
        keepSource(figure, sources[i], 'Chart source');
      });
    }).catch(function () {});
  }

  var diagramFigures = Array.prototype.slice.call(article.querySelectorAll('[data-publication-feature="mermaid"]'));
  if (diagramFigures.length && window.SDocMermaidCore && window.DOMPurify) {
    diagrams = window.SDocMermaidCore.create({
      window: window, document: document, root: article, scope: article,
      // Public diagrams use SVG text labels. Generated SVG lives in a shadow
      // root so its theme CSS cannot affect the surrounding article.
      loadMermaid: function () {
        return new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
          script.onload = function () {
            var mermaid = window.mermaid;
            resolve({
              initialize: function (config) {
                config.securityLevel = 'strict';
                config.flowchart.htmlLabels = false;
                config.sequence.htmlLabels = false;
                config.themeCSS = '';
                mermaid.initialize(config);
              },
              render: mermaid.render.bind(mermaid),
            });
          };
          script.onerror = reject;
          document.head.appendChild(script);
        });
      },
      setSvgHTML: function (stage, source) {
        var root = stage.shadowRoot || stage.attachShadow({ mode: 'open' });
        root.innerHTML = window.DOMPurify.sanitize(source, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'object', 'embed', 'use', 'a', 'image', 'animate', 'set'],
          FORBID_ATTR: ['href', 'xlink:href'],
        });
        var css = document.createElement('style');
        css.textContent = 'svg{max-width:100%;height:auto;display:block;margin:auto}';
        root.appendChild(css);
      },
    });
    var diagramSources = diagramFigures.map(function (figure) { return figure.querySelector('pre').cloneNode(true); });
    diagrams.processMermaid(article).then(function () {
      diagramFigures.forEach(function (figure, i) { keepSource(figure, diagramSources[i], 'Diagram source'); });
    }).catch(function () {});
  }
})();
