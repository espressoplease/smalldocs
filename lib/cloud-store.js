const crypto = require('crypto');
const zlib = require('zlib');
const SDocYaml = require('../cli/shared/sdocs-yaml');

const CRYPTO_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const COMPRESSION = 'brotli';

class CloudError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'CloudError';
    this.code = code;
    if (detail) Object.assign(this, detail);
  }
}

function requireText(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > (max || 1024)) {
    throw new CloudError('invalid_request', name + ' is required');
  }
  return value.trim();
}

function requireMarkdown(value) {
  if (typeof value !== 'string') throw new CloudError('invalid_request', 'markdown must be a string');
  return value;
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const seen = new Set();
  const tags = [];
  source.forEach((item) => {
    const tag = String(item || '').trim().replace(/^#/, '').toLowerCase();
    if (!tag || tag.length > 64 || seen.has(tag)) return;
    seen.add(tag);
    tags.push(tag);
  });
  return tags.slice(0, 64);
}

function deriveMetadata(markdown, filename) {
  const parsed = SDocYaml.parseFrontMatter(markdown);
  const body = parsed.body || '';
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(body);
  const cleanFilename = typeof filename === 'string' && filename.trim() ? filename.trim() : 'document.md';
  const fallback = cleanFilename.replace(/\.[^.]+$/, '') || 'Untitled';
  return {
    title: typeof parsed.meta.title === 'string' && parsed.meta.title.trim()
      ? parsed.meta.title.trim().slice(0, 512)
      : (heading ? heading[1].trim().slice(0, 512) : fallback.slice(0, 512)),
    filename: cleanFilename.slice(0, 512),
    tags: normalizeTags(parsed.meta.tags),
  };
}

function aad(input) {
  return Buffer.from([
    'sdocs-cloud', input.environment, input.workspaceId, input.projectId || '-',
    input.documentId || '-', input.revisionId || '-', input.kind,
    String(CRYPTO_VERSION), input.compression || 'none',
  ].join('\0'));
}

function encryptAead(key, plaintext, associatedData, randomBytes) {
  const nonce = randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce, ciphertext };
}

function decryptAead(key, nonce, ciphertext, associatedData) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12 || !Buffer.isBuffer(ciphertext) || ciphertext.length < 16) {
    throw new CloudError('temporary_service_failure', 'encrypted content is invalid');
  }
  try {
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (_) {
    throw new CloudError('temporary_service_failure', 'encrypted content could not be authenticated');
  }
}

class LocalKeyProvider {
  constructor(options) {
    options = options || {};
    const raw = options.masterKey;
    this.masterKey = Buffer.isBuffer(raw) ? Buffer.from(raw) : Buffer.from(String(raw || ''), 'base64');
    if (this.masterKey.length !== 32) throw new Error('local master key must be 32 bytes');
    this.environment = requireText(options.environment || 'development', 'environment', 64);
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.reference = options.reference || 'local-development-key';
  }

  _rootAad(kind, id, version) {
    return Buffer.from(['sdocs-cloud-root', this.environment, kind, id, String(version || 1)].join('\0'));
  }

  wrapProjectKey(projectId, version, projectKey) {
    const value = encryptAead(this.masterKey, projectKey, this._rootAad('project-key', projectId, version), this.randomBytes);
    return { ciphertext: value.ciphertext, nonce: value.nonce, reference: this.reference };
  }

  unwrapProjectKey(projectId, version, wrapped) {
    return decryptAead(this.masterKey, wrapped.nonce, wrapped.ciphertext,
      this._rootAad('project-key', projectId, version));
  }

  encryptWorkspaceName(workspaceId, name) {
    return this.encryptWorkspaceValue(workspaceId, 'workspace-name', name);
  }

  decryptWorkspaceName(workspaceId, encrypted) {
    return this.decryptWorkspaceValue(workspaceId, 'workspace-name', encrypted);
  }

  encryptWorkspaceValue(workspaceId, kind, value) {
    return encryptAead(this.masterKey, Buffer.from(value), this._rootAad(kind, workspaceId, 1), this.randomBytes);
  }

  decryptWorkspaceValue(workspaceId, kind, encrypted) {
    return decryptAead(this.masterKey, encrypted.nonce, encrypted.ciphertext,
      this._rootAad(kind, workspaceId, 1)).toString('utf8');
  }
}

