// sdocs-write.js — Write mode: contentEditable WYSIWYG with markdown shortcuts
(function () {
'use strict';

var S = SDocs;
var writeEl = document.getElementById('_sd_write');
S.writeEl = writeEl;
var editSession = null;
var sourceBlockAttribute = 'data-sdoc-write-block';
var writeHistory = null;
var undoButton = document.getElementById('_sd_wb-undo');
var beforeInputSelection = null;

// Compare the editable structure, not KaTeX's generated display markup.
// Checkbox state is a property, so include it even before HTML reflects it.
function editorSignature(nodes) {
  return Array.prototype.map.call(nodes, function (node) {
    if (node.nodeType === 3) return node.textContent.trim() ? node.textContent : '';
    if (node.nodeType !== 1) return '';
    var copy = S.richWrite ? S.richWrite.cloneSource(node) : node.cloneNode(true);
    var originals = Array.from(node.querySelectorAll('input[type="checkbox"]')).filter(function (input) { return !input.closest('.sdoc-write-rich'); });
    Array.from(copy.querySelectorAll('input[type="checkbox"]')).forEach(function (input, i) {
      if (originals[i]) input.toggleAttribute('checked', originals[i].checked);
    });
    [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('[' + sourceBlockAttribute + '],[data-sdoc-write-caret]')))
      .forEach(function (el) { el.removeAttribute(sourceBlockAttribute); el.removeAttribute('data-sdoc-write-caret'); });
    var math = copy.matches('.sdocs-math-display,.sdocs-math-inline') ? [copy] : [];
    math.concat(Array.prototype.slice.call(copy.querySelectorAll('.sdocs-math-display,.sdocs-math-inline')))
      .forEach(function (el) {
        el.innerHTML = '';
        el.className = el.classList.contains('sdocs-math-display') ? 'sdocs-math-display' : 'sdocs-math-inline';
      });
    return copy.outerHTML;
  }).join('');
}

function buildWriteSession(source) {
  var normalized = '', offsets = [0];
  for (var i = 0; i < source.length; i++) {
    if (source[i] === '\r') {
      normalized += '\n';
      if (source[i + 1] === '\n') i++;
    } else normalized += source[i];
    offsets.push(i + 1);
  }
  // Marked expands leading tabs before tokenizing. Map that expansion back to
  // the original bytes so an untouched indented block is never duplicated.
  var expanded = '', expandedOffsets = [0], previous = 0;
  normalized.replace(/^( *)(\t+)/gm, function (match, spaces, tabs, at) {
    for (var n = previous; n < at + spaces.length; n++) {
      expanded += normalized[n]; expandedOffsets.push(offsets[n + 1]);
    }
    for (var t = at + spaces.length; t < at + match.length; t++) {
      for (var pad = 0; pad < 4; pad++) { expanded += ' '; expandedOffsets.push(offsets[t + (pad === 3 ? 1 : 0)]); }
    }
    previous = at + match.length;
    return match;
  });
  for (var tail = previous; tail < normalized.length; tail++) { expanded += normalized[tail]; expandedOffsets.push(offsets[tail + 1]); }
  normalized = expanded; offsets = expandedOffsets;
  var tokens = marked.lexer(normalized), cursor = 0, blocks = [];
  writeEl.innerHTML = '';
  tokens.forEach(function (token) {
    if (token.type === 'space') return;
    var input = [token]; input.links = tokens.links;
    var template = document.createElement('template');
    template.innerHTML = DOMPurify.sanitize(marked.parser(input), { FORBID_ATTR: ['style'] });
    var nodes = Array.prototype.filter.call(template.content.childNodes, function (node) {
      return node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim());
    });
    if (!nodes.length) return;
    var at = normalized.indexOf(token.raw, cursor);
    var mapped = at >= 0;
    var end = mapped ? at + token.raw.length : cursor;
    var record = { id: String(blocks.length), token: token,
      raw: mapped ? source.slice(offsets[at], offsets[end]) : token.raw,
      before: mapped ? source.slice(offsets[cursor], offsets[at]) : '',
      nodes: nodes };
    var codeTokens = [], pres = [];
    marked.walkTokens([token], function (part) { if (part.type === 'code') codeTokens.push(part); });
    nodes.forEach(function (node) {
      if (node.nodeType === 1) {
        node.setAttribute(sourceBlockAttribute, record.id);
        if (node.tagName === 'PRE') pres.push(node);
        pres.push.apply(pres, node.querySelectorAll('pre'));
        node.querySelectorAll('input[type="checkbox"]').forEach(function (input) { input.disabled = false; });
      }
      writeEl.appendChild(node);
    });
    pres.forEach(function (pre, index) {
      var code = codeTokens[index];
      if (!code) return;
      pre.dataset.sdocsFenceInfo = code.lang || '';
      var fence = code.raw.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) pre.dataset.sdocsFence = fence[1];
    });
    record.signature = editorSignature(nodes);
    blocks.push(record);
    if (mapped) cursor = end;
  });
  if (!writeEl.childNodes.length) writeEl.innerHTML = '<p><br></p>';
  resetWriteHistory();
  return { original: source, blocks: blocks, trailing: source.slice(offsets[cursor]),
    signature: editorSignature(writeEl.childNodes), lastSaved: source };
}

