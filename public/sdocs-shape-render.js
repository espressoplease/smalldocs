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
  /* Per-element copy button. Sits top-right of a text-bearing shape, hidden */
  /* until the shape is hovered (or the button is focused). Lives inside the */
  /* scaled stage, so its reference px size is deliberately generous to stay */
  /* clickable once the stage shrinks for small inline slides. Default colour */
  /* inherits the doc foreground; .is-dark / .is-light variants are toggled */
  /* by JS from the shape\'s own fill luminance so it contrasts a coloured */
  /* shape instead of vanishing into it. */
  '.sd-shape-stage .sd-shape-copy-btn {',
  '  position: absolute; top: 4px; right: 4px; z-index: 6;',
  '  display: none; align-items: center; justify-content: center;',
  '  width: 30px; height: 30px; padding: 0; margin: 0;',
  '  background: rgba(127,127,127,0.12);',
  '  color: currentColor;',
  '  border: 1px solid rgba(127,127,127,0.30);',
  '  border-radius: 5px; cursor: pointer; opacity: 0.9;',
  '  transition: opacity .15s, background .12s;',
  '}',
  '.sd-shape-stage .sd-shape-copy-btn svg { width: 16px; height: 16px; display: block; pointer-events: none; }',
  '.sd-shape-stage .shape-rect:hover > .sd-shape-copy-btn,',
  '.sd-shape-stage .shape-text:hover > .sd-shape-copy-btn,',
  '.sd-shape-stage .sd-shape-copy-btn:focus-visible,',
  '.sd-shape-stage .sd-shape-copy-btn.copied { display: inline-flex; }',
  '.sd-shape-stage .sd-shape-copy-btn:hover { opacity: 1; background: rgba(127,127,127,0.22); }',
  '.sd-shape-stage .sd-shape-copy-btn:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
  '.sd-shape-stage .sd-shape-copy-btn.is-dark { color: #f5f5f4; background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.32); }',
  '.sd-shape-stage .sd-shape-copy-btn.is-dark:hover { background: rgba(255,255,255,0.24); }',
  '.sd-shape-stage .sd-shape-copy-btn.is-light { color: #1c1917; background: rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.22); }',
  '.sd-shape-stage .sd-shape-copy-btn.is-light:hover { background: rgba(0,0,0,0.12); }',
  '.sd-shape-stage .sd-shape-copy-btn.copied { color: #16a34a; border-color: #86efac; opacity: 1; }',
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
  /* Slide code blocks wrap; the inline-doc `overflow-x: auto` would clip */
  /* under the stage's `overflow: hidden`, silently losing the right side */
  /* of any line wider than the shape. `overflow-wrap: anywhere` lets the */
  /* browser break unbreakable tokens (long URLs, base64) as a fallback. */
  /* `padding-top: 1.8em` reserves a strip above the code for the copy   */
  /* button, em-based so it scales with the rest of the slide rather     */
  /* than locking to the inline-doc's 26px (which would shrink under the */
  /* slide's CSS transform).                                              */
  'pre {',
  '  position: relative;',
  '  margin: 0.3em 0; padding: 0.4em 0.6em; padding-top: 1.8em;',
  '  background: var(--md-pre-bg, rgba(0,0,0,.08));',
  '  border-radius: 4px; text-align: left; font-size: 0.85em;',
  '  white-space: pre-wrap; overflow-wrap: anywhere;',
  '  line-height: 1.3;',
  '  color: var(--md-code-color, inherit);',
  '}',
  'pre code {',
  '  background: none; padding: 0; font-size: inherit;',
  '  color: var(--md-code-color, inherit);',
  '  font-family: var(--md-code-font, inherit);',
  '  white-space: pre-wrap; overflow-wrap: anywhere;',
  '}',
  /* Copy button on slide code blocks, mirroring the inline-doc styling   */
  /* in rendered.css (`.pre-wrapper .copy-btn`). All sizing is em-based   */
  /* so the button scales with the slide's CSS transform; if it used     */
  /* fixed px it would shrink to a tiny dot at thumbnail scale.           */
  '.sd-code-copy-btn {',
  '  position: absolute; top: 0.3em; right: 0.3em;',
  '  display: flex; align-items: center; gap: 0.2em;',
  '  margin: 0; padding: 0.25em 0.4em;',
  '  background: var(--md-pre-bg, rgba(0,0,0,0.05));',
  '  color: var(--md-code-color, currentColor);',
  '  border: 1px solid var(--md-copy-btn-border, rgba(0,0,0,0.12));',
  '  border-radius: 0.25em;',
  '  cursor: pointer; opacity: 0.7;',
  '  transition: opacity 0.15s, background 0.12s;',
  '  font: inherit; font-size: 0.9em; line-height: 1;',
  '  z-index: 1;',
  '}',
  '.sd-code-copy-btn svg { width: 1em; height: 1em; display: block; }',
  'pre:hover .sd-code-copy-btn { opacity: 1; }',
  '.sd-code-copy-btn:hover { background: var(--md-copy-btn-hover, rgba(0,0,0,0.05)); opacity: 1; }',
  '.sd-code-copy-btn:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; opacity: 1; }',
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
  ':host(.shape-md-code-only.shape-md-fill) pre { background: transparent; border-radius: 0; margin: 0; padding: 0.3em 0.6em; padding-top: 1.8em; font-size: 1em; }',
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
  attachCodeCopyButtons(shadow);
  return host;
}

// Copy-button SVGs — duplicated from sdocs-app.js because the slide shadow
// DOM has no access to the host page's COPY_SVG / CHECK_SVG constants.
// If those change in sdocs-app.js, mirror the change here.
var SHAPE_COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var SHAPE_CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// Walk every <pre> in the shape's shadow DOM and append a copy button.
// The button lives inside the <pre> so it positions relative to the code
// container itself, not to outer content. textContent is read from the
// inner <code> element when present so the copied text excludes the
// button's own SVG markup.
function attachCodeCopyButtons(shadow) {
  if (!shadow || !shadow.querySelectorAll) return;
  var pres = shadow.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    (function(pre) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sd-code-copy-btn';
      btn.innerHTML = SHAPE_COPY_SVG;
      btn.title = 'Copy code';
      btn.setAttribute('aria-label', 'Copy code');
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var code = pre.querySelector('code');
        var text = code ? code.textContent : pre.textContent;
        if (!navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(text).then(function() {
          btn.innerHTML = SHAPE_CHECK_SVG;
          setTimeout(function() { btn.innerHTML = SHAPE_COPY_SVG; }, 1500);
        });
      });
      pre.appendChild(btn);
    })(pres[i]);
  }
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

