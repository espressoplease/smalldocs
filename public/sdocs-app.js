// sdocs-app.js — Core app module.
//
// Sections (top to bottom):
//   SVG icons                       small inline icons used by render helpers
//   Slugify + section helpers       build per-section URLs, extract section markdown
//   Render sub-functions            heading anchors, code-copy buttons, collapsible sections
//   Render (orchestrator)           run marked + DOMPurify, then the sub-functions above
//   File-info card                  the card shown at the top of read mode
//   Status                          transient status-bar messages
//   Load content                    loadText(): accept a string + filename, populate state
//   Compression helpers             brotli + base64url for the URL-hash encoding
//   Auto-save to URL hash           updateHash(): serialize state to location.hash
//   State sync                      syncAll(): reconcile editor / raw / rendered / write panes
//   Drag & drop                     accept dropped .md files
//   Mode toggle                     read / style / raw / export
//   Collapsible panels              left + right panels
//   Default content                 first-run default document
//   Register on SDocs               cross-module functions registered on window.SDocs
//   Load from URL hash              decompress + hydrate state on initial load
//   Init                            DOMContentLoaded wiring
//   Toolbar scroll hints            fade + bounce-peek on overflow
(function () {
'use strict';

var S = SDocs;

// ── SVG icons ──────────────────────────────────

var LINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var CLOSE_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// Ping the local library agent and remember reachability. The editor
// page uses this to decide whether the Tags row should be editable. Same
// canonical port (47843) as the library page. Re-pings on demand.
function pingLibraryAgent() {
  var url = 'http://127.0.0.1:47843/api/library/health';
  // 700ms timeout so a missing agent doesn't slow the first render.
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var to = ctrl ? setTimeout(function(){ ctrl.abort(); }, 700) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(function(r) { if (to) clearTimeout(to); S.libraryAgent = { reachable: r.ok }; })
    .catch(function() { if (to) clearTimeout(to); S.libraryAgent = { reachable: false }; });
}

// POST to the library agent's tag mutation endpoint. Returns the new
// tag list on success or throws.
function libraryMutateTags(filePath, add, remove) {
  return fetch('http://127.0.0.1:47843/api/library/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, add: add || [], remove: remove || [] }),
  }).then(function(r) {
    if (!r.ok) throw new Error('agent ' + r.status);
    return r.json();
  });
}

// Wire the + button and × buttons in a freshly-rendered Tags row.
function attachTagRowHandlers(row, filePath) {
  var input = row.querySelector('.fic-tag-input');
  var addBtn = row.querySelector('.fic-tag-add');
  function commit(tag) {
    tag = (tag || '').trim().replace(/^[#+]/, '').toLowerCase();
    if (!tag || !/^[a-z][\w-]{0,63}$/.test(tag)) return;
    libraryMutateTags(filePath, [tag], []).then(function(r) {
      if (!S.currentMeta) S.currentMeta = {};
      S.currentMeta.tags = r.tags || [];
      renderFileInfoCard();
    }).catch(function(){});
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      input.hidden = false;
      input.focus();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(input.value); input.value = ''; input.hidden = true; }
      else if (e.key === 'Escape') { input.value = ''; input.hidden = true; }
    });
    input.addEventListener('blur', function() {
      if (input.value.trim()) commit(input.value);
      input.value = ''; input.hidden = true;
    });
  }
  row.querySelectorAll('.fic-tag-x').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var t = btn.getAttribute('data-tag');
      libraryMutateTags(filePath, [], [t]).then(function(r) {
        if (!S.currentMeta) S.currentMeta = {};
        S.currentMeta.tags = r.tags || [];
        renderFileInfoCard();
      }).catch(function(){});
    });
  });
}
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
      container.querySelectorAll('.md-section > h2 > .section-toggle, .md-section > h3 > .section-toggle, .md-section > h4 > .section-toggle, .md-section > .sdoc-block-host > h2 > .section-toggle, .md-section > .sdoc-block-host > h3 > .section-toggle, .md-section > .sdoc-block-host > h4 > .section-toggle').forEach(function(t) { t.classList.toggle('open', isOpen); });
      if (S.syncFoldButton) S.syncFoldButton();
    });
  });

  // Nest H2/H3/H4 into collapsible section wrappers.
  // Each stack frame tracks its heading level so siblings are siblings
  // even when intermediate levels are skipped (e.g. h1 → h4 directly).
  var children = [].slice.call(container.children);
  var stack = [{ body: container, level: 0 }];
  children.forEach(function(child) {
    // H1 resets the nesting stack — each H1 starts a fresh top-level scope,
    // so an H1 that appears after an H2/H3/H4 isn't buried in the previous
    // section's collapsible body.
    if (child.tagName === 'H1') {
      stack = [{ body: container, level: 0 }];
      stack[0].body.appendChild(child);
      return;
    }
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
      if (S.syncFoldButton) S.syncFoldButton();
    });
  });
}

// ── Render (orchestrator) ──────────────────────────────────

