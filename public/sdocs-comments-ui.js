/**
 * sdocs-comments-ui.js - browser-only integration for comment mode.
 *
 * Comments live in SDocs.currentMeta.comments as a list of plain objects.
 * All mutations go through SDocComments.* which take/return `meta`, then
 * we set SDocs.currentMeta and call syncAll('comment') to re-render.
 *
 * On render, for each comment we:
 *   - For inline: find the quote in the rendered DOM via a three-tier
 *     fallback (block-scoped → global prefix+quote+suffix → quote-only)
 *     and wrap the located range in a <span class="sdoc-anchor">.
 *   - For block: find the target block via its per-type index and attach
 *     a card inside it.
 * Comments whose anchor can't be resolved render as orphans (card at the
 * end of the document with an "anchor lost" badge).
 */
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};
var SDC = window.SDocComments;

var PREFS_KEY = 'sdocs_comment_prefs';
var CONTEXT_LEN = 40; // chars of before/after captured for disambiguation

var focusedId = null;
var selectionPopoverEl = null;
var composerEl = null;

// ── Prefs ───────────────────────────────────────────────────────────────

function readPrefs() {
  try {
    var raw = localStorage.getItem(PREFS_KEY);
    var v = raw ? JSON.parse(raw) : {};
    return { author: v.author || 'user', color: v.color || '#ffd700' };
  } catch (_) { return { author: 'user', color: '#ffd700' }; }
}

function writePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) {}
}

// ── DOM helpers ─────────────────────────────────────────────────────────