// Read the rendered plain text of a text-bearing shape element. Its content
// lives in an open shadow root (.shape-md), so reach through it the same way
// measurementTarget does; fall back to the element's own textContent for the
// no-shadow path (test runners, plain-text fallback).
function readShapeText(el) {
  if (!el) return '';
  var shapeMd = el.querySelector && el.querySelector('.shape-md');
  if (shapeMd && shapeMd.shadowRoot) {
    var inner = shapeMd.shadowRoot.querySelector('.inner');
    if (inner) return (inner.textContent || '').trim();
  }
  return (el.textContent || '').trim();
}

// Concatenate the rendered text of every text-bearing shape in a stage, in
// DOM (paint) order, so "copy slide" yields the slide's readable text.
function collectSlideText(stage) {
  if (!stage || !stage.querySelectorAll) return '';
  var els = stage.querySelectorAll('.shape-rect, .shape-text');
  var parts = [];
  for (var i = 0; i < els.length; i++) {
    var t = readShapeText(els[i]);
    if (t) parts.push(t);
  }
  return parts.join('\n\n');
}

function legacyCopyText(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

function copyTextToClipboard(text, onDone) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onDone, function () { legacyCopyText(text); onDone(); });
  } else {
    legacyCopyText(text);
    onDone();
  }
}

// True when a shape carries copyable prose. Pure code blocks are excluded —
// they already get their own in-shadow copy button via attachCodeCopyButtons,
// which also covers chart / mermaid fenced blocks (their JSON/source isn't
// useful as "slide text").
function shapeHasCopyableText(s, el) {
  if (!s || s.content == null || s.content === '') return false;
  if (contentIsOnlyCodeBlock(s.content)) return false;
  return readShapeText(el).length > 0;
}

// Per-element copy button for a text-bearing shape. Hidden until the shape is
// hovered; its colour contrasts the shape's own fill so it stays legible on a
// coloured shape. Copies the shape's rendered text.
function attachShapeCopyButton(el, s, grid) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sd-shape-copy-btn';
  btn.title = 'Copy text';
  btn.setAttribute('aria-label', 'Copy this text');
  btn.innerHTML = SHAPE_COPY_SVG;
  // Contrast: prefer the shape's own fill, then the grid background.
  var fill = s.attrs && s.attrs.fill;
  var bg = (fill && fill !== 'none' && fill !== 'transparent')
    ? fill
    : (grid && grid.attrs && grid.attrs.bg) || null;
  var lum = bg ? colorLuminance(bg) : null;
  if (typeof lum === 'number') btn.classList.add(lum < 0.5 ? 'is-dark' : 'is-light');
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    copyTextToClipboard(readShapeText(el), function () {
      btn.classList.add('copied');
      btn.innerHTML = SHAPE_CHECK_SVG;
      setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = SHAPE_COPY_SVG; }, 1500);
    });
  });
  el.appendChild(btn);
  return btn;
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

// `opacity=N` (0..1) fades the whole shape — fill, stroke, AND any text
// content together. CSS clamps out-of-range values, and we accept any
// numeric string. Applies uniformly to HTML rects, per-shape SVGs, and
// text overlays so a single attribute on the shape fades its visible
// surface in one stroke.
function applyOpacity(el, attrs) {
  if (!attrs || attrs.opacity == null) return;
  var n = parseFloat(attrs.opacity);
  if (!isNaN(n)) el.style.opacity = String(n);
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
  applyOpacity(el, attrs);
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
  if (s.content != null && s.content !== '') {
    // textBox=x,y,w,h on a rectangle inset / shifts the area that holds
    // the markdown content, leaving the rect's fill / stroke / dimensions
    // unchanged. Same coordinate convention as on polygons: x,y,w,h in
    // grid units, relative to the rect's top-left.
    var tb = window.SDocShapes && window.SDocShapes.parseTextBox
      ? window.SDocShapes.parseTextBox(s.attrs && s.attrs.textBox) : null;
    if (tb) {
      var inner = document.createElement('div');
      inner.className = 'shape-rect-textbox';
      inner.style.position = 'absolute';
      inner.style.left = (tb.x / s.w * 100) + '%';
      inner.style.top = (tb.y / s.h * 100) + '%';
      inner.style.width = (tb.w / s.w * 100) + '%';
      inner.style.height = (tb.h / s.h * 100) + '%';
      inner.style.display = 'flex';
      inner.style.alignItems = el.dataset.valign === 'top' ? 'flex-start'
        : el.dataset.valign === 'bottom' ? 'flex-end' : 'center';
      inner.style.justifyContent = el.dataset.align === 'left' ? 'flex-start'
        : el.dataset.align === 'right' ? 'flex-end' : 'center';
      inner.style.textAlign = el.dataset.align || 'center';
      el.style.position = 'relative';
      attachRotatedContent(inner, s, grid, tb.w, tb.h);
      el.appendChild(inner);
    } else {
      attachRotatedContent(el, s, grid, s.w, s.h);
    }
  }
  if (s.id) el.dataset.id = s.id;
  return el;
}

