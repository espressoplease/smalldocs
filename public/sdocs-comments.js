/**
 * sdocs-comments.js - sidecar comment storage for comment mode.
 *
 * Comments live in the document's YAML front matter under `comments:` — a
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
  // Author metadata
  out.author = c.author || 'user';
  out.color = c.color || '#ffd700';
  out.at = c.at || new Date().toISOString();
  out.text = c.text || '';
  return out;
}

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * addSelectionComment(meta, anchor, noteMeta) -> { meta, id }
 *
 * `anchor` = { quote, prefix?, suffix?, block? }
 * `noteMeta` = { author?, color?, at?, text? }
 *
 * Returns a new meta with the comment appended. Body is untouched —
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

// ── Parse (legacy) ──────────────────────────────────────────────────────
// Kept as a thin wrapper for callers that still pass raw markdown, so
// Playwright / UI code can migrate incrementally.

function parse(meta /*, body */) {
  return { comments: getComments(meta).map(normalizeComment) };
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
    var label = (c.author || 'user') + ' - ' + (c.text || '');
    if (c.kind === 'block' && c.block) label += ' (block ' + c.block + ')';
    footnotes.push('[^' + c.id + ']: ' + label);
  });
  return out.replace(/\n*$/, '') + '\n\n' + footnotes.join('\n') + '\n';
}

/**
 * serializeClean(meta, body) -> string
 *
 * Returns the body verbatim. Supplied as the "strip all comments" flow;
 * since the sidecar model never injected anything into the body, this
 * is literally the identity function — but we wrap it for symmetry with
 * the other serializers.
 */
function serializeClean(meta, body) { return body; }

// ── Public API ──────────────────────────────────────────────────────────

exports.getComments         = getComments;
exports.setComments         = setComments;
exports.nextId              = nextId;
exports.normalizeComment    = normalizeComment;
exports.addSelectionComment = addSelectionComment;
exports.addBlockComment     = addBlockComment;
exports.removeComment       = removeComment;
exports.updateComment       = updateComment;
exports.parse               = parse;
exports.serializeFootnotes  = serializeFootnotes;
exports.serializeClean      = serializeClean;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocComments = {}));
