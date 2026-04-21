// sdocs-export.js — Export pipeline: CSS, HTML, PDF, Word, save-default
(function () {
'use strict';

var S = SDocs;

function getCssVar(name) {
  return (S.renderedEl.style.getPropertyValue(name) ||
          getComputedStyle(S.renderedEl).getPropertyValue(name)).trim();
}

function buildExportCSS() {
  var bgColor       = getCssVar('--md-bg')             || '#ffffff';
  var fontFamily    = getCssVar('--md-font-family')    || "'Inter', sans-serif";
  var baseSize      = getCssVar('--md-base-size')      || '16px';
  var lineHeight    = getCssVar('--md-line-height')    || '1.75';
  var color         = getCssVar('--md-color')          || '#1c1917';

  var hFontFamily   = getCssVar('--md-h-font-family')  || 'inherit';
  var hScale        = parseFloat(getCssVar('--md-h-scale') || '1');
  var hMB           = getCssVar('--md-h-margin-bottom')|| '0.4em';
  var hColor        = getCssVar('--md-h-color')        || '#0f0d0c';

  var h1Size    = 'calc(' + (getCssVar('--md-h1-size')    || '2.1em') + ' * ' + hScale + ')';
  var h1Color   = getCssVar('--md-h1-color')   || hColor;
  var h1Weight  = getCssVar('--md-h1-weight')  || '700';
  var h2Size    = 'calc(' + (getCssVar('--md-h2-size')    || '1.55em') + ' * ' + hScale + ')';
  var h2Color   = getCssVar('--md-h2-color')   || hColor;
  var h2Weight  = getCssVar('--md-h2-weight')  || '600';
  var h3Size    = 'calc(' + (getCssVar('--md-h3-size')    || '1.2em') + ' * ' + hScale + ')';
  var h3Color   = getCssVar('--md-h3-color')   || hColor;
  var h3Weight  = getCssVar('--md-h3-weight')  || '600';
  var h4Size    = 'calc(' + (getCssVar('--md-h4-size')    || '1.0em') + ' * ' + hScale + ')';
  var h4Color   = getCssVar('--md-h4-color')   || hColor;
  var h4Weight  = getCssVar('--md-h4-weight')  || '600';

  var pColor    = getCssVar('--md-p-color')     || '#3c3733';
  var pLH       = getCssVar('--md-p-line-height')|| lineHeight;
  var pMargin   = getCssVar('--md-p-margin')    || '0 0 1.1em';

  var linkColor = getCssVar('--md-link-color')  || '#2563eb';
  var linkDec   = getCssVar('--md-link-decoration') || 'underline';

  var codeBG    = getCssVar('--md-code-bg')     || '#f4f1ed';
  var codeColor = getCssVar('--md-code-color')  || '#6b21a8';
  var codeFont  = getCssVar('--md-code-font')   || "'JetBrains Mono', monospace";
  var preBG     = getCssVar('--md-pre-bg')      || codeBG;

  var bqBorder  = getCssVar('--md-bq-border')   || '3px solid #2563eb';
  var bqBg      = getCssVar('--md-bq-bg')      || '#f7f5f2';
  var bqColor   = getCssVar('--md-bq-color')    || '#6b6560';
  var bqPad     = getCssVar('--md-bq-padding')  || '0.5em 1em';
  var bqMargin  = getCssVar('--md-bq-margin')   || '1.2em 0';

  var listColor = getCssVar('--md-list-color')  || pColor;

  return '\n*, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }\nbody {\n  font-family: ' + fontFamily + ';\n  font-size: ' + baseSize + ';\n  color: ' + color + ';\n  line-height: ' + lineHeight + ';\n  background-color: ' + bgColor + ';\n  max-width: 720px;\n  margin: 0 auto;\n  padding: 40px 48px 60px;\n  -webkit-font-smoothing: antialiased;\n}\nh1 { font-family: ' + hFontFamily + '; font-size: ' + h1Size + '; color: ' + h1Color + '; font-weight: ' + h1Weight + '; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 ' + hMB + '; }\nh2 { font-family: ' + hFontFamily + '; font-size: ' + h2Size + '; color: ' + h2Color + '; font-weight: ' + h2Weight + '; letter-spacing: -0.015em; line-height: 1.3; margin: 1.4em 0 ' + hMB + '; padding-bottom: 0.3em; border-bottom: 1px solid #ede8e2; }\nh3 { font-family: ' + hFontFamily + '; font-size: ' + h3Size + '; color: ' + h3Color + '; font-weight: ' + h3Weight + '; letter-spacing: -0.01em; line-height: 1.4; margin: 1.2em 0 ' + hMB + '; }\nh4 { font-family: ' + hFontFamily + '; font-size: ' + h4Size + '; color: ' + h4Color + '; font-weight: ' + h4Weight + '; line-height: 1.5; margin: 1em 0 ' + hMB + '; }\np  { color: ' + pColor + '; line-height: ' + pLH + '; margin: ' + pMargin + '; }\na  { color: ' + linkColor + '; text-decoration: ' + linkDec + '; text-underline-offset: 2px; }\ncode { background: ' + codeBG + '; color: ' + codeColor + '; padding: 0.15em 0.45em; border-radius: 4px; font-family: ' + codeFont + '; font-size: 0.85em; }\npre  { background: ' + preBG + '; padding: 1.1em 1.25em; border-radius: 8px; overflow-x: auto; margin: 1.2em 0; border: 1px solid #e7e2db; }\npre code { background: none; padding: 0; color: ' + codeColor + '; font-size: 0.88em; }\nblockquote { border-left: ' + bqBorder + '; color: ' + bqColor + '; padding: ' + bqPad + '; margin: ' + bqMargin + '; background: ' + bqBg + '; border-radius: 0 6px 6px 0; }\nblockquote p { margin: 0; color: inherit; }\nul, ol { padding-left: 1.6em; margin: 0.5em 0 1.1em; color: ' + listColor + '; }\nli { margin-bottom: 0.3em; }\nli::marker { color: ' + listColor + '; }\nhr { border: none; border-top: 1px solid #ede8e2; margin: 2em 0; }\ntable { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 0.92em; }\nth, td { border: 1px solid #e2ddd6; padding: 7px 12px; text-align: left; }\nth { background: #f4f1ed; font-weight: 600; }\ntr:nth-child(even) td { background: #fafaf8; }\nimg { max-width: 100%; border-radius: 8px; }\n';
}

function inlineImages(clone) {
  var imgs = clone.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    if (/^data:/.test(img.src)) continue;
    // Find the corresponding loaded image in the live DOM by matching src
    var liveImg = S.renderedEl.querySelector('img[src="' + img.getAttribute('src') + '"]');
    if (!liveImg || !liveImg.naturalWidth) continue;
    try {
      var c = document.createElement('canvas');
      c.width = liveImg.naturalWidth;
      c.height = liveImg.naturalHeight;
      c.getContext('2d').drawImage(liveImg, 0, 0);
      img.src = c.toDataURL('image/png');
    } catch (e) {
      // CORS — leave original src in place
    }
  }
}

function inlineCharts(clone) {
  // Remove chart menu UI
  clone.querySelectorAll('.chart-menu-btn, .chart-menu').forEach(function(el) { el.remove(); });
  // Build a map from wrapper element → data URL using Chart.js instances
  var chartImages = S.getChartImages ? S.getChartImages() : [];
  var wrapperMap = new Map();
  chartImages.forEach(function(entry) {
    wrapperMap.set(entry.wrapper, entry.dataUrl);
  });
  // Match live wrappers to clone wrappers by index
  var origWrappers = S.renderedEl.querySelectorAll('.sdoc-chart');
  var cloneWrappers = clone.querySelectorAll('.sdoc-chart');
  for (var i = 0; i < cloneWrappers.length; i++) {
    var dataUrl = origWrappers[i] ? wrapperMap.get(origWrappers[i]) : null;
    if (!dataUrl || dataUrl === 'data:,') {
      // Fallback: try canvas.toDataURL directly
      var origCanvas = origWrappers[i] && origWrappers[i].querySelector('canvas');
      if (origCanvas && origCanvas.width > 0) {
        try { dataUrl = origCanvas.toDataURL('image/png'); } catch (e) { /* skip */ }
      }
    }
    var canvas = cloneWrappers[i].querySelector('canvas');
    if (canvas && dataUrl && dataUrl !== 'data:,') {
      var img = document.createElement('img');
      img.src = dataUrl;
      img.style.width = '100%';
      canvas.parentNode.replaceChild(img, canvas);
    } else if (canvas) {
      // No valid image — remove the empty canvas entirely
      canvas.remove();
    }
  }
}

function buildExportHTML() {
  var fontName = document.getElementById('_sd_ctrl-font-family').value.replace(/['"]/g,'').split(',')[0].trim();
  var fontLink = S.GOOGLE_FONTS.includes(fontName)
    ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fontName) + ':wght@400;500;600;700&display=swap">'
    : '';
  var title = (S.currentMeta.title || 'Document').replace(/</g,'&lt;');
  var clone = S.renderedEl.cloneNode(true);
  inlineCharts(clone);
  inlineImages(clone);
  clone.querySelectorAll('.section-toggle').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('.md-section-body').forEach(function(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  clone.querySelectorAll('.md-section').forEach(function(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>' + title + '</title>\n' + fontLink + '\n<style>' + buildExportCSS() + '\n.sdoc-chart { text-align: center; margin: 1.2em 0; }\n.sdoc-chart img { max-width: 100%; }</style>\n</head>\n<body>\n' +
    clone.innerHTML
      .replace(/<button class="copy-btn"[^]*?<\/button>/g, '')
      .replace(/<button class="header-copy-btn"[^]*?<\/button>/g, '')
      .replace(/<div class="pre-wrapper">([\s\S]*?)<\/div>/g, '$1')
      .replace(/<a class="header-anchor"[^]*?<\/a>/g, '') +
    '\n</body>\n</html>';
}

function expandAllSections() {
  var closed = [];
  S.renderedEl.querySelectorAll('.md-section-body:not(.open)').forEach(function(b) {
    b.classList.add('open');
    closed.push(b);
  });
  return closed;
}

function restoreSections(closed) {
  closed.forEach(function(b) { b.classList.remove('open'); });
}

// ── pdf-lib PDF renderer ──────────────────────────────

var pdfLibLoaded = false;

function loadPdfLib() {
  return new Promise(function(resolve, reject) {
    if (pdfLibLoaded) { resolve(); return; }
    var s1 = document.createElement('script');
    s1.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
      s2.onload = function() { pdfLibLoaded = true; resolve(); };
      s2.onerror = function() { reject(new Error('Could not load fontkit')); };
      document.head.appendChild(s2);
    };
    s1.onerror = function() { reject(new Error('Could not load pdf-lib')); };
    document.head.appendChild(s1);
  });
}

// ── Font loading ──

var fontBufCache = {};

function fontSlug(name) { return name.toLowerCase().replace(/\s+/g, '-'); }

function fetchFontBuf(slug, weight) {
  var key = slug + '-' + weight;
  if (fontBufCache[key]) return Promise.resolve(fontBufCache[key]);
  var url = 'https://cdn.jsdelivr.net/fontsource/fonts/' + slug + '@latest/latin-' + weight + '-normal.ttf';
  return fetch(url).then(function(r) {
    if (!r.ok) throw new Error(r.status);
    return r.arrayBuffer();
  }).then(function(buf) {
    fontBufCache[key] = buf;
    return buf;
  });
}

// ── Color parsing ──

function hexToRgb(hex) {
  if (!hex || hex.charAt(0) !== '#') return PDFLib.rgb(0, 0, 0);
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return PDFLib.rgb(parseInt(hex.substring(0,2),16)/255, parseInt(hex.substring(2,4),16)/255, parseInt(hex.substring(4,6),16)/255);
}

function parseBqBorderColor(val) {
  if (!val) return '#2563eb';
  var m = val.match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : '#2563eb';
}

// ── Style reading ──

function readPdfStyles() {
  var g = getCssVar;
  var hColor = g('--md-h-color') || '#0f0d0c';
  var pColor = g('--md-p-color') || '#3c3733';
  var codeBg = g('--md-code-bg') || '#f4f1ed';
  var hScale = parseFloat(g('--md-h-scale') || '1');
  var basePx = parseFloat(g('--md-base-size') || '16');
  var basePt = basePx * 0.75;
  return {
    basePt: basePt,
    lineH: parseFloat(g('--md-line-height') || '1.75'),
    hScale: hScale,
    h1Size: parseFloat(g('--md-h1-size') || '2.1') * basePt * hScale,
    h2Size: parseFloat(g('--md-h2-size') || '1.55') * basePt * hScale,
    h3Size: parseFloat(g('--md-h3-size') || '1.2') * basePt * hScale,
    h4Size: parseFloat(g('--md-h4-size') || '1.0') * basePt * hScale,
    color: g('--md-color') || '#1c1917',
    hColor: hColor,
    h1Color: g('--md-h1-color') || hColor, h2Color: g('--md-h2-color') || hColor,
    h3Color: g('--md-h3-color') || hColor, h4Color: g('--md-h4-color') || hColor,
    pColor: pColor,
    linkColor: g('--md-link-color') || '#2563eb',
    codeBg: codeBg, codeColor: g('--md-code-color') || '#6b21a8',
    preBg: g('--md-pre-bg') || codeBg, preBorder: g('--md-pre-border') || '#e7e2db',
    bqBg: g('--md-bq-bg') || '#f7f5f2', bqColor: g('--md-bq-color') || '#6b6560',
    bqBorderColor: parseBqBorderColor(g('--md-bq-border')),
    listColor: g('--md-list-color') || pColor,
    tableBorder: g('--md-table-border') || '#e2ddd6',
    tableHeaderBg: g('--md-table-header-bg') || '#f4f1ed',
    tableEvenBg: g('--md-table-even-bg') || '#fafaf8',
  };
}

// ── Image helper ──

function imgToDataUrl(img) {
  if (!img || !img.src) return null;
  if (/^data:/.test(img.src)) return img.src;
  if (!img.naturalWidth) return null;
  try {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
}

// ── CSS → PDF helpers ──

// px → pt (CSS uses 1px = 1/96in; PDF uses 1pt = 1/72in → pt = px * 0.75)
function pxToPt(px) { return parseFloat(px) * 0.75; }

// Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" → hex
function rgbStrToHex(s) {
  if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
  var m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return s.charAt(0) === '#' ? s : null;
  var r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  return '#' + [r, g, b].map(function(v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

// Read computed CSS into a structured object
function readComputedBlock(el) {
  var cs = getComputedStyle(el);
  return {
    color: rgbStrToHex(cs.color),
    background: rgbStrToHex(cs.backgroundColor),
    fontSize: pxToPt(parseFloat(cs.fontSize)),
    fontWeight: parseInt(cs.fontWeight) || 400,
    fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
    padL: pxToPt(parseFloat(cs.paddingLeft) || 0),
    padR: pxToPt(parseFloat(cs.paddingRight) || 0),
    padT: pxToPt(parseFloat(cs.paddingTop) || 0),
    padB: pxToPt(parseFloat(cs.paddingBottom) || 0),
    marL: pxToPt(parseFloat(cs.marginLeft) || 0),
    marR: pxToPt(parseFloat(cs.marginRight) || 0),
    marT: pxToPt(parseFloat(cs.marginTop) || 0),
    marB: pxToPt(parseFloat(cs.marginBottom) || 0),
    rTL: pxToPt(parseFloat(cs.borderTopLeftRadius) || 0),
    rTR: pxToPt(parseFloat(cs.borderTopRightRadius) || 0),
    rBR: pxToPt(parseFloat(cs.borderBottomRightRadius) || 0),
    rBL: pxToPt(parseFloat(cs.borderBottomLeftRadius) || 0),
    borderLeftColor: rgbStrToHex(cs.borderLeftColor),
    borderLeftWidth: pxToPt(parseFloat(cs.borderLeftWidth) || 0),
    borderColor: rgbStrToHex(cs.borderColor || cs.borderTopColor),
    borderWidth: pxToPt(parseFloat(cs.borderTopWidth) || 0),
    textDecoration: cs.textDecorationLine || cs.textDecoration,
  };
}

// ── pdf-lib rendering engine ──

async function renderPdf(rendered, st, chartImages) {
  var PDFDocument = PDFLib.PDFDocument;
  var rgb = PDFLib.rgb;
  var doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Load fonts
  var bodyFontRaw = getCssVar('--md-font-family') || "'Inter', sans-serif";
  var headFontRaw = getCssVar('--md-h-font-family') || 'inherit';
  var bodyName = bodyFontRaw.replace(/['"]/g, '').split(',')[0].trim();
  var headName = headFontRaw === 'inherit' ? bodyName : headFontRaw.replace(/['"]/g, '').split(',')[0].trim();
  var bodySlug = fontSlug(bodyName);
  var headSlug = fontSlug(headName);

  var font, bold, headFont, headBold, mono;
  try {
    var b400 = await fetchFontBuf(bodySlug, 400);
    var b700 = await fetchFontBuf(bodySlug, 700);
    // { subset: true } is critical: the default CustomFontEmbedder builds its
    // ToUnicode CMap from the font's cmap table only, so any glyph produced
    // by OpenType substitution (e.g. Inter's "case" feature swapping "(" for
    // an uppercase-aware variant next to capitals) has no Unicode mapping
    // and becomes unextractable. SubsetEmbedder CMaps every glyph that
    // encodeText actually uses, so substitutions round-trip correctly.
    font = await doc.embedFont(b400, { subset: true });
    bold = await doc.embedFont(b700, { subset: true });
  } catch (e) {
    font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  }
  if (headSlug !== bodySlug) {
    try {
      var h600 = await fetchFontBuf(headSlug, 600).catch(function() { return fetchFontBuf(headSlug, 700); });
      var h700 = await fetchFontBuf(headSlug, 700).catch(function() { return h600; });
      headFont = await doc.embedFont(h600, { subset: true });
      headBold = await doc.embedFont(h700, { subset: true });
    } catch (e) { headFont = font; headBold = bold; }
  } else {
    try {
      var semi = await fetchFontBuf(bodySlug, 600);
      headFont = await doc.embedFont(semi, { subset: true });
    } catch (e) { headFont = bold; }
    headBold = bold;
  }
  mono = await doc.embedFont(PDFLib.StandardFonts.Courier);

  // Page layout
  var W = 595.28; // A4 width
  var H = 841.89; // A4 height
  var ML = 48, MR = 48, MT = 48, MB = 48;
  var CW = W - ML - MR; // content width
  var fontSize = st.basePt;
  var lineSpacing = fontSize * st.lineH;

  var page = doc.addPage([W, H]);
  var y = H - MT;

  function ensureSpace(need) {
    if (y - need < MB) {
      page = doc.addPage([W, H]);
      y = H - MT;
    }
  }

  // ── Rounded rectangle (SVG path; pdf-lib's drawRectangle doesn't support borderRadius) ──
  // opts.x/y = top-left corner in PDF coords (y = distance from page bottom)
  // opts.radius = number, or {tl, tr, br, bl} for per-corner radii
  function drawRoundedRect(opts) {
    var x = opts.x, yTop = opts.y, w = opts.width, h = opts.height;
    var r = opts.radius;
    var rTL, rTR, rBR, rBL;
    if (typeof r === 'object') {
      rTL = r.tl || 0; rTR = r.tr || 0; rBR = r.br || 0; rBL = r.bl || 0;
    } else {
      rTL = rTR = rBR = rBL = r || 0;
    }
    var maxR = Math.min(w, h) / 2;
    rTL = Math.min(rTL, maxR); rTR = Math.min(rTR, maxR);
    rBR = Math.min(rBR, maxR); rBL = Math.min(rBL, maxR);

    // Build SVG path in local coords: origin at top-left, y grows DOWN, extends to (w, h)
    var path = 'M' + rTL + ' 0';
    path += ' L' + (w - rTR) + ' 0';
    if (rTR) path += ' Q' + w + ' 0 ' + w + ' ' + rTR;
    path += ' L' + w + ' ' + (h - rBR);
    if (rBR) path += ' Q' + w + ' ' + h + ' ' + (w - rBR) + ' ' + h;
    path += ' L' + rBL + ' ' + h;
    if (rBL) path += ' Q0 ' + h + ' 0 ' + (h - rBL);
    path += ' L0 ' + rTL;
    if (rTL) path += ' Q0 0 ' + rTL + ' 0';
    path += ' Z';

    // Pass origin via x/y options — pdf-lib flips SVG y-down into PDF y-up
    var drawOpts = { x: x, y: yTop };
    if (opts.color) drawOpts.color = hexToRgb(opts.color);
    if (opts.borderColor) drawOpts.borderColor = hexToRgb(opts.borderColor);
    if (opts.borderWidth) drawOpts.borderWidth = opts.borderWidth;
    page.drawSvgPath(path, drawOpts);
  }

  // ── Text wrapping engine ──

  function measureRun(run) {
    var f = run.bold ? bold : (run.italic ? font : font);
    var s = run.size || fontSize;
    if (run.code) { f = mono; s = fontSize * 0.85; }
    return { width: f.widthOfTextAtSize(run.text, s), font: f, size: s };
  }

  // Extract inline runs from DOM element
  function extractRuns(el) {
    var runs = [];
    el.childNodes.forEach(function(n) {
      if (n.nodeType === 3) {
        if (n.textContent) runs.push({ text: n.textContent, color: st.pColor });
      } else if (n.nodeType === 1) {
        var tag = n.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') {
          runs.push({ text: n.textContent, bold: true, color: st.pColor });
        } else if (tag === 'em' || tag === 'i') {
          runs.push({ text: n.textContent, italic: true, color: st.pColor });
        } else if (tag === 'code') {
          runs.push({ text: n.textContent, code: true, color: st.codeColor });
        } else if (tag === 'a') {
          runs.push({ text: n.textContent, color: st.linkColor, link: n.href, underline: true });
        } else if (tag === 'br') {
          runs.push({ text: '\n', color: st.pColor });
        } else if (tag !== 'img') {
          runs = runs.concat(extractRuns(n));
        }
      }
    });
    return runs;
  }

  // Split runs into wrapped lines that fit within maxW
  function wrapRuns(runs, maxW) {
    var lines = [[]];
    var lineW = 0;
    runs.forEach(function(run) {
      if (run.text === '\n') { lines.push([]); lineW = 0; return; }

      // Inline code: treat the whole run as one unit (don't word-split)
      // so spaces inside "npm i -g sdocs-dev" stay in one pill.
      if (run.code) {
        var f = mono;
        var s = fontSize * 0.85;
        // Account for pill padding in wrap calculation
        var ww = f.widthOfTextAtSize(run.text, s) + 5; // CODE_PAD_X * 2 = 5
        if (lineW + ww > maxW && lineW > 0) {
          lines.push([]); lineW = 0;
        }
        lines[lines.length - 1].push({
          text: run.text, font: f, size: s,
          color: run.color, code: true,
        });
        lineW += ww;
        return;
      }

      var words = run.text.split(/(\s+)/);
      words.forEach(function(word) {
        if (!word) return;
        var f = run.bold ? bold : (run.italic ? font : font);
        var s = run.size || fontSize;
        var ww = f.widthOfTextAtSize(word, s);
        if (lineW + ww > maxW && lineW > 0 && word.trim()) {
          lines.push([]);
          lineW = 0;
          // Skip leading whitespace on wrapped lines
          if (!word.trim()) return;
        }
        lines[lines.length - 1].push({
          text: word, font: f, size: s,
          color: run.color, bold: run.bold, italic: run.italic,
          link: run.link, underline: run.underline,
        });
        lineW += ww;
      });
    });
    return lines;
  }

  // Wrap a single code-block line to fit within maxW chars (word-break, keep leading indent)
  function wrapCodeLine(line, maxW, codeSize) {
    if (mono.widthOfTextAtSize(line, codeSize) <= maxW) return [line];
    // Extract leading whitespace for continuation indent
    var indentMatch = line.match(/^\s*/);
    var indent = indentMatch ? indentMatch[0] : '';
    var contIndent = indent + '  ';
    var words = line.split(/( +)/); // split but keep spaces
    var out = [''];
    var curW = 0;
    words.forEach(function(w) {
      if (!w) return;
      var ww = mono.widthOfTextAtSize(w, codeSize);
      if (curW + ww > maxW && out[out.length - 1].trim()) {
        out.push(contIndent);
        curW = mono.widthOfTextAtSize(contIndent, codeSize);
      }
      out[out.length - 1] += w;
      curW += ww;
    });
    return out;
  }

  // Add a clickable link annotation to the current page
  function addLinkAnnotation(url, x1, y1, x2, y2) {
    var PDFName = PDFLib.PDFName;
    var PDFString = PDFLib.PDFString;
    var ctx = doc.context;
    var linkDict = ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      C: [0, 0, 1],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    });
    var linkRef = ctx.register(linkDict);
    var annots = page.node.get(PDFName.of('Annots'));
    if (!annots) {
      page.node.set(PDFName.of('Annots'), ctx.obj([linkRef]));
    } else {
      annots.push(linkRef);
    }
  }

  // Merge adjacent runs with identical formatting so whitespace gets drawn
  // as part of a single text string (preserves proper inter-word spacing).
  function mergeRuns(lineRuns) {
    var out = [];
    lineRuns.forEach(function(r) {
      if (!r.text) return;
      var last = out[out.length - 1];
      var key = (r.font === last ? 'x' : '') + '|' + r.size + '|' + (r.color || '') +
                '|' + (r.code ? '1' : '0') + '|' + (r.underline ? '1' : '0') +
                '|' + (r.bold ? '1' : '0') + '|' + (r.italic ? '1' : '0') +
                '|' + (r.link || '');
      if (last && last._font === r.font && last._key === key) {
        last.text += r.text;
      } else {
        out.push({
          _font: r.font, _key: key,
          text: r.text, font: r.font, size: r.size, color: r.color,
          code: r.code, underline: r.underline, link: r.link,
          bold: r.bold, italic: r.italic,
        });
      }
    });
    return out;
  }

  // Inline code pill spacing
  var CODE_PAD_X = 2.5;
  var CODE_PAD_Y = 1;

  // Draw a single line of runs. `ly` is the baseline Y (PDF coords).
  function drawLine(lineRuns, x, ly) {
    var merged = mergeRuns(lineRuns);
    var cx = x;
    merged.forEach(function(r) {
      if (!r.text) return;
      var w = r.font.widthOfTextAtSize(r.text, r.size);
      // Inline code pill — pill width = w + 2*padX, text centered with padX inset
      if (r.code && r.text.trim()) {
        var ascent = r.size * 0.78;
        var descent = r.size * 0.22;
        var pillH = ascent + descent + CODE_PAD_Y * 2;
        drawRoundedRect({
          x: cx,
          y: ly + ascent + CODE_PAD_Y,
          width: w + CODE_PAD_X * 2,
          height: pillH,
          radius: 3,
          color: st.codeBg,
        });
        page.drawText(r.text, { x: cx + CODE_PAD_X, y: ly, size: r.size, font: r.font, color: hexToRgb(r.color || st.codeColor) });
        cx += w + CODE_PAD_X * 2;
        return;
      }
      page.drawText(r.text, { x: cx, y: ly, size: r.size, font: r.font, color: hexToRgb(r.color || st.pColor) });
      if (r.underline) {
        page.drawLine({
          start: { x: cx, y: ly - 1.2 },
          end: { x: cx + w, y: ly - 1.2 },
          thickness: 0.6,
          color: hexToRgb(r.color),
        });
      }
      if (r.link) {
        try { addLinkAnnotation(r.link, cx, ly - 2, cx + w, ly + r.size * 0.85); }
        catch (e) { /* ignore annotation errors */ }
      }
      cx += w;
    });
  }

  // Draw wrapped paragraph runs
  function drawParagraph(runs, indent) {
    indent = indent || 0;
    var lines = wrapRuns(runs, CW - indent);
    var lh = fontSize * st.lineH;
    ensureSpace(lh);
    lines.forEach(function(lineRuns) {
      ensureSpace(lh);
      drawLine(lineRuns, ML + indent, y);
      y -= lh;
    });
  }

  // ── Async walker ──

  var chartIdx = 0;

  async function walk(parent) {
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      var tag = el.tagName.toLowerCase();

      if (el.classList.contains('section-toggle') || el.classList.contains('copy-btn') ||
          el.classList.contains('header-copy-btn') || el.classList.contains('header-anchor')) continue;
      if (el.classList.contains('md-section') || el.classList.contains('md-section-body')) { await walk(el); continue; }
      if (el.classList.contains('pre-wrapper')) {
        var ip = el.querySelector('pre');
        if (ip) drawCodeBlock(ip);
        continue;
      }

      if (/^h[1-4]$/.test(tag)) drawHeading(el, tag);
      else if (tag === 'p') await drawParagraphEl(el);
      else if (tag === 'pre') drawCodeBlock(el);
      else if (tag === 'blockquote') drawBlockquote(el);
      else if (tag === 'ul') drawList(el, false);
      else if (tag === 'ol') drawList(el, true);
      else if (el.classList.contains('sdoc-chart')) await drawChart();
      else if (tag === 'hr') drawHR(el);
      else if (tag === 'img') await drawImage(el);
      else if (tag === 'table') drawTable(el);
    }
  }

  // ── Element renderers (CSS-driven) ──

  function drawHeading(el, tag) {
    var level = parseInt(tag[1]);
    var s = readComputedBlock(el);
    var sz = s.fontSize;
    var f = s.fontWeight >= 700 ? headBold : headFont;
    var color = s.color || st.hColor;
    y -= s.marT * 0.8;
    var runs = [{ text: el.textContent.trim() }];
    var lines = wrapHeadingRuns(runs, CW, f, sz);
    var lh = sz * 1.2;
    lines.forEach(function(line) {
      ensureSpace(lh);
      var cx = ML;
      line.forEach(function(word) {
        page.drawText(word.text, { x: cx, y: y - sz * 0.82, size: sz, font: f, color: hexToRgb(color) });
        cx += f.widthOfTextAtSize(word.text, sz);
      });
      y -= lh;
    });
    // Heading bottom margin — use full CSS value so paragraphs below aren't cramped
    y -= Math.max(s.marB, sz * 0.35);
  }

  // Special wrap for heading (single font/size, just for line breaking)
  function wrapHeadingRuns(runs, maxW, f, sz) {
    var lines = [[]];
    var lineW = 0;
    runs.forEach(function(run) {
      var words = run.text.split(/(\s+)/);
      words.forEach(function(word) {
        if (!word) return;
        var ww = f.widthOfTextAtSize(word, sz);
        if (lineW + ww > maxW && lineW > 0 && word.trim()) {
          lines.push([]); lineW = 0;
        }
        lines[lines.length - 1].push({ text: word });
        lineW += ww;
      });
    });
    return lines;
  }

  async function drawParagraphEl(el) {
    var s = readComputedBlock(el);
    y -= s.marT * 0.2; // tighter vertical rhythm in PDF
    // Detect images inside the paragraph
    var imgChildren = el.querySelectorAll(':scope > img');
    if (imgChildren.length) {
      // Process each child in order
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i];
        if (child.nodeType === 1 && child.tagName === 'IMG') {
          await drawImage(child);
        } else if (child.nodeType === 3 && child.textContent.trim()) {
          drawParagraphRuns([{ text: child.textContent, color: s.color || st.pColor }]);
        } else if (child.nodeType === 1) {
          drawParagraphRuns(extractRuns(child));
        }
      }
    } else {
      drawParagraphRuns(extractRuns(el), s);
    }
    y -= s.marB * 0.4;
  }

  function drawParagraphRuns(runs, s) {
    if (!runs.length) return;
    var lines = wrapRuns(runs, CW);
    var lh = s && s.lineHeight ? s.lineHeight * 0.75 : fontSize * st.lineH;
    lines.forEach(function(lineRuns) {
      ensureSpace(lh);
      drawLine(lineRuns, ML, y - fontSize * 0.85);
      y -= lh;
    });
  }

  function drawCodeBlock(el) {
    var s = readComputedBlock(el);
    var code = el.querySelector('code');
    var rawText = (code || el).textContent;
    var rawLines = rawText.split('\n');
    if (rawLines[rawLines.length - 1] === '') rawLines.pop();

    var codeSize = s.fontSize * 0.85;
    if (code) {
      codeSize = pxToPt(parseFloat(getComputedStyle(code).fontSize));
    }
    var lineH = codeSize * 1.5;
    var padT = s.padT, padB = s.padB, padL = s.padL, padR = s.padR;
    var innerW = CW - padL - padR;
    var radius = { tl: s.rTL, tr: s.rTR, br: s.rBR, bl: s.rBL };

    // Wrap each raw line to fit
    var wrappedLines = [];
    rawLines.forEach(function(line) {
      wrappedLines = wrappedLines.concat(wrapCodeLine(line, innerW, codeSize));
    });

    var blockH = wrappedLines.length * lineH + padT + padB;

    y -= s.marT * 0.5;
    ensureSpace(blockH + 8);

    drawRoundedRect({
      x: ML, y: y, width: CW, height: blockH,
      radius: radius,
      color: s.background || st.preBg,
      borderColor: s.borderColor || st.preBorder,
      borderWidth: s.borderWidth > 0 ? s.borderWidth : 0.5,
    });

    var cy = y - padT - codeSize * 0.82;
    var codeColor = code ? rgbStrToHex(getComputedStyle(code).color) : st.codeColor;
    wrappedLines.forEach(function(line) {
      if (line) page.drawText(line, { x: ML + padL, y: cy, size: codeSize, font: mono, color: hexToRgb(codeColor) });
      cy -= lineH;
    });
    // More breathing room after code blocks
    y -= blockH + Math.max(s.marB, fontSize * 0.8);
  }

  function drawBlockquote(el) {
    var s = readComputedBlock(el);
    var runs = [];
    el.querySelectorAll('p').forEach(function(p) { runs = runs.concat(extractRuns(p)); });
    if (!runs.length) runs = [{ text: el.textContent.trim(), color: s.color || st.bqColor }];
    runs.forEach(function(r) { r.color = s.color || st.bqColor; });

    var lh = s.lineHeight ? s.lineHeight * 0.75 : fontSize * st.lineH;
    var padL = s.padL, padR = s.padR, padT = s.padT, padB = s.padB;
    var borderW = s.borderLeftWidth;
    var textX = ML + padL + borderW;
    var lines = wrapRuns(runs, CW - padL - padR - borderW);
    var blockH = lines.length * lh + padT + padB;
    var radius = { tl: s.rTL, tr: s.rTR, br: s.rBR, bl: s.rBL };

    y -= s.marT * 0.4;
    ensureSpace(blockH + 4);

    // Background — full width, with CSS radii (typically left corners = 0, right corners = 6)
    drawRoundedRect({
      x: ML, y: y, width: CW, height: blockH,
      radius: radius,
      color: s.background || st.bqBg,
    });
    // Left border — flat rectangle (no rounding)
    if (borderW > 0) {
      var borderColor = s.borderLeftColor || st.bqBorderColor;
      drawRoundedRect({
        x: ML, y: y, width: borderW, height: blockH,
        radius: 0,
        color: borderColor,
      });
    }

    // Vertically center: distribute half-leading above first line
    var halfLeading = Math.max((lh - fontSize) / 2, 0);
    var bqY = y - padT - halfLeading - fontSize * 0.82;
    lines.forEach(function(lineRuns) {
      drawLine(lineRuns, textX + 4, bqY);
      bqY -= lh;
    });
    y -= blockH + s.marB * 0.4;
  }

  function drawList(el, ordered) {
    var s = readComputedBlock(el);
    var items = el.querySelectorAll(':scope > li');
    y -= s.marT * 0.2;
    items.forEach(function(li, idx) {
      var itemS = readComputedBlock(li);
      var lh = itemS.lineHeight ? itemS.lineHeight * 0.75 : fontSize * st.lineH;
      var bullet = ordered ? (idx + 1) + '.' : '\u2022';
      var indent = 14;
      var runs = extractRuns(li);
      var lines = wrapRuns(runs, CW - indent - 8);
      lines.forEach(function(lineRuns, lineIdx) {
        ensureSpace(lh);
        if (lineIdx === 0) {
          page.drawText(bullet, { x: ML + 4, y: y - fontSize * 0.85, size: fontSize, font: font, color: hexToRgb(st.listColor) });
        }
        drawLine(lineRuns, ML + indent + 4, y - fontSize * 0.85);
        y -= lh;
      });
    });
    y -= s.marB * 0.3;
  }

  async function drawChart() {
    var chartImg = chartImages[chartIdx];
    chartIdx++;
    if (!chartImg || !chartImg.dataUrl || chartImg.dataUrl === 'data:,') return;
    try {
      var imgBytes = Uint8Array.from(atob(chartImg.dataUrl.split(',')[1]), function(c) { return c.charCodeAt(0); });
      var img = await doc.embedPng(imgBytes);
      var scale = Math.min(CW / img.width, 1);
      var drawW = img.width * scale;
      var drawH = img.height * scale;
      ensureSpace(drawH + 16);
      var cx = ML + (CW - drawW) / 2;
      page.drawImage(img, { x: cx, y: y - drawH, width: drawW, height: drawH });
      y -= drawH + 12;
    } catch (e) { console.warn('Chart embed failed:', e); }
  }

  function drawHR(el) {
    var s = el ? readComputedBlock(el) : { marT: 20, marB: 20 };
    y -= s.marT * 0.5;
    ensureSpace(10);
    page.drawLine({ start: { x: ML, y: y }, end: { x: ML + CW, y: y }, thickness: 0.5, color: hexToRgb('#e2ddd6') });
    y -= s.marB * 0.5;
  }

  async function drawImage(imgEl) {
    var dataUrl = imgToDataUrl(imgEl);
    if (!dataUrl) return;
    try {
      var imgBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), function(c) { return c.charCodeAt(0); });
      var img = dataUrl.indexOf('image/png') > -1 ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
      var scale = Math.min(CW / img.width, 1);
      var drawW = img.width * scale;
      var drawH = img.height * scale;
      // Read border-radius from computed style
      var imgRadius = 0;
      if (imgEl) {
        var cs = getComputedStyle(imgEl);
        imgRadius = pxToPt(parseFloat(cs.borderTopLeftRadius) || 0);
      }
      ensureSpace(drawH + 8);
      var cx = ML + (CW - drawW) / 2;
      page.drawImage(img, { x: cx, y: y - drawH, width: drawW, height: drawH });
      y -= drawH + 8;
    } catch (e) { console.warn('Image embed failed:', e); }
  }

  function drawTable(el) {
    var rows = [];
    el.querySelectorAll('tr').forEach(function(tr) {
      var cells = [];
      tr.querySelectorAll('th, td').forEach(function(td) {
        cells.push({ text: td.textContent, isHeader: td.tagName === 'TH' });
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return;
    var cols = rows[0].length;
    var colW = CW / cols;
    var rowH = fontSize * 1.8;
    rows.forEach(function(cells, ri) {
      ensureSpace(rowH);
      var fillColor = ri === 0 ? st.tableHeaderBg : (ri % 2 === 0 ? st.tableEvenBg : null);
      if (fillColor) {
        page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: hexToRgb(fillColor) });
      }
      // Top border
      page.drawLine({ start: { x: ML, y: y }, end: { x: ML + CW, y: y }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
      cells.forEach(function(cell, ci) {
        var cx = ML + ci * colW + 8;
        var f = cell.isHeader ? bold : font;
        var txt = cell.text.substring(0, Math.floor(colW / (fontSize * 0.5)));
        page.drawText(txt, { x: cx, y: y - fontSize * 1.1, size: fontSize * 0.88, font: f, color: hexToRgb(st.pColor) });
        if (ci > 0) {
          page.drawLine({ start: { x: ML + ci * colW, y: y }, end: { x: ML + ci * colW, y: y - rowH }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
        }
      });
      y -= rowH;
    });
    page.drawLine({ start: { x: ML, y: y }, end: { x: ML + CW, y: y }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    page.drawLine({ start: { x: ML, y: y + rows.length * rowH }, end: { x: ML, y: y }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    page.drawLine({ start: { x: ML + CW, y: y + rows.length * rowH }, end: { x: ML + CW, y: y }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    y -= 8;
  }

  // ── Render ──

  await walk(rendered);

  // Handle async image/chart embeds — wait for all pending promises
  // pdf-lib embedPng/embedJpg return promises; we called them in sync context
  // Re-render approach: we need to make walk async for images/charts
  // For now, images embedded synchronously via the Promise.resolve pattern above
  // will work because pdf-lib's embed methods are sync for already-loaded data

  return doc.save();
}

// ── Export orchestration ──

async function exportPDF() {
  S.setStatus('Generating PDF\u2026');
  try {
    await loadPdfLib();
    // Ensure any KaTeX-rendered math has settled before capturing the DOM.
    // Otherwise fast-clicking Export right after load snapshots empty math
    // placeholders.
    if (S.processMath) { try { await S.processMath(S.renderedEl); } catch (_) {} }

    var closed = expandAllSections();
    await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, 150); }); });

    var st = readPdfStyles();
    var chartImages = S.getChartImages ? S.getChartImages() : [];
    var pdfBytes = await renderPdf(S.renderedEl, st, chartImages);
    restoreSections(closed);

    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.currentMeta.title || 'document').replace(/[^a-z0-9_-]/gi, '_') + '.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
    S.setStatus('PDF downloaded');
  } catch (e) {
    S.setStatus('PDF export failed: ' + e.message);
    console.error(e);
  }
}

S.buildExportHTML = buildExportHTML;
S.expandAllSections = expandAllSections;
S.restoreSections = restoreSections;

var htmlToDocxLoaded = false;

function loadHtmlToDocx() {
  return new Promise(function(resolve, reject) {
    if (htmlToDocxLoaded) { resolve(); return; }
    window.global = window; // polyfill for browser
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@turbodocx/html-to-docx@1/dist/html-to-docx.browser.js';
    s.onload = function() { htmlToDocxLoaded = true; resolve(); };
    s.onerror = function() { reject(new Error('Could not load html-to-docx')); };
    document.head.appendChild(s);
  });
}

async function exportWord() {
  S.setStatus('Generating Word document\u2026');
  try {
    await loadHtmlToDocx();
    var closed = expandAllSections();
    await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, 150); }); });
    var html = buildExportHTML();
    restoreSections(closed);
    var blob = await window.HTMLToDOCX(html, null, {
      orientation: 'portrait',
      margins: { top: 720, right: 900, bottom: 720, left: 900 },
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.currentMeta.title || 'document').replace(/[^a-z0-9_-]/gi,'_') + '.docx';
    a.click();
    URL.revokeObjectURL(a.href);
    S.setStatus('Exported Word .docx');
  } catch (e) {
    S.setStatus('Word export failed: ' + e.message);
    console.error(e);
  }
}

function download(filename, content) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Export panel handlers ──────────────────────────────

document.getElementById('_sd_exp-pdf').addEventListener('click', exportPDF);
document.getElementById('_sd_exp-word').addEventListener('click', exportWord);

document.getElementById('_sd_exp-raw').addEventListener('click', function() {
  download('document.md', S.currentBody);
  S.setStatus('Exported raw .md');
});

document.getElementById('_sd_exp-styled').addEventListener('click', function() {
  var meta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
  var fm = SDocYaml.serializeFrontMatter(meta);
  download('document.md', fm + '\n' + S.currentBody);
  S.setStatus('Exported styled .md with YAML front matter');
});

// ── Save as default styles ──────────────────────────────

function formatStyleValue(k, v) {
  if (typeof v !== 'object' || v === null) {
    return k + ': ' + JSON.stringify(v);
  }
  // light/dark theme blocks: serialize as nested block (not inline)
  if (k === 'light' || k === 'dark') {
    var blockLines = [k + ':'];
    Object.keys(v).forEach(function(sk) {
      var sv = v[sk];
      if (typeof sv === 'object' && sv !== null) {
        var inner = Object.keys(sv).map(function(a) { return a + ': ' + JSON.stringify(sv[a]); }).join(', ');
        blockLines.push('  ' + sk + ': { ' + inner + ' }');
      } else {
        blockLines.push('  ' + sk + ': ' + JSON.stringify(sv));
      }
    });
    return blockLines.join('\n');
  }
  // Default: inline object
  var inner = Object.keys(v).map(function(a) { return a + ': ' + JSON.stringify(v[a]); }).join(', ');
  return k + ': { ' + inner + ' }';
}

function buildStylesYaml() {
  var styles = S.collectStyles();
  var lines = [];
  Object.keys(styles).forEach(function(k) {
    lines.push(formatStyleValue(k, styles[k]));
  });
  return lines.join('\n');
}

var saveDefaultCmd = '';

function refreshSaveDefaultPreview() {
  var yaml = buildStylesYaml();
  saveDefaultCmd = "mkdir -p ~/.sdocs && cat > ~/.sdocs/styles.yaml << 'SDOCS'\n" + yaml + '\nSDOCS';
  document.getElementById('_sd_save-default-display').textContent = saveDefaultCmd;
}

document.querySelector('[data-target="_sd_body-save-default"]').addEventListener('click', function() {
  // Delay so the panel-body open class is toggled first
  setTimeout(refreshSaveDefaultPreview, 0);
});

document.getElementById('_sd_btn-copy-default').addEventListener('click', async function() {
  refreshSaveDefaultPreview();
  try {
    await navigator.clipboard.writeText(saveDefaultCmd);
    var msg = document.getElementById('_sd_save-default-msg');
    msg.textContent = 'Copied! Paste in your terminal to save defaults.';
    msg.style.display = 'block';
    setTimeout(function() { msg.style.display = 'none'; }, 4000);
  } catch (e) {
    S.setStatus('Could not copy to clipboard');
  }
});

})();
