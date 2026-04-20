// sdocs-present.js — fullscreen slide presentation mode.
//
// Public API:
//   SDocPresent.open(index = 0)      open at slide N
//   SDocPresent.close()              exit and restore scroll
//   SDocPresent.go(direction | N)    +1, -1, or absolute index
//   SDocPresent.refresh()            re-read .sdoc-slide DSLs after a render
//
// Reads every .sdoc-slide[data-dsl] in the document. Populates a thumbnail
// rail on the left and renders the active slide at full size. Syncs the URL
// hash with a present=<idx> parameter so links like /#md=...&present=2 open
// directly to that slide.

(function () {
'use strict';

var CSS_ID = 'sdocs-present-css';
var CSS = [
  '.sdoc-present {',
  '  position: fixed; inset: 0; z-index: 10000;',
  '  background: #0b0a09; color: #e7e5e2;',
  '  display: grid; grid-template-columns: 160px 1fr;',
  '  font-family: ui-sans-serif, system-ui, sans-serif;',
  '  animation: sdoc-present-fade .15s ease-out;',
  '}',
  '@keyframes sdoc-present-fade { from { opacity: 0 } to { opacity: 1 } }',
  '.sdoc-present-rail {',
  '  background: #131210; border-right: 1px solid #2a2724;',
  '  padding: 12px 10px; overflow-y: auto;',
  '  display: flex; flex-direction: column; gap: 10px;',
  '}',
  '.sdoc-present-thumb {',
  '  all: unset; display: block; cursor: pointer;',
  '  background: #1a1816; border: 2px solid transparent; border-radius: 4px;',
  '  padding: 4px; transition: border-color .12s;',
  '}',
  '.sdoc-present-thumb:hover { border-color: #3f3c38; }',
  '.sdoc-present-thumb.active { border-color: #f59e0b; }',
  '.sdoc-present-thumb-num {',
  '  font-size: 10px; color: #8a8580; margin: 2px 0 4px;',
  '  font-family: ui-monospace, Menlo, monospace;',
  '}',
  '.sdoc-present-thumb .sd-shape-stage {',
  '  width: 100%; background: #ffffff; border-radius: 2px;',
  '}',
  '.sdoc-present-stage-wrap {',
  '  display: flex; align-items: center; justify-content: center;',
  '  padding: 32px; overflow: hidden; position: relative;',
  '}',
  '.sdoc-present-stage {',
  '  /* --gw, --gh set by renderer */',
  '  max-width: 100%;',
  '  max-height: 100%;',
  '  width: auto; height: auto;',
  '  background: #ffffff; border-radius: 6px;',
  '  box-shadow: 0 30px 80px rgba(0, 0, 0, .6);',
  '}',
  '.sdoc-present-controls {',
  '  position: absolute; bottom: 14px; right: 20px;',
  '  display: flex; align-items: center; gap: 12px;',
  '  font-family: ui-monospace, Menlo, monospace; font-size: 12px;',
  '}',
  '.sdoc-present-counter { color: #8a8580; }',
  '.sdoc-present-close {',
  '  all: unset; cursor: pointer; padding: 4px 10px;',
  '  color: #d6d3d1; font-size: 12px; border-radius: 4px;',
  '  background: rgba(255, 255, 255, .06);',
  '  font-family: ui-monospace, Menlo, monospace;',
  '}',
  '.sdoc-present-close:hover { background: rgba(255, 255, 255, .12); }',
  '@media (max-width: 720px) {',
  '  .sdoc-present { grid-template-columns: 1fr; }',
  '  .sdoc-present-rail { display: none; }',
  '}',
  'body.sdoc-present-open { overflow: hidden; }',
].join('\n');

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  var style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
if (typeof document !== 'undefined') injectCSS();

var state = {
  open: false,
  index: 0,
  slides: [],            // array of DSL strings
  modal: null,
  stage: null,
  counter: null,
  savedScrollY: 0,
  savedActive: null,
  sizer: null,           // bound resize handler
};

function collectSlides() {
  var els = document.querySelectorAll('.sdoc-slide[data-dsl]');
  state.slides = [];
  for (var i = 0; i < els.length; i++) state.slides.push(els[i].getAttribute('data-dsl'));
}

function clamp(n) {
  if (state.slides.length === 0) return 0;
  if (n < 0) return 0;
  if (n >= state.slides.length) return state.slides.length - 1;
  return n;
}

function buildRailThumb(idx, dsl) {
  var btn = document.createElement('button');
  btn.className = 'sdoc-present-thumb';
  btn.setAttribute('data-slide-index', String(idx));
  btn.setAttribute('aria-label', 'Go to slide ' + (idx + 1));
  var num = document.createElement('div');
  num.className = 'sdoc-present-thumb-num';
  num.textContent = String(idx + 1);
  btn.appendChild(num);
  var stage = document.createElement('div');
  btn.appendChild(stage);
  // Rail thumbnails are ~140px wide, so the usual 8px font-size floor leaves
  // longer text spilling out of small shapes. Drop it to 2px — unreadable
  // but contained, which is what a navigation thumbnail wants.
  window.SDocShapeRender.renderShapes(dsl, stage, { minFontPx: 2 });
  btn.addEventListener('click', function () { go(idx); });
  return btn;
}

// Pick a px width for the stage that preserves aspect ratio AND fits the
// available stage-wrap area. CSS aspect-ratio can go wrong under grid when
// both max-width and max-height constrain, so we compute here.
function sizeStage() {
  if (!state.stage) return;
  var wrap = state.stage.parentElement;
  if (!wrap) return;
  var gw = parseFloat(getComputedStyle(state.stage).getPropertyValue('--gw')) || 16;
  var gh = parseFloat(getComputedStyle(state.stage).getPropertyValue('--gh')) || 9;
  var availW = wrap.clientWidth - 64;   // padding 32 × 2
  var availH = wrap.clientHeight - 64;
  if (availW <= 0 || availH <= 0) return;
  var byWidth = { w: availW, h: availW * gh / gw };
  var byHeight = { w: availH * gw / gh, h: availH };
  var pick = byWidth.h <= availH ? byWidth : byHeight;
  state.stage.style.width = pick.w + 'px';
  state.stage.style.height = pick.h + 'px';
}

function renderActive() {
  if (!state.stage) return;

  // Re-render from DSL (cloneNode(true) doesn't copy shadow roots, so we
  // can't just clone the inline stage). After renderShapes has done its own
  // autofit pass, copy the inline thumbnail's cqh font-sizes onto the
  // present-mode rects. cqh is % of the .sd-shape-stage's height, so the
  // values resolve proportionally at the larger fullscreen size — same
  // visual ratios, no autofit-drift between contexts.
  var dsl = state.slides[state.index] || '';
  window.SDocShapeRender.renderShapes(dsl, state.stage);
  state.stage.classList.add('sdoc-present-stage');
  sizeStage();

  var inlineSlides = document.querySelectorAll('.sdoc-slide[data-dsl]');
  var inline = inlineSlides[state.index];
  if (inline) {
    var inlineRects = inline.querySelectorAll('.shape-rect, .shape-text');
    // Wait two frames — renderShapes queues its own rAF for autofit, so our
    // override runs strictly after it.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!state.stage) return;
        var presentRects = state.stage.querySelectorAll('.shape-rect, .shape-text');
        var n = Math.min(inlineRects.length, presentRects.length);
        for (var i = 0; i < n; i++) {
          var fs = inlineRects[i].style.fontSize;
          if (fs) presentRects[i].style.fontSize = fs;
        }
      });
    });
  }

  // Rail selection
  if (state.modal) {
    var thumbs = state.modal.querySelectorAll('.sdoc-present-thumb');
    for (var i = 0; i < thumbs.length; i++) {
      thumbs[i].classList.toggle('active', i === state.index);
    }
    var active = state.modal.querySelector('.sdoc-present-thumb.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (state.counter) {
    state.counter.textContent = (state.index + 1) + ' / ' + state.slides.length;
  }
}

