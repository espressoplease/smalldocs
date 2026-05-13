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
  '.sd-shape-stage { position: absolute; top: 0; left: 0; transform-origin: top left; overflow: hidden; }',
  /* Each slide has three stacked sublayers: bottom / mid / top. DOM order */
  /* (last-appended paints above) gives us the stacking; no z-index needed. */
  /* Within each sublayer, the SVG holds vector primitives and the sublayer */
  /* itself holds rectangles and text overlays, so c/e/l/a/p still paint */
  /* below r-shapes when they share the same sublayer (the existing rule). */
  /* `layer=top` / `layer=bottom` on a shape promotes/demotes it across */
  /* sublayers; arrows-above-rects and dots-on-rects become possible. */
  /* pointer-events: none on the sublayer container (so the empty parts of */
  /* an upper sublayer don't steal clicks from shapes below), auto on its */
  /* shape children (so text selection still works inside rects). */
  '.sd-stage-sublayer { position: absolute; inset: 0; pointer-events: none; }',
  '.sd-stage-sublayer > .shape-rect,',
  '.sd-stage-sublayer > .shape-text { pointer-events: auto; }',
  '.sd-shape-stage .shape-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }',
  /* Default: centered both axes. Works naturally for titles and standalone */
  /* text. Agents override via align=left/right and valign=top/bottom — see */
  /* `sdoc slides` for when to switch (body/list copy usually wants left). */
  /* overflow: visible (not hidden) is deliberate. Role-based text shrinks */
  /* to fit via autofit-cap mode (see applySizing / applyAutoFit); once the */
  /* font hits the floor (~10px) any further overflow is shown rather than */
  /* clipped, so an over-stuffed shape looks broken instead of looking fine. */
  '.sd-shape-stage .shape-rect {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: visible; line-height: 1.25;',
  '}',
  '.sd-shape-stage .shape-text {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: visible; line-height: 1.25;',
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
// size - the role's px from ROLE_SIZES, the `size=Npx` override, or the
// autofit output when `size=fit`).
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
    // Same default as applySvgStroke: 0.02 grid units = thin neutral
    // stroke per the design principles in `sdoc slides custom-shapes`.
    var sw = attrs.strokeWidth != null ? parseFloat(attrs.strokeWidth) : 0.02;
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

// Default strokeWidth is 0.02 grid units = ~1.5px on a 16x9 reference
// stage. Matches the "thin neutral stroke" design principle in
// `sdoc slides custom-shapes`. Authors who want a heavier line set
// strokeWidth= explicitly; a missing strokeWidth used to default to
// 0.15 (= ~12px), which is exactly the "thick coloured stroke" the
// design principles tell agents to avoid.
function applySvgStroke(el, attrs, defaultStroke) {
  var stroke = attrs.stroke || defaultStroke || '#94a3b8';
  var sw = attrs.strokeWidth != null ? attrs.strokeWidth : 0.02;
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', sw);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('fill', attrs.fill || 'none');
}

// ─── Per-shape renderers ─────────────────────────────

// Typography is role-based. Each shape picks a `text=` role from a fixed
// table; autofit is opt-in via `size=fit`. The table is intentionally short
// (title / subtitle / body / caption) because slide decks read well when
// only 2-3 sizes appear across the whole deck. Per-shape autofit produced
// a different font-size for every box and made decks feel chaotic; roles
// pin the rhythm.
//
// Sizes are in px at the reference stage height (REF_H=720). The stage
// transform scales them with everything else, so a 24px body renders at
// 24px on a fullscreen slide and ~12px on a half-size rail thumbnail.
// Sizes are grid-aspect-independent: a 100x56.25 deck and a 16x9 deck
// render typography at the same px because the stage is always REF_H tall.
var ROLE_SIZES = {
  title:    64,
  subtitle: 40,
  body:     24,
  caption:  14,
};

