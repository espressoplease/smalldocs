'use strict';

function describe(row) {
  if (!row) return null;
  return { revision_id: row.id, revision_number: row.revision_number,
    actor_user_id: row.created_by_user_id,
    kind: row.revision_number === 1 ? 'created' : row.created_by_credential_id ? 'agent' : 'browser',
    edit_session_id: row.edit_session_id || null,
    updated_at: new Date(row.created_at_ms).toISOString() };
}

function activity(db, document, openedRevision) {
  const number = openedRevision ? openedRevision.revision_number : db.prepare(
    'SELECT revision_number FROM cloud_document_revisions WHERE id=? AND document_id=?'
  ).get(document.current_revision_id, document.id)?.revision_number;
  const latest = openedRevision && openedRevision.id ? openedRevision : db.prepare(`SELECT id,
    revision_number, created_by_user_id, created_by_credential_id, edit_session_id, created_at_ms
    FROM cloud_document_revisions WHERE document_id=? AND revision_number=?`).get(document.id, number);
  const agent = db.prepare(`SELECT id FROM cloud_document_revisions
    WHERE document_id=? AND created_by_credential_id IS NOT NULL AND revision_number>1
    ORDER BY revision_number DESC LIMIT 1`).get(document.id);
  return { latest: describe(latest), has_agent_edits: Boolean(document.agent_edit_seen || agent),
    last_agent_revision_id: agent ? agent.id : null };
}

function page(db, document, input) {
  // Keyset pagination reads only the newest requested runs. All queries use
  // revision metadata; ciphertext and Markdown never enter this listing.
  const scope = [document.id, document.workspace_id, document.project_id];
  const columns = 'id,parent_revision_id,revision_number,created_by_user_id,created_by_credential_id,edit_session_id,created_at_ms';
  const newest = db.prepare(`SELECT ${columns} FROM cloud_document_revisions
    WHERE document_id=? AND workspace_id=? AND project_id=? AND revision_number<? ORDER BY revision_number DESC LIMIT 1`);
  const boundary = db.prepare(`SELECT revision_number FROM cloud_document_revisions
    WHERE document_id=? AND workspace_id=? AND project_id=? AND revision_number<?
      AND (created_by_credential_id IS NOT NULL OR created_by_user_id<>? OR edit_session_id IS NULL OR edit_session_id<>?)
    ORDER BY revision_number DESC LIMIT 1`);
  const firstInRun = db.prepare(`SELECT ${columns} FROM cloud_document_revisions
    WHERE document_id=? AND workspace_id=? AND project_id=? AND revision_number>? AND revision_number<=?
    ORDER BY revision_number LIMIT 1`);
  const countRun = db.prepare(`SELECT COUNT(*) AS count FROM cloud_document_revisions
    WHERE document_id=? AND workspace_id=? AND project_id=? AND revision_number>? AND revision_number<=?`);
  const entries = [];
  let before = input.after ? input.after.revision_number : Number.MAX_SAFE_INTEGER;
  while (entries.length <= input.limit) {
    const last = newest.get(...scope, before);
    if (!last) break;
    let first = last, count = 1;
    if (last.edit_session_id && !last.created_by_credential_id) {
      // A different writer or session is a boundary even if this browser
      // later continues with the same session ID.
      const end = boundary.get(...scope, last.revision_number, last.created_by_user_id, last.edit_session_id)?.revision_number || 0;
      first = firstInRun.get(...scope, end, last.revision_number);
      count = countRun.get(...scope, end, last.revision_number).count;
    }
    entries.push({ ...describe(last), id: first.id, before_revision_id: first.parent_revision_id,
      first_revision_number: first.revision_number, save_count: count,
      started_at: new Date(first.created_at_ms).toISOString() });
    before = first.revision_number;
  }
  const values = entries.slice(0, input.limit), last = values.at(-1);
  return { entries: values, nextPosition: entries.length > input.limit && last ? { revision_number: last.first_revision_number } : null };
}

module.exports = { activity, page };
