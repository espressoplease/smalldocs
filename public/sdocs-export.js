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
  var fontName = document.getElementById('ctrl-font-family').value.replace(/['"]/g,'').split(',')[0].trim();
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
    font = await doc.embedFont(b400);
    bold = await doc.embedFont(b700);
  } catch (e) {
    font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  }
  if (headSlug !== bodySlug) {
    try {
      var h600 = await fetchFontBuf(headSlug, 600).catch(function() { return fetchFontBuf(headSlug, 700); });
      var h700 = await fetchFontBuf(headSlug, 700).catch(function() { return h600; });
      headFont = await doc.embedFont(h600);
      headBold = await doc.embedFont(h700);
    } catch (e) { headFont = font; headBold = bold; }
  } else {
    try {
      var semi = await fetchFontBuf(bodySlug, 600);
      headFont = await doc.embedFont(semi);
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
      var words = run.text.split(/(\s+)/);
      words.forEach(function(word) {
        if (!word) return;
        var f = run.bold ? bold : (run.code ? mono : font);
        var s = run.code ? fontSize * 0.85 : (run.size || fontSize);
        var ww = f.widthOfTextAtSize(word, s);
        if (lineW + ww > maxW && lineW > 0 && word.trim()) {
          lines.push([]);
          lineW = 0;
        }
        lines[lines.length - 1].push({ text: word, font: f, size: s, color: run.color, bold: run.bold, italic: run.italic, code: run.code, link: run.link, underline: run.underline });
        lineW += ww;
      });
    });
    return lines;
  }

  // Draw a single line of runs at x, y
  function drawLine(lineRuns, x, ly) {
    var cx = x;
    lineRuns.forEach(function(r) {
      if (!r.text) return;
      var w = r.font.widthOfTextAtSize(r.text, r.size);
      // Draw inline code background
      if (r.code) {
        var h = r.size + 4;
        page.drawRectangle({ x: cx - 2, y: ly - 3, width: w + 4, height: h, borderRadius: 3, color: hexToRgb(st.codeBg) });
      }
      page.drawText(r.text, { x: cx, y: ly, size: r.size, font: r.font, color: hexToRgb(r.color || st.pColor) });
      // Underline for links
      if (r.underline) {
        page.drawLine({ start: { x: cx, y: ly - 2 }, end: { x: cx + w, y: ly - 2 }, thickness: 0.5, color: hexToRgb(r.color) });
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

  // ── DOM walker ──

  var chartIdx = 0;

  function walk(parent) {
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      var tag = el.tagName.toLowerCase();

      if (el.classList.contains('section-toggle') || el.classList.contains('copy-btn') ||
          el.classList.contains('header-copy-btn') || el.classList.contains('header-anchor')) continue;
      if (el.classList.contains('md-section') || el.classList.contains('md-section-body')) { walk(el); continue; }
      if (el.classList.contains('pre-wrapper')) {
        var ip = el.querySelector('pre');
        if (ip) drawCodeBlock(ip);
        continue;
      }

      if (/^h[1-4]$/.test(tag)) drawHeading(el, tag);
      else if (tag === 'p') drawParagraphEl(el);
      else if (tag === 'pre') drawCodeBlock(el);
      else if (tag === 'blockquote') drawBlockquote(el);
      else if (tag === 'ul') drawList(el, false);
      else if (tag === 'ol') drawList(el, true);
      else if (el.classList.contains('sdoc-chart')) drawChart();
      else if (tag === 'hr') drawHR();
      else if (tag === 'img') drawImage(el);
      else if (tag === 'table') drawTable(el);
    }
  }

  // ── Element renderers ──

  function drawHeading(el, tag) {
    var level = parseInt(tag[1]);
    var sizes = [st.h1Size, st.h2Size, st.h3Size, st.h4Size];
    var colors = [st.h1Color, st.h2Color, st.h3Color, st.h4Color];
    var sz = sizes[level - 1];
    var topGap = level === 1 ? 0 : sz * 0.8;
    y -= topGap;
    ensureSpace(sz + 8);
    page.drawText(el.textContent.trim(), { x: ML, y: y, size: sz, font: level <= 2 ? headBold : headFont, color: hexToRgb(colors[level - 1]) });
    y -= sz * 0.4 + 8;
    // H2 underline
    if (level === 2) {
      page.drawLine({ start: { x: ML, y: y + 2 }, end: { x: ML + CW, y: y + 2 }, thickness: 0.5, color: hexToRgb('#ede8e2') });
      y -= 4;
    }
  }

  function drawParagraphEl(el) {
    var hasImg = el.querySelector('img');
    if (hasImg) {
      el.childNodes.forEach(function(child) {
        if (child.nodeType === 1 && child.tagName === 'IMG') {
          drawImage(child);
        } else if (child.nodeType === 3 && child.textContent.trim()) {
          drawParagraph([{ text: child.textContent, color: st.pColor }]);
        } else if (child.nodeType === 1) {
          drawParagraph(extractRuns(child));
        }
      });
    } else {
      drawParagraph(extractRuns(el));
      y -= fontSize * 0.3; // paragraph gap
    }
  }

  function drawCodeBlock(el) {
    var code = el.querySelector('code');
    var text = (code || el).textContent;
    var lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    var codeSize = fontSize * 0.85;
    var lineH = codeSize * 1.5;
    var pad = 12;
    var blockH = lines.length * lineH + pad * 2;
    ensureSpace(blockH + 8);
    // Background rounded rect
    page.drawRectangle({ x: ML, y: y - blockH + codeSize + 2, width: CW, height: blockH,
      borderRadius: 6, color: hexToRgb(st.preBg), borderColor: hexToRgb(st.preBorder), borderWidth: 0.5 });
    // Draw lines
    var cy = y - pad + 2;
    lines.forEach(function(line) {
      if (line) page.drawText(line, { x: ML + pad, y: cy, size: codeSize, font: mono, color: hexToRgb(st.codeColor) });
      cy -= lineH;
    });
    y -= blockH + fontSize * 0.6;
  }

  function drawBlockquote(el) {
    var runs = [];
    el.querySelectorAll('p').forEach(function(p) { runs = runs.concat(extractRuns(p)); });
    if (!runs.length) runs = [{ text: el.textContent.trim(), color: st.bqColor }];
    runs.forEach(function(r) { r.color = st.bqColor; });
    var lines = wrapRuns(runs, CW - 30);
    var lh = fontSize * st.lineH;
    var pad = 10;
    var blockH = lines.length * lh + pad * 2;
    ensureSpace(blockH + 4);
    // Background
    page.drawRectangle({ x: ML, y: y - blockH + fontSize + 2, width: CW, height: blockH,
      borderRadius: 4, color: hexToRgb(st.bqBg) });
    // Left border
    page.drawRectangle({ x: ML, y: y - blockH + fontSize + 2, width: 3, height: blockH,
      color: hexToRgb(st.bqBorderColor) });
    // Text
    var bqY = y - pad + 2;
    lines.forEach(function(lineRuns) {
      drawLine(lineRuns, ML + 16, bqY);
      bqY -= lh;
    });
    y -= blockH + fontSize * 0.5;
  }

  function drawList(el, ordered) {
    var items = el.querySelectorAll(':scope > li');
    var lh = fontSize * st.lineH;
    items.forEach(function(li, idx) {
      var bullet = ordered ? (idx + 1) + '.' : '\u2022';
      ensureSpace(lh);
      page.drawText(bullet, { x: ML + 12, y: y, size: fontSize, font: font, color: hexToRgb(st.listColor) });
      var runs = extractRuns(li);
      var lines = wrapRuns(runs, CW - 30);
      lines.forEach(function(lineRuns, lineIdx) {
        ensureSpace(lh);
        drawLine(lineRuns, ML + 28, y);
        y -= lh;
      });
    });
    y -= fontSize * 0.3;
  }

  function drawChart() {
    var chartImg = chartImages[chartIdx];
    chartIdx++;
    if (!chartImg || !chartImg.dataUrl || chartImg.dataUrl === 'data:,') return;
    try {
      var imgBytes = Uint8Array.from(atob(chartImg.dataUrl.split(',')[1]), function(c) { return c.charCodeAt(0); });
      var embedded = doc.embedPng(imgBytes);
      // embedPng is async in some versions — handle both
      Promise.resolve(embedded).then(function(img) {
        var scale = Math.min(CW / img.width, 1);
        var drawW = img.width * scale;
        var drawH = img.height * scale;
        ensureSpace(drawH + 16);
        var cx = ML + (CW - drawW) / 2;
        page.drawImage(img, { x: cx, y: y - drawH, width: drawW, height: drawH });
        y -= drawH + 12;
      });
    } catch (e) { /* skip failed chart */ }
  }

  function drawHR() {
    ensureSpace(20);
    y -= 8;
    page.drawLine({ start: { x: ML, y: y }, end: { x: ML + CW, y: y }, thickness: 0.5, color: hexToRgb('#e2ddd6') });
    y -= 12;
  }

  function drawImage(imgEl) {
    var dataUrl = imgToDataUrl(imgEl);
    if (!dataUrl) return;
    try {
      var imgBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), function(c) { return c.charCodeAt(0); });
      var embedded = dataUrl.indexOf('image/png') > -1 ? doc.embedPng(imgBytes) : doc.embedJpg(imgBytes);
      Promise.resolve(embedded).then(function(img) {
        var scale = Math.min(CW / img.width, 1);
        var drawW = img.width * scale;
        var drawH = img.height * scale;
        ensureSpace(drawH + 8);
        page.drawImage(img, { x: ML, y: y - drawH, width: drawW, height: drawH });
        y -= drawH + 8;
      });
    } catch (e) { /* skip */ }
  }

  function drawTable(el) {
    var headerCells = [], rows = [];
    el.querySelectorAll('tr').forEach(function(tr, ri) {
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
    var tableH = rows.length * rowH;
    ensureSpace(Math.min(tableH, rowH * 3)); // at least first 3 rows
    rows.forEach(function(cells, ri) {
      ensureSpace(rowH);
      var fillColor = ri === 0 ? st.tableHeaderBg : (ri % 2 === 0 ? st.tableEvenBg : null);
      if (fillColor) {
        page.drawRectangle({ x: ML, y: y - rowH + fontSize + 2, width: CW, height: rowH, color: hexToRgb(fillColor) });
      }
      // Cell borders
      page.drawLine({ start: { x: ML, y: y + fontSize + 2 }, end: { x: ML + CW, y: y + fontSize + 2 }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
      cells.forEach(function(cell, ci) {
        var cx = ML + ci * colW + 8;
        var f = cell.isHeader ? bold : font;
        var txt = cell.text.substring(0, Math.floor(colW / (fontSize * 0.5))); // truncate
        page.drawText(txt, { x: cx, y: y, size: fontSize * 0.88, font: f, color: hexToRgb(st.pColor) });
        // Vertical divider
        if (ci > 0) {
          page.drawLine({ start: { x: ML + ci * colW, y: y + fontSize + 2 }, end: { x: ML + ci * colW, y: y - rowH + fontSize + 2 }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
        }
      });
      y -= rowH;
    });
    // Bottom border
    page.drawLine({ start: { x: ML, y: y + fontSize + 2 }, end: { x: ML + CW, y: y + fontSize + 2 }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    // Side borders
    page.drawLine({ start: { x: ML, y: y + fontSize + 2 + rows.length * rowH }, end: { x: ML, y: y + fontSize + 2 }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    page.drawLine({ start: { x: ML + CW, y: y + fontSize + 2 + rows.length * rowH }, end: { x: ML + CW, y: y + fontSize + 2 }, thickness: 0.3, color: hexToRgb(st.tableBorder) });
    y -= fontSize * 0.5;
  }

  // ── Render ──

  walk(rendered);

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

document.getElementById('exp-pdf').addEventListener('click', exportPDF);
document.getElementById('exp-word').addEventListener('click', exportWord);

document.getElementById('exp-raw').addEventListener('click', function() {
  download('document.md', S.currentBody);
  S.setStatus('Exported raw .md');
});

document.getElementById('exp-styled').addEventListener('click', function() {
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
  document.getElementById('save-default-display').textContent = saveDefaultCmd;
}

document.querySelector('[data-target="body-save-default"]').addEventListener('click', function() {
  // Delay so the panel-body open class is toggled first
  setTimeout(refreshSaveDefaultPreview, 0);
});

document.getElementById('btn-copy-default').addEventListener('click', async function() {
  refreshSaveDefaultPreview();
  try {
    await navigator.clipboard.writeText(saveDefaultCmd);
    var msg = document.getElementById('save-default-msg');
    msg.textContent = 'Copied! Paste in your terminal to save defaults.';
    msg.style.display = 'block';
    setTimeout(function() { msg.style.display = 'none'; }, 4000);
  } catch (e) {
    S.setStatus('Could not copy to clipboard');
  }
});

})();
