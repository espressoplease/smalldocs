// sdocs-highlight.js - syntax highlighting for fenced code blocks.
//
// marked turns ```ruby into <pre><code class="language-ruby">. This module
// runs LAST in the render orchestration (after charts/mermaid/cells/forms have
// already replaced their own blocks), finds the code blocks that are left,
// and colours them with highlight.js.
//
// Mirrors the mermaid module's shape:
//   - highlight.js is lazy-loaded from a CDN on first use (never on load).
//   - language packs not in the core "common" build are lazy-loaded per language.
//   - the produced HTML is post-sanitised before it touches the DOM, even
//     though highlight.js only emits <span class>. A renderer's own output is
//     never trusted directly (see CLAUDE.md "Adding a new markdown feature").
//   - hard DoS limits: per-block size cap and per-document block cap.
//
// Theme/colour lives in css/rendered.css (the .hljs-* token rules). This file
// only produces the spans.

(function () {
  var S = window.SDocs;
  if (!S) return;

  // Loaded from jsDelivr to match the site CSP (script-src allows jsdelivr, as
  // the mermaid/charts modules already rely on). The @highlightjs/cdn-assets
  // package mirrors the cdnjs layout: /highlight.min.js + /languages/<lang>.min.js.
  var HLJS_VERSION = '11.11.1';
  var CDN_BASE = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@' + HLJS_VERSION;
  var CORE_JS = CDN_BASE + '/highlight.min.js';

  // Blocks owned by other processors. Those modules replace the <pre> with a
  // widget, so by the time we run they should already be gone - but a slow CDN
  // (mermaid/charts load async) can leave them in the DOM momentarily. Skipping
  // by language name means we never fight another processor for a block.
  var RESERVED = {
    chart: 1, mermaid: 1, cells: 1, form: 1, math: 1, slide: 1, slides: 1
  };

  var SOURCE_MAX_CHARS = 200 * 1024;  // per-block: don't tokenise giant pastes
  var DOC_BLOCK_CAP    = 120;          // per-document: cap total work

  var coreReady = null;       // shared promise -> hljs
  var langPromises = {};      // name -> promise (dedupe concurrent pack loads)

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadCore() {
    if (coreReady) return coreReady;
    coreReady = loadScript(CORE_JS).then(function () {
      var hljs = window.hljs;
      if (!hljs) throw new Error('hljs global missing');
      // We never want auto-detected language tags written onto our elements,
      // and we handle our own DOM, so keep config minimal.
      hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });
      return hljs;
    });
    return coreReady;
  }

  // The core "common" bundle ships ~40 languages and registers each one's
  // aliases (so getLanguage('js') already resolves to javascript). Anything
  // not in the bundle is fetched once by name; highlight.js resolves aliases
  // itself, so we don't keep a second alias table here.
  function ensureLanguage(hljs, lang) {
    if (hljs.getLanguage(lang)) return Promise.resolve(true);
    if (langPromises[lang]) return langPromises[lang];
    var url = CDN_BASE + '/languages/' + encodeURIComponent(lang) + '.min.js';
    langPromises[lang] = loadScript(url)
      .then(function () { return !!hljs.getLanguage(lang); })
      .catch(function () { return false; });
    return langPromises[lang];
  }

  // Pull the language token off the <code class="language-xxx"> element.
  function langOf(codeEl) {
    var m = (codeEl.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function sanitizeTokens(html) {
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['span'],
        ALLOWED_ATTR: ['class']
      });
    }
    return html;
  }

  function highlightOne(hljs, codeEl) {
    if (!codeEl || codeEl.dataset.hlDone) return Promise.resolve();
    var lang = langOf(codeEl);
    if (!lang || RESERVED[lang]) return Promise.resolve();

    var src = codeEl.textContent || '';
    if (src.length > SOURCE_MAX_CHARS) { codeEl.dataset.hlDone = '1'; return Promise.resolve(); }

    return ensureLanguage(hljs, lang).then(function (ok) {
      if (codeEl.dataset.hlDone) return;       // a concurrent render won the race
      if (!ok || !hljs.getLanguage(lang)) { codeEl.dataset.hlDone = '1'; return; }
      var out;
      try {
        out = hljs.highlight(src, { language: lang, ignoreIllegals: true });
      } catch (e) { codeEl.dataset.hlDone = '1'; return; }
      codeEl.innerHTML = sanitizeTokens(out.value);
      codeEl.classList.add('hljs');            // convention; lets theme CSS hook
      codeEl.dataset.hlDone = '1';
    }).catch(function () { /* CDN failure: leave the block as plain text */ });
  }

  function processHighlight(container) {
    if (!container) return Promise.resolve();
    var nodes = container.querySelectorAll('pre code[class*="language-"]');
    if (!nodes.length) return Promise.resolve();

    // Filter to blocks we'll actually touch before paying the CDN cost, so a
    // doc full of mermaid/chart blocks never loads highlight.js.
    var todo = [];
    for (var i = 0; i < nodes.length && todo.length < DOC_BLOCK_CAP; i++) {
      var el = nodes[i];
      if (el.dataset.hlDone) continue;
      var lang = langOf(el);
      if (!lang || RESERVED[lang]) continue;
      todo.push(el);
    }
    if (!todo.length) return Promise.resolve();

    return loadCore().then(function (hljs) {
      return Promise.all(todo.map(function (el) { return highlightOne(hljs, el); }));
    }).catch(function () { /* core CDN failure: plain text, no throw into render */ });
  }

  S.processHighlight = processHighlight;
})();
