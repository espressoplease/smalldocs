#!/usr/bin/env node
'use strict';
// Refresh the optional browser speech runtime. There is no application build step.
// Run: node scripts/vendor-comment-speech.js
// Transformers.js 3.8.1, Apache-2.0. Model and WASM assets load only in comment mode.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-speech-vendor-'));
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    if (!response.ok) throw new Error('Could not download the speech runtime.');
    const source = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(source).digest('hex') !== 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa') throw new Error('Speech runtime checksum does not match.');
    const input = path.join(dir, 'transformers.js');
    fs.writeFileSync(input, source);
    execFileSync('npx', ['--yes', 'esbuild@0.25.12', input, '--bundle', '--format=iife', '--global-name=SDocsSpeechEngine',
      '--define:import.meta=SDocsSpeechImportMeta', '--minify', '--legal-comments=eof',
      '--outfile=' + path.join(__dirname, '../public/vendor/comment-speech/transformers.js')], { stdio: 'inherit' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
