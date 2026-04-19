#!/usr/bin/env node
// Fetches a running sdocs instance, asks it what commit it thinks it's running,
// pulls the authoritative fingerprint list for that commit from GitHub, then
// hashes every file it receives over HTTP and compares.
//
// Writes a JSON result to --out (or stdout):
//   { commit, commitShort, checkedAt, base, result, totalFiles, matched, mismatches }
//
// result is one of:
//   ok        — every file matched
//   mismatch  — at least one file's hash differed from GitHub's list
//   pending   — server reports a commit, but its manifest isn't on GitHub yet
//               (typical during the window between merge and publish-manifest finishing)
//   error     — network / protocol failure; details in .error
//
// Exit codes: 0 ok, 1 mismatch, 2 pending, 3 error. These are informational for
// local runs; the GitHub Action writes the result regardless of exit code.

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_BASE = 'https://sdocs.dev';
const DEFAULT_RAW  = 'https://raw.githubusercontent.com/espressoplease/SDocs/trust-manifests';
const DEFAULT_CONCURRENCY = 8;

function parseArgs(argv) {
  const opts = {
    base: DEFAULT_BASE,
    raw: DEFAULT_RAW,
    out: null,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base')            opts.base = argv[++i].replace(/\/$/, '');
    else if (a === '--raw')        opts.raw = argv[++i].replace(/\/$/, '');
    else if (a === '--out')        opts.out = argv[++i];
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10) || DEFAULT_CONCURRENCY;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: check-sdocs.js [--base <url>] [--raw <url>] [--out <path>] [--concurrency <n>]\n'
      );
      process.exit(0);
    }
  }
  return opts;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + ' for ' + url);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function hashRemote(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + ' for ' + url);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function check(opts) {
  const checkedAt = new Date().toISOString();

  // Step 1: ask the server what commit it thinks it's running. We only read
  // .commit from this; the file hashes inside it are NOT authoritative because
  // the server authors both the files and this list.
  let serverManifest;
  try {
    serverManifest = await fetchJson(opts.base + '/trust/manifest');
  } catch (e) {
    return {
      checkedAt, base: opts.base, result: 'error',
      error: 'Could not read /trust/manifest from server: ' + e.message,
    };
  }

  const commit = serverManifest.commit;
  if (!commit || commit === 'unknown') {
    return {
      checkedAt, base: opts.base, result: 'error',
      error: 'Server did not report a commit.',
    };
  }
  const commitShort = commit.slice(0, 7);

  // Step 2: fetch the authoritative hash list from GitHub for that commit.
  const manifestUrl = opts.raw + '/' + commit + '.json';
  let gh;
  try {
    gh = await fetchJson(manifestUrl);
  } catch (e) {
    if (e.status === 404) {
      return {
        checkedAt, base: opts.base, commit, commitShort, result: 'pending',
        error: 'No manifest published on GitHub for this commit yet.',
        manifestUrl,
      };
    }
    return {
      checkedAt, base: opts.base, commit, commitShort, result: 'error',
      error: 'Could not fetch GitHub manifest: ' + e.message,
      manifestUrl,
    };
  }

  if (!Array.isArray(gh.files) || gh.files.length === 0) {
    return {
      checkedAt, base: opts.base, commit, commitShort, result: 'error',
      error: 'GitHub manifest has no files array.',
      manifestUrl,
    };
  }

  // Step 3: hash each file from the server, compare to GitHub's list.
  const mismatches = [];
  await runPool(gh.files, opts.concurrency, async (file) => {
    const url = opts.base + '/public' + file.path;
    try {
      const got = await hashRemote(url);
      if (got.sha256 !== file.sha256) {
        mismatches.push({
          path: file.path, expected: file.sha256, got: got.sha256,
          expectedBytes: file.bytes, gotBytes: got.bytes,
        });
      }
    } catch (e) {
      mismatches.push({ path: file.path, error: e.message });
    }
  });

  return {
    checkedAt, base: opts.base, commit, commitShort,
    result: mismatches.length === 0 ? 'ok' : 'mismatch',
    totalFiles: gh.files.length,
    matched: gh.files.length - mismatches.length,
    mismatches,
    manifestUrl,
  };
}

module.exports = { check };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  check(opts).then((result) => {
    const json = JSON.stringify(result, null, 2) + '\n';
    if (opts.out) fs.writeFileSync(opts.out, json);
    else process.stdout.write(json);
    const code = result.result === 'ok' ? 0
              : result.result === 'mismatch' ? 1
              : result.result === 'pending' ? 2
              : 3;
    process.exit(code);
  }).catch((e) => {
    process.stderr.write('check-sdocs failed: ' + (e && e.stack || e) + '\n');
    process.exit(3);
  });
}
