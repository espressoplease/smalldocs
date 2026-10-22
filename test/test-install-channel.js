const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { installStagingCli } = require('../scripts/install-staging-cli');
const { readInstallationChannel } = require('../cli/lib/install-channel');

module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-channel-'));
    const home = path.join(root, 'home');
    const prefix = path.join(home, '.sdocs');
    fs.mkdirSync(home);
    const installation = installStagingCli({ destination: prefix });
    const bin = path.join(installation.installed, 'bin/sdocs-dev.js');
    const source = path.resolve(__dirname, '..');
    const origin = 'https://cloud-staging.smalldocs.org';
    const skillFile = path.join(home, '.agents/skills/smalldocs/SKILL.md');
    const setupFile = path.join(prefix, 'setup.json');
    const environment = { ...process.env, HOME: home, SDOCS_HOME: prefix,
      NO_UPDATE_NOTIFIER: '1', SDOCS_NO_SETUP: '1', SDOCS_NO_REFRESH: '1' };
    for (const name of ['SDOCS_URL', 'SDOCS_CLOUD_URL', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete environment[name];
    function run(args, overrides = {}) {
      const result = spawnSync(process.execPath, [bin, ...args], { env: { ...environment, ...overrides }, encoding: 'utf8', timeout: 10000 });
      if (result.error) throw result.error;
      return result;
    }
    function evaluate(code, overrides = {}) {
      const script = 'const root=' + JSON.stringify(installation.installed) + ';\n' + code;
      const result = spawnSync(process.execPath, ['-e', script], { env: { ...environment, ...overrides }, encoding: 'utf8', timeout: 10000 });
      if (result.error) throw result.error;
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    }
    try {
      await testAsync('unconfigured source installs retain production defaults and existing upgrade behavior', async () => {
        const result = spawnSync(process.execPath, ['-e', `const c=require('./cli/lib/constants');const u=require('./cli/lib/update-check');process.stdout.write(JSON.stringify({url:c.DEFAULT_URL,channel:c.INSTALLATION_CHANNEL,upgrade:u.upgradeCommand(),custom:c.resolveBaseUrl('http://localhost:3000')}));`],
          { cwd: source, env: environment, encoding: 'utf8' });
        const value = JSON.parse(result.stdout);
        assert.strictEqual(value.url, 'https://smalldocs.org');
        assert.strictEqual(value.channel, null);
        assert.strictEqual(value.upgrade, 'npm i -g sdocs-dev@latest');
        assert.strictEqual(value.custom, 'http://localhost:3000');
      });
      await testAsync('maintainer installer copies the current CLI with staging metadata and records its runtime fingerprint', async () => {
        assert.strictEqual(installation.version, '1.20.0-rc.6');
        assert.match(installation.source_sha256, /^[a-f0-9]{64}$/);
        assert.strictEqual(fs.realpathSync(path.join(prefix, 'bin/sdoc')), fs.realpathSync(bin));
        const channel = readInstallationChannel(installation.installed);
        assert.strictEqual(channel.channel, 'staging');
        assert.strictEqual(channel.origin, origin);
        assert.strictEqual(channel.update_policy, 'manual');
        assert.ok(channel.reinstall_command.includes('--sdocs-home'));
        assert.ok(!fs.existsSync(path.join(source, 'cli/channel.json')));
        const pkg = JSON.parse(fs.readFileSync(path.join(installation.installed, 'package.json'), 'utf8'));
        assert.strictEqual(pkg.dependencies, undefined);
      });
      await testAsync('new CLI processes use staging for browser links, Cloud origins and guide links without environment wrappers', async () => {
        const value = evaluate(`const c=require(root+'/lib/constants');const urls=require(root+'/lib/url');const cloud=require(root+'/lib/cloud-commands');process.stdout.write(JSON.stringify({default:c.DEFAULT_URL,cloud:cloud.origin(),url:urls.buildUrl('# Document',{}),changes:c.AGENT_CHANGES_URL}));`);
        assert.strictEqual(value.default, origin);
        assert.strictEqual(value.cloud, origin);
        assert.ok(value.url.startsWith(origin + '/#md='));
        assert.strictEqual(value.changes, origin + '/agent-changes');
        const help = run(['help']);
        assert.strictEqual(help.status, 0);
        assert.ok(help.stdout.includes(origin));
        assert.ok(!help.stdout.includes('https://smalldocs.org'));
        assert.ok(help.stdout.includes('Print staging manual-update instructions'));
        assert.ok(help.stdout.includes('Automatic binary updates are disabled'));
        assert.ok(help.stdout.includes('Must match the installed staging origin'));
        assert.ok(!help.stdout.includes('Upgrade sdoc to the latest version now'));
      });
      await testAsync('staging installations reject production browser and API overrides before using them', async () => {
        const value = evaluate(`const c=require(root+'/lib/constants');const Cloud=require(root+'/lib/cloud-commands').CloudClient;const checks=[];for(const attempt of [()=>c.resolveBaseUrl('https://smalldocs.org'),()=>c.resolveCloudOrigin('https://smalldocs.org'),()=>new Cloud({origin:'https://smalldocs.org'}),()=>c.resolveBaseUrl('https://cloud-staging.smalldocs.org.attacker.test')]){try{attempt();checks.push(false);}catch(error){checks.push(error.code==='invalid_request');}}process.stdout.write(JSON.stringify(checks));`);
        assert.deepStrictEqual(value, [true, true, true, true]);
        assert.strictEqual(evaluate(`const c=require(root+'/lib/constants');try{c.resolveBaseUrl();process.stdout.write('false');}catch(error){process.stdout.write(JSON.stringify(error.code==='invalid_request'));}`, { SDOCS_URL: 'https://smalldocs.org' }), true);
        assert.strictEqual(evaluate(`const c=require(root+'/lib/constants');try{c.resolveCloudOrigin();process.stdout.write('false');}catch(error){process.stdout.write(JSON.stringify(error.code==='invalid_request'));}`, { SDOCS_CLOUD_URL: 'https://smalldocs.org' }), true);
        const blocked = run(['cloud', 'status', '--json'], { SDOCS_CLOUD_URL: 'https://smalldocs.org' });
        assert.strictEqual(blocked.status, 2);
        assert.strictEqual(JSON.parse(blocked.stdout).error, 'invalid_request');
      });
      await testAsync('Cloud staging requests refuse redirects and skill guidance uses the installed setup command', async () => {
        const value = evaluate(`const cloud=require(root+'/lib/cloud-commands');let redirect;const client=new cloud.CloudClient({fetch:async(url,options)=>{redirect=options.redirect;return{json:async()=>({ok:true}),status:200};}});client.raw('/test',{redirect:'follow'}).then(()=>process.stdout.write(JSON.stringify({redirect,install:cloud.skillInstallCommand(client.origin,true),standard:cloud.skillInstallCommand(client.origin,false),guide:cloud.CLOUD_SEARCH_HELP})));`);
        assert.strictEqual(value.redirect, 'manual');
        assert.strictEqual(value.install, 'sdoc setup --cloud --yes');
        assert.strictEqual(value.standard, 'sdoc setup --standard --yes');
        assert.ok(value.guide.includes(origin + '/cloud-search'));
        assert.ok(!value.guide.includes('https://smalldocs.org'));
      });
      await testAsync('Cloud setup installs the current origin-bound skill and refresh preserves it', async () => {
        fs.mkdirSync(path.join(home, '.claude'));
        assert.strictEqual(run(['setup', '--cloud', '--yes']).status, 0);
        let text = fs.readFileSync(skillFile, 'utf8');
        assert.ok(text.includes('sdocs-skill: v=36'));
        assert.ok(text.includes('sdocs-skill-edition: cloud'));
        assert.ok(text.includes('sdocs-skill-origin: ' + origin));
        assert.ok(text.includes('Staging: ' + origin));
        assert.ok(!text.includes('https://smalldocs.org'));
        assert.ok(/^description: "([^\n]+)"$/m.exec(text)[1].length <= 1024);
        assert.strictEqual(fs.realpathSync(path.join(home, '.claude/skills/smalldocs/SKILL.md')), fs.realpathSync(skillFile));
        assert.strictEqual(run(['refresh']).status, 0);
        assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), text);
        assert.strictEqual(JSON.parse(fs.readFileSync(setupFile, 'utf8')).skillEdition, 'cloud');
      });
      await testAsync('refresh replaces a same-version production skill with the installed staging edition', async () => {
        const standardBuild = require('../cli/lib/agent-block');
        fs.writeFileSync(skillFile, standardBuild.formatSkill(standardBuild.SKILL_VERSION, { cloud: true }));
        assert.ok(fs.readFileSync(skillFile, 'utf8').includes('https://smalldocs.org'));
        assert.strictEqual(run(['refresh']).status, 0);
        const text = fs.readFileSync(skillFile, 'utf8');
        assert.ok(text.includes('sdocs-skill-origin: ' + origin));
        assert.ok(!text.includes('https://smalldocs.org'));
      });
      await testAsync('cached production versions and old auto-install preferences cannot trigger staging auto-updates', async () => {
        const state = JSON.parse(fs.readFileSync(setupFile, 'utf8'));
        fs.writeFileSync(setupFile, JSON.stringify({ ...state, autoInstallUpdates: true }));
        fs.writeFileSync(path.join(prefix, 'update-check.json'), JSON.stringify({ latest: '999.0.0' }));
        const value = evaluate(`let network=0,exec=0;require('https').get=()=>{network++;throw new Error('Unexpected npm request');};require('child_process').execSync=()=>{exec++;throw new Error('Unexpected upgrade');};const u=require(root+'/lib/update-check');u.refreshUpdateCache();u.maybeUpdateBinary().then(()=>process.stdout.write(JSON.stringify({network,exec,command:u.upgradeCommand(),auto:u.autoInstallAndReexec('999.0.0')})));`, { NO_UPDATE_NOTIFIER: '', CI: '' });
        assert.deepStrictEqual(value, { network: 0, exec: 0, command: null, auto: false });
      });
      await testAsync('explicit upgrade cannot install npm production even when notifier is disabled', async () => {
        const result = run(['upgrade'], { NO_UPDATE_NOTIFIER: '1', CI: '' });
        assert.strictEqual(result.status, 1);
        assert.ok(result.stderr.includes('manual updates'));
        assert.ok(result.stderr.includes('install-staging-cli.js'));
        assert.ok(result.stderr.includes(prefix));
        assert.ok(!result.stderr.includes('npm i -g'));
        assert.ok(!result.stderr.includes('curl -fsSL'));
        const auto = run(['auto-update', 'on']);
        assert.strictEqual(auto.status, 0);
        assert.strictEqual(JSON.parse(fs.readFileSync(setupFile, 'utf8')).autoInstallUpdates, false);
      });
      await testAsync('staging local bridge and library gates accept only the staging browser origin', async () => {
        const value = evaluate(`const b=require(root+'/bin/sdocs-bridge');const l=require(root+'/lib/library-server');process.stdout.write(JSON.stringify({bridge:b.isAllowedOrigin('${origin}'),prod:b.isAllowedOrigin('https://smalldocs.org'),extra:b.isAllowedOrigin('https://smalldocs.org',['https://smalldocs.org']),library:l.originAllowed('${origin}'),libraryProd:l.originAllowed('https://smalldocs.org')}));`);
        assert.deepStrictEqual(value, { bridge: true, prod: false, extra: false, library: true, libraryProd: false });
      });
      await testAsync('reinstall archives the previous runtime and preserves state and documents outside it', async () => {
        fs.writeFileSync(path.join(prefix, 'keep-document.md'), '# Keep this document\n');
        const previousState = fs.readFileSync(setupFile, 'utf8');
        const next = installStagingCli({ destination: prefix });
        assert.ok(fs.existsSync(next.backup));
        assert.strictEqual(fs.readFileSync(path.join(prefix, 'keep-document.md'), 'utf8'), '# Keep this document\n');
        assert.strictEqual(fs.readFileSync(setupFile, 'utf8'), previousState);
        assert.strictEqual(readInstallationChannel(next.installed).origin, origin);
        assert.strictEqual(run(['version']).stdout.trim(), '1.20.0-rc.6');
      });
      await testAsync('invalid installation metadata fails closed instead of choosing production', async () => {
        const file = path.join(installation.installed, 'channel.json');
        const original = fs.readFileSync(file, 'utf8');
        for (const content of ['{invalid', JSON.stringify({ schema_version: 1, channel: 'staging', origin: 'https://smalldocs.org', update_policy: 'manual' }), JSON.stringify({ schema_version: 1, channel: 'staging', origin, update_policy: 'npm' })]) {
          fs.writeFileSync(file, content);
          assert.throws(() => readInstallationChannel(installation.installed));
          const failed = run(['version']);
          assert.notStrictEqual(failed.status, 0);
        }
        fs.writeFileSync(file, original);
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
};
