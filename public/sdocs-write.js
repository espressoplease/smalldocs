// sdocs-write.js — Write mode: contentEditable WYSIWYG with markdown shortcuts
(function () {
'use strict';

var S = SDocs;
var writeEl = document.getElementById('write');
S.writeEl = writeEl;

// ── Enter / exit write mode ──────────────────────────

function enterWriteMode() {
  var html = marked.parse(S.currentBody);
  writeEl.innerHTML = html || '<p><br></p>';
  copyStyleVars();
  writeEl.focus();
  placeCursorAtEnd(writeEl);
  setTimeout(updateToolbarState, 0);
}

function exitWriteMode() {
  S.currentBody = htmlToMarkdown(writeEl);
  S.render();
  S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
}

function copyStyleVars() {
  var style = S.renderedEl.style;
  for (var i = 0; i < style.length; i++) {
    var prop = style[i];
    if (prop.startsWith('--md-')) {
      writeEl.style.setProperty(prop, style.getPropertyValue(prop));
    }
  }
}

// ── HTML-to-Markdown conversion ──────────────────────

function htmlToMarkdown(container) {
  var lines = [];
  walkBlock(container.childNodes, lines, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function walkBlock(nodes, lines, indent) {
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.nodeType === 3) {
      var text = node.textContent.trim();
      if (text) lines.push(indent + text);
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
      for (var b = 0; b < bqLines.length; b++) {
        lines.push('> ' + bqLines[b]);
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
      lines.push('```' + lang);
      lines.push((codeEl || node).textContent);
      lines.push('```');
      lines.push('');
    } else if (tag === 'HR') {
      lines.push('');
      lines.push('---');
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
  var num = 1;
  for (var i = 0; i < items.length; i++) {
    if (items[i].tagName !== 'LI') continue;
    var li = items[i];
    var bullet = type === 'ul' ? '- ' : (num++) + '. ';
    var text = '';
    var subLists = [];
    for (var j = 0; j < li.childNodes.length; j++) {
      var child = li.childNodes[j];
      if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
        subLists.push(child);
      } else if (child.nodeType === 1) {
        text += inlineToMd(child);
      } else if (child.nodeType === 3) {
        text += child.textContent;
      }
    }
    lines.push(indent + bullet + text.trim());
    for (var k = 0; k < subLists.length; k++) {
      walkList(subLists[k], lines, indent + '  ', subLists[k].tagName === 'UL' ? 'ul' : 'ol');
    }
  }
}

function inlineToMd(node) {
  var result = '';
  for (var i = 0; i < node.childNodes.length; i++) {
    var child = node.childNodes[i];
    if (child.nodeType === 3) {
      result += child.textContent;
    } else if (child.nodeType === 1) {
      var tag = child.tagName;
      if (tag === 'STRONG' || tag === 'B') {
        result += '**' + inlineToMd(child) + '**';
      } else if (tag === 'EM' || tag === 'I') {
        result += '*' + inlineToMd(child) + '*';
      } else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') {
        result += '~~' + inlineToMd(child) + '~~';
      } else if (tag === 'CODE') {
        result += '`' + child.textContent + '`';
      } else if (tag === 'A') {
        var href = child.getAttribute('href') || '';
        result += '[' + inlineToMd(child) + '](' + href + ')';
      } else if (tag === 'IMG') {
        var alt = child.getAttribute('alt') || '';
        var src = child.getAttribute('src') || '';
        result += '![' + alt + '](' + src + ')';
      } else if (tag === 'BR') {
        result += '  \n';
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
    var oli = document.createElement('li');
    oli.textContent = olm[2];
    ol.appendChild(oli);
    block.replaceWith(ol);
    placeCursorAtEnd(oli);
    return;
  }
}

// ── Input handler + debounced sync ──────────────────

writeEl.addEventListener('input', function(e) {
  // Debounce sync
  clearTimeout(S._writeSyncTimer);
  S._writeSyncTimer = setTimeout(function() {
    S.currentBody = htmlToMarkdown(writeEl);
    S.syncAll('write');
  }, 500);

  // Check block-level shortcuts
  if (e.inputType === 'insertText' || e.inputType === 'insertParagraph') {
    checkShortcuts();
  }
});

// ── Keyboard shortcuts ──────────────────────────────

writeEl.addEventListener('keydown', function(e) {
  var mod = e.ctrlKey || e.metaKey;

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

  // Enter in code block: insert newline, not paragraph
  if (e.key === 'Enter') {
    var node = window.getSelection().anchorNode;
    if (node) {
      var pre = node.nodeType === 1 ? node.closest('pre') : (node.parentElement && node.parentElement.closest('pre'));
      if (pre) {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
        return;
      }
    }
  }

  // Tab for list indent
  if (e.key === 'Tab') {
    var block = getContainingBlock(window.getSelection().anchorNode);
    if (block && block.tagName === 'LI') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
    }
  }
});

// ── Paste handler: strip formatting ──────────────────

writeEl.addEventListener('paste', function(e) {
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

// ── Blur handler: sync immediately ──────────────────

writeEl.addEventListener('blur', function() {
  clearTimeout(S._writeSyncTimer);
  S.currentBody = htmlToMarkdown(writeEl);
  S.syncAll('write');
});

// ── Toolbar actions ──────────────────────────────────

function execInlineCode() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  if (range.collapsed) return;
  var code = document.createElement('code');
  code.appendChild(range.extractContents());
  range.insertNode(code);
  range.selectNodeContents(code);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertLink() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var text = sel.toString() || 'link text';
  var url = prompt('Enter URL:', 'https://');
  if (!url) return;
  var a = document.createElement('a');
  a.href = url;
  a.textContent = text;
  var range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(a);
  placeCursorAtEnd(a);
}

function wrapBlock(tagName) {
  document.execCommand('formatBlock', false, '<' + tagName + '>');
}

function toggleBlockquote() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var node = sel.anchorNode;
  // Check if cursor is inside a blockquote
  var el = node.nodeType === 1 ? node : node.parentElement;
  while (el && el !== writeEl) {
    if (el.tagName === 'BLOCKQUOTE') {
      // Unwrap: convert blockquote back to paragraph
      document.execCommand('formatBlock', false, '<p>');
      return;
    }
    el = el.parentElement;
  }
  // Wrap current block in blockquote
  document.execCommand('formatBlock', false, '<blockquote>');
}

function insertHR() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var block = getContainingBlock(sel.anchorNode);
  if (!block) return;
  var hr = document.createElement('hr');
  var p = document.createElement('p');
  p.innerHTML = '<br>';
  block.after(hr);
  hr.after(p);
  placeCursorAtEnd(p);
}

function insertImage() {
  var url = prompt('Image URL:', 'https://');
  if (!url) return;
  var alt = prompt('Alt text:', '') || '';
  var img = document.createElement('img');
  img.src = url;
  img.alt = alt;
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(img);
  // Place cursor after the image
  range.setStartAfter(img);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertCodeBlock() {
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var block = getContainingBlock(sel.anchorNode);
  var pre = document.createElement('pre');
  var code = document.createElement('code');
  code.textContent = '\n';
  pre.appendChild(code);
  var after = document.createElement('p');
  after.innerHTML = '<br>';
  if (block && block !== writeEl) {
    block.after(pre);
  } else {
    writeEl.appendChild(pre);
  }
  pre.after(after);
  placeCursorAtEnd(code);
}

// Toolbar button wiring
document.getElementById('wb-bold').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('bold', false, null);
});
document.getElementById('wb-italic').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('italic', false, null);
});
document.getElementById('wb-strike').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('strikeThrough', false, null);
});
document.getElementById('wb-code').addEventListener('click', function() {
  writeEl.focus();
  execInlineCode();
});
document.getElementById('wb-h1').addEventListener('click', function() { writeEl.focus(); wrapBlock('h1'); });
document.getElementById('wb-h2').addEventListener('click', function() { writeEl.focus(); wrapBlock('h2'); });
document.getElementById('wb-h3').addEventListener('click', function() { writeEl.focus(); wrapBlock('h3'); });
document.getElementById('wb-h4').addEventListener('click', function() { writeEl.focus(); wrapBlock('h4'); });
document.getElementById('wb-h5').addEventListener('click', function() { writeEl.focus(); wrapBlock('h5'); });
document.getElementById('wb-p').addEventListener('click', function() { writeEl.focus(); wrapBlock('p'); });
document.getElementById('wb-ul').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('insertUnorderedList', false, null);
});
document.getElementById('wb-ol').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('insertOrderedList', false, null);
});
document.getElementById('wb-bq').addEventListener('click', function() {
  writeEl.focus();
  toggleBlockquote();
});
document.getElementById('wb-codeblock').addEventListener('click', function() { writeEl.focus(); insertCodeBlock(); });
document.getElementById('wb-link').addEventListener('click', function() { writeEl.focus(); insertLink(); });
document.getElementById('wb-image').addEventListener('click', function() { writeEl.focus(); insertImage(); });
document.getElementById('wb-hr').addEventListener('click', function() { writeEl.focus(); insertHR(); });
document.getElementById('wb-clear').addEventListener('click', function() {
  writeEl.focus();
  document.execCommand('removeFormat', false, null);
});

