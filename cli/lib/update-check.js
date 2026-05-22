// Daily npm version check + optional auto-install.
//
// refreshUpdateCache(): non-blocking GET of dist-tags from npm, written to
// ~/.sdocs/update-check.json. Runs at most once per day, never on CI.
//
// maybeUpdateBinary(): reads the cached `latest`, compares to VERSION, and:
//   - autoInstallUpdates=true: silent self-upgrade + re-exec.
//   - interactive TTY: Y/n prompt.
//   - non-TTY: one-line hint.

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

const { UPDATE_CACHE, VERSION, ONE_DAY, GITHUB_REPO_URL } = require('./constants');
const { readSetupState } = require('./agent-block');

function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function readCachedLatest() {
  try { return JSON.parse(fs.readFileSync(UPDATE_CACHE, 'utf-8')).latest; }
  catch (_) { return null; }
}

// Self-upgrade: runs npm i -g, then re-execs into the new binary.
// On any failure, falls through (so the user's actual command still runs).
function autoInstallAndReexec(latest) {
  console.log(`\nUpdating sdoc ${VERSION} → ${latest}...`);
  try {
    execSync('npm i -g sdocs-dev@latest', { stdio: 'pipe' });
  } catch (e) {
    console.error(`! sdoc auto-update to ${latest} failed: ${(e.stderr || e.message || '').toString().trim().split('\n')[0]}`);
    console.error(`  Run \`npm i -g sdocs-dev@latest\` manually to upgrade.`);
    return false;
  }
  console.log(`✓ sdoc updated ${VERSION} → ${latest}`);
  console.log(`  Diff: ${GITHUB_REPO_URL}/compare/v${VERSION}...v${latest}`);
  const r = spawnSync(process.argv0, process.argv.slice(1), { stdio: 'inherit' });
  process.exit(r.status == null ? 0 : r.status);
}

async function maybeUpdateBinary() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  const latest = readCachedLatest();
  if (!latest || !isNewer(latest, VERSION)) return;

  const state = readSetupState();
  const autoInstall = state && state.autoInstallUpdates === true;

  if (autoInstall) {
    autoInstallAndReexec(latest);
    return;
  }

  const isInteractive = process.stdout.isTTY && process.stdin.isTTY;
  if (!isInteractive) {
    console.log(`Update available: ${VERSION} → ${latest}. Run \`npm i -g sdocs-dev@latest\` to upgrade.`);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question(`\nUpdate available: ${VERSION} → ${latest}. Install now? [Y/n] `, a => {
      rl.close(); resolve(a.trim().toLowerCase());
    });
  });
  if (answer && answer !== 'y' && answer !== 'yes') return;

  console.log('Installing sdocs-dev@latest...');
  try {
    execSync('npm i -g sdocs-dev@latest', { stdio: 'inherit' });
    console.log(`✓ Updated to v${latest}`);
  } catch (_) {
    console.error('Update failed. You may need: sudo npm i -g sdocs-dev');
  }
}

// Daily refresh of the cached `latest` version from npm. Not gated on TTY:
// agents populate the cache too, so the update hint reaches them on next run.
function refreshUpdateCache() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  try {
    if (Date.now() - fs.statSync(UPDATE_CACHE).mtimeMs < ONE_DAY) return;
  } catch (_) {}

  https.get('https://registry.npmjs.org/-/package/sdocs-dev/dist-tags', { timeout: 3000 }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).latest;
        fs.mkdirSync(path.dirname(UPDATE_CACHE), { recursive: true });
        fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ latest }));
      } catch (_) {}
    });
  }).on('error', () => {}).on('timeout', function () { this.destroy(); });
}

module.exports = {
  isNewer,
  readCachedLatest,
  autoInstallAndReexec,
  maybeUpdateBinary,
  refreshUpdateCache,
};
