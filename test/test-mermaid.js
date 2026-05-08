module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Mermaid Tests ───────────────────────────────\n');

  // Mirror the directive-strip regex from public/sdocs-mermaid.js. Tested
  // here in Node because the browser file is an IIFE that side-effects
  // window.SDocs - same pattern as test-chart-replace.js.
  const INIT_DIRECTIVE_RE = /%%\s*\{\s*init\s*:[\s\S]*?\}\s*%%/g;
  function stripDirectives(src) {
    return String(src || '').replace(INIT_DIRECTIVE_RE, '');
  }

  test('stripDirectives: removes %%{init: {...}}%% block', () => {
    const src = '%%{init: {"securityLevel":"loose"}}%%\ngraph TD\n  A --> B';
    const out = stripDirectives(src);
    assert.ok(!out.includes('init'), 'init directive should be gone');
    assert.ok(out.includes('graph TD'));
    assert.ok(out.includes('A --> B'));
  });

  test('stripDirectives: removes directive with whitespace variants', () => {
    const src = '%%  {  init :  {"theme":"dark"}  }  %%\nflowchart LR';
    const out = stripDirectives(src);
    assert.ok(!out.includes('init'));
    assert.ok(out.includes('flowchart LR'));
  });

  test('stripDirectives: removes multiple directives in one source', () => {
    const src = '%%{init: {"a":1}}%%\ngraph TD\n%%{init: {"b":2}}%%\nA --> B';
    const out = stripDirectives(src);
    assert.ok(!out.match(/init/), 'no init residue');
    assert.ok(out.includes('A --> B'));
  });

  test('stripDirectives: leaves diagram source untouched when no directive', () => {
    const src = 'graph TD\n  A[label] --> B';
    assert.strictEqual(stripDirectives(src), src);
  });

  test('stripDirectives: leaves non-init %% comments untouched', () => {
    // Mermaid uses %% for normal comments. We only strip {init:} forms.
    const src = '%% this is a comment\ngraph TD\nA --> B';
    const out = stripDirectives(src);
    assert.ok(out.includes('%% this is a comment'));
  });

  test('stripDirectives: handles null / undefined / non-string', () => {
    assert.strictEqual(stripDirectives(null), '');
    assert.strictEqual(stripDirectives(undefined), '');
    assert.strictEqual(stripDirectives(42), '42');
  });

  // ── Marked output shape ────────────────────────────
  // Confirms a ```mermaid fence gets <code class="language-mermaid">,
  // which is the selector processMermaid relies on.
  const { marked } = require('marked');

  test('marked: ```mermaid fence emits code.language-mermaid', () => {
    const md = '```mermaid\ngraph TD\n  A --> B\n```';
    const html = marked.parse(md);
    assert.ok(/<code[^>]*class="[^"]*language-mermaid/.test(html),
      'expected language-mermaid class on <code>: ' + html);
  });

  test('marked: mermaid source is HTML-escaped inside the code block', () => {
    const md = '```mermaid\ngraph TD\n  A["<b>x</b>"] --> B\n```';
    const html = marked.parse(md);
    assert.ok(html.includes('&lt;b&gt;'), 'angle brackets escaped: ' + html);
    assert.ok(!html.includes('<b>x</b>'), 'raw HTML must not survive');
  });

  test('marked: two adjacent mermaid blocks each get their own <code>', () => {
    const md = '```mermaid\nA --> B\n```\n\n```mermaid\nC --> D\n```';
    const html = marked.parse(md);
    const matches = html.match(/class="[^"]*language-mermaid[^"]*"/g) || [];
    assert.strictEqual(matches.length, 2, 'expected 2 mermaid code blocks');
  });

  // ── Source-size cap ────────────────────────────────
  // The cap is enforced at render time in the browser. Test the constant
  // and the comparison shape so a future reviewer who changes one but not
  // the other notices.
  const SOURCE_BYTE_CAP = 64 * 1024;

  test('size cap: 64 KB constant matches sdocs-mermaid.js', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'public', 'sdocs-mermaid.js'),
      'utf8'
    );
    assert.ok(/SOURCE_BYTE_CAP\s*=\s*64\s*\*\s*1024/.test(src),
      'public/sdocs-mermaid.js should declare SOURCE_BYTE_CAP = 64 * 1024');
    assert.ok(/DOC_BLOCK_CAP\s*=\s*50/.test(src),
      'public/sdocs-mermaid.js should declare DOC_BLOCK_CAP = 50');
    assert.ok(/RENDER_TIMEOUT_MS\s*=\s*5000/.test(src),
      'public/sdocs-mermaid.js should declare RENDER_TIMEOUT_MS = 5000');
  });

  test('size cap: a 65 KB source would exceed the limit', () => {
    const huge = 'A --> B\n'.repeat(8200); // ~65 KB
    assert.ok(huge.length > SOURCE_BYTE_CAP);
  });

  // ── Security defaults: confirm strict + htmlLabels:false in source ──
  test('hardening: sdocs-mermaid.js sets securityLevel: strict', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'public', 'sdocs-mermaid.js'),
      'utf8'
    );
    assert.ok(/securityLevel:\s*'strict'/.test(src),
      "expected securityLevel: 'strict' in mermaid.initialize");
    // We deliberately use htmlLabels:true to enable auto-wrap on long labels
    // (a major usability win for agent-authored diagrams). The post-sanitize
    // is what makes that safe - this test confirms both halves are still in
    // the source: htmlLabels:true is set, AND the sanitiser strips the
    // dangerous tags that htmlLabels exposes.
    assert.ok(/flowchart:\s*\{[\s\S]*?htmlLabels:\s*true/.test(src),
      'expected htmlLabels:true inside flowchart config block');
    assert.ok(/sequence:\s*\{[^}]*htmlLabels:\s*true/.test(src),
      'expected htmlLabels:true inside sequence config block');
  });

  test('hardening: post-sanitize forbids dangerous tags', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'public', 'sdocs-mermaid.js'),
      'utf8'
    );
    // The post-sanitize allows foreignObject (so htmlLabels can render)
    // but strips everything inside that could execute, exfiltrate, or
    // build phishing UI. Keys live in the FORBIDDEN_TAGS object literal -
    // assert each tag name appears in the source.
    const must = [
      'script', 'iframe', 'object', 'embed',
      'form', 'input', 'textarea', 'button',
      'use', 'animate'
    ];
    must.forEach(tag => {
      assert.ok(new RegExp('\\b' + tag + '\\s*:\\s*1').test(src),
        'expected FORBIDDEN_TAGS to include ' + tag);
    });
    // <style> isn't blanket-forbidden (Mermaid's SVG-level <style> is
    // essential for node fills), but the source should contain the
    // foreignObject contextual check that strips style inside it.
    assert.ok(/isInsideForeignObject/.test(src),
      'expected isInsideForeignObject helper');
  });

  test('hardening: post-sanitize strips javascript: URLs and on* attrs', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'public', 'sdocs-mermaid.js'),
      'utf8'
    );
    assert.ok(/JS_URL_RE/.test(src), 'expected javascript: URL regex');
    // The on* event handler strip lives in the attribute walk - check
    // it explicitly checks for the 'on' prefix.
    assert.ok(/name\.indexOf\('on'\)\s*===\s*0/.test(src),
      'expected on* attribute strip');
  });
};
