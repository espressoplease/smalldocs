// sdocs-mermaid-focus.js - Fullscreen pan/zoom modal for Mermaid diagrams.
//
// Each rendered .sdoc-mermaid wrapper carries a small top-right icon button
// (added by sdocs-mermaid.js after render). Clicking the button clones the
// already-rendered SVG into a centered stage with:
//   - drag to pan
//   - wheel to zoom toward cursor
//   - + / - / 0 keys for zoom; arrows for pan; ESC to close
//   - Fit / 100% / Reset buttons in the topbar
//
// Modal chrome is modelled on sdocs-present.js (the slides-framework branch)
// but stripped down for a single-stage diagram view. When both this and the
// slide modal land on main, the duplicated chrome is the trigger to extract
// a shared sdocs-focus.js - not before.
(function () {
  'use strict';
  var S = window.SDocs;

  var CSS_ID = 'sdocs-mermaid-focus-css';
  var CSS = [
    '.sdoc-mermaid-zoom-btn {',
    '  position: absolute; top: 6px; right: 6px;',
    '  width: 26px; height: 26px;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    /* Match the code-block copy-btn / chart-menu-btn pattern: background = */
    /* surrounding block bg so the button blends, with a subtle border. */
    '  background: var(--md-block-bg, #f4f1ed);',
    '  color: var(--md-color, #1c1917);',
    '  border: 1px solid var(--md-copy-btn-border, rgba(0,0,0,0.12));',
    '  border-radius: 4px;',
    '  cursor: pointer; opacity: 0.7; transition: opacity .15s, background .12s;',
    '  z-index: 2;',
    '}',
    '.sdoc-mermaid-zoom-btn:focus,',
    '.sdoc-mermaid-zoom-btn:hover { opacity: 1; }',
    '.sdoc-mermaid-zoom-btn:hover {',
    '  background: var(--md-copy-btn-hover, rgba(0,0,0,0.05));',
    '}',
    /* Focus modal inherits the block colour cascade from the page so it */
    /* feels like a magnified version of the diagram, not a separate */
    /* (presentation-style) hard-dark surface. The bg / fg vars are set */
    /* per-instance in JS to whichever block colours are currently in */
    /* effect, then read here. The topbar tints slightly darker than the */
    /* stage via color-mix to give a subtle separation. */
    '.sdoc-mermaid-focus {',
    '  position: fixed; inset: 0; z-index: 10000;',
    '  background: var(--sdoc-focus-bg, #f4f1ed);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  display: grid; grid-template-rows: 40px 1fr;',
    '  font-family: ui-sans-serif, system-ui, sans-serif;',
    '  animation: sdoc-mermaid-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-mermaid-fade { from { opacity: 0 } to { opacity: 1 } }',
    '.sdoc-mermaid-focus-topbar {',
    '  display: flex; align-items: center; gap: 6px;',
    '  height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-mermaid-focus-brand {',
    '  display: inline-flex; align-items: center;',
    '  color: #3B82F6; font-size: 13px; font-weight: 600;',
    '  margin-right: auto;',
    '}',
    '.sdoc-mermaid-focus-brand-suf {',
    '  color: var(--sdoc-focus-fg, #1c1917); font-weight: 400; margin-left: 4px;',
    '}',
    '.sdoc-mermaid-focus-actions { display: flex; gap: 2px; align-items: center; }',
    '.sdoc-mermaid-focus-sep {',
    '  width: 1px; height: 16px; margin: 0 4px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '}',
    '.sdoc-mermaid-focus-btn {',
    '  all: unset; cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  padding: 6px 10px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  font-size: 12px; font-family: inherit;',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-mermaid-focus-btn:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-mermaid-focus-btn:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    '.sdoc-mermaid-focus-zoom {',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 55%, transparent);',
    '  font-size: 12px; padding: 0 8px;',
    '  font-family: ui-monospace, Menlo, monospace;',
    '  align-self: center;',
    '}',
    '.sdoc-mermaid-focus-stage {',
    '  position: relative; overflow: hidden;',
    '  display: flex; align-items: center; justify-content: center;',
    '  cursor: grab;',
    '  touch-action: none;',  // we own pan/zoom
    '}',
    '.sdoc-mermaid-focus-stage.is-dragging { cursor: grabbing; }',
    '.sdoc-mermaid-focus-svg-wrap {',
    '  transform-origin: 50% 50%;',
    '  will-change: transform;',
    '}',
    '.sdoc-mermaid-focus-svg-wrap svg {',
    '  display: block; max-width: none; height: auto;',
    '}',
    'body.sdoc-mermaid-focus-open { overflow: hidden; }'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  if (typeof document !== 'undefined') injectCSS();

  // Lucide "expand" icon - matches lucide.dev/icons/maximize-2.
  var EXPAND_ICON_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>'
    + '<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  function buildZoomButton(wrapper) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sdoc-mermaid-zoom-btn';
    btn.setAttribute('aria-label', 'Open diagram in fullscreen');
    btn.title = 'Fullscreen (zoom & pan)';
    btn.innerHTML = EXPAND_ICON_SVG;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      open(wrapper);
    });
    return btn;
  }

  // ── State ─────────────────────────────────────────────
  var modal = null;
  var stageEl = null;
  var svgWrap = null;
  var zoomLabel = null;
  var prevFocus = null;
  var keyHandler = null;

  var tx = 0, ty = 0, scale = 1;
  var isDragging = false;
  var dragStart = null; // { x, y, tx, ty }

  function applyTransform() {
    if (svgWrap) svgWrap.style.transform =
      'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  // Read the SVG's actual rendered dimensions (in CSS pixels), not its
  // viewBox numbers. viewBox is a logical coordinate space - using it for
  // fit/center math leaves the diagram offset for any SVG whose pixel
  // width/height differ from its viewBox.
  function svgPixelSize() {
    if (!svgWrap) return null;
    var svg = svgWrap.querySelector('svg');
    if (!svg) return null;
    // Reset transform momentarily so getBoundingClientRect returns the
    // unscaled natural size, otherwise we'd feed scaled values back into
    // the next computation and drift.
    var prev = svgWrap.style.transform;
    svgWrap.style.transform = 'none';
    var rect = svg.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    svgWrap.style.transform = prev;
    return { w: w, h: h };
  }

  // The stage flex-centers the wrap at scale 1, so (tx, ty, scale) = (0, 0, 1)
  // is "natural centered". Fit math therefore only needs to set a scale - no
  // translate needed - and zoom-in/out pivots around the wrap's geometric
  // centre, not the wrap's top-left.
  function fit() {
    if (!stageEl || !svgWrap) return;
    var size = svgPixelSize();
    if (!size || !size.w || !size.h) {
      scale = 1; tx = 0; ty = 0; applyTransform(); return;
    }
    var stb = stageEl.getBoundingClientRect();
    var s = Math.min(stb.width * 0.9 / size.w, stb.height * 0.9 / size.h);
    if (!isFinite(s) || s <= 0) s = 1;
    scale = s; tx = 0; ty = 0;
    applyTransform();
  }

  function reset100() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  // Zoom toward a stage-local point (sx, sy) by multiplying scale by f.
  // (tx, ty) are offsets from the wrap's flex-centered position, with
  // transform-origin at wrap's centre. The wrap's centre in stage coords
  // is at (stageW/2 + tx, stageH/2 + ty). Keeping (sx, sy) fixed under
  // a zoom factor k means: (sx - cx)/scale stays constant.
  function zoomAt(sx, sy, f) {
    if (!stageEl) return;
    var minScale = 0.1, maxScale = 16;
    var newScale = Math.max(minScale, Math.min(maxScale, scale * f));
    var stb = stageEl.getBoundingClientRect();
    var cx = stb.width / 2 + tx;
    var cy = stb.height / 2 + ty;
    var k = newScale / scale;
    var newCx = sx - (sx - cx) * k;
    var newCy = sy - (sy - cy) * k;
    tx = newCx - stb.width / 2;
    ty = newCy - stb.height / 2;
    scale = newScale;
    applyTransform();
  }

  // ── Modal lifecycle ───────────────────────────────────
  function open(sourceWrapper) {
    if (modal) close();
    var srcSvg = sourceWrapper.querySelector('svg');
    if (!srcSvg) return;

    prevFocus = document.activeElement;

    modal = document.createElement('div');
    modal.className = 'sdoc-mermaid-focus';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Diagram fullscreen view');

    // Pull the bg/fg colours from the source wrapper (computed style) so the
    // modal feels like a magnified version of the block. Falls back to
    // theme-aware defaults if the cascade isn't reachable.
    var rendered = document.getElementById('_sd_rendered');
    var probe = sourceWrapper || rendered;
    var cs = probe ? getComputedStyle(probe) : null;
    var blockBg = (cs && cs.backgroundColor) || '';
    var fg = '';
    if (rendered) {
      var rcs = getComputedStyle(rendered);
      fg = rcs.getPropertyValue('--md-color').trim() || rcs.color;
    }
    if (blockBg) modal.style.setProperty('--sdoc-focus-bg', blockBg);
    if (fg)      modal.style.setProperty('--sdoc-focus-fg', fg);
    // Mirror --md-block-bg onto the modal so CSS rules in rendered.css that
    // reference it (edge label fills etc.) resolve correctly inside the
    // modal too - the modal is appended to <body>, not inside #_sd_rendered,
    // so the variable wouldn't otherwise cascade.
    if (blockBg) modal.style.setProperty('--md-block-bg', blockBg);

    var topbar = document.createElement('div');
    topbar.className = 'sdoc-mermaid-focus-topbar';
    topbar.innerHTML =
      '<span class="sdoc-mermaid-focus-brand">SmallDocs<span class="sdoc-mermaid-focus-brand-suf">Diagram</span></span>'
      + '<span class="sdoc-mermaid-focus-zoom" data-role="zoom">100%</span>'
      + '<div class="sdoc-mermaid-focus-actions">'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="copy-png">Copy PNG</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="save-png">Save PNG</button>'
      +   '<span class="sdoc-mermaid-focus-sep" aria-hidden="true"></span>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="fit">Fit</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="100">100%</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="zoomout" aria-label="Zoom out">−</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="zoomin" aria-label="Zoom in">+</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="close" aria-label="Close">✕</button>'
      + '</div>';

    stageEl = document.createElement('div');
    stageEl.className = 'sdoc-mermaid-focus-stage';

    svgWrap = document.createElement('div');
    svgWrap.className = 'sdoc-mermaid-focus-svg-wrap';
    var clone = srcSvg.cloneNode(true);
    // Mermaid sets width="100%" so the inline render fills its block.
    // For pan/zoom we need a stable natural size, otherwise the wrap
    // collapses to whatever the flex parent allocates and the fit math
    // is circular. Pull pixel dimensions from the viewBox.
    clone.removeAttribute('style');
    clone.style.maxWidth = 'none';
    var vb = clone.getAttribute('viewBox');
    if (vb) {
      var parts = vb.split(/\s+|,/).map(Number);
      var vbW = parts[2], vbH = parts[3];
      if (vbW && vbH) {
        clone.setAttribute('width',  String(vbW));
        clone.setAttribute('height', String(vbH));
      }
    }
    svgWrap.appendChild(clone);
    stageEl.appendChild(svgWrap);

    modal.appendChild(topbar);
    modal.appendChild(stageEl);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-mermaid-focus-open');

    zoomLabel = topbar.querySelector('[data-role="zoom"]');

    topbar.addEventListener('click', onTopbarClick);

    stageEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    stageEl.addEventListener('wheel', onWheel, { passive: false });
    stageEl.addEventListener('touchstart', onTouchStart, { passive: false });
    stageEl.addEventListener('touchmove', onTouchMove, { passive: false });
    stageEl.addEventListener('touchend', onTouchEnd);

    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);

    // Initial fit-to-screen after DOM has laid out
    requestAnimationFrame(function () { fit(); });

    var firstBtn = topbar.querySelector('[data-act="fit"]');
    if (firstBtn) firstBtn.focus();
  }

  function close() {
    if (!modal) return;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    modal.remove();
    modal = null; stageEl = null; svgWrap = null; zoomLabel = null;
    document.body.classList.remove('sdoc-mermaid-focus-open');
    tx = 0; ty = 0; scale = 1; isDragging = false; dragStart = null;
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_) {}
    prevFocus = null;
  }

  // ── PNG export ────────────────────────────────────────
  // CSS-driven polish (rx/ry rounding, overflow:visible) doesn't survive
  // XMLSerializer; the rules live outside the SVG document. Inject an
  // equivalent <style> block right after the opening <svg ...> tag so the
  // serialised copy renders the same as the live one when drawn to canvas
  // or pasted into another tool. Polish stays in rendered.css for the live
  // path - this only adds inline rules at export time.
  var INLINE_POLISH_CSS =
    '.node > rect, .node .label-container, .actor, .note > rect, ' +
    '.er.entityBox, .label-container[rx], rect.task { rx: 6px; ry: 6px; }';

  function serialiseSvg(svg) {
    var clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!clone.getAttribute('xmlns:xlink')) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    var styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = INLINE_POLISH_CSS;
    clone.insertBefore(styleEl, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }

  // Render the focus stage's SVG to a PNG blob at 2x device scale, with
  // the focus-modal background painted underneath so the image isn't
  // transparent. Returns a Promise<Blob>.
  function svgToPngBlob(scale) {
    return new Promise(function (resolve, reject) {
      if (!svgWrap) return reject(new Error('no svg'));
      var svg = svgWrap.querySelector('svg');
      if (!svg) return reject(new Error('no svg element'));
      var rect = svg.getBoundingClientRect();
      var s = scale || 2;
      var w = Math.max(1, Math.round(rect.width  * s));
      var h = Math.max(1, Math.round(rect.height * s));

      var xml = serialiseSvg(svg);
      // Base64 data URL is more reliable than blob: URLs for <img> SVG
      // loading - some Chromium versions reject blob: SVGs with embedded
      // <style> when used as image source.
      var b64;
      try {
        b64 = btoa(unescape(encodeURIComponent(xml)));
      } catch (e) { return reject(e); }
      var url = 'data:image/svg+xml;base64,' + b64;

      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          // Paint the modal background so the PNG has the same surface
          // colour the diagram is being read against - transparent PNG
          // dropped onto Slack/email looks wrong against arbitrary themes.
          var modalBg = modal ? getComputedStyle(modal).backgroundColor : '#ffffff';
          ctx.fillStyle = modalBg;
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (b) {
            if (b) resolve(b); else reject(new Error('toBlob failed'));
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        reject(new Error('svg image load failed'));
      };
      img.src = url;
    });
  }

  function flashLabel(btn, text) {
    var prev = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { if (btn) btn.textContent = prev; }, 1500);
  }

  function copyPng(btn) {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      flashLabel(btn, 'Not supported');
      return;
    }
    svgToPngBlob(2).then(function (blob) {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }).then(function () {
      flashLabel(btn, 'Copied');
    }).catch(function () {
      flashLabel(btn, 'Failed');
    });
  }

  function savePng(btn) {
    svgToPngBlob(2).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'diagram.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flashLabel(btn, 'Saved');
    }).catch(function () {
      flashLabel(btn, 'Failed');
    });
  }

  // ── Handlers ──────────────────────────────────────────
  function onTopbarClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'fit')      fit();
    else if (act === '100') reset100();
    else if (act === 'close') close();
    else if (act === 'copy-png') copyPng(btn);
    else if (act === 'save-png') savePng(btn);
    else if (act === 'zoomin' || act === 'zoomout') {
      var stb = stageEl.getBoundingClientRect();
      zoomAt(stb.width / 2, stb.height / 2, act === 'zoomin' ? 1.25 : 0.8);
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
    stageEl.classList.add('is-dragging');
  }
  function onMouseMove(e) {
    if (!isDragging || !dragStart) return;
    tx = dragStart.tx + (e.clientX - dragStart.x);
    ty = dragStart.ty + (e.clientY - dragStart.y);
    applyTransform();
  }
  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false; dragStart = null;
    if (stageEl) stageEl.classList.remove('is-dragging');
  }

  function onWheel(e) {
    if (!stageEl) return;
    e.preventDefault();
    var stb = stageEl.getBoundingClientRect();
    var sx = e.clientX - stb.left;
    var sy = e.clientY - stb.top;
    // deltaY > 0 means scroll down = zoom out (consistent with maps).
    var f = Math.pow(0.9985, e.deltaY);
    zoomAt(sx, sy, f);
  }

  // Single-finger drag only in v1. Pinch is "v2 if there's demand"; the
  // explicit cap keeps the touch path predictable.
  var lastTouch = null;
  function onTouchStart(e) {
    if (e.touches.length !== 1) { lastTouch = null; return; }
    e.preventDefault();
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: tx, ty: ty };
    isDragging = true;
  }
  function onTouchMove(e) {
    if (!lastTouch || e.touches.length !== 1) return;
    e.preventDefault();
    tx = lastTouch.tx + (e.touches[0].clientX - lastTouch.x);
    ty = lastTouch.ty + (e.touches[0].clientY - lastTouch.y);
    applyTransform();
  }
  function onTouchEnd() { lastTouch = null; isDragging = false; }

  function onKey(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    var stb = stageEl.getBoundingClientRect();
    var cx = stb.width / 2, cy = stb.height / 2;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(cx, cy, 1.25); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(cx, cy, 0.8);  return; }
    if (e.key === '0')                  { e.preventDefault(); fit(); return; }
    var step = 40;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); tx += step; applyTransform(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); tx -= step; applyTransform(); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); ty += step; applyTransform(); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); ty -= step; applyTransform(); }
  }

  // ── Public API ────────────────────────────────────────
  S.SDocMermaidFocus = {
    open: open,
    close: close,
    buildZoomButton: buildZoomButton
  };
})();
