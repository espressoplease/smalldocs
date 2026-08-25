#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const output = path.join(repo, 'sdk', 'browser', 'native', 'vendor');
const files = [
  ['public/sdocs-code-reader.js', 'sdocs-code-reader.js'],
  ['public/sdocs-code-focus.js', 'sdocs-code-focus.js'],
  ['public/css/code-reader.css', 'sdocs-code-reader.css'],
  ['public/sdocs-slide-reader.js', 'sdocs-slide-reader.js'],
  ['public/sdocs-present.js', 'sdocs-present.js'],
  ['public/sdocs-present-mobile.js', 'sdocs-present-mobile.js'],
  ['public/sdocs-zoom-math.js', 'sdocs-zoom-math.js'],
  ['public/sdocs-cells.js', 'sdocs-cells.js'],
  ['public/sdocs-cells-formula.js', 'sdocs-cells-formula.js'],
  ['public/sdocs-cells-xlsx.js', 'sdocs-cells-xlsx.js'],
  ['public/sdocs-cells-controller.js', 'sdocs-cells-controller.js'],
  ['public/sdocs-cells-select.js', 'sdocs-cells-select.js'],
  ['public/sdocs-cells-edit.js', 'sdocs-cells-edit.js'],
  ['public/sdocs-cells-focus.js', 'sdocs-cells-focus.js'],
  ['public/sdocs-cells-ui.js', 'sdocs-cells-ui.js'],
  ['public/css/cells.css', 'sdocs-cells.css', 'sdk-scoped-css'],
  ['public/fonts/inter-400.woff2', 'fonts/inter-400.woff2'],
  ['public/fonts/inter-500.woff2', 'fonts/inter-500.woff2'],
  ['public/fonts/inter-600.woff2', 'fonts/inter-600.woff2'],
  ['public/css/slide-reader.css', 'sdocs-slide-reader.css'],
];

fs.readdirSync(path.join(repo, 'public', 'sdocs-code-lang'))
  .filter((name) => name.endsWith('.js'))
  .sort()
  .forEach((name) => files.push([
    path.join('public', 'sdocs-code-lang', name),
    path.join('sdocs-code-lang', name),
  ]));

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function transformContents(contents, transform) {
  if (!transform) return contents;
  if (transform === 'sdk-scoped-css') {
    const css = contents.toString('utf8');
    const focusMarker = '/* Canonical spreadsheet fullscreen surface. */';
    const markerIndex = css.indexOf(focusMarker);
    const inline = (markerIndex < 0 ? css : css.slice(0, markerIndex))
      .replace(/body\.sdoc-cells-resizing/g, ':scope.sdoc-cells-resizing');
    const focus = markerIndex < 0 ? '' : css.slice(markerIndex)
      .replace(/body\.sdoc-cells-focus-open\s*\{[^}]*\}/g, '')
      .replace(/\.sdoc-cells-focus(?![-\w])/g,
        ':scope');
    return Buffer.from('@layer smalldocs {\n@scope (.smalldocs-sdk-view[data-smalldocs-sdk-version="0.2.0"]) {\n'
      + inline + '\n}\n@scope (.sdoc-cells-focus[data-smalldocs-sdk-version="0.2.0"]) {\n'
      + focus + '\n}\n}\n');
  }
  throw new Error('Unknown SDK snapshot transform: ' + transform);
}

function different(contents, target) {
  if (!fs.existsSync(target)) return true;
  return !contents.equals(fs.readFileSync(target));
}

const check = process.argv.includes('--check');
const changed = [];
const manifest = {};

files.forEach(([sourceName, targetName, transform]) => {
  const source = path.join(repo, sourceName);
  const target = path.join(output, targetName);
  const sourceContents = fs.readFileSync(source);
  const contents = transformContents(sourceContents, transform);
  manifest[targetName] = { source: sourceName, sha256: digest(contents) };
  if (transform) {
    manifest[targetName].sourceSha256 = digest(sourceContents);
    manifest[targetName].transform = transform;
  }
  if (!different(contents, target)) return;
  changed.push(targetName);
  if (check) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
});

const manifestPath = path.join(output, 'reader-manifest.json');
const manifestContents = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (!fs.existsSync(manifestPath) || !fs.readFileSync(manifestPath).equals(manifestContents)) {
  changed.push('reader-manifest.json');
  if (!check) fs.writeFileSync(manifestPath, manifestContents);
}

if (check && changed.length) {
  console.error('SDK reader snapshot is stale: ' + changed.join(', '));
  process.exit(1);
}

if (!check) console.log('SDK reader snapshot updated: ' + files.length + ' canonical files');
