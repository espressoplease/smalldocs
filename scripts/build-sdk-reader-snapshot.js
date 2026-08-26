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

function different(source, target) {
  if (!fs.existsSync(target)) return true;
  return !fs.readFileSync(source).equals(fs.readFileSync(target));
}

const check = process.argv.includes('--check');
const changed = [];
const manifest = {};

files.forEach(([sourceName, targetName]) => {
  const source = path.join(repo, sourceName);
  const target = path.join(output, targetName);
  const contents = fs.readFileSync(source);
  manifest[targetName] = { source: sourceName, sha256: digest(contents) };
  if (!different(source, target)) return;
  changed.push(targetName);
  if (check) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
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