// `size=Npx` overrides the role's size (literal, no shrink).
// `size=fit` opts into the fill-the-shape binary search (capped by
// `maxfont=` or the stage-height cap) - used by hero metrics.
// Default (no `size=`): role-based px is treated as a CAP. The shape
// renders at the role's px when content fits, and shrinks down toward
// the floor (~10px) only when content would otherwise overflow. Past
// the floor, content overflows visibly rather than clipping.
// Unknown role names fall back to `body` so a typo doesn't break a slide.
function applySizing(el, attrs) {
  attrs = attrs || {};
  var size = attrs.size;
  var role = attrs.text;

  if (size === 'fit') {
    el.dataset.autofit = 'on';
    return;
  }
  if (size != null && size !== '') {
    var m = String(size).match(/^(\d*\.?\d+)(px|pt|em|rem)?$/);
    if (m) {
      el.style.fontSize = m[1] + (m[2] || 'px');
      el.dataset.autofit = 'off';
      return;
    }
  }
  var px = Object.prototype.hasOwnProperty.call(ROLE_SIZES, role) ? ROLE_SIZES[role] : ROLE_SIZES.body;
  el.style.fontSize = px + 'px';
  el.dataset.autofit = 'cap';
  el.dataset.capsize = String(px);
}

// Background image support. Every shape kind can hold an image the same way:
// `image=URL` (or `src=URL` for the `i x y w h` sugar), `imageFit=cover|contain`
// (default `cover`), `imagePos=center|top|bottom|left|right` (default `center`).
//
// Rect uses CSS `background-image`, which paints above `background-color`, so
// `fill=<colour>` on the same shape shows through image alpha and remains
// visible if the image fails to load.
function imageSrcOf(attrs) {
  if (!attrs) return null;
  return attrs.image || attrs.src || null;
}

function imageFitOf(attrs) {
  var v = attrs && attrs.imageFit ? String(attrs.imageFit).toLowerCase() : 'cover';
  return v === 'contain' ? 'contain' : 'cover';
}

function imagePosOf(attrs) {
  return (attrs && attrs.imagePos) ? String(attrs.imagePos) : 'center';
}

function applyImageFillCss(el, attrs) {
  var src = imageSrcOf(attrs);
  if (!src) return;
  // Escape quotes and parens conservatively; src values are typically URLs
  // or data: URIs so this is enough to prevent accidental CSS breakage.
  var safe = src.replace(/"/g, '%22').replace(/\)/g, '%29');
  el.style.backgroundImage = 'url("' + safe + '")';
  el.style.backgroundSize = imageFitOf(attrs);
  el.style.backgroundPosition = imagePosOf(attrs);
  el.style.backgroundRepeat = 'no-repeat';
}

// SVG pattern-based image fill for circles and polygons. Returns the pattern
// id so the caller can set `fill="url(#id)"` on the shape. When `fill` is
// a colour, it paints as a backdrop rect inside the pattern so a semi-
// transparent image lets the colour show through (parity with CSS stacking).
var _imagePatternCounter = 0;
function ensureDefs(svg) {
  var defs = svg.querySelector('defs');
  if (defs) return defs;
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.insertBefore(defs, svg.firstChild);
  return defs;
}
function buildImagePatternSvg(svg, attrs) {
  var src = imageSrcOf(attrs);
  if (!src) return null;
  var id = 'sd-img-pat-' + (++_imagePatternCounter);
  var pat = document.createElementNS(SVG_NS, 'pattern');
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'objectBoundingBox');
  pat.setAttribute('patternContentUnits', 'objectBoundingBox');
  pat.setAttribute('width', '1');
  pat.setAttribute('height', '1');
  // Optional backdrop colour so fill=colour shows through image alpha, and
  // remains visible if the image fails to load.
  var backdrop = attrs && attrs.fill && attrs.fill !== 'none' ? attrs.fill : null;
  if (backdrop) {
    var r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', '0'); r.setAttribute('y', '0');
    r.setAttribute('width', '1'); r.setAttribute('height', '1');
    r.setAttribute('fill', backdrop);
    pat.appendChild(r);
  }
  var img = document.createElementNS(SVG_NS, 'image');
  img.setAttributeNS(null, 'href', src);
  // SVG 1.1 fallback for older renderers (notably some PDF toolchains).
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', src);
  img.setAttribute('x', '0'); img.setAttribute('y', '0');
  img.setAttribute('width', '1'); img.setAttribute('height', '1');
  // `slice` = CSS cover; `meet` = CSS contain. imagePos maps to the xY*YmY*
  // meetOrSlice align keyword (four common positions cover the deck case;
  // full CSS parity is out of scope).
  var fit = imageFitOf(attrs) === 'contain' ? 'meet' : 'slice';
  var pos = imagePosOf(attrs);
  var align = 'xMidYMid';
  if (pos === 'top') align = 'xMidYMin';
  else if (pos === 'bottom') align = 'xMidYMax';
  else if (pos === 'left') align = 'xMinYMid';
  else if (pos === 'right') align = 'xMaxYMid';
  img.setAttribute('preserveAspectRatio', align + ' ' + fit);
  pat.appendChild(img);
  ensureDefs(svg).appendChild(pat);
  return id;
}

