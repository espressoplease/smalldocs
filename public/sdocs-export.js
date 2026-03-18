// sdocs-export.js — Export pipeline: CSS, HTML, PDF, Word, save-default
(function () {
'use strict';

var S = SDocs;

function cv(name) {
  return (S.renderedEl.style.getPropertyValue(name) ||
          getComputedStyle(S.renderedEl).getPropertyValue(name)).trim();
}

function buildExportCSS() {
  var bgColor       = cv('--md-bg')             || '#ffffff';
  var fontFamily    = cv('--md-font-family')    || "'Inter', sans-serif";
  var baseSize      = cv('--md-base-size')      || '16px';
  var lineHeight    = cv('--md-line-height')    || '1.75';
  var color         = cv('--md-color')          || '#1c1917';

  var hFontFamily   = cv('--md-h-font-family')  || 'inherit';
  var hScale        = parseFloat(cv('--md-h-scale') || '1');
  var hMB           = cv('--md-h-margin-bottom')|| '0.4em';
  var hColor        = cv('--md-h-color')        || '#0f0d0c';

  var h1Size    = 'calc(' + (cv('--md-h1-size')    || '2.1em') + ' * ' + hScale + ')';
  var h1Color   = cv('--md-h1-color')   || hColor;
  var h1Weight  = cv('--md-h1-weight')  || '700';
  var h2Size    = 'calc(' + (cv('--md-h2-size')    || '1.55em') + ' * ' + hScale + ')';
  var h2Color   = cv('--md-h2-color')   || hColor;
  var h2Weight  = cv('--md-h2-weight')  || '600';
  var h3Size    = 'calc(' + (cv('--md-h3-size')    || '1.2em') + ' * ' + hScale + ')';
  var h3Color   = cv('--md-h3-color')   || hColor;
  var h3Weight  = cv('--md-h3-weight')  || '600';
  var h4Size    = 'calc(' + (cv('--md-h4-size')    || '1.0em') + ' * ' + hScale + ')';
  var h4Color   = cv('--md-h4-color')   || hColor;
  var h4Weight  = cv('--md-h4-weight')  || '600';

  var pColor    = cv('--md-p-color')     || '#3c3733';
  var pLH       = cv('--md-p-line-height')|| lineHeight;
  var pMargin   = cv('--md-p-margin')    || '0 0 1.1em';

  var linkColor = cv('--md-link-color')  || '#2563eb';
  var linkDec   = cv('--md-link-decoration') || 'underline';

  var codeBG    = cv('--md-code-bg')     || '#f4f1ed';
  var codeColor = cv('--md-code-color')  || '#6b21a8';
  var codeFont  = cv('--md-code-font')   || "'JetBrains Mono', monospace";
  var preBG     = cv('--md-pre-bg')      || codeBG;

  var bqBorder  = cv('--md-bq-border')   || '3px solid #2563eb';
  var bqColor   = cv('--md-bq-color')    || '#6b6560';
  var bqPad     = cv('--md-bq-padding')  || '0.5em 1em';
  var bqMargin  = cv('--md-bq-margin')   || '1.2em 0';

  return '\nbody {\n  font-family: ' + fontFamily + ';\n  font-size: ' + baseSize + ';\n  color: ' + color + ';\n  line-height: ' + lineHeight + ';\n  background-color: ' + bgColor + ';\n  max-width: 720px;\n  margin: 0 auto;\n  padding: 40px 48px 60px;\n  -webkit-font-smoothing: antialiased;\n}\nh1 { font-family: ' + hFontFamily + '; font-size: ' + h1Size + '; color: ' + h1Color + '; font-weight: ' + h1Weight + '; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 ' + hMB + '; }\nh2 { font-family: ' + hFontFamily + '; font-size: ' + h2Size + '; color: ' + h2Color + '; font-weight: ' + h2Weight + '; letter-spacing: -0.015em; line-height: 1.3; margin: 1.4em 0 ' + hMB + '; padding-bottom: 0.3em; border-bottom: 1px solid #ede8e2; }\nh3 { font-family: ' + hFontFamily + '; font-size: ' + h3Size + '; color: ' + h3Color + '; font-weight: ' + h3Weight + '; letter-spacing: -0.01em; line-height: 1.4; margin: 1.2em 0 ' + hMB + '; }\nh4 { font-family: ' + hFontFamily + '; font-size: ' + h4Size + '; color: ' + h4Color + '; font-weight: ' + h4Weight + '; line-height: 1.5; margin: 1em 0 ' + hMB + '; }\np  { color: ' + pColor + '; line-height: ' + pLH + '; margin: ' + pMargin + '; }\na  { color: ' + linkColor + '; text-decoration: ' + linkDec + '; text-underline-offset: 2px; }\ncode { background: ' + codeBG + '; color: ' + codeColor + '; padding: 0.15em 0.45em; border-radius: 4px; font-family: ' + codeFont + '; font-size: 0.85em; }\npre  { background: ' + preBG + '; padding: 1.1em 1.25em; border-radius: 8px; overflow-x: auto; margin: 1.2em 0; border: 1px solid #e7e2db; }\npre code { background: none; padding: 0; color: #3c3733; font-size: 0.88em; }\nblockquote { border-left: ' + bqBorder + '; color: ' + bqColor + '; padding: ' + bqPad + '; margin: ' + bqMargin + '; background: #f7f5f2; border-radius: 0 6px 6px 0; }\nblockquote p { margin: 0; color: inherit; }\nul, ol { padding-left: 1.6em; margin: 0.5em 0 1.1em; }\nli { margin-bottom: 0.3em; }\nhr { border: none; border-top: 1px solid #ede8e2; margin: 2em 0; }\ntable { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 0.92em; }\nth, td { border: 1px solid #e2ddd6; padding: 7px 12px; text-align: left; }\nth { background: #f4f1ed; font-weight: 600; }\ntr:nth-child(even) td { background: #fafaf8; }\nimg { max-width: 100%; border-radius: 8px; }\n';
}

function buildExportHTML() {
  var fontName = document.getElementById('ctrl-font-family').value.replace(/['"]/g,'').split(',')[0].trim();
  var fontLink = S.GOOGLE_FONTS.includes(fontName)
    ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fontName) + ':wght@400;500;600;700&display=swap">'
    : '';
  var title = (S.currentMeta.title || 'Document').replace(/</g,'&lt;');
  var clone = S.renderedEl.cloneNode(true);
  clone.querySelectorAll('.section-toggle').forEach(function(el) { el.remove(); });
  clone.querySelectorAll('.md-section-body').forEach(function(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  clone.querySelectorAll('.md-section').forEach(function(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>' + title + '</title>\n' + fontLink + '\n<style>' + buildExportCSS() + '</style>\n</head>\n<body>\n' +
    clone.innerHTML
      .replace(/<button class="copy-btn"[^]*?<\/button>/g, '')
      .replace(/<button class="header-copy-btn"[^]*?<\/button>/g, '')
      .replace(/<div class="pre-wrapper">([\s\S]*?)<\/div>/g, '$1')
      .replace(/<a class="header-anchor"[^]*?<\/a>/g, '') +
    '\n</body>\n</html>';
}

function exportPDF() {
  S.setStatus('Opening print dialog\u2026');
  var html = buildExportHTML();
  var win = window.open('', '_blank', 'width=900,height=700');
  win.document.open();
  win.document.write(html + '<script>\n    document.fonts.ready.then(() => {\n      window.focus();\n      window.print();\n    });\n  <\/script>');
  win.document.close();
  S.setStatus('PDF print dialog opened');
}

var htmlDocxLoaded = false;

function loadHtmlDocx() {
  return new Promise(function(resolve, reject) {
    if (htmlDocxLoaded) { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js';
    s.onload = function() { htmlDocxLoaded = true; resolve(); };
    s.onerror = function() { reject(new Error('Could not load html-docx-js')); };
    document.head.appendChild(s);
  });
}

async function exportWord() {
  S.setStatus('Generating Word document\u2026');
  try {
    await loadHtmlDocx();
    var html = buildExportHTML();
    var blob = window.htmlDocx.asBlob(html, {
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
