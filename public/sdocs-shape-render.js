// sdocs-shape-render.js — browser-only shape renderer
// Takes DSL text + a container element, produces rendered HTML+SVG.
// Used by both /shapes playground and the ```slide block processor.
//
// Depends on window.SDocShapes (parse, resolve, contentBox).
//
// The renderer also injects a single <style> element on first load so any
// page that includes this script gets the shape CSS without a separate
// stylesheet wiring step.

(function () {
'use strict';

var SVG_NS = 'http://www.w3.org/2000/svg';

// One-shot CSS injection so shape containers render correctly in any host page.
var CSS_ID = 'sdocs-shape-render-css';
// Host-page CSS lives in the light DOM and has higher specificity than
// anything we could reasonably ship (`#_sd_rendered p` etc.). Rather than
// fight that with !important chains and hope we enumerate every property,
// shape-md is a shadow DOM host — no selector on the host page can reach
// into it. The CSS that styles markdown inside a shape lives inside the
// shadow (SHAPE_MD_SHADOW_CSS below), with no scope prefix and no !important.
var CSS = [
  /* The wrap fills whatever space its parent gives it and locks the slide */
  /* aspect ratio. The inner stage is a fixed-pixel canvas (refW x refH); */
  /* a CSS transform scales it to fit the wrap. Everything inside the stage */
  /* measures at the reference size, so text wrapping and autofit produce */
  /* identical output in every context (inline, rail thumb, fullscreen, PDF). */
  '.sd-slide-wrap { position: relative; overflow: hidden; width: 100%; }',
  /* pointer-events: none lets clicks pass through the rendered stage to */
  /* the wrapping element, which typically owns the click handler (open */
  /* presentation mode, navigate to a slide). Text selection inside a slide */
  /* is a rare ask; if we need it later, scope this to inline contexts only. */
  '.sd-shape-stage { position: absolute; top: 0; left: 0; transform-origin: top left; overflow: hidden; pointer-events: none; }',
  /* Each slide has three stacked sublayers: bottom / auto / top. DOM order */
  /* (last-appended paints above) gives us the stacking; no z-index needed. */
  /* Within each sublayer, the SVG holds vector primitives and the sublayer */
  /* itself holds rectangles and text overlays, so c/e/l/a/p still paint */
  /* below r-shapes when they share the same sublayer (the existing rule). */
  /* `layer=top` / `layer=bottom` on a shape promotes/demotes it across */
  /* sublayers; arrows-above-rects and dots-on-rects become possible. */
  '.sd-stage-sublayer { position: absolute; inset: 0; pointer-events: none; }',
  '.sd-shape-stage .shape-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }',
  /* Default: centered both axes. Works naturally for titles and standalone */
  /* text. Agents override via align=left/right and valign=top/bottom — see */
  /* `sdoc slides` for when to switch (body/list copy usually wants left). */
  '.sd-shape-stage .shape-rect {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: hidden; line-height: 1.25;',
  '}',
  '.sd-shape-stage .shape-text {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: hidden; pointer-events: none; line-height: 1.25;',
  '}',
  '.sd-shape-stage .shape-rect[data-align="left"],',
  '.sd-shape-stage .shape-text[data-align="left"] { justify-content: flex-start; text-align: left; }',
  '.sd-shape-stage .shape-rect[data-align="right"],',
  '.sd-shape-stage .shape-text[data-align="right"] { justify-content: flex-end; text-align: right; }',
  '.sd-shape-stage .shape-rect[data-valign="top"],',
  '.sd-shape-stage .shape-text[data-valign="top"] { align-items: flex-start; }',
  '.sd-shape-stage .shape-rect[data-valign="bottom"],',
  '.sd-shape-stage .shape-text[data-valign="bottom"] { align-items: flex-end; }',
  '.sd-shape-stage .shape-md { display: block; max-width: 100%; color: inherit; }',
].join('\n');

// This is the only place markdown styling lives. Because the shadow root
// isolates the subtree completely, we can write clean rules without prefixes
// or !important — the host page literally cannot select in.
// CSS custom properties (unlike regular rules) cross shadow-DOM boundaries.
// When a slide is embedded in an SDocs document, --md-* vars declared on
// #_sd_rendered cascade down into the shadow root, so we can pick up the
// doc's chosen fonts and heading colors "for free" — no JS forwarding.
// Fallbacks make the rules still work in the /shapes playground or anywhere
// else the shape renderer runs outside an SDocs document.
var SHAPE_MD_SHADOW_CSS = [
  ':host { display: block; color: inherit; font: inherit; line-height: inherit; }',
  /* Paragraph/list text color: prefer --shape-color when the shape */
  /* declared color=, else use the doc's --md-color. This matters in */
  /* present mode, where .sdoc-present sets a cream `color` on the */
  /* modal chrome that would otherwise cascade into shape text. */
  '.inner {',
  '  text-align: inherit;',
  '  font-family: var(--md-font-family, inherit);',
  '  color: var(--shape-color, var(--md-color, inherit));',
  '}',
  '.inner > :first-child { margin-top: 0; }',
  '.inner > :last-child { margin-bottom: 0; }',
  'p { margin: 0.2em 0; color: inherit; }',
  /* Heading colors: prefer --shape-color (set when the shape declares color=), */
  /* otherwise pick up the doc-level per-level heading color so `# Title` inside */
  /* a shape automatically adopts the doc's h1 color without any DSL attribute. */
  'h1, h2, h3, h4, h5, h6 { font-family: var(--md-h-font-family, inherit); }',
  'h1 { color: var(--shape-color, var(--md-h1-color, inherit)); }',
  'h2 { color: var(--shape-color, var(--md-h2-color, inherit)); }',
  'h3 { color: var(--shape-color, var(--md-h3-color, inherit)); }',
  'h4 { color: var(--shape-color, var(--md-h4-color, inherit)); }',
  'h5, h6 { color: var(--shape-color, var(--md-h-color, inherit)); }',
  'h1 { font-size: 1.4em; font-weight: 700; margin: 0.2em 0; line-height: 1.15; }',
  'h2 { font-size: 1.2em; font-weight: 700; margin: 0.2em 0; line-height: 1.2; }',
  'h3 { font-size: 1.05em; font-weight: 600; margin: 0.15em 0; line-height: 1.2; }',
  'h4, h5, h6 { font-size: 1em; font-weight: 600; margin: 0.15em 0; }',
  'ul, ol { margin: 0.2em 0; padding: 0 0 0 1.2em; text-align: left; color: inherit; }',
  'li { margin: 0.1em 0; color: inherit; }',
  'li::marker { color: currentColor; }',
  'code {',
  '  background: var(--md-code-bg, rgba(0,0,0,.08));',
  '  color: var(--md-code-color, inherit);',
  '  font-family: var(--md-code-font, ui-monospace, Menlo, monospace);',
  '  padding: 0 0.25em; border-radius: 3px; font-size: 0.9em;',
  '}',
  'pre {',
  '  margin: 0.3em 0; padding: 0.4em 0.6em;',
  '  background: var(--md-pre-bg, rgba(0,0,0,.08));',
  '  border-radius: 4px; text-align: left; font-size: 0.85em;',
  '  overflow-x: auto; line-height: 1.3;',
  '  color: var(--md-code-color, inherit);',
  '}',
  'pre code {',
  '  background: none; padding: 0; font-size: inherit;',
  '  color: var(--md-code-color, inherit);',
  '  font-family: var(--md-code-font, inherit);',
  '}',
  'strong { font-weight: 700; }',
  'em { font-style: italic; }',
  'a { color: var(--md-link-color, inherit); text-decoration: underline; }',
  /* Forward the doc's blockquote styling (--md-bq-*) so a `> quote` */
  /* inside a shape picks up the same left-border + tinted bg as a */
  /* blockquote in the doc body. Fallbacks keep it readable in /shapes. */
  'blockquote {',
  '  margin: 0.3em 0; padding: 0 0 0 0.7em;',
  '  border-left: var(--md-bq-border, 2px solid currentColor);',
  '  background: var(--md-bq-bg, transparent);',
  '  color: var(--md-bq-color, inherit);',
  '  opacity: 0.9; text-align: left; font-style: italic;',
  '}',
  /* Tables pick up the doc\'s table tokens when available. Em-based */
  /* padding/font-size so autofit scales cells proportionally with the */
  /* shape\'s text. */
  'table {',
  '  border-collapse: collapse; width: 100%;',
  '  margin: 0.3em 0; font-size: 0.95em; text-align: left;',
  '}',
  'th, td {',
  '  border: 1px solid var(--md-table-border, rgba(0,0,0,.12));',
  '  padding: 0.35em 0.65em; vertical-align: top;',
  '  color: var(--md-table-text, inherit);',
  '}',
  'th {',
  '  background: var(--md-table-header-bg, rgba(0,0,0,.05));',
  '  font-weight: 600;',
  '}',
  'tbody tr:nth-child(even) td {',
  '  background: var(--md-table-even-bg, transparent);',
  '}',
  'tbody tr:nth-child(odd) td {',
  '  background: var(--md-table-odd-bg, transparent);',
  '}',
  /* When a shape\'s entire content is a code block AND the shape has a */
  /* fill, the shape itself acts as the code container — strip the pre\'s */
  /* own chrome so the fill shows edge-to-edge. Without a fill, keep the */
  /* normal block bg/radius/margin so code stays visually distinct from */
  /* the surrounding slide. */
  ':host(.shape-md-code-only.shape-md-fill) pre { background: transparent; border-radius: 0; margin: 0; padding: 0.3em 0.6em; font-size: 1em; }',
].join('\n');

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  var style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
if (typeof document !== 'undefined') injectCSS();

// ─── Helpers ─────────────────────────────────────────

function pct(v, axisValue) { return (v / axisValue * 100) + '%'; }

// Build a CSS block that overrides the default shadow font-size ratios for
// specific elements. Keys: h1Scale, h2Scale ... h6Scale, pScale. Values are
// plain numbers interpreted as em (relative to the shape's resolved font
// size — which is the autofit output or the font=Npx/font=fixed value).
function scaleOverrides(attrs) {
  if (!attrs) return '';
  var map = { h1Scale: 'h1', h2Scale: 'h2', h3Scale: 'h3', h4Scale: 'h4', h5Scale: 'h5', h6Scale: 'h6', pScale: 'p' };
  var rules = [];
  for (var key in map) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    var n = parseFloat(attrs[key]);
    if (!isFinite(n) || n <= 0) continue;
    rules.push(map[key] + ' { font-size: ' + n + 'em; }');
  }
  return rules.join('\n');
}

// Render content as a .shape-md host with a shadow root holding the markdown
// HTML. Shadow DOM isolates shape content from any host-page CSS that might
// try to restyle paragraphs, list markers, or headings inside a slide.
function contentToMarkdownNode(content, attrs) {
  var host = document.createElement('div');
  host.className = 'shape-md';
  if (content == null || content === '') return host;
  if (contentIsOnlyCodeBlock(content)) host.classList.add('shape-md-code-only');
  // Mark when the enclosing shape has an explicit fill so the shadow CSS
  // can decide whether nested code blocks should fill the shape or keep
  // their own block styling.
  if (attrs && attrs.fill && attrs.fill !== 'none' && attrs.fill !== 'transparent') {
    host.classList.add('shape-md-fill');
  }

  var marked = typeof window !== 'undefined' ? window.marked : null;
  var purify = typeof window !== 'undefined' ? window.DOMPurify : null;
  var markedFn = marked && (typeof marked.parse === 'function' ? marked.parse : (typeof marked === 'function' ? marked : null));

  // Fallback: no markdown pipeline loaded (unit test runners, etc.).
  if (!markedFn || typeof host.attachShadow !== 'function') {
    host.textContent = content;
    return host;
  }

  var html = markedFn(content);
  if (purify && typeof purify.sanitize === 'function') html = purify.sanitize(html);

  var overrides = scaleOverrides(attrs);
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>' + SHAPE_MD_SHADOW_CSS + (overrides ? '\n' + overrides : '') + '</style><div class="inner">' + html + '</div>';
  return host;
}

// True when `content` is effectively a single fenced code block and nothing
// else (allowing surrounding whitespace). Used to zero out the shape's
// default padding so the code fills the shape edge-to-edge — otherwise the
// shape fill shows as a visible frame around the code block's own bg tint.
function contentIsOnlyCodeBlock(content) {
  if (content == null) return false;
  var t = content.trim();
  var m = t.match(/^(```|~~~)[^\n]*\n[\s\S]*?\n(```|~~~)$/);
  if (!m) return false;
  return m[1] === m[2];
}

function shapePaddingGridUnits(s) {
  var v = s.attrs && s.attrs.padding;
  if (v != null && v !== '') {
    var n = Number(v);
    return isNaN(n) ? 0 : Math.max(0, n);
  }
  if (contentIsOnlyCodeBlock(s.content)) return 0;
  var box = window.SDocShapes.contentBox(s);
  if (!box) return 0;
  return Math.min(box.w, box.h) * 0.05;
}

function applyPadding(el, s, grid) {
  var p = shapePaddingGridUnits(s);
  if (p <= 0) { el.style.padding = '0'; return; }
  // Padding in the DSL is in grid units. The stage has a fixed reference
  // height (REF_H) with width derived from the grid aspect, so each grid
  // unit is exactly REF_H / grid.h pixels vertically and REF_W / grid.w
  // pixels horizontally. Those evaluate to the same px value (by ref-size
  // construction), so a single px value works for all four sides.
  var px = (p * REF_H) / grid.h;
  el.style.padding = px.toFixed(3) + 'px';
}

function applyShapeStyle(el, attrs, grid) {
  if (attrs.fill) el.style.background = attrs.fill;
  if (attrs.color) {
    el.style.color = attrs.color;
    // Mirror onto --shape-color so heading rules in the shadow root can
    // prefer an explicit shape color over doc-level heading colors.
    // CSS custom properties cross shadow-DOM boundaries, so this cascades in.
    el.style.setProperty('--shape-color', attrs.color);
  }
  if (attrs.radius != null) el.style.borderRadius = attrs.radius + '%';
  else el.style.borderRadius = '0.8%';
  if (attrs.stroke && attrs.stroke !== 'none') {
    var sw = attrs.strokeWidth != null ? parseFloat(attrs.strokeWidth) : 0.15;
    // strokeWidth is in grid units (same scale as shape w/h). Convert to px
    // against the reference stage width.
    var swPx = (sw / grid.w) * (REF_H * grid.w / grid.h);
    el.style.border = swPx.toFixed(3) + 'px solid ' + attrs.stroke;
  }
  if (attrs.shadow === 'none') el.style.boxShadow = 'none';
  // Per-shape overrides for table styling. CSS custom properties cross
  // shadow-DOM boundaries, so setting them on the shape's host element
  // makes them win over the doc-level --md-table-* values for anything
  // rendered inside this shape only.
  if (attrs.tableBorder)    el.style.setProperty('--md-table-border', attrs.tableBorder);
  if (attrs.tableHeaderBg)  el.style.setProperty('--md-table-header-bg', attrs.tableHeaderBg);
  if (attrs.tableEvenBg)    el.style.setProperty('--md-table-even-bg', attrs.tableEvenBg);
  if (attrs.tableOddBg)     el.style.setProperty('--md-table-odd-bg', attrs.tableOddBg);
  if (attrs.tableText)      el.style.setProperty('--md-table-text', attrs.tableText);
}

function applySvgStroke(el, attrs, defaultStroke) {
  var stroke = attrs.stroke || defaultStroke || '#94a3b8';
  var sw = attrs.strokeWidth != null ? attrs.strokeWidth : 0.15;
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', sw);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('fill', attrs.fill || 'none');
}

// ─── Per-shape renderers ─────────────────────────────

// `font=Npx` pins an exact size and disables autofit. `font=fixed` / `font=none`
// disable autofit but leave the CSS cascade to size text (useful when the
// agent wants doc-style rather than slide-style sizing).
//
// All shapes render on a fixed-size stage (REF_H tall), so `font=18px` means
// literally 18px at the stage's native resolution. The stage is then CSS-
// transformed to fit its context, so 18px reads as 18px on a fullscreen
// 720-tall slide, ~9px on a rail thumb that's scaled to 50%, and so on.
function applyFontAttr(el, attrs) {
  if (!attrs || !attrs.font) return;
  var v = String(attrs.font).trim();
  if (v === 'fixed' || v === 'none' || v === 'off') {
    el.dataset.autofit = 'off';
    el.dataset.fontMode = 'fixed';
    return;
  }
  var unitMatch = v.match(/^(\d*\.?\d+)(px|pt|em|rem)?$/);
  if (!unitMatch) return;
  var n = parseFloat(unitMatch[1]);
  var unit = unitMatch[2] || 'px';
  el.style.fontSize = n + unit;
  el.dataset.autofit = 'off';
}

function renderRect(s, grid) {
  var el = document.createElement('div');
  el.className = 'shape-rect';
  el.style.left = pct(s.x, grid.w);
  el.style.top = pct(s.y, grid.h);
  el.style.width = pct(s.w, grid.w);
  el.style.height = pct(s.h, grid.h);
  applyShapeStyle(el, s.attrs, grid);
  applyPadding(el, s, grid);
  if (s.attrs && s.attrs.maxfont) el.dataset.maxfont = s.attrs.maxfont;
  if (s.attrs && s.attrs.align) el.dataset.align = s.attrs.align;
  if (s.attrs && s.attrs.valign) el.dataset.valign = s.attrs.valign;
  applyFontAttr(el, s.attrs);
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content, s.attrs));
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderCircle(s) {
  var el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', s.cx);
  el.setAttribute('cy', s.cy);
  el.setAttribute('r', s.r);
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderEllipse(s) {
  var el = document.createElementNS(SVG_NS, 'ellipse');
  el.setAttribute('cx', s.cx);
  el.setAttribute('cy', s.cy);
  el.setAttribute('rx', s.rx);
  el.setAttribute('ry', s.ry);
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderLine(s) {
  var el = document.createElementNS(SVG_NS, 'line');
  el.setAttribute('x1', s.x1);
  el.setAttribute('y1', s.y1);
  el.setAttribute('x2', s.x2);
  el.setAttribute('y2', s.y2);
  applySvgStroke(el, s.attrs);
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderArrow(s, defsNeeded) {
  var g = document.createElementNS(SVG_NS, 'g');
  var line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', s.x1);
  line.setAttribute('y1', s.y1);
  line.setAttribute('x2', s.x2);
  line.setAttribute('y2', s.y2);
  applySvgStroke(line, s.attrs);
  line.setAttribute('marker-end', 'url(#_sd_arrowhead)');
  g.appendChild(line);
  defsNeeded.arrowhead = true;
  if (s.attrs.stroke) defsNeeded.arrowheadColor = s.attrs.stroke;
  if (s.id) g.dataset.id = s.id;
  return g;
}

function polyPath(points) {
  if (points.length === 0) return '';
  var d = 'M ' + points[0].x + ' ' + points[0].y;
  for (var i = 1; i < points.length; i++) {
    var p = points[i];
    if (p.curve) {
      var prev = points[i - 1];
      var mx = (prev.x + p.x) / 2;
      var my = (prev.y + p.y) / 2;
      d += ' Q ' + p.x + ' ' + p.y + ' ' + mx + ' ' + my;
      d += ' L ' + p.x + ' ' + p.y;
    } else {
      d += ' L ' + p.x + ' ' + p.y;
    }
  }
  d += ' Z';
  return d;
}

function renderPolygon(s) {
  var el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', polyPath(s.points));
  applySvgStroke(el, s.attrs);
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderTextOverlay(s, grid) {
  var box = window.SDocShapes.contentBox(s);
  if (!box) return null;
  var el = document.createElement('div');
  el.className = 'shape-text';
  el.style.left = pct(box.x, grid.w);
  el.style.top = pct(box.y, grid.h);
  el.style.width = pct(box.w, grid.w);
  el.style.height = pct(box.h, grid.h);
  if (s.attrs.color) el.style.color = s.attrs.color;
  applyPadding(el, s, grid);
  if (s.attrs && s.attrs.maxfont) el.dataset.maxfont = s.attrs.maxfont;
  if (s.attrs && s.attrs.align) el.dataset.align = s.attrs.align;
  if (s.attrs && s.attrs.valign) el.dataset.valign = s.attrs.valign;
  applyFontAttr(el, s.attrs);
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content, s.attrs));
  if (s.id) el.dataset.id = s.id + '-text';
  return el;
}

function buildArrowheadDefs(color) {
  var defs = document.createElementNS(SVG_NS, 'defs');
  var marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', '_sd_arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
  path.setAttribute('fill', color || '#475569');
  marker.appendChild(path);
  defs.appendChild(marker);
  return defs;
}

// ─── Auto-fit ────────────────────────────────────────

// Content inside a shape-md lives in an open shadow root, so the rect's own
// scrollWidth/Height and textContent don't reflect it. Return the element
// that actually represents the rendered content for measurement purposes.
function measurementTarget(el) {
  var shapeMd = el.querySelector && el.querySelector('.shape-md');
  if (shapeMd && shapeMd.shadowRoot) {
    var inner = shapeMd.shadowRoot.querySelector('.inner');
    if (inner) return inner;
  }
  return el;
}

function hasRenderableText(el) {
  var target = measurementTarget(el);
  var t = (target.textContent || '').trim();
  return t.length > 0;
}

function autoFitText(el, minPx, maxPx) {
  if (el.dataset.autofit === 'off') return;
  if (!hasRenderableText(el)) return;
  var target = measurementTarget(el);
  var cap = Math.max(minPx, Math.floor(maxPx));
  var lo = minPx, hi = cap, best = minPx;
  // clientWidth/Height include padding; available content area is the
  // inset. scrollWidth/Height are integer CSS px, so give a 1px tolerance
  // to avoid rounding rejecting every size. overflow: hidden is the
  // backstop if we ever oversize by a pixel.
  var cs = getComputedStyle(el);
  var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  var availW = Math.max(0, el.clientWidth - padX);
  var availH = Math.max(0, el.clientHeight - padY);
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = mid + 'px';
    var fits = target.scrollWidth <= availW + 1 && target.scrollHeight <= availH + 1;
    if (fits) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  el.style.fontSize = best + 'px';
}

// Default cap: text font-size never exceeds this fraction of stage height.
// Without a cap, a tall shape with one word balloons up to its own height,
// which makes slides look childish compared to surrounding document text.
// At 0.12, a single word on a 40%-tall shape renders at ~12% stage height —
// roughly the size of an h1 on a pro deck. Override per-shape with maxfont=Npx.
var DEFAULT_MAX_FONT_STAGE_PCT = 0.12;

// Reference stage height. Slides render at REF_H tall at their native
// resolution; a CSS transform scales the whole canvas to whatever pixel
// size the context gives it. Font sizing, padding, autofit — all measured
// at this reference. Agents who type `font=18px` get literal 18px on a
// 720-tall slide, which scales down/up with the transform.
var REF_H = 720;
function refW(grid) { return REF_H * grid.w / grid.h; }

function applyAutoFit(container, minPx, maxStageHPct) {
  var floor = typeof minPx === 'number' ? minPx : 8;
  var pct = typeof maxStageHPct === 'number' ? maxStageHPct : DEFAULT_MAX_FONT_STAGE_PCT;
  var stageCap = REF_H * pct;
  var els = container.querySelectorAll('.shape-rect, .shape-text');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.dataset.autofit === 'off') {
      // font=fixed: sample cascade-resolved px and pin it. The transform
      // scales this like everything else, so doc-style text still shrinks
      // proportionally in rail thumbs and grows in fullscreen.
      if (el.dataset.fontMode === 'fixed') {
        var cs = parseFloat(getComputedStyle(el).fontSize);
        if (isFinite(cs) && cs > 0) el.style.fontSize = cs.toFixed(3) + 'px';
      }
      continue;
    }
    var h = el.clientHeight;
    if (h <= 0) continue;
    var perShape = parseFloat(el.dataset.maxfont);
    var cap = isFinite(perShape) && perShape > 0 ? perShape : stageCap;
    autoFitText(el, floor, Math.min(h, cap));
  }
}

