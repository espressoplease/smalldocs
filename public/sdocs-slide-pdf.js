// sdocs-slide-pdf.js — Draw a rendered slide onto a pdf-lib page as real PDF
// primitives (shapes + text). Produces a PDF with selectable, extractable
// text — no rasterization, no print dialog.
//
// Flow:
//   1. Parse DSL → get shape geometry in grid units.
//   2. Render the slide into an off-screen stage at a fixed 1280x720
//      (always, regardless of the target PDF bounds — this keeps autofit's
//      binary search deterministic so inline-in-doc and slide-only exports
//      produce the same layout).
//   3. Settle autofit: force layout, then wait 2 rAFs + a short timeout.
//   4. Draw shape primitives (r/c/e/l/a/p) by mapping grid coords → PDF pt.
//   5. For each text-bearing shape, walk into the shadow root and draw:
//        a. block decorations (pre bg, blockquote rail, inline code pills)
//        b. one drawText per rendered line, positioned via Range API
//        c. link underlines, list markers
//
// Coordinate systems:
//   - Grid units (DSL): y grows DOWN. Converted to PDF via gridToPdf().
//   - Stage viewport: px, y grows DOWN. Converted via stageToPdf().
//   - PDF: pt, y grows UP. `bounds.x/y` is the BOTTOM-LEFT of the slide area.
//
// Assumes pdf-lib (PDFLib) and fontkit are already loaded globally, and that
// SDocShapes + SDocShapeRender are available. Fonts are passed in by the
// caller via ctx.fonts so body-PDF and slide-PDF share the same embedded
// fonts.

