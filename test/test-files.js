/**
 * File existence + content assertion tests
 */
const path = require('path');
const fs = require('fs');

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── File Existence Tests ────────────────────────\n');

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
    assert.ok(html.includes('id="export-panel"'), 'missing #export-panel');
    assert.ok(html.includes('id="btn-export"'), 'missing #btn-export');
    assert.ok(html.includes('id="btn-new"'), 'missing #btn-new');
  });

  test('css/layout.css contains drag-over overlay', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'layout.css'), 'utf-8');
    assert.ok(css.includes('drag-over'), 'missing drag-over class');
  });

  test('css/tokens.css contains dark theme overrides', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'tokens.css'), 'utf-8');
    assert.ok(css.includes('[data-theme="dark"]'), 'missing dark theme selector');
  });

  test('index.html contains theme toggle button', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('id="btn-theme"'), 'missing theme toggle button');
  });

  test('sdocs-theme.js contains theme functions', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-theme.js'), 'utf-8');
    assert.ok(js.includes('toggleTheme'), 'missing toggleTheme function');
    assert.ok(js.includes('prefers-color-scheme'), 'missing system preference detection');
    assert.ok(js.includes('sdocs-theme'), 'missing localStorage theme key');
  });

  test('sdocs-app.js contains required functions', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-app.js'), 'utf-8');
    assert.ok(js.includes('SDocYaml.parseFrontMatter'), 'missing parseFrontMatter usage');
    assert.ok(js.includes('SDocYaml.serializeFrontMatter'), 'missing serializeFrontMatter usage');
    assert.ok(js.includes('collectStyles'), 'missing collectStyles usage');
  });

  test('sdocs-theme.js has at least 20 Google Fonts', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-theme.js'), 'utf-8');
    const m = js.match(/const GOOGLE_FONTS = \[([\s\S]*?)\]/);
    assert.ok(m, 'GOOGLE_FONTS array not found');
    const fonts = m[1].split(',').filter(s => s.trim().length > 0);
    assert.ok(fonts.length >= 20, `only ${fonts.length} fonts (need >= 20)`);
  });

  test('sdocs-yaml.js exists and exports parseFrontMatter', () => {
    const yaml = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));
    assert.ok(typeof yaml.parseFrontMatter === 'function', 'missing parseFrontMatter export');
    assert.ok(typeof yaml.serializeFrontMatter === 'function', 'missing serializeFrontMatter export');
  });

  test('public/sdocs-styles.js exists', () => {
    const stylesPath = path.join(__dirname, '..', 'public', 'sdocs-styles.js');
    assert.ok(fs.existsSync(stylesPath), 'public/sdocs-styles.js not found');
  });

  test('all CSS modules exist under public/css/', () => {
    const cssDir = path.join(__dirname, '..', 'public', 'css');
    ['tokens.css', 'layout.css', 'rendered.css', 'panel.css', 'mobile.css'].forEach(f => {
      assert.ok(fs.existsSync(path.join(cssDir, f)), `missing css/${f}`);
    });
  });

  test('all JS modules exist under public/', () => {
    const dir = path.join(__dirname, '..', 'public');
    ['sdocs-yaml.js', 'sdocs-state.js', 'sdocs-theme.js', 'sdocs-controls.js', 'sdocs-export.js', 'sdocs-app.js'].forEach(f => {
      assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
    });
  });

  test('sdocs-yaml.js UMD exports all required functions', () => {
    const yaml = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));
    ['parseScalar', 'parseInlineObject', 'parseSimpleYaml', 'parseFrontMatter', 'serializeFrontMatter'].forEach(fn => {
      assert.ok(typeof yaml[fn] === 'function', `missing export: ${fn}`);
    });
  });

  test('sdocs-styles.js UMD exports all required functions and tables', () => {
    const S = require(path.join(__dirname, '..', 'public', 'sdocs-styles.js'));
    ['controlToCssVars', 'cascadeColor', 'collectStyles', 'stylesToControls'].forEach(fn => {
      assert.ok(typeof S[fn] === 'function', `missing export: ${fn}`);
    });
    ['COLOR_VAR_MAP', 'COLOR_CASCADE', 'CTRL_CSS_MAP', 'RANGE_NUM_PAIRS'].forEach(tbl => {
      assert.ok(S[tbl], `missing export: ${tbl}`);
    });
  });

  test('no stale monolith files remain', () => {
    const pub = path.join(__dirname, '..', 'public');
    assert.ok(!fs.existsSync(path.join(pub, 'styles.css')), 'old styles.css should be deleted');
    assert.ok(!fs.existsSync(path.join(pub, 'app.js')), 'old app.js should be deleted');
  });

  test('sdocs-charts.js exists', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'sdocs-charts.js')), 'missing sdocs-charts.js');
  });

  test('chart palette dropdown defaults to monochrome', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('id="ctrl-chart-palette"'), 'missing chart palette dropdown');
    assert.ok(html.includes('<option value="monochrome" selected>'), 'monochrome should be selected by default');
  });

  test('chart controls are inside the Colors > Blocks section', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    const blocksStart = html.indexOf('data-target="sub-colors-blocks"');
    const colorsEnd = html.indexOf('<!-- HEADERS -->');
    const chartAccent = html.indexOf('id="ctrl-chart-accent"');
    const chartPalette = html.indexOf('id="ctrl-chart-palette"');
    const blockBg = html.indexOf('id="ctrl-block-bg"');
    const blockText = html.indexOf('id="ctrl-block-text"');
    assert.ok(blocksStart > 0 && colorsEnd > 0, 'Blocks sub-section markers not found');
    assert.ok(blockBg > blocksStart && blockBg < colorsEnd, 'block-bg should be inside Blocks sub-section');
    assert.ok(blockText > blocksStart && blockText < colorsEnd, 'block-text should be inside Blocks sub-section');
    assert.ok(chartAccent > blocksStart && chartAccent < colorsEnd, 'chart accent should be inside Blocks sub-section');
    assert.ok(chartPalette > blocksStart && chartPalette < colorsEnd, 'chart palette should be inside Blocks sub-section');
  });
};
