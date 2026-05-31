// Local Bridge: lets the sdocs.dev page read and write files on the user's
// own machine. Started by `sdoc watch | edit | compose --wait`.
//
// Shape of a session:
//   - One bridge per `sdoc` invocation.
//   - Binds to 127.0.0.1 on a kernel-picked port (`--port 0`).
//   - Per-session 32-byte random token in the URL fragment.
//   - At most one live WebSocket connection.
//   - Path allowlist of files the caller passed, resolved via fs.realpath at
//     startup and re-checked on every write so a swapped symlink can't escape.
//   - Atomic writes (write to a tempfile in the same directory, then rename).
//   - Parent-directory watch (not file-watch) filtered by filename, with a
//     stat-poll backstop. The same disk content hash is compared on every
//     event so the bridge's own writes don't get echoed back as external
//     changes, and timestamp-equal-but-different writes are still caught.
//   - On WebSocket drop, wait `RECONNECT_GRACE_MS` for a reconnect with the
//     same token before treating the session as ended (chunk 2 reload survival).
//
// Hand-rolled WebSocket framing because the CLI package has zero runtime deps.
// We only need: handshake, text frames (incl. fragmentation), ping, pong, close.

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const FormBlock = require('../shared/sdocs-form-block.js');

// ── Constants ─────────────────────────────────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const RECONNECT_GRACE_MS    = 8000;     // wait this long for a reconnect after drop
                                        // (covers refresh + service-worker dance)
const STAT_POLL_MS          = 3000;     // stat-poll backstop (fs.watch coalesces)
const WATCH_DEBOUNCE_MS     = 50;       // collapse rapid fs.watch bursts
const NO_CONNECT_TIMEOUT_MS = 30000;    // exit if the browser never connects
const IDLE_TIMEOUT_MS       = 0;        // 0 = off. Background-throttled tabs
                                        // otherwise stall pings and trip this.
const MAX_MESSAGE_BYTES     = 20 * 1024 * 1024;
const ALLOWED_ROOT = 'smalldocs.org';
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];

// ── Helpers ───────────────────────────────────────────────

function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Origin pin: parse the header as a URL and compare structured fields. A
// string-suffix check would let through smalldocs.org.attacker.com; the
// hostname-equality + leading-dot subdomain check below does not.
function isAllowedOrigin(origin, extra) {
  if (!origin) return false;
  let u;
  try { u = new URL(origin); } catch (_) { return false; }
  // Origin headers carry no path / search / hash. Reject anything weird that
  // still parses (some browsers will tolerate junk).
  if (u.pathname && u.pathname !== '/') return false;
  if (u.search || u.hash) return false;
  const host = u.hostname.toLowerCase();
  // Production: HTTPS only, exact root or any subdomain. The leading dot in
  // the suffix is what closes smalldocs.org.attacker.com style footguns.
  if (u.protocol === 'https:') {
    if (host === ALLOWED_ROOT) return true;
    if (host.endsWith('.' + ALLOWED_ROOT)) return true;
  }
  // Loopback (dev + tests): page on localhost talks to a loopback bridge.
  if ((u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.indexOf(host) >= 0) {
    return true;
  }
  // CLI escape hatch: exact-string allowlist passed via `--allowed-origin`.
  if (extra && extra.indexOf(origin) >= 0) return true;
  return false;
}

// Host header check: blocks DNS-rebinding. The browser sends whatever
// hostname it used to reach us in the Host header; if that isn't a loopback
// hostname on our exact bound port, the request didn't legitimately come
// from a local page.
function isAllowedHost(hostHeader, boundPort) {
  if (!hostHeader || boundPort == null) return false;
  const m = /^([^:]+)(?::(\d+))?$/.exec(String(hostHeader).trim());
  if (!m) return false;
  const host = m[1].toLowerCase();
  const port = m[2] ? parseInt(m[2], 10) : null;
  if (port !== boundPort) return false;
  return LOOPBACK_HOSTS.indexOf(host) >= 0;
}

// Resolve a path through realpath. For files that don't exist yet, realpath
// the parent directory (which must exist) and append the basename so a later
// rename of the parent can't shift us out of the allowlist.
function resolveAllowedPath(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) {
    return fs.realpathSync(abs);
  }
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) {
    throw new Error('directory does not exist: ' + dir);
  }
  return path.join(fs.realpathSync(dir), path.basename(abs));
}

