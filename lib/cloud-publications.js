'use strict';

const crypto = require('crypto');
const yaml = require('../cli/shared/sdocs-yaml');
const styles = require('../cli/shared/sdocs-styles');
const { slugify } = require('../cli/shared/sdocs-slugify');
const { CloudError } = require('./cloud-store');
const comments = require('./cloud-comments');
const PUBLIC_STYLE_SCHEMA = JSON.parse(JSON.stringify(styles.STYLE_DEFAULTS));
for (const path of Object.keys(styles.STYLE_PATH_TO_VAR).concat('chart.palette')) {
  const parts = path.split('.');
  let target = PUBLIC_STYLE_SCHEMA;
  for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {});
  if (target[parts[parts.length - 1]] === undefined) target[parts[parts.length - 1]] = '';
}

function required(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new CloudError('invalid_request');
  return value.trim();
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}

// A public copy carries document styling, never arbitrary front matter. Use the
// existing style schema to keep private fields out of nested objects as well.
function publicStyles(value, schema = PUBLIC_STYLE_SCHEMA, theme = false) {
  const output = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const key of Object.keys(schema)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const item = value[key];
    if (schema[key] && typeof schema[key] === 'object') {
      const child = publicStyles(item, schema[key]);
      if (Object.keys(child).length) output[key] = child;
    } else if (typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)) output[key] = item;
  }
  if (schema === PUBLIC_STYLE_SCHEMA && !theme) {
    for (const key of ['light', 'dark']) {
      const child = publicStyles(value[key], schema, true);
      if (Object.keys(child).length) output[key] = child;
    }
  }
  return output;
}

