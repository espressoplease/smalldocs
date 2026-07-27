#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'public', 'index.html');
const outputPath = path.join(root, 'public', 'embed.html');

let html = fs.readFileSync(sourcePath, 'utf8');

html = html.replace('<html lang="en">', '<html lang="en" data-sdocs-embed>');
html = html.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' \'unsafe-inline\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'none\'; worker-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n' +
    '<meta name="referrer" content="no-referrer">'
);
html = html.replace(
  '<link rel="stylesheet" href="/public/css/mobile.css">',
  '<link rel="stylesheet" href="/public/css/mobile.css">\n' +
    '<link rel="stylesheet" href="/public/css/embed.css">'
);

const omittedScripts = [
  'sdocs-cli-setup.js',
  'sdocs-design-partner.js',
  'sdocs-connect.js',
  'sdocs-bridge.js',
  'sdocs-info.js',
  'sdocs-update.js',
  'sdocs-trust-footer.js',
];
for (const name of omittedScripts) {
  const line = new RegExp('^<script src="/public/' + name.replace('.', '\\.') + '"(?: defer)?></script>\\n?', 'm');
  html = html.replace(line, '');
}

html = html.replace(
  '<script src="/public/sdocs-source.js"></script>',
  '<script src="/public/sdocs-source.js"></script>\n' +
    '<script src="/public/sdocs-embed-source.js"></script>'
);

html = html.replace(/((?:href|src)="?)\/public\//g, '$1./');
html = html.replace(
  '<meta name="sdocs-default-md" content="__DEFAULT_MD_PATH__">',
  '<meta name="sdocs-default-md" content="./sdoc.md">'
);

fs.writeFileSync(outputPath, html);
console.log('Wrote ' + path.relative(root, outputPath));
