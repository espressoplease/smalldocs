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
 *   Slide-anchored (a ```slide block, optionally a single shape within it):
 *     { id, kind: 'slide', slide, shape?, slide_text?, author, color, at, text }
 *
 * - `quote` is the exact rendered-text phrase to highlight.
 * - `prefix` / `suffix` (0-60 chars) disambiguate when `quote` appears
 *   multiple times in the target block.
 * - `block` is a "tagname:index-among-siblings-of-that-tagname" hint, e.g.
 *   "p:3" = 4th <p> in render order. Per-type indexing is more resilient to
 *   block reordering than a single global ordinal.
 * - `slide` is the 0-based index of the ```slide block in document order.
 *   `shape` (optional) is the 0-based index of a shape within that slide's
 *   resolved DSL - it matches the `data-shape-idx` the renderer stamps on
 *   each shape, and lines up with a shape line the model can read in the
 *   slide source. Absent `shape` = a comment on the whole slide.
 *   `slide_text` is the visible text of the targeted shape (or the slide's
 *   leading text for a whole-slide note), kept as a human/AI-readable hint.
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

var DEFAULT_COLOR = '#ffbb00';
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

// Coerce a value to a non-negative integer index, or null if it isn't one.
// Slide / shape indices arrive from the DOM (data attributes, parsed as
// strings) or hand-edited YAML (kept as strings by our parser), so accept
// both numbers and numeric strings.
function toIndex(v) {
  if (v == null || v === '') return null;
  var n = typeof v === 'number' ? v : parseInt(v, 10);
  return (isFinite(n) && n >= 0) ? Math.floor(n) : null;
}

function normalizeComment(c) {
  if (!isValidId(c.id)) return null;
  var out = {
    id: c.id,
    kind: c.kind || (c.slide != null ? 'slide' : (c.quote ? 'inline' : 'block')),
  };
  // Anchor fields
  if (out.kind === 'inline') {
    out.quote = c.quote || '';
    if (c.prefix) out.prefix = c.prefix;
    if (c.suffix) out.suffix = c.suffix;
  }
  if (out.kind === 'slide') {
    // A slide comment without a resolvable slide index is meaningless;
    // default to slide 0 rather than dropping the note entirely.
    out.slide = toIndex(c.slide) == null ? 0 : toIndex(c.slide);
    // `shapes` (array) is the multi-element form; a single index collapses to
    // `shape` so single-element notes keep their existing on-disk shape. A
    // whole-slide note carries neither.
    if (Array.isArray(c.shapes)) {
      var arr = c.shapes.map(toIndex).filter(function (n) { return n != null; });
      if (arr.length === 1) out.shape = arr[0];
      else if (arr.length > 1) out.shapes = arr;
    } else {
      var shp = toIndex(c.shape);
      if (shp != null) out.shape = shp;
    }
    if (c.slide_text) out.slide_text = c.slide_text;
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

// anchor: { quote, prefix?, suffix?, block? }
// noteMeta: { author?, color?, at?, text? }
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

// anchor: { block, block_text? } where block is "tag:n" (e.g. "p:3").
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

// anchor: { slide, shape?, slide_text? } where slide is a 0-based slide
// index and shape (optional) is a 0-based shape index within that slide.
function addSlideComment(meta, anchor, noteMeta) {
  if (!anchor || toIndex(anchor.slide) == null) {
    throw new Error('addSlideComment requires a slide index');
  }
  var id = nextId(meta);
  var c = normalizeComment({
    id: id,
    kind: 'slide',
    slide: anchor.slide,
    shape: anchor.shape,
    shapes: anchor.shapes,
    slide_text: anchor.slide_text || '',
    author: (noteMeta || {}).author,
    color: (noteMeta || {}).color,
    at: (noteMeta || {}).at,
    text: (noteMeta || {}).text,
  });
  var list = getComments(meta);
  list.push(c);
  return { meta: setComments(meta, list), id: id };
}

function removeComment(meta, id) {
  var list = getComments(meta).filter(function (c) { return c.id !== id; });
  return setComments(meta, list);
}

// Returns the input meta unchanged if no comment matches `id`, so
// callers can compare reference-equality to detect a no-op.
function updateComment(meta, id, patch) {
  var changed = false;
  var list = getComments(meta).map(function (c) {
    if (c.id !== id) return c;
    changed = true;
    return normalizeComment(Object.assign({}, c, patch || {}));
  });
  return changed ? setComments(meta, list) : meta;
}

// ── Section slicing ─────────────────────────────────────────────────────

// Walk lines and collect every top-level ATX heading (`#` ... `######`)
// that sits OUTSIDE a fenced code block. Used by per-section copy to find
// the section boundaries in the raw source.
//
// Why: a naive `^(#{1,N})\s+...` regex pulls in `##` lines that live inside
// a ` ```markdown ` fence, which would silently truncate the copy at the
// first inner heading. Tracking fence state line-by-line is enough.
//
// Fence rules (CommonMark-shaped, just enough for this use case):
//   - opener:  ^[ ]{0,3}(`{3,}|~{3,}).*$
//   - closer:  same fence char, count >= opener's count, only whitespace
//              after the closing run
function findTopHeadings(md) {
  if (typeof md !== 'string') return [];
  var out = [];
  var lines = md.split('\n');
  var fence = null; // null when outside; e.g. '```' or '~~~~' when inside
  var pos = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.replace(/^[ \t]{0,3}/, '');
    var fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0]
          && fenceMatch[1].length >= fence.length
          && /^\s*$/.test(trimmed.slice(fenceMatch[1].length))) {
        fence = null;
      }
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else {
      var h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (h) {
        out.push({ index: pos, level: h[1].length, text: h[2].trim() });
      }
    }
    pos += line.length + 1; // +1 for the consumed '\n'
  }
  return out;
}

