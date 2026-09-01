// sdocs-docwalk.js - pure model for an agent-authored Markdown walkthrough.
//
// The CLI stores ordered, 1-based source-line annotations in front matter.
// This module uses marked's top-level lexer tokens to translate those source
// lines into rendered-document targets. Ordinary prose resolves through the
// same tag:index block vocabulary as comments. Rich fenced blocks resolve to
// their finished reader wrappers. Ordinary code fences retain their source-line
// geometry so the reader can place a card directly below the relevant line.
(function (exports) {
'use strict';

var MAX_STEPS = 300;

var RICH_FENCES = {
  chart:   { kind: 'block', type: 'chart' },
  mermaid: { kind: 'rich', selector: '.sdoc-mermaid', label: 'diagram' },
  cells:   { kind: 'rich', selector: '.sdoc-cells', label: 'sheet' },
  slide:   { kind: 'rich', selector: '.sdoc-slide', label: 'slide' },
  slides:  { kind: 'rich', selector: '.sdoc-slide', label: 'slide' },
  form:    { kind: 'rich', selector: '.sdoc-form-host', label: 'form' },
  video:   { kind: 'rich', selector: '.sdoc-video', label: 'video' },
  'sdoc-app': { kind: 'rich', selector: '.sdoc-app', label: 'runnable component' },
};

function str(value) { return typeof value === 'string' ? value : ''; }

function truthy(value) {
  if (value === true) return true;
  value = str(value).toLowerCase().trim();
  return value === 'true' || value === 'yes' || value === 'on' || value === '1';
}

function isDocwalk(meta) {
  return truthy(meta && meta.docwalk);
}

function lineAt(text, offset) {
  var line = 1;
  for (var i = 0; i < offset && i < text.length; i++) {
    if (text.charAt(i) === '\n') line++;
  }
  return line;
}

function nextIndex(counters, key) {
  var n = counters[key] || 0;
  counters[key] = n + 1;
  return n;
}

function descriptorFor(token, counters) {
  if (!token) return null;
  if (token.type === 'heading') {
    var heading = 'h' + parseInt(token.depth, 10);
    return { kind: 'block', type: heading, index: nextIndex(counters, heading) };
  }
  if (token.type === 'paragraph' || token.type === 'text') {
    return { kind: 'block', type: 'p', index: nextIndex(counters, 'p'), inline: true };
  }
  if (token.type === 'blockquote') {
    return { kind: 'block', type: 'blockquote', index: nextIndex(counters, 'blockquote') };
  }
  if (token.type === 'list') {
    var list = token.ordered ? 'ol' : 'ul';
    return { kind: 'block', type: list, index: nextIndex(counters, list) };
  }
  if (token.type === 'table') {
    return { kind: 'block', type: 'table', index: nextIndex(counters, 'table') };
  }
  if (token.type === 'hr') {
    return { kind: 'rich', selector: 'hr', label: 'divider', index: nextIndex(counters, 'hr') };
  }
  if (token.type === 'sdocsMathBlock') {
    var mathSelector = '.sdocs-math-display';
    return { kind: 'rich', selector: mathSelector, label: 'math block',
      index: nextIndex(counters, mathSelector) };
  }
  if (token.type === 'code') {
    var language = str(token.lang).trim().split(/\s+/)[0].toLowerCase();
    var rich = RICH_FENCES[language];
    if (rich) {
      var richKey = rich.kind === 'block' ? rich.type : rich.selector;
      return Object.assign({}, rich, { index: nextIndex(counters, richKey) });
    }
    var codeText = str(token.text).replace(/\n$/, '');
    return {
      kind: 'block', type: 'pre', index: nextIndex(counters, 'pre'),
      code: true, codeLineCount: Math.max(1, codeText.split('\n').length),
    };
  }
  return null;
}

function tokenTargets(body, lexer) {
  var tokens;
  try { tokens = lexer(body); } catch (_) { return []; }
  if (!Array.isArray(tokens)) return [];

  var counters = Object.create(null);
  var cursor = 0;
  var out = [];
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var raw = str(token && token.raw);
    var at = raw ? body.indexOf(raw, cursor) : cursor;
    if (at < 0) at = cursor;
    var desc = descriptorFor(token, counters);
    if (desc) {
      var content = raw.replace(/\n+$/, '');
      var startLine = lineAt(body, at);
      var endOffset = at + Math.max(0, content.length - 1);
      var endLine = lineAt(body, endOffset);
      out.push({
        startLine: startLine,
        endLine: Math.max(startLine, endLine),
        raw: raw,
        descriptor: desc,
      });
    }
    cursor = Math.max(cursor, at + raw.length);
  }
  return out;
}

function selectedSource(body, target, startLine, endLine) {
  if (!target.descriptor.inline) return '';
  var lines = body.replace(/\r\n?/g, '\n').split('\n');
  var from = Math.max(startLine, target.startLine) - 1;
  var to = Math.min(endLine, target.endLine);
  return lines.slice(from, to).join('\n').trim();
}

function targetKey(target) {
  var d = target.descriptor;
  return d.kind === 'block'
    ? 'block:' + d.type + ':' + d.index
    : 'rich:' + d.selector + ':' + d.index;
}

function targetsForRange(body, targets, startLine, endLine, annotation) {
  var hits = targets.filter(function (target) {
    return target.startLine <= endLine && target.endLine >= startLine;
  });
  // An annotation on a blank line belongs to the next rendered block. If it is
  // after the final block, use the preceding one. This keeps source line
  // numbers useful without turning whitespace into an orphaned step.
  if (!hits.length) {
    var next = targets.find(function (target) { return target.startLine > startLine; });
    if (next) hits = [next];
    else if (targets.length) hits = [targets[targets.length - 1]];
  }

  var seen = Object.create(null);
  var out = [];
  hits.forEach(function (target) {
    var key = targetKey(target);
    if (seen[key]) return;
    seen[key] = true;
    var d = Object.assign({}, target.descriptor);
    d.startLine = target.startLine;
    d.endLine = target.endLine;
    var quote = str(annotation && annotation.quote).trim();
    d.source = quote || selectedSource(body, target, startLine, endLine);
    if (d.code) {
      d.codeLine = Math.max(1, Math.min(d.codeLineCount, startLine - target.startLine));
      d.codeEndLine = Math.max(d.codeLine,
        Math.min(d.codeLineCount, endLine - target.startLine));
      d.quote = quote;
    }
    out.push(d);
  });
  return out;
}

function build(meta, body, lexer) {
  meta = meta || {};
  body = str(body).replace(/\r\n?/g, '\n');
  if (!isDocwalk(meta) || typeof lexer !== 'function') {
    return { steps: [], total: 0 };
  }
  var sourceTargets = tokenTargets(body, lexer);
  var lineCount = body ? body.split('\n').length : 0;
  var raw = Array.isArray(meta.annotations) ? meta.annotations : [];
  var steps = [];
  for (var i = 0; i < raw.length && steps.length < MAX_STEPS; i++) {
    var annotation = raw[i];
    if (!annotation) continue;
    var line = parseInt(annotation.line, 10);
    if (!(line >= 1) || line > lineCount) continue;
    var endLine = parseInt(annotation.endLine, 10);
    if (!(endLine >= line)) endLine = line;
    endLine = Math.min(endLine, lineCount);
    var text = str(annotation.text);
    if (!text.trim()) continue;
    var targets = targetsForRange(body, sourceTargets, line, endLine, annotation);
    if (!targets.length) continue;
    steps.push({
      line: line,
      endLine: endLine,
      text: text,
      targets: targets,
      index: steps.length,
    });
  }
  return { steps: steps, total: steps.length };
}

function clamp(index, total) {
  if (total <= 0) return -1;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

exports.build = build;
exports.clamp = clamp;
exports.isDocwalk = isDocwalk;
exports.MAX_STEPS = MAX_STEPS;

})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocDocwalk = {}));
