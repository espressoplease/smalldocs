// sdocs-code-comments.js - pure data model for code-viewer comments.
//
// The fullscreen code view (sdocs-code-focus.js) lets a reader annotate a
// source file. Code comments live in the document's ONE comment store
// (`comments` in the YAML front matter) alongside prose comments, so they travel
// with a short link / share / export and are rendered by both the reader and the
// viewer. Where a prose comment anchors to a rendered-text quote, a code comment
// anchors to a SOURCE LINE (or a method, a run of lines, or a token selection)
// inside a specific code block: it carries a `block` tag ("pre:N", the block's
// index among the document's code blocks) plus the line index (and a `quote` for
// a token), so several code blocks in one document keep their notes apart.
//
// This module is pure: it transforms plain arrays and objects and never touches
// the DOM or storage. The UI layer in sdocs-code-focus.js owns the document
// round-trip and rendering. Keeping the model pure means the Node test suite
// exercises the anchoring, sanitisation, and serialisation directly.
//
// Comment shape (flat, JSON-friendly):
//
//   Line-anchored:
//     { id, kind: 'line',   block, line, anchorText, author, color, at, text, resolved? }
//
//   Method-anchored:
//     { id, kind: 'method', block, line, endLine, anchorText, author, color, at, text, resolved? }
//
// - `block` is "pre:N", the 0-based index of the code block among the
//   document's code blocks, so a multi-block document keeps each block's notes
//   apart. A note without a block tag is treated as belonging to the first block.
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
    var line = toInt(c.line, -1);
    if (line < 0) return null;
    var kind = c.kind === 'method' ? 'method' : (c.kind === 'token' ? 'token' : 'line');
    // A token comment anchors to a selected phrase WITHIN a line, so it needs a
    // quote. Without one it can't be placed, so it degrades to a line comment.
    var quote = (kind === 'token' && typeof c.quote === 'string') ? sanitizeText(c.quote) : '';
    if (kind === 'token' && !quote.trim()) kind = 'line';
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
    if (typeof c.block === 'string' && c.block) out.block = c.block;
    ['block_text', 'line_prefix', 'line_suffix', 'quote_prefix', 'quote_suffix', 'document_hash'].forEach(function (key) {
      if (typeof c[key] === 'string') out[key] = c[key];
    });
    if (toInt(c.quote_offset, -1) >= 0) out.quote_offset = toInt(c.quote_offset, -1);
    if (c.anchor_status === 'orphaned' || c.anchor_status === 'ambiguous') out.anchor_status = c.anchor_status;
    if (kind === 'method') {
      var end = toInt(c.endLine, line);
      out.endLine = end < line ? line : end;
    }
    if (kind === 'token') out.quote = quote;
    if (c.resolved === true || c.resolved === 'true') out.resolved = true;
    var threads = typeof module !== 'undefined' && module.exports
      ? require('../cli/shared/sdocs-comment-data') : window.SDocsCommentData;
    if (threads && threads.normalizeThreadFields) threads.normalizeThreadFields(c, out);
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
    var threads = typeof module !== 'undefined' && module.exports
      ? require('../cli/shared/sdocs-comment-data') : window.SDocsCommentData;
    var c = normalize({
      id: id,
      uid: threads && threads.newId ? threads.newId('cm') : undefined,
      kind: anchor.kind,
      block: anchor.block,
      line: anchor.line,
      endLine: anchor.endLine,
      quote: anchor.quote,
      anchorText: anchor.anchorText,
      block_text: anchor.block_text,
      line_prefix: anchor.line_prefix,
      line_suffix: anchor.line_suffix,
      quote_prefix: anchor.quote_prefix,
      quote_suffix: anchor.quote_suffix,
      quote_offset: anchor.quote_offset,
      document_hash: anchor.document_hash,
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
      var threads = typeof module !== 'undefined' && module.exports
        ? require('../cli/shared/sdocs-comment-data') : window.SDocsCommentData;
      return normalize(Object.assign({}, c, patch || {}, {
        uid: c.uid || (threads && threads.newId ? threads.newId('cm') : undefined),
        updated_at: new Date().toISOString(),
      }));
    }).filter(Boolean);
    return changed ? arr : list;
  }

  // ── Anchor resolution ─────────────────────────────────────────────────────

  // Re-find the saved text, using neighboring lines to distinguish repeated
  // source. Ambiguous or missing targets stay unplaced instead of taking the
  // nearest ordinal, which may now refer to different code.
  function resolveLine(comment, srcLines) {
    return resolveLineTarget(comment, srcLines).line;
  }

  function resolveLineTarget(comment, srcLines) {
    if (!comment || !Array.isArray(srcLines) || !srcLines.length) return { line: -1, status: 'orphaned', candidates: [] };
    if (comment.anchor_status === 'orphaned' || comment.anchor_status === 'ambiguous') return { line: -1, status: comment.anchor_status, candidates: [] };
    var want = String(comment.anchorText || '').trim();
    var at = toInt(comment.line, -1);
    if (comment.block_text && String(comment.block_text).trim() === srcLines.join('\n').trim() &&
        at >= 0 && at < srcLines.length && srcLines[at].trim() === want) {
      if (comment.kind !== 'token' || resolveQuote(comment, srcLines[at]).start >= 0) {
        return { line: at, status: 'attached', candidates: [at] };
      }
    }
    var hits = [];
    for (var i = 0; i < srcLines.length; i++) {
      if (srcLines[i].trim() === want && (want || i === at ||
          typeof comment.line_prefix === 'string' || typeof comment.line_suffix === 'string')) hits.push(i);
    }
    var context = hits.filter(function (line) {
      return (typeof comment.line_prefix !== 'string' || srcLines.slice(Math.max(0, line - 2), line).join('\n') === comment.line_prefix)
        && (typeof comment.line_suffix !== 'string' || srcLines.slice(line + 1, line + 3).join('\n') === comment.line_suffix);
    });
    var hasContext = typeof comment.line_prefix === 'string' || typeof comment.line_suffix === 'string';
    var surviving = hits.filter(function (line) {
      return (comment.line_prefix && srcLines.slice(Math.max(0, line - 2), line).join('\n') === comment.line_prefix) ||
        (comment.line_suffix && srcLines.slice(line + 1, line + 3).join('\n') === comment.line_suffix);
    });
    var choices = context.length ? context : (surviving.length ? surviving : (hasContext ? [] : hits));
    if (choices.length !== 1) return { line: -1, status: choices.length ? 'ambiguous' : 'orphaned', candidates: choices };
    var line = choices[0];
    if (comment.kind === 'token' && comment.quote) {
      var token = resolveQuote(comment, srcLines[line]);
      if (token.start < 0) return { line: -1, status: token.status, candidates: [line] };
    }
    return { line: line, status: 'attached', candidates: choices };
  }

  function resolveQuote(comment, text) {
    var quote = String(comment.quote || '');
    var hits = [], from = 0, at;
    if (!quote) return { start: -1, status: 'orphaned' };
    var offset = toInt(comment.quote_offset, -1);
    if (offset >= 0 && text.trim() === String(comment.anchorText || '').trim() && text.slice(offset, offset + quote.length) === quote) {
      return { start: offset, status: 'attached' };
    }
    while ((at = text.indexOf(quote, from)) >= 0) { hits.push(at); from = at + quote.length; }
    var context = hits.filter(function (pos) {
      return (!comment.quote_prefix || text.slice(Math.max(0, pos - comment.quote_prefix.length), pos) === comment.quote_prefix)
        && (!comment.quote_suffix || text.slice(pos + quote.length, pos + quote.length + comment.quote_suffix.length) === comment.quote_suffix);
    });
    var choices = context.length ? context : hits;
    return choices.length === 1 ? { start: choices[0], status: 'attached' }
      : { start: -1, status: choices.length ? 'ambiguous' : 'orphaned' };
  }

  // A block ordinal is a navigation hint. Text and line context determine which
  // current fence owns a note after fences are inserted, moved, or removed.
  function resolveBlock(comment, blocks) {
    if (!comment || !Array.isArray(blocks)) return { index: -1, status: 'orphaned' };
    if (comment.anchor_status === 'orphaned' || comment.anchor_status === 'ambiguous') return { index: -1, status: comment.anchor_status };
    var exact = [];
    if (comment.block_text) blocks.forEach(function (text, index) {
      if (String(text).trim() === comment.block_text) exact.push(index);
    });
    if (exact.length === 1) return { index: exact[0], status: 'attached' };
    if (exact.length > 1) return { index: -1, status: 'ambiguous' };
    var candidates = [], ambiguous = false;
    blocks.forEach(function (text, index) {
      var target = resolveLineTarget(comment, String(text).replace(/\n$/, '').split('\n'));
      if (target.line >= 0) candidates.push(index);
      if (target.status === 'ambiguous') ambiguous = true;
    });
    if (candidates.length === 1) return { index: candidates[0], status: 'attached' };
    return { index: -1, status: candidates.length || ambiguous ? 'ambiguous' : 'orphaned' };
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
      var author = sanitizeText(c.author || 'user');
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

  // Resolve ANY comment kind to a 0-based source line: code kinds by their
  // stored line (+ anchorText drift recovery), a quote-anchored comment (inline
  // or token without a line) by the first line containing its quote, and a block
  // comment to -1 (it covers the whole block, not a single line).
  function resolveAnyLine(c, srcLines) {
    if (!c || !Array.isArray(srcLines)) return -1;
    if (c.anchor_status === 'orphaned' || c.anchor_status === 'ambiguous') return -1;
    if (c.kind === 'block') return -1;
    if (c.kind === 'inline' || (c.kind === 'token' && toInt(c.line, -1) < 0)) {
      var q = String(c.quote || '');
      if (!q) return -1;
      var source = srcLines.join('\n');
      var needle = (c.prefix || '') + q + (c.suffix || '');
      var at = source.indexOf(needle), length = needle.length;
      if (at < 0 && !c.prefix && !c.suffix) { at = source.indexOf(q); needle = q; length = q.length; }
      if (at < 0 || source.indexOf(needle, at + length) >= 0) return -1;
      var start = at + (needle === q ? 0 : (c.prefix || '').length);
      return source.slice(0, start).split('\n').length - 1;
    }
    return resolveLine(c, srcLines);
  }

  // Serialize ONE code block plus EVERY comment on it (any kind) as clean code
  // followed by an ordered, located notes list. Both the reader and the viewer
  // use this for "copy a code block with its comments", so the output is
  // identical and complete no matter which surface (or kind) it came from.
  function serializeBlockComments(list, srcLines, opts) {
    opts = opts || {};
    var lines = Array.isArray(srcLines) ? srcLines : String(srcLines || '').split('\n');
    var lang = opts.lang || '';
    var fileName = opts.fileName || 'code';
    var off = toInt(opts.lineOffset, 0);
    if (off < 0) off = 0;
    var resolved = getComments(list).map(function (c) {
      return { c: c, ln: resolveAnyLine(c, lines) };
    }).filter(function (r) { return r.c && sanitizeText(r.c.text || '').trim(); });
    resolved.sort(function (a, b) {
      var la = a.ln < 0 ? Infinity : a.ln, lb = b.ln < 0 ? Infinity : b.ln;
      return la - lb || idNum(a.c) - idNum(b.c);
    });
    var out = 'Comments on ' + fileName + '\n\n';
    out += '```' + lang + '\n' + lines.join('\n').replace(/\s+$/, '') + '\n```\n';
    if (!resolved.length) return out;
    out += '\nNotes:\n';
    resolved.forEach(function (r, i) {
      var c = r.c, ln = r.ln;
      var author = sanitizeText(c.author || 'user');
      var text = sanitizeText(c.text || '').replace(/\n+/g, ' ');
      var loc;
      if (c.kind === 'block') {
        loc = 'whole block';
      } else if (ln < 0) {
        loc = 'anchor missing or ambiguous' + (c.anchorText ? ' `' + sanitizeText(c.anchorText) + '`' : '');
      } else if (c.kind === 'method') {
        var end = ln + (toInt(c.endLine, ln) - toInt(c.line, ln));
        if (end < ln) end = ln;
        if (end >= lines.length) end = lines.length - 1;
        loc = 'method `' + (lines[ln] || '').trim() + '` (lines ' + (ln + 1 + off) + '-' + (end + 1 + off) + ')';
      } else {
        loc = 'line ' + (ln + 1 + off) + ' `' + (lines[ln] || '').trim() + '`';
      }
      out += '[' + (i + 1) + '] ' + loc + ' - ' + author + ': ' + text + '\n';
      if (c.resolved) out += '    Resolved\n';
      (Array.isArray(c.replies) ? c.replies : []).forEach(function (reply) {
        out += '    Reply - ' + sanitizeText(reply.author || 'user') + ': ' + sanitizeText(reply.text || '').replace(/\n+/g, ' ') + '\n';
      });
    });
    return out;
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
  exports.resolveLineTarget = resolveLineTarget;
  exports.resolveQuote = resolveQuote;
  exports.resolveBlock = resolveBlock;
  exports.serialize      = serialize;
  exports.parse          = parse;
  exports.serializeAnnotations = serializeAnnotations;
  exports.resolveAnyLine = resolveAnyLine;
  exports.serializeBlockComments = serializeBlockComments;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsCodeComments = {}));
