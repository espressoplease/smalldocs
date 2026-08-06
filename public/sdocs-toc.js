// Contents (TOC) panel: a toggleable overlay at the left edge of the reading
// area, built from the rendered document's h1-h4 headings (which already carry
// slug ids). Fold state is mirrored two-way with the document's collapsible
// sections: a panel chevron clicks the real section heading, and a
// MutationObserver on the rendered container reflects any section toggle
// (chevron, Expand all, sec= deep link) back into the panel.
(function () {
  var S = window.SDocs;
  var panel = document.getElementById('_sd_toc');
  var list = document.getElementById('_sd_toc-list');
  var btn = document.getElementById('_sd_btn-toc');
  if (!S || !panel || !list || !btn) return;

  var contentArea = document.getElementById('_sd_content-area');
  var STORAGE_KEY = 'sdocs-toc-open';
  var MIN_HEADINGS = 3;
  var CHEVRON = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function stored() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  }
  function store(open) {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (_) {}
  }

  function headings() {
    if (!S.renderedEl) return [];
    return [].slice.call(S.renderedEl.querySelectorAll('h1[id], h2[id], h3[id], h4[id]'));
  }

  // Heading text minus the widgets attachHeadingAnchors injected into it.
  function headingText(h) {
    var clone = h.cloneNode(true);
    clone.querySelectorAll('.section-toggle, .header-anchor, .header-copy-btn').forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }

  function rebuild() {
    var hs = headings();
    var enabled = hs.length >= MIN_HEADINGS;
    var open = enabled && stored();
    btn.style.display = enabled ? '' : 'none';
    panel.classList.toggle('open', open);
    btn.classList.toggle('active', open);
    list.innerHTML = '';
    if (!enabled) return;

    // Nest by heading level, same stack walk as buildCollapsibleSections.
    var stack = [{ ul: list, level: 0 }];
    hs.forEach(function (h) {
      var level = parseInt(h.tagName.charAt(1), 10);
      if (level === 1) stack = [{ ul: list, level: 0 }];
      else while (stack[stack.length - 1].level >= level) stack.pop();

      var li = document.createElement('li');
      li.className = 'toc-item toc-l' + level;
      li.dataset.slug = h.id;
      var row = document.createElement('div');
      row.className = 'toc-row';
      var link = document.createElement('button');
      link.type = 'button';
      link.className = 'toc-link';
      link.textContent = headingText(h);
      link.addEventListener('click', function () {
        if (S.revealSection) S.revealSection(li.dataset.slug);
      });
      row.appendChild(link);
      li.appendChild(row);
      var sub = document.createElement('ul');
      sub.className = 'toc-sub';
      li.appendChild(sub);
      stack[stack.length - 1].ul.appendChild(li);
      stack.push({ ul: sub, level: level });
    });

    // Chevrons: only h2-h4 entries with child entries fold (h1 has no
    // .md-section of its own, so its children are always listed).
    list.querySelectorAll('.toc-item').forEach(function (li) {
      var sub = li.querySelector(':scope > .toc-sub');
      if (!sub.children.length) { sub.remove(); return; }
      li.classList.add('has-children');
      if (li.classList.contains('toc-l1')) return;
      var chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'toc-chevron';
      chev.setAttribute('aria-label', 'Toggle section');
      chev.innerHTML = CHEVRON;
      chev.addEventListener('click', function (e) {
        e.stopPropagation();
        // Reuse the document's own section toggle handler so behavior
        // (descendant toggling, scroll compensation, fold button sync)
        // stays identical to clicking the heading in the document.
        var h = document.getElementById(li.dataset.slug);
        if (h) h.click();
      });
      var row = li.querySelector(':scope > .toc-row');
      row.insertBefore(chev, row.firstChild);
    });

    syncFolds();
    activeSlug = null;
    onScroll();
  }
  S.rebuildToc = rebuild;

  // Panel fold state is a pure reflection of the document's .open classes.
  function syncFolds() {
    list.querySelectorAll('.toc-item.has-children:not(.toc-l1)').forEach(function (li) {
      var h = document.getElementById(li.dataset.slug);
      var section = h && h.closest('.md-section');
      var body = section && section.querySelector(':scope > .md-section-body');
      li.classList.toggle('toc-collapsed', !(body && body.classList.contains('open')));
    });
  }

  var syncQueued = false;
  new MutationObserver(function () {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(function () {
      syncQueued = false;
      syncFolds();
      onScroll();
    });
  }).observe(S.renderedEl, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // ── Scrollspy ──────────────────────────────────────────────

  var activeSlug = null;

  function keepVisible(el) {
    var pr = panel.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    if (er.top < pr.top) panel.scrollTop += er.top - pr.top - 8;
    else if (er.bottom > pr.bottom) panel.scrollTop += er.bottom - pr.bottom + 8;
  }

  function setActive(slug) {
    if (slug === activeSlug) return;
    activeSlug = slug;
    var prev = list.querySelector('.toc-link.active');
    if (prev) prev.classList.remove('active');
    if (!slug) return;
    var li = list.querySelector('.toc-item[data-slug="' + CSS.escape(slug) + '"]');
    var link = li && li.querySelector(':scope > .toc-row > .toc-link');
    if (!link || !link.offsetParent) return;
    link.classList.add('active');
    keepVisible(link);
  }

  function onScroll() {
    if (!panel.classList.contains('open')) return;
    var hs = headings();
    if (!hs.length) return;
    var threshold = contentArea.getBoundingClientRect().top + 90;
    // Last visible heading above the threshold; falls back to the first
    // visible one when the scroll position is above every heading.
    var current = null;
    hs.forEach(function (h) {
      if (!h.offsetParent) return; // hidden (display:none in a collapsed body)
      if (current === null) current = h;
      if (h.getBoundingClientRect().top <= threshold) current = h;
    });
    setActive(current ? current.id : null);
  }

  var scrollQueued = false;
  contentArea.addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      onScroll();
    });
  });

  // ── Toggle button ──────────────────────────────────────────

  btn.addEventListener('click', function () {
    var open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    btn.classList.toggle('active', open);
    store(open);
    if (open) onScroll();
  });

  rebuild();
})();