function strip() {
  if (!S.renderedEl) return;
  // Unwrap highlight spans
  S.renderedEl.querySelectorAll('span.sdoc-anchor').forEach(function (span) {
    var parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
  // Remove injected cards + gutter buttons + heading-copy-with-comments buttons
  S.renderedEl.querySelectorAll('.sdoc-card, .sdoc-gutter-add, .sdoc-head-copy-c')
    .forEach(function (el) { el.remove(); });
  // Unwrap block-hosts (gutter button already removed above)
  S.renderedEl.querySelectorAll('.sdoc-block-host').forEach(function (host) {
    var parent = host.parentNode;
    while (host.firstChild) parent.insertBefore(host.firstChild, host);
    parent.removeChild(host);
  });
}

var TOP_BLOCK_SEL = 'p, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, table, .sdoc-chart';

function nearestTopBlock(node) {
  var el = node.nodeType === 1 ? node : node.parentNode;
  while (el && el !== S.renderedEl && el !== document.body) {
    if (el.matches && el.matches(TOP_BLOCK_SEL)) return el;
    el = el.parentNode;
  }
  return null;
}

// Walk the rendered tree and assign each top-level content block a stable
// (tagname, index-among-siblings-of-that-tagname) id. Nested blocks (a <p>
// inside a <blockquote>) are skipped — the outer block is the anchor.
function listTopBlocks(root) {
  if (!root) return { blocks: [], byType: {} };
  var blocks = [];
  var byType = {};
  root.querySelectorAll(TOP_BLOCK_SEL).forEach(function (block) {
    var ancestor = block.parentElement;
    while (ancestor && ancestor !== root) {
      if (ancestor.matches && ancestor.matches(TOP_BLOCK_SEL)) return;
      ancestor = ancestor.parentElement;
    }
    var t = block.classList && block.classList.contains('sdoc-chart')
      ? 'chart'
      : block.tagName.toLowerCase();
    if (!byType[t]) byType[t] = [];
    byType[t].push(block);
    blocks.push({ el: block, type: t, index: byType[t].length - 1 });
  });
  return { blocks: blocks, byType: byType };
}

function computeBlockId(block, root) {
  if (!block || !root) return '';
  var idx = listTopBlocks(root);
  var t = block.classList && block.classList.contains('sdoc-chart')
    ? 'chart'
    : block.tagName.toLowerCase();
  var list = idx.byType[t] || [];
  var pos = list.indexOf(block);
  return pos === -1 ? '' : t + ':' + pos;
}

function findBlockById(id, root) {
  if (!id || !root) return null;
  var parts = id.split(':');
  var t = parts[0];
  var n = parseInt(parts[1], 10);
  if (isNaN(n)) return null;
  var idx = listTopBlocks(root);
  var list = idx.byType[t] || [];
  return list[n] || null;
}

// Given a container and a cumulative character offset into container.textContent,
// build a DOM Range [startOffset, endOffset).
function rangeFromCharOffsets(container, startOffset, endOffset) {
  var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  var pos = 0, startNode = null, startInNode = 0, endNode = null, endInNode = 0;
  var n;
  while ((n = walker.nextNode()) !== null) {
    var len = n.nodeValue.length;
    if (startNode === null && pos + len >= startOffset) {
      startNode = n;
      startInNode = startOffset - pos;
    }
    if (endNode === null && pos + len >= endOffset) {
      endNode = n;
      endInNode = endOffset - pos;
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  var range = document.createRange();
  try {
    range.setStart(startNode, startInNode);
    range.setEnd(endNode, endInNode);
  } catch (_) { return null; }
  return range;
}

// Locate (prefix + quote + suffix) in container.textContent and return a
// Range covering just the `quote` portion. Returns null if not found OR
// if the resulting range crosses element boundaries (the caller's job
// is to try a smaller leaf in that case so the wrap stays inside a
// single element).
function findAnchorRange(container, prefix, quote, suffix) {
  if (!container || !quote) return null;
  var text = container.textContent || '';
  var needle = (prefix || '') + quote + (suffix || '');
  var idx = text.indexOf(needle);
  if (idx === -1) return null;
  var start = idx + (prefix || '').length;
  var end = start + quote.length;
  var range = rangeFromCharOffsets(container, start, end);
  if (!range) return null;
  return range;
}

// "Anchor leaves" = elements where a quote lives entirely within the
// element's own text tree, not across siblings of a container.
// Structural containers (ul, ol, table, blockquote with block children)
// are NOT leaves; their descendants are.
var ANCHOR_LEAF_SEL = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre';

function listAnchorLeaves(root) {
  if (!root) return [];
  var out = [];
  root.querySelectorAll(ANCHOR_LEAF_SEL).forEach(function (el) {
    // Exclude an element whose children include another LEAF (e.g. a
    // <blockquote> wrapping a <p> — the inner <p> is the leaf).
    var innerIsLeaf = false;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].matches && el.children[i].matches(ANCHOR_LEAF_SEL)) {
        innerIsLeaf = true;
        break;
      }
    }
    if (!innerIsLeaf) out.push(el);
  });
  return out;
}

// Three-tier fallback:
//   Tier 1: block-scoped via c.block hint (try block itself, then its leaves)
//   Tier 2: walk all anchor-leaves, prefer prefix+quote+suffix match
//   Tier 3: walk all anchor-leaves, quote-only (last resort)
// Searching per-leaf (rather than per-top-block) avoids ranges that
// cross sibling elements (e.g. across <li>s in a <ul>).
function resolveAnchor(c, root) {
  if (c.kind !== 'inline' || !c.quote) return null;
  // Tier 1: named block hint
  if (c.block) {
    var hint = findBlockById(c.block, root);
    if (hint) {
      var r = findAnchorRange(hint, c.prefix, c.quote, c.suffix);
      if (r) return { range: r, tier: 1 };
      // Block was a container (ul/table); drop to its leaves.
      var hintLeaves = listAnchorLeaves(hint);
      for (var k = 0; k < hintLeaves.length; k++) {
        var rh = findAnchorRange(hintLeaves[k], c.prefix, c.quote, c.suffix);
        if (rh) return { range: rh, tier: 1 };
      }
    }
  }
  var leaves = listAnchorLeaves(root);
  // Tier 2
  for (var i = 0; i < leaves.length; i++) {
    var r2 = findAnchorRange(leaves[i], c.prefix, c.quote, c.suffix);
    if (r2) return { range: r2, tier: 2 };
  }
  // Tier 3
  if (c.prefix || c.suffix) {
    for (var j = 0; j < leaves.length; j++) {
      var r3 = findAnchorRange(leaves[j], '', c.quote, '');
      if (r3) return { range: r3, tier: 3 };
    }
  }
  return null;
}

// ── Relative time ────────────────────────────────────────────────────────

function formatRelativeTime(iso) {
  if (!iso) return '';
  var t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  var diff = Math.max(0, Date.now() - t);
  var m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + ' min ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' hr ago';
  var d = Math.floor(h / 24);
  if (d < 30) return d + ' d ago';
  var mo = Math.floor(d / 30);
  if (mo < 12) return mo + ' mo ago';
  return Math.floor(d / 365) + ' y ago';
}

// ── Anchor span ─────────────────────────────────────────────────────────

function wrapRange(range, id, color) {
  var span = document.createElement('span');
  span.className = 'sdoc-anchor';
  span.setAttribute('data-c', id);
  if (color) span.style.background = color;
  try {
    range.surroundContents(span);
  } catch (_) {
    try {
      var frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    } catch (__) { return null; }
  }
  return span;
}

// ── Cards ───────────────────────────────────────────────────────────────

var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var X_SVG    = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function cardEl(c, orphaned) {
  var card = document.createElement('span');
  card.className = 'sdoc-card' + (orphaned ? ' sdoc-card-orphaned' : '');
  card.setAttribute('data-c', c.id);
  card.style.setProperty('--sdoc-card-color', c.color || '#ffd700');

  var who = document.createElement('span');
  who.className = 'sdoc-card-author';
  who.textContent = c.author || 'user';
  who.title = (c.author || 'user') + (c.at ? ' · ' + formatRelativeTime(c.at) : '');
  card.appendChild(who);

  var body = document.createElement('span');
  body.className = 'sdoc-card-body';
  body.textContent = ': ' + (c.text || '');
  card.appendChild(body);

  if (orphaned) {
    var badge = document.createElement('span');
    badge.className = 'sdoc-card-orphan-badge';
    badge.textContent = 'anchor lost';
    card.appendChild(badge);
  }

  var del = document.createElement('button');
  del.className = 'sdoc-card-delete';
  del.setAttribute('aria-label', 'Delete comment');
  del.title = 'Delete';
  del.textContent = '×';
  del.addEventListener('click', function (e) {
    e.stopPropagation();
    deleteComment(c.id);
  });
  card.appendChild(del);

  card.addEventListener('click', function (e) {
    if (card.classList.contains('sdoc-card-editing')) return;
    focusComment(c.id);
    enterEditMode(card, c);
  });

  return card;
}

function enterEditMode(card, c) {
  card.classList.add('sdoc-card-editing');
  var origHTML = card.innerHTML;
  card.innerHTML = '';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'sdoc-card-edit-input';
  input.value = c.text || '';

  var tick = document.createElement('button');
  tick.className = 'sdoc-card-edit-save';
  tick.setAttribute('aria-label', 'Save edit');
  tick.title = 'Save';
  tick.innerHTML = TICK_SVG;

  var x = document.createElement('button');
  x.className = 'sdoc-card-edit-cancel';
  x.setAttribute('aria-label', 'Cancel edit');
  x.title = 'Cancel';
  x.innerHTML = X_SVG;

  function restore() {
    card.classList.remove('sdoc-card-editing');
    card.innerHTML = origHTML;
    rebindCard(card, c);
  }

  function save() {
    var newText = input.value.trim();
    if (!newText) { input.focus(); return; }
    if (newText === (c.text || '')) { restore(); return; }
    S.currentMeta = SDC.updateComment(S.currentMeta || {}, c.id, { text: newText });
    if (S.syncAll) S.syncAll('comment');
  }

  tick.addEventListener('click', function (e) { e.stopPropagation(); save(); });
  x.addEventListener('click', function (e) { e.stopPropagation(); restore(); });
  input.addEventListener('click', function (e) { e.stopPropagation(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); restore(); }
  });

  card.appendChild(input);
  card.appendChild(tick);
  card.appendChild(x);
  setTimeout(function () { input.focus(); input.select(); }, 0);
}