// Open the allowlisted file read-only and capture (dev, ino) so we can
// confirm it's still the same file at every write. O_NOFOLLOW where
// supported so a symlink replacement at the resolved path can't grab a
// handle to whatever the symlink points at. The fd is held purely as an
// identity anchor; writes still go through the tmp+rename path.
function openIdentity(filepath) {
  let flags = fs.constants.O_RDONLY;
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW;
  let fd;
  try { fd = fs.openSync(filepath, flags); }
  catch (_) { return null; }
  let stat;
  try { stat = fs.fstatSync(fd); }
  catch (_) {
    try { fs.closeSync(fd); } catch (_) {}
    return null;
  }
  return { fd: fd, dev: stat.dev, ino: stat.ino };
}

function closeIdentity(id) {
  if (!id) return;
  try { fs.closeSync(id.fd); } catch (_) {}
}

// Stat the resolved path and compare (dev, ino) to a captured identity.
// True only when the file on disk is the exact inode we opened.
function sameIdentity(resolvedPath, id) {
  if (!id) return false;
  let st;
  try { st = fs.lstatSync(resolvedPath); }
  catch (_) { return false; }
  return st.dev === id.dev && st.ino === id.ino;
}

// Atomic write inside the same directory, then rename. The temp filename is
// hidden (dot-prefixed) so editors that scan the directory don't pick it up.
function atomicWrite(target, content) {
  const dir = path.dirname(target);
  const tmp = path.join(
    dir,
    '.' + path.basename(target) + '.sdocs-tmp-' + crypto.randomBytes(6).toString('hex')
  );
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// ── WebSocket framing (RFC 6455, server side) ─────────────

class WsParser {
  constructor(opts) {
    opts = opts || {};
    this.onMessage = opts.onMessage;
    this.onClose   = opts.onClose;
    this.onPing    = opts.onPing;
    this.onPong    = opts.onPong;
    this.onError   = opts.onError;
    this.maxBytes  = opts.maxBytes || MAX_MESSAGE_BYTES;
    // RFC 6455: client-to-server frames MUST be masked, server-to-client
    // frames MUST NOT be masked. Defaults to the server-side rule because
    // that's what the bridge needs in production. Set false in tests that
    // are parsing the bridge's own outbound frames.
    this.expectMasked = opts.expectMasked !== false;
    this._buf  = Buffer.alloc(0);
    this._frag = null;
    this._dead = false;
  }

  feed(chunk) {
    if (this._dead) return;
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);
    while (this._tryFrame()) {}
  }

  _tryFrame() {
    const b = this._buf;
    if (b.length < 2) return false;
    const fin    = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0F;
    const masked = (b[1] & 0x80) !== 0;
    let len      = b[1] & 0x7F;
    let off = 2;

    if (len === 126) {
      if (b.length < off + 2) return false;
      len = b.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return false;
      const hi = b.readUInt32BE(off);
      const lo = b.readUInt32BE(off + 4);
      if (hi !== 0) return this._fatal('frame exceeds 32-bit length');
      len = lo;
      off += 8;
    }
    if (this.expectMasked && !masked) return this._fatal('client frame must be masked');
    if (len > this.maxBytes)          return this._fatal('frame exceeds size cap');
    if (b.length < off + (masked ? 4 : 0) + len) return false;

    let data;
    if (masked) {
      const mask = b.slice(off, off + 4);
      off += 4;
      data = Buffer.alloc(len);
      for (let i = 0; i < len; i++) data[i] = b[off + i] ^ mask[i & 3];
    } else {
      data = b.slice(off, off + len);
    }
    this._buf = b.slice(off + len);

    if (opcode === 0x8) { this._dead = true; this.onClose && this.onClose(data); return false; }
    if (opcode === 0x9) { this.onPing && this.onPing(data); return true; }
    if (opcode === 0xA) { this.onPong && this.onPong(data); return true; }

    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (opcode === 0x0) {
        if (!this._frag) return this._fatal('continuation with no start frame');
        this._frag.chunks.push(data);
        this._frag.length += data.length;
        if (this._frag.length > this.maxBytes) return this._fatal('fragmented message exceeds size cap');
      } else {
        if (this._frag) return this._fatal('new data frame during fragmentation');
        this._frag = { opcode, chunks: [data], length: data.length };
      }
      if (fin) {
        const f = this._frag;
        this._frag = null;
        const full = f.chunks.length === 1 ? f.chunks[0] : Buffer.concat(f.chunks, f.length);
        this.onMessage && this.onMessage(f.opcode, full);
      }
      return true;
    }

    return this._fatal('unknown opcode 0x' + opcode.toString(16));
  }

  _fatal(msg) {
    this._dead = true;
    this.onError && this.onError(new Error(msg));
    return false;
  }
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

