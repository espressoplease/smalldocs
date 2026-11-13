// Source-backed reader interactions. Generated controls never become source HTML.
(function (exports) {
  'use strict';
  function fences(source, language) {
    var lines = String(source).match(/[^\n]*\n|[^\n]+$/g) || [];
    var at = 0, open = null, result = [];
    lines.forEach(function (line) {
      var text = line.replace(/\r?\n$/, '');
      if (!open) {
        var match = text.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
        if (match) open = { start: at, contentStart: at + line.length,
          delimiter: match[1], info: match[2].trim(), eol: /\r\n$/.test(line) ? '\r\n' : '\n' };
      } else if (new RegExp('^ {0,3}' + open.delimiter[0] + '{' + open.delimiter.length + ',}\\s*$').test(text)) {
        open.contentEnd = at;
        open.end = at + line.length;
        open.content = source.slice(open.contentStart, at);
        if (open.info.split(/\s/)[0] === language) result.push(open);
        open = null;
      }
      at += line.length;
    });
    return result;
  }
  function equivalent(left, right) {
    return String(left).replace(/\r\n?/g, '\n').replace(/\n$/, '') ===
      String(right).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  }
  function replaceFence(source, language, index, expected, next) {
    var block = fences(source, language)[index];
    if (!block || !equivalent(block.content, expected)) return null;
    var content = String(next).replace(/\r\n?/g, '\n').replace(/\n$/, '') + '\n';
    var size = block.delimiter.length;
    var closing = new RegExp('^ {0,3}(' + block.delimiter[0] + '{3,})\\s*$', 'gm'), match;
    while ((match = closing.exec(content))) size = Math.max(size, match[1].length + 1);
    var delimiter = block.delimiter[0].repeat(size);
    var trailing = /\n$/.test(source.slice(block.start, block.end)) ? block.eol : '';
    var replacement = delimiter + block.info + block.eol + content.replace(/\n/g, block.eol) + delimiter + trailing;
    return source.slice(0, block.start) + replacement + source.slice(block.end);
  }
  function appState(source) {
    var match = String(source).match(/<script\b(?=[^>]*\bid=["']sdoc-state["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
    if (!match) return {};
    try { var value = JSON.parse(match[1]); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (_) { return {}; }
  }
  function setAppState(source, value) {
    var json = JSON.stringify(value).replace(/</g, '\\u003c');
    var pattern = /<script\b(?=[^>]*\bid=["']sdoc-state["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>[\s\S]*?<\/script\s*>/i;
    var state = '<script type="application/json" id="sdoc-state">' + json + '</script>';
    if (pattern.test(source)) return source.replace(pattern, function () { return state; });
    if (/<head\b[^>]*>/i.test(source)) return source.replace(/<head\b[^>]*>/i, function (head) { return head + state; });
    return state + '\n' + source;
  }
  function appDefinition(source) {
    return source.replace(/<script\b(?=[^>]*\bid=["']sdoc-state["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>[\s\S]*?<\/script\s*>/i, '').trim();
  }
  function mergeState(base, current, proposed, conflicts, path) {
    if (JSON.stringify(current) === JSON.stringify(base)) return proposed;
    if (JSON.stringify(proposed) === JSON.stringify(base) || JSON.stringify(current) === JSON.stringify(proposed)) return current;
    function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
    if (!record(current) || !record(proposed)) {
      if (conflicts) conflicts.push({ kind:'interaction', source:path || 'state', base:base, current:current, proposed:proposed });
      return proposed;
    }
    var result = {};
    function own(value, key) { return value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined; }
    Array.from(new Set(Object.keys(current).concat(Object.keys(proposed), Object.keys(base || {})))).forEach(function (key) {
      var value = mergeState(own(base, key), own(current, key), own(proposed, key), conflicts, (path || 'state') + '.' + key);
      if (value !== undefined) Object.defineProperty(result, key, { value: value, enumerable: true, configurable: true, writable: true });
    });
    return result;
  }
  exports.fences = fences;
  exports.replaceFence = replaceFence;
  exports.appState = appState;
  exports.setAppState = setAppState;
  exports.appDefinition = appDefinition;
  exports.mergeState = mergeState;
  if (typeof window !== 'undefined' && window.SDocs) {
    var S = window.SDocs;
    S.hasActiveReaderInteraction = function () {
      var active = window.document.activeElement;
      return !!(active && active.closest && active.closest('.sdoc-form, .sdoc-app-frame') ||
        S.cellsFocus && S.cellsFocus.isEditing());
    };
    S.replaceInteractiveBlock = function (language, index, expected, next) {
      if (S.bridge && S.bridge._staticReadOnly) return false;
      var body = replaceFence(S.currentBody, language, index, expected, next);
      if (body === null) {
        if (S.setStatus) S.setStatus('This control has changed. Reopen the document before editing it.');
        return false;
      }
      if (body !== S.currentBody) { S.currentBody = body; S.syncAll('interaction'); }
      return true;
    };
  }
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocInteractions = {}));
