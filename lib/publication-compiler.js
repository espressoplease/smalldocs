'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const COMPILE_TIMEOUT_MS = 45000;
const TRANSFER_MAX_BYTES = 64 * 1024 * 1024;
const RICH_ASSETS = new Set([
  '/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  '/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
  '/npm/chartjs-plugin-annotation@3.1.0/dist/chartjs-plugin-annotation.min.js',
  '/npm/mermaid@10.9.1/dist/mermaid.min.js',
  '/npm/katex@0.16.11/dist/katex.min.css',
  '/npm/katex@0.16.11/dist/katex.min.js',
  '/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js',
]);

function compileError(cause) {
  const error = new Error('The public document could not be compiled.');
  error.code = 'publication_compile_failed';
  if (cause) error.cause = cause;
  return error;
}

function assetAllowed(value, origin, resourceType) {
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (url.username || url.password) return false;
  if (url.origin === origin) return /^\/public\/[A-Za-z0-9_./-]+\.(?:js|mjs|css|woff2?|ttf|otf|wasm|svg|png|jpe?g|gif|webp|ico)$/i.test(url.pathname)
    && !url.pathname.split('/').includes('..');
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'fonts.googleapis.com') return resourceType === 'stylesheet' && /^\/css2?$/.test(url.pathname);
  if (url.hostname === 'fonts.gstatic.com') return resourceType === 'font' && /^\/s\/[A-Za-z0-9_./-]+\.(?:woff2?|ttf|otf)$/.test(url.pathname);
  if (url.hostname !== 'cdn.jsdelivr.net') return false;
  return RICH_ASSETS.has(url.pathname)
    || /^\/npm\/katex@0\.16\.11\/dist\/fonts\/[A-Za-z0-9_-]+\.(?:woff2?|ttf)$/.test(url.pathname)
    || /^\/npm\/@highlightjs\/cdn-assets@11\.11\.1\/languages\/[A-Za-z0-9_-]+\.min\.js$/.test(url.pathname);
}

