// sdocs-slide-comments.js — comment mode for ```slide blocks.
//
// In comment mode, every rendered slide (the inline thumbnail AND the
// fullscreen present view) gets a transparent "hit layer": one overlay per
// shape, positioned from the shape's bounding box. Hovering an overlay
// highlights it; clicking opens a composer to leave feedback on that element.
// A separate button leaves a note on the whole slide ("Drop this", "make this
// about the last six months").
//
// The anchor is (slideIndex, shapeIndex) — both come straight from the
// rendered DOM (`data-slide-index`, `data-shape-idx`) and line up with a shape
// line in the slide source the model reads. Notes are stored as kind:'slide'
// comments in front matter (see sdocs-comments.js) and flow out through the
// existing copy-with-comments footnote serializer untouched.
//
// The pure geometry (computeHitRects) takes the shapes library as an argument
// so Node tests can exercise it without a DOM.

(function (global) {
'use strict';

// ── Pure geometry ───────────────────────────────────────────────────────
//
// Map a slide's DSL to a list of hit rectangles in PERCENT of the slide wrap,
// one per resolved shape. The wrap is un-transformed and shares the grid
// aspect ratio, so percent-of-wrap === grid-fraction — no transform math.
function computeHitRects(dsl, shapesLib) {
  var lib = shapesLib || (typeof window !== 'undefined' ? window.SDocShapes : null);
  if (!lib || typeof dsl !== 'string') return [];
  var parsed = lib.parse(dsl);
  var resolved = lib.resolve(parsed.shapes);
  var grid = parsed.grid || lib.DEFAULT_GRID;
  var gw = grid.w || 100, gh = grid.h || 56.25;
  // Lines and horizontal/vertical arrows have a zero-thickness bbox; give
  // every overlay a small minimum so thin decorative shapes stay clickable.
  var minW = gw * 0.03, minH = gh * 0.03;
  var rects = [];
  var kindCount = {};
  for (var i = 0; i < resolved.shapes.length; i++) {
    var s = resolved.shapes[i];
    // Count every shape of this kind in source order so the ordinal label
    // ("1st arrow") is stable and matches what a reader counts top-to-bottom.
    kindCount[s.kind] = (kindCount[s.kind] || 0) + 1;
    var box;
    try { box = lib.bboxOf(s); } catch (_) { continue; }
    if (!box) continue;
    var x = box.x, y = box.y, w = box.w, h = box.h;
    if (w < minW) { x -= (minW - w) / 2; w = minW; }
    if (h < minH) { y -= (minH - h) / 2; h = minH; }
    var text = shapeText(s);
    rects.push({
      shapeIdx: i,
      leftPct: (x / gw) * 100,
      topPct: (y / gh) * 100,
      wPct: (w / gw) * 100,
      hPct: (h / gh) * 100,
      text: text,
      // A human-readable anchor for the note: the shape's own text when it
      // has any, else its kind + ordinal ("1st arrow") so a text-less
      // decorative shape still reads clearly in the copied feedback and UI.
      label: text || (ordinal(kindCount[s.kind]) + ' ' + kindName(s)),
    });
  }
  return rects;
}

// Friendly name for a shape kind, shown when the shape has no text of its own.
var KIND_NAMES = {
  r: 'box', c: 'circle', e: 'ellipse', l: 'line', a: 'arrow', p: 'shape',
  chev: 'chevron', cyl: 'cylinder', bub: 'bubble', tab: 'tab', doc: 'document',
  cloud: 'cloud', icon: 'icon',
};
function kindName(s) {
  if (s && s.kind === 'icon' && s.attrs && s.attrs.name) return 'icon (' + s.attrs.name + ')';
  return (s && KIND_NAMES[s.kind]) || 'element';
}

// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11/12/13 -> "th", else "Nth".
function ordinal(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// The visible text of a shape, trimmed to a short hint. Shapes carry their
// markdown content in `s.content`; strip markdown noise to a plain phrase.
function shapeText(s) {
  var raw = (s && s.content) || '';
  if (!raw) return '';
  return raw
    .replace(/[#>*_`~|-]/g, ' ')   // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// Leading text of the whole slide: first non-empty shape text. Used as the
// slide_text hint on whole-slide notes so the footnote reads e.g. (slide 2
// "Q4 Review").
function slideLeadText(rects) {
  for (var i = 0; i < rects.length; i++) {
    if (rects[i].text) return rects[i].text.slice(0, 60);
  }
  return '';
}

// Everything below this point is browser-only. Bail cleanly in Node so the
// pure helpers above can still be required by tests.
if (typeof document === 'undefined') {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeHitRects: computeHitRects, shapeText: shapeText };
  }
  return;
}

function S() { return global.SDocs; }
var SDC = function () { return global.SDocComments; };

// ── Icons (mirror the comment-mode vocabulary) ───────────────────────────
var COMMENT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
var X_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
// Same copy glyph the heading / toolbar "with comments" buttons use.
var COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function prefs() {
  var ui = S() && S().commentsUi;
  if (ui && ui.readPrefs) return ui.readPrefs();
  return { author: 'user', color: '#ffbb00' };
}

function slideComments(slideIndex) {
  var sdc = SDC();
  if (!sdc) return [];
  return sdc.getComments((S() && S().currentMeta) || {})
    .map(sdc.normalizeComment)
    .filter(function (c) { return c && c.kind === 'slide' && c.slide === slideIndex; });
}

function iconBtn(svg, label, cls, onClick) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdoc-icon-btn ' + (cls || '');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = svg;
  b.addEventListener('click', onClick);
  return b;
}

// ── Composer + cards (reuse the .sdoc-card vocabulary) ────────────────────

// A view/edit card for an existing slide comment. `ordinal` is its 1-based
// position in the slide's comment list, shown as a leading chip so it lines
// up with the numbered dot on the element overlay.
function makeSlideCard(c, ordinal, ctx) {
  var card = document.createElement('div');
  card.className = 'sdoc-card sdoc-card-sidecar sdoc-slide-card';
  card.setAttribute('data-c', c.id);
  card.style.setProperty('--sdoc-card-color', c.color || prefs().color);

  var num = document.createElement('span');
  num.className = 'sdoc-slide-card-num';
  num.textContent = ordinal;
  card.appendChild(num);

  var who = document.createElement('span');
  who.className = 'sdoc-card-author';
  who.textContent = c.author || 'user';
  card.appendChild(who);

  var body = document.createElement('span');
  body.className = 'sdoc-card-body';
  body.textContent = c.text || '';
  card.appendChild(body);

  var target = document.createElement('span');
  target.className = 'sdoc-slide-card-target';
  if (shapesOf(c).length) {
    target.textContent = c.slide_text ? '“' + c.slide_text + '”' : 'element';
  } else {
    target.textContent = 'whole slide';
  }
  card.appendChild(target);

  var del = iconBtn(TRASH_SVG, 'Delete comment', 'sdoc-card-delete', function (e) {
    e.stopPropagation();
    var sdc = SDC();
    S().currentMeta = sdc.removeComment(S().currentMeta || {}, c.id);
    if (S().syncAll) S().syncAll('comment');
  });
  card.appendChild(del);

  card.addEventListener('click', function (e) {
    if (e.target.closest('.sdoc-icon-btn')) return;
    replaceWithEdit(card, c, ctx);
  });
  return card;
}

function replaceWithEdit(viewCard, c, ctx) {
  var edit = makeComposerCard({
    color: c.color,
    author: c.author,
    text: c.text,
    targetLabel: shapesOf(c).length ? (c.slide_text || 'element') : 'whole slide',
    onSave: function (text) {
      var sdc = SDC();
      if (text !== (c.text || '')) {
        S().currentMeta = sdc.updateComment(S().currentMeta || {}, c.id, { text: text });
      }
      if (S().syncAll) S().syncAll('comment');
    },
    onCancel: function () { if (S().syncAll) S().syncAll('comment'); },
  });
  if (viewCard.parentNode) viewCard.parentNode.replaceChild(edit, viewCard);
}

// Compose/edit card: a tinted sidecar with a target line, a textarea, and
// save/cancel. Mirrors the comment-mode composer so the styling reads as one
// system across text and slides.
function makeComposerCard(opts) {
  var card = document.createElement('div');
  card.className = 'sdoc-card sdoc-card-sidecar sdoc-card-edit sdoc-slide-card';
  card.style.setProperty('--sdoc-card-color', opts.color || prefs().color);

  var label = document.createElement('span');
  label.className = 'sdoc-slide-card-target sdoc-slide-card-target-compose';
  label.textContent = opts.targetLabel || 'whole slide';
  card.appendChild(label);

  var input = document.createElement('textarea');
  input.className = 'sdoc-card-input';
  input.rows = 1;
  input.placeholder = 'Feedback for the model…';
  if (opts.text) input.value = opts.text;
  input.addEventListener('click', function (e) { e.stopPropagation(); });

  var save = iconBtn(TICK_SVG, 'Save', 'sdoc-card-save', function (e) {
    e.stopPropagation();
    var t = input.value.trim();
    if (!t) { input.focus(); return; }
    opts.onSave(t);
  });
  var cancel = iconBtn(X_SVG, 'Cancel', 'sdoc-card-cancel', function (e) {
    e.stopPropagation();
    opts.onCancel();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); }
  });

  card.appendChild(input);
  card.appendChild(save);
  card.appendChild(cancel);
  setTimeout(function () { input.focus(); if (opts.text) input.select(); }, 0);
  return card;
}

// ── Layer building ────────────────────────────────────────────────────────
//
// A "context" packages where a slide is rendered. Inline and present share
// the same build path; only the host wrap and the card container differ.
//   wrap         - the .sd-slide-wrap (un-transformed, grid-aspect box)
//   slideIndex   - 0-based slide index
//   dsl          - the slide DSL
//   cardParent   - element the composer + card list are appended to
//   onChange     - re-render hook (so present can rebuild after a save)

function activeComposer() { return document.querySelector('.sdoc-slide-card.sdoc-card-edit'); }

// The element indices a slide comment covers (single, multi, or none).
function shapesOf(c) {
  if (Array.isArray(c.shapes)) return c.shapes;
  if (typeof c.shape === 'number') return [c.shape];
  return [];
}

// Pending multi-element selection while the user shift-clicks a group, before
// they save the single note that covers it. Only one is active at a time.
var pending = null;
function sameCtx(a, b) { return a && b && a.wrap === b.wrap && a.slideIndex === b.slideIndex; }
function clearPending() { pending = null; }

// shapeIdx -> label, for naming elements in the group composer / footnote.
function labelMap(dsl) {
  var m = {};
  computeHitRects(dsl).forEach(function (r) { m[r.shapeIdx] = r.label; });
  return m;
}

// A click on an element overlay. Shift extends/toggles a multi-element
// selection; a plain click is a single-element note (and clears any group).
function handleHitClick(ctx, rect, additive) {
  if (additive) {
    if (!pending || !sameCtx(pending.ctx, ctx)) pending = { ctx: ctx, idxs: [] };
    var at = pending.idxs.indexOf(rect.shapeIdx);
    if (at === -1) pending.idxs.push(rect.shapeIdx); else pending.idxs.splice(at, 1);
    if (!pending.idxs.length) {
      clearHighlights(ctx.wrap);
      var open0 = activeComposer();
      if (open0 && open0.parentNode) open0.parentNode.removeChild(open0);
      pending = null;
      return;
    }
    if (pending.idxs.length === 1) {
      // Dropped back to one element - reuse the single-element composer.
      var only = computeHitRects(ctx.dsl).filter(function (r) { return r.shapeIdx === pending.idxs[0]; })[0];
      openElementComposer(ctx, only || rect);
      return;
    }
    openGroupComposer(ctx, pending.idxs.slice());
    return;
  }
  pending = null;
  openElementComposer(ctx, rect);
}

function highlightShapes(wrap, idxs, color) {
  clearHighlights(wrap);
  if (!wrap) return;
  idxs.forEach(function (sh) {
    var hit = wrap.querySelector('.sdoc-slide-hit[data-shape-idx="' + sh + '"]');
    if (hit) {
      hit.classList.add('is-composing');
      if (color) hit.style.setProperty('--sdoc-anchor-color', color);
    }
  });
}

function openGroupComposer(ctx, idxs) {
  var existing = activeComposer();
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var p = prefs();
  highlightShapes(ctx.wrap, idxs, p.color);
  var lm = labelMap(ctx.dsl);
  var joined = idxs.map(function (i) { return lm[i] || ('element ' + i); }).join(' + ');
  var composer = makeComposerCard({
    color: p.color,
    author: p.author,
    targetLabel: idxs.length + ' elements · ' + joined,
    onSave: function (text) {
      var res = SDC().addSlideComment(S().currentMeta || {}, {
        slide: ctx.slideIndex, shapes: idxs, slide_text: joined,
      }, { author: p.author, color: p.color, at: new Date().toISOString(), text: text });
      S().currentMeta = res.meta;
      pending = null;
      afterChange(ctx);
    },
    onCancel: function () { clearHighlights(ctx.wrap); pending = null; afterChange(ctx); },
  });
  placeComposer(ctx, composer);
}

function buildLayer(ctx) {
  var wrap = ctx.wrap;
  if (!wrap) return;
  // Clear any prior layer / buttons on this wrap.
  var old = wrap.querySelector(':scope > .sdoc-slide-hit-layer');
  if (old) old.parentNode.removeChild(old);
  var oldBtn = wrap.querySelector(':scope > .sdoc-slide-comment-btn');
  if (oldBtn) oldBtn.parentNode.removeChild(oldBtn);

  var rects = computeHitRects(ctx.dsl);
  var comments = slideComments(ctx.slideIndex);
  // Map shape index -> { ordinal, color } among this slide's comments, for the
  // numbered dot. A multi-element note tags every shape it covers with the
  // same number.
  var ordinalOfShape = {}, colorOfShape = {};
  comments.forEach(function (c, i) {
    shapesOf(c).forEach(function (sh) {
      if (ordinalOfShape[sh] == null) {
        ordinalOfShape[sh] = i + 1;
        colorOfShape[sh] = c.color || prefs().color;
      }
    });
  });

  var layer = document.createElement('div');
  layer.className = 'sdoc-slide-hit-layer';
  layer.style.setProperty('--sdoc-anchor-color', prefs().color);

  rects.forEach(function (r) {
    var hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'sdoc-slide-hit';
    hit.setAttribute('data-shape-idx', String(r.shapeIdx));
    hit.style.left = r.leftPct + '%';
    hit.style.top = r.topPct + '%';
    hit.style.width = r.wPct + '%';
    hit.style.height = r.hPct + '%';
    hit.title = r.text ? 'Comment on “' + r.text + '”' : 'Comment on this element';
    if (ordinalOfShape[r.shapeIdx] != null) {
      hit.classList.add('is-commented');
      var dot = document.createElement('span');
      dot.className = 'sdoc-slide-hit-dot';
      dot.textContent = ordinalOfShape[r.shapeIdx];
      if (colorOfShape[r.shapeIdx]) dot.style.background = colorOfShape[r.shapeIdx];
      hit.appendChild(dot);
    }
    hit.addEventListener('click', function (e) {
      e.stopPropagation();
      // Shift-click gathers several elements into one note; plain click is a
      // single-element note.
      handleHitClick(ctx, r, e.shiftKey);
    });
    layer.appendChild(hit);
  });

  wrap.appendChild(layer);

  // Whole-slide comment button (top-left, away from the present button).
  var wsBtn = document.createElement('button');
  wsBtn.type = 'button';
  wsBtn.className = 'sdoc-slide-comment-btn';
  wsBtn.innerHTML = COMMENT_ICON;
  wsBtn.title = 'Comment on the whole slide';
  wsBtn.setAttribute('aria-label', 'Comment on the whole slide');
  if (comments.some(function (c) { return typeof c.shape !== 'number'; })) {
    wsBtn.classList.add('has-comment');
    var wholeOwner = comments.find(function (c) { return typeof c.shape !== 'number'; });
    if (wholeOwner) wsBtn.style.setProperty('--sdoc-anchor-color', wholeOwner.color || prefs().color);
  }
  wsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    openSlideComposer(ctx, rects);
  });
  wrap.appendChild(wsBtn);

  // Card list (existing comments) below the slide.
  renderCardList(ctx, comments);
}

