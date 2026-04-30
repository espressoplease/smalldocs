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
  // Clear block-comment indicator class + its CSS var.
  S.renderedEl.querySelectorAll('.sdoc-block-commented').forEach(function (el) {
    el.classList.remove('sdoc-block-commented');
    el.style.removeProperty('--sdoc-block-comment-color');
  });
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

function findBlockById(id, root, blockText) {
  if (!root) return null;
  var idx = listTopBlocks(root);
  // 1. Try the exact index first.
  if (id) {
    var parts = id.split(':');
    var t = parts[0];
    var n = parseInt(parts[1], 10);
    if (!isNaN(n)) {
      var list = idx.byType[t] || [];
      var hit = list[n] || null;
      // If we have a survival hint and the indexed block doesn't match it,
      // the index has likely drifted — fall through to text search.
      if (hit && (!blockText || (hit.textContent || '').trim().indexOf(blockText) === 0)) {
        return hit;
      }
    }
  }
  // 2. Fallback: scan all top blocks for one whose start matches blockText.
  if (blockText) {
    for (var i = 0; i < idx.blocks.length; i++) {
      var b = idx.blocks[i].el;
      if ((b.textContent || '').trim().indexOf(blockText) === 0) return b;
    }
  }
  return null;
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
    var hint = findBlockById(c.block, root, c.block_text);
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
  if (color) span.style.setProperty('--sdoc-anchor-color', color);
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
//
// One factory builds either shape (inline pill or block sidecar) in any of
// three modes (view / edit / compose). View shows static author + body and
// a delete icon. Edit/compose shows an input + tick/cancel. The DOM shape
// (and CSS class) of edit and compose are identical, so save/cancel just
// toggles the classes rather than swapping nodes.

var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var X_SVG    = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
// Tick at 13px to match the copy-with-comments buttons (header companion +
// toolbar). After-copy feedback restores whatever SVG was there originally.
var TICK_13_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var COPY_FEEDBACK_MS = 1500;

function flashCopyTick(btn) {
  if (!btn) return;
  var svg = btn.querySelector('svg');
  if (!svg) return;
  var original = svg.outerHTML;
  svg.outerHTML = TICK_13_SVG;
  setTimeout(function () {
    var current = btn.querySelector('svg');
    if (current) current.outerHTML = original;
  }, COPY_FEEDBACK_MS);
}

function iconBtn(svg, label, onClick) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdoc-icon-btn';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = svg;
  b.addEventListener('click', onClick);
  return b;
}

// Build a card element. `opts.shape` = 'pill' | 'sidecar'.
// `opts.mode` = 'view' | 'edit' | 'compose'. For edit/compose, `opts.onSave`
// receives the trimmed text and `opts.onCancel` is invoked to revert.
function makeCardElement(c, opts) {
  var shape = opts.shape;
  var mode  = opts.mode;
  var tag   = shape === 'pill' ? 'span' : 'div';
  var card = document.createElement(tag);
  card.className = 'sdoc-card sdoc-card-' + shape +
    (mode === 'view' ? '' : ' sdoc-card-edit') +
    (opts.orphaned ? ' sdoc-card-orphaned' : '');
  if (c && c.id) card.setAttribute('data-c', c.id);
  var color = (c && c.color) || readPrefs().color;
  card.style.setProperty('--sdoc-card-color', color);

  if (mode === 'view') {
    var who = document.createElement('span');
    who.className = 'sdoc-card-author';
    who.textContent = c.author || 'user';
    // Time stays as a hover tooltip on the author name only — it's
    // useful for "how old is this comment" but doesn't earn its own
    // line in the visible card.
    who.title = (c.author || 'user') + (c.at ? ' · ' + formatRelativeTime(c.at) : '');
    card.appendChild(who);

    var body = document.createElement('span');
    body.className = 'sdoc-card-body';
    body.textContent = c.text || '';
    card.appendChild(body);

    if (opts.orphaned) {
      var badge = document.createElement('span');
      badge.className = 'sdoc-card-orphan-badge';
      badge.textContent = 'anchor lost';
      card.appendChild(badge);
    }

    var del = iconBtn(TRASH_SVG, 'Delete comment', function (e) {
      e.stopPropagation();
      deleteComment(c.id);
    });
    del.classList.add('sdoc-card-delete');
    card.appendChild(del);

    card.addEventListener('click', function (e) {
      if (e.target.closest('.sdoc-icon-btn')) return;
      focusComment(c.id);
      replaceWithEdit(card, c, shape);
    });
  } else {
    var inputEl;
    if (shape === 'pill') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
    } else {
      inputEl = document.createElement('textarea');
      inputEl.rows = 1;
    }
    inputEl.className = 'sdoc-card-input';
    inputEl.placeholder = 'Add a comment...';
    if (c && c.text) inputEl.value = c.text;
    inputEl.addEventListener('click', function (e) { e.stopPropagation(); });

    var save = iconBtn(TICK_SVG, 'Save', function (e) {
      e.stopPropagation();
      var text = inputEl.value.trim();
      if (!text) { inputEl.focus(); return; }
      opts.onSave(text);
    });
    save.classList.add('sdoc-card-save');

    var cancel = iconBtn(X_SVG, 'Cancel', function (e) {
      e.stopPropagation();
      opts.onCancel();
    });
    cancel.classList.add('sdoc-card-cancel');

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
      if (e.key === 'Enter') {
        // Pill = single-line input → Enter saves.
        // Sidecar = textarea → Cmd/Ctrl+Enter saves; bare Enter inserts newline.
        if (shape === 'pill' || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          save.click();
        }
      }
    });

    card.appendChild(inputEl);
    card.appendChild(save);
    card.appendChild(cancel);
    setTimeout(function () { inputEl.focus(); if (c && c.text) inputEl.select(); }, 0);
  }

  return card;
}

