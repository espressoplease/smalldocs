'use strict';

const SDocYaml = require('../cli/shared/sdocs-yaml');

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

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function containsSequence(haystack, needle) {
  if (!needle.length) return true;
  if (needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function combineLines(current, proposed) {
  if (arraysEqual(current, proposed)) return current.slice();
  if (!current.length) return proposed.slice();
  if (!proposed.length) return current.slice();
  if (containsSequence(current, proposed)) return current.slice();
  if (containsSequence(proposed, current)) return proposed.slice();
  let overlap = Math.min(current.length, proposed.length);
  while (overlap > 0) {
    let matches = true;
    for (let i = 0; i < overlap; i += 1) {
      if (current[current.length - overlap + i] !== proposed[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return current.concat(proposed.slice(overlap));
    overlap -= 1;
  }
  return current.concat(proposed);
}

function editTouchesCluster(edit, start, end) {
  if (start === end) return edit.start === start;
  if (edit.start === edit.end) return edit.start >= start && edit.start < end;
  return edit.start < end && edit.end > start;
}

function materialize(base, start, end, edits) {
  const result = [];
  let cursor = start;
  edits.forEach((edit) => {
    result.push(...base.slice(cursor, edit.start));
    result.push(...edit.lines);
    cursor = edit.end;
  });
  result.push(...base.slice(cursor, end));
  return result;
}

function mergeText(baseText, currentText, proposedText) {
  if (currentText === baseText) {
    return { markdown: proposedText, classification: 'clean', combined: false };
  }
  if (proposedText === baseText || proposedText === currentText) {
    return { markdown: currentText, classification: 'noop', combined: false };
  }
  const base = splitLines(baseText);
  const currentEdits = diffEdits(base, splitLines(currentText))
    .map((edit) => Object.assign({ side: 'current' }, edit));
  const proposedEdits = diffEdits(base, splitLines(proposedText))
    .map((edit) => Object.assign({ side: 'proposed' }, edit));
  const all = currentEdits.concat(proposedEdits)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.side.localeCompare(b.side));
  const output = [];
  let cursor = 0;
  let combined = false;

  for (let index = 0; index < all.length;) {
    const cluster = [all[index]];
    let start = all[index].start;
    let end = all[index].end;
    index += 1;
    while (index < all.length && editTouchesCluster(all[index], start, end)) {
      cluster.push(all[index]);
      start = Math.min(start, all[index].start);
      end = Math.max(end, all[index].end);
      index += 1;
    }
    output.push(...base.slice(cursor, start));
    const fromCurrent = cluster.filter((edit) => edit.side === 'current');
    const fromProposed = cluster.filter((edit) => edit.side === 'proposed');
    if (!fromCurrent.length) {
      output.push(...materialize(base, start, end, fromProposed));
    } else if (!fromProposed.length) {
      output.push(...materialize(base, start, end, fromCurrent));
    } else {
      const current = materialize(base, start, end, fromCurrent);
      const proposed = materialize(base, start, end, fromProposed);
      if (!arraysEqual(current, proposed)) combined = true;
      output.push(...combineLines(current, proposed));
    }
    cursor = end;
  }
  output.push(...base.slice(cursor));
  return {
    markdown: output.join(''),
    classification: combined ? 'combined' : 'rebased',
    combined,
  };
}

function serializeDocument(meta, body) {
  return Object.keys(meta).length ? SDocYaml.serializeFrontMatter(meta) + '\n' + body : body;
}

function commentState(markdown) {
  const parsed = SDocYaml.parseFrontMatter(markdown);
  const meta = Object.assign({}, parsed.meta || {});
  const comments = Array.isArray(meta.comments) ? meta.comments.map((comment) =>
    Object.assign({}, comment)) : [];
  delete meta.comments;
  return { comments, markdown: serializeDocument(meta, parsed.body) };
}

function sameComment(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commentMap(comments) {
  const result = new Map();
  comments.forEach((comment) => {
    if (comment && typeof comment.id === 'string' && !result.has(comment.id)) {
      result.set(comment.id, comment);
    }
  });
  return result;
}

function mergeComments(baseComments, currentComments, proposedComments) {
  const base = commentMap(baseComments);
  const current = commentMap(currentComments);
  const proposed = commentMap(proposedComments);
  const order = [];
  const ordered = new Set();
  [baseComments, currentComments, proposedComments].forEach((comments) => {
    comments.forEach((comment) => {
      if (comment && typeof comment.id === 'string' && !ordered.has(comment.id)) {
        ordered.add(comment.id);
        order.push(comment.id);
      }
    });
  });
  const used = new Set(order);
  let nextNumber = 1;
  order.forEach((id) => {
    const match = /^c(\d+)$/.exec(id);
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
  });
  function nextId() {
    while (used.has('c' + nextNumber)) nextNumber += 1;
    const id = 'c' + nextNumber;
    used.add(id);
    nextNumber += 1;
    return id;
  }

  const comments = [];
  const remaps = [];
  let combined = false;
  function keep(comment) {
    if (comment) comments.push(Object.assign({}, comment));
  }
  function keepProposedCopy(comment) {
    const copy = Object.assign({}, comment, { id: nextId() });
    comments.push(copy);
    remaps.push({ from: comment.id, to: copy.id });
  }

  order.forEach((id) => {
    const before = base.get(id);
    const now = current.get(id);
    const wanted = proposed.get(id);
    if (!before) {
      if (now && wanted) {
        keep(now);
        if (!sameComment(now, wanted)) {
          keepProposedCopy(wanted);
          combined = true;
        }
      } else {
        keep(now || wanted);
      }
      return;
    }
    if (!now && !wanted) return;
    if (!now) {
      if (!sameComment(before, wanted)) {
        keep(wanted);
        combined = true;
      }
      return;
    }
    if (!wanted) {
      if (!sameComment(before, now)) {
        keep(now);
        combined = true;
      }
      return;
    }
    if (sameComment(now, wanted)) {
      keep(now);
    } else if (sameComment(now, before)) {
      keep(wanted);
    } else if (sameComment(wanted, before)) {
      keep(now);
    } else {
      keep(now);
      keepProposedCopy(wanted);
      combined = true;
    }
  });
  return { comments, combined, remaps };
}

function mergeTargetRevision(baseMarkdown, currentMarkdown, proposedMarkdown) {
  if (currentMarkdown === baseMarkdown) {
    return { markdown: proposedMarkdown, classification: 'clean', combined: false,
      comment_id_remaps: [] };
  }
  if (proposedMarkdown === baseMarkdown || proposedMarkdown === currentMarkdown) {
    return { markdown: currentMarkdown, classification: 'noop', combined: false,
      comment_id_remaps: [] };
  }
  const base = commentState(baseMarkdown);
  const current = commentState(currentMarkdown);
  const proposed = commentState(proposedMarkdown);
  const text = mergeText(base.markdown, current.markdown, proposed.markdown);
  const commentMerge = mergeComments(base.comments, current.comments, proposed.comments);
  const parsed = SDocYaml.parseFrontMatter(text.markdown);
  const meta = Object.assign({}, parsed.meta || {});
  if (commentMerge.comments.length) meta.comments = commentMerge.comments;
  else delete meta.comments;
  const combined = text.combined || commentMerge.combined;
  return {
    markdown: serializeDocument(meta, parsed.body),
    classification: combined ? 'combined' : text.classification,
    combined,
    comment_id_remaps: commentMerge.remaps,
  };
}

module.exports = {
  mergeTargetRevision,
};
