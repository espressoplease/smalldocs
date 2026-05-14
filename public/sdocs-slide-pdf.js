// sdocs-slide-pdf.js — Draw a rendered slide onto a pdf-lib page as real PDF
// primitives (shapes + text). Produces a PDF with selectable, extractable
// text — no rasterization, no print dialog.
//
// Flow:
//   1. Parse DSL → get shape geometry in grid units.
//   2. Render the slide into an off-screen 1280x720 stage. The renderer
//      already does an offscreen reference-size build, so measurement is
//      deterministic and the stage here is only for placing the final DOM
//      somewhere we can read positions from.
//   3. Force one layout pass (renderShapes' autofit is synchronous).
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
//
// The wrap is parented to #_sd_rendered (not document.body) so the slide's
// shadow-DOM content inherits the same --md-* custom properties the
// on-screen render gets: text color, --md-code-bg, --md-bg, etc. Parented
// to body those vars are undefined and getComputedStyle reads the wrong
// colors (default-coloured text turns black, inline-code pills lose their
// tint). position:fixed keeps it out of #_sd_rendered's layout flow.
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
  var host = document.getElementById('_sd_rendered') || document.body;
  host.appendChild(wrap);
  return { wrap: wrap, stage: stage, w: stageW, h: stageH };
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

// ─── Opacity ───────────────────────────────────────────

// Parse a shape's `opacity=` attr to a 0..1 number, or null when absent /
// invalid. Mirrors applyOpacity() in the on-screen renderer.
function shapeOpacity(attrs) {
  if (!attrs || attrs.opacity == null) return null;
  var n = parseFloat(attrs.opacity);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(1, n));
}

// Add pdf-lib `opacity` (fill) and `borderOpacity` (stroke) keys to a draw
// options object when the shape declares opacity=. Per-draw alpha is not a
// perfect match for CSS group opacity on overlapping fill+stroke, but it is
// far closer than ignoring opacity entirely (the prior behaviour).
function applyShapeOpacity(opts, attrs) {
  var op = shapeOpacity(attrs);
  if (op == null) return opts;
  opts.opacity = op;
  opts.borderOpacity = op;
  return opts;
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
  if (opts.opacity != null) pdfOpts.opacity = opts.opacity;
  if (opts.borderOpacity != null) pdfOpts.borderOpacity = opts.borderOpacity;
  page.drawSvgPath(d, pdfOpts);
}

// ─── Shape primitives (from parsed DSL, not DOM) ──────

// DSL strokeWidth in grid units. Default 0.02 - the same "thin neutral
// stroke" default the renderer uses (applySvgStroke / renderArrow). The
// previous 0.15 default rendered un-stroked arrows and lines ~7.5x too
// thick versus the on-screen slide.
function strokeWidthGrid(attrs) {
  var sw = attrs && attrs.strokeWidth != null ? parseFloat(attrs.strokeWidth) : 0.02;
  if (!isFinite(sw) || sw < 0) sw = 0.02;
  return sw;
}

function strokeWidthPt(attrs, grid, bounds) {
  // Convert to PDF points against the slide's bounds — matches how
  // shape-render maps grid units to reference px for the on-screen stage.
  return (strokeWidthGrid(attrs) / grid.w) * bounds.w;
}

// Image bytes fetch + pdf-lib embed. Shared by the image-fill pass below.
// Silently skips shapes whose bytes can't be obtained (CORS failure on external
// URLs, unsupported mime types); a warning is logged so failures don't
// disappear entirely.
async function embedImageForShape(pdfDoc, src) {
  var bytes, mime;
  try {
    var dataUrlMatch = /^data:image\/([^;,]+)([^,]*),(.*)$/.exec(src);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1].toLowerCase();
      var header = dataUrlMatch[2];
      var body = dataUrlMatch[3];
      if (/;base64/.test(header)) {
        var bin = atob(body);
        bytes = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(body));
      }
    } else {
      var resp = await fetch(src);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      bytes = new Uint8Array(await resp.arrayBuffer());
      mime = (resp.headers.get('content-type') || '').split(';')[0].split('/').pop().toLowerCase();
    }
  } catch (e) {
    if (window.console) console.warn('slide-pdf image fetch failed:', src, e && e.message);
    return null;
  }
  try {
    if (mime === 'png') return await pdfDoc.embedPng(bytes);
    if (mime === 'jpeg' || mime === 'jpg') return await pdfDoc.embedJpg(bytes);
    // pdf-lib natively embeds PNG + JPEG only. svg / webp / gif are skipped;
    // authors can pre-convert if they need PDF parity.
    if (window.console) console.info('slide-pdf: mime not embeddable in PDF:', mime, '(skipped)');
    return null;
  } catch (e) {
    if (window.console) console.warn('slide-pdf image embed failed:', src, e && e.message);
    return null;
  }
}

