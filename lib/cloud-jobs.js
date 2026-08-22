const crypto = require('crypto');

class CloudJobsError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'CloudJobsError';
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw new CloudJobsError('invalid_' + field, field + ' is required');
  }
  return text;
}

function positiveInteger(value, field, fallback) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CloudJobsError('invalid_' + field, field + ' must be a positive integer');
  }
  return value;
}

function timestamp(value, field, fallback) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CloudJobsError('invalid_' + field, field + ' must be a millisecond timestamp');
  }
  return value;
}

function canonicalJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new CloudJobsError('invalid_payload', 'payload must contain finite JSON values');
      return item;
    }
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item !== 'object') throw new CloudJobsError('invalid_payload', 'payload must be JSON serializable');
    if (seen.has(item)) throw new CloudJobsError('invalid_payload', 'payload must not contain cycles');
    seen.add(item);
    const output = {};
    for (const key of Object.keys(item).sort()) {
      if (item[key] === undefined) throw new CloudJobsError('invalid_payload', 'payload must not contain undefined values');
      output[key] = normalize(item[key]);
    }
    seen.delete(item);
    return output;
  }
  return JSON.stringify(normalize(value));
}

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

class CloudJobs {
  constructor(options) {
    options = options || {};
    if (!options.dbPath) throw new Error('dbPath is required');
    const Database = require('better-sqlite3');
    this.readonly = options.readonly === true;
    this.db = new Database(options.dbPath, this.readonly
      ? { readonly: true, fileMustExist: true }
      : undefined);
    if (!this.readonly) this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = ' + positiveInteger(options.busyTimeoutMs, 'busy_timeout_ms', 5000));
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.randomUUID = typeof options.randomUUID === 'function' ? options.randomUUID : crypto.randomUUID;
    this.baseBackoffMs = positiveInteger(options.baseBackoffMs, 'base_backoff_ms', 1000);
    this.maxBackoffMs = positiveInteger(options.maxBackoffMs, 'max_backoff_ms', 60 * 60 * 1000);
    if (this.maxBackoffMs < this.baseBackoffMs) {
      throw new CloudJobsError('invalid_backoff', 'max_backoff_ms must be at least base_backoff_ms');
    }
    if (!this.readonly) this._createSchema();
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'complete', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        max_attempts INTEGER NOT NULL CHECK(max_attempts >= 1),
        available_at_ms INTEGER NOT NULL,
        lease_owner TEXT,
        lease_expires_at_ms INTEGER,
        last_error_json TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        dead_at_ms INTEGER,
        UNIQUE(type, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS cloud_jobs_claim_idx
        ON cloud_jobs(state, available_at_ms, created_at_ms);
      CREATE INDEX IF NOT EXISTS cloud_jobs_lease_idx
        ON cloud_jobs(state, lease_expires_at_ms);
      CREATE INDEX IF NOT EXISTS cloud_jobs_cleanup_idx
        ON cloud_jobs(state, updated_at_ms);
    `);
  }

  _row(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      idempotencyKey: row.idempotency_key,
      payload: parseJson(row.payload_json),
      state: row.state,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAtMs: row.available_at_ms,
      leaseOwner: row.lease_owner,
      leaseExpiresAtMs: row.lease_expires_at_ms,
      lastError: parseJson(row.last_error_json),
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
      completedAtMs: row.completed_at_ms,
      deadAtMs: row.dead_at_ms,
    };
  }

  get(jobId) {
    const id = requiredText(jobId, 'job_id', 200);
    return this._row(this.db.prepare('SELECT * FROM cloud_jobs WHERE id = ?').get(id));
  }

  enqueue(input) {
    input = input || {};
    const type = requiredText(input.type, 'type', 200);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotency_key', 512);
    const payloadJson = canonicalJson(input.payload == null ? {} : input.payload);
    const maxAttempts = positiveInteger(input.maxAttempts, 'max_attempts', 5);
    const now = this.now();
    const requestedAvailableAtMs = input.availableAtMs == null
      ? null
      : timestamp(input.availableAtMs, 'available_at_ms');
    const availableAtMs = requestedAvailableAtMs == null ? now : requestedAvailableAtMs;
    const digest = crypto.createHash('sha256')
      .update(canonicalJson({ payload: parseJson(payloadJson), maxAttempts, availableAtMs: requestedAvailableAtMs }))
      .digest('hex');
    const id = this.randomUUID();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO cloud_jobs (
        id, type, idempotency_key, input_digest, payload_json, state, attempts,
        max_attempts, available_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
    `).run(id, type, idempotencyKey, digest, payloadJson, maxAttempts, availableAtMs, now, now);
    const row = this.db.prepare(`
      SELECT * FROM cloud_jobs WHERE type = ? AND idempotency_key = ?
    `).get(type, idempotencyKey);
    if (row.input_digest !== digest) {
      throw new CloudJobsError('idempotency_mismatch', 'idempotency key was already used with different job input');
    }
    return Object.assign(this._row(row), { created: result.changes === 1 });
  }

