const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const constants = require('./constants');
const io = require('./io');
const credentialStore = require('./cloud-credentials');
const bindings = require('./cloud-bindings');

const EXIT = { unexpected: 1, invalid_request: 2, login_required: 3,
  resource_unavailable: 4, account_required: 4, account_selection_required: 4,
  permission_denied: 4, revision_conflict: 5,
  idempotency_mismatch: 5,
  unsafe_local_state: 6, base_revision_unavailable: 6, rate_limited: 7,
  search_limit_reached: 7, temporary_service_failure: 7, billing_not_configured: 7,
  authentication_not_configured: 7, cloud_storage_not_configured: 7,
  subscription_required: 4, subscription_read_only: 4, payment_grace_expired: 4,
  storage_limit_exceeded: 4, project_limit_reached: 4, member_limit_reached: 4,
  file_too_large: 2 };

const CLOUD_HELP = `SmallDocs Cloud

  sdoc cloud login [--no-open]
  sdoc cloud logout
  sdoc cloud status [--account UUID]
  sdoc cloud members [--account UUID]
  sdoc cloud tags [--account UUID]
  sdoc cloud permission-groups [--account UUID]
  sdoc cloud access DOCUMENT_UUID [--only-you | --everyone | --member USER_UUID ...]
  sdoc cloud tag DOCUMENT_UUID --tag TAG [--tag TAG ...]
  sdoc cloud ls [--tag TAG] [--limit N]
  sdoc cloud search QUERY [--tag TAG] [--limit N]
  sdoc cloud create PATH [--account UUID]
  sdoc cloud pull DOCUMENT_UUID [--revision UUID] --output PATH [--no-bind]
  sdoc cloud push PATH [--document UUID --base-revision UUID]
  sdoc cloud history DOCUMENT_UUID
  sdoc cloud restore DOCUMENT_UUID --revision REVISION_UUID
  sdoc cloud delete DOCUMENT_UUID --base-revision UUID
  sdoc cloud deleted
  sdoc cloud undelete DOCUMENT_UUID --base-revision UUID

Add --json to any command for one machine-readable JSON object on stdout.`;

class CloudCommandError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.code = code;
    if (detail) this.data = detail;
  }
}

function origin() {
  return String(process.env.SDOCS_CLOUD_URL || constants.DEFAULT_URL).replace(/\/$/, '');
}

function entitlementFailure(code, status, cloudOrigin) {
  if (code === 'read_only') code = 'subscription_read_only';
  if (status !== 402 && !['subscription_required', 'subscription_read_only',
    'payment_grace_expired'].includes(code)) return null;
  if (!['subscription_required', 'subscription_read_only', 'payment_grace_expired'].includes(code)) {
    code = 'subscription_required';
  }
  if (code === 'subscription_required') {
    return { code, message: 'An active SmallDocs Cloud subscription is required to change documents.',
      action: 'subscribe', billing_url: cloudOrigin + '/cloud#pricing' };
  }
  return { code, message: 'This Cloud account is read-only because its subscription is not active. Ask an account owner to update billing.',
    action: 'manage_billing', billing_url: cloudOrigin + '/cloud/admin' };
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
    let response;
    try { response = await this.fetch(this.origin + endpoint, options || {}); }
    catch (error) {
      throw new CloudCommandError('temporary_service_failure',
        'Could not reach SmallDocs Cloud.', { cause: error && error.message });
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new CloudCommandError('temporary_service_failure',
        'SmallDocs Cloud returned an invalid response.', { http_status: response.status });
    }
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
      const entitlement = entitlementFailure(result.data.error, result.response.status, this.origin);
      if (entitlement) {
        throw new CloudCommandError(entitlement.code, entitlement.message,
          Object.assign({}, result.data, { http_status: result.response.status,
            action: entitlement.action, billing_url: entitlement.billing_url }));
      }
      var message = result.data.message;
      if (result.data.error === 'account_selection_required') {
        var choices = (result.data.accounts || []).map(function (account) {
          return account.name + ' (' + account.id + ')';
        }).join(', ');
        message = 'Choose an account with --account.' + (choices ? ' Available: ' + choices : '');
      } else if (result.data.error === 'account_required') {
        message = 'Set up SmallDocs Cloud before using this command.';
      }
      throw new CloudCommandError(result.data.error || 'temporary_service_failure',
        message, Object.assign({}, result.data, { http_status: result.response.status }));
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
  const body = Object.assign({}, error.data || {},
    { ok: false, command, error: code, message: error.message || code });
  if (opts.jsonFlag) process.stdout.write(JSON.stringify(body) + '\n');
  else {
    process.stderr.write('sdoc cloud: ' + body.message + '\n');
    if (body.billing_url) process.stderr.write(
      (body.action === 'subscribe' ? 'Subscribe: ' : 'Manage billing: ') + body.billing_url + '\n');
  }
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

function filterTags(documents, tags) {
  const wanted = (tags || []).map((tag) => String(tag).toLowerCase());
  return documents.filter((document) => wanted.every((tag) => (document.tags || []).includes(tag)));
}

function requestedLimit(value, fallback) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CloudCommandError('invalid_request', '--limit must be a positive integer');
  }
  return value;
}

