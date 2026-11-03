'use strict';

// A read-only source projection. A source match says nothing about whether a
// renderer can still attach a visual comment to the same DOM node or shape.
const { Marked } = require('marked');
const del = require('../public/sdocs-marked-del-core');
const textEdit = require('../cli/shared/sdocs-text-edit');
const prose = require('../public/sdocs-comments');
const marked = new Marked(del.extension);
const cellsModel = require('../public/sdocs-cells');
const cellsController = require('../public/sdocs-cells-controller');
const cellsComments = require('../public/sdocs-cells-comments');
const diagramComments = require('../public/sdocs-diagram-comments');
const MAX_CONTEXT_CHARS = 2000;
const MAX_CONTEXT_LINES = 12;
const NON_ANCHOR = new Set(['id', 'uid', 'author', 'author_user_id', 'color', 'at', 'text',
  'updated_at', 'resolved', 'resolved_at', 'replies', 'sha256', 'status']);

function norm(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function entityText(value) {
  return String(value || '').replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (all, name) => {
    if (name[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()];
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}
function inlineText(tokens) {
  return (tokens || []).map(token => token.tokens ? inlineText(token.tokens)
    : token.type === 'br' ? ' ' : token.type === 'html' || token.type === 'image' ? '' : entityText(token.text)).join('');
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map(key => [key, clone(value[key])]));
  return value;
}
function anchorOf(comment) {
  const anchor = {};
  Object.keys(comment || {}).forEach(key => { if (!NON_ANCHOR.has(key)) anchor[key] = clone(comment[key]); });
  anchor.kind = anchor.kind || (anchor.slide != null ? 'slide' : anchor.quote ? 'inline' : 'block');
  for (const key of ['range', 'cells_rows', 'row_texts', 'column_texts', 'cell_values', 'row_cells']) {
    if (typeof anchor[key] === 'string') { try { anchor[key] = JSON.parse(anchor[key]); } catch (_) {} }
  }
  return anchor;
}
function indexNumber(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 && value !== '' && value != null ? Number(value) : -1; }
function blockRef(comment) {
  const match = /^([a-z][a-z0-9]*):(\d+)$/.exec(comment.block || '');
  return match ? { type: match[1], index: Number(match[2]) } : null;
}
function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function portableView(source, bodyStart) {
  const body = source.slice(bodyStart), imported = prose.parseFootnotes(body);
  if (!imported.comments.length) return { source, at: offset => offset, body };
  const ids = new Set(imported.comments.map(comment => comment.id));
  const removals = [], protectedRanges = [];
  let offset = bodyStart, fence = null, fenceStart = 0;
  (body.match(/[^\n]*\n|[^\n]+$/g) || []).forEach(line => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line.replace(/\n$/, ''));
    if (!fence && match) { fence = match[1]; fenceStart = offset; }
    else if (fence && match && match[1][0] === fence[0] && match[1].length >= fence.length && /^\s*$/.test(match[2])) {
      protectedRanges.push([fenceStart, offset + line.length]); fence = null;
    } else if (!fence && /^\[\^c\d+\]:/.test(line)) removals.push([offset, offset + line.length]);
    offset += line.length;
  });
  if (fence) protectedRanges.push([fenceStart, source.length]);
  function protectedAt(start, end) { return protectedRanges.some(range => start < range[1] && end > range[0]); }
  for (const match of source.slice(bodyStart).matchAll(/<!-- sdoc-comments:v1 ([^\s]+) -->/g)) {
    const start = bodyStart + match.index, end = start + match[0].length;
    if (protectedAt(start, end)) continue;
    try { if (Array.isArray(JSON.parse(decodeURIComponent(match[1])))) removals.push([start, end]); } catch (_) {}
  }
  const seen = new Set(), inlineRanges = [];
  for (const match of body.matchAll(/\[([^\]\n]+?)\]\[\^(c\d+)\]/g)) {
    const start = bodyStart + match.index, end = start + match[0].length;
    if (!ids.has(match[2]) || seen.has(match[2]) || protectedAt(start, end)) continue;
    seen.add(match[2]); inlineRanges.push([start, end]);
    removals.push([start, start + 1], [start + 1 + match[1].length, end]);
  }
  for (const match of body.matchAll(/\[\^(c\d+)\]/g)) {
    const start = bodyStart + match.index, end = start + match[0].length;
    if (ids.has(match[1]) && !protectedAt(start, end) && !inlineRanges.some(range => start >= range[0] && end <= range[1])) removals.push([start, end]);
  }
  removals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const runs = [], parts = [];
  let position = 0, length = 0;
  function keep(end) {
    if (end <= position) return;
    runs.push({ start: length, source: position, length: end - position });
    parts.push(source.slice(position, end)); length += end - position;
  }
  removals.forEach(range => { keep(range[0]); position = Math.max(position, range[1]); });
  keep(source.length);
  function at(pos) {
    let low = 0, high = runs.length;
    while (low < high) { const mid = (low + high) >>> 1; if (runs[mid].start <= pos) low = mid + 1; else high = mid; }
    const run = runs[Math.max(0, low - 1)];
    return run ? run.source + Math.min(run.length, Math.max(0, pos - run.start)) : source.length;
  }
  return { source: parts.join(''), at, body: imported.body };
}