function imageFitForShape(attrs) {
  var v = attrs && attrs.imageFit ? String(attrs.imageFit).toLowerCase() : 'cover';
  return v === 'contain' ? 'contain' : 'cover';
}

// Draw an embedded image into a rectangular region, honouring fit + pos.
// pos: center|top|bottom|left|right. Only these five (matches the CSS path).
function drawImageInRect(page, img, x, yTop, w, h, fit, pos) {
  var iw = img.width, ih = img.height;
  var drawW, drawH;
  if (fit === 'contain') {
    var scaleMeet = Math.min(w / iw, h / ih);
    drawW = iw * scaleMeet;
    drawH = ih * scaleMeet;
  } else {
    var scaleSlice = Math.max(w / iw, h / ih);
    drawW = iw * scaleSlice;
    drawH = ih * scaleSlice;
  }
  // Default: centered in both axes.
  var drawX = x + (w - drawW) / 2;
  var drawYBottom = yTop - h + (h - drawH) / 2;
  if (pos === 'top')         drawYBottom = yTop - drawH;
  else if (pos === 'bottom') drawYBottom = yTop - h;
  else if (pos === 'left')   drawX = x;
  else if (pos === 'right')  drawX = x + w - drawW;
  page.drawImage(img, { x: drawX, y: drawYBottom, width: drawW, height: drawH });
}

// Draw the image for any shape that has `image=` (or legacy `src=`). Caller
// provides the rectangular region the image is clipped/sized to. For the
// `r` shape the region is the shape bounds; for `c`/`p` we use the bbox.
async function drawShapeImage(pdfDoc, page, s, grid, bounds) {
  var src = s.attrs && (s.attrs.image || s.attrs.src);
  if (!src) return;
  var SDocShapes = window.SDocShapes;
  var bb = SDocShapes.bboxOf(s);
  if (!bb) return;
  var x = gridToPdfX(bb.x, grid, bounds);
  var yTop = gridTopToPdfY(bb.y, grid, bounds);
  var w = gridToPdfW(bb.w, grid, bounds);
  var h = gridToPdfH(bb.h, grid, bounds);
  if (w <= 0 || h <= 0) return;

  var img = await embedImageForShape(pdfDoc, src);
  if (!img) return;

  var fit = imageFitForShape(s.attrs);
  var pos = (s.attrs && s.attrs.imagePos) ? String(s.attrs.imagePos) : 'center';
  drawImageInRect(page, img, x, yTop, w, h, fit, pos);
}

function drawShapeRect(page, s, grid, bounds) {
  var x = gridToPdfX(s.x, grid, bounds);
  var yTop = gridTopToPdfY(s.y, grid, bounds);
  var w = gridToPdfW(s.w, grid, bounds);
  var h = gridToPdfH(s.h, grid, bounds);
  if (w <= 0 || h <= 0) return;

  var fill = s.attrs.fill ? toHex(s.attrs.fill) : null;
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, grid, bounds) : 0;

  var radiusPct = s.attrs.radius != null ? parseFloat(s.attrs.radius) : 0.8;
  if (!isFinite(radiusPct) || radiusPct < 0) radiusPct = 0;
  var radiusPt = (radiusPct / 100) * Math.min(w, h);

  if (!fill && !stroke) return;
  drawRoundedRect(page, applyShapeOpacity({
    x: x, y: yTop, width: w, height: h,
    radius: radiusPt,
    color: fill,
    borderColor: stroke,
    borderWidth: sw,
  }, s.attrs));
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
  var sw = stroke ? strokeWidthPt(s.attrs, grid, bounds) : 0;

  var opts = { x: cx, y: cy, size: r };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw;
  }
  applyShapeOpacity(opts, s.attrs);
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
  var sw = stroke ? strokeWidthPt(s.attrs, grid, bounds) : 0;

  var opts = { x: cx, y: cy, xScale: rx, yScale: ry };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw;
  }
  applyShapeOpacity(opts, s.attrs);
  page.drawEllipse(opts);
}

