'use strict';

(function (exports) {
// Every selection and edit resolves against the original Markdown. Only after
// all operations have matched and their changed ranges are disjoint do we write.
const CANDIDATE_LIMIT = 8;
const SELECTOR_KEYS = ['section', 'lines', 'outline'];
const EDIT_KEYS = ['op', 'old_text', 'new_text', 'text', 'section', 'lines', 'occurrence', 'all', 'context_before', 'context_after'];

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.assign(code === 'invalid_request' ? { field: 'edit' } : {}, details || {});
  throw error;
}

function validateKeys(value, allowed, label, operationIndex) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail('invalid_request', label + ' contains an unknown field: ' + unknown[0].slice(0, 80) + '.',
    { operation_index: operationIndex, unknown_fields: unknown.slice(0, CANDIDATE_LIMIT).map(key => key.slice(0, 80)) });
}

function textSummary(text, start, end) {
  const first = start === undefined ? 0 : start;
  const last = end === undefined ? text.length : end;
  let bytes = 0;
  for (let i = first; i < last; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < last &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return { bytes, length: last - first, first: text.charCodeAt(first), last: text.charCodeAt(last - 1) };
}

function appendSummary(target, part) {
  if (!part.length) return;
  target.bytes += part.bytes;
  if (target.length && target.last >= 0xd800 && target.last <= 0xdbff && part.first >= 0xdc00 && part.first <= 0xdfff) {
    target.bytes -= 2;
  }
  if (!target.length) target.first = part.first;
  target.last = part.last;
  target.length += part.length;
}

function editBudget(options) {
  const maxBytes = options && options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    fail('invalid_request', 'maxBytes must be a nonnegative safe integer.');
  }
  let minimumAdded = 0;
  return {
    maxBytes,
    summary: text => maxBytes === undefined ? null : textSummary(text),
    add(part, operationIndex) {
      if (maxBytes === undefined || !part.length) return;
      // Each inserted fragment can save at most two bytes at either boundary
      // by pairing surrogates. Later deletions cannot remove inserted text.
      minimumAdded += part.bytes - (part.first >= 0xdc00 && part.first <= 0xdfff ? 2 : 0) -
        (part.last >= 0xd800 && part.last <= 0xdbff ? 2 : 0);
      if (minimumAdded > maxBytes) this.exceeded(minimumAdded, operationIndex);
    },
    exceeded(bytes, operationIndex) {
      fail('file_too_large', 'The edited document exceeds the permitted byte size.',
        { max_bytes: maxBytes, minimum_bytes: bytes, operation_index: operationIndex });
    },
  };
}

function contextMatches(markdown, edit, start, end) {
  return (edit.context_before === undefined || markdown.slice(Math.max(0, start - edit.context_before.length), start) === edit.context_before) &&
    (edit.context_after === undefined || markdown.slice(end, end + edit.context_after.length) === edit.context_after);
}

function source(value) {
  if (typeof value !== 'string') fail('invalid_request', 'Markdown must be a string.');
  // Retain only 32-bit source offsets. Line-dense documents must not allocate
  // millions of strings and objects before a targeted edit can be resolved.
  const starts = [];
  let count = 0;
  let crlfCount = 0;
  let lfCount = 0;
  for (let start = 0; start < value.length;) {
    if ((count & 4095) === 0) starts.push(new Uint32Array(4096));
    starts[count >> 12][count & 4095] = start;
    count += 1;
    const newline = value.indexOf('\n', start);
    if (newline === -1) break;
    if (newline > start && value.charCodeAt(newline - 1) === 13) crlfCount += 1;
    else lfCount += 1;
    start = newline + 1;
  }
  return { markdown: value, starts, line_count: count, crlf_count: crlfCount, lf_count: lfCount, headings: null };
}

function lineStart(model, index) {
  return index < model.line_count ? model.starts[index >> 12][index & 4095] : model.markdown.length;
}

function lineEol(model, index) {
  const end = lineStart(model, index + 1);
  if (model.markdown.charCodeAt(end - 1) !== 10) return '';
  return end - 2 >= lineStart(model, index) && model.markdown.charCodeAt(end - 2) === 13 ? '\r\n' : '\n';
}