function render() {
  S.destroyCharts();
  // Before stomping innerHTML, remember which collapsible sections the
  // user had expanded so we can re-open them after rebuild. Keyed by the
  // heading's slugified id, which is stable across renders of the same
  // body. Use a descendant query for the heading because comment mode
  // wraps headings in a `.sdoc-block-host` div (which our :scope-scoped
  // query would otherwise miss).
  var openIds = [];
  S.renderedEl.querySelectorAll('.md-section').forEach(function (sec) {
    var body = sec.querySelector(':scope > .md-section-body');
    if (!body || !body.classList.contains('open')) return;
    var heading = sec.querySelector('h2, h3, h4');
    if (heading && heading.id) openIds.push(heading.id);
  });
  var oldSpacer = S.renderedEl.querySelector('.sec-scroll-spacer');
  if (oldSpacer) oldSpacer.remove();
  S.renderedEl.innerHTML = DOMPurify.sanitize(marked.parse(S.currentBody), { FORBID_ATTR: ['style'] });

  attachHeadingAnchors(S.renderedEl);
  attachCodeCopyButtons(S.renderedEl);
  buildCollapsibleSections(S.renderedEl);
  // Re-expand sections that were open before this render.
  openIds.forEach(function (id) {
    var heading = S.renderedEl.querySelector('#' + CSS.escape(id));
    if (!heading) return;
    var section = heading.closest('.md-section');
    if (!section) return;
    var body = section.querySelector(':scope > .md-section-body');
    var toggle = heading.querySelector('.section-toggle');
    if (body) body.classList.add('open');
    if (toggle) toggle.classList.add('open');
  });
  S.processCharts(S.renderedEl);
  if (S.processMath) S.processMath(S.renderedEl);
  if (S.processMermaid) S.processMermaid(S.renderedEl);
  if (window.SDocSlides) window.SDocSlides.processSlides(S.renderedEl);
  if (S.renderForms) S.renderForms(S.renderedEl);
  renderFileInfoCard();
  if (S.commentsUi && S.commentsUi.onHostRender) S.commentsUi.onHostRender();
  if (S.syncFoldButton) S.syncFoldButton();
}

// ── File-info card ─────────────────────────────────────────

var SHORT_LINKS_LEARN_URL = 'https://sdocs.dev/#sec=short-links';

function shortenErrorMessage(code) {
  return code === 'rate_limited' ? 'Too many requests, try again later.'
    : code === 'payload_too_large' ? 'Document is too large to shorten.'
    : 'Could not create short link.';
}

async function runShortenFlow(btn, errEl) {
  btn.disabled = true;
  btn.classList.add('fic-shorten-loading');
  var originalLabel = btn.textContent;
  btn.textContent = 'Shortening…';
  if (errEl) errEl.hidden = true;
  try {
    var result = await shortenCurrentDocument();
    S.shortUrl = result.url;
    S.shortLinkId = result.id;
    renderFileInfoCard();
    // Fade in the new short URL row.
    var newRow = document.querySelector('.fic-row-short');
    if (newRow) {
      newRow.classList.add('fic-row-short-enter');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { newRow.classList.remove('fic-row-short-enter'); });
      });
    }
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove('fic-shorten-loading');
    btn.textContent = originalLabel;
    if (errEl) {
      errEl.textContent = shortenErrorMessage(err && err.message);
      errEl.hidden = false;
    }
    return false;
  }
}

function bridgeStateLabel(state) {
  switch (state) {
    case 'connecting':   return 'Connecting to local file...';
    case 'connected':    return 'Syncing with local file';
    case 'saving':       return 'Syncing with local file';
    case 'saved':        return 'Syncing with local file';
    case 'submitted':    return 'Submitted';
    case 'disconnected': return 'Not syncing with local file, stored in browser only';
    case 'error':        return 'Not syncing with local file, stored in browser only';
    default:             return state || 'Connecting to local file...';
  }
}

function bridgeStateIsLost(state) {
  return state === 'disconnected' || state === 'error';
}

// Modes where the user could be changing the file. Editing modes get the
// Edits row; reading / styling / exporting / info hide it so the card stays
// quiet when there's nothing to act on.
function bridgeShouldRender(currentMode) {
  return currentMode === 'write' || currentMode === 'raw' || currentMode === 'comment';
}

// "Actively connected" = the bridge is currently mirroring this document to
// disk. We don't include 'connecting' (still establishing) or the lost /
// submitted states. Used to gate the small "live" chip next to the filename.
function bridgeIsLive(status) {
  return status === 'connected' || status === 'saving' || status === 'saved';
}

// Compact pill rendered next to the filename in non-editing modes. The
// screen-share glyph + the words "local sync" tells the reader this file
// is paired with disk, without nagging them when it isn't.
var BRIDGE_LIVE_CHIP_HTML = ''
  + '<span class="fic-live-chip" data-tip="Connected to the file on your machine. Edits flow both ways.">'
  +   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  +     ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  +     '<path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
  +     '<path d="M8 21h8"/>'
  +     '<path d="M12 17v4"/>'
  +     '<path d="m17 8 5-5"/>'
  +     '<path d="M17 3h5v5"/>'
  +   '</svg>'
  +   '<span>local sync</span>'
  + '</span>';

// Lucide icons (https://lucide.dev). Inlined so the bundle stays free of
// icon-library deps. Stroke is currentColor — colour comes from CSS.
var BRIDGE_SCREEN_SHARE_SVG = ''
  + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  +   ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  +   '<path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
  +   '<path d="M8 21h8"/>'
  +   '<path d="M12 17v4"/>'
  +   '<path d="m17 8 5-5"/>'
  +   '<path d="M17 3h5v5"/>'
  + '</svg>';

var BRIDGE_SCREEN_SHARE_OFF_SVG = ''
  + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  +   ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  +   '<path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
  +   '<path d="M8 21h8"/>'
  +   '<path d="M12 17v4"/>'
  +   '<path d="m22 3-5 5"/>'
  +   '<path d="m17 3 5 5"/>'
  + '</svg>';