function flashTick(btn) {
  var ui = S() && S().commentsUi;
  if (ui && ui.flashCopyTick) { ui.flashCopyTick(btn); return; }
}

// Copy just this slide: its source fenced block plus its own notes, formatted
// the same way as the doc-wide copy so it pastes into a model as focused
// feedback ("here is the slide and what to change about it").
function copySlideWithComments(ctx, btn) {
  var sdc = SDC();
  if (!sdc) return;
  var meta = (S() && S().currentMeta) || {};
  var comments = slideComments(ctx.slideIndex);
  var miniMeta = Object.assign({}, meta, { comments: comments });
  var body = '~~~slide\n' + (ctx.dsl || '').replace(/\s+$/, '') + '\n~~~\n';
  var file = meta && typeof meta.file === 'string' ? meta.file : '';
  var header = (file ? 'Feedback on ' + file + ' ' : 'Feedback on ') + 'slide ' + (ctx.slideIndex + 1) + ':';
  var payload = header + '\n\n' + sdc.serializeFootnotes(miniMeta, body);
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;
  navigator.clipboard.writeText(payload).then(function () {
    flashTick(btn);
    if (S().setStatus) S().setStatus('Copied slide (with comments)');
  }).catch(function () {});
}

function copyBtn(label, title, onClick) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdoc-copy-with-c sdoc-slide-copy-c';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = COPY_SVG + '<span class="sdoc-copy-with-c-label">' + label + '</span>';
  b.addEventListener('click', function (e) { e.stopPropagation(); onClick(b); });
  return b;
}

