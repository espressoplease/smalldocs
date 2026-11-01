/* Public host for the shared SmallDocs reader. It only reads the published copy. */
(function () {
  'use strict';
  var fallback = document.getElementById('_sd_rendered');
  if (!fallback) return;
  var themeButton = document.querySelector('.publication-theme');
  var view;
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (themeButton) themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (themeButton) {
    themeButton.hidden = false;
    themeButton.addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }

  // Older snapshots contain public HTML rather than a Markdown source payload.
  // Reuse that published HTML, recovering rich fence text from its code blocks.
  // Never fetch a private document or substitute its newer draft.
  function legacySource() {
    var copy = fallback.cloneNode(true);
    var metadata = copy.querySelector('.publication-meta');
    if (metadata) {
      var footer = document.createElement('footer');
      footer.className = 'publication-meta';
      footer.appendChild(metadata.cloneNode(true));
      fallback.after(footer);
      metadata.remove();
    }
    var inventedTitle = copy.querySelector(':scope > h1:not([id])');
    if (inventedTitle) inventedTitle.remove();
    copy.querySelectorAll('pre > code').forEach(function (code) {
      if (!code.isConnected && !copy.contains(code)) return;
      var pre = code.parentElement;
      var block = pre.closest('.publication-rich') || pre;
      var language = (code.className.match(/(?:^|\s)language-([\w+-]+)/) || [,''])[1];
      var source = code.textContent;
      var fence = '`'.repeat(Math.max(3, Math.max.apply(null, (source.match(/`+/g) || ['']).map(function (run) { return run.length; })) + 1));
      block.replaceWith(document.createTextNode('\n\n' + fence + language + '\n' + source.replace(/\n$/, '') + '\n' + fence + '\n\n'));
    });
    return Array.prototype.map.call(copy.childNodes, function (node) {
      return node.nodeType === 3 ? node.textContent : node.outerHTML;
    }).join('\n\n');
  }

  var payload = document.getElementById('publication-source');
  var markdown;
  try { markdown = payload ? JSON.parse(payload.textContent).markdown : legacySource(); }
  catch (_) { return; }
  if (typeof markdown !== 'string') return;
  var mount = document.createElement('div');
  mount.className = 'publication-reader-mount publication-reader-preparing';
  fallback.before(mount);
  // Rich components measure their font and colours while mounting. Apply the
  // published style rules to the preparing reader before those measurements.
  document.head.querySelectorAll('style').forEach(function (style) {
    if (style.textContent.indexOf('html #_sd_rendered{') !== 0) return;
    var sharedStyle = document.createElement('style');
    sharedStyle.textContent = style.textContent.replace(/#_sd_rendered/g, '.publication-reader-mount .smalldocs-document');
    document.head.appendChild(sharedStyle);
  });
  import('/sdk/0.3.1/smalldocs.js').then(function (sdk) {
    return sdk.render(mount, markdown, {
      navigation: false,
      runnableHtml: false,
      sections: { collapsible: true, defaultOpen: true },
      controls: { copy: true, fullscreen: true, download: true }
    });
  }).then(function (reader) {
    view = reader;
    // Retain the exact validated document styles from the published HTML.
    fallback.remove();
    reader.element.id = '_sd_rendered';
    reader.element.setAttribute('aria-label', document.title.replace(/ \| SmallDocs$/, ''));
    mount.classList.remove('publication-reader-preparing');
    document.documentElement.dataset.publicationReady = 'true';
  }).catch(function () {
    mount.remove();
    document.documentElement.dataset.publicationReady = 'fallback';
  });
  window.addEventListener('pagehide', function (event) {
    if (!event.persisted && view) view.destroy();
  });
})();