async function list(opts, client) {
  const target = requestedLimit(opts.limitFlag, 50);
  const documents = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(100, target - documents.length)));
    if (cursor) params.set('cursor', cursor);
    const response = await client.authenticated('/api/cloud/v1/documents?' + params.toString());
    documents.push(...filterTags(response.documents || [], opts.tagFilters)
      .slice(0, target - documents.length));
    cursor = response.next_cursor || null;
    if (cursor && seenCursors.has(cursor)) throw new CloudCommandError('temporary_service_failure',
      'Cloud returned the same document cursor twice.');
    if (cursor) seenCursors.add(cursor);
  } while (documents.length < target && cursor);
  emit(opts, 'cloud.ls', { documents, next_cursor: cursor }, documents.map((document) =>
    document.id + '  ' + document.title + '  [' + (document.tags || []).join(', ') + ']').join('\n') || 'No Cloud documents.');
}

async function tags(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/tags' + query);
  const values = (response.tags || []).map((item) => ({ tag: item.tag, document_count: item.count }));
  emit(opts, 'cloud.tags', { tags: values }, values.map((item) => item.tag + ' - ' + item.document_count).join('\n') || 'No Cloud tags.');
}

async function members(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/members' + query);
  const values = response.members || [];
  emit(opts, 'cloud.members', { account_id: response.account_id, members: values }, values.map((member) =>
    member.user_id + '  ' + (member.email || member.name) + (member.is_you ? '  You' : '')).join('\n') || 'No account members.');
}

async function permissionGroups(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/permission-groups' + query);
  const values = response.permission_groups || [];
  emit(opts, 'cloud.permission-groups', { account_id: response.account_id,
    permission_groups: values }, values.map((group) => group.document_id + '  '
      + (group.mode === 'everyone' ? 'Everyone' : group.member_user_ids.join(', '))).join('\n') ||
    'No Cloud permission groups.');
}

async function access(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud access DOCUMENT_UUID [--only-you | --everyone | --member USER_UUID ...]');
  const choices = Number(Boolean(opts.onlyYouFlag)) + Number(Boolean(opts.everyoneFlag))
    + Number(Boolean(opts.memberFlags && opts.memberFlags.length));
  if (choices !== 1) throw new CloudCommandError('invalid_request',
    'choose one of --only-you, --everyone, or one or more --member values');
  const mode = opts.everyoneFlag ? 'everyone' : 'custom';
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + '/permission', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, member_user_ids: opts.memberFlags || [] }) });
  emit(opts, 'cloud.access', { document_id: documentId, permission: response.permission },
    'Updated access for ' + documentId + '.');
}

async function setTags(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud tag DOCUMENT_UUID --tag TAG [--tag TAG ...]');
  const current = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId));
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + '/tags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: opts.tagFilters || [],
        expected_head_revision_id: current.document.current_revision_id,
        idempotency_key: crypto.randomUUID() }) });
  emit(opts, 'cloud.tag', { document_id: documentId,
    revision_id: response.document.current_revision_id, tags: response.document.tags },
  'Updated tags for ' + documentId + '.');
}