// REF-pixel dims of a grid-unit box. Stage is rW x REF_H; a w x h grid
// region maps to (w * REF_H / grid.h) x (h * REF_H / grid.h) px. Stashed
// on shape elements so downstream code (e.g. chart canvas sizing) can use
// declared geometry instead of measuring the live DOM, which races layout
// in some render paths.
function refDimsFor(w, h, grid) {
  var k = REF_H / grid.h;
  return { w: w * k, h: h * k };
}

function renderRect(s, grid) {
  var el = document.createElement('div');
  el.className = 'shape-rect';
  el.style.left = pct(s.x, grid.w);
  el.style.top = pct(s.y, grid.h);
  el.style.width = pct(s.w, grid.w);
  el.style.height = pct(s.h, grid.h);
  applyShapeStyle(el, s.attrs, grid);
  applyImageFillCss(el, s.attrs);
  applyPadding(el, s, grid);
  if (s.attrs && s.attrs.maxfont) el.dataset.maxfont = s.attrs.maxfont;
  if (s.attrs && s.attrs.align) el.dataset.align = s.attrs.align;
  if (s.attrs && s.attrs.valign) el.dataset.valign = s.attrs.valign;
  var dims = refDimsFor(s.w, s.h, grid);
  el.dataset.refw = String(dims.w);
  el.dataset.refh = String(dims.h);
  applySizing(el, s.attrs);
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content, s.attrs));
  if (s.id) el.dataset.id = s.id;
  return el;
}

