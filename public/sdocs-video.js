// sdocs-video.js - YouTube video embeds for ```video fenced blocks.
//
// Pipeline (mirrors sdocs-mermaid.js):
//   1. marked turns a ```video fence into <pre><code class="language-video">.
//   2. DOMPurify keeps the <pre><code> text (default allowlist). Crucially,
//      NO iframe ever travels through the document markup - DOMPurify still
//      strips iframes globally, exactly as before.
//   3. processVideo(container), called after sanitize, walks every
//      code.language-video, reads its TEXT, extracts an 11-character video
//      id, validates it against /^[A-Za-z0-9_-]{11}$/, and builds the iframe
//      itself with DOM APIs from a src WE construct. The only thing that
//      crosses from the document is a regex-checked id - never raw markup.
//
// Security:
//   - The global DOMPurify config is untouched. Iframes stay forbidden in
//     ordinary markup; the only iframe on the page is the fixed-shape one
//     this module builds from a validated id.
//   - The embed host is youtube-nocookie.com (no tracking cookie until the
//     viewer presses play) with rel=0 (end-screen suggestions limited to the
//     source channel - YouTube no longer allows fully removing them).
//   - Per-block source cap (8 KB) and per-document block cap (50).
//
// The pure core (id extraction / validation / embed-url build) is UMD-shared
// with the Node tests; the DOM renderer below is browser-only.

(function (exports) {
  'use strict';

  // YouTube ids are exactly 11 url-safe base64 characters. This pattern is
  // the whole trust boundary: anything that is not 11 of [A-Za-z0-9_-] never
  // becomes an embed.
  var YT_ID = /^[A-Za-z0-9_-]{11}$/;

  // Parse a human start time into whole seconds. Accepts: 90, 90s, 1m30s,
  // 1h2m3s, 1:30, 1:02:03. Returns 0 for anything it can't read.
  function parseStart(v) {
    if (v == null) return 0;
    var s = String(v).trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s, 10) || 0;
    if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
      var total = 0;
      s.split(':').forEach(function (p) { total = total * 60 + (parseInt(p, 10) || 0); });
      return total;
    }
    var m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (m && (m[1] || m[2] || m[3])) {
      return (parseInt(m[1] || 0, 10)) * 3600 +
             (parseInt(m[2] || 0, 10)) * 60 +
             (parseInt(m[3] || 0, 10));
    }
    return 0;
  }

  // Pull the 11-char id out of any recognised YouTube URL shape, or accept a
  // bare id. Returns null when nothing valid is found - the caller renders an
  // error rather than guessing.
  function extractYouTubeId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (YT_ID.test(s)) return s;
    var m;
    // youtu.be/ID
    m = s.match(/^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/i);
    if (m) return m[1];
    // youtube.com/watch?...v=ID...
    m = s.match(/^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/i);
    if (m) return m[1];
    // youtube.com/{embed,shorts,v,live}/ID
    m = s.match(/^https?:\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/i);
    if (m) return m[1];
    return null;
  }

  // Split a ```video block body into a url line plus optional `key: value`
  // directives (title, start). First non-directive line is the url/id.
  function parseVideoSource(raw) {
    var lines = String(raw == null ? '' : raw).split(/\r?\n/);
    var urlLine = '';
    var directives = {};
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) continue;
      var d = ln.match(/^(title|caption|start)\s*:\s*(.*)$/i);
      if (d) { directives[d[1].toLowerCase()] = d[2].trim(); continue; }
      if (!urlLine) urlLine = ln;
    }
    if (!urlLine) return { error: 'Empty video block. Add a YouTube URL or 11-character video id.' };
    var id = extractYouTubeId(urlLine);
    if (!id) return { error: 'Not a recognised YouTube URL or 11-character video id.' };
    var start = 0;
    if (directives.start) {
      start = parseStart(directives.start);
    } else {
      var tm = urlLine.match(/[?&](?:t|start)=([^&#]+)/i);
      if (tm) start = parseStart(tm[1]);
    }
    return {
      provider: 'youtube',
      id: id,
      start: start,
      title: directives.title || directives.caption || '',
    };
  }

  // Build the embed src from a parsed block. id is already validated and
  // start is an integer, so the result is a fixed, safe URL.
  function buildEmbedUrl(parsed) {
    var qs = ['rel=0'];
    if (parsed.start) qs.push('start=' + parsed.start);
    return 'https://www.youtube-nocookie.com/embed/' + parsed.id + '?' + qs.join('&');
  }

  // Canonical watch URL, used for the caption link and export fallback.
  function watchUrl(parsed) {
    var u = 'https://www.youtube.com/watch?v=' + parsed.id;
    if (parsed.start) u += '&t=' + parsed.start + 's';
    return u;
  }

  exports.extractYouTubeId = extractYouTubeId;
  exports.parseVideoSource = parseVideoSource;
  exports.buildEmbedUrl = buildEmbedUrl;
  exports.watchUrl = watchUrl;
  exports.parseStart = parseStart;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocVideo = {}));


// ── Browser-only DOM renderer ──────────────────────────────────────────────
if (typeof window !== 'undefined' && window.SDocs) {
  (function () {
    'use strict';
    var S = window.SDocs;
    var V = window.SDocVideo;

    var SOURCE_BYTE_CAP = 8 * 1024;
    var DOC_BLOCK_CAP = 50;

    function byteLen(s) {
      try { return new Blob([s]).size; } catch (_) { return s.length; }
    }

    function renderError(target, msg) {
      var pre = document.createElement('pre');
      pre.className = 'sdoc-video-error';
      var line = document.createElement('div');
      line.className = 'sdoc-video-error-msg';
      line.textContent = msg;
      pre.appendChild(line);
      target.parentNode.replaceChild(pre, target);
    }

    function buildEmbed(parsed) {
      var wrapper = document.createElement('div');
      wrapper.className = 'sdoc-video';
      wrapper.setAttribute('data-watch', V.watchUrl(parsed));

      var frame = document.createElement('div');
      frame.className = 'sdoc-video-frame';

      // The iframe is built here, never parsed from document markup. Its src
      // is constructed from a validated id - nothing from the source string
      // reaches the DOM except that id.
      var iframe = document.createElement('iframe');
      iframe.setAttribute('src', V.buildEmbedUrl(parsed));
      iframe.setAttribute('title', parsed.title || 'YouTube video player');
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('frameborder', '0');
      frame.appendChild(iframe);
      wrapper.appendChild(frame);

      if (parsed.title) {
        var cap = document.createElement('div');
        cap.className = 'sdoc-video-caption';
        var a = document.createElement('a');
        a.setAttribute('href', V.watchUrl(parsed));
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = parsed.title;
        cap.appendChild(a);
        wrapper.appendChild(cap);
      }
      return wrapper;
    }

    function processVideo(container) {
      if (!container) return;
      var nodes = container.querySelectorAll('code.language-video');
      if (!nodes.length) return;
      var capped = Array.prototype.slice.call(nodes, 0, DOC_BLOCK_CAP);

      capped.forEach(function (codeEl) {
        var pre = codeEl.closest('pre');
        if (!pre || pre._videoDone) return;
        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;

        var src = codeEl.textContent || '';
        if (byteLen(src) > SOURCE_BYTE_CAP) {
          pre._videoDone = true;
          renderError(target, 'Video block too large.');
          return;
        }

        var parsed = V.parseVideoSource(src);
        pre._videoDone = true;
        if (parsed.error) { renderError(target, parsed.error); return; }
        target.parentNode.replaceChild(buildEmbed(parsed), target);
      });
    }

    S.processVideo = processVideo;
  })();
}
