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
  imageWithinTolerance,
  parseArgs,
  reportHtml,
  safeName,
} = require('./lib/sdocs-parity');
const {
  locatorFor,
  replayStep,
  resetInteractionState,
} = require('./lib/sdocs-parity-browser');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function usage() {
  return [
    'Usage: npm run parity -- <suite> [options]',
    '',
    'Options:',
    '  --baseline <git-ref>  Known-good production revision (default: origin/main)',
    '  --baseline-url <url>  Compare against a deployed SmallDocs origin',
    '  --sdk-version <x.y.z>  Candidate SDK version (default: 0.3.0)',
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

async function startCustomerHost(candidateOrigin, markdown, sdkOptions, sdkVersion) {
  const port = await freePort();
  const host = http.createServer((request, response) => {
    if (request.url === '/app.js') {
      const sdkUrl = candidateOrigin + '/sdk/' + sdkVersion + '/smalldocs.js';
      const javascript = 'import { render } from ' + JSON.stringify(sdkUrl) + ';' +
        'const markdown=' + JSON.stringify(markdown) + ';' +
        'const options=' + JSON.stringify(sdkOptions || {}) + ';' +
        'window.__parityReady=render(document.getElementById("report"),markdown,options).then(function(view){window.__parityView=view;return true});';
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
      '<style>html,body{margin:0;background:#f7f7f7}#report{box-sizing:border-box;width:min(1160px,100%);margin:40px auto;background:#fff;--sdocs-max-width:960px}</style></head>' +
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
  const page = await browser.newPage(Object.assign({
    viewport: suite.viewport,
    deviceScaleFactor: 1,
  }, suite.pageOptions || {}));
  const diagnostics = pageDiagnostics(page);
  await page.addInitScript(() => {
    window.__sdocsParityCopiedText = '';
    window.__sdocsParityCopiedPng = null;
    window.ClipboardItem = function (parts) { this.parts = parts; };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => { window.__sdocsParityCopiedText = String(value); },
        write: async (items) => { window.__sdocsParityCopiedPng = items[0].parts['image/png']; },
      },
    });
  });
  await page.goto(surface.origin + (kind === 'production' ? '/new' : '/'), { waitUntil: 'domcontentloaded' });
  if (kind === 'production') {
    try {
      await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function', null, { timeout: 3000 });
    } catch (error) {
      await page.goto(surface.origin + '/', { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function', null, { timeout: 10000 });
      } catch (fallbackError) {
        const state = await page.evaluate(() => ({
          path: location.pathname,
          title: document.title,
          scripts: Array.from(document.scripts).map((script) => script.src).filter(Boolean).slice(-8),
        }));
        throw new Error('Production reader did not initialise: ' + JSON.stringify(state) + '\n' +
          diagnostics.map((entry) => entry.type + ': ' + entry.message).join('\n'));
      }
    }
    await page.evaluate(({ source, codeComments }) => {
      if (codeComments === false && window.SDocCodeFocus && window.SDocCodeFocus.create) {
        if (window.SDocs.codeFocus && window.SDocs.codeFocus.destroy) window.SDocs.codeFocus.destroy();
        window.SDocs.codeFocus = window.SDocCodeFocus.create(window.SDocs, {
          root: function () { return window.SDocs.renderedEl; },
          comments: false,
        });
      }
      if (typeof window.SDocs.setMode === 'function') window.SDocs.setMode('read', true);
      window.SDocs.loadText(source, 'parity-fixture.md');
      window.SDocSlideComments = null;
      document.querySelectorAll('.md-section-body').forEach((section) => section.classList.add('open'));
      document.querySelectorAll('.section-toggle').forEach((toggle) => toggle.classList.add('open'));
      const style = document.createElement('style');
      style.dataset.parityHarness = 'true';
      style.textContent = '#_sd_rendered{width:min(960px,100%)!important;max-width:960px!important}';
      document.head.appendChild(style);
    }, {
      source: markdown,
      codeComments: suite.productionCapabilities && suite.productionCapabilities.codeComments,
    });
  } else {
    await page.evaluate(() => window.__parityReady);
  }
  await page.waitForSelector(suite.readySelector, { state: 'visible', timeout: 25000 });
  await settle(page);
  return { page, diagnostics };
}

function captureSelectors(config, state) {
  if (config.modes && config.modes[state.mode]) {
    const mode = config.modes[state.mode];
    return {
      root: mode.root,
      probes: Object.assign({ root: mode.root }, mode.probes || {}, state.probes || {}),
    };
  }
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
    const locator = locatorFor(page, config, contract);
    const count = await locator.count();
    if (contract.count != null && count !== contract.count) {
      failures.push(contract.message + ' (expected ' + contract.count + ', found ' + count + ')');
      continue;
    }
    if (contract.minCount != null && count < contract.minCount) {
      failures.push(contract.message + ' (expected at least ' + contract.minCount + ', found ' + count + ')');
      continue;
    }
    if (contract.maxCount != null && count > contract.maxCount) {
      failures.push(contract.message + ' (expected at most ' + contract.maxCount + ', found ' + count + ')');
      continue;
    }
    if (!count && [contract.text, contract.inputValue, contract.attribute, contract.visible, contract.focused, contract.focusVisible,
      contract.hovered, contract.nonEmpty, contract.insideViewport]
      .some((value) => value != null)) {
      failures.push(contract.message + ' (target not found)');
      continue;
    }
    if (contract.text != null) {
      const text = count ? String(await locator.first().textContent()).replace(/\s+/g, ' ').trim() : '';
      if (text !== contract.text) failures.push(contract.message + ' (expected "' + contract.text + '", found "' + text + '")');
    }
    if (contract.inputValue != null && count) {
      const value = await locator.first().inputValue();
      if (value !== contract.inputValue) failures.push(contract.message + ' (expected input value "' + contract.inputValue + '", found "' + value + '")');
    }
    if (contract.attribute != null && count) {
      const value = await locator.first().getAttribute(contract.attribute);
      if (value !== contract.value) failures.push(contract.message + ' (expected ' + contract.attribute + '="' + contract.value + '", found "' + value + '")');
    }
    if (contract.visible != null && count) {
      const visible = await locator.first().isVisible();
      if (visible !== contract.visible) failures.push(contract.message + ' (expected visible ' + contract.visible + ', found ' + visible + ')');
    }
    if (contract.focused != null && count) {
      const focused = await locator.first().evaluate((node) => node === document.activeElement);
      if (focused !== contract.focused) failures.push(contract.message + ' (expected focused ' + contract.focused + ', found ' + focused + ')');
    }
    if (contract.focusVisible != null && count) {
      const focusVisible = await locator.first().evaluate((node) => node.matches(':focus-visible'));
      if (focusVisible !== contract.focusVisible) failures.push(contract.message + ' (expected focus-visible ' + contract.focusVisible + ', found ' + focusVisible + ')');
    }
    if (contract.hovered != null && count) {
      const hovered = await locator.first().evaluate((node) => node.matches(':hover'));
      if (hovered !== contract.hovered) failures.push(contract.message + ' (expected hovered ' + contract.hovered + ', found ' + hovered + ')');
    }
    if (contract.nonEmpty != null && count) {
      const text = String(await locator.first().textContent()).replace(/\s+/g, ' ').trim();
      const nonEmpty = text.length > 0;
      if (nonEmpty !== contract.nonEmpty) failures.push(contract.message + ' (expected non-empty ' + contract.nonEmpty + ', found ' + nonEmpty + ')');
    }
    if (contract.insideViewport != null && count) {
      const box = await locator.first().boundingBox();
      const viewport = page.viewportSize();
      const tolerance = 0.5;
      const inside = Boolean(box && viewport && box.x >= -tolerance && box.y >= -tolerance
        && box.x + box.width <= viewport.width + tolerance
        && box.y + box.height <= viewport.height + tolerance);
      if (inside !== contract.insideViewport) failures.push(contract.message + ' (expected inside viewport ' + contract.insideViewport + ', found ' + inside + ')');
    }
  }
  return failures;
}

async function screenshotAligned(locator, options) {
  const prior = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const state = {
      translate: node.style.getPropertyValue('translate'),
      translatePriority: node.style.getPropertyPriority('translate'),
      changed: false,
    };
    const dx = Math.round(rect.x) - rect.x;
    const dy = Math.round(rect.y) - rect.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return state;
    node.style.setProperty('translate', dx + 'px ' + dy + 'px', 'important');
    state.changed = true;
    return state;
  });
  if (prior.changed) {
    await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  try {
    await locator.screenshot(options);
  } finally {
    if (prior.changed) {
      await locator.evaluate((node, state) => {
        if (state.translate) node.style.setProperty('translate', state.translate, state.translatePriority);
        else node.style.removeProperty('translate');
      }, prior);
    }
  }
}

async function hideForScreenshot(page, selectors) {
  const records = [];
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      records.push(await locator.nth(index).evaluate((node) => {
        const record = {
          node,
          value: node.style.getPropertyValue('visibility'),
          priority: node.style.getPropertyPriority('visibility'),
        };
        node.style.setProperty('visibility', 'hidden', 'important');
        return { value: record.value, priority: record.priority };
      }));
    }
  }
  return async function restore() {
    let recordIndex = 0;
    for (const selector of selectors || []) {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const record = records[recordIndex++];
        await locator.nth(index).evaluate((node, saved) => {
          if (saved.value) node.style.setProperty('visibility', saved.value, saved.priority);
          else node.style.removeProperty('visibility');
        }, record);
      }
    }
  };
}

