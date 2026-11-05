'use strict';
(function (exports) {
function lines(source) {
  var result = [], at = 0;
  String(source).split(/\n/).forEach(function (text) { result.push({ text: text.replace(/\r$/, ''), at: at }); at += text.length + 1; });
  return result;
}
function plainLabel(text) {
  return String(text).replace(/^"`?|`?"$/g, '').replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/#(\d+);/g, function (raw, n) { return Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : raw; }).replace(/\u200B/g, '').replace(/#quot;/g, '"');
}
function encodeLabel(text) {
  return String(text).replace(/[&#";\[\]{}()<>|%`\\]/g, function (c) { return '#' + c.codePointAt(0) + ';'; }).replace(/\r\n?|\n/g, '<br/>');
}
function replace(source, start, end, value) { return source.slice(0, start) + value + source.slice(end); }
function mermaidFields(source) {
  source = String(source);
  var fields = [], all = lines(source);
  if (/^\s*sequenceDiagram\b/m.test(source)) {
    var participants = new Set(), pending = new Map(), messageIndex = 0;
    all.forEach(function (line) {
      var text = line.text, actor = /^(\s*(?:create\s+)?(?:participant|actor)\s+)([^\s:;]+)(?:\s+as\s+(.*))?\s*$/.exec(text);
      if (actor) {
        participants.add(actor[2]);
        fields.push({ key: 'actor:' + actor[2], text: plainLabel(actor[3] || actor[2]), start: line.at, end: line.at + text.length,
          prefix: actor[1] + actor[2] + ' as ', suffix: '', kind: 'actor', id: actor[2] });
        return;
      }
      var msg = /^(\s*)([^\s:;]+?)\s*((?:<<)?-{1,2}(?:>>?|[x)]))\s*[+-]?([^\s:;]+)\s*:\s*(.*)$/.exec(text);
      if (!msg) return;
      [msg[2], msg[4]].forEach(function (id) { if (!pending.has(id)) pending.set(id, line.at); });
      var colon = text.indexOf(':');
      fields.push({ key: 'message:' + messageIndex++, text: plainLabel(msg[5]), start: line.at + colon + 1, end: line.at + text.length,
        prefix: ' ', suffix: '', kind: 'message' });
    });
    pending.forEach(function (at, id) {
      if (!participants.has(id)) fields.push({ key: 'actor:' + id, text: id, start: at, end: at,
        prefix: 'participant ' + id + ' as ', suffix: '\n', kind: 'actor', id: id });
    });
    return fields;
  }
  if (!/^\s*(?:flowchart|graph)\s+[A-Z]+\b/m.test(source)) return fields;
  // Scan explicit node labels, keeping shape delimiters and graph statements
  // outside the editable range. Quotes may contain delimiter characters.
  var shapes = [['(((', ')))'], ['[[', ']]'], ['((', '))'], ['([', '])'], ['[(', ')]'], ['{{', '}}'], ['[/', '/]'], ['[\\', '\\]'], ['(', ')'], ['[', ']'], ['{', '}'], ['>', ']']];
  all.forEach(function (line) {
    if (/^\s*(?:%%|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b)/.test(line.text)) return;
    var re = /[\p{L}\p{N}_][\p{L}\p{N}_-]*/gu, match;
    while ((match = re.exec(line.text))) {
      var at = re.lastIndex, pair = shapes.find(function (pair) { return line.text.slice(at, at + pair[0].length) === pair[0]; });
      if (!pair || pair[0] === '>' && /-$/.test(match[0])) continue;
      var start = at + pair[0].length, end = start, quoted = false;
      for (; end < line.text.length; end++) {
        if (line.text[end] === '"') quoted = !quoted;
        if (!quoted && line.text.slice(end, end + pair[1].length) === pair[1]) break;
      }
      if (end >= line.text.length) continue;
      var existing = fields.find(function (field) { return field.key === 'node:' + match[0]; });
      var field = { key: 'node:' + match[0], id: match[0], text: plainLabel(line.text.slice(start, end)),
        start: line.at + start, end: line.at + end, prefix: '"', suffix: '"', kind: 'node' };
      if (existing) Object.assign(existing, field); else fields.push(field);
      re.lastIndex = end + pair[1].length;
    }
  });
  return fields;
}
function implicitFlowField(source, key) {
  if (!key.startsWith('node:') || !/^\s*(?:flowchart|graph)\s+[A-Z]+\b/m.test(source)) return null;
  var id = key.slice(5), escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var pattern = new RegExp('(^|[^\\p{L}\\p{N}_-])(' + escaped + ')(?=$|--|-\\.|[\\s;<>.=&|+\\[\\](){}])', 'gu');
  var all = lines(source), labels = mermaidFields(source);
  for (var line of all) {
    if (/^\s*(?:%%|flowchart\b|graph\b|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b)/.test(line.text)) continue;
    pattern.lastIndex = 0;
    var match;
    while ((match = pattern.exec(line.text))) {
      var at = line.at + match.index + match[1].length;
      if (labels.some(function (field) { return at >= field.start && at < field.end; })) continue;
      if (/^\s*@\{/.test(line.text.slice(match.index + match[1].length + id.length))) continue;
      return { key: key, text: id, start: at + id.length, end: at + id.length, prefix: '["', suffix: '"]' };
    }
  }
  return null;
}
function mermaidField(source, key) {
  return mermaidFields(source).find(function (field) { return field.key === key; }) || implicitFlowField(source, key);
}
function setMermaidText(source, key, text) {
  var field = mermaidField(source, key);
  if (!field) throw new Error('Diagram text is no longer at this target.');
  if (field.text === String(text)) return source;
  return replace(source, field.start, field.end, field.prefix + (encodeLabel(text) || '#8203;') + field.suffix);
}
function slideFields(source, shapes) {
  var all = lines(source), slots = [], extendsTemplate = /^\s*@extends\b/m.test(source);
  if (extendsTemplate) {
    all.forEach(function (line, index) {
      var slot = /^#([A-Za-z][\w-]*)!?\s*:\s?(.*)$/.exec(line.text);
      if (!slot) return;
      slots.push({ key: 'slot:' + slot[1], id: slot[1], start: line.at, end: source.length, line: index,
        text: slot[2] === '|' ? '' : slot[2], kind: 'slot' });
    });
    slots.forEach(function (field, index) {
      var next = slots[index + 1]; field.end = next ? next.start : source.length;
      var following = all.slice(field.line + 1, next ? next.line : all.length).map(function (line) { return line.text; });
      var content = (field.text ? [field.text] : []).concat(following).join('\n').replace(/\s+$/, '');
      var nonblank = content.split('\n').filter(function (line) { return line.trim(); });
      var indent = nonblank.length ? Math.min.apply(null, nonblank.map(function (line) { return line.match(/^ */)[0].length; })) : 0;
      field.text = content.split('\n').map(function (line) { return line.slice(indent); }).join('\n');
    });
    return slots;
  }
  var parsed = shapes.parse(source);
  if (parsed.errors.length) return [];
  return parsed.shapes.map(function (shape, index) {
    if (shape.content == null) return null;
    var line = all[shape.lineNumber - 1], pipe = line.text.indexOf('|'), endLine = shape.lineNumber;
    while (endLine < all.length) {
      if (/^ {2}/.test(all[endLine].text)) { endLine++; continue; }
      if (!all[endLine].text.trim() && all.slice(endLine + 1).some(function (next) { return /^ {2}/.test(next.text); })) {
        var next = endLine + 1; while (next < all.length && !all[next].text.trim()) next++;
        if (next < all.length && /^ {2}/.test(all[next].text)) { endLine++; continue; }
      }
      break;
    }
    return { key: 'shape:' + index, id: shape.id, index: index, text: shape.content, kind: 'shape',
      start: line.at + pipe + 1, end: endLine < all.length ? all[endLine].at : source.length };
  }).filter(Boolean);
}
function setSlideText(source, field, text) {
  if (field.text === String(text)) return source;
  var eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (field.kind === 'slot') return replace(source, field.start, field.end, '#' + field.id + ': |' + eol + String(text).split(/\r?\n/).map(function (line) { return '  ' + line; }).join(eol) + eol);
  // Content always stays indented under the original shape specification.
  var encoded = String(text);
  return replace(source, field.start, field.end, eol + encoded.split(/\r?\n/).map(function (line) { return '  ' + line; }).join(eol) + (field.end < source.length || /\n$/.test(source) ? eol : ''));
}
function cellsSource(source, model, cells) {
  var all = String(source).split(/\r?\n/), index = 0;
  while (index < all.length && (!all[index].trim() || /^(?:sdoc-cells:|format:)/i.test(all[index]))) index++;
  var prefix = all.slice(0, index).join('\n');
  return (prefix ? prefix + '\n' : '') + cells.serializeCsv(model.cells.map(function (row) { return row.map(function (cell) { return cell.raw; }); })) + '\n';
}
exports.mermaidFields = mermaidFields;
exports.mermaidField = mermaidField;
exports.setMermaidText = setMermaidText;
exports.slideFields = slideFields;
exports.setSlideText = setSlideText;
exports.cellsSource = cellsSource;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocRichEdit = {}));
