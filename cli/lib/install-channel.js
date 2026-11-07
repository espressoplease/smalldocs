// Optional installation metadata lives beside package.json in installed builds.
// Source checkouts and published standard packages do not contain this file.
const fs = require('fs');
const path = require('path');

const PRODUCTION_ORIGIN = 'https://smalldocs.org';

function readInstallationChannel(packageRoot) {
  const file = path.join(packageRoot || path.resolve(__dirname, '..'), 'channel.json');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('SmallDocs installation metadata is unreadable. Reinstall this CLI build.');
  }
  if (!value || value.schema_version !== 1 || value.channel !== 'staging' ||
      value.update_policy !== 'manual') {
    throw new Error('SmallDocs installation metadata is invalid. Reinstall this CLI build.');
  }
  let origin;
  try { origin = new URL(value.origin); } catch (_) {}
  if (!origin || origin.protocol !== 'https:' || origin.origin !== value.origin ||
      origin.username || origin.password || origin.origin === PRODUCTION_ORIGIN) {
    throw new Error('SmallDocs staging installation needs its own HTTPS origin.');
  }
  if (value.reinstall_command != null && (!Array.isArray(value.reinstall_command) ||
      !value.reinstall_command.length || !value.reinstall_command.every(arg =>
        typeof arg === 'string' && arg.length > 0 && !/[\x00-\x1f\x7f]/.test(arg)))) {
    throw new Error('SmallDocs staging reinstall command is invalid.');
  }
  return Object.freeze(value);
}

function resolveInstallationUrl(candidate, channel, fallback) {
  const value = candidate || channel && channel.origin || fallback || PRODUCTION_ORIGIN;
  if (!channel) return value;
  let parsed;
  try { parsed = new URL(value); } catch (_) {}
  if (!parsed || parsed.origin !== channel.origin || parsed.username || parsed.password) {
    const error = new Error('This staging installation uses ' + channel.origin +
      '. Remove a conflicting --url, SDOCS_URL or SDOCS_CLOUD_URL value.');
    error.code = 'invalid_request';
    throw error;
  }
  return channel.origin;
}

function manualUpdateInstructions(channel) {
  const lead = 'This staging CLI uses manual updates. Automatic and npm updates are disabled.';
  if (!channel || !channel.reinstall_command) {
    return lead + '\nInstall a new staging CLI build to update it.';
  }
  const command = channel.reinstall_command.map(arg => "'" + arg.replace(/'/g, "'\\''") + "'").join(' ');
  return lead + '\nInstall the current source build with:\n  ' + command;
}

module.exports = { PRODUCTION_ORIGIN, readInstallationChannel, resolveInstallationUrl, manualUpdateInstructions };