// "slide with comments" - copies just this slide's source + its notes.
// The doc-wide / per-section "with comments" copy is NOT duplicated here: a
// slide note now lights up the existing header companion button (see
// sectionContainsComment in sdocs-comments-ui.js), so that path is reached
// the same way text comments reach it - next to the heading above the slide.
function buildSlideActions(ctx) {
  var row = document.createElement('div');
  row.className = 'sdoc-slide-comment-actions';
  row.appendChild(copyBtn('slide with comments',
    'Copy this slide and its comments', function (btn) {
      copySlideWithComments(ctx, btn);
    }));
  return row;
}

function renderCardList(ctx, comments) {
  if (!ctx.cardParent) return;
  var existing = ctx.cardParent.querySelector(':scope > .sdoc-slide-comment-list[data-for="' + ctx.slideIndex + '"]');
  if (existing) existing.parentNode.removeChild(existing);
  if (!comments.length) return;
  var list = document.createElement('div');
  list.className = 'sdoc-slide-comment-list';
  list.setAttribute('data-for', String(ctx.slideIndex));
  // Copy actions sit above the cards.
  list.appendChild(buildSlideActions(ctx));
  comments.forEach(function (c, i) {
    list.appendChild(makeSlideCard(c, i + 1, ctx));
  });
  ctx.cardInsert ? ctx.cardInsert(list) : ctx.cardParent.appendChild(list);
}

