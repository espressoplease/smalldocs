// Browser tests for the library UI on its production-shape footprint:
// the page is served from the main SDocs server (`/library`) and reads
// its data from a local agent passed as `?agent=<url>`.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

function seed(sandbox, realFilePath) {
  process.env.SDOCS_HOME = sandbox;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('library-') || k.includes('sdocs-library-')) delete require.cache[k];
  }
  const store = require('../cli/lib/library-store');
  const entries = [
    { id: 'aaa', title: 'Bridge architecture proposal',
      path: '/Users/x/SDocs/proposal.md',
      tags: ['proposal', 'bridge'],
      gitProject: 'sdocs', agent: 'claude-code',
      mtime: '2026-05-19T14:00:00Z' },
    { id: 'bbb', title: 'Circuit breaker thresholds',
      path: '/Users/x/work/monorepo/notes/breaker.md',
      tags: ['reliability'],
      gitProject: 'monorepo', agent: 'codex',
      mtime: '2026-05-05T16:00:00Z' },
    { id: 'ccc', title: 'A11y audit findings',
      path: '/Users/x/SDocs/docs/a11y.md',
      tags: ['a11y', 'audit'],
      gitProject: 'sdocs', agent: 'claude-code',
      mtime: '2026-04-15T15:00:00Z' },
    // One entry whose source actually exists on disk, so the open
    // endpoint can produce a real URL.
    { id: 'realone', title: 'Real file you can open',
      path: realFilePath,
      tags: ['demo'],
      mtime: new Date().toISOString() },
  ];
  for (const e of entries) store.upsertEntry(e);
}

async function startAgent(sandbox) {
  process.env.SDOCS_HOME = sandbox;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('library-') || k.includes('sdocs-library-')) delete require.cache[k];
  }
  const libServer = require('../cli/lib/library-server');
  const { server, agentUrl } = await libServer.createServer({ port: 0 });
  return { server, agentUrl };
}

let SANDBOX, agent, pageUrl, brokenPageUrl;

test.beforeAll(async () => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-ui-'));
  // Isolate the autostart plist lookup so the test process never touches
  // the user's real ~/Library/LaunchAgents directory. Dry-run so we
  // don't actually call launchctl.
  process.env.SDOCS_LAUNCHAGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-la-'));
  process.env.SDOCS_AUTOSTART_DRY_RUN = '1';
  const realFile = path.join(SANDBOX, 'real.md');
  fs.writeFileSync(realFile, '# Real one\n\nordinary body content.');
  seed(SANDBOX, realFile);
  // Mirror the production default: autostart on by default for the
  // happy path tests below.
  if (process.platform === 'darwin') {
    const autostart = require('../cli/lib/library-autostart');
    autostart.enable();
  }
  agent = await startAgent(SANDBOX);
  // force=1 skips the "first-visit-redirects-to-/connect" gate so the
  // existing UI tests don't all have to walk through the connect flow.
  // The redirect itself is covered by the connect-flow tests below.
  pageUrl = `http://localhost:3000/library?force=1&agent=${encodeURIComponent(agent.agentUrl)}`;
  brokenPageUrl = `http://localhost:3000/library?force=1&agent=${encodeURIComponent('http://127.0.0.1:1')}`;
});

test.afterAll(async () => {
  if (agent && agent.server) agent.server.close();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
});

test('library UI: renders entries from the agent', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  const titles = await page.$$eval('.res-title', els => els.map(e => e.textContent.trim()));
  expect(titles).toContain('Bridge architecture proposal');
  expect(titles).toContain('Circuit breaker thresholds');
  expect(titles).toContain('A11y audit findings');
});

test('library UI: shows error banner when agent is unreachable', async ({ page }) => {
  await page.goto(brokenPageUrl);
  await page.waitForSelector('#agent-banner:not([hidden])');
  const text = await page.textContent('#agent-banner');
  expect(text).toMatch(/sdoc library/i);
  // The fallback should include a copy button and the command in a code
  // element. Copy now covers both first-install and stopped states:
  // "npm i -g sdocs-dev && sdoc library".
  const cmd = await page.textContent('.agent-banner-cmd');
  expect(cmd.trim()).toContain('sdoc library');
  expect(cmd.trim()).toContain('sdocs-dev');
  expect(await page.locator('.agent-banner-copy').count()).toBe(1);
});

test('library UI: no banner when agent is reachable and autostart is on', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await expect(page.locator('#agent-banner')).toBeHidden();
});

test('library UI: recovery banner appears if autostart drops to off (and user did not turn it off)', async ({ page }) => {
  if (process.platform !== 'darwin') return;
  const autostart = require('../cli/lib/library-autostart');
  const store = require('../cli/lib/library-store');
  // Simulate "autostart got turned off by something other than the user"
  autostart.disable();
  store.saveState(Object.assign(store.loadState(), { autostartUserDisabled: false }));
  try {
    await page.goto(pageUrl);
    await page.waitForSelector('.res');
    const banner = page.locator('#agent-banner:not([hidden])');
    await expect(banner).toBeVisible();
    const cmd = await page.textContent('.agent-banner-cmd');
    expect(cmd).toContain('sdoc library autostart enable');
  } finally {
    autostart.enable(); // restore for following tests
  }
});