function dataRowHtml(key, label, value, isLocal, isShort, extraHtml) {
  var pill = isLocal ? '<span class="fic-local-tag" title="Only visible on this device, not included in shared sdocs">Local only</span>' : '';
  var cls = 'fic-row' + (isShort ? ' fic-row-short' : '');
  return '<div class="' + cls + '" data-key="' + key + '">'
    + '<span class="fic-label">' + label + '</span>'
    + '<span class="fic-value">' + escapeHtml(value) + '</span>'
    + (extraHtml || '')
    + pill
    + '<button class="fic-copy" title="Copy ' + label.toLowerCase() + '">' + COPY_SVG + '</button>'
    + '</div>';
}

function renderFileInfoCard() {
  var card = document.getElementById('_sd_sdocs-file-info');
  if (!card) return;
  var meta = S.currentMeta || {};
  var local = S.localMeta || {};
  var rowsEl = card.querySelector('.fic-rows');

  // The "Edits" row only renders when a bridge session is *or has been*
  // active. Opening a short URL or a regular shared URL has no bridge, and
  // the row stays hidden. If the bridge connects then drops, the row sticks
  // around in the "Connection lost" state so the user knows their typing
  // isn't reaching disk any more.
  var bridge = S.bridge || null;
  var bridgeFile = bridge && bridge.cfg && bridge.cfg.file ? bridge.cfg.file : null;

  var hasDoc = !!(meta.file || S.currentBody || (S.currentMeta && Object.keys(S.currentMeta).length));
  // Edits is a local-only row, but it only renders in editing modes — so
  // only count it toward the privacy-note flag when it'll actually appear.
  var bridgeRowWillRender = !!bridge && bridgeShouldRender(S.currentMode);
  var hasLocalRow = !!(local.path || local.fullPath || bridgeRowWillRender);

  if (!hasDoc && !meta.file && !hasLocalRow && !bridge) {
    card.hidden = true;
    rowsEl.innerHTML = '';
    return;
  }

  card.hidden = false;
  var note = card.querySelector('.fic-privacy-note');
  if (note) note.hidden = !hasLocalRow;

  // Build the row slots in display order. The short-URL slot always sits
  // right after Filename, so the row doesn't jump around as the user moves
  // between the intro / shorten / shortened states.
  var slots = [];
  if (meta.file || bridgeFile) {
    // When the bridge is live and the Edits row isn't showing (read /
    // style / export / info), drop a small "live" chip next to the
    // filename so the reader still knows the file is connected. We never
    // surface a *negative* hint here — disconnect doesn't add a chip.
    var liveChip = (bridge && bridgeIsLive(bridge.status) && !bridgeShouldRender(S.currentMode))
      ? BRIDGE_LIVE_CHIP_HTML
      : '';
    slots.push({ type: 'data', html: dataRowHtml('file', 'Filename', meta.file || bridgeFile, false, false, liveChip) });
  }

  // Don't offer a short URL for the built-in default document (bare / or
  // /legal landing pages). Shortening marketing copy isn't useful and
  // clutters the info card. The flag flips false as soon as the user drops
  // a file, opens a shared link, or edits anything.
  if (hasDoc && !S._isDefaultState) {
    slots.push(S.shortUrl
      ? { type: 'data', html: dataRowHtml('shortUrl', 'Short URL', S.shortUrl, false, true) }
      : { type: 'intro' });
  }

  if (local.path)     slots.push({ type: 'data', html: dataRowHtml('path', 'Rel. Path', local.path, true, false) });
  if (local.fullPath) slots.push({ type: 'data', html: dataRowHtml('fullPath', 'Abs. Path', local.fullPath, true, false) });

  // Tags row: front-matter tags + body hashtags, merged and deduped.
  // Editable when the file lives on disk (local.fullPath) and the local
  // library agent answers - then we add/remove tags via the agent and
  // it writes the file. Otherwise the row is read-only chips.
  var fmTags   = Array.isArray(meta.tags) ? meta.tags.map(String) : [];
  var bodyTags = (window.SDocLibraryTags && window.SDocLibraryTags.extractBodyHashtags)
    ? window.SDocLibraryTags.extractBodyHashtags(S.currentBody || '') : [];
  var tagList = (window.SDocLibraryTags && window.SDocLibraryTags.mergeTags)
    ? window.SDocLibraryTags.mergeTags(fmTags, bodyTags)
    : fmTags.concat(bodyTags);
  var agentReachable = !!(S.libraryAgent && S.libraryAgent.reachable);
  var canEditTags = !!(local.fullPath && agentReachable);
  if (tagList.length || canEditTags) {
    slots.push({ type: 'tags', tags: tagList, canEdit: canEditTags, filePath: local.fullPath });
  }

  // Agent request: shown when the bridge greeted us with a message and the
  // session can submit (feedback mode). Sits ABOVE Edits — it's the thing the
  // user is here to respond to, so it should land first when scanning the
  // card. Disappears once submitted.
  if (bridge && bridge.message && bridge.capabilities && bridge.capabilities.canSubmit && !bridge._submitted) {
    slots.push({ type: 'request', message: bridge.message });
  }

  // Edits sits at the end so every other row is settled first. Only shown
  // in editing modes — in read / style / export / info the row would
  // clutter the card without giving the user anything to act on.
  if (bridge && bridgeShouldRender(S.currentMode)) {
    slots.push({ type: 'bridge', state: bridge.status || 'connecting', label: bridge.statusLabel || bridgeStateLabel(bridge.status) });
  }

  // Render in order. Data rows go in as HTML; action rows are DOM nodes so we
  // can attach handlers to specific elements.
  rowsEl.innerHTML = '';
  slots.forEach(function(slot) {
    if (slot.type === 'data') {
      rowsEl.insertAdjacentHTML('beforeend', slot.html);
    } else if (slot.type === 'bridge') {
      // Edits row: mirrors the data-row layout (label · value · pill · RHS
      // icon slot) so it aligns with the copy buttons above. The icon
      // swaps to screen-share-off and turns dark red when the bridge has
      // dropped — visual signal that typing isn't reaching disk any more.
      var br = document.createElement('div');
      br.className = 'fic-row fic-row-bridge';
      br.setAttribute('data-state', slot.state);
      var icon = bridgeStateIsLost(slot.state) ? BRIDGE_SCREEN_SHARE_OFF_SVG : BRIDGE_SCREEN_SHARE_SVG;
      br.innerHTML = ''
        + '<span class="fic-label">Edits</span>'
        + '<span class="fic-value">' + escapeHtml(slot.label) + '</span>'
        + '<span class="fic-local-tag" title="Only visible on this device, not included in shared sdocs">Local only</span>'
        + '<span class="fic-bridge-icon" title="' + escapeHtml(slot.label) + '">' + icon + '</span>';
      rowsEl.appendChild(br);
    } else if (slot.type === 'request') {
      // Agent request row: same shape as a data row (label · value · action
      // button on the right), but with a subtle left accent so the eye lands
      // here when there's an outstanding question. The Done button is the
      // affordance — clicking it submits the file and ends the session.
      var rqRow = document.createElement('div');
      rqRow.className = 'fic-row fic-row-request';
      rqRow.innerHTML = ''
        + '<span class="fic-label">Agent</span>'
        + '<span class="fic-value fic-request-text">' + escapeHtml(slot.message) + '</span>'
        + '<button class="fic-request-done" type="button" aria-label="Submit and return control to the agent">Done</button>';
      rqRow.querySelector('.fic-request-done').addEventListener('click', function () {
        if (S.bridge && typeof S.bridge.submit === 'function') S.bridge.submit();
      });
      rowsEl.appendChild(rqRow);
    } else if (slot.type === 'tags') {
      var tagRow = document.createElement('div');
      tagRow.className = 'fic-row fic-row-tags' + (slot.canEdit ? ' fic-row-tags-edit' : '');
      var chipsHtml = slot.tags.map(function(t) {
        return '<span class="fic-tag-chip">#' + escapeHtml(t)
          + (slot.canEdit ? '<button class="fic-tag-x" type="button" data-tag="' + escapeHtml(t) + '" aria-label="Remove tag">' + CLOSE_SVG + '</button>' : '')
          + '</span>';
      }).join('');
      var addCtl = slot.canEdit
        ? '<button class="fic-tag-add" type="button" aria-label="Add tag" title="Add tag">+</button>'
          + '<input class="fic-tag-input" type="text" placeholder="add tag" autocomplete="off" hidden>'
        : '';
      tagRow.innerHTML = ''
        + '<span class="fic-label">Tags</span>'
        + '<span class="fic-value fic-tag-chips">' + chipsHtml + addCtl + '</span>';
      if (slot.canEdit) attachTagRowHandlers(tagRow, slot.filePath);
      rowsEl.appendChild(tagRow);
    } else if (slot.type === 'intro') {
      var introRow = document.createElement('div');
      introRow.className = 'fic-row fic-row-short-intro';
      introRow.innerHTML = ''
        + '<span class="fic-label">Short URL</span>'
        + '<button class="fic-shorten-button" title="Generate a short link for this document">Generate</button>'
        + '<span class="fic-short-intro-text">'
        +   'Encrypted document on our server, but decryption key stays with you '
        +   '(<a class="fic-short-intro-learn" href="' + SHORT_LINKS_LEARN_URL + '" target="_blank" rel="noopener">learn more</a>)'
        + '</span>'
        + '<span class="fic-shorten-error" hidden></span>'
        + '<button class="fic-copy fic-generate-icon" title="Generate a short link">' + LINK_SVG + '</button>';
      rowsEl.appendChild(introRow);
      var genBtn = introRow.querySelector('.fic-shorten-button');
      var genIcon = introRow.querySelector('.fic-generate-icon');
      var genErr = introRow.querySelector('.fic-shorten-error');
      function triggerGenerate(e) {
        e.stopPropagation();
        runShortenFlow(genBtn, genErr);
      }
      genBtn.addEventListener('click', triggerGenerate);
      genIcon.addEventListener('click', triggerGenerate);
    }
  });

  // Click-to-copy for plain data rows only. Walk up to the containing button
  // so clicks on the <svg> or <path> inside a .fic-copy still register.
  rowsEl.querySelectorAll('.fic-row[data-key]').forEach(function(row) {
    row.addEventListener('click', function(e) {
      var btnEl = e.target.closest('button');
      if (btnEl && !btnEl.classList.contains('fic-copy')) return;
      var val = row.querySelector('.fic-value').textContent;
      var btn = row.querySelector('.fic-copy');
      copyWithIconFeedback(val, btn);
    });
  });

  // Wire any [data-tip] elements in this freshly re-rendered card (the live
  // chip, primarily) into the shared toolbar-tooltip styling.
  if (typeof S.attachTooltips === 'function') S.attachTooltips(rowsEl);
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
      copyWithIconFeedback(S.currentBody || '', copyFile);
    });
  }
  // Discover the local library agent once. Re-render the file info card
  // when it answers so the Tags row can show edit controls if it's
  // reachable.
  pingLibraryAgent().then(function() { renderFileInfoCard(); });
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
  // Normalize all comments on load. This sanitizes attacker-controlled
  // fields (color, id) from a shared URL before the UI ever reads them.
  // Lifts footnote-format comments out of the body and merges them into
  // meta.comments — markdown-footnote authoring is a valid input format
  // alongside the YAML form. Body markers win on id collision since they
  // represent a more recent edit by the agent.
  if (window.SDocComments) {
    var fn = window.SDocComments.parseFootnotes
      ? window.SDocComments.parseFootnotes(S.currentBody)
      : { comments: [], body: S.currentBody };
    var existing = (S.currentMeta.comments || []).filter(function (c) {
      return !fn.comments.some(function (n) { return n.id === c.id; });
    });
    var merged = existing.concat(fn.comments)
      .map(window.SDocComments.normalizeComment)
      .filter(function (c) { return c !== null; });
    if (merged.length) {
      S.currentMeta = Object.assign({}, S.currentMeta, { comments: merged });
    } else {
      // Existing meta.comments may have been all-malformed; clear it.
      if (S.currentMeta && S.currentMeta.comments) {
        var copy = Object.assign({}, S.currentMeta);
        delete copy.comments;
        S.currentMeta = copy;
      }
    }
    if (fn.comments.length) S.currentBody = fn.body;
  }
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
  // Try brotli first, fall back to deflate for old URLs or missing WASM.
  // BrotliWasm.decompress returns 0 bytes silently on non-brotli input
  // instead of throwing, so treat empty output from non-trivial input as failure.
  if (typeof BrotliWasm !== 'undefined') {
    try {
      await BrotliWasm.ready;
      var decompressed = BrotliWasm.decompress(bytes);
      if (decompressed.length > 0 || bytes.length <= 2) {
        return new TextDecoder().decode(decompressed);
      }
    } catch (_) {}
  }
  return decompressDeflate(bytes);
}

