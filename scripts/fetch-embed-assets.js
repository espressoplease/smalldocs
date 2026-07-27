#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outputRoot = path.join(root, 'public', 'vendor', 'embed');

const assets = [
  ['mermaid/mermaid.min.js', 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js'],
  ['chart/chart.umd.min.js', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js'],
  ['chart/chartjs-plugin-datalabels.min.js', 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js'],
  ['katex/katex.min.js', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js'],
  ['katex/katex.min.css', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'],
  ['highlight/highlight.min.js', 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js'],
  ['export/pdf-lib.min.js', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'],
  ['export/fontkit.umd.min.js', 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'],
  ['export/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
  ['export/pptxgenjs.min.js', 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.min.js'],
  ['export/html-to-docx.browser.js', 'https://cdn.jsdelivr.net/npm/@turbodocx/html-to-docx@1/dist/html-to-docx.browser.js'],
  ['fonts/JetBrainsMono-Regular.ttf', 'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Regular.ttf'],
  ['fonts/NotoEmoji-Regular.ttf', 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.034/fonts/NotoEmoji-Regular.ttf'],
];

const licenses = [
  ['licenses/mermaid.txt', 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/LICENSE'],
  ['licenses/chart.js.txt', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/LICENSE.md'],
  ['licenses/chartjs-plugin-datalabels.txt', 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/LICENSE.md'],
  ['licenses/katex.txt', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/LICENSE'],
  ['licenses/highlight.js.txt', 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/LICENSE'],
  ['licenses/pdf-lib.txt', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/LICENSE.md'],
  ['licenses/fontkit.txt', 'https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/LICENSE.md'],
  ['licenses/jszip.txt', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/LICENSE.markdown'],
  ['licenses/pptxgenjs.txt', 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/LICENSE'],
  ['licenses/html-to-docx.txt', 'https://cdn.jsdelivr.net/npm/@turbodocx/html-to-docx@1/LICENSE'],
];

function fetchFile(relativePath, url) {
  const target = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync('curl', ['-fsSL', url, '-o', target], { stdio: 'inherit' });
  return target;
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const [relativePath, url] of assets.concat(licenses)) {
  fetchFile(relativePath, url);
}

const katexCss = fs.readFileSync(path.join(outputRoot, 'katex', 'katex.min.css'), 'utf8');
const katexFonts = new Set();
for (const match of katexCss.matchAll(/url\((?:"|')?fonts\/([^)'"?]+)(?:"|')?\)/g)) {
  katexFonts.add(match[1]);
}
for (const name of Array.from(katexFonts).sort()) {
  fetchFile(
    path.join('katex', 'fonts', name),
    'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/' + encodeURIComponent(name)
  );
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const bytes = fs.readFileSync(full);
      files.push({
        path: path.relative(outputRoot, full).split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
walk(outputRoot);
files.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(
  path.join(outputRoot, 'ASSETS.json'),
  JSON.stringify({ generatedBy: 'scripts/fetch-embed-assets.js', files }, null, 2) + '\n'
);
console.log('Wrote ' + files.length + ' pinned embed assets');
