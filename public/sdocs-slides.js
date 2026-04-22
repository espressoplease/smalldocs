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
  /* Border derives from the doc\'s text color so it contrasts whatever */
  /* the page background is. 14% opacity stays subtle in both themes. */
  '  border: 1px solid color-mix(in srgb, var(--md-color, #000) 14%, transparent);',
  '  border-radius: 6px;',
  '  overflow: hidden;',
  '  box-shadow: 0 1px 3px rgba(0,0,0,.05);',
  '  position: relative;',
  '  transition: box-shadow .15s, border-color .15s, transform .15s;',
  '}',
  /* On hover, the border lifts to 28% so the indicator works on both */
  /* themes (shadow intensification alone is invisible on dark bgs). */
  '.sdoc-slide:hover {',
  '  box-shadow: 0 3px 12px rgba(0,0,0,.1);',
  '  border-color: color-mix(in srgb, var(--md-color, #000) 28%, transparent);',
  '}',
  /* Present button: small top-right overlay, mirrors the copy button */
  /* pattern on code blocks. Always visible so users don\'t have to */
  /* hover-probe to discover it. Colors derive from the slide\'s own */
  /* --md-bg and --md-color via color-mix, so the button tints with */
  /* the doc theme (cream on a cream doc, dark on a dark-mode doc) */
  /* without any per-slide work. Fallbacks keep it legible if someone */
  /* embeds the shape renderer outside an SDocs document. */
  '.sdoc-slide-present {',
  '  position: absolute; top: 8px; right: 8px; z-index: 5;',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  width: 28px; height: 28px;',
  '  background: color-mix(in srgb, var(--md-bg, #fff) 88%, transparent);',
  '  border: 1px solid color-mix(in srgb, var(--md-color, #000) 14%, transparent);',
  '  border-radius: 4px; padding: 0;',
  '  color: color-mix(in srgb, var(--md-color, #0f172a) 65%, transparent);',
  '  cursor: pointer;',
  '  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);',
  '  transition: background .12s, border-color .12s, color .12s;',
  '}',
  '.sdoc-slide-present:hover {',
  '  background: var(--md-bg, #fff);',
  '  border-color: color-mix(in srgb, var(--md-color, #000) 28%, transparent);',
  '  color: var(--md-color, #0f172a);',
  '}',
  '.sdoc-slide-present:focus-visible { outline: 2px solid var(--accent, #2563eb); outline-offset: 1px; }',
  '.sdoc-slide-present svg { display: block; }',
  '.sdoc-slide .sd-shape-stage {',
  '  width: 100%;',
  /* Inherit the doc\'s page background so slides feel visually connected to */
  /* the surrounding text. The DSL `grid ... bg=...` attribute wins when set. */
  '  background: var(--md-bg, #ffffff);',
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

// Lucide "presentation" icon — a monitor with a small chart glyph.
// Matches lucide.dev/icons/presentation. Inline SVG avoids shipping an
// icon set; the geometry stays stable and can be recolored via currentColor.
var PRESENT_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/>'
  + '<path d="m7 21 5-5 5 5"/></svg>';

function buildPresentButton(slideIdx) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sdoc-slide-present';
  btn.setAttribute('aria-label', 'Open slide ' + (slideIdx + 1) + ' in presentation mode');
  btn.title = 'Present (Enter)';
  btn.innerHTML = PRESENT_ICON_SVG;
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (window.SDocPresent) window.SDocPresent.open(slideIdx);
  });
  return btn;
}

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

  // Resolve templates in a single batch. The resolver is pure: it takes
  // the raw DSL text of every slide block (in document order) and returns
  // the DSL to actually render, plus a skip flag for @template slides.
  // We do it before any DOM mutation so templates never produce a flash
  // of placeholder content, and consumers always see the expanded DSL.
  var rawDsls = [];
  for (var b = 0; b < blocks.length; b++) rawDsls.push(blocks[b].textContent);
  var resolved = window.SDocSlideResolve
    ? window.SDocSlideResolve.resolveSlides(rawDsls, window.SDocShapes)
    : rawDsls.map(function (d) { return { dsl: d, skip: false, errors: [] }; });

  var slideIdx = 0;
  for (var i = 0; i < blocks.length; i++) {
    var codeEl = blocks[i];
    var pre = codeEl.closest('pre');
    if (!pre) continue;

    var entry = resolved[i];
    var preWrapper = pre.closest('.pre-wrapper');
    var target = preWrapper || pre;

    // Template slides register but never render — strip the element so the
    // author sees nothing in its place and it's not counted in slideIdx.
    if (entry.skip) {
      target.parentNode.removeChild(target);
      continue;
    }

    var dslText = entry.dsl;
    var rawText = codeEl.textContent;

    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-slide';
    wrapper.setAttribute('data-dsl', dslText);
    wrapper.setAttribute('data-slide-index', String(slideIdx));

    var hasError = false;
    try {
      // Nested slide-wrap so the aspect-ratio-locked slide doesn't overlap
      // the (optional) error badge below it in the sdoc-slide flow.
      var slideWrap = document.createElement('div');
      wrapper.appendChild(slideWrap);
      var result = window.SDocShapeRender.renderShapes(dslText, slideWrap);
      var allErrors = (entry.errors || []).concat(result.errors || []);
      if (allErrors.length) {
        // Error badge shows the author's original source (with directives),
        // not the post-merge DSL — that's what they edit to fix the problem.
        wrapper.appendChild(buildErrorBadge(allErrors, rawText, slideIdx));
      }
    } catch (e) {
      renderError(wrapper, 'slide render failed: ' + e.message);
      hasError = true;
    }

    // Per-slide presentation button. Sits top-right as a small icon,
    // mirroring the code-block copy button. The slide itself is no
    // longer clickable — that frees text inside shapes to be selected,
    // copied, and (for agents) scraped out of the DOM.
    if (!hasError) {
      wrapper.appendChild(buildPresentButton(slideIdx));
    }

    target.parentNode.replaceChild(wrapper, target);
    slideIdx++;
  }

  // Let presentation mode re-scan slides.
  if (window.SDocPresent && window.SDocPresent.refresh) window.SDocPresent.refresh();
}

window.SDocSlides = { processSlides: processSlides };

})();