function onKey(e) {
  if (!state.open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    go(state.index + 1);
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    go(state.index - 1);
    return;
  }
  if (e.key === 'Home') { e.preventDefault(); go(0); return; }
  if (e.key === 'End')  { e.preventDefault(); go(state.slides.length - 1); return; }
}

function updateHashPresent(idx) {
  // Preserve existing hash params other than present=.
  var hash = window.location.hash.replace(/^#/, '');
  var parts = hash ? hash.split('&') : [];
  var next = [];
  var replaced = false;
  for (var i = 0; i < parts.length; i++) {
    if (/^present=/.test(parts[i])) {
      if (idx != null) { next.push('present=' + idx); replaced = true; }
    } else {
      next.push(parts[i]);
    }
  }
  if (idx != null && !replaced) next.push('present=' + idx);
  var newHash = next.join('&');
  var target = newHash ? '#' + newHash : window.location.pathname + window.location.search;
  // Use replaceState so we don't flood history with every slide advance.
  history.replaceState(null, '', target);
}

function open(startIndex) {
  collectSlides();
  if (state.slides.length === 0) return;
  if (state.open) {
    // Already open — just update index.
    go(startIndex || 0);
    return;
  }
  state.savedScrollY = window.scrollY;
  state.savedActive = document.activeElement;
  state.index = clamp(startIndex || 0);

  var modal = document.createElement('div');
  modal.className = 'sdoc-present';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Slide presentation');

  var rail = document.createElement('aside');
  rail.className = 'sdoc-present-rail';
  for (var i = 0; i < state.slides.length; i++) {
    rail.appendChild(buildRailThumb(i, state.slides[i]));
  }
  modal.appendChild(rail);

  var wrap = document.createElement('div');
  wrap.className = 'sdoc-present-stage-wrap';

  var stage = document.createElement('div');
  wrap.appendChild(stage);

  var controls = document.createElement('div');
  controls.className = 'sdoc-present-controls';

  var counter = document.createElement('div');
  counter.className = 'sdoc-present-counter';
  controls.appendChild(counter);

  var close = document.createElement('button');
  close.className = 'sdoc-present-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Exit presentation (Esc)');
  close.textContent = 'Close ×';
  close.addEventListener('click', function () { closePresent(); });
  controls.appendChild(close);

  wrap.appendChild(controls);

  modal.appendChild(wrap);
  document.body.appendChild(modal);
  document.body.classList.add('sdoc-present-open');

  state.modal = modal;
  state.stage = stage;
  state.counter = counter;
  state.open = true;

  state.sizer = function () { sizeStage(); };
  window.addEventListener('resize', state.sizer);
  window.addEventListener('keydown', onKey);

  renderActive();
  updateHashPresent(state.index);

  // Focus the stage so keyboard events land on the document body.
  modal.tabIndex = -1;
  setTimeout(function () { modal.focus(); }, 0);
}