function rebindCard(card, c) {
  var del = card.querySelector('.sdoc-card-delete');
  if (del) del.addEventListener('click', function (e) {
    e.stopPropagation();
    deleteComment(c.id);
  });
}

// ── Render anchors + cards ──────────────────────────────────────────────

function renderComment(c) {
  if (c.kind === 'inline') {
    var resolved = resolveAnchor(c, S.renderedEl);
    if (resolved) {
      var span = wrapRange(resolved.range, c.id, c.color);
      if (span) {
        var card = cardEl(c, false);
        span.parentNode.insertBefore(card, span.nextSibling);
        return false;
      }
    }
    // Fallback: orphan
    var orphanCard = cardEl(c, true);
    S.renderedEl.appendChild(orphanCard);
    return true;
  }
  // kind === 'block'
  var block = findBlockById(c.block, S.renderedEl);
  if (block) {
    var bCard = cardEl(c, false);
    block.appendChild(bCard);
    return false;
  }
  var o = cardEl(c, true);
  S.renderedEl.appendChild(o);
  return true;
}

// ── Gutter buttons ──────────────────────────────────────────────────────

function makeGutterBtn(targetBlock) {
  var btn = document.createElement('button');
  btn.className = 'sdoc-gutter-add';
  btn.setAttribute('aria-label', 'Add comment on this block');
  btn.title = 'Add comment';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    openBlockComposer(targetBlock);
  });
  return btn;
}