// Quadratic control point (grid coords) for a bowed line/arrow. Mirrors
// renderLine/renderArrow in the on-screen renderer: control = chord
// midpoint offset along the perpendicular by 2 * sagitta. Returns null for
// a degenerate (zero-length) chord.
function bowControlGrid(x1, y1, x2, y2, bow) {
  var dx = x2 - x1, dy = y2 - y1;
  var L = Math.hypot(dx, dy);
  if (L === 0) return null;
  var perpX = dy / L, perpY = -dx / L;
  return {
    cx: (x1 + x2) / 2 + perpX * (2 * bow),
    cy: (y1 + y2) / 2 + perpY * (2 * bow),
  };
}

// Draw a line / arrow shaft (straight or bowed) in PDF coords.
// endTrimGrid shortens the shaft at the (x2,y2) end by that many grid
// units along the end tangent, leaving room for an arrowhead so the
// shaft doesn't poke through it. strokePt overrides the thickness
// (arrows reduce it for short arrows, mirroring renderArrow's effSw).
function drawShaft(page, s, grid, bounds, endTrimGrid, strokePt) {
  var stroke = s.attrs.stroke ? toHex(s.attrs.stroke) : '#94a3b8';
  var sw = strokePt != null ? strokePt : strokeWidthPt(s.attrs, grid, bounds);
  var op = shapeOpacity(s.attrs);
  var scale = bounds.w / grid.w;

  // Bowed shaft: emit the quadratic in grid coords and let drawSvgPath's
  // scale + y-flip place it, the same way drawShapePolygon does.
  if (s.bow != null && s.bow !== 0) {
    var c = bowControlGrid(s.x1, s.y1, s.x2, s.y2, s.bow);
    if (c) {
      var ex = s.x2, ey = s.y2;
      if (endTrimGrid > 0) {
        var tx = s.x2 - c.cx, ty = s.y2 - c.cy;
        var tl = Math.hypot(tx, ty);
        if (tl > 0) {
          ex = s.x2 - (tx / tl) * endTrimGrid;
          ey = s.y2 - (ty / tl) * endTrimGrid;
        }
      }
      var d = 'M ' + s.x1 + ' ' + s.y1 + ' Q ' + c.cx + ' ' + c.cy + ' ' + ex + ' ' + ey;
      var o = {
        x: bounds.x, y: bounds.y + bounds.h, scale: scale,
        borderColor: hexToRgbPdf(stroke), borderWidth: sw / scale,
      };
      if (op != null) o.borderOpacity = op;
      page.drawSvgPath(d, o);
      return;
    }
  }

  var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  var L = Math.hypot(dx, dy);
  var gx2 = s.x2, gy2 = s.y2;
  if (L > 0 && endTrimGrid > 0) {
    gx2 = s.x2 - (dx / L) * endTrimGrid;
    gy2 = s.y2 - (dy / L) * endTrimGrid;
  }
  var lineOpts = {
    start: { x: gridToPdfX(s.x1, grid, bounds), y: gridPointToPdfY(s.y1, grid, bounds) },
    end: { x: gridToPdfX(gx2, grid, bounds), y: gridPointToPdfY(gy2, grid, bounds) },
    thickness: sw,
    color: hexToRgbPdf(stroke),
  };
  if (op != null) lineOpts.opacity = op;
  page.drawLine(lineOpts);
}

function drawShapeLine(page, s, grid, bounds) {
  drawShaft(page, s, grid, bounds, 0, strokeWidthPt(s.attrs, grid, bounds));
}