// ── AES-GCM helpers for short-link ciphertext ─────────

async function generateShortLinkKey() {
  var bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function importAesKey(keyBytes, usage) {
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [usage]);
}

// Accepts raw bytes (e.g. compressed markdown output) and encrypts them with
// AES-GCM. Returns a base64url string containing nonce(12) + ciphertext + tag.
async function encryptBytes(plainBytes, keyBytes) {
  var key = await importAesKey(keyBytes, 'encrypt');
  var nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plainBytes);
  var ctBytes = new Uint8Array(ct);
  var out = new Uint8Array(nonce.length + ctBytes.length);
  out.set(nonce, 0);
  out.set(ctBytes, nonce.length);
  return toBase64Url(out);
}

// Reverse of encryptBytes: takes the base64url blob + key, returns raw bytes.
async function decryptBytes(b64url, keyBytes) {
  var blob = fromBase64Url(b64url);
  if (blob.length < 12 + 16) throw new Error('ciphertext too short');
  var nonce = blob.subarray(0, 12);
  var body = blob.subarray(12);
  var key = await importAesKey(keyBytes, 'decrypt');
  var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body);
  return new Uint8Array(plain);
}

// Seal a document for storage: compress it, then AES-GCM encrypt the
// compressed bytes. Returns the base64url ciphertext blob. unsealDocument is
// the exact reverse. These two are the reusable core of the short-link
// mechanism, kept separate from the /api/short transport so chunk 7's
// commercial "sealed mode" can build on S.shortLink (exposed below) with its
// own server rather than duplicating this crypto.
async function sealDocument(text, keyBytes) {
  var compressedB64 = await compressText(text);
  var compressedBytes = fromBase64Url(compressedB64);
  return encryptBytes(compressedBytes, keyBytes);
}

