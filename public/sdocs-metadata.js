/* Document metadata uses the same side panel as sharing and formatting. */
(function () {
  'use strict';
  var S = window.SDocs;
  var panel = document.getElementById('_sd_metadata-panel');
  var button = document.getElementById('_sd_btn-metadata');
  if (!S || !panel || !button) return;
  var signature = '';

  function field(key, label, value) {
    if (!value) return;
    value = String(value);
    var section = document.createElement('section');
    section.className = 'panel-section sdoc-metadata-field';
    section.dataset.metadata = key;
    var heading = document.createElement('h2');
    heading.className = 'sdoc-metadata-label';
    heading.textContent = label;
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn sdoc-metadata-value';
    copy.setAttribute('aria-label', 'Copy ' + label.toLowerCase());
    var text = document.createElement('span');
    text.textContent = value;
    text.id = 'sdoc-metadata-' + key + '-value';
    copy.setAttribute('aria-describedby', text.id);
    copy.appendChild(text);
    copy.insertAdjacentHTML('beforeend', S.copyIcon || '');
    var status = document.createElement('span');
    status.className = 'sdoc-metadata-status';
    status.setAttribute('role', 'status');
    copy.addEventListener('click', function () {
      S.copyWithIconFeedback(value, copy).then(function () {
        status.textContent = label + ' copied.';
      }).catch(function () {
        status.textContent = 'Could not copy. Select the text to copy it.';
      });
    });
    section.append(heading, copy, status);
    panel.appendChild(section);
  }

  function update() {
    var meta = S.currentMeta || {};
    var paths = S.fileInfoPaths();
    var h1 = S.renderedEl && S.renderedEl.querySelector('h1');
    var heading = h1 && h1.cloneNode(true);
    if (heading) heading.querySelectorAll('button, .heading-anchor, .heading-copy').forEach(function (node) { node.remove(); });
    var title = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : String(meta.title || '');
    var bridge = S.bridge;
    var filename = paths.fullPath || paths.path ? '' : String(meta.file || (bridge && bridge.cfg && bridge.cfg.file) || '');
    var live = !!(bridge && ['connected', 'saving', 'saved'].indexOf(bridge.status) >= 0);
    var next = JSON.stringify([title, paths, filename, live]);
    if (next === signature) return;
    signature = next;
    panel.replaceChildren();
    field('title', 'Document title', title);
    field('fullPath', 'Absolute path', paths.fullPath);
    field('path', 'Relative path', paths.path);
    field('file', 'File name', filename);
    var note = document.createElement('p');
    note.className = 'sdoc-metadata-note';
    if (paths.fullPath || paths.path) {
      note.textContent = paths.creatorOnly ? 'File paths are visible only to you.' : 'Local file paths are not included in shared copies.';
      panel.appendChild(note);
    } else if (!title && !filename) {
      note.textContent = 'This document has no title or file paths.';
      panel.appendChild(note);
    }
    if (live) {
      var sync = document.createElement('p');
      sync.className = 'sdoc-metadata-note sdoc-metadata-sync';
      sync.textContent = 'Connected to the file on your machine. Edits flow both ways.';
      panel.appendChild(sync);
    }
  }

  button.addEventListener('click', function () {
    S.setMode(S.currentMode === 'metadata' ? 'read' : 'metadata');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && S.currentMode === 'metadata') {
      S.setMode('read');
      button.focus();
    }
  });
  S.metadata = { update: update };
})();
