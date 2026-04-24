/**
 * sdocs-comments.js - inline HTML comment storage + parser for comment mode.
 *
 * Comments are stored directly in the markdown body as HTML comments. `marked`
 * renders them as invisible, so in every non-comment mode the doc reads clean.
 * Only comment mode parses them out and renders UI overlays.
 *
 * Two shapes in the body:
 *
 *   Selection-anchored (the highlighted substring is wrapped):
 *     <!--sdoc-c:c1 before="context" after="context"-->opens your file at<!--/sdoc-c:c1-->
 *     <!--sdoc-comment id="c1" author="user" color="#ffd700" at="..." text="..."-->
 *
 *   Block-anchored (no wrappers; comment sits after the block):
 *     Your file never hits the server...
 *     <!--sdoc-comment id="c2" author="user" color="#ffd700" at="..." text="..."-->
 *
 * Attribute values are escaped: `&` `"` newlines and `--` sequences are encoded
 * so they never form an HTML comment terminator.
 *
 * This module is UMD so Node tests can exercise it directly.
 */
(function (exports) {
'use strict';

// ── Attribute encode / decode ───────────────────────────────────────────

function encodeAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    // Break every `-` that's followed by another `-`. Prevents any `--`
    // sequence, which in turn prevents `-->` closing the HTML comment.
    .replace(/-(?=-)/g, '&#45;');
}

var DECODE_MAP = { 'quot': '"', 'amp': '&', '#10': '\n', '#45': '-' };
function decodeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&(quot|amp|#10|#45);/g, function (_, e) {
    return DECODE_MAP[e];
  });
}

// Tokenize `name="value" name="value" ...` into a plain object. Values may
// contain `>` or any char except `"` (since `"` is always encoded as &quot;).
function parseAttrs(s) {
  var out = {};
  var re = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  var m;
  while ((m = re.exec(s)) !== null) {
    out[m[1]] = decodeAttr(m[2]);
  }
  return out;
}

// ── Fenced-code masking ─────────────────────────────────────────────────
// Replaces each fenced code block with an opaque placeholder so sdoc-looking
// strings inside code don't get parsed as real comments.

var FENCE_RE = /(^|\n)(```[\s\S]*?\n```|~~~[\s\S]*?\n~~~)/g;

function maskFences(md) {
  var fences = [];
  var masked = md.replace(FENCE_RE, function (_, lead, block) {
    fences.push(block);
    return lead + '\x00F' + (fences.length - 1) + '\x00';
  });
  return {
    masked: masked,
    restore: function (s) {
      return s.replace(/\x00F(\d+)\x00/g, function (_, i) {
        return fences[parseInt(i, 10)];
      });
    },
  };
}

// ── Parse ───────────────────────────────────────────────────────────────

/**
 * parse(md) -> { comments }
 *
 * For each <!--sdoc-comment ...--> in the body, finds the matching wrapper
 * pair (if any) by id, and returns a list of comment objects:
 *   { id, author, color, at, text, anchor: { type, text?, before?, after? } }
 *
 * Comments without a matching wrapper are treated as block-anchored.
 * Wrappers without a matching metadata block are ignored (malformed).
 */