function renderCircle(s, svgHost) {
  var el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', s.cx);
  el.setAttribute('cy', s.cy);
  el.setAttribute('r', s.r);
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (imageSrcOf(s.attrs)) {
    var patId = buildImagePatternSvg(svgHost, s.attrs);
    if (patId) el.setAttribute('fill', 'url(#' + patId + ')');
  }
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
  // The arrowhead uses markerUnits=strokeWidth + markerWidth=6, so the
  // head occupies the last 6 * strokeWidth of the arrow. We back the line
  // off by that amount and rely on refX=0 to put the tip back on (x2, y2).
  //
  // For arrows shorter than 12 * strokeWidth, the head would dominate (or
  // exceed) the line. Rather than letting the tip drift past (x2, y2),
  // scale the effective stroke width down so the head takes at most half
  // the arrow length. The agent's declared endpoints stay honest; the
  // arrow just renders thinner than the author asked for.
  var sw = (s.attrs && s.attrs.strokeWidth != null) ? s.attrs.strokeWidth : 0.02;
  var dx = s.x2 - s.x1;
  var dy = s.y2 - s.y1;
  var len = Math.sqrt(dx * dx + dy * dy);
  var effectiveSw = sw;
  var maxHead = len * 0.5;
  if (6 * sw > maxHead && len > 0) effectiveSw = maxHead / 6;
  var backoff = 6 * effectiveSw;
  var ex = s.x2, ey = s.y2;
  if (len > 0) {
    ex = s.x2 - (dx / len) * backoff;
    ey = s.y2 - (dy / len) * backoff;
  }
  line.setAttribute('x1', s.x1);
  line.setAttribute('y1', s.y1);
  line.setAttribute('x2', ex);
  line.setAttribute('y2', ey);
  applySvgStroke(line, s.attrs);
  if (effectiveSw !== sw) line.setAttribute('stroke-width', effectiveSw);
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

function renderPolygon(s, svgHost) {
  var el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', polyPath(s.points));
  // Match circle / ellipse: polygons default to NO stroke unless the
  // author opts in. Previously they fell through applySvgStroke's
  // `'#94a3b8'` fallback and rendered with a grey outline by default,
  // contradicting the "default: NO stroke" design principle.
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (imageSrcOf(s.attrs)) {
    var patId = buildImagePatternSvg(svgHost, s.attrs);
    if (patId) el.setAttribute('fill', 'url(#' + patId + ')');
  }
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
  if (s.attrs.color) {
    el.style.color = s.attrs.color;
    // Mirror onto --shape-color so the shadow root's `.inner` rule
    // (color: var(--shape-color, var(--md-color, inherit))) prefers the
    // shape's declared colour over the doc's --md-color. Without this,
    // a polygon with `color=#ffffff` on a dark fill still rendered the
    // text in the doc colour because --md-color won the var() chain.
    // Matches applyShapeStyle's behaviour for rectangles.
    el.style.setProperty('--shape-color', s.attrs.color);
  }
  applyPadding(el, s, grid);
  if (s.attrs && s.attrs.maxfont) el.dataset.maxfont = s.attrs.maxfont;
  if (s.attrs && s.attrs.align) el.dataset.align = s.attrs.align;
  if (s.attrs && s.attrs.valign) el.dataset.valign = s.attrs.valign;
  var dims = refDimsFor(box.w, box.h, grid);
  el.dataset.refw = String(dims.w);
  el.dataset.refh = String(dims.h);
  applySizing(el, s.attrs);
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content, s.attrs));
  if (s.id) el.dataset.id = s.id + '-text';
  return el;
}

function buildArrowheadDefs(color) {
  var defs = document.createElementNS(SVG_NS, 'defs');
  var marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', '_sd_arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '0');
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
  // to avoid rounding rejecting every size. If even minPx doesn't fit,
  // best stays at minPx and content overflows the shape visibly (shape
  // CSS uses overflow: visible) - the deliberate "looks broken when it
  // is broken" signal.
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

// Default cap for opt-in autofit (`size=fit`): font-size never exceeds this
// fraction of stage height. Roughly the size of an h1 on a pro deck. The
// per-shape `maxfont=Npx` overrides this cap when it's set.
var DEFAULT_MAX_FONT_STAGE_PCT = 0.12;

// Reference stage height. Slides render at REF_H tall at their native
// resolution; a CSS transform scales the whole canvas to whatever pixel
// size the context gives it. Font sizing, padding, autofit — all measured
// at this reference. Agents who type `size=18px` get literal 18px on a
// 720-tall slide, which scales down/up with the transform.
var REF_H = 720;
function refW(grid) { return REF_H * grid.w / grid.h; }