function lineText(model, index) {
  return model.markdown.slice(lineStart(model, index), lineStart(model, index + 1) - lineEol(model, index).length);
}

function line(model, index) {
  if (index < 0 || index >= model.line_count) return undefined;
  return { start: lineStart(model, index), end: lineStart(model, index + 1), text: lineText(model, index), eol: lineEol(model, index) };
}

function headings(model) {
  if (model.headings) return model.headings;
  const result = [];
  const stack = [];
  const total = model.line_count;
  let fence = null;
  let paragraphStart = null;
  let frontMatterEnd = -1;
  if (total && lineText(model, 0) === '---') {
    for (let i = 1; i < total; i += 1) {
      if (/^(---|\.\.\.)\s*$/.test(lineText(model, i))) { frontMatterEnd = i; break; }
    }
  }
  function add(title, level, start, headingEnd) {
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop().end_line = start;
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    const entry = { heading: title, title, path: parent ? parent.path + ' > ' + title : title,
      level, start_line: start + 1, end_line: total, heading_end_line: headingEnd + 1 };
    result.push(entry);
    stack.push(entry);
  }
  for (let i = 0; i < total; i += 1) {
    const text = lineText(model, i);
    if (i <= frontMatterEnd) continue;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      paragraphStart = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], length: open[1].length };
      paragraphStart = null;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    if (atx) {
      add((atx[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim(), atx[1].length, i, i);
      paragraphStart = null;
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(text);
    if (setext && paragraphStart !== null) {
      const parts = [];
      for (let j = paragraphStart; j < i; j += 1) parts.push(lineText(model, j).trim());
      add(parts.join(' '), setext[1][0] === '=' ? 1 : 2, paragraphStart, i);
      paragraphStart = null;
      continue;
    }
    if (!text.trim() || /^(?: {4}|\t| {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|<|(?:[-*_][ \t]*){3,}$))/.test(text)) {
      paragraphStart = null;
    } else if (paragraphStart === null) paragraphStart = i;
  }
  model.headings = result;
  return result;
}

function outline(markdown) {
  return headings(source(markdown)).map(entry => Object.assign({}, entry));
}

function lineAt(model, offset) {
  const total = model.line_count;
  if (!total) return 1;
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lineStart(model, middle) <= offset) low = middle + 1;
    else high = middle;
  }
  if (offset === model.markdown.length && model.markdown.endsWith('\n')) return total + 1;
  return Math.max(1, low);
}

function candidate(model, start, end) {
  const line = lineAt(model, start);
  const entries = headings(model);
  let section = null;
  for (let i = 0; i < entries.length && entries[i].start_line <= line; i += 1) {
    if (entries[i].end_line >= line) section = entries[i].path;
  }
  const text = model.markdown.slice(start, start + 240);
  return { line, section: section && section.slice(0, 240), excerpt: text.replace(/\s+/g, ' ').slice(0, 120) };
}

function errorDetails(model, operationIndex, matches, extra) {
  const details = Object.assign({ match_count: matches.length,
    candidates: matches.slice(0, CANDIDATE_LIMIT).map(match => candidate(model, match.start, match.end)) }, extra || {});
  if (operationIndex !== undefined) details.operation_index = operationIndex;
  if (details.match_count > CANDIDATE_LIMIT) details.candidates_truncated = true;
  return details;
}