function wsSend(socket, opcode, payload) {
  if (!socket || socket.destroyed || !socket.writable) return;
  try { socket.write(encodeFrame(opcode, payload)); } catch (_) {}
}

function wsSendJson(socket, obj) {
  wsSend(socket, 0x1, Buffer.from(JSON.stringify(obj), 'utf-8'));
}

function wsSendClose(socket, code, reason) {
  if (!socket || socket.destroyed) return;
  const body = Buffer.alloc(2);
  body.writeUInt16BE(code || 1000, 0);
  const payload = reason ? Buffer.concat([body, Buffer.from(reason, 'utf-8')]) : body;
  wsSend(socket, 0x8, payload);
  try { socket.end(); } catch (_) {}
}

// ── File watching ─────────────────────────────────────────

// Watch the parent directory filtered by filename. The watcher is the fast
// path; the stat-poll is the backstop fs.watch coalescing eats. Either path
// re-reads the file and hash-compares, so the bridge's own writes can be
// suppressed without timestamp games.
function startWatch(filepath, getKnownHash, onExternal) {
  const dir   = path.dirname(filepath);
  const base  = path.basename(filepath);
  let stopped = false;
  let scheduled = false;

  function check() {
    if (stopped) return;
    scheduled = false;
    let content;
    try {
      content = fs.readFileSync(filepath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        if (getKnownHash() !== null) onExternal({ deleted: true });
      }
      return;
    }
    const h = hashContent(content);
    if (h === getKnownHash()) return;
    onExternal({ content, hash: h });
  }

  function trigger() {
    if (stopped || scheduled) return;
    scheduled = true;
    setTimeout(check, WATCH_DEBOUNCE_MS);
  }

  let watcher = null;
  try {
    watcher = fs.watch(dir, (_eventType, filename) => {
      // On some platforms `filename` is null; trigger anyway and let the hash
      // compare decide. When it's present, filter by our basename.
      if (filename && filename !== base) return;
      trigger();
    });
    watcher.on('error', () => { /* keep the stat-poll backstop running */ });
  } catch (_) { /* same */ }

  const interval = setInterval(check, STAT_POLL_MS);

  return function stop() {
    stopped = true;
    if (watcher) { try { watcher.close(); } catch (_) {} }
    clearInterval(interval);
  };
}

// ── Bridge ────────────────────────────────────────────────

