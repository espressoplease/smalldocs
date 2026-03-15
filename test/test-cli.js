/**
 * CLI parseArgs/buildUrl + style merging tests
 */
const path = require('path');
const cli = require(path.join(__dirname, '..', 'bin', 'sdocs-dev.js'));
const SDocYaml = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));
const S = require(path.join(__dirname, '..', 'public', 'sdocs-styles.js'));

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Style Merging Tests ────────────────────────\n');

  test('mergeStyles: defaults applied when no file styles', () => {
    const defaults = { fontFamily: 'Lora', baseFontSize: 17 };
    const result = cli.mergeStyles(defaults, null);
    assert.strictEqual(result.fontFamily, 'Lora');
    assert.strictEqual(result.baseFontSize, 17);
  });

  test('mergeStyles: file styles override defaults', () => {
    const defaults = { fontFamily: 'Lora', baseFontSize: 17, color: '#000' };
    const fileStyles = { fontFamily: 'Inter', baseFontSize: 16 };
    const result = cli.mergeStyles(defaults, fileStyles);
    assert.strictEqual(result.fontFamily, 'Inter');
    assert.strictEqual(result.baseFontSize, 16);
    assert.strictEqual(result.color, '#000');
  });

  test('mergeStyles: nested objects merge at property level', () => {
    const defaults = { h1: { fontSize: 2.3, color: '#c0392b', fontWeight: 700 } };
    const fileStyles = { h1: { color: '#111' } };
    const result = cli.mergeStyles(defaults, fileStyles);
    assert.strictEqual(result.h1.fontSize, 2.3);
    assert.strictEqual(result.h1.color, '#111');
    assert.strictEqual(result.h1.fontWeight, 700);
  });

  test('mergeStyles: no defaults returns file styles', () => {
    const fileStyles = { fontFamily: 'Inter' };
    const result = cli.mergeStyles(null, fileStyles);
    assert.strictEqual(result.fontFamily, 'Inter');
  });

  test('mergeStyles: both null returns empty object', () => {
    const result = cli.mergeStyles(null, null);
    assert.deepStrictEqual(result, {});
  });

  test('applyDefaultStyles: injects styles into content with no front matter', () => {
    const defaults = { fontFamily: 'Lora', baseFontSize: 17 };
    const content = '# Hello\nWorld';
    const { meta, body } = cli.parseFrontMatter(content);
    const merged = cli.mergeStyles(defaults, meta.styles);
    const newMeta = { ...meta, styles: merged };
    const output = cli.serializeFrontMatter(newMeta) + '\n' + body;
    const reparsed = cli.parseFrontMatter(output);
    assert.strictEqual(reparsed.meta.styles.fontFamily, 'Lora');
    assert.strictEqual(reparsed.meta.styles.baseFontSize, 17);
    assert.ok(reparsed.body.includes('# Hello'));
  });

  test('applyDefaultStyles: file styles win over defaults in roundtrip', () => {
    const defaults = { fontFamily: 'Lora', baseFontSize: 17, h1: { fontSize: 2.5 } };
    const content = '---\nstyles:\n  fontFamily: Inter\n  h1: { color: "#fff" }\n---\n# Doc';
    const { meta, body } = cli.parseFrontMatter(content);
    const merged = cli.mergeStyles(defaults, meta.styles);
    assert.strictEqual(merged.fontFamily, 'Inter');
    assert.strictEqual(merged.baseFontSize, 17);
    assert.strictEqual(merged.h1.fontSize, 2.5);
    assert.strictEqual(merged.h1.color, '#fff');
  });

  console.log('\n── CLI Tests ──────────────────────────────────\n');

  test('parseArgs: file and mode', () => {
    const result = cli.parseArgs(['report.md', '--mode', 'read']);
    assert.strictEqual(result.file, 'report.md');
    assert.strictEqual(result.mode, 'read');
    assert.strictEqual(result.url, null);
  });

  test('parseArgs: --url flag', () => {
    const result = cli.parseArgs(['doc.md', '--url', 'http://localhost:3000']);
    assert.strictEqual(result.file, 'doc.md');
    assert.strictEqual(result.url, 'http://localhost:3000');
  });

  test('parseArgs: all flags combined', () => {
    const result = cli.parseArgs(['doc.md', '--mode', 'style', '--url', 'http://localhost:8080']);
    assert.strictEqual(result.file, 'doc.md');
    assert.strictEqual(result.mode, 'style');
    assert.strictEqual(result.url, 'http://localhost:8080');
  });

  test('parseArgs: no args', () => {
    const result = cli.parseArgs([]);
    assert.strictEqual(result.file, null);
    assert.strictEqual(result.mode, null);
    assert.strictEqual(result.url, null);
  });

  test('buildUrl: defaults to sdocs.dev with style mode when no content', () => {
    const url = cli.buildUrl(null, {});
    assert.ok(url.startsWith('https://sdocs.dev/'));
    assert.ok(url.includes('mode=style'));
    assert.ok(!url.includes('md='));
  });

  test('buildUrl: --url flag overrides base', () => {
    const url = cli.buildUrl(null, { url: 'http://localhost:3000' });
    assert.ok(url.startsWith('http://localhost:3000/'));
  });

  test('buildUrl: content produces md= param, omits mode=read (default)', () => {
    const url = cli.buildUrl('# Hello', {});
    assert.ok(url.includes('md='));
    assert.ok(!url.includes('mode='), 'read mode should be omitted from URL (it is the default)');
  });

  test('buildUrl: explicit mode overrides default', () => {
    const url = cli.buildUrl('# Hello', { mode: 'style' });
    assert.ok(url.includes('mode=style'));
  });

  test('buildUrl: content roundtrips through base64', () => {
    const content = '---\nstyles:\n  fontFamily: Lora\n---\n# Test';
    const url = cli.buildUrl(content, {});
    const hash = url.split('#')[1];
    const params = new URLSearchParams(hash);
    const decoded = Buffer.from(decodeURIComponent(params.get('md')), 'base64').toString('utf-8');
    assert.strictEqual(decoded, content);
  });

  test('every setting survives full YAML serialize → parse → stylesToControls roundtrip', () => {
    const styles = {
      fontFamily: 'Lora', baseFontSize: 18, lineHeight: 1.8, color: '#111111',
      headers: { fontFamily: 'Playfair Display', scale: 1.2, marginBottom: 0.6, color: '#222222' },
      h1: { fontSize: 2.5, fontWeight: 800, color: '#aa0000' },
      h2: { fontSize: 1.8, fontWeight: 700, color: '#bb0000' },
      h3: { fontSize: 1.4, fontWeight: 600, color: '#cc0000' },
      h4: { fontSize: 1.1, fontWeight: 500, color: '#dd0000' },
      p: { lineHeight: 1.9, marginBottom: 1.3, color: '#333333' },
      link: { color: '#e11d48', decoration: 'none' },
      code: { font: 'Fira Code', background: '#282c34', color: '#abb2bf' },
      blockquote: { borderColor: '#e11d48', borderWidth: 5, fontSize: 0.95, color: '#555555' },
      list: { spacing: 0.5, indent: 1.5, color: '#444444' },
    };
    const fm = SDocYaml.serializeFrontMatter({ styles });
    const { meta } = SDocYaml.parseFrontMatter(fm + '\n# Doc');
    const parsed = meta.styles;

    assert.strictEqual(parsed.fontFamily, 'Lora');
    assert.strictEqual(parsed.baseFontSize, 18);
    assert.strictEqual(parsed.lineHeight, 1.8);
    assert.strictEqual(parsed.color, '#111111');
    assert.strictEqual(parsed.headers.fontFamily, 'Playfair Display');
    assert.strictEqual(parsed.headers.scale, 1.2);
    assert.strictEqual(parsed.headers.marginBottom, 0.6);
    assert.strictEqual(parsed.headers.color, '#222222');
    assert.strictEqual(parsed.h1.fontSize, 2.5);
    assert.strictEqual(parsed.h1.fontWeight, 800);
    assert.strictEqual(parsed.h1.color, '#aa0000');
    assert.strictEqual(parsed.h2.fontSize, 1.8);
    assert.strictEqual(parsed.h2.fontWeight, 700);
    assert.strictEqual(parsed.h2.color, '#bb0000');
    assert.strictEqual(parsed.h3.fontSize, 1.4);
    assert.strictEqual(parsed.h3.fontWeight, 600);
    assert.strictEqual(parsed.h3.color, '#cc0000');
    assert.strictEqual(parsed.h4.fontSize, 1.1);
    assert.strictEqual(parsed.h4.fontWeight, 500);
    assert.strictEqual(parsed.h4.color, '#dd0000');
    assert.strictEqual(parsed.p.lineHeight, 1.9);
    assert.strictEqual(parsed.p.marginBottom, 1.3);
    assert.strictEqual(parsed.p.color, '#333333');
    assert.strictEqual(parsed.link.color, '#e11d48');
    assert.strictEqual(parsed.link.decoration, 'none');
    assert.strictEqual(parsed.code.font, 'Fira Code');
    assert.strictEqual(parsed.code.background, '#282c34');
    assert.strictEqual(parsed.code.color, '#abb2bf');
    assert.strictEqual(parsed.blockquote.borderColor, '#e11d48');
    assert.strictEqual(parsed.blockquote.borderWidth, 5);
    assert.strictEqual(parsed.blockquote.fontSize, 0.95);
    assert.strictEqual(parsed.blockquote.color, '#555555');
    assert.strictEqual(parsed.list.spacing, 0.5);
    assert.strictEqual(parsed.list.indent, 1.5);
    assert.strictEqual(parsed.list.color, '#444444');

    const { controls, overriddenColors } = S.stylesToControls(parsed);
    assert.strictEqual(controls['ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['ctrl-base-size-num'], 18);
    assert.strictEqual(controls['ctrl-line-height-num'], 1.8);
    assert.strictEqual(controls['ctrl-h-font-family'], 'Playfair Display');
    assert.strictEqual(controls['ctrl-h-scale-num'], 1.2);
    assert.strictEqual(controls['ctrl-h-mb-num'], 0.6);
    assert.strictEqual(controls['ctrl-h1-size-num'], 2.5);
    assert.strictEqual(controls['ctrl-h1-weight'], '800');
    assert.strictEqual(controls['ctrl-h2-size-num'], 1.8);
    assert.strictEqual(controls['ctrl-h2-weight'], '700');
    assert.strictEqual(controls['ctrl-h3-size-num'], 1.4);
    assert.strictEqual(controls['ctrl-h3-weight'], '600');
    assert.strictEqual(controls['ctrl-h4-size-num'], 1.1);
    assert.strictEqual(controls['ctrl-h4-weight'], '500');
    assert.strictEqual(controls['ctrl-p-lh-num'], 1.9);
    assert.strictEqual(controls['ctrl-p-mb-num'], 1.3);
    assert.strictEqual(controls['ctrl-link-color'], '#e11d48');
    assert.strictEqual(controls['ctrl-link-decoration'], 'none');
    assert.strictEqual(controls['ctrl-code-font'], 'Fira Code');
    assert.strictEqual(controls['ctrl-code-bg'], '#282c34');
    assert.strictEqual(controls['ctrl-code-color'], '#abb2bf');
    assert.strictEqual(controls['ctrl-bq-border-color'], '#e11d48');
    assert.strictEqual(controls['ctrl-bq-bw-num'], 5);
    assert.strictEqual(controls['ctrl-bq-size-num'], 0.95);
    assert.strictEqual(controls['ctrl-bq-color'], '#555555');
    assert.strictEqual(controls['ctrl-list-spacing-num'], 0.5);
    assert.strictEqual(controls['ctrl-list-indent-num'], 1.5);

    assert.ok(overriddenColors.has('ctrl-color'));
    assert.ok(overriddenColors.has('ctrl-h-color'));
    assert.ok(overriddenColors.has('ctrl-h1-color'));
    assert.ok(overriddenColors.has('ctrl-h2-color'));
    assert.ok(overriddenColors.has('ctrl-h3-color'));
    assert.ok(overriddenColors.has('ctrl-h4-color'));
    assert.ok(overriddenColors.has('ctrl-p-color'));
    assert.ok(overriddenColors.has('ctrl-list-color'));
  });
};
