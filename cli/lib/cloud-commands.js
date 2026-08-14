const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const constants = require('./constants');
const io = require('./io');
const credentialStore = require('./cloud-credentials');
const bindings = require('./cloud-bindings');

const EXIT = { unexpected: 1, invalid_request: 2, login_required: 3,
  resource_unavailable: 4, permission_denied: 4, revision_conflict: 5,
  unsafe_local_state: 6, base_revision_unavailable: 6, rate_limited: 7,
  temporary_service_failure: 7 };

const CLOUD_HELP = `SmallDocs Cloud

  sdoc cloud login [--no-open]
  sdoc cloud logout
  sdoc cloud status
  sdoc cloud projects
  sdoc cloud tags [--project UUID]
  sdoc cloud ls [--project UUID] [--tag TAG] [--limit N]
  sdoc cloud search QUERY [--project UUID] [--tag TAG] [--limit N]
  sdoc cloud create PATH --project UUID
  sdoc cloud pull DOCUMENT_UUID [--revision UUID] --output PATH [--no-bind]
  sdoc cloud push PATH

Add --json to any command for one machine-readable JSON object on stdout.`;

class CloudCommandError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.code = code;
    if (detail) { this.data = detail; Object.assign(this, detail); }
  }
}

function origin() {
  return String(process.env.SDOCS_CLOUD_URL || constants.DEFAULT_URL).replace(/\/$/, '');
}

class CloudClient {
  constructor(options) {
    options = options || {};
    this.origin = options.origin || origin();
    this.credentials = options.credentials || credentialStore;
    this.fetch = options.fetch || global.fetch;
  }

  loadCredential() { return this.credentials.load(this.origin); }
  saveCredential(value) { this.credentials.save(this.origin, value); }

  async raw(endpoint, options) {
    const response = await this.fetch(this.origin + endpoint, options || {});
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async refresh(credential) {
    const result = await this.raw('/api/cloud/v1/cli/token/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: credential.refresh_token }),
    });
    if (!result.response.ok) {
      this.credentials.remove(this.origin);
      throw new CloudCommandError('login_required', 'Cloud login has expired or was revoked.');
    }
    const next = { credential_id: result.data.credential_id, user_id: result.data.user_id,
      access_token: result.data.access_token, access_token_expires_at: result.data.access_token_expires_at,
      refresh_token: result.data.refresh_token };
    this.saveCredential(next);
    return next;
  }

  async authenticated(endpoint, options, retry) {
    let credential = this.loadCredential();
    if (!credential) throw new CloudCommandError('login_required', 'Run `sdoc cloud login`.');
    if (Date.parse(credential.access_token_expires_at || 0) <= Date.now() + 30000) {
      credential = await this.refresh(credential);
    }
    const headers = Object.assign({}, options && options.headers,
      { Authorization: 'Bearer ' + credential.access_token });
    const result = await this.raw(endpoint, Object.assign({}, options, { headers }));
    if (result.response.status === 401 && retry !== false) {
      credential = await this.refresh(credential);
      return this.authenticated(endpoint, options, false);
    }
    if (!result.response.ok) {
      throw new CloudCommandError(result.data.error || 'temporary_service_failure',
        result.data.message, result.data);
    }
    return result.data;
  }
}

function emit(opts, command, value, human) {
  if (opts.jsonFlag) process.stdout.write(JSON.stringify(Object.assign({ ok: true, command }, value)) + '\n');
  else process.stdout.write((human || JSON.stringify(value, null, 2)) + '\n');
}

function fail(opts, command, error) {
  const code = error.code || 'unexpected';
  const body = Object.assign({ ok: false, command, error: code, message: error.message || code },
    error.data || {});
  if (opts.jsonFlag) process.stdout.write(JSON.stringify(body) + '\n');
  else process.stderr.write('sdoc cloud: ' + body.message + '\n');
  process.exitCode = EXIT[code] || 1;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function login(opts, client) {
  if (client.loadCredential()) {
    try {
      const me = await client.authenticated('/api/cloud/v1/me');
      return emit(opts, 'cloud.login', { user: me.user, already_logged_in: true },
        'Already signed in as ' + (me.user.email || me.user.id) + '.');
    } catch (_) {}
  }
  const issued = await client.raw('/api/cloud/v1/cli/device-authorizations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: os.hostname() || 'SmallDocs CLI' }),
  });
  if (!issued.response.ok) throw new CloudCommandError(issued.data.error || 'temporary_service_failure');
  process.stderr.write('Authorize this CLI at:\n' + issued.data.verification_uri_complete + '\nCode: ' + issued.data.user_code + '\n');
  if (!opts.noOpenFlag) io.openBrowser(issued.data.verification_uri_complete,
    (message) => process.stderr.write(message + '\n'));
  const deadline = Date.now() + issued.data.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.max(1, issued.data.interval || 2) * 1000);
    const polled = await client.raw('/api/cloud/v1/cli/device-authorizations/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: issued.data.device_code }),
    });
    if (polled.response.status === 428 && polled.data.error === 'authorization_pending') continue;
    if (!polled.response.ok) throw new CloudCommandError('login_required', polled.data.error);
    const credential = { credential_id: polled.data.credential_id, user_id: polled.data.user_id,
      access_token: polled.data.access_token, access_token_expires_at: polled.data.access_token_expires_at,
      refresh_token: polled.data.refresh_token };
    client.saveCredential(credential);
    return emit(opts, 'cloud.login', { user_id: credential.user_id,
      credential_id: credential.credential_id }, 'Cloud login saved for this machine.');
  }
  throw new CloudCommandError('login_required', 'Authorization expired before it was approved.');
}