function scope(model, selector, operationIndex) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    fail('invalid_request', 'A selector must be an object.', { operation_index: operationIndex });
  }
  let start = 0;
  let end = model.markdown.length;
  let startLine = 1;
  let endLine = model.line_count;
  let section = null;
  if (selector.lines !== undefined) {
    const range = typeof selector.lines === 'string' && /^(\d+):(\d+)$/.exec(selector.lines);
    const first = range && Number(range[1]);
    const last = range && Number(range[2]);
    if (!range || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > model.line_count) {
      fail('invalid_request', 'lines must be an inclusive start:end range within the document.',
        { operation_index: operationIndex, total_lines: model.line_count });
    }
    startLine = first;
    endLine = last;
    start = lineStart(model, first - 1);
    end = lineStart(model, last);
  }
  if (selector.section !== undefined) {
    if (typeof selector.section !== 'string' || !selector.section.trim()) {
      fail('invalid_request', 'section must be a heading title or full heading path.', { operation_index: operationIndex });
    }
    const name = selector.section.trim();
    const entries = headings(model);
    const named = entries.filter(entry => entry.path === name || entry.title === name);
    const matches = named.filter(entry => entry.start_line <= endLine && entry.end_line >= startLine);
    if (matches.length !== 1) {
      const candidates = matches.length ? matches : entries;
      const details = { section: name.slice(0, 240), match_count: matches.length,
        candidates: candidates.slice(0, CANDIDATE_LIMIT).map(entry => ({ line: entry.start_line,
          end_line: entry.end_line, section: entry.path.slice(0, 240), excerpt: entry.title.slice(0, 120) })) };
      if (operationIndex !== undefined) details.operation_index = operationIndex;
      if (candidates.length > CANDIDATE_LIMIT) details.candidates_truncated = true;
      fail(matches.length ? 'section_ambiguous' : 'section_not_found', matches.length
        ? 'More than one section matches. Use a full heading path or a line range.'
        : 'The requested section was not found.', details);
    }
    section = matches[0];
    startLine = Math.max(startLine, section.start_line);
    endLine = Math.min(endLine, section.end_line);
    start = lineStart(model, startLine - 1);
    end = lineStart(model, endLine);
  }
  return { start, end, start_line: startLine, end_line: endLine, section: section && section.path };
}

function select(markdown, selector) {
  const model = source(markdown);
  if (selector && typeof selector === 'object' && !Array.isArray(selector)) {
    validateKeys(selector, SELECTOR_KEYS, 'The selector');
    if (selector.outline !== undefined && typeof selector.outline !== 'boolean') {
      fail('invalid_request', 'outline must be a boolean.');
    }
  }
  const selected = scope(model, selector === undefined ? {} : selector);
  const result = { markdown: markdown.slice(selected.start, selected.end), start_line: selected.start_line,
    end_line: selected.end_line, total_lines: model.line_count };
  if (selected.section) result.section = selected.section;
  if (selector && selector.outline) result.outline = headings(model).map(entry => Object.assign({}, entry));
  return result;
}

function diagnostic(model, operationIndex, op, matches, changedCount, matchedCount) {
  const locations = matches.slice(0, CANDIDATE_LIMIT).map(match => ({
    start_line: lineAt(model, match.start),
    end_line: lineAt(model, match.end > match.start ? match.end - 1 : match.start),
  }));
  const count = matchedCount === undefined ? matches.length : matchedCount;
  const result = { operation_index: operationIndex, op, matched_count: count,
    changed_count: changedCount, locations };
  if (count > CANDIDATE_LIMIT) result.locations_truncated = true;
  return result;
}

