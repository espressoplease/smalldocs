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

  // Check if cursor/selection is already inside a <code> element
  var node = sel.anchorNode;
  var existingCode = null;
  var el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el !== writeEl) {
    if (el.tagName === 'CODE' && !el.closest('pre')) { existingCode = el; break; }
    el = el.parentElement;
  }

  if (existingCode) {
    // Unwrap: replace <code> with its text content
    var text = document.createTextNode(existingCode.textContent);
    existingCode.replaceWith(text);
    range = document.createRange();
    range.selectNodeContents(text);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  if (range.collapsed) {
    // No selection: insert an empty <code> span the user can type into
    var code = document.createElement('code');
    code.textContent = '\u200B'; // zero-width space as placeholder
    range.insertNode(code);
    range = document.createRange();
    range.setStart(code.firstChild, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  // Wrap selection in <code>
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
  if (!sel.rangeCount) return;
  var node = sel.anchorNode;
  // Check if cursor is inside a blockquote
  var el = node.nodeType === 1 ? node : node.parentElement;
  var bq = null;
  while (el && el !== writeEl) {
    if (el.tagName === 'BLOCKQUOTE') { bq = el; break; }
    el = el.parentElement;
  }
  if (bq) {
    // Unwrap: move all children out of blockquote, replace with paragraphs
    var children = [].slice.call(bq.childNodes);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 1 && (child.tagName === 'P' || child.tagName === 'DIV')) {
        frag.appendChild(child);
      } else if (child.nodeType === 3 && child.textContent.trim()) {
        var p = document.createElement('p');
        p.textContent = child.textContent.trim();
        frag.appendChild(p);
      } else {
        frag.appendChild(child);
      }
    }
    bq.replaceWith(frag);
    // Place cursor in first paragraph
    var firstP = frag.firstChild || frag;
    if (firstP.nodeType === 11) firstP = firstP.firstChild; // DocumentFragment
    placeCursorAtEnd(firstP);
    return;
  }
  // Wrap current block in blockquote
  var block = getContainingBlock(sel.anchorNode);
  if (block && block !== writeEl) {
    var bqNew = document.createElement('blockquote');
    block.replaceWith(bqNew);
    bqNew.appendChild(block);
    placeCursorAtEnd(block);
  }
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
  var node = sel.anchorNode;

  // Check if cursor is already inside a code block — toggle off
  var el = node && (node.nodeType === 1 ? node : node.parentElement);
  var existingPre = null;
  while (el && el !== writeEl) {
    if (el.tagName === 'PRE') { existingPre = el; break; }
    el = el.parentElement;
  }
  if (existingPre) {
    // Unwrap: convert code block content to a paragraph
    var codeEl = existingPre.querySelector('code') || existingPre;
    var text = codeEl.textContent.replace(/\n+$/, '').replace(/^\n+/, '');
    var p = document.createElement('p');
    p.textContent = text || '\u00A0';
    existingPre.replaceWith(p);
    placeCursorAtEnd(p);
    return;
  }

  // Insert new code block — use selected text as content if any
  var range = sel.getRangeAt(0);
  var selectedText = sel.toString();
  var block = getContainingBlock(node);
  var pre = document.createElement('pre');
  var code = document.createElement('code');

  if (selectedText) {
    code.textContent = selectedText + '\n';
    // Remove the selected content from the DOM
    range.deleteContents();
    // If the containing block is now empty, replace it with the code block
    if (block && block !== writeEl && !block.textContent.trim()) {
      block.replaceWith(pre);
    } else if (block && block !== writeEl) {
      block.after(pre);
    } else {
      writeEl.appendChild(pre);
    }
  } else {
    code.textContent = '\n';
    if (block && block !== writeEl) {
      block.after(pre);
    } else {
      writeEl.appendChild(pre);
    }
  }

  pre.appendChild(code);
  var after = document.createElement('p');
  after.innerHTML = '<br>';
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