function replaceWithEdit(viewCard, c, shape) {
  var editCard = makeCardElement(c, {
    shape: shape,
    mode: 'edit',
    onSave: function (text) {
      if (text === (c.text || '')) { revert(); return; }
      S.currentMeta = SDC.updateComment(S.currentMeta || {}, c.id, { text: text });
      if (S.syncAll) S.syncAll('comment');
    },
    onCancel: revert,
  });
  function revert() {
    if (S.syncAll) S.syncAll('comment');
  }
  if (viewCard.parentNode) viewCard.parentNode.replaceChild(editCard, viewCard);
}

// ── Render anchors + cards ──────────────────────────────────────────────

function renderComment(c) {
  if (c.kind === 'inline') {
    var resolved = resolveAnchor(c, S.renderedEl);
    if (resolved) {
      var span = wrapRange(resolved.range, c.id, c.color);
      if (span) {
        var pill = makeCardElement(c, { shape: 'pill', mode: 'view' });
        // Anchors inside a <table> can't take an inline card inside a
        // <td> — the card widens the cell and breaks the column grid.
        // For tables, place the card as a sibling of the <table>.
        var table = span.closest('table');
        if (table && table.parentNode) {
          table.parentNode.insertBefore(pill, table.nextSibling);
        } else {
          span.parentNode.insertBefore(pill, span.nextSibling);
        }
        return false;
      }
    }
    var orphan = makeCardElement(c, { shape: 'sidecar', mode: 'view', orphaned: true });
    S.renderedEl.appendChild(orphan);
    return true;
  }
  // kind === 'block'
  var block = findBlockById(c.block, S.renderedEl, c.block_text);
  if (block) {
    var host = block.parentNode && block.parentNode.classList &&
               block.parentNode.classList.contains('sdoc-block-host')
      ? block.parentNode
      : null;
    if (host) {
      host.classList.add('sdoc-host-commented');
      host.style.setProperty('--sdoc-block-comment-color', c.color || '#ffd700');
    } else {
      // Block has no host (shouldn't happen in comment mode, but be safe).
      block.classList.add('sdoc-block-commented');
      block.style.setProperty('--sdoc-block-comment-color', c.color || '#ffd700');
    }
    var sidecar = makeCardElement(c, { shape: 'sidecar', mode: 'view' });
    // Append the card INSIDE the host (after the block) so the host's
    // left stripe spans block + card without a gap.
    (host || block.parentNode).appendChild(sidecar);
    return false;
  }
  var orphanBlock = makeCardElement(c, { shape: 'sidecar', mode: 'view', orphaned: true });
  S.renderedEl.appendChild(orphanBlock);
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
  selectionPopoverEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
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
  // Inline <code> and <pre><code> ARE allowed — the sidecar model anchors
  // by rendered text, which matches source for verbatim blocks.
  var anc = range.commonAncestorContainer;
  var el = anc.nodeType === 1 ? anc : anc.parentNode;
  while (el && el !== S.renderedEl) {
    if (el.classList && el.classList.contains('katex')) return hideSelectionPopover();
    el = el.parentNode;
  }

  var pop = ensureSelectionPopover();
  pop.style.setProperty('--sdoc-anchor-color', readPrefs().color);
  var rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return hideSelectionPopover();
  pop.style.display = 'block';
  pop.style.position = 'fixed';
  pop.style.top  = (rect.top - 42) + 'px';
  pop.style.left = (rect.right - 15) + 'px';
}