// ── Active toolbar state tracking ──────────────────────

var BLOCK_BTN_MAP = { H1: 'wb-h1', H2: 'wb-h2', H3: 'wb-h3', H4: 'wb-h4', H5: 'wb-h5', P: 'wb-p', DIV: 'wb-p' };
var BLOCK_BTN_IDS = ['wb-h1', 'wb-h2', 'wb-h3', 'wb-h4', 'wb-h5', 'wb-p', 'wb-ul', 'wb-ol', 'wb-bq', 'wb-codeblock'];

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
        activeBlock = list && list.tagName === 'OL' ? 'wb-ol' : 'wb-ul';
        break;
      }
      if (tag === 'BLOCKQUOTE') { activeBlock = 'wb-bq'; break; }
      if (tag === 'PRE') { activeBlock = 'wb-codeblock'; break; }
      el = el.parentElement;
    }
  }

  for (var i = 0; i < BLOCK_BTN_IDS.length; i++) {
    document.getElementById(BLOCK_BTN_IDS[i]).classList.toggle('active', BLOCK_BTN_IDS[i] === activeBlock);
  }

  document.getElementById('wb-bold').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('wb-italic').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('wb-strike').classList.toggle('active', document.queryCommandState('strikeThrough'));
}

document.addEventListener('selectionchange', function() {
  if (S.currentMode === 'write') updateToolbarState();
});

// ── Convert title→data-tip for CSS tooltips ──────────

var tipBtns = document.querySelectorAll('.write-tb-btn[title]');
for (var t = 0; t < tipBtns.length; t++) {
  tipBtns[t].setAttribute('data-tip', tipBtns[t].getAttribute('title'));
  tipBtns[t].removeAttribute('title');
}

// ── Register on SDocs ──────────────────────────────

S.enterWriteMode = enterWriteMode;
S.exitWriteMode = exitWriteMode;
S.updateToolbarState = updateToolbarState;

})();