(function () {
'use strict';

// Fixed measurement stage dimensions. Always 1280x720 regardless of target
// bounds — smaller stages cause autofit's integer-px binary search to round
// differently, which would shift line breaks between inline and fullscreen
// exports. Rendering at a canonical size and scaling the output affinely is
// the simplest way to keep both exports pixel-identical.
var STAGE_W = 1280;
var STAGE_H = 720;

// Fraction of a line-box from the top where the text baseline sits.
// For CSS line-heights in the 1.15-1.3 range used by shape-md shadow CSS
// this puts baseline roughly on the ascender line.
var BASELINE_RATIO = 0.78;

// ─── Stage lifecycle ──────────────────────────────────

// Offscreen stage used only for layout/measurement. opacity:0 + pointer-events:
// none keeps it invisible and non-interactive; top:0, left:0 keeps it inside
// the viewport so the engine doesn't skip layout.
function createStage(gridW, gridH) {
  var stageW = STAGE_W;
  var stageH = STAGE_W * gridH / gridW;
  var wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'width: ' + stageW + 'px',
    'height: ' + stageH + 'px',
    'opacity: 0',
    'pointer-events: none',
    'z-index: -1',
    'contain: layout paint',
  ].join(';');
  var stage = document.createElement('div');
  stage.style.cssText = 'width: 100%; height: 100%;';
  wrap.appendChild(stage);
  document.body.appendChild(wrap);
  return { wrap: wrap, stage: stage, w: stageW, h: stageH };
}

// Autofit is synchronous in the current renderer — no need to wait, but
// force one layout pass so getBoundingClientRect sees the final geometry.
function waitForAutofit(stage) {
  // eslint-disable-next-line no-unused-expressions
  stage.offsetHeight;
  return Promise.resolve();
}

// ─── Coordinate helpers ────────────────────────────────

function gridToPdfX(gx, grid, bounds) {
  return bounds.x + (gx / grid.w) * bounds.w;
}
// Returns PDF y for the TOP edge of a grid-y value (useful for rounded rect
// drawSvgPath which takes top-left origin).
function gridTopToPdfY(gy, grid, bounds) {
  return bounds.y + bounds.h - (gy / grid.h) * bounds.h;
}
// Returns PDF y for a point (for circles/line endpoints — no top/bottom flip
// needed, just single-point y-mirror).
function gridPointToPdfY(gy, grid, bounds) {
  return bounds.y + bounds.h - (gy / grid.h) * bounds.h;
}
function gridToPdfW(gw, grid, bounds) {
  return (gw / grid.w) * bounds.w;
}
function gridToPdfH(gh, grid, bounds) {
  return (gh / grid.h) * bounds.h;
}

function stageToPdfX(sx, stageRect, bounds) {
  var frac = (sx - stageRect.left) / stageRect.width;
  return bounds.x + frac * bounds.w;
}
// Maps a stage y (top-down) to a PDF y (bottom-up).
function stageToPdfY(sy, stageRect, bounds) {
  var frac = (sy - stageRect.top) / stageRect.height;
  return bounds.y + bounds.h - frac * bounds.h;
}
function stageScaleX(stageRect, bounds) {
  return bounds.w / stageRect.width;
}
function stageScaleY(stageRect, bounds) {
  return bounds.h / stageRect.height;
}
// Convert a stage-px font size into PDF pt at the current bounds scale.
function stagePxToPt(px, stageRect, bounds) {
  return px * (bounds.h / stageRect.height);
}

// ─── Color helpers ─────────────────────────────────────

function rgbStrToHex(s) {
  if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
  var m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return s.charAt(0) === '#' ? s : null;
  var a = m[4] != null ? parseFloat(m[4]) : 1;
  if (a < 0.05) return null;
  var r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  return '#' + [r, g, b].map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function toHex(c) {
  if (!c) return null;
  if (c.charAt && c.charAt(0) === '#') return c;
  return rgbStrToHex(c);
}

function hexToRgbPdf(hex) {
  var rgb = window.PDFLib.rgb;
  if (!hex) return rgb(0, 0, 0);
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return rgb(
    parseInt(hex.substring(0,2),16)/255,
    parseInt(hex.substring(2,4),16)/255,
    parseInt(hex.substring(4,6),16)/255
  );
}

// ─── Rounded rect (SVG path) ──────────────────────────

// Draws a rectangle with per-corner radii using pdf-lib's drawSvgPath.
// opts.x/y = top-left origin in PDF coords (pdf-lib flips SVG y-down
// internally). w/h in pt. radius: number or {tl,tr,br,bl}.
function drawRoundedRect(page, opts) {
  var x = opts.x, yTop = opts.y, w = opts.width, h = opts.height;
  if (w <= 0 || h <= 0) return;
  var r = opts.radius;
  var rTL, rTR, rBR, rBL;
  if (typeof r === 'object' && r !== null) {
    rTL = r.tl || 0; rTR = r.tr || 0; rBR = r.br || 0; rBL = r.bl || 0;
  } else {
    rTL = rTR = rBR = rBL = r || 0;
  }
  var maxR = Math.min(w, h) / 2;
  rTL = Math.min(rTL, maxR); rTR = Math.min(rTR, maxR);
  rBR = Math.min(rBR, maxR); rBL = Math.min(rBL, maxR);

  var d = 'M' + rTL + ' 0';
  d += ' L' + (w - rTR) + ' 0';
  if (rTR) d += ' Q' + w + ' 0 ' + w + ' ' + rTR;
  d += ' L' + w + ' ' + (h - rBR);
  if (rBR) d += ' Q' + w + ' ' + h + ' ' + (w - rBR) + ' ' + h;
  d += ' L' + rBL + ' ' + h;
  if (rBL) d += ' Q0 ' + h + ' 0 ' + (h - rBL);
  d += ' L0 ' + rTL;
  if (rTL) d += ' Q0 0 ' + rTL + ' 0';
  d += ' Z';

  var pdfOpts = { x: x, y: yTop };
  if (opts.color) pdfOpts.color = hexToRgbPdf(opts.color);
  if (opts.borderColor) pdfOpts.borderColor = hexToRgbPdf(opts.borderColor);
  if (opts.borderWidth != null && opts.borderWidth > 0) pdfOpts.borderWidth = opts.borderWidth;
  page.drawSvgPath(d, pdfOpts);
}

// ─── Shape primitives (from parsed DSL, not DOM) ──────

function strokeWidthPt(attrs, bounds) {
  // Shape stroke-width in the DSL is cqw. 1cqw = 1% of stage width. The stage
  // width maps affinely to bounds.w, so cqw → pt = (sw/100) * bounds.w.
  var sw = attrs && attrs.strokeWidth != null ? parseFloat(attrs.strokeWidth) : 0.15;
  if (!isFinite(sw) || sw < 0) sw = 0.15;
  return (sw / 100) * bounds.w;
}

function drawShapeRect(page, s, grid, bounds) {
  var x = gridToPdfX(s.x, grid, bounds);
  var yTop = gridTopToPdfY(s.y, grid, bounds);
  var w = gridToPdfW(s.w, grid, bounds);
  var h = gridToPdfH(s.h, grid, bounds);
  if (w <= 0 || h <= 0) return;

  var fill = s.attrs.fill ? toHex(s.attrs.fill) : null;
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, bounds) : 0;

  var radiusPct = s.attrs.radius != null ? parseFloat(s.attrs.radius) : 0.8;
  if (!isFinite(radiusPct) || radiusPct < 0) radiusPct = 0;
  var radiusPt = (radiusPct / 100) * Math.min(w, h);

  if (!fill && !stroke) return;
  drawRoundedRect(page, {
    x: x, y: yTop, width: w, height: h,
    radius: radiusPt,
    color: fill,
    borderColor: stroke,
    borderWidth: sw,
  });
}

function drawShapeCircle(page, s, grid, bounds) {
  var cx = gridToPdfX(s.cx, grid, bounds);
  var cy = gridPointToPdfY(s.cy, grid, bounds);
  // Grid aspect equals bounds aspect (stage size set from grid), so r in
  // grid-x units → same pt whether we scale via x or y.
  var r = gridToPdfW(s.r, grid, bounds);
  if (r <= 0) return;

  var fill = s.attrs.fill ? toHex(s.attrs.fill) : (s.attrs.stroke ? null : '#ffffff');
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, bounds) : 0;

  var opts = { x: cx, y: cy, size: r };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw;
  }
  page.drawCircle(opts);
}

