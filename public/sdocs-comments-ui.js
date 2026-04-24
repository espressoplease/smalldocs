/**
 * sdocs-comments-ui.js - browser-only integration for comment mode.
 *
 * Only active when body.comment-mode is on. On enter(), parses the current
 * body, walks #_sd_rendered's DOM, wraps selection anchors in highlight spans,
 * injects comment cards after anchored blocks, installs the selection-change
 * listener and the gutter `+` buttons, and paints the top comment toolbar.
 * exit() tears all of it down.
 *
 * All mutations to comments go through SDocComments.{add,remove}* which return
 * a new body string; we then set SDocs.currentBody and call syncAll to
 * re-render + re-encode the hash.
 */
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};
var SDC = window.SDocComments;

var PREFS_KEY = 'sdocs_comment_prefs';
var CONTEXT_LEN = 30; // chars of before/after captured for selection anchors

var focusedId = null;  // currently highlighted/navigated comment
var selectionPopoverEl = null;
var composerEl = null;
var orphanCount = 0;

// ── Prefs ───────────────────────────────────────────────────────────────

function readPrefs() {
  try {
    var raw = localStorage.getItem(PREFS_KEY);
    var v = raw ? JSON.parse(raw) : {};
    return {
      author: v.author || 'user',
      color:  v.color  || '#ffd700',
    };
  } catch (_) {
    return { author: 'user', color: '#ffd700' };
  }
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
}

// Walk DOM under root, collect Comment nodes. Returns [{node, data}].
function collectCommentNodes(root) {
  var out = [];
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
  var n;
  while ((n = walker.nextNode()) !== null) {
    out.push({ node: n, data: n.data || '' });
  }
  return out;
}

// Find the nearest ancestor element that is a top-level doc block
// (p, pre, blockquote, ul, ol, h1-h6, table, .sdoc-chart).
var TOP_BLOCK_SEL = 'p, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, table, .sdoc-chart';
function nearestTopBlock(node) {
  var el = node.nodeType === 1 ? node : node.parentNode;
  while (el && el !== S.renderedEl && el !== document.body) {
    if (el.matches && el.matches(TOP_BLOCK_SEL)) return el;
    el = el.parentNode;
  }
  return null;
}

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

// ── Wrap a selection-anchor by finding its start + end HTML Comment nodes ──

function wrapSelectionAnchor(c, commentNodes) {
  var startData = 'sdoc-c:' + c.id;
  var endData   = '/sdoc-c:' + c.id;
  var startNode = null, endNode = null;
  for (var i = 0; i < commentNodes.length; i++) {
    var d = commentNodes[i].data.trim();
    if (startNode == null && (d === startData || d.indexOf(startData + ' ') === 0)) {
      startNode = commentNodes[i].node;
    } else if (startNode && d === endData) {
      endNode = commentNodes[i].node;
      break;
    }
  }
  if (!startNode || !endNode) return false;

  // Build a Range from just-after start to just-before end.
  var range = document.createRange();
  range.setStartAfter(startNode);
  range.setEndBefore(endNode);

  // Reject if the range crosses a .katex or pre code ancestor - those have
  // rendered text that differs from source; highlighting is unsafe there.
  var commonAncestor = range.commonAncestorContainer;
  var el = commonAncestor.nodeType === 1 ? commonAncestor : commonAncestor.parentNode;
  while (el && el !== S.renderedEl) {
    if (el.classList && (el.classList.contains('katex') || (el.tagName === 'CODE' && el.parentNode && el.parentNode.tagName === 'PRE'))) {
      return false;
    }
    el = el.parentNode;
  }

  var span = document.createElement('span');
  span.className = 'sdoc-anchor';
  span.setAttribute('data-c', c.id);
  span.style.background = c.color;
  try {
    range.surroundContents(span);
  } catch (e) {
    // surroundContents throws if the range crosses non-text boundaries.
    // In that case, extract + wrap as a fallback.
    try {
      var frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    } catch (_) { return false; }
  }
  return true;
}

// ── Inject a comment card after its anchor ──────────────────────────────

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

  card.addEventListener('click', function () {
    focusComment(c.id);
  });

  return card;
}

function injectCard(c, commentNodes) {
  // Find the metadata comment node for this id (for block-anchored placement).
  var needle = 'sdoc-comment';
  var cNode = null;
  for (var i = 0; i < commentNodes.length; i++) {
    var d = commentNodes[i].data;
    if (d.indexOf(needle) === 0 && new RegExp('\\bid="' + c.id + '"').test(d)) {
      cNode = commentNodes[i].node;
      break;
    }
  }
  var orphaned = false;
  var card = cardEl(c, false);

  if (c.anchor.type === 'selection') {
    // Inline: place the card immediately after the highlight span so the
    // comment flows with the sentence it annotates.
    var span = S.renderedEl.querySelector('span.sdoc-anchor[data-c="' + c.id + '"]');
    if (span && span.parentNode) {
      span.parentNode.insertBefore(card, span.nextSibling);
      return false;
    }
    orphaned = true;
  } else {
    // Block anchor: append inline at the end of the preceding block's content
    // so it flows like a trailing note rather than a separate row.
    var block = cNode ? (cNode.previousElementSibling || nearestTopBlock(cNode)) : null;
    if (block) {
      block.appendChild(card);
      return false;
    }
    orphaned = true;
  }

  // Fully orphaned (wrapper or block couldn't be located in the current DOM).
  card.classList.add('sdoc-card-orphaned');
  card.appendChild(Object.assign(document.createElement('span'), {
    className: 'sdoc-card-orphan-badge',
    textContent: 'anchor lost',
  }));
  S.renderedEl.appendChild(card);
  return true;
}