function compileCsp(html) {
  const nonces = Array.from(String(html).matchAll(/<script\b[^>]*\bnonce=["']([A-Za-z0-9+/_=-]+)["']/g), match => "'nonce-" + match[1] + "'");
  return ["default-src 'none'", "script-src 'self' " + Array.from(new Set(nonces)).join(' ') + ' https://cdn.jsdelivr.net',
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com", "img-src 'self' data: blob:",
    "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
}

// This function executes in the isolated browser, using only the normal reader.
async function capturePublicRoot() {
  const S = window.SDocs;
  await Promise.resolve(S.publicationRenderReady);
  if (window.SDocSlides && window.SDocSlides.ready) await window.SDocSlides.ready();
  if (S.setAllSectionsOpen) S.setAllSectionsOpen(true);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  // Font/style observers can briefly empty a slide while remeasuring it.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const root = document.getElementById('_sd_rendered');
  if (!root || !window.DOMPurify) throw new Error('The document reader is unavailable.');
  const canvases = [], sheets = new Map();
  const shadowStyles = ['font', 'color', 'display', 'line-height', 'letter-spacing', 'text-align', 'text-decoration',
    'text-transform', 'white-space', 'overflow-wrap', 'word-break', 'margin', 'padding', 'background',
    'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'vertical-align', 'box-sizing'];
  function copy(node, inShadow) {
    const cloned = node.cloneNode(false);
    if (node.nodeType === 1) {
      if (node.tagName === 'CANVAS') canvases.push({ live: node, clone: cloned });
      if (node.classList.contains('sdoc-cells')) sheets.set(node, cloned);
      // Slide Markdown lives in open shadow roots. Flatten its rendered text
      // into the initial HTML and preserve its resolved presentation, rather
      // than losing it through cloneNode or relying on crawler shadow support.
      if ((inShadow || node.ownerSVGElement || node.tagName.toLowerCase() === 'svg') && cloned.style) {
        const computed = getComputedStyle(node);
        shadowStyles.forEach(name => cloned.style.setProperty(name, computed.getPropertyValue(name)));
        if (node.ownerSVGElement || node.tagName.toLowerCase() === 'svg') {
          ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','text-anchor','dominant-baseline','paint-order'].forEach(name => {
            const value = computed.getPropertyValue(name);
            if (!value.includes('url(')) cloned.style.setProperty(name, value);
          });
        }
      }
      const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
      Array.from(children).forEach(child => {
        if (child.nodeType === 1 && ['STYLE', 'LINK'].includes(child.tagName)) return;
        cloned.appendChild(copy(child, inShadow || Boolean(node.shadowRoot)));
      });
    } else if (node.childNodes) Array.from(node.childNodes).forEach(child => cloned.appendChild(copy(child, inShadow)));
    return cloned;
  }
  const clone = copy(root, false);
  clone.querySelectorAll('.md-section-body').forEach(node => node.classList.add('open'));
  clone.querySelectorAll('#_sd_sdocs-file-info,.sdocs-document-actions,.sec-scroll-spacer').forEach(node => node.remove());
  // Static HTML has no tab handlers. Expose every published sheet, and use
  // the existing full model/format API when an inline grid painted a subset.
  (S.cellsWorkbook || []).forEach(entry => {
    const live = entry.wrapper, target = sheets.get(live), model = live && live._cellsModel || entry.model;
    if (!target || !model) return;
    target.style.removeProperty('display'); target.removeAttribute('hidden');
    const extent = live._cellsExtent;
    if (!extent || extent.rows >= model.rows && extent.cols >= model.cols) return;
    const api = window.SDocCells, fx = live._cellsFxView || live._cellsFx || [];
    const table = document.createElement('table'); table.className = 'sdocs-publication-complete-sheet';
    const caption = document.createElement('caption'); caption.textContent = entry.name || model.name || 'Sheet'; table.appendChild(caption);
    const body = document.createElement('tbody');
    for (let r = 0; r < model.rows; r++) {
      const row = document.createElement('tr'), sourceRow = live._cellsRowOrder ? live._cellsRowOrder[r] : r;
      for (let c = 0; c < model.cols; c++) {
        const cell = model.cells[r] && model.cells[r][c] || {type:'empty',raw:''}, computed = /^\s*=/.test(cell.raw) && fx[r] && fx[r][c];
        const value = computed && computed.kind === 'number' ? {type:'number',value:computed.value,raw:String(computed.value),computed:true} : cell;
        const td = document.createElement('td');
        td.textContent = computed && computed.kind === 'error' ? computed.code : computed && computed.kind === 'boolean' ? (computed.value ? 'TRUE' : 'FALSE')
          : computed && computed.kind !== 'number' ? String(computed.value)
          : value.type === 'number' ? api.formatValue(value, api.resolveFormat(entry.model, sourceRow, c)) : cell.raw.replace(/<br\s*\/?>/gi,'\n');
        row.appendChild(td);
      } body.appendChild(row);
    }
    table.appendChild(body); const grid = target.querySelector('.sdoc-cells-grid'); if (grid) grid.replaceWith(table);
    target.querySelectorAll('.sdoc-cells-note').forEach(note => note.remove());
  });

  function chartTable(data, title) {
    const table = document.createElement('table');
    const caption = document.createElement('caption'); caption.textContent = title || 'Chart data'; table.appendChild(caption);
    const sets = Array.isArray(data.datasets) ? data.datasets : [];
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const rows = Math.max(labels.length, ...sets.map(set => Array.isArray(set.data) ? set.data.length : 0), 0);
    const head = document.createElement('tr');
    ['Label'].concat(sets.map(set => set.label || 'Value')).forEach(text => { const cell = document.createElement('th'); cell.textContent = text; cell.scope = 'col'; head.appendChild(cell); });
    const thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const body = document.createElement('tbody');
    for (let index = 0; index < rows; index++) {
      const row = document.createElement('tr');
      [labels[index] == null ? String(index + 1) : labels[index]].concat(sets.map(set => (set.data || [])[index])).forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        row.appendChild(cell);
      }); body.appendChild(row);
    }
    table.appendChild(body); return table;
  }
  canvases.forEach(({ live, clone: canvas }) => {
    const chart = window.Chart && window.Chart.getChart ? window.Chart.getChart(live) : null;
    const title = chart && chart.options && chart.options.plugins && chart.options.plugins.title && chart.options.plugins.title.text;
    const label = Array.isArray(title) ? title.join(' ') : title || live.getAttribute('aria-label') || 'Chart';
    const figure = document.createElement('figure');
    try {
      if (chart) { chart.stop(); chart.update('none'); }
      const image = document.createElement('img'); image.src = live.toDataURL('image/png'); image.alt = label;
      image.style.cssText = canvas.style.cssText; image.style.maxWidth = '100%'; figure.appendChild(image);
    } catch (_) {}
    if (chart && chart.data) figure.appendChild(chartTable(chart.data, label));
    else { const text = document.createElement('figcaption'); text.textContent = label; figure.appendChild(text); }
    canvas.replaceWith(figure);
  });
  clone.querySelectorAll('img').forEach(image => {
    const src = image.getAttribute('src') || '';
    let safeReference = false;
    try { const url = new URL(src, location.href); safeReference = !url.username && !url.password && (url.protocol === 'https:' || url.origin === location.origin && url.pathname.startsWith('/public/')); } catch (_) {}
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src) || safeReference) return;
    const text = document.createElement('span'); text.textContent = image.alt || 'Image'; image.replaceWith(text);
  });
  clone.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(attribute => {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'formaction', 'action', 'nonce', 'autofocus'].includes(attribute.name)) node.removeAttribute(attribute.name);
    });
  });
  // The normal Mermaid reader already owns its SVG/XHTML sanitiser. A generic
  // HTML pass would drop its foreignObject labels and silently lose text.
  const diagrams = [];
  if (window.SDocMermaidCore) {
    const sanitizer = window.SDocMermaidCore.create({ window, document, sdocs: {}, root });
    clone.querySelectorAll('svg.sdoc-mermaid-svg').forEach(svg => {
      const token = crypto.randomUUID();
      const placeholder = document.createElement('span'); placeholder.setAttribute('data-sdocs-compiled-diagram', token);
      diagrams.push({ token, html: sanitizer.sanitizeSvg(svg.outerHTML) }); svg.replaceWith(placeholder);
    });
    sanitizer.destroy();
  }
  let html = window.DOMPurify.sanitize(clone.outerHTML, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'nonce', 'contenteditable', 'autofocus'],
    ADD_ATTR: ['style'],
  });
  diagrams.forEach(diagram => { html = html.replace('<span data-sdocs-compiled-diagram="' + diagram.token + '"></span>', () => diagram.html); });
  const shapeStyle = document.head.querySelector('style#sdocs-shape-render-css');
  return { html, styles: { shape: shapeStyle ? shapeStyle.textContent : '', math: Boolean(clone.querySelector('.katex')) } };
}