function drawShapeEllipse(page, s, grid, bounds) {
  var cx = gridToPdfX(s.cx, grid, bounds);
  var cy = gridPointToPdfY(s.cy, grid, bounds);
  var rx = gridToPdfW(s.rx, grid, bounds);
  var ry = gridToPdfH(s.ry, grid, bounds);
  if (rx <= 0 || ry <= 0) return;

  var fill = s.attrs.fill ? toHex(s.attrs.fill) : (s.attrs.stroke ? null : '#ffffff');
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, bounds) : 0;

  var opts = { x: cx, y: cy, xScale: rx, yScale: ry };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw;
  }
  page.drawEllipse(opts);
}

function drawShapeLine(page, s, grid, bounds) {
  var x1 = gridToPdfX(s.x1, grid, bounds);
  var y1 = gridPointToPdfY(s.y1, grid, bounds);
  var x2 = gridToPdfX(s.x2, grid, bounds);
  var y2 = gridPointToPdfY(s.y2, grid, bounds);
  var stroke = s.attrs.stroke ? toHex(s.attrs.stroke) : '#94a3b8';
  var sw = strokeWidthPt(s.attrs, bounds);
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: sw,
    color: hexToRgbPdf(stroke),
  });
}

function drawShapeArrow(page, s, grid, bounds) {
  drawShapeLine(page, s, grid, bounds);
  var x1 = gridToPdfX(s.x1, grid, bounds);
  var y1 = gridPointToPdfY(s.y1, grid, bounds);
  var x2 = gridToPdfX(s.x2, grid, bounds);
  var y2 = gridPointToPdfY(s.y2, grid, bounds);
  var stroke = s.attrs.stroke ? toHex(s.attrs.stroke) : '#94a3b8';
  var sw = strokeWidthPt(s.attrs, bounds);

  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  var ux = dx / len, uy = dy / len;
  var px = -uy, py = ux; // perpendicular unit vector
  var headLen = Math.max(4, sw * 5);
  var headHalfWidth = Math.max(2, sw * 2.2);
  var baseX = x2 - ux * headLen;
  var baseY = y2 - uy * headLen;
  var leftX = baseX + px * headHalfWidth;
  var leftY = baseY + py * headHalfWidth;
  var rightX = baseX - px * headHalfWidth;
  var rightY = baseY - py * headHalfWidth;

  // Filled triangle via SVG path. Local coords: origin = (tipX, tipY).
  // pdf-lib flips y, so we author the path in y-down as usual. Local x/y
  // deltas are the same sign in y-down and y-up? No — pdf-lib passes the
  // path through `moveTo`/etc. which treat positive y as "down in SVG".
  // Since we're passing the origin as the PDF-coord position of the SVG's
  // (0,0), and our deltas in PDF space have a flipped sign relative to SVG
  // space, translate: localY_svg = -(pdf_y - tipY). Simpler: compute
  // left/right in PDF coords and just use their deltas in PDF space,
  // then negate the y deltas when building the d path (to match y-down).
  var lDx = leftX - x2, lDy = -(leftY - y2);
  var rDx = rightX - x2, rDy = -(rightY - y2);
  var d = 'M 0 0 L ' + lDx + ' ' + lDy + ' L ' + rDx + ' ' + rDy + ' Z';
  page.drawSvgPath(d, {
    x: x2, y: y2,
    color: hexToRgbPdf(stroke),
    borderWidth: 0,
  });
}

