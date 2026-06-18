// sdocs-present-mobile.js — touch + responsive-chrome layer for presentation mode.
//
// sdocs-present.js owns the slide deck, the rail, and the desktop chrome. This
// module enhances it on TOUCH devices only, and is a no-op on desktop (where a
// mouse + the persistent toolbar are correct). It hooks the present lifecycle
// through three calls that sdocs-present.js makes if this module is loaded:
//   SDocPresentMobile.onOpen({modal, stage, wrap, topbar})
//   SDocPresentMobile.onRender(index)   // after each slide (re)render
//   SDocPresentMobile.onClose()
//
// Three "outfits" are chosen by a form-factor class on the present modal,
// switched on orientation change (NOT height-resize, which storms as the
// mobile URL bar grows/shrinks):
//   .pm-desktop   — left untouched (mouse + rail + 40px bar)
//   .pm-portrait  — slim bar kept; a dismissible "rotate" nudge
//   .pm-landscape — full-bleed slide; the bar becomes an auto-hiding overlay
//
// Gestures (landscape + portrait touch), built on the shared pinch-zoom core
// (sdocs-zoom-math.js) and the finger-count state machine proven in
// sdocs-mermaid-focus.js. The whole model hinges on isFit():
//   at fit  → one-finger horizontal swipe changes slide
//   zoomed  → one finger pans (clamped so the slide can't leave the screen)
//   2 fingers → pinch-zoom anchored at the midpoint (floor = fit, cap = 4x)
//   double-tap → toggle fit <-> 2.5x at the tap point
//   single tap → toggle the chrome
//   every slide change resets zoom to fit.
(function () {
  'use strict';
  var ZM = window.SDocZoomMath;

  // ── tunables ──────────────────────────────────────────
  var MIN_SCALE = 1;        // a slide never zooms out past fit
  var MAX_SCALE = 4;        // slide text degrades past ~4x (diagrams go to 16x)
  var DBL_SCALE = 2.5;      // double-tap target
  var SLOP = 8;             // px before a touch commits to swipe/pan
  var COMMIT_FRAC = 0.25;   // swipe >25% of width commits a slide change
  var FLICK_VEL = 0.5;      // px/ms flick that commits regardless of distance
  var CHROME_HIDE_MS = 3000;
  var TAP_MAX_MS = 250;
  var DBL_TAP_MS = 280;

  var CSS_ID = 'sdocs-present-mobile-css';
  var CSS = [
    /* Landscape phone: reclaim the whole viewport. The rail is hidden (it is
       also hidden by the <=720px width query, but a landscape phone can be
       ~844px wide, so we cannot rely on width alone), the grid collapses to a
       single cell, and the topbar becomes an auto-hiding translucent overlay
       instead of a reserved 40px track. 100dvh tracks the live visible height
       as the URL bar moves. */
    '.sdoc-present.pm-landscape {',
    '  grid-template-columns: 1fr; grid-template-rows: 1fr; height: 100dvh;',
    '}',
    '.sdoc-present.pm-landscape .sdoc-present-rail { display: none; }',
    '.sdoc-present.pm-landscape .sdoc-present-stage-wrap {',
    '  grid-row: 1; grid-column: 1; padding: 8px;',
    '}',
    '.sdoc-present.pm-landscape .sdoc-present-topbar {',
    '  position: absolute; top: 0; left: 0; right: 0; z-index: 5;',
    '  background: rgba(19,18,16,.72); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);',
    '  border-bottom: 1px solid rgba(255,255,255,.08);',
    '  transition: transform .3s cubic-bezier(.4,0,.2,1), opacity .3s cubic-bezier(.4,0,.2,1);',
    '}',
    '.sdoc-present.pm-landscape.pm-chrome-hidden .sdoc-present-topbar {',
    '  transform: translateY(-100%); opacity: 0; pointer-events: none;',
    '}',
    /* Ghost exit: a faint, always-reachable close so a user can never feel
       trapped while the chrome is hidden. Visible only when chrome is hidden
       (when the bar is up, its own close button is there). */
    '.pm-ghost-close {',
    '  position: absolute; top: 8px; right: 10px; z-index: 6;',
    '  width: 34px; height: 34px; border-radius: 50%;',
    '  display: none; align-items: center; justify-content: center;',
    '  background: rgba(11,10,9,.45); color: #fff; border: none; cursor: pointer;',
    '  opacity: 0; pointer-events: none; transition: opacity .3s ease;',
    '}',
    '.sdoc-present.pm-landscape .pm-ghost-close { display: inline-flex; }',
    '.sdoc-present.pm-landscape.pm-chrome-hidden .pm-ghost-close { opacity: .4; pointer-events: auto; }',
    '.pm-ghost-close:active { opacity: .8; }',
    /* The slide stage drives its own transform for zoom/pan; no transition by
       default so panning tracks the finger 1:1. Animated moves add it inline. */
    '.sdoc-present-stage { transform-origin: 50% 50%; will-change: transform; }',
    /* A centered translucent toast, reused for the one-time coachmark and the
       portrait rotate hint. */
    '.pm-toast {',
    '  position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);',
    '  z-index: 7; max-width: 80%; text-align: center;',
    '  background: rgba(11,10,9,.82); color: #f5f4f2;',
    '  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.4;',
    '  padding: 9px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12);',
    '  display: inline-flex; align-items: center; gap: 8px;',
    '  opacity: 0; transition: opacity .35s ease; pointer-events: none;',
    '}',
    '.pm-toast.pm-show { opacity: 1; }',
    '.pm-toast svg { flex-shrink: 0; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .sdoc-present.pm-landscape .sdoc-present-topbar,',
    '  .pm-ghost-close, .pm-toast { transition: none; }',
    '}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (typeof document !== 'undefined') injectCSS();

  // ── state ─────────────────────────────────────────────
  var active = false;
  var modal = null, stage = null, wrap = null, topbar = null, ghostClose = null;
  var curIndex = 0, total = 0;

  var tx = 0, ty = 0, scale = 1;                 // stage transform
  var rect = null, viewW = 0, viewH = 0;         // viewport (wrap content box)
  var contentW = 0, contentH = 0;                // fitted slide size (scale 1)

  var mode = 'idle';                             // idle | touching | swiping | panning | pinching
  var lastTouch = null;                          // { x, y, tx, ty }
  var pinch = null;                              // { mx, my, dist }
  var touchStart = null;                         // { x, y, t }
  var axis = null;                               // 'h' once a swipe locks
  var raf = 0;
  var animating = false;                         // slide-change transition lock

  var chromeTimer = 0, chromeVisible = true;
  var tapTimer = 0, lastTapT = 0, lastTapX = 0, lastTapY = 0;

  var mqlCoarse = null, mqlLandscape = null, ffHandler = null, resizeHandler = null;
  var enteredFullscreen = false;

  function touchDevice() { return mqlCoarse ? mqlCoarse.matches : false; }
  function isFit() { return scale <= MIN_SCALE * 1.01; }

  // ── transform plumbing ────────────────────────────────
  function applyTransform() {
    if (stage) stage.style.transform =
      'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; applyTransform(); });
  }
  function setTransformAnimated(on) {
    if (!stage) return;
    stage.style.transition = on ? 'transform .22s cubic-bezier(.4,0,.2,1)' : 'none';
    applyTransform();
  }
  function resetZoom() {
    tx = 0; ty = 0; scale = 1; mode = 'idle';
    lastTouch = null; pinch = null; touchStart = null; axis = null;
    if (stage) { stage.style.transition = 'none'; applyTransform(); }
  }

  function cacheRects() {
    if (!wrap || !stage) { rect = null; return; }
    var r = wrap.getBoundingClientRect();
    rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    var cs = getComputedStyle(wrap);
    var px = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var py = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    viewW = wrap.clientWidth - px;
    viewH = wrap.clientHeight - py;
    // clientWidth/Height are layout boxes, unaffected by the stage transform.
    contentW = stage.clientWidth;
    contentH = stage.clientHeight;
  }

  function clampPan() {
    var c = ZM.clampTranslate(tx, ty, scale, contentW, contentH, viewW, viewH);
    tx = c.tx; ty = c.ty;
  }

  // ── two-finger helpers (stage-local = relative to wrap rect) ──
  function twoFinger(touches) {
    var ax = touches[0].clientX, ay = touches[0].clientY;
    var bx = touches[1].clientX, by = touches[1].clientY;
    return {
      mx: (ax + bx) / 2 - rect.left,
      my: (ay + by) / 2 - rect.top,
      dist: Math.hypot(bx - ax, by - ay)
    };
  }

  // Re-derive mode from finger count, re-seeding origins from scratch — same
  // approach as the mermaid focus modal; dissolves 1<->2 finger transitions.
  function syncMode(e) {
    var n = e.touches.length;
    if (n === 0) { mode = 'idle'; lastTouch = null; pinch = null; axis = null; return; }
    if (!rect) cacheRects();
    if (n === 1) {
      pinch = null;
      var p = e.touches[0];
      lastTouch = { x: p.clientX, y: p.clientY, tx: tx, ty: ty };
      // If we drop from pinch to one finger while zoomed, keep panning;
      // if back at fit, the next move re-decides (swipe vs nothing).
      mode = isFit() ? 'touching' : 'panning';
    } else {
      lastTouch = null;
      pinch = twoFinger(e.touches);
      mode = 'pinching';
    }
  }

  // ── touch handlers ────────────────────────────────────
  function onTouchStart(e) {
    if (!active) return;
    // Let taps on the chrome itself behave normally.
    if (e.target.closest && e.target.closest('.sdoc-present-topbar, .pm-ghost-close, .pm-toast')) return;
    cacheRects();
    if (e.touches.length === 1 && !animating) {
      var p = e.touches[0];
      touchStart = { x: p.clientX, y: p.clientY, t: e.timeStamp };
    }
    e.preventDefault();
    syncMode(e);
  }

  function onTouchMove(e) {
    if (!active || !rect) return;

    if (mode === 'pinching' && e.touches.length >= 2) {
      e.preventDefault();
      var cur = twoFinger(e.touches);
      var nx = ZM.applyPinch({ tx: tx, ty: ty, scale: scale }, rect.width, rect.height,
        pinch, cur, MIN_SCALE, MAX_SCALE);
      tx = nx.tx; ty = nx.ty; scale = nx.scale;
      clampPan();
      pinch.mx = cur.mx; pinch.my = cur.my; pinch.dist = cur.dist;
      schedule();
      return;
    }

    if (e.touches.length !== 1 || animating) return;
    var t = e.touches[0];

    if (mode === 'touching') {
      var dx0 = t.clientX - touchStart.x, dy0 = t.clientY - touchStart.y;
      if (Math.hypot(dx0, dy0) < SLOP) return;        // still maybe a tap
      e.preventDefault();
      if (isFit()) { mode = 'swiping'; axis = Math.abs(dx0) >= Math.abs(dy0) ? 'h' : 'v'; }
      else { mode = 'panning'; }
    }

    if (mode === 'swiping') {
      e.preventDefault();
      if (axis !== 'h') return;                        // vertical swipe is inert
      tx = t.clientX - touchStart.x; ty = 0; scale = 1;
      stage.style.transition = 'none';
      schedule();
      return;
    }

    if (mode === 'panning') {
      e.preventDefault();
      tx = lastTouch.tx + (t.clientX - lastTouch.x);
      ty = lastTouch.ty + (t.clientY - lastTouch.y);
      clampPan();
      schedule();
    }
  }

  function onTouchEnd(e) {
    if (!active) return;

    if (mode === 'touching' && touchStart) {
      var dur = e.timeStamp - touchStart.t;
      if (dur <= TAP_MAX_MS) { handleTap(touchStart.x, touchStart.y); }
    } else if (mode === 'swiping' && axis === 'h') {
      settleSwipe(e);
    } else if (mode === 'panning') {
      // snap exactly to fit if a pinch left us at/under fit
      if (isFit()) resetZoom();
    }

    syncMode(e);
    if (e.touches.length === 0 && mode === 'idle') { rect = null; }
  }

  function onTouchCancel() {
    // OS stole the gesture (notification, palm, edge-swipe). Reset; spring any
    // in-flight swipe back.
    if (mode === 'swiping') { tx = 0; setTransformAnimated(true); }
    mode = 'idle'; lastTouch = null; pinch = null; touchStart = null; axis = null;
    rect = null;
  }

  function settleSwipe(e) {
    var dx = tx;
    var velocity = touchStart ? Math.abs(dx) / Math.max(1, e.timeStamp - touchStart.t) : 0;
    var committed = Math.abs(dx) > viewW * COMMIT_FRAC || velocity > FLICK_VEL;
    var dir = dx < 0 ? 1 : -1;                          // swipe left => next
    var target = curIndex + dir;
    if (committed && target >= 0 && target < total) {
      animating = true;
      tx = dir > 0 ? -viewW : viewW;                    // fly the slide out
      setTransformAnimated(true);
      window.setTimeout(function () {
        var go = window.SDocPresent && window.SDocPresent.go;
        if (go) go(target);                             // renderActive -> onRender resets transform
        animating = false;
      }, 200);
    } else {
      tx = 0; ty = 0; setTransformAnimated(true);       // spring back
    }
  }

  // ── tap: single = chrome toggle, double = zoom toggle ──
  function handleTap(x, y) {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var near = Math.abs(x - lastTapX) < 40 && Math.abs(y - lastTapY) < 40;
    if (tapTimer && near && (now - lastTapT) < DBL_TAP_MS) {
      window.clearTimeout(tapTimer); tapTimer = 0; lastTapT = 0;
      doubleTapZoom(x, y);
      return;
    }
    lastTapT = now; lastTapX = x; lastTapY = y;
    tapTimer = window.setTimeout(function () { tapTimer = 0; toggleChrome(); }, DBL_TAP_MS);
  }

  function doubleTapZoom(clientX, clientY) {
    if (!rect) cacheRects();
    var sx = clientX - rect.left, sy = clientY - rect.top;
    var target = isFit() ? DBL_SCALE : MIN_SCALE;
    var factor = target / scale;
    var nx = ZM.nextTransform({ tx: tx, ty: ty, scale: scale }, rect.width, rect.height,
      sx, sy, factor, MIN_SCALE, MAX_SCALE);
    tx = nx.tx; ty = nx.ty; scale = nx.scale;
    clampPan();
    if (isFit()) { tx = 0; ty = 0; }
    setTransformAnimated(true);
  }

  // ── chrome auto-hide ──────────────────────────────────
  function showChrome() {
    if (!modal) return;
    chromeVisible = true;
    modal.classList.remove('pm-chrome-hidden');
    armChromeTimer();
  }
  function hideChrome() {
    if (!modal) return;
    chromeVisible = false;
    modal.classList.add('pm-chrome-hidden');
    if (chromeTimer) { window.clearTimeout(chromeTimer); chromeTimer = 0; }
  }
  function toggleChrome() { if (chromeVisible) hideChrome(); else showChrome(); }
  function armChromeTimer() {
    if (chromeTimer) window.clearTimeout(chromeTimer);
    // Only landscape auto-hides; desktop/portrait keep the bar.
    if (!modal || !modal.classList.contains('pm-landscape')) return;
    chromeTimer = window.setTimeout(function () {
      // Don't hide while a control has keyboard focus (a11y).
      if (modal && modal.querySelector('.sdoc-present-topbar:focus-within')) { armChromeTimer(); return; }
      hideChrome();
    }, CHROME_HIDE_MS);
  }

  // ── form factor ───────────────────────────────────────
  function applyFormFactor() {
    if (!modal) return;
    modal.classList.remove('pm-desktop', 'pm-portrait', 'pm-landscape');
    var coarse = touchDevice();
    var landscape = mqlLandscape ? mqlLandscape.matches : false;
    if (!coarse) { modal.classList.add('pm-desktop'); teardownGestures(); hideToasts(); showChrome(); return; }
    if (landscape) {
      modal.classList.add('pm-landscape');
      hideRotateHint();
      maybeCoach();
      showChrome();           // visible on entry, fades after the timer
    } else {
      modal.classList.add('pm-portrait');
      hideCoach();
      showChrome();
      maybeRotateHint();
    }
    // Re-fit and re-clamp against the new layout box.
    if (window.SDocPresent && window.SDocPresent.refit) window.SDocPresent.refit();
    cacheRects();
    clampPan();
    setTransformAnimated(false);
  }

  // ── toasts (coachmark + rotate hint) ──────────────────
  var coachEl = null, rotateEl = null;
  function lucideToast(svg, text) {
    var el = document.createElement('div');
    el.className = 'pm-toast';
    el.innerHTML = svg + '<span>' + text + '</span>';
    return el;
  }
  function maybeCoach() {
    try { if (window.localStorage && localStorage.getItem('sdoc-present-coach') === '1') return; } catch (_) {}
    if (coachEl) return;
    coachEl = lucideToast(
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
      'Swipe to move · pinch to zoom · tap for controls');
    modal.appendChild(coachEl);
    requestAnimationFrame(function () { if (coachEl) coachEl.classList.add('pm-show'); });
    window.setTimeout(hideCoach, 3200);
    try { if (window.localStorage) localStorage.setItem('sdoc-present-coach', '1'); } catch (_) {}
  }
  function hideCoach() {
    if (!coachEl) return;
    var el = coachEl; coachEl = null;
    el.classList.remove('pm-show');
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }
  function maybeRotateHint() {
    if (rotateEl) return;
    rotateEl = lucideToast(
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 1 0 10-10"/><path d="M2 12v4h4"/></svg>',
      'Rotate for a bigger slide');
    modal.appendChild(rotateEl);
    requestAnimationFrame(function () { if (rotateEl) rotateEl.classList.add('pm-show'); });
    window.setTimeout(hideRotateHint, 4000);
  }
  function hideRotateHint() {
    if (!rotateEl) return;
    var el = rotateEl; rotateEl = null;
    el.classList.remove('pm-show');
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }
  function hideToasts() { hideCoach(); hideRotateHint(); }

  // ── fullscreen (best effort; user-gesture + platform gated) ──
  function tryFullscreen() {
    if (!modal || !modal.requestFullscreen) return;          // iPhone Safari lacks it for non-video
    if (document.fullscreenElement) return;
    try {
      var p = modal.requestFullscreen();
      if (p && p.then) p.then(function () {
        enteredFullscreen = true;
        if (screen.orientation && screen.orientation.lock) {
          try { screen.orientation.lock('landscape').catch(function () {}); } catch (_) {}
        }
      }).catch(function () {});
    } catch (_) {}
  }
  function exitFullscreenIfOurs() {
    if (enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen().catch(function () {}); } catch (_) {}
    }
    enteredFullscreen = false;
  }

  // ── gesture wiring ────────────────────────────────────
  function wireGestures() {
    if (!stage || !wrap) return;
    wrap.style.touchAction = 'none';  // we own pan/zoom/swipe
    wrap.addEventListener('touchstart', onTouchStart, { passive: false });
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd);
    wrap.addEventListener('touchcancel', onTouchCancel);
  }
  function teardownGestures() {
    if (!wrap) return;
    wrap.removeEventListener('touchstart', onTouchStart);
    wrap.removeEventListener('touchmove', onTouchMove);
    wrap.removeEventListener('touchend', onTouchEnd);
    wrap.removeEventListener('touchcancel', onTouchCancel);
  }

  // ── lifecycle hooks (called from sdocs-present.js) ────
  function onOpen(refs) {
    modal = refs.modal; stage = refs.stage; wrap = refs.wrap; topbar = refs.topbar;
    active = true;
    enteredFullscreen = false;
    chromeVisible = true;
    curIndex = refs.index || 0;
    total = document.querySelectorAll('.sdoc-slide[data-dsl]').length;

    mqlCoarse = window.matchMedia('(pointer: coarse)');
    mqlLandscape = window.matchMedia('(orientation: landscape)');

    if (touchDevice()) {
      // Ghost exit button (landscape only via CSS).
      ghostClose = document.createElement('button');
      ghostClose.type = 'button';
      ghostClose.className = 'pm-ghost-close';
      ghostClose.setAttribute('aria-label', 'Exit presentation');
      ghostClose.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      ghostClose.addEventListener('click', function () { if (window.SDocPresent) window.SDocPresent.close(); });
      modal.appendChild(ghostClose);

      wireGestures();
      tryFullscreen();
    }

    // Switch outfit on orientation change (and pointer-type change), NOT on
    // height resize — that storms as the URL bar moves and would flicker.
    ffHandler = function () { applyFormFactor(); };
    if (mqlLandscape.addEventListener) mqlLandscape.addEventListener('change', ffHandler);
    else if (mqlLandscape.addListener) mqlLandscape.addListener(ffHandler);

    // On rotation, the present sizer re-runs sizeStage on resize; we re-cache
    // and re-clamp one rAF later (iOS reports stale dims during the event).
    resizeHandler = function () { requestAnimationFrame(function () { cacheRects(); clampPan(); applyTransform(); }); };
    window.addEventListener('resize', resizeHandler);

    applyFormFactor();
  }

  function onRender(index) {
    if (!active) return;
    curIndex = typeof index === 'number' ? index : curIndex;
    total = document.querySelectorAll('.sdoc-slide[data-dsl]').length;
    resetZoom();      // every slide change returns to fit
    cacheRects();
  }

  function onClose() {
    teardownGestures();
    if (ffHandler && mqlLandscape) {
      if (mqlLandscape.removeEventListener) mqlLandscape.removeEventListener('change', ffHandler);
      else if (mqlLandscape.removeListener) mqlLandscape.removeListener(ffHandler);
    }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    if (chromeTimer) window.clearTimeout(chromeTimer);
    if (tapTimer) window.clearTimeout(tapTimer);
    hideToasts();
    exitFullscreenIfOurs();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    active = false;
    modal = stage = wrap = topbar = ghostClose = null;
    rect = null; mode = 'idle'; lastTouch = null; pinch = null; touchStart = null;
    tx = 0; ty = 0; scale = 1; chromeTimer = 0; tapTimer = 0;
    mqlCoarse = mqlLandscape = ffHandler = resizeHandler = null;
  }

  window.SDocPresentMobile = { onOpen: onOpen, onRender: onRender, onClose: onClose };
})();
