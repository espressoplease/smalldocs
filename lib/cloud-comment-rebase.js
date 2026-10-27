'use strict';

const { splitLines, diffEdits } = require('../cli/shared/sdocs-text-diff');
const context = require('./cloud-comment-context');

const THREAD_FIELDS = new Set(['id', 'uid', 'author', 'author_user_id', 'color', 'at', 'text',
  'updated_at', 'resolved', 'resolved_at', 'replies']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
}
function targetFields(comment) {
  return JSON.stringify(stable(Object.fromEntries(Object.keys(comment).filter(key => !THREAD_FIELDS.has(key)).map(key => [key, comment[key]]))));
}
function offsets(parts) {
  const result = [0];
  for (const part of parts) result.push(result[result.length - 1] + part.length);
  return result;
}
function tokens(text) { return text.match(/[\p{L}\p{N}_]+|\s+|[^\s]/gu) || []; }

function sourceEdits(before, after) {
  const beforeLines = splitLines(before), afterLines = splitLines(after);
  const lineOffsets = offsets(beforeLines), edits = [];
  diffEdits(beforeLines, afterLines).forEach(hunk => {
    const oldText = beforeLines.slice(hunk.start, hunk.end).join('');
    const newText = hunk.lines.join('');
    const left = tokens(oldText), right = tokens(newText), tokenOffsets = offsets(left);
    diffEdits(left, right).forEach(part => {
      let start = lineOffsets[hunk.start] + tokenOffsets[part.start];
      let end = lineOffsets[hunk.start] + tokenOffsets[part.end];
      let replacement = part.lines.join('');
      // Token anchors isolate independent edits, then common character edges
      // preserve selections that cover only part of a changed word or number.
      while (start < end && replacement && before[start] === replacement[0]) {
        start += 1; replacement = replacement.slice(1);
      }
      while (start < end && replacement && before[end - 1] === replacement[replacement.length - 1]) {
        end -= 1; replacement = replacement.slice(0, -1);
      }
      if (start !== end || replacement) edits.push({ start, end, text: replacement });
    });
  });
  return edits.sort((left, right) => left.start - right.start || left.end - right.end);
}

function intersects(edit, start, end) {
  return edit.start === edit.end ? edit.start > start && edit.start < end : edit.start < end && edit.end > start;
}
function mapRange(start, end, edits) {
  let before = 0, inside = 0;
  for (const edit of edits) {
    const delta = edit.text.length - (edit.end - edit.start);
    if (edit.end <= start) { before += delta; continue; }
    if (edit.start >= end) break;
    if (edit.start < start || edit.end > end) return null;
    inside += delta;
  }
  const range = { start: start + before, end: end + before + inside };
  return range.end > range.start ? range : null;
}
function mapPoint(point, edits) {
  let delta = 0;
  for (const edit of edits) {
    if (edit.end <= point) delta += edit.text.length - (edit.end - edit.start);
    else if (edit.start < point) return undefined;
    else break;
  }
  return point + delta;
}
function count(text, quote) {
  let found = 0, from = 0, at;
  if (!quote) return 0;
  while ((at = text.indexOf(quote, from)) >= 0) { found += 1; if (found > 1) break; from = at + 1; }
  return found;
}

function uniqueWitness(before, after, original, mapped, edits) {
  const lineStart = before.lastIndexOf('\n', Math.max(0, original.start - 1)) + 1;
  const next = before.indexOf('\n', original.end);
  const lineEnd = next < 0 ? before.length : next + 1;
  const candidates = [[original.start, original.end], [lineStart, lineEnd]];
  for (const radius of [8, 16, 32, 64, 120]) candidates.push([
    Math.max(0, original.start - radius), Math.min(before.length, original.end + radius)]);
  let start = lineStart, end = lineEnd;
  for (let radius = 0; radius < 2; radius += 1) {
    start = start ? before.lastIndexOf('\n', Math.max(0, start - 2)) + 1 : 0;
    const following = before.indexOf('\n', end);
    end = following < 0 ? before.length : following + 1;
    candidates.push([start, lineEnd], [lineStart, end], [start, end]);
  }
  return candidates.some(([first, last]) => {
    // Evidence must survive unchanged outside the selected passage. Deleting
    // one of two identical passages cannot turn an arbitrary diff alignment
    // into proof that the other passage was the original target.
    if (edits.some(edit => intersects(edit, first, last) && !intersects(edit, original.start, original.end))) return false;
    const evidence = before.slice(first, last);
    if (count(before, evidence) !== 1) return false;
    const current = mapRange(first, last, edits);
    if (!current || mapped.start < current.start || mapped.end > current.end) return false;
    const transformed = before.slice(first, original.start) + after.slice(mapped.start, mapped.end) + before.slice(original.end, last);
    return after.slice(current.start, current.end) === transformed && count(after, transformed) === 1;
  });
}