function injectGutterButtons() {
  S.renderedEl.querySelectorAll(TOP_BLOCK_SEL).forEach(function (block) {
    if (block.closest('.sdoc-card')) return;
    if (block.parentNode && block.parentNode.classList &&
        block.parentNode.classList.contains('sdoc-block-host')) return;
    var ancestor = block.parentElement;
    while (ancestor && ancestor !== S.renderedEl) {
      if (ancestor.matches && ancestor.matches(TOP_BLOCK_SEL)) return;
      ancestor = ancestor.parentElement;
    }
    var host = document.createElement('div');
    host.className = 'sdoc-block-host';
    block.parentNode.insertBefore(host, block);
    host.appendChild(block);
    host.appendChild(makeGutterBtn(block));
  });
}

// ── Selection popover ───────────────────────────────────────────────────

function ensureSelectionPopover() {
  if (selectionPopoverEl) return selectionPopoverEl;
  selectionPopoverEl = document.createElement('button');
  selectionPopoverEl.className = 'sdoc-selection-add';
  selectionPopoverEl.setAttribute('aria-label', 'Comment on selection');
  selectionPopoverEl.title = 'Comment on selection';
  selectionPopoverEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
  selectionPopoverEl.style.display = 'none';
  document.body.appendChild(selectionPopoverEl);
  selectionPopoverEl.addEventListener('mousedown', function (e) {
    e.preventDefault(); // keep the selection alive
  });
  selectionPopoverEl.addEventListener('click', function (e) {
    e.stopPropagation();
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    openSelectionComposerFromSelection(sel.getRangeAt(0));
    hideSelectionPopover();
  });
  return selectionPopoverEl;
}

function hideSelectionPopover() {
  if (selectionPopoverEl) selectionPopoverEl.style.display = 'none';
}

