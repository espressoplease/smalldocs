const crypto = require('crypto');

const JSON_LIMIT = 16 * 1024;

function parsePublicOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw new Error('CLOUD_AUTH_PUBLIC_ORIGIN must be a valid HTTP or HTTPS origin');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('CLOUD_AUTH_PUBLIC_ORIGIN must be a valid HTTP or HTTPS origin');
  }
  return parsed.origin;
}

function canLogDevCodes(options) {
  const opts = options || {};
  if (!opts.enabled || (opts.nodeEnv !== 'development' && opts.nodeEnv !== 'test')) return false;
  const hostname = new URL(parsePublicOrigin(opts.publicOrigin)).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function getClientIp(req, trustProxy) {
  const xff = trustProxy && req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function safeReturnPath(value, fallback) {
  const defaultPath = fallback || '/cloud/admin';
  if (typeof value !== 'string' || !value.length) return defaultPath;
  if (!value.startsWith('/') || value.startsWith('//')) return defaultPath;
  if (/^[\\/]+/.test(value.slice(1))) return defaultPath;
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return defaultPath;
  try {
    const parsed = new URL(value, 'https://smalldocs.invalid');
    if (parsed.origin !== 'https://smalldocs.invalid') return defaultPath;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch (_) {
    return defaultPath;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (_) {}
  }
  return cookies;
}

function sessionCookie(token, options) {
  const opts = options || {};
  const name = opts.secure === false ? 'sdocs_cloud' : '__Host-sdocs_cloud';
  const parts = [
    name + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure !== false) parts.push('Secure');
  if (Number.isInteger(opts.maxAge) && opts.maxAge >= 0) parts.push('Max-Age=' + opts.maxAge);
  return parts.join('; ');
}

function clearSessionCookie(options) {
  return sessionCookie('', Object.assign({}, options, { maxAge: 0 }));
}

function sessionTokenFromCookies(cookieHeader, secure) {
  const cookies = parseCookies(cookieHeader);
  return secure ? cookies['__Host-sdocs_cloud'] : cookies.sdocs_cloud;
}

function csrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sameOrigin(req, publicOrigin) {
  const expected = new URL(publicOrigin);
  const source = req.headers.origin || req.headers.referer;
  if (!source) return false;
  try {
    return new URL(source).origin === expected.origin;
  } catch (_) {
    return false;
  }
}

function readJson(req, limit) {
  const cap = limit || JSON_LIMIT;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let ended = false;
    req.on('data', chunk => {
      if (ended) return;
      size += chunk.length;
      if (size > cap) {
        ended = true;
        const error = new Error('payload_too_large');
        error.code = 'payload_too_large';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (ended) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        const error = new Error('invalid_json');
        error.code = 'invalid_json';
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  JSON_LIMIT,
  parsePublicOrigin,
  canLogDevCodes,
  getClientIp,
  safeReturnPath,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  sessionTokenFromCookies,
  csrfToken,
  timingSafeEqualString,
  sameOrigin,
  readJson,
};