async function logout(opts, client) {
  const credential = client.loadCredential();
  if (credential) {
    try { await client.authenticated('/api/cloud/v1/cli/credentials/' + encodeURIComponent(credential.credential_id),
      { method: 'DELETE' }); } catch (_) {}
    client.credentials.remove(client.origin);
  }
  emit(opts, 'cloud.logout', { logged_out: true }, 'Signed out of SmallDocs Cloud.');
}

async function projects(opts, client) {
  const workspaces = await client.authenticated('/api/cloud/v1/workspaces');
  const values = [];
  for (const workspace of workspaces.workspaces) {
    const response = await client.authenticated('/api/cloud/v1/projects?workspace_id=' + encodeURIComponent(workspace.id));
    response.projects.forEach((project) => values.push({ id: project.id, name: project.name,
      workspace: { id: workspace.id, name: workspace.name }, role: project.role }));
  }
  emit(opts, 'cloud.projects', { projects: values }, values.map((project) =>
    project.id + '  ' + project.workspace.name + ' / ' + project.name + '  ' + project.role).join('\n') || 'No projects.');
}

function filterTags(documents, tags) {
  const wanted = (tags || []).map((tag) => String(tag).toLowerCase());
  return documents.filter((document) => wanted.every((tag) => (document.tags || []).includes(tag)));
}