// ── Gutter add-comment buttons ──────────────────────────────────────────

function makeGutterBtn(targetBlock) {
  var btn = document.createElement('button');
  btn.className = 'sdoc-gutter-add';
  btn.setAttribute('aria-label', 'Add comment on this block');
  btn.title = 'Add comment';
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    openBlockComposer(targetBlock);
  });
  // Position at the block's left margin. We absolute-position relative to
  // #_sd_content-area so scrolling works naturally.
  return btn;
}

function injectGutterButtons() {
  S.renderedEl.querySelectorAll(TOP_BLOCK_SEL).forEach(function (block) {
    // Skip blocks that are inside collapsible section headers or cards
    if (block.closest('.sdoc-card')) return;
    var btn = makeGutterBtn(block);
    block.insertBefore(btn, block.firstChild);
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

  // Reject if selection is outside rendered area
  if (!S.renderedEl || !S.renderedEl.contains(range.commonAncestorContainer)) {
    return hideSelectionPopover();
  }

  // Reject multi-block selections
  var startBlock = nearestTopBlock(range.startContainer);
  var endBlock   = nearestTopBlock(range.endContainer);
  if (!startBlock || startBlock !== endBlock) return hideSelectionPopover();

  // Reject selections inside .katex or any <code> (inline or pre) — either the
  // rendered text differs from source (katex) or wrapping HTML comments there
  // would be escaped as literal text (code).
  var anc = range.commonAncestorContainer;
  var el = anc.nodeType === 1 ? anc : anc.parentNode;
  while (el && el !== S.renderedEl) {
    if (el.classList && el.classList.contains('katex')) return hideSelectionPopover();
    if (el.tagName === 'CODE') return hideSelectionPopover();
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

function makeComposer(onSave) {
  hideComposer();
  var el = document.createElement('div');
  el.className = 'sdoc-composer';
  var ta = document.createElement('textarea');
  ta.placeholder = 'Add a comment...';
  ta.rows = 3;
  el.appendChild(ta);
  var actions = document.createElement('div');
  actions.className = 'sdoc-composer-actions';
  var save = document.createElement('button');
  save.className = 'btn sdoc-composer-save';
  save.textContent = 'Save';
  var cancel = document.createElement('button');
  cancel.className = 'btn sdoc-composer-cancel';
  cancel.textContent = 'Cancel';
  save.addEventListener('click', function () {
    var text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    onSave(text);
    hideComposer();
  });
  cancel.addEventListener('click', hideComposer);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideComposer(); }
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
  var blockText = (block.textContent || '').trim().slice(0, 80);
  if (!blockText) return;
  var composer = makeComposer(function (text) {
    var prev = S.currentBody;
    try {
      var res = SDC.addBlockComment(prev, { blockText: blockText }, {
        author: prefs.author, color: prefs.color,
        at: new Date().toISOString(), text: text,
      });
      S.currentBody = res.md;
      if (S.syncAll) S.syncAll('comment');
      setTimeout(function () { focusComment(res.id); }, 30);
    } catch (e) {
      console.warn('addBlockComment failed:', e && e.message);
    }
  });
  block.parentNode.insertBefore(composer, block.nextSibling);
}

function captureContext(range) {
  // Read up to CONTEXT_LEN chars of surrounding text from the containing block.
  var block = nearestTopBlock(range.startContainer);
  if (!block) return { before: '', after: '' };
  var blockText = block.textContent || '';
  var preRange = document.createRange();
  preRange.selectNodeContents(block);
  preRange.setEnd(range.startContainer, range.startOffset);
  var beforeAll = preRange.toString();
  preRange.setStart(range.endContainer, range.endOffset);
  preRange.setEnd(block, block.childNodes.length);
  var afterAll = preRange.toString();
  return {
    before: beforeAll.slice(Math.max(0, beforeAll.length - CONTEXT_LEN)),
    after:  afterAll.slice(0, CONTEXT_LEN),
  };
}

function openSelectionComposerFromSelection(range) {
  var prefs = readPrefs();
  var selectedText = range.toString();
  if (!selectedText) return;
  var ctx = captureContext(range);
  var block = nearestTopBlock(range.startContainer);
  if (!block) return;
  var composer = makeComposer(function (text) {
    try {
      var res = SDC.addSelectionComment(S.currentBody, {
        selectedText: selectedText,
        before: ctx.before,
        after: ctx.after,
      }, {
        author: prefs.author, color: prefs.color,
        at: new Date().toISOString(), text: text,
      });
      S.currentBody = res.md;
      if (S.syncAll) S.syncAll('comment');
      setTimeout(function () { focusComment(res.id); }, 30);
    } catch (e) {
      console.warn('addSelectionComment failed:', e && e.message);
    }
  });
  block.parentNode.insertBefore(composer, block.nextSibling);
  // Clear the selection so the popover goes away.
  var sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

// ── Delete ──────────────────────────────────────────────────────────────

function deleteComment(id) {
  var prev = S.currentBody;
  S.currentBody = SDC.removeComment(prev, id);
  if (S.syncAll) S.syncAll('comment');
}

// ── Toolbar paint ───────────────────────────────────────────────────────

function paintToolbar() {
  var tb = document.getElementById('_sd_comment-toolbar');
  if (!tb) return;
  var parsed = SDC.parse(S.currentBody || '');
  var total = parsed.comments.length;
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
    var ids = parsed.comments.map(function (c) { return c.id; });
    var idx = Math.max(0, ids.indexOf(focusedId));
    if (focusedId == null) idx = 0;
    if (countEl) countEl.textContent = (idx + 1) + ' / ' + total;
    if (prevBtn) prevBtn.disabled = total <= 1;
    if (nextBtn) nextBtn.disabled = total <= 1;
    if (copyBtn) copyBtn.disabled = false;
  }

  // Orphan count: cards that actually rendered as orphaned after this render
  var orphanBadgeCount = S.renderedEl ? S.renderedEl.querySelectorAll('.sdoc-card-orphaned').length : 0;
  orphanCount = orphanBadgeCount;
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
  var parsed = SDC.parse(S.currentBody || '');
  if (!parsed.comments.length) return;
  var ids = parsed.comments.map(function (c) { return c.id; });
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

// ── Heading companion "copy with comments" button ───────────────────────

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
    var docWide = e.shiftKey;
    copyWithComments(heading, docWide);
  });
  return btn;
}

function paintHeadingCopyWithComments(comments) {
  if (!S.renderedEl) return;
  // Remove stale companion buttons first
  S.renderedEl.querySelectorAll('.sdoc-head-copy-c').forEach(function (b) { b.remove(); });
  if (!comments.length) return;
  // For each heading, if its section contains any commented descendant, add a companion button.
  var headings = S.renderedEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach(function (h) {
    var sectionHasComment = sectionContainsComment(h);
    if (sectionHasComment) {
      h.appendChild(buildHeadCopyCommentsBtn(h));
    }
  });
}

// Does the heading's section (from this heading to next heading of same-or-higher level) contain a comment card?
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

// Emit either the whole current body (docWide) or the substring of the body
// that belongs to the given heading's section, with all sdoc HTML comments
// intact so they round-trip to the agent.
function extractSectionSource(headingText, level) {
  var md = S.currentBody || '';
  var headingRe = new RegExp('^(#{1,' + level + '})\\s+(.+)$', 'gm');
  var m;
  var startIdx = -1;
  while ((m = headingRe.exec(md)) !== null) {
    if (m[2].trim() === headingText.trim() && m[1].length === level) {
      startIdx = m.index;
      break;
    }
  }
  if (startIdx === -1) return null;
  // Find next heading of same or higher level
  var afterRe = new RegExp('\\n(#{1,' + level + '})\\s+', 'g');
  afterRe.lastIndex = startIdx + 1;
  var a = afterRe.exec(md);
  var endIdx = a ? a.index : md.length;
  return md.slice(startIdx, endIdx).trim() + '\n';
}

function copyWithComments(headingEl, docWide) {
  var payload;
  if (docWide || !headingEl) {
    payload = S.currentBody || '';
  } else {
    var text = (headingEl.textContent || '').replace(/\s+¶.*$/, '').trim();
    // Strip the appended companion button text if any
    text = text.replace(/\s+$/, '');
    var level = parseInt(headingEl.tagName[1], 10);
    var section = extractSectionSource(text, level);
    payload = section != null ? section : (S.currentBody || '');
  }
  navigator.clipboard.writeText(payload).then(function () {
    if (S.setStatus) S.setStatus(docWide ? 'Copied document with comments' : 'Copied section with comments');
  }).catch(function () {
    if (S.setStatus) S.setStatus('Copy failed');
  });
}

// ── Public lifecycle ────────────────────────────────────────────────────

function render() {
  if (!S.renderedEl) return;
  if (!document.body.classList.contains('comment-mode')) return;
  strip();
  var parsed = SDC.parse(S.currentBody || '');
  var commentNodes = collectCommentNodes(S.renderedEl);
  parsed.comments.forEach(function (c) {
    if (c.anchor.type === 'selection') {
      wrapSelectionAnchor(c, commentNodes);
    }
    injectCard(c, commentNodes);
  });
  injectGutterButtons();
  paintHeadingCopyWithComments(parsed.comments);
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
  if (copy) copy.addEventListener('click', function (e) { copyWithComments(null, true); });
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

// Install hook so render() in sdocs-app.js triggers our overlay render.
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
};

function init() {
  wireToolbar();
  wirePrefsInputs();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