// ── Composer ────────────────────────────────────────────────────────────
//
// Composing a new comment uses the SAME card shape as the saved comment:
// pill for selection comments, sidecar for block comments. So the position
// the user types in is exactly where the saved comment will live.

function hideComposer() {
  if (composerEl && composerEl.parentNode) {
    composerEl.parentNode.removeChild(composerEl);
  }
  composerEl = null;
}

function openBlockComposer(block) {
  hideComposer();
  var prefs = readPrefs();
  var blockId = computeBlockId(block, S.renderedEl);
  if (!blockId) return;
  // Capture a survival hint: the block's leading text, so the comment can
  // re-anchor if the index drifts after a future edit.
  var blockText = (block.textContent || '').slice(0, 60).trim();
  var host = block.parentNode && block.parentNode.classList &&
             block.parentNode.classList.contains('sdoc-block-host')
    ? block.parentNode
    : null;
  if (host) {
    host.classList.add('sdoc-host-commented');
    host.style.setProperty('--sdoc-block-comment-color', prefs.color);
  }

  var draft = { color: prefs.color, author: prefs.author };
  var composer = makeCardElement(draft, {
    shape: 'sidecar',
    mode: 'compose',
    onSave: function (text) {
      try {
        var res = SDC.addBlockComment(S.currentMeta || {}, {
          block: blockId,
          block_text: blockText,
        }, {
          author: prefs.author, color: prefs.color,
          at: new Date().toISOString(), text: text,
        });
        S.currentMeta = res.meta;
        hideComposer();
        if (S.syncAll) S.syncAll('comment');
        setTimeout(function () { focusComment(res.id); }, 30);
      } catch (e) {
        console.warn('addBlockComment failed:', e && e.message);
      }
    },
    onCancel: function () {
      hideComposer();
      if (!hasBlockComment(blockId) && host) {
        host.classList.remove('sdoc-host-commented');
        host.style.removeProperty('--sdoc-block-comment-color');
      }
    },
  });
  composerEl = composer;
  // Place inside the host so the left stripe spans block + composer.
  (host || block.parentNode).appendChild(composer);
}