function placeComposer(ctx, composer) {
  if (ctx.composerInsert) { ctx.composerInsert(composer); return; }
  (ctx.cardParent || document.body).appendChild(composer);
}

function openElementComposer(ctx, rect) {
  var existing = activeComposer();
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var p = prefs();
  highlightShape(ctx.wrap, rect.shapeIdx, p.color);
  var composer = makeComposerCard({
    color: p.color,
    author: p.author,
    targetLabel: '“' + (rect.label || ('element ' + rect.shapeIdx)) + '”',
    onSave: function (text) {
      var res = SDC().addSlideComment(S().currentMeta || {}, {
        slide: ctx.slideIndex, shape: rect.shapeIdx, slide_text: rect.label,
      }, { author: p.author, color: p.color, at: new Date().toISOString(), text: text });
      S().currentMeta = res.meta;
      afterChange(ctx);
    },
    onCancel: function () { clearHighlights(ctx.wrap); afterChange(ctx); },
  });
  placeComposer(ctx, composer);
}

function openSlideComposer(ctx, rects) {
  var existing = activeComposer();
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var p = prefs();
  if (ctx.wrap) ctx.wrap.classList.add('sdoc-slide-whole-hot');
  var composer = makeComposerCard({
    color: p.color,
    author: p.author,
    targetLabel: 'whole slide',
    onSave: function (text) {
      var res = SDC().addSlideComment(S().currentMeta || {}, {
        slide: ctx.slideIndex, slide_text: slideLeadText(rects || computeHitRects(ctx.dsl)),
      }, { author: p.author, color: p.color, at: new Date().toISOString(), text: text });
      S().currentMeta = res.meta;
      afterChange(ctx);
    },
    onCancel: function () { if (ctx.wrap) ctx.wrap.classList.remove('sdoc-slide-whole-hot'); afterChange(ctx); },
  });
  placeComposer(ctx, composer);
}

