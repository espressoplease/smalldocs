'use strict';
module.exports = function (h) {
  return async function () {
    const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
    const source = fs.readFileSync(path.join(__dirname, '../ops/deploy-production.sh'), 'utf8');
    const remote = source.split("<<'REMOTE'\n")[1].split('\nREMOTE')[0];
    for (const failure of ['', 'compiler', 'health']) await h.testAsync('production deployment ' + (failure ? failure + ' failure restores the old release and units' : 'promotes the staged release without overwriting it'), () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-deploy-test-'));
      try {
        const base = root + '/opt/smalldocs', units = root + '/etc/systemd/system', bin = root + '/bin';
        const commit = 'a'.repeat(40), previous = base + '/releases/' + 'b'.repeat(40), release = base + '/releases/' + commit;
        const unit = units + '/smalldocs.service', oldUnit = '[Unit]\nDescription=Previous release\n';
        for (const directory of [release + '/ops/systemd', release + '/.git', previous, units, bin]) fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(release + '/.git/HEAD', commit + '\n');
        fs.writeFileSync(release + '/immutable-marker', 'Staging is using this release.');
        for (const script of ['install-publication-browser.sh', 'install-production-monitor.sh', 'prune-releases.sh']) fs.writeFileSync(release + '/ops/' + script, '#!/bin/sh\nexit 0\n');
        for (const name of ['smalldocs.service', 'smalldocs-compiler.service']) fs.copyFileSync(path.join(__dirname, '../ops/systemd', name), release + '/ops/systemd/' + name);
        fs.writeFileSync(unit, oldUnit); fs.symlinkSync(previous, base + '/current');
        const shim = '#!' + process.execPath + '\n' + `
const fs=require('fs'),path=require('path'),cp=require('child_process');
let command=path.basename(process.argv[1]),args=process.argv.slice(2);
if(command==='sudo'){command=args.shift();}
const root=process.env.SDOCS_DEPLOY_TEST_ROOT,base=root+'/opt/smalldocs';
if(command==='systemctl'){
 fs.appendFileSync(root+'/events',JSON.stringify(args)+'\\n');
 if(args[0]==='restart'&&args[1]==='smalldocs-compiler'&&process.env.SDOCS_DEPLOY_TEST_FAIL==='compiler'&&fs.readlinkSync(base+'/current').endsWith('a'.repeat(40)))process.exit(1);
 process.exit(0);
}
if(command==='test'&&args[0]==='-S')process.exit(0);
if(command==='install'){fs.copyFileSync(args[args.length-2],args[args.length-1]);process.exit(0);}
if(['id','systemd-analyze','sleep','chown'].includes(command))process.exit(0);
if(command==='curl')process.exit(process.env.SDOCS_DEPLOY_TEST_FAIL==='health'&&fs.readlinkSync(base+'/current').endsWith('a'.repeat(40))?22:0);
if(command==='npm')throw new Error('An existing staged release must not be rebuilt');
if(command==='journalctl')process.exit(0);
const actual=cp.spawnSync(command,args,{stdio:'inherit'});if(actual.error)throw actual.error;process.exit(actual.status||0);
`;
        for (const name of ['sudo', 'systemctl', 'id', 'systemd-analyze', 'sleep', 'curl', 'npm']) fs.writeFileSync(bin + '/' + name, shim, { mode: 0o700 });
        let script = remote;
        for (const prefix of ['/opt/smalldocs', '/etc/systemd/system', '/run/smalldocs-compiler', '/var/cache/smalldocs-compiler']) script = script.split(prefix).join(root + prefix);
        const archive = root + '/release.tar.gz'; fs.writeFileSync(archive, 'Unused staged-release archive');
        const result = cp.spawnSync('/bin/sh', ['-s', '--', commit, archive], { input: script, encoding: 'utf8', timeout: 10000,
          env: { ...process.env, PATH: bin + ':' + process.env.PATH, SDOCS_DEPLOY_TEST_ROOT: root, SDOCS_DEPLOY_TEST_FAIL: failure } });
        if (result.error) throw result.error;
        h.assert.strictEqual(result.status, failure ? 1 : 0, result.stderr);
        h.assert.strictEqual(fs.realpathSync(base + '/current'), fs.realpathSync(failure ? previous : release));
        h.assert.strictEqual(fs.readFileSync(release + '/immutable-marker', 'utf8'), 'Staging is using this release.');
        const events = fs.readFileSync(root + '/events', 'utf8').trim().split('\n').map(JSON.parse);
        if (failure) {
          h.assert.strictEqual(fs.readFileSync(unit, 'utf8'), oldUnit);
          h.assert.strictEqual(fs.existsSync(units + '/smalldocs-compiler.service'), false);
          h.assert.ok(events.some(event => event[0] === 'disable' && event[2] === 'smalldocs-compiler'));
        } else {
          const compiler = events.findIndex(event => event[0] === 'restart' && event[1] === 'smalldocs-compiler');
          const app = events.findIndex(event => event[0] === 'restart' && event[1] === 'smalldocs');
          h.assert.ok(compiler >= 0 && app > compiler);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  };
};