// Attach (optionally rotated) markdown content to a shape element.
//   - textAngle missing / 0 / NaN -> content attached directly (no wrap).
//   - textAngle == 90 or -90       -> content sits in an absolutely-positioned
//                                      wrapper whose layout dimensions are
//                                      SWAPPED, so text wraps along the
//                                      rotated long axis (axis-label case).
//   - any other angle              -> simple CSS rotate on the content node;
//                                      no dimension swap. The author is
//                                      responsible for sizing the shape so
//                                      the rotated text fits (see slides
//                                      docs for the bbox formula).
function attachRotatedContent(hostEl, s, grid, w, h) {
  var node = contentToMarkdownNode(s.content, s.attrs);
  var raw = s.attrs && s.attrs.textAngle;
  var angle = (raw != null && raw !== '') ? parseFloat(raw) : 0;
  if (!isFinite(angle)) angle = 0;
  // Normalize to (-180, 180].
  if (angle !== 0) angle = ((angle % 360) + 540) % 360 - 180;
  if (angle === 0) { hostEl.appendChild(node); return; }
  if (angle === 90 || angle === -90) {
    // Use CSS writing-mode for vertical text flow. `vertical-rl` flows
    // top-to-bottom from the right edge; `text-orientation: sideways`
    // keeps Latin glyphs upright (rotated 90 CW from horizontal). For
    // -90 (bottom-to-top, classic y-axis reading direction) we rotate
    // the wrap an additional 180 deg. The wrap takes the shape's full
    // bounding box; the inner text flows naturally inside it without
    // any swap-dim percentage math.
    var wrap = document.createElement('div');
    wrap.className = 'shape-text-rotated';
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.writingMode = 'vertical-rl';
    wrap.style.textOrientation = 'sideways';
    if (angle === -90) {
      wrap.style.transform = 'rotate(180deg)';
    }
    wrap.appendChild(node);
    hostEl.style.position = 'relative';
    hostEl.appendChild(wrap);
    return;
  }
  // Arbitrary angle: simple rotation, no dim swap. Autofit is left alone
  // (it measures the unrotated content against the shape bbox; the author
  // sizes the shape with the bbox formula in mind).
  node.style.transform = 'rotate(' + angle + 'deg)';
  node.style.transformOrigin = 'center center';
  hostEl.appendChild(node);
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

// Pure path-builder helpers — return the SVG `d` string for each shape in
// grid coordinates. The renderer wraps the result in an SVG <path> element;
// the slide-PDF exporter reuses the same strings via `page.drawSvgPath`, so
// vector output stays identical across both surfaces.
function chevPath(s) {
  var tip = window.SDocShapes.chevTip(s);
  var notch = window.SDocShapes.chevNotch(s);
  var x = s.x, y = s.y, w = s.w, h = s.h;
  if (notch > 0) {
    return 'M ' + x + ' ' + y +
           ' L ' + (x + w - tip) + ' ' + y +
           ' L ' + (x + w) + ' ' + (y + h / 2) +
           ' L ' + (x + w - tip) + ' ' + (y + h) +
           ' L ' + x + ' ' + (y + h) +
           ' L ' + (x + notch) + ' ' + (y + h / 2) +
           ' Z';
  }
  return 'M ' + x + ' ' + y +
         ' L ' + (x + w - tip) + ' ' + y +
         ' L ' + (x + w) + ' ' + (y + h / 2) +
         ' L ' + (x + w - tip) + ' ' + (y + h) +
         ' L ' + x + ' ' + (y + h) +
         ' Z';
}

function renderChev(s) {
  var el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', chevPath(s));
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

// Cylinder is two paths: a filled body that traces over-the-top, down,
// under-the-bottom, and back up the left edge; and a stroke-only cap that
// re-draws the visible front arc of the top ellipse so the lid reads as
// 3D even when the body is filled. Cap colour/width come from the shape
// stroke attrs (defaulted) so the body's stroke styling stays separate.
function cylPaths(s) {
  var lip = window.SDocShapes.cylLip(s);
  var x = s.x, y = s.y, w = s.w, h = s.h;
  var rx = w / 2;
  var ry = lip / 2;
  var body = 'M ' + x + ' ' + (y + ry) +
             ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ry) +
             ' L ' + (x + w) + ' ' + (y + h - ry) +
             ' A ' + rx + ' ' + ry + ' 0 0 1 ' + x + ' ' + (y + h - ry) +
             ' Z';
  var cap = 'M ' + x + ' ' + (y + ry) +
            ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ry);
  var capColor = (s.attrs && s.attrs.stroke) || '#94a3b8';
  var capW = (s.attrs && s.attrs.strokeWidth != null) ? s.attrs.strokeWidth : 0.06;
  return { body: body, cap: cap, capColor: capColor, capW: capW };
}

function renderCyl(s) {
  var p = cylPaths(s);
  var g = document.createElementNS(SVG_NS, 'g');
  var body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', p.body);
  applySvgStroke(body, s.attrs, 'none');
  if (!s.attrs.fill) body.setAttribute('fill', '#ffffff');
  g.appendChild(body);
  // Lid: the full top ellipse, so the shape reads as a database cylinder
  // rather than a lidless tube. On a filled cyl the lid is a light highlight
  // (its lower edge is the seam between lid and body); on an outline cyl it is
  // the ellipse outline.
  var lip = window.SDocShapes.cylLip(s);
  var lid = document.createElementNS(SVG_NS, 'ellipse');
  lid.setAttribute('cx', String(s.x + s.w / 2));
  lid.setAttribute('cy', String(s.y + lip / 2));
  lid.setAttribute('rx', String(s.w / 2));
  lid.setAttribute('ry', String(lip / 2));
  if (s.attrs.fill) {
    var lc = window.SDocShapes.cylLidColors(s.attrs.fill);
    lid.setAttribute('fill', lc ? lc.lid : 'rgba(255,255,255,0.45)');
    lid.setAttribute('stroke', lc ? lc.seam : 'rgba(0,0,0,0.15)');
    lid.setAttribute('stroke-width', String(p.capW));
  } else {
    lid.setAttribute('fill', 'none');
    lid.setAttribute('stroke', p.capColor);
    lid.setAttribute('stroke-width', String(p.capW));
  }
  g.appendChild(lid);
  if (s.id) g.dataset.id = s.id;
  return g;
}