function exactEdits(model, edits, budget) {
  const changes = [];
  const streams = [];
  const diagnostics = [];
  for (const [operationIndex, edit] of edits.entries()) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
      fail('invalid_request', 'Each edit must be an object.', { operation_index: operationIndex });
    }
    validateKeys(edit, EDIT_KEYS, 'The edit', operationIndex);
    const selected = scope(model, edit, operationIndex);
    const op = edit.op === undefined ? 'replace' : edit.op;
    if (op === 'append' || op === 'prepend') {
      if (typeof edit.text !== 'string' || edit.old_text !== undefined || edit.new_text !== undefined ||
          edit.occurrence !== undefined || edit.all !== undefined || edit.context_before !== undefined || edit.context_after !== undefined) {
        fail('invalid_request', 'append and prepend take text plus an optional section or lines selector.',
          { operation_index: operationIndex });
      }
      const position = op === 'append' ? selected.end : selected.start;
      const match = { start: position, end: position };
      if (edit.text) {
        const summary = budget.summary(edit.text);
        budget.add(summary, operationIndex);
        changes.push({ start: position, end: position, text: edit.text, summary, operation_index: operationIndex });
      }
      diagnostics.push(diagnostic(model, operationIndex, op, [match], edit.text ? 1 : 0));
      continue;
    }
    if (op !== 'replace' || edit.text !== undefined || typeof edit.old_text !== 'string' || !edit.old_text.length || typeof edit.new_text !== 'string') {
      fail('invalid_request', 'A replacement requires nonempty old_text and string new_text.', { operation_index: operationIndex });
    }
    if (edit.occurrence !== undefined && (!Number.isSafeInteger(edit.occurrence) || edit.occurrence < 1)) {
      fail('invalid_request', 'occurrence must be a positive integer.', { operation_index: operationIndex });
    }
    if ((edit.all !== undefined && typeof edit.all !== 'boolean') || (edit.all && edit.occurrence !== undefined)) {
      fail('invalid_request', 'Use either all: true or occurrence, not both.', { operation_index: operationIndex });
    }
    ['context_before', 'context_after'].forEach(key => {
      if (edit[key] !== undefined && typeof edit[key] !== 'string') {
        fail('invalid_request', key + ' must be a string.', { operation_index: operationIndex });
      }
    });
    const matches = [];
    let matchCount = 0;
    let occurrenceMatch = null;
    const changed = edit.old_text !== edit.new_text;
    const summary = changed ? budget.summary(edit.new_text) : null;
    let position = selected.start;
    while ((position = model.markdown.indexOf(edit.old_text, position)) !== -1 && position + edit.old_text.length <= selected.end) {
      const end = position + edit.old_text.length;
      if (contextMatches(model.markdown, edit, position, end)) {
        matchCount += 1;
        if (matches.length < CANDIDATE_LIMIT) matches.push({ start: position, end });
        if (edit.occurrence === matchCount) occurrenceMatch = { start: position, end };
        if (edit.all && changed) budget.add(summary, operationIndex);
      }
      position += 1;
    }
    if (!matchCount || (edit.occurrence !== undefined && edit.occurrence > matchCount)) {
      fail('edit_no_match', 'The requested text and context did not match the selected occurrence.',
        errorDetails(model, operationIndex, matches, { match_count: matchCount }));
    }
    if (matchCount > 1 && !edit.all && edit.occurrence === undefined) {
      fail('edit_ambiguous', 'More than one match was found. Add a selector, context, occurrence, or all: true.',
        errorDetails(model, operationIndex, matches, { match_count: matchCount }));
    }
    const chosen = edit.occurrence !== undefined ? [occurrenceMatch] : (edit.all ? matches : [matches[0]]);
    if (changed && edit.all) {
      streams.push({ start: selected.start, end: selected.end, old_text: edit.old_text, new_text: edit.new_text,
        context_before: edit.context_before, context_after: edit.context_after,
        summary, operation_index: operationIndex });
    } else if (changed) chosen.forEach(match => {
      budget.add(summary, operationIndex);
      changes.push({ start: match.start, end: match.end, text: edit.new_text, summary, operation_index: operationIndex });
    });
    const chosenCount = edit.all ? matchCount : chosen.length;
    diagnostics.push(diagnostic(model, operationIndex, op, chosen, changed ? chosenCount : 0, chosenCount));
  }
  return { changes, streams, diagnostics };
}

