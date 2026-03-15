// sdocs-app.js — Core app: render, sync, modes, drag/drop, init
(function () {
'use strict';

var S = SDocs;

// ── SVG icons ──────────────────────────────────

var LINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// ── Slugify + section helpers ──────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

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

// ── Render ──────────────────────────────────

function render() {
  S.renderedEl.innerHTML = marked.parse(S.currentBody);

  var slugCounts = {};
  var allHeadings = [].slice.call(S.renderedEl.querySelectorAll('h1, h2, h3, h4'));
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
        setTimeout(function() { anchor.innerHTML = LINK_SVG; }, 1500);
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
        setTimeout(function() { copyBtn.innerHTML = COPY_SVG; }, 1500);
      });
    });
    h.appendChild(copyBtn);
  });

  S.renderedEl.querySelectorAll('pre').forEach(function(pre) {
    var wrapper = document.createElement('div');
    wrapper.className = 'pre-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.title = 'Copy code';
    btn.addEventListener('click', function() {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(function() {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function() {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
    wrapper.appendChild(btn);
  });

  // Collapsible heading sections (H2, H3, H4)
  var SECTION_CHEVRON = '<span class="section-toggle"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  var SECTION_LEVELS = { H2: 2, H3: 3, H4: 4 };
  var children = [].slice.call(S.renderedEl.children);
  var bodyStack = [S.renderedEl];
  children.forEach(function(child) {
    var level = SECTION_LEVELS[child.tagName];
    if (level) {
      while (bodyStack.length > level - 1) bodyStack.pop();
      var sectionDiv = document.createElement('div');
      sectionDiv.className = 'md-section';
      var sectionBody = document.createElement('div');
      sectionBody.className = 'md-section-body';
      child.insertAdjacentHTML('afterbegin', SECTION_CHEVRON);
      bodyStack[bodyStack.length - 1].appendChild(sectionDiv);
      sectionDiv.appendChild(child);
      sectionDiv.appendChild(sectionBody);
      bodyStack.push(sectionBody);
    } else {
      bodyStack[bodyStack.length - 1].appendChild(child);
    }
  });

  S.renderedEl.querySelectorAll('.md-section > h2, .md-section > h3, .md-section > h4').forEach(function(heading) {
    heading.addEventListener('click', function(e) {
      if (e.target.closest('.header-anchor') || e.target.closest('.header-copy-btn')) return;
      var section = heading.closest('.md-section');
      var body = section.querySelector('.md-section-body');
      var toggle = section.querySelector('.section-toggle');
      var isOpen = body.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      body.querySelectorAll('.md-section-body').forEach(function(b) { b.classList.toggle('open', isOpen); });
      body.querySelectorAll('.section-toggle').forEach(function(t) { t.classList.toggle('open', isOpen); });
    });
  });
}

// ── Status ──────────────────────────────────

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

// ── Load content ──────────────────────────────────

function loadText(text, filename) {
  var parsed = SDocYaml.parseFrontMatter(text);
  S.currentMeta = parsed.meta;
  S.currentBody = parsed.body;
  render();
  if (parsed.meta.styles) S.applyStylesFromMeta(parsed.meta.styles);
  S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
  setStatus(filename ? 'Loaded: ' + filename : 'Ready');
  syncAll('load');
}

// ── Compression helpers (deflate-raw + base64url) ──

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

async function compressText(text) {
  var encoded = new TextEncoder().encode(text);
  var cs = new CompressionStream('deflate-raw');
  var writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();
  var chunks = [];
  var reader = cs.readable.getReader();
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  var total = chunks.reduce(function(n, c) { return n + c.length; }, 0);
  var buf = new Uint8Array(total);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) { buf.set(chunks[i], offset); offset += chunks[i].length; }
  return toBase64Url(buf);
}

async function decompressText(b64url) {
  var bytes = fromBase64Url(b64url);
  var ds = new DecompressionStream('deflate-raw');
  var writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  var chunks = [];
  var reader = ds.readable.getReader();
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  var total = chunks.reduce(function(n, c) { return n + c.length; }, 0);
  var buf = new Uint8Array(total);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) { buf.set(chunks[i], offset); offset += chunks[i].length; }
  return new TextDecoder().decode(buf);
}

// ── Auto-save to URL hash ──────────────────────────

function updateHash() {
  clearTimeout(S._hashTimer);
  S._hashTimer = setTimeout(async function() {
    if (S._isDefaultState && S.currentMode === 'read') {
      history.replaceState(null, '', window.location.pathname);
      return;
    }
    var params = new URLSearchParams();
    if (!S._isDefaultState) {
      var meta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
      var full = SDocYaml.serializeFrontMatter(meta) + '\n' + S.currentBody;
      var compressed = await compressText(full);
      params.set('md', compressed);
    }
    if (S.currentMode !== 'read') {
      params.set('mode', S.currentMode);
    }
    history.replaceState(null, '', '#' + params.toString());
  }, 400);
}

// ── State sync ──────────────────────────────────

function syncAll(source) {
  if (S._syncing) return;
  S._syncing = true;
  try {
    if (source === 'controls') {
      S._isDefaultState = false;
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
    } else if (source === 'load') {
      updateHash();
    }
  } finally {
    S._syncing = false;
  }
}

// ── Drag & drop ──────────────────────────────────

var contentArea = document.getElementById('content-area');

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
  clearTimeout(S._rawSyncTimer);
  S._rawSyncTimer = setTimeout(function() { syncAll('raw'); }, 300);
});

