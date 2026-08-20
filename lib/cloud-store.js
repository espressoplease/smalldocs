const crypto = require('crypto');
const zlib = require('zlib');
const { domainToASCII } = require('url');
const SDocYaml = require('../cli/shared/sdocs-yaml');
const { normalizeLimit } = require('./cloud-cursor');
const { KmsKeyProviderError } = require('./cloud-kms');
const { mergeTargetRevision } = require('./cloud-merge');

const CRYPTO_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const COMPRESSION = 'brotli';
const PUBLIC_INVITE_DOMAINS = new Set([
  'aol.com', 'gmail.com', 'googlemail.com', 'hotmail.com', 'icloud.com', 'live.com',
  'mail.com', 'me.com', 'outlook.com', 'proton.me', 'protonmail.com', 'yahoo.com',
]);

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

function normalizeOptionalNote(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new CloudError('invalid_request', 'note must be a string');
  const note = value.replace(/\r\n?/g, '\n').trim();
  return note || null;
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

function normalizeInviteDomain(value) {
  const raw = String(value || '').trim().replace(/^@+/, '').replace(/\.+$/, '');
  const domain = domainToASCII(raw).toLowerCase();
  if (!domain || domain.length > 253 || !domain.includes('.') ||
      !domain.split('.').every((label) => label && label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new CloudError('invalid_request', 'domain is invalid');
  }
  if (PUBLIC_INVITE_DOMAINS.has(domain)) {
    throw new CloudError('public_email_domain', 'public email domains cannot be enabled');
  }
  return domain;
}

function normalizeInviteDomains(value) {
  if (!Array.isArray(value)) throw new CloudError('invalid_request', 'domains must be an array');
  return [...new Set(value.map(normalizeInviteDomain))].sort();
}

function defaultInviteDomainFromEmail(value) {
  const email = String(value || '').trim();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  try {
    return normalizeInviteDomain(email.slice(at + 1));
  } catch (_) {
    return null;
  }
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
        deleted_at_ms INTEGER,
        purge_after_ms INTEGER
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
      CREATE TABLE IF NOT EXISTS cloud_workspace_invite_domains (
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        domain TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, domain)
      );

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

      CREATE TABLE IF NOT EXISTS cloud_permission_groups (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL UNIQUE REFERENCES cloud_documents(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('custom', 'everyone')),
        created_by_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_permission_groups_workspace_idx
        ON cloud_permission_groups(workspace_id, updated_at_ms, id);
      CREATE TABLE IF NOT EXISTS cloud_permission_group_members (
        permission_group_id TEXT NOT NULL REFERENCES cloud_permission_groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY(permission_group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS cloud_notification_batches (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES cloud_workspaces(id) ON DELETE CASCADE,
        actor_user_id TEXT NOT NULL,
        actor_credential_id TEXT,
        note_ciphertext BLOB,
        note_nonce BLOB,
        idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(actor_user_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS cloud_notification_documents (
        batch_id TEXT NOT NULL REFERENCES cloud_notification_batches(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES cloud_documents(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY(batch_id, document_id),
        UNIQUE(batch_id, position)
      );
      CREATE TABLE IF NOT EXISTS cloud_notification_recipients (
        batch_id TEXT NOT NULL REFERENCES cloud_notification_batches(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        PRIMARY KEY(batch_id, user_id)
      );

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
    const workspaceColumns = this.db.prepare('PRAGMA table_info(cloud_workspaces)').all();
    if (!workspaceColumns.some((column) => column.name === 'purge_after_ms')) {
      this.db.exec('ALTER TABLE cloud_workspaces ADD COLUMN purge_after_ms INTEGER');
    }
    const notificationColumns = this.db.prepare(
      'PRAGMA table_info(cloud_notification_batches)').all();
    if (!notificationColumns.some((column) => column.name === 'note_ciphertext')) {
      this.db.exec('ALTER TABLE cloud_notification_batches ADD COLUMN note_ciphertext BLOB');
    }
    if (!notificationColumns.some((column) => column.name === 'note_nonce')) {
      this.db.exec('ALTER TABLE cloud_notification_batches ADD COLUMN note_nonce BLOB');
    }
    this._migrateDocumentPermissions();
  }

  _migrateDocumentPermissions() {
    const documents = this.db.prepare(`
      SELECT d.id, d.workspace_id, d.created_by_user_id, d.created_at_ms
      FROM cloud_documents d
      LEFT JOIN cloud_permission_groups g ON g.document_id = d.id
      WHERE g.id IS NULL
      ORDER BY d.created_at_ms, d.id
    `).all();
    if (!documents.length) return;
    const insertGroup = this.db.prepare(`
      INSERT INTO cloud_permission_groups
        (id, workspace_id, document_id, mode, created_by_user_id, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, 'custom', ?, ?, ?)
    `);
    const insertMember = this.db.prepare(`
      INSERT OR IGNORE INTO cloud_permission_group_members
        (permission_group_id, user_id, created_at_ms) VALUES (?, ?, ?)
    `);
    const legacyMembers = this.db.prepare(`
      SELECT DISTINCT m.user_id
      FROM cloud_workspace_memberships m
      LEFT JOIN cloud_project_grants pg
        ON pg.workspace_id = m.workspace_id AND pg.user_id = m.user_id
       AND pg.project_id = ? AND pg.revoked_at_ms IS NULL
      WHERE m.workspace_id = ? AND m.status = 'active'
        AND (m.role IN ('owner', 'admin') OR pg.role IS NOT NULL)
      ORDER BY m.user_id
    `);
    this.db.transaction(() => {
      documents.forEach((document) => {
        const groupId = this._uuid();
        insertGroup.run(groupId, document.workspace_id, document.id,
          document.created_by_user_id, document.created_at_ms, document.created_at_ms);
        const projectId = this.db.prepare(
          'SELECT project_id FROM cloud_documents WHERE id = ?').get(document.id).project_id;
        legacyMembers.all(projectId, document.workspace_id).forEach((member) => {
          insertMember.run(groupId, member.user_id, document.created_at_ms);
        });
        insertMember.run(groupId, document.created_by_user_id, document.created_at_ms);
      });
    }).immediate();
  }

  _uuid() { return this.randomUUID(); }

  _digest(value) {
    return crypto.createHmac('sha256', this.idempotencySecret).update(JSON.stringify(value)).digest('hex');
  }

  _tokenDigest(domain, value) {
    return crypto.createHmac('sha256', this.idempotencySecret).update(domain).update('\0').update(String(value)).digest('hex');
  }

  async _keyOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof KmsKeyProviderError) {
        throw new CloudError('temporary_service_failure', 'encryption service is unavailable');
      }
      throw error;
    }
  }

  _beforeCommit(callback, detail) {
    if (callback == null) return;
    if (typeof callback !== 'function') throw new CloudError('invalid_request');
    const result = callback(detail);
    if (result && typeof result.then === 'function') {
      throw new CloudError('temporary_service_failure', 'commit authorization must be synchronous');
    }
  }

  async _workspaceName(row) {
    return this._keyOperation(() => this.keyProvider.decryptWorkspaceName(row.id, {
      nonce: row.name_nonce, ciphertext: row.name_ciphertext,
    }));
  }

  async _projectKey(projectId, version) {
    const row = this.db.prepare(`
      SELECT wrapped_key_ciphertext, wrapped_key_nonce, key_reference
      FROM cloud_project_keys WHERE project_id = ? AND version = ?
    `).get(projectId, version || 1);
    if (!row) throw new CloudError('temporary_service_failure', 'project key is unavailable');
    return this._keyOperation(() => this.keyProvider.unwrapProjectKey(projectId, version || 1, {
      ciphertext: row.wrapped_key_ciphertext,
      nonce: row.wrapped_key_nonce,
      reference: row.key_reference,
    }));
  }

  _encryptProjectName(workspaceId, projectId, name, projectKey) {
    return encryptAead(projectKey, Buffer.from(name), aad({
      environment: this.environment, workspaceId, projectId, kind: 'project-name',
    }), this.randomBytes);
  }

  async _decryptProjectName(row) {
    const key = await this._projectKey(row.id, 1);
    try {
      return decryptAead(key, row.name_nonce, row.name_ciphertext, aad({
        environment: this.environment, workspaceId: row.workspace_id, projectId: row.id, kind: 'project-name',
      })).toString('utf8');
    } finally {
      key.fill(0);
    }
  }

  _workspaceRole(userId, workspaceId) {
    const row = this.db.prepare(`
      SELECT m.role FROM cloud_workspace_memberships m
      JOIN cloud_workspaces w ON w.id = m.workspace_id AND w.deleted_at_ms IS NULL
      WHERE m.workspace_id = ? AND m.user_id = ? AND m.status = 'active'
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
    const access = this._documentAccess(userId, row);
    if (!access || (required === 'editor' && access !== 'editor')) throw new CloudError('resource_unavailable');
    return { row, access };
  }

  _documentAccess(userId, document) {
    if (!this._workspaceRole(userId, document.workspace_id)) return null;
    if (document.created_by_user_id === userId) return 'editor';
    const group = this.db.prepare(`
      SELECT id, mode FROM cloud_permission_groups WHERE document_id = ?
    `).get(document.id);
    if (!group) return null;
    if (group.mode === 'everyone') return 'editor';
    const member = this.db.prepare(`
      SELECT 1 FROM cloud_permission_group_members
      WHERE permission_group_id = ? AND user_id = ?
    `).get(group.id, userId);
    return member ? 'editor' : null;
  }

  _permissionGroup(documentId) {
    return this.db.prepare(`
      SELECT id, workspace_id, document_id, mode, created_by_user_id,
             created_at_ms, updated_at_ms
      FROM cloud_permission_groups WHERE document_id = ?
    `).get(documentId);
  }

  getDocumentPermission(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'viewer',
      Boolean(input.includeDeleted)).row;
    const group = this._permissionGroup(document.id);
    if (!group) throw new CloudError('temporary_service_failure');
    const members = this.db.prepare(`
      SELECT gm.user_id
      FROM cloud_permission_group_members gm
      JOIN cloud_workspace_memberships wm
        ON wm.workspace_id = ? AND wm.user_id = gm.user_id AND wm.status = 'active'
      WHERE gm.permission_group_id = ?
      ORDER BY CASE WHEN gm.user_id = ? THEN 0 ELSE 1 END, gm.created_at_ms, gm.user_id
    `).all(document.workspace_id, group.id, document.created_by_user_id).map((row) => row.user_id);
    return {
      id: group.id,
      account_id: group.workspace_id,
      document_id: group.document_id,
      mode: group.mode,
      member_user_ids: members,
      owner_user_id: document.created_by_user_id,
      can_manage: document.created_by_user_id === input.userId,
      updated_at: new Date(group.updated_at_ms).toISOString(),
    };
  }

  setDocumentPermission(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    if (document.created_by_user_id !== input.userId) throw new CloudError('permission_denied');
    const mode = input.mode === 'everyone' ? 'everyone' : 'custom';
    const requested = Array.isArray(input.memberUserIds) ? input.memberUserIds : [];
    const memberIds = Array.from(new Set([document.created_by_user_id].concat(requested)
      .map((value) => requireText(value, 'memberUserId', 256))));
    if (mode === 'custom') {
      const active = this.db.prepare(`
        SELECT user_id FROM cloud_workspace_memberships
        WHERE workspace_id = ? AND status = 'active'
      `).all(document.workspace_id);
      const allowed = new Set(active.map((row) => row.user_id));
      if (memberIds.some((userId) => !allowed.has(userId))) throw new CloudError('invalid_request');
    }
    return this.db.transaction(() => {
      const current = this._requireDocument(input.userId, document.id, 'editor').row;
      if (current.created_by_user_id !== input.userId) throw new CloudError('permission_denied');
      const group = this._permissionGroup(document.id);
      if (!group) throw new CloudError('temporary_service_failure');
      const now = this.now();
      this.db.prepare(`
        UPDATE cloud_permission_groups SET mode = ?, updated_at_ms = ? WHERE id = ?
      `).run(mode, now, group.id);
      this.db.prepare('DELETE FROM cloud_permission_group_members WHERE permission_group_id = ?')
        .run(group.id);
      const insert = this.db.prepare(`
        INSERT INTO cloud_permission_group_members
          (permission_group_id, user_id, created_at_ms) VALUES (?, ?, ?)
      `);
      memberIds.forEach((userId) => insert.run(group.id, userId, now));
      this._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
        userId: input.userId, action: 'document.permission.update', resourceId: document.id });
      return this.getDocumentPermission({ userId: input.userId, documentId: document.id });
    }).immediate();
  }

  listPermissionGroups(input) {
    input = input || {};
    if (!this._workspaceRole(input.userId, input.workspaceId)) throw new CloudError('resource_unavailable');
    const rows = this.db.prepare(`
      SELECT g.document_id FROM cloud_permission_groups g
      JOIN cloud_documents d ON d.id = g.document_id AND d.deleted_at_ms IS NULL
      WHERE g.workspace_id = ? ORDER BY g.updated_at_ms DESC, g.id
    `).all(input.workspaceId);
    const groups = [];
    rows.forEach((row) => {
      try {
        groups.push(this.getDocumentPermission({ userId: input.userId, documentId: row.document_id }));
      } catch (error) {
        if (error.code !== 'resource_unavailable') throw error;
      }
    });
    return groups;
  }

  async createDocumentNotification(input) {
    input = input || {};
    const documentIds = Array.from(new Set((Array.isArray(input.documentIds) ? input.documentIds : [])
      .map((value) => requireText(value, 'documentId', 256))));
    const recipientUserIds = Array.from(new Set((Array.isArray(input.recipientUserIds)
      ? input.recipientUserIds : []).map((value) => requireText(value, 'recipientUserId', 256))))
      .filter((userId) => userId !== input.userId);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 256);
    const note = normalizeOptionalNote(input.note);
    if (!documentIds.length || !recipientUserIds.length) throw new CloudError('invalid_request');

    const documents = documentIds.map((documentId) =>
      this._requireDocument(input.userId, documentId, 'editor').row);
    const workspaceId = documents[0].workspace_id;
    if (documents.some((document) => document.workspace_id !== workspaceId)) {
      throw new CloudError('invalid_request', 'documents must belong to one account');
    }
    recipientUserIds.forEach((recipientUserId) => {
      if (!this._workspaceRole(recipientUserId, workspaceId)) throw new CloudError('invalid_request');
      if (documents.some((document) => !this._documentAccess(recipientUserId, document))) {
        throw new CloudError('permission_denied');
      }
    });

    const requestDigest = this._digest({ documentIds, recipientUserIds, note });
    const existing = this.db.prepare(`
      SELECT id, workspace_id, request_digest, created_at_ms
      FROM cloud_notification_batches WHERE actor_user_id = ? AND idempotency_key = ?
    `).get(input.userId, idempotencyKey);
    if (existing) {
      if (existing.request_digest !== requestDigest) throw new CloudError('idempotency_mismatch');
      return {
        id: existing.id,
        workspace_id: existing.workspace_id,
        document_ids: documentIds,
        recipient_user_ids: recipientUserIds,
        created_at: new Date(existing.created_at_ms).toISOString(),
        created: false,
      };
    }

    const encryptedNote = note == null ? null : await this._keyOperation(() =>
      this.keyProvider.encryptWorkspaceValue(workspaceId, 'notification-note', note));

    return this.db.transaction(() => {
      const batchId = this._uuid();
      const now = this.now();
      documents.forEach((document) => {
        const current = this._requireDocument(input.userId, document.id, 'editor').row;
        if (current.workspace_id !== workspaceId) {
          throw new CloudError('permission_denied');
        }
        recipientUserIds.forEach((recipientUserId) => {
          if (!this._workspaceRole(recipientUserId, workspaceId) ||
              !this._documentAccess(recipientUserId, current)) throw new CloudError('permission_denied');
        });
      });
      this.db.prepare(`
        INSERT INTO cloud_notification_batches
          (id, workspace_id, actor_user_id, actor_credential_id, note_ciphertext,
           note_nonce, idempotency_key, request_digest, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(batchId, workspaceId, input.userId, input.credentialId || null,
        encryptedNote && encryptedNote.ciphertext, encryptedNote && encryptedNote.nonce,
        idempotencyKey, requestDigest, now);
      const insertDocument = this.db.prepare(`
        INSERT INTO cloud_notification_documents (batch_id, document_id, position)
        VALUES (?, ?, ?)
      `);
      documents.forEach((document, position) => {
        insertDocument.run(batchId, document.id, position);
        this._audit({ workspaceId, projectId: document.project_id, userId: input.userId,
          credentialId: input.credentialId, action: 'document.notification.create',
          resourceId: document.id });
      });
      const insertRecipient = this.db.prepare(`
        INSERT INTO cloud_notification_recipients (batch_id, user_id) VALUES (?, ?)
      `);
      recipientUserIds.forEach((recipientUserId) => insertRecipient.run(batchId, recipientUserId));
      return {
        id: batchId,
        workspace_id: workspaceId,
        document_ids: documentIds,
        recipient_user_ids: recipientUserIds,
        created_at: new Date(now).toISOString(),
        created: true,
      };
    }).immediate();
  }

  async getDocumentNotificationDelivery(input) {
    input = input || {};
    const row = this.db.prepare(`
      SELECT b.id, b.workspace_id, b.actor_user_id, b.actor_credential_id,
             b.note_ciphertext, b.note_nonce, b.created_at_ms
      FROM cloud_notification_batches b
      JOIN cloud_notification_recipients r ON r.batch_id = b.id
      WHERE b.id = ? AND r.user_id = ?
    `).get(input.batchId, input.recipientUserId);
    if (!row) throw new CloudError('resource_unavailable');
    if (!this._workspaceRole(input.recipientUserId, row.workspace_id)) {
      return { skipped: true, reason: 'access_removed' };
    }
    const documents = [];
    const documentRows = this.db.prepare(`
      SELECT d.* FROM cloud_notification_documents n
      JOIN cloud_documents d ON d.id = n.document_id AND d.deleted_at_ms IS NULL
      WHERE n.batch_id = ? ORDER BY n.position
    `).all(row.id);
    for (const document of documentRows) {
      if (!this._documentAccess(input.recipientUserId, document)) continue;
      const revision = this.db.prepare(`
        SELECT * FROM cloud_document_revisions WHERE id = ? AND document_id = ?
      `).get(document.current_revision_id, document.id);
      if (!revision) continue;
      const content = await this._decryptRevision(revision);
      documents.push({ id: document.id, title: content.metadata.title });
    }
    if (!documents.length) return { skipped: true, reason: 'access_removed' };
    let note = null;
    if (row.note_ciphertext || row.note_nonce) {
      if (!row.note_ciphertext || !row.note_nonce) {
        throw new CloudError('temporary_service_failure', 'notification note is invalid');
      }
      note = await this._keyOperation(() => this.keyProvider.decryptWorkspaceValue(
        row.workspace_id, 'notification-note', {
          ciphertext: row.note_ciphertext, nonce: row.note_nonce,
        }));
    }
    return {
      skipped: false,
      batch_id: row.id,
      workspace_id: row.workspace_id,
      actor_user_id: row.actor_user_id,
      actor_credential_id: row.actor_credential_id,
      recipient_user_id: input.recipientUserId,
      note,
      documents,
      created_at: new Date(row.created_at_ms).toISOString(),
    };
  }

  _audit(input) {
    this.db.prepare(`
      INSERT INTO cloud_audit_events
        (id, workspace_id, project_id, actor_user_id, actor_credential_id, action, resource_id, result, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this._uuid(), input.workspaceId, input.projectId || null, input.userId,
      input.credentialId || null, input.action, input.resourceId || null, input.result || 'success', this.now());
  }

  async _prepareWorkspaceAndProject(userId, workspaceName, kind, projectName) {
    const now = this.now();
    const workspaceId = this._uuid();
    const projectId = this._uuid();
    const workspaceEncrypted = await this._keyOperation(() =>
      this.keyProvider.encryptWorkspaceName(workspaceId, workspaceName));
    const projectKey = this.randomBytes(32);
    try {
      const wrapped = await this._keyOperation(() => this.keyProvider.wrapProjectKey(projectId, 1, projectKey));
      const projectEncrypted = this._encryptProjectName(workspaceId, projectId, projectName, projectKey);
      return { now, workspaceId, projectId, workspaceEncrypted, wrapped, projectEncrypted,
        userId, kind };
    } finally {
      projectKey.fill(0);
    }
  }

  _insertWorkspaceAndProject(prepared) {
    const { now, workspaceId, projectId, workspaceEncrypted, wrapped, projectEncrypted,
      userId, kind } = prepared;
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

  async ensurePersonalWorkspace(userId, displayName) {
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
    const prepared = await this._prepareWorkspaceAndProject(
      userId, displayName || 'Personal', 'personal', 'Documents');
    return this.db.transaction(() => {
      const again = this.db.prepare(`
        SELECT w.id AS workspace_id, p.id AS project_id
        FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
        JOIN cloud_projects p ON p.workspace_id = w.id
        WHERE w.kind = 'personal' AND m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
        LIMIT 1
      `).get(userId);
      if (again) return { workspaceId: again.workspace_id, projectId: again.project_id, created: false };
      const made = this._insertWorkspaceAndProject(prepared);
      return { ...made, created: true };
    }).immediate();
  }

  async createTeamWorkspace(input) {
    input = input || {};
    const userId = requireText(input.userId, 'userId', 256);
    const name = requireText(input.name, 'name', 512);
    const projectName = input.projectName ? requireText(input.projectName, 'projectName', 512) : 'General';
    const inviteDomains = normalizeInviteDomains(input.inviteDomains || []);
    const prepared = await this._prepareWorkspaceAndProject(userId, name, 'team', projectName);
    return this.db.transaction(() => {
      const made = this._insertWorkspaceAndProject(prepared);
      const insert = this.db.prepare(`
        INSERT INTO cloud_workspace_invite_domains
          (workspace_id, domain, created_by_user_id, created_at_ms)
        VALUES (?, ?, ?, ?)
      `);
      inviteDomains.forEach((domain) => insert.run(
        made.workspaceId, domain, userId, prepared.now));
      return { ...made, inviteDomains };
    }).immediate();
  }

  async createProject(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const name = requireText(input.name, 'name', 512);
    const now = this.now();
    const projectId = this._uuid();
    const projectKey = this.randomBytes(32);
    let wrapped;
    let encrypted;
    try {
      wrapped = await this._keyOperation(() => this.keyProvider.wrapProjectKey(projectId, 1, projectKey));
      encrypted = this._encryptProjectName(input.workspaceId, projectId, name, projectKey);
    } finally {
      projectKey.fill(0);
    }
    this.db.transaction(() => {
      const currentRole = this._workspaceRole(input.userId, input.workspaceId);
      if (currentRole !== 'owner' && currentRole !== 'admin') throw new CloudError('permission_denied');
      this._beforeCommit(input.beforeCommit);
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

  async listWorkspaces(userId) {
    const rows = this.db.prepare(`
      SELECT w.*, m.role
      FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ? AND m.status = 'active' AND w.deleted_at_ms IS NULL
      ORDER BY w.created_at_ms, w.id
    `).all(userId);
    const workspaces = [];
    for (const row of rows) {
      const name = await this._workspaceName(row);
      const role = this._workspaceRole(userId, row.id);
      if (role) workspaces.push({ id: row.id, kind: row.kind, name, role });
    }
    return workspaces;
  }

  listWorkspaceMemberships(userId) {
    return this.db.prepare(`
      SELECT w.id, w.kind, m.role
      FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ? AND m.status = 'active' AND w.deleted_at_ms IS NULL
      ORDER BY w.created_at_ms, w.id
    `).all(userId).map((row) => ({ id: row.id, kind: row.kind, role: row.role }));
  }

  async listDeletedWorkspaces(userId) {
    const rows = this.db.prepare(`
      SELECT w.*, m.role
      FROM cloud_workspaces w JOIN cloud_workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ? AND m.status = 'active' AND m.role = 'owner'
        AND w.kind = 'team' AND w.deleted_at_ms IS NOT NULL AND w.purge_after_ms > ?
      ORDER BY w.deleted_at_ms DESC, w.id
    `).all(userId, this.now());
    const workspaces = [];
    for (const row of rows) {
      const name = await this._workspaceName(row);
      const membership = this.db.prepare(`
        SELECT m.role FROM cloud_workspace_memberships m
        JOIN cloud_workspaces w ON w.id = m.workspace_id
        WHERE m.workspace_id = ? AND m.user_id = ? AND m.status = 'active'
          AND m.role = 'owner' AND w.deleted_at_ms IS NOT NULL AND w.purge_after_ms > ?
      `).get(row.id, userId, this.now());
      if (membership) workspaces.push({
        id: row.id,
        kind: row.kind,
        name,
        role: membership.role,
        deleted_at: new Date(row.deleted_at_ms).toISOString(),
        purge_after: new Date(row.purge_after_ms).toISOString(),
      });
    }
    return workspaces;
  }

  async listProjects(userId, workspaceId) {
    const workspaceRole = this._workspaceRole(userId, workspaceId);
    if (!workspaceRole) throw new CloudError('resource_unavailable');
    const rows = this.db.prepare(`
      SELECT p.* FROM cloud_projects p
      LEFT JOIN cloud_project_grants g ON g.project_id = p.id AND g.user_id = ? AND g.revoked_at_ms IS NULL
      WHERE p.workspace_id = ? AND p.deleted_at_ms IS NULL
        AND (? IN ('owner', 'admin') OR g.role IS NOT NULL)
      ORDER BY p.created_at_ms, p.id
    `).all(userId, workspaceId, workspaceRole);
    const projects = [];
    for (const row of rows) {
      const name = await this._decryptProjectName(row);
      const role = this._projectAccess(userId, row.workspace_id, row.id);
      if (role) projects.push({ id: row.id, workspaceId: row.workspace_id, name, role });
    }
    return projects;
  }

  getWorkspaceUsage(input) {
    input = input || {};
    if (!input.skipAccess && !this._workspaceRole(input.userId, input.workspaceId)) {
      throw new CloudError('resource_unavailable');
    }
    const projectCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM cloud_projects
      WHERE workspace_id = ? AND deleted_at_ms IS NULL
    `).get(input.workspaceId).count;
    const memberCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM cloud_workspace_memberships
      WHERE workspace_id = ? AND status = 'active'
    `).get(input.workspaceId).count;
    const storedBytes = this.db.prepare(`
      SELECT COALESCE(SUM(r.compressed_size + length(r.metadata_ciphertext)), 0) AS bytes
      FROM cloud_document_revisions r
      JOIN cloud_documents d ON d.id = r.document_id
      WHERE r.workspace_id = ?
    `).get(input.workspaceId).bytes;
    return { storedBytes, projectCount, memberCount, searchRequestsInWindow: 0 };
  }

  getWorkspaceInvitePolicy(input) {
    input = input || {};
    const role = this._workspaceRole(input.userId, input.workspaceId);
    if (!role) throw new CloudError('resource_unavailable');
    const domains = this.db.prepare(`
      SELECT domain FROM cloud_workspace_invite_domains
      WHERE workspace_id = ? ORDER BY domain
    `).all(input.workspaceId).map((row) => row.domain);
    const canManage = role === 'owner' || role === 'admin';
    return { domains, can_manage: canManage, can_invite: canManage || domains.length > 0 };
  }

  setWorkspaceInviteDomains(input) {
    input = input || {};
    const role = this._workspaceRole(input.userId, input.workspaceId);
    if (role !== 'owner' && role !== 'admin') throw new CloudError('permission_denied');
    const domains = normalizeInviteDomains(input.domains);
    const now = this.now();
    this.db.transaction(() => {
      const currentRole = this._workspaceRole(input.userId, input.workspaceId);
      if (currentRole !== 'owner' && currentRole !== 'admin') {
        throw new CloudError('permission_denied');
      }
      this._beforeCommit(input.beforeCommit);
      this.db.prepare('DELETE FROM cloud_workspace_invite_domains WHERE workspace_id = ?')
        .run(input.workspaceId);
      const insert = this.db.prepare(`
        INSERT INTO cloud_workspace_invite_domains
          (workspace_id, domain, created_by_user_id, created_at_ms)
        VALUES (?, ?, ?, ?)
      `);
      domains.forEach((domain) => insert.run(input.workspaceId, domain, input.userId, now));
      this._audit({ workspaceId: input.workspaceId, userId: input.userId,
        action: 'invitation.domains.update', resourceId: input.workspaceId });
    }).immediate();
    return { domains, can_manage: true, can_invite: true };
  }

  getProjectContext(input) {
    const access = this._requireProject(input.userId, input.projectId, input.requiredRole || 'viewer');
    return { id: access.row.id, workspaceId: access.row.workspace_id, role: access.role };
  }

  getDocumentContext(input) {
    const access = this._requireDocument(input.userId, input.documentId, input.requiredRole || 'viewer',
      Boolean(input.includeDeleted));
    return { id: access.row.id, workspaceId: access.row.workspace_id,
      projectId: access.row.project_id, role: access.role,
      currentRevisionId: access.row.current_revision_id };
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

  listAccountMembers(input) {
    input = input || {};
    if (!this._workspaceRole(input.userId, input.workspaceId)) throw new CloudError('resource_unavailable');
    return this.db.prepare(`
      SELECT user_id, role, created_at_ms
      FROM cloud_workspace_memberships
      WHERE workspace_id = ? AND status = 'active'
      ORDER BY created_at_ms, user_id
    `).all(input.workspaceId).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      created_at: new Date(row.created_at_ms).toISOString(),
      is_you: row.user_id === input.userId,
    }));
  }

  transferWorkspaceOwnership(input) {
    input = input || {};
    if (!input.targetUserId || input.targetUserId === input.actorUserId) {
      throw new CloudError('invalid_request');
    }
    return this.db.transaction(() => {
      const actorRole = this._workspaceRole(input.actorUserId, input.workspaceId);
      if (actorRole !== 'owner') throw new CloudError('permission_denied');
      const target = this.db.prepare(`
        SELECT role, status FROM cloud_workspace_memberships
        WHERE workspace_id = ? AND user_id = ?
      `).get(input.workspaceId, input.targetUserId);
      if (!target || target.status !== 'active') throw new CloudError('resource_unavailable');
      const updated = this.db.prepare(`
        UPDATE cloud_workspace_memberships SET role = 'owner'
        WHERE workspace_id = ? AND user_id = ? AND status = 'active'
      `).run(input.workspaceId, input.targetUserId);
      if (updated.changes !== 1) throw new CloudError('resource_unavailable');
      this._audit({ workspaceId: input.workspaceId, userId: input.actorUserId,
        action: 'workspace.owner.add', resourceId: input.targetUserId });
      return {
        workspace_id: input.workspaceId,
        owner_user_id: input.targetUserId,
        previous_role: target.role,
        retained_owner_user_id: input.actorUserId,
        updated_at: new Date(this.now()).toISOString(),
      };
    }).immediate();
  }

  deleteWorkspace(input) {
    input = input || {};
    const restoreWindowMs = Number.isFinite(input.restoreWindowMs) && input.restoreWindowMs > 0
      ? input.restoreWindowMs : 30 * 24 * 60 * 60 * 1000;
    return this.db.transaction(() => {
      const actorRole = this._workspaceRole(input.userId, input.workspaceId);
      if (actorRole !== 'owner') throw new CloudError('permission_denied');
      const workspace = this.db.prepare(`
        SELECT id, kind FROM cloud_workspaces WHERE id = ? AND deleted_at_ms IS NULL
      `).get(input.workspaceId);
      if (!workspace) throw new CloudError('resource_unavailable');
      if (workspace.kind === 'personal') throw new CloudError('personal_workspace_cannot_be_deleted');
      const now = this.now();
      const purgeAfterMs = now + restoreWindowMs;
      if (!Number.isSafeInteger(purgeAfterMs)) throw new CloudError('invalid_request');
      const result = this.db.prepare(`
        UPDATE cloud_workspaces SET deleted_at_ms = ?, purge_after_ms = ?
        WHERE id = ? AND kind = 'team' AND deleted_at_ms IS NULL
      `).run(now, purgeAfterMs, input.workspaceId);
      if (result.changes !== 1) throw new CloudError('resource_unavailable');
      this._audit({ workspaceId: input.workspaceId, userId: input.userId,
        action: 'workspace.delete', resourceId: input.workspaceId });
      return {
        id: input.workspaceId,
        deleted_at: new Date(now).toISOString(),
        purge_after: new Date(purgeAfterMs).toISOString(),
        purge_after_ms: purgeAfterMs,
      };
    }).immediate();
  }

  restoreWorkspace(input) {
    input = input || {};
    return this.db.transaction(() => {
      const workspace = this.db.prepare(`
        SELECT w.id, w.kind, w.deleted_at_ms, w.purge_after_ms, m.role, m.status
        FROM cloud_workspaces w
        LEFT JOIN cloud_workspace_memberships m
          ON m.workspace_id = w.id AND m.user_id = ?
        WHERE w.id = ?
      `).get(input.userId, input.workspaceId);
      if (!workspace || workspace.kind !== 'team' || workspace.status !== 'active') {
        throw new CloudError('resource_unavailable');
      }
      if (workspace.role !== 'owner') throw new CloudError('permission_denied');
      if (workspace.deleted_at_ms == null || workspace.purge_after_ms <= this.now()) {
        throw new CloudError('resource_unavailable');
      }
      const restoredAt = this.now();
      const result = this.db.prepare(`
        UPDATE cloud_workspaces SET deleted_at_ms = NULL, purge_after_ms = NULL
        WHERE id = ? AND deleted_at_ms IS NOT NULL AND purge_after_ms > ?
      `).run(input.workspaceId, restoredAt);
      if (result.changes !== 1) throw new CloudError('resource_unavailable');
      this._audit({ workspaceId: input.workspaceId, userId: input.userId,
        action: 'workspace.restore', resourceId: input.workspaceId });
      return { id: input.workspaceId, restored_at: new Date(restoredAt).toISOString() };
    }).immediate();
  }

  purgeDeletedWorkspaces(input) {
    input = input || {};
    const beforeMs = Number.isFinite(input.beforeMs) ? input.beforeMs : this.now();
    const limit = Math.max(1, Math.min(Number(input.limit) || 100, 1000));
    const workspaceId = input.workspaceId || null;
    return this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT id FROM cloud_workspaces
        WHERE kind = 'team' AND deleted_at_ms IS NOT NULL AND purge_after_ms <= ?
          AND (? IS NULL OR id = ?)
        ORDER BY purge_after_ms, id LIMIT ?
      `).all(beforeMs, workspaceId, workspaceId, limit);
      const removeAudit = this.db.prepare('DELETE FROM cloud_audit_events WHERE workspace_id = ?');
      const removeIdempotency = this.db.prepare(`
        DELETE FROM cloud_idempotency_records
        WHERE resource_id = ?
          OR resource_id IN (SELECT id FROM cloud_projects WHERE workspace_id = ?)
          OR resource_id IN (SELECT id FROM cloud_documents WHERE workspace_id = ?)
      `);
      const removeDocuments = this.db.prepare('DELETE FROM cloud_documents WHERE workspace_id = ?');
      const removeWorkspace = this.db.prepare(`
        DELETE FROM cloud_workspaces
        WHERE id = ? AND kind = 'team' AND deleted_at_ms IS NOT NULL AND purge_after_ms <= ?
      `);
      let purged = 0;
      rows.forEach((row) => {
        removeIdempotency.run(row.id, row.id, row.id);
        removeDocuments.run(row.id);
        removeAudit.run(row.id);
        purged += removeWorkspace.run(row.id, beforeMs).changes;
      });
      return { purged_count: purged };
    }).immediate();
  }

  async createInvitation(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    const email = requireText(input.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CloudError('invalid_request');
    const role = input.role || 'member';
    const emailDomain = domainToASCII(email.slice(email.lastIndexOf('@') + 1)).toLowerCase();
    const memberDomainAllowed = input.allowMemberInvite === true &&
      actorRole === 'member' && role === 'member' &&
      Boolean(this.db.prepare(`
        SELECT 1 FROM cloud_workspace_invite_domains WHERE workspace_id = ? AND domain = ?
      `).get(input.workspaceId, emailDomain));
    if (!['admin', 'member'].includes(role) ||
        (actorRole !== 'owner' && actorRole !== 'admin' && !memberDomainAllowed)) {
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
    const encrypted = await this._keyOperation(() =>
      this.keyProvider.encryptWorkspaceValue(input.workspaceId, 'invitation-email', email));
    this.db.transaction(() => {
      const currentRole = this._workspaceRole(input.userId, input.workspaceId);
      const currentMemberDomainAllowed = input.allowMemberInvite === true &&
        currentRole === 'member' && role === 'member' &&
        Boolean(this.db.prepare(`
          SELECT 1 FROM cloud_workspace_invite_domains WHERE workspace_id = ? AND domain = ?
        `).get(input.workspaceId, emailDomain));
      if (currentRole !== 'owner' && currentRole !== 'admin' && !currentMemberDomainAllowed) {
        throw new CloudError('permission_denied');
      }
      grants.forEach((grant) => {
        const project = this.db.prepare(`
          SELECT id FROM cloud_projects
          WHERE id = ? AND workspace_id = ? AND deleted_at_ms IS NULL
        `).get(grant.projectId, input.workspaceId);
        if (!project) throw new CloudError('resource_unavailable');
      });
      this._beforeCommit(input.beforeCommit);
      this.db.prepare(`
        INSERT INTO cloud_invitations
          (id, workspace_id, token_hash, email_ciphertext, email_nonce, workspace_role,
           project_grants_json, invited_by_user_id, created_at_ms, expires_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspaceId, this._tokenDigest('invitation', token), encrypted.ciphertext,
        encrypted.nonce, role, JSON.stringify(grants), input.userId, now, expiresAtMs);
      this._audit({ workspaceId: input.workspaceId, userId: input.userId,
        action: 'invitation.create', resourceId: id });
    }).immediate();
    return { id, token, email, role, projectGrants: grants, expiresAtMs };
  }

  async listWorkspaceInvitations(input) {
    input = input || {};
    const actorRole = this._workspaceRole(input.userId, input.workspaceId);
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
    const now = this.now();
    const rows = this.db.prepare(`
      SELECT * FROM cloud_invitations
      WHERE workspace_id = ? AND accepted_at_ms IS NULL AND revoked_at_ms IS NULL
        AND expires_at_ms > ?
      ORDER BY created_at_ms DESC, id
    `).all(input.workspaceId, now);
    const invitations = [];
    for (const row of rows) {
      const email = await this._keyOperation(() => this.keyProvider.decryptWorkspaceValue(
        row.workspace_id, 'invitation-email', {
          ciphertext: row.email_ciphertext, nonce: row.email_nonce,
        }));
      const currentRole = this._workspaceRole(input.userId, input.workspaceId);
      if (currentRole !== 'owner' && currentRole !== 'admin') throw new CloudError('permission_denied');
      invitations.push({
        id: row.id,
        email,
        role: row.workspace_role,
        project_grants: JSON.parse(row.project_grants_json),
        invited_by_user_id: row.invited_by_user_id,
        created_at: new Date(row.created_at_ms).toISOString(),
        expires_at: new Date(row.expires_at_ms).toISOString(),
      });
    }
    return invitations;
  }

  revokeWorkspaceInvitation(input) {
    input = input || {};
    return this.db.transaction(() => {
      const actorRole = this._workspaceRole(input.userId, input.workspaceId);
      if (actorRole !== 'owner' && actorRole !== 'admin') throw new CloudError('permission_denied');
      const now = this.now();
      const result = this.db.prepare(`
        UPDATE cloud_invitations SET revoked_at_ms = ?
        WHERE id = ? AND workspace_id = ? AND accepted_at_ms IS NULL
          AND revoked_at_ms IS NULL AND expires_at_ms > ?
      `).run(now, input.invitationId, input.workspaceId, now);
      if (result.changes !== 1) throw new CloudError('resource_unavailable');
      this._audit({ workspaceId: input.workspaceId, userId: input.userId,
        action: 'invitation.revoke', resourceId: input.invitationId });
      return { id: input.invitationId, revoked_at: new Date(now).toISOString() };
    }).immediate();
  }

  async getInvitationContext(input) {
    input = input || {};
    const row = this.db.prepare(`
      SELECT i.* FROM cloud_invitations i
      JOIN cloud_workspaces w ON w.id = i.workspace_id AND w.deleted_at_ms IS NULL
      WHERE i.token_hash = ?
    `).get(this._tokenDigest('invitation', input.token));
    if (!row || row.expires_at_ms <= this.now() || row.accepted_at_ms != null || row.revoked_at_ms != null) {
      throw new CloudError('resource_unavailable');
    }
    const invitedEmail = await this._keyOperation(() => this.keyProvider.decryptWorkspaceValue(
      row.workspace_id, 'invitation-email', {
      ciphertext: row.email_ciphertext, nonce: row.email_nonce,
    }));
    const current = this.db.prepare(`
      SELECT i.id FROM cloud_invitations i
      JOIN cloud_workspaces w ON w.id = i.workspace_id AND w.deleted_at_ms IS NULL
      WHERE i.id = ? AND i.expires_at_ms > ? AND i.accepted_at_ms IS NULL AND i.revoked_at_ms IS NULL
    `).get(row.id, this.now());
    if (!current) throw new CloudError('resource_unavailable');
    const emails = (input.verifiedEmails || []).map((email) => String(email).trim().toLowerCase());
    if (!emails.includes(invitedEmail)) throw new CloudError('permission_denied');
    return { workspaceId: row.workspace_id, role: row.workspace_role };
  }

  async acceptInvitation(input) {
    input = input || {};
    const emails = (input.verifiedEmails || []).map((email) => String(email).trim().toLowerCase());
    const candidate = this.db.prepare(`
      SELECT i.* FROM cloud_invitations i
      JOIN cloud_workspaces w ON w.id = i.workspace_id AND w.deleted_at_ms IS NULL
      WHERE i.token_hash = ?
    `).get(this._tokenDigest('invitation', input.token));
    const beforeDecrypt = this.now();
    if (!candidate || candidate.expires_at_ms <= beforeDecrypt || candidate.accepted_at_ms != null ||
        candidate.revoked_at_ms != null) throw new CloudError('resource_unavailable');
    const invitedEmail = await this._keyOperation(() => this.keyProvider.decryptWorkspaceValue(
      candidate.workspace_id, 'invitation-email', {
        ciphertext: candidate.email_ciphertext, nonce: candidate.email_nonce,
      }));
    if (!emails.includes(invitedEmail)) throw new CloudError('permission_denied');
    return this.db.transaction(() => {
      const now = this.now();
      const row = this.db.prepare(`
        SELECT i.* FROM cloud_invitations i
        JOIN cloud_workspaces w ON w.id = i.workspace_id AND w.deleted_at_ms IS NULL
        WHERE i.token_hash = ?
      `).get(this._tokenDigest('invitation', input.token));
      if (!row || row.expires_at_ms <= now || row.accepted_at_ms != null || row.revoked_at_ms != null) {
        throw new CloudError('resource_unavailable');
      }
      if (row.id !== candidate.id) throw new CloudError('resource_unavailable');
      this._beforeCommit(input.beforeCommit);
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

  async _prepareRevision(input) {
    const markdown = requireMarkdown(input.markdown);
    const metadata = deriveMetadata(markdown, input.filename);
    const body = Buffer.from(markdown);
    const compressed = zlib.brotliCompressSync(body);
    const key = await this._projectKey(input.projectId, 1);
    let metadataBytes;
    try {
      const bodyAad = aad({ ...input, environment: this.environment, kind: 'body', compression: COMPRESSION });
      const metaAad = aad({ ...input, environment: this.environment, kind: 'metadata', compression: 'none' });
      const encryptedBody = encryptAead(key, compressed, bodyAad, this.randomBytes);
      metadataBytes = Buffer.from(JSON.stringify(metadata));
      const encryptedMetadata = encryptAead(key, metadataBytes, metaAad, this.randomBytes);
      return { markdown, metadata, compressedSize: compressed.length, bodySize: body.length,
        encryptedBody, encryptedMetadata };
    } finally {
      key.fill(0);
      body.fill(0);
      compressed.fill(0);
      if (metadataBytes) metadataBytes.fill(0);
    }
  }

  _idempotentReplay(input) {
    const key = requireText(input.idempotencyKey, 'idempotencyKey', 256);
    const digest = this._digest(input.request);
    const existing = this.db.prepare(`
      SELECT request_digest, response_json FROM cloud_idempotency_records
      WHERE principal_id = ? AND endpoint = ? AND resource_id = ? AND idempotency_key = ?
    `).get(input.userId, input.endpoint, input.resourceId, key);
    if (existing) {
      if (existing.request_digest !== digest) throw new CloudError('idempotency_mismatch');
      return { found: true, response: JSON.parse(existing.response_json) };
    }
    return { found: false, key, digest };
  }

  _idempotent(input, execute) {
    const replay = this._idempotentReplay(input);
    if (replay.found) return replay.response;
    const response = execute();
    this.db.prepare(`
      INSERT INTO cloud_idempotency_records
        (principal_id, endpoint, resource_id, idempotency_key, request_digest, response_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.userId, input.endpoint, input.resourceId, replay.key, replay.digest,
      JSON.stringify(response), this.now());
    return response;
  }

  async createDocument(input) {
    input = input || {};
    const project = this._requireProject(input.userId, input.projectId, 'editor').row;
    const idempotency = {
      userId: input.userId, endpoint: 'documents.create', resourceId: project.id,
      idempotencyKey: input.idempotencyKey,
      request: { projectId: project.id, markdown: input.markdown, filename: input.filename },
    };
    const replay = this._idempotentReplay(idempotency);
    if (replay.found) return replay.response;
    const documentId = input.documentId || this._uuid();
    const revisionId = this._uuid();
    const prepared = await this._prepareRevision({
      workspaceId: project.workspace_id, projectId: project.id, documentId, revisionId,
      markdown: input.markdown, filename: input.filename,
    });
    return this.db.transaction(() => this._idempotent(idempotency, () => {
      this._requireProject(input.userId, project.id, 'editor');
      this._beforeCommit(input.beforeCommit);
      const now = this.now();
      this.db.prepare(`
        INSERT INTO cloud_documents
          (id, workspace_id, project_id, created_by_user_id, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(documentId, project.workspace_id, project.id, input.userId, now, now);
      const permissionGroupId = this._uuid();
      this.db.prepare(`
        INSERT INTO cloud_permission_groups
          (id, workspace_id, document_id, mode, created_by_user_id, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, 'custom', ?, ?, ?)
      `).run(permissionGroupId, project.workspace_id, documentId, input.userId, now, now);
      this.db.prepare(`
        INSERT INTO cloud_permission_group_members
          (permission_group_id, user_id, created_at_ms) VALUES (?, ?, ?)
      `).run(permissionGroupId, input.userId, now);
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
      input.prepared.compressedSize, input.prepared.bodySize, input.userId,
      input.credentialId || null, input.now);
  }

  _documentResult(documentId, metadata, revisionNumber, revisionId, updatedAtMs, project) {
    const result = {
      id: documentId,
      title: metadata.title,
      filename: metadata.filename,
      tags: metadata.tags,
      current_revision_id: revisionId,
      revision_number: revisionNumber,
      updated_at: new Date(updatedAtMs).toISOString(),
    };
    if (project) result.project = project;
    return result;
  }

  async _decryptRevision(row) {
    const key = await this._projectKey(row.project_id, row.project_key_version);
    try {
      const common = {
        environment: this.environment, workspaceId: row.workspace_id, projectId: row.project_id,
        documentId: row.document_id, revisionId: row.id,
      };
      const compressed = decryptAead(key, row.body_nonce, row.body_ciphertext,
        aad({ ...common, kind: 'body', compression: row.compression_format }));
      let body;
      let metadataBytes;
      try {
        body = zlib.brotliDecompressSync(compressed, { maxOutputLength: row.uncompressed_size });
      } catch (_) {
        compressed.fill(0);
        throw new CloudError('temporary_service_failure', 'encrypted content could not be decompressed');
      }
      try {
        if (body.length !== row.uncompressed_size) throw new CloudError('temporary_service_failure');
        metadataBytes = decryptAead(key, row.metadata_nonce, row.metadata_ciphertext,
          aad({ ...common, kind: 'metadata', compression: 'none' }));
        return { markdown: body.toString('utf8'), metadata: JSON.parse(metadataBytes.toString('utf8')) };
      } finally {
        compressed.fill(0);
        body.fill(0);
        if (metadataBytes) metadataBytes.fill(0);
      }
    } finally {
      key.fill(0);
    }
  }

  getDocumentHead(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'viewer').row;
    const revision = this.db.prepare(`
      SELECT revision_number FROM cloud_document_revisions
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
    `).get(document.current_revision_id, document.workspace_id, document.project_id, document.id);
    if (!revision) throw new CloudError('temporary_service_failure');
    return {
      id: document.id,
      current_revision_id: document.current_revision_id,
      revision_number: revision.revision_number,
      updated_at: new Date(document.updated_at_ms).toISOString(),
    };
  }

  async getDocument(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'viewer', input.includeDeleted).row;
    const revisionId = input.revisionId || document.current_revision_id;
    const row = this.db.prepare(`
      SELECT * FROM cloud_document_revisions
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
    `).get(revisionId, document.workspace_id, document.project_id, document.id);
    if (!row) throw new CloudError('resource_unavailable');
    const content = await this._decryptRevision(row);
    const project = this.db.prepare('SELECT * FROM cloud_projects WHERE id = ? AND workspace_id = ?')
      .get(document.project_id, document.workspace_id);
    const projectName = await this._decryptProjectName(project);
    this._requireDocument(input.userId, document.id, 'viewer', input.includeDeleted);
    return {
      ...this._documentResult(document.id, content.metadata, row.revision_number, row.id,
        document.updated_at_ms, { id: document.project_id, name: projectName }),
      workspace_id: document.workspace_id,
      project_id: document.project_id,
      markdown: content.markdown,
      deleted_at: document.deleted_at_ms == null ? null : new Date(document.deleted_at_ms).toISOString(),
    };
  }

  async saveRevision(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    const idempotency = {
      userId: input.userId, endpoint: 'documents.revisions.create', resourceId: document.id,
      idempotencyKey: input.idempotencyKey,
      request: { expectedHeadRevisionId: input.expectedHeadRevisionId,
        markdown: input.markdown, filename: input.filename },
    };
    const replay = this._idempotentReplay(idempotency);
    if (replay.found) return replay.response;
    const revisionId = this._uuid();
    const prepared = await this._prepareRevision({
      workspaceId: document.workspace_id, projectId: document.project_id,
      documentId: document.id, revisionId, markdown: input.markdown, filename: input.filename,
    });
    return this.db.transaction(() => this._idempotent(idempotency, () => {
      this._requireDocument(input.userId, document.id, 'editor');
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
      this._beforeCommit(input.beforeCommit);
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

  async saveTargetRevision(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    const targetRevisionId = requireText(input.targetRevisionId, 'targetRevisionId', 128);
    const proposedMarkdown = requireMarkdown(input.markdown);
    const idempotency = {
      userId: input.userId, endpoint: 'documents.revisions.target', resourceId: document.id,
      idempotencyKey: input.idempotencyKey,
      request: { targetRevisionId, markdown: proposedMarkdown, filename: input.filename },
    };
    const replay = this._idempotentReplay(idempotency);
    if (replay.found) return replay.response;
    const target = this.db.prepare(`
      SELECT * FROM cloud_document_revisions
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
    `).get(targetRevisionId, document.workspace_id, document.project_id, document.id);
    if (!target) {
      throw new CloudError('target_too_old', null, {
        documentId: document.id,
        targetRevisionId,
        currentRevisionId: document.current_revision_id,
      });
    }
    const targetContent = await this._decryptRevision(target);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const observed = this._requireDocument(input.userId, document.id, 'editor').row;
      const current = this.db.prepare(`
        SELECT * FROM cloud_document_revisions
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
      `).get(observed.current_revision_id, document.workspace_id, document.project_id, document.id);
      if (!current) throw new CloudError('temporary_service_failure');
      const currentContent = current.id === target.id
        ? targetContent : await this._decryptRevision(current);
      this._requireDocument(input.userId, document.id, 'editor');
      const merged = mergeTargetRevision(targetContent.markdown, currentContent.markdown,
        proposedMarkdown);
      const mergedBytes = Buffer.byteLength(merged.markdown);
      if (input.maxMarkdownBytes != null && mergedBytes > input.maxMarkdownBytes) {
        throw new CloudError('file_too_large');
      }
      const commonResult = {
        markdown: merged.markdown,
        target_revision_id: targetRevisionId,
        merged_from_revision_id: current.id,
        merge_classification: merged.classification,
        combined: merged.combined,
        comment_id_remaps: merged.comment_id_remaps,
      };
      const revisionId = merged.markdown === currentContent.markdown ? null : this._uuid();
      const prepared = revisionId ? await this._prepareRevision({
        workspaceId: document.workspace_id, projectId: document.project_id,
        documentId: document.id, revisionId, markdown: merged.markdown,
        filename: input.filename || currentContent.metadata.filename,
      }) : null;

      try {
        return this.db.transaction(() => this._idempotent(idempotency, () => {
          this._requireDocument(input.userId, document.id, 'editor');
          const latest = this.db.prepare(`
            SELECT * FROM cloud_documents WHERE id = ? AND deleted_at_ms IS NULL
          `).get(document.id);
          if (!latest || latest.current_revision_id !== current.id) {
            const moved = new Error('target head moved');
            moved.code = 'target_head_moved';
            throw moved;
          }
          const retainedTarget = this.db.prepare(`
            SELECT id FROM cloud_document_revisions
            WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
          `).get(targetRevisionId, document.workspace_id, document.project_id, document.id);
          if (!retainedTarget) {
            throw new CloudError('target_too_old', null, {
              documentId: document.id,
              targetRevisionId,
              currentRevisionId: current.id,
            });
          }
          this._beforeCommit(input.beforeCommit, { markdownBytes: mergedBytes });
          if (!prepared) {
            return {
              ...this._documentResult(document.id, currentContent.metadata,
                current.revision_number, current.id, latest.updated_at_ms),
              ...commonResult,
            };
          }
          const now = this.now();
          const number = current.revision_number + 1;
          this._insertRevision({
            documentId: document.id, revisionId, workspaceId: document.workspace_id,
            projectId: document.project_id, parentRevisionId: current.id,
            revisionNumber: number, userId: input.userId, credentialId: input.credentialId,
            prepared, now,
          });
          const advanced = this.db.prepare(`
            UPDATE cloud_documents SET current_revision_id = ?, updated_at_ms = ?
            WHERE id = ? AND current_revision_id = ? AND deleted_at_ms IS NULL
          `).run(revisionId, now, document.id, current.id);
          if (advanced.changes !== 1) {
            const moved = new Error('target head moved');
            moved.code = 'target_head_moved';
            throw moved;
          }
          this._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
            userId: input.userId, credentialId: input.credentialId,
            action: 'document.revision.merge', resourceId: document.id });
          return {
            ...this._documentResult(document.id, prepared.metadata, number, revisionId, now),
            ...commonResult,
          };
        })).immediate();
      } catch (error) {
        if (!error || error.code !== 'target_head_moved') throw error;
      }
    }
    throw new CloudError('temporary_service_failure', 'document changed too quickly to merge');
  }

  async updateDocumentTags(input) {
    input = input || {};
    const opened = await this.getDocument({ userId: input.userId, documentId: input.documentId });
    const parsed = SDocYaml.parseFrontMatter(opened.markdown);
    const meta = Object.assign({}, parsed.meta, { tags: normalizeTags(input.tags) });
    const markdown = SDocYaml.serializeFrontMatter(meta) + '\n' + parsed.body;
    return this.saveRevision({
      userId: input.userId,
      credentialId: input.credentialId,
      documentId: opened.id,
      expectedHeadRevisionId: input.expectedHeadRevisionId || opened.current_revision_id,
      markdown,
      filename: opened.filename,
      idempotencyKey: input.idempotencyKey,
      beforeCommit: input.beforeCommit,
    });
  }

  async restoreRevision(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor').row;
    const idempotency = {
      userId: input.userId, endpoint: 'documents.revisions.restore', resourceId: document.id,
      idempotencyKey: input.idempotencyKey,
      request: {
        expectedHeadRevisionId: input.expectedHeadRevisionId,
        revisionId: input.revisionId,
      },
    };
    const replay = this._idempotentReplay(idempotency);
    if (replay.found) return replay.response;
    const source = this.db.prepare(`
      SELECT * FROM cloud_document_revisions
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
    `).get(input.revisionId, document.workspace_id, document.project_id, document.id);
    if (!source) throw new CloudError('resource_unavailable');
    const sourceContent = await this._decryptRevision(source);
    const revisionId = this._uuid();
    const prepared = await this._prepareRevision({
      workspaceId: document.workspace_id, projectId: document.project_id,
      documentId: document.id, revisionId, markdown: sourceContent.markdown,
      filename: sourceContent.metadata.filename,
    });
    return this.db.transaction(() => this._idempotent(idempotency, () => {
      this._requireDocument(input.userId, document.id, 'editor');
      const current = this.db.prepare('SELECT * FROM cloud_documents WHERE id = ? AND deleted_at_ms IS NULL')
        .get(document.id);
      if (!current || current.current_revision_id !== input.expectedHeadRevisionId) {
        throw new CloudError('revision_conflict', null, {
          documentId: document.id,
          baseRevisionId: input.expectedHeadRevisionId || null,
          currentRevisionId: current ? current.current_revision_id : null,
        });
      }
      const currentSource = this.db.prepare(`
        SELECT * FROM cloud_document_revisions
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND document_id = ?
      `).get(input.revisionId, document.workspace_id, document.project_id, document.id);
      if (!currentSource) throw new CloudError('resource_unavailable');
      const parent = this.db.prepare(`
        SELECT revision_number FROM cloud_document_revisions
        WHERE id = ? AND document_id = ? AND project_id = ?
      `).get(current.current_revision_id, document.id, document.project_id);
      if (!parent) throw new CloudError('temporary_service_failure');
      this._beforeCommit(input.beforeCommit);
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
        restored_from_revision_id: currentSource.id,
      };
    })).immediate();
  }

  async listDocuments(input) {
    input = input || {};
    const projects = this.db.prepare(`
          SELECT p.* FROM cloud_projects p
          JOIN cloud_workspaces w ON w.id = p.workspace_id AND w.deleted_at_ms IS NULL
          JOIN cloud_workspace_memberships m ON m.workspace_id = p.workspace_id
          WHERE m.user_id = ? AND m.status = 'active' AND p.deleted_at_ms IS NULL
            AND (? IS NULL OR p.workspace_id = ?)
            AND (? IS NULL OR p.id = ?)
          ORDER BY p.id
        `).all(input.userId, input.workspaceId || null, input.workspaceId || null,
          input.projectId || null, input.projectId || null);
    const results = [];
    for (const project of projects) {
      const projectName = await this._decryptProjectName(project);
      const rows = this.db.prepare(`
        SELECT d.*, r.*, d.created_by_user_id AS document_created_by_user_id
        FROM cloud_documents d
        JOIN cloud_document_revisions r ON r.id = d.current_revision_id
        WHERE d.workspace_id = ? AND d.project_id = ? AND d.deleted_at_ms IS NULL
        ORDER BY d.updated_at_ms DESC, d.id
      `).all(project.workspace_id, project.id);
      for (const row of rows) {
        try { this._requireDocument(input.userId, row.document_id, 'viewer'); }
        catch (error) {
          if (error.code === 'resource_unavailable') continue;
          throw error;
        }
        const content = await this._decryptRevision(row);
        results.push({
          ...this._documentResult(row.document_id, content.metadata, row.revision_number,
            row.id, row.updated_at_ms, { id: project.id, name: projectName }),
          created_by_user_id: row.document_created_by_user_id,
          shared_with_me: row.document_created_by_user_id !== input.userId,
        });
      }
    }
    results.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
    return results;
  }

  async listDeletedDocuments(input) {
    input = input || {};
    const rows = this.db.prepare(`
      SELECT d.*, r.*, p.id AS name_project_id, p.workspace_id AS name_workspace_id,
        p.name_ciphertext, p.name_nonce
      FROM cloud_documents d
      JOIN cloud_document_revisions r ON r.id = d.current_revision_id
      JOIN cloud_projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id
      JOIN cloud_workspaces w ON w.id = d.workspace_id AND w.deleted_at_ms IS NULL
      JOIN cloud_workspace_memberships m ON m.workspace_id = d.workspace_id
      WHERE m.user_id = ? AND m.status = 'active' AND p.deleted_at_ms IS NULL
        AND d.deleted_at_ms IS NOT NULL AND d.purge_after_ms > ?
        AND (? IS NULL OR d.workspace_id = ?)
      ORDER BY d.deleted_at_ms DESC, d.id
    `).all(input.userId, this.now(), input.workspaceId || null, input.workspaceId || null);
    const results = [];
    for (const row of rows) {
      try { this._requireDocument(input.userId, row.document_id, 'editor', true); }
      catch (error) {
        if (error.code === 'resource_unavailable') continue;
        throw error;
      }
      const content = await this._decryptRevision(row);
      const projectName = await this._decryptProjectName({
        id: row.name_project_id, workspace_id: row.name_workspace_id,
        name_ciphertext: row.name_ciphertext, name_nonce: row.name_nonce,
      });
      results.push({
        ...this._documentResult(row.document_id, content.metadata, row.revision_number, row.id,
          row.updated_at_ms, { id: row.project_id, name: projectName }),
        workspace_id: row.workspace_id,
        deleted_at: new Date(row.deleted_at_ms).toISOString(),
        purge_after: new Date(row.purge_after_ms).toISOString(),
      });
    }
    return results;
  }

  pageDocuments(documents, input) {
    input = input || {};
    const limit = normalizeLimit(input.limit);
    let values = documents || [];
    if (!Array.isArray(values)) throw new CloudError('invalid_request', 'documents must be an array');
    if (input.after) {
      const updatedAt = input.after.updated_at;
      const id = input.after.id;
      if (typeof updatedAt !== 'string' || typeof id !== 'string') {
        throw new CloudError('invalid_request', 'document cursor is invalid');
      }
      values = values.filter((document) => document.updated_at < updatedAt ||
        (document.updated_at === updatedAt && document.id > id));
    }
    const documentsPage = values.slice(0, limit);
    const last = documentsPage[documentsPage.length - 1];
    return {
      documents: documentsPage,
      nextPosition: values.length > limit && last
        ? { updated_at: last.updated_at, id: last.id }
        : null,
    };
  }

  async listDocumentsPage(input) {
    input = input || {};
    return this.pageDocuments(await this.listDocuments(input), input);
  }

  async listTags(input) {
    const counts = new Map();
    (await this.listDocuments(input || {})).forEach((document) => {
      document.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts, ([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async search(input) {
    input = input || {};
    const query = requireText(input.query, 'query', 256).toLowerCase();
    const requiredTags = normalizeTags(input.tags);
    const limit = Math.max(1, Math.min(Number(input.limit) || 50, 100));
    const maxProjects = Math.max(1, Math.min(Number(input.maxProjects) || 50, 500));
    const maxDocuments = Math.max(1, Math.min(Number(input.maxDocuments) || 1000, 10000));
    const maxBytes = Math.max(1024, Math.min(Number(input.maxBytes) || 50 * 1024 * 1024,
      1024 * 1024 * 1024));
    const deadlineMs = Math.max(50, Math.min(Number(input.deadlineMs) || 2000, 30000));
    const startedAt = Date.now();
    const projects = this.db.prepare(`
          SELECT p.* FROM cloud_projects p
          JOIN cloud_workspaces w ON w.id = p.workspace_id AND w.deleted_at_ms IS NULL
          JOIN cloud_workspace_memberships m ON m.workspace_id = p.workspace_id
          WHERE m.user_id = ? AND m.status = 'active' AND p.deleted_at_ms IS NULL
            AND (? IS NULL OR p.workspace_id = ?)
            AND (? IS NULL OR p.id = ?)
          ORDER BY p.id
        `).all(input.userId, input.workspaceId || null, input.workspaceId || null,
          input.projectId || null, input.projectId || null);
    if (projects.length > maxProjects) throw new CloudError('search_limit_reached');
    const results = [];
    let scannedDocuments = 0;
    let scannedBytes = 0;
    for (const project of projects) {
      const projectName = await this._decryptProjectName(project);
      if (Date.now() - startedAt > deadlineMs) throw new CloudError('search_limit_reached');
      const rows = this.db.prepare(`
        SELECT d.*, r.*, d.created_by_user_id AS document_created_by_user_id
        FROM cloud_documents d
        JOIN cloud_document_revisions r ON r.id = d.current_revision_id
        WHERE d.workspace_id = ? AND d.project_id = ? AND d.deleted_at_ms IS NULL
        ORDER BY d.updated_at_ms DESC, d.id
      `).all(project.workspace_id, project.id);
      for (const row of rows) {
        try { this._requireDocument(input.userId, row.document_id, 'viewer'); }
        catch (error) {
          if (error.code === 'resource_unavailable') continue;
          throw error;
        }
        scannedDocuments += 1;
        scannedBytes += Number(row.uncompressed_size) || 0;
        if (scannedDocuments > maxDocuments || scannedBytes > maxBytes || Date.now() - startedAt > deadlineMs) {
          throw new CloudError('search_limit_reached');
        }
        const content = await this._decryptRevision(row);
        if (Date.now() - startedAt > deadlineMs) throw new CloudError('search_limit_reached');
        if (!requiredTags.every((tag) => content.metadata.tags.includes(tag))) continue;
        const fields = [content.metadata.title, content.metadata.filename,
          content.metadata.tags.join(' '), content.markdown];
        if (fields.join('\n').toLowerCase().indexOf(query) < 0) continue;
        const bodyIndex = content.markdown.toLowerCase().indexOf(query);
        const start = Math.max(0, bodyIndex - 60);
        const snippet = bodyIndex < 0 ? '' : content.markdown.slice(start,
          bodyIndex + query.length + 100).replace(/\s+/g, ' ').trim();
        const line = bodyIndex < 0 ? null : content.markdown.slice(0, bodyIndex).split('\n').length;
        results.push({ ...this._documentResult(row.document_id, content.metadata,
          row.revision_number, row.id, row.updated_at_ms, { id: project.id, name: projectName }),
          created_by_user_id: row.document_created_by_user_id,
          shared_with_me: row.document_created_by_user_id !== input.userId,
          matches: [{ field: bodyIndex < 0 ? 'metadata' : 'body', line, snippet }] });
      }
    }
    results.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
    return results.slice(0, limit);
  }

  deleteDocument(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor', true).row;
    if (document.current_revision_id !== input.expectedHeadRevisionId) {
      throw new CloudError('revision_conflict', null, { currentRevisionId: document.current_revision_id });
    }
    if (document.deleted_at_ms != null) {
      return { id: document.id, deleted_at: new Date(document.deleted_at_ms).toISOString(),
        purge_after: new Date(document.purge_after_ms).toISOString() };
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

  async restoreDeletedDocument(input) {
    input = input || {};
    const document = this._requireDocument(input.userId, input.documentId, 'editor', true).row;
    if (document.deleted_at_ms == null || document.purge_after_ms <= this.now()) {
      throw new CloudError('resource_unavailable');
    }
    if (document.current_revision_id !== input.expectedHeadRevisionId) {
      throw new CloudError('revision_conflict', null, { documentId: document.id,
        baseRevisionId: input.expectedHeadRevisionId || null,
        currentRevisionId: document.current_revision_id });
    }
    const prepared = await this.getDocument({ userId: input.userId, documentId: document.id,
      includeDeleted: true });
    return this.db.transaction(() => {
      const current = this._requireDocument(input.userId, document.id, 'editor', true).row;
      const now = this.now();
      if (current.deleted_at_ms == null || current.purge_after_ms <= now) {
        throw new CloudError('resource_unavailable');
      }
      if (current.current_revision_id !== input.expectedHeadRevisionId) {
        throw new CloudError('revision_conflict', null, { documentId: current.id,
          baseRevisionId: input.expectedHeadRevisionId || null,
          currentRevisionId: current.current_revision_id });
      }
      this._beforeCommit(input.beforeCommit);
      const result = this.db.prepare(`
        UPDATE cloud_documents SET deleted_at_ms = NULL, purge_after_ms = NULL, updated_at_ms = ?
        WHERE id = ? AND current_revision_id = ? AND deleted_at_ms IS NOT NULL AND purge_after_ms > ?
      `).run(now, current.id, input.expectedHeadRevisionId, now);
      if (result.changes !== 1) throw new CloudError('resource_unavailable');
      this._audit({ workspaceId: current.workspace_id, projectId: current.project_id,
        userId: input.userId, action: 'document.restore', resourceId: current.id });
      return { ...prepared, updated_at: new Date(now).toISOString() };
    }).immediate();
  }

  purgeDeletedDocuments(input) {
    input = input || {};
    const beforeMs = Number.isFinite(input.beforeMs) ? input.beforeMs : this.now();
    const limit = Math.max(1, Math.min(Number(input.limit) || 100, 1000));
    return this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT id, workspace_id, project_id FROM cloud_documents
        WHERE deleted_at_ms IS NOT NULL AND purge_after_ms <= ?
        ORDER BY purge_after_ms, id LIMIT ?
      `).all(beforeMs, limit);
      const remove = this.db.prepare(`
        DELETE FROM cloud_documents
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND deleted_at_ms IS NOT NULL AND purge_after_ms <= ?
      `);
      let purged = 0;
      rows.forEach((row) => {
        const result = remove.run(row.id, row.workspace_id, row.project_id, beforeMs);
        purged += result.changes;
        if (result.changes) this._audit({ workspaceId: row.workspace_id,
          projectId: row.project_id, userId: input.actorUserId || 'system',
          action: 'document.purge', resourceId: row.id });
      });
      return { purged_count: purged };
    }).immediate();
  }

  async exportWorkspace(input) {
    input = input || {};
    const role = this._workspaceRole(input.userId, input.workspaceId);
    if (role !== 'owner') throw new CloudError('permission_denied');
    const workspace = (await this.listWorkspaces(input.userId)).find((item) => item.id === input.workspaceId);
    if (!workspace) throw new CloudError('resource_unavailable');
    const projects = await this.listProjects(input.userId, input.workspaceId);
    const documents = [];
    for (const project of projects) {
      const summaries = await this.listDocuments({ userId: input.userId, projectId: project.id });
      for (const summary of summaries) {
        const current = await this.getDocument({ userId: input.userId, documentId: summary.id });
        const revisions = [];
        if (input.includeRevisions !== false) {
          for (const revision of this.listRevisions({ userId: input.userId, documentId: summary.id })) {
            revisions.push(await this.getDocument({ userId: input.userId,
              documentId: summary.id, revisionId: revision.id, includeDeleted: true }));
          }
        }
        documents.push({ ...current, revisions });
      }
    }
    if (this._workspaceRole(input.userId, input.workspaceId) !== 'owner') {
      throw new CloudError('permission_denied');
    }
    this._audit({ workspaceId: input.workspaceId, userId: input.userId,
      action: 'workspace.export', resourceId: input.workspaceId });
    return { exported_at: new Date(this.now()).toISOString(), workspace, projects, documents };
  }

  listAuditEvents(input) {
    input = input || {};
    const role = this._workspaceRole(input.userId, input.workspaceId);
    if (role !== 'owner' && role !== 'admin') throw new CloudError('permission_denied');
    const limit = Math.max(1, Math.min(Number(input.limit) || 100, 500));
    return this.db.prepare(`
      SELECT id, project_id, actor_user_id, actor_credential_id, action,
             resource_id, result, created_at_ms
      FROM cloud_audit_events WHERE workspace_id = ?
      ORDER BY created_at_ms DESC, id DESC LIMIT ?
    `).all(input.workspaceId, limit).map((row) => ({
      id: row.id, project_id: row.project_id, actor_user_id: row.actor_user_id,
      actor_credential_id: row.actor_credential_id, action: row.action,
      resource_id: row.resource_id, result: row.result,
      created_at: new Date(row.created_at_ms).toISOString(),
    }));
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

  pageRevisions(revisions, input) {
    input = input || {};
    const limit = normalizeLimit(input.limit);
    let values = revisions || [];
    if (!Array.isArray(values)) throw new CloudError('invalid_request', 'revisions must be an array');
    if (input.after) {
      const revisionNumber = input.after.revision_number;
      const id = input.after.id;
      if (!Number.isSafeInteger(revisionNumber) || typeof id !== 'string') {
        throw new CloudError('invalid_request', 'revision cursor is invalid');
      }
      values = values.filter((revision) => revision.revision_number < revisionNumber ||
        (revision.revision_number === revisionNumber && revision.id > id));
    }
    const revisionsPage = values.slice(0, limit);
    const last = revisionsPage[revisionsPage.length - 1];
    return {
      revisions: revisionsPage,
      nextPosition: values.length > limit && last
        ? { revision_number: last.revision_number, id: last.id }
        : null,
    };
  }

  listRevisionsPage(input) {
    input = input || {};
    return this.pageRevisions(this.listRevisions(input), input);
  }

  pruneRevisions(input) {
    input = input || {};
    const keepPrevious = Number(input.keepPrevious);
    const retainAfterMs = Number(input.retainAfterMs);
    if (!Number.isInteger(keepPrevious) || keepPrevious < 0) {
      throw new CloudError('invalid_request', 'keepPrevious must be a non-negative integer');
    }
    if (!Number.isSafeInteger(retainAfterMs) || retainAfterMs < 0) {
      throw new CloudError('invalid_request', 'retainAfterMs must be a millisecond timestamp');
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
          AND (
            created_at_ms < ?
            OR id NOT IN (
            SELECT id FROM cloud_document_revisions
            WHERE workspace_id = ? AND project_id = ? AND document_id = ?
              AND id <> ?
            ORDER BY revision_number DESC
            LIMIT ?
            )
          )
      `).run(document.workspace_id, document.project_id, document.id,
        document.current_revision_id, retainAfterMs, document.workspace_id, document.project_id,
        document.id, document.current_revision_id, keepPrevious);
      const retained = this.db.prepare(`
        SELECT COUNT(*) AS count FROM cloud_document_revisions
        WHERE workspace_id = ? AND project_id = ? AND document_id = ?
      `).get(document.workspace_id, document.project_id, document.id).count;
      const oldestPrevious = this.db.prepare(`
        SELECT MIN(created_at_ms) AS created_at_ms FROM cloud_document_revisions
        WHERE workspace_id = ? AND project_id = ? AND document_id = ? AND id <> ?
      `).get(document.workspace_id, document.project_id, document.id,
        document.current_revision_id);
      return {
        document_id: document.id,
        current_revision_id: document.current_revision_id,
        deleted_count: removed.changes,
        retained_count: retained,
        oldest_retained_previous_created_at_ms: oldestPrevious.created_at_ms,
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
  normalizeInviteDomain,
  defaultInviteDomainFromEmail,
};