function bubPath(s) {
  var tail = window.SDocShapes.bubTail(s);
  var x = s.x, y = s.y, w = s.w, h = s.h;
  var rad = (s.attrs && s.attrs.radius != null) ? parseFloat(s.attrs.radius) : 1;
  if (!isFinite(rad) || rad < 0) rad = 0;
  rad = Math.min(rad, w / 2, h / 2);

  // tailStyle picks the tail silhouette.
  //   concave (default): sides curve toward the tail axis - elegant horn /
  //                      teardrop. Reads as "designed."
  //   sharp:             straight narrow triangle. Schematic, "needle."
  //   wide:              straight wider triangle. Friendly, generic-callout.
  var style = (s.attrs && s.attrs.tailStyle) || 'concave';
  var STYLE = { sharp: 0.18, wide: 0.32, concave: 0.26 };
  var baseW = (STYLE[style] != null ? STYLE[style] : STYLE.concave) * Math.min(w, h);

  var edge = null;
  if (tail) {
    var cx = x + w / 2;
    var cy = y + h / 2;
    var dx = tail.x - cx;
    var dy = tail.y - cy;
    var horiz = Math.abs(dx) * h > Math.abs(dy) * w; // pick edge by aspect
    edge = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Build the SVG commands for the tail between two base points p1 and p2
  // (in path traversal order), routed via the tail tip.
  function tailCmds(p1, p2, tip) {
    if (style === 'sharp' || style === 'wide') {
      return ' L ' + p1.x + ' ' + p1.y +
             ' L ' + tip.x + ' ' + tip.y +
             ' L ' + p2.x + ' ' + p2.y;
    }
    // concave: quadratic Beziers whose control points are pulled toward the
    // tail's central axis, so the sides bow inward and the silhouette tapers
    // smoothly from base to tip.
    var baseCx = (p1.x + p2.x) / 2;
    var baseCy = (p1.y + p2.y) / 2;
    var k = 0.35; // inward pull strength
    var c1x = (p1.x + tip.x) / 2 + (baseCx - p1.x) * k;
    var c1y = (p1.y + tip.y) / 2 + (baseCy - p1.y) * k;
    var c2x = (p2.x + tip.x) / 2 + (baseCx - p2.x) * k;
    var c2y = (p2.y + tip.y) / 2 + (baseCy - p2.y) * k;
    return ' L ' + p1.x + ' ' + p1.y +
           ' Q ' + c1x + ' ' + c1y + ' ' + tip.x + ' ' + tip.y +
           ' Q ' + c2x + ' ' + c2y + ' ' + p2.x + ' ' + p2.y;
  }

  var d = 'M ' + (x + rad) + ' ' + y;

  // Top edge -> top-right corner
  if (edge === 'top' && tail) {
    var ax = clamp(tail.x, x + rad + baseW / 2, x + w - rad - baseW / 2);
    d += tailCmds({ x: ax - baseW / 2, y: y }, { x: ax + baseW / 2, y: y }, tail);
  }
  d += ' L ' + (x + w - rad) + ' ' + y;
  d += ' A ' + rad + ' ' + rad + ' 0 0 1 ' + (x + w) + ' ' + (y + rad);

  // Right edge -> bottom-right corner
  if (edge === 'right' && tail) {
    var ay = clamp(tail.y, y + rad + baseW / 2, y + h - rad - baseW / 2);
    d += tailCmds({ x: x + w, y: ay - baseW / 2 }, { x: x + w, y: ay + baseW / 2 }, tail);
  }
  d += ' L ' + (x + w) + ' ' + (y + h - rad);
  d += ' A ' + rad + ' ' + rad + ' 0 0 1 ' + (x + w - rad) + ' ' + (y + h);

  // Bottom edge -> bottom-left corner
  if (edge === 'bottom' && tail) {
    var ax2 = clamp(tail.x, x + rad + baseW / 2, x + w - rad - baseW / 2);
    d += tailCmds({ x: ax2 + baseW / 2, y: y + h }, { x: ax2 - baseW / 2, y: y + h }, tail);
  }
  d += ' L ' + (x + rad) + ' ' + (y + h);
  d += ' A ' + rad + ' ' + rad + ' 0 0 1 ' + x + ' ' + (y + h - rad);

  // Left edge -> top-left corner
  if (edge === 'left' && tail) {
    var ay2 = clamp(tail.y, y + rad + baseW / 2, y + h - rad - baseW / 2);
    d += tailCmds({ x: x, y: ay2 + baseW / 2 }, { x: x, y: ay2 - baseW / 2 }, tail);
  }
  d += ' L ' + x + ' ' + (y + rad);
  d += ' A ' + rad + ' ' + rad + ' 0 0 1 ' + (x + rad) + ' ' + y;
  d += ' Z';
  return d;
}

function renderBub(s) {
  var el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', bubPath(s));
  el.setAttribute('stroke-linejoin', 'round');
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

function tabPath(s) {
  var th = window.SDocShapes.tabHeight(s);
  var x = s.x, y = s.y, w = s.w, h = s.h;
  // Tab portion sits on top-left, ~38% of body width by default.
  var tabW = (s.attrs && s.attrs.tabW != null && s.attrs.tabW !== '')
    ? Math.min(parseFloat(s.attrs.tabW), w * 0.9)
    : w * 0.38;
  // Sloped neck between tab and body, ~ tab height for a 45-ish degree slope.
  var slope = Math.min(th, w - tabW);
  return 'M ' + x + ' ' + y +
         ' L ' + (x + tabW) + ' ' + y +
         ' L ' + (x + tabW + slope) + ' ' + (y + th) +
         ' L ' + (x + w) + ' ' + (y + th) +
         ' L ' + (x + w) + ' ' + (y + h) +
         ' L ' + x + ' ' + (y + h) +
         ' Z';
}

function renderTab(s) {
  var el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', tabPath(s));
  el.setAttribute('stroke-linejoin', 'round');
  applySvgStroke(el, s.attrs, 'none');
  if (!s.attrs.fill) el.setAttribute('fill', '#ffffff');
  if (s.id) el.dataset.id = s.id;
  return el;
}

// Doc shape: body outline with the top-right corner cut off, plus an
// inset triangle in the cut corner drawn as a semi-transparent black
// overlay so the corner reads as a 3D fold over any body fill colour.
function docPaths(s) {
  var fold = window.SDocShapes.docFold(s);
  var x = s.x, y = s.y, w = s.w, h = s.h;
  var body = 'M ' + x + ' ' + y +
             ' L ' + (x + w - fold) + ' ' + y +
             ' L ' + (x + w) + ' ' + (y + fold) +
             ' L ' + (x + w) + ' ' + (y + h) +
             ' L ' + x + ' ' + (y + h) +
             ' Z';
  var foldD = 'M ' + (x + w - fold) + ' ' + y +
              ' L ' + (x + w) + ' ' + (y + fold) +
              ' L ' + (x + w - fold) + ' ' + (y + fold) +
              ' Z';
  return { body: body, fold: foldD };
}

function renderDoc(s) {
  var p = docPaths(s);
  var g = document.createElementNS(SVG_NS, 'g');
  var body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', p.body);
  body.setAttribute('stroke-linejoin', 'round');
  applySvgStroke(body, s.attrs, 'none');
  if (!s.attrs.fill) body.setAttribute('fill', '#ffffff');
  g.appendChild(body);

  var foldEl = document.createElementNS(SVG_NS, 'path');
  foldEl.setAttribute('d', p.fold);
  foldEl.setAttribute('fill', 'rgba(0,0,0,0.18)');
  foldEl.setAttribute('stroke', 'none');
  g.appendChild(foldEl);

  if (s.id) g.dataset.id = s.id;
  return g;
}

// Cloud path data fetched verbatim from each icon library's canonical
// SVG source. Variant key -> { d, vbW, vbH, yOffset, fillRule } where
// yOffset (defaults 0) corrects Material's inverted viewBox.
//
// Three variants kept: heroicons (default - sharp / modern), material
// (puffy / friendly), bootstrap (smooth / balanced). Tabler reads as a
// speech bubble more than a cloud; Phosphor has a rendering artifact
// (notch on top-right). Both were dropped after a side-by-side review.
var CLOUD_VARIANTS = {
  heroicons: {
    d: 'M4.5 9.75a6 6 0 0 1 11.573-2.226 3.75 3.75 0 0 1 4.133 4.303A4.5 4.5 0 0 1 18 20.25H6.75a5.25 5.25 0 0 1-2.23-10.004 6.072 6.072 0 0 1-.02-.496Z',
    vbW: 24, vbH: 24, fillRule: 'evenodd'
  },
  material: {
    d: 'M260-160q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 75-52.5 127.5T740-160H260Z',
    vbW: 960, vbH: 960, yOffset: 960
  },
  bootstrap: {
    d: 'M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383Z',
    vbW: 16, vbH: 16
  }
};

function renderCloud(s) {
  var variant = (s.attrs && s.attrs.variant) || 'heroicons';
  var spec = CLOUD_VARIANTS[variant] || CLOUD_VARIANTS.heroicons;
  var x = s.x, y = s.y, w = s.w, h = s.h;

  // Wrap the canonical icon path in a <g> that translates + scales it
  // into the shape's (x, y, w, h) box. vector-effect="non-scaling-stroke"
  // keeps the stroke width uniform regardless of aspect ratio.
  // Material's path uses a (0, -vbH) viewBox; yOffset shifts the path
  // back into a (0, 0)-(vbW, vbH) frame before scaling.
  var g = document.createElementNS(SVG_NS, 'g');
  var t = 'translate(' + x + ' ' + y + ') scale(' + (w / spec.vbW) + ' ' + (h / spec.vbH) + ')';
  if (spec.yOffset) t += ' translate(0 ' + spec.yOffset + ')';
  g.setAttribute('transform', t);
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', spec.d);
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  if (spec.fillRule) path.setAttribute('fill-rule', spec.fillRule);
  applySvgStroke(path, s.attrs, 'none');
  if (!s.attrs.fill) path.setAttribute('fill', '#ffffff');
  g.appendChild(path);
  if (s.id) g.dataset.id = s.id;
  return g;
}

// Icon bundle: 1960 Lucide icons live in /public/sdocs-icons-data.js
// (~81 KB gzipped). Loaded lazily on first `icon` shape, cached on
// window.SDocIcons after. Same pattern as mermaid / chart.js / KaTeX:
// pay the network cost once per session, only when the feature is
// actually used.
var iconBundleStatus = 'idle'; // idle | loading | ready | failed
var iconBundlePending = [];    // [{ shape, placeholder, parent }]

function loadIconBundle() {
  if (iconBundleStatus !== 'idle') return;
  iconBundleStatus = 'loading';
  window.SDocIconsReady = function () {
    iconBundleStatus = 'ready';
    // Re-render every placeholder that was emitted while the bundle was loading.
    var queue = iconBundlePending; iconBundlePending = [];
    for (var i = 0; i < queue.length; i++) {
      var entry = queue[i];
      if (entry.placeholder && entry.placeholder.parentNode) {
        var fresh = renderIcon(entry.shape);
        entry.placeholder.parentNode.replaceChild(fresh, entry.placeholder);
      }
    }
  };
  var script = document.createElement('script');
  script.src = '/public/sdocs-icons-data.js';
  script.onerror = function () {
    iconBundleStatus = 'failed';
    // Mark any pending placeholders so they don't keep waiting; the
    // missing-icon style will render on next attempt.
    iconBundlePending = [];
  };
  document.head.appendChild(script);
}

function iconPlaceholder(s) {
  // Light dashed rect at the icon's position so the slide layout
  // doesn't visibly reflow when the real icon swaps in. Same bbox
  // as the icon itself.
  var rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', s.x);
  rect.setAttribute('y', s.y);
  rect.setAttribute('width', s.w);
  rect.setAttribute('height', s.h);
  rect.setAttribute('rx', '0.5');
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#D9DFEA');
  rect.setAttribute('stroke-width', '0.1');
  rect.setAttribute('stroke-dasharray', '0.4 0.3');
  return rect;
}

function renderIcon(s) {
  var name = s.attrs && s.attrs.name;
  var color = (s.attrs && s.attrs.color) || '#0F1E3A';
  var sw = (s.attrs && s.attrs.strokeWidth != null) ? s.attrs.strokeWidth : 2;
  var x = s.x, y = s.y, w = s.w, h = s.h;

  // Nested <svg> with its own viewBox handles the 24x24 -> (w, h)
  // scaling natively. Setting fill / stroke / linecap on the wrapper
  // lets the bundled Lucide markup inherit cleanly without per-element
  // edits.
  var inner = document.createElementNS(SVG_NS, 'svg');
  inner.setAttribute('x', x);
  inner.setAttribute('y', y);
  inner.setAttribute('width', w);
  inner.setAttribute('height', h);
  inner.setAttribute('viewBox', '0 0 24 24');
  inner.setAttribute('fill', 'none');
  inner.setAttribute('stroke', color);
  inner.setAttribute('stroke-width', String(sw));
  inner.setAttribute('stroke-linecap', 'round');
  inner.setAttribute('stroke-linejoin', 'round');

  var iconXml = (name && window.SDocIcons) ? window.SDocIcons[name] : null;
  if (!iconXml && name && iconBundleStatus !== 'ready') {
    // Bundle not loaded yet (or still loading). Trigger load, emit a
    // dashed-rect placeholder, and queue this shape for re-render once
    // the bundle arrives.
    if (iconBundleStatus === 'idle') loadIconBundle();
    var ph = iconPlaceholder(s);
    iconBundlePending.push({ shape: s, placeholder: ph });
    return ph;
  }
  if (!iconXml) {
    // Bundle loaded but the name isn't in it (typo or removed icon).
    // Struck-through rect so the gap is visible, not silent.
    var rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '2'); rect.setAttribute('y', '2');
    rect.setAttribute('width', '20'); rect.setAttribute('height', '20');
    rect.setAttribute('rx', '2');
    rect.setAttribute('stroke', '#E54B7C');
    inner.appendChild(rect);
    var line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '4'); line.setAttribute('y1', '4');
    line.setAttribute('x2', '20'); line.setAttribute('y2', '20');
    line.setAttribute('stroke', '#E54B7C');
    inner.appendChild(line);
  } else {
    // Parse the icon's inner SVG content into properly-namespaced nodes
    // and append to the nested <svg>. DOMParser handles SVG namespacing
    // cleanly - innerHTML on an SVG element does NOT.
    var doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg">' + iconXml + '</svg>',
      'image/svg+xml'
    );
    var src = doc.documentElement;
    while (src.firstChild) inner.appendChild(src.firstChild);
  }
  if (s.id) inner.dataset.id = s.id;
  return inner;
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
  // Bowed line: quadratic Bezier with control at chord midpoint offset
  // perpendicular by 2 * sagitta. Mirrors the polygon ^h arc convention.
  if (s.bow != null && s.bow !== 0) {
    var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (L > 0) {
      var perpX = dy / L, perpY = -dx / L;
      var cx = (s.x1 + s.x2) / 2 + perpX * (2 * s.bow);
      var cy = (s.y1 + s.y2) / 2 + perpY * (2 * s.bow);
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M ' + s.x1 + ' ' + s.y1 +
                             ' Q ' + cx + ' ' + cy + ' ' + s.x2 + ' ' + s.y2);
      path.setAttribute('fill', 'none');
      applySvgStroke(path, s.attrs);
      if (s.id) path.dataset.id = s.id;
      return path;
    }
  }
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

  var el;
  if (s.bow != null && s.bow !== 0 && len > 0) {
    // Bowed arrow: render a quadratic Bezier with control at the chord
    // midpoint offset perpendicularly by 2 * sagitta. To keep the head's
    // tip on (x2, y2), back the endpoint off along the curve's tangent at
    // t=1, which for Q(P0,C,P1) points along (P1 - C).
    var perpX = dy / len, perpY = -dx / len;
    var cx = (s.x1 + s.x2) / 2 + perpX * (2 * s.bow);
    var cy = (s.y1 + s.y2) / 2 + perpY * (2 * s.bow);
    var tx = s.x2 - cx, ty = s.y2 - cy;
    var tLen = Math.sqrt(tx * tx + ty * ty);
    var ex = s.x2, ey = s.y2;
    if (tLen > 0) {
      ex = s.x2 - (tx / tLen) * backoff;
      ey = s.y2 - (ty / tLen) * backoff;
    }
    el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', 'M ' + s.x1 + ' ' + s.y1 +
                         ' Q ' + cx + ' ' + cy + ' ' + ex + ' ' + ey);
    el.setAttribute('fill', 'none');
  } else {
    el = document.createElementNS(SVG_NS, 'line');
    var ex2 = s.x2, ey2 = s.y2;
    if (len > 0) {
      ex2 = s.x2 - (dx / len) * backoff;
      ey2 = s.y2 - (dy / len) * backoff;
    }
    el.setAttribute('x1', s.x1);
    el.setAttribute('y1', s.y1);
    el.setAttribute('x2', ex2);
    el.setAttribute('y2', ey2);
  }
  applySvgStroke(el, s.attrs);
  if (effectiveSw !== sw) el.setAttribute('stroke-width', effectiveSw);
  el.setAttribute('marker-end', 'url(#_sd_arrowhead)');
  g.appendChild(el);
  defsNeeded.arrowhead = true;
  if (s.attrs.stroke) defsNeeded.arrowheadColor = s.attrs.stroke;
  if (s.id) g.dataset.id = s.id;
  return g;
}