async function captureState(page, surfaceName, config, state, outputDir, diagnostics, stepFailures) {
  const selectors = captureSelectors(config, state);
  const root = page.locator(selectors.root).first();
  const rootFound = await root.count() > 0;
  const screenshotRoot = page.locator(state.screenshotSelector || selectors.root).first();
  const screenshotRootFound = await screenshotRoot.count() > 0;
  const fileBase = safeName(surfaceName) + '-' + safeName(state.name);
  const imagePath = path.join(outputDir, 'screenshots', fileBase + '.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  const restoreHidden = await hideForScreenshot(page, config.hideForScreenshot);
  try {
    if (screenshotRootFound) await screenshotAligned(screenshotRoot, { path: imagePath, animations: 'disabled' });
    else await page.screenshot({ path: imagePath, fullPage: false, animations: 'disabled' });
  } finally {
    await restoreHidden();
  }
  const data = await page.evaluate(({ rootSelector, probes }) => {
    function directText(node) {
      if (node.tagName === 'STYLE') return '';
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
      if (/^(input|textarea|select)$/i.test(node.tagName)) result.value = node.value;
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
        lineHeight: computed.lineHeight,
        boxSizing: computed.boxSizing,
        padding: computed.padding,
        margin: computed.margin,
        gridTemplateColumns: computed.gridTemplateColumns,
        height: Math.round(rect.height * 10) / 10,
        opacity: computed.opacity,
        outlineColor: computed.outlineColor,
        outlineOffset: computed.outlineOffset,
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        boxShadow: computed.boxShadow,
        cursor: computed.cursor,
        pointerEvents: computed.pointerEvents,
        visibility: computed.visibility,
        width: Math.round(rect.width * 10) / 10,
      };
    }
    function identity(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
      return {
        tag: node.tagName.toLowerCase(),
        classes: Array.from(node.classList).sort(),
        role: node.getAttribute('role'),
        label: node.getAttribute('aria-label') || node.getAttribute('title') || '',
      };
    }
    const root = document.querySelector(rootSelector);
    const controls = root ? Array.from(root.querySelectorAll('button,a,[role="button"]')).map((node) => ({
      tag: node.tagName.toLowerCase(),
      classes: Array.from(node.classList).sort(),
      label: node.getAttribute('aria-label') || node.getAttribute('title') || (node.textContent || '').replace(/\s+/g, ' ').trim(),
      expanded: node.getAttribute('aria-expanded'),
      disabled: node.hasAttribute('disabled'),
      focused: node === document.activeElement,
      focusVisible: node.matches(':focus-visible'),
      hovered: node.matches(':hover'),
    })) : [];
    const styles = {};
    Object.keys(probes).forEach((name) => { styles[name] = style(probes[name]); });
    return {
      semantic: tree(root, { count: 0 }),
      controls,
      styles,
      interaction: {
        active: root && root.contains(document.activeElement) ? identity(document.activeElement) : null,
        focusVisible: Boolean(root && root.contains(document.activeElement) && document.activeElement.matches(':focus-visible')),
        hoverPath: root ? [root].concat(Array.from(root.querySelectorAll(':hover')))
          .filter((node) => node.matches(':hover')).map(identity) : [],
      },
      page: { title: document.title, path: location.pathname + location.hash, bodyClasses: Array.from(document.body.classList).sort() },
    };
  }, { rootSelector: selectors.root, probes: selectors.probes });
  data.imagePath = imagePath;
  if (config.ignoreRootIdentity && data.semantic) {
    data.semantic.tag = 'reader-root';
    data.semantic.classes = [];
    if (data.interaction && data.interaction.hoverPath && data.interaction.hoverPath[0]) {
      data.interaction.hoverPath[0].tag = 'reader-root';
      data.interaction.hoverPath[0].classes = [];
    }
  }
  if (state.ignoreHover && data.interaction) {
    data.interaction.hoverPath = [];
    data.controls.forEach((control) => { control.hovered = false; });
  }
  data.contractFailures = (await contractFailures(page, state.contracts, config)).concat(stepFailures || []);
  const diagnosticIgnore = config.diagnosticIgnore || [];
  data.diagnostics = diagnostics.filter((entry) => !diagnosticIgnore.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(entry.message);
    return entry.message.includes(String(pattern));
  }));
  data.rootFound = rootFound;
  return data;
}

