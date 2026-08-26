#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const {
  compareCapture,
  diffPng,
  parseArgs,
  reportHtml,
  safeName,
} = require('./lib/sdocs-parity');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function usage() {
  return [
    'Usage: npm run parity -- <suite> [options]',
    '',
    'Options:',
    '  --baseline <git-ref>  Known-good production revision (default: origin/main)',
    '  --baseline-url <url>  Compare against a deployed SmallDocs origin',
    '  --output <directory>  Evidence directory',
    '  --headed              Show Chromium while the suite runs',
    '  --help                Show this help',
  ].join('\n');
}

function git(args, options) {
  return childProcess.execFileSync('git', args, Object.assign({
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }, options || {})).trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, processHandle) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (processHandle && processHandle.exitCode != null) {
        reject(new Error('Server exited before becoming ready: ' + processHandle.log.join('\n')));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) resolve();
        else retry();
      });
      request.on('error', retry);
    }
    function retry() {
      if (Date.now() - started > 20000) reject(new Error('Timed out waiting for ' + url));
      else setTimeout(poll, 120);
    }
    poll();
  });
}

async function startSmallDocs(root, label) {
  const port = await freePort();
  const log = [];
  const handle = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ANALYTICS_ENABLED: '0',
      CLOUD_DEPLOYMENT_MODE: 'off',
      NODE_PATH: path.join(PROJECT_ROOT, 'node_modules'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  handle.log = log;
  function record(chunk) {
    const lines = String(chunk).trim().split('\n').filter(Boolean);
    log.push(...lines);
    if (log.length > 80) log.splice(0, log.length - 80);
  }
  handle.stdout.on('data', record);
  handle.stderr.on('data', record);
  const origin = 'http://127.0.0.1:' + port;
  await waitForHttp(origin + '/', handle);
  return { label, origin, handle };
}

async function startCustomerHost(candidateOrigin, markdown) {
  const port = await freePort();
  const host = http.createServer((request, response) => {
    if (request.url === '/app.js') {
      const sdkUrl = candidateOrigin + '/sdk/0.2.0/smalldocs.js';
      const javascript = 'import { render } from ' + JSON.stringify(sdkUrl) + ';' +
        'const markdown=' + JSON.stringify(markdown) + ';' +
        'window.__parityReady=render(document.getElementById("report"),markdown).then(function(view){window.__parityView=view;return true});';
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(javascript);
      return;
    }
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
      return;
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self' " + candidateOrigin + ' https://cdn.jsdelivr.net',
      "style-src 'self' 'unsafe-inline' " + candidateOrigin + ' https://cdn.jsdelivr.net',
      'font-src ' + candidateOrigin + ' https://cdn.jsdelivr.net',
      "img-src 'self' data: blob: " + candidateOrigin,
      'connect-src ' + candidateOrigin + ' https://cdn.jsdelivr.net',
      'frame-src ' + candidateOrigin + ' https://www.youtube-nocookie.com',
      "object-src 'none'",
    ].join('; ');
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Clean SDK customer</title>' +
      '<style>html,body{margin:0;background:#f7f7f7}#report{box-sizing:border-box;width:1160px;margin:40px auto;background:#fff;--sdocs-max-width:960px}</style></head>' +
      '<body><main id="report"></main><script type="module" src="/app.js"></script></body></html>';
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
    });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    host.once('error', reject);
    host.listen(port, '127.0.0.1', resolve);
  });
  return { label: 'Clean customer SDK', origin: 'http://127.0.0.1:' + port, handle: host };
}

