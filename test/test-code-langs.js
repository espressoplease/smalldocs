/**
 * code-langs tests - extension -> highlight.js fence label, and wrapping.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Code Langs Tests ───────────────────────────\n');

  const { langForFile, isCodeFile, wrapCodeFile } = require('../cli/lib/code-langs');

  test('langForFile: common extensions map to highlight.js names', () => {
    assert.strictEqual(langForFile('app.rb'), 'ruby');
    assert.strictEqual(langForFile('server.js'), 'javascript');
    assert.strictEqual(langForFile('types.ts'), 'typescript');
    assert.strictEqual(langForFile('view.tsx'), 'typescript');
    assert.strictEqual(langForFile('main.go'), 'go');
    assert.strictEqual(langForFile('lib.rs'), 'rust');
    assert.strictEqual(langForFile('a.py'), 'python');
  });

  test('langForFile: case-insensitive and path-aware', () => {
    assert.strictEqual(langForFile('/deep/PATH/App.RB'), 'ruby');
    assert.strictEqual(langForFile('C:\\proj\\Main.GO'.replace(/\\/g, '/')), 'go');
  });

  test('langForFile: extensionless Dockerfile is recognised by name', () => {
    assert.strictEqual(langForFile('Dockerfile'), 'dockerfile');
    assert.strictEqual(langForFile('/srv/Dockerfile'), 'dockerfile');
  });

  test('langForFile: documents and unknowns are not code', () => {
    assert.strictEqual(langForFile('README.md'), '');
    assert.strictEqual(langForFile('notes.txt'), '');
    assert.strictEqual(langForFile('archive.zip'), '');
    assert.strictEqual(langForFile(''), '');
    assert.strictEqual(langForFile(null), '');
  });

  test('isCodeFile mirrors langForFile truthiness', () => {
    assert.strictEqual(isCodeFile('a.rb'), true);
    assert.strictEqual(isCodeFile('a.md'), false);
  });

  test('wrapCodeFile: fences with the language and trims trailing whitespace', () => {
    assert.strictEqual(wrapCodeFile('puts 1\n\n', 'a.rb'), '```ruby\nputs 1\n```\n');
  });

  test('wrapCodeFile: preserves interior blank lines and indentation', () => {
    const src = 'def a\n\n  b\nend';
    assert.strictEqual(wrapCodeFile(src, 'a.rb'), '```ruby\ndef a\n\n  b\nend\n```\n');
  });

  test('wrapCodeFile: optional label rides in the fence info string', () => {
    // A code walkthrough labels each fence with its filename so the browser
    // can name the tab; a plain open passes no label and the fence is unchanged.
    assert.strictEqual(wrapCodeFile('puts 1', 'app.rb', 'app.rb'), '```ruby app.rb\nputs 1\n```\n');
    assert.strictEqual(wrapCodeFile('puts 1', 'app.rb'), '```ruby\nputs 1\n```\n');
  });

  // Drift guard: the CLI writes these labels into the fence, and the browser
  // hands them straight to highlight.js. Every label must therefore be a name
  // highlight.js actually knows (core bundle or an on-demand pack). This list
  // is the set highlight.js supports that we rely on; adding a new extension
  // means confirming its language belongs here, which is the point.
  const { LANG_BY_EXT } = require('../cli/lib/code-langs');
  const KNOWN_HLJS_LANGS = new Set([
    'javascript', 'typescript', 'python', 'ruby', 'go', 'rust', 'java',
    'kotlin', 'swift', 'c', 'cpp', 'csharp', 'php', 'scala', 'elixir',
    'erlang', 'clojure', 'haskell', 'lua', 'perl', 'r', 'dart', 'bash',
    'powershell', 'sql', 'yaml', 'toml', 'ini', 'json', 'xml', 'css',
    'scss', 'less', 'dockerfile', 'diff', 'graphql', 'protobuf'
  ]);

  test('every LANG_BY_EXT label is a highlight.js language we support', () => {
    Object.keys(LANG_BY_EXT).forEach((ext) => {
      const lang = LANG_BY_EXT[ext];
      assert.ok(KNOWN_HLJS_LANGS.has(lang),
        '.' + ext + ' maps to "' + lang + '", which is not in the supported highlight.js set');
    });
  });
};