function drawShapeArrow(page, s, grid, bounds) {
  // Mirror renderArrow: the shaft stops short by 6*effSw so the head's
  // tip - not the shaft's end cap - lands on (x2,y2). Short arrows shrink
  // the effective stroke so the head can't dominate or overshoot. Without
  // the back-off the thick shaft poked through the head, which read as a
  // blocky, oversized arrowhead in the PDF.
  var swGrid = strokeWidthGrid(s.attrs);
  var chordGrid = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  if (chordGrid <= 0) return;
  var effSwGrid = swGrid;
  if (6 * swGrid > chordGrid * 0.5) effSwGrid = (chordGrid * 0.5) / 6;
  var backoffGrid = 6 * effSwGrid;
  var gridToPt = bounds.w / grid.w;

  drawShaft(page, s, grid, bounds, backoffGrid, effSwGrid * gridToPt);

  // Head: filled triangle, tip at (x2,y2), oriented along the tip tangent.
  // Geometry matches the on-screen SVG marker: 6*effSw long, 6*effSw wide
  // (3*effSw each side of the line).
  var x2 = gridToPdfX(s.x2, grid, bounds);
  var y2 = gridPointToPdfY(s.y2, grid, bounds);
  var tipDx, tipDy;
  if (s.bow != null && s.bow !== 0) {
    var bc = bowControlGrid(s.x1, s.y1, s.x2, s.y2, s.bow);
    if (bc) {
      tipDx = x2 - gridToPdfX(bc.cx, grid, bounds);
      tipDy = y2 - gridPointToPdfY(bc.cy, grid, bounds);
    }
  }
  if (tipDx == null) {
    tipDx = x2 - gridToPdfX(s.x1, grid, bounds);
    tipDy = y2 - gridPointToPdfY(s.y1, grid, bounds);
  }
  var tl = Math.hypot(tipDx, tipDy);
  if (tl < 1e-6) return;
  var ux = tipDx / tl, uy = tipDy / tl;
  var px = -uy, py = ux; // perpendicular unit vector
  var headLen = 6 * effSwGrid * gridToPt;
  var headHalf = 3 * effSwGrid * gridToPt;
  var baseX = x2 - ux * headLen, baseY = y2 - uy * headLen;
  var leftX = baseX + px * headHalf, leftY = baseY + py * headHalf;
  var rightX = baseX - px * headHalf, rightY = baseY - py * headHalf;

  // Filled triangle via SVG path. Local coords: origin = (tipX, tipY).
  // pdf-lib flips SVG y, so negate the y deltas to author in y-down.
  var lDx = leftX - x2, lDy = -(leftY - y2);
  var rDx = rightX - x2, rDy = -(rightY - y2);
  var d = 'M 0 0 L ' + lDx + ' ' + lDy + ' L ' + rDx + ' ' + rDy + ' Z';
  var headOpts = {
    x: x2, y: y2,
    color: hexToRgbPdf(s.attrs.stroke ? toHex(s.attrs.stroke) : '#94a3b8'),
    borderWidth: 0,
  };
  var op = shapeOpacity(s.attrs);
  if (op != null) headOpts.opacity = op;
  page.drawSvgPath(d, headOpts);
}