// Walks rendered shapes and runs the autofit binary search.
//   autofit='on'  - size=fit: fill-the-shape, capped at stage-height or
//                   per-shape maxfont=.
//   autofit='cap' - default role-based path: role's px is the cap; shrink
//                   down toward floor only when content would overflow.
//   autofit='off' - literal size=Npx: leave alone.
function applyAutoFit(container, minPx, maxStageHPct) {
  var floor = typeof minPx === 'number' ? minPx : 10;
  var pct = typeof maxStageHPct === 'number' ? maxStageHPct : DEFAULT_MAX_FONT_STAGE_PCT;
  var stageCap = REF_H * pct;
  var els = container.querySelectorAll('.shape-rect, .shape-text');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var mode = el.dataset.autofit;
    if (mode !== 'on' && mode !== 'cap') continue;
    var h = el.clientHeight;
    if (h <= 0) continue;
    var cap;
    if (mode === 'on') {
      var perShape = parseFloat(el.dataset.maxfont);
      cap = isFinite(perShape) && perShape > 0 ? perShape : stageCap;
    } else {
      var role = parseFloat(el.dataset.capsize);
      cap = isFinite(role) && role > 0 ? role : ROLE_SIZES.body;
    }
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
        L.svg.appendChild(renderCircle(s, L.svg));
        if (s.content) L.el.appendChild(renderTextOverlay(s, grid));
      } else if (s.kind === 'e') {
        L.svg.appendChild(renderEllipse(s));
        if (s.content) L.el.appendChild(renderTextOverlay(s, grid));
      } else if (s.kind === 'l') {
        L.svg.appendChild(renderLine(s));
      } else if (s.kind === 'a') {
        L.svg.appendChild(renderArrow(s, defsNeeded));
      } else if (s.kind === 'p') {
        L.svg.appendChild(renderPolygon(s, L.svg));
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
  var minFontPx = typeof options.minFontPx === 'number' ? options.minFontPx : 10;
  var maxStageHPct = typeof options.maxStageHPct === 'number' ? options.maxStageHPct : DEFAULT_MAX_FONT_STAGE_PCT;
  // eslint-disable-next-line no-unused-expressions
  stage.offsetHeight;
  applyAutoFit(stage, minFontPx, maxStageHPct);

  // Move stage into the real wrap. Shadow roots travel with their hosts,
  // so content and styles are preserved — no re-parse, no DOM rebuild.
  wrap.appendChild(stage);
  if (off.parentNode) off.parentNode.removeChild(off);

  attachScaler(wrap, stage, rW);

  // After shapes land in the live DOM, run chart / math / mermaid
  // post-processors against each shape's shadow root. They use
  // querySelectorAll which doesn't cross shadow boundaries, so each
  // shadow needs its own pass.
  // options.chartImages: array of PNG data URLs from a previous
  // inline render. When passed (rail-thumb context), chart code
  // blocks are replaced with <img> rather than re-rendered.
  processShadowBlocks(stage, { chartImages: options.chartImages });

  // Schedule a chart snapshot pass so present-mode rail thumbs
  // can substitute pre-rendered PNGs instead of re-instantiating
  // Chart.js at thumbnail dimensions (where fonts look enormous
  // and bars get crushed). The snapshot is stored on the wrap so
  // callers can fish it out. Skip when we already used PNGs (rail
  // thumbnail path) - no need to re-snapshot pre-rendered PNGs.
  if (!options.chartImages) snapshotChartsForReuse(stage, wrap);

  return result;
}

// Walk every .shape-md host in the stage and run the chart / math /
// mermaid processors on its shadow root. Each processor uses
// container.querySelectorAll, which doesn't cross shadow boundaries -
// so a single processor call against the main doc misses anything
// inside slide shapes.
//
// KaTeX and Mermaid both need stylesheets that don't cross the shadow
// boundary either. Inject them on demand into shadow roots that contain
// matching content; Chart.js draws to a canvas and needs no extra CSS.
function processShadowBlocks(stage, opts) {
  if (!stage || typeof stage.querySelectorAll !== 'function') return;
  opts = opts || {};
  var hosts = stage.querySelectorAll('.shape-md');
  var chartImageIndex = 0;
  for (var i = 0; i < hosts.length; i++) {
    var host = hosts[i];
    var root = host.shadowRoot;
    if (!root) continue;

    var hasChart   = !!root.querySelector('code.language-chart');
    var hasMath    = !!root.querySelector('.sdocs-math-display, .sdocs-math-inline');
    var hasMermaid = !!root.querySelector('code.language-mermaid');

    if (hasChart) {
      injectChartCss(root);
      if (opts.chartImages && opts.chartImages.length) {
        // Rail-thumb context: substitute pre-rendered PNGs for chart
        // code blocks. Avoids re-running Chart.js at thumbnail size
        // where the canvas measures tiny and fixed-px fonts blow up.
        var chartCodes = root.querySelectorAll('code.language-chart');
        for (var c = 0; c < chartCodes.length; c++) {
          var url = opts.chartImages[chartImageIndex++];
          var pre = chartCodes[c].closest('pre');
          if (!pre || !url) continue;
          var wrapperEl = document.createElement('div');
          wrapperEl.className = 'sdoc-chart';
          var img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.style.cssText = 'width: 100%; height: 100%; object-fit: contain; display: block;';
          wrapperEl.appendChild(img);
          pre.parentNode.replaceChild(wrapperEl, pre);
        }
      } else if (window.SDocs && typeof window.SDocs.processCharts === 'function') {
        // Pass the host shape's declared REF-pixel dims so processCharts
        // can size the chart canvas from authoritative geometry instead of
        // measuring the live DOM (which races layout in the inline path
        // and produced wrong aspect ratios for non-square charts).
        var parent = host.parentElement;
        var refW = parent ? parseFloat(parent.dataset.refw) : NaN;
        var refH = parent ? parseFloat(parent.dataset.refh) : NaN;
        try {
          window.SDocs.processCharts(root, {
            slideContext: true,
            shapeWidth: refW,
            shapeHeight: refH,
          });
        } catch (_) {}
      }
    }
    if (hasMath) {
      injectKatexCss(root);
      if (window.SDocs && typeof window.SDocs.processMath === 'function') {
        try { window.SDocs.processMath(root); } catch (_) {}
      }
    }
    if (hasMermaid) {
      injectMermaidCss(root);
      if (window.SDocs && typeof window.SDocs.processMermaid === 'function') {
        try { window.SDocs.processMermaid(root); } catch (_) {}
        // Force the SVG to fill its container in both dimensions. CSS
        // `height: 100%` on SVG is unreliable across browsers (Chromium
        // computes height from intrinsic aspect when width is fixed),
        // so set the inline style explicitly once the SVG exists.
        kickShadowMermaid(root);
      }
    }
  }
}

