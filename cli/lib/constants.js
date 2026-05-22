// Shared constants used across the CLI lib.
//
// VERSION resolves to the CLI's own package version (cli/package.json),
// not the server's root package.json.

const path = require('path');
const os   = require('os');

exports.DEFAULT_URL       = 'https://sdocs.dev';
exports.VERSION           = require('../package.json').version;
exports.UPDATE_CACHE      = path.join(os.homedir(), '.sdocs', 'update-check.json');
exports.SETUP_CACHE       = path.join(os.homedir(), '.sdocs', 'setup.json');
exports.ONE_DAY           = 86400000;
exports.AGENT_CHANGES_URL = 'https://sdocs.dev/agent-changes';
exports.GITHUB_REPO_URL   = 'https://github.com/espressoplease/SDocs';
