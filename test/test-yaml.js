/**
 * YAML front matter parse/serialize tests
 * Uses shared sdocs-yaml.js module
 */
const path = require('path');
const fs = require('fs');
const SDocYaml = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));

module.exports = function(harness) {
  const { assert, test } = harness;
  const { parseFrontMatter, serializeFrontMatter } = SDocYaml;

  console.log('\n── YAML Tests ─────────────────────────────────\n');

  test('parseFrontMatter: no front matter → empty meta + original body', () => {
    const { meta, body } = parseFrontMatter('# Hello\nWorld');
    assert.deepStrictEqual(meta, {});
    assert.strictEqual(body, '# Hello\nWorld');
  });

  test('parseFrontMatter: extracts scalar fields', () => {
    const text = '---\ntitle: "My Doc"\nauthor: Jane\n---\n# Body';
    const { meta, body } = parseFrontMatter(text);
    assert.strictEqual(meta.title, 'My Doc');
    assert.strictEqual(meta.author, 'Jane');
    assert.strictEqual(body, '# Body');
  });

  test('parseFrontMatter: parses numeric values', () => {
    const text = '---\nstyles:\n  baseFontSize: 17\n---\n';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.styles.baseFontSize, 17);
  });

  test('parseFrontMatter: parses inline object values', () => {
    const text = '---\nstyles:\n  h1: { fontSize: 2.4, color: "#fff" }\n---\n';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.styles.h1.fontSize, 2.4);
    assert.strictEqual(meta.styles.h1.color, '#fff');
  });

  test('parseFrontMatter: roundtrip serialize → parse', () => {
    const original = {
      title: 'Test',
      styles: {
        fontFamily: 'Inter',
        baseFontSize: 16,
        h1: { fontSize: 2.2, color: '#fff' },
      }
    };
    const fm = serializeFrontMatter(original);
    const { meta } = parseFrontMatter(fm + '\n# body');
    assert.strictEqual(meta.title, 'Test');
    assert.strictEqual(meta.styles.fontFamily, 'Inter');
    assert.strictEqual(meta.styles.baseFontSize, 16);
    assert.strictEqual(meta.styles.h1.fontSize, 2.2);
    assert.strictEqual(meta.styles.h1.color, '#fff');
  });

  test('parseFrontMatter: sample.smd fixture parses correctly', () => {
    const smd = fs.readFileSync(path.join(__dirname, 'sample.smd'), 'utf-8');
    const { meta, body } = parseFrontMatter(smd);
    assert.strictEqual(meta.title, 'Sample Styled Document');
    assert.strictEqual(meta.styles.fontFamily, 'Inter');
    assert.strictEqual(meta.styles.baseFontSize, 16);
    assert.ok(body.includes('# Sample Styled Document'));
  });

  test('serializeFrontMatter: produces --- delimiters', () => {
    const fm = serializeFrontMatter({ title: 'T' });
    assert.ok(fm.startsWith('---\n'));
    assert.ok(fm.endsWith('\n---'));
  });

  test('export styled: body is preserved after front matter', () => {
    const styles = { fontFamily: 'Roboto', baseFontSize: 16 };
    const body = '# Hello\nWorld\n';
    const fm = serializeFrontMatter({ styles });
    const full = fm + '\n' + body;
    const { meta, body: parsedBody } = parseFrontMatter(full);
    assert.strictEqual(meta.styles.fontFamily, 'Roboto');
    assert.strictEqual(parsedBody.trim(), '# Hello\nWorld');
  });

  test('parseFrontMatter: empty front matter block returns raw text', () => {
    // Regex requires content between --- delimiters, so ---\n--- is not front matter
    const { meta, body } = parseFrontMatter('---\n---\n# Hello');
    assert.deepStrictEqual(meta, {});
    assert.strictEqual(body, '---\n---\n# Hello');
  });

  test('parseFrontMatter: front matter with only whitespace', () => {
    const { meta, body } = parseFrontMatter('---\n \n---\n# Hello');
    assert.deepStrictEqual(meta, {});
    assert.strictEqual(body, '# Hello');
  });

  test('parseFrontMatter: Windows \\r\\n line endings', () => {
    const text = '---\r\ntitle: "Win"\r\nstyles:\r\n  baseFontSize: 14\r\n---\r\n# Body';
    const { meta, body } = parseFrontMatter(text);
    assert.strictEqual(meta.title, 'Win');
    assert.strictEqual(meta.styles.baseFontSize, 14);
    assert.ok(body.includes('# Body'));
  });

  test('parseFrontMatter: empty string returns empty meta', () => {
    const { meta, body } = parseFrontMatter('');
    assert.deepStrictEqual(meta, {});
    assert.strictEqual(body, '');
  });

  test('parseScalar: boolean-like strings stay as strings', () => {
    const { parseScalar } = SDocYaml;
    assert.strictEqual(parseScalar('true'), 'true');
    assert.strictEqual(parseScalar('false'), 'false');
  });

  test('parseScalar: strips surrounding quotes', () => {
    const { parseScalar } = SDocYaml;
    assert.strictEqual(parseScalar('"hello"'), 'hello');
    assert.strictEqual(parseScalar("'world'"), 'world');
  });

  // ── Prototype-pollution guard ───────────────────────────────────
  // The parser used to assign keys directly onto plain objects, so a
  // crafted YAML payload with `__proto__:` could ghost-inject values
  // that callers reading `meta.x` would resolve via the prototype chain
  // even when the document had no real `x`. We skip the three dangerous
  // keys at every level (block, inline-object, array-item).

  test('parseFrontMatter: __proto__ at block level is ignored', () => {
    const text = '---\n__proto__:\n  polluted: yes\ntitle: "ok"\n---\n# Body';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.title, 'ok');
    assert.strictEqual({}.polluted, undefined, 'Object.prototype must not be polluted');
    assert.strictEqual(meta.polluted, undefined, 'meta.polluted must not resolve via prototype chain');
  });

  test('parseFrontMatter: __proto__ in inline object is ignored', () => {
    const text = '---\nstyles: { __proto__: bad, color: red }\n---\n# Body';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.styles.color, 'red');
    assert.strictEqual(meta.styles.polluted, undefined);
  });

  test('parseFrontMatter: __proto__ inside array item is ignored', () => {
    const text = '---\ncomments:\n  - id: c1\n    __proto__: bad\n    text: ok\n---\n# Body';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.comments[0].id, 'c1');
    assert.strictEqual(meta.comments[0].text, 'ok');
    // Reading any random key on the parsed item must not resolve via
    // Object.prototype (would happen if __proto__ replaced the chain).
    assert.strictEqual(meta.comments[0].toString.name, 'toString');
  });

  test('parseFrontMatter: constructor and prototype keys also skipped', () => {
    const text = '---\nconstructor:\n  evil: 1\nprototype:\n  evil: 1\nok: yes\n---\n# Body';
    const { meta } = parseFrontMatter(text);
    assert.strictEqual(meta.ok, 'yes');
    // constructor/prototype lookups must still resolve to the real
    // Object.prototype values, proving they weren't replaced.
    assert.strictEqual(meta.constructor, Object);
  });
};