function reanchor(beforeMarkdown, afterMarkdown) {
  if (beforeMarkdown === afterMarkdown) return afterMarkdown;
  // Lazy to keep the comment action module free to call this helper without a
  // module initialization cycle.
  const comments = require('./cloud-comments');
  const beforeState = comments.snapshot(beforeMarkdown), afterState = comments.snapshot(afterMarkdown);
  if (!beforeState.comments.length || !afterState.comments.length || afterState.imported_count) return afterMarkdown;
  const before = beforeState.body.replace(/\r\n/g, '\n');
  const after = afterState.body.replace(/\r\n/g, '\n');
  if (before === after) return afterMarkdown;
  const oldById = new Map();
  beforeState.comments.forEach(comment => {
    if (!oldById.has(comment.id)) oldById.set(comment.id, comment);
    else oldById.set(comment.id, null);
  });
  const afterCounts = new Map();
  afterState.comments.forEach(comment => afterCounts.set(comment.id, (afterCounts.get(comment.id) || 0) + 1));
  const selected = [];
  afterState.comments.forEach((comment, index) => {
    const old = oldById.get(comment.id);
    const kind = comment.kind || (comment.quote ? 'inline' : 'block');
    if (!old || afterCounts.get(comment.id) !== 1 || old.uid && comment.uid && old.uid !== comment.uid ||
        !['inline', 'line', 'method', 'token'].includes(kind) || comment.anchor_status || targetFields(old) !== targetFields(comment)) return;
    selected.push({ comment, index, old: { ...old, kind } });
  });
  if (!selected.length) return afterMarkdown;
  const edits = sourceEdits(before, after);
  const locations = context.sourceLocations(before, selected.map(item => item.old));
  const updated = afterState.comments.slice(), requests = [], targets = [];
  let changed = false;
  selected.forEach((item, i) => {
    const original = locations[i];
    if (!['exact', 'relocated'].includes(original.status)) {
      if (original.status === 'lost' || original.status === 'ambiguous') {
        updated[item.index] = { ...item.comment, anchor_status: original.status === 'lost' ? 'orphaned' : 'ambiguous' }; changed = true;
      }
      return;
    }
    const mapped = mapRange(original.start, original.end, edits);
    if (!mapped || !after.slice(mapped.start, mapped.end).trim()) {
      updated[item.index] = { ...item.comment, anchor_status: 'orphaned' }; changed = true; return;
    }
    if (!uniqueWitness(before, after, original, mapped, edits)) {
      updated[item.index] = { ...item.comment, anchor_status: 'ambiguous' }; changed = true; return;
    }
    requests.push({ kind: item.old.kind, ...mapped,
      ...(original.method_end === undefined ? {} : { method_end: mapPoint(original.method_end, edits) }) });
    targets.push(item);
  });
  const anchors = context.anchorsAtSource(after, requests);
  targets.forEach((item, i) => {
    const anchor = anchors[i];
    if (!anchor) {
      updated[item.index] = { ...item.comment, anchor_status: 'orphaned' }; changed = true; return;
    }
    const next = { ...item.comment, ...anchor };
    // The selectors identified the old source when the comment was created.
    // The current block and fingerprint now identify the rebased position.
    delete next.lines; delete next.section;
    if (targetFields(next) !== targetFields(item.comment)) { updated[item.index] = next; changed = true; }
  });
  return changed ? comments.write(afterState, updated) : afterMarkdown;
}

module.exports = { reanchor };