function serializeWriteSession() {
  if (!editSession) return htmlToMarkdown(writeEl);
  if (editorSignature(writeEl.childNodes) === editSession.signature) return editSession.original;
  var groups = [], used = new Set();
  Array.prototype.forEach.call(writeEl.childNodes, function (node) {
    if (node.nodeType === 3 && !node.textContent.trim()) return;
    var id = node.nodeType === 1 ? node.getAttribute(sourceBlockAttribute) : null;
    var previous = groups[groups.length - 1];
    if (id !== null && previous && previous.id === id) previous.nodes.push(node);
    else groups.push({ id: id, nodes: [node] });
  });
  var output = '', previousIndex = -1;
  groups.forEach(function (group) {
    var record = group.id !== null ? editSession.blocks[Number(group.id)] : null;
    var firstUse = record && !used.has(record.id);
    var before = firstUse ? record.before : '';
    var unchanged = firstUse && editorSignature(group.nodes) === record.signature;
    var text;
    if (unchanged) text = record.raw;
    else {
      var container = document.createElement('div');
      group.nodes.forEach(function (node) { container.appendChild(S.richWrite ? S.richWrite.cloneSource(node) : node.cloneNode(true)); });
      // cloneNode does not copy an input's live checked property.
      var originals = group.nodes.flatMap(function (node) { return node.querySelectorAll ? Array.from(node.querySelectorAll('input[type="checkbox"]')).filter(function (input) { return !input.closest('.sdoc-write-rich'); }) : []; });
      Array.from(container.querySelectorAll('input[type="checkbox"]')).forEach(function (el, i) { el.checked = originals[i].checked; });
      text = htmlToMarkdown(container).replace(/\n$/, '');
      if (record) text += (record.raw.match(/\r?\n(?:\s*\r?\n)*$/) || [''])[0];
    }
    if (output && !(firstUse && Number(record.id) === previousIndex + 1)) {
      if (!/\n\s*\n$/.test(output + before)) output += /\n$/.test(output) ? '\n' : '\n\n';
    }
    output += before + text;
    if (record) used.add(record.id);
    previousIndex = record ? Number(record.id) : -1;
  });
  // Definitions are not visible editor nodes. Retain them even if the block
  // that followed them was deleted or moved.
  editSession.blocks.forEach(function (record) {
    if (!used.has(record.id) && record.before.trim()) output += '\n\n' + record.before;
  });
  return output + editSession.trailing;
}

function flushWriteChanges() {
  clearTimeout(S._writeSyncTimer); S._writeSyncTimer = null;
  if (!editSession) return false;
  var body = serializeWriteSession();
  if (body === editSession.lastSaved) return false;
  S.currentBody = body;
  editSession.lastSaved = body;
  if (S.invalidateLocalMeta) S.invalidateLocalMeta();
  S.syncAll('write');
  return true;
}

// ── Enter / exit write mode ──────────────────────────

function enterWriteMode() {
  if (editSession && editSession.lastSaved === S.currentBody) { copyStyleVars(); return; }
  clearTimeout(S._writeSyncTimer);
  editSession = buildWriteSession(S.currentBody);
  copyStyleVars();
  if (S.processMath) S.processMath(writeEl);
  if (S.richWrite) S.richWrite.ready = S.richWrite.hydrate();
  setTimeout(updateToolbarState, 0);
}

function exitWriteMode() {
  if (S.richWrite) S.richWrite.finish(false);
  flushWriteChanges();
  resetWriteSession();
  writeEl.replaceChildren();
  S.render();
}

function resetWriteSession() {
  if (S.richWrite) S.richWrite.destroy(false);
  clearTimeout(S._writeSyncTimer); S._writeSyncTimer = null;
  S._checkCodeBlockExit = null;
  editSession = null;
  writeHistory = null;
  updateUndoButton();
  beforeInputSelection = null;
}

function copyStyleVars() {
  Array.from(writeEl.style).forEach(function (prop) { if (prop.startsWith('--md-')) writeEl.style.removeProperty(prop); });
  var style = S.renderedEl.style;
  for (var i = 0; i < style.length; i++) {
    var prop = style[i];
    if (prop.startsWith('--md-')) {
      writeEl.style.setProperty(prop, style.getPropertyValue(prop));
    }
  }
  if (S.richWrite) S.richWrite.retheme();
}

// ── HTML-to-Markdown conversion ──────────────────────

function htmlToMarkdown(container) {
  var lines = [];
  walkBlock(container.childNodes, lines, '');
  var compact = [];
  lines.forEach(function (line) {
    if (line === '' && (!compact.length || compact[compact.length - 1] === '')) return;
    compact.push(line);
  });
  while (compact.length && compact[compact.length - 1] === '') compact.pop();
  return compact.join('\n') + '\n';
}