function handleSelectionChange() {
  if (!document.body.classList.contains('comment-mode')) return hideSelectionPopover();
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideSelectionPopover();
  var range = sel.getRangeAt(0);
  if (range.collapsed) return hideSelectionPopover();

  if (!S.renderedEl || !S.renderedEl.contains(range.commonAncestorContainer)) {
    return hideSelectionPopover();
  }

  // Reject multi-block selections. This guard is what prevents a user from
  // commenting across paragraphs, which in the sidecar model would also be
  // meaningless (the quote wouldn't live in a single block).
  var startBlock = nearestTopBlock(range.startContainer);
  var endBlock   = nearestTopBlock(range.endContainer);
  if (!startBlock || startBlock !== endBlock) return hideSelectionPopover();

  // Reject selections inside .katex (rendered text differs from source).
  // Inline <code> IS allowed now — the sidecar model anchors by the rendered
  // text, which is identical to what the user sees.
  var anc = range.commonAncestorContainer;
  var el = anc.nodeType === 1 ? anc : anc.parentNode;
  while (el && el !== S.renderedEl) {
    if (el.classList && el.classList.contains('katex')) return hideSelectionPopover();
    if (el.tagName === 'PRE' || (el.tagName === 'CODE' && el.parentNode && el.parentNode.tagName === 'PRE')) {
      return hideSelectionPopover();
    }
    el = el.parentNode;
  }

  var pop = ensureSelectionPopover();
  var rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return hideSelectionPopover();
  pop.style.display = 'block';
  pop.style.position = 'fixed';
  pop.style.top  = (rect.top - 34) + 'px';
  pop.style.left = (rect.right - 14) + 'px';
}

// ── Composer ────────────────────────────────────────────────────────────

function hideComposer() {
  if (composerEl && composerEl.parentNode) {
    composerEl.parentNode.removeChild(composerEl);
  }
  composerEl = null;
}

function makeComposer(onSave, onCancel, initialText) {
  hideComposer();
  var el = document.createElement('div');
  el.className = 'sdoc-composer';
  var prefs = readPrefs();
  el.style.setProperty('--sdoc-card-color', prefs.color);
  var ta = document.createElement('textarea');
  ta.placeholder = 'Add a comment...';
  ta.rows = 3;
  if (initialText) ta.value = initialText;
  el.appendChild(ta);
  var actions = document.createElement('div');
  actions.className = 'sdoc-composer-actions';
  var save = document.createElement('button');
  save.className = 'sdoc-composer-save';
  save.setAttribute('aria-label', 'Save comment');
  save.title = 'Save (Cmd/Ctrl + Enter)';
  save.innerHTML = TICK_SVG;
  var cancel = document.createElement('button');
  cancel.className = 'sdoc-composer-cancel';
  cancel.setAttribute('aria-label', 'Cancel');
  cancel.title = 'Cancel (Esc)';
  cancel.innerHTML = X_SVG;
  function doCancel() {
    hideComposer();
    if (onCancel) onCancel();
  }
  save.addEventListener('click', function () {
    var text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    onSave(text);
    hideComposer();
  });
  cancel.addEventListener('click', doCancel);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { doCancel(); }
    if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { save.click(); }
  });
  actions.appendChild(save);
  actions.appendChild(cancel);
  el.appendChild(actions);
  composerEl = el;
  setTimeout(function () { ta.focus(); }, 0);
  return el;
}

function openBlockComposer(block) {
  var prefs = readPrefs();
  var blockId = computeBlockId(block, S.renderedEl);
  if (!blockId) return;
  block.classList.add('sdoc-pending-block');
  function clearPending() { block.classList.remove('sdoc-pending-block'); }
  var composer = makeComposer(function (text) {
    clearPending();
    try {
      var res = SDC.addBlockComment(S.currentMeta || {}, { block: blockId }, {
        author: prefs.author, color: prefs.color,
        at: new Date().toISOString(), text: text,
      });
      S.currentMeta = res.meta;
      if (S.syncAll) S.syncAll('comment');
      setTimeout(function () { focusComment(res.id); }, 30);
    } catch (e) {
      console.warn('addBlockComment failed:', e && e.message);
    }
  }, clearPending);
  block.parentNode.insertBefore(composer, block.nextSibling);
}

