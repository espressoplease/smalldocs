// sdocs-shapes.js — shape DSL parser (UMD)
// Shared by browser playground and Node tests.
//
// DSL (Phase 1):
//   r x y w h                   rectangle
//   c cx cy r                   circle
//   e cx cy rx ry               ellipse
//   l x1 y1 x2 y2               line
//   a x1 y1 x2 y2               arrow (line with head at end)
//   p x,y x,y [~] x,y ...       polygon; `~` before a point = curved segment
//
// After the numeric args, in any order:
//   #id                         attach an identifier
//   key=value                   style attribute (fill=#fff, radius=4, ...)
//
// Content (single-line in Phase 1):
//   ... | content goes here
//
// Lines starting with `//` are comments. Blank lines are ignored.
// All coordinates are grid units (e.g. 0-100 horizontal, 0-56.25 for 16:9).

(function (exports) {
'use strict';

var ARG_COUNTS = { r: 4, c: 3, e: 4, l: 4, a: 4 };
var POINT_RE = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;

function isPointToken(s) { return POINT_RE.test(s); }

function parseNumber(s, ctx) {
  var n = Number(s);
  if (isNaN(n)) throw new Error('Expected number' + (ctx ? ' for ' + ctx : '') + ', got "' + s + '"');
  return n;
}

function parsePoint(s) {
  var parts = s.split(',');
  return { x: parseNumber(parts[0], 'point x'), y: parseNumber(parts[1], 'point y') };
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

  if (kind === 'p') {
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
      if (!isPointToken(t)) break;
      var pt = parsePoint(t);
      pt.curve = nextCurve;
      shape.points.push(pt);
      nextCurve = false;
      i++;
    }
    if (nextCurve) throw new Error('polygon: trailing ~ with no following point');
    if (shape.points.length < 2) throw new Error('polygon: needs at least 2 points');
  } else if (ARG_COUNTS.hasOwnProperty(kind)) {
    var n = ARG_COUNTS[kind];
    if (rest.length < n) throw new Error(kind + ': needs ' + n + ' numeric args (got ' + rest.length + ')');
    var nums = [];
    for (var k = 0; k < n; k++) nums.push(parseNumber(rest[k], kind + ' arg ' + (k + 1)));
    i = n;
    if (kind === 'r')      { shape.x = nums[0]; shape.y = nums[1]; shape.w = nums[2]; shape.h = nums[3]; }
    else if (kind === 'c') { shape.cx = nums[0]; shape.cy = nums[1]; shape.r = nums[2]; }
    else if (kind === 'e') { shape.cx = nums[0]; shape.cy = nums[1]; shape.rx = nums[2]; shape.ry = nums[3]; }
    else                   { shape.x1 = nums[0]; shape.y1 = nums[1]; shape.x2 = nums[2]; shape.y2 = nums[3]; }
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

function parse(src) {
  var lines = (src == null ? '' : String(src)).split('\n');
  var shapes = [];
  var errors = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.slice(0, 2) === '//') continue;
    try {
      var s = parseLine(line, i + 1);
      if (s) shapes.push(s);
    } catch (e) {
      errors.push({ line: i + 1, message: e.message, source: line });
    }
  }
  return { shapes: shapes, errors: errors };
}

function serializeShape(s) {
  var parts = [s.kind];
  if (s.kind === 'r')      parts.push(s.x, s.y, s.w, s.h);
  else if (s.kind === 'c') parts.push(s.cx, s.cy, s.r);
  else if (s.kind === 'e') parts.push(s.cx, s.cy, s.rx, s.ry);
  else if (s.kind === 'l' || s.kind === 'a') parts.push(s.x1, s.y1, s.x2, s.y2);
  else if (s.kind === 'p') {
    for (var i = 0; i < s.points.length; i++) {
      var p = s.points[i];
      if (p.curve) parts.push('~');
      parts.push(p.x + ',' + p.y);
    }
  }
  if (s.id) parts.push('#' + s.id);
  var keys = Object.keys(s.attrs || {});
  for (var k = 0; k < keys.length; k++) parts.push(keys[k] + '=' + s.attrs[keys[k]]);
  var line = parts.join(' ');
  if (s.content != null) line += ' | ' + s.content;
  return line;
}

function serialize(shapes) {
  return shapes.map(serializeShape).join('\n');
}

exports.parse = parse;
exports.parseLine = parseLine;
exports.serialize = serialize;
exports.serializeShape = serializeShape;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocShapes = {}));