function createCompiler(options) {
  options = options || {};
  const origin = new URL(options.origin).origin;
  if (!/^https?:/.test(origin)) throw new Error('The compiler requires an HTTP origin.');
  const timeoutMs = options.timeoutMs || COMPILE_TIMEOUT_MS;
  let browserPromise, queue = Promise.resolve(), closed = false, idleTimer;
  async function browser() {
    clearTimeout(idleTimer);
    if (browserPromise) {
      const previous = await browserPromise;
      if (previous.isConnected && !previous.isConnected()) browserPromise = null;
    }
    if (!browserPromise) {
      const type = options.browserType || require('playwright-core').chromium;
      const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || '/tmp', LANG: 'C.UTF-8' };
      if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
      browserPromise = type.launch({ headless: true, chromiumSandbox: true, env, timeout: timeoutMs,
        executablePath: options.executablePath || process.env.SDOCS_PUBLICATION_BROWSER_EXECUTABLE || undefined }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
  }
  async function stopBrowser() {
    clearTimeout(idleTimer); const pending = browserPromise; browserPromise = null;
    if (pending) await pending.then(value => value.close()).catch(() => {});
  }
  async function compileOne(snapshot) {
    let context, timer;
    try {
      const html = snapshot && typeof snapshot.html === 'string' ? snapshot.html : await options.shell(snapshot);
      if (typeof html !== 'string') throw new Error('The compiler requires a trusted application shell.');
      const instance = await browser();
      context = await instance.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: false,
        serviceWorkers: 'block', colorScheme: 'light', locale: 'en-GB', timezoneId: 'UTC' });
      timer = setTimeout(() => context.close().catch(() => {}), timeoutMs);
      const location = origin + '/__sdocs-publication-compile__/' + crypto.randomUUID();
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.url() === location && request.isNavigationRequest()) return route.fulfill({ status: 200,
          contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': compileCsp(html), 'Cache-Control': 'no-store' }, body: html });
        if (request.method() !== 'GET' || !assetAllowed(request.url(), origin, request.resourceType())) return route.abort('blockedbyclient');
        // A permitted asset must not redirect the worker to a private service.
        try {
          const response = await route.fetch({ maxRedirects: 0 });
          if (response.status() >= 300 && response.status() < 400) return route.abort('blockedbyclient');
          const headers = response.headers(); delete headers['set-cookie'];
          return route.fulfill({ response, headers });
        } catch (_) { return route.abort('blockedbyclient'); }
      });
      if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
      await page.goto(location, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForFunction(() => window.SDocs && window.SDocs._appReady);
      const captured = await page.evaluate(capturePublicRoot);
      const result = typeof captured === 'string' ? { html: captured, styles: { shape: '', math: false } } : captured;
      if (!result || !/^<[^>]+\bid="_sd_rendered"/.test(result.html)) throw new Error('The compiled document root is missing.');
      return { html: result.html, styles: result.styles, rendererVersion: options.rendererVersion || 'app-reader' };
    } catch (error) { throw compileError(error); }
    finally {
      clearTimeout(timer); if (context) await context.close().catch(() => {});
      idleTimer = setTimeout(stopBrowser, options.idleMs == null ? 30000 : options.idleMs); idleTimer.unref();
    }
  }
  return {
    compile(snapshot) {
      if (closed) return Promise.reject(compileError());
      const result = queue.then(() => compileOne(snapshot)); queue = result.catch(() => {}); return result;
    },
    async close() { closed = true; await queue; await stopBrowser(); },
  };
}

