/**
 * Install-method detection tests.
 *
 * isUrlInstall(moduleDir) decides whether sdoc was installed by the curl
 * script (under $SDOCS_HOME/cli) or by npm. upgradeCommand() branches on it.
 * The detection realpath-resolves both sides, so a symlinked home must not
 * fool it - that is the regression these tests guard.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const updateCheck = require('../cli/lib/update-check');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Install-method Detection Tests ──────────────\n');

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdoc-install-'));
  const savedHome = process.env.SDOCS_HOME;

  // A genuine URL install: $SDOCS_HOME/cli/{bin,lib}.
  const urlHome = path.join(base, 'sdocs-home');
  const urlCliLib = path.join(urlHome, 'cli', 'lib');
  fs.mkdirSync(urlCliLib, { recursive: true });
  fs.mkdirSync(path.join(urlHome, 'cli', 'bin'), { recursive: true });

  // An npm-global install: lib lives under npm's prefix, not ~/.sdocs.
  const npmLib = path.join(base, 'npm-prefix', 'lib', 'node_modules', 'sdocs-dev', 'lib');
  fs.mkdirSync(npmLib, { recursive: true });

  test('isUrlInstall: true when the module sits under $SDOCS_HOME/cli', () => {
    process.env.SDOCS_HOME = urlHome;
    assert.strictEqual(updateCheck.isUrlInstall(urlCliLib), true);
    delete process.env.SDOCS_HOME;
  });

  test('isUrlInstall: false for an npm-prefix install', () => {
    process.env.SDOCS_HOME = urlHome;
    assert.strictEqual(updateCheck.isUrlInstall(npmLib), false);
    delete process.env.SDOCS_HOME;
  });

  test('isUrlInstall: false when $SDOCS_HOME/cli does not exist', () => {
    process.env.SDOCS_HOME = path.join(base, 'nonexistent');
    assert.strictEqual(updateCheck.isUrlInstall(urlCliLib), false);
    delete process.env.SDOCS_HOME;
  });

  test('isUrlInstall: a symlinked home path still resolves to true', () => {
    // realhome holds the actual install; linkhome is a symlink to it. Pointing
    // SDOCS_HOME through the symlink must not break detection - a raw
    // startsWith() would miss because __dirname is already realpath-resolved.
    const realHome = path.join(base, 'realhome');
    const realCliLib = path.join(realHome, 'cli', 'lib');
    fs.mkdirSync(realCliLib, { recursive: true });
    const linkHome = path.join(base, 'linkhome');
    try {
      fs.symlinkSync(realHome, linkHome, 'dir');
    } catch (_) {
      return; // platform without symlink support; skip
    }
    process.env.SDOCS_HOME = linkHome;
    // The module is discovered at its real (resolved) location.
    assert.strictEqual(updateCheck.isUrlInstall(realCliLib), true);
    delete process.env.SDOCS_HOME;
  });

  test('upgradeCommand: returns one of the two valid forms', () => {
    delete process.env.SDOCS_HOME;
    const cmd = updateCheck.upgradeCommand();
    assert.ok(
      cmd === 'npm i -g sdocs-dev@latest' || /^curl -fsSL \S+ \| sh$/.test(cmd),
      'unexpected upgrade command: ' + cmd
    );
  });

  // checkoutRoot() is what stops an upgrade from overwriting a working tree.
  // Layout: <repo>/.git + <repo>/cli/{bin,lib}, which is this repo's shape.
  const repo = path.join(base, 'repo');
  const repoCliLib = path.join(repo, 'cli', 'lib');
  fs.mkdirSync(repoCliLib, { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'));

  test('checkoutRoot: finds the repo above the package root', () => {
    assert.strictEqual(updateCheck.checkoutRoot(repoCliLib), fs.realpathSync(repo));
  });

  test('checkoutRoot: a worktree/submodule .git file counts', () => {
    const wt = path.join(base, 'worktree');
    fs.mkdirSync(path.join(wt, 'cli', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    assert.strictEqual(updateCheck.checkoutRoot(path.join(wt, 'cli', 'lib')), fs.realpathSync(wt));
  });

  test('checkoutRoot: null for an installed payload with no .git above it', () => {
    assert.strictEqual(updateCheck.checkoutRoot(npmLib), null);
    assert.strictEqual(updateCheck.checkoutRoot(urlCliLib), null);
  });

  test('checkoutRoot: an install path symlinked onto a checkout is a checkout', () => {
    // How a dev copy is usually wired in: ~/.sdocs/cli -> <repo>/cli. Judged by
    // where the code really lives, or install.sh would replace the symlink.
    const linkHome = path.join(base, 'linked-home');
    fs.mkdirSync(linkHome);
    try {
      fs.symlinkSync(path.join(repo, 'cli'), path.join(linkHome, 'cli'), 'dir');
    } catch (_) {
      return; // platform without symlink support; skip
    }
    assert.strictEqual(updateCheck.checkoutRoot(path.join(linkHome, 'cli', 'lib')), fs.realpathSync(repo));
  });

  test('checkoutRoot: null when the package root does not exist', () => {
    assert.strictEqual(updateCheck.checkoutRoot(path.join(base, 'gone', 'lib')), null);
  });

  // Restore env and clean up the sandbox.
  if (savedHome === undefined) delete process.env.SDOCS_HOME;
  else process.env.SDOCS_HOME = savedHome;
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
};