function escapeText(text) {
  return text.replace(/\\/g, '\\\\').replace(/([`*_\[\]<>~])/g, '\\$1')
    .replace(/(^|\n)(\s*)(#{1,6}|[-+>]|\d+[.)])(?=\s)/g, function (_, newline, space, marker) {
      return newline + space + marker.replace(/([#.+>)*-])/g, '\\$1');
    });
}

function plainCode(node) {
  var text = '';
  node.childNodes.forEach(function (child) {
    if (child.nodeType === 3) text += child.textContent;
    else if (child.nodeType === 1) {
      if (child.tagName === 'BR') text += '\n';
      else {
        if (/^(DIV|P)$/.test(child.tagName) && text && !text.endsWith('\n')) text += '\n';
        text += plainCode(child);
      }
    }
  });
  return text;
}

function walkBlock(nodes, lines, indent) {
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.nodeType === 3) {
      var text = node.textContent.trim();
      if (text) lines.push(indent + escapeText(text));
      continue;
    }
    if (node.nodeType !== 1) continue;
    var tag = node.tagName;

    if (/^H[1-6]$/.test(tag)) {
      var level = parseInt(tag[1]);
      var hashes = '';
      for (var h = 0; h < level; h++) hashes += '#';
      lines.push('');
      lines.push(hashes + ' ' + inlineToMd(node));
      lines.push('');
    } else if (tag === 'P') {
      lines.push('');
      lines.push(indent + inlineToMd(node));
      lines.push('');
    } else if (tag === 'UL') {
      lines.push('');
      walkList(node, lines, indent, 'ul');
      lines.push('');
    } else if (tag === 'OL') {
      lines.push('');
      walkList(node, lines, indent, 'ol');
      lines.push('');
    } else if (tag === 'BLOCKQUOTE') {
      lines.push('');
      var bqLines = [];
      walkBlock(node.childNodes, bqLines, '');
      // Inner blocks (e.g. a <p>) emit their own leading/trailing blank lines;
      // prefixing those with '> ' produced stray '> ' lines around the quote.
      while (bqLines.length && !bqLines[0].trim()) bqLines.shift();
      while (bqLines.length && !bqLines[bqLines.length - 1].trim()) bqLines.pop();
      var prevBlank = false;
      for (var b = 0; b < bqLines.length; b++) {
        var blank = !bqLines[b].trim();
        if (blank && prevBlank) continue; // collapse runs of blank lines to one '>'
        lines.push(blank ? '>' : '> ' + bqLines[b]);
        prevBlank = blank;
      }
      lines.push('');
    } else if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var lang = '';
      if (codeEl) {
        var cls = codeEl.className || '';
        var m = cls.match(/language-(\S+)/);
        if (m) lang = m[1];
      }
      lines.push('');
      lang = node.dataset.sdocsFenceInfo || lang;
      var source = plainCode(codeEl || node).replace(/\n$/, '');
      var originalFence = node.dataset.sdocsFence || '```';
      var character = originalFence[0], fenceLength = Math.max(3, originalFence.length);
      var runs = source.match(character === '`' ? /`+/g : /~+/g) || [];
      runs.forEach(function (run) { fenceLength = Math.max(fenceLength, run.length + 1); });
      var fence = repeat(character, fenceLength);
      lines.push(fence + lang);
      // Strip the single trailing newline browsers keep on code textContent;
      // left in, it serialized as a blank line before the closing fence.
      lines.push(source);
      lines.push(fence);
      lines.push('');
    } else if (tag === 'TABLE') {
      lines.push('');
      walkTable(node, lines, indent);
      lines.push('');
    } else if (tag === 'HR') {
      lines.push('');
      lines.push('---');
      lines.push('');
    } else if (tag === 'DIV' && node.classList && node.classList.contains('sdocs-math-display')) {
      var blockTex = node.getAttribute('data-tex') || '';
      lines.push('');
      lines.push('$$');
      lines.push(blockTex);
      lines.push('$$');
      lines.push('');
    } else if (tag === 'BR') {
      lines.push('');
    } else if (tag === 'DIV') {
      // contentEditable often wraps lines in divs
      if (node.querySelector('h1,h2,h3,h4,h5,h6,p,ul,ol,pre,blockquote')) {
        walkBlock(node.childNodes, lines, indent);
      } else {
        lines.push('');
        lines.push(indent + inlineToMd(node));
        lines.push('');
      }
    } else {
      // Unknown block — recurse
      walkBlock(node.childNodes, lines, indent);
    }
  }
}

function walkList(listEl, lines, indent, type) {
  var items = listEl.children;
  var num = listEl.hasAttribute('start') ? Number(listEl.getAttribute('start')) : 1;
  if (!Number.isFinite(num)) num = 1;
  // Fallback indent for a stray nested list (see the UL/OL branch below); tracks
  // the content column of the item most recently emitted.
  var lastChildIndent = indent + '  ';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    // A nested list can appear as a direct child of the list rather than inside
    // the preceding <li> — Chrome's execCommand('indent') produces exactly this
    // shape. Attach it as a sub-list of the item above it; without this branch
    // walkList skipped it and the indented items vanished on the way to read mode.
    if (item.tagName === 'UL' || item.tagName === 'OL') {
      walkList(item, lines, lastChildIndent, item.tagName === 'UL' ? 'ul' : 'ol');
      continue;
    }
    if (item.tagName !== 'LI') continue;
    var li = item;
    if (type === 'ol' && item.hasAttribute('value') && Number.isFinite(Number(item.getAttribute('value')))) num = Number(item.getAttribute('value'));
    var bullet = type === 'ul' ? '- ' : (num++) + '. ';
    // Nested content aligns under the marker (2 cols for "- ", 3 for "1. ") so
    // it re-parses as a child list rather than a sibling / lazy continuation.
    var childIndent = indent + repeat(' ', bullet.length);
    lastChildIndent = childIndent;
    // GFM task list: preserve the checkbox state as [ ] / [x].
    var checkbox = Array.from(li.children).find(function (child) { return child.matches('input[type="checkbox"]'); });
    if (!checkbox && li.firstElementChild && li.firstElementChild.tagName === 'P') checkbox = li.firstElementChild.querySelector('input[type="checkbox"]');
    var prefix = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : '';
    // inlineToMd over the whole <li> keeps top-level **bold** / [links] that a
    // per-child pass dropped, and skips nested UL/OL (walked separately below).
    var body = [], inline = document.createElement('span');
    function flushInline() {
      var text = inlineToMd(inline).trim();
      if (text) body.push(text);
      inline.innerHTML = '';
    }
    Array.from(li.childNodes).forEach(function (child) {
      if (child.nodeType === 1 && /^(P|DIV|UL|OL|PRE|BLOCKQUOTE|TABLE|HR|H[1-6])$/.test(child.tagName)) {
        flushInline();
        if (child.tagName === 'UL' || child.tagName === 'OL') walkList(child, body, '', child.tagName === 'UL' ? 'ul' : 'ol');
        else walkBlock([child], body, '');
      } else inline.appendChild(child.cloneNode(true));
    });
    flushInline();
    while (body.length && body[0] === '') body.shift();
    while (body.length && body[body.length - 1] === '') body.pop();
    var first = (body.shift() || '').split('\n');
    lines.push(indent + bullet + prefix + first.shift());
    first.forEach(function (line) { lines.push(childIndent + line); });
    var lastBlank = false;
    body.forEach(function (line) {
      if (line === '' && lastBlank) return;
      lines.push(line === '' ? '' : line.split('\n').map(function (part) { return childIndent + part; }).join('\n'));
      lastBlank = line === '';
    });
    if (Array.from(li.children).some(function (child) { return child.tagName === 'P'; }) && i < items.length - 1) lines.push('');
  }
}

function repeat(str, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += str;
  return out;
}

function walkTable(table, lines, indent) {
  var rows = table.querySelectorAll('tr');
  if (!rows.length) return;
  function cellsOf(row) {
    var cells = row.querySelectorAll('th,td');
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      out.push(inlineToMd(cells[i]).trim().replace(/ *\n */g, '<br>').replace(/\|/g, '\\|'));
    }
    return out;
  }
  var header = cellsOf(rows[0]);
  if (!header.length) return;
  lines.push(indent + '| ' + header.join(' | ') + ' |');
  lines.push(indent + '| ' + Array.from(rows[0].children).map(function (cell) {
    var align = cell.getAttribute('align') || cell.style.textAlign;
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---';
  }).join(' | ') + ' |');
  for (var r = 1; r < rows.length; r++) {
    var cells = cellsOf(rows[r]);
    if (!cells.length) continue;
    lines.push(indent + '| ' + cells.join(' | ') + ' |');
  }
}

function formatInline(marker, element) {
  var text = inlineToMd(element), parts = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return parts[2] ? parts[1] + marker + parts[2] + marker + parts[3] : text;
}

function inlineToMd(node) {
  var result = '';
  for (var i = 0; i < node.childNodes.length; i++) {
    var child = node.childNodes[i];
    if (child.nodeType === 3) {
      result += escapeText(child.textContent);
    } else if (child.nodeType === 1) {
      var tag = child.tagName;
      if (tag === 'STRONG' || tag === 'B') {
        result += formatInline('**', child);
      } else if (tag === 'EM' || tag === 'I') {
        result += formatInline('*', child);
      } else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') {
        result += formatInline('~~', child);
      } else if (tag === 'CODE') {
        var codeText = child.textContent.replace(/\u200B/g, '');
        if (!codeText) continue;
        var ticks = repeat('`', Math.max.apply(null, [0].concat((codeText.match(/`+/g) || []).map(function (run) { return run.length; }))) + 1);
        var pad = /^`|`$/.test(codeText) || (/^ | $/.test(codeText) && /\S/.test(codeText));
        result += ticks + (pad ? ' ' : '') + codeText + (pad ? ' ' : '') + ticks;
      } else if (tag === 'SPAN' && child.classList && child.classList.contains('sdocs-math-inline')) {
        result += '$' + (child.getAttribute('data-tex') || '') + '$';
      } else if (tag === 'A') {
        var href = child.getAttribute('href') || '';
        var title = child.getAttribute('title');
        result += '[' + inlineToMd(child) + '](' + href.replace(/([\\()])/g, '\\$1') + (title ? ' "' + title.replace(/([\\"])/g, '\\$1') + '"' : '') + ')';
      } else if (tag === 'IMG') {
        var alt = child.getAttribute('alt') || '';
        var src = child.getAttribute('src') || '';
        var imageTitle = child.getAttribute('title');
        result += '![' + escapeText(alt) + '](' + src.replace(/([\\()])/g, '\\$1')
          + (imageTitle ? ' \"' + imageTitle.replace(/([\\\"])/g, '\\$1') + '\"' : '') + ')';
      } else if (tag === 'BR') {
        result += '  \n';
      } else if (tag === 'DIV' || tag === 'P') {
        if (result && !result.endsWith('\n')) result += '  \n';
        result += inlineToMd(child);
      } else if (tag === 'UL' || tag === 'OL') {
        // Nested lists inside an <li> are serialized by walkList, not here.
      } else if (tag === 'INPUT') {
        // Task-list checkbox is captured as a [ ]/[x] prefix by walkList.
      } else {
        result += inlineToMd(child);
      }
    }
  }
  return result;
}

// ── Cursor helpers ──────────────────────────────────

function placeCursorAtEnd(el) {
  var range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function getContainingBlock(node) {
  while (node && node !== writeEl) {
    if (node.nodeType === 1) {
      var display = getComputedStyle(node).display;
      if (display === 'block' || display === 'list-item') return node;
    }
    node = node.parentNode;
  }
  return null;
}

// ── Markdown shortcuts ──────────────────────────────

function checkShortcuts() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var block = getContainingBlock(sel.anchorNode);
  if (!block || block === writeEl) return;
  // Only transform simple paragraphs/divs (not already formatted blocks)
  if (block.tagName !== 'P' && block.tagName !== 'DIV') return;
  var text = block.textContent;

  // Heading: # through ######
  var hm = text.match(/^(#{1,6})\s(.+)$/);
  if (hm) {
    var lvl = hm[1].length;
    var heading = document.createElement('h' + lvl);
    heading.textContent = hm[2];
    block.replaceWith(heading);
    placeCursorAtEnd(heading);
    return;
  }

  // Horizontal rule: ---
  if (/^---$/.test(text.trim())) {
    var hr = document.createElement('hr');
    var p = document.createElement('p');
    p.innerHTML = '<br>';
    block.replaceWith(hr);
    hr.after(p);
    placeCursorAtEnd(p);
    return;
  }

  // Code block: ```
  if (/^```(\w*)$/.test(text.trim())) {
    var langMatch = text.trim().match(/^```(\w*)$/);
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    if (langMatch[1]) code.className = 'language-' + langMatch[1];
    code.textContent = '\n';
    pre.appendChild(code);
    block.replaceWith(pre);
    placeCursorAtEnd(code);
    return;
  }

  // Blockquote: >
  var bqm = text.match(/^>\s(.*)$/);
  if (bqm) {
    var bq = document.createElement('blockquote');
    var bqp = document.createElement('p');
    bqp.textContent = bqm[1];
    bq.appendChild(bqp);
    block.replaceWith(bq);
    placeCursorAtEnd(bqp);
    return;
  }

  // Unordered list: - or *
  var ulm = text.match(/^[-*]\s(.*)$/);
  if (ulm) {
    var ul = document.createElement('ul');
    var li = document.createElement('li');
    li.textContent = ulm[1];
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCursorAtEnd(li);
    return;
  }

  // Ordered list: 1.
  var olm = text.match(/^(\d+)\.\s(.*)$/);
  if (olm) {
    var ol = document.createElement('ol');
    if (Number(olm[1]) !== 1) ol.start = Number(olm[1]);
    var oli = document.createElement('li');
    oli.textContent = olm[2];
    ol.appendChild(oli);
    block.replaceWith(ol);
    placeCursorAtEnd(oli);
    return;
  }
}

// Store reversible HTML deltas, including selections, for both native input
// and custom structure changes. Never carry an undo stack into another document.
function captureWriteSelection() {
  var selection = window.getSelection();
  if (!selection.rangeCount || !writeEl.contains(selection.anchorNode) || !writeEl.contains(selection.focusNode)) return null;
  function point(node, offset) {
    var path = [];
    while (node !== writeEl) { path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node)); node = node.parentNode; }
    return { path: path, offset: offset };
  }
  return { anchor: point(selection.anchorNode, selection.anchorOffset), focus: point(selection.focusNode, selection.focusOffset) };
}

function restoreWriteSelection(saved) {
  if (!saved) return;
  function point(value) {
    var node = writeEl;
    value.path.forEach(function (index) { if (node.childNodes.length) node = node.childNodes[Math.min(index, node.childNodes.length - 1)]; });
    return { node: node, offset: Math.min(value.offset, node.nodeType === 3 ? node.length : node.childNodes.length) };
  }
  var anchor = point(saved.anchor), focus = point(saved.focus), selection = window.getSelection();
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

function historyHtml() {
  var copy = S.richWrite ? S.richWrite.cloneSource(writeEl) : writeEl.cloneNode(true);
  var originals = Array.from(writeEl.querySelectorAll('input[type="checkbox"]')).filter(function (input) { return !input.closest('.sdoc-write-rich'); });
  copy.querySelectorAll('input[type="checkbox"]').forEach(function (input, i) { input.toggleAttribute('checked', originals[i].checked); });
  copy.querySelectorAll('.sdocs-math-display,.sdocs-math-inline').forEach(function (math) {
    math.innerHTML = '';
    math.className = math.classList.contains('sdocs-math-display') ? 'sdocs-math-display' : 'sdocs-math-inline';
  });
  return copy.innerHTML;
}

function resetWriteHistory() {
  writeHistory = { html: historyHtml(), selection: null, undo: [], redo: [], restoring: false };
  updateUndoButton();
}

function updateUndoButton() {
  if (undoButton) undoButton.disabled = !writeHistory || !writeHistory.undo.length;
}

function htmlDelta(before, after) {
  var at = 0, endBefore = before.length, endAfter = after.length;
  while (at < endBefore && at < endAfter && before[at] === after[at]) at++;
  while (endBefore > at && endAfter > at && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { at: at, before: before.slice(at, endBefore), after: after.slice(at, endAfter) };
}

function recordWriteHistory(inputType, group) {
  if (!writeHistory || writeHistory.restoring) return;
  var html = historyHtml(), history = writeHistory, selection = captureWriteSelection();
  if (html === history.html) { beforeInputSelection = null; return; }
  var previous = history.undo[history.undo.length - 1], beforeSelection = beforeInputSelection || history.selection;
  // Shadow-root text selections are retargeted to their host in the document.
  // Rich fields supply their own identity for grouping a burst of typing.
  var combine = previous && previous.type === inputType && Date.now() - previous.time < 1000
    && (inputType === 'insertRichText' && group === previous.group
      || inputType === 'insertText' && JSON.stringify(previous.selection) === JSON.stringify(beforeSelection));
  var before = history.html;
  if (combine) {
    before = before.slice(0, previous.at) + previous.before + before.slice(previous.at + previous.after.length);
    beforeSelection = previous.beforeSelection;
    history.undo.pop();
  }
  var delta = htmlDelta(before, html);
  delta.beforeSelection = beforeSelection; delta.selection = selection; delta.type = inputType; delta.group = group; delta.time = Date.now();
  history.undo.push(delta); history.redo = [];
  history.html = html; history.selection = selection; beforeInputSelection = null;
  updateUndoButton();
}

function travelWriteHistory(redo) {
  if (!writeHistory) return;
  recordWriteHistory('pending');
  var history = writeHistory, from = redo ? history.redo : history.undo, to = redo ? history.undo : history.redo;
  var delta = from.pop();
  if (!delta) return;
  history.restoring = true;
  var old = redo ? delta.before : delta.after, replacement = redo ? delta.after : delta.before;
  history.html = history.html.slice(0, delta.at) + replacement + history.html.slice(delta.at + old.length);
  writeEl.innerHTML = history.html;
  if (S.richWrite) S.richWrite.ready = S.richWrite.hydrate();
  history.selection = redo ? delta.selection : delta.beforeSelection;
  restoreWriteSelection(history.selection);
  to.push(delta);
  updateUndoButton();
  if (S.processMath) S.processMath(writeEl);
  history.restoring = false;
  beforeInputSelection = null;
  writeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: redo ? 'historyRedo' : 'historyUndo' }));
}

writeEl.addEventListener('beforeinput', function (event) {
  if (event.target.closest && event.target.closest('.sdoc-write-rich')) return;
  if (!writeHistory) return;
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault(); travelWriteHistory(event.inputType === 'historyRedo'); return;
  }
  beforeInputSelection = captureWriteSelection();
});

// ── Input handler + debounced sync ──────────────────

writeEl.addEventListener('input', function(e) {
  if (!editSession || S.currentMode !== 'write') return;
  if (e.target !== writeEl && e.target.closest && e.target.closest('.sdoc-write-rich')) return;
  if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') {
    queueMicrotask(function () { if (editSession) recordWriteHistory(e._sdocRichInputType || e.inputType, e._sdocRichGroup); });
  }

  // Debounce sync
  clearTimeout(S._writeSyncTimer);
  var session = editSession;
  S._writeSyncTimer = setTimeout(function() {
    if (editSession === session && S.currentMode === 'write') flushWriteChanges();
  }, 500);

  // Code block exit: after Enter inserts a line break, check for 2+ consecutive
  // empty lines at the end. Chromium represents newlines as <br> elements in
  // contentEditable, with an extra trailing BR as a caret placeholder.
  // Pattern: N enters = N+1 trailing BRs. So 2 empty Enters = 3+ trailing BRs.
  if (S._checkCodeBlockExit) {
    var pre = S._checkCodeBlockExit;
    S._checkCodeBlockExit = null;
    var codeEl = pre.querySelector('code') || pre;
    var children = codeEl.childNodes;
    var trailingBRs = 0;
    for (var ci = children.length - 1; ci >= 0; ci--) {
      var child = children[ci];
      if (child.nodeType === 1 && child.tagName === 'BR') { trailingBRs++; continue; }
      // Skip empty or whitespace-only text nodes (e.g. trailing \n from initialization)
      if (child.nodeType === 3 && !child.textContent.trim()) { continue; }
      break;
    }
    // 3+ trailing BRs = 2+ empty Enters at end → exit code block
    if (trailingBRs >= 3) {
      // Remove all trailing BRs
      while (codeEl.lastChild && codeEl.lastChild.nodeType === 1 && codeEl.lastChild.tagName === 'BR') {
        codeEl.removeChild(codeEl.lastChild);
      }
      // Clean trailing text newlines too
      if (codeEl.lastChild && codeEl.lastChild.nodeType === 3) {
        codeEl.lastChild.textContent = codeEl.lastChild.textContent.replace(/\n+$/, '');
      }
      // Ensure code block isn't completely empty
      if (!codeEl.textContent && !codeEl.querySelector('br')) {
        codeEl.textContent = '\n';
      }
      var exitP = document.createElement('p');
      exitP.innerHTML = '<br>';
      pre.after(exitP);
      placeCursorAtEnd(exitP);
      return;
    }
  }

  // Check block-level shortcuts
  if (!e.isComposing && (e.inputType === 'insertText' || e.inputType === 'insertParagraph')) {
    checkShortcuts();
  }
});

function changeListIndent(item, outdent) {
  var list = item.parentElement, parentItem = list.parentElement.closest('li');
  beforeInputSelection = captureWriteSelection();
  var selection = window.getSelection();
  var anchor = selection.anchorNode, anchorOffset = selection.anchorOffset;
  var focus = selection.focusNode, focusOffset = selection.focusOffset;
  if (outdent && parentItem && writeEl.contains(parentItem)) {
    var following = [], sibling = item.nextElementSibling;
    while (sibling) { following.push(sibling); sibling = sibling.nextElementSibling; }
    if (following.length) {
      var remaining = document.createElement(list.tagName);
      following.forEach(function (child) { remaining.appendChild(child); });
      item.appendChild(remaining);
    }
    parentItem.after(item);
    if (!list.children.length) list.remove();
  } else if (!outdent && item.previousElementSibling) {
    var previous = item.previousElementSibling;
    var nested = Array.from(previous.children).find(function (child) { return child.tagName === list.tagName; });
    if (!nested) { nested = document.createElement(list.tagName); previous.appendChild(nested); }
    nested.appendChild(item);
  } else if (outdent) {
    document.execCommand('outdent', false, null);
    return;
  } else return;
  selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  writeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatIndent' }));
}

// ── Keyboard shortcuts ──────────────────────────────

writeEl.addEventListener('keydown', function(e) {
  if (e.isComposing || e.keyCode === 229 || e.target.closest && e.target.closest('.sdoc-write-rich')) return;
  var mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); travelWriteHistory(e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === 'y' && !e.shiftKey) { e.preventDefault(); travelWriteHistory(true); return; }

  // Inline formatting shortcuts
  if (mod && !e.shiftKey) {
    if (e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); return; }
    if (e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); return; }
    if (e.key === 'e') { e.preventDefault(); execInlineCode(); return; }
    if (e.key === 'k') { e.preventDefault(); insertLink(); return; }
  }
  if (mod && e.shiftKey && e.key === 'x') {
    e.preventDefault();
    document.execCommand('strikeThrough', false, null);
    return;
  }

  // Enter key: special handling for code blocks and blockquotes
  if (e.key === 'Enter' && !mod && !e.shiftKey) {
    var sel = window.getSelection();
    var node = sel.rangeCount ? sel.anchorNode : null;
    if (node) {
      // Code block: insert line break, not paragraph
      var pre = node.nodeType === 1 ? node.closest('pre') : (node.parentElement && node.parentElement.closest('pre'));
      if (pre) {
        e.preventDefault();
        // Flag MUST be set before execCommand because the input event
        // fires synchronously during execCommand execution
        S._checkCodeBlockExit = pre;
        document.execCommand('insertLineBreak', false, null);
        return;
      }

      // Blockquote: Enter on empty line exits
      var bqEl = node.nodeType === 1 ? node.closest('blockquote') : (node.parentElement && node.parentElement.closest('blockquote'));
      if (bqEl) {
        var block = getContainingBlock(node);
        // If current block is empty (just whitespace or <br>), exit blockquote
        if (block && block !== writeEl && block !== bqEl) {
          var blockText = block.textContent.trim();
          if (!blockText) {
            e.preventDefault();
            block.remove();
            // If blockquote is now empty, remove it too
            if (!bqEl.textContent.trim() && !bqEl.querySelector('img,hr,pre')) {
              var afterP = document.createElement('p');
              afterP.innerHTML = '<br>';
              bqEl.replaceWith(afterP);
              placeCursorAtEnd(afterP);
            } else {
              // Insert paragraph after blockquote
              var afterP = document.createElement('p');
              afterP.innerHTML = '<br>';
              bqEl.after(afterP);
              placeCursorAtEnd(afterP);
            }
            return;
          }
        }
      }
    }
  }

  // Tab for list indent
  if (e.key === 'Tab') {
    var anchor = window.getSelection().anchorNode;
    var element = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    var item = element && element.closest('li');
    if (item && writeEl.contains(item)) {
      e.preventDefault();
      changeListIndent(item, e.shiftKey);
    }
  }
});

// ── Paste handler: strip formatting ──────────────────

writeEl.addEventListener('paste', function(e) {
  if (e.target.closest && e.target.closest('.sdoc-write-rich')) return;
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

// ── Blur handler: sync immediately ──────────────────

writeEl.addEventListener('blur', function() {
  if (S.currentMode === 'write' && editSession) flushWriteChanges();
});

// ── Toolbar actions ──────────────────────────────────

if (undoButton) {
  undoButton.addEventListener('pointerdown', function (event) { event.preventDefault(); });
  undoButton.addEventListener('click', function () {
    if (S.currentMode !== 'write' || !editSession) return;
    if (S.richWrite) S.richWrite.finish(false);
    writeEl.focus({ preventScroll: true });
    travelWriteHistory(false);
  });
}

// Custom structure changes use DOM ranges so the browser cannot inherit a
// removed wrapper. The shared history below covers typing and toolbar actions.
function insertEditorNodes(range, nodes, focus, placement) {
  if (!writeEl.contains(range.commonAncestorContainer)) return;
  beforeInputSelection = captureWriteSelection();
  range.deleteContents();
  var fragment = document.createDocumentFragment();
  nodes.forEach(function (node) { fragment.appendChild(node); });
  var last = fragment.lastChild;
  range.insertNode(fragment);
  var selection = window.getSelection(), caret = document.createRange();
  if (focus) {
    if (placement === 'after') { caret.setStartAfter(focus); caret.collapse(true); }
    else { caret.selectNodeContents(focus); if (placement !== 'select') caret.collapse(false); }
  } else if (last) { caret.setStartAfter(last); caret.collapse(true); }
  else { caret = range; caret.collapse(true); }
  selection.removeAllRanges(); selection.addRange(caret);
  writeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatBlock' }));
}

function replaceEditorBlock(block, nodes, focus, placement) {
  var range = document.createRange(); range.selectNode(block);
  insertEditorNodes(range, nodes, focus, placement);
}

function execInlineCode() {
  var sel = window.getSelection();
  if (!sel.rangeCount || !writeEl.contains(sel.anchorNode)) return;
  var range = sel.getRangeAt(0);
  var el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  var existing = el.closest('code');
  if (existing && !existing.closest('pre')) {
    range.selectNode(existing);
    insertEditorNodes(range, [document.createTextNode(existing.textContent.replace(/\u200B/g, ''))]);
    return;
  }
  var code = document.createElement('code');
  code.textContent = range.collapsed ? '\u200B' : sel.toString();
  insertEditorNodes(range, [code], code, range.collapsed ? 'end' : 'select');
}

function insertLink() {
  var sel = window.getSelection();
  if (!sel.rangeCount || !writeEl.contains(sel.anchorNode)) return;
  var range = sel.getRangeAt(0).cloneRange(), text = sel.toString() || 'link text';
  var url = prompt('Enter URL:', 'https://');
  if (!url) return;
  var a = document.createElement('a'); a.href = url; a.textContent = text;
  var safe = DOMPurify.sanitize(a.outerHTML, { RETURN_DOM_FRAGMENT: true });
  insertEditorNodes(range, Array.from(safe.childNodes), safe.firstChild);
}

function wrapBlock(tagName) {
  // Toggle: if already in this block type, revert to <p>
  var sel = window.getSelection();
  if (sel.rangeCount) {
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== writeEl) {
      if (el.tagName === tagName.toUpperCase()) {
        document.execCommand('formatBlock', false, '<p>');
        return;
      }
      el = el.parentElement;
    }
  }
  document.execCommand('formatBlock', false, '<' + tagName + '>');
}

function toggleBlockquote() {
  var sel = window.getSelection();
  if (!sel.rangeCount || !writeEl.contains(sel.anchorNode)) return;
  var el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  var bq = el.closest('blockquote');
  if (bq) {
    var copy = bq.cloneNode(true), nodes = Array.from(copy.childNodes);
    var first = copy.querySelector('p,div') || copy.firstElementChild;
    replaceEditorBlock(bq, nodes, first);
  } else {
    var block = getContainingBlock(sel.anchorNode);
    if (!block || block === writeEl) return;
    var quote = document.createElement('blockquote');
    var content = block.cloneNode(true); quote.appendChild(content);
    replaceEditorBlock(block, [quote], content);
  }
}

function insertHR() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var block = getContainingBlock(sel.anchorNode);
  if (!block) return;
  var range = document.createRange(); range.setStartAfter(block); range.collapse(true);
  var p = document.createElement('p'); p.appendChild(document.createElement('br'));
  insertEditorNodes(range, [document.createElement('hr'), p], p);
}

function insertImage() {
  var sel = window.getSelection();
  if (!sel.rangeCount || !writeEl.contains(sel.anchorNode)) return;
  var range = sel.getRangeAt(0).cloneRange();
  var url = prompt('Image URL:', 'https://');
  if (!url) return;
  var alt = prompt('Alt text:', '') || '';
  var img = document.createElement('img'); img.src = url; img.alt = alt;
  var safe = DOMPurify.sanitize(img.outerHTML, { RETURN_DOM_FRAGMENT: true });
  insertEditorNodes(range, Array.from(safe.childNodes), safe.firstChild, 'after');
}

function insertCodeBlock() {
  var sel = window.getSelection();
  if (!sel.rangeCount || !writeEl.contains(sel.anchorNode)) return;
  var el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  var existing = el.closest('pre');
  if (existing) {
    var p = document.createElement('p'); p.textContent = plainCode(existing.querySelector('code') || existing).replace(/^\n|\n$/g, '') || '\u00A0';
    replaceEditorBlock(existing, [p], p);
    return;
  }
  var range = sel.getRangeAt(0).cloneRange(), selected = sel.toString();
  var block = getContainingBlock(sel.anchorNode);
  var pre = document.createElement('pre'), code = document.createElement('code');
  code.textContent = selected + '\n'; pre.appendChild(code);
  var after = document.createElement('p'); after.appendChild(document.createElement('br'));
  if (selected && block && selected === block.textContent) range.selectNode(block);
  else if (!selected && block) { range.setStartAfter(block); range.collapse(true); }
  insertEditorNodes(range, [pre, after], code);
}

// Toolbar button wiring
document.getElementById('_sd_wb-bold').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('bold', false, null);
});
document.getElementById('_sd_wb-italic').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('italic', false, null);
});
document.getElementById('_sd_wb-strike').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('strikeThrough', false, null);
});
document.getElementById('_sd_wb-code').addEventListener('click', function() {
  writeEl.focus();
  execInlineCode();
});
var blockStyle = document.getElementById('_sd_wb-block');
var blockStyleRange = null;
function rememberBlockSelection() {
  var selection = window.getSelection();
  if (selection.rangeCount && writeEl.contains(selection.anchorNode)) {
    blockStyleRange = selection.getRangeAt(0).cloneRange();
  }
}
if (blockStyle) {
  blockStyle.addEventListener('pointerdown', rememberBlockSelection);
  blockStyle.addEventListener('focus', rememberBlockSelection);
  blockStyle.addEventListener('change', function () {
    var tag = blockStyle.value;
    writeEl.focus();
    if (blockStyleRange && writeEl.contains(blockStyleRange.startContainer)) {
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(blockStyleRange);
    }
    wrapBlock(tag);
    updateToolbarState();
  });
}
document.getElementById('_sd_wb-ul').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('insertUnorderedList', false, null);
});
document.getElementById('_sd_wb-ol').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('insertOrderedList', false, null);
});
document.getElementById('_sd_wb-bq').addEventListener('click', function() {
  writeEl.focus();
  toggleBlockquote();
});
document.getElementById('_sd_wb-codeblock').addEventListener('click', function() { writeEl.focus(); insertCodeBlock(); });
document.getElementById('_sd_wb-link').addEventListener('click', function() { writeEl.focus(); insertLink(); });
document.getElementById('_sd_wb-image').addEventListener('click', function() { writeEl.focus(); insertImage(); });
document.getElementById('_sd_wb-hr').addEventListener('click', function() { writeEl.focus(); insertHR(); });
document.getElementById('_sd_wb-clear').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('removeFormat', false, null);
});

