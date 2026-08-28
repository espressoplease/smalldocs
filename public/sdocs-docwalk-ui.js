// sdocs-docwalk-ui.js - guided agent annotations for rendered Markdown.
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};
var DW = window.SDocDocwalk;
var currentKey = '';
var currentModel = { steps: [], total: 0 };
var currentIndex = -1;
var resolvedByStep = [];
var didInitialScroll = false;

function isCodewalk() {
  return !!(window.SDocCodewalk && window.SDocCodewalk.isCodewalk(S.currentMeta));
}

function active() {
  return !!(DW && (DW.isDocwalk(S.currentMeta) || isCodewalk()));
}

function modelKey() {
  var body = String(S.currentBody || '');
  var annotations = S.currentMeta && S.currentMeta.annotations;
  var encoded = '';
  try { encoded = JSON.stringify(annotations || []); } catch (_) {}
  return body.length + ':' + body.slice(0, 80) + ':' + encoded;
}

function strip() {
  if (!S.renderedEl) return;
  S.renderedEl.querySelectorAll('.sdoc-docwalk-card, .sdoc-docwalk-stack')
    .forEach(function (element) { element.remove(); });
  S.renderedEl.querySelectorAll('.sdoc-docwalk-inline').forEach(function (span) {
    var parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
  S.renderedEl.querySelectorAll('.sdoc-docwalk-target, .sdoc-docwalk-target-active')
    .forEach(function (element) {
      element.classList.remove('sdoc-docwalk-target', 'sdoc-docwalk-target-active');
    });
  S.renderedEl.querySelectorAll('.sdoc-docwalk-code').forEach(function (surface) {
    surface.remove();
  });
  S.renderedEl.querySelectorAll('pre.sdoc-docwalk-code-source').forEach(function (pre) {
    pre.classList.remove('sdoc-docwalk-code-source');
    pre.removeAttribute('data-docwalk-pre-index');
  });
}

function topLevelMatches(selector) {
  if (!S.renderedEl) return [];
  return Array.prototype.filter.call(S.renderedEl.querySelectorAll(selector), function (element) {
    var parent = element.parentElement;
    while (parent && parent !== S.renderedEl) {
      if (parent.matches && parent.matches(
        'p, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, table, .sdoc-chart')) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
}

function findBlock(target) {
  if (target.file && S.renderedEl) {
    var named = S.renderedEl.querySelectorAll('pre[data-file]');
    for (var n = 0; n < named.length; n++) {
      if (named[n].getAttribute('data-file') === target.file) return named[n];
    }
  }
  var id = target.type + ':' + target.index;
  if (S.commentsUi && S.commentsUi._findBlockById) {
    var hint = target.source ? plainInline(target.source).slice(0, 60) : '';
    var found = S.commentsUi._findBlockById(id, S.renderedEl, hint);
    if (found) return found;
  }
  var selector = target.type === 'chart' ? '.sdoc-chart' : target.type;
  return topLevelMatches(selector)[target.index] || null;
}

function plainInline(source) {
  if (!source) return '';
  try {
    var holder = document.createElement('div');
    holder.innerHTML = DOMPurify.sanitize(marked.parseInline(source), { FORBID_ATTR: ['style'] });
    return (holder.textContent || '').replace(/\s+/g, ' ').trim();
  } catch (_) {
    return String(source).replace(/[*_`~\[\]]/g, '').trim();
  }
}

function wrapRange(range) {
  if (!range || range.collapsed) return null;
  var span = document.createElement('span');
  span.className = 'sdoc-docwalk-inline sdoc-docwalk-target';
  try {
    range.surroundContents(span);
  } catch (_) {
    try {
      var fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    } catch (__) { return null; }
  }
  return span;
}

// Keep highlight.js spans valid on every logical source line. This is the same
// balancing rule the fullscreen code viewer uses before it builds line rows.
function splitHighlightedLines(html) {
  var lines = String(html).split('\n');
  var out = [];
  var open = [];
  for (var i = 0; i < lines.length; i++) {
    var prefix = open.join('');
    var re = /<span\b[^>]*>|<\/span>/g;
    var match;
    while ((match = re.exec(lines[i]))) {
      if (match[0] === '</span>') open.pop();
      else open.push(match[0]);
    }
    out.push(prefix + lines[i] + new Array(open.length + 1).join('</span>'));
  }
  return out;
}

function codeSurface(pre, target) {
  var wrapper = pre && pre.closest ? pre.closest('.pre-wrapper') : null;
  if (!wrapper) return null;
  var selector = '.sdoc-docwalk-code[data-pre-index="' + target.index + '"]';
  var existing = wrapper.querySelector(selector);
  if (existing) return existing;
  var code = pre.querySelector('code');
  if (!code) return null;

  var parts = splitHighlightedLines(code.innerHTML);
  if (parts.length > target.codeLineCount) parts = parts.slice(0, target.codeLineCount);
  while (parts.length < target.codeLineCount) parts.push('');

  var surface = document.createElement('div');
  surface.className = 'sdoc-docwalk-code';
  surface.setAttribute('data-pre-index', target.index);
  surface.setAttribute('role', 'region');
  surface.setAttribute('aria-label', 'Annotated code');
  for (var i = 0; i < parts.length; i++) {
    var row = document.createElement('div');
    row.className = 'sdoc-docwalk-code-row';
    row.setAttribute('data-code-line', i + 1);
    var number = document.createElement('span');
    number.className = 'sdoc-docwalk-code-number';
    number.textContent = i + 1;
    var text = document.createElement('span');
    text.className = 'sdoc-docwalk-code-text';
    text.innerHTML = parts[i] || ' ';
    row.appendChild(number);
    row.appendChild(text);
    surface.appendChild(row);
  }
  pre.classList.add('sdoc-docwalk-code-source');
  pre.setAttribute('data-docwalk-pre-index', target.index);
  wrapper.insertBefore(surface, pre);
  return surface;
}

function textRangeForQuote(root, quote) {
  if (!root || !quote) return null;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  var text = '';
  var node;
  while ((node = walker.nextNode())) {
    nodes.push({ node: node, start: text.length, end: text.length + node.nodeValue.length });
    text += node.nodeValue;
  }
  var at = text.indexOf(quote);
  if (at < 0) return null;
  var end = at + quote.length;
  var startNode = null;
  var endNode = null;
  for (var i = 0; i < nodes.length; i++) {
    if (!startNode && at >= nodes[i].start && at < nodes[i].end) startNode = nodes[i];
    if (end > nodes[i].start && end <= nodes[i].end) { endNode = nodes[i]; break; }
  }
  if (!startNode || !endNode) return null;
  var range = document.createRange();
  range.setStart(startNode.node, at - startNode.start);
  range.setEnd(endNode.node, end - endNode.start);
  return range;
}

function resolveCodeTarget(pre, target) {
  var surface = codeSurface(pre, target);
  if (!surface) return null;
  var marks = [];
  var first = target.codeLine || 1;
  var last = target.codeEndLine || first;
  for (var line = first; line <= last; line++) {
    var row = surface.querySelector('.sdoc-docwalk-code-row[data-code-line="' + line + '"]');
    if (!row) continue;
    row.classList.add('sdoc-docwalk-code-mark', 'sdoc-docwalk-target');
    marks.push(row);
  }
  if (!marks.length) return null;

  if (target.quote) {
    for (var i = 0; i < marks.length; i++) {
      var text = marks[i].querySelector('.sdoc-docwalk-code-text');
      var range = textRangeForQuote(text, target.quote);
      var token = range && wrapRange(range);
      if (token) {
        marks.forEach(function (mark) {
          mark.classList.remove('sdoc-docwalk-target');
        });
        token.classList.add('sdoc-docwalk-code-token');
        return { element: marks[marks.length - 1], marks: [token] };
      }
    }
  }
  return { element: marks[marks.length - 1], marks: marks };
}

function resolveTarget(target) {
  var element = null;
  if (target.kind === 'block') element = findBlock(target);
  else if (target.kind === 'rich' && S.renderedEl) {
    element = S.renderedEl.querySelectorAll(target.selector)[target.index] || null;
  }
  if (!element) return null;

  if (target.code) return resolveCodeTarget(element, target);

  if (target.kind === 'rich' && target.selector === '.sdoc-cells') {
    var pane = element.closest && element.closest('.sdoc-cells-pane');
    var mark = pane || element;
    mark.classList.add('sdoc-docwalk-target');
    return { element: element, mark: mark };
  }

  if (target.kind === 'block' && target.inline && target.source &&
      S.commentsUi && S.commentsUi._resolveAnchor) {
    var quote = plainInline(target.source);
    if (quote) {
      var resolved = S.commentsUi._resolveAnchor({
        kind: 'inline', block: target.type + ':' + target.index,
        quote: quote, prefix: '', suffix: '',
      }, S.renderedEl);
      var span = resolved && wrapRange(resolved.range);
      if (span) return { element: element, mark: span };
    }
  }

  element.classList.add('sdoc-docwalk-target');
  return { element: element, mark: element };
}

function insertionAnchor(element) {
  if (!element) return null;
  if (element.classList && element.classList.contains('sdoc-docwalk-code-row')) return element;
  var cellsPane = element.closest && element.closest('.sdoc-cells-pane');
  if (cellsPane) return cellsPane;
  var tableHost = element.closest && element.closest('.sdoc-table-host');
  if (tableHost) return tableHost;
  var tableScroll = element.closest && element.closest('.md-table-scroll');
  if (tableScroll) return tableScroll;
  var blockHost = element.closest && element.closest('.sdoc-block-host');
  if (blockHost) return blockHost;
  var preWrapper = element.closest && element.closest('.pre-wrapper');
  if (preWrapper) return preWrapper;
  return element;
}

function stackAfter(anchor, stacks) {
  if (!anchor || !anchor.parentNode) return null;
  for (var i = 0; i < stacks.length; i++) {
    if (stacks[i].anchor === anchor) return stacks[i].stack;
  }
  var stack = document.createElement('div');
  stack.className = 'sdoc-docwalk-stack';
  anchor.parentNode.insertBefore(stack, anchor.nextSibling);
  stacks.push({ anchor: anchor, stack: stack });
  return stack;
}

function navButton(action, label, disabled) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'sdoc-docwalk-nav sdoc-walkthrough-nav is-' + action;
  button.setAttribute('data-docwalk', action);
  button.disabled = !!disabled;
  if (action === 'prev') {
    button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>' + label + '</span>';
  } else if (action === 'next') {
    button.innerHTML = '<span>' + label + '</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  } else {
    button.title = 'Back to start';
    button.setAttribute('aria-label', 'Back to the first step');
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  }
  return button;
}

function cardFor(step) {
  var card = document.createElement('aside');
  card.className = 'sdoc-docwalk-card sdoc-walkthrough-card';
  if (step.index === currentModel.total - 1) card.classList.add('is-last');
  card.setAttribute('data-docwalk-step', step.index);

  var body = document.createElement('div');
  body.className = 'sdoc-docwalk-note';
  body.innerHTML = S.renderMarkdownSafe ? S.renderMarkdownSafe(step.text) : '';
  card.appendChild(body);

  var footer = document.createElement('div');
  footer.className = 'sdoc-docwalk-step sdoc-walkthrough-step';
  footer.appendChild(navButton('prev', 'Prev', step.index === 0));
  var position = document.createElement('span');
  position.className = 'sdoc-docwalk-position sdoc-walkthrough-position';
  position.textContent = 'Step ' + (step.index + 1) + ' of ' + currentModel.total;
  footer.appendChild(position);
  var actions = document.createElement('span');
  actions.className = 'sdoc-docwalk-actions sdoc-walkthrough-actions';
  actions.appendChild(navButton('restart', '', step.index === 0));
  actions.appendChild(navButton('next', 'Next', step.index === currentModel.total - 1));
  footer.appendChild(actions);
  card.appendChild(footer);
  return card;
}

function revealSections(element) {
  var body = element && element.closest ? element.closest('.md-section-body') : null;
  while (body) {
    body.classList.add('open');
    var section = body.closest('.md-section');
    var heading = section && section.querySelector(
      ':scope > h2, :scope > h3, :scope > h4, :scope > .sdoc-block-host > h2, :scope > .sdoc-block-host > h3, :scope > .sdoc-block-host > h4');
    var toggle = heading && heading.querySelector(':scope > .section-toggle');
    if (toggle) toggle.classList.add('open');
    body = section && section.parentElement ? section.parentElement.closest('.md-section-body') : null;
  }
}

function revealCells(element) {
  var pane = element && element.closest ? element.closest('.sdoc-cells-pane') : null;
  if (!pane) return;
  var sheets = Array.prototype.slice.call(pane.querySelectorAll('.sdoc-cells'));
  var index = sheets.indexOf(element.closest('.sdoc-cells'));
  var tabs = pane.querySelectorAll('.sdoc-cells-pane-tab');
  if (index >= 0 && tabs[index] && !tabs[index].classList.contains('is-active')) tabs[index].click();
}

function syncActive(scroll) {
  if (!S.renderedEl) return;
  S.renderedEl.querySelectorAll('.sdoc-docwalk-target-active')
    .forEach(function (element) { element.classList.remove('sdoc-docwalk-target-active'); });
  S.renderedEl.querySelectorAll('.sdoc-docwalk-card.is-active')
    .forEach(function (element) { element.classList.remove('is-active'); });

  var resolved = resolvedByStep[currentIndex] || [];
  resolved.forEach(function (item) {
    (item.marks || [item.mark]).filter(Boolean).forEach(function (mark) {
      mark.classList.add('sdoc-docwalk-target-active');
    });
  });
  var card = S.renderedEl.querySelector('.sdoc-docwalk-card[data-docwalk-step="' + currentIndex + '"]');
  if (card) card.classList.add('is-active');
  if (!scroll) return;

  var target = resolved[0] && resolved[0].element;
  if (target) {
    revealSections(target);
    revealCells(target);
  }
  requestAnimationFrame(function () {
    var destination = card || target;
    if (destination && destination.isConnected) {
      destination.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function goTo(index, options) {
  if (!currentModel.total) return;
  currentIndex = DW.clamp(index, currentModel.total);
  syncActive(!(options && options.scroll === false));
}

function codewalkModel() {
  var CW = window.SDocCodewalk;
  if (!CW || !S.renderedEl) return { steps: [], total: 0 };
  var model = CW.build(S.currentMeta);
  var pres = Array.prototype.slice.call(S.renderedEl.querySelectorAll('pre[data-file]'));
  var byFile = Object.create(null);
  pres.forEach(function (pre, index) {
    var code = pre.querySelector('code');
    var text = code ? code.textContent || '' : '';
    if (text.slice(-1) === '\n') text = text.slice(0, -1);
    byFile[pre.getAttribute('data-file')] = {
      index: index, count: Math.max(1, text.split('\n').length),
    };
  });
  var steps = [];
  model.steps.forEach(function (step) {
    var info = byFile[step.file];
    if (!info) return;
    var line = Math.max(1, Math.min(info.count, step.line));
    var endLine = Math.max(line, Math.min(info.count, step.endLine));
    steps.push({
      line: step.line, endLine: step.endLine, text: step.text, index: step.index,
      targets: [{
        kind: 'block', type: 'pre', index: info.index, file: step.file,
        code: true, codeLineCount: info.count, codeLine: line,
        codeEndLine: endLine, quote: step.quote || '',
      }],
    });
  });
  return { steps: steps, total: model.total };
}

function codeContextForPre(pre) {
  if (!active() || !pre) return null;
  var rawIndex = pre.getAttribute('data-docwalk-pre-index');
  var selectedKey = rawIndex == null ? '' : 'pre:' + rawIndex;
  if (!selectedKey) return null;
  var byFile = Object.create(null);
  var preByFile = Object.create(null);
  var stepFile = Object.create(null);
  var pres = S.renderedEl.querySelectorAll('pre[data-docwalk-pre-index]');
  for (var p = 0; p < pres.length; p++) {
    var key = 'pre:' + pres[p].getAttribute('data-docwalk-pre-index');
    preByFile[key] = pres[p];
  }
  currentModel.steps.forEach(function (step) {
    step.targets.forEach(function (target) {
      if (!target.code) return;
      var key = 'pre:' + target.index;
      var note = {
        line: target.codeLine, endLine: target.codeEndLine, text: step.text,
        quote: target.quote || '', index: step.index,
      };
      (byFile[key] || (byFile[key] = [])).push(note);
      if (stepFile[step.index] == null) stepFile[step.index] = key;
    });
  });
  var selected = byFile[selectedKey] || [];
  if (!selected.length) return null;
  var stepIndex = currentIndex;
  if (!selected.some(function (note) { return note.index === stepIndex; })) {
    stepIndex = selected[0].index;
  }
  return {
    steps: currentModel.steps, byFile: byFile, preByFile: preByFile,
    stepFile: stepFile, stepIndex: stepIndex, selectedKey: selectedKey,
  };
}

function render() {
  if (!S.renderedEl) return;
  strip();
  if (!active() || !window.marked || typeof window.marked.lexer !== 'function') {
    currentModel = { steps: [], total: 0 };
    currentIndex = -1;
    resolvedByStep = [];
    return;
  }

  var key = modelKey();
  if (key !== currentKey) {
    currentKey = key;
    currentIndex = 0;
    didInitialScroll = false;
  }
  currentModel = isCodewalk()
    ? codewalkModel()
    : DW.build(S.currentMeta, S.currentBody, window.marked.lexer);
  currentIndex = DW.clamp(currentIndex, currentModel.total);
  resolvedByStep = [];
  var stacks = [];

  currentModel.steps.forEach(function (step) {
    var resolved = step.targets.map(resolveTarget).filter(Boolean);
    resolvedByStep[step.index] = resolved;
    if (!resolved.length) return;
    var anchor = insertionAnchor(resolved[resolved.length - 1].element);
    var stack = stackAfter(anchor, stacks);
    if (stack) stack.appendChild(cardFor(step));
  });
  syncActive(false);
  if (!didInitialScroll && currentModel.total && resolvedByStep[currentIndex] &&
      resolvedByStep[currentIndex].length) {
    didInitialScroll = true;
    syncActive(true);
  }
}

function handleClick(event) {
  var button = event.target.closest('[data-docwalk]');
  if (!button || button.disabled) return;
  var action = button.getAttribute('data-docwalk');
  if (action === 'prev') goTo(currentIndex - 1);
  else if (action === 'next') goTo(currentIndex + 1);
  else if (action === 'restart') goTo(0);
}

function handleKey(event) {
  if (!active() || !currentModel.total || event.defaultPrevented || event.metaKey ||
      event.ctrlKey || event.altKey || event.shiftKey) return;
  var target = event.target;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if (document.querySelector('.sdoc-code-focus, .sdoc-present, .sdoc-mermaid-focus')) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); goTo(currentIndex + 1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(currentIndex - 1); }
}

document.addEventListener('click', handleClick);
document.addEventListener('keydown', handleKey);

S.docwalk = {
  render: render,
  onHostRender: render,
  goTo: goTo,
  active: active,
  model: function () { return currentModel; },
  currentIndex: function () { return currentIndex; },
  codeContextForPre: codeContextForPre,
};

})();
