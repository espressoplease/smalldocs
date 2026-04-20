// sdocs-slides.js — render ```slide fenced blocks as inline thumbnails.
// Mirrors the processCharts pattern in sdocs-charts.js: walks the rendered
// markdown DOM, finds code.language-slide blocks, and replaces each with a
// thumbnail containing a fully-rendered shape canvas.
//
// Clicking a thumbnail is a Phase 6 concern (presentation mode) — for now
// the thumbnail is visual only.

(function () {
'use strict';

// One-shot CSS injection so the thumbnail container looks consistent in any
// host page without needing a separate stylesheet wiring step.
var CSS_ID = 'sdocs-slides-css';
var CSS = [
  '.sdoc-slide {',
  '  display: block;',
  '  margin: 1.2em 0;',
  '  max-width: 100%;',
  '  background: var(--md-code-bg, #f6f5f2);',
  '  border: 1px solid var(--md-block-border, rgba(0,0,0,.08));',
  '  border-radius: 6px;',
  '  overflow: hidden;',
  '  box-shadow: 0 1px 3px rgba(0,0,0,.05);',
  '}',
  '.sdoc-slide .sd-shape-stage {',
  '  width: 100%;',
  '  background: #ffffff;',
  '  display: block;',
  '}',
  '.sdoc-slide.sdoc-slide-error {',
  '  padding: 12px 16px;',
  '  color: #b91c1c;',
  '  font-family: ui-monospace, Menlo, monospace;',
  '  font-size: 12px;',
  '  white-space: pre-wrap;',
  '}',
].join('\n');

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  var style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
if (typeof document !== 'undefined') injectCSS();

function renderError(wrapper, message) {
  wrapper.classList.add('sdoc-slide-error');
  wrapper.textContent = message;
}

function processSlides(container) {
  if (!container) return;
  if (!window.SDocShapeRender || !window.SDocShapes) return;
  var blocks = container.querySelectorAll('code.language-slide');
  if (!blocks.length) return;

  for (var i = 0; i < blocks.length; i++) {
    var codeEl = blocks[i];
    var pre = codeEl.closest('pre');
    if (!pre) continue;

    var dslText = codeEl.textContent;

    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-slide';

    try {
      var stage = document.createElement('div');
      wrapper.appendChild(stage);
      var result = window.SDocShapeRender.renderShapes(dslText, stage);
      if (result.errors && result.errors.length) {
        // Keep the rendered shapes but surface the error count for now.
        var errBadge = document.createElement('div');
        errBadge.style.cssText = 'padding:6px 10px;font:11px/1.3 ui-monospace,monospace;color:#b91c1c;background:#fef2f2;border-top:1px solid #fecaca;';
        errBadge.textContent = result.errors.length + ' error'
          + (result.errors.length === 1 ? '' : 's')
          + ': ' + result.errors.map(function (e) { return 'line ' + e.line + ' — ' + e.message; }).join('; ');
        wrapper.appendChild(errBadge);
      }
    } catch (e) {
      renderError(wrapper, 'slide render failed: ' + e.message);
    }

    var preWrapper = pre.closest('.pre-wrapper');
    var target = preWrapper || pre;
    target.parentNode.replaceChild(wrapper, target);
  }
}

window.SDocSlides = { processSlides: processSlides };

})();