function parsePatch(patch) {
  if (typeof patch !== 'string' || !patch.trim()) fail('invalid_patch', 'patch must be a nonempty unified diff string.');
  let lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  // Structural lines identify transport CRLF. With LF transport, a CR on a
  // content line belongs to the document and can express a newline conversion.
  const structural = lines.find(line => /^@@ /.test(line));
  if (structural && structural.endsWith('\r')) lines = lines.map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
  const hunks = [];
  let headerCount = 0;
  let diffCount = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i += 1; continue; }
    if (/^diff --git /.test(line)) {
      diffCount += 1;
      if (diffCount > 1 || hunks.length) fail('invalid_patch', 'A patch must describe one Markdown document.');
      i += 1;
      continue;
    }
    if (/^--- /.test(line)) {
      if (headerCount || hunks.length || !/^\+\+\+ /.test(lines[i + 1] || '')) {
        fail('invalid_patch', 'A patch must contain one paired file header.');
      }
      headerCount += 1;
      i += 2;
      continue;
    }
    if (!hunks.length && /^(?:index |new file mode |deleted file mode |old mode |new mode )/.test(line)) { i += 1; continue; }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (!header) fail('invalid_patch', 'Expected a unified diff hunk header.', { patch_line: i + 1 });
    const hunk = { oldStart: Number(header[1]), oldCount: header[2] === undefined ? 1 : Number(header[2]),
      newStart: Number(header[3]), newCount: header[4] === undefined ? 1 : Number(header[4]), entries: [] };
    const operationIndex = hunks.length;
    if (![hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount].every(Number.isSafeInteger) ||
        (!hunk.oldStart && hunk.oldCount) || (!hunk.newStart && hunk.newCount) || (!hunk.oldCount && !hunk.newCount)) {
      fail('invalid_patch', 'Invalid unified diff line coordinates.', { operation_index: operationIndex });
    }
    i += 1;
    let oldCount = 0;
    let newCount = 0;
    while (i < lines.length) {
      const body = lines[i];
      if (body === '\\ No newline at end of file') {
        const previous = hunk.entries[hunk.entries.length - 1];
        if (!previous || previous.noNewline) fail('invalid_patch', 'A no-newline marker must follow a content line.', { operation_index: operationIndex });
        previous.noNewline = true;
        i += 1;
        continue;
      }
      if (oldCount === hunk.oldCount && newCount === hunk.newCount) break;
      if (!/^[ +\-]/.test(body)) fail('invalid_patch', 'Hunk content does not match its declared line counts.',
        { operation_index: operationIndex, patch_line: i + 1 });
      const type = body[0];
      hunk.entries.push({ type, text: body.slice(1), noNewline: false });
      if (type !== '+') oldCount += 1;
      if (type !== '-') newCount += 1;
      if (oldCount > hunk.oldCount || newCount > hunk.newCount) fail('invalid_patch', 'Hunk content exceeds its declared line counts.',
        { operation_index: operationIndex });
      i += 1;
    }
    if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) fail('invalid_patch', 'Hunk content does not match its declared line counts.',
      { operation_index: operationIndex });
    ['old', 'new'].forEach(side => {
      const entries = hunk.entries.filter(entry => entry.type !== (side === 'old' ? '+' : '-'));
      if (entries.slice(0, -1).some(entry => entry.noNewline)) fail('invalid_patch', 'A no-newline marker must describe the final line on its side of a hunk.',
        { operation_index: operationIndex });
    });
    hunks.push(hunk);
  }
  if (!hunks.length) fail('invalid_patch', 'The patch contains no hunks.');
  const explicitEol = hunks.some(hunk => hunk.entries.some(entry => !entry.noNewline && entry.text.endsWith('\r')));
  hunks.forEach(hunk => {
    hunk.explicitEol = explicitEol;
    hunk.entries.forEach(entry => {
      entry.eol = entry.noNewline ? '' : (entry.text.endsWith('\r') ? '\r\n' : '\n');
      if (entry.eol === '\r\n') entry.text = entry.text.slice(0, -1);
    });
  });
  return hunks;
}

