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

function exportPDF() {
  S.setStatus('Opening print dialog\u2026');
  var closed = expandAllSections();
  // Wait for Chart.js ResizeObserver to re-render expanded charts
  requestAnimationFrame(function() { setTimeout(function() {
    var html = buildExportHTML();
    restoreSections(closed);
    // Use a hidden iframe to avoid popup blockers
    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;width:900px;height:700px;';
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Wait for images and fonts, then trigger print
    var iframeWin = iframe.contentWindow;
    Promise.all(
      Array.from(doc.images).filter(function(i) { return !i.complete; }).map(function(i) {
        return new Promise(function(r) { i.onload = i.onerror = r; });
      })
    ).then(function() {
      return doc.fonts ? doc.fonts.ready : Promise.resolve();
    }).then(function() {
      iframeWin.focus();
      iframeWin.print();
      S.setStatus('PDF print dialog opened');
      // Clean up iframe after print dialog closes
      setTimeout(function() { document.body.removeChild(iframe); }, 1000);
    });
  }, 150); });
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