// Minimal chart CSS for shadow-rooted shapes. We hide the chart-menu UI
// entirely - the menu's click handler delegates from document, and DOM
// events inside a shadow root don't bubble to document listeners, so the
// menu would render visible-but-inert. Tighter padding than the main-doc
// rule (.sdoc-chart in rendered.css uses 16px) because the shape's own
// padding already adds breathing room.
// Chart wrapper inside a shape needs explicit dimensions for Chart.js
// (responsive + maintainAspectRatio) to size the canvas. The shape-md
// host is a flex item inside the .shape-rect parent, sized by its
// intrinsic content - but a chart has no intrinsic size, so the chain
// collapses to 0x0. Filling 100% of the host gives the canvas a real
// box to measure against.
//
// The chart-menu UI is hidden: its click handler delegates from
// document, and clicks inside a shadow root don't bubble to document
// listeners, so the menu would render visible-but-inert.
var CHART_SHADOW_CSS = [
  ':host { display: block; width: 100%; height: 100%; }',
  '.inner { width: 100%; height: 100%; }',
  '.sdoc-chart {',
  '  margin: 0; padding: 0; background: transparent;',
  '  width: 100%; height: 100%; max-width: 100%;',
  '  position: relative;',
  '}',
  '.sdoc-chart canvas { width: 100% !important; height: 100% !important; }',
  '.chart-menu-btn, .chart-menu { display: none !important; }',
].join('\n');

// Poll until the mermaid SVG appears inside the shadow root, then pin
// its inline width/height to the wrapper's clientWidth/clientHeight in
// pixels. CSS percentages do NOT work reliably here: Chromium ignores
// `height: 100%` on an SVG element with a viewBox and computes height
// from the intrinsic aspect ratio instead (even with !important).
// Setting explicit pixels forces the SVG element box to exactly the
// wrapper size; preserveAspectRatio="xMidYMid meet" (mermaid's default)
// then scales the viewBox content to fit, with letterboxing on the
// long axis instead of vertical overflow.
function kickShadowMermaid(shadow) {
  var attempts = 0;
  function tick() {
    attempts++;
    var wrapper = shadow.querySelector('.sdoc-mermaid');
    var svg = wrapper && wrapper.querySelector('svg.sdoc-mermaid-svg');
    if (wrapper && svg && wrapper.clientWidth > 0 && wrapper.clientHeight > 0) {
      svg.style.setProperty('width',  wrapper.clientWidth  + 'px', 'important');
      svg.style.setProperty('height', wrapper.clientHeight + 'px', 'important');
      svg.style.setProperty('max-width', '100%', 'important');
      svg.style.setProperty('visibility', 'visible', 'important');
      return;
    }
    if (attempts < 40) setTimeout(tick, 100);
  }
  setTimeout(tick, 80);
}

