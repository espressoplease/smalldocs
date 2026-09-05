/**
 * File existence + content assertion tests
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── File Existence Tests ────────────────────────\n');

  test('server.js file exists', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    assert.ok(fs.existsSync(serverPath), 'server.js not found');
  });

  test('production deployment binds Node to loopback and hardens the service', () => {
    const env = fs.readFileSync(path.join(__dirname, '..', 'ops', 'smalldocs.env.example'), 'utf8');
    const unit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd', 'smalldocs.service'), 'utf8');
    const nginx = fs.readFileSync(path.join(__dirname, '..', 'ops', 'nginx',
      'smalldocs.conf'), 'utf8');
    assert.ok(env.includes('HOST=127.0.0.1'));
    assert.ok(env.includes('CLOUD_MODE=off'));
    assert.ok(env.includes('CLOUD_PUBLIC_MODE=hidden'));
    assert.ok(unit.includes('User=smalldocs'));
    assert.ok(unit.includes('LoadCredential=aws-credentials:'));
    assert.ok(unit.includes('LoadCredential=stripe-api-key:'));
    assert.ok(unit.includes('LoadCredential=stripe-webhook-secret:'));
    assert.ok(unit.includes(
      'AWS_SHARED_CREDENTIALS_FILE=/run/credentials/smalldocs.service/aws-credentials'));
    assert.ok(unit.includes(
      'STRIPE_SECRET_KEY_FILE=/run/credentials/smalldocs.service/stripe-api-key'));
    assert.ok(unit.includes(
      'STRIPE_WEBHOOK_SECRET_FILE=/run/credentials/smalldocs.service/stripe-webhook-secret'));
    assert.ok(unit.includes('ProtectSystem=strict'));
    assert.ok(unit.includes('ReadWritePaths=/var/lib/smalldocs'));
    assert.ok(unit.includes('LimitCORE=0'));
    assert.ok(nginx.includes('server_name smalldocs.org www.smalldocs.org'));
    assert.ok(nginx.includes('proxy_pass http://127.0.0.1:3003'));
    assert.ok(nginx.includes('proxy_set_header X-Forwarded-For $remote_addr'));
    assert.ok(!nginx.includes('$proxy_add_x_forwarded_for'));
    assert.ok(nginx.includes('access_log off'));
  });

  test('staging uses a separate account, state path, port, and public origin', () => {
    const env = fs.readFileSync(path.join(__dirname, '..', 'ops',
      'smalldocs-staging.env.example'), 'utf8');
    const unit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      'smalldocs-staging.service'), 'utf8');
    const nginx = fs.readFileSync(path.join(__dirname, '..', 'ops', 'nginx',
      'smalldocs-staging.conf'), 'utf8');
    assert.ok(env.includes('CLOUD_MODE=staging'));
    assert.ok(env.includes('CLOUD_PUBLIC_MODE=enabled'));
    assert.ok(env.includes('HOST=127.0.0.1'));
    assert.ok(env.includes('PORT=3004'));
    assert.ok(env.includes('CLOUD_AUTH_PUBLIC_ORIGIN=https://cloud-staging.smalldocs.org'));
    assert.ok(env.includes('/var/lib/smalldocs-staging/'));
    assert.ok(unit.includes('User=smalldocs-staging'));
    assert.ok(unit.includes('ReadWritePaths=/var/lib/smalldocs-staging'));
    assert.ok(!unit.includes('/var/lib/smalldocs\n'));
    assert.ok(nginx.includes('proxy_pass http://127.0.0.1:3004'));
    assert.ok(nginx.includes('proxy_set_header X-Forwarded-For $remote_addr'));
    assert.ok(!nginx.includes('$proxy_add_x_forwarded_for'));
    assert.ok(nginx.includes('access_log off'));
  });

  test('production backup uses a coordinated snapshot and systemd credentials', () => {
    const backup = fs.readFileSync(path.join(__dirname, '..', 'ops', 'backup-production.sh'), 'utf8');
    const unit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      'smalldocs-backup.service'), 'utf8');
    const timer = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      'smalldocs-backup.timer'), 'utf8');
    assert.ok(backup.includes('systemctl stop smalldocs'));
    assert.ok(backup.includes('restart_service'));
    assert.ok(backup.includes('checksum-algorithm SHA256'));
    assert.ok(backup.includes('backup-heartbeat.js'));
    assert.ok(backup.includes('SDOCS_BACKUP_LOCAL_RETENTION_DAYS'));
    assert.ok(backup.includes("-name 'smalldocs-*.tar.gz'"));
    assert.ok(backup.includes('-delete'));
    assert.ok(unit.includes('LoadCredential=aws-credentials:'));
    assert.ok(unit.includes('EnvironmentFile=-/etc/smalldocs/backup-monitor.env'));
    assert.ok(timer.includes('Persistent=true'));
  });

  test('production monitoring is scheduled and reads job state without payloads', () => {
    const monitor = fs.readFileSync(path.join(__dirname, '..', 'ops', 'production-monitor.js'), 'utf8');
    const unit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      'smalldocs-monitor.service'), 'utf8');
    const timer = fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      'smalldocs-monitor.timer'), 'utf8');
    assert.ok(monitor.includes('createCloudJobs({ dbPath, readonly: true })'));
    assert.ok(monitor.includes('operational counts and status only'));
    assert.ok(unit.includes('LoadCredential=resend-api-key:'));
    assert.ok(timer.includes('OnUnitActiveSec=5min'));
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'ops', 'systemd',
      '60-smalldocs-journal-retention.conf'), 'utf8').includes('MaxRetentionSec=90day'));
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'ops',
      'install-production-monitor.sh'), 'utf8').includes(
      'systemctl enable --now smalldocs-monitor.timer'));
  });

  test('deployment keeps current and previous production and staging releases', () => {
    const projectRoot = path.join(__dirname, '..');
    const production = fs.readFileSync(path.join(projectRoot, 'ops/deploy-production.sh'), 'utf8');
    const staging = fs.readFileSync(path.join(projectRoot, 'ops/deploy-staging.sh'), 'utf8');
    const prune = fs.readFileSync(path.join(projectRoot, 'ops/prune-releases.sh'), 'utf8');
    for (const content of [production, staging]) {
      assert.ok(content.includes('ops/prune-releases.sh'));
      assert.ok(content.includes('/opt/smalldocs/current'));
      assert.ok(content.includes('/opt/smalldocs/previous'));
      assert.ok(content.includes('/opt/smalldocs/staging-current'));
      assert.ok(content.includes('/opt/smalldocs/staging-previous'));
    }
    assert.ok(prune.includes("grep -Eq '^[0-9a-f]{7,40}$'"));
    assert.ok(prune.includes('Active pointer must resolve inside the release root'));
  });

  test('release pruning removes only inactive commit directories', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-releases-'));
    const releases = path.join(directory, 'releases');
    const names = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(40));
    names.push('e'.repeat(7));
    fs.mkdirSync(releases);
    for (const name of names) fs.mkdirSync(path.join(releases, name));
    fs.mkdirSync(path.join(releases, 'manual'));
    const pointers = ['current', 'previous', 'staging-current', 'staging-previous'];
    pointers.forEach((pointer, index) => fs.symlinkSync(path.join(releases, names[index]),
      path.join(directory, pointer)));
    try {
      childProcess.execFileSync('sh', [path.join(__dirname, '..', 'ops', 'prune-releases.sh'),
        releases, ...pointers.map(pointer => path.join(directory, pointer))]);
      for (const name of names.slice(0, 4)) {
        assert.strictEqual(fs.existsSync(path.join(releases, name)), true);
      }
      assert.strictEqual(fs.existsSync(path.join(releases, names[4])), false);
      assert.strictEqual(fs.existsSync(path.join(releases, 'manual')), true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('production deploy verifies, installs, and can roll back systemd unit changes', () => {
    const deploy = fs.readFileSync(path.join(__dirname, '..', 'ops',
      'deploy-production.sh'), 'utf8');
    assert.ok(deploy.includes('systemd-analyze verify "$unit_source"'));
    assert.ok(deploy.includes('install -o root -g root -m 0644 "$unit_source" "$unit_target"'));
    assert.ok(deploy.includes('systemctl daemon-reload'));
    assert.ok(deploy.includes('install-production-monitor.sh'));
    assert.ok(deploy.includes('rollback_release'));
    assert.ok(deploy.includes('"$release_dir/.git/HEAD"'));
  });

  test('staging deploy publishes one exact commit and cannot switch production', () => {
    const deploy = fs.readFileSync(path.join(__dirname, '..', 'ops',
      'deploy-staging.sh'), 'utf8');
    assert.ok(deploy.includes('refs/heads/feature/cloud-foundation'));
    assert.ok(deploy.includes('/opt/smalldocs/staging-current'));
    assert.ok(deploy.includes('systemctl restart smalldocs-staging'));
    assert.ok(deploy.includes('http://127.0.0.1:3004/version-check'));
    assert.ok(deploy.includes('https://cloud-staging.smalldocs.org'));
    assert.ok(deploy.includes('rollback_staging'));
    assert.ok(deploy.includes('Xx]-[Ss]docs-[Cc]ommit'));
    assert.ok(!/ln -sfn[^\n]+\/opt\/smalldocs\/current/.test(deploy));
    assert.ok(!/systemctl restart smalldocs(?:\s|$)/.test(deploy));
  });

  test('public/index.html exists', () => {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    assert.ok(fs.existsSync(htmlPath), 'public/index.html not found');
  });

  test('public setup copy leads with the standard cross-agent skill installer', () => {
    const setup = require(path.join(__dirname, '..', 'public', 'sdocs-cli-setup.js'));
    const homepage = fs.readFileSync(path.join(__dirname, '..', 'public',
      'homepage.html'), 'utf8');
    const docs = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdoc.md'), 'utf8');
    const upgrade = fs.readFileSync(path.join(__dirname, '..', 'public',
      'upgrade.md'), 'utf8');
    const newHome = fs.readFileSync(path.join(__dirname, '..', 'public', 'blogs',
      'new-home.md'), 'utf8');
    const explainer = fs.readFileSync(path.join(__dirname, '..', 'public', 'blogs',
      'what-is-a-smalldoc.md'), 'utf8');
    const command = 'npx skills@latest add https://smalldocs.org/agent-skills/standard --global';
    assert.ok(setup.SETUP_PROMPT.includes(command));
    assert.ok(setup.SETUP_PROMPT.includes('save a document to SmallDocs Cloud'));
    assert.ok(!setup.SETUP_PROMPT.includes('Then run: `sdoc setup --yes`'));
    assert.ok(homepage.includes(command));
    assert.ok(homepage.includes('built-in fallback installs the standard edition'));
    assert.ok(homepage.includes('requires Node 22.20 or newer'));
    assert.ok(docs.includes(command));
    assert.ok(docs.includes('requires Node 22.20 or newer'));
    assert.ok(!docs.includes('/agent-skills/smalldocs/SKILL.md'));
    assert.ok(upgrade.includes(command));
    assert.ok(newHome.includes(command));
    assert.ok(explainer.includes(command));
    assert.ok(!explainer.includes('Nothing leaves my machine unless I explicitly run `sdoc share`.'));
  });

  test('Cloud UI lab assets exist and remain opt-in', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'public',
      'sdocs-cloud-ui-lab.js'), 'utf-8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css',
      'cloud-ui-lab.css'), 'utf-8');
    assert.ok(script.includes("params.get('cloud-ui-prototype') === '1'"));
    assert.ok(script.includes("hashParams.get('cloud-ui-prototype') === '1'"));
    assert.ok(script.includes('This is an interactive UI prototype'));
    assert.ok(styles.includes('#_sd_cloud-lab-panel'));
    assert.ok(styles.includes('mobile-cloud-lab-open'));
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    assert.ok(server.includes("CLOUD_DEPLOYMENT.mode !== 'production'"));
  });

  test('index.html contains required markup elements', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('id="_sd_rendered"'), 'missing #_sd_rendered');
    assert.ok(html.includes('id="_sd_raw"'), 'missing #_sd_raw');
    assert.ok(html.includes('id="_sd_right"'), 'missing #_sd_right panel');
    assert.ok(html.includes('id="_sd_export-panel"'), 'missing #_sd_export-panel');
    assert.ok(html.includes('id="_sd_btn-export"'), 'missing #_sd_btn-export');
    assert.ok(html.includes('id="_sd_btn-new"'), 'missing #_sd_btn-new');
  });

  test('css/layout.css contains drag-over overlay', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'layout.css'), 'utf-8');
    assert.ok(css.includes('drag-over'), 'missing drag-over class');
  });

  test('css/tokens.css contains dark theme overrides', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'tokens.css'), 'utf-8');
    assert.ok(css.includes('[data-theme="dark"]'), 'missing dark theme selector');
  });

  test('code and document walkthroughs share one card component', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'walkthrough.css'), 'utf-8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-code-focus.js'), 'utf-8');
    const docs = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-docwalk-ui.js'), 'utf-8');
    const sdkCss = fs.readFileSync(path.join(
      __dirname, '..', 'sdk', 'browser', 'releases', '0.3.0', 'code-reader.css'
    ), 'utf-8');
    assert.ok(html.includes('/public/css/walkthrough.css'));
    assert.ok(css.includes('.sdoc-walkthrough-card.is-active'));
    assert.ok(code.includes("card.classList.add('sdoc-walkthrough-card')"));
    assert.ok(docs.includes('sdoc-docwalk-card sdoc-walkthrough-card'));
    assert.ok(sdkCss.includes("@import url('./vendor/sdocs-walkthrough.css')"));
  });

  test('reader controls share dimensions and developer docs reuse the shared sidebar', () => {
    const cssDir = path.join(__dirname, '..', 'public', 'css');
    const tokens = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf-8');
    const layout = fs.readFileSync(path.join(cssDir, 'layout.css'), 'utf-8');
    const panel = fs.readFileSync(path.join(cssDir, 'panel.css'), 'utf-8');
    const sidebar = fs.readFileSync(path.join(cssDir, 'sidebar-shared.css'), 'utf-8');
    const developers = fs.readFileSync(path.join(cssDir, 'developers.css'), 'utf-8');
    assert.ok(tokens.includes('--ui-toolbar-height: 40px'));
    assert.ok(tokens.includes('--ui-panel-width:    335px'));
    assert.ok(layout.includes('height: var(--ui-toolbar-height)'));
    assert.ok(panel.includes('width: var(--ui-panel-width)'));
    assert.ok(developers.includes('height: var(--ui-toolbar-height)'));
    assert.ok(sidebar.includes('--sdocs-sidebar-width: 224px'));
    assert.ok(developers.includes('margin-left: var(--sdocs-sidebar-width)'));
  });

  test('index.html contains theme toggle button', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('id="_sd_btn-theme"'), 'missing theme toggle button');
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

  test('library HTML escaping protects text and quoted attributes', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'library', 'library.js'), 'utf-8');
    assert.match(js, /replace\(\/\[&<>"'\]\/[a-z]*/);
    assert.ok(js.includes("'\"': '&quot;'"), 'double quotes are not escaped');
    assert.ok(js.includes("\"'\": '&#39;'"), 'single quotes are not escaped');
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
    ['sdocs-yaml.js', 'sdocs-slugify.js', 'sdocs-state.js', 'sdocs-theme.js', 'sdocs-controls.js', 'sdocs-export.js', 'sdocs-app.js'].forEach(f => {
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
    assert.ok(html.includes('id="_sd_ctrl-chart-palette"'), 'missing chart palette dropdown');
    assert.ok(html.includes('<option value="monochrome" selected>'), 'monochrome should be selected by default');
  });

  test('every HTML route in server.js goes through serveHtmlWithRewrite', () => {
    // Static guard: a new HTML route added via `serveFile(res, '...html', ...)`
    // would silently bypass the asset-versioning rewriter, reintroducing the
    // stale-cache bug class. The per-route tests in test-http.js enumerate
    // routes by hand, so they can't catch a route they don't know about.
    // This regex on server.js source closes that gap.
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    const matches = src.match(/serveFile\([^)]*\.html['"][^)]*\)/g);
    assert.ok(!matches,
      'HTML files must be served via serveHtmlWithRewrite, not serveFile. Found:\n' +
      (matches || []).join('\n'));
  });

  test('cli/bin/sdocs-postinstall.js exists and is silent when not a global install', () => {
    const postinstall = path.join(__dirname, '..', 'cli', 'bin', 'sdocs-postinstall.js');
    assert.ok(fs.existsSync(postinstall), 'missing cli/bin/sdocs-postinstall.js');
    const src = fs.readFileSync(postinstall, 'utf-8');
    assert.ok(src.includes("npm_config_global"), 'should gate on npm_config_global');
    assert.ok(src.includes('process.env.CI'), 'should skip when CI is set');
  });

  test('public/agent-changes.md exists and lists v1, v2, v3 sections', () => {
    const changes = fs.readFileSync(path.join(__dirname, '..', 'public', 'agent-changes.md'), 'utf-8');
    assert.ok(changes.includes('## v3'), 'missing v3 section');
    assert.ok(changes.includes('## v2'), 'missing v2 section');
    assert.ok(changes.includes('## v1'), 'missing v1 section');
  });

  test('runnable HTML page is a human-facing gallery with three live demos', () => {
    const explainer = fs.readFileSync(path.join(__dirname, '..', 'public',
      'runnable-html.md'), 'utf8');
    assert.ok(explainer.includes('# Runnable HTML'));
    assert.strictEqual((explainer.match(/~~~sdoc-app/g) || []).length, 3);
    assert.ok(explainer.includes('<title>Interactive valuation surface</title>'));
    assert.ok(explainer.includes('<title>Live backlog simulator</title>'));
    assert.ok(explainer.includes('<title>Interactive dependency map</title>'));
    assert.strictEqual((explainer.match(/\*\*Try this prompt:\*\*/g) || []).length, 3);
    assert.ok(!explainer.includes('How an agent should decide'));
    assert.ok(explainer.includes('[Renderer SDK](/developers)'));
  });

  test('cli/package.json has postinstall script and version 1.5.0+', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cli', 'package.json'), 'utf-8'));
    assert.ok(pkg.scripts && pkg.scripts.postinstall, 'missing scripts.postinstall');
    assert.ok(pkg.scripts.postinstall.includes('sdocs-postinstall.js'),
              'postinstall should run sdocs-postinstall.js');
    const major = parseInt(pkg.version.split('.')[0], 10);
    const minor = parseInt(pkg.version.split('.')[1], 10);
    assert.ok(major > 1 || (major === 1 && minor >= 5),
              'version should be 1.5.0 or later (got ' + pkg.version + ')');
  });

  test('chart controls are inside the Colors > Blocks section', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
    const blocksStart = html.indexOf('data-target="_sd_sub-colors-blocks"');
    const colorsEnd = html.indexOf('<!-- HEADERS -->');
    const chartAccent = html.indexOf('id="_sd_ctrl-chart-accent"');
    const chartPalette = html.indexOf('id="_sd_ctrl-chart-palette"');
    const blockBg = html.indexOf('id="_sd_ctrl-block-bg"');
    const blockText = html.indexOf('id="_sd_ctrl-block-text"');
    assert.ok(blocksStart > 0 && colorsEnd > 0, 'Blocks sub-section markers not found');
    assert.ok(blockBg > blocksStart && blockBg < colorsEnd, 'block-bg should be inside Blocks sub-section');
    assert.ok(blockText > blocksStart && blockText < colorsEnd, 'block-text should be inside Blocks sub-section');
    assert.ok(chartAccent > blocksStart && chartAccent < colorsEnd, 'chart accent should be inside Blocks sub-section');
    assert.ok(chartPalette > blocksStart && chartPalette < colorsEnd, 'chart palette should be inside Blocks sub-section');
  });

  test('versioned SDK reader snapshot matches canonical production sources', () => {
    const repo = path.join(__dirname, '..');
    const releaseRoot = path.join(repo, 'sdk', 'browser', 'releases', '0.3.1');
    const manifestPath = path.join(releaseRoot, 'vendor', 'reader-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    Object.keys(manifest).forEach((targetName) => {
      const source = fs.readFileSync(path.join(repo, manifest[targetName].source));
      const target = fs.readFileSync(path.join(releaseRoot, 'vendor', targetName));
      if (!manifest[targetName].transform) {
        assert.deepStrictEqual(target, source, targetName + ' must be regenerated from its canonical source');
        return;
      }
      const crypto = require('crypto');
      const hash = value => crypto.createHash('sha256').update(value).digest('hex');
      assert.strictEqual(hash(source), manifest[targetName].sourceSha256,
        targetName + ' canonical transform source has drifted');
      assert.strictEqual(hash(target), manifest[targetName].sha256,
        targetName + ' transformed SDK snapshot has drifted');
      if (manifest[targetName].transform === 'manual-sdk-adapter') return;
      assert.ok(target.toString('utf8').startsWith('@layer smalldocs {\n@scope (.smalldocs-sdk-view[data-smalldocs-sdk-version="0.3.1"]) {\n'),
        targetName + ' must remain layered and scoped to the exact SDK version');
      if (targetName === 'sdocs-cells.css') {
        const css = target.toString('utf8');
        assert.ok(css.includes('.sdoc-cells-focus-topbar'),
          'cells focus descendant class names must survive the SDK scope transform');
        assert.ok(!css.includes('data-smalldocs-sdk-version="0.3.1"]-topbar'),
          'the SDK scope transform must not splice the version marker into class names');
      }
    });
  });
};