function parse(md) {
  var out = { comments: [] };
  if (typeof md !== 'string' || !md) return out;

  var masked = maskFences(md).masked;

  // 1. Collect wrapper spans.
  var wrappers = {};
  var wrapRe = /<!--sdoc-c:(c\d+)((?:\s+[a-zA-Z][\w-]*="[^"]*")*)\s*-->([\s\S]*?)<!--\/sdoc-c:\1-->/g;
  var w;
  while ((w = wrapRe.exec(masked)) !== null) {
    var wAttrs = parseAttrs(w[2] || '');
    wrappers[w[1]] = {
      text: w[3],
      before: wAttrs.before || '',
      after: wAttrs.after || '',
    };
  }

  // 2. Collect metadata blocks. Non-greedy match to first `-->`. Since our
  // encoder never emits `-->` inside attribute values, this is safe.
  var metaRe = /<!--sdoc-comment\s+([\s\S]+?)-->/g;
  var m;
  while ((m = metaRe.exec(masked)) !== null) {
    var a = parseAttrs(m[1]);
    if (!a.id) continue;
    var c = {
      id: a.id,
      author: a.author || 'user',
      color: a.color || '#ffd700',
      at: a.at || '',
      text: a.text || '',
      anchor: null,
    };
    if (wrappers[a.id]) {
      c.anchor = {
        type: 'selection',
        text: wrappers[a.id].text,
        before: wrappers[a.id].before,
        after: wrappers[a.id].after,
      };
    } else {
      c.anchor = { type: 'block' };
    }
    out.comments.push(c);
  }

  return out;
}

// ── Serialize helpers ───────────────────────────────────────────────────

function serializeWrapper(id, anchorText, before, after) {
  var attrs = [];
  if (before) attrs.push('before="' + encodeAttr(before) + '"');
  if (after)  attrs.push('after="'  + encodeAttr(after)  + '"');
  var attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  return '<!--sdoc-c:' + id + attrStr + '-->' + anchorText + '<!--/sdoc-c:' + id + '-->';
}

function serializeComment(c) {
  var attrs = [
    'id="'     + encodeAttr(c.id)     + '"',
    'author="' + encodeAttr(c.author) + '"',
    'color="'  + encodeAttr(c.color)  + '"',
    'at="'     + encodeAttr(c.at)     + '"',
    'text="'   + encodeAttr(c.text)   + '"',
  ];
  return '<!--sdoc-comment ' + attrs.join(' ') + '-->';
}

// ── ID allocation ───────────────────────────────────────────────────────

function nextCommentId(md) {
  if (typeof md !== 'string' || !md) return 'c1';
  // Skip ids that live inside fenced code so sample sdoc syntax in a code
  // block doesn't inflate the counter.
  var masked = maskFences(md).masked;
  var max = 0;
  var re = /\bid="c(\d+)"/g;
  var m;
  while ((m = re.exec(masked)) !== null) {
    var n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'c' + (max + 1);
}

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * addSelectionComment(md, {selectedText, before, after}, meta) -> { md, id }
 *
 * Inserts a wrapper around the located selection and a metadata block after
 * the containing markdown block. Locates the selection by matching
 * `before + selectedText + after` in the (fence-masked) body; throws if not
 * found.
 */
function addSelectionComment(md, sel, meta) {
  var fm = maskFences(md);
  var masked = fm.masked;
  // Try context-qualified match first (surest). If that misses (common when
  // source has inline markdown the rendered DOM doesn't: backticks, links,
  // emphasis), fall back to locating just the selected text. In the fallback
  // we refuse ambiguous matches rather than silently anchoring to the first
  // occurrence - better to orphan a comment than attach it to the wrong place.
  var selStart, selEnd;
  var needle = (sel.before || '') + sel.selectedText + (sel.after || '');
  var idx = (sel.before || sel.after) ? masked.indexOf(needle) : -1;
  if (idx !== -1) {
    selStart = idx + (sel.before || '').length;
    selEnd = selStart + sel.selectedText.length;
  } else {
    // Plain-text fallback: locate the selection by literal string match.
    var first = masked.indexOf(sel.selectedText);
    if (first === -1) throw new Error('selection not found in body');
    var second = masked.indexOf(sel.selectedText, first + 1);
    if (second !== -1) throw new Error('selection text appears multiple times; select a longer phrase');
    selStart = first;
    selEnd = first + sel.selectedText.length;
  }
  var id = nextCommentId(md);
  var wrapper = serializeWrapper(id, sel.selectedText, sel.before || '', sel.after || '');
  var withWrap = masked.slice(0, selStart) + wrapper + masked.slice(selEnd);
  // Insert metadata block after the block containing the selection.
  var blockEnd = withWrap.indexOf('\n\n', selStart + wrapper.length);
  if (blockEnd === -1) blockEnd = withWrap.length;
  var metaBlock = '\n\n' + serializeComment({
    id: id,
    author: meta.author || 'user',
    color: meta.color  || '#ffd700',
    at:    meta.at     || new Date().toISOString(),
    text:  meta.text   || '',
  });
  var finalMasked = withWrap.slice(0, blockEnd) + metaBlock + withWrap.slice(blockEnd);
  return { md: fm.restore(finalMasked), id: id };
}

/**
 * addBlockComment(md, {blockText}, meta) -> { md, id }
 *
 * Inserts a metadata block after the first occurrence of blockText's opening.
 * blockText is expected to be a substring that uniquely locates the target
 * block's first characters.
 */
function addBlockComment(md, opts, meta) {
  var fm = maskFences(md);
  var masked = fm.masked;
  var idx = masked.indexOf(opts.blockText);
  if (idx === -1) throw new Error('block not found in body');
  var id = nextCommentId(md);
  var blockEnd = masked.indexOf('\n\n', idx + opts.blockText.length);
  if (blockEnd === -1) blockEnd = masked.length;
  var metaBlock = '\n\n' + serializeComment({
    id: id,
    author: meta.author || 'user',
    color: meta.color  || '#ffd700',
    at:    meta.at     || new Date().toISOString(),
    text:  meta.text   || '',
  });
  var finalMasked = masked.slice(0, blockEnd) + metaBlock + masked.slice(blockEnd);
  return { md: fm.restore(finalMasked), id: id };
}

/**
 * removeComment(md, id) -> md
 *
 * Strips the comment with the given id. If a wrapper pair exists, unwraps it
 * (the highlighted text stays). If a metadata block exists, removes it.
 */
function removeComment(md, id) {
  if (typeof md !== 'string' || !md) return md;
  var fm = maskFences(md);
  var masked = fm.masked;
  var safeId = id.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  var wrapRe = new RegExp(
    '<!--sdoc-c:' + safeId + '(?:\\s+[a-zA-Z][\\w-]*="[^"]*")*\\s*-->' +
    '([\\s\\S]*?)' +
    '<!--/sdoc-c:' + safeId + '-->',
    'g'
  );
  masked = masked.replace(wrapRe, '$1');
  var metaRe = new RegExp(
    '\\n?<!--sdoc-comment\\s+[\\s\\S]*?\\bid="' + safeId + '"[\\s\\S]*?-->',
    'g'
  );
  masked = masked.replace(metaRe, '');
  return fm.restore(masked);
}

// ── Public API ──────────────────────────────────────────────────────────

exports.parse               = parse;
exports.encodeAttr          = encodeAttr;
exports.decodeAttr          = decodeAttr;
exports.parseAttrs          = parseAttrs;
exports.serializeWrapper    = serializeWrapper;
exports.serializeComment    = serializeComment;
exports.nextCommentId       = nextCommentId;
exports.addSelectionComment = addSelectionComment;
exports.addBlockComment     = addBlockComment;
exports.removeComment       = removeComment;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocComments = {}));
