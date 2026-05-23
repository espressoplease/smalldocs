// Browser-side Bridge client.
//
// Pairs with the local Bridge process the CLI spawns (cli/bin/sdocs-bridge.js).
// Self-registers as a document Source whose `matches()` fires when the URL
// fragment carries `#bridge=127.0.0.1:NNNN&token=...`. Once selected, it:
//
//   - opens a WebSocket to the local bridge,
//   - waits for the bridge's `hello`, loads the file content into the editor,
//   - in edit / compose mode, autosaves on every change (debounced),
//   - in compose mode, shows a Done button that sends `submit`,
//   - swallows the bridge's `external-change` push, auto-applying it when the
//     user has nothing unsaved and showing a banner otherwise.
//
// Registration must run before sdocs-app.js's catch-all `fragment` source so
// the bridge wins for `#bridge=...` URLs. The script tag is positioned for
// this in index.html.

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var S = window.SDocs;
  if (!S || !S.Sources) {
    // sdocs-source.js must have loaded first. Without it the bridge can't
    // register, so fail quietly — the page will fall back to fragment loading.
    return;
  }

  // ── Hash parsing ─────────────────────────────────────────

  function paramsFromHash(hash) {
    if (typeof hash !== 'string') return null;
    var h = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (h.indexOf('bridge=') < 0) return null;
    var p;
    try { p = new URLSearchParams(h); }
    catch (_) { return null; }
    var addr = p.get('bridge');
    if (!addr) return null;
    // Only loopback addresses are permitted. The CLI builds these URLs
    // itself, but a hostile sdocs.dev shouldn't be able to coax the page
    // into talking to an arbitrary host.
    if (!/^127\.0\.0\.1:\d+$/.test(addr) && !/^localhost:\d+$/i.test(addr)) {
      return null;
    }
    return {
      addr:  addr,
      token: p.get('token') || '',
      file:  p.get('file')  || null,
    };
  }

  // ── Session stash (refresh survival) ─────────────────────
  //
  // We strip bridge=/token= from the URL on hello to keep the token out of
  // history, screenshots, and accidental copy/paste. That makes refresh a
  // dead end — the new page load has no idea which bridge to talk to.
  //
  // SessionStorage is per-tab and dies when the tab closes, which is exactly
  // the lifetime we want. We stash on hello and hydrate the hash from it on
  // load if the URL itself doesn't already carry the params.

  var STASH_KEY = 'sdocs.bridge.session';

  function readStash() {
    try {
      var raw = window.sessionStorage.getItem(STASH_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return null;
      if (typeof v.bridge !== 'string' || typeof v.token !== 'string') return null;
      // Loopback guard mirrors paramsFromHash so a tampered stash can't point
      // the page at an off-machine host.
      if (!/^127\.0\.0\.1:\d+$/.test(v.bridge) && !/^localhost:\d+$/i.test(v.bridge)) {
        return null;
      }
      return v;
    } catch (_) { return null; }
  }

  function writeStash(cfg) {
    try {
      var payload = { bridge: cfg.addr, token: cfg.token };
      if (cfg.file) payload.file = cfg.file;
      window.sessionStorage.setItem(STASH_KEY, JSON.stringify(payload));
    } catch (_) { /* private mode, quota — never block on this */ }
  }

  function clearStash() {
    try { window.sessionStorage.removeItem(STASH_KEY); } catch (_) {}
  }

  // If the hash already carries bridge params we leave them alone (that's a
  // fresh `sdoc <file>` invocation). Otherwise, if the tab has a stash from
  // a previous load, splice it back into the hash so the source registry
  // picks the bridge up like it normally would.
  (function hydrateFromStash() {
    if (paramsFromHash(window.location.hash) != null) return;
    var stash = readStash();
    if (!stash) return;
    var h = window.location.hash.charAt(0) === '#' ? window.location.hash.slice(1) : window.location.hash;
    var p;
    try { p = new URLSearchParams(h); } catch (_) { p = new URLSearchParams(); }
    p.set('bridge', stash.bridge);
    p.set('token', stash.token);
    if (stash.file) p.set('file', stash.file);
    var newUrl = window.location.pathname + '#' + p.toString();
    window.history.replaceState(null, '', newUrl);
  }());

  // ── Source registration ──────────────────────────────────

  S.Sources.register({
    name: 'bridge',
    matches: function (loc) { return paramsFromHash(loc.hash) != null; },
    create:  function (loc) { return new BridgeSource(paramsFromHash(loc.hash)); },
  });

  // ── Source implementation ────────────────────────────────

  function BridgeSource(cfg) {
    this.name = 'bridge';
    this.cfg  = cfg;
    // Mode arrives in the `hello` message from the server (we don't trust the
    // URL fragment to declare it). Until then we assume the safe default:
    // canSave true so user typing isn't dropped, canSubmit false so no Done
    // button appears.
    this.mode = 'open';
    this.message = null;
    this.capabilities = { canSave: true, canWatch: true, canSubmit: false };
    this.status = 'connecting';   // surfaces in the file-info card row
    this.statusLabel = null;       // optional override; null falls back to default
    this._ws = null;
    this._connected = false;
    this._helloed = false;
    this._lastWritten = null;     // full document string we last persisted
    this._pendingExternal = null; // queued external content when user is dirty
    this._writeId = 0;
    this._saveTimer = null;
    this._pingTimer = null;
    this._submitted = false;
    this._loadResolve = null;
    this._loadPromise = new Promise(function (resolve) { this._loadResolve = resolve; }.bind(this));
    S.bridge = this; // single global instance — useful for tests + UI hooks
  }

  // Update the connection state shown in the file-info card row. `label` is
  // optional — when omitted, the card picks a default from `status`.
  BridgeSource.prototype._setStatus = function (status, label) {
    this.status = status;
    this.statusLabel = label || null;
    if (S.renderFileInfoCard) S.renderFileInfoCard();
  };

  // Capability gate: WebSocket on a Secure Context to ws://127.0.0.1 is OK
  // in Chrome and Firefox but blocked by Safari as mixed content. Chunk 3
  // owns the user-facing Safari warning bar; here we just abort cleanly.
  BridgeSource.prototype._supported = function () {
    if (typeof WebSocket === 'undefined') return false;
    var ua = navigator.userAgent || '';
    var isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
    return !isSafari;
  };

  BridgeSource.prototype.load = function () {
    if (!this._supported()) {
      if (S.setStatus) S.setStatus('Bridge editor needs Chrome or Firefox.', 'error');
      return Promise.resolve();
    }
    this._installAutoSaveHook();
    this._installFormSubmitHook();
    this._connect();
    return this._loadPromise;
  };

  // Listen for sdocs-form-submit events bubbling up from rendered form
  // blocks. Each event carries everything we need to forward to the
  // bridge: form id, button name, in-scope values, revision token, and
  // whether this submit is meant to end the session.
  BridgeSource.prototype._installFormSubmitHook = function () {
    if (S._bridgeFormSubmitHooked) return;
    var self = this;
    document.addEventListener('sdocs-form-submit', function (ev) {
      if (!self._helloed || self._submitted) return;
      var d = ev && ev.detail;
      if (!d || !d.formId || !d.buttonName) return;
      self._send({
        type: 'submitForm',
        form_id: d.formId,
        button_name: d.buttonName,
        values: d.values || {},
        scope: d.scope || [],
        token: d.token || '',
        final: !!d.final,
      });
    });
    S._bridgeFormSubmitHooked = true;
  };

  // Wrap S.syncAll once so every edit (write / raw / controls / comment)
  // bounces through the bridge. Theme swaps are viewer-side, not document
  // changes — skip them.
  BridgeSource.prototype._installAutoSaveHook = function () {
    if (!this.capabilities.canSave) return;
    if (S._bridgeAutosaveHooked) return;
    var self = this;
    var orig = S.syncAll;
    S.syncAll = function (source) {
      var ret = orig.apply(this, arguments);
      if (source !== 'theme' && source !== 'load') self._queueSave();
      return ret;
    };
    S._bridgeAutosaveHooked = true;
  };

  // Current full document, the same shape we write to disk.
  //
  // We deliberately *don't* take S.rawEl.value verbatim: the live raw textarea
  // always carries a fully expanded `styles:` block, including defaults. The
  // user opened a plain markdown file — we shouldn't smuggle a wall of YAML
  // back into it. Same shape as the styled-export path: strip defaults, drop
  // the block if nothing remains.
  BridgeSource.prototype._currentDocument = function () {
    var body = (S.currentBody != null) ? S.currentBody : '';
    var meta = Object.assign({}, S.currentMeta || {});

    if (typeof SDocStyles !== 'undefined' && typeof S.collectStyles === 'function') {
      var styles = SDocStyles.stripStyleDefaults(S.collectStyles());
      if (styles && Object.keys(styles).length > 0) {
        meta.styles = styles;
      } else {
        delete meta.styles;
      }
    }

    if (Object.keys(meta).length === 0) return body;
    return SDocYaml.serializeFrontMatter(meta) + '\n' + body;
  };

  BridgeSource.prototype._queueSave = function () {
    if (!this.capabilities.canSave) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    var self = this;
    this._saveTimer = setTimeout(function () { self._saveNow('write'); }, 500);
  };

  BridgeSource.prototype._saveNow = function (kind) {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this._connected) return;
    var doc = this._currentDocument();
    if (doc === this._lastWritten && kind !== 'submit') return;
    this._writeId++;
    var msg = { type: kind, id: 'w' + this._writeId, content: doc };
    this._send(msg);
    this._lastWritten = doc;
    if (S.setStatus) S.setStatus(kind === 'submit' ? 'Submitting...' : 'Saving...');
    this._setStatus('saving', kind === 'submit' ? 'Submitting...' : 'Saving...');
  };

  BridgeSource.prototype.submit = function () {
    if (!this.capabilities.canSubmit || this._submitted) return;
    this._submitted = true;
    this._saveNow('submit');
  };

  // ── WebSocket ────────────────────────────────────────────

  BridgeSource.prototype._connect = function () {
    var self = this;
    var url = 'ws://' + this.cfg.addr + '/?token=' + encodeURIComponent(this.cfg.token);
    var ws;
    try { ws = new WebSocket(url); }
    catch (e) { return this._fail(e.message); }
    this._ws = ws;

    ws.addEventListener('open', function () {
      self._connected = true;
      self._startHeartbeat();
      // WebSocket is open but we haven't seen `hello` yet — keep status
      // amber/connecting until the first message arrives.
    });
    ws.addEventListener('message', function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      self._onMessage(msg);
    });
    ws.addEventListener('error', function () {
      // The browser fires `error` then `close`. The close handler runs the
      // disconnect path; nothing else to do here.
    });
    ws.addEventListener('close', function () {
      var wasConnected = self._connected;
      self._connected = false;
      self._stopHeartbeat();
      if (!self._helloed) {
        self._fail('Could not connect to the local bridge. Is the sdoc command still running?');
        return;
      }
      if (self._submitted) return;
      if (wasConnected) {
        if (S.setStatus) S.setStatus('Bridge disconnected.', 'error');
        self._setStatus('disconnected');
      }
    });
  };

  BridgeSource.prototype._send = function (obj) {
    if (!this._ws || this._ws.readyState !== 1) return;
    try { this._ws.send(JSON.stringify(obj)); } catch (_) {}
  };

  BridgeSource.prototype._startHeartbeat = function () {
    var self = this;
    this._stopHeartbeat();
    this._pingTimer = setInterval(function () { self._send({ type: 'ping' }); }, 15000);
  };
  BridgeSource.prototype._stopHeartbeat = function () {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  };

  BridgeSource.prototype._fail = function (msg) {
    if (S.setStatus) S.setStatus(msg, 'error');
    this._setStatus('error', 'Connection failed');
    if (this._loadResolve) { this._loadResolve(); this._loadResolve = null; }
    // Couldn't talk to the bridge — drop the stash so refreshing doesn't put
    // the page back into the same failing reconnect loop.
    clearStash();
  };

  // ── Message dispatch ────────────────────────────────────

  BridgeSource.prototype._onMessage = function (msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello')           return this._onHello(msg);
    if (msg.type === 'external-change') return this._onExternal(msg);
    if (msg.type === 'ack')             return this._onAck(msg);
    if (msg.type === 'submitted')       return this._onSubmitted();
    if (msg.type === 'form-submitted')  return this._onFormSubmitted(msg);
    if (msg.type === 'form-stale')      return this._onFormStale(msg);
    if (msg.type === 'error')           return this._onError(msg);
    // Unknown types ignored.
  };

  BridgeSource.prototype._onFormSubmitted = function (msg) {
    if (S.setStatus) {
      S.setStatus(msg.final
        ? 'Submitted. You can close this tab.'
        : 'Sent to the agent.');
    }
    // When --keep-open is in play, server keeps the session alive; the
    // next external-change will refresh the form on its own. For final
    // submits, _onSubmitted runs in addition (the server sends both).
  };

  BridgeSource.prototype._onFormStale = function (msg) {
    if (S.setStatus) S.setStatus('The form was updated by the agent. Please review again.', 'warn');
    // The page will get a fresh external-change push imminently with the
    // new form schema; nothing else to do here.
  };

  BridgeSource.prototype._onHello = function (msg) {
    this._helloed = true;
    var content = typeof msg.content === 'string' ? msg.content : '';
    var name = msg.file || this.cfg.file || 'untitled.md';

    // Server tells the client which session shape this is. We trust this
    // over anything in the URL fragment — the URL is just a transport hint.
    this.mode = msg.mode === 'feedback' ? 'feedback' : 'open';
    this.capabilities = (msg.capabilities && typeof msg.capabilities === 'object')
      ? msg.capabilities
      : { canSave: true, canWatch: true, canSubmit: this.mode === 'feedback' };
    this.message = (typeof msg.message === 'string' && msg.message.trim().length) ? msg.message.trim() : null;
    // hello is authoritative for the filename. Persist it onto cfg so any
    // file-info render after this picks it up even when the URL fragment
    // didn't carry &file=... (e.g. tests, or a direct WS reconnect).
    if (typeof msg.file === 'string' && msg.file.length) this.cfg.file = msg.file;

    // Strip the bridge params from the URL bar so the user doesn't share
    // their session token by accident. The hash listener already wires this
    // back through loadFromHash on user navigation, but the bridge is the
    // authoritative source for as long as it's connected. We stash the same
    // params in sessionStorage so a refresh can hydrate the hash and
    // reconnect within the bridge's grace window.
    try {
      var h = window.location.hash.charAt(0) === '#' ? window.location.hash.slice(1) : window.location.hash;
      var p = new URLSearchParams(h);
      p.delete('bridge'); p.delete('token'); p.delete('file');
      var newHash = p.toString();
      var newUrl = window.location.pathname + (newHash ? '#' + newHash : '');
      window.history.replaceState(null, '', newUrl);
    } catch (_) { /* private mode etc. — never block on this */ }
    writeStash(this.cfg);

    // Populate runtime-only local metadata so the file-info card shows
    // Rel. Path / Abs. Path the same way the legacy &local= flow used to.
    // Done before loadText so the first render already has the rows.
    S.localMeta = {};
    if (typeof msg.fullPath === 'string') S.localMeta.fullPath = msg.fullPath;
    if (typeof msg.path === 'string')     S.localMeta.path     = msg.path;

    S._isDefaultState = false;
    if (S.loadText) S.loadText(content, name);
    this._lastWritten = this._currentDocument();
    // Don't auto-switch the editor mode. The user opened the file to read;
    // they can click into Write/Raw themselves. Switching uninvited surprised
    // people in QA.
    if (S.setStatus) S.setStatus('Connected to ' + name);
    // _setStatus already triggers a re-render of the file-info card, which
    // picks up `this.message` + `this.capabilities.canSubmit` and draws the
    // request row in-card. No banner / floating button to install.
    this._setStatus('connected');
    if (this._loadResolve) { this._loadResolve(); this._loadResolve = null; }
  };

  BridgeSource.prototype._onAck = function (_msg) {
    if (this._submitted) return;
    if (S.setStatus) S.setStatus('Saved');
    this._setStatus('saved');
  };

  BridgeSource.prototype._onSubmitted = function () {
    if (S.setStatus) S.setStatus('Submitted. You can close this tab.');
    // Triggers a re-render: the request row checks `_submitted` and removes
    // itself, the bridge status row's existing 'submitted' label takes over.
    this._setStatus('submitted');
    // Session is over — clearing the stash means a refresh won't try to
    // re-attach to a bridge that has already exited.
    clearStash();
  };

  BridgeSource.prototype._onError = function (msg) {
    if (msg && msg.code === 'EREADONLY') return; // expected in watch mode
    var text = (msg && msg.message) || (msg && msg.code) || 'bridge error';
    if (S.setStatus) S.setStatus('Bridge: ' + text, 'error');
  };

  // External change: if the user has nothing unsaved, swap in the new content.
  // Otherwise queue it and show a banner; chunk 3 polishes this UX into a
  // dedicated bar with reload/keep buttons.
  BridgeSource.prototype._onExternal = function (msg) {
    var content = typeof msg.content === 'string' ? msg.content : '';
    if (content === this._lastWritten) return; // our own write echoing back

    var current = this._currentDocument();
    var unsaved = this.capabilities.canSave && (current !== this._lastWritten);

    if (!unsaved) {
      if (S.loadText) S.loadText(content, msg.file || this.cfg.file || 'untitled.md');
      this._lastWritten = this._currentDocument();
      if (S.setStatus) S.setStatus('File changed on disk — reloaded.');
      return;
    }

    this._pendingExternal = content;
    if (S.setStatus) S.setStatus('File changed on disk. Reload to take the new version.', 'warn');
  };

  // Public method the UI (chunk 3 banner) calls to apply a pending external
  // change, discarding the local unsaved edits.
  BridgeSource.prototype.reloadPendingExternal = function () {
    if (this._pendingExternal == null) return;
    var content = this._pendingExternal;
    this._pendingExternal = null;
    if (S.loadText) S.loadText(content, this.cfg.file || 'untitled.md');
    this._lastWritten = this._currentDocument();
    if (S.setStatus) S.setStatus('Reloaded from disk.');
  };

  // ── External subscription (Source contract) ──────────────

  BridgeSource.prototype.onExternalChange = function (cb) {
    // The internal flow already loads external content directly via loadText.
    // Expose the hook so chunk 3 (banner UX) and tests can observe it.
    if (typeof cb !== 'function') return;
    var prev = this._onExternal;
    var self = this;
    this._onExternal = function (msg) { prev.call(self, msg); try { cb(msg); } catch (_) {} };
  };

  BridgeSource.prototype.save = function () { this._queueSave(); };

  // Exposed helpers (used by tests).
  S.bridgeInternals = {
    paramsFromHash: paramsFromHash,
    BridgeSource: BridgeSource,
  };
}());
