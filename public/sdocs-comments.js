/**
 * sdocs-comments.js - sidecar comment storage for comment mode.
 *
 * Comments live in the document's YAML front matter under `comments:` - a
 * list of objects. The markdown body is NEVER touched; this removes every
 * class of "marked parses our marker wrong" bug the old inline-HTML-comment
 * format suffered from (line-start paragraph loss, inline-code backtick
 * unbalancing, cross-block wrapping, etc.).
 *
 * Comment shape (all fields flat; easier to YAML-serialize):
 *
 *   Selection-anchored:
 *     { id, kind: 'inline', quote, prefix, suffix, block, author, color, at, text }
 *
 *   Block-anchored:
 *     { id, kind: 'block', block, author, color, at, text }
 *
 * - `quote` is the exact rendered-text phrase to highlight.
 * - `prefix` / `suffix` (0-60 chars) disambiguate when `quote` appears
 *   multiple times in the target block.
 * - `block` is a "tagname:index-among-siblings-of-that-tagname" hint, e.g.
 *   "p:3" = 4th <p> in render order. Per-type indexing is more resilient to
 *   block reordering than a single global ordinal.
 *
 * Anchor resolution at render time uses a three-tier fallback:
 *   1. Block-scoped:  find block → locate (prefix+quote+suffix) in its text.
 *   2. Global:        search the whole rendered body for (prefix+quote+suffix).
 *   3. Quote-only:    last-resort global search for just the quote.
 *
 * UMD module so Node tests can call it directly.
 */
(function (exports) {
'use strict';

// ── Helpers ─────────────────────────────────────────────────────────────

var DEFAULT_COLOR = '#ffd700';
var HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
var ID_FORMAT = /^c\d+$/;

// Comment ids are written into a CSS selector
// (`.sdoc-card[data-c="..."]`). Crafted ids with quotes or brackets
// would break querySelector, or worse, match unrelated nodes. The
// writer always produces `cN`, so reject anything else.
function isValidId(id) {
  return typeof id === 'string' && ID_FORMAT.test(id);
}

// Comment colours flow into `style.setProperty('--sdoc-...-color', c)`,
// which is substituted directly into `background: var(--..., url())`-shaped
// CSS. setProperty accepts arbitrary token sequences, so without a gate a
// crafted shared URL could ship `url(https://attacker/p.gif)` as a colour
// and every viewer would GET that on render. The colour <input> in the UI
// emits #rrggbb only, so restrict to hex.
function sanitizeColor(c) {
  return (typeof c === 'string' && HEX_COLOR.test(c)) ? c : DEFAULT_COLOR;
}

// "Copy with comments" output gets pasted into agents, Slack, etc.
// A crafted shared URL whose comment text contains an embedded newline
// can forge additional [^cN]: footnote definitions in the copied bytes;
// bidi format characters can make the rendered card look one way while
// the copied bytes carry another. Strip both at serialization time so
// the clipboard contents match what the user saw on screen.
//   - C0 controls (0x00-0x1F): stripped except \t
//   - C1 controls (0x80-0x9F): stripped
//   - Bidi format chars: U+202A-U+202E, U+2066-U+2069
//   - Embedded \n collapses to a single space (footnote labels are
//     single-line; preserving the bytes would forge new footnotes)
var BIDI_OR_CTRL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\n+/g, ' ').replace(BIDI_OR_CTRL, '');
}

function getComments(meta) {
  if (!meta || typeof meta !== 'object') return [];
  var list = meta.comments;
  if (!Array.isArray(list)) return [];
  return list.slice();
}

function setComments(meta, list) {
  var out = Object.assign({}, meta || {});
  if (!list || list.length === 0) delete out.comments;
  else out.comments = list.slice();
  return out;
}