function closePresent() { close(); }

function close() {
  if (!state.open) return;
  window.removeEventListener('keydown', onKey);
  if (state.sizer) window.removeEventListener('resize', state.sizer);
  state.sizer = null;
  if (state.modal && state.modal.parentNode) state.modal.parentNode.removeChild(state.modal);
  state.modal = null;
  state.stage = null;
  state.counter = null;
  state.open = false;
  document.body.classList.remove('sdoc-present-open');
  updateHashPresent(null);
  window.scrollTo(0, state.savedScrollY);
  if (state.savedActive && typeof state.savedActive.focus === 'function') {
    try { state.savedActive.focus(); } catch (_) {}
  }
  state.savedActive = null;
}

function go(n) {
  var idx;
  if (typeof n === 'number') idx = clamp(n);
  else idx = state.index;
  if (idx === state.index && state.open) return;
  state.index = idx;
  if (state.open) {
    renderActive();
    updateHashPresent(idx);
  }
}

function refresh() {
  collectSlides();
  if (state.open) renderActive();
}

function readPresentFromHash() {
  var hash = window.location.hash.replace(/^#/, '');
  var parts = hash.split('&');
  for (var i = 0; i < parts.length; i++) {
    var m = parts[i].match(/^present=(\d+)$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function maybeOpenFromHash() {
  var idx = readPresentFromHash();
  if (idx == null) {
    if (state.open) close();
    return;
  }
  // Wait for slides to be collected (they're created during render).
  var waitUntil = Date.now() + 2000;
  function tryOpen() {
    collectSlides();
    if (state.slides.length > 0) {
      if (state.open) go(idx);
      else open(idx);
    } else if (Date.now() < waitUntil) {
      setTimeout(tryOpen, 80);
    }
  }
  tryOpen();
}

window.addEventListener('hashchange', function () {
  var idx = readPresentFromHash();
  if (idx == null) {
    if (state.open) close();
  } else if (!state.open) {
    maybeOpenFromHash();
  } else {
    go(idx);
  }
});

// If the page loaded with present=N in the hash, attempt to open once the
// document has finished rendering.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { maybeOpenFromHash(); });
  } else {
    setTimeout(maybeOpenFromHash, 100);
  }
}

window.SDocPresent = {
  open: open,
  close: close,
  go: go,
  refresh: refresh,
};

})();