async function unsealDocument(cipherB64, keyBytes) {
  var compressedBytes = await decryptBytes(cipherB64, keyBytes);
  var compressedB64 = toBase64Url(compressedBytes);
  return decompressText(compressedB64);
}

// Compress current document, encrypt with a fresh key, upload ciphertext.
// Returns { url, id } on success; throws on failure.
async function shortenCurrentDocument() {
  var styles = SDocStyles.stripStyleDefaults(S.collectStyles());
  var meta = Object.assign({}, S.currentMeta);
  if (Object.keys(styles).length > 0) meta.styles = styles;
  else delete meta.styles;
  var full = SDocYaml.serializeFrontMatter(meta) + '\n' + S.currentBody;

  var keyBytes = await generateShortLinkKey();
  var cipherB64 = await sealDocument(full, keyBytes);

  var resp = await fetch('/api/short', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext: cipherB64 }),
  });
  if (!resp.ok) {
    var msg = 'short_link_failed';
    try { var j = await resp.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  var data = await resp.json();
  if (!data || !data.id) throw new Error('bad_response');

  var keyB64 = toBase64Url(keyBytes);
  var url = window.location.origin + '/s/' + data.id + '#k=' + keyB64;
  return { url: url, id: data.id };
}

// Given a /s/:id pathname, fetch + decrypt + decompress the stored document.
async function loadShortLink(id, keyB64) {
  if (!keyB64) throw new Error('missing_key');
  var resp = await fetch('/api/short/' + encodeURIComponent(id));
  if (resp.status === 404) throw new Error('not_found');
  if (!resp.ok) throw new Error('fetch_failed');
  var data = await resp.json();
  if (!data || !data.ciphertext) throw new Error('bad_response');
  var keyBytes = fromBase64Url(keyB64);
  return unsealDocument(data.ciphertext, keyBytes);
}

// ── Auto-save to URL hash ──────────────────────────

// The id length range stays wide ({1,32}) so links minted before the
// id-length bump (8 chars) and after it (22 chars) both resolve.
var SHORT_LINK_PATH_RE = /^\/s\/([A-Za-z0-9_-]{1,32})$/;

function normalizedBasePath() {
  var p = window.location.pathname;
  if (p === '/new' || SHORT_LINK_PATH_RE.test(p)) return '/';
  return p;
}

// Params set by other modules (presentation mode, etc.) that we must preserve
// when updateHash rewrites the hash. Without this list, opening present mode
// sets ?present=N but the next debounced updateHash wipes it out, collapsing
// present mode via the hashchange listener.
var PRESERVED_HASH_PARAMS = ['present'];

function updateHash() {
  clearTimeout(S._hashTimer);
  S._hashTimer = setTimeout(async function() {
    var existing = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var preserved = {};
    for (var i = 0; i < PRESERVED_HASH_PARAMS.length; i++) {
      var k = PRESERVED_HASH_PARAMS[i];
      if (existing.has(k)) preserved[k] = existing.get(k);
    }
    var writePreserved = function (p) {
      for (var k in preserved) p.set(k, preserved[k]);
    };
    if (S._isDefaultState && S.currentMode === 'read') {
      if (Object.keys(preserved).length === 0) {
        history.replaceState(null, '', normalizedBasePath());
      } else {
        var p0 = new URLSearchParams();
        writePreserved(p0);
        history.replaceState(null, '', normalizedBasePath() + '#' + p0.toString());
      }
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
    writePreserved(params);
    history.replaceState(null, '', normalizedBasePath() + '#' + params.toString());
  }, 400);
}

// ── State sync ──────────────────────────────────

// A loaded short link is an immutable snapshot of one exact document. Once the
// live document diverges from that snapshot - an edit to text, styles, or
// comments, or a fresh document loaded over it - the short URL no longer
// points at what the user sees, so stop advertising it. Clearing both fields
// and re-rendering the file info card drops the stale "Short URL" row.
// (initShortLink re-sets these immediately after its own loadText, so clearing
// on the 'load' source does no harm.)
function dropShortLinkIfDiverged() {
  if (!S.shortUrl && !S.shortLinkId) return;
  S.shortUrl = null;
  S.shortLinkId = null;
  renderFileInfoCard();
}

function syncAll(source) {
  if (S._syncing) return;
  S._syncing = true;
  try {
    // Theme is a viewer preference, not a document change, so it keeps any
    // loaded short link. Every other source means the document diverged.
    if (source !== 'theme') dropShortLinkIfDiverged();
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
    } else if (source === 'theme') {
      // Theme swap: re-serialize + refresh hash but don't flip
      // _isDefaultState (theme is a viewer preference, not a doc change).
      S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
      S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
      updateHash();
    } else if (source === 'comment') {
      // Comment mode: currentBody changed (comment added/removed). Re-render
      // the markdown (which triggers comments.onHostRender to rebuild overlays)
      // and refresh the hash so the new comment survives reload.
      S._isDefaultState = false;
      S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
      S.rawEl.value = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
      render();
      updateHash();
    }
  } finally {
    S._syncing = false;
    if (S.applyChromeTint) S.applyChromeTint();
    if (S.refreshCommentDot) S.refreshCommentDot();
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

  document.getElementById('_sd_btn-read').classList.toggle('active',    mode === 'read');
  document.getElementById('_sd_btn-style').classList.toggle('active',   mode === 'style');
  document.getElementById('_sd_btn-write').classList.toggle('active',   mode === 'write');
  document.getElementById('_sd_btn-raw').classList.toggle('active',     mode === 'raw');
  document.getElementById('_sd_btn-export').classList.toggle('active',  mode === 'export');
  document.getElementById('_sd_btn-info').classList.toggle('active',    mode === 'info');
  document.getElementById('_sd_btn-comment').classList.toggle('active', mode === 'comment');

  // Auto-expand the overflow group if the active mode lives inside it,
  // otherwise the active indicator would be hidden behind the hamburger.
  var overflowGroup = document.getElementById('_sd_toggle-overflow');
  var overflowBtn = document.getElementById('_sd_btn-overflow');
  if (overflowGroup && overflowBtn && (mode === 'write' || mode === 'raw' || mode === 'export')) {
    overflowGroup.classList.add('open');
    overflowBtn.setAttribute('aria-expanded', 'true');
    overflowBtn.title = 'Close menu';
  }

  document.body.classList.toggle('style-mode',   mode === 'style');
  document.body.classList.toggle('read-mode',    mode === 'read');
  document.body.classList.toggle('write-mode',   mode === 'write');
  document.body.classList.toggle('raw-mode',     mode === 'raw');
  document.body.classList.toggle('export-mode',  mode === 'export');
  document.body.classList.toggle('info-mode',    mode === 'info');
  document.body.classList.toggle('comment-mode', mode === 'comment');
  document.body.classList.remove('mobile-sheet-open');
  document.body.classList.remove('mobile-export-open');
  document.body.classList.remove('mobile-info-open');

  if (prev === 'comment' && mode !== 'comment' && S.commentsUi) S.commentsUi.exit();
  if (mode === 'comment' && S.commentsUi) S.commentsUi.enter();

  // The Slides PDF + PowerPoint options only make sense when the rendered
  // doc contains at least one ```slide block. Gate visibility each time
  // the panel opens.
  if (mode === 'export') {
    var hasSlides = !!document.querySelector('.sdoc-slide');
    var slidesOpt = document.getElementById('_sd_exp-slides-pdf');
    if (slidesOpt) slidesOpt.style.display = hasSlides ? '' : 'none';
    var pptxOpt = document.getElementById('_sd_exp-slides-pptx');
    if (pptxOpt) pptxOpt.style.display = hasSlides ? '' : 'none';
  }

  // Enter write mode — populate contentEditable
  if (mode === 'write') {
    S.enterWriteMode();
  }

  if (mode === 'read') {
    document.getElementById('_sd_content-area').focus();
  }

  // The Edits row in the file-info card only shows in editing modes, so a
  // mode change needs to re-render the card. Bridge-less sessions skip the
  // call — there's no row whose visibility depends on this.
  if (S.bridge) renderFileInfoCard();

  if (!skipHash) updateHash();
}

document.getElementById('_sd_btn-theme').addEventListener('click', function() { S.toggleTheme(); });
document.getElementById('_sd_theme-tab-light').addEventListener('click', function() { S.switchThemeAndUpdate('light'); });
document.getElementById('_sd_theme-tab-dark').addEventListener('click', function() { S.switchThemeAndUpdate('dark'); });
document.getElementById('_sd_btn-read').addEventListener('click',   function() { setMode('read'); });
document.getElementById('_sd_btn-fold').addEventListener('click', function() {
  if (!S.renderedEl) return;
  var bodies = S.renderedEl.querySelectorAll('.md-section-body');
  var allOpen = bodies.length > 0 && Array.prototype.every.call(bodies, function(b) { return b.classList.contains('open'); });
  var nextOpen = !allOpen;
  S.renderedEl.querySelectorAll('h1 > .section-toggle').forEach(function(t) { t.classList.toggle('open', nextOpen); });
  bodies.forEach(function(b) { b.classList.toggle('open', nextOpen); });
  S.renderedEl.querySelectorAll('.md-section .section-toggle').forEach(function(t) { t.classList.toggle('open', nextOpen); });
  syncFoldButton();
});

function syncFoldButton() {
  var btn = document.getElementById('_sd_btn-fold');
  if (!btn || !S.renderedEl) return;
  var bodies = S.renderedEl.querySelectorAll('.md-section-body');
  btn.style.display = bodies.length ? '' : 'none';
  var allOpen = bodies.length > 0 && Array.prototype.every.call(bodies, function(b) { return b.classList.contains('open'); });
  btn.classList.toggle('is-open', allOpen);
  var label = allOpen ? 'Collapse all' : 'Expand all';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('data-tip', label);
}
S.syncFoldButton = syncFoldButton;
document.getElementById('_sd_btn-style').addEventListener('click',  function() { setMode('style'); });
document.getElementById('_sd_btn-write').addEventListener('click',  function() { setMode('write'); });
document.getElementById('_sd_btn-raw').addEventListener('click',    function() { setMode('raw'); });
document.getElementById('_sd_btn-export').addEventListener('click', function() { setMode('export'); });
document.getElementById('_sd_btn-info').addEventListener('click', function() {
  setMode('info');
  if (S.markInfoSeen) S.markInfoSeen();
});
document.getElementById('_sd_btn-comment').addEventListener('click', function() { setMode('comment'); });

document.getElementById('_sd_btn-new').addEventListener('click', function() {
  history.replaceState(null, '', '/new');
  startNewDocument();
});

(function () {
  var btn = document.getElementById('_sd_btn-overflow');
  var group = document.getElementById('_sd_toggle-overflow');
  if (!btn || !group) return;
  btn.addEventListener('click', function () {
    var open = group.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.dataset.tip = open ? 'Less' : 'More';
  });
})();

// Toolbar tooltip: one shared #_sd_tooltip in <body>, positioned below
// the hovered button via fixed coords. Skipped on touch / no-hover devices.
//
// Exposes SDocs.attachTooltips(root) so any module that injects new
// [data-tip] elements (e.g. the file-info card re-rendering the live
// chip) can wire them up after innerHTML writes wipe prior listeners.
(function () {
  var tip = document.getElementById('_sd_tooltip');
  if (!tip) return;
  // Hover-capable, fine pointer = real mouse. Touch + stylus get nothing.
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var DELAY = 300;
  var timer = null;
  var current = null;
  var attached = typeof WeakSet === 'function' ? new WeakSet() : null;

  function position(target) {
    var r = target.getBoundingClientRect();
    var ttRect = tip.getBoundingClientRect();
    // Centred under the button, with an 8px gap for the caret.
    var left = r.left + r.width / 2 - ttRect.width / 2;
    var top = r.bottom + 8;
    // Clamp to viewport so tooltips near the right edge stay visible.
    var pad = 6;
    if (left < pad) left = pad;
    if (left + ttRect.width > window.innerWidth - pad) {
      left = window.innerWidth - pad - ttRect.width;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function show(target) {
    var text = target.dataset.tip;
    if (!text) return;
    current = target;
    tip.textContent = text;
    tip.setAttribute('aria-hidden', 'false');
    // Position once before the show class so transform-origin is right;
    // a second pass after the layout settles (next frame) re-centres
    // because the tooltip may have grown to fit longer text.
    position(target);
    requestAnimationFrame(function () {
      if (current === target) {
        position(target);
        tip.classList.add('show');
      }
    });
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    current = null;
    tip.classList.remove('show');
    tip.setAttribute('aria-hidden', 'true');
  }

  function attach(btn) {
    if (!btn || !btn.dataset || !btn.dataset.tip) return;
    if (attached && attached.has(btn)) return;
    if (attached) attached.add(btn);
    btn.addEventListener('mouseenter', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { show(btn); }, DELAY);
    });
    btn.addEventListener('mouseleave', hide);
    // Dismiss instantly on click — the resulting state change is
    // the user's feedback, the tooltip would just linger.
    btn.addEventListener('click', hide);
    // If the button scrolls offscreen / is hidden mid-hover, drop the tip.
    btn.addEventListener('blur', hide);
  }

  function attachAll(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-tip]').forEach(attach);
  }

  S.attachTooltips = attachAll;

  attachAll(document.getElementById('_sd_left-toolbar'));

  // Hide on scroll/resize because the cached position becomes stale.
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
})();


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

document.getElementById('_sd_info-panel-header').addEventListener('click', function() {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle('mobile-info-open');
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
  // Off-root pages (e.g. /legal) load a different default doc via the
  // meta tag. The logo should take you back to the real home — not reset
  // in place, which would just re-render the same off-root doc.
  if (window.location.pathname !== '/') {
    window.location.href = window.location.origin + '/';
    return;
  }
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
var _defaultMetaEl = document.querySelector('meta[name="sdocs-default-md"]');
var _defaultMdPath = _defaultMetaEl && _defaultMetaEl.content;
// Guard against the server-side template placeholder leaking through
// (e.g. a stale service-worker cache serving an older index.html).
if (!_defaultMdPath || _defaultMdPath.charAt(0) !== '/') _defaultMdPath = '/public/sdoc.md';
var _defaultReady = fetch(_defaultMdPath).then(function(r) { return r.text(); }).then(function(t) { DEFAULT_MD = t; });

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

// The short-link mechanism as one internal interface. Chunk 7's commercial
// "sealed mode" reuses the crypto primitives (generateKey / seal / unseal /
// encodeKey / decodeKey) with its own server transport; create / load are the
// short-link transport (POST + GET /api/short) built on those primitives.
// Sealed mode builds on this interface rather than reaching into the
// module-private functions above.
S.shortLink = {
  generateKey: generateShortLinkKey,
  seal: sealDocument,
  unseal: unsealDocument,
  encodeKey: toBase64Url,
  decodeKey: fromBase64Url,
  create: shortenCurrentDocument,
  load: loadShortLink,
};

// Clear runtime-only local metadata (paths) once the user has edited the
// document, since the content no longer corresponds to the file on disk.
// Suppressed while a document is loading — style changes during load come from
// applying saved styles, not from user edits. Also suppressed while a Bridge
// session is connected: autosave keeps the on-screen document in lockstep
// with the file on disk, so the paths still describe the live content.
S.invalidateLocalMeta = function() {
  if (S._loadingDocument) return;
  if (S.bridge && S.bridge._connected) return;
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

  if (modeParam && ['read', 'style', 'write', 'raw', 'export', 'info', 'comment'].includes(modeParam)) {
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

async function initShortLink(id) {
  var hash = window.location.hash.slice(1);
  var params = hash ? new URLSearchParams(hash) : new URLSearchParams();
  var keyB64 = params.get('k');
  if (!keyB64) {
    setStatus('Short link is missing its decryption key.', 'error');
    return;
  }
  try {
    var text = await loadShortLink(id, keyB64);
    S._isDefaultState = false;
    S._loadingDocument = true;
    S.resetAllStyles();
    loadText(text);
    // loadText -> syncAll('load') -> updateHash queues a URL rewrite. Cancel
    // it so the short link stays visible in the address bar. On the first
    // real edit, updateHash runs again and normalizes the URL to / + #md=.
    clearTimeout(S._hashTimer);
    var modeParam = params.get('mode');
    if (modeParam && ['read', 'style', 'write', 'raw', 'export', 'info', 'comment'].indexOf(modeParam) >= 0) {
      setMode(modeParam, true);
    } else {
      setMode('read', true);
    }
    S.shortUrl = window.location.origin + window.location.pathname + '#k=' + keyB64;
    S.shortLinkId = id;
    if (typeof renderFileInfoCard === 'function') renderFileInfoCard();
  } catch (e) {
    var msg = e && e.message === 'not_found'
      ? 'Short link not found. It may have expired.'
      : e && e.message === 'missing_key'
      ? 'Short link is missing its decryption key.'
      : 'Could not load this short link.';
    setStatus(msg, 'error');
  } finally {
    S._loadingDocument = false;
  }
}

// Register the document sources this build ships with. Order matters:
// Sources.select() picks the FIRST match, so the most specific URL
// shapes go first. Later chunks (Bridge, Library, WorkspaceLink) add a
// new source by calling SDocs.Sources.register from their own module —
// the dispatch below does not change.

S.Sources.register({
  name: 'short-link',
  matches: function (loc) { return SHORT_LINK_PATH_RE.test(loc.pathname); },
  create: function (loc) {
    var id = SHORT_LINK_PATH_RE.exec(loc.pathname)[1];
    return {
      name: 'short-link',
      capabilities: { canSave: false, canWatch: false, canSubmit: false },
      load: function () { return initShortLink(id); },
    };
  },
});

S.Sources.register({
  name: 'new-document',
  matches: function (loc) { return loc.pathname === '/new'; },
  create: function () {
    return {
      name: 'new-document',
      capabilities: { canSave: true, canWatch: false, canSubmit: false },
      load: function () { startNewDocument(); },
    };
  },
});

S.Sources.register({
  name: 'fragment',
  matches: function () { return true; }, // catch-all
  create: function () {
    return {
      name: 'fragment',
      capabilities: { canSave: true, canWatch: false, canSubmit: false },
      load: function () { return loadFromHash(); },
    };
  },
});

(async function () {
  await _defaultReady;
  var source = S.Sources.select();
  if (source) {
    await source.load();
  }
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
var commentHint = initScrollHint(document.getElementById('_sd_comment-toolbar'));

// Re-check and peek when entering write/comment mode
var _origSetMode = setMode;
setMode = function(mode, skipHash) {
  _origSetMode(mode, skipHash);
  if (mode === 'write') {
    setTimeout(function() { writeHint.update(); writeHint.peek(); }, 100);
  } else if (mode === 'comment') {
    setTimeout(function() { commentHint.update(); commentHint.peek(); }, 100);
  }
};
S.setMode = setMode;
S.commentHint = commentHint;

// Check left toolbar on load
setTimeout(function() { leftHint.update(); leftHint.peek(); }, 500);

})();