function drawShapePolygon(page, s, grid, bounds) {
  if (!s.points || s.points.length < 2) return;
  var SDocShapes = window.SDocShapes;
  var bb = SDocShapes.bboxOf(s);
  var bbX = gridToPdfX(bb.x, grid, bounds);
  var bbYTop = gridTopToPdfY(bb.y, grid, bounds);
  var bbW = gridToPdfW(bb.w, grid, bounds);
  var bbH = gridToPdfH(bb.h, grid, bounds);

  function lx(gx) { return bb.w > 0 ? (gx - bb.x) * bbW / bb.w : 0; }
  function ly(gy) { return bb.h > 0 ? (gy - bb.y) * bbH / bb.h : 0; }

  var pts = s.points;
  var d = 'M ' + lx(pts[0].x) + ' ' + ly(pts[0].y);
  for (var i = 1; i < pts.length; i++) {
    var p = pts[i];
    if (p.curve) {
      var prev = pts[i - 1];
      var mx = (prev.x + p.x) / 2, my = (prev.y + p.y) / 2;
      d += ' Q ' + lx(p.x) + ' ' + ly(p.y) + ' ' + lx(mx) + ' ' + ly(my);
      d += ' L ' + lx(p.x) + ' ' + ly(p.y);
    } else {
      d += ' L ' + lx(p.x) + ' ' + ly(p.y);
    }
  }
  d += ' Z';

  var fill = s.attrs.fill ? toHex(s.attrs.fill) : '#ffffff';
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, bounds) : 0;
  var opts = { x: bbX, y: bbYTop };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw;
  }
  page.drawSvgPath(d, opts);
}

// ─── Font picking ──────────────────────────────────────

// fonts: { body, bodyBold, heading, headingBold, mono, bodyName, headingName }
// Picks the right pdf-lib font for a DOM element.
//
// - code/pre → mono (semantic, not font-family based, since body/heading
//   embeddings don't include monospace variants)
// - h1-h6 → heading pack (semi/bold for weight >= 600, else heading regular)
// - strong/b/weight >= 600 in prose → bodyBold
// - else → body
//
// We deliberately DO NOT use computed font-family to pick heading vs body —
// when both are the same family (the common case) the heading pack is loaded
// as semi-bold, and selecting it for plain p text would render everything
// looking bold.
function pickFont(el, fonts) {
  if (el.closest && el.closest('code, pre')) return fonts.mono;

  var headingEl = el.closest && el.closest('h1, h2, h3, h4, h5, h6');
  var cs = getComputedStyle(el);
  var weight = parseInt(cs.fontWeight) || 400;
  var isBold = weight >= 600;

  if (headingEl) {
    if (isBold) return fonts.headingBold || fonts.heading || fonts.bodyBold || fonts.body;
    return fonts.heading || fonts.body;
  }
  return isBold ? (fonts.bodyBold || fonts.body) : fonts.body;
}

// ─── Text node → per-line groups ───────────────────────