// ── Active toolbar state tracking ──────────────────────

var BLOCK_BTN_MAP = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', P: 'p', DIV: 'p' };
var BLOCK_BTN_IDS = ['_sd_wb-ul', '_sd_wb-ol', '_sd_wb-bq', '_sd_wb-codeblock'];

function updateToolbarState() {
  var sel = window.getSelection();
  var activeBlock = null;

  if (sel.rangeCount) {
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== writeEl) {
      var tag = el.tagName;
      if (BLOCK_BTN_MAP[tag]) { activeBlock = BLOCK_BTN_MAP[tag]; break; }
      if (tag === 'LI') {
        var list = el.parentElement;
        activeBlock = list && list.tagName === 'OL' ? '_sd_wb-ol' : '_sd_wb-ul';
        break;
      }
      if (tag === 'BLOCKQUOTE') { activeBlock = '_sd_wb-bq'; break; }
      if (tag === 'PRE') { activeBlock = '_sd_wb-codeblock'; break; }
      el = el.parentElement;
    }
  }

  for (var i = 0; i < BLOCK_BTN_IDS.length; i++) {
    document.getElementById(BLOCK_BTN_IDS[i]).classList.toggle('active', BLOCK_BTN_IDS[i] === activeBlock);
  }
  if (blockStyle && document.activeElement !== blockStyle) {
    blockStyle.value = /^(p|h[1-5])$/.test(activeBlock || '') ? activeBlock : 'p';
  }

  document.getElementById('_sd_wb-bold').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('_sd_wb-italic').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('_sd_wb-strike').classList.toggle('active', document.queryCommandState('strikeThrough'));
}

