/**
 * Browser base64 UTF-8 roundtrip tests
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

  test('browser base64: CLI encode → browser decode roundtrip', () => {
    const content = '## Why the 500 happened \u2014 the failure sequence';
    const cliEncoded = encodeURIComponent(Buffer.from(content, 'utf-8').toString('base64'));
    assert.strictEqual(browserDecode(cliEncoded), content);
  });

  test('browser base64: browser encode → CLI decode roundtrip', () => {
    const content = '## Em-dash \u2014 and curly \u201cquotes\u201d';
    const encoded = browserEncode(content);
    const cliDecoded = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf-8');
    assert.strictEqual(cliDecoded, content);
  });
};
