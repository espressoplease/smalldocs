// sdocs-codewalk-ui.js — browser glue for the multi-file code walkthrough.
//
// The pure model lives in sdocs-codewalk.js; the tabbed rendering + the
// cross-file stepper live in the fullscreen viewer (sdocs-code-focus.js). This
// module owns the one thing that has to happen at MARKDOWN-PARSE time: stamping
// each code fence's filename onto its <pre> so the viewer can label the tab and
// match annotations to the right file.
//
// A walkthrough fence is `\`\`\`python app.py` — language then filename. marked's
// default code renderer keeps only the first word ("python") for the highlight
// class and drops the filename. So we override the code renderer to emit
// `<pre data-file="app.py">` for walkthrough docs, falling back to the default
// renderer everywhere else (return false). DOMPurify keeps data-* attributes
// (only `style` is forbidden in renderMarkdownSafe), so the attribute survives.
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only stamp data-file when the current document opted into a walkthrough, so
  // the override is inert for every ordinary doc (and ordinary `\`\`\`lang title`
  // fences keep their existing default rendering).
  function activeCodewalk() {
    var S = window.SDocs;
    var CW = window.SDocCodewalk;
    return !!(S && CW && CW.isCodewalk(S.currentMeta));
  }

  if (typeof window.marked !== 'undefined' && window.marked &&
      typeof window.marked.use === 'function') {
    window.marked.use({
      renderer: {
        // marked v11 calls this positionally: (code, infostring, escaped).
        code: function (code, infostring, escaped) {
          if (!activeCodewalk()) return false;
          var info = String(infostring || '');
          var m = /^(\S+)\s+(\S.*)$/.exec(info);
          if (!m) return false; // no filename token → default renderer
          var lang = m[1].toLowerCase().replace(/[^\w+#.-]/g, '');
          var file = m[2].replace(/"/g, '').trim();
          var body = escaped ? code : escapeHtml(code);
          return '<pre data-file="' + escapeHtml(file) + '">'
               + '<code class="language-' + escapeHtml(lang) + '">'
               + body + '\n</code></pre>\n';
        },
      },
    });
  }
})();