// A save/cancel/delete all funnel here. Inline relies on syncAll's full
// re-render (which re-runs render() and strips any open composer); present
// rebuilds its overlay in place, so the composer it portaled into the panel
// won't be torn down by a re-render - remove it explicitly first.
function afterChange(ctx) {
  var open = activeComposer();
  if (open && open.parentNode) open.parentNode.removeChild(open);
  // Inline gets a full re-render (fresh slide DOM), but the present stage
  // persists across slide re-renders, so clear any compose highlight here.
  clearHighlights(ctx.wrap);
  if (ctx.onChange) { ctx.onChange(); return; }
  if (S().syncAll) S().syncAll('comment');
}

function highlightShape(wrap, shapeIdx, color) {
  clearHighlights(wrap);
  if (!wrap) return;
  var hit = wrap.querySelector('.sdoc-slide-hit[data-shape-idx="' + shapeIdx + '"]');
  if (hit) {
    hit.classList.add('is-composing');
    if (color) hit.style.setProperty('--sdoc-anchor-color', color);
  }
}

function clearHighlights(wrap) {
  if (!wrap) return;
  wrap.querySelectorAll('.sdoc-slide-hit.is-composing').forEach(function (h) {
    h.classList.remove('is-composing');
  });
  wrap.classList.remove('sdoc-slide-whole-hot');
}