// Slice `md` to the substring covered by the section whose ATX heading
// matches (level, headingText). Section ends at the next heading of equal
// or higher rank, ignoring any headings inside fenced code blocks. Returns
// null if the heading isn't found.
function findSectionRange(md, level, headingText) {
  var headings = findTopHeadings(md);
  var startIdx = -1, startI = -1;
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    if (h.level === level && h.text === headingText) {
      startIdx = h.index;
      startI = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  var endIdx = md.length;
  for (var j = startI + 1; j < headings.length; j++) {
    if (headings[j].level <= level) { endIdx = headings[j].index; break; }
  }
  return { startIdx: startIdx, endIdx: endIdx, body: md.slice(startIdx, endIdx) };
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
 * Matching strategy, in priority order:
 *   1. `c.occurrence` (number, 0-indexed) — the Nth occurrence of `quote`
 *      in `body`. Caller computes this from the rendered DOM at copy time
 *      so we always pick the same occurrence the user actually anchored
 *      to, even when source markdown differs from rendered text (bold,
 *      links, code formatting, etc.).
 *   2. `prefix + quote + suffix` matches uniquely → land there.
 *   3. `quote` alone → first occurrence (best-effort fallback).
 *
 * Replacement positions are computed against the original body in one
 * pass, then applied in descending order. This means earlier comments'
 * positions are never shifted by later replacements, AND occurrence
 * counts always run against the unedited source text — so two comments
 * targeting different occurrences of the same quote can both land
 * correctly.
 */
function serializeFootnotes(meta, body) {
  if (typeof body !== 'string') return body;
  var comments = getComments(meta);
  if (!comments.length) return body;
  var inlineComments = comments.filter(function (c) { return c.kind === 'inline' && c.quote; });
  var hits = [];
  inlineComments.forEach(function (c) {
    var pos = -1;
    if (typeof c.occurrence === 'number' && c.occurrence >= 0) {
      pos = nthIndexOf(body, c.quote, c.occurrence);
    }
    if (pos === -1) {
      var needle = (c.prefix || '') + c.quote + (c.suffix || '');
      var idx = body.indexOf(needle);
      if (idx !== -1) pos = idx + (c.prefix || '').length;
    }
    if (pos === -1) pos = body.indexOf(c.quote);
    if (pos !== -1) {
      hits.push({ start: pos, end: pos + c.quote.length, id: c.id, quote: c.quote });
    }
  });
  hits.sort(function (a, b) { return b.start - a.start; });
  // Skip a hit whose range overlaps with one we've already replaced (we
  // walk right-to-left, so "already replaced" means a hit further right).
  // Without this guard, slice/replace math would corrupt the body when a
  // later comment's range falls inside an earlier comment's range. The
  // dropped hit still gets a footnote definition appended below — only
  // its inline anchor is omitted.
  var out = body;
  var minRightEdge = body.length + 1;
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    if (h.end > minRightEdge) continue;
    var replacement = '[' + h.quote + '][^' + h.id + ']';
    out = out.slice(0, h.start) + replacement + out.slice(h.end);
    minRightEdge = h.start;
  }
  var footnotes = [];
  comments.forEach(function (c) {
    var label = sanitizeText(c.author || 'user');
    if (c.resolved) label += ' [resolved]';
    label += ' - ' + sanitizeText(c.text || '');
    if (c.kind === 'block' && c.block) {
      var blockTag = c.block;
      if (c.block_text) blockTag += ' "' + sanitizeText(c.block_text) + '..."';
      label += ' (block ' + blockTag + ')';
    }
    if (c.kind === 'slide') {
      // Slides don't anchor into body text (their source is the fenced DSL,
      // which we never rewrite), so the location rides entirely in the
      // footnote label. Slide number is 1-based to match what the user sees
      // in the present-mode counter and the slide badge. When the note
      // targets one shape, carry its index (matches `data-shape-idx` and the
      // shape's line in the slide source) plus the shape's visible text.
      var slideTag = 'slide ' + ((typeof c.slide === 'number' ? c.slide : 0) + 1);
      if (Array.isArray(c.shapes) && c.shapes.length) {
        // Multi-element note: list the indices joined with '+', then one
        // quoted hint covering all of them (the UI joins the labels).
        slideTag += ', elements ' + c.shapes.join('+');
        if (c.slide_text) slideTag += ' "' + sanitizeText(c.slide_text) + '"';
      } else if (typeof c.shape === 'number') {
        slideTag += ', element ' + c.shape;
        if (c.slide_text) slideTag += ' "' + sanitizeText(c.slide_text) + '"';
      } else if (c.slide_text) {
        slideTag += ' "' + sanitizeText(c.slide_text) + '"';
      }
      label += ' (' + slideTag + ')';
    }
    footnotes.push('[^' + c.id + ']: ' + label);
  });
  return out.replace(/\n*$/, '') + '\n\n' + footnotes.join('\n') + '\n';
}

// Index of the n-th (0-indexed) occurrence of `needle` in `hay`, or -1.
function nthIndexOf(hay, needle, n) {
  if (!needle) return -1;
  var pos = -1, from = 0;
  for (var i = 0; i <= n; i++) {
    pos = hay.indexOf(needle, from);
    if (pos === -1) return -1;
    from = pos + needle.length;
  }
  return pos;
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
    // Trailing "(slide N[, element M][ "text"])" hint - the inverse of the
    // slide label serializeFootnotes emits. Slide number is 1-based on disk;
    // store it 0-based to match the in-memory anchor.
    var sTag = (out.text || '').match(/\s*\(slide\s+(\d+)(?:,\s*elements?\s+([\d+]+))?(?:\s+"([^"]*)")?\)\s*$/);
    if (sTag) {
      out.slide = parseInt(sTag[1], 10) - 1;
      if (sTag[2] != null) {
        var idxs = sTag[2].split('+').map(function (x) { return parseInt(x, 10); })
          .filter(function (n) { return !isNaN(n); });
        if (idxs.length > 1) out.shapes = idxs;
        else if (idxs.length === 1) out.shape = idxs[0];
      }
      if (sTag[3]) out.slide_text = sTag[3];
      out.text = out.text.replace(/\s*\(slide\s+\d+(?:,\s*elements?\s+[\d+]+)?(?:\s+"[^"]*")?\)\s*$/, '');
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
    var c3;
    if (typeof d3.slide === 'number') {
      // Slide notes carry a "(slide N ...)" hint and no body marker, so they
      // land here as orphan definitions. Rebuild the slide anchor.
      c3 = { id: id, kind: 'slide', slide: d3.slide, text: d3.text };
      if (Array.isArray(d3.shapes)) c3.shapes = d3.shapes;
      else if (typeof d3.shape === 'number') c3.shape = d3.shape;
      if (d3.slide_text) c3.slide_text = d3.slide_text;
    } else {
      c3 = { id: id, kind: 'block', text: d3.text };
      if (d3.block) c3.block = d3.block;
    }
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
exports.addSlideComment     = addSlideComment;
exports.removeComment       = removeComment;
exports.updateComment       = updateComment;
exports.serializeFootnotes  = serializeFootnotes;
exports.parseFootnotes      = parseFootnotes;
exports.serializeClean      = serializeClean;
exports.findTopHeadings     = findTopHeadings;
exports.findSectionRange    = findSectionRange;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocComments = {}));