function drawShapePolygon(page, s, grid, bounds) {
  if (!s.points || s.points.length < 2) return;

  // Emit the exact same path the on-screen renderer draws — segment
  // operators (~ ^h >P * P1 P2) and corner rounding ((r) included — by
  // reusing SDocShapeRender.polyPath. The path comes back in grid
  // coordinates (y-down); drawSvgPath's `scale` + automatic y-flip place
  // it. The grid aspect equals the bounds aspect (the stage is sized from
  // the grid and the page is sized from the grid), so a single uniform
  // scale is correct. scale also multiplies borderWidth, so divide it out.
  var polyPath = window.SDocShapeRender && window.SDocShapeRender.polyPath;
  var d;
  if (polyPath) {
    d = polyPath(s.points);
  } else {
    // Defensive fallback: straight-edged polygon through the vertices.
    var pts = s.points;
    d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (var i = 1; i < pts.length; i++) d += ' L ' + pts[i].x + ' ' + pts[i].y;
    d += ' Z';
  }
  if (!d) return;

  var scale = bounds.w / grid.w;
  var fill = s.attrs.fill ? toHex(s.attrs.fill) : '#ffffff';
  var stroke = s.attrs.stroke && s.attrs.stroke !== 'none' ? toHex(s.attrs.stroke) : null;
  var sw = stroke ? strokeWidthPt(s.attrs, grid, bounds) : 0;
  var opts = { x: bounds.x, y: bounds.y + bounds.h, scale: scale };
  if (fill) opts.color = hexToRgbPdf(fill);
  if (stroke) {
    opts.borderColor = hexToRgbPdf(stroke);
    opts.borderWidth = sw / scale;
  }
  applyShapeOpacity(opts, s.attrs);
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

function drawPreBackground(pre, stageRect, page, bounds, op) {
  var cs = getComputedStyle(pre);
  var bg = rgbStrToHex(cs.backgroundColor);
  if (!bg) return;
  var rect = pre.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  var radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
  var o = {
    x: stageToPdfX(rect.left, stageRect, bounds),
    y: stageToPdfY(rect.top, stageRect, bounds),
    width: rect.width * stageScaleX(stageRect, bounds),
    height: rect.height * stageScaleY(stageRect, bounds),
    radius: radiusPx * stageScaleY(stageRect, bounds),
    color: bg,
  };
  if (op != null) o.opacity = op;
  drawRoundedRect(page, o);
}

function drawBlockquoteBorder(bq, stageRect, page, bounds, op) {
  var cs = getComputedStyle(bq);
  var borderLeftColor = rgbStrToHex(cs.borderLeftColor);
  var borderLeftWidth = parseFloat(cs.borderLeftWidth) || 0;
  if (!borderLeftColor || borderLeftWidth < 0.1) return;
  var rect = bq.getBoundingClientRect();
  if (rect.height <= 0) return;
  var o = {
    x: stageToPdfX(rect.left, stageRect, bounds),
    y: stageToPdfY(rect.top, stageRect, bounds),
    width: borderLeftWidth * stageScaleX(stageRect, bounds),
    height: rect.height * stageScaleY(stageRect, bounds),
    radius: 0,
    color: borderLeftColor,
  };
  if (op != null) o.opacity = op;
  drawRoundedRect(page, o);
}

// Inline <code> pills. element.getClientRects() returns per-line border-box
// rects including padding, so one pill per fragment works correctly.
function drawInlineCodePill(code, stageRect, page, bounds, op) {
  if (code.parentElement && code.parentElement.tagName === 'PRE') return;
  var cs = getComputedStyle(code);
  var bg = rgbStrToHex(cs.backgroundColor);
  if (!bg) return;
  var radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
  var rects = code.getClientRects();
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (r.width <= 0 || r.height <= 0) continue;
    var o = {
      x: stageToPdfX(r.left, stageRect, bounds),
      y: stageToPdfY(r.top, stageRect, bounds),
      width: r.width * stageScaleX(stageRect, bounds),
      height: r.height * stageScaleY(stageRect, bounds),
      radius: radiusPx * stageScaleY(stageRect, bounds),
      color: bg,
    };
    if (op != null) o.opacity = op;
    drawRoundedRect(page, o);
  }
}

// ─── Link underlines ──────────────────────────────────

function drawLinkUnderline(a, stageRect, page, bounds, op) {
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
    var lo = {
      start: { x: stageToPdfX(r.left, stageRect, bounds), y: pdfY },
      end: { x: stageToPdfX(r.right, stageRect, bounds), y: pdfY },
      thickness: Math.max(0.4, fontPx * 0.05 * scY),
      color: hexToRgbPdf(colorHex),
    };
    if (op != null) lo.opacity = op;
    page.drawLine(lo);
  }
}

// ─── List markers ─────────────────────────────────────

// Approximate marker position: li.left - 0.75em of the li's computed font
// size. Vertically align to the first visual line of the li's content.
function drawListMarker(li, stageRect, page, bounds, fonts, op) {
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

  var mo = {
    x: stageToPdfX(markerLeftStage, stageRect, bounds),
    y: stageToPdfY(baselineStage, stageRect, bounds),
    size: stagePxToPt(fontPx, stageRect, bounds),
    font: fonts.body,
    color: hexToRgbPdf(colorHex),
  };
  if (op != null) mo.opacity = op;
  page.drawText(marker, mo);
}

// ─── Text drawing ─────────────────────────────────────

