#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startCompilerWorker } = require('../lib/publication-compiler');

(async () => {
  const socketPath = process.env.SDOCS_PUBLICATION_COMPILER_SOCKET;
  const origin = process.env.SDOCS_PUBLICATION_COMPILER_ORIGIN;
  if (!socketPath || !origin) throw new Error('Set SDOCS_PUBLICATION_COMPILER_SOCKET and SDOCS_PUBLICATION_COMPILER_ORIGIN.');
  let rendererVersion = process.env.SDOCS_PUBLICATION_RENDERER_VERSION;
  if (!rendererVersion) {
    try { rendererVersion = fs.readFileSync(path.join(__dirname, '../.git/HEAD'), 'utf8').trim(); }
    catch (_) { rendererVersion = require('../package.json').version; }
  }
  const worker = await startCompilerWorker({ socketPath, origin, rendererVersion,
    executablePath: process.env.SDOCS_PUBLICATION_BROWSER_EXECUTABLE,
    onError(error) { console.error('Publication compilation failed:', error.cause ? error.cause.message : error.message); },
  });
  console.log('Publication compiler ready.');
  let closing = false;
  async function close() { if (closing) return; closing = true; await worker.close(); }
  process.on('SIGTERM', close); process.on('SIGINT', close);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