async function search(opts, client) {
  if (!opts.extra) throw new CloudCommandError('invalid_request', 'usage: sdoc cloud search QUERY');
  const limit = requestedLimit(opts.limitFlag, 50);
  const response = await client.authenticated('/api/cloud/v1/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: opts.extra, tags: opts.tagFilters, limit }),
  });
  const documents = response.documents || [];
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

function requireCredential(client) {
  const credential = client.loadCredential();
  if (!credential) throw new CloudCommandError('login_required', 'Run `sdoc cloud login`.');
  return credential;
}

async function create(opts, client) {
  const file = requireFile(opts.extra);
  const content = fs.readFileSync(file, 'utf8');
  const digest = bindings.hash(content);
  const credential = requireCredential(client);
  let pending = bindings.getPending(credential.user_id, file);
  const destination = opts.accountFlag || 'default-account';
  if (!pending || pending.operation !== 'create' || pending.destination !== destination || pending.sha256 !== digest) {
    pending = { operation: 'create', destination, sha256: digest,
      idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  const response = await client.authenticated('/api/cloud/v1/account/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: opts.accountFlag,
      filename: path.basename(file), markdown: content,
      idempotency_key: pending.idempotency_key }),
  });
  const document = response.document;
  bindings.set(credential.user_id, file, { document_id: document.id,
    revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
  bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, content);
  bindings.clearPending(credential.user_id, file);
  const localChanged = bindings.hash(fs.readFileSync(file)) !== digest;
  emit(opts, 'cloud.create', { document_id: document.id, revision_id: document.current_revision_id,
    revision_number: document.revision_number,
    account_id: response.account && response.account.id || opts.accountFlag || null, path: file,
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
  const credential = requireCredential(client);
  const existingBinding = bindings.get(credential.user_id, output);
  if (opts.noBindFlag && existingBinding) {
    throw new CloudCommandError('unsafe_local_state',
      '--no-bind requires an output path that is not already bound');
  }
  if (opts.revisionFlag && !opts.noBindFlag) {
    throw new CloudCommandError('unsafe_local_state',
      'pulling a historical revision requires --no-bind');
  }
  if (existingBinding && existingBinding.document_id !== documentId && !opts.forceFlag) {
    throw new CloudCommandError('unsafe_local_state',
      'output is bound to a different Cloud document; use --force to replace and rebind it');
  }
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
  const credential = requireCredential(client);
  const hasExplicitBinding = opts.documentFlag || opts.baseRevisionFlag;
  if (hasExplicitBinding && (!opts.documentFlag || !opts.baseRevisionFlag)) {
    throw new CloudCommandError('unsafe_local_state',
      'provide both --document and --base-revision');
  }
  let binding = hasExplicitBinding ? null : bindings.get(credential.user_id, file);
  if (hasExplicitBinding) {
    binding = { document_id: opts.documentFlag, revision_id: opts.baseRevisionFlag };
  } else if (!binding) {
    throw new CloudCommandError('unsafe_local_state',
      'file is not bound; provide both --document and --base-revision');
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

async function history(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud history DOCUMENT_UUID');
  const revisions = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const response = await client.authenticated('/api/cloud/v1/documents/'
      + encodeURIComponent(documentId) + '/revisions?' + params.toString());
    revisions.push(...(response.revisions || []));
    cursor = response.next_cursor || null;
    if (cursor && seenCursors.has(cursor)) throw new CloudCommandError('temporary_service_failure',
      'Cloud returned the same revision cursor twice.');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  emit(opts, 'cloud.history', { document_id: documentId, revisions,
    next_cursor: null }, revisions.map((revision) =>
    revision.revision_number + '  ' + revision.id + '  ' + revision.created_at).join('\n') || 'No revisions.');
}

async function restore(opts, client) {
  const documentId = opts.extra;
  const sourceRevisionId = opts.revisionFlag;
  if (!documentId || !sourceRevisionId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud restore DOCUMENT_UUID --revision REVISION_UUID');
  const currentResponse = await client.authenticated('/api/cloud/v1/documents/'
    + encodeURIComponent(documentId));
  const current = currentResponse.document;
  if (!current || !current.current_revision_id) {
    throw new CloudCommandError('temporary_service_failure', 'Cloud did not return the current document revision.');
  }
  const credential = client.loadCredential();
  const pendingResource = documentId + ':' + sourceRevisionId;
  let pending = bindings.getOperationPending(credential.user_id, 'restore', pendingResource);
  if (!pending) {
    pending = { expected_head_revision_id: current.current_revision_id,
      idempotency_key: crypto.randomUUID() };
    bindings.setOperationPending(credential.user_id, 'restore', pendingResource, pending);
  }
  const baseRevisionId = pending.expected_head_revision_id;
  let response;
  try {
    response = await client.authenticated('/api/cloud/v1/documents/'
      + encodeURIComponent(documentId) + '/revisions/' + encodeURIComponent(sourceRevisionId) + '/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: baseRevisionId,
        idempotency_key: pending.idempotency_key }),
    });
  } catch (error) {
    if (error && error.code === 'revision_conflict') {
      bindings.clearOperationPending(credential.user_id, 'restore', pendingResource);
    }
    throw error;
  }
  bindings.clearOperationPending(credential.user_id, 'restore', pendingResource);
  const document = response.document;
  emit(opts, 'cloud.restore', { document_id: document.id,
    base_revision_id: baseRevisionId,
    restored_from_revision_id: document.restored_from_revision_id || sourceRevisionId,
    revision_id: document.current_revision_id,
    revision_number: document.revision_number,
    tags: document.tags }, 'Restored revision ' + sourceRevisionId + ' as revision '
      + document.revision_number + '.');
}

async function deleteDocument(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.baseRevisionFlag) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud delete DOCUMENT_UUID --base-revision UUID');
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId), {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_head_revision_id: opts.baseRevisionFlag }),
  });
  const document = response.document;
  emit(opts, 'cloud.delete', { document_id: document.id,
    base_revision_id: opts.baseRevisionFlag, deleted_at: document.deleted_at,
    purge_after: document.purge_after }, 'Deleted ' + document.id + '.');
}

