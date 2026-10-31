const crypto = require('crypto');
const SDocYaml = require('../cli/shared/sdocs-yaml');

// The database stores keyed term equality and positions, never plaintext words.
// This leaks term frequency, document membership and word order. See
// maintainers/cloud-search.md for the threat model and rebuild procedure.
const VERSION = 3;
const FIELDS = ['title', 'filename', 'tags', 'body'];
const WEIGHTS = [8, 5, 6, 1];

function failure(message, code) {
  return Object.assign(new Error(message), { code: code || 'invalid_request' });
}

function fold(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

function* iterateWords(value) {
  for (const match of String(value).matchAll(/[\p{L}\p{N}\p{M}_]+/gu)) {
    // Compatibility forms can expand into several words. Retain the original
    // span so snippets still point to the source character or sequence.
    for (const normalized of fold(match[0]).matchAll(/[\p{L}\p{N}\p{M}_]+/gu)) {
      yield { value: normalized[0], offset: match.index, length: match[0].length };
    }
  }
}

function words(value) { return Array.from(iterateWords(value)); }

// Raw runs preserve literal matching, including punctuation and decomposed Unicode.
// Split query anchors at newlines because selected fields are joined by synthetic
// newlines at verification time. An anchor must not depend on those boundaries.
function literalRuns(value) {
  return String(value).toLowerCase().match(/[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_]+/gu) || [];
}
function literalGrams(value) {
  const grams = new Set();
  for (let offset = 0; offset < value.length; offset++) {
    for (let size = 1; size <= 3 && offset + size <= value.length; size++) grams.add(value.slice(offset, offset + size));
  }
  return grams;
}

function searchKey(key) {
  return crypto.createHmac('sha256', key).update('sdocs-cloud-search-key-v1').digest();
}

function digest(key, kind, value) {
  return crypto.createHmac('sha256', key).update(kind).update('\0').update(kind === 'literal-gram' || kind === 'literal-term' ? Buffer.from(value, 'utf16le') : value).digest();
}

function encodePositions(values) {
  const output = [];
  let previous = 0;
  for (const position of values) {
    let delta = position - previous;
    do {
      const low = delta & 127;
      delta = Math.floor(delta / 128);
      output.push(low | (delta ? 128 : 0));
    } while (delta);
    previous = position;
  }
  return Buffer.from(output);
}

function decodePositions(value) {
  const output = [];
  let previous = 0;
  let delta = 0;
  let shift = 0;
  for (const byte of value) {
    delta += (byte & 127) * Math.pow(2, shift);
    if (byte & 128) { shift += 7; continue; }
    previous += delta;
    output.push(previous);
    delta = 0;
    shift = 0;
  }
  return output;
}

function tagAad(environment, projectId, hash, kind) {
  return Buffer.from(['sdocs-cloud-search', environment, projectId, kind || 'tag-v1', hash.toString('hex')].join('\0'));
}

function sealTag(key, value, aad, randomBytes) {
  const nonce = randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return { nonce, ciphertext: Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]) };
}

