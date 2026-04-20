// sdocs-shapes.js — shape DSL parser + reference resolver (UMD)
// Shared by browser playground and Node tests.
//
// Grid (optional, must be first non-comment line):
//   grid W H                    sets coordinate system to W × H cells
//                               (aspect ratio = W/H; defaults to 100 × 56.25)
//
// DSL primitives:
//   r x y w h                   rectangle
//   c <point> r                 circle (point = `cx cy` or `@ref`)
//   e <point> rx ry             ellipse
//   l <point> <point>           line
//   a <point> <point>           arrow (line with head at end)
//   p <point> <point> ...       polygon; `~` before a point = curved segment
//                               (polygon point = `x,y` or `@ref`)
//
// References:
//   @id                         center of the shape with that id
//   @id.center|top|bottom|left|right|topleft|topright|bottomleft|bottomright
//
// Trailing tokens (any order):
//   #id                         attach an identifier to the current shape
//   key=value                   style attribute
//
// Content:
//   ... | content goes here     (single line in Phase 1-2)
//
// Lines starting with `//` are comments. Blank lines are ignored.
// Coordinates are grid units (typically 0-100 horizontally).

(function (exports) {
'use strict';

var POINT_RE = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;
var REF_RE = /^@([A-Za-z_][\w-]*)(?:\.([a-z]+))?$/;

var ANCHOR_TABLE = {
  center:      [0.5, 0.5],
  top:         [0.5, 0.0],
  bottom:      [0.5, 1.0],
  left:        [0.0, 0.5],
  right:       [1.0, 0.5],
  topleft:     [0.0, 0.0],
  topright:    [1.0, 0.0],
  bottomleft:  [0.0, 1.0],
  bottomright: [1.0, 1.0],
};

function isPointToken(s) { return POINT_RE.test(s); }
function isRefToken(s) { return REF_RE.test(s); }

function tryParseRef(s) {
  var m = s == null ? null : s.match(REF_RE);
  if (!m) return null;
  return { id: m[1], anchor: m[2] || 'center' };
}

function parseNumber(s, ctx) {
  var n = Number(s);
  if (isNaN(n)) throw new Error('Expected number' + (ctx ? ' for ' + ctx : '') + ', got "' + s + '"');
  return n;
}

function parsePointLiteral(s) {
  var parts = s.split(',');
  return { x: parseNumber(parts[0], 'point x'), y: parseNumber(parts[1], 'point y') };
}

// Consume one "point slot" from rest[idx]. A point is either:
//   - a @ref token (1 token)
//   - a pair of numeric tokens (2 tokens)
function consumePoint(rest, idx, kind, slotName) {
  var t = rest[idx];
  if (t == null) throw new Error(kind + ': missing ' + slotName);
  var ref = tryParseRef(t);
  if (ref) return { ref: ref, next: idx + 1 };
  if (rest[idx + 1] == null) throw new Error(kind + ': ' + slotName + ' needs two numbers or @ref');
  return {
    x: parseNumber(t, kind + ' ' + slotName + '.x'),
    y: parseNumber(rest[idx + 1], kind + ' ' + slotName + '.y'),
    next: idx + 2,
  };
}

function parseLine(raw, lineNumber) {
  // Split off content after | (first occurrence).
  var pipeIdx = raw.indexOf('|');
  var spec = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  var content = pipeIdx >= 0 ? raw.slice(pipeIdx + 1).trim() : null;

  var tokens = spec.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  var kind = tokens[0];
  var rest = tokens.slice(1);
  var shape = { kind: kind, id: null, attrs: {}, content: content, lineNumber: lineNumber };
  var i = 0;

  if (kind === 'r') {
    if (rest.length < 4) throw new Error('r: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'r x');
    shape.y = parseNumber(rest[1], 'r y');
    shape.w = parseNumber(rest[2], 'r w');
    shape.h = parseNumber(rest[3], 'r h');
    i = 4;
  } else if (kind === 'c') {
    var cPt = consumePoint(rest, 0, 'c', 'center');
    i = cPt.next;
    if (cPt.ref) { shape.cx = null; shape.cy = null; shape.refs = { center: cPt.ref }; }
    else         { shape.cx = cPt.x; shape.cy = cPt.y; }
    if (rest[i] == null) throw new Error('c: needs radius');
    shape.r = parseNumber(rest[i], 'c r');
    i++;
  } else if (kind === 'e') {
    var ePt = consumePoint(rest, 0, 'e', 'center');
    i = ePt.next;
    if (ePt.ref) { shape.cx = null; shape.cy = null; shape.refs = { center: ePt.ref }; }
    else         { shape.cx = ePt.x; shape.cy = ePt.y; }
    if (rest[i] == null || rest[i + 1] == null) throw new Error('e: needs rx ry');
    shape.rx = parseNumber(rest[i], 'e rx');
    shape.ry = parseNumber(rest[i + 1], 'e ry');
    i += 2;
  } else if (kind === 'l' || kind === 'a') {
    var p1 = consumePoint(rest, 0, kind, 'from');
    var p2 = consumePoint(rest, p1.next, kind, 'to');
    i = p2.next;
    var refs = {};
    if (p1.ref) { shape.x1 = null; shape.y1 = null; refs.from = p1.ref; }
    else        { shape.x1 = p1.x; shape.y1 = p1.y; }
    if (p2.ref) { shape.x2 = null; shape.y2 = null; refs.to = p2.ref; }
    else        { shape.x2 = p2.x; shape.y2 = p2.y; }
    if (Object.keys(refs).length > 0) shape.refs = refs;
  } else if (kind === 'p') {
    shape.points = [];
    var nextCurve = false;
    while (i < rest.length) {
      var t = rest[i];
      if (t === '~') {
        if (shape.points.length === 0) throw new Error('polygon: ~ cannot precede the first point');
        nextCurve = true;
        i++;
        continue;
      }
      if (isRefToken(t)) {
        shape.points.push({ ref: tryParseRef(t), curve: nextCurve });
        nextCurve = false;
        i++;
        continue;
      }
      if (!isPointToken(t)) break;
      var pt = parsePointLiteral(t);
      pt.curve = nextCurve;
      shape.points.push(pt);
      nextCurve = false;
      i++;
    }
    if (nextCurve) throw new Error('polygon: trailing ~ with no following point');
    if (shape.points.length < 2) throw new Error('polygon: needs at least 2 points');
  } else {
    throw new Error('Unknown shape "' + kind + '"');
  }

  // Trailing tokens: #id or key=value attributes, in any order.
  while (i < rest.length) {
    var tok = rest[i];
    if (tok.charAt(0) === '#') {
      if (shape.id) throw new Error('multiple #id tokens on one line');
      var idName = tok.slice(1);
      if (!/^[A-Za-z_][\w-]*$/.test(idName)) throw new Error('invalid id "' + tok + '"');
      shape.id = idName;
    } else {
      var eq = tok.indexOf('=');
      if (eq <= 0) throw new Error('unexpected token "' + tok + '"');
      var key = tok.slice(0, eq);
      var val = tok.slice(eq + 1);
      if (!/^[A-Za-z][\w-]*$/.test(key)) throw new Error('invalid attribute key "' + key + '"');
      shape.attrs[key] = val;
    }
    i++;
  }

  return shape;
}

var DEFAULT_GRID = { w: 100, h: 56.25 };

function parseGridLine(trimmed) {
  var tokens = trimmed.split(/\s+/);
  if (tokens.length !== 3) {
    throw new Error('grid: expected "grid W H", got ' + tokens.length + ' tokens');
  }
  var w = parseNumber(tokens[1], 'grid W');
  var h = parseNumber(tokens[2], 'grid H');
  if (w <= 0 || h <= 0) throw new Error('grid: W and H must be positive');
  return { w: w, h: h };
}

// Indented (2+ space) lines immediately after a shape line become
// continuation content for that shape — YAML block scalar style. Content only
// collects when the shape line had a `|` separator; otherwise the indented
// lines are errors, since they'd silently disappear.
function collectIndentedContent(lines, startIdx) {
  var out = [];
  var i = startIdx;
  while (i < lines.length) {
    var l = lines[i];
    if (l.length === 0) {
      // Blank line: include only if another indented line follows.
      var j = i + 1;
      while (j < lines.length && lines[j].length === 0) j++;
      if (j < lines.length && /^ {2}/.test(lines[j])) {
        out.push('');
        i++;
        continue;
      }
      break;
    }
    if (!/^ {2}/.test(l)) break;
    out.push(l.replace(/^ {2}/, ''));
    i++;
  }
  return { lines: out, nextIdx: i };
}

function parse(src) {
  var lines = (src == null ? '' : String(src)).split('\n');
  var shapes = [];
  var errors = [];
  var grid = null;
  var seenShape = false;
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    if (trimmed.slice(0, 2) === '//') { i++; continue; }

    // Detect stray indented lines at top level (continuation with no parent).
    if (/^ {2}/.test(line)) {
      errors.push({ line: i + 1, message: 'unexpected indented line (no preceding shape with |)', source: line });
      i++;
      continue;
    }

    // Grid statement: must appear before any shape, at most once.
    if (/^grid(\s|$)/.test(trimmed)) {
      if (seenShape) {
        errors.push({ line: i + 1, message: 'grid must be declared before any shapes', source: line });
        i++;
        continue;
      }
      if (grid) {
        errors.push({ line: i + 1, message: 'grid declared more than once', source: line });
        i++;
        continue;
      }
      try {
        grid = parseGridLine(trimmed);
      } catch (e) {
        errors.push({ line: i + 1, message: e.message, source: line });
      }
      i++;
      continue;
    }

    try {
      var s = parseLine(line, i + 1);
      if (s) {
        seenShape = true;
        // If shape declared a `|` separator, collect any following indented
        // lines and append them to the content.
        if (s.content != null) {
          var cont = collectIndentedContent(lines, i + 1);
          if (cont.lines.length > 0) {
            var joined = cont.lines.join('\n');
            s.content = s.content.length > 0
              ? s.content + '\n' + joined
              : joined;
          }
          i = cont.nextIdx;
        } else {
          i++;
        }
        shapes.push(s);
      } else {
        i++;
      }
    } catch (e) {
      errors.push({ line: i + 1, message: e.message, source: line });
      i++;
    }
  }
  return { shapes: shapes, errors: errors, grid: grid || { w: DEFAULT_GRID.w, h: DEFAULT_GRID.h } };
}

// ─── Reference resolution ──────────────────────────────

function bboxOf(shape) {
  if (shape.kind === 'r') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape.kind === 'c') return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
  if (shape.kind === 'e') return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
  if (shape.kind === 'l' || shape.kind === 'a') {
    var mnx = Math.min(shape.x1, shape.x2), mxx = Math.max(shape.x1, shape.x2);
    var mny = Math.min(shape.y1, shape.y2), mxy = Math.max(shape.y1, shape.y2);
    return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
  }
  if (shape.kind === 'p') {
    var mx = Infinity, Mx = -Infinity, my = Infinity, My = -Infinity;
    for (var j = 0; j < shape.points.length; j++) {
      var p = shape.points[j];
      if (p.x < mx) mx = p.x;
      if (p.x > Mx) Mx = p.x;
      if (p.y < my) my = p.y;
      if (p.y > My) My = p.y;
    }
    return { x: mx, y: my, w: Mx - mx, h: My - my };
  }
  throw new Error('bboxOf: unknown kind ' + shape.kind);
}

// Content box for a shape — where text should render. Returns { x, y, w, h }
// in grid units, or null for decorative shapes (lines, arrows).
//   Rectangle: full rect bounds.
//   Circle:    inscribed square (side = r * √2).
//   Ellipse:   inscribed rectangle (w = rx * √2, h = ry * √2).
//   Polygon:   bounding box.
function contentBox(shape) {
  if (shape.kind === 'r') {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === 'c') {
    var side = shape.r * Math.SQRT2;
    return { x: shape.cx - side / 2, y: shape.cy - side / 2, w: side, h: side };
  }
  if (shape.kind === 'e') {
    var w = shape.rx * Math.SQRT2;
    var h = shape.ry * Math.SQRT2;
    return { x: shape.cx - w / 2, y: shape.cy - h / 2, w: w, h: h };
  }
  if (shape.kind === 'p') {
    return bboxOf(shape);
  }
  return null;
}

function anchorPoint(shape, anchor) {
  var t = ANCHOR_TABLE[anchor];
  if (!t) throw new Error('unknown anchor ".' + anchor + '"');
  var b = bboxOf(shape);
  return { x: b.x + b.w * t[0], y: b.y + b.h * t[1] };
}

function refsInShape(shape) {
  var ids = [];
  if (shape.refs) {
    var keys = Object.keys(shape.refs);
    for (var k = 0; k < keys.length; k++) ids.push(shape.refs[keys[k]].id);
  }
  if (shape.kind === 'p') {
    for (var j = 0; j < shape.points.length; j++) {
      if (shape.points[j].ref) ids.push(shape.points[j].ref.id);
    }
  }
  return ids;
}

function shapeHasRefs(shape) {
  if (shape.refs && Object.keys(shape.refs).length > 0) return true;
  if (shape.kind === 'p') {
    for (var j = 0; j < shape.points.length; j++) if (shape.points[j].ref) return true;
  }
  return false;
}

function resolveShape(shape, byId) {
  if (shape.refs) {
    var keys = Object.keys(shape.refs);
    for (var k = 0; k < keys.length; k++) {
      var slot = keys[k];
      var r = shape.refs[slot];
      var target = byId[r.id];
      var ap = anchorPoint(target, r.anchor);
      if (slot === 'center')     { shape.cx = ap.x; shape.cy = ap.y; }
      else if (slot === 'from')  { shape.x1 = ap.x; shape.y1 = ap.y; }
      else if (slot === 'to')    { shape.x2 = ap.x; shape.y2 = ap.y; }
    }
  }
  if (shape.kind === 'p') {
    for (var j = 0; j < shape.points.length; j++) {
      var pt = shape.points[j];
      if (pt.ref) {
        var tgt = byId[pt.ref.id];
        var ap2 = anchorPoint(tgt, pt.ref.anchor);
        pt.x = ap2.x;
        pt.y = ap2.y;
      }
    }
  }
}

// Resolves @ref tokens into concrete coordinates. Mutates shapes in place.
// Returns { shapes, errors }. Refs metadata is preserved for serialization.
function resolve(shapes) {
  var errors = [];
  var byId = {};
  for (var i = 0; i < shapes.length; i++) {
    var s = shapes[i];
    if (s.id) {
      if (byId[s.id]) errors.push({ line: s.lineNumber, message: 'duplicate id "#' + s.id + '"' });
      else byId[s.id] = s;
    }
  }

  var resolved = new Set();
  for (var j = 0; j < shapes.length; j++) {
    if (!shapeHasRefs(shapes[j])) resolved.add(shapes[j]);
  }

  var progress = true;
  while (progress) {
    progress = false;
    for (var m = 0; m < shapes.length; m++) {
      var s2 = shapes[m];
      if (resolved.has(s2)) continue;
      var needs = refsInShape(s2);
      var ready = true;
      var missing = null;
      for (var n = 0; n < needs.length; n++) {
        if (!byId[needs[n]]) { missing = needs[n]; ready = false; break; }
        if (!resolved.has(byId[needs[n]])) { ready = false; break; }
      }
      if (missing) {
        errors.push({ line: s2.lineNumber, message: 'unknown id "@' + missing + '"' });
        resolved.add(s2);
        progress = true;
        continue;
      }
      if (!ready) continue;
      try {
        resolveShape(s2, byId);
        resolved.add(s2);
        progress = true;
      } catch (e) {
        errors.push({ line: s2.lineNumber, message: e.message });
        resolved.add(s2);
        progress = true;
      }
    }
  }

  for (var p = 0; p < shapes.length; p++) {
    if (!resolved.has(shapes[p])) {
      errors.push({ line: shapes[p].lineNumber, message: 'unresolvable reference (cycle)' });
    }
  }

  return { shapes: shapes, errors: errors };
}

// Convenience: parse + resolve in one call.
function parseAndResolve(src) {
  var pr = parse(src);
  var rr = resolve(pr.shapes);
  return { shapes: rr.shapes, errors: pr.errors.concat(rr.errors), grid: pr.grid };
}

// ─── Serialization (preserves refs for roundtrip) ──────

function refTokenStr(r) {
  return '@' + r.id + (r.anchor && r.anchor !== 'center' ? '.' + r.anchor : '');
}

function serializeShape(s) {
  var parts = [s.kind];
  if (s.kind === 'r') {
    parts.push(s.x, s.y, s.w, s.h);
  } else if (s.kind === 'c') {
    if (s.refs && s.refs.center) parts.push(refTokenStr(s.refs.center));
    else parts.push(s.cx, s.cy);
    parts.push(s.r);
  } else if (s.kind === 'e') {
    if (s.refs && s.refs.center) parts.push(refTokenStr(s.refs.center));
    else parts.push(s.cx, s.cy);
    parts.push(s.rx, s.ry);
  } else if (s.kind === 'l' || s.kind === 'a') {
    if (s.refs && s.refs.from) parts.push(refTokenStr(s.refs.from));
    else parts.push(s.x1, s.y1);
    if (s.refs && s.refs.to) parts.push(refTokenStr(s.refs.to));
    else parts.push(s.x2, s.y2);
  } else if (s.kind === 'p') {
    for (var i = 0; i < s.points.length; i++) {
      var pt = s.points[i];
      if (pt.curve) parts.push('~');
      if (pt.ref) parts.push(refTokenStr(pt.ref));
      else parts.push(pt.x + ',' + pt.y);
    }
  }
  if (s.id) parts.push('#' + s.id);
  var keys = Object.keys(s.attrs || {});
  for (var k = 0; k < keys.length; k++) parts.push(keys[k] + '=' + s.attrs[keys[k]]);
  var line = parts.join(' ');
  if (s.content != null) line += ' | ' + s.content;
  return line;
}

function serialize(shapes, grid) {
  var lines = [];
  if (grid && (grid.w !== DEFAULT_GRID.w || grid.h !== DEFAULT_GRID.h)) {
    lines.push('grid ' + grid.w + ' ' + grid.h);
  }
  for (var i = 0; i < shapes.length; i++) lines.push(serializeShape(shapes[i]));
  return lines.join('\n');
}

exports.parse = parse;
exports.parseLine = parseLine;
exports.resolve = resolve;
exports.parseAndResolve = parseAndResolve;
exports.anchorPoint = anchorPoint;
exports.bboxOf = bboxOf;
exports.contentBox = contentBox;
exports.serialize = serialize;
exports.serializeShape = serializeShape;
exports.ANCHOR_TABLE = ANCHOR_TABLE;
exports.DEFAULT_GRID = DEFAULT_GRID;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocShapes = {}));