// Walk characters and group consecutive ones whose rects share (approximately)
// the same top. Returns lines with { text, top, bottom, left, right, height }.
function linesForTextNode(node) {
  var text = node.textContent;
  if (!text) return [];
  var range = document.createRange();
  var lines = [];
  var current = null;

  for (var i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    var cr = range.getBoundingClientRect();
    var ch = text.charAt(i);

    // Zero-width characters at line boundaries (soft-wrap spaces, end-of-line
    // newlines) — attach to current line but don't reposition anything.
    if (!cr.width && !cr.height) {
      if (current) current.text += ch;
      continue;
    }

    // Group by "same line" using line-height epsilon. Round the top to
    // 0.5px buckets so sub-pixel jitter from mixed-size inline runs doesn't
    // create phantom line breaks.
    var sameLine = current && Math.abs(current.top - cr.top) < Math.max(2, cr.height * 0.4);
    if (sameLine) {
      current.text += ch;
      current.right = Math.max(current.right, cr.right);
      if (cr.height > current.height) current.height = cr.height;
    } else {
      current = {
        text: ch,
        top: cr.top,
        bottom: cr.bottom,
        left: cr.left,
        right: cr.right,
        height: cr.height,
      };
      lines.push(current);
    }
  }

  return lines;
}

// ─── Block decorations ─────────────────────────────────

function drawPreBackground(pre, stageRect, page, bounds) {
  var cs = getComputedStyle(pre);
  var bg = rgbStrToHex(cs.backgroundColor);
  if (!bg) return;
  var rect = pre.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  var radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
  drawRoundedRect(page, {
    x: stageToPdfX(rect.left, stageRect, bounds),
    y: stageToPdfY(rect.top, stageRect, bounds),
    width: rect.width * stageScaleX(stageRect, bounds),
    height: rect.height * stageScaleY(stageRect, bounds),
    radius: radiusPx * stageScaleY(stageRect, bounds),
    color: bg,
  });
}

function drawBlockquoteBorder(bq, stageRect, page, bounds) {
  var cs = getComputedStyle(bq);
  var borderLeftColor = rgbStrToHex(cs.borderLeftColor);
  var borderLeftWidth = parseFloat(cs.borderLeftWidth) || 0;
  if (!borderLeftColor || borderLeftWidth < 0.1) return;
  var rect = bq.getBoundingClientRect();
  if (rect.height <= 0) return;
  drawRoundedRect(page, {
    x: stageToPdfX(rect.left, stageRect, bounds),
    y: stageToPdfY(rect.top, stageRect, bounds),
    width: borderLeftWidth * stageScaleX(stageRect, bounds),
    height: rect.height * stageScaleY(stageRect, bounds),
    radius: 0,
    color: borderLeftColor,
  });
}

// Inline <code> pills. element.getClientRects() returns per-line border-box
// rects including padding, so one pill per fragment works correctly.
function drawInlineCodePill(code, stageRect, page, bounds) {
  if (code.parentElement && code.parentElement.tagName === 'PRE') return;
  var cs = getComputedStyle(code);
  var bg = rgbStrToHex(cs.backgroundColor);
  if (!bg) return;
  var radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
  var rects = code.getClientRects();
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (r.width <= 0 || r.height <= 0) continue;
    drawRoundedRect(page, {
      x: stageToPdfX(r.left, stageRect, bounds),
      y: stageToPdfY(r.top, stageRect, bounds),
      width: r.width * stageScaleX(stageRect, bounds),
      height: r.height * stageScaleY(stageRect, bounds),
      radius: radiusPx * stageScaleY(stageRect, bounds),
      color: bg,
    });
  }
}

// ─── Link underlines ──────────────────────────────────

function drawLinkUnderline(a, stageRect, page, bounds) {
  var cs = getComputedStyle(a);
  var dec = (cs.textDecorationLine || cs.textDecoration || '');
  if (dec.indexOf('underline') < 0) return;
  var colorHex = rgbStrToHex(cs.color) || '#2563eb';
  var fontPx = parseFloat(cs.fontSize);
  if (!(fontPx > 0)) return;
  var scY = stageScaleY(stageRect, bounds);
  var rects = a.getClientRects();
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (r.width <= 0) continue;
    var underlineStageY = r.top + r.height * 0.85;
    var pdfY = stageToPdfY(underlineStageY, stageRect, bounds);
    page.drawLine({
      start: { x: stageToPdfX(r.left, stageRect, bounds), y: pdfY },
      end: { x: stageToPdfX(r.right, stageRect, bounds), y: pdfY },
      thickness: Math.max(0.4, fontPx * 0.05 * scY),
      color: hexToRgbPdf(colorHex),
    });
  }
}

