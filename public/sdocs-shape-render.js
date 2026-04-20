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
  '.sd-shape-stage { position: relative; overflow: hidden; container-type: size; }',
  '.sd-shape-stage .shape-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }',
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
  '.sd-shape-stage .shape-md { display: block; max-width: 100%; color: inherit; }',
].join('\n');

// This is the only place markdown styling lives. Because the shadow root
// isolates the subtree completely, we can write clean rules without prefixes
// or !important — the host page literally cannot select in.
var SHAPE_MD_SHADOW_CSS = [
  ':host { display: block; color: inherit; font: inherit; line-height: inherit; }',
  '.inner { text-align: inherit; }',
  '.inner > :first-child { margin-top: 0; }',
  '.inner > :last-child { margin-bottom: 0; }',
  'p { margin: 0.2em 0; color: inherit; }',
  'h1 { font-size: 1.4em; font-weight: 700; margin: 0.2em 0; line-height: 1.15; color: inherit; }',
  'h2 { font-size: 1.2em; font-weight: 700; margin: 0.2em 0; line-height: 1.2; color: inherit; }',
  'h3 { font-size: 1.05em; font-weight: 600; margin: 0.15em 0; line-height: 1.2; color: inherit; }',
  'h4, h5, h6 { font-size: 1em; font-weight: 600; margin: 0.15em 0; color: inherit; }',
  'ul, ol { margin: 0.2em 0; padding: 0 0 0 1.2em; text-align: left; color: inherit; }',
  'li { margin: 0.1em 0; color: inherit; }',
  'li::marker { color: currentColor; }',
  'code { background: rgba(0,0,0,.08); padding: 0 0.25em; border-radius: 3px; font-size: 0.9em; font-family: ui-monospace, Menlo, monospace; color: inherit; }',
  'pre { margin: 0.3em 0; padding: 0.4em 0.6em; background: rgba(0,0,0,.08); border-radius: 4px; text-align: left; font-size: 0.85em; overflow-x: auto; line-height: 1.3; color: inherit; }',
  'pre code { background: none; padding: 0; font-size: inherit; }',
  'strong { font-weight: 700; }',
  'em { font-style: italic; }',
  'a { color: inherit; text-decoration: underline; }',
  'blockquote { margin: 0.3em 0; padding: 0 0 0 0.7em; border-left: 2px solid currentColor; opacity: 0.85; text-align: left; font-style: italic; color: inherit; }',
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

// Render content as a .shape-md host with a shadow root holding the markdown
// HTML. Shadow DOM isolates shape content from any host-page CSS that might
// try to restyle paragraphs, list markers, or headings inside a slide.
function contentToMarkdownNode(content) {
  var host = document.createElement('div');
  host.className = 'shape-md';
  if (content == null || content === '') return host;

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

  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>' + SHAPE_MD_SHADOW_CSS + '</style><div class="inner">' + html + '</div>';
  return host;
}

function shapePaddingGridUnits(s) {
  var v = s.attrs && s.attrs.padding;
  if (v != null && v !== '') {
    var n = Number(v);
    return isNaN(n) ? 0 : Math.max(0, n);
  }
  var box = window.SDocShapes.contentBox(s);
  if (!box) return 0;
  return Math.min(box.w, box.h) * 0.05;
}

function applyPadding(el, s, grid) {
  var p = shapePaddingGridUnits(s);
  if (p <= 0) { el.style.padding = '0'; return; }
  var padV = (p / grid.h) * 100;
  var padH = (p / grid.w) * 100;
  el.style.padding = padV.toFixed(3) + 'cqh ' + padH.toFixed(3) + 'cqw';
}

function applyShapeStyle(el, attrs) {
  if (attrs.fill) el.style.background = attrs.fill;
  if (attrs.color) el.style.color = attrs.color;
  if (attrs.radius != null) el.style.borderRadius = attrs.radius + '%';
  else el.style.borderRadius = '0.8%';
  if (attrs.stroke && attrs.stroke !== 'none') {
    var sw = attrs.strokeWidth != null ? attrs.strokeWidth : 0.15;
    el.style.border = sw + 'cqw solid ' + attrs.stroke;
  }
  if (attrs.shadow === 'none') el.style.boxShadow = 'none';
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

function renderRect(s, grid) {
  var el = document.createElement('div');
  el.className = 'shape-rect';
  el.style.left = pct(s.x, grid.w);
  el.style.top = pct(s.y, grid.h);
  el.style.width = pct(s.w, grid.w);
  el.style.height = pct(s.h, grid.h);
  applyShapeStyle(el, s.attrs);
  applyPadding(el, s, grid);
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content));
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
  if (s.content != null && s.content !== '') el.appendChild(contentToMarkdownNode(s.content));
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

function autoFitText(el, stageH, minPx, maxPx) {
  if (el.dataset.autofit === 'off') return;
  if (!hasRenderableText(el)) return;
  var target = measurementTarget(el);
  var cap = Math.max(minPx, Math.floor(maxPx));
  var lo = minPx, hi = cap, best = minPx;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = mid + 'px';
    // Measure scrollWidth/Height on the inner shadow node (which reflects the
    // laid-out content) and compare against the outer visible container.
    var fits = target.scrollWidth <= el.clientWidth && target.scrollHeight <= el.clientHeight;
    if (fits) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (stageH > 0) {
    el.style.fontSize = ((best / stageH) * 100).toFixed(3) + 'cqh';
  } else {
    el.style.fontSize = best + 'px';
  }
}

function applyAutoFit(container, minPx) {
  var stageH = container.clientHeight;
  if (stageH <= 0) return;
  var floor = typeof minPx === 'number' ? minPx : 8;
  var els = container.querySelectorAll('.shape-rect, .shape-text');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.dataset.autofit === 'off') continue;
    var h = el.clientHeight;
    if (h <= 0) continue;
    autoFitText(el, stageH, floor, h);
  }
}