// startBridge returns a Promise<Bridge>. Bridge shape:
//   {
//     port, token, mode, files,
//     close(),                      // shuts everything down
//     onSubmit(cb), onClose(cb), onConnect(cb),
//     awaitTerminal()               // resolves to { kind, code, ... } when
//                                   // the session ends (submit / close /
//                                   // no-connect / error).
//   }
function startBridge(opts) {
  opts = opts || {};
  if (!Array.isArray(opts.files) || opts.files.length === 0) {
    throw new Error('startBridge: opts.files (array of paths) is required');
  }
  // Two session shapes:
  //   - 'open':     standard connected-to-disk. Tab close exits 0.
  //   - 'feedback': agent handoff. Done returns 0, close-without-Done returns
  //                 2. An optional `opts.message` is sent to the browser and
  //                 rendered as a banner above the document.
  const mode = opts.mode || 'open';
  if (['open', 'feedback'].indexOf(mode) < 0) {
    throw new Error('startBridge: mode must be open | feedback');
  }
  const message = typeof opts.message === 'string' ? opts.message : null;
  // keepOpen=true keeps the bridge alive across non-final submits, so
  // an agent can write more state into the file and the user can keep
  // answering without re-launching the CLI.
  const keepOpen = !!opts.keepOpen;

  // Event sinks for "user clicked a submit button". Stdout receives a
  // JSON line per submit so agents can tail the process. logFile receives
  // the same line appended to a named file, for harnesses that can't
  // stream a background process's stdout but can read a file. onEvent is
  // an in-process callback used by tests.
  const eventLogFile = typeof opts.logFile === 'string' && opts.logFile ? opts.logFile : null;
  if (eventLogFile) {
    // Fail-fast: confirm we can append to the path before the browser
    // ever sees the form, so the user doesn't fill in a form and then
    // discover the events have nowhere to land.
    try {
      fs.appendFileSync(eventLogFile, '');
    } catch (e) {
      throw new Error('startBridge: --log-file is not writable: ' + e.message);
    }
  }
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  // Every successful submit emits at minimum one JSON line on stdout.
  // In single-shot mode the process exits right after, so the agent
  // reads stdout once and is done — no tailing, no log file required.
  // --keep-open keeps the bridge alive across many submits; the agent
  // tails stdout to react per click.

  const token   = opts.token   || crypto.randomBytes(32).toString('base64url');
  const port    = opts.port    || 0;
  const extra   = opts.allowedOrigins || [];
  const idleMs  = opts.idleTimeoutMs != null ? opts.idleTimeoutMs : IDLE_TIMEOUT_MS;
  const noConnMs = opts.noConnectTimeoutMs != null ? opts.noConnectTimeoutMs : NO_CONNECT_TIMEOUT_MS;
  const reconnectMs = opts.reconnectGraceMs != null ? opts.reconnectGraceMs : RECONNECT_GRACE_MS;

  const allowlist = opts.files.map(resolveAllowedPath);
  if (new Set(allowlist).size !== allowlist.length) {
    throw new Error('startBridge: duplicate files in allowlist');
  }
  // v1 ships single-file sessions; the array shape leaves room for multi-file.
  const filepath = allowlist[0];

  const state = { content: Buffer.alloc(0), hash: null };
  // Identity anchor: (dev, ino) of the file we were authorized to touch.
  // Mutated when the watcher detects a legitimate external save or after
  // our own atomic rename (rename always changes the inode by design).
  // Null until the file first exists on disk (compose mode).
  let identity = null;
  if (fs.existsSync(filepath)) {
    state.content = fs.readFileSync(filepath);
    state.hash    = hashContent(state.content);
    identity      = openIdentity(filepath);
  }

  // Subscribers — the CLI listens to onSubmit/onClose/onConnect to decide
  // whether to exit 0 (submit) or non-zero (cancel / no-connect).
  const subs = { submit: [], close: [], connect: [], external: [] };
  function emit(kind, payload) {
    (subs[kind] || []).forEach(fn => { try { fn(payload); } catch (_) {} });
  }

  let socket    = null;
  let parser    = null;
  let everConnected = false;
  let reconnectTimer = null;
  let noConnectTimer = null;
  let idleTimer      = null;
  let terminated = false;
  let terminal   = null;
  let watchStop  = null;
  const terminalWaiters = [];

  function clearAllTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (noConnectTimer) { clearTimeout(noConnectTimer); noConnectTimer = null; }
    if (idleTimer)      { clearTimeout(idleTimer);      idleTimer      = null; }
  }
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(() => terminate({ kind: 'idle', code: 4 }), idleMs);
  }

  function terminate(t) {
    if (terminated) return;
    terminated = true;
    terminal = t;
    clearAllTimers();
    if (watchStop) { try { watchStop(); } catch (_) {} watchStop = null; }
    closeIdentity(identity);
    identity = null;
    if (socket && !socket.destroyed) {
      wsSendClose(socket, 1000, '');
      try { socket.destroy(); } catch (_) {}
    }
    try { server.close(); } catch (_) {}
    emit(t.kind, t);
    terminalWaiters.splice(0).forEach(fn => fn(t));
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString('utf-8')); }
    catch (_) { return wsSendJson(socket, { type: 'error', code: 'EBADJSON', message: 'invalid JSON' }); }
    if (!msg || typeof msg.type !== 'string') return;
    bumpIdle();

    if (msg.type === 'ping') {
      wsSendJson(socket, { type: 'pong' });
      return;
    }
    if (msg.type === 'pong') return;

    // Read a file the document references (e.g. a {{report.csv}} cells block),
    // for display only. Resolved relative to the document's folder; absolute
    // paths are honoured as-is. No folder restriction by design - the gate is
    // this authenticated, localhost-only socket. This never touches the
    // document's own content/sync, so it can't affect what gets saved back.
    if (msg.type === 'read-file') {
      const rid = msg.id;
      const rel = typeof msg.path === 'string' ? msg.path : '';
      try {
        const target = path.resolve(path.dirname(filepath), rel);
        const content = fs.readFileSync(target, 'utf-8');
        wsSendJson(socket, { type: 'file', id: rid, ok: true, path: rel, content: content });
      } catch (e) {
        wsSendJson(socket, {
          type: 'file', id: rid, ok: false,
          error: (e && e.code === 'ENOENT') ? 'not found' : ((e && e.message) || 'read failed'),
        });
      }
      return;
    }

    if (msg.type === 'write' || msg.type === 'submit') {
      const body = typeof msg.content === 'string' ? msg.content : '';
      const buf  = Buffer.from(body, 'utf-8');
      // Re-resolve through realpath every write to defeat a symlink swap.
      let resolved;
      try { resolved = resolveAllowedPath(filepath); }
      catch (e) {
        wsSendJson(socket, { type: 'error', code: 'EPATH', message: e.message, id: msg.id });
        return;
      }
      if (resolved !== filepath) {
        wsSendJson(socket, { type: 'error', code: 'EPATH', message: 'path now resolves outside the allowlist', id: msg.id });
        return;
      }
      // Identity gate: realpath catches symlink swaps; this catches the
      // in-place inode swap (unlink + recreate at the same path).
      if (identity && !sameIdentity(filepath, identity)) {
        wsSendJson(socket, { type: 'error', code: 'EPATH', message: 'file identity changed since session start', id: msg.id });
        return;
      }
      try {
        state.hash = hashContent(buf);   // set before rename: the watcher will
        state.content = buf;             // see our own write and suppress it
        atomicWrite(filepath, buf);
      } catch (e) {
        wsSendJson(socket, { type: 'error', code: e.code || 'EWRITE', message: e.message, id: msg.id });
        return;
      }
      // Atomic rename always changes the inode. Recapture so the next write
      // compares against fresh identity, not the orphaned one.
      closeIdentity(identity);
      identity = openIdentity(filepath);
      if (msg.id) wsSendJson(socket, { type: 'ack', for: msg.id });

      if (msg.type === 'submit') {
        wsSendJson(socket, { type: 'submitted' });
        terminate({ kind: 'submit', code: 0 });
      }
      return;
    }

    if (msg.type === 'submitForm') {
      handleFormSubmit(msg);
      return;
    }

    if (msg.type === 'close') {
      // Tab is closing intentionally. No reconnect grace — exit immediately
      // with the right code for our mode.
      const t = (mode === 'feedback')
        ? { kind: 'cancel', code: 2 }
        : { kind: 'close',  code: 0 };
      terminate(t);
      return;
    }

    // Unknown types are ignored.
  }

  // Handle a `submitForm` message from the browser. The flow:
  //   1. Re-read the file from disk (the file is the source of truth,
  //      not anything we have in memory).
  //   2. Find the named form block, recompute its revision token.
  //   3. If the token doesn't match what the browser submitted, the
  //      schema has changed under the user's hands. Reject with
  //      `form-stale`; the next external-change push will refresh
  //      their view to the new schema.
  //   4. Apply the user's values (scoped) and append a submission
  //      entry. Re-serialise the block and splice it back into the
  //      document.
  //   5. Verify boundary stability: the only bytes that may differ
  //      between pre and post are inside the fenced region.
  //   6. Atomic-write the file.
  //   7. Ack to the browser. If the button was final or the CLI was
  //      not started with keepOpen, terminate.
  function handleFormSubmit(msg) {
    const formId = typeof msg.form_id === 'string' ? msg.form_id : '';
    const buttonName = typeof msg.button_name === 'string' ? msg.button_name : '';
    const values = (msg.values && typeof msg.values === 'object') ? msg.values : {};
    const scope = Array.isArray(msg.scope) ? msg.scope : [];
    const submittedToken = typeof msg.token === 'string' ? msg.token : '';
    const final = !!msg.final;

    if (!formId || !buttonName) {
      return wsSendJson(socket, { type: 'error', code: 'EBADFORM', message: 'missing form_id or button_name' });
    }

    // Fresh disk re-read.
    let diskBuf;
    try { diskBuf = fs.readFileSync(filepath); }
    catch (e) {
      return wsSendJson(socket, { type: 'error', code: 'EREAD', message: e.message });
    }
    const docText = diskBuf.toString('utf-8');

    const blocks = FormBlock.findFormBlocks(docText);
    const target = blocks.find(b => b.id === formId);
    if (!target) {
      return wsSendJson(socket, { type: 'error', code: 'EFORM_MISSING', message: 'no form with id ' + formId });
    }
    if (target.error || !target.parsed) {
      return wsSendJson(socket, { type: 'error', code: 'EFORM_PARSE', message: target.error || 'unparseable form' });
    }

    const currentToken = FormBlock.formRevisionToken(target.parsed.fields, target.parsed.buttons);
    if (currentToken !== submittedToken) {
      return wsSendJson(socket, { type: 'form-stale', form_id: formId, expected: currentToken, got: submittedToken });
    }

    // Apply the submit: merge in-scope values, append submission entry.
    const next = {
      id: target.parsed.id,
      fields: target.parsed.fields,
      buttons: target.parsed.buttons,
      answers: Object.assign({}, target.parsed.answers || {}),
      submissions: (target.parsed.submissions || []).slice(),
    };
    Object.keys(values).forEach(k => {
      // Defence in depth: only apply values for fields that exist in
      // the schema. The browser-side renderer already enforces this
      // but a misbehaving client shouldn't be able to smuggle keys.
      if (next.fields.some(f => f.name === k)) {
        next.answers[k] = values[k];
      }
    });
    next.submissions.push({
      by: buttonName,
      at: new Date().toISOString(),
      scope: scope.length ? scope : next.fields.map(f => f.name),
      values: scopedValuesOnly(values, next.fields.map(f => f.name)),
    });

    const spliced = FormBlock.spliceFormBlock(docText, target, next);
    if (spliced.error) {
      return wsSendJson(socket, { type: 'error', code: 'EFORM_SPLICE', message: spliced.error });
    }
    const newDoc = spliced.doc;

    // Boundary stability: same start byte; bytes outside [start, newEnd]
    // identical to bytes outside [start, end] in the original.
    const pre  = docText.slice(0, target.startByte);
    const post = docText.slice(target.endByte);
    const newPre  = newDoc.slice(0, spliced.startByte);
    const newPost = newDoc.slice(spliced.endByte);
    if (pre !== newPre || post !== newPost) {
      return wsSendJson(socket, { type: 'error', code: 'EFORM_BOUNDARY', message: 'form write would shift surrounding bytes' });
    }

    // Belt + braces: re-parse and confirm the block still parses and
    // its id is unchanged. A serializer that produced subtly invalid
    // YAML would slip through the boundary check.
    const reBlocks = FormBlock.findFormBlocks(newDoc);
    const reTarget = reBlocks.find(b => b.id === formId);
    if (!reTarget || reTarget.error) {
      return wsSendJson(socket, { type: 'error', code: 'EFORM_REPARSE', message: 'spliced form failed to re-parse' });
    }

    // Identity gate before writing (same as the write/submit handler).
    if (identity && !sameIdentity(filepath, identity)) {
      return wsSendJson(socket, { type: 'error', code: 'EPATH', message: 'file identity changed since session start' });
    }
    // Atomic write. The watcher will see the change, hash will match
    // what we just wrote, no echo.
    const buf = Buffer.from(newDoc, 'utf-8');
    try {
      state.hash = hashContent(buf);
      state.content = buf;
      atomicWrite(filepath, buf);
    } catch (e) {
      return wsSendJson(socket, { type: 'error', code: e.code || 'EWRITE', message: e.message });
    }
    closeIdentity(identity);
    identity = openIdentity(filepath);

    wsSendJson(socket, {
      type: 'form-submitted',
      form_id: formId,
      button_name: buttonName,
      final: final,
    });

    // Emit one event per successful submit. Agents reading the process's
    // stdout (Claude Code, Codex, etc.) get a clean trigger; weak-shell
    // harnesses can read --log-file instead.
    const lastSubmission = next.submissions[next.submissions.length - 1];
    emitSubmitEvent({
      event:   'submit',
      form_id: formId,
      by:      buttonName,
      at:      lastSubmission.at,
      scope:   lastSubmission.scope,
      values:  lastSubmission.values,
      final:   final,
    });

    if (final || !keepOpen) {
      wsSendJson(socket, { type: 'submitted' });
      terminate({ kind: 'submit', code: 0 });
    }
  }

  function emitSubmitEvent(ev) {
    const line = JSON.stringify(ev) + '\n';
    // Always write to stdout. In single-shot mode this lands right
    // before exit, so the agent reads its full output once the process
    // is done. In --keep-open mode each click writes another line and
    // the agent tails. Startup chatter is on stderr so stdout is a
    // clean event channel either way.
    try { process.stdout.write(line); } catch (_) {}
    if (eventLogFile) {
      try { fs.appendFileSync(eventLogFile, line); } catch (_) {}
    }
    if (onEvent) {
      try { onEvent(ev); } catch (_) {}
    }
  }

  function scopedValuesOnly(values, allowed) {
    const out = {};
    Object.keys(values).forEach(k => {
      if (allowed.indexOf(k) >= 0) out[k] = values[k];
    });
    return out;
  }

  function pushExternal(change) {
    if (!socket) return;
    if (change.deleted) {
      wsSendJson(socket, { type: 'error', code: 'ENOENT', message: 'file was deleted' });
      return;
    }
    state.content = change.content;
    state.hash    = change.hash;
    wsSendJson(socket, {
      type: 'external-change',
      content: change.content.toString('utf-8'),
      file: path.basename(filepath),
    });
  }

  function attachSocket(sock) {
    socket = sock;
    everConnected = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (noConnectTimer) { clearTimeout(noConnectTimer); noConnectTimer = null; }
    bumpIdle();

    parser = new WsParser({
      onMessage: (_op, payload) => handleMessage(payload),
      onPing:    (d) => wsSend(sock, 0xA, d),
      onPong:    () => bumpIdle(),
      onClose:   () => detachSocket('peer-close'),
      onError:   () => detachSocket('parser-error'),
    });
    sock.on('data',  (chunk) => parser.feed(chunk));
    sock.on('error', () => detachSocket('socket-error'));
    sock.on('end',   () => detachSocket('socket-end'));
    sock.on('close', () => detachSocket('socket-close'));

    // Initial hello with the current file content. `message` is the agent's
    // free-text prompt for feedback sessions; the browser renders it as a
    // banner above the document. `null` outside feedback mode.
    //
    // `path` + `fullPath` mirror the legacy &local= URL fragment that the
    // non-bridged `sdoc <file>` flow used to populate. They feed the
    // "Rel. Path" / "Abs. Path" rows on the file-info card. Both are derived
    // here (process.cwd is the CLI's working dir) so the browser never has
    // to know about the user's filesystem layout.
    const relFromCwd = path.relative(process.cwd(), filepath);
    const localPath = (!relFromCwd.startsWith('..') && !path.isAbsolute(relFromCwd))
      ? './' + relFromCwd
      : null;
    wsSendJson(sock, {
      type: 'hello',
      file: path.basename(filepath),
      content: state.content.toString('utf-8'),
      mode,
      message,
      path: localPath,
      fullPath: filepath,
      capabilities: capsForMode(mode),
    });
    emit('connect', { firstTime: subs.connect.length === 0 || !subs._everEmitted });
    // Mark first connect so reconnects don't re-emit "first" semantics if a
    // caller cares.
    subs._everEmitted = true;
  }

  function detachSocket(_reason) {
    if (!socket) return;
    const s = socket;
    socket = null;
    parser = null;
    try { s.destroy(); } catch (_) {}
    if (terminated) return;

    // Reload survival: wait for the same token to reconnect before exiting.
    if (reconnectMs > 0) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        const t = (mode === 'feedback')
          ? { kind: 'cancel', code: 2 }
          : { kind: 'close',  code: 0 };
        terminate(t);
      }, reconnectMs);
    } else {
      const t = (mode === 'feedback')
        ? { kind: 'cancel', code: 2 }
        : { kind: 'close',  code: 0 };
      terminate(t);
    }
  }

  // ── HTTP + Upgrade ─────────────────────────────────────
  const server = http.createServer((req, res) => {
    // The bridge has no plain HTTP endpoints. Anything that isn't a WS
    // upgrade gets 404.
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('bridge: not found');
  });

  server.on('upgrade', (req, sock, head) => {
    if (terminated) {
      sock.write('HTTP/1.1 410 Gone\r\n\r\n');
      try { sock.destroy(); } catch (_) {}
      return;
    }
    const reject = (status, msg) => {
      sock.write('HTTP/1.1 ' + status + '\r\nContent-Type: text/plain\r\nContent-Length: ' + Buffer.byteLength(msg) + '\r\n\r\n' + msg);
      try { sock.destroy(); } catch (_) {}
    };

    // Origin pin: rejects other websites and other origins on this machine.
    const origin = req.headers['origin'];
    if (!isAllowedOrigin(origin, extra)) {
      return reject('403 Forbidden', 'bridge: origin not allowed');
    }
    // Host header: blocks DNS-rebinding. The request must claim it's talking
    // to our exact loopback host + bound port.
    const addr = server.address();
    const boundPort = addr ? addr.port : null;
    if (!isAllowedHost(req.headers['host'], boundPort)) {
      return reject('403 Forbidden', 'bridge: host not allowed');
    }
    // Token gate: 32-byte session secret in the query string.
    const url = new URL(req.url, 'http://127.0.0.1');
    const got = url.searchParams.get('token');
    if (!got || got.length !== token.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token))) {
      return reject('401 Unauthorized', 'bridge: bad token');
    }
    // Single live connection per bridge.
    if (socket) {
      return reject('409 Conflict', 'bridge: already connected');
    }
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (!key || version !== '13') {
      return reject('400 Bad Request', 'bridge: bad WS handshake');
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accept,
      '', '',
    ];
    sock.write(lines.join('\r\n'));
    sock.setNoDelay(true);
    attachSocket(sock);
  });

  // ── Listen ─────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      // Start watching now — the agent or another editor may write before the
      // browser connects, and we want the hello message to carry fresh content.
      // opts.watch === false skips the watcher entirely. Test escape hatch
      // so tests can exercise the identity gate without racing the debounce.
      if (opts.watch !== false) {
        watchStop = startWatch(filepath, () => state.hash, (change) => {
          if (change.deleted) {
            if (socket) pushExternal(change);
            state.content = Buffer.alloc(0);
            state.hash = hashContent(state.content);
            closeIdentity(identity);
            identity = null;
            return;
          }
          state.content = change.content;
          state.hash    = change.hash;
          // External editors (vim's backupcopy, JetBrains, etc.) commonly
          // change the inode on save. Recapture so the user's next write
          // doesn't trip the identity gate on a legitimate edit.
          closeIdentity(identity);
          identity = openIdentity(filepath);
          if (socket) pushExternal(change);
        });
      }

      if (noConnMs > 0) {
        noConnectTimer = setTimeout(() => {
          if (!everConnected) terminate({ kind: 'no-connect', code: 3 });
        }, noConnMs);
      }

      resolve({
        port: addr.port,
        token,
        mode,
        files: allowlist.slice(),
        close() { terminate({ kind: 'close', code: 0 }); },
        on(kind, cb) { (subs[kind] = subs[kind] || []).push(cb); return this; },
        onSubmit(cb)  { this.on('submit',  cb); return this; },
        onClose(cb)   { this.on('close',   cb); return this; },
        onCancel(cb)  { this.on('cancel',  cb); return this; },
        onConnect(cb) { this.on('connect', cb); return this; },
        awaitTerminal() {
          if (terminal) return Promise.resolve(terminal);
          return new Promise(res => terminalWaiters.push(res));
        },
      });
    });
  });
}

function capsForMode(mode) {
  // The browser never gets a server-enforced read-only mode in this model.
  // Both 'open' and 'feedback' can save; 'feedback' additionally exposes the
  // Done button (canSubmit).
  return {
    canSave:   true,
    canWatch:  true,
    canSubmit: mode === 'feedback',
  };
}

// ── Exports ───────────────────────────────────────────────

module.exports = {
  startBridge,
  // Exposed for tests:
  WsParser,
  encodeFrame,
  hashContent,
  isAllowedOrigin,
  isAllowedHost,
  resolveAllowedPath,
  atomicWrite,
  capsForMode,
  WS_GUID,
};