document.addEventListener('selectionchange', function() {
  if (S.currentMode === 'write') {
    rememberBlockSelection();
    if (writeHistory && historyHtml() === writeHistory.html) writeHistory.selection = captureWriteSelection();
    updateToolbarState();
  }
});

// ── Convert title→data-tip for CSS tooltips ──────────

var tipBtns = document.querySelectorAll('.write-tb-btn[title]');
for (var t = 0; t < tipBtns.length; t++) {
  tipBtns[t].setAttribute('data-tip', tipBtns[t].getAttribute('title'));
  if (!tipBtns[t].hasAttribute('aria-label')) {
    tipBtns[t].setAttribute('aria-label', tipBtns[t].getAttribute('title'));
  }
  tipBtns[t].removeAttribute('title');
}

// ── Register on SDocs ──────────────────────────────

S.serializeWriteFragment = htmlToMarkdown;
S.enterWriteMode = enterWriteMode;
S.exitWriteMode = exitWriteMode;
S.updateToolbarState = updateToolbarState;
S.flushWriteChanges = flushWriteChanges;
S.resetWriteSession = resetWriteSession;
S.refreshWriteStyles = copyStyleVars;
S.hasPendingWriteChanges = function () { return !!editSession && serializeWriteSession() !== editSession.lastSaved; };

})();
