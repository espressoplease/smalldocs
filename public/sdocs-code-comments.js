// sdocs-code-comments.js - pure data model for code-viewer comments.
//
// The fullscreen code view (sdocs-code-focus.js) lets a reader annotate a
// source file. Unlike markdown comments - which anchor to rendered-text quotes
// and live in the document's YAML front matter - code comments anchor to a
// SOURCE LINE (or a method, a run of lines), and persist in localStorage keyed
// by the file. There is no document round-trip here: a code file opened with
// `sdoc app.rb` is not a saved SmallDocs document, so the comments ride
// alongside it in the browser the same way the fold preference does.
//
// This module is pure: it transforms plain arrays and objects and never touches
// the DOM or localStorage. The UI layer in sdocs-code-focus.js owns load/save
// and rendering. Keeping the model pure means the Node test suite exercises the
// anchoring, sanitisation, and serialisation directly.
//
// Comment shape (flat, JSON-friendly):
//
//   Line-anchored:
//     { id, kind: 'line',   line, anchorText, author, color, at, text, resolved? }
//
//   Method-anchored:
//     { id, kind: 'method', line, endLine, anchorText, author, color, at, text, resolved? }
//
// - `line` is the 0-based source-line index the comment was placed on. For a
//   method comment it is the header line (the `def` / `function` / `fn` line).
// - `endLine` (method only) is the last line of the method body, so the whole
//   method can be highlighted when the reader hovers it.
// - `anchorText` is the trimmed text of the anchored line at write time. When
//   the file shifts (lines added above), resolveLine() uses it to re-find the
//   line near its stored index, the code analogue of the markdown quote anchor.
//
// UMD so Node tests can require it directly.
(function (exports) {
  'use strict';

  var DEFAULT_COLOR = '#ffbb00';
  var HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var ID_FORMAT = /^c\d+$/;

  // ids land in a CSS selector (`[data-c="..."]`); only ever emit `cN`.
  function isValidId(id) {
    return typeof id === 'string' && ID_FORMAT.test(id);
  }

  // Colours feed `style.setProperty('--...-color', c)`, which is substituted
  // straight into `var(...)`-shaped CSS. A crafted value could smuggle a
  // `url(...)` and make every viewer fetch it. The colour <input> emits #rrggbb,
  // so restrict to hex and fall back to the default otherwise.
  function sanitizeColor(c) {
    return (typeof c === 'string' && HEX_COLOR.test(c)) ? c : DEFAULT_COLOR;
  }

  // Strip control and bidi-format characters from comment text so a crafted
  // shared file can't make a card read one way on screen and another when
  // copied. Newlines and tabs survive (the composer is multi-line); other C0
  // controls, C1 controls, and the bidi overrides are removed. Built from
  // \u escapes so no raw control bytes sit in the source.
  var BIDI_OR_CTRL = new RegExp(
    '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069]', 'g');
  function sanitizeText(s) {
    if (typeof s !== 'string') return '';
    return s.replace(BIDI_OR_CTRL, '');
  }

  function getComments(list) {
    return Array.isArray(list) ? list.slice() : [];
  }

  function nextId(list) {
    var max = 0;
    getComments(list).forEach(function (c) {
      var m = /^c(\d+)$/.exec((c && c.id) || '');
      if (m) { var n = parseInt(m[1], 10); if (!isNaN(n) && n > max) max = n; }
    });
    return 'c' + (max + 1);
  }

  function toInt(n, fallback) {
    var v = parseInt(n, 10);
    return isNaN(v) ? fallback : v;
  }

  // Coerce an arbitrary object into a valid comment, or null if it can't be one.
  // Used both by the mutators and by parse() so loaded data is held to the same
  // bar as freshly created comments.
  function normalize(c) {
    if (!c || !isValidId(c.id)) return null;
    var kind = c.kind === 'method' ? 'method' : 'line';
    var line = toInt(c.line, -1);
    if (line < 0) return null;
    var out = {
      id: c.id,
      kind: kind,
      line: line,
      anchorText: typeof c.anchorText === 'string' ? c.anchorText : '',
      author: c.author || 'user',
      color: sanitizeColor(c.color),
      at: c.at || new Date().toISOString(),
      text: sanitizeText(c.text || ''),
    };
    if (kind === 'method') {
      var end = toInt(c.endLine, line);
      out.endLine = end < line ? line : end;
    }
    if (c.resolved === true || c.resolved === 'true') out.resolved = true;
    return out;
  }

  // anchor: { kind, line, endLine?, anchorText? }
  // note:   { author?, color?, at?, text? }
  function addComment(list, anchor, note) {
    if (!anchor || toInt(anchor.line, -1) < 0) {
      throw new Error('addComment requires a line index');
    }
    var arr = getComments(list);
    var id = nextId(arr);
    var c = normalize({
      id: id,
      kind: anchor.kind,
      line: anchor.line,
      endLine: anchor.endLine,
      anchorText: anchor.anchorText,
      author: (note || {}).author,
      color: (note || {}).color,
      at: (note || {}).at,
      text: (note || {}).text,
    });
    if (!c) throw new Error('addComment produced an invalid comment');
    arr.push(c);
    return { list: arr, id: id };
  }

  function removeComment(list, id) {
    return getComments(list).filter(function (c) { return c.id !== id; });
  }

  // Returns the same array reference when nothing matched, so callers can detect
  // a no-op by identity.
  function updateComment(list, id, patch) {
    var changed = false;
    var arr = getComments(list).map(function (c) {
      if (c.id !== id) return c;
      changed = true;
      return normalize(Object.assign({}, c, patch || {}));
    }).filter(Boolean);
    return changed ? arr : list;
  }

  // ── Anchor resolution ─────────────────────────────────────────────────────

  // Re-find a comment's line in the current source. The stored index is the
  // first guess; if the line there no longer matches the saved anchorText (the
  // file was edited upstream), search outward for the nearest line whose trimmed
  // text equals anchorText. Returns the resolved 0-based index, or -1 if the
  // anchor is lost (the comment is then shown as orphaned).
  //
  // Empty anchorText can't be matched by text, so it trusts the stored index as
  // long as it is still in range.
  function resolveLine(comment, srcLines) {
    if (!comment || !Array.isArray(srcLines) || !srcLines.length) return -1;
    var want = String(comment.anchorText || '').trim();
    var at = toInt(comment.line, -1);
    if (!want) return (at >= 0 && at < srcLines.length) ? at : -1;
    if (at >= 0 && at < srcLines.length && srcLines[at].trim() === want) return at;
    // Spiral outward from the stored index so the nearest identical line wins
    // when the anchor text is not unique.
    var n = srcLines.length;
    for (var d = 1; d < n; d++) {
      var lo = at - d, hi = at + d;
      if (lo >= 0 && lo < n && srcLines[lo].trim() === want) return lo;
      if (hi >= 0 && hi < n && srcLines[hi].trim() === want) return hi;
    }
    // Stored index out of range entirely: fall back to a forward scan.
    for (var i = 0; i < n; i++) if (srcLines[i].trim() === want) return i;
    return -1;
  }

  // ── Copy with comments ────────────────────────────────────────────────────

  // Emit the source plus its notes as a single annotated block, the code
  // analogue of the markdown footnote copy: the code fenced unchanged, then a
  // numbered Notes list keyed by line (or method range) with author and text.
  // Pasteable into an agent or chat. Notes are ordered by their resolved line;
  // a note whose anchor is gone is dropped from the list (its anchor can't be
  // pointed at). opts: { fileName, lang, lineOffset }.
  //
  // lineOffset shifts the line numbers PRINTED in the notes without changing how
  // anchors resolve. A per-section copy fences only the section slice but still
  // wants to cite the file's real line numbers, so it passes the section's start
  // index (0-based) as lineOffset: a note resolved to slice row 0 then prints as
  // the absolute line it came from, not "line 1".
  function serializeAnnotations(list, srcLines, opts) {
    opts = opts || {};
    var lines = Array.isArray(srcLines) ? srcLines : String(srcLines || '').split('\n');
    var lang = opts.lang || '';
    var fileName = opts.fileName || 'code';
    var off = toInt(opts.lineOffset, 0);
    if (off < 0) off = 0;
    var resolved = getComments(list).map(function (c) {
      return { c: c, ln: resolveLine(c, lines) };
    }).filter(function (r) { return r.ln >= 0; });
    resolved.sort(function (a, b) { return a.ln - b.ln || idNum(a.c) - idNum(b.c); });

    var out = 'Comments on ' + fileName + '\n\n';
    out += '```' + lang + '\n' + lines.join('\n').replace(/\s+$/, '') + '\n```\n';
    if (!resolved.length) return out;
    out += '\nNotes:\n';
    resolved.forEach(function (r, i) {
      var c = r.c, ln = r.ln;
      var author = sanitizeText(c.author || 'you');
      var text = sanitizeText(c.text || '').replace(/\n+/g, ' ');
      var loc;
      if (c.kind === 'method') {
        var end = ln + (toInt(c.endLine, ln) - toInt(c.line, ln));
        if (end < ln) end = ln;
        if (end >= lines.length) end = lines.length - 1;
        loc = 'method `' + (lines[ln] || '').trim() + '` (lines ' + (ln + 1 + off) + '-' + (end + 1 + off) + ')';
      } else {
        loc = 'line ' + (ln + 1 + off) + ' `' + (lines[ln] || '').trim() + '`';
      }
      out += '[' + (i + 1) + '] ' + loc + ' - ' + author + ': ' + text + '\n';
    });
    return out;
  }

  function idNum(c) {
    var m = /^c(\d+)$/.exec((c && c.id) || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  // ── Persistence (string <-> array) ────────────────────────────────────────

  // Serialise to a compact JSON string for localStorage. Pure: the UI hands the
  // result to localStorage.setItem.
  function serialize(list) {
    return JSON.stringify(getComments(list));
  }

  // Parse a stored string back into a validated array. Anything malformed (bad
  // JSON, non-array, junk entries) degrades to an empty list rather than
  // throwing, so a corrupt key never breaks the overlay.
  function parse(str) {
    if (typeof str !== 'string' || !str) return [];
    var raw;
    try { raw = JSON.parse(str); } catch (_) { return []; }
    if (!Array.isArray(raw)) return [];
    return raw.map(normalize).filter(Boolean);
  }

  exports.DEFAULT_COLOR  = DEFAULT_COLOR;
  exports.isValidId      = isValidId;
  exports.sanitizeColor  = sanitizeColor;
  exports.sanitizeText   = sanitizeText;
  exports.getComments    = getComments;
  exports.nextId         = nextId;
  exports.normalize      = normalize;
  exports.addComment     = addComment;
  exports.removeComment  = removeComment;
  exports.updateComment  = updateComment;
  exports.resolveLine    = resolveLine;
  exports.serialize      = serialize;
  exports.parse          = parse;
  exports.serializeAnnotations = serializeAnnotations;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsCodeComments = {}));