// Emit one segment from `prev` to `p` per its seg metadata. Used by polyPath
// after corner-rounding logic has decided whether `prev` / `p` are the actual
// polygon vertices or tangent points on rounded corners.
//
// Segment kinds (set by the parser):
//   line   — L to point
//   smooth — soft bow at sagitta = 10% of chord length (positive = left of
//            travel = up for a rightward chord). Pre-1.6 ~ was structurally
//            degenerate; this restores it as a visible soft corner.
//   arc    — Q with control offset from chord midpoint along the perpendicular
//            by 2 * sagitta. Sagitta is the visible bow depth at t=0.5, not
//            the hidden SVG control offset.
//   quad   — Through-point quadratic: passes through seg.c at t=0.5. SVG
//            control derived as C = 2*P - (A+B)/2.
//   cubic  — Through-point cubic: passes through seg.c1 at t=1/3 and seg.c2
//            at t=2/3. SVG controls derived via closed-form.
function emitPolySeg(seg, prev, p) {
  if (seg.type === 'smooth' || seg.type === 'arc') {
    var dx = p.x - prev.x, dy = p.y - prev.y;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (L === 0) return ' L ' + p.x + ' ' + p.y;
    var sagitta = seg.type === 'arc' ? seg.sagitta : L * 0.1;
    var perpX = dy / L, perpY = -dx / L;
    var cx = (prev.x + p.x) / 2 + perpX * (2 * sagitta);
    var cy = (prev.y + p.y) / 2 + perpY * (2 * sagitta);
    return ' Q ' + cx + ' ' + cy + ' ' + p.x + ' ' + p.y;
  } else if (seg.type === 'quad') {
    var qcx = 2 * seg.c.x - (prev.x + p.x) / 2;
    var qcy = 2 * seg.c.y - (prev.y + p.y) / 2;
    return ' Q ' + qcx + ' ' + qcy + ' ' + p.x + ' ' + p.y;
  } else if (seg.type === 'cubic') {
    var P1 = seg.c1, P2 = seg.c2;
    var c1x = 3 * P1.x - 1.5 * P2.x - (5 / 6) * prev.x + (1 / 3) * p.x;
    var c1y = 3 * P1.y - 1.5 * P2.y - (5 / 6) * prev.y + (1 / 3) * p.y;
    var c2x = 3 * P2.x - 1.5 * P1.x - (5 / 6) * p.x + (1 / 3) * prev.x;
    var c2y = 3 * P2.y - 1.5 * P1.y - (5 / 6) * p.y + (1 / 3) * prev.y;
    return ' C ' + c1x + ' ' + c1y +
           ' ' + c2x + ' ' + c2y +
           ' ' + p.x + ' ' + p.y;
  }
  return ' L ' + p.x + ' ' + p.y;
}