test('library UI: recovery banner does NOT appear when user explicitly disabled autostart', async ({ page }) => {
  if (process.platform !== 'darwin') return;
  const autostart = require('../cli/lib/library-autostart');
  const store = require('../cli/lib/library-store');
  autostart.disable();
  store.saveState(Object.assign(store.loadState(), { autostartUserDisabled: true }));
  try {
    await page.goto(pageUrl);
    await page.waitForSelector('.res');
    await expect(page.locator('#agent-banner')).toBeHidden();
  } finally {
    store.saveState(Object.assign(store.loadState(), { autostartUserDisabled: false }));
    autostart.enable();
  }
});

test('library UI: recovery banner can be dismissed and stays dismissed across reload', async ({ page }) => {
  if (process.platform !== 'darwin') return;
  const autostart = require('../cli/lib/library-autostart');
  autostart.disable();
  try {
    await page.goto(pageUrl);
    await page.waitForSelector('.res');
    await page.waitForSelector('#agent-banner:not([hidden])');
    await page.click('.agent-banner-dismiss');
    await expect(page.locator('#agent-banner')).toBeHidden();
    await page.reload();
    await page.waitForSelector('.res');
    await expect(page.locator('#agent-banner')).toBeHidden();
  } finally {
    autostart.enable();
  }
});

test('library UI: no-agent banner copy button swaps to a check on click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(brokenPageUrl);
  await page.waitForSelector('#agent-banner:not([hidden])');
  const btn = page.locator('.agent-banner-copy').first();
  expect(await btn.locator('svg rect').count()).toBe(1);
  await btn.click();
  await expect(btn.locator('svg polyline')).toHaveCount(1);
  await expect(btn).toHaveClass(/copied/);
});

test('library UI: search filters results', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.fill('#q', 'breaker');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  expect(await page.textContent('.res-title')).toContain('Circuit breaker thresholds');
});

test('library UI: tag chip filters', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.click('button[data-facet="tag"]');
  await page.waitForSelector('.facet-panel.open .facet-option');
  await page.click('.facet-option:has-text("reliability")');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  expect(await page.textContent('.res-title')).toContain('Circuit breaker thresholds');
});

test('library UI: project facet filters to one project', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.click('button[data-facet="project"]');
  await page.waitForSelector('.facet-panel.open .facet-option');
  await page.click('.facet-option:has-text("sdocs")');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 2);
});

test('library UI: star toggle and starred-only filter', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  const firstStar = page.locator('.res .res-star').first();
  await firstStar.click({ force: true });
  await page.click('#star-toggle');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
});

test('library UI: clear all resets filters', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.fill('#q', 'breaker');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  await page.click('#clear');
  await page.waitForFunction(() => document.querySelectorAll('.res').length >= 4);
});

test('library UI: double-click opens the entry in a new tab', async ({ page, context }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  // The real file is "Real one"; double-click that row, watch for the new page.
  const row = page.locator('.res:has-text("Real file you can open")');
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    row.dblclick(),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  const url = newPage.url();
  expect(url).toMatch(/#bridge=/);
});

test('library UI: click already-selected row opens it', async ({ page, context }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  const row = page.locator('.res:has-text("Real file you can open")');
  await row.click(); // selects
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    row.click(), // second click opens
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/#bridge=/);
});

test('library UI: Enter key on selected row opens it', async ({ page, context }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  // Focus the search input, type a query that narrows to "Real one".
  await page.fill('#q', 'real file');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    page.press('#q', 'Enter'),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/#bridge=/);
});

test('library UI: status line shows entry count', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  const status = await page.textContent('#status-line');
  expect(status).toContain('4 entries');
});

// ── Exclude-chip cycle ──────────────────────────────────

test('library UI: tag option + / - buttons include and exclude explicitly', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.click('button[data-facet="tag"]');
  await page.waitForSelector('.facet-panel.open .facet-option');

  // Click the main label to include: narrows to entries with tag "bridge".
  const bridgeOption = page.locator('.facet-option:has-text("bridge")');
  await bridgeOption.locator('.opt-label').click();
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  await expect(bridgeOption).toHaveClass(/selected/);

  // Click the - button to switch directly to exclude. The pill flips
  // colour and the row count moves to entries WITHOUT tag "bridge".
  await bridgeOption.locator('.opt-minus').click();
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 3);
  await expect(bridgeOption).toHaveClass(/excluded/);
  await expect(page.locator('.filter-chip.exclude').first()).toBeVisible();

  // Click - again to clear.
  await bridgeOption.locator('.opt-minus').click();
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 4);
  await expect(bridgeOption).not.toHaveClass(/excluded/);
  await expect(bridgeOption).not.toHaveClass(/selected/);
});