function openTag(key, row, environment, kind) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, row.nonce);
    decipher.setAAD(tagAad(environment, row.project_id, row.tag_hash, kind));
    decipher.setAuthTag(row.ciphertext.subarray(-16));
    return Buffer.concat([decipher.update(row.ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8');
  } catch (_) {
    throw failure('search metadata could not be authenticated', 'temporary_service_failure');
  }
}

class CloudSearchIndex {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_search_documents (
        id INTEGER PRIMARY KEY,
        document_id TEXT NOT NULL UNIQUE REFERENCES cloud_documents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
        head_revision_id TEXT NOT NULL,
        format_version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_search_documents_project_idx ON cloud_search_documents(project_id, id);
      CREATE TABLE IF NOT EXISTS cloud_search_terms (
        id INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
        term_hash BLOB NOT NULL,
        ciphertext BLOB,
        nonce BLOB,
        UNIQUE(project_id, term_hash)
      );
      CREATE TABLE IF NOT EXISTS cloud_search_term_features (
        feature_hash BLOB NOT NULL,
        term_id INTEGER NOT NULL REFERENCES cloud_search_terms(id) ON DELETE CASCADE,
        PRIMARY KEY(feature_hash, term_id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS cloud_search_postings (
        term_id INTEGER NOT NULL REFERENCES cloud_search_terms(id) ON DELETE CASCADE,
        search_document_id INTEGER NOT NULL REFERENCES cloud_search_documents(id) ON DELETE CASCADE,
        field INTEGER NOT NULL,
        positions BLOB NOT NULL,
        PRIMARY KEY(term_id, search_document_id, field)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS cloud_search_postings_document_idx ON cloud_search_postings(search_document_id);
      CREATE TABLE IF NOT EXISTS cloud_search_tags (
        id INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
        tag_hash BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        UNIQUE(project_id, tag_hash)
      );
      CREATE TABLE IF NOT EXISTS cloud_search_document_tags (
        search_document_id INTEGER NOT NULL REFERENCES cloud_search_documents(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES cloud_search_tags(id) ON DELETE CASCADE,
        PRIMARY KEY(search_document_id, tag_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS cloud_search_document_tags_tag_idx ON cloud_search_document_tags(tag_id, search_document_id);
    `);
    const columns = this.db.prepare('PRAGMA table_info(cloud_search_terms)').all();
    if (!columns.some((column) => column.name === 'ciphertext')) this.db.exec('ALTER TABLE cloud_search_terms ADD COLUMN ciphertext BLOB');
    if (!columns.some((column) => column.name === 'nonce')) this.db.exec('ALTER TABLE cloud_search_terms ADD COLUMN nonce BLOB');
  }

  prepare(input) {
    const key = searchKey(input.key);
    try {
      const terms = new Map();
      const values = [input.metadata.title, input.metadata.filename, input.metadata.tags.join('\n'), input.markdown];
      values.forEach((value, field) => {
        words(value).forEach((word, position) => {
          if (!terms.has(word.value)) terms.set(word.value, { hash: digest(key, 'term', word.value), fields: new Map() });
          const term = terms.get(word.value);
          if (!term.fields.has(field)) term.fields.set(field, []);
          term.fields.get(field).push(position);
        });
      });
      const literalValues = [input.metadata.title, input.metadata.filename, input.metadata.tags.join(' '), input.markdown];
      literalValues.forEach((value, field) => {
        for (const run of literalRuns(value)) {
          const name = 'literal\0' + run;
          if (!terms.has(name)) terms.set(name, { literal: true, value: run,
            hash: digest(key, 'literal-term', run), fields: new Map() });
          // Literal candidates need document membership, not positions or scores.
          terms.get(name).fields.set(field, []);
        }
      });
      const lookup = this.db.prepare('SELECT id,ciphertext FROM cloud_search_terms WHERE project_id=? AND term_hash=?');
      for (const [word, term] of terms) {
        const existing = lookup.get(input.projectId, term.hash);
        if (existing && existing.ciphertext) { term.id = existing.id; continue; }
        if (term.literal) {
          const encrypted = sealTag(input.key, term.value, tagAad(this.store.environment, input.projectId, term.hash, 'literal-v3'), this.store.randomBytes);
          term.ciphertext = encrypted.ciphertext; term.nonce = encrypted.nonce;
          term.features = Array.from(literalGrams(term.value), gram => digest(key, 'literal-gram', gram));
          continue;
        }
        const encrypted = sealTag(input.key, word, tagAad(this.store.environment, input.projectId, term.hash, 'term-v1'), this.store.randomBytes);
        term.ciphertext = encrypted.ciphertext;
        term.nonce = encrypted.nonce;
        const features = new Set();
        let prefix = '';
        let prefixLength = 0;
        const tail = [];
        for (const character of word) {
          if (prefixLength < 32) {
            prefix += character;
            prefixLength++;
            features.add('prefix\0' + prefix);
          }
          tail.push(character);
          if (tail.length > 3) tail.shift();
          for (let size = 1; size <= tail.length; size++) features.add('gram\0' + tail.slice(-size).join(''));
        }
        term.features = Array.from(features, (feature) => {
          const split = feature.indexOf('\0');
          return digest(key, feature.slice(0, split), feature.slice(split + 1));
        });
      }
      const tags = input.metadata.tags.map((tag) => {
        const hash = digest(key, 'tag', tag);
        return { hash, ...sealTag(input.key, tag, tagAad(this.store.environment, input.projectId, hash), this.store.randomBytes) };
      });
      return { terms: Array.from(terms.values()), tags };
    } finally { key.fill(0); }
  }

  commit(input) {
    this.db.prepare(`INSERT INTO cloud_search_documents(document_id,project_id,head_revision_id,format_version)
      VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET project_id=excluded.project_id,
      head_revision_id=excluded.head_revision_id,format_version=excluded.format_version`)
      .run(input.documentId, input.projectId, input.revisionId, VERSION);
    const documentId = this.db.prepare('SELECT id FROM cloud_search_documents WHERE document_id=?').get(input.documentId).id;
    this.db.prepare('DELETE FROM cloud_search_postings WHERE search_document_id=?').run(documentId);
    this.db.prepare('DELETE FROM cloud_search_document_tags WHERE search_document_id=?').run(documentId);
    const insertTerm = this.db.prepare(`INSERT INTO cloud_search_terms(project_id,term_hash,ciphertext,nonce) VALUES (?,?,?,?)
      ON CONFLICT(project_id,term_hash) DO UPDATE SET ciphertext=coalesce(cloud_search_terms.ciphertext,excluded.ciphertext),nonce=coalesce(cloud_search_terms.nonce,excluded.nonce)`);
    const lookup = this.db.prepare('SELECT id FROM cloud_search_terms WHERE project_id=? AND term_hash=?');
    const insertFeature = this.db.prepare('INSERT OR IGNORE INTO cloud_search_term_features VALUES (?,?)');
    const insertPosting = this.db.prepare('INSERT INTO cloud_search_postings VALUES (?,?,?,?)');
    for (const term of input.prepared.terms) {
      let termId = term.id;
      if (!termId) {
        insertTerm.run(input.projectId, term.hash, term.ciphertext, term.nonce);
        termId = lookup.get(input.projectId, term.hash).id;
        for (const feature of term.features) insertFeature.run(feature, termId);
      }
      for (const [field, positions] of term.fields) insertPosting.run(termId, documentId, field, encodePositions(positions));
    }
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO cloud_search_tags(project_id,tag_hash,ciphertext,nonce) VALUES (?,?,?,?)');
    const findTag = this.db.prepare('SELECT id FROM cloud_search_tags WHERE project_id=? AND tag_hash=?');
    const linkTag = this.db.prepare('INSERT INTO cloud_search_document_tags VALUES (?,?)');
    for (const tag of input.prepared.tags) {
      insertTag.run(input.projectId, tag.hash, tag.ciphertext, tag.nonce);
      linkTag.run(documentId, findTag.get(input.projectId, tag.hash).id);
    }
  }

  scope(input, indexedOnly, includeIndexState) {
    const clauses = ['d.deleted_at_ms IS NULL', 'p.deleted_at_ms IS NULL', 'w.deleted_at_ms IS NULL',
      "m.status='active'", '(d.created_by_user_id=@userId OR g.mode=\'everyone\' OR gm.user_id IS NOT NULL)'];
    const params = { userId: input.userId };
    for (const [key, column] of [['workspaceIds', 'd.workspace_id'], ['documentIds', 'd.id'],
      ['authorUserIds', 'd.created_by_user_id'], ['updatedByUserIds', 'r.created_by_user_id']]) {
      if (input[key] !== undefined) {
        if (!Array.isArray(input[key]) || input[key].some((value) => typeof value !== 'string' || !value)) throw failure(key + ' must be an array of identifiers');
        params[key] = JSON.stringify(input[key]);
        clauses.push(column + ' IN (SELECT value FROM json_each(@' + key + '))');
      }
    }
    if (input.projectId) { clauses.push('d.project_id=@projectId'); params.projectId = input.projectId; }
    if (input.sharedWithMe) clauses.push('d.created_by_user_id<>@userId');
    if (input.starredOnly) clauses.push('EXISTS (SELECT 1 FROM cloud_document_stars st WHERE st.user_id=@userId AND st.document_id=d.id)');
    for (const [key, column, comparison] of [['createdAfter', 'd.created_at_ms', '>='], ['createdBefore', 'd.created_at_ms', '<='],
      ['updatedAfter', 'd.updated_at_ms', '>='], ['updatedBefore', 'd.updated_at_ms', '<=']]) {
      if (input[key] != null) {
        const timestamp = typeof input[key] === 'string' ? Date.parse(input[key]) : NaN;
        if (!Number.isFinite(timestamp)) throw failure(key + ' must be an ISO timestamp');
        clauses.push(column + comparison + '@' + key); params[key] = timestamp;
      }
    }
    if (indexedOnly) clauses.push('s.head_revision_id=d.current_revision_id AND s.project_id=d.project_id AND s.format_version=' + VERSION);
    const needsRevision = input.updatedByUserIds !== undefined;
    return { sql: `SELECT s.id AS sid,d.id,d.workspace_id,d.project_id,d.current_revision_id,
        d.created_by_user_id,${needsRevision ? 'r.created_by_user_id' : 'NULL'} AS updated_by_user_id,d.created_at_ms,d.updated_at_ms
        ${includeIndexState ? ',s.head_revision_id AS indexed_head,s.project_id AS indexed_project,s.format_version AS indexed_version' : ''}
      FROM cloud_documents d ${needsRevision ? 'JOIN cloud_document_revisions r ON r.id=d.current_revision_id' : ''}
      JOIN cloud_projects p ON p.id=d.project_id JOIN cloud_workspaces w ON w.id=d.workspace_id
      JOIN cloud_workspace_memberships m ON m.workspace_id=d.workspace_id AND m.user_id=@userId
      LEFT JOIN cloud_permission_groups g ON g.document_id=d.id
      LEFT JOIN cloud_permission_group_members gm ON gm.permission_group_id=g.id AND gm.user_id=@userId
      LEFT JOIN cloud_search_documents s ON s.document_id=d.id WHERE ` + clauses.join(' AND '), params };
  }

  missing(input) {
    let scope;
    if (input.userId) {
      scope = this.scope(input, false);
      return this.db.prepare(`SELECT a.* FROM (${scope.sql}) a LEFT JOIN cloud_search_documents s ON s.document_id=a.id
        WHERE s.id IS NULL OR s.project_id<>a.project_id OR s.head_revision_id<>a.current_revision_id OR s.format_version<>${VERSION}
        ORDER BY a.id`).all(scope.params);
    }
    const params = {};
    let where = '';
    if (input.workspaceIds !== undefined) { where = ' AND d.workspace_id IN (SELECT value FROM json_each(@workspaces))'; params.workspaces = JSON.stringify(input.workspaceIds); }
    return this.db.prepare(`SELECT d.id,d.project_id,d.workspace_id,d.current_revision_id FROM cloud_documents d
      JOIN cloud_projects p ON p.id=d.project_id AND p.deleted_at_ms IS NULL
      JOIN cloud_workspaces w ON w.id=d.workspace_id AND w.deleted_at_ms IS NULL
      LEFT JOIN cloud_search_documents s ON s.document_id=d.id
      WHERE d.deleted_at_ms IS NULL AND (s.id IS NULL OR s.project_id<>d.project_id OR s.head_revision_id<>d.current_revision_id OR s.format_version<>${VERSION})${where}
      ORDER BY d.id`).all(params);
  }

  async rebuild(input) {
    input = input || {};
    const limit = input.limit == null ? 100 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw failure('rebuild limit must be between 1 and 1000');
    const pending = this.missing(input);
    const after = input.after && (typeof input.after === 'string' ? input.after : input.after.id);
    const batch = pending.filter((row) => !after || row.id > after).slice(0, limit);
    let indexed = 0;
    for (const document of batch) {
      if (input.userId) this.store._requireDocument(input.userId, document.id, 'viewer');
      const row = this.db.prepare('SELECT * FROM cloud_document_revisions WHERE id=? AND document_id=?').get(document.current_revision_id, document.id);
      if (!row) continue;
      const content = await this.store._decryptRevision(row);
      if (input.userId) this.store._requireDocument(input.userId, document.id, 'viewer');
      const key = await this.store._projectKey(document.project_id, row.project_key_version);
      try {
        if (input.userId) this.store._requireDocument(input.userId, document.id, 'viewer');
        const prepared = this.prepare({ key, projectId: document.project_id, markdown: content.markdown, metadata: content.metadata });
        this.db.transaction(() => {
          if (input.userId) this.store._requireDocument(input.userId, document.id, 'viewer');
          const current = this.db.prepare('SELECT project_id,current_revision_id,deleted_at_ms FROM cloud_documents WHERE id=?').get(document.id);
          if (!current || current.deleted_at_ms != null || current.project_id !== document.project_id || current.current_revision_id !== row.id) return;
          this.commit({ documentId: document.id, projectId: document.project_id, revisionId: row.id, prepared });
          indexed++;
        }).immediate();
      } finally { key.fill(0); }
    }
    const remaining = this.missing(input).length;
    return { indexed_count: indexed, remaining_count: remaining, ready: remaining === 0,
      nextPosition: remaining && batch.length ? { id: batch[batch.length - 1].id } : null };
  }

  status(input) {
    const remaining = this.missing(input || {}).length;
    return { format_version: VERSION, ready: remaining === 0, remaining_count: remaining };
  }

  _textLeaf(leaf, table, keys, fields, projectKeys) {
    const allowedFields = leaf.field === 'text' ? fields.map((field) => FIELDS.indexOf(field)) : [FIELDS.indexOf(leaf.field)];
    if (allowedFields.some((field) => field < 0)) throw failure('unknown search field');
    const tokens = words(leaf.value).map((word) => word.value);
    if (!tokens.length || (leaf.match === 'prefix' && tokens.length !== 1)) throw failure('prefix searches require one word');
    if (!['term', 'phrase', 'prefix'].includes(leaf.match)) throw failure('unknown text match');
    const result = new Map();
    for (const [projectId, key] of keys) {
      if (tokens.length === 1) {
        const token = tokens[0];
        const prefix = leaf.match === 'prefix';
        const characters = Array.from(token);
        const longPrefix = prefix && characters.length > 32;
        const rows = this.db.prepare(`SELECT p.search_document_id,p.field,p.positions${longPrefix ? ',t.term_hash,t.ciphertext,t.nonce,t.project_id,t.id AS term_id' : ''} FROM cloud_search_postings p
          JOIN ${table} a ON a.sid=p.search_document_id
          JOIN cloud_search_terms t ON t.id=p.term_id
          ${prefix ? 'JOIN cloud_search_term_features f ON f.term_id=t.id' : ''}
          WHERE t.project_id=? AND a.project_id=? AND ${prefix ? 'f.feature_hash' : 't.term_hash'}=?
            AND p.field IN (SELECT value FROM json_each(?))`).iterate(projectId, projectId,
          digest(key, prefix ? 'prefix' : 'term', longPrefix ? characters.slice(0, 32).join('') : token), JSON.stringify(allowedFields));
        const countMap = new Map();
        const accepted = new Map();
        for (const row of rows) {
          if (longPrefix) {
            if (!accepted.has(row.term_id)) accepted.set(row.term_id,
              openTag(projectKeys.get(projectId), { ...row, tag_hash: row.term_hash }, this.store.environment, 'term-v1').startsWith(token));
            if (!accepted.get(row.term_id)) continue;
          }
          const id = row.search_document_id * FIELDS.length + row.field;
          let count = countMap.get(id) || 0;
          // A terminal varint byte represents one occurrence. Scoring stops at
          // ten occurrences across all matching prefix variants in this field.
          if (count < 10) for (const byte of row.positions) {
            if (!(byte & 128) && ++count === 10) break;
          }
          if (count) countMap.set(id, count);
        }
        for (const [id, occurrences] of countMap) {
          const sid = Math.floor(id / FIELDS.length);
          const field = id % FIELDS.length;
          const score = WEIGHTS[field] * (leaf.match === 'phrase' ? 2 : 1) * (1 + occurrences / 10);
          result.set(sid, (result.get(sid) || 0) + score);
        }
        continue;
      }
      const tokenPostings = tokens.map((token) => {
        const prefix = leaf.match === 'prefix';
        const characters = Array.from(token);
        const longPrefix = prefix && characters.length > 32;
        const rows = this.db.prepare(`SELECT p.search_document_id,p.field,p.positions${longPrefix ? ',t.term_hash,t.ciphertext,t.nonce,t.project_id,t.id AS term_id' : ''} FROM cloud_search_postings p
          JOIN ${table} a ON a.sid=p.search_document_id
          JOIN cloud_search_terms t ON t.id=p.term_id
          ${prefix ? 'JOIN cloud_search_term_features f ON f.term_id=t.id' : ''}
          WHERE t.project_id=? AND a.project_id=? AND ${prefix ? 'f.feature_hash' : 't.term_hash'}=?
            AND p.field IN (SELECT value FROM json_each(?))`).all(projectId, projectId,
          digest(key, prefix ? 'prefix' : 'term', longPrefix ? characters.slice(0, 32).join('') : token), JSON.stringify(allowedFields));
        const positions = new Map();
        const accepted = new Map();
        for (const row of rows) {
          if (longPrefix) {
            if (!accepted.has(row.term_id)) accepted.set(row.term_id,
              openTag(projectKeys.get(projectId), { ...row, tag_hash: row.term_hash }, this.store.environment, 'term-v1').startsWith(token));
            if (!accepted.get(row.term_id)) continue;
          }
          const id = row.search_document_id + ':' + row.field;
          if (!positions.has(id)) positions.set(id, []);
          const values = positions.get(id);
          for (const position of decodePositions(row.positions)) values.push(position);
        }
        return positions;
      });
      for (const [id, starts] of tokenPostings[0]) {
        let occurrences;
        if (tokens.length === 1) occurrences = starts.length;
        else {
          const others = tokenPostings.slice(1).map((postings) => new Set(postings.get(id) || []));
          occurrences = starts.filter((start) => others.every((positions, index) => positions.has(start + index + 1))).length;
        }
        if (!occurrences) continue;
        const [sid, field] = id.split(':').map(Number);
        const score = WEIGHTS[field] * (leaf.match === 'phrase' ? 2 : 1) * (1 + Math.min(occurrences, 10) / 10);
        result.set(sid, (result.get(sid) || 0) + score);
      }
    }
    return result;
  }

  _expression(expression, table, keys, fields, universe, projectKeys) {
    if (!expression) return new Map(Array.from(universe, (sid) => [sid, 0]));
    if (expression.op === 'and' || expression.op === 'or') {
      if (!Array.isArray(expression.clauses) || !expression.clauses.length) throw failure('Boolean search requires clauses');
      const children = expression.clauses.map((clause) => this._expression(clause, table, keys, fields, universe, projectKeys));
      if (expression.op === 'or') {
        const result = new Map();
        for (const child of children) for (const [sid, score] of child) result.set(sid, (result.get(sid) || 0) + score);
        return result;
      }
      children.sort((left, right) => left.size - right.size);
      const result = new Map(children[0]);
      for (const [sid, score] of result) {
        if (children.some((child) => !child.has(sid))) result.delete(sid);
        else result.set(sid, score + children.slice(1).reduce((sum, child) => sum + child.get(sid), 0));
      }
      return result;
    }
    if (expression.op === 'not') {
      if (!expression.clause) throw failure('NOT requires a clause');
      const excluded = this._expression(expression.clause, table, keys, fields, universe, projectKeys);
      return new Map(Array.from(universe).filter((sid) => !excluded.has(sid)).map((sid) => [sid, 0]));
    }
    if (typeof expression.value !== 'string' || !expression.value.trim()) throw failure('search value is required');
    if (expression.field === 'tag') {
      const result = new Map();
      for (const [projectId, key] of keys) {
        const tag = expression.value.trim().replace(/^#/, '').toLowerCase();
        for (const row of this.db.prepare(`SELECT a.sid FROM ${table} a JOIN cloud_search_document_tags dt ON dt.search_document_id=a.sid
          JOIN cloud_search_tags t ON t.id=dt.tag_id WHERE t.project_id=? AND a.project_id=? AND t.tag_hash=?`).all(projectId, projectId, digest(key, 'tag', tag))) result.set(row.sid, 0);
      }
      return result;
    }
    if (expression.field === 'author') return new Map(this.db.prepare(`SELECT sid FROM ${table} WHERE created_by_user_id=?`).all(expression.value).map((row) => [row.sid, 0]));
    return this._textLeaf(expression, table, keys, fields, projectKeys);
  }

  _literalCandidates(query, table, keys, fields, projectKeys) {
    const exactRun = literalRuns(query).length === 1 && !query.includes('\n');
    if (exactRun) this.db.exec(`CREATE TEMP TABLE ${table}_literal_terms(id INTEGER PRIMARY KEY)`);
    const anchors = literalRuns(query).flatMap(run => run.split('\n')).filter(Boolean);
    anchors.sort((a, b) => b.length - a.length);
    if (!anchors.length) return;
    const anchor = anchors[0];
    // A small subset is sufficient for a safe superset of true matches. Raw
    // verification removes false positives without a SQL parameter explosion.
    const size = Math.min(3, anchor.length);
    const grams = [...new Set(Array.from({ length: anchor.length - size + 1 }, (_, i) => anchor.slice(i, i + size)))].slice(0, 8);
    for (const [projectId, key] of keys) {
      const hashes = grams.map(gram => digest(key, 'literal-gram', gram));
      const matchingTerms = `SELECT f.term_id FROM cloud_search_term_features f WHERE f.feature_hash IN (${hashes.map(() => '?').join(',')})
        GROUP BY f.term_id HAVING count(*)=?`;
      if (exactRun) {
        const termPage = this.db.prepare(`SELECT t.*,t.term_hash AS tag_hash FROM cloud_search_terms t
          WHERE t.project_id=? AND t.id>? AND t.id IN (${matchingTerms}) AND EXISTS (
            SELECT 1 FROM cloud_search_postings p JOIN ${table} a ON a.sid=p.search_document_id
            WHERE p.term_id=t.id AND a.project_id=? AND p.field IN (SELECT value FROM json_each(?)))
          ORDER BY t.id LIMIT 64`);
        const insert = this.db.prepare(`INSERT OR IGNORE INTO ${table}_literal_terms VALUES (?)`);
        let previous = 0;
        for (;;) {
          const terms = termPage.all(projectId, previous, ...hashes, hashes.length, projectId, JSON.stringify(fields.map(field => FIELDS.indexOf(field))));
          if (!terms.length) break;
          for (const term of terms) {
            previous = term.id;
            // Verify each distinct vocabulary run once, rather than decrypting
            // every document containing a common fragment such as "operat".
            if (openTag(projectKeys.get(projectId), term, this.store.environment, 'literal-v3').includes(query)) insert.run(term.id);
          }
        }
      }
      this.db.prepare(`DELETE FROM ${table} WHERE project_id=? AND sid NOT IN (
        SELECT p.search_document_id FROM cloud_search_postings p
        JOIN cloud_search_terms t ON t.id=p.term_id AND t.project_id=?
        WHERE p.field IN (SELECT value FROM json_each(?)) AND p.term_id IN (
          ${exactRun ? `SELECT id FROM ${table}_literal_terms` : matchingTerms}))`).run(projectId, projectId,
          JSON.stringify(fields.map(field => FIELDS.indexOf(field))), ...(exactRun ? [] : [...hashes, hashes.length]));
    }
    if (exactRun) this.db.exec(`DROP TABLE ${table}_literal_terms`);
    return exactRun;
  }

  _filterTags(input, table, keys) {
    for (const [name, values] of [['all', input.tags || []], ['any', input.tagsAny || []], ['none', input.tagsNone || []]]) {
      if (!Array.isArray(values)) throw failure('tags must be arrays');
      if (!values.length) continue;
      for (const [projectId, key] of keys) {
        const normalized = [...new Set(values.map(tag => tag.trim().replace(/^#/, '').toLowerCase()))];
        const hashes = normalized.map(tag => digest(key, 'tag', tag));
        const match = `SELECT dt.search_document_id FROM cloud_search_document_tags dt JOIN cloud_search_tags t ON t.id=dt.tag_id
          WHERE t.project_id=? AND t.tag_hash IN (${hashes.map(() => '?').join(',')})
          GROUP BY dt.search_document_id ${name === 'all' ? 'HAVING count(DISTINCT t.id)=?' : ''}`;
        this.db.prepare(`DELETE FROM ${table} WHERE project_id=? AND sid ${name === 'none' ? 'IN' : 'NOT IN'} (${match})`)
          .run(projectId, projectId, ...hashes, ...(name === 'all' ? [normalized.length] : []));
      }
    }
  }

  _checkCurrent(table, userId, selected, starredOnly) {
    // No await may occur between this authorization check and aggregation.
    const where = !selected ? '' : selected.sid != null ? 'sid=' + Number(selected.sid) + ' AND ' :
      'project_id=' + this.db.prepare('SELECT quote(?) AS q').get(selected.projectId).q + ' AND ';
    this.db.exec(`DELETE FROM ${table} WHERE ${where}NOT EXISTS (
      SELECT 1 FROM cloud_documents d JOIN cloud_projects p ON p.id=d.project_id AND p.deleted_at_ms IS NULL
      JOIN cloud_workspaces w ON w.id=d.workspace_id AND w.deleted_at_ms IS NULL
      JOIN cloud_workspace_memberships m ON m.workspace_id=d.workspace_id AND m.status='active'
      LEFT JOIN cloud_permission_groups g ON g.document_id=d.id
      LEFT JOIN cloud_permission_group_members gm ON gm.permission_group_id=g.id AND gm.user_id=m.user_id
      WHERE d.id=${table}.id AND d.current_revision_id=${table}.current_revision_id
        AND d.project_id=${table}.project_id AND d.workspace_id=${table}.workspace_id
        AND d.deleted_at_ms IS NULL AND m.user_id=${this.db.prepare('SELECT quote(?) AS q').get(userId).q}
        AND (d.created_by_user_id=m.user_id OR g.mode='everyone' OR gm.user_id IS NOT NULL)
        ${starredOnly ? 'AND EXISTS (SELECT 1 FROM cloud_document_stars st WHERE st.user_id=m.user_id AND st.document_id=d.id)' : ''})`);
  }

  async page(input) {
    input = input || {};
    if (input.query != null && typeof input.query !== 'string') throw failure('query must be a string');
    const limit = input.limit == null ? 50 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure('limit must be between 1 and 100');
    const fields = input.fields || FIELDS;
    if (!Array.isArray(fields) || !fields.length || fields.some((field) => !FIELDS.includes(field))) throw failure('fields are invalid');
    const sort = input.sort || (input.expression || input.query ? 'relevance' : 'updated_desc');
    if (!['relevance', 'updated_desc', 'created_desc'].includes(sort)) throw failure('unknown search sort');
    const matchLimit = input.matchLimit == null ? 5 : Number(input.matchLimit);
    const facetLimit = input.facetLimit == null ? 50 : Number(input.facetLimit);
    if (!Number.isSafeInteger(matchLimit) || matchLimit < 0 || matchLimit > 100 || !Number.isSafeInteger(facetLimit) || facetLimit < 1 || facetLimit > 1000) throw failure('invalid match or facet limit');
    if (input.facets != null && (!Array.isArray(input.facets) || input.facets.some((facet) => !['tags', 'authors', 'libraries'].includes(facet)))) throw failure('unknown search facet');
    function resolveAuthor(expression) {
      if (!expression || typeof expression !== 'object') return expression;
      if (expression.clauses) return { ...expression, clauses: expression.clauses.map(resolveAuthor) };
      if (expression.clause) return { ...expression, clause: resolveAuthor(expression.clause) };
      return expression.field === 'author' && expression.value === 'me' ? { ...expression, value: input.userId } : expression;
    }
    input = { ...input, query: input.query && input.query.trim(), expression: resolveAuthor(input.expression) };
    const scope = this.scope(input, false, true);
    const table = 'cloud_search_scope_' + crypto.randomBytes(8).toString('hex');
    const keys = new Map();
    const projectKeys = new Map();
    const projectNames = new Map();
    try {
      this.db.exec(`CREATE TEMP TABLE ${table} (sid INTEGER UNIQUE,id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,current_revision_id TEXT,
        created_by_user_id TEXT,updated_by_user_id TEXT,created_at_ms INTEGER,updated_at_ms INTEGER,
        indexed_head TEXT,indexed_project TEXT,indexed_version INTEGER,score REAL NOT NULL DEFAULT 0)`);
      const stamp = () => String(this.db.pragma('data_version', { simple: true })) + ':' + this.db.prepare('SELECT total_changes() AS n').get().n;
      let validatedStamp;
      const populate = this.db.transaction(() => {
        this.db.prepare(`INSERT INTO ${table}(sid,id,workspace_id,project_id,current_revision_id,created_by_user_id,updated_by_user_id,created_at_ms,updated_at_ms,indexed_head,indexed_project,indexed_version) ${scope.sql}`).run(scope.params);
        // Capture inside the same read snapshot as the authorized relation.
        validatedStamp = stamp();
      });
      populate();
      const missing = () => this.db.prepare(`SELECT 1 FROM ${table} WHERE sid IS NULL OR indexed_head<>current_revision_id OR indexed_project<>project_id OR indexed_version<>? LIMIT 1`).get(VERSION);
      if (missing()) {
        await this.rebuild({ ...input, limit: 100, after: null });
        this.db.exec(`DELETE FROM ${table}`);
        populate();
        if (missing()) throw failure('Search index is being prepared. Retry this search or complete the operator rebuild.', 'search_index_building');
      }
      this.db.exec(`CREATE INDEX ${table}_project ON ${table}(project_id)`);
      const recheck = (force, selected) => {
        if (force || stamp() !== validatedStamp) {
          this.db.transaction(() => {
            this._checkCurrent(table, input.userId, selected, input.starredOnly);
            // A selected-row check does not certify the rest of the scope.
            // The unconditional pre-aggregation check validates every row.
            if (!selected) validatedStamp = stamp();
          })();
        }
      };
      // Browsing and author/date/star filters do not need keys for every project.
      // Open only the returned page's metadata keys unless the index needs them.
      const needsIndexKeys = input.expression || input.query || (input.facets || []).includes('tags') ||
        [input.tags || [], input.tagsAny || [], input.tagsNone || []].some(values => !Array.isArray(values) || values.length);
      const projects = needsIndexKeys
        ? this.db.prepare(`SELECT DISTINCT p.* FROM cloud_projects p JOIN ${table} a ON a.project_id=p.id`).all() : [];
      for (const project of projects) {
        recheck();
        if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? LIMIT 1`).get(project.id)) continue;
        const key = await this.store._projectKey(project.id, 1);
        recheck();
        projectKeys.set(project.id, key);
        keys.set(project.id, searchKey(key));
      }
      if (input.expression) {
        const universe = new Set(Array.from(this.db.prepare(`SELECT sid FROM ${table}`).iterate(), row => row.sid));
        const matches = this._expression(input.expression, table, keys, fields, universe, projectKeys);
        this.db.exec(`CREATE TEMP TABLE ${table}_matches(sid INTEGER PRIMARY KEY,score REAL)`);
        const insert = this.db.prepare(`INSERT INTO ${table}_matches VALUES (?,?)`);
        this.db.transaction(() => { for (const [sid, score] of matches) insert.run(sid, Math.round(score * 1000) / 1000); })();
        this.db.exec(`DELETE FROM ${table} WHERE sid NOT IN (SELECT sid FROM ${table}_matches);
          UPDATE ${table} SET score=(SELECT score FROM ${table}_matches m WHERE m.sid=${table}.sid);
          DROP TABLE ${table}_matches`);
      }
      this._filterTags(input, table, keys);
      if (input.query) {
        const query = input.query.trim().toLowerCase();
        const verifiedRuns = this._literalCandidates(query, table, keys, fields, projectKeys);
        if (verifiedRuns) this.db.exec(`UPDATE ${table} SET score=score+1`);
        let lastSid = -1;
        const batch = this.db.prepare(`SELECT sid,current_revision_id FROM ${table} WHERE sid>? ORDER BY sid LIMIT 32`);
        const revision = this.db.prepare('SELECT * FROM cloud_document_revisions WHERE id=?');
        const remove = this.db.prepare(`DELETE FROM ${table} WHERE sid=?`);
        const score = this.db.prepare(`UPDATE ${table} SET score=score+1 WHERE sid=?`);
        for (; !verifiedRuns;) {
          const rows = batch.all(lastSid);
          if (!rows.length) break;
          for (const row of rows) {
            lastSid = row.sid;
            const content = await this.store._decryptRevision(revision.get(row.current_revision_id));
            recheck(false, row);
            const values = { title: content.metadata.title, filename: content.metadata.filename,
              tags: content.metadata.tags.join(' '), body: content.markdown };
            if (fields.map(field => values[field]).join('\n').toLowerCase().includes(query)) score.run(row.sid);
            else remove.run(row.sid);
          }
        }
      }
      recheck(true);
      if (input.beforeReturn) this.store._beforeCommit(input.beforeReturn);
      const order = sort === 'relevance' ? 'score DESC,updated_at_ms DESC,id ASC' :
        sort === 'created_desc' ? 'created_at_ms DESC,id ASC' : 'updated_at_ms DESC,id ASC';
      function boundary(after) {
        if (!after) return { sql: '', params: [] };
        if (typeof after.id !== 'string' || !Number.isFinite(after.updated_at_ms) || !Number.isFinite(after.created_at_ms) || !Number.isFinite(after.score)) throw failure('invalid search cursor position');
        const column = sort === 'created_desc' ? 'created_at_ms' : 'updated_at_ms';
        const timestamp = sort === 'created_desc' ? after.created_at_ms : after.updated_at_ms;
        const tail = `(${column}<? OR (${column}=? AND id>?))`;
        return sort === 'relevance' ? { sql: `WHERE (score<? OR (score=? AND ${tail}))`, params: [after.score, after.score, timestamp, timestamp, after.id] }
          : { sql: 'WHERE ' + tail, params: [timestamp, timestamp, after.id] };
      }
      const documents = [];
      const selectedRows = new Map();
      const needsBody = Boolean(matchLimit && (input.query || input.expression));
      const revisionColumns = needsBody ? '*' : 'id,workspace_id,project_id,document_id,project_key_version,metadata_nonce,metadata_ciphertext,revision_number,created_by_user_id';
      const readRevision = this.db.prepare(`SELECT ${revisionColumns} FROM cloud_document_revisions WHERE id=?`);
      let position = input.after;
      while (!input.tagsOnly && documents.length < limit) {
        const after = boundary(position);
        const rows = this.db.prepare(`SELECT * FROM ${table} ${after.sql} ORDER BY ${order} LIMIT ?`).all(...after.params, limit - documents.length);
        if (!rows.length) break;
        for (const row of rows) {
          position = row;
          if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE sid=?`).get(row.sid)) continue;
          const revision = readRevision.get(row.current_revision_id);
          const content = needsBody ? await this.store._decryptRevision(revision)
            : { metadata: await this.store._decryptRevisionMetadata(revision) };
          recheck(false, row);
          if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE sid=?`).get(row.sid)) continue;
          if (!projectNames.has(row.project_id)) {
            const project = this.db.prepare('SELECT * FROM cloud_projects WHERE id=?').get(row.project_id);
            const name = await this.store._decryptProjectName(project);
            recheck(false, row);
            projectNames.set(row.project_id, name);
          }
          if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE sid=?`).get(row.sid)) continue;
          selectedRows.set(row.id, row);
          documents.push({ ...this.store._documentResult(row.id, content.metadata, revision.revision_number, revision.id, row.updated_at_ms,
            { id: row.project_id, name: projectNames.get(row.project_id) }), workspace_id: row.workspace_id,
            created_by_user_id: row.created_by_user_id, updated_by_user_id: revision.created_by_user_id,
            created_at: new Date(row.created_at_ms).toISOString(), shared_with_me: row.created_by_user_id !== input.userId,
            starred: this.store.isDocumentStarred(input.userId, row.id),
            score: row.score, matches: needsBody ? snippets(content, input, fields, matchLimit) : [] });
        }
      }
      recheck(true);
      if (input.beforeReturn) this.store._beforeCommit(input.beforeReturn);
      const remains = this.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`);
      const visibleDocuments = documents.filter(document => remains.get(document.id));
      const facets = {};
      const facetTotals = {};
      const facetsTruncated = {};
      const requested = input.facets || [];
      if (requested.includes('tags')) {
        const counts = this.db.prepare(`SELECT t.*,count(*) AS count FROM cloud_search_tags t
          JOIN cloud_search_document_tags dt ON dt.tag_id=t.id JOIN ${table} m ON m.sid=dt.search_document_id
          GROUP BY t.id`).all();
        const merged = new Map();
        for (const row of counts) {
          const label = openTag(projectKeys.get(row.project_id), row, this.store.environment);
          merged.set(label, (merged.get(label) || 0) + row.count);
        }
        facets.tags = Array.from(merged, ([tag, document_count]) => ({ tag, document_count }))
          .sort((a, b) => b.document_count - a.document_count || a.tag.localeCompare(b.tag)).slice(0, input.allTags ? undefined : facetLimit);
        facetTotals.tags = merged.size;
      }
      if (requested.includes('authors')) {
        facets.authors = this.db.prepare(`SELECT a.created_by_user_id AS user_id,count(*) AS document_count
          FROM ${table} a GROUP BY a.created_by_user_id
          ORDER BY document_count DESC,user_id LIMIT ?`).all(facetLimit);
        facetTotals.authors = this.db.prepare(`SELECT count(DISTINCT a.created_by_user_id) AS count FROM ${table} a`).get().count;
      }
      if (requested.includes('libraries')) {
        facets.libraries = this.db.prepare(`SELECT a.workspace_id AS id,count(*) AS document_count
          FROM ${table} a GROUP BY a.workspace_id
          ORDER BY document_count DESC,id LIMIT ?`).all(facetLimit);
        facetTotals.libraries = this.db.prepare(`SELECT count(DISTINCT a.workspace_id) AS count FROM ${table} a`).get().count;
      }
      for (const facet of requested) facetsTruncated[facet] = facets[facet].length < facetTotals[facet];
      // Cursor positions must never disclose a document revoked during an await.
      const last = visibleDocuments.length ? selectedRows.get(visibleDocuments[visibleDocuments.length - 1].id) : null;
      const total = this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
      const continuation = boundary(last || input.after);
      const hasMore = Boolean(last && this.db.prepare(`SELECT 1 FROM ${table} ${continuation.sql} LIMIT 1`).get(...continuation.params));
      if (!last && !input.tagsOnly && total && this.db.prepare(`SELECT 1 FROM ${table} ${continuation.sql} LIMIT 1`).get(...continuation.params)) throw failure('Search changed while the page was loading. Retry this request.', 'temporary_service_failure');
      return { documents: visibleDocuments, total_count: total, facets, facet_totals: facetTotals,
        facets_truncated: facetsTruncated, has_more: hasMore,
        nextPosition: hasMore ? { id: last.id, score: last.score, updated_at_ms: last.updated_at_ms, created_at_ms: last.created_at_ms } : null };
    } finally {
      for (const key of keys.values()) key.fill(0);
      for (const key of projectKeys.values()) key.fill(0);
      this.db.exec(`DROP TABLE IF EXISTS ${table}_literal_terms; DROP TABLE IF EXISTS ${table}_matches; DROP TABLE IF EXISTS ${table}`);
    }
  }
}

function snippets(content, input, fields, limit) {
  if (!limit) return [];
  const leaves = new Map();
  function add(leaf) {
    const terms = leaf.match === 'substring' ? [leaf.value.toLowerCase()] : words(leaf.value).map((word) => word.value);
    const key = JSON.stringify([leaf.field, leaf.match, terms]);
    if (!leaves.has(key)) leaves.set(key, { ...leaf, key, terms });
  }
  function collect(expression, negative) {
    if (!expression) return;
    if (expression.op === 'not') { collect(expression.clause, !negative); return; }
    if (expression.clauses) { expression.clauses.forEach((clause) => collect(clause, negative)); return; }
    if (!negative && FIELDS.concat('text').includes(expression.field)) add(expression);
  }
  collect(input.expression, false);
  if (input.query) add({ field: 'text', match: 'substring', value: input.query.trim() });
  if (!leaves.size) return [];
  const values = { title: content.metadata.title, filename: content.metadata.filename,
    tags: content.metadata.tags.join(' '), body: content.markdown };
  const bodyStart = content.markdown.length - SDocYaml.parseFrontMatter(content.markdown).body.length;
  const newlines = Array.from(content.markdown.matchAll(/\n/g), (match) => match.index);
  function sourceLine(offset) {
    let low = 0;
    let high = newlines.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (newlines[middle] < offset) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  }
  const hits = [];
  const bestQuality = new Map();
  for (const field of FIELDS.filter((name) => fields.includes(name))) {
    const text = values[field];
    const lowercase = text.toLowerCase();
    let lowerOffsets;
    if (lowercase.length !== text.length) {
      lowerOffsets = { starts: new Uint32Array(lowercase.length), ends: new Uint32Array(lowercase.length) };
      let lowerIndex = 0;
      let offset = 0;
      for (const character of text) {
        for (let i = 0; i < character.toLowerCase().length; i++) { lowerOffsets.starts[lowerIndex] = offset; lowerOffsets.ends[lowerIndex++] = offset + character.length; }
        offset += character.length;
      }
    }
    for (const leaf of leaves.values()) {
      if (leaf.field !== 'text' && leaf.field !== field) continue;
      const terms = leaf.terms;
      const occurrences = [];
      // Returned evidence is bounded by matchLimit. Retain enough separated
      // candidates for clause coverage, without allocating a hit per repeated word.
      const budget = Math.max(10, limit * 2);
      let proseCount = 0, frontCount = 0;
      function retain(start, end) {
        const front = field === 'body' && end <= bodyStart;
        if ((front ? frontCount : proseCount) < budget) {
          occurrences.push({ start, end });
          if (front) frontCount++; else proseCount++;
        }
        return proseCount >= budget;
      }
      if (leaf.match === 'substring') {
        let at = lowercase.indexOf(terms[0]);
        while (at >= 0) {
          const start = lowerOffsets ? lowerOffsets.starts[at] : at;
          const end = lowerOffsets ? lowerOffsets.ends[at + terms[0].length - 1] : at + terms[0].length;
          if (retain(start, end)) break;
          at = lowercase.indexOf(terms[0], at + 1);
        }
      } else {
        const window = [];
        for (const token of iterateWords(text)) {
          window.push(token);
          if (window.length > terms.length) window.shift();
          if (window.length !== terms.length) continue;
          if (leaf.match === 'prefix' ? !window[0].value.startsWith(terms[0]) : window[0].value !== terms[0]) continue;
          if (terms.length > 1 && !terms.every((term, j) => window[j].value === term)) continue;
          const last = window[window.length - 1];
          if (retain(window[0].offset, last.offset + last.length)) break;
        }
      }
      for (const hit of occurrences) {
        const frontMatter = field === 'body' && hit.end <= bodyStart;
        const quality = field === 'body' ? frontMatter ? 4 : 0 : field === 'title' ? 1 : field === 'filename' ? 2 : 3;
        bestQuality.set(leaf.key, Math.min(bestQuality.get(leaf.key) == null ? Infinity : bestQuality.get(leaf.key), quality));
        hits.push({ ...hit, field, frontMatter, quality, line: field === 'body' ? sourceLine(hit.start) : null,
          coverage: new Set([leaf.key]) });
      }
    }
  }
  // For each positive clause, use prose evidence when it exists. Keep metadata
  // evidence for clauses that only match metadata, including explicit fields.
  const preferred = hits.filter((hit) => hit.quality === bestQuality.get(hit.coverage.values().next().value))
    .sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field) || a.start - b.start || b.end - a.end);
  const merged = [];
  for (const hit of preferred) {
    const previous = merged[merged.length - 1];
    if (previous && previous.field === hit.field && hit.start < previous.end) {
      previous.end = Math.max(previous.end, hit.end);
      previous.frontMatter = previous.frontMatter && hit.frontMatter;
      previous.quality = Math.min(previous.quality, hit.quality);
      for (const clause of hit.coverage) previous.coverage.add(clause);
    } else merged.push({ ...hit, coverage: new Set(hit.coverage) });
  }
  const passages = [];
  for (const hit of merged) {
    const text = values[hit.field];
    const previous = passages[passages.length - 1];
    if (previous && previous.field === hit.field && previous.frontMatter === hit.frontMatter && hit.start < previous.end) {
      previous.hits.push(hit);
      previous.end = Math.max(previous.end, hit.end);
      for (const clause of hit.coverage) previous.coverage.add(clause);
      previous.lines.add(hit.line);
      continue;
    }
    const boundary = hit.field === 'body' && !hit.frontMatter ? Math.min(bodyStart, hit.start) : 0;
    const end = hit.frontMatter ? Math.max(bodyStart, hit.end) : text.length;
    passages.push({ field: hit.field, frontMatter: hit.frontMatter, quality: hit.quality,
      start: Math.max(boundary, hit.start - 60, previous && previous.field === hit.field ? previous.end : 0),
      end: Math.min(end, hit.end + 100), hits: [hit], coverage: new Set(hit.coverage),
      line: hit.line, lines: new Set([hit.line]) });
  }
  const selected = [];
  const covered = new Set();
  const usedLines = new Set();
  while (selected.length < limit && passages.length) {
    let best = -1;
    let bestGain = -1;
    for (let i = 0; i < passages.length; i++) {
      const candidate = passages[i];
      const gain = Array.from(candidate.coverage).filter((clause) => !covered.has(clause)).length;
      if (!gain && Array.from(candidate.lines).some((line) => usedLines.has(candidate.field + ':' + line))) continue;
      if (gain > bestGain || gain === bestGain && best >= 0 && candidate.quality < passages[best].quality) {
        best = i;
        bestGain = gain;
      }
    }
    if (best < 0) break;
    const passage = passages.splice(best, 1)[0];
    selected.push(passage);
    for (const clause of passage.coverage) covered.add(clause);
    for (const line of passage.lines) usedLines.add(passage.field + ':' + line);
  }
  return selected.map((passage) => {
    const text = values[passage.field];
    return { field: passage.field, line: passage.line, snippet: text.slice(passage.start, passage.end),
      terms: Array.from(new Set(passage.hits.map((hit) => text.slice(hit.start, hit.end)))),
      offsets: passage.hits.map((hit) => ({ start: hit.start - passage.start, end: hit.end - passage.start })) };
  });
}

module.exports = { CloudSearchIndex, VERSION, FIELDS, fold, words, searchKey, digest, encodePositions, decodePositions };