// Wait until every chart canvas inside `stage` has a Chart.js instance
// attached and a non-zero drawing buffer, then snapshot each canvas to
// a PNG data URL. The PNGs are stashed on the wrap element so present
// mode (or other callers) can read them via wrap.__chartImages.
//
// Reason: rail thumbnails in present mode re-render the slide DSL at
// thumbnail dimensions, where Chart.js's internal measurement collapses
// and fixed-px fonts render at chart-dominating sizes. Substituting the
// pre-rendered PNG sidesteps the whole re-render path.
function snapshotChartsForReuse(stage, wrap) {
  var canvases = [];
  var hosts = stage.querySelectorAll('.shape-md');
  for (var i = 0; i < hosts.length; i++) {
    var root = hosts[i].shadowRoot;
    if (!root) continue;
    var cs = root.querySelectorAll('canvas');
    for (var j = 0; j < cs.length; j++) canvases.push(cs[j]);
  }
  if (!canvases.length) return;

  var attempts = 0;
  function tick() {
    attempts++;
    var Chart = window.Chart;
    var allReady = Chart && canvases.every(function (c) {
      var chart = Chart.getChart ? Chart.getChart(c) : null;
      return chart && c.width > 0 && c.height > 0;
    });
    if (allReady) {
      wrap.__chartImages = canvases.map(function (c) {
        try { return c.toDataURL('image/png'); } catch (_) { return null; }
      });
      return;
    }
    if (attempts < 40) setTimeout(tick, 100);
  }
  setTimeout(tick, 100);
}

function injectChartCss(shadow) {
  if (shadow._chartCssInjected) return;
  shadow._chartCssInjected = true;
  var style = document.createElement('style');
  style.textContent = CHART_SHADOW_CSS;
  shadow.appendChild(style);
  // The shape-md host CSS in SHAPE_MD_SHADOW_CSS uses `:host { display: block }`
  // with intrinsic sizing. For a chart shape, give the host an explicit
  // width/height so the chart wrapper has a parent box to fill. Other
  // shape kinds (text-only) keep the original intrinsic sizing.
  if (shadow.host) {
    shadow.host.style.width = '100%';
    shadow.host.style.height = '100%';
  }
}

// KaTeX CSS lives at the same URL the math module loads. Injecting a
// <link> inside the shadow root makes the rules apply to katex output
// that lives there. The browser de-dupes the underlying fetch across
// many shadow roots that reference the same href.
var KATEX_CSS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
function injectKatexCss(shadow) {
  if (shadow._katexCssInjected) return;
  shadow._katexCssInjected = true;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = KATEX_CSS_URL;
  shadow.appendChild(link);
}