function extractRevision(revision, tempRoot) {
  const resolved = git(['rev-parse', '--verify', revision + '^{commit}']);
  const destination = path.join(tempRoot, 'baseline');
  const archive = path.join(tempRoot, 'baseline.tar');
  fs.mkdirSync(destination, { recursive: true });
  childProcess.execFileSync('git', ['archive', '--format=tar', '-o', archive, resolved], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  childProcess.execFileSync('tar', ['-xf', archive, '-C', destination]);
  return { resolved, destination };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pageDiagnostics(page) {
  const entries = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      entries.push({ type: 'console-' + message.type(), message: message.text() });
    }
  });
  page.on('pageerror', (error) => entries.push({ type: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => entries.push({
    type: 'requestfailed',
    message: request.url() + ': ' + ((request.failure() && request.failure().errorText) || 'failed'),
  }));
  return entries;
}

async function settle(page) {
  await page.evaluate(async () => {
    if (window.SDocSlides && typeof window.SDocSlides.ready === 'function') {
      await window.SDocSlides.ready();
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(350);
}

async function initialiseSurface(browser, surface, kind, suite, markdown) {
  const page = await browser.newPage({ viewport: suite.viewport, deviceScaleFactor: 1 });
  const diagnostics = pageDiagnostics(page);
  await page.goto(surface.origin + (kind === 'production' ? '/new' : '/'), { waitUntil: 'domcontentloaded' });
  if (kind === 'production') {
    try {
      await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
    } catch (error) {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        title: document.title,
        scripts: Array.from(document.scripts).map((script) => script.src).filter(Boolean).slice(-8),
      }));
      throw new Error('Production reader did not initialise: ' + JSON.stringify(state) + '\n' +
        diagnostics.map((entry) => entry.type + ': ' + entry.message).join('\n'));
    }
    await page.evaluate(({ source }) => {
      if (typeof window.SDocs.setMode === 'function') window.SDocs.setMode('read', true);
      window.SDocs.loadText(source, 'parity-fixture.md');
      window.SDocSlideComments = null;
      document.querySelectorAll('.md-section-body').forEach((section) => section.classList.add('open'));
      document.querySelectorAll('.section-toggle').forEach((toggle) => toggle.classList.add('open'));
      const style = document.createElement('style');
      style.dataset.parityHarness = 'true';
      style.textContent = '#_sd_rendered{width:960px!important;max-width:960px!important}';
      document.head.appendChild(style);
    }, { source: markdown });
  } else {
    await page.evaluate(() => window.__parityReady);
  }
  await page.waitForSelector(suite.readySelector, { state: 'visible', timeout: 25000 });
  await settle(page);
  return { page, diagnostics };
}

async function replayStep(page, step, config) {
  const scope = step.within === 'presentation' ? page.locator(config.presentationRoot).first() : page;
  let locator;
  if (step.role) locator = scope.getByRole(step.role, { name: step.name, exact: true });
  else locator = scope.locator(step.selector);
  if (step.action === 'click') {
    if (await locator.count() < 1) throw new Error('Control not found: ' + (step.name || step.selector));
    await locator.first().click();
  } else if (step.action === 'press') {
    await page.keyboard.press(step.key);
  } else {
    throw new Error('Unsupported action: ' + step.action);
  }
}

function captureSelectors(config, state) {
  const root = state.mode === 'inline' ? config.inlineRoot : config.presentationRoot;
  return {
    root,
    probes: Object.assign({
      root,
      stage: state.mode === 'inline' ? root + ' > .sd-slide-wrap' : config.stage,
      slide: state.mode === 'inline' ? root : config.stage + ' .sdoc-slide',
      text: state.mode === 'inline' ? root + ' .sd-text' : config.stage + ' .sd-text',
      rail: config.rail,
      firstButton: root + ' button',
    }, state.probes || {}),
  };
}

async function contractFailures(page, contracts, config) {
  const failures = [];
  for (const contract of contracts || []) {
    const scope = contract.within === 'presentation' ? page.locator(config.presentationRoot).first() : page;
    let locator;
    if (contract.role) locator = scope.getByRole(contract.role, { name: contract.name, exact: true });
    else locator = scope.locator(contract.selector);
    const count = await locator.count();
    if (contract.count != null && count !== contract.count) {
      failures.push(contract.message + ' (expected ' + contract.count + ', found ' + count + ')');
      continue;
    }
    if (contract.text != null) {
      const text = count ? String(await locator.first().textContent()).replace(/\s+/g, ' ').trim() : '';
      if (text !== contract.text) failures.push(contract.message + ' (expected "' + contract.text + '", found "' + text + '")');
    }
  }
  return failures;
}

async function captureState(page, surfaceName, config, state, outputDir, diagnostics, stepFailures) {
  const selectors = captureSelectors(config, state);
  const root = page.locator(selectors.root).first();
  const rootFound = await root.count() > 0;
  const fileBase = safeName(surfaceName) + '-' + safeName(state.name);
  const imagePath = path.join(outputDir, 'screenshots', fileBase + '.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  await page.mouse.move(1, 1);
  if (rootFound) await root.screenshot({ path: imagePath, animations: 'disabled' });
  else await page.screenshot({ path: imagePath, fullPage: false, animations: 'disabled' });
  const data = await page.evaluate(({ rootSelector, probes }) => {
    function directText(node) {
      return Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    function tree(node, budget) {
      if (!node || budget.count >= 1600) return null;
      budget.count += 1;
      const result = {
        tag: node.tagName.toLowerCase(),
        classes: Array.from(node.classList).sort(),
      };
      const text = directText(node);
      if (text) result.text = text;
      ['role', 'aria-label', 'aria-selected', 'aria-expanded', 'title'].forEach((name) => {
        if (node.hasAttribute(name)) result[name] = node.getAttribute(name);
      });
      const children = Array.from(node.children).map((child) => tree(child, budget)).filter(Boolean);
      if (children.length) result.children = children;
      return result;
    }
    function style(selector) {
      const node = document.querySelector(selector);
      if (!node) return null;
      const computed = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        selector,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        borderColor: computed.borderColor,
        borderRadius: computed.borderRadius,
        display: computed.display,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        gridTemplateColumns: computed.gridTemplateColumns,
        height: Math.round(rect.height * 10) / 10,
        opacity: computed.opacity,
        width: Math.round(rect.width * 10) / 10,
      };
    }
    const root = document.querySelector(rootSelector);
    const controls = root ? Array.from(root.querySelectorAll('button,a,[role="button"]')).map((node) => ({
      tag: node.tagName.toLowerCase(),
      classes: Array.from(node.classList).sort(),
      label: node.getAttribute('aria-label') || node.getAttribute('title') || (node.textContent || '').replace(/\s+/g, ' ').trim(),
      expanded: node.getAttribute('aria-expanded'),
      disabled: node.hasAttribute('disabled'),
    })) : [];
    const styles = {};
    Object.keys(probes).forEach((name) => { styles[name] = style(probes[name]); });
    return {
      semantic: tree(root, { count: 0 }),
      controls,
      styles,
      page: { title: document.title, path: location.pathname + location.hash, bodyClasses: Array.from(document.body.classList).sort() },
    };
  }, { rootSelector: selectors.root, probes: selectors.probes });
  data.imagePath = imagePath;
  data.contractFailures = (await contractFailures(page, state.contracts, config)).concat(stepFailures || []);
  data.diagnostics = diagnostics.slice();
  data.rootFound = rootFound;
  return data;
}

async function captureSurface(browser, surface, kind, suite, markdown, outputDir) {
  const session = await initialiseSurface(browser, surface, kind, suite, markdown);
  const captures = [];
  const config = suite.surfaces[kind];
  const stepFailures = [];
  try {
    for (const state of suite.states) {
      for (const step of state.before || []) {
        try {
          await replayStep(session.page, step, config);
        } catch (error) {
          stepFailures.push(error.message);
        }
      }
      await settle(session.page);
      captures.push(await captureState(
        session.page, surface.label, config, state, outputDir, session.diagnostics, stepFailures.splice(0),
      ));
    }
  } finally {
    await session.page.close();
  }
  return { name: surface.label, kind, captures };
}

function relativeToReport(outputDir, filePath) {
  return path.relative(outputDir, filePath).split(path.sep).join('/');
}

function compareSurfaces(label, reference, candidate, suite, outputDir) {
  const states = suite.states.map((state, index) => {
    const left = reference.captures[index];
    const right = candidate.captures[index];
    const differences = compareCapture(left, right);
    const diffImagePath = path.join(outputDir, 'diffs', safeName(label) + '-' + safeName(state.name) + '.png');
    const image = diffPng(left.imagePath, right.imagePath, diffImagePath, 0.2);
    const contractFailures = right.contractFailures.concat(
      right.diagnostics.map((entry) => entry.type + ': ' + entry.message),
    );
    const imagePass = image.sameSize && image.ratio <= 0.003;
    return {
      name: state.name,
      label: state.label,
      pass: differences.length === 0 && contractFailures.length === 0 && imagePass,
      differences,
      contractFailures,
      image,
      referenceImage: relativeToReport(outputDir, left.imagePath),
      candidateImage: relativeToReport(outputDir, right.imagePath),
      diffImage: relativeToReport(outputDir, diffImagePath),
    };
  });
  return { label, pass: states.every((state) => state.pass), states };
}

async function stopServer(server) {
  if (!server || !server.handle) return;
  if (typeof server.handle.close === 'function' && !server.handle.kill) {
    await new Promise((resolve) => server.handle.close(resolve));
    return;
  }
  if (server.handle.exitCode == null) {
    server.handle.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      server.handle.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2), PROJECT_ROOT);
  if (options.help) {
    process.stdout.write(usage() + '\n');
    return;
  }
  const suitePath = path.join(PROJECT_ROOT, 'test', 'parity', 'suites', safeName(options.suite) + '.js');
  if (!fs.existsSync(suitePath)) throw new Error('Unknown parity suite: ' + options.suite);
  const suite = require(suitePath);
  const markdown = fs.readFileSync(suite.fixture, 'utf8');
  const outputDir = options.output || path.join(PROJECT_ROOT, 'test-results', 'parity', suite.name + '-' + timestamp());
  fs.mkdirSync(outputDir, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-parity-'));
  const baseline = options.baselineUrl ? null : extractRevision(options.baseline, tempRoot);
  const servers = [];
  let browser;
  try {
    let baselineServer;
    if (options.baselineUrl) {
      baselineServer = {
        label: 'Deployed production',
        origin: options.baselineUrl.replace(/\/$/, ''),
        handle: null,
      };
      process.stdout.write('Using deployed production ' + baselineServer.origin + '\n');
    } else {
      process.stdout.write('Starting frozen production ' + baseline.resolved.slice(0, 12) + '\n');
      baselineServer = await startSmallDocs(baseline.destination, 'Frozen production');
      servers.push(baselineServer);
    }
    process.stdout.write('Starting current production\n');
    const candidateServer = await startSmallDocs(PROJECT_ROOT, 'Current production');
    servers.push(candidateServer);
    const customerServer = await startCustomerHost(candidateServer.origin, markdown);
    servers.push(customerServer);
    browser = await chromium.launch({ headless: !options.headed });
    process.stdout.write('Capturing frozen production\n');
    const frozen = await captureSurface(browser, baselineServer, 'production', suite, markdown, outputDir);
    process.stdout.write('Capturing current production\n');
    const current = await captureSurface(browser, candidateServer, 'production', suite, markdown, outputDir);
    process.stdout.write('Capturing clean customer SDK\n');
    const sdk = await captureSurface(browser, customerServer, 'sdk', suite, markdown, outputDir);
    const comparisons = [
      compareSurfaces(baselineServer.label + ' to current production', frozen, current, suite, outputDir),
      compareSurfaces('Current production to clean customer SDK', current, sdk, suite, outputDir),
    ];
    const report = {
      schemaVersion: 1,
      suite: suite.name,
      baseline: options.baselineUrl || options.baseline + ' (' + baseline.resolved + ')',
      candidate: git(['rev-parse', 'HEAD']),
      createdAt: new Date().toISOString(),
      pass: comparisons.every((comparison) => comparison.pass),
      comparisons,
      surfaces: { frozen, current, sdk },
    };
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(outputDir, 'index.html'), reportHtml(report));
    process.stdout.write('\nReport: ' + path.join(outputDir, 'index.html') + '\n');
    comparisons.forEach((comparison) => {
      const failed = comparison.states.filter((state) => !state.pass);
      process.stdout.write((failed.length ? 'DRIFT ' : 'PASS  ') + comparison.label + ': ' + failed.length + '/' + comparison.states.length + ' states failed\n');
    });
    if (!report.pass) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    for (let index = servers.length - 1; index >= 0; index -= 1) await stopServer(servers[index]);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