async function deletedDocuments(opts, client) {
  const response = await client.authenticated('/api/cloud/v1/documents/deleted');
  const documents = response.documents || [];
  emit(opts, 'cloud.deleted', { documents }, documents.map((document) =>
    document.id + '  ' + document.title + '  restore before ' + document.purge_after).join('\n') ||
    'No deleted Cloud documents.');
}

async function undeleteDocument(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.baseRevisionFlag) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud undelete DOCUMENT_UUID --base-revision UUID');
  const response = await client.authenticated('/api/cloud/v1/documents/' +
    encodeURIComponent(documentId) + '/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_head_revision_id: opts.baseRevisionFlag }),
  });
  const document = response.document;
  emit(opts, 'cloud.undelete', { document_id: document.id,
    revision_id: document.current_revision_id, revision_number: document.revision_number,
    tags: document.tags }, 'Restored ' + document.id + '.');
}

async function status(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const me = await client.authenticated('/api/cloud/v1/account' + query);
  const credential = client.loadCredential();
  emit(opts, 'cloud.status', { user: me.user, account: me.account, accounts: me.accounts,
    credential_id: credential.credential_id, origin: client.origin },
  'Signed in as ' + (me.user.email || me.user.id) + '. Account: ' + me.account.name + '.');
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
    if (action === 'members') return await members(opts, client);
    if (action === 'tags') return await tags(opts, client);
    if (action === 'permission-groups') return await permissionGroups(opts, client);
    if (action === 'access') return await access(opts, client);
    if (action === 'tag') return await setTags(opts, client);
    if (action === 'ls') return await list(opts, client);
    if (action === 'search') return await search(opts, client);
    if (action === 'create') return await create(opts, client);
    if (action === 'pull') return await pull(opts, client);
    if (action === 'push') return await push(opts, client);
    if (action === 'history') return await history(opts, client);
    if (action === 'restore') return await restore(opts, client);
    if (action === 'delete') return await deleteDocument(opts, client);
    if (action === 'deleted') return await deletedDocuments(opts, client);
    if (action === 'undelete') return await undeleteDocument(opts, client);
    throw new CloudCommandError('invalid_request', 'unknown Cloud command: ' + action);
  } catch (error) {
    fail(opts, command, error);
  }
}

module.exports = { CloudClient, CloudCommandError, runCloudCommand, filterTags, origin, EXIT, CLOUD_HELP,
  entitlementFailure };
