// `sdoc safe` — verify the SDocs host is serving the bytes GitHub
// published for its claimed commit.
//
//   1. Ask the host (`/trust/manifest`) what commit it is running.
//   2. Fetch the authoritative fingerprint list for that commit from
//      raw.githubusercontent.com/.../trust-manifests/<sha>.json.
//   3. Download each file from the host, SHA-256 it, compare.
//
// Bytes come from the host. Fingerprints come from GitHub. The host
// cannot produce a match it did not already publish to GitHub.
//
// Server-side request handling still cannot be verified by hashing.
// `--audit` prints GitHub links to the files an auditor needs to read.

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

const { DEFAULT_URL } = require('./constants');

// Server-side files an auditor needs to read to review what `sdoc safe`
// cannot prove by hashing. Kept small on purpose.
const AUDIT_SOURCE_FILES = [
  'server.js',
  'short-links/db.js',
  'short-links/rate-limit.js',
  'analytics/db.js',
  'analytics/query.js',
];

const TRUST_RAW_BASE = 'https://raw.githubusercontent.com/espressoplease/SDocs/trust-manifests';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(u, { timeout: 8000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        res.resume();
        return;
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('invalid JSON from ' + url)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(u, { timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => { resolve(Buffer.concat(chunks)); });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function runSafe(opts) {
  const base = (opts.url || process.env.SDOCS_URL || DEFAULT_URL).replace(/\/$/, '');
  const jsonOut = !!opts.jsonFlag;
  const audit = !!opts.auditFlag;
  const rawBase = (opts.rawBase || process.env.SDOCS_TRUST_RAW || TRUST_RAW_BASE).replace(/\/$/, '');

  let serverReport;
  try {
    serverReport = await fetchJson(base + '/trust/manifest');
  } catch (e) {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'server_fetch_failed', message: e.message })); }
    else { console.error('sdoc safe: could not fetch ' + base + '/trust/manifest - ' + e.message); }
    process.exit(2);
  }
  const commit = serverReport.commit;
  if (!commit || commit === 'unknown') {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'no_commit_reported' })); }
    else { console.error('sdoc safe: host did not report a commit.'); }
    process.exit(2);
  }

  const manifestUrl = rawBase + '/' + commit + '.json';
  let manifest;
  try {
    manifest = await fetchJson(manifestUrl);
  } catch (e) {
    const pending = /HTTP 404/.test(e.message);
    if (jsonOut) {
      console.log(JSON.stringify({
        ok: false,
        error: pending ? 'manifest_not_yet_published' : 'manifest_fetch_failed',
        host: base, commit, manifestUrl, message: e.message,
      }));
    } else if (pending) {
      console.error('sdoc safe: no fingerprint list published on GitHub for commit ' + commit.slice(0, 7) + ' yet.');
      console.error('           (publish-manifest.yml runs on push to main; give it a minute.)');
      console.error('           looked for: ' + manifestUrl);
    } else {
      console.error('sdoc safe: could not fetch ' + manifestUrl + ' - ' + e.message);
    }
    process.exit(pending ? 2 : 3);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    if (jsonOut) { console.log(JSON.stringify({ ok: false, error: 'manifest_has_no_files', manifestUrl })); }
    else { console.error('sdoc safe: GitHub manifest at ' + manifestUrl + ' has no files array.'); }
    process.exit(3);
  }

  const results = [];
  let ok = 0, fail = 0;
  for (const file of manifest.files) {
    const fileUrl = base + '/public' + file.path;
    try {
      const buf = await fetchBuffer(fileUrl);
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      const match = got === file.sha256;
      results.push({ path: file.path, bytes: file.bytes, expected: file.sha256, got, match });
      if (match) ok++; else fail++;
    } catch (e) {
      results.push({ path: file.path, bytes: file.bytes, expected: file.sha256, error: e.message, match: false });
      fail++;
    }
  }

  const repo = manifest.repo || 'https://github.com/espressoplease/SDocs';
  const auditLinks = audit ? AUDIT_SOURCE_FILES.map(f => ({
    file: f,
    url: repo + '/blob/' + commit + '/' + f,
  })) : null;

  if (jsonOut) {
    console.log(JSON.stringify({
      ok: fail === 0,
      host: base,
      commit,
      builtAt: manifest.builtAt,
      manifestUrl,
      totals: { ok, fail, total: results.length },
      files: results,
      audit: auditLinks,
      unverified: {
        note: 'Server-side code (request handling, storage) cannot be verified by hashing. Read the source files listed under audit to review what a malicious operator could theoretically modify.',
        files: AUDIT_SOURCE_FILES,
      },
    }, null, 2));
  } else {
    console.log('');
    console.log('  sdoc safe - verifying ' + base);
    console.log('  commit    ' + commit);
    console.log('  built at  ' + (manifest.builtAt || '?'));
    console.log('  tree      ' + repo + '/tree/' + commit);
    console.log('  list      ' + manifestUrl);
    console.log('');
    for (const r of results) {
      const glyph = r.match ? '✓' : '✗';
      const line = '  ' + glyph + ' ' + r.path.padEnd(32) + ' ' + (r.match ? 'match' : (r.error || 'MISMATCH'));
      console.log(line);
    }
    console.log('');
    if (fail === 0) {
      console.log('  ✓ ' + ok + ' / ' + results.length + ' files match the list GitHub published for this commit.');
      console.log('    Bytes came from this host; fingerprints came from GitHub.');
    } else {
      console.log('  ✗ ' + fail + ' / ' + results.length + ' files FAILED to match GitHub\'s list for this commit.');
      console.log('    The host is serving different bytes than GitHub published for ' + commit.slice(0, 7) + '.');
    }
    console.log('');
    console.log('  What this does not prove:');
    console.log('    Server-side request handling cannot be verified by hashing alone.');
    console.log('    The only way to audit it is to read the source. Start here:');
    console.log('');
    for (const f of AUDIT_SOURCE_FILES) {
      console.log('    ' + repo + '/blob/' + commit + '/' + f);
    }
    console.log('');
    if (!audit) {
      console.log('  Re-run with --audit for machine-readable audit pointers, or --json for full output.');
      console.log('');
    }
  }

  process.exit(fail === 0 ? 0 : 1);
}

module.exports = {
  AUDIT_SOURCE_FILES,
  TRUST_RAW_BASE,
  fetchJson,
  fetchBuffer,
  runSafe,
};