function patchEdits(model, patch, budget) {
  const hunks = parsePatch(patch);
  const changes = [];
  const diagnostics = [];
  const defaultEol = model.crlf_count > model.lf_count ? '\r\n' : '\n';
  function offset(lineIndex) { return lineStart(model, lineIndex); }
  hunks.forEach((hunk, operationIndex) => {
    const old = hunk.entries.filter(entry => entry.type !== '+');
    const matches = [];
    let matchCount = 0;
    function addMatch(match) { matchCount += 1; if (matches.length < CANDIDATE_LIMIT) matches.push(match); }
    if (!old.length) {
      // With no context, only the document boundaries identify an insertion.
      if (hunk.oldStart === 0) addMatch({ start: 0, end: 0, lineIndex: 0 });
      else if (hunk.oldStart === model.line_count) addMatch({ start: model.markdown.length, end: model.markdown.length,
        lineIndex: model.line_count });
      else fail('invalid_patch', 'An insertion inside a document needs unchanged context lines.', { operation_index: operationIndex });
      if (matches[0].lineIndex && !model.markdown.endsWith('\n')) {
        fail('invalid_patch', 'To append after an unterminated line, include that line in the replacement hunk.', { operation_index: operationIndex });
      }
    } else {
      // Prefix matching avoids rescanning long, repeated context at every line.
      const prefix = new Array(old.length).fill(0);
      function same(left, right) { return left.text === right.text && left.noNewline === right.noNewline &&
        (!hunk.explicitEol || left.eol === right.eol); }
      for (let i = 1, length = 0; i < old.length; i += 1) {
        while (length && !same(old[i], old[length])) length = prefix[length - 1];
        if (same(old[i], old[length])) length += 1;
        prefix[i] = length;
      }
      for (let i = 0, length = 0; i < model.line_count; i += 1) {
        const text = lineText(model, i);
        const eol = lineEol(model, i);
        function matchesLine(entry) { return entry.text === text && entry.noNewline === !eol &&
          (!hunk.explicitEol || entry.eol === eol); }
        while (length && !matchesLine(old[length])) length = prefix[length - 1];
        if (matchesLine(old[length])) length += 1;
        if (length === old.length) {
          const start = i + 1 - old.length;
          addMatch({ start: offset(start), end: offset(i + 1), lineIndex: start });
          length = prefix[length - 1];
        }
      }
    }
    if (!matchCount) fail('edit_no_match', 'The patch context or removed text does not match the document.',
      errorDetails(model, operationIndex, matches));
    if (matchCount > 1) fail('edit_ambiguous', 'The patch context matches more than one location. Include more context.',
      errorDetails(model, operationIndex, matches, { match_count: matchCount }));
    const matched = matches[0];
    const newEntries = hunk.entries.filter(entry => entry.type !== '-');
    if (newEntries.some(entry => entry.noNewline) && matched.lineIndex + old.length !== model.line_count) {
      fail('invalid_patch', 'A new line without a newline must be at the end of the document.', { operation_index: operationIndex });
    }
    let localEol = '';
    for (let i = matched.lineIndex; i < matched.lineIndex + old.length && !localEol; i += 1) localEol = lineEol(model, i);
    if (!localEol) localEol = (matched.lineIndex < model.line_count && lineEol(model, matched.lineIndex)) ||
      (matched.lineIndex > 0 && lineEol(model, matched.lineIndex - 1)) || defaultEol;
    let cursor = matched.lineIndex;
    let run = null;
    let changedCount = 0;
    function flush() {
      if (!run) return;
      function eol(entry, index) { return entry.noNewline ? '' :
        (hunk.explicitEol ? entry.eol : (run.removed[index] && run.removed[index].eol || localEol)); }
      if (run.added.length === run.removed.length && run.added.every((entry, index) =>
        entry.text === run.removed[index].text && eol(entry, index) === run.removed[index].eol)) { run = null; return; }
      const summary = budget.maxBytes === undefined ? null : { bytes: 0, length: 0 };
      if (summary) {
        run.added.forEach((entry, index) => {
          appendSummary(summary, textSummary(entry.text));
          appendSummary(summary, textSummary(eol(entry, index)));
        });
        budget.add(summary, operationIndex);
      }
      const text = run.added.map((entry, index) => entry.text + eol(entry, index)).join('');
      changes.push({ start: run.start, end: run.end, text, summary, operation_index: operationIndex });
      changedCount += 1;
      run = null;
    }
    hunk.entries.forEach(entry => {
      if (entry.type === ' ') { flush(); cursor += 1; return; }
      if (!run) run = { start: offset(cursor), end: offset(cursor), added: [], removed: [] };
      if (entry.type === '-') {
        run.removed.push(line(model, cursor));
        cursor += 1;
        run.end = offset(cursor);
      } else run.added.push(entry);
    });
    flush();
    diagnostics.push(diagnostic(model, operationIndex, 'patch', [matched], changedCount));
  });
  return { changes, diagnostics };
}

