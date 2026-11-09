const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (harness) {
  const { assert, testAsync } = harness;
  return async function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-pull-safety-'));
    const oldHome = process.env.SDOCS_HOME;
    const oldMask = process.umask(0o022);
    process.env.SDOCS_HOME = path.join(directory, 'state');
    const { runCloudCommand } = require('../cli/lib/cloud-commands');
    const { parseArgs } = require('../cli/lib/io');
    const content = 'Private Cloud fixture content';
    const client = {
      origin: 'https://smalldocs.test', loadCredential: () => ({ user_id: 'fixture-user' }),
      authenticated: async () => ({ document: {
        id: 'fixture-document', current_revision_id: 'fixture-revision', revision_number: 1,
        markdown: content, tags: [], title: 'Fixture', filename: 'fixture.md',
        workspace_id: 'fixture-library', updated_at: new Date().toISOString(),
      } }),
    };
    async function pull(file) {
      const output = process.stdout.write;
      try {
        process.stdout.write = () => true;
        await runCloudCommand(parseArgs(['cloud', 'pull', 'fixture-document', '--output', file,
          '--force', '--no-bind', '--json']), { client });
      } finally { process.stdout.write = output; }
      assert.strictEqual(fs.readFileSync(file, 'utf8'), content);
    }
    try {
      await testAsync('Cloud pull preserves private file permissions and creates private new files', async () => {
        const existing = path.join(directory, 'existing.md');
        fs.writeFileSync(existing, 'Before', { mode: 0o600 });
        await pull(existing);
        const fresh = path.join(directory, 'new.md');
        await pull(fresh);
        if (process.platform !== 'win32') {
          assert.strictEqual(fs.statSync(existing).mode & 0o777, 0o600);
          assert.strictEqual(fs.statSync(fresh).mode & 0o777, 0o600);
        }
      });
      await testAsync('Cloud pull does not follow an existing predictable temporary-file symlink', async () => {
        if (process.platform === 'win32') return;
        const file = path.join(directory, 'symlink.md');
        const other = path.join(directory, 'unrelated.txt');
        fs.writeFileSync(other, 'Leave this file unchanged');
        fs.symlinkSync(other, file + '.sdocs-tmp-' + process.pid);
        await pull(file);
        assert.strictEqual(fs.lstatSync(file).isSymbolicLink(), false);
        assert.strictEqual(fs.readFileSync(other, 'utf8'), 'Leave this file unchanged');
      });
      await testAsync('Cloud pull retains intentionally shared permissions under a more restrictive umask', async () => {
        if (process.platform === 'win32') return;
        const file = path.join(directory, 'shared.md');
        fs.writeFileSync(file, 'Before');
        fs.chmodSync(file, 0o660);
        const mask = process.umask(0o077);
        try {
          await pull(file);
          assert.strictEqual(fs.statSync(file).mode & 0o777, 0o660);
        } finally { process.umask(mask); }
      });
      await testAsync('Cloud pull opens a fresh temporary file exclusively and removes it after a write failure', async () => {
        const file = path.join(directory, 'failure.md');
        fs.writeFileSync(file, 'Original file');
        const originalOpen = fs.openSync, originalWrite = fs.writeFileSync;
        const originalStdout = process.stdout.write, originalStderr = process.stderr.write;
        const originalExit = process.exitCode;
        let created;
        fs.openSync = function (name, flags, ...args) {
          if (String(name).includes('.sdocs-tmp-')) {
            assert.strictEqual(flags, 'wx');
            created = name;
          }
          return originalOpen.call(this, name, flags, ...args);
        };
        fs.writeFileSync = function (target, ...args) {
          if (typeof target === 'number') throw Object.assign(new Error('Fixture disk failure'), { code: 'ENOSPC' });
          return originalWrite.call(this, target, ...args);
        };
        try {
          process.stdout.write = process.stderr.write = () => true;
          await runCloudCommand(parseArgs(['cloud', 'pull', 'fixture-document', '--output', file,
            '--force', '--no-bind', '--json']), { client });
          assert(created);
          assert.strictEqual(fs.existsSync(created), false);
          assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Original file');
        } finally {
          fs.openSync = originalOpen; fs.writeFileSync = originalWrite;
          process.stdout.write = originalStdout; process.stderr.write = originalStderr;
          process.exitCode = originalExit;
        }
      });
    } finally {
      if (oldHome === undefined) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = oldHome;
      process.umask(oldMask);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
};
