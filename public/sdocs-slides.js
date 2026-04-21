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
  '  cursor: zoom-in;',
  '  position: relative;',
  '  transition: box-shadow .15s, transform .15s;',
  '}',
  '.sdoc-slide:hover { box-shadow: 0 3px 12px rgba(0,0,0,.1); }',
  '.sdoc-slide:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }',
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
  '  cursor: default;',
  '}',
  '.sdoc-slide-errbadge {',
  '  padding: 8px 10px;',
  '  font: 12px/1.45 ui-monospace, Menlo, monospace;',
  '  color: #991b1b;',
  '  background: #fef2f2;',
  '  border-top: 1px solid #fecaca;',
  '  display: flex; gap: 10px; align-items: flex-start; justify-content: space-between;',
  '}',
  '.sdoc-slide-errbadge-msg { flex: 1; }',
  '.sdoc-slide-errbadge-title { font-weight: 700; display: block; margin-bottom: 2px; }',
  '.sdoc-slide-errbadge-list { margin: 0; padding: 0 0 0 16px; }',
  '.sdoc-slide-errbadge-list li { margin: 2px 0; }',
  '.sdoc-slide-errbadge-copy {',
  '  all: unset; cursor: pointer; flex-shrink: 0;',
  '  padding: 4px 10px; border-radius: 4px;',
  '  background: #fff; border: 1px solid #fecaca; color: #991b1b;',
  '  font: 11px/1 ui-monospace, Menlo, monospace;',
  '  transition: background .12s, border-color .12s;',
  '}',
  '.sdoc-slide-errbadge-copy:hover { background: #fff5f5; border-color: #f87171; }',
  '.sdoc-slide-errbadge-copy.copied { background: #dcfce7; border-color: #86efac; color: #166534; }',
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

// Error badge carries everything an agent needs to fix the slide without
// context-hunting: formatted error list + a "Copy" button that puts the
// full diagnostic (slide index, errors, the actual DSL text) on the
// clipboard in one shot. The click on the button doesn't bubble to the
// slide wrapper so it doesn't also open present mode.
function buildErrorBadge(errors, dslText, slideIdx) {
  var badge = document.createElement('div');
  badge.className = 'sdoc-slide-errbadge';

  var msg = document.createElement('div');
  msg.className = 'sdoc-slide-errbadge-msg';
  var title = document.createElement('span');
  title.className = 'sdoc-slide-errbadge-title';
  title.textContent = errors.length + ' error' + (errors.length === 1 ? '' : 's')
    + ' in slide ' + (slideIdx + 1);
  msg.appendChild(title);
  var list = document.createElement('ul');
  list.className = 'sdoc-slide-errbadge-list';
  for (var i = 0; i < errors.length; i++) {
    var li = document.createElement('li');
    li.textContent = 'line ' + errors[i].line + ': ' + errors[i].message;
    list.appendChild(li);
  }
  msg.appendChild(list);
  badge.appendChild(msg);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sdoc-slide-errbadge-copy';
  btn.textContent = 'Copy';
  btn.setAttribute('title', 'Copy a diagnostic your agent can use to fix this slide');
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var report = buildErrorReport(errors, dslText, slideIdx);
    var done = function () {
      btn.classList.add('copied');
      btn.textContent = 'Copied';
      setTimeout(function () { btn.classList.remove('copied'); btn.textContent = 'Copy'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report).then(done).catch(function () {
        legacyCopy(report); done();
      });
    } else {
      legacyCopy(report); done();
    }
  });
  badge.appendChild(btn);

  return badge;
}

function buildErrorReport(errors, dslText, slideIdx) {
  var lines = [];
  lines.push('SDocs slide ' + (slideIdx + 1) + ' — ' + errors.length + ' error' + (errors.length === 1 ? '' : 's'));
  for (var i = 0; i < errors.length; i++) {
    lines.push('  line ' + errors[i].line + ': ' + errors[i].message);
  }
  lines.push('');
  lines.push('Slide source (fenced block):');
  lines.push('~~~slide');
  lines.push(dslText.replace(/\s+$/, ''));
  lines.push('~~~');
  return lines.join('\n');
}

function legacyCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

function processSlides(container) {
  if (!container) return;
  if (!window.SDocShapeRender || !window.SDocShapes) return;
  var blocks = container.querySelectorAll('code.language-slide');
  if (!blocks.length) return;

  var slideIdx = 0;
  for (var i = 0; i < blocks.length; i++) {
    var codeEl = blocks[i];
    var pre = codeEl.closest('pre');
    if (!pre) continue;

    var dslText = codeEl.textContent;

    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-slide';
    wrapper.setAttribute('data-dsl', dslText);
    wrapper.setAttribute('data-slide-index', String(slideIdx));
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('aria-label', 'Slide ' + (slideIdx + 1) + ' (click to present)');

    var hasError = false;
    try {
      var stage = document.createElement('div');
      wrapper.appendChild(stage);
      var result = window.SDocShapeRender.renderShapes(dslText, stage);
      if (result.errors && result.errors.length) {
        wrapper.appendChild(buildErrorBadge(result.errors, dslText, slideIdx));
      }
    } catch (e) {
      renderError(wrapper, 'slide render failed: ' + e.message);
      hasError = true;
    }

    if (!hasError) {
      (function (idx) {
        wrapper.addEventListener('click', function () {
          if (window.SDocPresent) window.SDocPresent.open(idx);
        });
        wrapper.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (window.SDocPresent) window.SDocPresent.open(idx);
          }
        });
      })(slideIdx);
    }

    var preWrapper = pre.closest('.pre-wrapper');
    var target = preWrapper || pre;
    target.parentNode.replaceChild(wrapper, target);
    slideIdx++;
  }

  // Let presentation mode re-scan slides.
  if (window.SDocPresent && window.SDocPresent.refresh) window.SDocPresent.refresh();
}

window.SDocSlides = { processSlides: processSlides };

})();
