// Diagram feedback uses the document's existing thread store and card UI.
(function (exports) {
'use strict';

function resolveTarget(comment, diagrams) {
  if (comment.anchor_status) return { index: -1, status: comment.anchor_status };
  var source = String(comment.diagram_source || '').trim();
  var exact = diagrams.filter(function (diagram) { return diagram.source.trim() === source; });
  var candidates = exact.length ? exact : comment.node_id ? diagrams : [];
  var hits = [];
  candidates.forEach(function (diagram) {
    if (!comment.node_id) { hits.push({ index: diagram.index, diagram: diagram }); return; }
    var nodes = (diagram.nodes || []).filter(function (node) { return node.id === comment.node_id; });
    if (nodes.length === 1) hits.push({ index: diagram.index, diagram: diagram, node: nodes[0] });
  });
  return hits.length === 1 ? Object.assign({ status: 'attached' }, hits[0])
    : { index: -1, status: hits.length > 1 ? 'ambiguous' : 'orphaned' };
}
exports.resolveTarget = resolveTarget;
if (typeof document === 'undefined') return;
var S = window.SDocs, C = window.SDocComments, focus = null, draft = null;
var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></svg>';

function nodesIn(wrapper) {
  return Array.prototype.slice.call(wrapper.querySelectorAll('svg g.node')).map(function (el) {
    var id = el.getAttribute('data-id');
    if (!id) { var match = /^flowchart-(.+)-\d+$/.exec(el.id); id = match && match[1]; }
    return { id: id, text: (el.textContent || '').replace(/\s+/g, ' ').trim(), element: el };
  }).filter(function (node) { return node.id; });
}
function entries() {
  if (!S.renderedEl) return [];
  return Array.prototype.slice.call(S.renderedEl.querySelectorAll('.sdoc-mermaid')).filter(function (wrapper) {
    return !wrapper.closest('.sdoc-slide, .sdoc-card');
  }).map(function (wrapper, index) {
    return { index: index, wrapper: wrapper, source: wrapper._sdMermaidSource || '', nodes: nodesIn(wrapper) };
  });
}
function targetFor(comment, all) {
  if (!comment.anchor_status && comment.document_hash === C.documentFingerprint(S.currentBody)) {
    var index = Number(String(comment.block).split(':')[1]), diagram = all[index];
    var node = diagram && diagram.nodes.filter(function (item) { return item.id === comment.node_id; })[0];
    if (diagram && (!comment.node_id || node)) return { index: index, diagram: diagram, node: node, status: 'attached' };
  }
  return resolveTarget(comment, all);
}
function clearDraft() { if (draft) draft.remove(); draft = null; }
function label(comment) { return comment.node_id ? 'Diagram node: ' + (comment.node_text || comment.node_id) : 'Diagram'; }
function compose(diagram, node, container) {
  clearDraft();
  var prefs = S.commentsUi.readPrefs();
  var anchor = { block: 'diagram:' + diagram.index, diagram_source: diagram.source,
    document_hash: C.documentFingerprint(S.currentBody) };
  if (node) { anchor.node_id = node.id; anchor.node_text = node.text; }
  draft = S.commentsUi.makeCardElement(prefs, { shape: 'sidecar', mode: 'compose', targetLabel: label(anchor),
    onSave: function (text) {
      var result = C.addDiagramComment(S.currentMeta, anchor, { text: text, author: prefs.author, color: prefs.color });
      S.currentMeta = result.meta; clearDraft(); S.syncAll('comment');
    }, onCancel: clearDraft });
  draft.classList.add('sdoc-diagram-card'); container.appendChild(draft);
  draft.querySelector('.sdoc-card-input').focus();
}
function addButton(diagram, container, toolbar) {
  var button = document.createElement('button'); button.type = 'button';
  button.className = toolbar ? 'sdoc-mermaid-focus-btn sdoc-diagram-add' : 'sdoc-mermaid-tool-btn sdoc-diagram-add';
  button.classList.add('sdoc-rich-comment-btn');
  button.innerHTML = ICON; button.title = 'Comment on diagram'; button.setAttribute('aria-label', 'Comment on diagram');
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (!document.body.classList.contains('comment-mode')) S.setMode('comment');
    container.hidden = false; compose(diagram, null, container);
  });
  return button;
}
function bindNodes(diagram, wrapper, container) {
  nodesIn(wrapper).forEach(function (node) {
    var el = node.element;
    el.classList.add('sdoc-diagram-node-commentable'); el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Comment on ' + (node.text || node.id));
    function open(event) { event.preventDefault(); event.stopPropagation(); compose(diagram, node, container); }
    el._sdocCommentClick = open; el.addEventListener('click', open);
    var key = function (event) { if (event.key === 'Enter' || event.key === ' ') open(event); };
    el._sdocCommentKey = key; el.addEventListener('keydown', key);
    var down = function (event) { event.stopPropagation(); };
    el._sdocCommentDown = down; el.addEventListener('mousedown', down);
  });
}
function cleanNodes(root) {
  root.querySelectorAll('.sdoc-diagram-node-commentable').forEach(function (el) {
    el.classList.remove('sdoc-diagram-node-commentable', 'sdoc-diagram-node-commented');
    el.style.removeProperty('--sdoc-anchor-color'); el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label');
    if (el._sdocCommentClick) el.removeEventListener('click', el._sdocCommentClick);
    if (el._sdocCommentKey) el.removeEventListener('keydown', el._sdocCommentKey);
    if (el._sdocCommentDown) el.removeEventListener('mousedown', el._sdocCommentDown);
  });
}
function clear() {
  if (!S.renderedEl) return;
  S.renderedEl.querySelectorAll('.sdoc-diagram-add, .sdoc-diagram-comments').forEach(function (el) { el.remove(); });
  cleanNodes(S.renderedEl);
  if (!document.body.classList.contains('comment-mode')) refreshFocus(entries());
}
function paint(all, container, diagram, wrapper) {
  C.getComments(S.currentMeta).map(C.normalizeComment).filter(function (c) { return c && c.kind === 'diagram'; }).forEach(function (c) {
    var target = targetFor(c, all);
    if (diagram ? target.index !== diagram.index : target.index >= 0) return;
    var card = S.commentsUi.makeCardElement(c, { shape: 'sidecar', mode: 'view', targetLabel: label(c),
      orphaned: target.index < 0, anchorStatus: target.status });
    card.classList.add('sdoc-diagram-card'); container.appendChild(card);
    if (c.node_id && wrapper && target.index >= 0) nodesIn(wrapper).forEach(function (node) {
      if (node.id === c.node_id) { node.element.classList.add('sdoc-diagram-node-commented'); node.element.style.setProperty('--sdoc-anchor-color', c.color); }
    });
  });
}
function render() {
  if (!document.body.classList.contains('comment-mode') || !S.commentsUi) return;
  var all = entries();
  all.forEach(function (diagram) {
    var container = document.createElement('div'); container.className = 'sdoc-diagram-comments';
    diagram.wrapper.insertAdjacentElement('afterend', container);
    var tools = diagram.wrapper.querySelector('.sdoc-mermaid-tools') || diagram.wrapper;
    tools.appendChild(addButton(diagram, container, false));
    bindNodes(diagram, diagram.wrapper, container); paint(all, container, diagram, diagram.wrapper);
  });
  var orphans = document.createElement('div'); orphans.className = 'sdoc-diagram-comments';
  paint(all, orphans, null, null); if (orphans.childElementCount) S.renderedEl.appendChild(orphans);
  refreshFocus(all);
}
function refreshFocus(all) {
  if (!focus || !focus.modal.isConnected || hasDraft()) return;
  var found = all.filter(function (diagram) { return diagram.wrapper === focus.wrapper; });
  if (!found.length && focus.documentHash === C.documentFingerprint(S.currentBody)) {
    var original = all[focus.index];
    if (original && original.source.trim() === focus.source.trim()) found = [original];
  }
  if (!found.length) found = all.filter(function (diagram) { return diagram.source.trim() === focus.source.trim(); });
  if (!found.length && S.currentBody.indexOf(focus.source.trim()) >= 0) return;
  if (found.length !== 1) { focus.close(); return; }
  var diagram = found[0], enabled = document.body.classList.contains('comment-mode');
  focus.panel.replaceChildren(); focus.panel.hidden = !enabled;
  cleanNodes(focus.svg); focus.bar.querySelectorAll('.sdoc-diagram-add').forEach(function (el) { el.remove(); });
  (focus.bar.querySelector('.sdoc-mermaid-focus-actions') || focus.bar).appendChild(addButton(diagram, focus.panel, true));
  if (!enabled) return;
  bindNodes(diagram, focus.svg, focus.panel); paint(all, focus.panel, diagram, focus.svg);
}
function attachFocus(wrapper, modal, svg, bar, close) {
  var panel = document.createElement('div'); panel.className = 'sdoc-diagram-focus-comments';
  modal.appendChild(panel);
  focus = { source: wrapper._sdMermaidSource || '', wrapper: wrapper,
    index: entries().findIndex(function (diagram) { return diagram.wrapper === wrapper; }),
    documentHash: C.documentFingerprint(S.currentBody), modal: modal, svg: svg, bar: bar, panel: panel, close: close };
  refreshFocus(entries());
}
function hasDraft() { return !!((draft && draft.isConnected) ||
  (focus && focus.modal.isConnected && focus.modal.querySelector('.sdoc-card-edit'))); }
S.diagramComments = { render: render, clear: clear, attachFocus: attachFocus,
  detachFocus: function () { clearDraft(); focus = null; }, hasDraft: hasDraft,
  resolveTarget: function (c) { return targetFor(c, entries()); } };
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsDiagramComments = {}));
