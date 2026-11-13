// Markdown task controls. Positions refer to the original source, not DOM text.
(function (exports) {
  'use strict';

  function taskPositions(markdown, marked) {
    var original = String(markdown);
    var offsets = [];
    var source = original.replace(/\r\n?|[^\r]/g, function (part, offset) {
      offsets.push(offset);
      return part.charAt(0) === '\r' ? '\n' : part;
    });
    var positions = [];

    // Marked removes quote prefixes and list indentation from child tokens.
    // Match their raw lines within their parent's source range, retaining the
    // original offsets. Code and HTML tokens are consumed without visiting them.
    function locate(raw, start, end) {
      var exact = source.indexOf(raw, start);
      if (exact !== -1 && exact + raw.length <= end) {
        return { start: exact, end: exact + raw.length };
      }
      var cursor = start;
      var first = null;
      var last = start;
      var lines = raw.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var at = source.indexOf(line, cursor);
        if (at === -1 || at + line.length > end) return null;
        if (first === null) first = at;
        last = at + line.length;
        cursor = source.indexOf('\n', last);
        if (cursor === -1) cursor = end;
        else cursor += 1;
      }
      return first === null ? null : { start: first, end: last };
    }

    function visit(tokens, start, end) {
      var cursor = start;
      (tokens || []).forEach(function (token) {
        if (!token.raw) return;
        var range = locate(token.raw, cursor, end);
        if (!range) return;
        cursor = range.end;
        if (token.type === 'list_item' && token.task) {
          var marker = source.slice(range.start, range.end).match(/^[ \t]*(?:[*+-]|\d{1,9}[.)])[ \t]+\[([ xX])\]/);
          if (marker) positions.push(offsets[range.start + marker[0].length - 2]);
        }
        if (token.type === 'list') visit(token.items, range.start, range.end);
        if (token.type === 'list_item' || token.type === 'blockquote') {
          visit(token.tokens, range.start, range.end);
        }
      });
    }
    visit(marked.lexer(source), 0, source.length);
    return positions;
  }

  function attach(root, options) {
    var snapshot = options.getMarkdown();
    var positions = taskPositions(snapshot, options.marked);
    // Render only parser-generated task inputs with a private marker, so raw
    // HTML checkboxes cannot shift the source positions of Markdown tasks.
    root.querySelectorAll('input[data-sdoc-task]').forEach(function (input) {
      var index = Number(input.getAttribute('data-sdoc-task'));
      var position = positions[index];
      if (position == null) return;
      input.disabled = options.canEdit ? !options.canEdit() : false;
      var item = input.closest('li');
      if (item) {
        var label = item.cloneNode(true);
        label.querySelectorAll('ul, ol, .sdoc-card, button').forEach(function (node) { node.remove(); });
        input.setAttribute('aria-label', label.textContent.trim() || 'Task');
      }
      input.addEventListener('change', function () {
        var current = options.getMarkdown();
        if ((options.canEdit && !options.canEdit()) || current !== snapshot) {
          input.checked = snapshot.charAt(position).toLowerCase() === 'x';
          return;
        }
        snapshot = current.slice(0, position) + (input.checked ? 'x' : ' ') + current.slice(position + 1);
        // The shared snapshot keeps sibling controls current without replacing
        // the DOM, preserving focus and other interactive views.
        options.setMarkdown(snapshot);
        input.toggleAttribute('checked', input.checked);
        options.onChange();
      });
    });
  }

  function render(markdown, marked) {
    var index = 0;
    // Preserve the app's codewalk and cells renderer extensions.
    var renderer = Object.create(marked.defaults.renderer || new marked.Renderer());
    renderer.checkbox = function (checked) {
      return '<input type="checkbox" disabled data-sdoc-task="' + index++ + '"'
        + (checked ? ' checked' : '') + '>';
    };
    return marked.parse(markdown, { renderer: renderer });
  }

  exports.taskPositions = taskPositions;
  exports.attach = attach;
  exports.render = render;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocTasks = {}));