// ─── List markers ─────────────────────────────────────

// Approximate marker position: li.left - 0.75em of the li's computed font
// size. Vertically align to the first visual line of the li's content.
function drawListMarker(li, stageRect, page, bounds, fonts) {
  var parent = li.parentElement;
  if (!parent) return;
  var ordered = parent.tagName === 'OL';
  var cs = getComputedStyle(li);
  var fontPx = parseFloat(cs.fontSize);
  if (!(fontPx > 0)) return;
  var colorHex = rgbStrToHex(cs.color) || '#000000';

  var range = document.createRange();
  range.selectNodeContents(li);
  var rects = range.getClientRects();
  if (!rects.length) return;
  var firstLine = rects[0];
  if (!(firstLine.height > 0)) return;

  var marker;
  if (ordered) {
    var siblings = parent.querySelectorAll(':scope > li');
    var idx = 1;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] === li) { idx = i + 1; break; }
    }
    marker = idx + '.';
  } else {
    marker = '\u2022';
  }

  var liRect = li.getBoundingClientRect();
  var markerLeftStage = liRect.left - fontPx * 0.75;
  var baselineStage = firstLine.top + firstLine.height * BASELINE_RATIO;

  page.drawText(marker, {
    x: stageToPdfX(markerLeftStage, stageRect, bounds),
    y: stageToPdfY(baselineStage, stageRect, bounds),
    size: stagePxToPt(fontPx, stageRect, bounds),
    font: fonts.body,
    color: hexToRgbPdf(colorHex),
  });
}

// ─── Text drawing ─────────────────────────────────────

function drawTextNode(node, stageRect, page, bounds, fonts) {
  var text = node.textContent;
  if (!text || !/\S/.test(text)) return;
  var parent = node.parentElement;
  if (!parent) return;

  var cs = getComputedStyle(parent);
  var fontPx = parseFloat(cs.fontSize);
  if (!(fontPx > 0)) return;
  var fontPt = stagePxToPt(fontPx, stageRect, bounds);
  if (fontPt < 0.5) return; // too small to render meaningfully

  var font = pickFont(parent, fonts);
  if (!font) return;

  // Color precedence: inline code inherits its own color in the shadow CSS
  // (--md-code-color), so getComputedStyle on the parent <code> gives it to
  // us directly.
  var colorHex = rgbStrToHex(cs.color) || '#000000';
  var color = hexToRgbPdf(colorHex);

  var lines = linesForTextNode(node);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (!/\S/.test(ln.text)) continue;
    // Two things to handle:
    //   1. pdf-lib treats \n/\r in drawText as a hard newline and cascades
    //      subsequent drawText calls below — replace whitespace runs with a
    //      single space so the string is always one visual line.
    //   2. Keep leading whitespace: ln.left points at the first char's rect
    //      (which might be a space). Stripping "text" but drawing at the
    //      space's x would shift the visible text leftward into the
    //      preceding run.
    var drawText = ln.text.replace(/\s+/g, ' ').replace(/\s+$/, '');
    if (!drawText) continue;

    var baselineStageY = ln.top + ln.height * BASELINE_RATIO;
    var pdfX = stageToPdfX(ln.left, stageRect, bounds);
    var pdfY = stageToPdfY(baselineStageY, stageRect, bounds);


    try {
      page.drawText(drawText, {
        x: pdfX,
        y: pdfY,
        size: fontPt,
        font: font,
        color: color,
      });
    } catch (e) {
      // pdf-lib throws if a glyph is missing from the subset. Fall back to
      // body font (which should cover basic Latin).
      if (font !== fonts.body) {
        try {
          page.drawText(drawText, {
            x: pdfX, y: pdfY, size: fontPt, font: fonts.body, color: color,
          });
        } catch (e2) { /* give up on this run */ }
      }
    }
  }
}

// ─── Shape content (decorations + text) ────────────────