// Capture prefix/suffix context within the containing block's plain text.
function captureContext(range, block) {
  if (!block) return { prefix: '', suffix: '' };
  var preRange = document.createRange();
  preRange.selectNodeContents(block);
  preRange.setEnd(range.startContainer, range.startOffset);
  var beforeAll = preRange.toString();
  preRange.setStart(range.endContainer, range.endOffset);
  preRange.setEnd(block, block.childNodes.length);
  var afterAll = preRange.toString();
  return {
    prefix: beforeAll.slice(Math.max(0, beforeAll.length - CONTEXT_LEN)),
    suffix: afterAll.slice(0, CONTEXT_LEN),
  };
}

function openSelectionComposerFromSelection(range) {
  var prefs = readPrefs();
  var quote = range.toString();
  if (!quote) return;
  var block = nearestTopBlock(range.startContainer);
  if (!block) return;
  var ctx = captureContext(range, block);
  var blockId = computeBlockId(block, S.renderedEl);

  // Visual preview of the pending anchor while the composer is open.
  var pendingSpan = document.createElement('span');
  pendingSpan.className = 'sdoc-pending-anchor';
  try {
    range.surroundContents(pendingSpan);
  } catch (_) {
    try {
      var frag = range.extractContents();
      pendingSpan.appendChild(frag);
      range.insertNode(pendingSpan);
    } catch (__) { pendingSpan = null; }
  }
  function clearPending() {
    if (pendingSpan && pendingSpan.parentNode) {
      var parent = pendingSpan.parentNode;
      while (pendingSpan.firstChild) parent.insertBefore(pendingSpan.firstChild, pendingSpan);
      parent.removeChild(pendingSpan);
      parent.normalize();
    }
    pendingSpan = null;
  }

  var composer = makeComposer(function (text) {
    clearPending();
    try {
      var res = SDC.addSelectionComment(S.currentMeta || {}, {
        quote: quote, prefix: ctx.prefix, suffix: ctx.suffix, block: blockId,
      }, {
        author: prefs.author, color: prefs.color,
        at: new Date().toISOString(), text: text,
      });
      S.currentMeta = res.meta;
      if (S.syncAll) S.syncAll('comment');
      setTimeout(function () { focusComment(res.id); }, 30);
    } catch (e) {
      console.warn('addSelectionComment failed:', e && e.message);
    }
  }, clearPending);
  block.parentNode.insertBefore(composer, block.nextSibling);
  var sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

// ── Delete ──────────────────────────────────────────────────────────────

function deleteComment(id) {
  S.currentMeta = SDC.removeComment(S.currentMeta || {}, id);
  if (S.syncAll) S.syncAll('comment');
}

// ── Toolbar paint ───────────────────────────────────────────────────────

function paintToolbar() {
  var tb = document.getElementById('_sd_comment-toolbar');
  if (!tb) return;
  var comments = SDC.getComments(S.currentMeta);
  var total = comments.length;
  var countEl = document.getElementById('_sd_comment-count');
  var prevBtn = document.getElementById('_sd_comment-prev');
  var nextBtn = document.getElementById('_sd_comment-next');
  var copyBtn = document.getElementById('_sd_comment-copy-doc');
  var orphanEl = document.getElementById('_sd_comment-orphan');

  if (total === 0) {
    if (countEl) countEl.textContent = '0 comments';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
  } else {
    var ids = comments.map(function (c) { return c.id; });
    var idx = Math.max(0, ids.indexOf(focusedId));
    if (focusedId == null) idx = 0;
    if (countEl) countEl.textContent = (idx + 1) + ' / ' + total;
    if (prevBtn) prevBtn.disabled = total <= 1;
    if (nextBtn) nextBtn.disabled = total <= 1;
    if (copyBtn) copyBtn.disabled = false;
  }

  var orphanBadgeCount = S.renderedEl ? S.renderedEl.querySelectorAll('.sdoc-card-orphaned').length : 0;
  if (orphanEl) {
    if (orphanBadgeCount > 0) {
      orphanEl.hidden = false;
      orphanEl.textContent = orphanBadgeCount + ' orphaned';
    } else {
      orphanEl.hidden = true;
    }
  }
}

function navigateRelative(delta) {
  var comments = SDC.getComments(S.currentMeta);
  if (!comments.length) return;
  var ids = comments.map(function (c) { return c.id; });
  var idx = Math.max(0, ids.indexOf(focusedId));
  if (focusedId == null) idx = delta > 0 ? -1 : 0;
  var next = (idx + delta + ids.length) % ids.length;
  focusComment(ids[next]);
}

function focusComment(id) {
  focusedId = id;
  var card = S.renderedEl.querySelector('.sdoc-card[data-c="' + id + '"]');
  if (card) {
    S.renderedEl.querySelectorAll('.sdoc-card-focus').forEach(function (el) {
      el.classList.remove('sdoc-card-focus');
    });
    card.classList.add('sdoc-card-focus');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  paintToolbar();
}

// ── Heading "copy with comments" companion button ───────────────────────

function buildHeadCopyCommentsBtn(heading) {
  var btn = document.createElement('button');
  btn.className = 'sdoc-copy-with-c sdoc-head-copy-c';
  btn.setAttribute('aria-label', 'Copy section with comments');
  btn.title = 'Copy section with comments (Shift+Click for whole document)';
  btn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
    '<span class="sdoc-copy-with-c-label">with comments</span>';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    // On heading companion: default = section in footnote format.
    // Alt = section as SDocs round-trip.
    // Shift = WHOLE document (backward-compat with previous wiring).
    copyWithComments(heading, e.shiftKey, { roundTrip: e.altKey });
  });
  return btn;
}

