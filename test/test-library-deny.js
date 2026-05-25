// Path-pattern deny list + .sdocsignore behaviour for the library
// scanner. Uses a real temporary directory to drive the walk.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scanner = require('../cli/lib/library-scan');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

module.exports = function (h) {
  const { test, assert } = h;

  test('deniedByPattern: SSH keys are denied by basename', () => {
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/id_rsa'), true);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/id_rsa.pub'), true);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/id_ed25519'), true);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/server.ppk'), true);
  });

  test('deniedByPattern: env files', () => {
    assert.strictEqual(scanner.deniedByPattern('/proj/.env'), true);
    assert.strictEqual(scanner.deniedByPattern('/proj/.env.local'), true);
    assert.strictEqual(scanner.deniedByPattern('/proj/.env.production'), true);
  });

  test('deniedByPattern: crypto material extensions', () => {
    assert.strictEqual(scanner.deniedByPattern('/x/server.key'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/server.pem'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/cert.crt'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/store.kdbx'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/encrypted.gpg'), true);
  });

  test('deniedByPattern: credentials / secrets by name', () => {
    assert.strictEqual(scanner.deniedByPattern('/x/aws-credentials'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/credentials.json'), true);
    assert.strictEqual(scanner.deniedByPattern('/x/api_secret.json'), true);
  });

  test('deniedByPattern: blocks anything under a sensitive directory name', () => {
    assert.strictEqual(scanner.deniedByPattern('/Users/x/.ssh/notes.md'), true);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/.aws/config.md'), true);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/.gnupg/somefile.md'), true);
  });

  test('deniedByPattern: ordinary markdown is allowed', () => {
    assert.strictEqual(scanner.deniedByPattern('/Users/x/work/plan.md'), false);
    assert.strictEqual(scanner.deniedByPattern('/Users/x/Documents/notes/breakers.md'), false);
  });

  test('scan: deny list does NOT block notes-about-secrets (markdown is allowed)', () => {
    // Important property: a user's notes file called "secret.md" or
    // "credentials.md" is a legitimate document and must stay indexable.
    // The deny list only kicks in for config-shaped extensions.
    const root = tmpDir('sdocs-deny-md-ok-');
    write(path.join(root, 'good.md'), '# good');
    write(path.join(root, 'credentials.md'), '# notes about creds, NOT the creds');
    write(path.join(root, 'secret-santa.md'), '# notes');
    // These would-be-credentials non-md files should be skipped
    // (but only the .md filter ever runs on them today).
    write(path.join(root, 'credentials.json'), '{"key":"shouldnt index"}');
    const out = scanner.scan({ roots: [root] });
    const bases = out.map(f => path.basename(f.path)).sort();
    assert.deepStrictEqual(bases, ['credentials.md', 'good.md', 'secret-santa.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('parseSdocsignore: returns null when the file is absent', () => {
    const dir = tmpDir('sdocs-ignore-absent-');
    assert.strictEqual(scanner.parseSdocsignore(dir), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('parseSdocsignore: ignores blanks and comments', () => {
    const dir = tmpDir('sdocs-ignore-parse-');
    write(path.join(dir, '.sdocsignore'),
      '# top comment\n\n  drafts/\n*.tmp\n# another\nsubdir/notes.md\n');
    const patterns = scanner.parseSdocsignore(dir);
    assert.ok(patterns);
    assert.strictEqual(patterns.length, 3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('scan: .sdocsignore excludes a basename-pattern from its directory', () => {
    const root = tmpDir('sdocs-ignore-base-');
    write(path.join(root, 'keep.md'), '# keep');
    write(path.join(root, 'draft.md'), '# draft');
    write(path.join(root, '.sdocsignore'), 'draft.md\n');
    const out = scanner.scan({ roots: [root] });
    const bases = out.map(f => path.basename(f.path)).sort();
    assert.deepStrictEqual(bases, ['keep.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scan: .sdocsignore globs work for *.md', () => {
    const root = tmpDir('sdocs-ignore-glob-');
    write(path.join(root, 'keep.md'), '# k');
    write(path.join(root, 'a.tmp.md'), '# tmp1');
    write(path.join(root, 'b.tmp.md'), '# tmp2');
    write(path.join(root, '.sdocsignore'), '*.tmp.md\n');
    const out = scanner.scan({ roots: [root] });
    const bases = out.map(f => path.basename(f.path)).sort();
    assert.deepStrictEqual(bases, ['keep.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scan: .sdocsignore directory entry excludes the directory and its contents', () => {
    const root = tmpDir('sdocs-ignore-dir-');
    write(path.join(root, 'keep.md'), '# k');
    write(path.join(root, 'drafts', 'a.md'), '# a');
    write(path.join(root, 'drafts', 'b.md'), '# b');
    write(path.join(root, '.sdocsignore'), 'drafts/\n');
    const out = scanner.scan({ roots: [root] });
    const bases = out.map(f => path.basename(f.path)).sort();
    assert.deepStrictEqual(bases, ['keep.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scan: .sdocsignore patterns inherit into subdirectories', () => {
    const root = tmpDir('sdocs-ignore-inherit-');
    write(path.join(root, '.sdocsignore'), '*.local.md\n');
    write(path.join(root, 'a.md'), '# a');
    write(path.join(root, 'a.local.md'), '# private');
    write(path.join(root, 'sub', 'b.md'), '# b');
    write(path.join(root, 'sub', 'b.local.md'), '# private nested');
    const out = scanner.scan({ roots: [root] });
    const bases = out.map(f => path.basename(f.path)).sort();
    assert.deepStrictEqual(bases, ['a.md', 'b.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scan: anchored path-pattern in .sdocsignore (with /)', () => {
    const root = tmpDir('sdocs-ignore-anchored-');
    write(path.join(root, '.sdocsignore'), 'sub/secret.md\n');
    write(path.join(root, 'secret.md'), '# top-secret should NOT be ignored');
    write(path.join(root, 'sub', 'secret.md'), '# nested-secret SHOULD be ignored');
    const out = scanner.scan({ roots: [root] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(path.basename(out[0].path), 'secret.md');
    assert.strictEqual(path.dirname(out[0].path), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
};
