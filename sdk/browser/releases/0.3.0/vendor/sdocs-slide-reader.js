// sdocs-slide-reader.js - canonical inline slide surface.
(function (exports) {
  'use strict';

  var PRESENT_ICON_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/>'
    + '<path d="m7 21 5-5 5 5"/></svg>';

  function value(option) {
    return typeof option === 'function' ? option() : option;
  }

  function setHTML(options, node, html) {
    if (options.setHTML) options.setHTML(node, String(html));
    else node.innerHTML = html;
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }

  function copyText(options, text, done) {
    var clipboard = options.clipboard || (typeof navigator !== 'undefined' && navigator.clipboard);
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(text).then(done).catch(function () {
        legacyCopy(text);
        done();
      });
      return;
    }
    legacyCopy(text);
    done();
  }

  function formatErrorLine(error) {
    if (error.line) return 'line ' + error.line + ': ' + error.message;
    if (error.source) return error.source + ': ' + error.message;
    return error.message;
  }

  function buildErrorReport(errors, dslText, slideIndex) {
    var lines = [];
    lines.push('SDocs slide ' + (slideIndex + 1) + ' - ' + errors.length + ' error'
      + (errors.length === 1 ? '' : 's'));
    for (var i = 0; i < errors.length; i++) lines.push('  ' + formatErrorLine(errors[i]));
    lines.push('');
    lines.push('Slide source (fenced block):');
    lines.push('~~~slide');
    lines.push(dslText.replace(/\s+$/, ''));
    lines.push('~~~');
    return lines.join('\n');
  }

  function buildErrorBadge(options, wrapper) {
    var errors = wrapper.__sdocErrors || [];
    var dslText = wrapper.__sdocRawText || '';
    var slideIndex = wrapper.__sdocSlideIdx || 0;
    var badge = document.createElement('div');
    badge.className = 'sdoc-slide-errbadge';

    var message = document.createElement('div');
    message.className = 'sdoc-slide-errbadge-msg';
    var title = document.createElement('span');
    title.className = 'sdoc-slide-errbadge-title';
    title.textContent = errors.length + ' error' + (errors.length === 1 ? '' : 's')
      + ' in slide ' + (slideIndex + 1);
    message.appendChild(title);
    var list = document.createElement('ul');
    list.className = 'sdoc-slide-errbadge-list';
    for (var i = 0; i < errors.length; i++) {
      var item = document.createElement('li');
      item.textContent = formatErrorLine(errors[i]);
      list.appendChild(item);
    }
    message.appendChild(list);
    badge.appendChild(message);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sdoc-slide-errbadge-copy';
    button.textContent = 'Copy';
    button.title = 'Copy a diagnostic your agent can use to fix this slide';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var report = buildErrorReport(errors, dslText, slideIndex);
      copyText(options, report, function () {
        button.classList.add('copied');
        button.textContent = 'Copied';
        setTimeout(function () {
          if (!button.isConnected) return;
          button.classList.remove('copied');
          button.textContent = 'Copy';
        }, 1500);
      });
    });
    badge.appendChild(button);
    return badge;
  }

  function syncErrorBadge(options, wrapper) {
    var existing = wrapper.querySelector(':scope > .sdoc-slide-errbadge');
    if (existing) existing.remove();
    if (!wrapper.__sdocErrors || !wrapper.__sdocErrors.length) return;
    wrapper.appendChild(buildErrorBadge(options, wrapper));
  }

  function appendSlideError(wrapper, error, options) {
    if (!wrapper || !error) return;
    if (!wrapper.__sdocErrors) wrapper.__sdocErrors = [];
    wrapper.__sdocErrors.push(error);
    syncErrorBadge(options || {}, wrapper);
  }

  function create(options) {
    options = options || {};
    var currentResults = [];
    var currentSlides = [];
    var destroyed = false;

    function destroyResults() {
      for (var i = currentResults.length - 1; i >= 0; i--) {
        var result = currentResults[i];
        if (result && result.destroy) {
          try { result.destroy(); } catch (_) {}
        }
      }
      currentResults = [];
      currentSlides = [];
    }

    function buildPresentButton(slideIndex) {
      if (!options.present) return null;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sdoc-slide-present';
      button.setAttribute('aria-label', 'Open slide ' + (slideIndex + 1) + ' in presentation mode');
      button.title = 'Present (Enter)';
      setHTML(options, button, PRESENT_ICON_SVG);
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        options.present(slideIndex, currentSlides.slice());
      });
      return button;
    }

    function renderError(wrapper, message) {
      wrapper.classList.add('sdoc-slide-error');
      wrapper.textContent = message;
    }

    function process(container) {
      if (destroyed || !container) {
        return { slides: [], ready: Promise.resolve([]), destroy: function () {} };
      }
      destroyResults();
      var shapes = value(options.shapes);
      var renderer = value(options.renderer);
      var resolver = value(options.resolver);
      var templates = value(options.templates);
      if (!shapes || !renderer || !renderer.renderShapes) {
        throw new Error('SmallDocs slide reader requires the shape renderer');
      }

      var selector = options.selector || 'code.language-slide';
      var blocks = Array.prototype.slice.call(container.querySelectorAll(selector));
      if (!blocks.length) {
        if (options.onRefresh) options.onRefresh([]);
        return { slides: [], ready: Promise.resolve([]), destroy: destroyResults };
      }
      var raw = blocks.map(function (code) { return code.textContent || ''; });
      var resolved = resolver && resolver.resolveSlides
        ? resolver.resolveSlides(raw, shapes, { stdlib: templates })
        : raw.map(function (dsl) { return { dsl: dsl, skip: false, errors: [] }; });
      var pending = [];
      var slideIndex = 0;

      for (var i = 0; i < blocks.length; i++) {
        var code = blocks[i];
        var pre = code.closest('pre');
        if (!pre) continue;
        var entry = resolved[i] || { dsl: raw[i], skip: false, errors: [] };
        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;
        if (!target.parentNode) continue;
        if (entry.skip) {
          target.remove();
          continue;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'sdoc-slide';
        wrapper.dataset.dsl = entry.dsl;
        wrapper.dataset.slideIndex = String(slideIndex);
        wrapper.__sdocErrors = [];
        wrapper.__sdocRawText = raw[i];
        wrapper.__sdocSlideIdx = slideIndex;
        wrapper.addEventListener('sdoc-slide-error', (function (owner) {
          return function (event) {
            if (event && event.detail) appendSlideError(owner, event.detail, options);
          };
        })(wrapper));

        var renderResult = null;
        var hasFatalError = false;
        try {
          var slideWrap = document.createElement('div');
          wrapper.appendChild(slideWrap);
          var renderOptions = options.renderOptions
            ? options.renderOptions(entry.dsl, slideIndex) || {}
            : {};
          if (renderOptions.copyButtons == null) renderOptions.copyButtons = true;
          renderResult = renderer.renderShapes(entry.dsl, slideWrap, renderOptions);
          currentResults.push(renderResult);
          if (renderResult.ready || renderResult.pending) {
            pending.push(renderResult.ready || renderResult.pending);
          }
          var luminance = renderResult.cornerLuminance;
          if (typeof luminance === 'number') {
            wrapper.classList.add(luminance < 0.5 ? 'sdoc-slide-dark-ui' : 'sdoc-slide-light-ui');
          }
          var errors = (entry.errors || []).concat(renderResult.errors || []);
          if (errors.length) {
            wrapper.__sdocErrors = errors.slice();
            syncErrorBadge(options, wrapper);
          }
        } catch (error) {
          renderError(wrapper, 'slide render failed: ' + error.message);
          hasFatalError = true;
        }

        if (!hasFatalError) {
          var presentButton = buildPresentButton(slideIndex);
          if (presentButton) wrapper.appendChild(presentButton);
        }
        target.replaceWith(wrapper);
        currentSlides.push({
          dsl: entry.dsl,
          source: raw[i],
          index: slideIndex,
          element: wrapper,
          result: renderResult,
        });
        slideIndex++;
      }

      if (options.onRefresh) options.onRefresh(currentSlides.slice());
      return {
        slides: currentSlides.slice(),
        ready: Promise.all(pending).then(function () { return currentSlides.slice(); }),
        destroy: destroyResults,
      };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      destroyResults();
    }

    return {
      process: process,
      destroy: destroy,
      slides: function () { return currentSlides.slice(); },
      appendSlideError: function (wrapper, error) { appendSlideError(wrapper, error, options); },
    };
  }

  exports.create = create;
  exports.appendSlideError = appendSlideError;
  exports.formatErrorLine = formatErrorLine;
  exports.buildErrorReport = buildErrorReport;
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocSlideReader = window.SDocSlideReader || {}));