// For each point with a `(r` corner-rounding modifier, compute the two
// tangent points on the adjacent edges and the SVG arc parameters. Skip
// (return null) when either adjacent segment is curved (rounding has no
// clean semantics there), when the corner is colinear or flipped, or when
// the radius would consume more than half of either neighbouring chord.
function computePolyRounding(points) {
  var n = points.length;
  var out = new Array(n);
  for (var i = 0; i < n; i++) {
    out[i] = null;
    var pt = points[i];
    if (pt.round == null || pt.round <= 0) continue;
    var prev = points[(i - 1 + n) % n];
    var next = points[(i + 1) % n];
    var inSeg  = pt.seg   || (pt.curve   ? { type: 'smooth' } : { type: 'line' });
    var outSeg = next.seg || (next.curve ? { type: 'smooth' } : { type: 'line' });
    if (inSeg.type !== 'line' || outSeg.type !== 'line') continue;

    var dxIn = prev.x - pt.x, dyIn = prev.y - pt.y;
    var dxOut = next.x - pt.x, dyOut = next.y - pt.y;
    var lenIn = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
    var lenOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut);
    if (lenIn === 0 || lenOut === 0) continue;

    var uxIn = dxIn / lenIn, uyIn = dyIn / lenIn;
    var uxOut = dxOut / lenOut, uyOut = dyOut / lenOut;
    var cosFull = uxIn * uxOut + uyIn * uyOut;
    // Colinear (no real corner) or 180-degree flip (degenerate). Either way,
    // skip rounding instead of dividing by tan(0) or tan(pi/2).
    if (cosFull >=  0.9999) continue;
    if (cosFull <= -0.9999) continue;

    var halfAngle = Math.acos(cosFull) / 2;
    var tanHalf = Math.tan(halfAngle);
    var d = pt.round / tanHalf;
    // Clamp the tangent-point setback to half of either neighbouring chord
    // so adjacent rounded corners cannot overlap. The actual rendered radius
    // shrinks alongside d when clamping kicks in.
    d = Math.min(d, lenIn / 2, lenOut / 2);
    var actualR = d * tanHalf;

    var tIn  = { x: pt.x + uxIn  * d, y: pt.y + uyIn  * d };
    var tOut = { x: pt.x + uxOut * d, y: pt.y + uyOut * d };

    // SVG sweep flag: pick the arc that bends toward the polygon interior
    // (i.e. away from the corner vertex). The cross product of the incoming
    // edge direction (-uIn) with the outgoing edge direction (uOut) tells us
    // which way the path turns; in SVG y-down coords, positive cross =
    // clockwise turn = sweep flag 1.
    var cross = (-uxIn) * uyOut - (-uyIn) * uxOut;
    var sweep = cross > 0 ? 1 : 0;

    out[i] = { tIn: tIn, tOut: tOut, r: actualR, sweep: sweep };
  }
  return out;
}