// ── Inline slides ─────────────────────────────────────────────────────────

function inlineCtxFor(slideEl) {
  var wrap = slideEl.querySelector('.sd-slide-wrap');
  if (!wrap) return null;
  var slideIndex = parseInt(slideEl.getAttribute('data-slide-index'), 10) || 0;
  var dsl = slideEl.getAttribute('data-dsl') || '';
  return {
    wrap: wrap,
    slideIndex: slideIndex,
    dsl: dsl,
    cardParent: slideEl.parentNode,
    // Cards + composer go right after the slide element so they read as
    // attached to it, like a sidecar under a block.
    cardInsert: function (node) { slideEl.parentNode.insertBefore(node, slideEl.nextSibling); },
    composerInsert: function (node) { slideEl.parentNode.insertBefore(node, slideEl.nextSibling); },
  };
}

function renderInline() {
  if (!S() || !S().renderedEl) return;
  stripInline();
  if (!document.body.classList.contains('comment-mode')) return;
  var slides = S().renderedEl.querySelectorAll('.sdoc-slide[data-dsl]');
  slides.forEach(function (slideEl) {
    var ctx = inlineCtxFor(slideEl);
    if (ctx) buildLayer(ctx);
  });
}

function stripInline() {
  if (!S() || !S().renderedEl) return;
  var root = S().renderedEl;
  root.querySelectorAll('.sdoc-slide-hit-layer, .sdoc-slide-comment-btn, .sdoc-slide-comment-list').forEach(function (n) {
    if (n.parentNode) n.parentNode.removeChild(n);
  });
  // Any open composer that lives between slides.
  root.querySelectorAll('.sdoc-slide-card.sdoc-card-edit').forEach(function (n) {
    if (n.parentNode) n.parentNode.removeChild(n);
  });
}

function enter() { renderInline(); }
function exit() { pending = null; stripInline(); presentTeardown(); }
function render() { renderInline(); }

// ── Present mode ────────────────────────────────────────────────────────────
//
// Present mode owns a "Comment" toggle in its topbar. While it's on, the
// active stage gets the same hit layer + whole-slide button, and the current
// slide's cards render in a panel docked to the right of the stage. State
// lives here; present.js just calls the hooks below.

var presentState = { commenting: false, modal: null, btn: null, panel: null };

