/**
 * Browser base64 UTF-8 roundtrip tests + CLI deflate encoding tests
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Browser Base64 UTF-8 Tests ──────────────────\n');

  // Simulate browser's btoa/atob (Latin-1 only) in Node
  function browserBtoa(str) {
    return Buffer.from(str, 'latin1').toString('base64');
  }
  function browserAtob(b64) {
    return Buffer.from(b64, 'base64').toString('latin1');
  }

  function browserEncode(text) {
    const latin1 = unescape(encodeURIComponent(text));
    return encodeURIComponent(browserBtoa(latin1));
  }

  function browserDecode(param) {
    return decodeURIComponent(escape(browserAtob(decodeURIComponent(param))));
  }

  test('browser base64: roundtrips ASCII content', () => {
    const content = '# Hello World\n\nSome plain ASCII text.';
    assert.strictEqual(browserDecode(browserEncode(content)), content);
  });

  test('browser base64: roundtrips em-dash and Unicode', () => {
    const content = '## Why the 500 happened \u2014 the failure sequence';
    assert.strictEqual(browserDecode(browserEncode(content)), content);
  });

  test('browser base64: roundtrips mixed Unicode (curly quotes, emoji)', () => {
    const content = 'He said \u201chello\u201d \u2014 then left \ud83d\ude00';
    assert.strictEqual(browserDecode(browserEncode(content)), content);
  });

  console.log('\n── CLI Deflate Encoding Tests ──────────────────\n');

  test('CLI deflate: roundtrips ASCII via deflate-raw + base64url', () => {
    const zlib = require('zlib');
    const content = '# Hello World\n\nSome plain ASCII text.';

    // CLI side: deflateRawSync + base64url
    const deflated = zlib.deflateRawSync(Buffer.from(content, 'utf-8'));
    const b64url = deflated.toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Browser side (simulated): base64url → inflateRawSync
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - b64.length % 4) % 4;
    b64 += '='.repeat(pad);
    const inflated = zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf-8');

    assert.strictEqual(inflated, content);
  });

  test('CLI deflate: roundtrips Unicode via deflate-raw + base64url', () => {
    const zlib = require('zlib');
    const content = '## Why the 500 happened \u2014 \u201cthe failure\u201d sequence';

    const deflated = zlib.deflateRawSync(Buffer.from(content, 'utf-8'));
    const b64url = deflated.toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - b64.length % 4) % 4;
    b64 += '='.repeat(pad);
    const inflated = zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf-8');

    assert.strictEqual(inflated, content);
  });
};