// ─── Main entry ──────────────────────────────────────

function renderShapes(dslText, container, options) {
  options = options || {};
  var SDocShapes = window.SDocShapes;
  var parsed = SDocShapes.parse(dslText);
  var resolved = SDocShapes.resolve(parsed.shapes);
  var result = {
    shapes: resolved.shapes,
    errors: parsed.errors.concat(resolved.errors),
    grid: parsed.grid,
  };

  container.classList.add('sd-shape-stage');
  container.style.setProperty('--gw', result.grid.w);
  container.style.setProperty('--gh', result.grid.h);
  container.style.aspectRatio = result.grid.w + ' / ' + result.grid.h;
  container.innerHTML = '';

  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'shape-svg');
  svg.setAttribute('viewBox', '0 0 ' + result.grid.w + ' ' + result.grid.h);
  svg.setAttribute('preserveAspectRatio', 'none');
  container.appendChild(svg);

  var defsNeeded = { arrowhead: false, arrowheadColor: null };

  for (var i = 0; i < result.shapes.length; i++) {
    var s = result.shapes[i];
    try {
      if (s.kind === 'r') {
        container.appendChild(renderRect(s, result.grid));
      } else if (s.kind === 'c') {
        svg.appendChild(renderCircle(s));
        if (s.content) container.appendChild(renderTextOverlay(s, result.grid));
      } else if (s.kind === 'e') {
        svg.appendChild(renderEllipse(s));
        if (s.content) container.appendChild(renderTextOverlay(s, result.grid));
      } else if (s.kind === 'l') {
        svg.appendChild(renderLine(s));
      } else if (s.kind === 'a') {
        svg.appendChild(renderArrow(s, defsNeeded));
      } else if (s.kind === 'p') {
        svg.appendChild(renderPolygon(s));
        if (s.content) container.appendChild(renderTextOverlay(s, result.grid));
      }
    } catch (e) {
      result.errors.push({ line: s.lineNumber, message: 'render: ' + e.message });
    }
  }

  if (defsNeeded.arrowhead) {
    svg.insertBefore(buildArrowheadDefs(defsNeeded.arrowheadColor), svg.firstChild);
  }

  var minFontPx = typeof options.minFontPx === 'number' ? options.minFontPx : 8;
  requestAnimationFrame(function () { applyAutoFit(container, minFontPx); });

  return result;
}

window.SDocShapeRender = {
  renderShapes: renderShapes,
  applyAutoFit: applyAutoFit,
};

})();