// ── Mode toggle (read / style / raw) ──────────────────

function setMode(mode, skipHash) {
  S.currentMode = mode;
  S.renderedEl.style.display = mode === 'raw' ? 'none' : '';
  S.rawEl.style.display      = mode === 'raw' ? 'block' : 'none';

  document.getElementById('btn-read').classList.toggle('active',  mode === 'read');
  document.getElementById('btn-style').classList.toggle('active', mode === 'style');
  document.getElementById('btn-raw').classList.toggle('active',   mode === 'raw');

  document.body.classList.toggle('read-mode', mode === 'read');
  document.body.classList.toggle('raw-mode', mode === 'raw');
  document.body.classList.remove('mobile-sheet-open');
  if (!skipHash) updateHash();
}

document.getElementById('btn-theme').addEventListener('click', function() { S.toggleTheme(); });
document.getElementById('btn-read').addEventListener('click',  function() { setMode('read'); });
document.getElementById('btn-style').addEventListener('click', function() { setMode('style'); });
document.getElementById('btn-raw').addEventListener('click',   function() { setMode('raw'); });

document.getElementById('btn-expand-all').addEventListener('click', function() {
  S.renderedEl.querySelectorAll('.md-section-body').forEach(function(b) { b.classList.add('open'); });
  S.renderedEl.querySelectorAll('.section-toggle').forEach(function(t) { t.classList.add('open'); });
});
document.getElementById('btn-collapse-all').addEventListener('click', function() {
  S.renderedEl.querySelectorAll('.md-section-body').forEach(function(b) { b.classList.remove('open'); });
  S.renderedEl.querySelectorAll('.section-toggle').forEach(function(t) { t.classList.remove('open'); });
});

document.getElementById('right-header').addEventListener('click', function() {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle('mobile-sheet-open');
  }
});

document.getElementById('factory-reset-styles').addEventListener('click', function() {
  S.resetAllStyles();
  S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
  render();
  syncAll('load');
});

document.getElementById('topbar-brand').addEventListener('click', function(e) {
  e.preventDefault();
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
var _defaultReady = fetch('/public/default.md').then(function(r) { return r.text(); }).then(function(t) { DEFAULT_MD = t; });

// ── Register on SDocs for cross-module access ──────────

S.syncAll = syncAll;
S.setStatus = setStatus;
S.setMode = setMode;
S.render = render;
S.loadText = loadText;

// ── Init ──────────────────────────────────

(async function () {
  await _defaultReady;
  var hash = window.location.hash.slice(1);
  var params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  var mdParam = params.get('md');
  var modeParam = params.get('mode');
  var stylesParam = params.get('styles');
  if (mdParam) {
    try {
      S._isDefaultState = false;
      var text = await decompressText(mdParam);
      loadText(text, 'document.md');
    } catch (e) {
      console.warn('sdocs-dev: could not decode hash', e);
    }
  }
  if (modeParam && ['read', 'style', 'raw'].includes(modeParam)) {
    setMode(modeParam, true);
  } else {
    setMode('read', true);
  }
  if (!mdParam) {
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

  var secParam = params.get('sec');
  if (secParam) {
    setTimeout(function() {
      var target = document.getElementById(secParam);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 200);
  }
}());

})();
