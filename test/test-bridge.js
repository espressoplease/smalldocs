// Bridge core tests.
//
// Three slices:
//   1. Pure-function checks (origin policy, path resolution, ws framing).
//   2. End-to-end through a real bridge: handshake, hello, write+ack, external
//      change push, submit, reject-on-bad-token, reject-on-bad-origin.
//   3. feedback exit-code paths (close-without-submit, submit, no-connect).
//
// We hand-roll a minimal WebSocket client because the CLI ships with zero deps
// and the test harness inherits that constraint.

const fs   = require('fs');
const net  = require('net');
const os   = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const bridge = require('../cli/bin/sdocs-bridge');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── Minimal WS client (Node-side) ─────────────────────────

function clientHandshake(port, token, opts) {
  opts = opts || {};
  const origin = opts.origin || 'https://sdocs.dev';
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      const lines = [
        'GET /?token=' + encodeURIComponent(token) + ' HTTP/1.1',
        'Host: 127.0.0.1:' + port,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Origin: ' + origin,
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        '', '',
      ];
      sock.write(lines.join('\r\n'));
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const sep = buf.indexOf(Buffer.from('\r\n\r\n'));
      if (sep < 0) return;
      const head = buf.slice(0, sep).toString('utf-8');
      const rest = buf.slice(sep + 4);
      sock.removeAllListeners('data');
      // If the handshake failed (no 101), there's nothing to read after.
      if (!head.includes('101 Switching Protocols')) {
        return resolve({ sock, head, rest });
      }
      // Attach a single shared parser. Messages arriving later land in a
      // queue; tests pull from the queue via nextMessage(sock).
      sock._queue = [];
      sock._waiters = [];
      const parser = new bridge.WsParser({
        expectMasked: false,
        onMessage: (op, payload) => {
          if (op !== 0x1) return;
          let msg;
          try { msg = JSON.parse(payload.toString('utf-8')); } catch (_) { return; }
          if (sock._waiters.length) sock._waiters.shift()(msg);
          else sock._queue.push(msg);
        },
      });
      if (rest.length) parser.feed(rest);
      sock.on('data', (chunk) => parser.feed(chunk));
      resolve({ sock, head, rest });
    });
    sock.on('error', reject);
  });
}

function maskFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let head;
  if (len < 126)        { head = Buffer.alloc(2); head[1] = 0x80 | len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else                  { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x80 | opcode;
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, masked]);
}

function sendJson(sock, obj) {
  sock.write(maskFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf-8')));
}

// Pull the next message from the per-socket queue. The parser feeding the
// queue lives on the socket from clientHandshake; tests don't need their own.
function nextMessage(sock, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!sock._queue) return reject(new Error('socket is not in a connected WS state'));
    if (sock._queue.length) return resolve(sock._queue.shift());
    const t = setTimeout(() => {
      const i = sock._waiters.indexOf(onMsg);
      if (i >= 0) sock._waiters.splice(i, 1);
      reject(new Error('timeout waiting for ws message'));
    }, timeoutMs || 3000);
    const onMsg = (m) => { clearTimeout(t); resolve(m); };
    sock._waiters.push(onMsg);
  });
}

// ── Test fixtures ─────────────────────────────────────────

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body || '# initial\n');
  return p;
}

// ── Tests ─────────────────────────────────────────────────

