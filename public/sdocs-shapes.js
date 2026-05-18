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
//   p <point> <point> ...       polygon; segment operators between points:
//                                 ~          soft bow (sagitta = 10% of chord)
//                                 ^h         arc / bow by sagitta h
//                                 >P         quadratic Bezier through P
//                                 * P1 P2    cubic Bezier through P1, P2
//                               point modifiers:
//                                 (r         round the corner at this point
//                               (polygon point = `x,y` or `@ref`; control P can
//                               be either; arrow `a` also accepts `^h` between
//                               its endpoints)
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

// Parse one token as a control-point coord: either `x,y` literal or `@ref`.
// Returns { x, y } or { ref: { id, anchor } }. Throws if neither.
function parseCtrlPoint(token, opName) {
  if (token == null) throw new Error('polygon: ' + opName + ' control: missing token');
  var ref = tryParseRef(token);
  if (ref) return { ref: ref };
  if (!isPointToken(token)) throw new Error('polygon: ' + opName + ' control: expected x,y or @ref, got "' + token + '"');
  return parsePointLiteral(token);
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
  } else if (kind === 'i') {
    // Parser sugar: `i x y w h src=URL` is a rect-with-image. The shape lives
    // its life as kind='r'; trailing `src=` (or `image=`) feeds the renderer's
    // image-fill path so every rect/circle/polygon can hold a bitmap the
    // same way. Keeping the `i` keystroke is pure ergonomics: "image in
    // grid slot" is a common enough ask to deserve the shorthand.
    if (rest.length < 4) throw new Error('i: needs 4 numeric args (got ' + rest.length + ')');
    shape.kind = 'r';
    shape.x = parseNumber(rest[0], 'i x');
    shape.y = parseNumber(rest[1], 'i y');
    shape.w = parseNumber(rest[2], 'i w');
    shape.h = parseNumber(rest[3], 'i h');
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
    // Optional `^h` between endpoints: bow the line/arrow by sagitta h.
    // Same convention as polygon ^h: positive bows to the left of the
    // direction of travel (upward for a rightward chord in SVG y-down).
    var aft1 = p1.next;
    if (rest[aft1] && rest[aft1].charAt(0) === '^') {
      var bt = rest[aft1];
      var bsv;
      if (bt.length > 1) { bsv = bt.slice(1); aft1++; }
      else { bsv = rest[aft1 + 1]; aft1 += 2; }
      if (bsv == null) throw new Error(kind + ': ^ needs a sagitta value');
      shape.bow = parseNumber(bsv, kind + ': ^h sagitta');
    }
    var p2 = consumePoint(rest, aft1, kind, 'to');
    i = p2.next;
    var refs = {};
    if (p1.ref) { shape.x1 = null; shape.y1 = null; refs.from = p1.ref; }
    else        { shape.x1 = p1.x; shape.y1 = p1.y; }
    if (p2.ref) { shape.x2 = null; shape.y2 = null; refs.to = p2.ref; }
    else        { shape.x2 = p2.x; shape.y2 = p2.y; }
    if (Object.keys(refs).length > 0) shape.refs = refs;
  } else if (kind === 'p') {
    shape.points = [];
    // `pendingSeg` is the segment description (line / smooth / arc / quad /
    // cubic) that will be attached to the *next* point pushed. It carries the
    // metadata for the edge from the previous point to the next one.
    // `pendingRound` is the corner-rounding radius for the next point; the
    // point itself owns this (the rounding sits AT the vertex, not on an
    // adjacent edge).
    var pendingSeg = null;
    var pendingRound = null;
    while (i < rest.length) {
      var t = rest[i];

      // ~ — smooth quadratic to midpoint (existing behavior).
      if (t === '~') {
        if (shape.points.length === 0) throw new Error('polygon: ~ cannot precede the first point');
        pendingSeg = { type: 'smooth' };
        i++;
        continue;
      }

      // ^h — arc / bow by sagitta h, perpendicular to the chord.
      // Accepts `^0.8` (attached) or `^ 0.8` (separate token).
      if (t.charAt(0) === '^') {
        if (shape.points.length === 0) throw new Error('polygon: ^ cannot precede the first point');
        var sagToken;
        if (t.length > 1) { sagToken = t.slice(1); i++; }
        else { sagToken = rest[i + 1]; i += 2; }
        if (sagToken == null) throw new Error('polygon: ^ needs a sagitta value');
        var sag = parseNumber(sagToken, 'polygon: ^h sagitta');
        pendingSeg = { type: 'arc', sagitta: sag };
        continue;
      }

      // >P — quadratic Bezier with one explicit control point.
      // Accepts `>5.5,3.4` / `>@card.top` (attached) or `> 5.5,3.4` (separate).
      if (t.charAt(0) === '>') {
        if (shape.points.length === 0) throw new Error('polygon: > cannot precede the first point');
        var ctrlToken;
        if (t.length > 1) { ctrlToken = t.slice(1); i++; }
        else { ctrlToken = rest[i + 1]; i += 2; }
        var ctrl = parseCtrlPoint(ctrlToken, '>');
        pendingSeg = { type: 'quad', c: ctrl };
        continue;
      }

      // * — cubic Bezier with two control points (next two tokens).
      if (t === '*') {
        if (shape.points.length === 0) throw new Error('polygon: * cannot precede the first point');
        var c1 = parseCtrlPoint(rest[i + 1], '*');
        var c2 = parseCtrlPoint(rest[i + 2], '*');
        pendingSeg = { type: 'cubic', c1: c1, c2: c2 };
        i += 3;
        continue;
      }

      // (r — round the corner at the next point with radius r. Unlike the
      // segment operators above, this targets the vertex itself, so it is
      // valid even before the first point. Rounding only takes effect when
      // both adjacent segments are straight; the renderer silently no-ops
      // otherwise (curved-edge corners have no clean rounding semantics).
      if (t.charAt(0) === '(') {
        var rToken;
        if (t.length > 1) { rToken = t.slice(1); i++; }
        else { rToken = rest[i + 1]; i += 2; }
        if (rToken == null) throw new Error('polygon: ( needs a radius value');
        var rVal = parseNumber(rToken, 'polygon: (r radius');
        if (rVal <= 0) throw new Error('polygon: (r radius must be > 0');
        pendingRound = rVal;
        continue;
      }

      if (isRefToken(t)) {
        var rpt = { ref: tryParseRef(t) };
        rpt.seg = pendingSeg || { type: 'line' };
        rpt.curve = rpt.seg.type === 'smooth';
        if (pendingRound != null) rpt.round = pendingRound;
        shape.points.push(rpt);
        pendingSeg = null;
        pendingRound = null;
        i++;
        continue;
      }
      if (!isPointToken(t)) break;
      var pt = parsePointLiteral(t);
      pt.seg = pendingSeg || { type: 'line' };
      pt.curve = pt.seg.type === 'smooth';
      if (pendingRound != null) pt.round = pendingRound;
      shape.points.push(pt);
      pendingSeg = null;
      pendingRound = null;
      i++;
    }
    if (pendingSeg) {
      var opName = pendingSeg.type === 'smooth' ? '~'
                 : pendingSeg.type === 'arc'    ? '^'
                 : pendingSeg.type === 'quad'   ? '>'
                 : pendingSeg.type === 'cubic'  ? '*'
                 : pendingSeg.type;
      throw new Error('polygon: trailing ' + opName + ' with no following point');
    }
    if (pendingRound != null) throw new Error('polygon: trailing ( with no following point');
    if (shape.points.length < 2) {
      // Hint when the author wrote space-separated coords (e.g. `p 7 1 9 1 8 3`)
      // by analogy with `r x y w h`. Polygon's variable-length point list needs
      // a delimiter, so each point is `x,y` (one token) or `@ref`.
      var looksLikeRawNums = false;
      for (var rk = i; rk < rest.length; rk++) {
        var tk = rest[rk];
        if (tk.indexOf('=') >= 0 || tk.charAt(0) === '#') break;
        if (/^-?\d+(?:\.\d+)?$/.test(tk)) { looksLikeRawNums = true; break; }
      }
      if (looksLikeRawNums) {
        throw new Error('polygon: points use "x,y" (one token per point), not space-separated coords. e.g. `p 10,10 50,10 30,40`');
      }
      throw new Error('polygon: needs at least 2 points');
    }
  } else if (kind === 'chev') {
    // Chevron / arrow-block. Same coords as rect, plus a pointed tip on
    // the right. Optional `notch=N` carves the left edge into a matching
    // V so a row of chevrons interlocks (`> text >` style).
    if (rest.length < 4) throw new Error('chev: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'chev x');
    shape.y = parseNumber(rest[1], 'chev y');
    shape.w = parseNumber(rest[2], 'chev w');
    shape.h = parseNumber(rest[3], 'chev h');
    i = 4;
  } else if (kind === 'bub') {
    // Speech-bubble / callout. Body is a rounded rect at (x, y, w, h); a
    // triangular tail points from the body's nearest edge to `tail=tx,ty`.
    if (rest.length < 4) throw new Error('bub: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'bub x');
    shape.y = parseNumber(rest[1], 'bub y');
    shape.w = parseNumber(rest[2], 'bub w');
    shape.h = parseNumber(rest[3], 'bub h');
    i = 4;
  } else if (kind === 'cyl') {
    // Cylinder. Bounding box (x, y, w, h); the visible top/bottom ellipse
    // caps each take `lip` height (default ~15% of h, capped by w).
    if (rest.length < 4) throw new Error('cyl: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'cyl x');
    shape.y = parseNumber(rest[1], 'cyl y');
    shape.w = parseNumber(rest[2], 'cyl w');
    shape.h = parseNumber(rest[3], 'cyl h');
    i = 4;
  } else if (kind === 'tab') {
    // Folder tab. (x, y, w, h) is the full bbox; a smaller rectangular
    // tab sits on top-left, joined to the body with a slope. Text
    // centres in the body (below the tab).
    if (rest.length < 4) throw new Error('tab: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'tab x');
    shape.y = parseNumber(rest[1], 'tab y');
    shape.w = parseNumber(rest[2], 'tab w');
    shape.h = parseNumber(rest[3], 'tab h');
    i = 4;
  } else if (kind === 'doc') {
    // Document with folded top-right corner. The fold size defaults to
    // ~15% of min(w, h); the fold itself is drawn as a small triangle in
    // a lighter tint so the corner reads as a 3D fold.
    if (rest.length < 4) throw new Error('doc: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'doc x');
    shape.y = parseNumber(rest[1], 'doc y');
    shape.w = parseNumber(rest[2], 'doc w');
    shape.h = parseNumber(rest[3], 'doc h');
    i = 4;
  } else if (kind === 'cloud') {
    // Cloud shape. Single SVG path with five Bezier bumps around the
    // perimeter, no internal seams (unlike the hand-drawn "overlapping
    // circles" workaround).
    if (rest.length < 4) throw new Error('cloud: needs 4 numeric args (got ' + rest.length + ')');
    shape.x = parseNumber(rest[0], 'cloud x');
    shape.y = parseNumber(rest[1], 'cloud y');
    shape.w = parseNumber(rest[2], 'cloud w');
    shape.h = parseNumber(rest[3], 'cloud h');
    i = 4;
  } else {
    throw new Error('Unknown shape "' + kind + '"');
  }

  // Trailing tokens: #id or key=value attributes, in any order.
  while (i < rest.length) {
    var tok = rest[i];
    if (tok.charAt(0) === '#') {
      if (shape.id) throw new Error('multiple #id tokens on one line');
      var idName = tok.slice(1);
      // Trailing `!` marks the slot as required when the template is
      // consumed via @extends. The resolver checks for unfilled required
      // slots and surfaces an error per slide; for plain shapes (not
      // inside a template) the flag is just metadata that gets ignored.
      var required = false;
      if (idName.length > 0 && idName.charAt(idName.length - 1) === '!') {
        required = true;
        idName = idName.slice(0, -1);
      }
      if (!/^[A-Za-z_][\w-]*$/.test(idName)) throw new Error('invalid id "' + tok + '"');
      shape.id = idName;
      if (required) shape.required = true;
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
  if (tokens.length < 3) {
    throw new Error('grid: expected "grid W H [key=val ...]", got ' + tokens.length + ' tokens');
  }
  var w = parseNumber(tokens[1], 'grid W');
  var h = parseNumber(tokens[2], 'grid H');
  if (w <= 0 || h <= 0) throw new Error('grid: W and H must be positive');
  var attrs = {};
  for (var i = 3; i < tokens.length; i++) {
    var tok = tokens[i];
    var eq = tok.indexOf('=');
    if (eq < 0) throw new Error('grid: unexpected token "' + tok + '" — use key=value');
    var key = tok.slice(0, eq);
    var val = tok.slice(eq + 1);
    if (!/^[A-Za-z][\w-]*$/.test(key)) throw new Error('grid: invalid attribute key "' + key + '"');
    attrs[key] = val;
  }
  return { w: w, h: h, attrs: attrs };
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
  return { shapes: shapes, errors: errors, grid: grid || { w: DEFAULT_GRID.w, h: DEFAULT_GRID.h, attrs: {} } };
}

// ─── Reference resolution ──────────────────────────────

// Tip / notch / lip / tail defaults for the high-level shapes. Kept here
// (rather than in the renderer) so contentBox and any geometry consumer
// computes the same numbers without duplicating defaults.
function chevTip(s) {
  if (s.attrs && s.attrs.tip != null && s.attrs.tip !== '') {
    var v = parseFloat(s.attrs.tip);
    if (isFinite(v) && v >= 0) return Math.min(v, s.w);
  }
  return Math.min(s.h / 2, s.w * 0.25);
}
function chevNotch(s) {
  if (s.attrs && s.attrs.notch != null && s.attrs.notch !== '') {
    var v = parseFloat(s.attrs.notch);
    if (isFinite(v) && v >= 0) return Math.min(v, s.w / 2);
  }
  return 0;
}
function cylLip(s) {
  if (s.attrs && s.attrs.lip != null && s.attrs.lip !== '') {
    var v = parseFloat(s.attrs.lip);
    if (isFinite(v) && v > 0) return Math.min(v, s.h / 2);
  }
  return Math.min(s.h * 0.2, s.w * 0.4);
}
function bubTail(s) {
  if (s.attrs && s.attrs.tail) {
    var parts = String(s.attrs.tail).split(/[\s,]+/).filter(function (p) { return p !== ''; });
    if (parts.length === 2) {
      var tx = parseFloat(parts[0]);
      var ty = parseFloat(parts[1]);
      if (isFinite(tx) && isFinite(ty)) return { x: tx, y: ty };
    }
  }
  return null;
}

// Defaults for tab / doc / cloud parameters - kept here so contentBox
// computes the same numbers without duplicating the renderer's defaults.
function tabHeight(s) {
  if (s.attrs && s.attrs.tabH != null && s.attrs.tabH !== '') {
    var v = parseFloat(s.attrs.tabH);
    if (isFinite(v) && v > 0) return Math.min(v, s.h * 0.5);
  }
  return Math.min(s.h * 0.22, s.w * 0.18);
}
function docFold(s) {
  if (s.attrs && s.attrs.fold != null && s.attrs.fold !== '') {
    var v = parseFloat(s.attrs.fold);
    if (isFinite(v) && v > 0) return Math.min(v, s.w * 0.5, s.h * 0.5);
  }
  return Math.min(s.w, s.h) * 0.15;
}

function bboxOf(shape) {
  if (shape.kind === 'r') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape.kind === 'chev' || shape.kind === 'cyl' ||
      shape.kind === 'tab' || shape.kind === 'doc' || shape.kind === 'cloud') {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === 'bub') {
    // Body bbox only - the tail can poke outside, but the bounding box
    // we report is the rectangular body for layout / contentBox purposes.
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
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
  // `textBox=x,y,w,h` (or `x y w h`) overrides where text content
  // renders. Values are in grid units, relative to the shape's bounding
  // box top-left. Useful for asymmetric polygons (chevrons, callouts,
  // ribbons) where centering text in the bbox drifts it off the visual
  // mass; the author specifies a body rectangle and text centers there.
  var tb = parseTextBox(shape.attrs && shape.attrs.textBox);
  if (tb) {
    var bbox = bboxOf(shape);
    return { x: bbox.x + tb.x, y: bbox.y + tb.y, w: tb.w, h: tb.h };
  }
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
  if (shape.kind === 'chev') {
    // Text centres in the rectangular body, excluding the tip (and the
    // notch indent if set). This is the whole point of `chev` over a
    // hand-drawn polygon - the visual mass is the body, not the bbox.
    var tip = chevTip(shape);
    var notch = chevNotch(shape);
    return { x: shape.x + notch, y: shape.y,
             w: Math.max(0, shape.w - tip - notch), h: shape.h };
  }
  if (shape.kind === 'cyl') {
    // Text centres in the cylindrical body (between the two ellipse caps).
    var lip = cylLip(shape);
    return { x: shape.x, y: shape.y + lip,
             w: shape.w, h: Math.max(0, shape.h - 2 * lip) };
  }
  if (shape.kind === 'bub') {
    // Text centres in the bubble body. The tail does not displace text.
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === 'tab') {
    // Text centres in the body (below the tab on top-left).
    var th = tabHeight(shape);
    return { x: shape.x, y: shape.y + th, w: shape.w, h: Math.max(0, shape.h - th) };
  }
  if (shape.kind === 'doc') {
    // Text centres in the full body. The fold trims the top-right corner;
    // for long titles this can clip slightly, so the author may want to
    // shrink the shape or use a manual textBox.
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === 'cloud') {
    // Cloud text area is the inscribed rectangle - roughly the middle
    // 70% of the bbox, where the silhouette is dense enough to host
    // text without it floating over the bumps' negative space.
    var insetX = shape.w * 0.15;
    var insetY = shape.h * 0.20;
    return { x: shape.x + insetX, y: shape.y + insetY,
             w: shape.w - 2 * insetX, h: shape.h - 2 * insetY };
  }
  return null;
}

// Parse a "x,y,w,h" or "x y w h" attribute value into four numbers.
// Returns null if missing or malformed. Negative w/h are rejected.
function parseTextBox(raw) {
  if (raw == null || raw === '') return null;
  var parts = String(raw).split(/[\s,]+/).filter(function (s) { return s !== ''; });
  if (parts.length !== 4) return null;
  var x = parseFloat(parts[0]);
  var y = parseFloat(parts[1]);
  var w = parseFloat(parts[2]);
  var h = parseFloat(parts[3]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { x: x, y: y, w: w, h: h };
}

function anchorPoint(shape, anchor) {
  var t = ANCHOR_TABLE[anchor];
  if (!t) throw new Error('unknown anchor ".' + anchor + '"');
  var b = bboxOf(shape);
  return { x: b.x + b.w * t[0], y: b.y + b.h * t[1] };
}

function segCtrlRefs(seg) {
  // Returns an array of ref objects ({id, anchor}) for any control points in
  // this segment that were declared as @refs. Used by refsInShape /
  // shapeHasRefs / resolveShape to walk the new operator metadata.
  if (!seg) return [];
  var out = [];
  if (seg.c && seg.c.ref) out.push(seg.c.ref);
  if (seg.c1 && seg.c1.ref) out.push(seg.c1.ref);
  if (seg.c2 && seg.c2.ref) out.push(seg.c2.ref);
  return out;
}

function refsInShape(shape) {
  var ids = [];
  if (shape.refs) {
    var keys = Object.keys(shape.refs);
    for (var k = 0; k < keys.length; k++) ids.push(shape.refs[keys[k]].id);
  }
  if (shape.kind === 'p') {
    for (var j = 0; j < shape.points.length; j++) {
      var pt = shape.points[j];
      if (pt.ref) ids.push(pt.ref.id);
      var crefs = segCtrlRefs(pt.seg);
      for (var ci = 0; ci < crefs.length; ci++) ids.push(crefs[ci].id);
    }
  }
  return ids;
}

function shapeHasRefs(shape) {
  if (shape.refs && Object.keys(shape.refs).length > 0) return true;
  if (shape.kind === 'p') {
    for (var j = 0; j < shape.points.length; j++) {
      if (shape.points[j].ref) return true;
      if (segCtrlRefs(shape.points[j].seg).length > 0) return true;
    }
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
      // Resolve any @ref control points on the segment ending at this vertex.
      if (pt.seg) {
        var ctrlKeys = ['c', 'c1', 'c2'];
        for (var ck = 0; ck < ctrlKeys.length; ck++) {
          var sp = pt.seg[ctrlKeys[ck]];
          if (sp && sp.ref) {
            var ct = byId[sp.ref.id];
            var cap = anchorPoint(ct, sp.ref.anchor);
            sp.x = cap.x;
            sp.y = cap.y;
          }
        }
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

// Flags shapes whose bounding box extends outside the declared grid. A common
// agent mistake is writing `h 70` on a 56.25-tall grid and not realising the
// shape falls off the bottom. Surfaces as a parse-time error so the thumbnail
// badge catches it before the overflow is rendered.
function checkGridBounds(shapes, grid) {
  var errs = [];
  var EPS = 0.001;
  for (var i = 0; i < shapes.length; i++) {
    var s = shapes[i];
    // Lines and arrows are decorative, SVG clips them cleanly, and they
    // commonly reference shape anchors that happen to sit at grid edges.
    // Skip them to avoid false positives.
    if (s.kind === 'l' || s.kind === 'a') continue;
    try {
      var bb = bboxOf(s);
      var right = bb.x + bb.w;
      var bottom = bb.y + bb.h;
      if (bb.x < -EPS || bb.y < -EPS || right > grid.w + EPS || bottom > grid.h + EPS) {
        errs.push({
          line: s.lineNumber,
          message: 'shape extends outside grid ' + grid.w + 'x' + grid.h
            + ' (bbox ' + bb.x.toFixed(1) + ',' + bb.y.toFixed(1)
            + ' to ' + right.toFixed(1) + ',' + bottom.toFixed(1) + ')',
        });
      }
    } catch (e) { /* unresolvable shape — skip */ }
  }
  return errs;
}

// Convenience: parse + resolve in one call.
function parseAndResolve(src) {
  var pr = parse(src);
  var rr = resolve(pr.shapes);
  var bounds = checkGridBounds(rr.shapes, pr.grid);
  return { shapes: rr.shapes, errors: pr.errors.concat(rr.errors, bounds), grid: pr.grid };
}

// ─── Serialization (preserves refs for roundtrip) ──────

function refTokenStr(r) {
  return '@' + r.id + (r.anchor && r.anchor !== 'center' ? '.' + r.anchor : '');
}

// Stringify a control point that's either an x,y literal or an @ref.
// Used by polygon segment operators (>, *) to round-trip through serialize.
function ctrlTokenStr(c) {
  if (c.ref) return refTokenStr(c.ref);
  return c.x + ',' + c.y;
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
    if (s.bow != null) parts.push('^' + s.bow);
    if (s.refs && s.refs.to) parts.push(refTokenStr(s.refs.to));
    else parts.push(s.x2, s.y2);
  } else if (s.kind === 'p') {
    for (var i = 0; i < s.points.length; i++) {
      var pt = s.points[i];
      var seg = pt.seg;
      if (seg && seg.type === 'arc') {
        parts.push('^' + seg.sagitta);
      } else if (seg && seg.type === 'quad') {
        parts.push('>' + ctrlTokenStr(seg.c));
      } else if (seg && seg.type === 'cubic') {
        parts.push('*');
        parts.push(ctrlTokenStr(seg.c1));
        parts.push(ctrlTokenStr(seg.c2));
      } else if ((seg && seg.type === 'smooth') || (!seg && pt.curve)) {
        parts.push('~');
      }
      if (pt.round != null) parts.push('(' + pt.round);
      if (pt.ref) parts.push(refTokenStr(pt.ref));
      else parts.push(pt.x + ',' + pt.y);
    }
  }
  if (s.id) parts.push('#' + s.id + (s.required ? '!' : ''));
  var keys = Object.keys(s.attrs || {});
  for (var k = 0; k < keys.length; k++) parts.push(keys[k] + '=' + s.attrs[keys[k]]);
  var line = parts.join(' ');
  if (s.content != null) {
    if (s.content.indexOf('\n') >= 0) {
      // Multi-line content: emit block form (| alone, then 2-space-indented
      // continuations) so serialize → parse round-trips correctly.
      var indented = s.content.split('\n').map(function (l) { return '  ' + l; }).join('\n');
      return line + ' |\n' + indented;
    }
    line += ' | ' + s.content;
  }
  return line;
}

function serialize(shapes, grid) {
  var lines = [];
  var hasAttrs = grid && grid.attrs && Object.keys(grid.attrs).length > 0;
  var nonDefaultSize = grid && (grid.w !== DEFAULT_GRID.w || grid.h !== DEFAULT_GRID.h);
  if (nonDefaultSize || hasAttrs) {
    var gl = 'grid ' + grid.w + ' ' + grid.h;
    if (hasAttrs) {
      var keys = Object.keys(grid.attrs);
      for (var i = 0; i < keys.length; i++) gl += ' ' + keys[i] + '=' + grid.attrs[keys[i]];
    }
    lines.push(gl);
  }
  for (var j = 0; j < shapes.length; j++) lines.push(serializeShape(shapes[j]));
  return lines.join('\n');
}

exports.parse = parse;
exports.parseLine = parseLine;
exports.resolve = resolve;
exports.parseAndResolve = parseAndResolve;
exports.anchorPoint = anchorPoint;
exports.bboxOf = bboxOf;
exports.checkGridBounds = checkGridBounds;
exports.contentBox = contentBox;
exports.parseTextBox = parseTextBox;
exports.chevTip = chevTip;
exports.chevNotch = chevNotch;
exports.cylLip = cylLip;
exports.bubTail = bubTail;
exports.tabHeight = tabHeight;
exports.docFold = docFold;
exports.serialize = serialize;
exports.serializeShape = serializeShape;
exports.ANCHOR_TABLE = ANCHOR_TABLE;
exports.DEFAULT_GRID = DEFAULT_GRID;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocShapes = {}));
