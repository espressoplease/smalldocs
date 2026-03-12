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
//  COLOR CASCADE ROUNDTRIP TESTS
// ══════════════════════════════════════════════════════
console.log('\n── Color Cascade Tests ────────────────────────\n');

// Simulate the cascade-aware collectStyles logic (pure function, no DOM)
// overridden is a Set of color control IDs; colorValues maps control IDs to their values
function collectCascadeColors(overridden, colorValues) {
  const styles = {};
  if (overridden.has('ctrl-color'))      styles.color = colorValues['ctrl-color'];
  if (overridden.has('ctrl-h-color'))    styles.headersColor = colorValues['ctrl-h-color'];
  if (overridden.has('ctrl-h1-color'))   styles.h1Color = colorValues['ctrl-h1-color'];
  if (overridden.has('ctrl-h2-color'))   styles.h2Color = colorValues['ctrl-h2-color'];
  if (overridden.has('ctrl-h3-color'))   styles.h3Color = colorValues['ctrl-h3-color'];
  if (overridden.has('ctrl-h4-color'))   styles.h4Color = colorValues['ctrl-h4-color'];
  if (overridden.has('ctrl-p-color'))    styles.pColor = colorValues['ctrl-p-color'];
  if (overridden.has('ctrl-list-color')) styles.listColor = colorValues['ctrl-list-color'];
  return styles;
}

// Simulate applyStylesFromMeta's color handling: returns which controls would be overridden
function applyCascadeFromStyles(styles) {
  const overridden = new Set();
  if (styles.color)        overridden.add('ctrl-color');
  if (styles.headersColor) overridden.add('ctrl-h-color');
  if (styles.h1Color)      overridden.add('ctrl-h1-color');
  if (styles.h2Color)      overridden.add('ctrl-h2-color');
  if (styles.h3Color)      overridden.add('ctrl-h3-color');
  if (styles.h4Color)      overridden.add('ctrl-h4-color');
  if (styles.pColor)       overridden.add('ctrl-p-color');
  if (styles.listColor)    overridden.add('ctrl-list-color');
  return overridden;
}

test('cascade: no overridden colors → no colors emitted', () => {
  const overridden = new Set();
  const colorValues = {
    'ctrl-color': '#1c1917', 'ctrl-h-color': '#1c1917',
    'ctrl-h1-color': '#1c1917', 'ctrl-h2-color': '#1c1917',
    'ctrl-h3-color': '#1c1917', 'ctrl-h4-color': '#1c1917',
    'ctrl-p-color': '#1c1917', 'ctrl-list-color': '#1c1917',
  };
  const styles = collectCascadeColors(overridden, colorValues);
  assert.deepStrictEqual(styles, {});
});

test('cascade: only root color overridden → only root emitted', () => {
  const overridden = new Set(['ctrl-color']);
  const colorValues = {
    'ctrl-color': '#ff0000', 'ctrl-h-color': '#ff0000',
    'ctrl-h1-color': '#ff0000', 'ctrl-p-color': '#ff0000',
  };
  const styles = collectCascadeColors(overridden, colorValues);
  assert.strictEqual(styles.color, '#ff0000');
  assert.strictEqual(styles.headersColor, undefined);
  assert.strictEqual(styles.h1Color, undefined);
  assert.strictEqual(styles.pColor, undefined);
});

test('cascade: roundtrip preserves override set', () => {
  const original = new Set(['ctrl-color']);
  const colorValues = { 'ctrl-color': '#ff0000' };
  const collected = collectCascadeColors(original, colorValues);
  const restored = applyCascadeFromStyles(collected);
  assert.ok(restored.has('ctrl-color'));
  assert.ok(!restored.has('ctrl-h-color'));
  assert.ok(!restored.has('ctrl-h1-color'));
  assert.ok(!restored.has('ctrl-p-color'));
  assert.strictEqual(restored.size, 1);
});

test('cascade: root + child override survives roundtrip', () => {
  const original = new Set(['ctrl-color', 'ctrl-h1-color']);
  const colorValues = { 'ctrl-color': '#ff0000', 'ctrl-h1-color': '#0000ff' };
  const collected = collectCascadeColors(original, colorValues);
  const restored = applyCascadeFromStyles(collected);
  assert.ok(restored.has('ctrl-color'));
  assert.ok(restored.has('ctrl-h1-color'));
  assert.ok(!restored.has('ctrl-h2-color'));
  assert.ok(!restored.has('ctrl-h-color'));
  assert.strictEqual(restored.size, 2);
});

test('cascade: full YAML roundtrip with front matter', () => {
  // Only root color overridden → serialize → parse → only root should come back
  const styles = { fontFamily: 'Inter', baseFontSize: 16, color: '#ff0000',
    h1: { fontSize: 2.1, fontWeight: 700 } };
  const fm = cli.serializeFrontMatter({ styles });
  const { meta } = cli.parseFrontMatter(fm + '\n# Doc');
  assert.strictEqual(meta.styles.color, '#ff0000');
  // h1 should have no color key since we didn't include one
  assert.strictEqual(meta.styles.h1.color, undefined);
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