function hasBlockComment(blockId) {
  var list = SDC.getComments(S.currentMeta || {});
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === 'block' && list[i].block === blockId) return true;
  }
  return false;
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
  hideComposer();
  var prefs = readPrefs();
  var quote = range.toString();
  if (!quote) return;
  var block = nearestTopBlock(range.startContainer);
  if (!block) return;
  var ctx = captureContext(range, block);
  var blockId = computeBlockId(block, S.renderedEl);

  // Visual preview while the composer is open. Same look as a saved
  // inline anchor — solid colour with forced dark text — so the user
  // sees the final result immediately. The composer pill below is
  // signal enough that this is still pending.
  var pendingSpan = document.createElement('span');
  pendingSpan.className = 'sdoc-anchor';
  pendingSpan.style.setProperty('--sdoc-anchor-color', prefs.color);
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

  var draft = { color: prefs.color, author: prefs.author };
  var composer = makeCardElement(draft, {
    shape: 'pill',
    mode: 'compose',
    onSave: function (text) {
      clearPending();
      hideComposer();
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
    },
    onCancel: function () { clearPending(); hideComposer(); },
  });
  composerEl = composer;
  // Place the inline composer pill right after the pending anchor — same
  // physical spot the saved pill will land in. Tables get sibling-of-table.
  var table = pendingSpan ? pendingSpan.closest('table') : null;
  if (table && table.parentNode) {
    table.parentNode.insertBefore(composer, table.nextSibling);
  } else if (pendingSpan && pendingSpan.parentNode) {
    pendingSpan.parentNode.insertBefore(composer, pendingSpan.nextSibling);
  } else {
    // Fallback: sibling-after-block (matches old behavior if anchor wrap failed)
    block.parentNode.insertBefore(composer, block.nextSibling);
  }
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
  var zeroEl   = tb.querySelector('.sdoc-toolbar-zero');
  var activeEl = tb.querySelector('.sdoc-toolbar-active');

  // Cross-fade between the zero-state hint and the active controls
  // when crossing the 0/non-zero boundary. Both states share the same
  // flex slot and animate via the .is-active class in CSS.
  if (zeroEl && activeEl) {
    if (total === 0) {
      zeroEl.classList.add('is-active');
      activeEl.classList.remove('is-active');
    } else {
      zeroEl.classList.remove('is-active');
      activeEl.classList.add('is-active');
    }
  }

  if (total === 0) {
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
  } else {
    var ids = comments.map(function (c) { return c.id; });
    var idx = Math.max(0, ids.indexOf(focusedId));
    if (focusedId == null) idx = 0;
    if (countEl) countEl.textContent = (idx + 1) + ' / ' + total;
    // Stay enabled even at total === 1 so the arrow still jumps to the
    // single comment (useful when it's hidden inside a long collapsed doc).
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
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
  if (!card) { paintToolbar(); return; }

  // Expand any collapsed .md-section-body that contains this card so the
  // user can actually see what they navigated to. Walk up from the card,
  // opening every closed ancestor body and rotating the corresponding
  // chevron. Deliberately does NOT re-collapse other sections — matches
  // the user's mental model ("I arrived here; keep it open").
  var ancestor = card.parentElement;
  while (ancestor && ancestor !== S.renderedEl) {
    if (ancestor.classList && ancestor.classList.contains('md-section-body') &&
        !ancestor.classList.contains('open')) {
      ancestor.classList.add('open');
      var section = ancestor.closest('.md-section');
      var toggle = section && section.querySelector('.section-toggle');
      if (toggle) toggle.classList.add('open');
    }
    ancestor = ancestor.parentElement;
  }

  S.renderedEl.querySelectorAll('.sdoc-card-focus, .sdoc-card-focus-flash')
    .forEach(function (el) {
      el.classList.remove('sdoc-card-focus');
      el.classList.remove('sdoc-card-focus-flash');
    });
  card.classList.add('sdoc-card-focus');

  // requestAnimationFrame: let the .open class changes settle into a real
  // layout before scrollIntoView measures positions and the flash class is
  // applied. Without this the scroll can target the pre-expand layout, and
  // a freshly-revealed card wouldn't reliably trigger the CSS animation.
  requestAnimationFrame(function () {
    card.classList.add('sdoc-card-focus-flash');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { card.classList.remove('sdoc-card-focus-flash'); }, 900);
  });

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
    copyWithComments(heading, e.shiftKey, { roundTrip: e.altKey })
      .then(function (ok) { if (ok) flashCopyTick(btn); });
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

// Hint placement: tag ONLY the immediate parent heading — the deepest h2/h3/h4
// whose .md-section-body directly contains a comment block (not via a nested
// sub-heading). This anchors the tinted gutter tab to the most specific
// heading possible, instead of bubbling up to ancestors. When that heading
// sits inside a collapsed parent, the hint isn't visible until the user
// expands far enough to reach it; the toolbar's comment-button dot remains
// the global "this doc has comments" signal.
//
// Headings that already carry .sdoc-host-commented (the heading itself has
// a direct comment) are skipped — their tab is already lit by that path.
function paintDescendantCommentHints(comments) {
  if (!S.renderedEl) return;
  S.renderedEl.querySelectorAll('.sdoc-block-host.sdoc-has-direct-section-comment')
    .forEach(function (host) {
      host.classList.remove('sdoc-has-direct-section-comment');
      host.style.removeProperty('--sdoc-descendant-comment-color');
    });
  if (!comments.length) return;

  S.renderedEl.querySelectorAll('h2, h3, h4').forEach(function (h) {
    var host = h.parentElement;
    if (!host || !host.classList || !host.classList.contains('sdoc-block-host')) return;
    if (host.classList.contains('sdoc-host-commented')) return;

    var section = h.closest('.md-section');
    if (!section) return;
    var body = section.querySelector(':scope > .md-section-body');
    if (!body) return;
    if (!hasDirectCommentInBody(body)) return;

    host.classList.add('sdoc-has-direct-section-comment');
    var color = mostRecentDirectCommentColor(body, comments);
    if (color) host.style.setProperty('--sdoc-descendant-comment-color', color);
  });
}

// True iff the section body has a card or anchor that is a direct member
// of the body (not inside a nested .md-section).
function hasDirectCommentInBody(body) {
  var ownSection = body.parentElement; // the .md-section wrapping body+heading
  var nodes = body.querySelectorAll('.sdoc-card, span.sdoc-anchor');
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].closest('.md-section') === ownSection) return true;
  }
  return false;
}