test('library UI: search box supports -tag:foo to exclude a tag', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.fill('#q', '-tag:bridge');
  // Submitting the search syntax materialises an exclude chip and
  // clears the matching entries from view.
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 3);
  await expect(page.locator('.filter-chip.exclude')).toHaveCount(1);
});

// ── Calendar date-range picker ──────────────────────────

test('library UI: opening the date facet exposes a calendar range picker', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.click('button[data-facet="since"]');
  await page.waitForSelector('.facet-panel.open');
  // Two date inputs + Apply button live inside the panel.
  await expect(page.locator('.date-range-input[data-end="from"]')).toBeVisible();
  await expect(page.locator('.date-range-input[data-end="to"]')).toBeVisible();
  await expect(page.locator('.date-range-apply')).toBeVisible();
});

test('library UI: applying a custom date range filters by mtime', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  await page.click('button[data-facet="since"]');
  await page.waitForSelector('.facet-panel.open .date-range-input');
  // Seed entries land in May 2026 (aaa) and earlier. Pick a window
  // that only covers aaa's mtime (2026-05-19).
  await page.fill('.date-range-input[data-end="from"]', '2026-05-15');
  await page.fill('.date-range-input[data-end="to"]',   '2026-05-25');
  await page.click('.date-range-apply');
  await page.waitForFunction(() => document.querySelectorAll('.res').length === 1);
  await expect(page.locator('.filter-chip')).toContainText('2026-05-15');
});

// ── Rescued badge tooltip ───────────────────────────────

test('library UI: rescued badge, when present, links to the explainer page', async ({ page }) => {
  await page.goto(pageUrl);
  await page.waitForSelector('.res');
  // The default fixture has no rescued entries, so this test is a
  // markup-shape check only. Any rescue badge that does render must be
  // an <a> pointing at /library/rescued.
  const badges = page.locator('.rescued-badge');
  const count = await badges.count();
  for (let i = 0; i < count; i++) {
    const tag = await badges.nth(i).evaluate(el => el.tagName.toLowerCase());
    expect(tag).toBe('a');
    await expect(badges.nth(i)).toHaveAttribute('href', '/library/rescued');
  }
});

test('rescued explainer page renders at /library/rescued', async ({ page }) => {
  await page.goto('http://localhost:3000/library/rescued');
  await expect(page.locator('h1')).toHaveText('Rescued files');
});

// ── Connect-flow gate ────────────────────────────────

test('connect page renders at /connect', async ({ page }) => {
  await page.goto('http://localhost:3000/connect');
  await expect(page.locator('h1')).toHaveText('Local Connect');
  await expect(page.locator('#connect-btn')).toBeVisible();
});

test('first visit to /library redirects to /connect with a return URL', async ({ page }) => {
  // Fresh context, no localStorage yet -> should redirect.
  const noForceUrl = `http://localhost:3000/library?agent=${encodeURIComponent(agent.agentUrl)}`;
  await page.goto(noForceUrl);
  await page.waitForURL(/\/connect\?return=/);
  // The return param round-trips the original library path back to the connect page.
  expect(decodeURIComponent(page.url())).toContain('return=/library?agent=');
});

test('library does NOT redirect when localStorage marks the browser connected', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true, version: '1.11.1', at: Date.now() }));
  });
  const noForceUrl = `http://localhost:3000/library?agent=${encodeURIComponent(agent.agentUrl)}`;
  await page.goto(noForceUrl);
  // Stays on /library and loads results.
  await page.waitForSelector('.res');
  expect(page.url()).toContain('/library');
});

test('connect button marks the browser connected and shows the open-library link', async ({ page }) => {
  // Point the connect button at our test agent by overriding its URL
  // via a pre-init script. The connect script always hits the canonical
  // port (47843) which we can't bind from tests, so we monkey-patch
  // fetch to redirect that one URL to our agent.
  const agentUrl = agent.agentUrl;
  await page.addInitScript(({ realAgentUrl }) => {
    const orig = window.fetch;
    window.fetch = function (url, init) {
      if (typeof url === 'string' && url.startsWith('http://127.0.0.1:47843')) {
        return orig(url.replace('http://127.0.0.1:47843', realAgentUrl), init);
      }
      return orig(url, init);
    };
  }, { realAgentUrl: agentUrl });
  await page.goto('http://localhost:3000/connect');
  await page.click('#connect-btn');
  await expect(page.locator('#status.ok')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#nav-buttons')).toBeVisible();
  // localStorage now records the success.
  const stored = await page.evaluate(() => localStorage.getItem('sdocs.connect'));
  expect(stored).toContain('"connected":true');
});

test('home page does not fire any fetch to 127.0.0.1 on load', async ({ page }) => {
  // The whole point of /connect is that first-time visitors never
  // touch the loopback agent without consenting. This is the
  // canary test for that promise.
  const loopbackHits = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('127.0.0.1:47843') || url.includes('localhost:47843')) {
      loopbackHits.push(url);
    }
  });
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle');
  expect(loopbackHits).toEqual([]);
});