function presentCtx() {
  var st = presentState;
  if (!st.modal) return null;
  var stageWrap = st.modal.querySelector('.sdoc-present-stage');
  if (!stageWrap) return null;
  // The present stage IS the slide wrap (renderShapes adds .sd-slide-wrap).
  var wrap = stageWrap.classList.contains('sd-slide-wrap')
    ? stageWrap : stageWrap.querySelector('.sd-slide-wrap');
  var idx = st.slideIndex != null ? st.slideIndex : 0;
  var dsl = st.dsl || '';
  return {
    wrap: wrap,
    slideIndex: idx,
    dsl: dsl,
    cardParent: st.panel,
    onChange: function () {
      // Persist to the doc, then rebuild present overlay from fresh meta.
      if (S().syncAll) S().syncAll('comment');
      // syncAll re-renders the inline doc + present.refresh(); rebuild our
      // overlay against the (possibly re-rendered) present stage next tick.
      setTimeout(function () { presentRender(); }, 0);
    },
    composerInsert: function (node) { if (st.panel) st.panel.insertBefore(node, st.panel.firstChild); },
    cardInsert: function (node) { if (st.panel) st.panel.appendChild(node); },
  };
}

// Called by present.js after each renderActive (slide change / open).
function onPresentRender(modal, slideIndex, dsl) {
  presentState.modal = modal;
  presentState.slideIndex = slideIndex;
  presentState.dsl = dsl;
  if (presentState.commenting) presentRender();
}

function presentRender() {
  ensurePresentPanel();
  var ctx = presentCtx();
  if (!ctx || !ctx.wrap) return;
  buildLayer(ctx);
}

function ensurePresentPanel() {
  var st = presentState;
  if (!st.modal) return;
  if (st.commenting) {
    st.modal.classList.add('sdoc-present-commenting');
    if (!st.panel || !st.panel.parentNode) {
      var panel = document.createElement('aside');
      panel.className = 'sdoc-present-comment-panel';
      var h = document.createElement('div');
      h.className = 'sdoc-present-comment-panel-head';
      h.textContent = 'Slide comments';
      panel.appendChild(h);
      st.modal.appendChild(panel);
      st.panel = panel;
    }
  } else {
    st.modal.classList.remove('sdoc-present-commenting');
    if (st.panel && st.panel.parentNode) st.panel.parentNode.removeChild(st.panel);
    st.panel = null;
  }
}

// present.js gives us its toggle button so we can reflect active state on it.
function presentToggle(btn) {
  presentState.btn = btn || presentState.btn;
  presentState.commenting = !presentState.commenting;
  if (presentState.btn) presentState.btn.classList.toggle('active', presentState.commenting);
  // Add/remove the panel first - that changes the stage area. Then, on the
  // next frame (so the new width has laid out), re-fit the stage and draw
  // overlays. Skipping the refit leaves the hit-layer sized to the stale
  // pre-panel height (the overlays sit too low / too tall until a slide flip).
  ensurePresentPanel();
  var raf = (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : function (f) { setTimeout(f, 16); };
  raf(function () {
    if (window.SDocPresent && window.SDocPresent.refit) window.SDocPresent.refit();
    if (presentState.commenting) presentRender();
    else clearPresentOverlay();
  });
}

function clearPresentOverlay() {
  ensurePresentPanel(); // removes panel when off
  var st = presentState;
  if (!st.modal) return;
  st.modal.querySelectorAll('.sdoc-slide-hit-layer, .sdoc-slide-comment-btn').forEach(function (n) {
    if (n.parentNode) n.parentNode.removeChild(n);
  });
}

function presentTeardown() {
  presentState.commenting = false;
  if (presentState.panel && presentState.panel.parentNode) {
    presentState.panel.parentNode.removeChild(presentState.panel);
  }
  presentState.panel = null;
  presentState.modal = null;
  presentState.btn = null;
}

// ── Public API ─────────────────────────────────────────────────────────────

var api = {
  computeHitRects: computeHitRects,
  shapeText: shapeText,
  enter: enter,
  exit: exit,
  render: render,
  // present hooks
  onPresentRender: onPresentRender,
  presentToggle: presentToggle,
  presentTeardown: presentTeardown,
  isPresentCommenting: function () { return presentState.commenting; },
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.SDocSlideComments = api;
if (global.SDocs) global.SDocs.slideComments = api;

})(typeof window !== 'undefined' ? window : this);
