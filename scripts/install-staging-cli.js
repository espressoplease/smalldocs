#!/usr/bin/env node
// Install the current checked-out CLI runtime into an explicitly chosen prefix.
// This does not authenticate, change agent skills or modify shell startup files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function installStagingCli(options) {
  if (!options || !options.destination) throw new Error('Pass --sdocs-home DIRECTORY.');
  const destination = path.resolve(options.destination);
  const sourceRoot = options.sourceRoot || path.resolve(__dirname, '..');
  const source = path.join(sourceRoot, 'cli');
  if (destination === sourceRoot || destination === source || destination.startsWith(source + path.sep)) {
    throw new Error('Choose an installation directory outside the CLI source.');
  }
  const origin = 'https://cloud-staging.smalldocs.org';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(destination, '.cli-staging-'));
  let backup = null;
  try {
    for (const directory of ['bin', 'lib', 'shared']) {
      fs.cpSync(path.join(source, directory), path.join(temporary, directory), { recursive: true });
    }
    fs.copyFileSync(path.join(source, 'package.json'), path.join(temporary, 'package.json'));
    const hash = crypto.createHash('sha256');
    function fingerprint(directory, relative = '') {
      for (const name of fs.readdirSync(directory).sort()) {
        const filename = path.join(directory, name);
        const label = path.join(relative, name);
        if (fs.statSync(filename).isDirectory()) fingerprint(filename, label);
        else hash.update(label).update('\0').update(fs.readFileSync(filename)).update('\0');
      }
    }
    fingerprint(temporary);
    const metadata = {
      schema_version: 1, channel: 'staging', origin, update_policy: 'manual',
      source_sha256: hash.digest('hex'),
      reinstall_command: [process.execPath, path.join(sourceRoot, 'scripts/install-staging-cli.js'),
        '--sdocs-home', destination],
    };
    fs.writeFileSync(path.join(temporary, 'channel.json'), JSON.stringify(metadata, null, 2) + '\n');
    const installed = path.join(destination, 'cli');
    if (fs.existsSync(installed)) {
      backup = path.join(destination, 'cli.previous-' + stamp + '-' + crypto.randomBytes(3).toString('hex'));
      fs.renameSync(installed, backup);
    }
    try { fs.renameSync(temporary, installed); }
    catch (error) {
      if (backup && !fs.existsSync(installed)) fs.renameSync(backup, installed);
      throw error;
    }
    const bin = path.join(destination, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const name of ['sdoc', 'sdocs-dev']) {
      const link = path.join(bin, '.' + name + '.staging-' + process.pid);
      fs.symlinkSync('../cli/bin/sdocs-dev.js', link);
      try { fs.renameSync(link, path.join(bin, name)); }
      finally { fs.rmSync(link, { force: true }); }
    }
    return { installed, bin, backup, channel: metadata.channel, origin,
      version: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version,
      source_sha256: metadata.source_sha256 };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !['--sdocs-home', '--destination'].includes(args[0])) {
    console.error('Usage: node scripts/install-staging-cli.js --sdocs-home DIRECTORY');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(installStagingCli({ destination: args[1] }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { installStagingCli };