// ─── $path.to.prop resolution ────────────────────────

// Walk every shape attr (and grid attrs) and substitute $refs with the
// corresponding var(--md-*) expression. Collects unresolved refs as
// errors so the thumbnail badge can surface them to the agent.
// Mutates attrs in place.
function resolveAttrRefs(attrs, lineNumber, errors) {
  if (!attrs) return;
  var SDocStyles = typeof window !== 'undefined' ? window.SDocStyles : null;
  if (!SDocStyles || !SDocStyles.resolveStyleRef) return;
  for (var k in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
    var v = attrs[k];
    if (typeof v !== 'string' || v.charAt(0) !== '$') continue;
    var r = SDocStyles.resolveStyleRef(v);
    if (!r) continue;
    if (r.error) {
      errors.push({ line: lineNumber, message: r.error });
      continue;
    }
    attrs[k] = r.value;
  }
}

function resolveStyleRefs(grid, shapes) {
  var errors = [];
  if (grid && grid.attrs) resolveAttrRefs(grid.attrs, 1, errors);
  for (var i = 0; i < shapes.length; i++) {
    resolveAttrRefs(shapes[i].attrs, shapes[i].lineNumber, errors);
  }
  return errors;
}

// ─── Main entry ──────────────────────────────────────

// Attach a ResizeObserver to the wrap that keeps the inner stage scaled to
// fit. Scale is wrap.clientWidth / refW (wrap and stage share aspect ratio
// by construction — wrap sets aspectRatio, stage is refW x refH).
function attachScaler(wrap, stage, rW) {
  var update = function () {
    var w = wrap.clientWidth;
    if (w <= 0) return;
    stage.style.transform = 'scale(' + (w / rW) + ')';
  };
  update();
  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(update);
    ro.observe(wrap);
    // Hold a ref so GC doesn't reclaim while wrap is still in the DOM.
    wrap.__sdScalerRO = ro;
  }
  // Re-run once on next frame: if the wrap was just inserted into a
  // display:none / collapsed section, its clientWidth reads 0 initially and
  // the ResizeObserver will catch the transition when the section opens,
  // but some browsers skip the very first callback for zero-size elements.
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(update);
}

