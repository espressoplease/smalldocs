// sdocs-slide-pptx.js — Map a parsed slide DSL onto a real PowerPoint slide
// using PptxGenJS. Output is editable in PowerPoint / Keynote / Google
// Slides: native shapes stay as shapes, text lives INSIDE its shape (so it
// reflows when the user resizes), and only non-mappable geometry (cloud
// variants, speech-bubble tails, polygons, icons) round-trips through an
// embedded PNG.
//
// Flow (per slide):
//   1. Parse DSL → grid + shape list.
//   2. Render off-stage so charts / mermaid / math have a real layout.
//   3. For each shape, ask shapeStrategy() whether to draw it as a native
//      PowerPoint primitive, a custom freeform path, or a rasterised PNG.
//      The decision lives in ONE place so adding a new shape kind is a
//      single-line change.
//   4. Native shapes get text-with-shape via `addText({ shape: ... })`,
//      which produces ONE pptx element the user can both resize and re-edit.
//   5. Rasterised shapes draw their geometry as a picture, then layer any
//      text as a separate free-floating text frame (less ideal, but the
//      geometry isn't editable either way).
//   6. Rich blocks (chart / mermaid / math) measure their INTRINSIC SVG /
//      canvas (not the wrapper, which is 100% width) and embed as PNG
//      preserving aspect.
//
// Coordinate system:
//   - DSL grid: y grows DOWN, units are arbitrary.
//   - pptx: y grows DOWN, units are INCHES.

