#!/usr/bin/env node
// Walks public/ and emits a SHA-256 fingerprint list for every file it finds,
// in the same shape the server serves at /trust/manifest. Shared by server.js
// (in-memory at startup) and the GitHub Action (published to the repo).
//
// CLI:
//   node scripts/build-manifest.js [--commit <sha>] [--repo <url>] [--public <dir>]
// Prints JSON to stdout. Exit code 0 on success.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_REPO = 'https://github.com/espressoplease/SDocs';

// Returns { files: [{path, sha256, bytes}], buffers: Map<relPath, Buffer> }.
// buffers is only populated when keepBuffers is true (server.js uses it to also
// feed the app-version cache-busting hash without re-reading every file).
function walkPublic(publicRoot, { keepBuffers = false } = {}) {
  const files = [];
  const buffers = keepBuffers ? new Map() : null;

  (function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;         // .DS_Store, .gitkeep, etc.
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'fonts') continue;           // large, unchanging, irrelevant to code
        walk(full);
        continue;
      }
      const buf = fs.readFileSync(full);
      const rel = '/' + path.relative(publicRoot, full).split(path.sep).join('/');
      files.push({
        path: rel,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        bytes: buf.length,
      });
      if (buffers) buffers.set(rel, buf);
    }
  })(publicRoot);

  return { files, buffers };
}

function buildManifest({ publicRoot, commit, repo, builtAt }) {
  const { files } = walkPublic(publicRoot);
  return {
    commit: commit || 'unknown',
    builtAt: builtAt || new Date().toISOString(),
    repo: repo || DEFAULT_REPO,
    files,
  };
}

module.exports = { walkPublic, buildManifest };

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { publicRoot: path.join(__dirname, '..', 'public') };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--commit')      opts.commit = args[++i];
    else if (a === '--repo')   opts.repo = args[++i];
    else if (a === '--public') opts.publicRoot = path.resolve(args[++i]);
    else if (a === '--builtAt') opts.builtAt = args[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: build-manifest.js [--commit <sha>] [--repo <url>] [--public <dir>] [--builtAt <iso>]\n'
      );
      process.exit(0);
    }
  }
  const manifest = buildManifest(opts);
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
