// Encrypted short links: /s/<id>#k=<key>.
//
// The CLI compresses + encrypts the document with a freshly generated
// AES-256-GCM key, POSTs the ciphertext to /api/short, then assembles a
// URL whose key lives in the fragment (which browsers don't send to
// servers). The key never leaves this process. Trade-offs vs the
// default `#md=` form are documented in HELP.

const https  = require('https');
const http   = require('http');
const zlib   = require('zlib');
const crypto = require('crypto');

const SDocYaml   = require('../shared/sdocs-yaml.js');
const SDocStyles = require('../shared/sdocs-styles.js');
const { slugify } = require('../shared/sdocs-slugify.js');

const { toBase64Url } = require('./url');
const { DEFAULT_URL } = require('./constants');

// The blob format (nonce(12) + ciphertext + tag(16)) matches the browser.
function compressAndEncrypt(content) {
  const compressed = zlib.brotliCompressSync(Buffer.from(content, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  const keyBytes = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, nonce);
  const ct = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([nonce, ct, tag]);
  return { keyBytes, cipherB64url: toBase64Url(blob) };
}

function uploadShortLink(ciphertextB64, baseUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/short', baseUrl);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = JSON.stringify({ ciphertext: ciphertextB64 });
    const req = mod.request({
      method: 'POST',
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(body); } catch (_) { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && json && json.id) {
          resolve(json.id);
        } else {
          const err = (json && json.error) || ('http_' + res.statusCode);
          reject(new Error(err));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function buildShortUrl(content, opts) {
  if (!content) throw new Error('short link requires file content');

  // Mirror the hash-build's default-stripping so the encrypted payload is
  // identical to what the browser would encode.
  const parsed = SDocYaml.parseFrontMatter(content);
  if (parsed.meta && parsed.meta.styles) {
    const stripped = SDocStyles.stripStyleDefaults(parsed.meta.styles);
    if (Object.keys(stripped).length > 0) parsed.meta.styles = stripped;
    else delete parsed.meta.styles;
    content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
  }

  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const { keyBytes, cipherB64url } = compressAndEncrypt(content);
  const id = await uploadShortLink(cipherB64url, baseUrl);
  const keyB64 = toBase64Url(keyBytes);

  const params = new URLSearchParams();
  params.set('k', keyB64);
  const mode = opts.mode;
  if (mode && mode !== 'read') params.set('mode', mode);
  if (opts.theme) params.set('theme', opts.theme);
  if (opts.section) params.set('sec', slugify(opts.section));

  return `${baseUrl}/s/${id}#${params.toString()}`;
}

module.exports = {
  compressAndEncrypt,
  uploadShortLink,
  buildShortUrl,
};
