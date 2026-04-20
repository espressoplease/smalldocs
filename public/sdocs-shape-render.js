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
var CSS = [
  '.sd-shape-stage { position: relative; overflow: hidden; container-type: size; }',
  '.sd-shape-stage .shape-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }',
  '.sd-shape-stage .shape-rect {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: hidden; line-height: 1.2;',
  '}',
  '.sd-shape-stage .shape-text {',
  '  position: absolute; box-sizing: border-box;',
  '  display: flex; align-items: center; justify-content: center; text-align: center;',
  '  overflow: hidden; pointer-events: none; line-height: 1.2;',
  '}',
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
  if (s.content) el.textContent = s.content;
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
  el.textContent = s.content;
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

function autoFitText(el, stageH, minPx, maxPx) {
  var text = (el.textContent || '').trim();
  if (!text) return;
  if (el.dataset.autofit === 'off') return;
  var cap = Math.max(minPx, Math.floor(maxPx));
  var lo = minPx, hi = cap, best = minPx;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = mid + 'px';
    var fits = el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight;
    if (fits) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (stageH > 0) {
    el.style.fontSize = ((best / stageH) * 100).toFixed(3) + 'cqh';
  } else {
    el.style.fontSize = best + 'px';
  }
}

function applyAutoFit(container) {
  var stageH = container.clientHeight;
  if (stageH <= 0) return;
  var els = container.querySelectorAll('.shape-rect, .shape-text');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.dataset.autofit === 'off') continue;
    var h = el.clientHeight;
    if (h <= 0) continue;
    autoFitText(el, stageH, 8, h);
  }
}

// ─── Main entry ──────────────────────────────────────

function renderShapes(dslText, container) {
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

  requestAnimationFrame(function () { applyAutoFit(container); });

  return result;
}

window.SDocShapeRender = {
  renderShapes: renderShapes,
  applyAutoFit: applyAutoFit,
};

})();