// Newest comment whose anchor lives directly in the body (not inside a
// nested .md-section). Comments push to the array tail, so newest-first.
function mostRecentDirectCommentColor(body, comments) {
  var ownSection = body.parentElement;
  for (var i = comments.length - 1; i >= 0; i--) {
    var c = comments[i];
    if (!c || !c.id) continue;
    var sel = '.sdoc-card[data-c="' + c.id + '"], span.sdoc-anchor[data-c="' + c.id + '"]';
    var node = body.querySelector(sel);
    if (!node) continue;
    if (node.closest('.md-section') !== ownSection) continue;
    return c.color || null;
  }
  return null;
}

function sectionContainsComment(heading) {
  // For H2/H3/H4 (wrapped in .md-section by buildCollapsibleSections),
  // the whole section's content is inside the ancestor .md-section div —
  // a simple descendant query covers it, regardless of block-host wrapping.
  var section = heading.closest('.md-section');
  if (section) {
    return !!section.querySelector('.sdoc-card, span.sdoc-anchor');
  }
  // For H1/H5/H6 (no .md-section wrapping), walk forward siblings until the
  // next heading of same-or-higher level. Comment mode may have wrapped the
  // heading in .sdoc-block-host — start from that wrapper's sibling instead.
  var level = parseInt(heading.tagName[1], 10);
  var start = (heading.parentElement && heading.parentElement.classList &&
               heading.parentElement.classList.contains('sdoc-block-host'))
    ? heading.parentElement
    : heading;
  var node = start.nextElementSibling;
  while (node) {
    // Direct heading sibling
    if (/^H[1-6]$/.test(node.tagName)) {
      var nextLevel = parseInt(node.tagName[1], 10);
      if (nextLevel <= level) break;
    }
    // Heading wrapped in .sdoc-block-host
    if (node.classList && node.classList.contains('sdoc-block-host')) {
      var innerH = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
      if (innerH) {
        var innerLevel = parseInt(innerH.tagName[1], 10);
        if (innerLevel <= level) break;
      }
    }
    if (node.classList && node.classList.contains('sdoc-card')) return true;
    if (node.querySelector && node.querySelector('.sdoc-card, span.sdoc-anchor')) return true;
    node = node.nextElementSibling;
  }
  return false;
}

// ── Copy with comments ──────────────────────────────────────────────────

// Read a heading's source text without the companion buttons that
// SDocs appends inside it (.header-anchor, .header-copy-btn, the
// "with comments" companion). Without this, headingEl.textContent
// returns "H2 Titlewith comments" and never matches the markdown.
function getHeadingPlainText(headingEl) {
  var clone = headingEl.cloneNode(true);
  clone.querySelectorAll(
    '.header-anchor, .header-copy-btn, .sdoc-head-copy-c, .sdoc-copy-with-c'
  ).forEach(function (el) { el.remove(); });
  return (clone.textContent || '').replace(/\s+$/, '').trim();
}

// Slice the body to the substring that belongs to headingEl's section.
// Returns { meta, body } where meta.comments is filtered to only those
// anchored to blocks within that section. null if the heading can't be found.
function extractSectionSource(headingEl) {
  if (!headingEl) return null;
  var level = parseInt(headingEl.tagName[1], 10);
  var headingText = getHeadingPlainText(headingEl);
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
  // Filter comments to those anchored inside the slice.
  // - Inline (selection-anchored): match by quote text appearing in slice.
  // - Block (block-anchored): resolve the block in the rendered DOM, then
  //   check whether that block sits inside the H2/H3/.../section's range
  //   in the rendered tree (i.e. between this heading and the next
  //   same-or-higher heading).
  var all = SDC.getComments(S.currentMeta);
  var blocksInSection = listBlocksInSection(headingEl, level);
  var inSection = all.filter(function (c) {
    if (c.kind === 'inline' && c.quote) {
      return sectionBody.indexOf(c.quote) !== -1;
    }
    if (c.kind === 'block' && c.block) {
      var bEl = findBlockById(c.block, S.renderedEl, c.block_text);
      return bEl && blocksInSection.indexOf(bEl) !== -1;
    }
    return false;
  });
  return { meta: { comments: inSection }, body: sectionBody };
}

