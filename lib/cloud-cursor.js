const crypto = require('crypto');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

class CloudCursorError extends Error {
  constructor(message) {
    super(message || 'invalid cursor');
    this.name = 'CloudCursorError';
    this.code = 'invalid_request';
  }
}

function normalizeLimit(value, defaultValue, maxValue) {
  const fallback = defaultValue == null ? DEFAULT_PAGE_SIZE : defaultValue;
  const maximum = maxValue == null ? MAX_PAGE_SIZE : maxValue;
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new CloudCursorError('limit must be a positive integer');
  }
  return Math.min(number, maximum);
}

function createCursorCodec(options) {
  options = options || {};
  const secret = Buffer.from(String(options.secret || ''));
  if (secret.length < 16) throw new Error('cursor secret must contain at least 16 bytes');

  function scopeDigest(scope) {
    return crypto.createHash('sha256').update(String(scope)).digest('base64url');
  }

  function signature(body) {
    return crypto.createHmac('sha256', secret).update(body).digest();
  }

  function encode(scope, position) {
    const body = Buffer.from(JSON.stringify({ v: 1, s: scopeDigest(scope), p: position })).toString('base64url');
    return body + '.' + signature(body).toString('base64url');
  }

  function decode(token, scope) {
    if (typeof token !== 'string' || !token || token.length > 4096) throw new CloudCursorError();
    const parts = token.split('.');
    if (parts.length !== 2) throw new CloudCursorError();
    let provided;
    try { provided = Buffer.from(parts[1], 'base64url'); } catch (_) { throw new CloudCursorError(); }
    const expected = signature(parts[0]);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new CloudCursorError();
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
    catch (_) { throw new CloudCursorError(); }
    if (!payload || payload.v !== 1 || payload.s !== scopeDigest(scope) ||
        !payload.p || typeof payload.p !== 'object' || Array.isArray(payload.p)) {
      throw new CloudCursorError();
    }
    return payload.p;
  }

  return { encode, decode };
}

module.exports = { CloudCursorError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, createCursorCodec, normalizeLimit };
