// sdocs-prose-reader.js - shared table and blockquote reader controls.
(function (exports) {
  'use strict';

  var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var COPY_FEEDBACK_MS = 1500;
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

  function create(options) {
    options = options || {};
    var doc = options.document || document;
    var win = options.window || window;
    var destroyed = false;
    var timers = [];

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

    function schedule(callback) {
      var timer = win.setTimeout(function () {
        timers = timers.filter(function (candidate) { return candidate !== timer; });
        callback();
      }, COPY_FEEDBACK_MS);
      timers.push(timer);
    }

    function flashButton(button, label) {
      var suffix = label ? '<span class="table-copy-label">' + label + '</span>' : '';
      setHTML(button, CHECK_SVG + suffix);
      schedule(function () {
        if (active(button)) setHTML(button, COPY_SVG + suffix);
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

    function copyText(text, button, label) {
      var clipboard = options.clipboard || (win.navigator && win.navigator.clipboard);
      if (!clipboard || !clipboard.writeText) return Promise.resolve(false);
      return clipboard.writeText(text).then(function () {
        if (active(button)) flashButton(button, label);
        return true;
      }).catch(function () { return false; });
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
      attachTables(container);
      attachBlockquotes(container);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      timers.forEach(function (timer) { win.clearTimeout(timer); });
      timers = [];
    }

    return {
      attach: attach,
      destroy: destroy,
      tableToPngBlob: tableToPngBlob
    };
  }

  exports.create = create;
  exports.serializeTableCsv = serializeTableCsv;
  exports.tableRows = tableRows;
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocProseReader = window.SDocProseReader || {}));