  claim(input) {
    input = input || {};
    const workerId = requiredText(input.workerId, 'worker_id', 200);
    const leaseMs = positiveInteger(input.leaseMs, 'lease_ms', 30000);
    const types = input.types == null ? [] : input.types;
    if (!Array.isArray(types)) throw new CloudJobsError('invalid_types', 'types must be an array');
    const normalizedTypes = types.map((type) => requiredText(type, 'type', 200));
    const now = this.now();
    const leaseExpiresAtMs = now + leaseMs;
    if (!Number.isSafeInteger(leaseExpiresAtMs)) {
      throw new CloudJobsError('invalid_lease_ms', 'lease expiration is outside the supported timestamp range');
    }

    return this.db.transaction(() => {
      this.db.prepare(`
        UPDATE cloud_jobs
        SET state = 'dead', lease_owner = NULL, lease_expires_at_ms = NULL,
            dead_at_ms = ?, updated_at_ms = ?
        WHERE state = 'running' AND lease_expires_at_ms <= ? AND attempts >= max_attempts
      `).run(now, now, now);

      const typeSql = normalizedTypes.length
        ? ' AND type IN (' + normalizedTypes.map(() => '?').join(', ') + ')'
        : '';
      const row = this.db.prepare(`
        SELECT id FROM cloud_jobs
        WHERE (
          (state = 'queued' AND available_at_ms <= ?)
          OR (state = 'running' AND lease_expires_at_ms <= ? AND attempts < max_attempts)
        )${typeSql}
        ORDER BY available_at_ms ASC, created_at_ms ASC, id ASC
        LIMIT 1
      `).get(now, now, ...normalizedTypes);
      if (!row) return null;

      const updated = this.db.prepare(`
        UPDATE cloud_jobs
        SET state = 'running', attempts = attempts + 1, lease_owner = ?,
            lease_expires_at_ms = ?, updated_at_ms = ?
        WHERE id = ? AND (
          (state = 'queued' AND available_at_ms <= ?)
          OR (state = 'running' AND lease_expires_at_ms <= ? AND attempts < max_attempts)
        )
      `).run(workerId, leaseExpiresAtMs, now, row.id, now, now);
      if (updated.changes !== 1) return null;
      return this.get(row.id);
    }).immediate();
  }

  _ownedRunningJob(jobId, workerId, now) {
    const row = this.db.prepare('SELECT * FROM cloud_jobs WHERE id = ?').get(jobId);
    if (!row) throw new CloudJobsError('job_not_found', 'job was not found');
    if (row.state !== 'running' || row.lease_owner !== workerId || row.lease_expires_at_ms <= now) {
      throw new CloudJobsError('lease_lost', 'worker no longer holds an active lease for this job');
    }
    return row;
  }

  complete(input) {
    input = input || {};
    const jobId = requiredText(input.jobId, 'job_id', 200);
    const workerId = requiredText(input.workerId, 'worker_id', 200);
    const now = this.now();
    return this.db.transaction(() => {
      this._ownedRunningJob(jobId, workerId, now);
      this.db.prepare(`
        UPDATE cloud_jobs
        SET state = 'complete', lease_owner = NULL, lease_expires_at_ms = NULL,
            last_error_json = NULL, completed_at_ms = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(now, now, jobId);
      return this.get(jobId);
    }).immediate();
  }

  retry(input) {
    input = input || {};
    const jobId = requiredText(input.jobId, 'job_id', 200);
    const workerId = requiredText(input.workerId, 'worker_id', 200);
    const errorJson = input.error == null ? null : canonicalJson(input.error);
    const now = this.now();
    return this.db.transaction(() => {
      const row = this._ownedRunningJob(jobId, workerId, now);
      if (row.attempts >= row.max_attempts) {
        this.db.prepare(`
          UPDATE cloud_jobs
          SET state = 'dead', lease_owner = NULL, lease_expires_at_ms = NULL,
              last_error_json = ?, dead_at_ms = ?, updated_at_ms = ?
          WHERE id = ?
        `).run(errorJson, now, now, jobId);
      } else {
        const calculated = Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, row.attempts - 1));
        const backoffMs = timestamp(input.backoffMs, 'backoff_ms', calculated);
        const availableAtMs = now + backoffMs;
        if (!Number.isSafeInteger(availableAtMs)) {
          throw new CloudJobsError('invalid_backoff_ms', 'retry timestamp is outside the supported range');
        }
        this.db.prepare(`
          UPDATE cloud_jobs
          SET state = 'queued', available_at_ms = ?, lease_owner = NULL,
              lease_expires_at_ms = NULL, last_error_json = ?, updated_at_ms = ?
          WHERE id = ?
        `).run(availableAtMs, errorJson, now, jobId);
      }
      return this.get(jobId);
    }).immediate();
  }

  requeueDead(input) {
    input = input || {};
    const type = requiredText(input.type, 'type', 200);
    const limit = positiveInteger(input.limit, 'limit', 100);
    const now = this.now();
    return this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT id FROM cloud_jobs
        WHERE type = ? AND state = 'dead'
        ORDER BY dead_at_ms ASC, id ASC LIMIT ?
      `).all(type, limit);
      const update = this.db.prepare(`
        UPDATE cloud_jobs
        SET state = 'queued', attempts = 0, available_at_ms = ?,
            lease_owner = NULL, lease_expires_at_ms = NULL,
            completed_at_ms = NULL, dead_at_ms = NULL, updated_at_ms = ?
        WHERE id = ? AND state = 'dead'
      `);
      let requeued = 0;
      for (const row of rows) requeued += update.run(now, now, row.id).changes;
      return { requeued };
    }).immediate();
  }