(function () {
'use strict';

// ─── Constants ──────────────────────────────────────────────

// PowerPoint widescreen default. Per-slide layouts override; this is the
// font-scale reference (a 13.333" slide uses base role sizes; narrower
// layouts shrink proportionally).
var REF_SLIDE_W_IN = 13.333;
// On-screen stage is rendered at this width before being scaled to the
// target slide; used for off-stage layout + for px → pt font conversion.
var STAGE_REF_PX_W = 1280;
// Default stroke colour when the DSL omits it. Matches the on-screen
// renderer's "thin neutral stroke" (Tailwind slate-400).
var DEFAULT_STROKE_HEX = '94A3B8';
// Default text colour when the shape doesn't pick one and the fill isn't
// dark enough to need inversion. Matches the on-screen renderer's
// --md-color (Tailwind slate-900 / SDocs navy).
var DEFAULT_TEXT_HEX = '0F1E3A';
// Muted text colour for the `caption` role on light fills.
var CAPTION_TEXT_HEX = '6B7280';
// Lighter caption tint for dark fills (washed white instead of full white
// so it still reads as "caption, not title").
var CAPTION_ON_DARK_HEX = 'BDC3CC';

// Font fallback chains. PptxGenJS accepts a single comma-separated string;
// each viewer walks the list and picks the first installed family. Order
// matters:
//   - Inter / Merriweather / Menlo first so users who installed the
//     on-screen font locally get the exact match.
//   - Aptos / Cambria / Consolas next — ship with Office 365 (Aptos since
//     2024, the others for years).
//   - Calibri / Helvetica Neue / Courier New cover older Office, Keynote,
//     macOS / iOS, and any remaining Windows install.
//   - Generic family terminator so Google Slides + browser previews still
//     land on something readable.
var SANS_CHAIN = 'Inter, Aptos, Calibri, Helvetica Neue, Arial, sans-serif';
var SERIF_CHAIN = 'Merriweather, Cambria, Georgia, Times New Roman, serif';
var MONO_CHAIN = 'Menlo, Consolas, Courier New, monospace';

// Family-name sets used to classify the on-screen font into one of the
// three chains. Anything not in serif/mono is treated as sans (the
// SDocs picker's default category and the safer fallback).
var SERIF_NAMES = {
  'Merriweather': 1, 'Playfair Display': 1, 'Roboto Slab': 1, 'Lora': 1,
  'PT Serif': 1, 'Crimson Text': 1, 'Georgia': 1, 'Times New Roman': 1,
  'Times': 1, 'Cambria': 1,
};
var MONO_NAMES = {
  'Menlo': 1, 'Consolas': 1, 'Courier New': 1, 'Courier': 1,
  'JetBrains Mono': 1, 'Source Code Pro': 1, 'Fira Code': 1,
  'ui-monospace': 1, 'monospace': 1,
};
// Per-rich-block render deadline before we give up and paint the slide
// without it. Charts / mermaid / KaTeX can sit behind their own CDN
// promises on first use; the user-facing flow waits longer than this.
var SHADOW_BLOCK_TIMEOUT_MS = 6000;
// Hard cap on the icon-bundle wait when a slide carries `icon` shapes.
var ICON_BUNDLE_TIMEOUT_MS = 5000;
// Raster scale for rich blocks and shape PNG fallbacks. 2x at 96dpi keeps
// edges crisp at retina render. Hardcoded; rich-block helpers carry their
// own DPR knob and we don't override theirs.
var RASTER_DPR = 2;

// ─── Stage lifecycle ───────────────────────────────────────

// Off-stage host for the rendered shape DOM. Parented to #_sd_rendered
// so the shadow-DOM inside shape-md inherits the document's --md-* CSS
// vars (matching the on-screen render and the PDF exporter).
function createStage(gridW, gridH) {
  var stageH = STAGE_REF_PX_W * gridH / gridW;
  var wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = [
    'position: fixed',
    'left: 0', 'top: 0',
    'width: ' + STAGE_REF_PX_W + 'px',
    'height: ' + stageH + 'px',
    'opacity: 0', 'pointer-events: none',
    'z-index: -1', 'contain: layout paint',
  ].join(';');
  var stage = document.createElement('div');
  stage.style.cssText = 'width: 100%; height: 100%;';
  wrap.appendChild(stage);
  var host = document.getElementById('_sd_rendered') || document.body;
  host.appendChild(wrap);
  return { wrap: wrap, stage: stage };
}

// ─── Colour helpers ────────────────────────────────────────

function toHex6(c) {
  if (!c) return null;
  c = String(c).trim();
  if (c === 'none' || c === 'transparent') return null;
  if (c.charAt(0) === '#') {
    var hex = c.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
    return null;
  }
  var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    return [m[1], m[2], m[3]].map(function (n) {
      var v = parseInt(n, 10);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }
  return null;
}

// Perceived brightness < 128 → treat as dark. Used to flip default text
// colour to white on dark fills so titles like `r ... fill=#0f172a |
// Header` don't render navy-on-navy.
function isHexDark(hex) {
  if (!hex || hex.length !== 6) return false;
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

// ─── Geometry helpers ──────────────────────────────────────

function gridToIn(g, gridDim, slideDim) { return (g / gridDim) * slideDim; }

function shapeRectIn(s, grid, slideW, slideH) {
  var bb = window.SDocShapes.bboxOf(s);
  if (!bb) return null;
  return {
    x: gridToIn(bb.x, grid.w, slideW),
    y: gridToIn(bb.y, grid.h, slideH),
    w: gridToIn(bb.w, grid.w, slideW),
    h: gridToIn(bb.h, grid.h, slideH),
  };
}

function contentRectIn(s, grid, slideW, slideH) {
  var SDocShapes = window.SDocShapes;
  var box = SDocShapes.contentBox ? SDocShapes.contentBox(s) : null;
  if (!box) {
    var bb = SDocShapes.bboxOf(s);
    if (!bb) return null;
    box = bb;
  }
  return {
    x: gridToIn(box.x, grid.w, slideW),
    y: gridToIn(box.y, grid.h, slideH),
    w: gridToIn(box.w, grid.w, slideW),
    h: gridToIn(box.h, grid.h, slideH),
  };
}

// Convert grid-unit strokeWidth to pptx points relative to the actual
// slide width (not the reference width — so a 10"-wide deck doesn't get
// rescaled stroke weights from the 13.333"-wide reference).
function strokeWidthPt(attrs, grid, slideW) {
  var sw = (attrs && attrs.strokeWidth != null) ? parseFloat(attrs.strokeWidth) : 0.02;
  if (!isFinite(sw) || sw <= 0) sw = 0.02;
  var inches = sw * (slideW / grid.w);
  return Math.max(0.25, inches * 72);
}

// ─── Shape attribute helpers ───────────────────────────────

function shapeFill(attrs) {
  if (!attrs || attrs.fill === 'none') return null;
  var hex = toHex6(attrs.fill);
  return hex ? { color: hex } : null;
}

function shapeLine(attrs, swPt) {
  if (!attrs || attrs.stroke === 'none' || !attrs.stroke) return null;
  var hex = toHex6(attrs.stroke);
  if (!hex) return null;
  return { color: hex, width: swPt };
}

function applyOpacity(opts, attrs) {
  if (!attrs || attrs.opacity == null) return;
  var op = parseFloat(attrs.opacity);
  if (!isFinite(op) || op >= 1 || op < 0) return;
  var transparency = Math.round((1 - op) * 100);
  if (opts.fill) opts.fill.transparency = transparency;
  if (opts.line) opts.line.transparency = transparency;
}

function shapeTextRole(attrs) {
  if (!attrs) return null;
  return attrs.text || attrs.role || null;
}

// Per-role px sizes. Tuned so PowerPoint's typical projection sizes
// (title ~44pt, body ~28pt) come out of px × 0.75 at the reference slide
// width. Bumped from the on-screen ROLE_SIZES (body 24, caption 14) so
// the body/caption gap is visible — PowerPoint conventions read at a
// projector distance, on-screen Inter reads up close.
function fontPtForRole(role, slideW) {
  var px = role === 'title' ? 64
         : role === 'subtitle' ? 40
         : role === 'caption' ? 16
         : 28; // body / default
  var scale = (slideW || REF_SLIDE_W_IN) / REF_SLIDE_W_IN;
  return Math.max(8, px * 0.75 * scale);
}

// Title only gets bolded. Subtitle stays regular-weight, distinguished
// from body by size only — matches how SDocs flows headline roles on
// screen, and keeps the title:subtitle weight gap clear.
function isBoldRole(role) { return role === 'title'; }

// Pick a default text colour. Author override (`color=`) wins; otherwise
// invert to white on dark fills so titles like `r ... fill=#0f172a text=title`
// remain legible without manual color= attributes on every slide. Caption
// keeps its muted grey on light backgrounds and softens to a washed tint
// on dark ones (so the role still reads "caption", not "title").
function defaultTextColour(s) {
  if (s.attrs && s.attrs.color) return toHex6(s.attrs.color) || DEFAULT_TEXT_HEX;
  var fillHex = toHex6(s.attrs && s.attrs.fill);
  var darkFill = !!(fillHex && isHexDark(fillHex));
  if (shapeTextRole(s.attrs) === 'caption') {
    return darkFill ? CAPTION_ON_DARK_HEX : CAPTION_TEXT_HEX;
  }
  return darkFill ? 'FFFFFF' : DEFAULT_TEXT_HEX;
}

// Classify a CSS font-family list ("Inter, system-ui, sans-serif") into
// one of sans / serif / mono by matching the FIRST quoted family against
// the known-name sets. Empty / unknown families default to sans.
function classifyFontFamily(familyStr) {
  if (!familyStr) return 'sans';
  // Strip surrounding whitespace + quotes off the first family token.
  var m = String(familyStr).match(/^\s*['"]?([^'",]+?)['"]?(?:\s*,|$)/);
  if (!m) return 'sans';
  var first = m[1].trim();
  if (SERIF_NAMES[first]) return 'serif';
  if (MONO_NAMES[first]) return 'mono';
  return 'sans';
}

// Walk the document's CSS vars to discover the active body + heading
// families. Returns one resolved fallback chain per role bucket so the
// per-shape buildTextOpts call doesn't have to re-classify.
function detectExportFontChains() {
  var host = document.getElementById('_sd_rendered') || document.body;
  var cs;
  try { cs = getComputedStyle(host); } catch (e) { return { body: SANS_CHAIN, heading: SANS_CHAIN }; }
  var bodyFamily = (cs.getPropertyValue('--md-font-family') || '').trim() || cs.fontFamily || '';
  var headingFamily = (cs.getPropertyValue('--md-h-font-family') || '').trim();
  if (!headingFamily || headingFamily === 'inherit') headingFamily = bodyFamily;
  return {
    body: chainFor(classifyFontFamily(bodyFamily)),
    heading: chainFor(classifyFontFamily(headingFamily)),
  };
}

function chainFor(cls) {
  if (cls === 'serif') return SERIF_CHAIN;
  if (cls === 'mono') return MONO_CHAIN;
  return SANS_CHAIN;
}

// Resolve the fontFace string for a shape. Author override (`font=` attr)
// wins — accepts the three keywords or a custom family list. Otherwise
// the role picks: title/subtitle → heading chain, everything else → body.
// Custom families get the SANS_CHAIN appended as a fallback so an unknown
// family name still resolves to something readable.
function resolveFontFace(s, role, chains) {
  var explicit = s.attrs && s.attrs.font;
  if (explicit) {
    var v = String(explicit).trim();
    if (v === 'sans') return SANS_CHAIN;
    if (v === 'serif') return SERIF_CHAIN;
    if (v === 'mono') return MONO_CHAIN;
    return v.indexOf(',') >= 0 ? v : (v + ', ' + SANS_CHAIN);
  }
  return (role === 'title' || role === 'subtitle') ? chains.heading : chains.body;
}

// Default alignment honours an explicit `align=`. Otherwise, title /
// subtitle centre (matching headline conventions); body / caption /
// no-role anchor left (matching how the SDocs renderer flows body text).
function defaultAlign(s) {
  if (s.attrs && s.attrs.align) return s.attrs.align;
  var role = shapeTextRole(s.attrs);
  return (role === 'title' || role === 'subtitle') ? 'center' : 'left';
}

// pptx accepts 't' | 'm' | 'b'.
function pptxValign(s) {
  var v = (s.attrs && s.attrs.valign) || 'middle';
  if (v === 'top') return 't';
  if (v === 'bottom') return 'b';
  return 'm';
}

// Plain-text approximation of shape markdown content. Rich blocks render
// separately as embedded images; their source is stripped so the text
// frame doesn't duplicate them as literal markdown.
function plainTextFromContent(content) {
  if (!content) return '';
  var raw = String(content)
    .replace(/```chart[\s\S]*?```/g, '')
    .replace(/```mermaid[\s\S]*?```/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '');
  // Leading markdown markers per line (#, *, -, >) get stripped. Trade-off:
  // a real text line starting with one of those characters loses it. v1
  // doesn't try to preserve markdown formatting; richer support would walk
  // the rendered shadow DOM and emit per-run pptx text.
  raw = raw.replace(/^[\s>#*\-]+/gm, '').trim();
  return raw.replace(/\s+/g, ' ');
}

// ─── Shape strategy table ──────────────────────────────────
//
// One place that owns "for shape kind K, do we draw a native pptx
// primitive, a freeform path, or fall back to rasterising the rendered
// SVG?". Adding a new shape kind is a single-line change here; the
// dispatch in drawShape reads from this.

function shapeStrategy(s) {
  var k = s.kind;
  // Lines + arrows are always native (pptx has them).
  if (k === 'l' || k === 'a') return 'line';
  // Plain primitives.
  if (k === 'r' || k === 'c' || k === 'e') return 'native';
  // Compound shapes with a clean pptx preset.
  if (k === 'cyl') return 'native';                     // → can
  // `tab` and `doc` both lack a viewer-portable native preset. The OOXML
  // `folderCorner` exists and PowerPoint renders it, but Keynote (the
  // default viewer on macOS / iOS) silently drops it. `foldedCorner`
  // isn't even exposed by PptxGenJS. Rasterise both to keep the visual
  // identical across PowerPoint, Keynote, and Google Slides.
  if (k === 'tab') return 'raster';
  if (k === 'doc') return 'raster';
  // Chevrons: only the default geometry maps cleanly to pptx ChevronType.
  // notch/tip variants and `flat-back` need raster to stay faithful.
  if (k === 'chev') {
    var a = s.attrs || {};
    var isDefault = a.notch == null && a.tip == null;
    return isDefault ? 'native' : 'raster';
  }
  // Clouds: only the default `heroicons` variant matches pptx's preset.
  if (k === 'cloud') {
    var v = (s.attrs && s.attrs.variant) || 'heroicons';
    return v === 'heroicons' ? 'native' : 'raster';
  }
  // Speech bubble tails require OOXML adjustment-point injection that
  // PptxGenJS doesn't expose. Raster keeps tail position + style faithful.
  if (k === 'bub') return 'raster';
  // Polygons round-trip as a freeform shape so vertices stay editable.
  if (k === 'p') return 'custGeom';
  // Icons: always raster (they're 24x24 SVG library content).
  if (k === 'icon') return 'raster';
  return null;
}

// Native pptx ShapeType key. Lookup table; null when no preset matches.
function nativeShapePreset(s) {
  var k = s.kind;
  if (k === 'r') {
    var radiusPct = parseFloat(s.attrs && s.attrs.radius);
    return (isFinite(radiusPct) && radiusPct > 0) ? 'roundRect' : 'rect';
  }
  if (k === 'c' || k === 'e') return 'ellipse';
  if (k === 'chev') return 'chevron';
  if (k === 'cyl') return 'can';
  if (k === 'cloud') return 'cloud';
  return null;
}

// ─── Native shape + text (combined) ─────────────────────────

// Build the geometry options object passed to addShape / addText.
function buildShapeOpts(s, rect, grid, slideW) {
  var swPt = strokeWidthPt(s.attrs, grid, slideW);
  var opts = {
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    fill: shapeFill(s.attrs),
    line: shapeLine(s.attrs, swPt),
  };
  applyOpacity(opts, s.attrs);
  // Whole-shape rotation: shape `rotate=` attr on a primitive. textAngle
  // doesn't go here (it's a text-frame-only rotation handled below).
  if (s.attrs && s.attrs.rotate != null && s.attrs.rotate !== '') {
    var r = parseFloat(s.attrs.rotate);
    if (isFinite(r) && r !== 0) opts.rotate = r;
  }
  return opts;
}

// Build the text-styling options merged into the addText call. Returns
// null when the shape has no usable text content. fontChains comes from
// detectExportFontChains() and is resolved once per drawSlide call.
function buildTextOpts(s, slideW, fontChains) {
  var text = plainTextFromContent(s.content);
  if (!text) return null;
  var role = shapeTextRole(s.attrs);
  var fontSize = fontPtForRole(role, slideW);
  var colorHex = defaultTextColour(s);
  var opts = {
    fontFace: resolveFontFace(s, role, fontChains),
    fontSize: fontSize,
    color: colorHex,
    align: defaultAlign(s),
    valign: pptxValign(s),
    bold: isBoldRole(role),
    italic: role === 'caption',
    wrap: true,
    fit: 'shrink',
    text: text,
  };
  // textAngle rotates the text frame around its centre. For cardinal
  // angles pptx has a cleaner `vert` mode (keeps the shape upright and
  // flips text orientation inside it); fall back to `rotate` for arbitrary
  // angles since not all clients render `vert` consistently.
  if (s.attrs && s.attrs.textAngle != null && s.attrs.textAngle !== '') {
    var ta = parseFloat(s.attrs.textAngle);
    if (isFinite(ta) && ta !== 0) opts.rotate = ta;
  }
  return opts;
}

function drawNativeShape(slide, pres, s, grid, slideW, slideH, fontChains) {
  var rect = shapeRectIn(s, grid, slideW, slideH);
  if (!rect) return;
  var presetKey = nativeShapePreset(s);
  if (!presetKey) return;
  var preset = pres.ShapeType[presetKey];
  if (!preset) return;

  var shapeOpts = buildShapeOpts(s, rect, grid, slideW);
  if (presetKey === 'roundRect') {
    var radiusPct = parseFloat(s.attrs.radius);
    if (isFinite(radiusPct) && radiusPct > 0) {
      shapeOpts.rectRadius = Math.min(0.5, radiusPct / 100);
    }
  }

  var textOpts = buildTextOpts(s, slideW, fontChains);
  // When textAngle is set, the `rotate` option on a combined addShape+text
  // call rotates the whole shape (changing its bbox). The DSL semantics
  // are "rotate the text inside, keep the shape upright" — so we draw the
  // shape and the text as two elements when rotation is involved. Trade-
  // off: rotated text doesn't reflow on shape resize, but that's the
  // rarer authoring case (axis labels, vertical titles).
  var hasTextRotation = textOpts && textOpts.rotate != null;

  if (textOpts && !hasTextRotation) {
    // Combined call: text lives INSIDE the shape, both in the OOXML
    // (`<p:sp><p:txBody>`) and in PowerPoint's editing model. Resizing
    // the shape reflows the text. This is what "editable-first" means.
    var t = textOpts.text;
    delete textOpts.text;
    var combined = Object.assign({}, shapeOpts, textOpts, { shape: preset });
    slide.addText(t, combined);
  } else {
    slide.addShape(preset, shapeOpts);
    if (textOpts) {
      var t2 = textOpts.text;
      delete textOpts.text;
      var contentRect = contentRectIn(s, grid, slideW, slideH) || rect;
      slide.addText(t2, Object.assign({
        x: contentRect.x, y: contentRect.y, w: contentRect.w, h: contentRect.h,
      }, textOpts));
    }
  }
}

function drawLineOrArrow(slide, pres, s, grid, slideW, slideH) {
  var x1 = gridToIn(s.x1, grid.w, slideW);
  var y1 = gridToIn(s.y1, grid.h, slideH);
  var x2 = gridToIn(s.x2, grid.w, slideW);
  var y2 = gridToIn(s.y2, grid.h, slideH);
  var swPt = strokeWidthPt(s.attrs, grid, slideW);
  var x = Math.min(x1, x2), y = Math.min(y1, y2);
  var w = Math.max(0.01, Math.abs(x2 - x1));
  var h = Math.max(0.01, Math.abs(y2 - y1));
  var flipH = (x1 > x2);
  var flipV = (y1 > y2);
  var hex = toHex6((s.attrs && s.attrs.stroke) || ('#' + DEFAULT_STROKE_HEX));
  var line = { color: hex || DEFAULT_STROKE_HEX, width: swPt };
  if (s.kind === 'a') line.endArrowType = 'triangle';
  slide.addShape(pres.ShapeType.line, {
    x: x, y: y, w: w, h: h,
    flipH: flipH, flipV: flipV,
    line: line,
  });
}

// ─── Polygon (custGeom freeform) ───────────────────────────

// PptxGenJS exposes a `custGeom` shape that takes a `points` array
// describing path commands. Mapping the DSL polygon's resolved points
// preserves vertex edit-ability in PowerPoint instead of pinning them
// to a raster. Closed polygon (auto-closes back to the first point).
function drawCustGeomPolygon(slide, pres, s, grid, slideW, slideH, fontChains) {
  var pts = s.points;
  if (!pts || pts.length < 2) return;
  var bb = window.SDocShapes.bboxOf(s);
  if (!bb || bb.w <= 0 || bb.h <= 0) return;

  // PptxGenJS custGeom points are in inches, relative to the shape's
  // x/y origin. Translate the polygon so its bbox starts at (0,0), then
  // scale grid → inches.
  var sx = slideW / grid.w;
  var sy = slideH / grid.h;
  var pathPoints = pts.map(function (p, i) {
    return {
      x: (p.x - bb.x) * sx,
      y: (p.y - bb.y) * sy,
      moveTo: i === 0,
    };
  });
  pathPoints.push({ close: true });

  var rect = shapeRectIn(s, grid, slideW, slideH);
  var swPt = strokeWidthPt(s.attrs, grid, slideW);
  var opts = {
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    fill: shapeFill(s.attrs),
    line: shapeLine(s.attrs, swPt),
    points: pathPoints,
  };
  applyOpacity(opts, s.attrs);

  var textOpts = buildTextOpts(s, slideW, fontChains);
  if (textOpts) {
    var t = textOpts.text;
    delete textOpts.text;
    var combined = Object.assign({}, opts, textOpts, { shape: pres.ShapeType.custGeom });
    slide.addText(t, combined);
  } else {
    slide.addShape(pres.ShapeType.custGeom, opts);
  }
}

// ─── Raster shape (PNG embed) ──────────────────────────────

async function drawShapeViaRaster(slide, s, idx, grid, slideW, slideH, stage) {
  if (!stage) return;
  var wrap = stage.querySelector('.shape-svg[data-shape-idx="' + idx + '"]');
  if (!wrap) return;

  // Use the rendered geometry's real bbox, not the shape's declared bbox.
  // Some shapes draw OUTSIDE their declared bbox (a `bub` tail extends
  // past the bubble body, for example). Falling back to the declared
  // bbox when getBBox isn't reliable keeps simpler shapes working.
  var bb = null;
  try {
    var gb = wrap.getBBox();
    if (gb && gb.width > 0 && gb.height > 0) {
      bb = { x: gb.x, y: gb.y, w: gb.width, h: gb.height };
    }
  } catch (e) { /* getBBox can throw on detached or empty SVG */ }
  if (!bb) {
    var declared = window.SDocShapes.bboxOf(s);
    if (!declared || declared.w <= 0 || declared.h <= 0) return;
    bb = { x: declared.x, y: declared.y, w: declared.w, h: declared.h };
  }

  // Slide placement uses the same (possibly tail-inclusive) bbox so the
  // tail isn't clipped on the slide.
  var rect = {
    x: gridToIn(bb.x, grid.w, slideW),
    y: gridToIn(bb.y, grid.h, slideH),
    w: gridToIn(bb.w, grid.w, slideW),
    h: gridToIn(bb.h, grid.h, slideH),
  };

  var clone = wrap.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', bb.x + ' ' + bb.y + ' ' + bb.w + ' ' + bb.h);
  clone.removeAttribute('preserveAspectRatio');
  var pxW = Math.max(16, Math.ceil(rect.w * 96 * RASTER_DPR));
  var pxH = Math.max(16, Math.ceil(rect.h * 96 * RASTER_DPR));
  clone.setAttribute('width', String(pxW));
  clone.setAttribute('height', String(pxH));
  var svgStr = new XMLSerializer().serializeToString(clone);
  var dataUrl = 'data:image/svg+xml;base64,' +
                btoa(unescape(encodeURIComponent(svgStr)));
  var img = await new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function (e) { reject(e); };
    im.src = dataUrl;
  });
  var canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  canvas.getContext('2d').drawImage(img, 0, 0, pxW, pxH);
  var pngData = canvas.toDataURL('image/png');
  slide.addImage({ data: pngData, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
}

// Text overlay for a rasterised shape — the geometry is a picture so we
// can't embed text inside it, but we can still position a text frame on
// top so the caption is editable. Lower fidelity than native shapes
// (resizing the picture won't reflow the text) but visible + editable.
function drawShapeTextOverlay(slide, s, grid, slideW, slideH, fontChains) {
  if (s.kind === 'icon') return; // icons don't carry text content
  var textOpts = buildTextOpts(s, slideW, fontChains);
  if (!textOpts) return;
  var rect = contentRectIn(s, grid, slideW, slideH);
  if (!rect) return;
  var t = textOpts.text;
  delete textOpts.text;
  slide.addText(t, Object.assign({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, textOpts));
}

// ─── Rich block rasterisation ───────────────────────────────

var RICH_SELECTOR = '.sdoc-chart, .sdoc-mermaid, .sdocs-math-display, .sdocs-math-inline';

// Each entry: { dataUrl, padX, padY } where padX/padY are stage-px overhang
// the raster includes beyond the wrapper's bbox. Currently only math
// rasterisation adds padding (KaTeX descenders); chart / mermaid return 0.
async function rasterizeRichBlock(wrapper) {
  if (wrapper.classList.contains('sdoc-chart')) {
    var canvas = wrapper.querySelector('canvas');
    if (canvas) {
      try { return { dataUrl: canvas.toDataURL('image/png'), padX: 0, padY: 0 }; }
      catch (e) { /* fall through */ }
    }
  }
  if (wrapper.classList.contains('sdoc-mermaid')) {
    if (window.SDocs && window.SDocs.rasterizeMermaidWrapper) {
      var d = await window.SDocs.rasterizeMermaidWrapper(wrapper);
      return d ? { dataUrl: d, padX: 0, padY: 0 } : null;
    }
  }
  if (wrapper.classList.contains('sdocs-math-display') ||
      wrapper.classList.contains('sdocs-math-inline')) {
    if (window.SDocs && window.SDocs.rasterizeMathElement) {
      var res = await window.SDocs.rasterizeMathElement(wrapper);
      if (!res) return null;
      var r0 = wrapper.getBoundingClientRect();
      var padX = Math.max(0, (res.width - r0.width) / 2);
      var padY = Math.max(0, (res.height - r0.height) / 2);
      return { dataUrl: res.dataUrl, padX: padX, padY: padY };
    }
  }
  return null;
}

// Wrappers like `.sdoc-mermaid` have `width: 100%`, so their bbox is the
// whole shape content box even though the SVG inside has intrinsic size.
// Measuring the inner element (the actual <svg> or <canvas>) gives the
// real rendered size so the embedded picture isn't stretched to fill.
function intrinsicRectOf(wrapper) {
  var inner = wrapper.querySelector('svg') || wrapper.querySelector('canvas');
  if (inner) {
    var r = inner.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return wrapper.getBoundingClientRect();
}

async function drawRichBlocks(slide, container, stageRect, slideW, slideH) {
  var blocks = [];
  var hosts = container.querySelectorAll('.shape-md');
  for (var i = 0; i < hosts.length; i++) {
    var sm = hosts[i];
    if (!sm.shadowRoot) continue;
    var inner = sm.shadowRoot.querySelector('.inner');
    if (!inner) continue;
    var rs = inner.querySelectorAll(RICH_SELECTOR);
    for (var j = 0; j < rs.length; j++) blocks.push(rs[j]);
  }
  if (!blocks.length) return;
  for (var k = 0; k < blocks.length; k++) {
    var el = blocks[k];
    try {
      var rect = intrinsicRectOf(el);
      if (rect.width <= 0 || rect.height <= 0) continue;
      var raster = await rasterizeRichBlock(el);
      if (!raster || !raster.dataUrl) continue;
      var leftPx = rect.left - (raster.padX || 0);
      var topPx = rect.top - (raster.padY || 0);
      var wPx = rect.width + 2 * (raster.padX || 0);
      var hPx = rect.height + 2 * (raster.padY || 0);
      var xIn = ((leftPx - stageRect.left) / stageRect.width) * slideW;
      var yIn = ((topPx - stageRect.top) / stageRect.height) * slideH;
      var wIn = (wPx / stageRect.width) * slideW;
      var hIn = (hPx / stageRect.height) * slideH;
      slide.addImage({ data: raster.dataUrl, x: xIn, y: yIn, w: wIn, h: hIn });
    } catch (e) {
      if (window.console) console.warn('slide-pptx rich block:', e && e.message);
    }
  }
}

// ─── Async readiness helpers ────────────────────────────────

// Wait for chart/mermaid/math blocks inside shape shadow roots to finish
// their async render pipeline (CDN load + per-block render). Returns when
// every host's source code blocks have been swapped for rendered output,
// or when the deadline lapses (we'd rather ship a slightly incomplete
// slide than hang the export).
function waitForShadowBlocks(stage) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + SHADOW_BLOCK_TIMEOUT_MS;
    function ready() {
      var hosts = stage.querySelectorAll('.shape-md');
      for (var i = 0; i < hosts.length; i++) {
        var root = hosts[i].shadowRoot;
        if (!root) continue;
        var chartCodes = root.querySelectorAll('code.language-chart');
        for (var a = 0; a < chartCodes.length; a++) {
          var cp = chartCodes[a].closest('pre');
          if (cp && !cp.classList.contains('sdoc-chart-error')) return false;
        }
        var canvases = root.querySelectorAll('.sdoc-chart canvas');
        for (var b = 0; b < canvases.length; b++) {
          if (!(canvases[b].width > 0 && canvases[b].height > 0)) return false;
        }
        if (root.querySelector('code.language-mermaid')) return false;
        var merms = root.querySelectorAll('.sdoc-mermaid');
        for (var m = 0; m < merms.length; m++) {
          if (!merms[m].querySelector('svg') &&
              !(merms[m].textContent && merms[m].textContent.trim())) return false;
        }
        var maths = root.querySelectorAll('.sdocs-math-display, .sdocs-math-inline');
        for (var n = 0; n < maths.length; n++) {
          if (!maths[n].querySelector('.katex') && !maths[n]._katexDone) return false;
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

function waitForIconBundle() {
  return new Promise(function (resolve) {
    var deadline = Date.now() + ICON_BUNDLE_TIMEOUT_MS;
    (function tick() {
      if (window.SDocIcons && Object.keys(window.SDocIcons).length > 0) return resolve();
      if (Date.now() > deadline) return resolve();
      setTimeout(tick, 50);
    })();
  });
}

// ─── Main entry ────────────────────────────────────────────

// Draw one slide. ctx = { dsl, slide, pres, slideW (in), slideH (in) }.
// Returns { warnings: N } so the export pipeline can surface
// "Exported with N warnings" instead of silently skipping shapes.
async function drawSlide(ctx) {
  var SDocShapes = window.SDocShapes;
  var SDocShapeRender = window.SDocShapeRender;
  if (!SDocShapes || !SDocShapeRender) throw new Error('Shape renderer not loaded');
  if (!window.PptxGenJS) throw new Error('PptxGenJS not loaded');

  var dsl = ctx.dsl;
  var slide = ctx.slide;
  var pres = ctx.pres;
  var slideW = ctx.slideW;
  var slideH = ctx.slideH;
  if (!dsl || !slide || !pres || !slideW || !slideH) throw new Error('drawSlide: missing ctx fields');

  var parsed = SDocShapes.parse(dsl);
  SDocShapes.resolve(parsed.shapes);
  var grid = parsed.grid;
  var shapes = parsed.shapes;
  var warnings = 0;

  if (grid.attrs && grid.attrs.bg) {
    var bgHex = toHex6(grid.attrs.bg);
    if (bgHex) slide.background = { color: bgHex };
  }

  var st = createStage(grid.w, grid.h);
  try {
    SDocShapeRender.renderShapes(dsl, st.stage);
    // eslint-disable-next-line no-unused-expressions
    st.stage.offsetHeight; // flush pending layout

    // Resolve the active font chains once for this slide — the on-screen
    // body/heading families drive the fontFace fallback we apply to every
    // text frame. Cheap to call; reading getComputedStyle is hot-path-fast.
    var fontChains = detectExportFontChains();

    // Wait for the icon bundle if any icons are present.
    for (var hi = 0; hi < shapes.length; hi++) {
      if (shapes[hi].kind === 'icon') { await waitForIconBundle(); break; }
    }

    // Pass 1: shape geometry, dispatched via the single strategy table.
    // Native primitives also receive their text content in the same call
    // so the resulting OOXML has one editable element per shape.
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var strat = shapeStrategy(s);
      if (!strat) continue;
      try {
        if (strat === 'line') {
          drawLineOrArrow(slide, pres, s, grid, slideW, slideH);
        } else if (strat === 'native') {
          drawNativeShape(slide, pres, s, grid, slideW, slideH, fontChains);
        } else if (strat === 'custGeom') {
          drawCustGeomPolygon(slide, pres, s, grid, slideW, slideH, fontChains);
        } else if (strat === 'raster') {
          await drawShapeViaRaster(slide, s, i, grid, slideW, slideH, st.stage);
        }
      } catch (err) {
        warnings++;
        if (window.console) console.warn('slide-pptx shape #' + i + ' (' + s.kind + '):', err);
      }
    }

    // Pass 2: text overlays for rasterised shapes (native shapes already
    // carry their text from pass 1). Skipped for `icon` which has no
    // text content.
    for (var t = 0; t < shapes.length; t++) {
      var ts = shapes[t];
      if (shapeStrategy(ts) !== 'raster') continue;
      try {
        drawShapeTextOverlay(slide, ts, grid, slideW, slideH, fontChains);
      } catch (err) {
        warnings++;
        if (window.console) console.warn('slide-pptx text overlay #' + t + ':', err);
      }
    }

    // Wait for charts / mermaid / math to finish their render pipeline
    // before snapshotting their DOM. Without this we'd capture <pre>
    // source instead of rendered output.
    await waitForShadowBlocks(st.stage);

    // Pass 3: rich blocks embed as PNG at their intrinsic size + position.
    var stageRect = st.stage.getBoundingClientRect();
    await drawRichBlocks(slide, st.stage, stageRect, slideW, slideH);
  } finally {
    if (st.wrap.parentNode) st.wrap.parentNode.removeChild(st.wrap);
  }

  return { warnings: warnings };
}

window.SDocSlidePptx = {
  drawSlide: drawSlide,
  REF_SLIDE_W_IN: REF_SLIDE_W_IN,
};

})();
