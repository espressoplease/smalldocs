/**
 * Red/Green test runner for sdocs-dev
 * Usage: node test/run.js
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Colours ──────────────────────────────────────────
const GREEN = '\x1b[32m✔\x1b[0m';
const RED   = '\x1b[31m✘\x1b[0m';
const RESET = '\x1b[0m';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${GREEN} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${RED} ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`${GREEN} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${RED} ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

// ── Inline: YAML front matter parsing ─────────────────
// We re-implement the same logic as index.html to test it in Node
function parseScalar(v) {
  v = v.trim().replace(/^["']|["']$/g, '');
  const n = Number(v);
  if (!isNaN(n) && v !== '') return n;
  return v;
}
function parseInlineObject(str) {
  const inner = str.replace(/^\{/, '').replace(/\}$/, '').trim();
  const obj = {};
  inner.split(',').forEach(pair => {
    const m = pair.trim().match(/^(\w[\w-]*):\s*(.*)/);
    if (m) obj[m[1]] = parseScalar(m[2].trim());
  });
  return obj;
}
function parseSimpleYaml(str) {
  const result = {};
  const lines = str.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!keyMatch) { i++; continue; }
    const key = keyMatch[1];
    const rest = keyMatch[2].trim();
    if (rest.startsWith('{')) {
      result[key] = parseInlineObject(rest);
      i++;
    } else if (rest === '') {
      const nested = {};
      i++;
      while (i < lines.length && lines[i].match(/^  /)) {
        const nl = lines[i].trim();
        const nm = nl.match(/^(\w[\w-]*):\s*(.*)/);
        if (nm) {
          const nrest = nm[2].trim();
          nested[nm[1]] = nrest.startsWith('{') ? parseInlineObject(nrest) : parseScalar(nrest);
        }
        i++;
      }
      result[key] = nested;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }
  return result;
}
function parseFrontMatter(text) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, body: text };
  const yamlStr = m[1];
  const body = text.slice(m[0].length);
  const meta = parseSimpleYaml(yamlStr);
  return { meta, body };
}
function serializeFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'object' && sv !== null) {
          const inner = Object.entries(sv).map(([a, b]) => `${a}: ${JSON.stringify(b)}`).join(', ');
          lines.push(`  ${sk}: { ${inner} }`);
        } else {
          lines.push(`  ${sk}: ${JSON.stringify(sv)}`);
        }
      }
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════
//  UNIT TESTS (no server needed)
// ══════════════════════════════════════════════════════
console.log('\n── Unit Tests ─────────────────────────────────\n');

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

test('server.js file exists', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  assert.ok(fs.existsSync(serverPath), 'server.js not found');
});

test('public/index.html exists', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  assert.ok(fs.existsSync(htmlPath), 'public/index.html not found');
});

test('index.html contains required markup elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
  assert.ok(html.includes('id="rendered"'), 'missing #rendered');
  assert.ok(html.includes('id="raw"'), 'missing #raw');
  assert.ok(html.includes('id="right"'), 'missing #right panel');
});

test('styles.css contains drag-over overlay', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf-8');
  assert.ok(css.includes('drag-over'), 'missing drag-over class');
});

test('public/styles.css exists', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  assert.ok(fs.existsSync(cssPath), 'public/styles.css not found');
});

test('public/app.js exists', () => {
  const jsPath = path.join(__dirname, '..', 'public', 'app.js');
  assert.ok(fs.existsSync(jsPath), 'public/app.js not found');
});

test('app.js contains required functions', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf-8');
  assert.ok(js.includes('parseFrontMatter'), 'missing parseFrontMatter function');
  assert.ok(js.includes('serializeFrontMatter'), 'missing serializeFrontMatter function');
  assert.ok(js.includes('collectStyles'), 'missing collectStyles function');
  assert.ok(js.includes('GOOGLE_FONTS'), 'missing GOOGLE_FONTS array');
});

test('app.js has at least 20 Google Fonts', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf-8');
  const m = js.match(/const GOOGLE_FONTS = \[([\s\S]*?)\]/);
  assert.ok(m, 'GOOGLE_FONTS array not found');
  const fonts = m[1].split(',').filter(s => s.trim().length > 0);
  assert.ok(fonts.length >= 20, `only ${fonts.length} fonts (need >= 20)`);
});

// ══════════════════════════════════════════════════════
//  STYLE MERGING TESTS (from CLI module)
// ══════════════════════════════════════════════════════
console.log('\n── Style Merging Tests ────────────────────────\n');

const cli = require(path.join(__dirname, '..', 'bin', 'sdocs-dev.js'));

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
  assert.strictEqual(result.color, '#000'); // default preserved
});

test('mergeStyles: nested objects merge at property level', () => {
  const defaults = { h1: { fontSize: 2.3, color: '#c0392b', fontWeight: 700 } };
  const fileStyles = { h1: { color: '#111' } };
  const result = cli.mergeStyles(defaults, fileStyles);
  assert.strictEqual(result.h1.fontSize, 2.3);   // from default
  assert.strictEqual(result.h1.color, '#111');     // from file
  assert.strictEqual(result.h1.fontWeight, 700);   // from default
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
  // This test only works if ~/.sdocs/styles.yaml exists, so we test the
  // underlying parseFrontMatter + mergeStyles + serializeFrontMatter pipeline
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
  assert.strictEqual(merged.fontFamily, 'Inter');      // file wins
  assert.strictEqual(merged.baseFontSize, 17);          // default fills in
  assert.strictEqual(merged.h1.fontSize, 2.5);          // default fills in nested
  assert.strictEqual(merged.h1.color, '#fff');           // file wins nested
});

// ══════════════════════════════════════════════════════
//  SDOCS-STYLES PURE MODULE TESTS (real production code)
// ══════════════════════════════════════════════════════
console.log('\n── SDocStyles Pure Module Tests ───────────────\n');

const S = require(path.join(__dirname, '..', 'public', 'sdocs-styles.js'));

test('collectStyles: non-overridden colors omitted', () => {
  const values = {
    'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
    'ctrl-line-height-num': '1.75', 'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
    'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
    'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
    'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
    'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
    'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
    'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
    'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
    'ctrl-code-color': '#6B21A8',
    'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
    'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
    'ctrl-color': '#1c1917', 'ctrl-h-color': '#1c1917',
    'ctrl-h1-color': '#1c1917', 'ctrl-h2-color': '#1c1917',
    'ctrl-h3-color': '#1c1917', 'ctrl-h4-color': '#1c1917',
    'ctrl-p-color': '#1c1917', 'ctrl-list-color': '#1c1917',
  };
  const styles = S.collectStyles(values, new Set());
  assert.strictEqual(styles.color, undefined);
  assert.strictEqual(styles.headers.color, undefined);
  assert.strictEqual(styles.h1.color, undefined);
  assert.strictEqual(styles.p.color, undefined);
});

test('collectStyles: overridden colors emitted', () => {
  const values = {
    'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
    'ctrl-line-height-num': '1.75', 'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
    'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
    'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
    'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
    'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
    'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
    'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
    'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
    'ctrl-code-color': '#6B21A8',
    'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
    'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
    'ctrl-color': '#ff0000', 'ctrl-h1-color': '#0000ff',
  };
  const overridden = new Set(['ctrl-color', 'ctrl-h1-color']);
  const styles = S.collectStyles(values, overridden);
  assert.strictEqual(styles.color, '#ff0000');
  assert.strictEqual(styles.h1.color, '#0000ff');
  assert.strictEqual(styles.h2.color, undefined);
});

// Every non-color setting: controls → collectStyles → stylesToControls → verify
test('every non-color setting roundtrips through collectStyles → stylesToControls', () => {
  const values = {
    'ctrl-font-family': "'Lora', serif",
    'ctrl-base-size-num': '18',
    'ctrl-line-height-num': '1.8',
    'ctrl-h-font-family': "'Playfair Display', serif",
    'ctrl-h-scale-num': '1.2',
    'ctrl-h-mb-num': '0.6',
    'ctrl-h1-size-num': '2.5', 'ctrl-h1-weight': '800',
    'ctrl-h2-size-num': '1.8', 'ctrl-h2-weight': '700',
    'ctrl-h3-size-num': '1.4', 'ctrl-h3-weight': '600',
    'ctrl-h4-size-num': '1.1', 'ctrl-h4-weight': '500',
    'ctrl-p-lh-num': '1.9',
    'ctrl-p-mb-num': '1.3',
    'ctrl-link-color': '#e11d48',
    'ctrl-link-decoration': 'none',
    'ctrl-code-font': "'Fira Code', monospace",
    'ctrl-code-bg': '#282c34',
    'ctrl-code-color': '#abb2bf',
    'ctrl-bq-border-color': '#e11d48',
    'ctrl-bq-bw-num': '5',
    'ctrl-bq-size-num': '0.95',
    'ctrl-bq-color': '#555555',
    'ctrl-list-spacing-num': '0.5',
    'ctrl-list-indent-num': '1.5',
  };
  const styles = S.collectStyles(values, new Set());

  // Check every property in the styles object
  assert.strictEqual(styles.fontFamily, 'Lora');
  assert.strictEqual(styles.baseFontSize, 18);
  assert.strictEqual(styles.lineHeight, 1.8);
  assert.strictEqual(styles.headers.fontFamily, 'Playfair Display');
  assert.strictEqual(styles.headers.scale, 1.2);
  assert.strictEqual(styles.headers.marginBottom, 0.6);
  assert.strictEqual(styles.h1.fontSize, 2.5);
  assert.strictEqual(styles.h1.fontWeight, 800);
  assert.strictEqual(styles.h2.fontSize, 1.8);
  assert.strictEqual(styles.h2.fontWeight, 700);
  assert.strictEqual(styles.h3.fontSize, 1.4);
  assert.strictEqual(styles.h3.fontWeight, 600);
  assert.strictEqual(styles.h4.fontSize, 1.1);
  assert.strictEqual(styles.h4.fontWeight, 500);
  assert.strictEqual(styles.p.lineHeight, 1.9);
  assert.strictEqual(styles.p.marginBottom, 1.3);
  assert.strictEqual(styles.link.color, '#e11d48');
  assert.strictEqual(styles.link.decoration, 'none');
  assert.strictEqual(styles.code.font, 'Fira Code');
  assert.strictEqual(styles.code.background, '#282c34');
  assert.strictEqual(styles.code.color, '#abb2bf');
  assert.strictEqual(styles.blockquote.borderColor, '#e11d48');
  assert.strictEqual(styles.blockquote.borderWidth, 5);
  assert.strictEqual(styles.blockquote.fontSize, 0.95);
  assert.strictEqual(styles.blockquote.color, '#555555');
  assert.strictEqual(styles.list.spacing, 0.5);
  assert.strictEqual(styles.list.indent, 1.5);

  // Roundtrip back to controls and verify every value
  const { controls } = S.stylesToControls(styles);
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
});

// Every cascade color: controls → collectStyles → stylesToControls → verify
test('every cascade color roundtrips through collectStyles → stylesToControls', () => {
  const values = {
    'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
    'ctrl-line-height-num': '1.75', 'ctrl-h-font-family': 'inherit',
    'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
    'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
    'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
    'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
    'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
    'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
    'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
    'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
    'ctrl-code-color': '#6B21A8',
    'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
    'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
    'ctrl-list-spacing-num': '0.3', 'ctrl-list-indent-num': '1.6',
    'ctrl-color': '#111111',
    'ctrl-h-color': '#222222',
    'ctrl-h1-color': '#aa0000',
    'ctrl-h2-color': '#bb0000',
    'ctrl-h3-color': '#cc0000',
    'ctrl-h4-color': '#dd0000',
    'ctrl-p-color': '#333333',
    'ctrl-list-color': '#444444',
  };
  const allOverridden = new Set([
    'ctrl-color', 'ctrl-h-color',
    'ctrl-h1-color', 'ctrl-h2-color', 'ctrl-h3-color', 'ctrl-h4-color',
    'ctrl-p-color', 'ctrl-list-color',
  ]);
  const styles = S.collectStyles(values, allOverridden);

  assert.strictEqual(styles.color, '#111111');
  assert.strictEqual(styles.headers.color, '#222222');
  assert.strictEqual(styles.h1.color, '#aa0000');
  assert.strictEqual(styles.h2.color, '#bb0000');
  assert.strictEqual(styles.h3.color, '#cc0000');
  assert.strictEqual(styles.h4.color, '#dd0000');
  assert.strictEqual(styles.p.color, '#333333');
  assert.strictEqual(styles.list.color, '#444444');

  const { controls, overriddenColors } = S.stylesToControls(styles);
  assert.strictEqual(controls['ctrl-color'], '#111111');
  assert.strictEqual(controls['ctrl-h-color'], '#222222');
  assert.strictEqual(controls['ctrl-h1-color'], '#aa0000');
  assert.strictEqual(controls['ctrl-h2-color'], '#bb0000');
  assert.strictEqual(controls['ctrl-h3-color'], '#cc0000');
  assert.strictEqual(controls['ctrl-h4-color'], '#dd0000');
  assert.strictEqual(controls['ctrl-p-color'], '#333333');
  assert.strictEqual(controls['ctrl-list-color'], '#444444');

  for (const id of allOverridden) {
    assert.ok(overriddenColors.has(id), `${id} should be in overriddenColors`);
  }
});

test('controlToCssVars: base-size adds px suffix', () => {
  const result = S.controlToCssVars('ctrl-base-size-num', '18', {});
  assert.deepStrictEqual(result, [{ cssVar: '--md-base-size', value: '18px' }]);
});

test('controlToCssVars: bq-border combines color + width', () => {
  const allVals = { 'ctrl-bq-border-color': '#ff0000', 'ctrl-bq-bw-num': '4' };
  const result = S.controlToCssVars('ctrl-bq-border-color', '#ff0000', allVals);
  assert.deepStrictEqual(result, [{ cssVar: '--md-bq-border', value: '4px solid #ff0000' }]);
});

test('controlToCssVars: code-bg sets both code-bg and pre-bg', () => {
  const result = S.controlToCssVars('ctrl-code-bg', '#f0f0f0', {});
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].cssVar, '--md-code-bg');
  assert.strictEqual(result[1].cssVar, '--md-pre-bg');
});

test('controlToCssVars: p-margin uses template', () => {
  const result = S.controlToCssVars('ctrl-p-mb-num', '1.5', {});
  assert.deepStrictEqual(result, [{ cssVar: '--md-p-margin', value: '0 0 1.5em' }]);
});

test('cascadeColor: propagates to non-overridden children', () => {
  const overridden = new Set();
  const updates = S.cascadeColor('ctrl-color', '#ff0000', overridden);
  assert.strictEqual(updates['ctrl-color'], '#ff0000');
  assert.strictEqual(updates['ctrl-h-color'], '#ff0000');
  assert.strictEqual(updates['ctrl-h1-color'], '#ff0000');
  assert.strictEqual(updates['ctrl-p-color'], '#ff0000');
  assert.strictEqual(updates['ctrl-list-color'], '#ff0000');
});

test('cascadeColor: stops at overridden children', () => {
  const overridden = new Set(['ctrl-h1-color']);
  const updates = S.cascadeColor('ctrl-color', '#ff0000', overridden);
  assert.strictEqual(updates['ctrl-h2-color'], '#ff0000'); // not overridden
  assert.strictEqual(updates['ctrl-h1-color'], undefined); // overridden, skipped
});

test('stylesToControls: maps all style keys to control IDs', () => {
  const styles = { fontFamily: 'Lora', baseFontSize: 17, color: '#ff0000',
    h1: { fontSize: 2.3, color: '#0000ff', fontWeight: 700 } };
  const { controls, overriddenColors } = S.stylesToControls(styles);
  assert.strictEqual(controls['ctrl-font-family'], 'Lora');
  assert.strictEqual(controls['ctrl-base-size-num'], 17);
  assert.ok(overriddenColors.has('ctrl-color'));
  assert.ok(overriddenColors.has('ctrl-h1-color'));
  assert.ok(!overriddenColors.has('ctrl-h2-color'));
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
  const fm = cli.serializeFrontMatter({ styles });
  const { meta } = cli.parseFrontMatter(fm + '\n# Doc');
  const parsed = meta.styles;

  // Verify every value survived YAML serialization
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

  // Verify stylesToControls maps everything back correctly
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

  // Verify all cascade colors are marked as overridden
  assert.ok(overriddenColors.has('ctrl-color'));
  assert.ok(overriddenColors.has('ctrl-h-color'));
  assert.ok(overriddenColors.has('ctrl-h1-color'));
  assert.ok(overriddenColors.has('ctrl-h2-color'));
  assert.ok(overriddenColors.has('ctrl-h3-color'));
  assert.ok(overriddenColors.has('ctrl-h4-color'));
  assert.ok(overriddenColors.has('ctrl-p-color'));
  assert.ok(overriddenColors.has('ctrl-list-color'));
});

// ══════════════════════════════════════════════════════
//  SLUGIFY + TOC TESTS
// ══════════════════════════════════════════════════════
console.log('\n── Slugify + TOC Tests ────────────────────────\n');

// Mirror the slugify function from index.html
function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

test('slugify: basic text', () => {
  assert.strictEqual(slugify('Getting Started'), 'getting-started');
});

test('slugify: strips special characters', () => {
  assert.strictEqual(slugify("What's New?"), 'whats-new');
});

test('slugify: collapses multiple spaces and hyphens', () => {
  assert.strictEqual(slugify('foo   bar--baz'), 'foo-bar-baz');
});

test('slugify: handles numbers', () => {
  assert.strictEqual(slugify('Step 1: Install'), 'step-1-install');
});

test('slugify: trims leading/trailing hyphens', () => {
  assert.strictEqual(slugify('  --hello--  '), 'hello');
});

test('slugify: empty string', () => {
  assert.strictEqual(slugify(''), '');
});

test('slugify: unicode stripped to ascii', () => {
  assert.strictEqual(slugify('Café Résumé'), 'caf-rsum');
});

test('slugify: deduplication logic', () => {
  // Simulate the same dedup logic used in render()
  const headings = ['Setup', 'Usage', 'Setup', 'Setup'];
  const slugCounts = {};
  const results = [];
  headings.forEach(text => {
    let slug = slugify(text);
    if (!slug) slug = 'section';
    if (slugCounts[slug] != null) {
      slugCounts[slug]++;
      slug = slug + '-' + slugCounts[slug];
    } else {
      slugCounts[slug] = 0;
    }
    results.push(slug);
  });
  assert.deepStrictEqual(results, ['setup', 'usage', 'setup-1', 'setup-2']);
});

// ══════════════════════════════════════════════════════
//  CLI TESTS (parseArgs + buildUrl)
// ══════════════════════════════════════════════════════
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

test('buildUrl: content produces md= param with read mode', () => {
  const url = cli.buildUrl('# Hello', {});
  assert.ok(url.includes('md='));
  assert.ok(url.includes('mode=read'));
});

test('buildUrl: explicit mode overrides default', () => {
  const url = cli.buildUrl('# Hello', { mode: 'style' });
  assert.ok(url.includes('mode=style'));
});

test('buildUrl: content roundtrips through base64', () => {
  const content = '---\nstyles:\n  fontFamily: Lora\n---\n# Test';
  const url = cli.buildUrl(content, {});
  // Extract the md param and decode it
  const hash = url.split('#')[1];
  const params = new URLSearchParams(hash);
  const decoded = Buffer.from(decodeURIComponent(params.get('md')), 'base64').toString('utf-8');
  assert.strictEqual(decoded, content);
});

// ══════════════════════════════════════════════════════
//  Browser Base64 Encoding Tests (UTF-8 roundtrip)
// ══════════════════════════════════════════════════════
console.log('\n── Browser Base64 UTF-8 Tests ──────────────────\n');

// Simulate browser's btoa/atob (Latin-1 only) in Node
function browserBtoa(str) {
  return Buffer.from(str, 'latin1').toString('base64');
}
function browserAtob(b64) {
  return Buffer.from(b64, 'base64').toString('latin1');
}

// Browser encode: encodeURIComponent(btoa(unescape(encodeURIComponent(text))))
function browserEncode(text) {
  const latin1 = unescape(encodeURIComponent(text));
  return encodeURIComponent(browserBtoa(latin1));
}

// Browser decode (fixed): decodeURIComponent(escape(atob(decodeURIComponent(param))))
function browserDecode(param) {
  return decodeURIComponent(escape(browserAtob(decodeURIComponent(param))));
}

test('browser base64: roundtrips ASCII content', () => {
  const content = '# Hello World\n\nSome plain ASCII text.';
  assert.strictEqual(browserDecode(browserEncode(content)), content);
});

test('browser base64: roundtrips em-dash and Unicode', () => {
  const content = '## Why the 500 happened — the failure sequence';
  assert.strictEqual(browserDecode(browserEncode(content)), content);
});

test('browser base64: roundtrips mixed Unicode (curly quotes, emoji)', () => {
  const content = 'He said \u201chello\u201d \u2014 then left \ud83d\ude00';
  assert.strictEqual(browserDecode(browserEncode(content)), content);
});

test('browser base64: CLI encode → browser decode roundtrip', () => {
  // CLI encodes with Buffer, browser decodes with atob+escape trick
  const content = '## Why the 500 happened \u2014 the failure sequence';
  const cliEncoded = encodeURIComponent(Buffer.from(content, 'utf-8').toString('base64'));
  assert.strictEqual(browserDecode(cliEncoded), content);
});

test('browser base64: browser encode → CLI decode roundtrip', () => {
  // Browser encodes with btoa+unescape trick, CLI decodes with Buffer
  const content = '## Em-dash \u2014 and curly \u201cquotes\u201d';
  const encoded = browserEncode(content);
  const cliDecoded = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf-8');
  assert.strictEqual(cliDecoded, content);
});

// ══════════════════════════════════════════════════════
//  HTTP TESTS (requires server running)
// ══════════════════════════════════════════════════════
async function runHttpTests() {
  console.log('\n── HTTP Tests (starting server) ─────────────────\n');

  // Start the server in a child process
  const { spawn } = require('child_process');
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '3099' },
    stdio: 'pipe',
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    let ready = false;
    server.stdout.on('data', d => {
      if (!ready && d.toString().includes('running at')) {
        ready = true;
        resolve();
      }
    });
    server.stderr.on('data', d => console.error('server stderr:', d.toString()));
    setTimeout(() => { if (!ready) reject(new Error('Server did not start in time')); }, 3000);
  });

  const BASE = 'http://localhost:3099';

  await testAsync('GET / returns 200', async () => {
    const r = await get(BASE + '/');
    assert.strictEqual(r.status, 200);
  });

  await testAsync('GET / returns HTML content-type', async () => {
    const r = await get(BASE + '/');
    assert.ok(r.headers['content-type'].includes('text/html'));
  });

  await testAsync('GET / body contains SDocs markup', async () => {
    const r = await get(BASE + '/');
    assert.ok(r.body.includes('SDocs'));
  });

  await testAsync('GET /nonexistent returns 404', async () => {
    const r = await get(BASE + '/nonexistent-path-xyz');
    assert.strictEqual(r.status, 404);
  });

  await testAsync('GET /public/index.html returns 200', async () => {
    const r = await get(BASE + '/public/index.html');
    assert.strictEqual(r.status, 200);
  });

  // Path traversal protection
  await testAsync('Path traversal returns 404 or 403', async () => {
    const r = await get(BASE + '/public/../../package.json');
    assert.ok(r.status === 404 || r.status === 403);
  });

  server.kill();
}

(async () => {
  await runHttpTests();

  console.log(`\n── Results ─────────────────────────────────────\n`);
  console.log(`  ${GREEN} ${passed} passed`);
  if (failed > 0) {
    console.log(`  ${RED} ${failed} failed`);
    process.exit(1);
  } else {
    console.log(`\n  All tests passed!\n`);
  }
})().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