function drawShapeContent(container, stageRect, page, bounds, fonts) {
  var shapeMd = container.querySelector('.shape-md');
  if (!shapeMd || !shapeMd.shadowRoot) return;
  var inner = shapeMd.shadowRoot.querySelector('.inner');
  if (!inner) return;

  // Block decorations first (painted behind text).
  var pres = inner.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) drawPreBackground(pres[i], stageRect, page, bounds);

  var bqs = inner.querySelectorAll('blockquote');
  for (var j = 0; j < bqs.length; j++) drawBlockquoteBorder(bqs[j], stageRect, page, bounds);

  var codes = inner.querySelectorAll('code');
  for (var k = 0; k < codes.length; k++) drawInlineCodePill(codes[k], stageRect, page, bounds);

  // Link underlines (drawn below text, before text so text sits on top).
  var links = inner.querySelectorAll('a');
  for (var l = 0; l < links.length; l++) drawLinkUnderline(links[l], stageRect, page, bounds);

  // List markers — drawn as text, so they go in the text pass conceptually
  // but we can emit them now.
  var lis = inner.querySelectorAll('li');
  for (var m = 0; m < lis.length; m++) drawListMarker(lis[m], stageRect, page, bounds, fonts);

  // Text nodes.
  var walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT, null);
  var node;
  while ((node = walker.nextNode())) {
    drawTextNode(node, stageRect, page, bounds, fonts);
  }
}

// ─── Main entry ───────────────────────────────────────

async function drawSlide(ctx) {
  var SDocShapes = window.SDocShapes;
  var SDocShapeRender = window.SDocShapeRender;
  if (!SDocShapes || !SDocShapeRender) throw new Error('Shape renderer not loaded');
  if (!window.PDFLib) throw new Error('pdf-lib not loaded');

  var dsl = ctx.dsl;
  var page = ctx.page;
  var bounds = ctx.bounds;
  var fonts = ctx.fonts;

  if (!dsl || !page || !bounds || !fonts) throw new Error('drawSlide: missing ctx fields');

  var parsed = SDocShapes.parse(dsl);
  SDocShapes.resolve(parsed.shapes);
  var grid = parsed.grid;
  var shapes = parsed.shapes;

  var st = createStage(grid.w, grid.h);
  try {
    SDocShapeRender.renderShapes(dsl, st.stage);
    await waitForAutofit(st.stage);

    // Grid background. If the DSL didn't set one, fill white so text has a
    // predictable backdrop (slides commonly rely on an implicit white bg).
    var bg = grid.attrs && grid.attrs.bg ? toHex(grid.attrs.bg) : '#ffffff';
    if (bg) {
      page.drawRectangle({
        x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h,
        color: hexToRgbPdf(bg),
      });
    }

    // Draw shape primitives from the parsed data (not DOM) — faster and
    // avoids SVG-to-PDF coord conversion hell.
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      try {
        if (s.kind === 'r') drawShapeRect(page, s, grid, bounds);
        else if (s.kind === 'c') drawShapeCircle(page, s, grid, bounds);
        else if (s.kind === 'e') drawShapeEllipse(page, s, grid, bounds);
        else if (s.kind === 'l') drawShapeLine(page, s, grid, bounds);
        else if (s.kind === 'a') drawShapeArrow(page, s, grid, bounds);
        else if (s.kind === 'p') drawShapePolygon(page, s, grid, bounds);
      } catch (err) {
        if (window.console) console.warn('slide-pdf shape draw failed:', err);
      }
    }

    // Draw text content from the rendered DOM.
    var stageRect = st.stage.getBoundingClientRect();
    var textContainers = st.stage.querySelectorAll('.shape-rect, .shape-text');
    for (var j = 0; j < textContainers.length; j++) {
      try {
        drawShapeContent(textContainers[j], stageRect, page, bounds, fonts);
      } catch (err) {
        if (window.console) console.warn('slide-pdf text draw failed:', err);
      }
    }
  } finally {
    if (st.wrap.parentNode) st.wrap.parentNode.removeChild(st.wrap);
  }
}

window.SDocSlidePdf = {
  drawSlide: drawSlide,
  STAGE_W: STAGE_W,
  STAGE_H: STAGE_H,
};

})();
