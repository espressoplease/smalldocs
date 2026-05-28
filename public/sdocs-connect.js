// Client-side store: have we successfully reached the local library
// agent from this browser before? If yes, pages that talk to the agent
// (the library, tag autocomplete, the live-file refresh) can ping it
// silently. If no, those pages link out to /connect instead of making
// a request that would surprise the user with Chrome's Private Network
// Access prompt.
//
// State lives in localStorage so it survives page reloads but doesn't
// cross browsers / machines. That's the right grain: each browser
// independently grants (or has been granted) loopback permission, and
// each gets one walkthrough.
//
// Loaded via a plain <script> tag before any module that asks about
// agent reachability. UMD shape so Node tests can require the same
// file if needed.

(function (exports) {
  var KEY = 'sdocs.connect';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : null;
    } catch (_) { return null; }
  }

  function write(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (_) {}
  }

  // True when the user has completed the Connect walkthrough at least
  // once in this browser. The agent may not be running RIGHT NOW (they
  // might have quit `sdoc library`), but they have granted Chrome's
  // PNA permission for this origin and consented to local access.
  function isConnected() {
    var s = read();
    return !!(s && s.connected === true);
  }

  function markConnected(version) {
    write({
      connected: true,
      version: version || '',
      at: Date.now(),
    });
  }

  function forget() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  function lastVersion() {
    var s = read();
    return s && s.version ? s.version : '';
  }

  function lastSeenAt() {
    var s = read();
    return s && s.at ? s.at : 0;
  }

  exports.isConnected   = isConnected;
  exports.markConnected = markConnected;
  exports.forget        = forget;
  exports.lastVersion   = lastVersion;
  exports.lastSeenAt    = lastSeenAt;
})(typeof module !== 'undefined' && module.exports
   ? module.exports
   : (window.SDocsConnect = {}));
