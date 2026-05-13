// sdocs-mermaid.js - Mermaid diagram rendering for ```mermaid fenced blocks.
//
// Pipeline:
//   1. marked turns a ```mermaid fence into <pre><code class="language-mermaid">.
//      Same shape as ```chart - we don't add a marked extension.
//   2. DOMPurify keeps the <pre><code> structure (default allowlist).
//   3. processMermaid(container), called after sanitize, walks every
//      code.language-mermaid, runs Mermaid, replaces the <pre> with a
//      <div class="sdoc-mermaid"> wrapping the rendered SVG.
//   4. Mermaid itself is loaded lazily from jsDelivr on first use.
//
// Security:
//   - mermaid.initialize: securityLevel: 'strict', htmlLabels: false on
//     flowchart and sequence (so labels don't emit <foreignObject>).
//   - %%{init: ...}%% directives are stripped from source before render -
//     they can otherwise flip securityLevel back to 'loose' at parse time.
//   - Per-diagram source-size cap (64 KB) and per-document block cap (50).
//   - Per-render timeout (5s); Mermaid's layout can hang on adversarial input.
//   - Mermaid's SVG output is inserted via innerHTML, which routes around
//     the main DOMPurify pass. We run a tight SVG-profile sanitize on the
//     SVG string before insertion. Forbids foreignObject / script / use /
//     iframe / set / animate. Mirrors the KaTeX render-after-sanitize order
//     in sdocs-math.js but with explicit post-sanitize because Mermaid SVG
//     has a wider attack surface than KaTeX's MathML/HTML.
(function () {
  'use strict';
  var S = window.SDocs;

  var MERMAID_VERSION = '10.9.1';
  var MERMAID_JS = 'https://cdn.jsdelivr.net/npm/mermaid@' + MERMAID_VERSION + '/dist/mermaid.min.js';

  var SOURCE_BYTE_CAP = 64 * 1024;
  var DOC_BLOCK_CAP   = 50;
  var RENDER_TIMEOUT_MS = 5000;

  // %%{init: ...}%% directives can override securityLevel/htmlLabels at
  // parse time. Strip them all - we re-initialise on every processMermaid call.
  var INIT_DIRECTIVE_RE = /%%\s*\{\s*init\s*:[\s\S]*?\}\s*%%/g;

  var mermaidReady = null;
  var diagramCounter = 0;

  function cssVar(name) {
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return '';
    return getComputedStyle(rendered).getPropertyValue(name).trim();
  }

  // Linear blend of two #RRGGBB hex strings. ratio=0 → a, ratio=1 → b.
  // themeVariables only accepts colour strings, so colour-mix has to happen
  // here in JS rather than via CSS color-mix(). Falls through (returns a)
  // for non-hex inputs - rgb()/hsl() values from getPropertyValue would
  // need a heavier parser and tokens.css uses hex throughout.
  function mixHex(a, b, ratio) {
    var ah = String(a || ''), bh = String(b || '');
    if (!/^#[0-9a-f]{6}$/i.test(ah) || !/^#[0-9a-f]{6}$/i.test(bh)) return ah;
    var ar = parseInt(ah.slice(1,3),16), ag = parseInt(ah.slice(3,5),16), ab = parseInt(ah.slice(5,7),16);
    var br = parseInt(bh.slice(1,3),16), bg = parseInt(bh.slice(3,5),16), bb = parseInt(bh.slice(5,7),16);
    var t = Math.max(0, Math.min(1, ratio));
    var r = Math.round(ar * (1 - t) + br * t);
    var g = Math.round(ag * (1 - t) + bg * t);
    var c = Math.round(ab * (1 - t) + bb * t);
    return '#' + [r, g, c].map(function (n) {
      return n.toString(16).padStart(2, '0');
    }).join('');
  }

  // Map SDocs CSS variables to Mermaid themeVariables. Mermaid + theme:'base'
  // derives most of its colour palette from a handful of knobs; we feed the
  // SDocs blocks/text/bg cascade into them. Re-read on every render so theme
  // toggles are picked up.
  function isDark() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function readThemeVars() {
    // tokens.css overrides --md-bg / --md-color in dark mode but does not
    // touch --md-block-bg / --md-block-text - readers using default styles
    // would otherwise get a light cream Mermaid wrapper on a dark page.
    // Provide a dark-aware fallback here.
    var dark = isDark();
    var bg      = cssVar('--md-bg')         || (dark ? '#2c2a26' : '#ffffff');
    var color   = cssVar('--md-color')      || (dark ? '#e7e5e2' : '#1c1917');
    var blockBg = cssVar('--md-block-bg')   || (dark ? '#1f1d1a' : '#f4f1ed');
    var blockTx = cssVar('--md-block-text') || (dark ? '#a8a29e' : '#6b6560');
    var font    = cssVar('--md-font-family') || '';
    // Node fill uses page bg (whiter / darker) rather than block bg, so nodes
    // stand out against the block-coloured wrapper. Border is the muted
    // block-text colour, blended 55% toward the node fill so it sits visually
    // behind the dark label text instead of competing with it. Edges
    // (lineColor) are blended less - they need to read as connections, not
    // structure. Both blend ratios are eyeballed against the default theme;
    // a heavier blend washes the border out, lighter brings the clash back.
    var line      = mixHex(blockTx, bg, 0.40);
    var accent    = cssVar('--md-link-color') || (dark ? '#60a5fa' : '#2563eb');
    // Bold-by-default hierarchy. Modeled on the classic "tinted card with
    // saturated stroke" aesthetic (cf. tailwind's bg-blue-50 / border-blue-600
    // pattern, or the classDef ok/warn/danger example in the stress doc).
    // Each layer reads at a glance:
    //   - Wrapper: cream (--md-block-bg) - the document's block surface
    //   - Subgraph: distinctly darker cream + saturated accent border
    //   - Node:     pale-accent fill + saturated accent border + dark text
    // The accent picks up the document's --md-link-color, so themed docs
    // theme their diagrams automatically. Subgraph fill stays lightness-
    // only (no accent in the fill itself) so multiple subgraphs in one
    // diagram don't compete with nodes for visual attention.
    var nodeFill      = mixHex(bg, accent, 0.07);
    var nodeBorder    = accent;                            // saturated, not blended
    var clusterBg     = mixHex(blockBg, blockTx, 0.13);    // distinctly darker
    var clusterBorder = mixHex(blockTx, accent, 0.55);     // accent-tinted, but muted vs nodes
    return {
      background:         blockBg,
      primaryColor:       nodeFill,
      primaryTextColor:   color,
      primaryBorderColor: nodeBorder,
      lineColor:          line,
      secondaryColor:     nodeFill,
      tertiaryColor:      nodeFill,
      mainBkg:            nodeFill,
      textColor:          color,
      fontFamily:         font || 'inherit',
      clusterBkg:         clusterBg,
      clusterBorder:      clusterBorder,
      titleColor:         color,
      edgeLabelBackground: blockBg,
      // Quadrant chart specifics. Mermaid's quadrant chart layout is fragile;
      // these vars give it enough colour hierarchy that the title, axis,
      // quadrant labels, point labels and dots are visually distinguishable
      // instead of all rendering as the same near-black weight.
      quadrant1Fill:                       bg,
      quadrant2Fill:                       bg,
      quadrant3Fill:                       bg,
      quadrant4Fill:                       bg,
      quadrant1TextFill:                   blockTx,
      quadrant2TextFill:                   blockTx,
      quadrant3TextFill:                   blockTx,
      quadrant4TextFill:                   blockTx,
      quadrantPointFill:                   accent,
      quadrantPointTextFill:               color,
      quadrantTitleFill:                   color,
      quadrantXAxisTextFill:               blockTx,
      quadrantYAxisTextFill:               blockTx,
      quadrantInternalBorderStrokeFill:    clusterBorder,
      quadrantExternalBorderStrokeFill:    clusterBorder
    };
  }

  function initMermaid(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      flowchart: {
        // htmlLabels: true gives auto-wrap on long labels, which is the
        // single biggest readability win for unstyled diagrams. Mermaid
        // emits <foreignObject> elements containing HTML; the post-sanitize
        // (sanitizeSvg) allows the foreignObject element but strips dangerous
        // children (script/iframe/style/form/object/embed) and dangerous
        // attributes (on*/srcdoc/formaction/javascript:). Combined with
        // securityLevel:'strict' and the %%{init}%% directive strip, the
        // bounded XSS surface inside SDocs (no cookies / sessions / accounts)
        // makes this an acceptable trade for the agent-default ergonomics.
        htmlLabels: true,
        nodeSpacing: 60,
        rankSpacing: 70,
        padding: 16
      },
      sequence:  { htmlLabels: true },
      // Quadrant chart layout knobs - Mermaid's defaults pack labels into
      // the dots and on top of the axis lines. Bump padding throughout and
      // shrink the point markers so the chart reads.
      quadrantChart: {
        pointRadius:        4,
        pointTextPadding:   14,
        pointLabelFontSize: 13,
        quadrantPadding:    12,
        xAxisLabelPadding:  12,
        yAxisLabelPadding:  12,
        titlePadding:       14,
        quadrantTextTopPadding: 12,
        titleFontSize:      18,
        quadrantLabelFontSize: 14
      },
      themeVariables: readThemeVars()
    });
  }

  // Lazy-load Mermaid from CDN. Mirrors the KaTeX loader in sdocs-math.js,
  // including the window.exports / window.module shadow so the UMD wrapper
  // doesn't bind to a DOM element with id="exports" (HTML named-access).
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise(function (resolve, reject) {
      var prevExports = window.exports;
      var prevModule  = window.module;
      window.exports = undefined;
      window.module  = undefined;
      function restore() {
        if (prevExports === undefined) delete window.exports; else window.exports = prevExports;
        if (prevModule  === undefined) delete window.module;  else window.module  = prevModule;
      }
      var s = document.createElement('script');
      s.src = MERMAID_JS;
      s.async = true;
      s.onload = function () {
        restore();
        var m = window.mermaid;
        if (!m) { reject(new Error('mermaid global missing')); return; }
        try { initMermaid(m); } catch (e) { reject(e); return; }
        resolve(m);
      };
      s.onerror = function () { restore(); reject(new Error('mermaid load failed')); };
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  function stripDirectives(src) {
    return String(src || '').replace(INIT_DIRECTIVE_RE, '');
  }

  // Post-render sanitize on the SVG string.
  //
  // DOMPurify can't cleanly handle SVG with HTML inside <foreignObject> -
  // its parser flattens namespaces and strips the inner XHTML content
  // even with PARSER_MEDIA_TYPE tweaks. So we hand-roll a tree walk
  // using DOMParser (which preserves namespaces) and explicit
  // element/attribute checks. This is a few dozen lines but the rules
  // are right there in source for any reviewer.
  //
  // Defense layers (working with strict-mode + %%{init}%% strip):
  //   1. Forbidden elements removed wherever they appear: script, iframe,
  //      object, embed, form/input/textarea/button (phishing UI), use/
  //      set/animate (SVG-side attacks), video/audio/source/track,
  //      meta/link/base.
  //   2. <style> allowed only as a direct SVG child (Mermaid needs it
  //      for node fill/stroke/font) - banned anywhere inside a
  //      <foreignObject> where CSS @import is a network exfil vector.
  //   3. Dangerous attributes stripped from every element: on* event
  //      handlers, srcdoc, formaction, action, ping, background.
  //   4. URL-bearing attributes (href, xlink:href, src) reject the
  //      javascript: scheme.

  var FORBIDDEN_TAGS = {
    script:1, iframe:1, object:1, embed:1,
    form:1, input:1, textarea:1, button:1, select:1, option:1,
    use:1, set:1, animate:1, animatemotion:1, animatetransform:1,
    video:1, audio:1, source:1, track:1,
    meta:1, link:1, base:1
  };
  var FORBIDDEN_ATTRS = {
    srcdoc:1, formaction:1, action:1, ping:1, background:1
  };
  var URL_ATTRS = { href:1, src:1, 'xlink:href':1 };
  var JS_URL_RE = /^\s*javascript:/i;

  function isInsideForeignObject(node) {
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      if ((p.tagName || '').toLowerCase() === 'foreignobject') return true;
      p = p.parentNode;
    }
    return false;
  }

  // Mermaid emits HTML-style void tags (`<br>`) inside foreignObject
  // labels, which an XML parser rejects. Self-close them before parse so
  // the SVG round-trips through DOMParser cleanly.
  function fixVoidTags(s) {
    return String(s).replace(/<(br|hr|img|wbr)\s*>/gi, '<$1/>');
  }

  function sanitizeSvg(svgStr) {
    var fixed = fixVoidTags(svgStr);
    var doc;
    try {
      doc = new DOMParser().parseFromString(fixed, 'image/svg+xml');
    } catch (e) { return ''; }
    if (!doc || doc.querySelector('parsererror')) return '';
    var root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') return '';

    // Walk every descendant. Iterate in reverse so removals don't shift
    // unvisited indices.
    var all = Array.prototype.slice.call(root.querySelectorAll('*'));
    for (var i = all.length - 1; i >= 0; i--) {
      var el = all[i];
      var tag = (el.tagName || '').toLowerCase();

      if (FORBIDDEN_TAGS[tag]) {
        if (el.parentNode) el.parentNode.removeChild(el);
        continue;
      }
      // <style> is OK at SVG level (Mermaid needs it). Strip it inside
      // foreignObject where CSS @import becomes a problem.
      if (tag === 'style' && isInsideForeignObject(el)) {
        if (el.parentNode) el.parentNode.removeChild(el);
        continue;
      }

      // Attribute pass.
      var attrs = Array.prototype.slice.call(el.attributes || []);
      for (var j = 0; j < attrs.length; j++) {
        var a = attrs[j];
        var name = a.name.toLowerCase();
        if (name.indexOf('on') === 0)            { el.removeAttribute(a.name); continue; }
        if (FORBIDDEN_ATTRS[name])               { el.removeAttribute(a.name); continue; }
        if (URL_ATTRS[name] && JS_URL_RE.test(a.value)) {
          el.removeAttribute(a.name);
        }
      }
    }

    return new XMLSerializer().serializeToString(root);
  }

  // Auto-tint nodes by their containing subgraph cluster. Subgraphs naturally
  // express "things that belong together"; giving each cluster's nodes a
  // distinct hue derived from the page palette makes structure read at a
  // glance (vs. the default where every node looks identical regardless of
  // which cluster it lives in). Only kicks in for diagrams with 2+ clusters.
  // Floating nodes (those declared outside any subgraph) keep the default
  // accent fill so they read as "outside the system."
  //
  // Mermaid emits nodes and clusters as siblings under separate <g> groups,
  // so cluster membership has to be recovered from geometry: we measure each
  // cluster's bounding rect, sort smallest-first (so nested subgraphs claim
  // their nodes before their parent), and assign each node to the smallest
  // cluster whose rect contains the node's centre.
  //
  // getBoundingClientRect is the right tool here because mermaid lays nodes
  // out with subtle padding that getBBox + a CTM walk struggles with - some
  // nodes end up just outside their containing cluster in SVG user space.
  // BCR uses post-layout viewport pixels and gets this right.
  //
  // BCR returns 0x0 when the SVG sits inside a display:none ancestor (e.g.
  // a slide rendered into a collapsed section at initial page render). To
  // handle that case, doApplyClusterTints below probes BCR once; if any
  // cluster measures zero, we register an IntersectionObserver and re-run
  // when the SVG actually becomes visible. Idempotent: nodes that already
  // got a tint keep it.
  var TINT_HUES = ['#3b82f6', '#16a34a', '#d97706', '#9333ea', '#ec4899', '#0d9488'];
  function applyClusterTints(svgEl, blockBg) {
    var clusters = svgEl.querySelectorAll('g.cluster');
    if (clusters.length < 2) return;
    var nodes = svgEl.querySelectorAll('g.node');
    if (!nodes.length) return;

    function doPass() {
      var clusterInfo = [];
      var anyZero = false;
      for (var i = 0; i < clusters.length; i++) {
        var bb = clusters[i].getBoundingClientRect();
        if (!bb.width || !bb.height) { anyZero = true; continue; }
        clusterInfo.push({ rect: bb, idx: i });
      }
      if (clusterInfo.length < 2) return false; // can't tint without comparators
      clusterInfo.sort(function (a, b) {
        return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
      });

      nodes.forEach(function (node) {
        var nb = node.getBoundingClientRect();
        var ncx = (nb.left + nb.right) / 2;
        var ncy = (nb.top + nb.bottom) / 2;
        for (var k = 0; k < clusterInfo.length; k++) {
          var cr = clusterInfo[k].rect;
          if (ncx >= cr.left && ncx <= cr.right && ncy >= cr.top && ncy <= cr.bottom) {
            var hue = TINT_HUES[clusterInfo[k].idx % TINT_HUES.length];
            var fillCol = mixHex(blockBg, hue, 0.10);
            var strokeCol = mixHex(blockBg, hue, 0.65);
            for (var c = 0; c < node.children.length; c++) {
              var child = node.children[c];
              var tn = child.tagName.toLowerCase();
              if (tn === 'rect' || tn === 'polygon' || tn === 'circle' ||
                  tn === 'ellipse' || tn === 'path') {
                child.style.fill = fillCol;
                child.style.stroke = strokeCol;
              }
            }
            break;
          }
        }
      });
      return !anyZero;
    }

    // First pass: if the SVG is already laid out (e.g. it's the main present
    // stage or an open section), tinting completes here and we're done.
    if (doPass()) return;

    // Otherwise the SVG was rendered into a collapsed / off-screen context.
    // Defer until it actually paints, then re-run once.
    if (typeof IntersectionObserver === 'undefined') return;
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].isIntersecting) {
          doPass();
          io.disconnect();
          return;
        }
      }
    });
    io.observe(svgEl);
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('render timeout')); }, ms); })
    ]);
  }

  function renderError(wrapper, message) {
    wrapper.classList.add('sdoc-mermaid-error');
    var msg = document.createElement('pre');
    msg.className = 'sdoc-mermaid-error-msg';
    msg.textContent = String(message || 'Could not render diagram');
    wrapper.appendChild(msg);
  }

  // Mermaid v10 attaches temporary nodes to document.body during render:
  //   - `<div id="d<our-id>">` enclosing container (always appended)
  //   - `<iframe id="i<our-id>">` for font-size measurement (sometimes)
  //   - `<svg id="<our-id>">` the rendered SVG (sometimes attached
  //                          directly to body before being extracted)
  // On success it removes them. On syntax error it populates the enclosing
  // div with the native errorRenderer SVG (bomb icon + "Syntax error in
  // text") and leaves the lot behind. Our wrapper already shows the
  // textual parse error; the leftover bomb is noise.
  // Call after every render attempt to sweep any of the three.
  function cleanupRenderOrphan(id) {
    if (!id) return;
    var ids = [id, 'd' + id, 'i' + id];
    for (var i = 0; i < ids.length; i++) {
      var n = document.getElementById(ids[i]);
      if (n && n.parentNode === document.body) {
        try { document.body.removeChild(n); } catch (_) {}
      }
    }
  }

  // Walk all code.language-mermaid blocks in container, render each, and
  // replace the <pre> with a <div class="sdoc-mermaid"> wrapping the SVG.
  // Returns a Promise that resolves once every diagram has rendered (or
  // failed) so PDF export can await.
  function processMermaid(container) {
    if (!container) return Promise.resolve();
    var nodes = container.querySelectorAll('code.language-mermaid');
    if (!nodes.length) return Promise.resolve();

    var capped = Array.prototype.slice.call(nodes, 0, DOC_BLOCK_CAP);

    return loadMermaid().then(function (mermaid) {
      try { initMermaid(mermaid); } catch (_) {}
      var themeVars = readThemeVars();

      var jobs = capped.map(function (codeEl) {
        var pre = codeEl.closest('pre');
        if (!pre) return Promise.resolve();
        if (pre._mermaidDone) return Promise.resolve();

        var rawSrc = codeEl.textContent || '';

        var wrapper = document.createElement('div');
        wrapper.className = 'sdoc-mermaid';
        var stage = document.createElement('div');
        stage.className = 'sdoc-mermaid-stage';
        wrapper.appendChild(stage);

        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;
        target.parentNode.replaceChild(wrapper, target);
        pre._mermaidDone = true;

        if (rawSrc.length > SOURCE_BYTE_CAP) {
          renderError(wrapper, 'Diagram source exceeds ' + (SOURCE_BYTE_CAP / 1024) + ' KB cap');
          return Promise.resolve();
        }

        var src = stripDirectives(rawSrc);

        diagramCounter += 1;
        var id = 'sdoc-mermaid-' + diagramCounter;

        var p;
        try { p = mermaid.render(id, src); }
        catch (e) {
          renderError(wrapper, e && e.message);
          cleanupRenderOrphan(id);
          return Promise.resolve();
        }

        return withTimeout(p, RENDER_TIMEOUT_MS)
          .then(function (out) {
            var svg = (out && out.svg) || '';
            stage.innerHTML = sanitizeSvg(svg);
            // Stamp a class on the rendered <svg> so polish rules in
            // rendered.css can target both this inline copy and the
            // cloned copy in the focus modal with a single selector.
            // Mermaid's own inline `max-width: <natural-px>` is kept -
            // small diagrams should render at natural size rather than
            // scale up to fill the wrapper, which makes them look
            // cartoonish.
            var svgEl = stage.querySelector('svg');
            if (svgEl) {
              svgEl.classList.add('sdoc-mermaid-svg');
              try { applyClusterTints(svgEl, themeVars.background); } catch (_) {}
            }
            // Per-diagram fullscreen button (sdocs-mermaid-focus.js).
            // Optional - the diagram still renders if focus mode isn't loaded.
            if (S.SDocMermaidFocus && S.SDocMermaidFocus.buildZoomButton) {
              wrapper.appendChild(S.SDocMermaidFocus.buildZoomButton(wrapper));
            }
          })
          .catch(function (err) {
            renderError(wrapper, (err && err.message) || 'Mermaid render error');
          })
          .then(function () { cleanupRenderOrphan(id); });
      });

      return Promise.all(jobs);
    }).catch(function () {
      // CDN load failure - leave any unprocessed source visible so the
      // reader at least sees the diagram text.
    });
  }

  S.processMermaid = processMermaid;

  // ── PDF / Word export rasterization ────────────────────
  // Mirrors S.getChartImages() — returns one entry per .sdoc-mermaid wrapper
  // with a PNG dataURL the exporter embeds. Async because SVG → PNG goes
  // through Image() decode + canvas drawImage.
  //
  // Polish CSS from rendered.css doesn't cascade into a serialized standalone
  // SVG, so the visible polish (rounded shape corners, edge-label chip styling)
  // is re-emitted as inline <style> on the SVG before rasterization. Theme
  // tokens are read from the wrapper's live computed style so themed docs
  // export themed PNGs. The line-height: normal fix isn't needed here — a
  // standalone SVG inherits the UA "normal" by default, so descenders don't
  // clip even though they would in the inline #_sd_rendered context.
  function buildExportPolishCss(wrapper) {
    var cs = getComputedStyle(wrapper || document.documentElement);
    var blockBg = (cs.getPropertyValue('--md-block-bg') || '').trim() || '#f4f1ed';
    var blockText = (cs.getPropertyValue('--md-block-text') || '').trim() || '#6b6560';
    return [
      '.node > rect, .node .label-container, .actor, .note > rect,',
      '.er.entityBox, .label-container[rx], rect.task { rx: 6px; ry: 6px; }',
      '.edgeLabel foreignObject > div {',
      '  width: max-content; max-width: 240px; white-space: normal;',
      '  padding: 2px 8px; border-radius: 8px;',
      '  background-color: ' + blockBg + ';',
      '  border: 1px solid ' + blockText + ';',
      '}',
      'span.edgeLabel { background: transparent !important; }',
      'foreignObject > div { text-align: center; }'
    ].join('\n');
  }

  function rasterizeSvgToPng(wrapper, svg, scale) {
    return new Promise(function (resolve, reject) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return resolve(null);
      var s = scale || 2;
      var w = Math.max(1, Math.round(rect.width * s));
      var h = Math.max(1, Math.round(rect.height * s));

      var clone = svg.cloneNode(true);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      var styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.textContent = buildExportPolishCss(wrapper);
      clone.insertBefore(styleEl, clone.firstChild);

      var xml = new XMLSerializer().serializeToString(clone);
      var b64;
      try { b64 = btoa(unescape(encodeURIComponent(xml))); }
      catch (e) { return reject(e); }
      var url = 'data:image/svg+xml;base64,' + b64;

      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('mermaid rasterize: image load failed')); };
      img.src = url;
    });
  }

  S.getMermaidImages = function () {
    var wrappers = document.querySelectorAll('.sdoc-mermaid');
    var jobs = Array.prototype.map.call(wrappers, function (wrapper) {
      var svg = wrapper.querySelector('svg');
      if (!svg) return Promise.resolve({ wrapper: wrapper, dataUrl: null });
      return rasterizeSvgToPng(wrapper, svg, 2)
        .then(function (dataUrl) { return { wrapper: wrapper, dataUrl: dataUrl }; })
        .catch(function () { return { wrapper: wrapper, dataUrl: null }; });
    });
    return Promise.all(jobs);
  };
})();
