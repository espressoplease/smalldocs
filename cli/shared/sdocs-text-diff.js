'use strict';

(function (exports) {
function splitLines(value) {
  if (!value) return [];
  return String(value).match(/[^\n]*\n|[^\n]+$/g) || [];
}

function lineCounts(lines, start, end) {
  const counts = new Map();
  for (let i = start; i < end; i += 1) {
    const value = lines[i];
    const entry = counts.get(value);
    if (entry) entry.count += 1;
    else counts.set(value, { count: 1, index: i });
  }
  return counts;
}

function longestIncreasingPairs(pairs) {
  if (!pairs.length) return [];
  const tails = [];
  const tailIndexes = [];
  const previous = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i += 1) {
    const value = pairs[i].right;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tailIndexes[low - 1];
    tails[low] = value;
    tailIndexes[low] = i;
  }
  const result = [];
  let index = tailIndexes[tails.length - 1];
  while (index >= 0) {
    result.push(pairs[index]);
    index = previous[index];
  }
  return result.reverse();
}

function patienceAnchors(left, leftStart, leftEnd, right, rightStart, rightEnd) {
  const leftCounts = lineCounts(left, leftStart, leftEnd);
  const rightCounts = lineCounts(right, rightStart, rightEnd);
  const pairs = [];
  leftCounts.forEach((leftEntry, value) => {
    const rightEntry = rightCounts.get(value);
    if (leftEntry.count === 1 && rightEntry && rightEntry.count === 1) {
      pairs.push({ left: leftEntry.index, right: rightEntry.index });
    }
  });
  pairs.sort((a, b) => a.left - b.left);
  return longestIncreasingPairs(pairs);
}

function diffEdits(base, updated) {
  const edits = [];

  function walk(baseStart, baseEnd, updatedStart, updatedEnd) {
    while (baseStart < baseEnd && updatedStart < updatedEnd &&
        base[baseStart] === updated[updatedStart]) {
      baseStart += 1;
      updatedStart += 1;
    }
    while (baseStart < baseEnd && updatedStart < updatedEnd &&
        base[baseEnd - 1] === updated[updatedEnd - 1]) {
      baseEnd -= 1;
      updatedEnd -= 1;
    }
    if (baseStart === baseEnd && updatedStart === updatedEnd) return;
    if (baseStart === baseEnd || updatedStart === updatedEnd) {
      edits.push({ start: baseStart, end: baseEnd,
        lines: updated.slice(updatedStart, updatedEnd) });
      return;
    }
    const anchors = patienceAnchors(base, baseStart, baseEnd,
      updated, updatedStart, updatedEnd);
    if (!anchors.length) {
      edits.push({ start: baseStart, end: baseEnd,
        lines: updated.slice(updatedStart, updatedEnd) });
      return;
    }
    let previousBase = baseStart;
    let previousUpdated = updatedStart;
    anchors.forEach((anchor) => {
      walk(previousBase, anchor.left, previousUpdated, anchor.right);
      previousBase = anchor.left + 1;
      previousUpdated = anchor.right + 1;
    });
    walk(previousBase, baseEnd, previousUpdated, updatedEnd);
  }

  walk(0, base.length, 0, updated.length);
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  return edits;
}

function compare(before, after) {
  const original = splitLines(before);
  const updated = splitLines(after);
  let offset = 0;
  let added = 0;
  let removed = 0;
  const hunks = diffEdits(original, updated).map((edit) => {
    const hunk = {
      before_line: edit.start + 1,
      after_line: edit.start + offset + 1,
      before: original.slice(edit.start, edit.end),
      after: edit.lines.slice(),
      context_before: original.slice(Math.max(0, edit.start - 3), edit.start),
      context_after: original.slice(edit.end, edit.end + 3),
    };
    removed += hunk.before.length;
    added += hunk.after.length;
    offset += hunk.after.length - hunk.before.length;
    return hunk;
  });
  return { changed: hunks.length > 0, added_lines: added, removed_lines: removed, hunks };
}

exports.splitLines = splitLines;
exports.diffEdits = diffEdits;
exports.compare = compare;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsTextDiff = {}));
