// sdocs-app.js — Core app: render, sync, modes, drag/drop, init
(function () {
'use strict';

var S = SDocs;

// ── SVG icons ──────────────────────────────────

var LINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var CHEVRON_SVG = '<span class="section-toggle"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
var COPY_FEEDBACK_MS = 1500;

// ── Slugify + section helpers ──────────────────────

var slugify = SDocSlugify.slugify;

function buildSectionUrl(slug) {
  var base = window.location.origin + window.location.pathname;
  var hash = window.location.hash.slice(1);
  var params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  params.delete('sec');
  params.set('sec', slug);
  if (S.currentMode !== 'read' && S.currentMode !== 'raw') {
    params.set('mode', S.currentMode);
  }
  return base + '#' + params.toString();
}

function getSectionMarkdown(headingIndex) {
  var lines = S.currentBody.split('\n');
  var headings = [];
  var inFence = false;
  for (var i = 0; i < lines.length; i++) {
    if (/^(`{3,}|~{3,})/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    var m = lines[i].match(/^(#{1,4})\s/);
    if (m) headings.push({ line: i, level: m[1].length });
  }
  if (headingIndex < 0 || headingIndex >= headings.length) return '';
  var target = headings[headingIndex];
  var endLine = lines.length;
  for (var j = headingIndex + 1; j < headings.length; j++) {
    if (headings[j].level <= target.level) {
      endLine = headings[j].line;
      break;
    }
  }
  return lines.slice(target.line, endLine).join('\n').trimEnd();
}

// ── Render sub-functions ──────────────────────────────────

function attachHeadingAnchors(container) {
  var slugCounts = {};
  var allHeadings = [].slice.call(container.querySelectorAll('h1, h2, h3, h4'));
  allHeadings.forEach(function(h, idx) {
    var slug = slugify(h.textContent);
    if (!slug) slug = 'section';
    if (slugCounts[slug] != null) {
      slugCounts[slug]++;
      slug = slug + '-' + slugCounts[slug];
    } else {
      slugCounts[slug] = 0;
    }
    h.id = slug;

    var anchor = document.createElement('a');
    anchor.className = 'header-anchor';
    anchor.innerHTML = LINK_SVG;
    anchor.title = 'Copy link to section';
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      navigator.clipboard.writeText(buildSectionUrl(slug)).then(function() {
        anchor.innerHTML = CHECK_SVG;
        setTimeout(function() { anchor.innerHTML = LINK_SVG; }, COPY_FEEDBACK_MS);
      });
    });
    h.appendChild(anchor);

    var copyBtn = document.createElement('button');
    copyBtn.className = 'header-copy-btn';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.title = 'Copy section';
    var hIdx = idx;
    copyBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var md = getSectionMarkdown(hIdx);
      navigator.clipboard.writeText(md).then(function() {
        copyBtn.innerHTML = CHECK_SVG;
        setTimeout(function() { copyBtn.innerHTML = COPY_SVG; }, COPY_FEEDBACK_MS);
      });
    });
    h.appendChild(copyBtn);
  });
}

function attachCodeCopyButtons(container) {
  container.querySelectorAll('pre').forEach(function(pre) {
    var wrapper = document.createElement('div');
    wrapper.className = 'pre-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = COPY_SVG;
    btn.title = 'Copy code';
    btn.addEventListener('click', function() {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(function() {
        btn.innerHTML = CHECK_SVG;
        setTimeout(function() { btn.innerHTML = COPY_SVG; }, COPY_FEEDBACK_MS);
      });
    });
    wrapper.appendChild(btn);
  });
}

var SECTION_LEVELS = { H2: 2, H3: 3, H4: 4 };

function buildCollapsibleSections(container) {
  // H1 expand/collapse toggle (controls all sections below)
  container.querySelectorAll('h1').forEach(function(h1) {
    h1.insertAdjacentHTML('afterbegin', CHEVRON_SVG);
    h1.style.cursor = 'pointer';
    h1.addEventListener('click', function(e) {
      if (e.target.closest('.header-anchor') || e.target.closest('.header-copy-btn')) return;
      var toggle = h1.querySelector('.section-toggle');
      var isOpen = toggle.classList.toggle('open');
      container.querySelectorAll('.md-section-body').forEach(function(b) { b.classList.toggle('open', isOpen); });
      container.querySelectorAll('.md-section > h2 > .section-toggle, .md-section > h3 > .section-toggle, .md-section > h4 > .section-toggle').forEach(function(t) { t.classList.toggle('open', isOpen); });
    });
  });

  // Nest H2/H3/H4 into collapsible section wrappers.
  // Each stack frame tracks its heading level so siblings are siblings
  // even when intermediate levels are skipped (e.g. h1 → h4 directly).
  var children = [].slice.call(container.children);
  var stack = [{ body: container, level: 0 }];
  children.forEach(function(child) {
    var level = SECTION_LEVELS[child.tagName];
    if (level) {
      while (stack[stack.length - 1].level >= level) stack.pop();
      var sectionDiv = document.createElement('div');
      sectionDiv.className = 'md-section';
      var sectionBody = document.createElement('div');
      sectionBody.className = 'md-section-body';
      child.insertAdjacentHTML('afterbegin', CHEVRON_SVG);
      stack[stack.length - 1].body.appendChild(sectionDiv);
      sectionDiv.appendChild(child);
      sectionDiv.appendChild(sectionBody);
      stack.push({ body: sectionBody, level: level });
    } else {
      stack[stack.length - 1].body.appendChild(child);
    }
  });

  // Attach click handlers for section heading toggles
  container.querySelectorAll('.md-section > h2, .md-section > h3, .md-section > h4').forEach(function(heading) {
    heading.addEventListener('click', function(e) {
      if (e.target.closest('.header-anchor') || e.target.closest('.header-copy-btn')) return;
      var yBefore = heading.getBoundingClientRect().top;
      var section = heading.closest('.md-section');
      var body = section.querySelector('.md-section-body');
      var toggle = section.querySelector('.section-toggle');
      var isOpen = body.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      body.querySelectorAll('.md-section-body').forEach(function(b) { b.classList.toggle('open', isOpen); });
      body.querySelectorAll('.section-toggle').forEach(function(t) { t.classList.toggle('open', isOpen); });
      var yAfter = heading.getBoundingClientRect().top;
      if (yAfter !== yBefore) {
        contentArea.scrollTop += yAfter - yBefore;
      }
    });
  });
}

// ── Render (orchestrator) ──────────────────────────────────

function render() {
  S.destroyCharts();
  var oldSpacer = S.renderedEl.querySelector('.sec-scroll-spacer');
  if (oldSpacer) oldSpacer.remove();
  S.renderedEl.innerHTML = DOMPurify.sanitize(marked.parse(S.currentBody));

  attachHeadingAnchors(S.renderedEl);
  attachCodeCopyButtons(S.renderedEl);
  buildCollapsibleSections(S.renderedEl);
  S.processCharts(S.renderedEl);
  renderFileInfoCard();
}

// ── File-info card ─────────────────────────────────────────

function renderFileInfoCard() {
  var card = document.getElementById('_sd_sdocs-file-info');
  if (!card) return;
  var meta = S.currentMeta || {};
  var local = S.localMeta || {};
  var rowsEl = card.querySelector('.fic-rows');

  var rows = [];
  if (meta.file)      rows.push({ key: 'file',     label: 'Filename',  value: meta.file,      local: false });
  if (local.path)     rows.push({ key: 'path',     label: 'Rel. Path', value: local.path,     local: true  });
  if (local.fullPath) rows.push({ key: 'fullPath', label: 'Abs. Path', value: local.fullPath, local: true  });

  if (rows.length === 0) {
    card.hidden = true;
    rowsEl.innerHTML = '';
    return;
  }

  card.hidden = false;
  var note = card.querySelector('.fic-privacy-note');
  if (note) note.hidden = !rows.some(function(r) { return r.local; });
  rowsEl.innerHTML = rows.map(function(r) {
    var pill = r.local ? '<span class="fic-local-tag" title="Only visible on this device — not included in shared sdocs">Local only</span>' : '';
    return '<div class="fic-row" data-key="' + r.key + '">'
      + '<span class="fic-label">' + r.label + '</span>'
      + '<span class="fic-value">' + escapeHtml(r.value) + '</span>'
      + pill
      + '<button class="fic-copy" title="Copy ' + r.label.toLowerCase() + '">' + COPY_SVG + '</button>'
      + '</div>';
  }).join('');

  rowsEl.querySelectorAll('.fic-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var val = row.querySelector('.fic-value').textContent;
      var btn = row.querySelector('.fic-copy');
      copyWithIconFeedback(val, btn);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}

// Swap the button's <svg> to a check, restore after COPY_FEEDBACK_MS.
// Works for both icon-only and icon+label buttons.
function copyWithIconFeedback(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    if (!btn) return;
    var svg = btn.querySelector('svg');
    if (svg) {
      svg.outerHTML = CHECK_SVG;
      setTimeout(function() {
        var current = btn.querySelector('svg');
        if (current) current.outerHTML = COPY_SVG;
      }, COPY_FEEDBACK_MS);
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  var copyFile = document.getElementById('_sd_btn-copy-file');
  if (copyFile) {
    copyFile.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var meta = Object.assign({}, S.currentMeta || {}, { styles: S.collectStyles() });
      var full = SDocYaml.serializeFrontMatter(meta) + '\n' + (S.currentBody || '');
      copyWithIconFeedback(full, copyFile);
    });
  }
});

// ── Status ──────────────────────────────────

function setStatus(msg) {
  document.getElementById('_sd_status-text').textContent = msg;
}

// ── Load content ──────────────────────────────────

function loadText(text, filename) {
  var parsed = SDocYaml.parseFrontMatter(text);
  S.currentMeta = parsed.meta;
  S.currentBody = parsed.body;
  S.chartStyles = (parsed.meta.styles && parsed.meta.styles.chart) || null;
  render();
  if (parsed.meta.styles) S.applyStylesFromMeta(parsed.meta.styles);
  // Re-apply theme defaults for standalone colors (front matter may have
  // theme-specific values that don't match the viewer's current theme)
  S.STANDALONE_COLOR_IDS.forEach(function(ctrlId) {
    if (!S.overriddenColors.has(ctrlId)) {
      var val = S.getStandaloneDefault(ctrlId);
      var el = document.getElementById(ctrlId);
      if (el) {
        el.value = val;
        var allVals = S.readAllControlValues();
        SDocStyles.controlToCssVars(ctrlId, val, allVals)
          .forEach(function(a) { S.setStyleVar(a.cssVar, a.value); });
      }
    }
  });
  S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
  setStatus(filename ? 'Loaded: ' + filename : '');
  syncAll('load');
}

// ── Compression helpers (brotli + base64url) ──

function concatChunks(chunks) {
  var total = chunks.reduce(function(n, c) { return n + c.length; }, 0);
  var buf = new Uint8Array(total);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) { buf.set(chunks[i], offset); offset += chunks[i].length; }
  return buf;
}

async function readAllChunks(readable) {
  var chunks = [];
  var reader = readable.getReader();
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  return concatChunks(chunks);
}

function toBase64Url(bytes) {
  var bin = Array.from(new Uint8Array(bytes), function(b) { return String.fromCharCode(b); }).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function compressDeflate(text) {
  var encoded = new TextEncoder().encode(text);
  var cs = new CompressionStream('deflate-raw');
  var writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();
  return toBase64Url(await readAllChunks(cs.readable));
}

async function compressText(text) {
  if (typeof BrotliWasm === 'undefined') return compressDeflate(text);
  try {
    await BrotliWasm.ready;
    var encoded = new TextEncoder().encode(text);
    var compressed = BrotliWasm.compress(encoded, { quality: 11 });
    return toBase64Url(compressed);
  } catch (_) {
    return compressDeflate(text);
  }
}

async function decompressDeflate(bytes) {
  var ds = new DecompressionStream('deflate-raw');
  var writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new TextDecoder().decode(await readAllChunks(ds.readable));
}

async function decompressText(b64url) {
  var bytes = fromBase64Url(b64url);
  // Try brotli first, fall back to deflate for old URLs or missing WASM
  if (typeof BrotliWasm !== 'undefined') {
    try {
      await BrotliWasm.ready;
      var decompressed = BrotliWasm.decompress(bytes);
      return new TextDecoder().decode(decompressed);
    } catch (_) {}
  }
  return decompressDeflate(bytes);
}

// ── Auto-save to URL hash ──────────────────────────

function updateHash() {
  clearTimeout(S._hashTimer);
  S._hashTimer = setTimeout(async function() {
    if (S._isDefaultState && S.currentMode === 'read') {
      history.replaceState(null, '', window.location.pathname === '/new' ? '/' : window.location.pathname);
      return;
    }
    var params = new URLSearchParams();
    if (!S._isDefaultState) {
      var styles = SDocStyles.stripStyleDefaults(S.collectStyles());
      var meta = Object.assign({}, S.currentMeta);
      if (Object.keys(styles).length > 0) meta.styles = styles;
      else delete meta.styles;
      var full = SDocYaml.serializeFrontMatter(meta) + '\n' + S.currentBody;
      var compressed = await compressText(full);
      params.set('md', compressed);
    }
    if (S.currentMode !== 'read') {
      params.set('mode', S.currentMode);
    }
    var basePath = window.location.pathname === '/new' ? '/' : window.location.pathname;
    history.replaceState(null, '', basePath + '#' + params.toString());
  }, 400);
}

// ── State sync ──────────────────────────────────

function syncAll(source) {
  if (S._syncing) return;
  S._syncing = true;
  try {
    if (source === 'controls') {
      S._isDefaultState = false;
      S.invalidateLocalMeta();
      S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
      S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
      updateHash();
    } else if (source === 'raw') {
      S._isDefaultState = false;
      var parsed = SDocYaml.parseFrontMatter(S.rawEl.value);
      S.currentMeta = parsed.meta;
      S.currentBody = parsed.body;
      render();
      if (parsed.meta.styles) S.applyStylesFromMeta(parsed.meta.styles);
      updateHash();
    } else if (source === 'write') {
      S._isDefaultState = false;
      S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
      S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
      updateHash();
    } else if (source === 'load') {
      updateHash();
    }
  } finally {
    S._syncing = false;
  }
}

// ── Drag & drop ──────────────────────────────────

var contentArea = document.getElementById('_sd_content-area');

contentArea.addEventListener('dragover', function(e) {
  e.preventDefault();
  contentArea.classList.add('drag-over');
});
['dragleave','dragend'].forEach(function(ev) {
  contentArea.addEventListener(ev, function() { contentArea.classList.remove('drag-over'); });
});
contentArea.addEventListener('drop', function(e) {
  e.preventDefault();
  contentArea.classList.remove('drag-over');
  var file = e.dataTransfer.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) { S._isDefaultState = false; loadText(ev.target.result, file.name); };
  reader.readAsText(file);
});

S.rawEl.addEventListener('input', function() {
  // Content has diverged from the on-disk file — drop local paths.
  S.invalidateLocalMeta();

  clearTimeout(S._rawSyncTimer);
  S._rawSyncTimer = setTimeout(function() { syncAll('raw'); }, 300);
});

// ── Mode toggle (read / style / raw / export) ──────────────────

function setMode(mode, skipHash) {
  var prev = S.currentMode;
  S.currentMode = mode;

  // Exit write mode — extract markdown back
  if (prev === 'write' && mode !== 'write') {
    S.exitWriteMode();
  }

  S.renderedEl.style.display = (mode === 'raw' || mode === 'write') ? 'none' : '';
  S.rawEl.style.display      = mode === 'raw' ? 'block' : 'none';

  document.getElementById('_sd_btn-read').classList.toggle('active',   mode === 'read');
  document.getElementById('_sd_btn-style').classList.toggle('active',  mode === 'style');
  document.getElementById('_sd_btn-write').classList.toggle('active',  mode === 'write');
  document.getElementById('_sd_btn-raw').classList.toggle('active',    mode === 'raw');
  document.getElementById('_sd_btn-export').classList.toggle('active', mode === 'export');

  document.body.classList.toggle('style-mode',  mode === 'style');
  document.body.classList.toggle('read-mode',   mode === 'read');
  document.body.classList.toggle('write-mode',  mode === 'write');
  document.body.classList.toggle('raw-mode',    mode === 'raw');
  document.body.classList.toggle('export-mode', mode === 'export');
  document.body.classList.remove('mobile-sheet-open');
  document.body.classList.remove('mobile-export-open');

  // Enter write mode — populate contentEditable
  if (mode === 'write') {
    S.enterWriteMode();
  }

  if (mode === 'read') {
    document.getElementById('_sd_content-area').focus();
  }

  if (!skipHash) updateHash();
}

document.getElementById('_sd_btn-theme').addEventListener('click', function() { S.toggleTheme(); });
document.getElementById('_sd_theme-tab-light').addEventListener('click', function() { S.switchThemeAndUpdate('light'); });
document.getElementById('_sd_theme-tab-dark').addEventListener('click', function() { S.switchThemeAndUpdate('dark'); });
document.getElementById('_sd_btn-read').addEventListener('click',   function() { setMode('read'); });
document.getElementById('_sd_btn-style').addEventListener('click',  function() { setMode('style'); });
document.getElementById('_sd_btn-write').addEventListener('click',  function() { setMode('write'); });
document.getElementById('_sd_btn-raw').addEventListener('click',    function() { setMode('raw'); });
document.getElementById('_sd_btn-export').addEventListener('click', function() { setMode('export'); });

document.getElementById('_sd_btn-new').addEventListener('click', function() {
  history.replaceState(null, '', '/new');
  startNewDocument();
});


document.getElementById('_sd_right-header').addEventListener('click', function() {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle('mobile-sheet-open');
  }
});

document.getElementById('_sd_export-panel-header').addEventListener('click', function() {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle('mobile-export-open');
  }
});

document.getElementById('_sd_factory-reset-styles').addEventListener('click', function() {
  S.resetAllStyles();
  S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
  render();
  syncAll('load');
});

document.getElementById('_sd_toolbar-brand').addEventListener('click', function(e) {
  e.preventDefault();
  if (window.location.hash && window.location.hash.indexOf('md=') !== -1) {
    window.open(window.location.origin + window.location.pathname, '_blank');
    return;
  }
  S.resetAllStyles();
  loadText(DEFAULT_MD);
  S._isDefaultState = true;
  clearTimeout(S._hashTimer);
  history.replaceState(null, '', window.location.pathname);
  setMode('read');
});

// ── Collapsible panels ──────────────────────────────

document.querySelectorAll('.panel-header').forEach(function(h) {
  h.addEventListener('click', function() {
    var body = document.getElementById(h.dataset.target);
    var open = body.classList.toggle('open');
    h.classList.toggle('open', open);
  });
});
document.querySelectorAll('.sub-header').forEach(function(h) {
  h.addEventListener('click', function() {
    var body = document.getElementById(h.dataset.target);
    var open = body.classList.toggle('open');
    h.classList.toggle('open', open);
  });
});

// ── Default content ──────────────────────────────────

var DEFAULT_MD = '';
var _defaultReady = fetch('/public/sdoc.md').then(function(r) { return r.text(); }).then(function(t) { DEFAULT_MD = t; });

// ── Register on SDocs for cross-module access ──────────

function startNewDocument() {
  S.resetAllStyles();
  S.currentBody = '';
  S.currentMeta = {};
  S._isDefaultState = false;
  clearTimeout(S._hashTimer);
  render();
  setMode('write', true);
  var w = S.writeEl;
  w.innerHTML = '<h1><br></h1>';
  w.focus();
  var range = document.createRange();
  range.selectNodeContents(w.querySelector('h1'));
  range.collapse(false);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  setTimeout(function() { S.updateToolbarState(); }, 0);
}

S.syncAll = syncAll;
S.setStatus = setStatus;
S.setMode = setMode;
S.render = render;
S.loadText = loadText;
S.renderFileInfoCard = renderFileInfoCard;

// Clear runtime-only local metadata (paths) once the user has edited the
// document, since the content no longer corresponds to the file on disk.
// Suppressed while a document is loading — style changes during load come from
// applying saved styles, not from user edits.
S.invalidateLocalMeta = function() {
  if (S._loadingDocument) return;
  if (!S.localMeta || Object.keys(S.localMeta).length === 0) return;
  S.localMeta = {};
  renderFileInfoCard();
};

// Sync theme tabs to initial theme
S.updateThemeTabs(S.activeTheme);

// ── Load document from URL hash ──────────────────────────────────

var _lastLoadedHash = null;

async function loadFromHash() {
  var hash = window.location.hash.slice(1);
  if (hash === _lastLoadedHash) return;
  _lastLoadedHash = hash;

  clearTimeout(S._hashTimer);

  var params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  var mdParam = params.get('md');
  var modeParam = params.get('mode');
  var stylesParam = params.get('styles');
  var themeParam = params.get('theme');
  var secParam = params.get('sec');
  var localParam = params.get('local');

  // Read &local=<base64url-json> into memory, then strip it from the URL bar
  // so anything the user copies/shares no longer contains it.
  if (localParam) {
    try {
      var b64 = localParam.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      S.localMeta = JSON.parse(atob(b64)) || {};
    } catch (e) {
      S.localMeta = {};
    }
    params.delete('local');
    var newHash = params.toString();
    var newUrl = window.location.pathname + (newHash ? '#' + newHash : '');
    window.history.replaceState(null, '', newUrl);
    _lastLoadedHash = newHash; // prevent re-trigger
  }

  S._loadingDocument = true;
  S.resetAllStyles();

  if (mdParam) {
    try {
      S._isDefaultState = false;
      var text = await decompressText(mdParam);
      loadText(text);
    } catch (e) {
      console.warn('sdocs-dev: could not decode hash', e);
    }
  }

  if (themeParam === 'light' || themeParam === 'dark') {
    var savedPref = localStorage.getItem('sdocs-theme');
    S.switchThemeAndUpdate(themeParam);
    // Restore localStorage — URL theme is view-only, not persistent
    if (savedPref) localStorage.setItem('sdocs-theme', savedPref);
    else localStorage.removeItem('sdocs-theme');
  } else {
    // Restore user's actual preferred theme (previous hash may have overridden it)
    var preferred = S.getPreferredTheme();
    if (preferred !== S.activeTheme) {
      S.switchThemeAndUpdate(preferred);
    }
  }

  if (modeParam && ['read', 'style', 'write', 'raw', 'export'].includes(modeParam)) {
    setMode(modeParam, true);
  } else {
    setMode('read', true);
  }

  if (!mdParam) {
    S._isDefaultState = true;
    loadText(DEFAULT_MD);
    if (stylesParam) {
      try {
        var styles = JSON.parse(atob(decodeURIComponent(stylesParam)));
        S.applyStylesFromMeta(styles);
      } catch (e) {
        console.warn('sdocs-dev: could not decode #styles hash', e);
      }
    }
  }

  if (secParam) {
    setTimeout(function() {
      var target = document.getElementById(secParam);
      if (!target) return;

      var ownSection = target.closest('.md-section');
      if (ownSection) {
        var ownBody = ownSection.querySelector(':scope > .md-section-body');
        if (ownBody) { ownBody.classList.add('open'); }
        var ownToggle = ownSection.querySelector(':scope > h1 > .section-toggle, :scope > h2 > .section-toggle, :scope > h3 > .section-toggle, :scope > h4 > .section-toggle');
        if (ownToggle) { ownToggle.classList.add('open'); }
      }

      var el = target.closest('.md-section-body');
      while (el) {
        el.classList.add('open');
        var parentSection = el.closest('.md-section');
        if (parentSection) {
          var toggle = parentSection.querySelector(':scope > h2 > .section-toggle, :scope > h3 > .section-toggle, :scope > h4 > .section-toggle');
          if (toggle) toggle.classList.add('open');
        }
        el = el.parentElement ? el.parentElement.closest('.md-section-body') : null;
      }

      var spacerNeeded = contentArea.clientHeight - (contentArea.scrollHeight - target.offsetTop);
      if (spacerNeeded > 0) {
        var spacer = document.createElement('div');
        spacer.className = 'sec-scroll-spacer';
        spacer.style.height = spacerNeeded + 'px';
        S.renderedEl.appendChild(spacer);
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }

  if (!secParam) {
    contentArea.scrollTop = 0;
  }
}

// ── Init ──────────────────────────────────

(async function () {
  await _defaultReady;
  if (window.location.pathname === '/new') {
    startNewDocument();
    return;
  }
  await loadFromHash();
}());

window.addEventListener('hashchange', function () {
  loadFromHash();
});

window.addEventListener('popstate', function () {
  loadFromHash();
});

// ── Toolbar scroll hints (fade + bounce-peek) ──────

function initScrollHint(el) {
  function update() {
    var hasOverflow = el.scrollWidth > el.clientWidth + 1;
    el.classList.toggle('has-overflow', hasOverflow);
    if (hasOverflow) {
      var atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      el.classList.toggle('scrolled-end', atEnd);
    }
  }

  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);

  // Bounce-peek: briefly scroll right then back on first show
  var peeked = false;
  function peek() {
    if (peeked) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    peeked = true;
    el.scrollTo({ left: 28, behavior: 'smooth' });
    setTimeout(function() { el.scrollTo({ left: 0, behavior: 'smooth' }); }, 400);
  }

  // Run initial check; peek after a short delay
  update();
  return { update: update, peek: peek };
}

var leftHint = initScrollHint(document.getElementById('_sd_left-toolbar'));
var writeHint = initScrollHint(document.getElementById('_sd_write-toolbar'));

// Re-check and peek when entering write mode
var _origSetMode = setMode;
setMode = function(mode, skipHash) {
  _origSetMode(mode, skipHash);
  if (mode === 'write') {
    setTimeout(function() { writeHint.update(); writeHint.peek(); }, 100);
  }
};
S.setMode = setMode;

// Check left toolbar on load
setTimeout(function() { leftHint.update(); leftHint.peek(); }, 500);

})();