function drawTextNode(node, stageRect, page, bounds, fonts, op) {
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


    var txtOpts = { x: pdfX, y: pdfY, size: fontPt, font: font, color: color };
    if (op != null) txtOpts.opacity = op;
    try {
      page.drawText(drawText, txtOpts);
    } catch (e) {
      // pdf-lib throws if a glyph is missing from the subset. Fall back to
      // body font (which should cover basic Latin).
      if (font !== fonts.body) {
        try {
          var fbOpts = { x: pdfX, y: pdfY, size: fontPt, font: fonts.body, color: color };
          if (op != null) fbOpts.opacity = op;
          page.drawText(drawText, fbOpts);
        } catch (e2) { /* give up on this run */ }
      }
    }
  }
}

// ─── Rich blocks (chart / mermaid / math) ──────────────

// The renderer turns ```chart / ```mermaid fences and $$...$$ math into
// non-text DOM inside the shape's shadow root: a Chart.js <canvas>, a
// Mermaid <svg>, KaTeX HTML. The text walker can't reproduce those, so
// they're rasterized to PNG and embedded as images at their DOM box.
var RICH_BLOCK_SELECTOR = '.sdoc-chart, .sdoc-mermaid, .sdocs-math-display, .sdocs-math-inline';

function richBlockKind(el) {
  if (el.classList.contains('sdoc-chart')) return 'chart';
  if (el.classList.contains('sdoc-mermaid')) return 'mermaid';
  if (el.classList.contains('sdocs-math-display') ||
      el.classList.contains('sdocs-math-inline')) return 'math';
  return null;
}

// Poll until every chart / mermaid / math block inside the stage's shadow
// roots has finished its async (CDN-loaded) render, or the timeout fires.
// drawSlide must wait for this before reading the DOM, otherwise it
// snapshots half-rendered (or still-source) blocks.
function waitForShadowBlocks(stage, timeoutMs) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + (timeoutMs || 6000);
    function ready() {
      var hosts = stage.querySelectorAll('.shape-md');
      for (var i = 0; i < hosts.length; i++) {
        var root = hosts[i].shadowRoot;
        if (!root) continue;
        // Chart code blocks not yet swapped for a sized canvas. An errored
        // chart keeps its <pre> but is marked, so it counts as "done".
        var chartCodes = root.querySelectorAll('code.language-chart');
        for (var a = 0; a < chartCodes.length; a++) {
          var cp = chartCodes[a].closest('pre');
          if (cp && !cp.classList.contains('sdoc-chart-error')) return false;
        }
        var canvases = root.querySelectorAll('.sdoc-chart canvas');
        for (var b = 0; b < canvases.length; b++) {
          if (!(canvases[b].width > 0 && canvases[b].height > 0)) return false;
        }
        // Mermaid code blocks not yet swapped for an <svg> (or an error msg).
        if (root.querySelector('code.language-mermaid')) return false;
        var merms = root.querySelectorAll('.sdoc-mermaid');
        for (var m = 0; m < merms.length; m++) {
          if (!merms[m].querySelector('svg') &&
              !(merms[m].textContent && merms[m].textContent.trim())) return false;
        }
        // KaTeX not yet rendered into its placeholder.
        var maths = root.querySelectorAll('.sdocs-math-display, .sdocs-math-inline');
        for (var k = 0; k < maths.length; k++) {
          if (!maths[k].querySelector('.katex') && !maths[k]._katexDone) return false;
        }
      }
      return true;
    }
    (function tick() {
      var done = false;
      try { done = ready(); } catch (e) { done = true; }
      if (done || Date.now() > deadline) return resolve();
      setTimeout(tick, 50);
    })();
  });
}