  cleanup(input) {
    input = input || {};
    const beforeMs = timestamp(input.beforeMs, 'before_ms', this.now());
    const limit = positiveInteger(input.limit, 'limit', 1000);
    const result = this.db.prepare(`
      DELETE FROM cloud_jobs WHERE id IN (
        SELECT id FROM cloud_jobs
        WHERE state IN ('complete', 'dead') AND updated_at_ms < ?
        ORDER BY updated_at_ms ASC, id ASC
        LIMIT ?
      )
    `).run(beforeMs, limit);
    return { deleted: result.changes };
  }

  summary(input) {
    input = input || {};
    const types = input.types == null ? [] : input.types;
    if (!Array.isArray(types)) throw new CloudJobsError('invalid_types', 'types must be an array');
    const normalizedTypes = types.map((type) => requiredText(type, 'type', 200));
    const typeSql = normalizedTypes.length
      ? ' WHERE type IN (' + normalizedTypes.map(() => '?').join(', ') + ')'
      : '';
    const now = this.now();
    const rows = this.db.prepare(`
      SELECT type, state, COUNT(*) AS count,
             MIN(created_at_ms) AS oldest_created_at_ms,
             MIN(CASE WHEN state = 'queued' THEN available_at_ms END) AS oldest_available_at_ms
      FROM cloud_jobs${typeSql}
      GROUP BY type, state
      ORDER BY type ASC, state ASC
    `).all(...normalizedTypes);
    const leaseRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM cloud_jobs
      WHERE state = 'running' AND lease_expires_at_ms <= ?` +
      (normalizedTypes.length
        ? ' AND type IN (' + normalizedTypes.map(() => '?').join(', ') + ')'
        : '')
    ).get(now, ...normalizedTypes);
    const errorRows = this.db.prepare(`
      SELECT type, last_error_json, COUNT(*) AS count
      FROM cloud_jobs
      WHERE last_error_json IS NOT NULL` +
      (normalizedTypes.length
        ? ' AND type IN (' + normalizedTypes.map(() => '?').join(', ') + ')'
        : '')
      + ' GROUP BY type, last_error_json'
    ).all(...normalizedTypes);

    const states = { queued: 0, running: 0, complete: 0, dead: 0 };
    const byType = new Map();
    let oldestPendingAtMs = null;
    for (const row of rows) {
      if (!byType.has(row.type)) {
        byType.set(row.type, { type: row.type, queued: 0, running: 0, complete: 0, dead: 0 });
      }
      const item = byType.get(row.type);
      item[row.state] = row.count;
      states[row.state] += row.count;
      if ((row.state === 'queued' || row.state === 'running') &&
          (oldestPendingAtMs == null || row.oldest_created_at_ms < oldestPendingAtMs)) {
        oldestPendingAtMs = row.oldest_created_at_ms;
      }
      if (row.state === 'queued') item.oldestAvailableAtMs = row.oldest_available_at_ms;
    }

    const errors = new Map();
    for (const row of errorRows) {
      let parsed;
      try { parsed = parseJson(row.last_error_json); } catch (_) { parsed = null; }
      const rawCode = parsed && typeof parsed === 'object' && typeof parsed.code === 'string'
        ? parsed.code : 'unknown';
      const code = /^[a-z0-9_-]{1,80}$/.test(rawCode) ? rawCode : 'unknown';
      const key = row.type + '\0' + code;
      const current = errors.get(key) || { type: row.type, code, count: 0 };
      current.count += row.count;
      errors.set(key, current);
    }

    return {
      generatedAtMs: now,
      total: states.queued + states.running + states.complete + states.dead,
      states,
      expiredLeaseCount: leaseRow.count,
      oldestPendingAtMs,
      types: Array.from(byType.values()),
      errors: Array.from(errors.values()).sort((left, right) =>
        left.type.localeCompare(right.type) || left.code.localeCompare(right.code)),
    };
  }

  close() {
    this.db.close();
  }
}

function createCloudJobs(options) {
  return new CloudJobs(options);
}

module.exports = { CloudJobs, CloudJobsError, createCloudJobs };