function paintHeadingCopyWithComments(comments) {
  if (!S.renderedEl) return;
  S.renderedEl.querySelectorAll('.sdoc-head-copy-c').forEach(function (b) { b.remove(); });
  if (!comments.length) return;
  S.renderedEl.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (h) {
    if (sectionContainsComment(h)) h.appendChild(buildHeadCopyCommentsBtn(h));
  });
}

function sectionContainsComment(heading) {
  var level = parseInt(heading.tagName[1], 10);
  var node = heading.nextElementSibling;
  while (node) {
    if (/^H[1-6]$/.test(node.tagName)) {
      var nextLevel = parseInt(node.tagName[1], 10);
      if (nextLevel <= level) break;
    }
    if (node.classList && node.classList.contains('sdoc-card')) return true;
    if (node.querySelector && node.querySelector('.sdoc-card, span.sdoc-anchor')) return true;
    node = node.nextElementSibling;
  }
  return false;
}

// ── Copy with comments ──────────────────────────────────────────────────

// Slice the body to the substring that belongs to headingEl's section.
// Returns { meta, body } where meta.comments is filtered to only those
// anchored to blocks within that section. null if the heading can't be found.
function extractSectionSource(headingEl) {
  if (!headingEl) return null;
  var level = parseInt(headingEl.tagName[1], 10);
  var headingText = (headingEl.textContent || '').replace(/\s+$/, '').trim();
  var md = S.currentBody || '';
  var headingRe = new RegExp('^(#{1,' + level + '})\\s+(.+)$', 'gm');
  var m, startIdx = -1;
  while ((m = headingRe.exec(md)) !== null) {
    if (m[2].trim() === headingText && m[1].length === level) {
      startIdx = m.index;
      break;
    }
  }
  if (startIdx === -1) return null;
  var afterRe = new RegExp('\\n(#{1,' + level + '})\\s+', 'g');
  afterRe.lastIndex = startIdx + 1;
  var a = afterRe.exec(md);
  var endIdx = a ? a.index : md.length;
  var sectionBody = md.slice(startIdx, endIdx).trim() + '\n';
  // Filter comments: include only those whose anchor text appears in this slice.
  var all = SDC.getComments(S.currentMeta);
  var inSection = all.filter(function (c) {
    if (c.kind === 'inline' && c.quote) {
      return sectionBody.indexOf(c.quote) !== -1;
    }
    return false;
  });
  return { meta: { comments: inSection }, body: sectionBody };
}

