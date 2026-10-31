const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STAGING_ORIGIN = 'https://cloud-staging.smalldocs.org';

function buildPackage(sourceRoot, output) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cli-package-'));
  try {
    const packageDir = path.join(temporary, 'package');
    fs.mkdirSync(packageDir);
    for (const name of ['bin', 'lib', 'shared', 'package.json']) {
      fs.cpSync(path.join(sourceRoot, 'cli', name), path.join(packageDir, name), { recursive: true });
    }
    fs.writeFileSync(path.join(packageDir, 'channel.json'), JSON.stringify({
      schema_version: 1, channel: 'staging', origin: STAGING_ORIGIN, update_policy: 'manual',
      reinstall_command: ['sh', '-c', 'curl -fsSL ' + STAGING_ORIGIN + '/install | sh'],
    }) + '\n');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync('tar', ['-czf', output, '-C', temporary, 'package']);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function installer(source, version) {
  return source
    .replace('SDOCS_TARBALL_URL="${SDOCS_TARBALL_URL:-}"',
      'SDOCS_TARBALL_URL="${SDOCS_TARBALL_URL:-' + STAGING_ORIGIN + '/cli/sdocs-dev.tgz}"')
    .replace('SDOCS_VERSION="${SDOCS_VERSION:-}"', 'SDOCS_VERSION="${SDOCS_VERSION:-' + version + '}"');
}

module.exports = { buildPackage, installer, STAGING_ORIGIN };
