module.exports = function (h) {
  return async function () {
    const { testAsync, assert } = h;
    const fs = require('fs'), os = require('os'), path = require('path');
    const { execFileSync } = require('child_process');
    const root = path.resolve(__dirname, '..');
    const { buildPackage, installer, STAGING_ORIGIN } = require('../lib/staging-cli-package');
    const setup = require('../public/sdocs-cli-setup');
    await testAsync('fresh hosted CLI install keeps staging origin, skills and updates isolated from production', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-hosted-install-'));
      try {
        const tarball = path.join(directory, 'sdocs-dev.tgz');
        buildPackage(root, tarball);
        const script = path.join(directory, 'install.sh');
        const source = installer(fs.readFileSync(path.join(root, 'install.sh'), 'utf8'), require('../cli/package.json').version);
        assert.ok(source.includes(STAGING_ORIGIN + '/cli/sdocs-dev.tgz'));
        fs.writeFileSync(script, source);
        const home = path.join(directory, 'user'); fs.mkdirSync(home);
        const state = path.join(home, '.sdocs');
        const env = { ...process.env, HOME: home, SDOCS_HOME: state, SHELL: '/bin/zsh',
          SDOCS_TARBALL_URL: 'file://' + tarball, SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1', SDOCS_NO_UPDATE_CHECK: '1' };
        execFileSync('sh', [script], { env, stdio: 'pipe' });
        const cli = path.join(state, 'bin', 'sdoc');
        const metadata = JSON.parse(fs.readFileSync(path.join(state, 'cli', 'channel.json')));
        assert.strictEqual(metadata.origin, STAGING_ORIGIN);
        assert.strictEqual(metadata.update_policy, 'manual');
        assert.ok(execFileSync(cli, ['--help'], { env, encoding: 'utf8' }).includes(STAGING_ORIGIN));
        execFileSync(cli, ['setup', '--cloud', '--yes'], { env, stdio: 'pipe' });
        const skill = fs.readFileSync(path.join(home, '.agents', 'skills', 'smalldocs', 'SKILL.md'), 'utf8');
        assert.ok(skill.includes(STAGING_ORIGIN));
        assert.ok(skill.includes('tags'));
        try { execFileSync(cli, ['upgrade'], { env, stdio: 'pipe' }); assert.fail('staging upgrade should remain manual'); }
        catch (error) { assert.strictEqual(error.status, 1); assert.ok((String(error.stdout) + String(error.stderr)).includes(STAGING_ORIGIN + '/install')); }
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    await testAsync('install instructions select the library after login and set PATH and origin before sdoc', async () => {
      for (const windows of [false, true]) {
        const instructions = setup.cloudInstructions({ origin: STAGING_ORIGIN, workspaceId: 'library-123', windows });
        assert.ok(instructions.commands.indexOf('SDOCS_CLOUD_URL=') < instructions.commands.indexOf('sdoc cloud login'));
        assert.ok(instructions.commands.indexOf('sdoc cloud login') < instructions.commands.indexOf('sdoc setup --cloud'));
        assert.ok(instructions.commands.includes('sdoc setup --cloud --account library-123 --yes'));
        assert.ok(instructions.commands.includes(STAGING_ORIGIN + (windows ? '/cli/sdocs-dev.tgz' : '/install')));
        if (!windows) assert.ok(instructions.commands.includes('export PATH="$HOME/.sdocs/bin:$PATH"'));
        assert.ok(instructions.prompt.includes('Replace the example tags'));
        assert.ok(instructions.prompt.includes('returned Cloud URL'));
      }
      assert.strictEqual(setup.installCommand(false), 'curl -fsSL https://smalldocs.org/install | sh');
    });
  };
};