function forEachChange(model, plan, visit) {
  // Only one cursor per operation is retained, even for millions of matches.
  // A heap merges original-position streams without expanding them into objects.
  const heap = [];
  function compare(left, right) { return left.value.start - right.value.start || left.value.end - right.value.end; }
  function push(node) {
    let i = heap.length;
    heap.push(node);
    while (i) {
      const parent = (i - 1) >> 1;
      if (compare(heap[parent], node) <= 0) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  }
  function pop() {
    const first = heap[0];
    const last = heap.pop();
    if (!heap.length) return first;
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child += 1;
      if (compare(last, heap[child]) <= 0) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
    return first;
  }
  let ordinaryIndex = 0;
  const ordinary = { next() { this.value = plan.changes[ordinaryIndex++]; return !!this.value; } };
  if (ordinary.next()) push(ordinary);
  (plan.streams || []).forEach(edit => {
    let position = edit.start;
    const node = { value: { start: 0, end: 0, text: edit.new_text, summary: edit.summary, operation_index: edit.operation_index },
      next() {
        while ((position = model.markdown.indexOf(edit.old_text, position)) !== -1 && position + edit.old_text.length <= edit.end) {
          const start = position;
          const end = position + edit.old_text.length;
          position += 1;
          if (contextMatches(model.markdown, edit, start, end)) {
            this.value.start = start;
            this.value.end = end;
            return true;
          }
        }
        return false;
      },
    };
    if (node.next()) push(node);
  });
  while (heap.length) {
    const node = pop();
    visit(node.value);
    if (node.next()) push(node);
  }
}

function validatePlan(model, plan, budget) {
  let previousStart = -1;
  let previousEnd = -1;
  let previousOperation;
  let cursor = 0;
  const size = { bytes: 0, length: 0 };
  forEachChange(model, plan, change => {
    if (previousEnd > change.start || (previousStart === previousEnd && change.start === change.end && previousStart === change.start)) {
      fail('overlapping_edits', 'Two edits change the same original text or insert at the same position.',
        errorDetails(model, change.operation_index, [{ start: previousStart, end: previousEnd }, change],
          { conflicting_operation_index: previousOperation }));
    }
    if (budget.maxBytes !== undefined) {
      if (change.start > cursor) appendSummary(size, textSummary(model.markdown, cursor, change.start));
      appendSummary(size, change.summary);
      if (size.bytes > budget.maxBytes) budget.exceeded(size.bytes, change.operation_index);
    }
    cursor = change.end;
    previousStart = change.start;
    previousEnd = change.end;
    previousOperation = change.operation_index;
  });
  if (budget.maxBytes !== undefined) {
    if (cursor < model.markdown.length) appendSummary(size, textSummary(model.markdown, cursor));
    if (size.bytes > budget.maxBytes) budget.exceeded(size.bytes, previousOperation);
  }
}

function materialize(model, plan) {
  if (!plan.changes.length && (!plan.streams || !plan.streams.length)) return model.markdown;
  const chunks = [];
  let parts = [];
  let length = 0;
  function append(text) {
    if (!text.length) return;
    parts.push(text);
    length += text.length;
    if (length >= 65536) { chunks.push(parts.join('')); parts = []; length = 0; }
  }
  let cursor = 0;
  forEachChange(model, plan, change => {
    append(model.markdown.slice(cursor, change.start));
    append(change.text);
    cursor = change.end;
  });
  append(model.markdown.slice(cursor));
  if (parts.length) chunks.push(parts.join(''));
  return chunks.join('');
}

function applyEdits(markdown, request, options) {
  const model = source(markdown);
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      (request.patch !== undefined) === (request.edits !== undefined)) {
    fail('invalid_request', 'Provide either edits or patch.');
  }
  validateKeys(request, ['edits', 'patch'], 'The request');
  if (request.edits !== undefined && !Array.isArray(request.edits)) fail('invalid_request', 'edits must be an array.');
  const budget = editBudget(options);
  const plan = request.patch !== undefined ? patchEdits(model, request.patch, budget) : exactEdits(model, request.edits, budget);
  plan.changes.sort((a, b) => a.start - b.start || a.end - b.end);
  validatePlan(model, plan, budget);
  return { markdown: materialize(model, plan), applied_edits: plan.diagnostics,
    matched_count: plan.diagnostics.reduce((sum, entry) => sum + entry.matched_count, 0) };
}

exports.outline = outline;
exports.select = select;
exports.applyEdits = applyEdits;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsTextEdit = {}));