function buildIndex(markdown, queries = []) {
  const original = String(markdown == null ? '' : markdown);
  const lines = original.match(/[^\n]*\n|[^\n]+$/g) || [];
  const clean = lines.map(line => line.replace(/\r?\n$/, ''));
  const starts = [];
  let offset = 0;
  clean.forEach(line => { starts.push(offset); offset += line.length + 1; });
  const source = clean.join('\n');
  function lineAt(pos) {
    let low = 0, high = starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= pos) low = mid + 1; else high = mid; }
    return Math.max(1, low);
  }
  let first = 0;
  if (clean[0] === '---') {
    const end = clean.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end >= 0) first = end + 1;
  }
  const bodyStart = starts[first] === undefined ? source.length : starts[first];
  const body = source.slice(bodyStart);
  const portable = portableView(source, bodyStart), lexSource = portable.source;
  const documentHash = prose.documentFingerprint(portable.body);
  const tokens = marked.lexer(lexSource.slice(bodyStart));
  const blocks = [], byType = new Map(), codeLines = new Map();
  const headings = textEdit.outline(original);
  let cursor = bodyStart;

  function projection(token, raw, rawStart) {
    let text = '', seek = 0;
    const charLines = [], charOffsets = [];
    function append(value, rawValue) {
      const parts = entityText(value).split('\n');
      const rawParts = String(rawValue || value || '').split('\n');
      parts.forEach((part, partIndex) => {
        const rawPart = rawParts[partIndex] || part;
        let at = rawPart ? raw.indexOf(rawPart, seek) : seek;
        if (at < 0) at = part ? raw.indexOf(part, seek) : seek;
        if (at < 0) at = seek;
        const line = lineAt(portable.at(rawStart + at));
        seek = Math.min(raw.length, at + rawPart.length);
        let rawCursor = 0;
        for (const char of part) {
          const rawChar = rawPart.indexOf(char, rawCursor);
          if (rawChar >= 0) rawCursor = rawChar;
          const charOffset = portable.at(rawStart + at + rawCursor);
          if (/\s/.test(char)) {
            if (text && text[text.length - 1] !== ' ') { text += ' '; charLines.push(line); charOffsets.push(charOffset); }
          } else {
            text += char;
            for (let i = 0; i < char.length; i += 1) { charLines.push(line); charOffsets.push(charOffset + i); }
          }
          rawCursor += char.length;
        }
        if (partIndex < parts.length - 1 && text && text[text.length - 1] !== ' ') {
          text += ' '; charLines.push(line); charOffsets.push(portable.at(rawStart + seek));
        }
      });
    }
    function walk(list) {
      (list || []).forEach(child => {
        if (child.items) child.items.forEach(item => { walk(item.tokens); append(' ', ''); });
        else if (child.tokens) walk(child.tokens);
        else if (child.type === 'br' || child.type === 'space') append(' ', child.raw);
        else if (child.type !== 'html' && child.type !== 'image') append(child.text || '', child.raw);
      });
    }
    if (token.type === 'table') {
      [token.header].concat(token.rows).forEach(row => { row.forEach(cell => { walk(cell.tokens); append(' ', ''); }); });
    } else if (token.items) token.items.forEach(item => { walk(item.tokens); append(' ', ''); });
    else if (token.tokens) walk(token.tokens);
    else append(token.text || '', token.text || raw);
    return { text: text.trimEnd(), charLines: Uint32Array.from(charLines), charOffsets: Uint32Array.from(charOffsets) };
  }

  tokens.forEach(token => {
    const raw = token.raw || '';
    const found = lexSource.indexOf(raw, cursor);
    const start = found >= 0 ? found : cursor;
    cursor = start + raw.length;
    let type = { paragraph: 'p', code: 'pre', blockquote: 'blockquote', table: 'table', list: token.ordered ? 'ol' : 'ul' }[token.type];
    if (token.type === 'heading') type = 'h' + token.depth;
    if (!type) return;
    const end = start + raw.trimEnd().length;
    const block = Object.assign({ type, ordinal: (byType.get(type) || []).length, token,
      start_line: lineAt(portable.at(start)), end_line: lineAt(portable.at(Math.max(start, end - 1))), raw }, projection(token, raw, start));
    blocks.push(block); addTo(byType, type, block);
    if (type === 'pre') {
      const fenced = /^ {0,3}(`{3,}|~{3,})/.test(raw);
      block.code = token.text || '';
      block.codeLines = block.code.replace(/\n$/, '').split('\n');
      block.code_start_line = block.start_line + (fenced ? 1 : 0);
      block.codeLines.forEach((line, i) => addTo(codeLines, line.trim(), { block, index: i }));
    }
    if (type === 'table') {
      block.header = token.header.map(cell => norm(inlineText(cell.tokens)));
      block.rows = token.rows.map(row => row.map(cell => norm(inlineText(cell.tokens))));
    }
  });

  // Match every requested quote in a single pass over the indexed text. This
  // also handles short quotes and many comments on a long paragraph without
  // rescanning the entire document once for each comment.
  const quoteCache = new Map(), trie = [{ next: new Map(), fail: 0, out: [] }];
  Array.from(new Set(queries.map(norm).filter(Boolean))).forEach(quote => {
    quoteCache.set(quote, []);
    let state = 0;
    for (let i = 0; i < quote.length; i += 1) {
      const char = quote[i];
      if (!trie[state].next.has(char)) { trie[state].next.set(char, trie.length); trie.push({ next: new Map(), fail: 0, out: [] }); }
      state = trie[state].next.get(char);
    }
    trie[state].out.push(quote);
  });
  const queue = Array.from(trie[0].next.values());
  for (let q = 0; q < queue.length; q += 1) {
    const state = queue[q];
    trie[state].next.forEach((child, char) => {
      let fallback = trie[state].fail;
      while (fallback && !trie[fallback].next.has(char)) fallback = trie[fallback].fail;
      trie[child].fail = trie[fallback].next.get(char) || 0;
      trie[child].out = trie[child].out.concat(trie[trie[child].fail].out);
      queue.push(child);
    });
  }
  blocks.forEach(block => {
    let state = 0;
    for (let i = 0; i < block.text.length; i += 1) {
      const char = block.text[i];
      while (state && !trie[state].next.has(char)) state = trie[state].fail;
      state = trie[state].next.get(char) || 0;
      trie[state].out.forEach(quote => {
        const at = i - quote.length + 1;
        quoteCache.get(quote).push({ block, at, end: i + 1, source_offset: block.charOffsets[at], start_line: block.charLines[at] || block.start_line,
          end_line: block.charLines[i] || block.end_line });
      });
    }
  });
  function findQuote(quote) {
    quote = norm(quote);
    if (!quote) return [];
    if (quoteCache.has(quote)) return quoteCache.get(quote);
    const matches = [];
    blocks.forEach(block => {
      let at = 0;
      while ((at = block.text.indexOf(quote, at)) >= 0) {
        matches.push({ block, at, end: at + quote.length, source_offset: block.charOffsets[at], start_line: block.charLines[at] || block.start_line,
          end_line: block.charLines[at + quote.length - 1] || block.end_line });
        at += Math.max(1, quote.length);
      }
    });
    quoteCache.set(quote, matches);
    return matches;
  }
  return { original, source, body, documentHash, lines, clean, starts, blocks, byType, codeLines, headings, findQuote };
}

function failure(status, sourceStatus) { return { match_status: status, source_status: sourceStatus, target: null }; }
function targetResult(comment, target, verified = true) {
  const ref = blockRef(comment);
  const sameBlock = !ref || target.block.type === ref.type && target.block.ordinal === ref.index;
  const sameLine = target.code_index === undefined || indexNumber(comment.line) === target.code_index;
  return { match_status: verified ? sameBlock && sameLine ? 'exact' : 'relocated' : 'unverified',
    source_status: verified ? 'matched' : 'ordinal_only', target };
}
function pick(comment, candidates, verified = true) {
  if (candidates.length !== 1) return failure(candidates.length ? 'ambiguous' : 'lost', candidates.length ? 'ambiguous' : 'not_found');
  return targetResult(comment, candidates[0], verified);
}
function blockTarget(block) { return { block, start_line: block.start_line, end_line: block.end_line }; }
function hintMatches(block, hint) { return !hint || block.text.startsWith(norm(hint)); }
function hintedBlocks(index, comment, type) {
  const ref = blockRef(comment);
  const blocks = type || ref ? index.byType.get(type || ref.type) || [] : index.blocks;
  if (comment.block_text) return blocks.filter(block => hintMatches(block, comment.block_text));
  return ref && blocks[ref.index] ? [blocks[ref.index]] : [];
}

function selectorScope(index, comment) {
  let start = 1, end = index.lines.length;
  if (comment.lines !== undefined) {
    const range = typeof comment.lines === 'string' && /^(\d+):(\d+)$/.exec(comment.lines);
    if (!range || !Number.isSafeInteger(Number(range[1])) || !Number.isSafeInteger(Number(range[2])) ||
        Number(range[1]) < 1 || Number(range[2]) < Number(range[1]) || Number(range[2]) > end) {
      const error = new Error('lines must be an inclusive start:end range within the document.');
      error.code = 'invalid_request'; error.details = { field: 'comments', total_lines: end }; throw error;
    }
    start = Number(range[1]); end = Number(range[2]);
  }
  if (comment.section !== undefined) {
    if (typeof comment.section !== 'string' || !comment.section.trim()) {
      const error = new Error('section must be a heading title or full heading path.');
      error.code = 'invalid_request'; error.details = { field: 'comments' }; throw error;
    }
    const heading = comment.section.trim();
    const matches = index.headings.filter(entry => (entry.path === heading || entry.title === heading) && entry.start_line <= end && entry.end_line >= start);
    if (matches.length !== 1) {
      const error = new Error(matches.length ? 'More than one section matches.' : 'The requested section was not found.');
      error.code = matches.length ? 'edit_ambiguous' : 'edit_no_match';
      error.details = { field: 'comments', match_count: matches.length, candidates: matches.slice(0, 8).map(entry => ({
        line: entry.start_line, end_line: entry.end_line, section: entry.path.slice(0, 240) })) };
      throw error;
    }
    start = Math.max(start, matches[0].start_line); end = Math.min(end, matches[0].end_line);
  }
  return { start, end };
}

function proseHits(index, comment) {
  const scope = selectorScope(index, comment);
  let hits = index.findQuote(comment.quote).filter(hit => hit.start_line >= scope.start && hit.end_line <= scope.end);
  const ref = blockRef(comment);
  if (comment.document_hash === index.documentHash && typeof comment.quote_offset === 'number' && ref) {
    const original = (index.byType.get(ref.type) || [])[ref.index];
    const exact = hits.filter(hit => hit.block === original && hit.at === comment.quote_offset);
    if (exact.length === 1) return exact;
  }
  if (comment.prefix || comment.suffix) {
    const before = norm(comment.prefix), after = norm(comment.suffix);
    const contextual = hits.filter(hit => (!before || hit.block.text.slice(0, hit.at).trimEnd().endsWith(before)) &&
      (!after || hit.block.text.slice(hit.end).trimStart().startsWith(after)));
    hits = contextual;
  }
  if (comment.block_text) {
    const hinted = hits.filter(hit => (!ref || hit.block.type === ref.type) && hintMatches(hit.block, comment.block_text));
    if (hinted.length || !comment.prefix && !comment.suffix) hits = hinted;
  }
  return hits;
}
function proseTarget(index, comment) {
  if (!norm(comment.quote)) return failure('unverified', 'unsupported');
  try { return pick(comment, proseHits(index, comment)); }
  catch (error) { return failure(error.code === 'edit_ambiguous' ? 'ambiguous' : 'lost', error.code === 'edit_ambiguous' ? 'ambiguous' : 'not_found'); }
}

function codeTarget(index, comment) {
  const wanted = String(comment.anchorText || '').trim();
  let hits = wanted ? (index.codeLines.get(wanted) || []).map(hit => ({ ...hit })) : [];
  let trustedBlock = false;
  const ref = blockRef(comment);
  if (!wanted) {
    const block = ref && (index.byType.get('pre') || [])[ref.index];
    const line = indexNumber(comment.line);
    if (block && line >= 0 && line < block.codeLines.length) {
      return targetResult(comment, { block, code_index: line, start_line: block.code_start_line + line,
        end_line: block.code_start_line + line }, false);
    }
    return failure('unverified', 'unsupported');
  }
  if (comment.block_text) {
    const exact = hits.filter(hit => hit.block.code.trim() === String(comment.block_text).trim());
    if (exact.length) {
      hits = exact;
      const blocks = new Set(exact.map(hit => hit.block));
      if (blocks.size === 1) {
        const original = exact.filter(hit => hit.index === indexNumber(comment.line));
        if (original.length === 1) { hits = original; trustedBlock = true; }
      }
    }
  }
  if (!trustedBlock && (typeof comment.line_prefix === 'string' || typeof comment.line_suffix === 'string')) {
    const contextual = hits.filter(hit => {
      const lines = hit.block.codeLines, line = hit.index;
      return (typeof comment.line_prefix !== 'string' || lines.slice(Math.max(0, line - 2), line).join('\n') === comment.line_prefix) &&
        (typeof comment.line_suffix !== 'string' || lines.slice(line + 1, line + 3).join('\n') === comment.line_suffix);
    });
    const surviving = hits.filter(hit => {
      const lines = hit.block.codeLines, line = hit.index;
      return comment.line_prefix && lines.slice(Math.max(0, line - 2), line).join('\n') === comment.line_prefix ||
        comment.line_suffix && lines.slice(line + 1, line + 3).join('\n') === comment.line_suffix;
    });
    hits = contextual.length ? contextual : surviving;
  }
  if (comment.kind === 'token' && comment.quote) {
    let count = 0;
    hits = hits.filter(hit => {
      const text = hit.block.codeLines[hit.index], quote = String(comment.quote);
      let from = 0, at, positions = [];
      const offset = indexNumber(comment.quote_offset);
      if (offset >= 0 && text.trim() === String(comment.anchorText || '').trim() && text.slice(offset, offset + quote.length) === quote) {
        count += 1; hit.quote_index = offset; return true;
      }
      while ((at = text.indexOf(quote, from)) >= 0) { positions.push(at); from = at + Math.max(1, quote.length); }
      const contextual = positions.filter(pos => (!comment.quote_prefix || text.slice(0, pos).endsWith(comment.quote_prefix)) &&
        (!comment.quote_suffix || text.slice(pos + quote.length).startsWith(comment.quote_suffix)));
      if (comment.quote_prefix || comment.quote_suffix) positions = contextual;
      count += positions.length;
      if (positions.length === 1) hit.quote_index = positions[0];
      return positions.length > 0;
    });
    if (count > 1) return failure('ambiguous', 'ambiguous');
  }
  return pick(comment, hits.map(hit => {
    const span = comment.kind === 'method' ? Math.max(0, indexNumber(comment.endLine) - indexNumber(comment.line)) : 0;
    const start = hit.block.code_start_line + hit.index;
    return { block: hit.block, code_index: hit.index, quote_index: hit.quote_index, start_line: start,
      end_line: Math.min(hit.block.code_start_line + hit.block.codeLines.length - 1, start + span) };
  }));
}

function tableTarget(index, comment) {
  const tables = index.byType.get('table') || [];
  const ref = blockRef(comment), scope = comment.table_scope || 'table';
  let selected = tables;
  if (comment.table_signature) {
    const exact = tables.filter(table => prose.documentFingerprint(JSON.stringify([table.header].concat(table.rows))) === comment.table_signature);
    if (exact.length > 1) return failure('ambiguous', 'ambiguous');
    if (exact.length === 1) { const result = tableTarget(index, { ...comment, table_signature: undefined, block_text: undefined,
      row_text: undefined, column_text: undefined, row_cells: undefined, cell_text: undefined, block: 'table:' + exact[0].ordinal });
      if (result.target) { result.match_status = exact[0].ordinal === (blockRef(comment) || {}).index ? 'exact' : 'relocated'; result.source_status = 'matched'; }
      return result;
    }
  }
  if (comment.block_text) {
    const hinted = tables.filter(table => hintMatches(table, comment.block_text));
    if (hinted.length) selected = hinted;
  }
  const evidence = !!(comment.block_text || comment.row_text || comment.column_text || comment.cell_text);
  if (!evidence) selected = ref && tables[ref.index] ? [tables[ref.index]] : [];
  const hits = [];
  selected.forEach(table => {
    if (scope === 'table') { hits.push(blockTarget(table)); return; }
    let rows = scope === 'row' || scope === 'cell'
      ? table.rows.map((cells, i) => ({ cells, i })).filter(row => comment.row_text
        ? row.cells.join(' | ') === norm(comment.row_text) || row.cells.some(cell => cell === norm(comment.row_text))
        : row.i === indexNumber(comment.table_row)) : [{ i: -1 }];
    if (rows.length > 1 && Array.isArray(comment.row_cells)) rows = rows.filter(row => JSON.stringify(row.cells) === JSON.stringify(comment.row_cells.map(norm)));
    const columns = scope === 'column' || scope === 'cell'
      ? table.header.map((text, i) => ({ text, i })).filter(column => comment.column_text
        ? column.text === norm(comment.column_text) : column.i === indexNumber(comment.table_column)) : [{ i: -1 }];
    rows.forEach(row => columns.forEach(column => {
      const line = row.i < 0 ? table.start_line : table.start_line + 2 + row.i;
      hits.push({ block: table, start_line: line, end_line: scope === 'column' ? table.end_line : line,
        table_row: row.i, table_column: column.i });
    }));
  });
  const result = pick(comment, hits, evidence);
  if (result.match_status === 'exact' && result.target &&
      ((result.target.table_row >= 0 && result.target.table_row !== indexNumber(comment.table_row)) ||
      (result.target.table_column >= 0 && result.target.table_column !== indexNumber(comment.table_column)))) result.match_status = 'relocated';
  return result;
}

function cellsEntries(index) {
  if (index.cellsEntries) return index.cellsEntries;
  const blocks = (index.byType.get('pre') || []).filter(block => /^cells(?:\s|$)/i.test(block.token.lang || ''));
  const inputs = blocks.map(block => {
    let source = block.code;
    const rest = (block.token.lang || '').replace(/^cells\s*/i, '');
    if (rest) {
      const info = cellsModel.parseFenceInfo(rest);
      source = 'sdoc-cells: name="' + info.name.replace(/"/g, '') + '"' +
        (info.workbook ? ' workbook="' + info.workbook.replace(/"/g, '') + '"' : '') + '\n' + source;
    }
    return { source, context: block };
  });
  const plan = cellsController.planWorkbooks(inputs, cellsModel, { recalcWorkbook: () => [] }, cellsController.DEFAULT_LIMITS);
  index.cellsEntries = plan.entries.map((entry, n) => ({ name: entry.name, source: entry.source,
    model: entry.model, block: entry.context, index: n }));
  return index.cellsEntries;
}

function codeOffset(index, block, position) {
  let from = 0, row = 0;
  while (row + 1 < block.codeLines.length && from + block.codeLines[row].length < position) {
    from += block.codeLines[row].length + 1; row++;
  }
  const documentRow = block.code_start_line + row - 1;
  const rawLine = index.clean[documentRow] || '';
  const indentation = Math.max(0, rawLine.indexOf(block.codeLines[row]));
  return index.starts[documentRow] + indentation + position - from;
}

function shapeHeaderRange(index, block, rect) {
  const text = block.codeLines[rect.sourceLine - 1]; if (text === undefined) return null;
  const pipe = text.indexOf('|'), prefix = pipe < 0 ? text : text.slice(0, pipe + 1);
  const offset = block.codeLines.slice(0, rect.sourceLine - 1).join('\n').length + (rect.sourceLine > 1 ? 1 : 0);
  return { start: codeOffset(index, block, offset), end: codeOffset(index, block, offset + prefix.length), prefix };
}

// Source lines for CSV records, including quoted multiline values. Coordinates
// remain in the original fenced source, without the synthetic sheet-name line.
function sheetRecords(index, entry) {
  const code = entry.block.code, records = [];
  let from = 0;
  while (code[from] === '\n') from++;
  while (/^(?:sdoc-cells:|format:)/i.test(code.slice(from))) {
    const end = code.indexOf('\n', from); if (end < 0) return [];
    from = end + 1;
  }
  let quote = false, start = from;
  for (let i = from; i <= code.length; i++) {
    if (code[i] === '"') { if (quote && code[i + 1] === '"') i++; else quote = !quote; }
    if ((!quote && code[i] === '\n') || i === code.length) {
      if (i > start || i < code.length) records.push({ start: codeOffset(index, entry.block, start), end: codeOffset(index, entry.block, i) });
      start = i + 1;
    }
  }
  return records;
}
function cellsTarget(index, comment) {
  const entries = cellsEntries(index);
  const result = cellsComments.resolveTarget(comment, entries, { document_hash: index.documentHash });
  if (!result.sheet) return failure(result.status === 'ambiguous' ? 'ambiguous' : 'lost', result.status === 'ambiguous' ? 'ambiguous' : 'not_found');
  const records = sheetRecords(index, result.sheet);
  if (!result.rows.length || result.rows.some(row => !records[row]) || result.columns.some(col => col >= result.sheet.model.cols)) return failure('lost', 'not_found');
  const start = Math.min(...result.rows.map(row => records[row].start)), end = Math.max(...result.rows.map(row => records[row].end));
  const lineAt = offset => { let line = 0; while (line + 1 < index.starts.length && index.starts[line + 1] <= offset) line++; return line + 1; };
  return { match_status: result.sheet.index === (blockRef(comment) || {}).index ? 'exact' : 'relocated', source_status: 'matched',
    target: { block: result.sheet.block, sheet: result.sheet, rows: result.rows, columns: result.columns,
      records, start_line: lineAt(start), end_line: lineAt(Math.max(start, end - 1)) } };
}
function diagramEntries(index) {
  return (index.byType.get('pre') || []).filter(block => /^mermaid(?:\s|$)/i.test(block.token.lang || '')).map((block, n) =>
    ({ source: block.code, index: n, block, nodes: [] }));
}
function diagramNodeLine(source, id) {
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|[\\s;>|&])' + escaped + '(?=\\s*(?:[\\[({]|[-.=<>]|$))');
  let depth = 0, quote = '', edgeLabel = false;
  const clean = source.split('\n').map(line => {
    if (/^\s*(?:style|classDef|class|click|linkStyle|subgraph|end|direction|flowchart|graph)\s/.test(line)) return '';
    let result = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (!quote && !depth && c === '%' && line[i + 1] === '%') break;
      if (quote) {
        if (c === '\\') { result += '  '; i++; continue; }
        if (c === quote) quote = '';
        result += ' '; continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; result += ' '; continue; }
      if (!depth && c === '|') { edgeLabel = !edgeLabel; result += '|'; continue; }
      if (edgeLabel) { result += ' '; continue; }
      if ('[({'.includes(c)) { depth++; result += depth === 1 ? c : ' '; continue; }
      if ('])}'.includes(c) && depth) { depth--; result += depth ? ' ' : c; continue; }
      result += depth ? ' ' : c;
    }
    return result;
  });
  return clean.findIndex(line => re.test(line));
}

function diagramTarget(index, comment) {
  const entries = diagramEntries(index);
  entries.forEach(entry => { if (comment.node_id && diagramNodeLine(entry.source, comment.node_id) >= 0) entry.nodes.push({ id: comment.node_id }); });
  let result;
  const ordinal = (blockRef(comment) || {}).index;
  if (comment.document_hash === index.documentHash && entries[ordinal]) result = { diagram: entries[ordinal] };
  else result = diagramComments.resolveTarget(comment, entries);
  if (!result.diagram) return failure(result.status === 'ambiguous' ? 'ambiguous' : 'lost', result.status === 'ambiguous' ? 'ambiguous' : 'not_found');
  const block = result.diagram.block, target = blockTarget(block);
  if (comment.node_id) {
    const line = diagramNodeLine(block.code, comment.node_id);
    if (line < 0) return failure('lost', 'not_found');
    target.start_line = target.end_line = block.code_start_line + line;
  }
  return { match_status: result.diagram.index === ordinal ? 'exact' : 'relocated', source_status: 'matched', target };
}

function slideTarget(index, comment) {
  const slideComments = require('../public/sdocs-slide-comments');
  const shapes = require('../public/sdocs-shapes');
  const slides = (index.byType.get('pre') || []).filter(block => /^slide(?:\s|$)/i.test(block.token.lang || ''));
  const entries = slides.map((block, i) => ({ source: block.code.trim(),
    rects: slideComments.computeHitRects(block.code, shapes), index: i, block }));
  const anchor = comment.slide_source ? { ...comment, slide_source: String(comment.slide_source).trim() } : comment;
  const selected = Array.isArray(comment.shapes) ? comment.shapes : comment.shape == null ? [] : [comment.shape];
  const resolved = slideComments.resolveEntries(anchor, entries,
    comment.document_hash && comment.document_hash === index.documentHash, shapes);
  const entry = entries.find(item => item.index === resolved.index);
  if (entry) {
    const target = Object.assign(blockTarget(entry.block), { slide_index: entry.index, shape_indices: resolved.shapes || [], rects: entry.rects });
    const result = targetResult(comment, target,
      !!(comment.slide_source || comment.slide_text || comment.shape_texts && comment.shape_texts.length ||
      comment.document_hash && comment.document_hash === index.documentHash));
    if (result.match_status !== 'unverified') {
      result.match_status = entry.index === indexNumber(comment.slide) &&
        JSON.stringify(resolved.shapes || []) === JSON.stringify(selected) ? 'exact' : 'relocated';
    }
    return result;
  }
  if (resolved.status === 'ambiguous') return failure('ambiguous', 'ambiguous');
  // Legacy or template source that the shape parser cannot expand still
  // provides useful source context, without claiming a visual match.
  let hits = [];
  if (comment.slide_source) hits = entries.filter(item => item.source === anchor.slide_source);
  const shapeTexts = Array.isArray(comment.shape_texts) ? comment.shape_texts : [];
  const hints = shapeTexts.length ? shapeTexts : comment.slide_text ? [comment.slide_text] : [];
  if (!hits.length && hints.length) hits = entries.filter(item => !item.rects.length && hints.every(hint => item.source.includes(hint)));
  const result = pick(comment, hits.map(item => blockTarget(item.block)));
  if (result.target && selected.length) {
    result.match_status = 'unverified'; result.source_status = 'slide_source_only';
  }
  return result;
}

function elementTarget(index, comment) {
  const blocks = index.byType.get((blockRef(comment) || {}).type) || [];
  if (!comment.element_text) {
    const block = hintedBlocks(index, comment)[0];
    return block ? targetResult(comment, blockTarget(block), false) : failure('unverified', 'unsupported');
  }
  const matches = index.findQuote(comment.element_text).filter(hit => blocks.includes(hit.block));
  const hits = comment.block_text ? matches.filter(hit => hintMatches(hit.block, comment.block_text)) : matches;
  const result = pick(comment, hits.length ? hits : matches);
  if (result.target) {
    // Text can locate the list source, but it does not prove a structural DOM
    // path or whether a branch includes the same descendant items.
    result.match_status = 'unverified'; result.source_status = 'element_source_only';
  }
  return result;
}

function snippet(index, target) {
  const block = target.block;
  let start = Math.max(block.start_line, target.start_line - 2);
  let end = Math.min(block.end_line, Math.max(target.end_line + 2, start));
  let truncated = end - start + 1 > MAX_CONTEXT_LINES;
  end = Math.min(end, start + MAX_CONTEXT_LINES - 1);
  // Make room for the anchor before including neighboring source lines.
  let preceding = 0;
  for (let line = start; line < target.start_line; line += 1) preceding += (index.lines[line - 1] || '').length;
  while (start < target.start_line && preceding > MAX_CONTEXT_CHARS / 4) {
    preceding -= (index.lines[start - 1] || '').length; start += 1; truncated = true;
  }
  // Preserve whole original source lines where they fit. A single long line
  // must be clipped, and truncated tells the caller it needs a scoped read.
  let markdown = '', actualEnd = start - 1;
  for (let line = start; line <= end; line += 1) {
    const part = index.lines[line - 1] || '';
    if (markdown.length + part.length > MAX_CONTEXT_CHARS) {
      if (line === target.start_line) {
        const column = target.source_offset === undefined ? 0 : target.source_offset - index.starts[line - 1];
        const available = MAX_CONTEXT_CHARS - markdown.length;
        const from = Math.max(0, Math.min(part.length - available, column - Math.floor(available / 3)));
        markdown += part.slice(from, from + available); actualEnd = line;
      } else if (!markdown) { markdown = part.slice(0, MAX_CONTEXT_CHARS); actualEnd = line; }
      truncated = true;
      break;
    }
    markdown += part; actualEnd = line;
  }
  if (actualEnd < target.end_line || start > block.start_line || actualEnd < block.end_line) truncated = true;
  let section = null;
  for (const heading of index.headings) {
    if (heading.start_line > target.start_line) break;
    if (heading.end_line >= target.start_line) section = heading.path.slice(0, 240);
  }
  return { start_line: start, end_line: Math.max(start, actualEnd), section,
    markdown, truncated, line_basis: 'document' };
}

function project(markdown, comments, options = {}) {
  const list = Array.isArray(comments) ? comments : [];
  if (!list.length) return [];
  const index = buildIndex(markdown, list.flatMap(comment => comment ? [comment.quote, comment.element_text] : []));
  const includeContext = options.context === 'snippet';
  return list.map(comment => {
    const anchor = anchorOf(comment);
    let result;
    if (anchor.anchor_status === 'orphaned' || anchor.anchor_status === 'ambiguous') result = failure(
      anchor.anchor_status === 'ambiguous' ? 'ambiguous' : 'lost', anchor.anchor_status === 'ambiguous' ? 'ambiguous' : 'not_found');
    else if (anchor.kind === 'inline') result = proseTarget(index, anchor);
    else if (['line', 'method', 'token'].includes(anchor.kind)) result = codeTarget(index, anchor);
    else if (anchor.kind === 'table') result = tableTarget(index, anchor);
    else if (anchor.kind === 'slide') result = slideTarget(index, anchor);
    else if (anchor.kind === 'cells') result = cellsTarget(index, anchor);
    else if (anchor.kind === 'diagram') result = diagramTarget(index, anchor);
    else if (anchor.kind === 'element') result = elementTarget(index, anchor);
    else if (anchor.kind === 'block') {
      const blocks = hintedBlocks(index, anchor);
      result = blocks.length ? pick(anchor, blocks.map(blockTarget), !!anchor.block_text)
        : failure(anchor.block_text ? 'lost' : 'unverified', anchor.block_text ? 'not_found' : 'unsupported');
    } else result = failure('unverified', 'unsupported');
    anchor.match_status = result.match_status;
    anchor.source_status = result.source_status;
    return { anchor, context: includeContext && result.target ? snippet(index, result.target) : null };
  });
}

function locateInline(markdown, anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) ||
      typeof anchor.quote !== 'string' || !norm(anchor.quote) || anchor.kind && anchor.kind !== 'inline') {
    const error = new Error('An inline comment requires a nonempty quote.');
    error.code = 'invalid_request'; error.details = { field: 'comments' }; throw error;
  }
  const index = buildIndex(markdown, [anchor.quote]);
  const hits = proseHits(index, anchor);
  if (hits.length !== 1) {
    const error = new Error(hits.length ? 'More than one source passage matches this quote.' : 'The comment quote was not found in the selected source.');
    error.code = hits.length ? 'edit_ambiguous' : 'edit_no_match';
    error.details = { field: 'comments', match_count: hits.length, candidates: hits.slice(0, 8).map(hit => ({
      line: hit.start_line, end_line: hit.end_line, block: hit.block.type + ':' + hit.block.ordinal,
      excerpt: hit.block.text.slice(Math.max(0, hit.at - 40), hit.at + 120) })) };
    if (hits.length > 8) error.details.candidates_truncated = true;
    throw error;
  }
  const hit = hits[0];
  return Object.assign({}, clone(anchor), inlineAnchor(index, hit, anchor));
}
function inlineAnchor(index, hit, anchor) {
  return { kind: 'inline', quote: anchor.quote, block: hit.block.type + ':' + hit.block.ordinal,
    block_text: hit.block.text.slice(0, 240), prefix: anchor.prefix || hit.block.text.slice(Math.max(0, hit.at - 60), hit.at),
    suffix: anchor.suffix || hit.block.text.slice(hit.end, hit.end + 60),
    document_hash: index.documentHash, quote_offset: hit.at, quote_offset_basis: 'normalized' };
}

// Internal backend helper. Offsets refer to normalized source (CRLF becomes
// LF), and are supplied only when the rendered quote also occurs verbatim in
// that source range. Rich selections across formatting remain conservative.
function sourceLocations(markdown, comments) {
  const index = buildIndex(markdown, comments.flatMap(comment => comment ? [comment.quote] : []));
  return comments.map(raw => {
    const comment = anchorOf(raw);
    const result = comment.kind === 'inline' ? proseTarget(index, comment)
      : ['line', 'method', 'token'].includes(comment.kind) ? codeTarget(index, comment)
      : comment.kind === 'cells' ? cellsTarget(index, comment) : comment.kind === 'diagram' ? diagramTarget(index, comment)
      : comment.kind === 'slide' ? slideTarget(index, comment) : failure('unverified', 'unsupported');
    if (!result.target) return { status: result.match_status };
    const target = result.target;
    let start, end;
    if (comment.kind === 'cells' || comment.kind === 'diagram' || comment.kind === 'slide') {
      start = codeOffset(index, target.block, 0); end = codeOffset(index, target.block, target.block.code.length);
      const shapeRanges = comment.kind === 'slide' ? (target.shape_indices || []).map(shape => {
        const rect = target.rects.find(rect => rect.shapeIdx === shape);
        if (!rect || !rect.sourceLine) return null;
        return shapeHeaderRange(index, target.block, rect);
      }) : undefined;
      if (shapeRanges && shapeRanges.some(shape => !shape)) return { status: 'unverified' };
      return { status: result.match_status, start, end, rich_anchor: comment, shape_ranges: shapeRanges,
        row_ranges: comment.kind === 'cells' ? target.rows.map(row => target.records[row]) : undefined };
    }
    if (comment.kind === 'inline') {
      start = target.source_offset;
      end = target.block.charOffsets[target.end - 1] + 1;
      if (index.source.slice(start, end) !== comment.quote) return { status: 'unverified' };
    } else {
      start = index.starts[target.start_line - 1];
      const line = index.clean[target.start_line - 1];
      if (comment.kind === 'token') {
        const quote = target.quote_index;
        if (quote === undefined) return { status: 'unverified' };
        start += Math.max(0, line.indexOf(target.block.codeLines[target.code_index])) + quote;
        end = start + String(comment.quote || '').length;
      } else {
        const offset = line.indexOf(String(comment.anchorText || '').trim());
        if (offset < 0) return { status: 'unverified' };
        start += offset; end = start + String(comment.anchorText || '').trim().length;
      }
    }
    const methodEnd = comment.kind === 'method' ? index.starts[Math.min(target.block.code_start_line + indexNumber(comment.endLine),
      target.block.code_start_line + target.block.codeLines.length - 1)] : undefined;
    return { status: result.match_status, start, end, method_end: methodEnd };
  });
}

// The caller must already have proved these source positions through an edit
// map. Unlike quote search, this helper never substitutes another occurrence.
function anchorsAtSource(markdown, ranges) {
  const source = String(markdown).replace(/\r\n/g, '\n');
  const index = buildIndex(source, ranges.map(range => source.slice(range.start, range.end)));
  return ranges.map(range => {
    const quote = source.slice(range.start, range.end);
    if (range.kind === 'inline') {
      const hits = index.findQuote(quote).filter(hit => hit.source_offset === range.start &&
        hit.block.charOffsets[hit.end - 1] + 1 === range.end);
      return hits.length === 1 ? inlineAnchor(index, hits[0], { quote }) : null;
    }
    const blocks = (index.byType.get('pre') || []).filter(block => range.start >= index.starts[block.code_start_line - 1] &&
      range.end <= (index.starts[block.code_start_line + block.codeLines.length - 1] || source.length));
    if (blocks.length !== 1) return null;
    const block = blocks[0];
    let line = 0;
    while (line + 1 < block.codeLines.length && index.starts[block.code_start_line + line] <= range.start) line += 1;
    if (range.kind === 'slide') {
      const slides = (index.byType.get('pre') || []).filter(item => /^slide(?:\s|$)/i.test(item.token.lang || ''));
      const slide = slides.indexOf(block); if (slide < 0 || range.shape_ranges && range.shape_ranges.some(shape => !shape)) return null;
      const lib = require('../public/sdocs-slide-comments'), shapesLib = require('../public/sdocs-shapes');
      const rects = lib.computeHitRects(block.code, shapesLib);
      const selected = (range.shape_ranges || []).map(shape => {
        let candidates = rects.filter(rect => {
          const current = shapeHeaderRange(index, block, rect);
          return current && current.start >= shape.start && current.end <= shape.end;
        });
        const exact = candidates.filter(rect => shapeHeaderRange(index, block, rect).prefix === shape.prefix);
        if (exact.length) candidates = exact;
        return candidates.length === 1 ? candidates[0] : null;
      });
      if (selected.some(shape => !shape)) return null;
      const anchor = { ...range.rich_anchor, slide, slide_source: block.code, document_hash: index.documentHash };
      delete anchor.shape; delete anchor.shapes;
      if (selected.length === 1) anchor.shape = selected[0].shapeIdx;
      else if (selected.length > 1) anchor.shapes = selected.map(shape => shape.shapeIdx);
      anchor.shape_texts = selected.map(shape => shape.label);
      anchor.slide_text = selected.length ? anchor.shape_texts.join(' + ') : (rects.find(rect => rect.text) || {}).text || '';
      return anchor;
    }
    if (range.kind === 'diagram') {
      const entries = diagramEntries(index), entry = entries.find(entry => entry.block === block);
      if (!entry || range.rich_anchor.node_id && diagramNodeLine(entry.source, range.rich_anchor.node_id) < 0) return null;
      return { ...range.rich_anchor, block: 'diagram:' + entry.index, diagram_source: entry.source, document_hash: index.documentHash };
    }
    if (range.kind === 'cells') {
      const entry = cellsEntries(index).find(entry => entry.block === block);
      if (!entry || !range.row_ranges || range.row_ranges.some(record => !record)) return null;
      const records = sheetRecords(index, entry), rows = range.row_ranges.map(record => records.findIndex(current => current.start === record.start && current.end === record.end));
      if (rows.some(row => row < 0) || new Set(rows).size !== rows.length) return null;
      const data = entry.model.cells.map(row => row.map(cell => cell.raw));
      const previous = cellsModel.parseCells(range.rich_anchor.sheet_source || '');
      const oldHeader = previous.cells && previous.cells[0] && previous.cells[0].map(cell => cell.raw);
      const sameColumns = oldHeader && JSON.stringify(oldHeader) === JSON.stringify(data[0]);
      const columns = sameColumns ? Array.from({ length: range.rich_anchor.range.end_col - range.rich_anchor.range.start_col + 1 },
        (_, n) => range.rich_anchor.range.start_col + n) : (range.rich_anchor.column_texts || []).map(text => {
        const found = data[0].map((value, n) => value === text ? n : -1).filter(n => n >= 0);
        return found.length === 1 ? found[0] : -1;
      });
      if (!columns.length || columns.some(col => col < 0) || columns.some((col, n) => n && col !== columns[n - 1] + 1)) return null;
      return { ...range.rich_anchor, block: 'cells:' + entry.index, sheet_name: entry.name, sheet_source: entry.source,
        range: { start_row: Math.min(...rows), end_row: Math.max(...rows), start_col: columns[0], end_col: columns[columns.length - 1] },
        cells_rows: rows, row_texts: rows.map(row => JSON.stringify(data[row])), column_texts: columns.map(col => data[0][col]),
        cell_values: rows.map(row => columns.map(col => data[row][col])), document_hash: index.documentHash };
    }
    const text = block.codeLines[line], documentLine = block.code_start_line + line - 1;
    const base = index.starts[documentLine] + Math.max(0, index.clean[documentLine].indexOf(text));
    const anchor = { kind: range.kind, block: 'pre:' + block.ordinal, line,
      anchorText: text, block_text: block.code.trim(), document_hash: index.documentHash,
      line_prefix: block.codeLines.slice(Math.max(0, line - 2), line).join('\n'),
      line_suffix: block.codeLines.slice(line + 1, line + 3).join('\n') };
    if (range.kind === 'token') {
      if (range.start < base || range.end > base + text.length || text.slice(range.start - base, range.end - base) !== quote) return null;
      const at = range.start - base;
      Object.assign(anchor, { quote, quote_offset: at, quote_prefix: text.slice(Math.max(0, at - 60), at), quote_suffix: text.slice(at + quote.length, at + quote.length + 60) });
    }
    if (range.kind === 'method' && range.method_end !== undefined) {
      let endLine = line;
      while (endLine + 1 < block.codeLines.length && index.starts[block.code_start_line + endLine] < range.method_end) endLine += 1;
      anchor.endLine = endLine;
    }
    return anchor;
  });
}

module.exports = { project, locateInline, sourceLocations, anchorsAtSource };