module.exports = function (harness) {
  const { assert, test, testAsync } = harness;
  const asyncTests = [];
  const t = (name, fn) => asyncTests.push([name, fn]);

  console.log('\n── Bridge core tests ─────────────────────────\n');

  // 1. Pure functions.

  test('isAllowedOrigin: sdocs.dev and loopback are accepted', () => {
    assert.strictEqual(bridge.isAllowedOrigin('https://sdocs.dev'), true);
    assert.strictEqual(bridge.isAllowedOrigin('http://localhost:3000'), true);
    assert.strictEqual(bridge.isAllowedOrigin('http://127.0.0.1:8080'), true);
    assert.strictEqual(bridge.isAllowedOrigin('https://evil.example'), false);
    assert.strictEqual(bridge.isAllowedOrigin(''), false);
    assert.strictEqual(bridge.isAllowedOrigin(undefined), false);
  });

  test('resolveAllowedPath: existing file resolves through realpath', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-'));
    const file = path.join(dir, 'a.md');
    fs.writeFileSync(file, 'x');
    const out = bridge.resolveAllowedPath(file);
    assert.strictEqual(fs.realpathSync(file), out);
  });

  test('resolveAllowedPath: missing file in existing dir is acceptable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-'));
    const file = path.join(dir, 'new.md');
    const out = bridge.resolveAllowedPath(file);
    assert.ok(out.endsWith('new.md'));
  });

  test('atomicWrite: writes via tempfile and rename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-'));
    const f = path.join(dir, 'out.md');
    bridge.atomicWrite(f, Buffer.from('hello'));
    assert.strictEqual(fs.readFileSync(f, 'utf-8'), 'hello');
    // No tempfile leftover.
    const leftover = fs.readdirSync(dir).filter(n => n !== 'out.md');
    assert.deepStrictEqual(leftover, []);
  });

  test('encodeFrame: small / medium / large length encoding', () => {
    const a = bridge.encodeFrame(0x1, Buffer.from('hi'));
    assert.strictEqual(a[1] & 0x7F, 2);
    const b = bridge.encodeFrame(0x1, Buffer.alloc(200));
    assert.strictEqual(b[1] & 0x7F, 126);
    const c = bridge.encodeFrame(0x1, Buffer.alloc(70000));
    assert.strictEqual(c[1] & 0x7F, 127);
  });

  test('WsParser: rejects unmasked client frames', () => {
    let err = null;
    const p = new bridge.WsParser({ onError: (e) => { err = e; }, onMessage: () => {} });
    // FIN | text, length 1, no mask, one byte payload.
    p.feed(Buffer.from([0x81, 0x01, 0x61]));
    assert.ok(err && /must be masked/.test(err.message));
  });

  test('WsParser: round-trips a masked text frame', () => {
    let got = null;
    const p = new bridge.WsParser({ onMessage: (op, buf) => { got = buf.toString('utf-8'); } });
    p.feed(maskFrame(0x1, Buffer.from('hello world')));
    assert.strictEqual(got, 'hello world');
  });

  test('WsParser: reassembles fragmented messages', () => {
    let got = null;
    const p = new bridge.WsParser({ onMessage: (op, buf) => { got = buf.toString('utf-8'); } });
    // Two fragments: first text not-FIN, then continuation with FIN.
    const mask1 = crypto.randomBytes(4);
    const a = Buffer.from('foo');
    const am = Buffer.alloc(3);
    for (let i = 0; i < 3; i++) am[i] = a[i] ^ mask1[i & 3];
    p.feed(Buffer.concat([Buffer.from([0x01, 0x83]), mask1, am])); // FIN=0, opcode=text, masked

    const mask2 = crypto.randomBytes(4);
    const b = Buffer.from('bar');
    const bm = Buffer.alloc(3);
    for (let i = 0; i < 3; i++) bm[i] = b[i] ^ mask2[i & 3];
    p.feed(Buffer.concat([Buffer.from([0x80, 0x83]), mask2, bm])); // FIN=1, opcode=continuation, masked

    assert.strictEqual(got, 'foobar');
  });

  // 2. End-to-end through a real bridge.

  t('e2e: handshake -> hello with file content', async () => {
    const f = tmpFile('doc.md', '# hi from disk\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock, head } = await clientHandshake(b.port, b.token);
    assert.ok(head.includes('101 Switching Protocols'));
    const hello = await nextMessage(sock);
    assert.strictEqual(hello.type, 'hello');
    assert.strictEqual(hello.content, '# hi from disk\n');
    assert.strictEqual(hello.file, 'doc.md');
    assert.deepStrictEqual(hello.capabilities, { canSave: true, canWatch: true, canSubmit: false });
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: write message persists file atomically', async () => {
    const f = tmpFile('w.md', 'old\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // consume hello
    sendJson(sock, { type: 'write', id: 'w1', content: 'NEW BODY\n' });
    const ack = await nextMessage(sock);
    assert.strictEqual(ack.type, 'ack');
    assert.strictEqual(ack.for, 'w1');
    assert.strictEqual(fs.readFileSync(f, 'utf-8'), 'NEW BODY\n');
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: external change pushed when file is rewritten on disk', async () => {
    const f = tmpFile('e.md', 'one\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello

    // Simulate an outside writer (an agent, another editor).
    const dir = path.dirname(f);
    const tmp = path.join(dir, '.swap');
    fs.writeFileSync(tmp, 'two\n');
    fs.renameSync(tmp, f);

    const ext = await nextMessage(sock, 6000);
    assert.strictEqual(ext.type, 'external-change');
    assert.strictEqual(ext.content, 'two\n');
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: bridge does not echo its own writes back as external-change', async () => {
    const f = tmpFile('echo.md', 'a\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello

    sendJson(sock, { type: 'write', id: 'w1', content: 'b\n' });
    await nextMessage(sock); // ack
    // Drain pending messages over the next 500ms; assert none were
    // external-change (the bridge must suppress echoes of its own writes).
    await new Promise(r => setTimeout(r, 500));
    const echoed = (sock._queue || []).some(m => m.type === 'external-change');
    assert.strictEqual(echoed, false);
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: bad token is rejected with 401', async () => {
    const f = tmpFile('t.md', '');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { head } = await clientHandshake(b.port, 'WRONG');
    assert.ok(head.includes('401 Unauthorized'));
    b.close();
    await b.awaitTerminal();
  });

  t('e2e: bad origin is rejected with 403', async () => {
    const f = tmpFile('o.md', '');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { head } = await clientHandshake(b.port, b.token, { origin: 'https://evil.example' });
    assert.ok(head.includes('403 Forbidden'));
    b.close();
    await b.awaitTerminal();
  });

  t('e2e: a second concurrent connection is refused with 409', async () => {
    const f = tmpFile('s.md', '');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const c1 = await clientHandshake(b.port, b.token);
    assert.ok(c1.head.includes('101'));
    const c2 = await clientHandshake(b.port, b.token);
    assert.ok(c2.head.includes('409 Conflict'));
    c1.sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: write to a path that escapes the allowlist is refused', async () => {
    // Use a symlink swap: start the bridge against a real file, then swap the
    // file out for a symlink pointing somewhere else. The next write should
    // refuse with EPATH.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-bridge-'));
    const target = path.join(dir, 'doc.md');
    fs.writeFileSync(target, 'a');
    const outside = path.join(dir, 'outside.md');
    fs.writeFileSync(outside, 'outside-untouched');

    const b = await bridge.startBridge({
      files: [target], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello

    // Swap: remove the real file, replace with a symlink to `outside`.
    fs.unlinkSync(target);
    fs.symlinkSync(outside, target);

    sendJson(sock, { type: 'write', id: 'w1', content: 'evil' });
    const reply = await nextMessage(sock);
    assert.strictEqual(reply.type, 'error');
    assert.strictEqual(reply.code, 'EPATH');
    assert.strictEqual(fs.readFileSync(outside, 'utf-8'), 'outside-untouched');
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: feedback mode forwards the agent message in hello', async () => {
    const f = tmpFile('fb.md', 'draft\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'feedback',
      message: 'Satisfied with my change to Q3?',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    const hello = await nextMessage(sock);
    assert.strictEqual(hello.mode, 'feedback');
    assert.strictEqual(hello.message, 'Satisfied with my change to Q3?');
    assert.strictEqual(hello.capabilities.canSubmit, true);
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: open mode hello has canSubmit=false and no message', async () => {
    const f = tmpFile('op.md', 'x\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    const hello = await nextMessage(sock);
    assert.strictEqual(hello.mode, 'open');
    assert.strictEqual(hello.capabilities.canSubmit, false);
    assert.strictEqual(hello.message, null);
    sock.destroy();
    await b.awaitTerminal();
  });

  t('e2e: hello carries fullPath (and a relative path when the file is under cwd)', async () => {
    const f = tmpFile('paths.md', '');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    const hello = await nextMessage(sock);
    // The bridge resolves through realpath at startup — on macOS that turns
    // /var/folders into /private/var/folders. Compare against the realpath.
    assert.strictEqual(hello.fullPath, fs.realpathSync(f));
    // tmpFile() resolves outside CWD on most systems, so `path` is null.
    // The relative-path branch is covered by the e2e Playwright test.
    assert.ok(hello.path === null || (typeof hello.path === 'string' && hello.path.startsWith('./')));
    sock.destroy();
    await b.awaitTerminal();
  });

  // 3. feedback exit semantics.

  t('feedback: submit terminates with kind=submit / code=0', async () => {
    const f = tmpFile('c.md', 'draft\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'feedback',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello
    sendJson(sock, { type: 'submit', id: 's1', content: 'final\n' });
    const term = await b.awaitTerminal();
    assert.strictEqual(term.kind, 'submit');
    assert.strictEqual(term.code, 0);
    assert.strictEqual(fs.readFileSync(f, 'utf-8'), 'final\n');
    try { sock.destroy(); } catch (_) {}
  });

  t('feedback: close-without-submit terminates with kind=cancel / code=2', async () => {
    const f = tmpFile('cx.md', 'draft\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'feedback',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello
    sendJson(sock, { type: 'close' });
    const term = await b.awaitTerminal();
    assert.strictEqual(term.kind, 'cancel');
    assert.strictEqual(term.code, 2);
    try { sock.destroy(); } catch (_) {}
  });

  t('feedback: no browser connect within deadline -> code=3', async () => {
    const f = tmpFile('nc.md', '');
    const b = await bridge.startBridge({
      files: [f], mode: 'feedback',
      noConnectTimeoutMs: 200, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
    const term = await b.awaitTerminal();
    assert.strictEqual(term.kind, 'no-connect');
    assert.strictEqual(term.code, 3);
  });

  // 4. Reload survival.

  t('reload survival: a fresh connection within the grace window resumes the session', async () => {
    const f = tmpFile('rs.md', 'one\n');
    const b = await bridge.startBridge({
      files: [f], mode: 'open',
      noConnectTimeoutMs: 5000, reconnectGraceMs: 500, idleTimeoutMs: 0,
    });
    const { sock } = await clientHandshake(b.port, b.token);
    await nextMessage(sock); // hello

    // Drop the socket as a page-reload would.
    sock.destroy();
    // Within the grace window, the bridge is still running. Reconnect.
    await new Promise(r => setTimeout(r, 100));
    const c2 = await clientHandshake(b.port, b.token);
    assert.ok(c2.head.includes('101'));
    const hello2 = await nextMessage(c2.sock);
    assert.strictEqual(hello2.type, 'hello');
    c2.sock.destroy();
    await b.awaitTerminal();
  });

  // Return an async runner so the orchestrator can await completion before
  // calling report(). Tests run sequentially: each one binds its own port +
  // creates its own tempdir, but we keep them serial for clearer failure
  // attribution.
  return async function runBridge() {
    for (const [name, fn] of asyncTests) {
      await testAsync(name, fn);
    }
  };
};