// Three copy formats, selected by modifier:
//   click         → footnote format (human-readable in any md viewer)
//   Shift+click   → SDocs round-trip (frontmatter + body) for pasting
//                   into another SDocs tab
//   Alt+click     → clean body (strips comments entirely)
function copyWithComments(headingEl, docWide, mods) {
  mods = mods || {};
  var source;
  if (docWide || !headingEl) {
    source = { meta: S.currentMeta || {}, body: S.currentBody || '' };
  } else {
    source = extractSectionSource(headingEl);
    if (!source) source = { meta: S.currentMeta || {}, body: S.currentBody || '' };
  }
  var payload, label;
  if (mods.roundTrip) {
    payload = window.SDocYaml
      ? window.SDocYaml.serializeFrontMatter(source.meta) + '\n' + source.body
      : source.body;
    label = 'Copied (SDocs format)';
  } else if (mods.clean) {
    payload = SDC.serializeClean(source.meta, source.body);
    label = 'Copied (clean)';
  } else {
    payload = SDC.serializeFootnotes(source.meta, source.body);
    label = 'Copied (footnotes)';
  }
  navigator.clipboard.writeText(payload).then(function () {
    if (S.setStatus) S.setStatus(label);
  }).catch(function () {
    if (S.setStatus) S.setStatus('Copy failed');
  });
}

// ── Public lifecycle ────────────────────────────────────────────────────

function render() {
  if (!S.renderedEl) return;
  if (!document.body.classList.contains('comment-mode')) return;
  strip();
  var comments = SDC.getComments(S.currentMeta).map(SDC.normalizeComment);
  comments.forEach(function (c) { renderComment(c); });
  injectGutterButtons();
  paintHeadingCopyWithComments(comments);
  paintToolbar();
}

function enter() {
  document.addEventListener('selectionchange', handleSelectionChange);
  render();
}

function exit() {
  document.removeEventListener('selectionchange', handleSelectionChange);
  hideSelectionPopover();
  hideComposer();
  strip();
  focusedId = null;
}

function wireToolbar() {
  var prev = document.getElementById('_sd_comment-prev');
  var next = document.getElementById('_sd_comment-next');
  var copy = document.getElementById('_sd_comment-copy-doc');
  if (prev) prev.addEventListener('click', function () { navigateRelative(-1); });
  if (next) next.addEventListener('click', function () { navigateRelative(+1); });
  if (copy) copy.addEventListener('click', function (e) {
    // Toolbar copy: whole doc. Default = footnote, Shift = round-trip, Alt = clean.
    copyWithComments(null, true, { roundTrip: e.shiftKey, clean: e.altKey });
  });
}

function wirePrefsInputs() {
  var nameInput  = document.getElementById('_sd_comment-pref-author');
  var colorInput = document.getElementById('_sd_comment-pref-color');
  if (!nameInput || !colorInput) return;
  var prefs = readPrefs();
  nameInput.value  = prefs.author;
  colorInput.value = prefs.color;
  nameInput.addEventListener('input', function () {
    writePrefs({ author: nameInput.value || 'user', color: colorInput.value });
  });
  colorInput.addEventListener('input', function () {
    writePrefs({ author: nameInput.value || 'user', color: colorInput.value });
  });
}

function onHostRender() {
  if (document.body.classList.contains('comment-mode')) render();
}

S.commentsUi = {
  enter: enter,
  exit: exit,
  render: render,
  onHostRender: onHostRender,
  navigate: navigateRelative,
  focusComment: focusComment,
  readPrefs: readPrefs,
  writePrefs: writePrefs,
  // Exposed for tests.
  _computeBlockId: computeBlockId,
  _findBlockById: findBlockById,
  _resolveAnchor: resolveAnchor,
};

function init() { wireToolbar(); wirePrefsInputs(); }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