async function captureSurface(browser, surface, kind, suite, markdown, outputDir) {
  const captures = [];
  const config = suite.surfaces[kind];
  const stepFailures = [];
  let session = null;
  try {
    for (const state of suite.states) {
      if (!session || state.fresh === true) {
        if (session) await session.page.close();
        session = await initialiseSurface(browser, surface, kind, suite, markdown);
      }
      if (state.viewport) await session.page.setViewportSize(state.viewport);
      if (state.resetInteraction !== false) await resetInteractionState(session.page);
      const steps = state.beforeBySurface && state.beforeBySurface[kind]
        ? state.beforeBySurface[kind]
        : state.before || [];
      for (const step of steps) {
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
    if (session) await session.page.close();
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
    const ignoredDifferences = (suite.ignoreDifferences || []).concat(state.ignoreDifferences || []);
    const differences = compareCapture(left, right).filter((difference) =>
      !ignoredDifferences.some((location) => difference.location === location
        || difference.location.startsWith(location + '.')));
    const diffImagePath = path.join(outputDir, 'diffs', safeName(label) + '-' + safeName(state.name) + '.png');
    const image = diffPng(left.imagePath, right.imagePath, diffImagePath, 0.2);
    const contractFailures = left.contractFailures.map((failure) => 'Reference: ' + failure)
      .concat(left.diagnostics.map((entry) => 'Reference ' + entry.type + ': ' + entry.message))
      .concat(right.contractFailures.map((failure) => 'Candidate: ' + failure))
      .concat(right.diagnostics.map((entry) => 'Candidate ' + entry.type + ': ' + entry.message));
    const imagePass = imageWithinTolerance(image, state.imageTolerance || suite.imageTolerance);
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
    const customerServer = await startCustomerHost(
      candidateServer.origin, markdown, suite.sdkOptions, options.sdkVersion);
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
      schemaVersion: 2,
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
