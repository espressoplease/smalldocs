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

test('index.html contains required elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
  assert.ok(html.includes('id="rendered"'), 'missing #rendered');
  assert.ok(html.includes('id="raw"'), 'missing #raw');
  assert.ok(html.includes('id="right"'), 'missing #right panel');
  assert.ok(html.includes('drag-over'), 'missing drag-over class');
  assert.ok(html.includes('parseFrontMatter'), 'missing parseFrontMatter function');
  assert.ok(html.includes('serializeFrontMatter'), 'missing serializeFrontMatter function');
  assert.ok(html.includes('collectStyles'), 'missing collectStyles function');
  assert.ok(html.includes('GOOGLE_FONTS'), 'missing GOOGLE_FONTS array');
});

test('index.html has at least 20 Google Fonts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
  const m = html.match(/const GOOGLE_FONTS = \[([\s\S]*?)\]/);
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

test('collectStyles → stylesToControls roundtrip', () => {
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
    'ctrl-color': '#ff0000',
  };
  const overridden = new Set(['ctrl-color']);
  const styles = S.collectStyles(values, overridden);
  const { controls, overriddenColors } = S.stylesToControls(styles);
  assert.strictEqual(controls['ctrl-base-size-num'], 16);
  assert.ok(overriddenColors.has('ctrl-color'));
  assert.ok(!overriddenColors.has('ctrl-h1-color'));
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

test('cascade: full YAML roundtrip with front matter', () => {
  const styles = { fontFamily: 'Inter', baseFontSize: 16, color: '#ff0000',
    h1: { fontSize: 2.1, fontWeight: 700 } };
  const fm = cli.serializeFrontMatter({ styles });
  const { meta } = cli.parseFrontMatter(fm + '\n# Doc');
  assert.strictEqual(meta.styles.color, '#ff0000');
  assert.strictEqual(meta.styles.h1.color, undefined);
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