// Walk forward from headingEl in document order and collect every
// top-level block until we hit a heading of equal-or-higher level.
function listBlocksInSection(headingEl, level) {
  var out = [];
  if (!headingEl || !S.renderedEl) return out;
  var all = Array.from(S.renderedEl.querySelectorAll('*'));
  var startIdx = all.indexOf(headingEl);
  if (startIdx === -1) return out;
  for (var i = startIdx + 1; i < all.length; i++) {
    var node = all[i];
    if (/^H[1-6]$/.test(node.tagName)) {
      var nodeLevel = parseInt(node.tagName[1], 10);
      if (nodeLevel <= level) break;
    }
    if (node.matches && node.matches(TOP_BLOCK_SEL)) {
      // Skip nested blocks (already counted via their parent).
      var ancestor = node.parentElement;
      var nested = false;
      while (ancestor && ancestor !== S.renderedEl) {
        if (ancestor.matches && ancestor.matches(TOP_BLOCK_SEL)) { nested = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (!nested) out.push(node);
    }
  }
  return out;
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
  return navigator.clipboard.writeText(payload).then(function () {
    if (S.setStatus) S.setStatus(label);
    return true;
  }).catch(function () {
    if (S.setStatus) S.setStatus('Copy failed');
    return false;
  });
}

// ── Public lifecycle ────────────────────────────────────────────────────

function render() {
  if (!S.renderedEl) return;
  if (!document.body.classList.contains('comment-mode')) return;
  strip();
  // Inject hosts BEFORE rendering comments so block-level renders can
  // attach the sidecar inside the host (and apply .sdoc-host-commented).
  injectGutterButtons();
  var comments = SDC.getComments(S.currentMeta).map(SDC.normalizeComment);
  comments.forEach(function (c) { renderComment(c); });
  paintHeadingCopyWithComments(comments);
  paintDescendantCommentHints(comments);
  paintToolbar();
}

// Push the user's current pref colour onto <body> as --sdoc-anchor-color
// so unattached UI (gutter buttons, the selection popover) inherits the
// same tint without each piece needing its own copy. Existing .sdoc-anchor
// spans set their own per-comment colour inline and aren't affected.
function applyPrefColorToBody() {
  document.body.style.setProperty('--sdoc-anchor-color', readPrefs().color);
}

function enter() {
  applyPrefColorToBody();
  document.addEventListener('selectionchange', handleSelectionChange);
  render();
}

function exit() {
  document.removeEventListener('selectionchange', handleSelectionChange);
  hideSelectionPopover();
  hideComposer();
  strip();
  focusedId = null;
  document.body.style.removeProperty('--sdoc-anchor-color');
}

function wireToolbar() {
  var prev = document.getElementById('_sd_comment-prev');
  var next = document.getElementById('_sd_comment-next');
  var copy = document.getElementById('_sd_comment-copy-doc');
  if (prev) prev.addEventListener('click', function () { navigateRelative(-1); });
  if (next) next.addEventListener('click', function () { navigateRelative(+1); });
  if (copy) copy.addEventListener('click', function (e) {
    // Toolbar copy: whole doc. Default = footnote, Shift = round-trip, Alt = clean.
    copyWithComments(null, true, { roundTrip: e.shiftKey, clean: e.altKey })
      .then(function (ok) { if (ok) flashCopyTick(copy); });
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
    if (document.body.classList.contains('comment-mode')) applyPrefColorToBody();
  });
}

function onHostRender() {
  if (document.body.classList.contains('comment-mode')) render();
}

// Toolbar comment-button dot: lit whenever the doc carries any comments,
// regardless of mode. Reuses the .btn-with-dot / .info-dot / .has-unseen
// plumbing from sdocs-info.js, and tints the dot with the most recent
// comment's color so the toolbar reflects the active palette of the doc.
function refreshCommentDot() {
  var btn = document.getElementById('_sd_btn-comment');
  if (!btn) return;
  var list = SDC.getComments(S.currentMeta || {});
  btn.classList.toggle('has-unseen', list.length > 0);
  if (list.length > 0) {
    // list.push() is the only insertion path, so the tail is the most
    // recent comment. Fall back to the chrome accent if the comment
    // omitted a color (older docs, hand-edited YAML).
    var last = list[list.length - 1];
    btn.style.setProperty('--btn-dot-color', last.color || 'var(--accent)');
  } else {
    btn.style.removeProperty('--btn-dot-color');
  }
}

S.refreshCommentDot = refreshCommentDot;

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