// Rasterize one rich block and draw it as a PNG at its on-stage box.
async function drawRichBlock(el, kind, stageRect, page, bounds, pdfDoc, op) {
  var target = el;          // element whose box positions the image
  var dataUrl = null;
  var padX = 0, padY = 0;   // image overhang beyond `target`'s box

  if (kind === 'chart') {
    var canvas = el.querySelector('canvas');
    if (!canvas) return;
    target = canvas;
    // tuneConfigForSlide already renders the canvas at >=2x DPR, so a plain
    // snapshot is crisp enough for print without re-rendering.
    try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { return; }
  } else if (kind === 'mermaid') {
    var svg = el.querySelector('svg');
    if (!svg || !window.SDocs || !window.SDocs.rasterizeMermaidWrapper) return;
    target = svg;
    dataUrl = await window.SDocs.rasterizeMermaidWrapper(el);
  } else if (kind === 'math') {
    if (!window.SDocs || !window.SDocs.rasterizeMathElement) return;
    var res = await window.SDocs.rasterizeMathElement(el);
    if (res) {
      dataUrl = res.dataUrl;
      var r0 = el.getBoundingClientRect();
      // rasterizeMathEl pads the capture a few px each side; spread that
      // overhang around `el`'s box so the formula isn't squished.
      padX = Math.max(0, (res.width - r0.width) / 2);
      padY = Math.max(0, (res.height - r0.height) / 2);
    }
  }
  if (!dataUrl) return;

  var rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  var img;
  try { img = await pdfDoc.embedPng(dataUrl); } catch (e) { return; }

  var scX = stageScaleX(stageRect, bounds), scY = stageScaleY(stageRect, bounds);
  var w = (rect.width + padX * 2) * scX;
  var h = (rect.height + padY * 2) * scY;
  var x = stageToPdfX(rect.left - padX, stageRect, bounds);
  var yTop = stageToPdfY(rect.top - padY, stageRect, bounds);
  var drawOpts = { x: x, y: yTop - h, width: w, height: h };
  if (op != null) drawOpts.opacity = op;
  page.drawImage(img, drawOpts);
}

// Table cell backgrounds + borders. Markdown tables have no colspan /
// rowspan, so every td/th is a clean grid cell; drawing each cell's box
// reproduces the grid (shared edges draw twice, which is harmless).
function drawTableCells(table, stageRect, page, bounds, op) {
  var cells = table.querySelectorAll('td, th');
  var scX = stageScaleX(stageRect, bounds), scY = stageScaleY(stageRect, bounds);
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var r = cell.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    var cs = getComputedStyle(cell);
    var bg = rgbStrToHex(cs.backgroundColor);
    var bw = parseFloat(cs.borderTopWidth) || 0;
    var bc = rgbStrToHex(cs.borderTopColor);
    var o = {
      x: stageToPdfX(r.left, stageRect, bounds),
      y: stageToPdfY(r.top, stageRect, bounds),
      width: r.width * scX,
      height: r.height * scY,
      radius: 0,
    };
    if (bg) o.color = bg;
    if (bc && bw > 0.1) {
      o.borderColor = bc;
      o.borderWidth = Math.max(0.3, bw * scY);
    }
    if (op != null) { o.opacity = op; o.borderOpacity = op; }
    if (o.color || o.borderColor) drawRoundedRect(page, o);
  }
}

// ─── Shape content (decorations + text) ────────────────

