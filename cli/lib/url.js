// URL encoding for SDocs links.
//
// - toBase64Url / fromBase64Url: URL-safe base64.
// - compressToBase64Url / decompressFromBase64Url: brotli + base64url.
//   The browser uses the same shape so a URL built here decodes there
//   identically. Decompression falls back to raw inflate for old links.
// - buildUrl: the public form (`#md=<compressed>`), default-style
//   stripping included so the URL is as short as the browser would write.

const zlib = require('zlib');
const SDocYaml   = require('../shared/sdocs-yaml.js');
const SDocStyles = require('../shared/sdocs-styles.js');
const { slugify } = require('../shared/sdocs-slugify.js');
const { DEFAULT_URL } = require('./constants');

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  b64 += '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

function compressToBase64Url(text) {
  const compressed = zlib.brotliCompressSync(Buffer.from(text, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  return toBase64Url(compressed);
}

function decompressFromBase64Url(b64url) {
  const buf = fromBase64Url(b64url);
  try {
    return zlib.brotliDecompressSync(buf).toString('utf-8');
  } catch (_) {
    return zlib.inflateRawSync(buf).toString('utf-8');
  }
}

function buildUrl(content, opts) {
  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const params = new URLSearchParams();

  // Runtime-only metadata (paths). Stripped from the URL by the browser on load,
  // so anything the user copies from the address bar won't contain them.
  if (opts.local && Object.keys(opts.local).length > 0) {
    const json = JSON.stringify(opts.local);
    const b64 = Buffer.from(json, 'utf-8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    params.set('local', b64);
  }

  if (content) {
    const parsed = SDocYaml.parseFrontMatter(content);
    if (parsed.meta && parsed.meta.styles) {
      const stripped = SDocStyles.stripStyleDefaults(parsed.meta.styles);
      if (Object.keys(stripped).length > 0) {
        parsed.meta.styles = stripped;
      } else {
        delete parsed.meta.styles;
      }
      content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
    }
    params.set('md', compressToBase64Url(content));
  } else if (opts.defaultStyles) {
    const stylesJson = JSON.stringify(opts.defaultStyles);
    params.set('styles', encodeURIComponent(Buffer.from(stylesJson, 'utf-8').toString('base64')));
  }

  const mode = opts.mode || (content ? 'read' : 'style');
  if (mode && mode !== 'read') params.set('mode', mode);

  if (opts.theme) params.set('theme', opts.theme);

  if (opts.section) {
    params.set('sec', slugify(opts.section));
  }

  const qs = params.toString();
  return qs ? `${baseUrl}/#${qs}` : baseUrl;
}

module.exports = {
  toBase64Url,
  fromBase64Url,
  compressToBase64Url,
  decompressFromBase64Url,
  buildUrl,
};