// Subset of the .sdoc-mermaid polish from css/rendered.css, tightened
// for use inside a slide shape (no outer margin / padding / fill - the
// shape itself owns those). Keep the SVG-side selectors (rx/ry rounding,
// edge-label chip styling, foreignObject line-height) in sync with the
// matching block in rendered.css. The chip's background-color inherits
// --md-block-bg, which crosses the shadow boundary cleanly.
var MERMAID_SHADOW_CSS = [
  ':host { display: block; width: 100%; height: 100%; }',
  '.inner { width: 100%; height: 100%; text-align: center; }',
  // `position: relative` is required so the expand button (which is
  // position: absolute at top:6px / right:6px) anchors to the diagram
  // wrapper rather than floating up to the next positioned ancestor.
  '.sdoc-mermaid {',
  '  margin: 0; padding: 0; background: transparent;',
  '  overflow: hidden; text-align: center;',
  '  width: 100%; height: 100%; position: relative;',
  '}',
  // SVG fills the container; mermaid's default preserveAspectRatio
  // (xMidYMid meet) scales the viewBox content to fit inside the SVG
  // element while preserving aspect ratio. With height: auto the SVG
  // element grew to whatever the diagram's natural ratio dictated and
  // a tall diagram (state machine, vertical sequence) overflowed the
  // shape; making the SVG element box-size 100%x100% means the diagram
  // shrinks to fit vertically when needed, with empty space on the
  // long axis instead of clipping on the short one.
  //
  // !important is required because mermaid writes an inline
  //   style="max-width: <natural-px>px"
  // on the SVG. Without overriding it, the SVG can never grow past
  // its natural viewBox width, so width:100% gets clamped and height
  // (auto-computed from aspect) overflows the wrapper.
  // svg.sdoc-mermaid-svg (the diagram itself) starts hidden until
  // kickShadowMermaid pins explicit pixel dimensions. Without this,
  // the SVG paints once at its auto-height size (Chromium computes
  // height from viewBox aspect, ignoring height:100%), then snaps to
  // the correct size when the kick fires - visible as a flicker /
  // resize when navigating between slides.
  //
  // Scoped to the .sdoc-mermaid-svg class so the inline icon SVG
  // inside the expand button (sibling element inside .sdoc-mermaid)
  // stays visible.
  '.sdoc-mermaid svg.sdoc-mermaid-svg { width: 100% !important; height: 100% !important; max-width: 100% !important; display: block; visibility: hidden; }',
  'svg.sdoc-mermaid-svg { overflow: visible; }',
  'svg.sdoc-mermaid-svg .node > rect,',
  'svg.sdoc-mermaid-svg .node .label-container,',
  'svg.sdoc-mermaid-svg .actor,',
  'svg.sdoc-mermaid-svg .note > rect,',
  'svg.sdoc-mermaid-svg .er.entityBox,',
  'svg.sdoc-mermaid-svg .label-container[rx],',
  'svg.sdoc-mermaid-svg rect.task { rx: 6px; ry: 6px; }',
  '.edgeLabel foreignObject > div {',
  '  min-width: 0;',
  '  width: max-content !important;',
  '  max-width: 240px !important;',
  '  white-space: normal !important;',
  '  padding: 2px 8px; border-radius: 8px;',
  '  background-color: var(--md-block-bg, #f4f1ed);',
  '}',
  'svg.sdoc-mermaid-svg span.edgeLabel { background: transparent !important; }',
  'foreignObject > div { min-width: 120px; text-align: center; }',
  'foreignObject, foreignObject > div, foreignObject span { line-height: normal; }',
  // The expand button is styled by global CSS in sdocs-mermaid-focus.js,
  // which doesn't cross the shadow boundary. Mirror the rules here so
  // the button anchors to the diagram wrapper instead of falling back
  // to position:static and landing in the middle of the shape.
  '.sdoc-mermaid-zoom-btn {',
  '  position: absolute; top: 6px; right: 6px;',
  '  width: 26px; height: 26px;',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  background: transparent;',
  '  color: var(--md-color, #1c1917);',
  '  border: 1px solid var(--md-copy-btn-border, rgba(0,0,0,0.12));',
  '  border-radius: 4px;',
  '  cursor: pointer; opacity: 0.7;',
  '  transition: opacity .15s, background .12s;',
  '  z-index: 2;',
  '}',
  '.sdoc-mermaid-zoom-btn:hover,',
  '.sdoc-mermaid-zoom-btn:focus { opacity: 1; }',
  '.sdoc-mermaid-zoom-btn:hover {',
  '  background: var(--md-copy-btn-hover, rgba(0,0,0,0.05));',
  '}',
].join('\n');

function injectMermaidCss(shadow) {
  if (shadow._mermaidCssInjected) return;
  shadow._mermaidCssInjected = true;
  var style = document.createElement('style');
  style.textContent = MERMAID_SHADOW_CSS;
  shadow.appendChild(style);
  // Same reason as injectChartCss: mermaid has no intrinsic size before
  // render, so the shape-md host collapses without an explicit fill.
  if (shadow.host) {
    shadow.host.style.width = '100%';
    shadow.host.style.height = '100%';
  }
}

window.SDocShapeRender = {
  renderShapes: renderShapes,
};

})();