async function drawShapeContent(container, stageRect, page, bounds, fonts, pdfDoc) {
  var shapeMd = container.querySelector('.shape-md');
  if (!shapeMd || !shapeMd.shadowRoot) return;
  var inner = shapeMd.shadowRoot.querySelector('.inner');
  if (!inner) return;

  // Shape opacity: the renderer fades the whole shape (fill, stroke, text)
  // together via `opacity=`. Read the container's computed opacity so text
  // and decorations fade to match. null = fully opaque (no opacity key
  // added to draw calls).
  var op = null;
  try {
    var cv = parseFloat(getComputedStyle(container).opacity);
    if (!isNaN(cv) && cv < 1) op = cv;
  } catch (e) {}

  // Each decoration/text pass is isolated so one element that fails (a
  // missing glyph, a zero-size rect) can't abort the rest of the shape's
  // content the way an unguarded throw used to.
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn('slide-pdf content:', e && e.message); } }
  // True for any node inside a rich block (chart / mermaid / math). Those
  // are drawn as rasterized images, so their inner text / decorations must
  // not be drawn again on top.
  function inRich(el) { return !!(el && el.closest && el.closest(RICH_BLOCK_SELECTOR)); }

  // Rich blocks first: rasterized images sit behind any plain text.
  var richBlocks = inner.querySelectorAll(RICH_BLOCK_SELECTOR);
  for (var ri = 0; ri < richBlocks.length; ri++) {
    var rel = richBlocks[ri];
    var kind = richBlockKind(rel);
    if (!kind) continue;
    try {
      await drawRichBlock(rel, kind, stageRect, page, bounds, pdfDoc, op);
    } catch (e) {
      if (window.console) console.warn('slide-pdf rich block:', e && e.message);
    }
  }

  // Table cells (background + borders).
  var tables = inner.querySelectorAll('table');
  for (var t = 0; t < tables.length; t++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawTableCells(el, stageRect, page, bounds, op); });
  })(tables[t]);

  // Block decorations (painted behind text).
  var pres = inner.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawPreBackground(el, stageRect, page, bounds, op); });
  })(pres[i]);

  var bqs = inner.querySelectorAll('blockquote');
  for (var j = 0; j < bqs.length; j++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawBlockquoteBorder(el, stageRect, page, bounds, op); });
  })(bqs[j]);

  var codes = inner.querySelectorAll('code');
  for (var k = 0; k < codes.length; k++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawInlineCodePill(el, stageRect, page, bounds, op); });
  })(codes[k]);

  // Link underlines (drawn below text, before text so text sits on top).
  var links = inner.querySelectorAll('a');
  for (var l = 0; l < links.length; l++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawLinkUnderline(el, stageRect, page, bounds, op); });
  })(links[l]);

  // List markers — drawn as text, so they go in the text pass conceptually
  // but we can emit them now.
  var lis = inner.querySelectorAll('li');
  for (var m = 0; m < lis.length; m++) (function (el) {
    if (inRich(el)) return;
    safe(function () { drawListMarker(el, stageRect, page, bounds, fonts, op); });
  })(lis[m]);

  // Text nodes (skip anything inside a rasterized rich block).
  var walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT, null);
  var node;
  while ((node = walker.nextNode())) {
    (function (n) {
      if (inRich(n.parentElement)) return;
      safe(function () { drawTextNode(n, stageRect, page, bounds, fonts, op); });
    })(node);
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
    // Force layout so getBoundingClientRect reflects the final geometry.
    // eslint-disable-next-line no-unused-expressions
    st.stage.offsetHeight;

    // Grid background. The DSL `grid ... bg=` wins; otherwise match the
    // on-screen stage, which inherits the document's --md-bg (white in the
    // light theme, dark in dark mode). Falls back to white if the var can't
    // be read. Reading it off the stage works because createStage parents
    // the wrap inside #_sd_rendered.
    var bg;
    if (grid.attrs && grid.attrs.bg) {
      bg = toHex(grid.attrs.bg);
    } else {
      var mdBg = '';
      try { mdBg = getComputedStyle(st.stage).getPropertyValue('--md-bg').trim(); } catch (e) {}
      bg = toHex(mdBg) || '#ffffff';
    }
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

    // Second pass: async image fills. Any shape can carry `image=`/`src=`;
    // image paints above its shape's vector fill/stroke, matching the CSS
    // stacking on screen (background-color → background-image → border).
    for (var ii = 0; ii < shapes.length; ii++) {
      var si = shapes[ii];
      if (!si.attrs || !(si.attrs.image || si.attrs.src)) continue;
      // Only shapes with a rectangular bounding region receive image fill
      // in the PDF path. Lines/arrows don't have a fillable region.
      if (si.kind !== 'r' && si.kind !== 'c' && si.kind !== 'p' && si.kind !== 'e') continue;
      try {
        await drawShapeImage(ctx.pdfDoc, page, si, grid, bounds);
      } catch (err) {
        if (window.console) console.warn('slide-pdf image draw failed:', err);
      }
    }

    // Charts / Mermaid / Math inside shapes render asynchronously (CDN
    // loads + their own render passes). Wait for them to settle before
    // snapshotting the DOM, or they'd be captured as source / half-drawn.
    await waitForShadowBlocks(st.stage);

    // Draw text + rich content from the rendered DOM.
    var stageRect = st.stage.getBoundingClientRect();
    var textContainers = st.stage.querySelectorAll('.shape-rect, .shape-text');
    for (var j = 0; j < textContainers.length; j++) {
      try {
        await drawShapeContent(textContainers[j], stageRect, page, bounds, fonts, ctx.pdfDoc);
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