function polyPath(points) {
  if (points.length === 0) return '';
  var n = points.length;
  var rounding = computePolyRounding(points);

  // If pt[0] is rounded, the path starts at its outgoing tangent point and
  // ends with the arc from tIn[0] back to tOut[0] (which Z then collapses).
  var startPt = rounding[0] ? rounding[0].tOut : points[0];
  var d = 'M ' + startPt.x + ' ' + startPt.y;

  for (var i = 1; i <= n; i++) {
    var idx = i % n;
    var pt = points[idx];
    var prev = points[(i - 1) % n];
    var prevEnd = rounding[(i - 1) % n] ? rounding[(i - 1) % n].tOut : prev;
    var seg = pt.seg || (pt.curve ? { type: 'smooth' } : { type: 'line' });

    if (rounding[idx]) {
      // The segment into this corner must be straight (computePolyRounding
      // would have returned null otherwise), so an L to tIn is always right.
      d += ' L ' + rounding[idx].tIn.x + ' ' + rounding[idx].tIn.y;
      var ri = rounding[idx];
      d += ' A ' + ri.r + ' ' + ri.r + ' 0 0 ' + ri.sweep +
           ' ' + ri.tOut.x + ' ' + ri.tOut.y;
    } else {
      d += emitPolySeg(seg, prevEnd, pt);
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
  applyOpacity(el, s.attrs);
  if (s.attrs && s.attrs.maxfont) el.dataset.maxfont = s.attrs.maxfont;
  if (s.attrs && s.attrs.align) el.dataset.align = s.attrs.align;
  if (s.attrs && s.attrs.valign) el.dataset.valign = s.attrs.valign;
  var dims = refDimsFor(box.w, box.h, grid);
  el.dataset.refw = String(dims.w);
  el.dataset.refh = String(dims.h);
  applySizing(el, s.attrs);
  if (s.content != null && s.content !== '') {
    attachRotatedContent(el, s, grid, box.w, box.h);
  }
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

// Relative luminance (0 = black, 1 = white) for #rgb / #rrggbb / rgb()/rgba()
// fills. Returns null for anything it can't parse (named colors, gradients).
function colorLuminance(c) {
  c = String(c).trim();
  var r, g, b, m;
  if ((m = c.match(/^#([0-9a-f]{3})$/i))) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = c.match(/^#([0-9a-f]{6})$/i))) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else if ((m = c.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i))) {
    r = parseFloat(m[1]); g = parseFloat(m[2]); b = parseFloat(m[3]);
  } else {
    return null;
  }
  return (0.2126 * r + 0.7152 * g + 0.0594 * b) / 255;
}

// Estimate the background luminance behind the top-right corner of the
// stage, where the present button sits. The button otherwise inherits the
// document's foreground color, but a slide can paint its own background
// (grid `bg=` or a full-bleed rect) that doesn't track the doc theme - on a
// dark slide in a light doc the button goes dark-on-dark. Walk the rects
// that cover the corner point, pick the one that paints last (layer rank,
// then source order), fall back to the grid bg. Returns 0..1, or null when
// it can't be determined (no explicit fill, image fill, named color) - in
// which case the caller leaves the button on the doc-theme default.
function cornerBackgroundLuminance(shapes, grid) {
  var px = grid.w * 0.98;
  var py = grid.h * 0.02;
  var rank = { bottom: 0, mid: 1, top: 2 };
  var best = null, bestKey = -1;
  for (var i = 0; i < shapes.length; i++) {
    var s = shapes[i];
    if (s.kind !== 'r') continue;
    var a = s.attrs || {};
    if (!a.fill || a.fill === 'none' || a.fill === 'transparent') continue;
    if (a.image) continue;
    if (s.x > px || s.y > py || s.x + s.w < px || s.y + s.h < py) continue;
    var key = (rank[a.layer] != null ? rank[a.layer] : 1) * 1e6 + i;
    if (key > bestKey) { bestKey = key; best = a.fill; }
  }
  var fill = best || (grid.attrs && grid.attrs.bg) || null;
  return fill ? colorLuminance(fill) : null;
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

  // Luminance behind the top-right corner, so the caller can flip the
  // present button to a contrasting palette on dark / light slides.
  result.cornerLuminance = cornerBackgroundLuminance(result.shapes, grid);

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
  // everything), mid (the default), top (paints last, above everything).
  // Within each sublayer, source order alone determines stacking — every
  // SVG primitive lives in its own per-shape <svg> sibling to the HTML
  // rects, so a polygon declared after a rect paints over that rect and
  // vice versa. Authors opt into top/bottom via `layer=top` /
  // `layer=bottom` on a shape; omit for mid.
  function makeSublayer() {
    var el = document.createElement('div');
    el.className = 'sd-stage-sublayer';
    return { el: el };
  }
  var layers = { bottom: makeSublayer(), mid: makeSublayer(), top: makeSublayer() };
  stage.appendChild(layers.bottom.el);
  stage.appendChild(layers.mid.el);
  stage.appendChild(layers.top.el);

  // Shared defs SVG at the stage level. Holds the arrowhead marker so
  // every per-shape SVG can resolve url(#_sd_arrowhead) — SVG IDs are
  // document-scoped, so one copy works for arrows in any sublayer.
  // Always-on (zero-sized, no content unless arrows are present) keeps
  // the stage's DOM shape consistent across decks.
  var sharedDefs = document.createElementNS(SVG_NS, 'svg');
  sharedDefs.setAttribute('class', 'shape-defs');
  sharedDefs.setAttribute('aria-hidden', 'true');
  sharedDefs.setAttribute('width', '0');
  sharedDefs.setAttribute('height', '0');
  sharedDefs.style.position = 'absolute';
  sharedDefs.style.width = '0';
  sharedDefs.style.height = '0';
  sharedDefs.style.overflow = 'hidden';
  stage.insertBefore(sharedDefs, stage.firstChild);

  // Build a fresh <svg> wrapper for a single SVG primitive. Each shape
  // gets its own SVG so HTML rects and SVG primitives can interleave
  // freely by source order within a sublayer (rather than the SVG
  // sublayer always sitting under all the HTML rects, the pre-1.6
  // behavior).
  function makeShapeSvg() {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'shape-svg');
    s.setAttribute('viewBox', '0 0 ' + grid.w + ' ' + grid.h);
    s.setAttribute('preserveAspectRatio', 'none');
    return s;
  }

  var defsNeeded = { arrowhead: false, arrowheadColor: null };

  function pickLayer(s) {
    var v = s.attrs && s.attrs.layer;
    if (v == null || v === '') return layers.mid;
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
        var rectEl = renderRect(s, grid);
        rectEl.dataset.shapeIdx = String(i);
        L.el.appendChild(rectEl);
        if (options.copyButtons && shapeHasCopyableText(s, rectEl)) {
          attachShapeCopyButton(rectEl, s, grid);
        }
      } else {
        // Every SVG primitive gets its own <svg> wrapper so its DOM
        // position among the sublayer's children is preserved.
        var svg = makeShapeSvg();
        // Tag the wrapper with its parsed-shape index so external
        // consumers (the slide-PDF rasterizer) can locate a specific
        // shape's rendered DOM by index instead of brittle DOM-order
        // matching across layers.
        svg.dataset.shapeIdx = String(i);
        if (s.kind === 'c') {
          svg.appendChild(renderCircle(s, svg));
        } else if (s.kind === 'e') {
          svg.appendChild(renderEllipse(s));
        } else if (s.kind === 'l') {
          svg.appendChild(renderLine(s));
        } else if (s.kind === 'a') {
          svg.appendChild(renderArrow(s, defsNeeded));
        } else if (s.kind === 'p') {
          svg.appendChild(renderPolygon(s, svg));
        } else if (s.kind === 'chev') {
          svg.appendChild(renderChev(s));
        } else if (s.kind === 'cyl') {
          svg.appendChild(renderCyl(s));
        } else if (s.kind === 'bub') {
          svg.appendChild(renderBub(s));
        } else if (s.kind === 'tab') {
          svg.appendChild(renderTab(s));
        } else if (s.kind === 'doc') {
          svg.appendChild(renderDoc(s));
        } else if (s.kind === 'cloud') {
          svg.appendChild(renderCloud(s));
        } else if (s.kind === 'icon') {
          svg.appendChild(renderIcon(s));
        }
        applyOpacity(svg, s.attrs);
        L.el.appendChild(svg);
        // Text overlay sits AFTER its parent SVG in source order so it
        // paints on top of the shape it labels. (icon shapes don't
        // carry text content - the icon IS the content - so they're
        // omitted from this list.)
        if ((s.kind === 'c' || s.kind === 'e' || s.kind === 'p' ||
             s.kind === 'chev' || s.kind === 'cyl' || s.kind === 'bub' ||
             s.kind === 'tab' || s.kind === 'doc' || s.kind === 'cloud') &&
            s.content) {
          var overlay = renderTextOverlay(s, grid);
          overlay.dataset.shapeIdx = String(i);
          L.el.appendChild(overlay);
          if (options.copyButtons && shapeHasCopyableText(s, overlay)) {
            attachShapeCopyButton(overlay, s, grid);
          }
        }
      }
    } catch (e) {
      result.errors.push({ line: s.lineNumber, message: 'render: ' + e.message });
    }
  }

  if (defsNeeded.arrowhead) {
    sharedDefs.appendChild(buildArrowheadDefs(defsNeeded.arrowheadColor));
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
  var done = false;
  var ro = null, mo = null;

  function reveal() {
    if (done) return;
    var wrapper = shadow.querySelector('.sdoc-mermaid');
    var svg = wrapper && wrapper.querySelector('svg.sdoc-mermaid-svg');
    if (!wrapper || !svg) return;           // SVG not rendered yet
    // SVG has appeared - stop watching for its insertion.
    if (mo) { mo.disconnect(); mo = null; }
    if (!(wrapper.clientWidth > 0 && wrapper.clientHeight > 0)) {
      // SVG exists but the wrapper is collapsed (0x0) - e.g. the slide is
      // in a section that hasn't been expanded yet. Watch for it to gain a
      // real box and reveal then, rather than giving up.
      if (!ro && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(reveal);
        ro.observe(wrapper);
      }
      return;
    }
    svg.style.setProperty('width',  wrapper.clientWidth  + 'px', 'important');
    svg.style.setProperty('height', wrapper.clientHeight + 'px', 'important');
    svg.style.setProperty('max-width', '100%', 'important');
    svg.style.setProperty('visibility', 'visible', 'important');
    done = true;
    if (ro) { ro.disconnect(); ro = null; }
  }

  // The wrapper + SVG appear asynchronously: mermaid lazy-loads from a CDN,
  // then renders. Watch the shadow root for that insertion instead of
  // polling for a fixed window - a cold CDN fetch can take longer than any
  // reasonable timeout, which left slide diagrams blank until a hard
  // refresh warmed the cache.
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(reveal);
    mo.observe(shadow, { childList: true, subtree: true });
  }
  reveal();
  // Fallbacks for environments without observers, and to catch the first
  // paint when the SVG was already present.
  [80, 300, 1200, 4000].forEach(function (t) { setTimeout(reveal, t); });
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
  // Path-builder helpers exposed so the slide-PDF exporter can emit the
  // exact same geometry through pdf-lib's drawSvgPath. Returning bare `d`
  // strings (or { body, ... } objects for two-path shapes) keeps the PDF
  // path independent of DOM construction.
  polyPath: polyPath,
  chevPath: chevPath,
  cylPaths: cylPaths,
  bubPath: bubPath,
  tabPath: tabPath,
  docPaths: docPaths,
  // Exposed so a mermaid theme re-render can re-size and re-reveal a slide's
  // embedded diagram after replacing its (hidden-by-default) SVG.
  kickShadowMermaid: kickShadowMermaid,
  // Exposed so present mode can read a rendered slide's plain text for its
  // "copy slide" action without re-parsing the DSL.
  collectSlideText: collectSlideText,
  readShapeText: readShapeText,
};

})();
