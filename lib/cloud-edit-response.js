'use strict';

// Bound diagnostic output, not the document or the number of edits saved.
function compactDiff(diff) {
  if (!diff) return diff;
  let remaining = 6000;
  let truncated = false;
  function lines(values) {
    const result = [];
    for (const value of values || []) {
      if (remaining <= 0) { truncated = true; break; }
      const text = String(value);
      const clipped = text.slice(0, Math.min(remaining, 1200));
      remaining -= clipped.length;
      if (clipped.length < text.length) truncated = true;
      result.push(clipped);
    }
    return result;
  }
  const hunks = [];
  for (const hunk of diff.hunks || []) {
    if (remaining <= 0 || hunks.length >= 8) { truncated = true; break; }
    hunks.push({ before_line: hunk.before_line, after_line: hunk.after_line,
      before: lines(hunk.before), after: lines(hunk.after),
      context_before: lines(hunk.context_before), context_after: lines(hunk.context_after) });
  }
  return { changed: diff.changed, added_lines: diff.added_lines, removed_lines: diff.removed_lines,
    total_hunks: (diff.hunks || []).length, hunks, truncated };
}

function editReceipt(document, origin) {
  const receipt = {};
  for (const key of ['id', 'title', 'filename', 'tags', 'workspace_id', 'project_id',
    'current_revision_id', 'revision_number', 'updated_at', 'preview', 'target_revision_id',
    'merged_from_revision_id', 'merge_classification', 'merge_retry_count', 'combined',
    'target_recovered', 'conflict_count', 'base_sha256', 'current_sha256', 'proposed_sha256',
    'content_sha256', 'would_change', 'metadata_changed', 'revision_created', 'matched_count']) {
    if (document[key] !== undefined) receipt[key] = document[key];
  }
  receipt.document_id = document.id;
  receipt.revision_id = document.current_revision_id;
  receipt.base_revision_id = document.target_revision_id;
  receipt.saved_sha256 = document.preview ? undefined : document.content_sha256;
  receipt.url = origin + '/docs?cloud-document=' + encodeURIComponent(document.id);
  receipt.overlapping_edits_preserved = !document.preview && document.conflict_count > 0;
  receipt.overlaps = (document.conflicts || []).slice(0, 5).map(conflict => {
    const value = {};
    for (const key of ['kind', 'source', 'base_start_line', 'base_end_line_exclusive', 'comment_id', 'reason']) {
      if (conflict[key] !== undefined) value[key] = conflict[key];
    }
    for (const key of ['base', 'current', 'proposed']) {
      const original = conflict[key];
      const text = typeof original === 'string' ? original : JSON.stringify(original);
      value[key] = text == null ? null : text.slice(0, 600);
      if (text && text.length > 600) value.truncated = true;
    }
    return value;
  });
  receipt.overlaps_truncated = (document.conflicts || []).length > receipt.overlaps.length;
  receipt.applied_edits = (document.applied_edits || []).slice(0, 100);
  receipt.applied_edit_count = (document.applied_edits || []).length;
  receipt.applied_edits_truncated = receipt.applied_edit_count > receipt.applied_edits.length;
  receipt.diff = compactDiff(document.diff);
  return receipt;
}

module.exports = { compactDiff, editReceipt };