class CloudStore {
  constructor(options) {
    options = options || {};
    if (!options.dbPath) throw new Error('dbPath is required');
    if (!options.keyProvider) throw new Error('keyProvider is required');
    const Database = require('better-sqlite3');
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.keyProvider = options.keyProvider;
    this.environment = this.keyProvider.environment;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.idempotencySecret = String(options.idempotencySecret || '');
    if (Buffer.byteLength(this.idempotencySecret) < 16) throw new Error('idempotencySecret must contain at least 16 bytes');
    this._createSchema();
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_workspaces (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('personal', 'team')),
        name_ciphertext BLOB NOT NULL,
        name_nonce BLOB NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        deleted_at_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS cloud_workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
        status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
        created_at_ms INTEGER NOT NULL,
        disabled_at_ms INTEGER,
        PRIMARY KEY(workspace_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS cloud_workspace_memberships_user_idx
        ON cloud_workspace_memberships(user_id, status, workspace_id);
      CREATE UNIQUE INDEX IF NOT EXISTS cloud_personal_workspace_creator_idx
        ON cloud_workspaces(created_by_user_id) WHERE kind = 'personal' AND deleted_at_ms IS NULL;

      CREATE TABLE IF NOT EXISTS cloud_projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        name_ciphertext BLOB NOT NULL,
        name_nonce BLOB NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        deleted_at_ms INTEGER,
        UNIQUE(workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS cloud_project_keys (
        project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        wrapped_key_ciphertext BLOB NOT NULL,
        wrapped_key_nonce BLOB NOT NULL,
        key_reference TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        retired_at_ms INTEGER,
        PRIMARY KEY(project_id, version)
      );
      CREATE TABLE IF NOT EXISTS cloud_project_grants (
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('viewer', 'editor')),
        created_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER,
        PRIMARY KEY(project_id, user_id),
        FOREIGN KEY(workspace_id, project_id) REFERENCES cloud_projects(workspace_id, id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cloud_documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        current_revision_id TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        deleted_at_ms INTEGER,
        purge_after_ms INTEGER,
        UNIQUE(workspace_id, project_id, id),
        FOREIGN KEY(workspace_id, project_id) REFERENCES cloud_projects(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS cloud_documents_project_idx
        ON cloud_documents(workspace_id, project_id, deleted_at_ms, updated_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_document_revisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        parent_revision_id TEXT,
        revision_number INTEGER NOT NULL,
        body_ciphertext BLOB NOT NULL,
        metadata_ciphertext BLOB NOT NULL,
        body_nonce BLOB NOT NULL,
        metadata_nonce BLOB NOT NULL,
        algorithm TEXT NOT NULL,
        compression_format TEXT NOT NULL,
        crypto_format_version INTEGER NOT NULL,
        project_key_version INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL,
        uncompressed_size INTEGER NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_by_credential_id TEXT,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(document_id, revision_number),
        UNIQUE(workspace_id, project_id, document_id, id),
        FOREIGN KEY(workspace_id, project_id, document_id)
          REFERENCES cloud_documents(workspace_id, project_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS cloud_revisions_document_idx
        ON cloud_document_revisions(document_id, revision_number DESC);

      CREATE TABLE IF NOT EXISTS cloud_idempotency_records (
        principal_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY(principal_id, endpoint, resource_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS cloud_audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        actor_user_id TEXT NOT NULL,
        actor_credential_id TEXT,
        action TEXT NOT NULL,
        resource_id TEXT,
        result TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        email_ciphertext BLOB NOT NULL,
        email_nonce BLOB NOT NULL,
        workspace_role TEXT NOT NULL CHECK(workspace_role IN ('admin', 'member')),
        project_grants_json TEXT NOT NULL,
        invited_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        accepted_by_user_id TEXT,
        accepted_at_ms INTEGER,
        revoked_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_invitations_workspace_idx
        ON cloud_invitations(workspace_id, expires_at_ms, accepted_at_ms);
    `);
  }

  _uuid() { return this.randomUUID(); }

  _digest(value) {
    return crypto.createHmac('sha256', this.idempotencySecret).update(JSON.stringify(value)).digest('hex');
  }

  _tokenDigest(domain, value) {
    return crypto.createHmac('sha256', this.idempotencySecret).update(domain).update('\0').update(String(value)).digest('hex');
  }

  _workspaceName(row) {
    return this.keyProvider.decryptWorkspaceName(row.id, {
      nonce: row.name_nonce, ciphertext: row.name_ciphertext,
    });
  }

  _projectKey(projectId, version) {
    const row = this.db.prepare(`
      SELECT wrapped_key_ciphertext, wrapped_key_nonce, key_reference
      FROM cloud_project_keys WHERE project_id = ? AND version = ?
    `).get(projectId, version || 1);
    if (!row) throw new CloudError('temporary_service_failure', 'project key is unavailable');
    return this.keyProvider.unwrapProjectKey(projectId, version || 1, {
      ciphertext: row.wrapped_key_ciphertext,
      nonce: row.wrapped_key_nonce,
      reference: row.key_reference,
    });
  }

  _encryptProjectName(workspaceId, projectId, name, projectKey) {
    return encryptAead(projectKey, Buffer.from(name), aad({
      environment: this.environment, workspaceId, projectId, kind: 'project-name',
    }), this.randomBytes);
  }

  _decryptProjectName(row) {
    const key = this._projectKey(row.id, 1);
    return decryptAead(key, row.name_nonce, row.name_ciphertext, aad({
      environment: this.environment, workspaceId: row.workspace_id, projectId: row.id, kind: 'project-name',
    })).toString('utf8');
  }

  _workspaceRole(userId, workspaceId) {
    const row = this.db.prepare(`
      SELECT role FROM cloud_workspace_memberships
      WHERE workspace_id = ? AND user_id = ? AND status = 'active'
    `).get(workspaceId, userId);
    return row ? row.role : null;
  }

  _projectAccess(userId, workspaceId, projectId) {
    const workspaceRole = this._workspaceRole(userId, workspaceId);
    if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'editor';
    if (!workspaceRole) return null;
    const grant = this.db.prepare(`
      SELECT role FROM cloud_project_grants
      WHERE workspace_id = ? AND project_id = ? AND user_id = ? AND revoked_at_ms IS NULL
    `).get(workspaceId, projectId, userId);
    return grant ? grant.role : null;
  }

  _requireProject(userId, projectId, required) {
    const row = this.db.prepare(`
      SELECT id, workspace_id, name_ciphertext, name_nonce, created_at_ms
      FROM cloud_projects WHERE id = ? AND deleted_at_ms IS NULL
    `).get(projectId);
    if (!row) throw new CloudError('resource_unavailable');
    const access = this._projectAccess(userId, row.workspace_id, projectId);
    if (!access || (required === 'editor' && access !== 'editor')) throw new CloudError('resource_unavailable');
    return { row, access };
  }

  _requireDocument(userId, documentId, required, includeDeleted) {
    const row = this.db.prepare(`
      SELECT * FROM cloud_documents WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at_ms IS NULL'}
    `).get(documentId);
    if (!row) throw new CloudError('resource_unavailable');
    const access = this._projectAccess(userId, row.workspace_id, row.project_id);
    if (!access || (required === 'editor' && access !== 'editor')) throw new CloudError('resource_unavailable');
    return { row, access };
  }

  _audit(input) {
    this.db.prepare(`
      INSERT INTO cloud_audit_events
        (id, workspace_id, project_id, actor_user_id, actor_credential_id, action, resource_id, result, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this._uuid(), input.workspaceId, input.projectId || null, input.userId,
      input.credentialId || null, input.action, input.resourceId || null, input.result || 'success', this.now());
  }

  _createWorkspaceAndProject(userId, workspaceName, kind, projectName) {
    const now = this.now();
    const workspaceId = this._uuid();
    const projectId = this._uuid();
    const workspaceEncrypted = this.keyProvider.encryptWorkspaceName(workspaceId, workspaceName);
    const projectKey = this.randomBytes(32);
    const wrapped = this.keyProvider.wrapProjectKey(projectId, 1, projectKey);
    const projectEncrypted = this._encryptProjectName(workspaceId, projectId, projectName, projectKey);
    this.db.prepare(`
      INSERT INTO cloud_workspaces
        (id, kind, name_ciphertext, name_nonce, created_by_user_id, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, kind, workspaceEncrypted.ciphertext, workspaceEncrypted.nonce, userId, now);
    this.db.prepare(`
      INSERT INTO cloud_workspace_memberships
        (workspace_id, user_id, role, status, created_at_ms) VALUES (?, ?, 'owner', 'active', ?)
    `).run(workspaceId, userId, now);
    this.db.prepare(`
      INSERT INTO cloud_projects
        (id, workspace_id, name_ciphertext, name_nonce, created_by_user_id, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(projectId, workspaceId, projectEncrypted.ciphertext, projectEncrypted.nonce, userId, now);
    this.db.prepare(`
      INSERT INTO cloud_project_keys
        (project_id, version, wrapped_key_ciphertext, wrapped_key_nonce, key_reference, created_at_ms)
      VALUES (?, 1, ?, ?, ?, ?)
    `).run(projectId, wrapped.ciphertext, wrapped.nonce, wrapped.reference, now);
    this._audit({ workspaceId, projectId, userId, action: 'workspace.create', resourceId: workspaceId });
    return { workspaceId, projectId };
  }

  ensurePersonalWorkspace(userId, displayName) {
    requireText(userId, 'userId', 256);
    const existing = this.db.prepare(`
      SELECT w.id AS workspace_id, p.id AS project_id
      FROM cloud_workspaces w
      JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
      JOIN cloud_projects p ON p.workspace_id = w.id AND p.deleted_at_ms IS NULL
      WHERE w.kind = 'personal' AND w.deleted_at_ms IS NULL
        AND m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
      ORDER BY p.created_at_ms LIMIT 1
    `).get(userId);
    if (existing) return { workspaceId: existing.workspace_id, projectId: existing.project_id, created: false };
    return this.db.transaction(() => {
      const again = this.db.prepare(`
        SELECT w.id AS workspace_id, p.id AS project_id
        FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
        JOIN cloud_projects p ON p.workspace_id = w.id
        WHERE w.kind = 'personal' AND m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
        LIMIT 1
      `).get(userId);
      if (again) return { workspaceId: again.workspace_id, projectId: again.project_id, created: false };
      const made = this._createWorkspaceAndProject(userId, displayName || 'Personal', 'personal', 'Documents');
      return { ...made, created: true };
    }).immediate();
  }

  createTeamWorkspace(input) {
    input = input || {};
    const userId = requireText(input.userId, 'userId', 256);
    const name = requireText(input.name, 'name', 512);
    const projectName = input.projectName ? requireText(input.projectName, 'projectName', 512) : 'General';
    return this.db.transaction(() => this._createWorkspaceAndProject(userId, name, 'team', projectName)).immediate();
  }

  createProject(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const name = requireText(input.name, 'name', 512);
    const now = this.now();
    const projectId = this._uuid();
    const projectKey = this.randomBytes(32);
    const wrapped = this.keyProvider.wrapProjectKey(projectId, 1, projectKey);
    const encrypted = this._encryptProjectName(input.workspaceId, projectId, name, projectKey);
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO cloud_projects
          (id, workspace_id, name_ciphertext, name_nonce, created_by_user_id, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(projectId, input.workspaceId, encrypted.ciphertext, encrypted.nonce, input.userId, now);
      this.db.prepare(`
        INSERT INTO cloud_project_keys
          (project_id, version, wrapped_key_ciphertext, wrapped_key_nonce, key_reference, created_at_ms)
        VALUES (?, 1, ?, ?, ?, ?)
      `).run(projectId, wrapped.ciphertext, wrapped.nonce, wrapped.reference, now);
      this._audit({ workspaceId: input.workspaceId, projectId, userId: input.userId,
        action: 'project.create', resourceId: projectId });
    }).immediate();
    return { id: projectId, workspaceId: input.workspaceId, name, role: 'editor' };
  }

  listWorkspaces(userId) {
    const rows = this.db.prepare(`
      SELECT w.*, m.role
      FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ? AND m.status = 'active' AND w.deleted_at_ms IS NULL
      ORDER BY w.created_at_ms, w.id
    `).all(userId);
    return rows.map((row) => ({ id: row.id, kind: row.kind, name: this._workspaceName(row), role: row.role }));
  }

  listProjects(userId, workspaceId) {
    const workspaceRole = this._workspaceRole(userId, workspaceId);
    if (!workspaceRole) throw new CloudError('resource_unavailable');
    const rows = this.db.prepare(`
      SELECT p.* FROM cloud_projects p
      LEFT JOIN cloud_project_grants g ON g.project_id = p.id AND g.user_id = ? AND g.revoked_at_ms IS NULL
      WHERE p.workspace_id = ? AND p.deleted_at_ms IS NULL
        AND (? IN ('owner', 'admin') OR g.role IS NOT NULL)
      ORDER BY p.created_at_ms, p.id
    `).all(userId, workspaceId, workspaceRole);
    return rows.map((row) => ({
      id: row.id, workspaceId: row.workspace_id, name: this._decryptProjectName(row),
      role: this._projectAccess(userId, row.workspace_id, row.id),
    }));
  }

  addWorkspaceMember(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.actorUserId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const role = input.role || 'member';
    if (!['admin', 'member'].includes(role) || (role === 'admin' && actorRole !== 'owner')) {
      throw new CloudError('permission_denied');
    }
    this.db.prepare(`
      INSERT INTO cloud_workspace_memberships (workspace_id, user_id, role, status, created_at_ms)
      VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', disabled_at_ms = NULL
    `).run(input.workspaceId, input.userId, role, this.now());
  }

  listWorkspaceMembers(input) {
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    return this.db.prepare(`
      SELECT user_id, role, status, created_at_ms, disabled_at_ms
      FROM cloud_workspace_memberships WHERE workspace_id = ?
      ORDER BY status, created_at_ms, user_id
    `).all(input.workspaceId).map((row) => ({
      user_id: row.user_id, role: row.role, status: row.status,
      created_at: new Date(row.created_at_ms).toISOString(),
      disabled_at: row.disabled_at_ms == null ? null : new Date(row.disabled_at_ms).toISOString(),
    }));
  }

  createInvitation(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const email = requireText(input.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CloudError('invalid_request');
    const role = input.role || 'member';
    if (!['admin', 'member'].includes(role) || (role === 'admin' && actorRole !== 'owner')) {
      throw new CloudError('permission_denied');
    }
    const grants = Array.isArray(input.projectGrants) ? input.projectGrants : [];
    grants.forEach((grant) => {
      if (!grant || !['viewer', 'editor'].includes(grant.role)) throw new CloudError('invalid_request');
      const project = this.db.prepare('SELECT id FROM cloud_projects WHERE id = ? AND workspace_id = ? AND deleted_at_ms IS NULL')
        .get(grant.projectId, input.workspaceId);
      if (!project) throw new CloudError('resource_unavailable');
    });
    const token = this.randomBytes(32).toString('base64url');
    const id = this._uuid();
    const now = this.now();
    const expiresAtMs = now + (input.ttlMs || 7 * 24 * 60 * 60 * 1000);
    const encrypted = this.keyProvider.encryptWorkspaceValue(input.workspaceId, 'invitation-email', email);
    this.db.prepare(`
      INSERT INTO cloud_invitations
        (id, workspace_id, token_hash, email_ciphertext, email_nonce, workspace_role,
         project_grants_json, invited_by_user_id, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, this._tokenDigest('invitation', token), encrypted.ciphertext,
      encrypted.nonce, role, JSON.stringify(grants), input.userId, now, expiresAtMs);
    this._audit({ workspaceId: input.workspaceId, userId: input.userId,
      action: 'invitation.create', resourceId: id });
    return { id, token, email, role, projectGrants: grants, expiresAtMs };
  }

  acceptInvitation(input) {
    input = input || {};
    const emails = (input.verifiedEmails || []).map((email) => String(email).trim().toLowerCase());
    const now = this.now();
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM cloud_invitations WHERE token_hash = ?
      `).get(this._tokenDigest('invitation', input.token));
      if (!row || row.expires_at_ms <= now || row.accepted_at_ms != null || row.revoked_at_ms != null) {
        throw new CloudError('resource_unavailable');
      }
      const invitedEmail = this.keyProvider.decryptWorkspaceValue(row.workspace_id, 'invitation-email', {
        ciphertext: row.email_ciphertext, nonce: row.email_nonce,
      });
      if (!emails.includes(invitedEmail)) throw new CloudError('permission_denied');
      this.db.prepare(`
        INSERT INTO cloud_workspace_memberships (workspace_id, user_id, role, status, created_at_ms)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role,
          status = 'active', disabled_at_ms = NULL
      `).run(row.workspace_id, input.userId, row.workspace_role, now);
      const insertGrant = this.db.prepare(`
        INSERT INTO cloud_project_grants (workspace_id, project_id, user_id, role, created_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, revoked_at_ms = NULL
      `);
      JSON.parse(row.project_grants_json).forEach((grant) =>
        insertGrant.run(row.workspace_id, grant.projectId, input.userId, grant.role, now));
      this.db.prepare(`
        UPDATE cloud_invitations SET accepted_by_user_id = ?, accepted_at_ms = ? WHERE id = ?
      `).run(input.userId, now, row.id);
      this._audit({ workspaceId: row.workspace_id, userId: input.userId,
        action: 'invitation.accept', resourceId: row.id });
      return { workspaceId: row.workspace_id, role: row.workspace_role };
    }).immediate();
  }

  removeWorkspaceMember(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.actorUserId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const target = this.db.prepare(`
      SELECT role, status FROM cloud_workspace_memberships WHERE workspace_id = ? AND user_id = ?
    `).get(input.workspaceId, input.userId);
    if (!target || target.status !== 'active') throw new CloudError('resource_unavailable');
    if (target.role === 'owner') {
      const owners = this.db.prepare(`
        SELECT COUNT(*) AS count FROM cloud_workspace_memberships
        WHERE workspace_id = ? AND role = 'owner' AND status = 'active'
      `).get(input.workspaceId).count;
      if (owners <= 1) throw new CloudError('final_owner_required');
      if (actorRole !== 'owner') throw new CloudError('permission_denied');
    }
    if (actorRole === 'admin' && target.role !== 'member') throw new CloudError('permission_denied');
    const now = this.now();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE cloud_workspace_memberships SET status = 'disabled', disabled_at_ms = ?
        WHERE workspace_id = ? AND user_id = ?
      `).run(now, input.workspaceId, input.userId);
      this.db.prepare(`
        UPDATE cloud_project_grants SET revoked_at_ms = ?
        WHERE workspace_id = ? AND user_id = ? AND revoked_at_ms IS NULL
      `).run(now, input.workspaceId, input.userId);
      this._audit({ workspaceId: input.workspaceId, userId: input.actorUserId,
        action: 'member.remove', resourceId: input.userId });
    }).immediate();
    return { ok: true };
  }

  grantProject(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.actorUserId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    if (!['viewer', 'editor'].includes(input.role)) throw new CloudError('invalid_request');
    const member = this._workspaceRole(input.userId, input.workspaceId);
    if (!member) throw new CloudError('resource_unavailable');
    this.db.prepare(`
      INSERT INTO cloud_project_grants (workspace_id, project_id, user_id, role, created_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, revoked_at_ms = NULL
    `).run(input.workspaceId, input.projectId, input.userId, input.role, this.now());
  }

  _prepareRevision(input) {
    const markdown = requireMarkdown(input.markdown);
    const metadata = deriveMetadata(markdown, input.filename);
    const body = Buffer.from(markdown);
    const compressed = zlib.brotliCompressSync(body);
    const key = this._projectKey(input.projectId, 1);
    const bodyAad = aad({ ...input, environment: this.environment, kind: 'body', compression: COMPRESSION });
    const metaAad = aad({ ...input, environment: this.environment, kind: 'metadata', compression: 'none' });
    const encryptedBody = encryptAead(key, compressed, bodyAad, this.randomBytes);
    const encryptedMetadata = encryptAead(key, Buffer.from(JSON.stringify(metadata)), metaAad, this.randomBytes);
    return { markdown, metadata, compressed, body, encryptedBody, encryptedMetadata };
  }

  _idempotent(input, execute) {
    const key = requireText(input.idempotencyKey, 'idempotencyKey', 256);
    const digest = this._digest(input.request);
    const existing = this.db.prepare(`
      SELECT request_digest, response_json FROM cloud_idempotency_records
      WHERE principal_id = ? AND endpoint = ? AND resource_id = ? AND idempotency_key = ?
    `).get(input.userId, input.endpoint, input.resourceId, key);
    if (existing) {
      if (existing.request_digest !== digest) throw new CloudError('idempotency_mismatch');
      return JSON.parse(existing.response_json);
    }
    const response = execute();
    this.db.prepare(`
      INSERT INTO cloud_idempotency_records
        (principal_id, endpoint, resource_id, idempotency_key, request_digest, response_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.userId, input.endpoint, input.resourceId, key, digest, JSON.stringify(response), this.now());
    return response;
  }

  createDocument(input) {
    input = input || {};
    const project = this._requireProject(input.userId, input.projectId, 'editor').row;
    const documentId = input.documentId || this._uuid();
    const revisionId = this._uuid();
    const prepared = this._prepareRevision({
      workspaceId: project.workspace_id, projectId: project.id, documentId, revisionId,
      markdown: input.markdown, filename: input.filename,
    });
    return this.db.transaction(() => this._idempotent({
      userId: input.userId, endpoint: 'documents.create', resourceId: project.id,
      idempotencyKey: input.idempotencyKey,
      request: { projectId: project.id, markdown: input.markdown, filename: input.filename },
    }, () => {
      const now = this.now();
      this.db.prepare(`
        INSERT INTO cloud_documents
          (id, workspace_id, project_id, created_by_user_id, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(documentId, project.workspace_id, project.id, input.userId, now, now);
      this._insertRevision({
        documentId, revisionId, workspaceId: project.workspace_id, projectId: project.id,
        parentRevisionId: null, revisionNumber: 1, userId: input.userId,
        credentialId: input.credentialId, prepared, now,
      });
      this.db.prepare('UPDATE cloud_documents SET current_revision_id = ? WHERE id = ?').run(revisionId, documentId);
      this._audit({ workspaceId: project.workspace_id, projectId: project.id, userId: input.userId,
        credentialId: input.credentialId, action: 'document.create', resourceId: documentId });
      return this._documentResult(documentId, prepared.metadata, 1, revisionId, now);
    })).immediate();
  }

  _insertRevision(input) {
    this.db.prepare(`
      INSERT INTO cloud_document_revisions
        (id, workspace_id, project_id, document_id, parent_revision_id, revision_number,
         body_ciphertext, metadata_ciphertext, body_nonce, metadata_nonce, algorithm,
         compression_format, crypto_format_version, project_key_version, compressed_size,
         uncompressed_size, created_by_user_id, created_by_credential_id, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(input.revisionId, input.workspaceId, input.projectId, input.documentId,
      input.parentRevisionId, input.revisionNumber, input.prepared.encryptedBody.ciphertext,
      input.prepared.encryptedMetadata.ciphertext, input.prepared.encryptedBody.nonce,
      input.prepared.encryptedMetadata.nonce, ALGORITHM, COMPRESSION, CRYPTO_VERSION,
      input.prepared.compressed.length, input.prepared.body.length, input.userId,
      input.credentialId || null, input.now);
  }

  _documentResult(documentId, metadata, revisionNumber, revisionId, updatedAtMs, project) {
    return {
      id: documentId,
      title: metadata.title,
      filename: metadata.filename,
      tags: metadata.tags,
      current_revision_id: revisionId,
      revision_number: revisionNumber,
      updated_at: new Date(updatedAtMs).toISOString(),
      project: project || undefined,
    };
  }

  _decryptRevision(row) {
    const key = this._projectKey(row.project_id, row.project_key_version);
    const common = {
      environment: this.environment, workspaceId: row.workspace_id, projectId: row.project_id,
      documentId: row.document_id, revisionId: row.id,
    };
    const compressed = decryptAead(key, row.body_nonce, row.body_ciphertext,
      aad({ ...common, kind: 'body', compression: row.compression_format }));
    let body;
    try {
      body = zlib.brotliDecompressSync(compressed, { maxOutputLength: row.uncompressed_size });
    } catch (_) {
      throw new CloudError('temporary_service_failure', 'encrypted content could not be decompressed');
    }
    if (body.length !== row.uncompressed_size) throw new CloudError('temporary_service_failure');
    const metadata = JSON.parse(decryptAead(key, row.metadata_nonce, row.metadata_ciphertext,
      aad({ ...common, kind: 'metadata', compression: 'none' })).toString('utf8'));
    return { markdown: body.toString('utf8'), metadata };
  }

  getDocument(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'viewer', input.includeDeleted).row;
    const revisionId = input.revisionId || document.current_revision_id;
    const row = this.db.prepare(`
      SELECT * FROM cloud_document_revisions
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
    `).get(revisionId, document.workspace_id, document.project_id, document.id);
    if (!row) throw new CloudError('resource_unavailable');
    const content = this._decryptRevision(row);
    const project = this.db.prepare('SELECT * FROM cloud_projects WHERE id = ? AND workspace_id = ?')
      .get(document.project_id, document.workspace_id);
    return {
      ...this._documentResult(document.id, content.metadata, row.revision_number, row.id,
        document.updated_at_ms, { id: document.project_id, name: this._decryptProjectName(project) }),
      workspace_id: document.workspace_id,
      project_id: document.project_id,
      markdown: content.markdown,
      deleted_at: document.deleted_at_ms == null ? null : new Date(document.deleted_at_ms).toISOString(),
    };
  }

  saveRevision(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    const revisionId = this._uuid();
    const prepared = this._prepareRevision({
      workspaceId: document.workspace_id, projectId: document.project_id,
      documentId: document.id, revisionId, markdown: input.markdown, filename: input.filename,
    });
    return this.db.transaction(() => this._idempotent({
      userId: input.userId, endpoint: 'documents.revisions.create', resourceId: document.id,
      idempotencyKey: input.idempotencyKey,
      request: { expectedHeadRevisionId: input.expectedHeadRevisionId, markdown: input.markdown, filename: input.filename },
    }, () => {
      const current = this.db.prepare('SELECT * FROM cloud_documents WHERE id = ? AND deleted_at_ms IS NULL').get(document.id);
      if (!current || current.current_revision_id !== input.expectedHeadRevisionId) {
        throw new CloudError('revision_conflict', null, {
          documentId: document.id,
          baseRevisionId: input.expectedHeadRevisionId || null,
          currentRevisionId: current ? current.current_revision_id : null,
        });
      }
      const parent = this.db.prepare(`
        SELECT revision_number FROM cloud_document_revisions
        WHERE id = ? AND document_id = ? AND project_id = ?
      `).get(current.current_revision_id, document.id, document.project_id);
      if (!parent) throw new CloudError('temporary_service_failure');
      const now = this.now();
      const number = parent.revision_number + 1;
      this._insertRevision({
        documentId: document.id, revisionId, workspaceId: document.workspace_id,
        projectId: document.project_id, parentRevisionId: current.current_revision_id,
        revisionNumber: number, userId: input.userId, credentialId: input.credentialId,
        prepared, now,
      });
      const advanced = this.db.prepare(`
        UPDATE cloud_documents SET current_revision_id = ?, updated_at_ms = ?
        WHERE id = ? AND current_revision_id = ? AND deleted_at_ms IS NULL
      `).run(revisionId, now, document.id, input.expectedHeadRevisionId);
      if (advanced.changes !== 1) throw new CloudError('revision_conflict');
      this._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
        userId: input.userId, credentialId: input.credentialId, action: 'document.revision.create', resourceId: document.id });
      return this._documentResult(document.id, prepared.metadata, number, revisionId, now);
    })).immediate();
  }

  restoreRevision(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    return this.db.transaction(() => this._idempotent({
      userId: input.userId, endpoint: 'documents.revisions.restore', resourceId: document.id,
      idempotencyKey: input.idempotencyKey,
      request: {
        expectedHeadRevisionId: input.expectedHeadRevisionId,
        revisionId: input.revisionId,
      },
    }, () => {
      const current = this.db.prepare('SELECT * FROM cloud_documents WHERE id = ? AND deleted_at_ms IS NULL')
        .get(document.id);
      if (!current || current.current_revision_id !== input.expectedHeadRevisionId) {
        throw new CloudError('revision_conflict', null, {
          documentId: document.id,
          baseRevisionId: input.expectedHeadRevisionId || null,
          currentRevisionId: current ? current.current_revision_id : null,
        });
      }
      const source = this.db.prepare(`
        SELECT * FROM cloud_document_revisions
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
      `).get(input.revisionId, document.workspace_id, document.project_id, document.id);
      if (!source) throw new CloudError('resource_unavailable');
      const parent = this.db.prepare(`
        SELECT revision_number FROM cloud_document_revisions
        WHERE id = ? AND document_id = ? AND project_id = ?
      `).get(current.current_revision_id, document.id, document.project_id);
      if (!parent) throw new CloudError('temporary_service_failure');
      const sourceContent = this._decryptRevision(source);
      const revisionId = this._uuid();
      const prepared = this._prepareRevision({
        workspaceId: document.workspace_id, projectId: document.project_id,
        documentId: document.id, revisionId, markdown: sourceContent.markdown,
        filename: sourceContent.metadata.filename,
      });
      const now = this.now();
      const number = parent.revision_number + 1;
      this._insertRevision({
        documentId: document.id, revisionId, workspaceId: document.workspace_id,
        projectId: document.project_id, parentRevisionId: current.current_revision_id,
        revisionNumber: number, userId: input.userId, credentialId: input.credentialId,
        prepared, now,
      });
      const advanced = this.db.prepare(`
        UPDATE cloud_documents SET current_revision_id = ?, updated_at_ms = ?
        WHERE id = ? AND current_revision_id = ? AND deleted_at_ms IS NULL
      `).run(revisionId, now, document.id, input.expectedHeadRevisionId);
      if (advanced.changes !== 1) throw new CloudError('revision_conflict');
      this._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
        userId: input.userId, credentialId: input.credentialId,
        action: 'document.revision.restore', resourceId: document.id });
      return {
        ...this._documentResult(document.id, prepared.metadata, number, revisionId, now),
        markdown: sourceContent.markdown,
        restored_from_revision_id: source.id,
      };
    })).immediate();
  }

  listDocuments(input) {
    input = input || {};
    const projects = input.projectId
      ? [this._requireProject(input.userId, input.projectId, 'viewer').row]
      : this.db.prepare(`
          SELECT p.* FROM cloud_projects p
          JOIN cloud_workspace_memberships m ON m.workspace_id = p.workspace_id
          LEFT JOIN cloud_project_grants g ON g.project_id = p.id AND g.user_id = m.user_id AND g.revoked_at_ms IS NULL
          WHERE m.user_id = ? AND m.status = 'active' AND p.deleted_at_ms IS NULL
            AND (? IS NULL OR p.workspace_id = ?)
            AND (m.role IN ('owner', 'admin') OR g.role IS NOT NULL)
          ORDER BY p.id
        `).all(input.userId, input.workspaceId || null, input.workspaceId || null);
    const results = [];
    for (const project of projects) {
      const projectName = this._decryptProjectName(project);
      const rows = this.db.prepare(`
        SELECT d.*, r.* FROM cloud_documents d
        JOIN cloud_document_revisions r ON r.id = d.current_revision_id
        WHERE d.workspace_id = ? AND d.project_id = ? AND d.deleted_at_ms IS NULL
        ORDER BY d.updated_at_ms DESC, d.id
      `).all(project.workspace_id, project.id);
      rows.forEach((row) => {
        const content = this._decryptRevision(row);
        results.push(this._documentResult(row.document_id, content.metadata, row.revision_number,
          row.id, row.updated_at_ms, { id: project.id, name: projectName }));
      });
    }
    results.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
    return results;
  }

  listTags(input) {
    const counts = new Map();
    this.listDocuments(input || {}).forEach((document) => {
      document.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts, ([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  search(input) {
    input = input || {};
    const query = requireText(input.query, 'query', 256).toLowerCase();
    const limit = Math.max(1, Math.min(Number(input.limit) || 50, 100));
    const documents = this.listDocuments({ userId: input.userId, projectId: input.projectId,
      workspaceId: input.workspaceId });
    const results = [];
    for (const summary of documents) {
      const document = this.getDocument({ userId: input.userId, documentId: summary.id });
      const fields = [document.title, document.filename, document.tags.join(' '), document.markdown];
      const joined = fields.join('\n').toLowerCase();
      const index = joined.indexOf(query);
      if (index < 0) continue;
      const bodyIndex = document.markdown.toLowerCase().indexOf(query);
      const start = Math.max(0, bodyIndex - 60);
      const snippet = bodyIndex < 0 ? '' : document.markdown.slice(start, bodyIndex + query.length + 100).replace(/\s+/g, ' ').trim();
      results.push({ ...summary, matches: [{ field: bodyIndex < 0 ? 'metadata' : 'body', snippet }] });
      if (results.length >= limit) break;
    }
    return results;
  }

  deleteDocument(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    if (document.current_revision_id !== input.expectedHeadRevisionId) {
      throw new CloudError('revision_conflict', null, { currentRevisionId: document.current_revision_id });
    }
    const now = this.now();
    const purgeAfter = now + (input.restoreWindowMs || 30 * 24 * 60 * 60 * 1000);
    const result = this.db.prepare(`
      UPDATE cloud_documents SET deleted_at_ms = ?, purge_after_ms = ?, updated_at_ms = ?
      WHERE id = ? AND current_revision_id = ? AND deleted_at_ms IS NULL
    `).run(now, purgeAfter, now, document.id, input.expectedHeadRevisionId);
    if (result.changes !== 1) throw new CloudError('revision_conflict');
    this._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
      userId: input.userId, action: 'document.delete', resourceId: document.id });
    return { id: document.id, deleted_at: new Date(now).toISOString(), purge_after: new Date(purgeAfter).toISOString() };
  }

  listRevisions(input) {
    const document = this._requireDocument(input.userId, input.documentId, 'viewer', true).row;
    return this.db.prepare(`
      SELECT id, parent_revision_id, revision_number, created_by_user_id,
             created_by_credential_id, created_at_ms, compressed_size, uncompressed_size
      FROM cloud_document_revisions
      WHERE workspace_id = ? AND project_id = ? AND document_id = ?
      ORDER BY revision_number DESC
    `).all(document.workspace_id, document.project_id, document.id).map((row) => ({
      id: row.id,
      parent_revision_id: row.parent_revision_id,
      revision_number: row.revision_number,
      created_by_user_id: row.created_by_user_id,
      created_by_credential_id: row.created_by_credential_id,
      created_at: new Date(row.created_at_ms).toISOString(),
      compressed_size: row.compressed_size,
      uncompressed_size: row.uncompressed_size,
    }));
  }

  pruneRevisions(input) {
    input = input || {};
    const keepLatest = Number(input.keepLatest);
    if (!Number.isInteger(keepLatest) || keepLatest < 0) {
      throw new CloudError('invalid_request', 'keepLatest must be a non-negative integer');
    }
    return this.db.transaction(() => {
      const document = this.db.prepare(`
        SELECT id, workspace_id, project_id, current_revision_id
        FROM cloud_documents WHERE id = ?
      `).get(input.documentId);
      if (!document) throw new CloudError('resource_unavailable');
      const removed = this.db.prepare(`
        DELETE FROM cloud_document_revisions
        WHERE workspace_id = ? AND project_id = ? AND document_id = ?
          AND id <> ?
          AND id NOT IN (
            SELECT id FROM cloud_document_revisions
            WHERE workspace_id = ? AND project_id = ? AND document_id = ?
            ORDER BY revision_number DESC
            LIMIT ?
          )
      `).run(document.workspace_id, document.project_id, document.id,
        document.current_revision_id, document.workspace_id, document.project_id,
        document.id, keepLatest);
      const retained = this.db.prepare(`
        SELECT COUNT(*) AS count FROM cloud_document_revisions
        WHERE workspace_id = ? AND project_id = ? AND document_id = ?
      `).get(document.workspace_id, document.project_id, document.id).count;
      return {
        document_id: document.id,
        current_revision_id: document.current_revision_id,
        deleted_count: removed.changes,
        retained_count: retained,
      };
    }).immediate();
  }

  close() { this.db.close(); }
}

function createLocalKeyProvider(options) { return new LocalKeyProvider(options); }
function createCloudStore(options) { return new CloudStore(options); }

module.exports = {
  CloudError,
  CloudStore,
  LocalKeyProvider,
  createCloudStore,
  createLocalKeyProvider,
  deriveMetadata,
  normalizeTags,
};
