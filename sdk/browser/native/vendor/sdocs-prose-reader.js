// sdocs-prose-reader.js - shared ordinary document reader controls.
(function (exports) {
  'use strict';

  var LINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var CHEVRON_SVG = '<span class="section-toggle"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  var COPY_FEEDBACK_MS = 1500;
  var SECTION_LEVELS = { H2: 2, H3: 3, H4: 4 };
  var TABLE_IMAGE_STYLE_PROPS = [
    'display', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
    'border-collapse', 'border-spacing',
    'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'background-color', 'color', 'font-family', 'font-size', 'font-style',
    'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'text-decoration', 'text-transform', 'vertical-align', 'white-space',
    'word-break', 'overflow-wrap'
  ];

  function tableCellCopyText(cell) {
    if (!cell) return '';
    var clone = cell.cloneNode(true);
    clone.querySelectorAll('.table-copy-btn, .sdoc-card, .sdoc-table-add')
      .forEach(function (element) { element.remove(); });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function tableRows(table) {
    return Array.prototype.map.call(table.rows, function (row) {
      return Array.prototype.map.call(row.cells, tableCellCopyText);
    });
  }

  function serializeTableCsv(rows) {
    return rows.map(function (row) {
      return row.map(function (value) {
        var text = String(value == null ? '' : value);
        return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
      }).join(',');
    }).join('\n');
  }

  function sectionMarkdown(markdown, headingIndex) {
    var lines = String(markdown == null ? '' : markdown).split('\n');
    var headings = [];
    var fence = null;
    for (var i = 0; i < lines.length; i++) {
      var fenceMatch = lines[i].match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1][0];
        else if (fence === fenceMatch[1][0]) fence = null;
        continue;
      }
      if (fence) continue;
      var match = lines[i].match(/^(#{1,4})\s/);
      if (match) headings.push({ line: i, level: match[1].length });
    }
    if (headingIndex < 0 || headingIndex >= headings.length) return '';
    var target = headings[headingIndex];
    var endLine = lines.length;
    for (var j = headingIndex + 1; j < headings.length; j++) {
      if (headings[j].level <= target.level) {
        endLine = headings[j].line;
        break;
      }
    }
    return lines.slice(target.line, endLine).join('\n').trimEnd();
  }

  function create(options) {
    options = options || {};
    var doc = options.document || document;
    var win = options.window || window;
    var destroyed = false;
    var timers = [];
    var rememberedOpenIds = Array.isArray(options.openSectionIds)
      ? options.openSectionIds.slice()
      : [];
    var rememberedSectionIds = Array.isArray(options.sectionIds)
      ? options.sectionIds.slice()
      : [];
    var hasRememberedState = options.restoreSectionState === true;

    function root() {
      return typeof options.root === 'function' ? options.root() : options.root;
    }

    function active(node) {
      return !destroyed && (!options.isActive || options.isActive()) && (!node || node.isConnected);
    }

    function setHTML(node, html) {
      if (options.setHTML) options.setHTML(node, String(html));
      else node.innerHTML = html;
    }

    function controls(name) {
      var value = typeof options.controls === 'function' ? options.controls() : options.controls;
      return !value || value[name] !== false;
    }

    function sectionConfig() {
      var value = typeof options.sections === 'function' ? options.sections() : options.sections;
      value = value && typeof value === 'object' ? value : {};
      return {
        collapsible: value.collapsible !== false,
        defaultOpen: value.defaultOpen === true
      };
    }

    function source() {
      var value = typeof options.markdown === 'function' ? options.markdown() : options.markdown;
      return String(value == null ? '' : value);
    }

    function slug(value) {
      if (options.slugify) return options.slugify(value);
      return String(value || '').toLowerCase().trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    }

    function sectionUrl(id) {
      if (options.buildSectionUrl) return options.buildSectionUrl(id);
      return win.location.origin + win.location.pathname + win.location.search + '#' + encodeURIComponent(id);
    }

    function schedule(callback) {
      var timer = win.setTimeout(function () {
        timers = timers.filter(function (candidate) { return candidate !== timer; });
        callback();
      }, COPY_FEEDBACK_MS);
      timers.push(timer);
    }

    function flashButton(button, label, restoreIcon) {
      var suffix = label ? '<span class="table-copy-label">' + label + '</span>' : '';
      setHTML(button, CHECK_SVG + suffix);
      schedule(function () {
        if (active(button)) setHTML(button, (restoreIcon || COPY_SVG) + suffix);
      });
    }

    function flashTableLabel(button, text) {
      var label = button.querySelector('.table-copy-label');
      if (!label) return;
      var previous = label.textContent;
      label.textContent = text;
      schedule(function () {
        if (active(button)) label.textContent = previous;
      });
    }

    function copyText(text, button, label, restoreIcon) {
      var clipboard = options.clipboard || (win.navigator && win.navigator.clipboard);
      if (!clipboard || !clipboard.writeText) return Promise.resolve(false);
      return clipboard.writeText(text).then(function () {
        if (active(button)) flashButton(button, label, restoreIcon);
        return true;
      }).catch(function () { return false; });
    }

    function attachHeadings(container) {
      var counts = {};
      var headings = Array.prototype.slice.call(container.querySelectorAll('h1, h2, h3, h4'));
      headings.forEach(function (heading, index) {
        var text = heading.textContent;
        var id = slug(text) || 'section';
        if (counts[id] != null) {
          counts[id] += 1;
          id += '-' + counts[id];
        } else {
          counts[id] = 0;
        }
        heading.id = String(options.idPrefix || '') + id;
        id = heading.id;
        heading.dataset.smalldocsHeadingText = text.trim();
        if (!controls('copy')) return;

        var anchor = doc.createElement('a');
        anchor.className = 'header-anchor';
        setHTML(anchor, LINK_SVG);
        anchor.title = 'Copy link to section';
        anchor.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          copyText(sectionUrl(id), anchor, '', LINK_SVG);
        });
        heading.appendChild(anchor);

        var copy = doc.createElement('button');
        copy.className = 'header-copy-btn';
        setHTML(copy, COPY_SVG);
        copy.title = 'Copy section';
        copy.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          copyText(sectionMarkdown(source(), index), copy, '');
        });
        heading.appendChild(copy);
      });
      return headings;
    }

    function sectionHeading(section) {
      return section.querySelector(':scope > h2, :scope > h3, :scope > h4')
        || section.querySelector(':scope > .sdoc-block-host > h2, :scope > .sdoc-block-host > h3, :scope > .sdoc-block-host > h4');
    }

    function setSectionOpen(section, open, cascade) {
      if (!section) return;
      var body = section.querySelector(':scope > .md-section-body');
      var heading = sectionHeading(section);
      var toggle = heading && heading.querySelector(':scope > .section-toggle');
      if (!body || !toggle) return;
      body.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
      if (cascade) {
        body.querySelectorAll('.md-section-body').forEach(function (nestedBody) {
          nestedBody.classList.toggle('open', open);
        });
        body.querySelectorAll('.section-toggle').forEach(function (nestedToggle) {
          nestedToggle.classList.toggle('open', open);
        });
      }
      if (options.onSectionsChange) options.onSectionsChange();
    }

    function setAllSectionsOpen(container, open) {
      container.querySelectorAll('h1 > .section-toggle').forEach(function (toggle) {
        toggle.classList.toggle('open', open);
      });
      container.querySelectorAll('.md-section').forEach(function (section) {
        setSectionOpen(section, open, false);
      });
    }

    function openHeading(heading) {
      var section = heading && heading.closest ? heading.closest('.md-section') : null;
      while (section) {
        setSectionOpen(section, true, false);
        var parentBody = section.parentElement && section.parentElement.closest('.md-section-body');
        section = parentBody ? parentBody.closest('.md-section') : null;
      }
    }

    function attachSections(container) {
      var config = sectionConfig();
      if (!config.collapsible) return;

      container.querySelectorAll('h1').forEach(function (heading) {
        var holder = doc.createElement('span');
        setHTML(holder, CHEVRON_SVG);
        var toggle = holder.firstElementChild;
        heading.insertBefore(toggle, heading.firstChild);
        heading.style.cursor = 'pointer';
        heading.addEventListener('click', function (event) {
          if (event.target.closest('.header-anchor') || event.target.closest('.header-copy-btn')) return;
          var open = !toggle.classList.contains('open');
          setAllSectionsOpen(container, open);
        });
      });

      var children = Array.prototype.slice.call(container.children);
      var stack = [{ body: container, level: 0 }];
      children.forEach(function (child) {
        if (child.tagName === 'H1') {
          stack = [{ body: container, level: 0 }];
          stack[0].body.appendChild(child);
          return;
        }
        var level = SECTION_LEVELS[child.tagName];
        if (!level) {
          stack[stack.length - 1].body.appendChild(child);
          return;
        }
        while (stack[stack.length - 1].level >= level) stack.pop();
        var section = doc.createElement('div');
        section.className = 'md-section';
        var body = doc.createElement('div');
        body.className = 'md-section-body';
        var holder = doc.createElement('span');
        setHTML(holder, CHEVRON_SVG);
        var toggle = holder.firstElementChild;
        child.insertBefore(toggle, child.firstChild);
        stack[stack.length - 1].body.appendChild(section);
        section.appendChild(child);
        section.appendChild(body);
        stack.push({ body: body, level: level });
        setSectionOpen(section, config.defaultOpen, false);
      });

      container.querySelectorAll('.md-section > h2, .md-section > h3, .md-section > h4').forEach(function (heading) {
        heading.addEventListener('click', function (event) {
          if (event.target.closest('.header-anchor') || event.target.closest('.header-copy-btn')) return;
          var before = heading.getBoundingClientRect().top;
          var section = heading.closest('.md-section');
          var body = section.querySelector(':scope > .md-section-body');
          setSectionOpen(section, !body.classList.contains('open'), true);
          var after = heading.getBoundingClientRect().top;
          var scrollContainer = typeof options.scrollContainer === 'function'
            ? options.scrollContainer()
            : options.scrollContainer;
          if (scrollContainer && before !== after) scrollContainer.scrollTop += after - before;
        });
      });

      if (hasRememberedState) {
        var remembered = new Set(rememberedOpenIds);
        var known = new Set(rememberedSectionIds);
        container.querySelectorAll('.md-section').forEach(function (section) {
          var heading = sectionHeading(section);
          if (heading && known.has(heading.id)) {
            setSectionOpen(section, remembered.has(heading.id), false);
          }
        });
      } else {
        rememberedOpenIds.forEach(function (id) {
          var heading;
          try { heading = container.querySelector('#' + win.CSS.escape(id)); } catch (_) { heading = null; }
          if (heading) openHeading(heading);
        });
      }
      var allBodies = Array.prototype.slice.call(container.querySelectorAll('.md-section-body'));
      var allOpen = allBodies.length > 0 && allBodies.every(function (body) { return body.classList.contains('open'); });
      container.querySelectorAll('h1 > .section-toggle').forEach(function (toggle) {
        toggle.classList.toggle('open', allOpen);
      });
    }

    function captureOpenIds(container) {
      var current = container || root();
      if (!current) return rememberedOpenIds.slice();
      rememberedOpenIds = [];
      rememberedSectionIds = [];
      hasRememberedState = true;
      current.querySelectorAll('.md-section').forEach(function (section) {
        var body = section.querySelector(':scope > .md-section-body');
        var heading = sectionHeading(section);
        if (heading && heading.id) rememberedSectionIds.push(heading.id);
        if (body && heading && heading.id && body.classList.contains('open')) {
          rememberedOpenIds.push(heading.id);
        }
      });
      return rememberedOpenIds.slice();
    }

    function inlineTableImageStyles(table, clone) {
      var originals = [table].concat(Array.prototype.slice.call(table.querySelectorAll('*')));
      var copies = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
      for (var i = 0; i < originals.length; i++) {
        var computed = win.getComputedStyle(originals[i]);
        for (var j = 0; j < TABLE_IMAGE_STYLE_PROPS.length; j++) {
          var property = TABLE_IMAGE_STYLE_PROPS[j];
          copies[i].style.setProperty(property, computed.getPropertyValue(property));
        }
      }
    }

    function tableToPngBlob(table, scale) {
      return new Promise(function (resolve, reject) {
        if (!active(table)) {
          reject(new Error('Table is no longer available'));
          return;
        }
        var rect = table.getBoundingClientRect();
        var width = Math.max(1, Math.ceil(rect.width));
        var height = Math.max(1, Math.ceil(rect.height));
        var clone = table.cloneNode(true);
        inlineTableImageStyles(table, clone);
        clone.querySelectorAll('.table-copy-btn, .sdoc-card, .sdoc-table-add')
          .forEach(function (element) { element.remove(); });
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        clone.style.setProperty('margin', '0');
        clone.style.setProperty('width', width + 'px');
        var html = new win.XMLSerializer().serializeToString(clone);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'
          + '<foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';
        var url;
        try {
          url = 'data:image/svg+xml;base64,' + win.btoa(unescape(encodeURIComponent(svg)));
        } catch (error) {
          reject(error);
          return;
        }

        var image = new win.Image();
        image.onload = function () {
          if (!active(table)) {
            reject(new Error('Table is no longer available'));
            return;
          }
          try {
            var imageScale = scale || 2;
            var canvas = doc.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * imageScale));
            canvas.height = Math.max(1, Math.round(height * imageScale));
            var context = canvas.getContext('2d');
            var currentRoot = root();
            context.fillStyle = currentRoot ? win.getComputedStyle(currentRoot).backgroundColor : '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function (blob) {
              if (blob) resolve(blob);
              else reject(new Error('Table PNG creation failed'));
            }, 'image/png');
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = function () { reject(new Error('Table PNG rendering failed')); };
        image.src = url;
      });
    }

    function tableButton(table, kind) {
      var label = kind.toUpperCase();
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'table-copy-btn table-copy-' + kind + '-btn';
      setHTML(button, COPY_SVG + '<span class="table-copy-label">' + label + '</span>');
      button.title = 'Copy table as ' + label;
      button.setAttribute('aria-label', 'Copy table as ' + label);
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (kind === 'csv') {
          copyText(serializeTableCsv(tableRows(table)), button, label);
          return;
        }
        var clipboard = options.clipboard || (win.navigator && win.navigator.clipboard);
        var ClipboardItemApi = options.ClipboardItem || win.ClipboardItem;
        if (!ClipboardItemApi || !clipboard || !clipboard.write) {
          flashTableLabel(button, 'Not supported');
          return;
        }
        tableToPngBlob(table, 2).then(function (blob) {
          if (!active(button)) return null;
          return clipboard.write([new ClipboardItemApi({ 'image/png': blob })]);
        }).then(function (result) {
          if (result !== null && active(button)) flashButton(button, label);
        }).catch(function () {
          if (active(button)) flashTableLabel(button, 'Failed');
        });
      });
      return button;
    }

    function attachTables(container) {
      container.querySelectorAll('table').forEach(function (table) {
        var parent = table.parentNode;
        if (parent && parent.classList && parent.classList.contains('md-table-scroll')) return;
        var wrapper = doc.createElement('div');
        wrapper.className = 'md-table-scroll';
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
        if (!controls('copy') || !table.rows.length) return;
        var toolbar = doc.createElement('div');
        toolbar.className = 'md-table-toolbar';
        toolbar.appendChild(tableButton(table, 'csv'));
        toolbar.appendChild(tableButton(table, 'png'));
        wrapper.insertBefore(toolbar, table);
      });
    }

    function quoteText(quote) {
      var clone = quote.cloneNode(true);
      clone.querySelectorAll('.quote-copy-btn, .sdoc-card, .sdoc-gutter-add')
        .forEach(function (element) { element.remove(); });
      var parts = [];
      Array.prototype.forEach.call(clone.childNodes, function (node) {
        var value = node.nodeType === 1
          ? (node.innerText || node.textContent || '')
          : (node.textContent || '');
        value = value.trim();
        if (value) parts.push(value);
      });
      return parts.join('\n\n');
    }

    function attachBlockquotes(container) {
      if (!controls('copy')) return;
      container.querySelectorAll('blockquote').forEach(function (quote) {
        if (quote.classList.contains('sdoc-copyable-quote')) return;
        quote.classList.add('sdoc-copyable-quote');
        var button = doc.createElement('button');
        button.type = 'button';
        button.className = 'quote-copy-btn';
        setHTML(button, COPY_SVG);
        button.title = 'Copy quote';
        button.setAttribute('aria-label', 'Copy quote');
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          copyText(quoteText(quote), button, '');
        });
        quote.appendChild(button);
      });
    }

    function attach(container) {
      if (destroyed || !container) return;
      attachHeadings(container);
      attachTables(container);
      attachBlockquotes(container);
      attachSections(container);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      timers.forEach(function (timer) { win.clearTimeout(timer); });
      timers = [];
    }

    return {
      attach: attach,
      captureOpenIds: captureOpenIds,
      sectionIds: function () { return rememberedSectionIds.slice(); },
      destroy: destroy,
      openHeading: openHeading,
      setAllSectionsOpen: function (open) {
        var current = root();
        if (current) setAllSectionsOpen(current, open);
      },
      tableToPngBlob: tableToPngBlob
    };
  }

  exports.create = create;
  exports.sectionMarkdown = sectionMarkdown;
  exports.serializeTableCsv = serializeTableCsv;
  exports.tableRows = tableRows;
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocProseReader = window.SDocProseReader || {}));
