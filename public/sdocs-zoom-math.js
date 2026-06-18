// sdocs-zoom-math.js - Pure pan/zoom transform math for the focus modals.
//
// No DOM, no globals. Given the current transform state and a gesture
// input, returns the next transform state. The Mermaid focus modal
// (sdocs-mermaid-focus.js) routes wheel, keyboard, toolbar-button and
// touch-pinch zoom through this one core so every entry path lands on
// byte-identical transforms - a `+` press and a pinch to the same scale
// agree.
//
// State shape: { tx, ty, scale }. (tx, ty) are offsets in CSS px from the
// wrap's flex-centred position; transform-origin is the wrap's centre, so
// "natural centred" is (0, 0, 1). Anchors and midpoints are stage-local
// coordinates (clientX/Y minus the stage's top-left).
//
// UMD: window.SDocZoomMath in the browser, module.exports under Node tests.
(function (exports) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Zoom the transform by `factor` while keeping the stage-local point
  // (anchorX, anchorY) pinned under itself. This is the single source of
  // truth for every zoom in the focus modal. The wrap's centre in stage
  // coords is (stageW/2 + tx, stageH/2 + ty); holding the anchor fixed
  // across a scale change means (anchor - centre) scales by k = new/old.
  function nextTransform(state, stageW, stageH, anchorX, anchorY, factor, minScale, maxScale) {
    var scale = state.scale;
    // scale is clamped >= minScale (> 0) by every caller, so k is finite.
    var newScale = clamp(scale * factor, minScale, maxScale);
    var k = newScale / scale;
    var cx = stageW / 2 + state.tx;
    var cy = stageH / 2 + state.ty;
    var newCx = anchorX - (anchorX - cx) * k;
    var newCy = anchorY - (anchorY - cy) * k;
    return {
      tx: newCx - stageW / 2,
      ty: newCy - stageH / 2,
      scale: newScale
    };
  }

  // One frame of a two-finger gesture: zoom by the ratio of finger spread
  // anchored at the current midpoint, then translate by how far the midpoint
  // itself travelled (two-finger pan). `prev` / `cur` are { mx, my, dist }
  // in stage-local coords. A near-zero previous spread (two fingers landing
  // on the same pixel) would make the ratio explode, so we treat it as no
  // zoom for that frame. This function is pure: the caller advances `prev`.
  function applyPinch(state, stageW, stageH, prev, cur, minScale, maxScale) {
    var factor = prev.dist > 1 ? cur.dist / prev.dist : 1;
    var z = nextTransform(state, stageW, stageH, cur.mx, cur.my, factor, minScale, maxScale);
    return {
      tx: z.tx + (cur.mx - prev.mx),
      ty: z.ty + (cur.my - prev.my),
      scale: z.scale
    };
  }

  // Clamp the pan offset so scaled content can't be dragged off the viewport
  // into empty space - the map / Photos / PDF behaviour. The diagram modal
  // deliberately does NOT use this (a diagram is free-roam); slides do, so a
  // zoomed slide always keeps its content against the screen edges.
  //
  // Geometry: content is centred in the viewport at (tx,ty)=(0,0) and scales
  // about its centre. The centre may travel at most half the overflow on each
  // axis before an edge of the content would pull inside the viewport. When
  // the scaled content is no larger than the viewport on an axis (contentDim *
  // scale <= viewDim), that axis is pinned centred (max = 0).
  //
  // contentW/H = the fitted (scale-1) content size; viewW/H = the viewport
  // (the clipping frame). For a letterboxed slide these differ on the
  // non-constraining axis, which is why both are passed explicitly.
  function clampTranslate(tx, ty, scale, contentW, contentH, viewW, viewH) {
    var maxTx = Math.max(0, (contentW * scale - viewW) / 2);
    var maxTy = Math.max(0, (contentH * scale - viewH) / 2);
    return { tx: clamp(tx, -maxTx, maxTx), ty: clamp(ty, -maxTy, maxTy) };
  }

  exports.clamp = clamp;
  exports.nextTransform = nextTransform;
  exports.applyPinch = applyPinch;
  exports.clampTranslate = clampTranslate;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocZoomMath = {}));
