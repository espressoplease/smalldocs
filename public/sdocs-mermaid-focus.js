// sdocs-mermaid-focus.js - Fullscreen pan/zoom modal for Mermaid diagrams.
//
// Each rendered .sdoc-mermaid wrapper carries a small top-right icon button
// (added by sdocs-mermaid.js after render). Clicking the button clones the
// already-rendered SVG into a centered stage with:
//   - drag to pan
//   - wheel to zoom toward cursor
//   - + / - keys to zoom; 0 to fit; arrows for pan; ESC to close
//   - Copy PNG / Save PNG / Fit / Zoom -/+ buttons in the topbar
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
    '  background: transparent;',
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
    // z-index sits above .sdoc-present (10000) and its topbar (10001) so
    // the focus modal is the dominant surface when opened from inside
    // presentation mode. The present modal is also display:none'd in
    // open()/close() so nothing peeks through if the focus modal ends up
    // with a translucent background.
    '.sdoc-mermaid-focus {',
    '  position: fixed; inset: 0; z-index: 10100;',
    '  background: var(--sdoc-focus-bg, #f4f1ed);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  display: grid; grid-template-rows: 40px 1fr;',
    '  font-family: ui-sans-serif, system-ui, sans-serif;',
    '  animation: sdoc-mermaid-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-mermaid-fade { from { opacity: 0 } to { opacity: 1 } }',
    '.sdoc-mermaid-focus-topbar {',
    '  position: relative;',  // anchors the overflow-fade ::after on mobile
    /* gap:2px matches the main app's .toggle-group spacing -- the cluster */
    /* on the right reads as one tight group rather than separate items.   */
    '  display: flex; align-items: center; gap: 2px;',
    '  height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-mermaid-focus-brand {',
    '  display: inline-flex; align-items: baseline;',
    '  color: #3B82F6; font-size: 13px; font-weight: 600;',
    '  margin-right: auto;',
    '}',
    /* Three-variant brand text (full / short / tiny) mirrors the main */
    /* toolbar pattern: only one displays per breakpoint. */
    '.sdoc-mermaid-focus-brand-text { display: none; }',
    '.sdoc-mermaid-focus-brand-full { display: inline; }',
    '.sdoc-mermaid-focus-brand-suf {',
    '  color: var(--sdoc-focus-fg, #1c1917); font-weight: 400; margin-left: 4px;',
    '}',
    '.sdoc-mermaid-focus-actions { display: flex; gap: 2px; align-items: center; }',
    /* Separator has no horizontal margin -- the topbar gap (2px) handles */
    /* spacing, matching .write-tb-sep / main app conventions.            */
    '.sdoc-mermaid-focus-sep {',
    '  width: 1px; height: 16px; flex-shrink: 0;',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '}',
    /* Padding 6px 8px mirrors .toggle-group .btn so the icon-only buttons */
    /* are the same compact 30x26 hit target as the main toolbar.          */
    '.sdoc-mermaid-focus-btn {',
    '  all: unset; cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  padding: 6px 8px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  font-size: 12px; font-family: inherit;',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-mermaid-focus-btn:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-mermaid-focus-btn:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    /* Whole menu clusters on the right of the topbar -- brand has        */
    /* margin-right:auto, everything else flows in DOM order:             */
    /*   brand | <auto> | zoom group | sep | copy group | sep | close     */
    /* Mobile drops brand's auto-margin so the cluster moves to the left  */
    /* and scrolls horizontally; close stays at the far-right end.        */
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
    /* Action button = icon + qualifier label (e.g. "[copy] PNG"). */
    /* Modeled on .sdoc-copy-with-c in comments.css; the bordered ghost */
    /* shape disambiguates it from the unbordered icon-only buttons. */
    '.sdoc-mermaid-focus-action {',
    '  all: unset; cursor: pointer;',
    '  display: inline-flex; align-items: center; gap: 5px;',
    '  padding: 4px 9px; border-radius: 4px;',
    '  background: transparent;',
    '  border: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  font-size: 11.5px; font-weight: 500; font-family: inherit;',
    '  transition: background .12s, color .12s, border-color .12s;',
    '}',
    '.sdoc-mermaid-focus-action:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  border-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 32%, transparent);',
    '}',
    '.sdoc-mermaid-focus-action:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    '.sdoc-mermaid-focus-action svg { flex-shrink: 0; }',
    '.sdoc-mermaid-focus-action-label { white-space: nowrap; }',
    /* Mobile: left-align everything, let the topbar scroll horizontally. */
    /* Close stays at the far-right end of the scroll, matching desktop;  */
    /* the "Diagram" suffix is dropped here -- contextual and not worth   */
    /* the width. Mirrors the main toolbar pattern (mobile.css).          */
    '@media (max-width: 768px) {',
    '  .sdoc-mermaid-focus-brand { margin-right: 0; }',
    '  .sdoc-mermaid-focus-brand-full { display: none; }',
    '  .sdoc-mermaid-focus-brand-short { display: inline; }',
    '  .sdoc-mermaid-focus-brand-suf { display: none; }',
    '  .sdoc-mermaid-focus-topbar {',
    '    overflow-x: auto; overflow-y: hidden;',
    '    scrollbar-width: none; -webkit-overflow-scrolling: touch;',
    '  }',
    '  .sdoc-mermaid-focus-topbar::-webkit-scrollbar { display: none; }',
    '  .sdoc-mermaid-focus-topbar > * { flex-shrink: 0; }',
    '}',
    /* Right-edge fade hint when the topbar overflows. JS toggles */
    /* .has-overflow / .scrolled-end on resize/scroll. */
    '@media (max-width: 560px) {',
    '  .sdoc-mermaid-focus-topbar.has-overflow::after {',
    '    content: ""; position: absolute; top: 0; right: 0;',
    '    width: 32px; height: 100%;',
    '    background: linear-gradient(to right, transparent, color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%) 90%);',
    '    pointer-events: none; opacity: 1;',
    '    transition: opacity .2s ease;',
    '  }',
    '  .sdoc-mermaid-focus-topbar.scrolled-end::after { opacity: 0; }',
    '}',
    /* Very narrow: fall back to the SD brand. */
    '@media (max-width: 366px) {',
    '  .sdoc-mermaid-focus-brand-short { display: none; }',
    '  .sdoc-mermaid-focus-brand-tiny { display: inline; }',
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

  // Lucide icons (lucide.dev/icons). Single source per icon; the wrapper
  // function lets us pass a size while keeping stroke / viewBox uniform.
  function lucide(paths, size) {
    var s = size || 14;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" '
      + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var EXPAND_ICON_SVG = lucide(
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>'
    + '<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'
  );
  var COPY_ICON_SVG = lucide(
    '<rect x="9" y="9" width="13" height="13" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    13
  );
  var DOWNLOAD_ICON_SVG = lucide(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
    + '<polyline points="7 10 12 15 17 10"/>'
    + '<line x1="12" y1="15" x2="12" y2="3"/>',
    13
  );
  var SCAN_ICON_SVG = lucide(
    '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>'
    + '<path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>'
  );
  var ZOOM_IN_ICON_SVG = lucide(
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    + '<line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>'
  );
  var ZOOM_OUT_ICON_SVG = lucide(
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    + '<line x1="8" y1="11" x2="14" y2="11"/>'
  );
  var X_ICON_SVG = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

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

  // Treat unset, "transparent", and "rgba(0, 0, 0, 0)" as no-fill so we
  // can fall back to a sensible default. Browsers serialise transparent
  // either way depending on cascade history.
  function isTransparentColor(c) {
    if (!c) return true;
    c = String(c).replace(/\s+/g, '');
    return c === 'transparent' || c === 'rgba(0,0,0,0)';
  }

  // ── State ─────────────────────────────────────────────
  var modal = null;
  var stageEl = null;
  var svgWrap = null;
  var topbarEl = null;
  var prevFocus = null;
  var keyHandler = null;
  var resizeHandler = null;

  var tx = 0, ty = 0, scale = 1;
  var isDragging = false;
  var dragStart = null; // { x, y, tx, ty }

  function applyTransform() {
    if (svgWrap) svgWrap.style.transform =
      'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
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
    // Inside a slide shape the .sdoc-mermaid wrapper is intentionally
    // transparent so the shape's own background shows through. If we
    // copy that transparent value onto --sdoc-focus-bg, the focus modal
    // itself becomes transparent and whatever's underneath (present
    // mode, the doc body) bleeds through. Fall back to the rendered
    // doc's background, then to the CSS default.
    if (isTransparentColor(blockBg)) {
      var rendBg = rendered ? getComputedStyle(rendered).backgroundColor : '';
      blockBg = isTransparentColor(rendBg) ? '' : rendBg;
    }
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
    /* Layout: brand | <auto> | actions | sep | close                */
    /* Close sits at the far right on both desktop and mobile. On    */
    /* mobile the topbar scrolls horizontally; close trails the end  */
    /* of the scroll rather than crowding the brand.                 */
    topbar.innerHTML =
      '<span class="sdoc-mermaid-focus-brand">'
      +   '<span class="sdoc-mermaid-focus-brand-text sdoc-mermaid-focus-brand-full">SmallDocs</span>'
      +   '<span class="sdoc-mermaid-focus-brand-text sdoc-mermaid-focus-brand-short">SDocs</span>'
      +   '<span class="sdoc-mermaid-focus-brand-text sdoc-mermaid-focus-brand-tiny">SD</span>'
      +   '<span class="sdoc-mermaid-focus-brand-suf">Diagram</span>'
      + '</span>'
      + '<div class="sdoc-mermaid-focus-actions">'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="zoomin" title="Zoom in (+)" aria-label="Zoom in">' + ZOOM_IN_ICON_SVG + '</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="zoomout" title="Zoom out (−)" aria-label="Zoom out">' + ZOOM_OUT_ICON_SVG + '</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-btn" data-act="fit" title="Fit to view (0)" aria-label="Fit to view">' + SCAN_ICON_SVG + '</button>'
      +   '<span class="sdoc-mermaid-focus-sep" aria-hidden="true"></span>'
      +   '<button type="button" class="sdoc-mermaid-focus-action" data-act="copy-png" title="Copy PNG to clipboard" aria-label="Copy PNG to clipboard">'
      +     COPY_ICON_SVG + '<span class="sdoc-mermaid-focus-action-label">PNG</span>'
      +   '</button>'
      +   '<button type="button" class="sdoc-mermaid-focus-action" data-act="save-png" title="Save as PNG file" aria-label="Save as PNG file">'
      +     DOWNLOAD_ICON_SVG + '<span class="sdoc-mermaid-focus-action-label">PNG</span>'
      +   '</button>'
      + '</div>'
      + '<span class="sdoc-mermaid-focus-sep" aria-hidden="true"></span>'
      + '<button type="button" class="sdoc-mermaid-focus-btn sdoc-mermaid-focus-close" data-act="close" title="Close (Esc)" aria-label="Close">' + X_ICON_SVG + '</button>';

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

    // When opened from within presentation mode, hide the present modal
    // entirely. Otherwise its topbar (z-index 10001) and rail show
    // through and there are visually two stacked menus competing for
    // attention. close() restores the original display value.
    hidePresentModal();

    topbarEl = topbar;

    topbar.addEventListener('click', onTopbarClick);
    topbar.addEventListener('scroll', updateTopbarOverflow, { passive: true });

    stageEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    stageEl.addEventListener('wheel', onWheel, { passive: false });
    stageEl.addEventListener('touchstart', onTouchStart, { passive: false });
    stageEl.addEventListener('touchmove', onTouchMove, { passive: false });
    stageEl.addEventListener('touchend', onTouchEnd);

    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);
    resizeHandler = updateTopbarOverflow;
    window.addEventListener('resize', resizeHandler);

    // Initial fit-to-screen after DOM has laid out
    requestAnimationFrame(function () { fit(); updateTopbarOverflow(); });

    var firstBtn = topbar.querySelector('[data-act="fit"]');
    if (firstBtn) firstBtn.focus();
  }

  function close() {
    if (!modal) return;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    keyHandler = null;
    resizeHandler = null;
    modal.remove();
    modal = null; stageEl = null; svgWrap = null; topbarEl = null;
    document.body.classList.remove('sdoc-mermaid-focus-open');
    tx = 0; ty = 0; scale = 1; isDragging = false; dragStart = null;
    restorePresentModal();
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_) {}
    prevFocus = null;
  }

  // Track whether we hid the present modal on open, so close() only
  // restores when we were the one to hide it.
  var presentHiddenByUs = false;
  function hidePresentModal() {
    var p = document.querySelector('.sdoc-present');
    if (p && p.style.display !== 'none') {
      p._sdocFocusPrevDisplay = p.style.display;
      p.style.display = 'none';
      presentHiddenByUs = true;
    }
  }
  function restorePresentModal() {
    if (!presentHiddenByUs) return;
    presentHiddenByUs = false;
    var p = document.querySelector('.sdoc-present');
    if (p && '_sdocFocusPrevDisplay' in p) {
      p.style.display = p._sdocFocusPrevDisplay;
      delete p._sdocFocusPrevDisplay;
    }
  }

  // Toggle .has-overflow / .scrolled-end so CSS can show / hide the
  // right-edge fade hint. Mirrors the main toolbar pattern.
  function updateTopbarOverflow() {
    if (!topbarEl) return;
    var hasOverflow = topbarEl.scrollWidth > topbarEl.clientWidth + 1;
    topbarEl.classList.toggle('has-overflow', hasOverflow);
    var atEnd = topbarEl.scrollLeft + topbarEl.clientWidth >= topbarEl.scrollWidth - 1;
    topbarEl.classList.toggle('scrolled-end', atEnd);
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

  // Swap just the qualifier label so the leading icon survives.
  // Falls back to whole-button textContent for any caller without a label span.
  function flashLabel(btn, text) {
    var labelEl = btn.querySelector('.sdoc-mermaid-focus-action-label');
    var target = labelEl || btn;
    var prev = target.textContent;
    target.textContent = text;
    setTimeout(function () { if (target) target.textContent = prev; }, 1500);
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
