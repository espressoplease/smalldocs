// Folder and process defaults select a library without changing machine state.
const fs = require('fs');
const path = require('path');

function failure(code, message, data) {
  return Object.assign(new Error(message), { code, data });
}

function selection(options = {}) {
  if (options.accountFlag) return { source: 'flag', value: options.accountFlag };
  const env = options.env || process.env;
  if (env.SDOCS_LIBRARY && env.SDOCS_LIBRARY.trim()) {
    return { source: 'environment', value: env.SDOCS_LIBRARY.trim() };
  }
  let directory = path.resolve(options.cwd || process.cwd());
  while (true) {
    const filename = path.join(directory, '.sdocs.json');
    let text;
    try { text = fs.readFileSync(filename, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw failure('invalid_request',
        'Could not read the library configuration: ' + filename, { config_file: filename });
    }
    if (text !== undefined) {
      let config;
      try { config = JSON.parse(text); } catch (_) {
        throw failure('invalid_request', 'Invalid JSON in ' + filename + '.', { config_file: filename });
      }
      if (!config || Array.isArray(config) || typeof config.library !== 'string' || !config.library.trim()) {
        throw failure('invalid_request', 'Set "library" to a library name or ID in ' + filename + '.', { config_file: filename });
      }
      return { source: 'folder', value: config.library.trim(), config_file: filename };
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return options.fallbackAccountId ? { source: 'installation_default', value: options.fallbackAccountId } : null;
}

async function resolve(client, selected) {
  if (!selected) return null;
  // Explicit IDs are still checked by the account API when used. Names are
  // resolved using only the libraries accessible to the signed-in person.
  if (selected.source === 'flag' || selected.source === 'installation_default') return selected.value;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.value)) return selected.value.toLowerCase();
  const response = await client.authenticated('/api/cloud/v1/library-settings');
  const libraries = response.libraries || [];
  let matches = libraries.filter(library => library.name === selected.value);
  if (!matches.length) {
    const normalized = selected.value.normalize('NFC').toLowerCase();
    matches = libraries.filter(library => library.name.normalize('NFC').toLowerCase() === normalized);
  }
  if (matches.length === 1) return matches[0].id;
  const detail = { library_selection: selected };
  if (matches.length > 1) {
    detail.accounts = matches.map(library => ({ id: library.id, name: library.name }));
    throw failure('account_selection_required', 'More than one accessible library is named "' + selected.value + '". Use its ID in ' +
      (selected.config_file || 'SDOCS_LIBRARY') + ' or pass --account ID.', detail);
  }
  throw failure('resource_unavailable', 'The configured library "' + selected.value + '" is unavailable on ' + client.origin +
    '. Run sdoc cloud libraries --json and update ' + (selected.config_file || 'SDOCS_LIBRARY') + ', or pass --account ID.', detail);
}

function receipt(selected, libraryId) {
  return { source: selected ? selected.source : 'account_default', library_id: libraryId,
    ...(selected ? { selector: selected.value } : {}),
    ...(selected && selected.config_file ? { config_file: selected.config_file } : {}) };
}

module.exports = { selection, resolve, receipt };