async function list(opts, client) {
  const query = opts.projectFlag ? '?project_id=' + encodeURIComponent(opts.projectFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/documents' + query);
  const documents = filterTags(response.documents || [], opts.tagFilters).slice(0, opts.limitFlag || 50);
  emit(opts, 'cloud.ls', { documents, next_cursor: null }, documents.map((document) =>
    document.id + '  ' + document.title + '  [' + (document.tags || []).join(', ') + ']').join('\n') || 'No Cloud documents.');
}

async function tags(opts, client) {
  const query = opts.projectFlag ? '?project_id=' + encodeURIComponent(opts.projectFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/tags' + query);
  const values = (response.tags || []).map((item) => ({ tag: item.tag, document_count: item.count }));
  emit(opts, 'cloud.tags', { tags: values }, values.map((item) => item.tag + ' - ' + item.document_count).join('\n') || 'No Cloud tags.');
}

async function search(opts, client) {
  if (!opts.extra) throw new CloudCommandError('invalid_request', 'usage: sdoc cloud search QUERY');
  const response = await client.authenticated('/api/cloud/v1/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: opts.extra, project_id: opts.projectFlag, limit: opts.limitFlag || 50 }),
  });
  const documents = filterTags(response.documents || [], opts.tagFilters);
  emit(opts, 'cloud.search', { documents, next_cursor: null }, documents.map((document) =>
    document.id + '  ' + document.title + '\n  ' + ((document.matches && document.matches[0] && document.matches[0].snippet) || '')).join('\n') || 'No matches.');
}

function requireFile(file) {
  if (!file) throw new CloudCommandError('invalid_request', 'a Markdown file path is required');
  const absolute = bindings.canonical(file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new CloudCommandError('invalid_request', 'file not found: ' + file);
  }
  return absolute;
}

async function create(opts, client) {
  const file = requireFile(opts.extra);
  if (!opts.projectFlag) throw new CloudCommandError('invalid_request', '--project UUID is required');
  const content = fs.readFileSync(file, 'utf8');
  const digest = bindings.hash(content);
  const credential = client.loadCredential();
  let pending = bindings.getPending(credential.user_id, file);
  if (!pending || pending.operation !== 'create' || pending.project_id !== opts.projectFlag || pending.sha256 !== digest) {
    pending = { operation: 'create', project_id: opts.projectFlag, sha256: digest,
      idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  const response = await client.authenticated('/api/cloud/v1/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: opts.projectFlag, filename: path.basename(file), markdown: content,
      idempotency_key: pending.idempotency_key }),
  });
  const document = response.document;
  bindings.set(credential.user_id, file, { document_id: document.id,
    revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
  bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, content);
  bindings.clearPending(credential.user_id, file);
  const localChanged = bindings.hash(fs.readFileSync(file)) !== digest;
  emit(opts, 'cloud.create', { document_id: document.id, revision_id: document.current_revision_id,
    revision_number: document.revision_number, project_id: opts.projectFlag, path: file,
    tags: document.tags, sha256: digest, binding_created: true,
    local_changed_after_upload: localChanged }, 'Created ' + document.id + (localChanged ? '; the local file changed again during upload.' : '.'));
}

function atomicFileWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.sdocs-tmp-' + process.pid;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

async function pull(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.outputPath) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud pull DOCUMENT_UUID --output PATH');
  const output = bindings.canonical(opts.outputPath);
  const credential = client.loadCredential();
  const existingBinding = bindings.get(credential.user_id, output);
  if (fs.existsSync(output) && !existingBinding && !opts.forceFlag) {
    throw new CloudCommandError('unsafe_local_state', 'output exists and is not bound; use --force to replace it');
  }
  if (fs.existsSync(output) && existingBinding && !opts.forceFlag) {
    const currentHash = bindings.hash(fs.readFileSync(output));
    if (currentHash !== existingBinding.content_sha256) {
      throw new CloudCommandError('unsafe_local_state', 'the bound file has local changes; use --force to replace it');
    }
  }
  const endpoint = '/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + (opts.revisionFlag ? '/revisions/' + encodeURIComponent(opts.revisionFlag) : '');
  const response = await client.authenticated(endpoint);
  const document = response.document;
  atomicFileWrite(output, document.markdown);
  const digest = bindings.hash(document.markdown);
  if (!opts.noBindFlag) {
    bindings.set(credential.user_id, output, { document_id: document.id,
      revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
    bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, document.markdown);
  }
  emit(opts, 'cloud.pull', { document_id: document.id, revision_id: document.current_revision_id,
    revision_number: document.revision_number, path: output, tags: document.tags,
    sha256: digest, binding_created: !opts.noBindFlag }, 'Pulled ' + document.id + ' to ' + output + '.');
}

async function push(opts, client) {
  const file = requireFile(opts.extra);
  const credential = client.loadCredential();
  let binding = bindings.get(credential.user_id, file);
  if (!binding) {
    if (!opts.documentFlag || !opts.baseRevisionFlag) throw new CloudCommandError('unsafe_local_state',
      'file is not bound; provide both --document and --base-revision');
    binding = { document_id: opts.documentFlag, revision_id: opts.baseRevisionFlag };
  }
  const content = fs.readFileSync(file, 'utf8');
  const digest = bindings.hash(content);
  if (binding.content_sha256 === digest) {
    return emit(opts, 'cloud.push', { document_id: binding.document_id,
      base_revision_id: binding.revision_id, revision_id: binding.revision_id,
      sha256: digest, no_change: true }, 'No changes to push.');
  }
  let pending = bindings.getPending(credential.user_id, file);
  if (!pending || pending.document_id !== binding.document_id || pending.base_revision_id !== binding.revision_id || pending.sha256 !== digest) {
    pending = { document_id: binding.document_id, base_revision_id: binding.revision_id,
      sha256: digest, idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(binding.document_id) + '/revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_head_revision_id: binding.revision_id,
      filename: path.basename(file), markdown: content, idempotency_key: pending.idempotency_key }),
  });
  const document = response.document;
  bindings.set(credential.user_id, file, { document_id: document.id,
    revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
  bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, content);
  bindings.clearPending(credential.user_id, file);
  const localChanged = bindings.hash(fs.readFileSync(file)) !== digest;
  emit(opts, 'cloud.push', { document_id: document.id, base_revision_id: binding.revision_id,
    revision_id: document.current_revision_id, revision_number: document.revision_number,
    tags: document.tags, sha256: digest, no_change: false,
    local_changed_after_upload: localChanged }, 'Pushed revision ' + document.revision_number
      + (localChanged ? '; the local file changed again during upload.' : '.'));
}

async function status(opts, client) {
  const me = await client.authenticated('/api/cloud/v1/me');
  const credential = client.loadCredential();
  emit(opts, 'cloud.status', { user: me.user, credential_id: credential.credential_id,
    origin: client.origin }, 'Signed in as ' + (me.user.email || me.user.id) + '.');
}

async function runCloudCommand(opts, dependencies) {
  const action = String(opts.file || 'status').toLowerCase();
  const command = 'cloud.' + action;
  const client = dependencies && dependencies.client || new CloudClient();
  try {
    if (opts.helpFlag || action === 'help') return process.stdout.write(CLOUD_HELP + '\n');
    if (action === 'login') return await login(opts, client);
    if (action === 'logout') return await logout(opts, client);
    if (action === 'status') return await status(opts, client);
    if (action === 'projects') return await projects(opts, client);
    if (action === 'tags') return await tags(opts, client);
    if (action === 'ls') return await list(opts, client);
    if (action === 'search') return await search(opts, client);
    if (action === 'create') return await create(opts, client);
    if (action === 'pull') return await pull(opts, client);
    if (action === 'push') return await push(opts, client);
    throw new CloudCommandError('invalid_request', 'unknown Cloud command: ' + action);
  } catch (error) {
    fail(opts, command, error);
  }
}

module.exports = { CloudClient, CloudCommandError, runCloudCommand, filterTags, origin, EXIT, CLOUD_HELP };
