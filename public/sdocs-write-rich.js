// Rendered editing islands keep their source separate from generated DOM.
(function () {
'use strict';
var S = window.SDocs, current = null, serial = 0;
function active(owner) { return current === owner && !owner.destroyed; }
function sourcePre(entry) {
  var pre = entry.pre.cloneNode(true); pre.querySelector('code').textContent = entry.source;
  return pre;
}
function cloneSource(node) {
  if (!node || node.nodeType !== 1 || !current) return node.cloneNode(true);
  function replacement(original) {
    var entry = current.entries.find(function (entry) { return entry.host === original; });
    return entry ? sourcePre(entry) : original.cloneNode(true);
  }
  if (node.matches('.sdoc-write-rich')) return replacement(node);
  var copy = node.cloneNode(true), originals = node.querySelectorAll('.sdoc-write-rich');
  copy.querySelectorAll('.sdoc-write-rich').forEach(function (host, index) { host.replaceWith(replacement(originals[index])); });
  return copy;
}
function signal(owner, type) {
  if (!active(owner)) return;
  var event = new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' });
  event._sdocRichInputType = type || 'formatRich';
  event._sdocRichGroup = owner.historyGroup; S.writeEl.dispatchEvent(event);
}
function update(owner, entry, source, type) {
  if (!active(owner) || !entry.host.isConnected || entry.source === source) return;
  entry.source = source; signal(owner, type);
}
function teardown(commit) {
  var owner = current;
  if (!owner) return;
  if (commit !== false && owner.finish) owner.finish(false);
  owner.destroyed = true; current = null;
  if (owner.finish) owner.finish(true);
  if (owner.overlay) owner.overlay.remove();
  owner.editors.forEach(function (editor) { editor.detach(false); });
  if (owner.cellsFocus) owner.cellsFocus.destroy();
  if (owner.cellsEditor) owner.cellsEditor.destroy();
  if (owner.cellsUI) owner.cellsUI.destroy();
  if (owner.selection) owner.selection.destroy();
  if (owner.slides) owner.slides.destroy();
  if (owner.mermaid) owner.mermaid.destroy();
}
function fieldInput(owner, entry, target, field) {
  if (!active(owner)) return;
  if (owner.finish) owner.finish(false);
  owner.historyGroup = owner.id + ':' + owner.entries.indexOf(entry) + ':' + field.key;
  var original = entry.source, rect = target.getBoundingClientRect();
  var input = document.createElement('textarea'); input.className = 'sdoc-cells-editor sdoc-write-label-editor';
  input.setAttribute('aria-label', 'Diagram text'); input.value = field.text;
  input.style.left = Math.max(8, Math.min(rect.left, innerWidth - 248)) + 'px';
  input.style.top = Math.max(8, Math.min(rect.top, innerHeight - 88)) + 'px';
  input.style.width = Math.min(innerWidth - 16, Math.max(240, rect.width)) + 'px'; input.style.height = '72px';
  input.style.font = getComputedStyle(target.querySelector('text') || target).font;
  if (parseFloat(input.style.fontSize) < 16) input.style.fontSize = '16px';
  document.body.appendChild(input); owner.overlay = input;
  var done = false;
  function finish(cancel) {
    if (done) return; done = true; owner.finish = null; owner.overlay = null;
    input.removeEventListener('blur', onBlur); input.remove();
    if (active(owner)) queueMicrotask(function () { window.dispatchEvent(new Event('sdocs-rich-write-finish')); });
    update(owner, entry, cancel ? original : window.SDocRichEdit.setMermaidText(original, field.key, input.value));
    if (active(owner)) renderDiagram(owner, entry);
  }
  function onBlur() { finish(false); }
  owner.finish = finish;
  input.addEventListener('input', function () { update(owner, entry, window.SDocRichEdit.setMermaidText(original, field.key, input.value), 'insertRichText'); });
  input.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(true); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', onBlur); input.focus(); input.select();
}
function diagramTargets(entry) {
  var fields = window.SDocRichEdit.mermaidFields(entry.source), wrapper = entry.host.querySelector('.sdoc-mermaid'), out = [];
  if (!wrapper) return out;
  ( /^\s*(?:flowchart|graph)\s+[A-Z]+\b/m.test(entry.source) ? wrapper.querySelectorAll('svg g.node') : [] ).forEach(function (node) {
    var id = node.getAttribute('data-id') || (node.id.match(/^flowchart-(.+)-\d+$/) || [])[1];
    if (!id) return;
    var field = window.SDocRichEdit.mermaidField(entry.source, 'node:' + id);
    if (field) out.push({ element: node, field: field });
  });
  fields.filter(function (field) { return field.kind === 'actor'; }).forEach(function (field) {
    wrapper.querySelectorAll('rect.actor[name],g.actor-man[name]').forEach(function (node) {
      if (node.getAttribute('name') === field.id) out.push({ element: node.parentElement, field: field });
    });
  });
  var messages = wrapper.querySelectorAll('text.messageText'), sourceMessages = fields.filter(function (field) { return field.kind === 'message'; });
  if (messages.length === sourceMessages.length) messages.forEach(function (node, i) { out.push({ element: node, field: sourceMessages[i] }); });
  return out;
}
function renderDiagram(owner, entry) {
  var generation = ++entry.generation;
  entry.host.replaceChildren(sourcePre(entry));
  return owner.mermaid.processMermaid(entry.host).then(function () {
    if (!active(owner) || generation !== entry.generation) return;
    diagramTargets(entry).forEach(function (target) {
      var element = target.element; element.classList.add('sdoc-write-diagram-label');
      element.setAttribute('tabindex', '0'); element.setAttribute('role', 'button'); element.setAttribute('aria-label', 'Edit diagram text' + (target.field.text || target.field.id ? ': ' + (target.field.text || target.field.id) : ''));
      function open(event) { event.preventDefault(); event.stopPropagation(); fieldInput(owner, entry, element, target.field); }
      element.addEventListener('click', open);
      element.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ') open(event); });
    });
  });
}
function renderSlides(owner) {
  owner.entries.filter(function (entry) { return entry.kind === 'slide'; }).forEach(function (entry) { entry.host.replaceChildren(sourcePre(entry)); });
  var result = owner.slides.process(S.writeEl);
  return result.ready.then(function (slides) {
    if (!active(owner)) return;
    slides.forEach(function (slide) {
      var host = slide.element.closest('.sdoc-write-rich'), entry = owner.entries.find(function (entry) { return entry.host === host; });
      if (!entry) return;
      var fields = window.SDocRichEdit.slideFields(entry.source, window.SDocShapes);
      slide.element.querySelectorAll('.shape-md').forEach(function (textHost) {
        var box = textHost.closest('[data-shape-idx]'), index = box && Number(box.dataset.shapeIdx), shape = slide.result.shapes[index];
        var field = fields.find(function (field) { return field.kind === 'slot' ? field.id === shape.id : field.index === index; });
        if (!field && /^\s*@extends\b/m.test(entry.source) && shape.id) field = { kind: 'slot', key: 'slot:' + shape.id, id: shape.id, text: shape.content, start: entry.source.length, end: entry.source.length };
        var inner = textHost.shadowRoot && textHost.shadowRoot.querySelector('.inner');
        if (!field || !inner || /^(?: {0,3})(?:`{3,}|~{3,})/m.test(field.text) || inner.querySelector('pre,svg,canvas,iframe,.sdoc-cells,.sdoc-mermaid')) return;
        var originalHTML = inner.innerHTML, originalSource = entry.source, startingText = field.text, focusedField = field;
        inner.contentEditable = 'true'; inner.setAttribute('role', 'textbox'); inner.setAttribute('aria-label', 'Slide text'); inner.setAttribute('aria-multiline', 'true');
        inner.classList.add('sdoc-editable-slide-text');
        var style = document.createElement('style'); style.textContent = '.sdoc-editable-slide-text:focus{outline:1px solid currentColor;outline-offset:3px;cursor:text}.sdoc-editable-slide-text{cursor:text;min-height:1em;min-width:1em}.sdoc-editable-slide-text:empty::before{content:"\\200B"}';
        textHost.shadowRoot.appendChild(style);
        function sync() {
          if (!active(owner) || !entry.host.isConnected) return;
          var copy = inner.cloneNode(true); copy.querySelectorAll('button').forEach(function (node) { node.remove(); });
          var text = inner.innerHTML === originalHTML ? startingText : S.serializeWriteFragment(copy).replace(/\n$/, '');
          update(owner, entry, window.SDocRichEdit.setSlideText(originalSource, focusedField, text), 'insertRichText');
        }
        inner.addEventListener('input', sync);
        inner.addEventListener('focus', function () {
          owner.historyGroup = owner.id + ':' + owner.entries.indexOf(entry) + ':' + field.key;
          if (owner.finish) owner.finish(false);
          originalHTML = inner.innerHTML; originalSource = entry.source;
          focusedField = window.SDocRichEdit.slideFields(originalSource, window.SDocShapes).find(function (candidate) { return candidate.key === field.key; }) || field;
          startingText = focusedField.text;
          var done = false;
          owner.finish = function (cancel) {
            if (done) return; done = true; owner.finish = null;
            if (cancel) { inner.innerHTML = originalHTML; update(owner, entry, originalSource); }
            else sync();
            slide.result.shapes[index].content = window.SDocRichEdit.slideFields(entry.source, window.SDocShapes).find(function (candidate) { return candidate.key === field.key; })?.text || '';
            if (slide.result.refit) slide.result.refit();
            if (active(owner)) queueMicrotask(function () { window.dispatchEvent(new Event('sdocs-rich-write-finish')); });
          };
        });
        inner.addEventListener('blur', function () { if (owner.finish) owner.finish(false); });
        inner.addEventListener('keydown', function (event) {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') { event.preventDefault(); if (owner.finish) owner.finish(true); inner.blur(); }
        });
        inner.addEventListener('paste', function (event) { event.preventDefault(); event.stopPropagation(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); });
        inner.addEventListener('drop', function (event) { event.preventDefault(); event.stopPropagation(); document.execCommand('insertText', false, event.dataTransfer.getData('text/plain')); });
      });
    });
  });
}
function persistCells(owner, model) {
  var entry = owner.entries.find(function (entry) { return model.__sdocWriteWrapper && entry.host.contains(model.__sdocWriteWrapper); });
  if (!entry) entry = owner.entries.find(function (entry) { return entry.model === model; });
  if (!entry) return;
  update(owner, entry, window.SDocRichEdit.cellsSource(entry.source, model, window.SDocCells));
  if (active(owner)) queueMicrotask(function () { window.dispatchEvent(new Event('sdocs-rich-write-finish')); });
  owner.cellsState.cellsWorkbook.forEach(function (sheet) {
    if (sheet.wrapper) { sheet.wrapper._cellsModelOriginal = false; sheet.wrapper._cellsRepaint(); }
  });
}
function attachCells(owner, wrapper, model) {
  var entry = owner.entries.find(function (entry) { return entry.host.contains(wrapper); });
  // onGridBuilt runs before mountGrid inserts its wrapper. Bind after mounting.
  if (!entry) return;
  entry.model = model; model.__sdocWriteWrapper = wrapper;
  var api = owner.cellsEditor.attach(wrapper, { onChange: function () { persistCells(owner, model); } });
  owner.editors.push(api);
}
function cellsInfo(code, pre, source) {
  var info = String(pre.dataset.sdocsFenceInfo || '').replace(/^cells(?:\s+|$)/i, ''), parsed = window.SDocCells.parseFenceInfo(info);
  if (!parsed.name && !parsed.workbook) return source;
  return 'sdoc-cells: ' + (parsed.name ? 'name=' + JSON.stringify(parsed.name) + ' ' : '') + (parsed.workbook ? 'workbook=' + JSON.stringify(parsed.workbook) : '') + '\n' + source;
}
function hydrate() {
  teardown(false);
  var owner = { id: ++serial, entries: [], editors: [], destroyed: false, cellsState: { currentMeta: S.currentMeta } };
  current = owner;
  S.writeEl.querySelectorAll('pre > code').forEach(function (code) {
    var kind = (code.className.match(/(?:^|\s)language-(cells|slide|mermaid)(?:\s|$)/) || [])[1];
    if (!kind) return;
    var pre = code.parentElement, host = document.createElement('div'); host.className = 'sdoc-write-rich'; host.contentEditable = 'false'; host.dataset.richKind = kind;
    if (pre.hasAttribute('data-sdoc-write-block')) host.setAttribute('data-sdoc-write-block', pre.getAttribute('data-sdoc-write-block'));
    pre.replaceWith(host); host.appendChild(pre);
    owner.entries.push({ host: host, pre: pre.cloneNode(true), source: code.textContent, kind: kind, generation: 0 });
  });
  var jobs = [];
  if (owner.entries.some(function (entry) { return entry.kind === 'mermaid'; })) {
    owner.mermaid = window.SDocMermaidCore.create({ window: window, document: document, root: S.writeEl, scope: S.writeEl, sdocs: {}, isActive: function () { return active(owner); } });
    owner.entries.filter(function (entry) { return entry.kind === 'mermaid'; }).forEach(function (entry) { jobs.push(renderDiagram(owner, entry)); });
  }
  if (owner.entries.some(function (entry) { return entry.kind === 'slide'; })) {
    owner.slides = window.SDocSlideReader.create({ shapes: window.SDocShapes, renderer: window.SDocShapeRender, resolver: window.SDocSlideResolve,
      templates: window.SDocSlideStdlib && window.SDocSlideStdlib.templates });
    jobs.push(renderSlides(owner));
  }
  if (owner.entries.some(function (entry) { return entry.kind === 'cells'; })) {
    owner.selection = window.SDocCellsSelection.create({ window: window, document: document });
    owner.cellsUI = window.SDocCellsUI.create({ window: window, document: document, state: owner.cellsState, cells: window.SDocCells,
      formula: window.SDocCellsFormula, controller: window.SDocCellsController, selection: owner.selection, sourceForCode: cellsInfo,
      loadFeature: function (name) {
        if (name !== 'focus') return S.loadCellsFeature(name);
        return owner.cellsReady.then(function () {
          if (!active(owner)) throw new Error('This editor is closed.');
          if (!owner.cellsFocus) owner.cellsFocus = window.SDocCellsFocus.create({
            window: window, document: document, cells: window.SDocCells, formula: window.SDocCellsFormula, controller: owner.cellsUI.controller, editor: owner.cellsEditor,
            buildGrid: owner.cellsUI.buildGrid, buildCopyControls: owner.cellsUI.buildCopyControls, formatStats: owner.cellsUI.formatStats,
            themeSource: function () { return S.writeEl; }, isActive: function () { return active(owner); },
            onChange: function (model) { persistCells(owner, model); }, onEdited: function (model) { persistCells(owner, model); },
            loadFeature: function (feature) { return S.loadCellsFeature(feature); },
          });
          return owner.cellsFocus;
        });
      }, isActive: function () { return active(owner); } });
    owner.cellsUI.processCells(S.writeEl);
    owner.cellsReady = S.loadCellsFeature('focus').then(function () {
      if (!active(owner)) return;
      owner.cellsEditor = window.SDocCellsEdit.create({ window: window, document: document, cells: window.SDocCells, formula: window.SDocCellsFormula, isActive: function () { return active(owner); } });
      owner.cellsState.cellsWorkbook.forEach(function (sheet) { if (sheet.wrapper) attachCells(owner, sheet.wrapper, sheet.model); });
    });
    jobs.push(owner.cellsReady);
  }
  return Promise.all(jobs).catch(function (error) { if (active(owner) && S.setStatus) S.setStatus(error.message, 'error'); });
}
S.richWrite = {
  hydrate: hydrate, cloneSource: cloneSource, destroy: teardown,
  retheme: function () {
    var owner = current; if (!owner) return;
    if (owner.cellsFocus) owner.cellsFocus.refreshTheme();
    if (owner.finish) return;
    owner.entries.filter(function (entry) { return entry.kind === 'mermaid'; }).forEach(function (entry) { renderDiagram(owner, entry); });
  },
  finish: function (cancel) {
    if (!current) return;
    if (current.cellsFocus) current.cellsFocus.close();
    current.editors.forEach(function (editor) { if (editor) editor.commitOpen(); });
    if (current.finish) current.finish(!!cancel);
  },
  commitCells: function () {
    if (!current) return;
    current.editors.forEach(function (editor) { if (editor) editor.commitOpen(); });
    if (current.cellsFocus) current.cellsFocus.commitOpen();
  },
  hasActiveField: function () { return !!(current && (current.finish || current.editors.some(function (editor) { return editor && editor.isEditing(); }) || current.cellsFocus && current.cellsFocus.isEditing())); },
};
})();