function createCompilerClient(options) {
  if (!options || typeof options.socketPath !== 'string' || !path.isAbsolute(options.socketPath)) throw new Error('Set an absolute compiler Unix socket path.');
  return {
    async compile(snapshot) {
      const html = typeof snapshot.html === 'string' ? snapshot.html : await options.shell(snapshot);
      const body = JSON.stringify({ html, title: snapshot.title, url: snapshot.url });
      return new Promise((resolve, reject) => {
        const request = http.request({ socketPath: options.socketPath, path: '/compile', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: options.timeoutMs || COMPILE_TIMEOUT_MS + 5000 }, response => {
          let bytes = 0; const chunks = [];
          response.on('data', chunk => { bytes += chunk.length; if (bytes > (options.maxResponseBytes || TRANSFER_MAX_BYTES)) response.destroy(compileError()); else chunks.push(chunk); });
          response.on('error', reject);
          response.on('end', () => {
            try { const data = JSON.parse(Buffer.concat(chunks).toString());
              if (response.statusCode !== 200 || !data.ok || typeof data.html !== 'string') throw compileError();
              resolve({ html: data.html, styles: data.styles || { shape: '', math: false }, rendererVersion: data.rendererVersion });
            } catch (error) { reject(compileError(error)); }
          });
        });
        request.on('error', error => reject(compileError(error))); request.on('timeout', () => request.destroy(compileError())); request.end(body);
      });
    },
    async close() {},
  };
}

async function startCompilerWorker(options) {
  if (!options || typeof options.socketPath !== 'string' || !path.isAbsolute(options.socketPath)) throw new Error('Set an absolute compiler Unix socket path.');
  const compiler = options.compiler || createCompiler(options);
  const socketPath = options.socketPath;
  if (fs.existsSync(socketPath)) {
    if (!fs.lstatSync(socketPath).isSocket()) throw new Error('The compiler socket path is occupied.');
    fs.unlinkSync(socketPath);
  }
  const server = http.createServer((request, response) => {
    function answer(status, body) { if (!response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); } }
    if (request.method !== 'POST' || request.url !== '/compile') { answer(404, { ok: false }); return; }
    const chunks = []; let bytes = 0, exceeded = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > (options.maxRequestBytes || TRANSFER_MAX_BYTES)) { exceeded = true; chunks.length = 0; answer(413, { ok: false, error: 'payload_too_large' }); }
      else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', async () => {
      if (exceeded) return;
      let snapshot;
      try { snapshot = JSON.parse(Buffer.concat(chunks).toString()); if (!snapshot || typeof snapshot.html !== 'string') throw new Error(); }
      catch (_) { answer(400, { ok: false, error: 'invalid_request' }); return; }
      try { answer(200, { ok: true, ...await compiler.compile(snapshot) }); }
      catch (error) { if (options.onError) options.onError(error); answer(503, { ok: false, error: 'publication_compile_failed' }); }
    });
    request.on('error', () => answer(400, { ok: false, error: 'invalid_request' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  fs.chmodSync(socketPath, options.socketMode == null ? 0o660 : options.socketMode);
  return { socketPath, async close() { await new Promise(resolve => server.close(resolve)); await compiler.close(); try { fs.unlinkSync(socketPath); } catch (_) {} } };
}

module.exports = { createCompiler, createCompilerClient, startCompilerWorker, assetAllowed };