function nextId(meta) {
  var max = 0;
  var list = getComments(meta);
  for (var i = 0; i < list.length; i++) {
    var m = /^c(\d+)$/.exec(list[i].id || '');
    if (m) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return 'c' + (max + 1);
}

function normalizeComment(c) {
  if (!isValidId(c.id)) return null;
  var out = {
    id: c.id,
    kind: c.kind || (c.quote ? 'inline' : 'block'),
  };
  // Anchor fields
  if (out.kind === 'inline') {
    out.quote = c.quote || '';
    if (c.prefix) out.prefix = c.prefix;
    if (c.suffix) out.suffix = c.suffix;
  }
  if (c.block) out.block = c.block;
  // block_text: first ~60 chars of the block at write time. Used as a
  // text-based fallback when the block index has drifted (e.g. a paragraph
  // was inserted upstream). Block-comment analogue of inline's quote.
  if (c.block_text) out.block_text = c.block_text;
  // Author metadata
  out.author = c.author || 'user';
  out.color = sanitizeColor(c.color);
  out.at = c.at || new Date().toISOString();
  out.text = c.text || '';
  // resolved: optional. Preserved only when truthy so the on-disk YAML
  // stays terse for the common (unresolved) case. Coerced to boolean
  // because the YAML parser intentionally keeps "true"/"false" as
  // strings (its general contract); we apply boolean semantics here.
  if (c.resolved === true || c.resolved === 'true') out.resolved = true;
  return out;
}

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * addSelectionComment(meta, anchor, noteMeta) -> { meta, id }
 *
 * `anchor` = { quote, prefix?, suffix?, block? }
 * `noteMeta` = { author?, color?, at?, text? }
 *
 * Returns a new meta with the comment appended. Body is untouched -
 * anchoring happens at render time via text-quote lookup.
 */
function addSelectionComment(meta, anchor, noteMeta) {
  if (!anchor || typeof anchor.quote !== 'string' || !anchor.quote) {
    throw new Error('addSelectionComment requires a non-empty quote');
  }
  var id = nextId(meta);
  var c = normalizeComment({
    id: id,
    kind: 'inline',
    quote: anchor.quote,
    prefix: anchor.prefix || '',
    suffix: anchor.suffix || '',
    block: anchor.block || '',
    author: (noteMeta || {}).author,
    color: (noteMeta || {}).color,
    at: (noteMeta || {}).at,
    text: (noteMeta || {}).text,
  });
  var list = getComments(meta);
  list.push(c);
  return { meta: setComments(meta, list), id: id };
}

/**
 * addBlockComment(meta, { block }, noteMeta) -> { meta, id }
 *
 * Block comment targets the whole block (e.g. `"p:3"` or `"blockquote:0"`).
 */
function addBlockComment(meta, anchor, noteMeta) {
  if (!anchor || typeof anchor.block !== 'string' || !anchor.block) {
    throw new Error('addBlockComment requires a block id');
  }
  var id = nextId(meta);
  var c = normalizeComment({
    id: id,
    kind: 'block',
    block: anchor.block,
    block_text: anchor.block_text || '',
    author: (noteMeta || {}).author,
    color: (noteMeta || {}).color,
    at: (noteMeta || {}).at,
    text: (noteMeta || {}).text,
  });
  var list = getComments(meta);
  list.push(c);
  return { meta: setComments(meta, list), id: id };
}

/**
 * removeComment(meta, id) -> meta
 */
function removeComment(meta, id) {
  var list = getComments(meta).filter(function (c) { return c.id !== id; });
  return setComments(meta, list);
}

/**
 * updateComment(meta, id, patch) -> meta
 *
 * Merges `patch` into the comment with this id. Returns unchanged meta if
 * no matching comment exists. Typical patches: `{ text: 'new note' }`.
 */
function updateComment(meta, id, patch) {
  var changed = false;
  var list = getComments(meta).map(function (c) {
    if (c.id !== id) return c;
    changed = true;
    return normalizeComment(Object.assign({}, c, patch || {}));
  });
  return changed ? setComments(meta, list) : meta;
}

// ── Copy serializers ────────────────────────────────────────────────────

/**
 * serializeFootnotes(meta, body) -> string
 *
 * Emits the body with each inline comment's quote transformed into a
 * `[quote][^cN]` footnote reference, and the comment texts appended as
 * `[^cN]: author - text` lines. Block comments become footnote refs
 * attached at the end of the document.
 *
 * Matching strategy: try `prefix + quote + suffix` first (best case),
 * then `quote` alone. Comments whose quote can't be found in the body
 * still get a footnote at the end but no inline anchor.
 */
function serializeFootnotes(meta, body) {
  if (typeof body !== 'string') return body;
  var comments = getComments(meta);
  if (!comments.length) return body;
  var out = body;
  var footnotes = [];
  // Process in reverse so earlier replacements don't invalidate indices of later ones.
  var inlineComments = comments.filter(function (c) { return c.kind === 'inline' && c.quote; });
  var blockComments = comments.filter(function (c) { return c.kind !== 'inline'; });
  inlineComments.slice().reverse().forEach(function (c) {
    var needle = (c.prefix || '') + c.quote + (c.suffix || '');
    var idx = out.indexOf(needle);
    var quoteIdx = -1;
    if (idx !== -1) {
      quoteIdx = idx + (c.prefix || '').length;
    } else {
      quoteIdx = out.indexOf(c.quote);
    }
    if (quoteIdx !== -1) {
      var end = quoteIdx + c.quote.length;
      var replacement = '[' + c.quote + '][^' + c.id + ']';
      out = out.slice(0, quoteIdx) + replacement + out.slice(end);
    }
  });
  // Emit footnotes in original (chronological) order.
  comments.forEach(function (c) {
    var label = sanitizeText(c.author || 'user');
    if (c.resolved) label += ' [resolved]';
    label += ' - ' + sanitizeText(c.text || '');
    if (c.kind === 'block' && c.block) {
      var blockTag = c.block;
      if (c.block_text) blockTag += ' "' + sanitizeText(c.block_text) + '..."';
      label += ' (block ' + blockTag + ')';
    }
    footnotes.push('[^' + c.id + ']: ' + label);
  });
  return out.replace(/\n*$/, '') + '\n\n' + footnotes.join('\n') + '\n';
}

/**
 * serializeClean(meta, body) -> string
 *
 * Returns the body verbatim. Supplied as the "strip all comments" flow;
 * since the sidecar model never injected anything into the body, this
 * is literally the identity function - but we wrap it for symmetry with
 * the other serializers.
 */
function serializeClean(meta, body) { return body; }

/**
 * parseFootnotes(body) -> { comments, body }
 *
 * Inverse of serializeFootnotes. Recognises markdown footnotes whose ids
 * follow our convention (cN where N is digits) and converts them into
 * comment objects. Other footnote ids are left alone - academic citations
 * and the like keep their footnote semantics.
 *
 * Recognised patterns:
 *   Inline:  [quote][^cN]            anchor span = quote, kind = inline
 *   Block:   ...end of paragraph.[^cN]   kind = block, anchor = containing
 *                                         paragraph (block_text = first ~60
 *                                         chars of the paragraph the marker
 *                                         sits in)
 *   Defn:    [^cN]: author - text [resolved]?   the comment text
 *
 * The returned `body` has the recognised refs/defs stripped, ready to feed
 * to the markdown renderer. Unrecognised footnotes pass through unchanged.
 *
 * `block_text` is computed from the body string at parse time, before
 * marked rendering. For block comments, this is the survival hint that
 * lets the existing tier-2 resolver attach the comment to the right
 * block in the rendered DOM (where tag:n indices are computed).
 */
function parseFootnotes(body) {
  if (typeof body !== 'string' || body.indexOf('[^c') === -1) {
    return { comments: [], body: body };
  }
  var ID_RE = /^c\d+$/;
  // Pull out definitions first. Anchored at line start; tolerate trailing
  // whitespace/newlines. Also tolerate `[^cN]:`-only lines (no text).
  var defs = {};
  var DEF_RE = /^\[\^(c\d+)\]:[ \t]*(.*)$/;
  var lines = body.split('\n');
  var keptLines = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(DEF_RE);
    if (m) {
      defs[m[1]] = (m[2] || '').trim();
    } else {
      keptLines.push(lines[i]);
    }
  }
  body = keptLines.join('\n');

  // Pull author + text + resolved-marker out of a definition string.
  // Format emitted by serializeFootnotes: "<author>[ [resolved]] - <text>".
  function decodeDef(raw) {
    var out = { text: raw || '', resolved: false, author: undefined };
    if (!raw) return out;
    if (/\[resolved\]/.test(raw)) out.resolved = true;
    // Try to split on the first " - " that comes after a plausible author token.
    var split = raw.match(/^(.+?)\s-\s(.+)$/);
    if (split) {
      var head = split[1].replace(/\s*\[resolved\]\s*$/, '').trim();
      // Heuristic: treat head as an author handle if it's compact (no inner punctuation
      // beyond `.`, `_`, `-`, brackets, spaces) and reasonably short.
      if (head.length <= 40 && /^[\w][\w \[\].\-_]*$/.test(head)) {
        out.author = head;
        out.text = split[2];
      }
    }
    // Trailing "(block tag:n)" hint, if present, gets stripped from text and
    // surfaced separately.
    var tag = (out.text || '').match(/\s*\(block\s+(\w+:\d+)\)\s*$/);
    if (tag) {
      out.block = tag[1];
      out.text = out.text.replace(/\s*\(block\s+\w+:\d+\)\s*$/, '');
    }
    return out;
  }

  var comments = [];
  var seen = {};

  // Inline: [quote][^cN]
  body = body.replace(/\[([^\]\n]+?)\]\[\^(c\d+)\]/g, function (_m, quote, id) {
    if (!ID_RE.test(id)) return _m;
    if (seen[id]) return _m;
    seen[id] = true;
    var d = decodeDef(defs[id]);
    var c = { id: id, kind: 'inline', quote: quote, text: d.text };
    if (d.author) c.author = d.author;
    if (d.resolved) c.resolved = true;
    comments.push(c);
    return quote;
  });

  // Block markers: lone [^cN] not preceded by `]`. The surrounding paragraph
  // becomes the block_text survival hint.
  var REF_RE = /\[\^(c\d+)\]/g;
  var match;
  while ((match = REF_RE.exec(body)) !== null) {
    var id = match[1];
    if (!ID_RE.test(id) || seen[id]) continue;
    var refStart = match.index;
    if (body[refStart - 1] === ']') continue;
    seen[id] = true;
    var paraStart = body.lastIndexOf('\n\n', refStart);
    paraStart = paraStart === -1 ? 0 : paraStart + 2;
    var paraEnd = body.indexOf('\n\n', refStart);
    if (paraEnd === -1) paraEnd = body.length;
    var paragraph = body.slice(paraStart, paraEnd);
    var clean = paragraph.replace(REF_RE, '').trim();
    var d2 = decodeDef(defs[id]);
    var c2 = { id: id, kind: 'block', block_text: clean.slice(0, 60), text: d2.text };
    if (d2.block) c2.block = d2.block;
    if (d2.author) c2.author = d2.author;
    if (d2.resolved) c2.resolved = true;
    comments.push(c2);
  }
  body = body.replace(REF_RE, function (_m, id) { return seen[id] ? '' : _m; });

  // Orphan definitions (no body marker). Treat as block comments. This is the
  // shape serializeFootnotes emits today for block-kind comments - the def
  // carries a `(block tag:n)` hint and there is no body marker.
  Object.keys(defs).forEach(function (id) {
    if (!ID_RE.test(id) || seen[id]) return;
    seen[id] = true;
    var d3 = decodeDef(defs[id]);
    var c3 = { id: id, kind: 'block', text: d3.text };
    if (d3.block) c3.block = d3.block;
    if (d3.author) c3.author = d3.author;
    if (d3.resolved) c3.resolved = true;
    comments.push(c3);
  });

  body = body.replace(/\n{3,}$/, '\n').replace(/[ \t]+$/gm, '');
  // Return in chronological (id) order rather than parse-pass order.
  comments.sort(function (a, b) {
    var na = parseInt((a.id || '').slice(1), 10);
    var nb = parseInt((b.id || '').slice(1), 10);
    return na - nb;
  });
  return { comments: comments, body: body };
}

// ── Public API ──────────────────────────────────────────────────────────

exports.sanitizeColor       = sanitizeColor;
exports.isValidId           = isValidId;
exports.getComments         = getComments;
exports.setComments         = setComments;
exports.nextId              = nextId;
exports.normalizeComment    = normalizeComment;
exports.addSelectionComment = addSelectionComment;
exports.addBlockComment     = addBlockComment;
exports.removeComment       = removeComment;
exports.updateComment       = updateComment;
exports.serializeFootnotes  = serializeFootnotes;
exports.parseFootnotes      = parseFootnotes;
exports.serializeClean      = serializeClean;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocComments = {}));