// Build a freshly-parented offscreen container at reference size. Shapes
// render, autofit runs synchronously (known dimensions, no rAF/observer
// dance), then we move the stage into the caller's wrap. This is the single
// fix for the whole class of "clientHeight === 0 in a collapsed section"
// problems: the offscreen parent is always laid out.
function buildOffscreenStage(rW) {
  var off = document.createElement('div');
  off.setAttribute('aria-hidden', 'true');
  off.style.cssText = [
    'position: fixed',
    'left: -99999px',
    'top: 0',
    'width: ' + rW + 'px',
    'height: ' + REF_H + 'px',
    'opacity: 0',
    'pointer-events: none',
    'contain: layout paint',
  ].join(';');
  return off;
}

function renderShapes(dslText, wrap, options) {
  options = options || {};
  var SDocShapes = window.SDocShapes;
  var parsed = SDocShapes.parse(dslText);
  var resolved = SDocShapes.resolve(parsed.shapes);
  var bounds = SDocShapes.checkGridBounds ? SDocShapes.checkGridBounds(resolved.shapes, parsed.grid) : [];
  var refErrors = resolveStyleRefs(parsed.grid, resolved.shapes);
  var result = {
    shapes: resolved.shapes,
    errors: parsed.errors.concat(resolved.errors, bounds, refErrors),
    grid: parsed.grid,
  };

  var grid = result.grid;
  var rW = refW(grid);

  // Wrap: fills caller-provided space, locks aspect ratio, clips the
  // possibly-larger transformed stage to its visible bounds.
  wrap.classList.add('sd-slide-wrap');
  wrap.style.aspectRatio = grid.w + ' / ' + grid.h;
  wrap.style.setProperty('--gw', grid.w);
  wrap.style.setProperty('--gh', grid.h);
  wrap.innerHTML = '';

  // Build stage offscreen so autofit can measure under all conditions
  // (collapsed sections, display:none ancestors, etc.).
  var off = buildOffscreenStage(rW);
  document.body.appendChild(off);

  var stage = document.createElement('div');
  stage.className = 'sd-shape-stage';
  stage.style.width = rW + 'px';
  stage.style.height = REF_H + 'px';
  if (grid.attrs && grid.attrs.bg) stage.style.backgroundColor = grid.attrs.bg;
  off.appendChild(stage);

  // Three stacked sublayers in DOM order: bottom (paints first, below
  // everything), mid (the default — SVG primitives render inside this
  // sublayer's <svg>, rectangles inside the sublayer div), top (paints
  // last, above everything). Authors opt into top/bottom via
  // `layer=top` / `layer=bottom` on a shape; omit for mid.
  function makeSublayer() {
    var el = document.createElement('div');
    el.className = 'sd-stage-sublayer';
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'shape-svg');
    s.setAttribute('viewBox', '0 0 ' + grid.w + ' ' + grid.h);
    s.setAttribute('preserveAspectRatio', 'none');
    el.appendChild(s);
    return { el: el, svg: s };
  }
  var layers = { bottom: makeSublayer(), mid: makeSublayer(), top: makeSublayer() };
  stage.appendChild(layers.bottom.el);
  stage.appendChild(layers.mid.el);
  stage.appendChild(layers.top.el);

  var defsNeeded = { arrowhead: false, arrowheadColor: null };

  // Arrows default to `layer=top` — almost every flow-diagram use case
  // wants the arrow head to land above the rects it points into. The
  // escape hatch is explicit `layer=mid` or `layer=bottom` on the arrow.
  function pickLayer(s) {
    var v = s.attrs && s.attrs.layer;
    if (v == null || v === '') {
      return s.kind === 'a' ? layers.top : layers.mid;
    }
    if (v === 'top' || v === 'bottom' || v === 'mid') return layers[v];
    result.errors.push({
      line: s.lineNumber,
      message: 'invalid layer "' + v + '" (expected top | mid | bottom)',
    });
    return layers.mid;
  }

  for (var i = 0; i < result.shapes.length; i++) {
    var s = result.shapes[i];
    try {
      var L = pickLayer(s);
      if (s.kind === 'r') {
        L.el.appendChild(renderRect(s, grid));
      } else if (s.kind === 'c') {
        L.svg.appendChild(renderCircle(s));
        if (s.content) L.el.appendChild(renderTextOverlay(s, grid));
      } else if (s.kind === 'e') {
        L.svg.appendChild(renderEllipse(s));
        if (s.content) L.el.appendChild(renderTextOverlay(s, grid));
      } else if (s.kind === 'l') {
        L.svg.appendChild(renderLine(s));
      } else if (s.kind === 'a') {
        L.svg.appendChild(renderArrow(s, defsNeeded));
      } else if (s.kind === 'p') {
        L.svg.appendChild(renderPolygon(s));
        if (s.content) L.el.appendChild(renderTextOverlay(s, grid));
      }
    } catch (e) {
      result.errors.push({ line: s.lineNumber, message: 'render: ' + e.message });
    }
  }

  // Arrowhead defs live in one svg but are referenced document-wide via
  // url(#_sd_arrowhead), so a single copy works for arrows in any sublayer.
  if (defsNeeded.arrowhead) {
    // Arrows default to layer=top, so most arrowhead markers live in the
    // top sublayer's svg. Putting defs in that same svg keeps them
    // reachable; url(#_sd_arrowhead) is document-scoped so any other
    // sublayer's svg can reference it too.
    var defsSvg = layers.top.svg;
    defsSvg.insertBefore(buildArrowheadDefs(defsNeeded.arrowheadColor), defsSvg.firstChild);
  }

  // Force layout, then run autofit. Both are synchronous because the
  // offscreen stage has known dimensions and is in the render tree.
  var minFontPx = typeof options.minFontPx === 'number' ? options.minFontPx : 8;
  var maxStageHPct = typeof options.maxStageHPct === 'number' ? options.maxStageHPct : DEFAULT_MAX_FONT_STAGE_PCT;
  // eslint-disable-next-line no-unused-expressions
  stage.offsetHeight;
  applyAutoFit(stage, minFontPx, maxStageHPct);

  // Move stage into the real wrap. Shadow roots travel with their hosts,
  // so content and styles are preserved — no re-parse, no DOM rebuild.
  wrap.appendChild(stage);
  if (off.parentNode) off.parentNode.removeChild(off);

  attachScaler(wrap, stage, rW);

  return result;
}

window.SDocShapeRender = {
  renderShapes: renderShapes,
};

})();