function publicSnapshot(markdown) {
  const state = comments.snapshot(markdown);
  const title = typeof state.meta.title === 'string' && state.meta.title.trim()
    ? state.meta.title.trim().slice(0, 512)
    : ((/^\s*#\s+(.+?)\s*$/m.exec(state.body) || [])[1] || 'Untitled document').slice(0, 512);
  const description = typeof state.meta.description === 'string' ? state.meta.description.trim().slice(0, 512) : '';
  const selectedStyles = publicStyles(state.meta.styles);
  const publicMarkdown = (Object.keys(selectedStyles).length ? yaml.serializeFrontMatter({ styles: selectedStyles }) + '\n' : '') + state.body;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(ordered({ title, description,
    body: state.body, styles: selectedStyles }))).digest('hex');
  return { markdown: publicMarkdown, title, description, fingerprint };
}

class CloudPublications {
  constructor(options) {
    this.store = options.store;
    this.db = this.store.db;
    this.origin = new URL(options.origin).origin;
    this.renderPage = options.renderPage;
    this.now = options.now || this.store.now;
    this.randomId = options.randomId || (() => crypto.randomBytes(12).toString('base64url'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_publications (
        document_id TEXT PRIMARY KEY REFERENCES cloud_documents(id) ON DELETE CASCADE,
        public_id TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        published_revision_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        rendered_html TEXT,
        published_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        generation INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS cloud_publication_receipts (
        document_id TEXT NOT NULL REFERENCES cloud_documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        PRIMARY KEY(document_id,user_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS cloud_publication_withdrawals (
        document_id TEXT PRIMARY KEY REFERENCES cloud_documents(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL DEFAULT 1
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS cloud_publications_date ON cloud_publications(active,published_at_ms DESC,slug DESC)');
    const columns = new Set(this.db.prepare('PRAGMA table_info(cloud_publications)').all().map(column => column.name));
    if (!columns.has('public_source')) this.db.exec('ALTER TABLE cloud_publications ADD COLUMN public_source TEXT');
    if (!columns.has('renderer_version')) this.db.exec('ALTER TABLE cloud_publications ADD COLUMN renderer_version TEXT');
    if (!columns.has('rendered_styles')) this.db.exec('ALTER TABLE cloud_publications ADD COLUMN rendered_styles TEXT');
    if (!columns.has('public_source') || !columns.has('rendered_styles')) this.db.exec('DROP TRIGGER IF EXISTS cloud_publication_document_withdraw; DROP TRIGGER IF EXISTS cloud_publication_project_withdraw; DROP TRIGGER IF EXISTS cloud_publication_workspace_withdraw;');
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS cloud_publication_document_withdraw
        AFTER UPDATE OF deleted_at_ms ON cloud_documents WHEN NEW.deleted_at_ms IS NOT NULL
        BEGIN UPDATE cloud_publications SET active=0,rendered_html=NULL,public_source=NULL,rendered_styles=NULL,generation=generation+1
          WHERE document_id=NEW.id;
          INSERT INTO cloud_publication_withdrawals(document_id,generation) VALUES(NEW.id,1)
          ON CONFLICT(document_id) DO UPDATE SET generation=generation+1; END;
      CREATE TRIGGER IF NOT EXISTS cloud_publication_project_withdraw
        AFTER UPDATE OF deleted_at_ms ON cloud_projects WHEN NEW.deleted_at_ms IS NOT NULL
        BEGIN UPDATE cloud_publications SET active=0,rendered_html=NULL,public_source=NULL,rendered_styles=NULL,generation=generation+1
          WHERE document_id IN (SELECT id FROM cloud_documents WHERE project_id=NEW.id);
          INSERT INTO cloud_publication_withdrawals(document_id,generation)
          SELECT id,1 FROM cloud_documents WHERE project_id=NEW.id
          ON CONFLICT(document_id) DO UPDATE SET generation=generation+1; END;
      CREATE TRIGGER IF NOT EXISTS cloud_publication_workspace_withdraw
        AFTER UPDATE OF deleted_at_ms ON cloud_workspaces WHEN NEW.deleted_at_ms IS NOT NULL
        BEGIN UPDATE cloud_publications SET active=0,rendered_html=NULL,public_source=NULL,rendered_styles=NULL,generation=generation+1
          WHERE document_id IN (SELECT id FROM cloud_documents WHERE workspace_id=NEW.id);
          INSERT INTO cloud_publication_withdrawals(document_id,generation)
          SELECT id,1 FROM cloud_documents WHERE workspace_id=NEW.id
          ON CONFLICT(document_id) DO UPDATE SET generation=generation+1; END;
    `);
  }

  _document(userId, documentId, manage = false) {
    const document = this.store._requireDocument(userId, documentId, 'viewer').row;
    if (manage && document.created_by_user_id !== userId) throw new CloudError('permission_denied');
    return document;
  }

  _row(documentId) { return this.db.prepare('SELECT * FROM cloud_publications WHERE document_id=?').get(documentId); }
  _withdrawalVersion(documentId) {
    const row = this.db.prepare('SELECT generation FROM cloud_publication_withdrawals WHERE document_id=?').get(documentId);
    return row ? row.generation : 0;
  }

  _status(document, userId, fingerprint) {
    const row = this._row(document.id);
    const canManage = document.created_by_user_id === userId;
    return { can_publish: canManage, can_unpublish: Boolean(canManage && row && row.active),
      head_revision_id: document.current_revision_id,
      publication: row ? { url: this.origin + '/p/' + row.slug,
        published_revision_id: row.published_revision_id, published_at_ms: row.published_at_ms,
        updated_at_ms: row.updated_at_ms, active: Boolean(row.active),
        status: row.active ? 'published' : 'unpublished',
        is_current: Boolean(row.active && (fingerprint ? row.fingerprint === fingerprint
          : row.published_revision_id === document.current_revision_id)), can_manage: canManage } : null };
  }

  statusMetadata(input) {
    const document = this._document(input.userId, input.documentId);
    if (input.beforeCommit) input.beforeCommit(document);
    return this._status(document, input.userId);
  }

  async status(input) {
    const before = this._document(input.userId, input.documentId);
    const document = await this.store.getDocument({ userId: input.userId, documentId: input.documentId });
    const current = this._document(input.userId, input.documentId);
    if (before.workspace_id !== current.workspace_id || before.project_id !== current.project_id ||
        current.current_revision_id !== document.current_revision_id) throw new CloudError('resource_unavailable');
    if (input.beforeCommit) input.beforeCommit(current);
    return this._status(current, input.userId, publicSnapshot(document.markdown).fingerprint);
  }

  _receipt(input, revisionId) {
    const row = this.db.prepare(`SELECT revision_id FROM cloud_publication_receipts
      WHERE document_id=? AND user_id=? AND idempotency_key=?`).get(input.documentId, input.userId, input.idempotencyKey);
    if (row && row.revision_id !== revisionId) throw new CloudError('idempotency_mismatch');
    return row;
  }

  async publish(input) {
    const revisionId = required(input.expectedRevisionId);
    input = { ...input, idempotencyKey: required(input.idempotencyKey) };
    const before = this._document(input.userId, input.documentId, true);
    if (input.beforeCommit) input.beforeCommit(before);
    if (this._receipt(input, revisionId)) return this.status(input);
    if (before.current_revision_id !== revisionId) throw new CloudError('revision_conflict');
    const prior = this._row(input.documentId);
    const withdrawalVersion = this._withdrawalVersion(input.documentId);
    const document = await this.store.getDocument({ userId: input.userId, documentId: input.documentId, revisionId });
    const snapshot = publicSnapshot(document.markdown);
    const now = this.now();
    const publicId = prior ? prior.public_id : this.randomId();
    const slug = prior ? prior.slug : (slugify(snapshot.title).slice(0, 96) || 'document') + '-' + publicId;
    const publishedAt = prior ? prior.published_at_ms : now;
    const source = { markdown: snapshot.markdown, title: snapshot.title,
      description: snapshot.description, url: this.origin + '/p/' + slug,
      publishedAt, updatedAt: now, authorName: input.authorName || '' };
    const rendered = await this.renderPage(source);
    const html = typeof rendered === 'string' ? rendered : rendered && rendered.html;
    const rendererVersion = typeof rendered === 'object' && rendered.rendererVersion || 'legacy';
    if (typeof html !== 'string') throw new CloudError('temporary_service_failure');
    return this.db.transaction(() => {
      const current = this._document(input.userId, input.documentId, true);
      if (input.beforeCommit) input.beforeCommit(current);
      if (this._receipt(input, revisionId)) return this._status(current, input.userId, snapshot.fingerprint);
      const existing = this._row(input.documentId);
      if (current.workspace_id !== before.workspace_id || current.project_id !== before.project_id ||
          current.current_revision_id !== revisionId || this._withdrawalVersion(input.documentId) !== withdrawalVersion ||
          (existing ? existing.generation : 0) !== (prior ? prior.generation : 0)) {
        throw new CloudError('revision_conflict');
      }
      this.db.prepare(`INSERT INTO cloud_publications
        (document_id,public_id,slug,published_revision_id,fingerprint,rendered_html,published_at_ms,updated_at_ms,public_source,renderer_version,rendered_styles,active,generation)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1) ON CONFLICT(document_id) DO UPDATE SET
        published_revision_id=excluded.published_revision_id,fingerprint=excluded.fingerprint,
        rendered_html=excluded.rendered_html,public_source=excluded.public_source,renderer_version=excluded.renderer_version,rendered_styles=excluded.rendered_styles,
        updated_at_ms=excluded.updated_at_ms,active=1,generation=generation+1`)
        .run(input.documentId, publicId, slug, revisionId, snapshot.fingerprint, html, publishedAt, now, JSON.stringify(source), rendererVersion,JSON.stringify(rendered.styles||{}));
      this.db.prepare(`INSERT INTO cloud_publication_receipts(document_id,user_id,idempotency_key,revision_id)
        VALUES (?,?,?,?)`).run(input.documentId, input.userId, input.idempotencyKey, revisionId);
      this.store._audit({ workspaceId: current.workspace_id, projectId: current.project_id,
        userId: input.userId, action: 'document.publish', resourceId: input.documentId });
      return this._status(current, input.userId, snapshot.fingerprint);
    })();
  }

  unpublish(input) {
    return this.db.transaction(() => {
      const document = this._document(input.userId, input.documentId, true);
      if (input.beforeCommit) input.beforeCommit(document);
      this.db.prepare(`INSERT INTO cloud_publication_withdrawals(document_id,generation) VALUES(?,1)
        ON CONFLICT(document_id) DO UPDATE SET generation=generation+1`).run(input.documentId);
      this.db.prepare(`UPDATE cloud_publications SET active=0,rendered_html=NULL,public_source=NULL,rendered_styles=NULL,
        generation=generation+1,updated_at_ms=? WHERE document_id=? AND active=1`).run(this.now(), input.documentId);
      this.store._audit({ workspaceId: document.workspace_id, projectId: document.project_id,
        userId: input.userId, action: 'document.unpublish', resourceId: input.documentId });
      return this._status(document, input.userId);
    })();
  }

  getPublic(slug) {
    return this.db.prepare(`SELECT p.document_id,p.slug,p.rendered_html,p.public_source,p.renderer_version,p.rendered_styles,p.generation,p.published_revision_id,p.active,p.published_at_ms,p.updated_at_ms,
      d.deleted_at_ms AS document_deleted,pr.deleted_at_ms AS project_deleted,w.deleted_at_ms AS workspace_deleted
      FROM cloud_publications p JOIN cloud_documents d ON d.id=p.document_id
      JOIN cloud_projects pr ON pr.id=d.project_id JOIN cloud_workspaces w ON w.id=d.workspace_id
      WHERE p.slug=?`).get(slug);
  }

  listPublic(options = {}) {
    return this.db.prepare(`SELECT p.slug,p.updated_at_ms FROM cloud_publications p
      JOIN cloud_documents d ON d.id=p.document_id JOIN cloud_projects pr ON pr.id=d.project_id
      JOIN cloud_workspaces w ON w.id=d.workspace_id WHERE p.active=1 AND p.rendered_html IS NOT NULL
      AND d.deleted_at_ms IS NULL AND pr.deleted_at_ms IS NULL AND w.deleted_at_ms IS NULL
      AND (@version IS NULL OR p.renderer_version IS NOT @version)
      ORDER BY p.slug LIMIT @limit OFFSET @offset`).all({ version: options.rendererVersion || null,
        limit: options.limit == null ? -1 : options.limit, offset: options.offset || 0 });
  }

  publicCount() {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM cloud_publications p
      JOIN cloud_documents d ON d.id=p.document_id JOIN cloud_projects pr ON pr.id=d.project_id
      JOIN cloud_workspaces w ON w.id=d.workspace_id WHERE p.active=1 AND p.rendered_html IS NOT NULL
      AND d.deleted_at_ms IS NULL AND pr.deleted_at_ms IS NULL AND w.deleted_at_ms IS NULL`).get().count;
  }

  listPublicPage({ page = 1, limit = 50 } = {}) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isSafeInteger((page - 1) * limit)) throw new CloudError('invalid_request');
    const rows = this.db.prepare(`SELECT p.slug,p.published_at_ms,p.updated_at_ms,
      CASE WHEN json_valid(p.public_source) THEN COALESCE(json_extract(p.public_source,'$.title'),'Published document')
        ELSE 'Published document' END AS title,
      CASE WHEN json_valid(p.public_source) THEN COALESCE(json_extract(p.public_source,'$.description'),'') ELSE '' END AS description
      FROM cloud_publications p JOIN cloud_documents d ON d.id=p.document_id
      JOIN cloud_projects pr ON pr.id=d.project_id JOIN cloud_workspaces w ON w.id=d.workspace_id
      WHERE p.active=1 AND p.rendered_html IS NOT NULL
      AND d.deleted_at_ms IS NULL AND pr.deleted_at_ms IS NULL AND w.deleted_at_ms IS NULL
      ORDER BY p.published_at_ms DESC,p.slug DESC LIMIT ? OFFSET ?`).all(limit + 1, (page - 1) * limit);
    return { items: rows.slice(0, limit), page, has_next: rows.length > limit, has_previous: page > 1 };
  }

  async rebuildPublished(slug) {
    const before=this.getPublic(slug);
    if(!before || !before.active || before.document_deleted!=null || before.project_deleted!=null || before.workspace_deleted!=null) return false;
    const source=require('./publication-shell').publicationSource(before,this.origin);
    const rendered=await this.renderPage(source);
    if(!rendered || typeof rendered.html!=='string') throw new CloudError('temporary_service_failure');
    return this.db.transaction(()=>{
      const current=this.getPublic(slug);
      if(!current || !current.active || current.document_deleted!=null || current.project_deleted!=null || current.workspace_deleted!=null ||
        current.generation!==before.generation || current.published_revision_id!==before.published_revision_id) return false;
      this.db.prepare('UPDATE cloud_publications SET rendered_html=?,public_source=?,renderer_version=?,rendered_styles=? WHERE slug=?')
        .run(rendered.html,JSON.stringify(source),rendered.rendererVersion,JSON.stringify(rendered.styles||{}),slug);
      return true;
    })();
  }
}

module.exports = { CloudPublications, publicSnapshot };
