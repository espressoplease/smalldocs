const crypto = require('crypto');
const bindings = require('./cloud-bindings');
const { lineRange } = require('./cloud-edit');

const HELP = `SmallDocs Cloud comments

FIND FEEDBACK AND READ ITS CONTEXT

  sdoc cloud search 'launch plan' --compact --json
  sdoc cloud comments DOCUMENT_ID --json
  sdoc cloud comments DOCUMENT_ID --id c7 --json
  sdoc cloud comments DOCUMENT_ID --status all --limit 50 --json
  sdoc cloud comments DOCUMENT_ID --author Priya --all --json
  sdoc cloud comments DOCUMENT_ID --author me --pages 3 --json
  sdoc cloud comments DOCUMENT_ID --cursor CURSOR --json
  sdoc cloud comments DOCUMENT_ID --revision REVISION_ID --json
  sdoc cloud comments DOCUMENT_ID --context none --json

The document reference may also be its Cloud URL, from the connected Cloud
origin. Listing defaults to open comments, 25 results and snippet context.
--status accepts open, resolved or all. --id reads one comment, including a
resolved comment unless --status explicitly filters it out. Follow next_cursor
with the same filters while has_more is true. --pages N fetches up to N pages;
--all follows every remaining page. Use one of --pages or --all. complete is true
when that continuation is exhausted; returned_count counts collected comments.
Counts describe all document comments before filtering. --revision reads a
retained document revision. Cursors keep later pages on the same revision.

--author accepts an exact display name (case-insensitive), a user ID, or me.
IDs and me match stored author IDs exactly. These are document metadata filters,
not verification of the comment author's identity. Author and pagination options
apply to listing only.

JSON includes the document URL and revision, each comment's ID, sha256, status,
author, text, replies and stored anchor fields. Context provides bounded source
Markdown, section and line numbers when available. anchor.match_status and
anchor.source_status describe what was located; an ambiguous, lost or unverified
anchor needs inspection. A display name alone does not verify authorship.

EDIT THE DOCUMENT, RESPOND, AND RESOLVE

  sdoc cloud read DOCUMENT_ID --section Production --json
  sdoc cloud edit DOCUMENT_ID --section Production --old '10' --new '20' --base-revision READ_REVISION_ID --json
  sdoc cloud comments DOCUMENT_ID --id c7 --reply 'Updated the production limit.' --json
  sdoc cloud comments DOCUMENT_ID --id c7 --resolve --note 'Corrected and checked.' --json
  sdoc cloud comments DOCUMENT_ID --id c7 --reopen --json
  sdoc cloud comments DOCUMENT_ID --id c7 --delete --json
  sdoc cloud comments DOCUMENT_ID --id c7 --reattach --quote '45 minutes' --section Production --json
  sdoc cloud comments DOCUMENT_ID --id c7 --resolve --base-revision REVISION_ID --dry-run --json

Use scoped reads and cloud edit to change document content. Reply adds a message
to the existing comment. Resolve marks it addressed; --note adds a reply in the
same save. Reopen makes it open again. These actions preserve the original note.
Delete removes the selected comment and all its replies from the current
document. The document text and other comments stay unchanged. Use it to remove
feedback that is no longer needed, including feedback you have addressed.
Resolve keeps the thread in the current document. Earlier revisions retain
deleted feedback under the document's 90-day retention policy.
Choose one action per command. Replies and notes must contain text. For a value
beginning with --, use --reply=TEXT, --note=TEXT or --text=TEXT.

After locating the intended passage, use --reattach to repair a lost or ambiguous
anchor. It requires --id and --quote, with optional --section or --lines. It
preserves the original note, replies and status. Quote and scope select a passage
within the base revision, as for --add below.

By default, actions on existing comments read the selected comment and use its
revision and sha256 as the base. --add reads the current document head instead.
Pass --base-revision to act on feedback you read earlier. Independent
document and comment changes are preserved. comment_changed means this comment
changed since the base; inspect the returned current comment and read it again
before deciding how to proceed. comment_unavailable means the selected comment
is absent. On target_too_old, read the current feedback and reapply your intent.
On resource_unavailable, keep the intended change and confirm document access.

--dry-run previews an action without saving. Successful saves return a compact
receipt with the document URL, revision and affected comment. Read the comment
again to verify. Deletion returns action: delete, comment_id and comment: null;
use the saved revision to verify its absence. If a save response is lost, rerun
the same command: durable pending state retains its original base and
idempotency key. Changing its payload starts a new operation. Listing does not
download or bind a local Markdown file.

ADD A COMMENT

  sdoc cloud comments DOCUMENT_ID --add --text 'Check this limit.' --quote '10 minutes' --section Production --json

--add requires --text and an exact visible-text --quote from the document. Optional
--section HEADING or --lines START:END selects content in the base revision.
Line ranges are 1-based and inclusive; section and lines are alternatives.
The quote must match once. On edit_ambiguous, inspect the returned candidates
and narrow the selection. On edit_no_match, read the relevant source and retry
with its exact text. Do not combine --add with --id or another action.
`;

function error(code, message, data) { return Object.assign(new Error(message), { code, data }); }
function invalid(message) { throw error('invalid_request', message); }
function present(value) { return value !== undefined && value !== null; }
function requireText(value, option) {
  if (typeof value !== 'string' || !value.trim()) invalid(option + ' requires a nonempty value.');
}

function documentId(reference, cloudOrigin) {
  requireText(reference, 'Document reference');
  if (!/^[a-z][a-z\d+.-]*:/i.test(reference)) return reference;
  let url;
  try { url = new URL(reference); } catch (_) { invalid('Provide a document ID or a valid Cloud document URL.'); }
  if (url.origin !== new URL(cloudOrigin).origin || url.username || url.password || url.pathname !== '/docs') {
    invalid('The document URL must belong to the connected Cloud origin and use its /docs page.');
  }
  const ids = url.searchParams.getAll('cloud-document');
  if (ids.length !== 1 || !ids[0].trim()) invalid('The Cloud document URL requires one cloud-document ID.');
  return ids[0];
}

function requestOptions(opts, cloudOrigin) {
  const id = documentId(opts.extra, cloudOrigin);
  for (const [key, name] of [['revisionFlag', '--revision'], ['baseRevisionFlag', '--base-revision'],
    ['commentCursorFlag', '--cursor']]) if (present(opts[key])) requireText(opts[key], name);
  if (present(opts.commentIdFlag) && !/^c\d+$/.test(opts.commentIdFlag)) invalid('--id requires a comment ID such as c7.');
  const actions = [present(opts.commentReplyFlag) && 'reply', opts.commentResolveFlag && 'resolve',
    opts.commentReopenFlag && 'reopen', opts.commentDeleteFlag && 'delete', opts.commentAddFlag && 'add', opts.commentReattachFlag && 'reattach'].filter(Boolean);
  if (actions.length > 1) invalid('Choose one of --reply, --resolve, --reopen, --delete, --add or --reattach.');
  const action = actions[0] || null;
  if (!action) {
    if (opts.dryRunFlag || present(opts.baseRevisionFlag) || present(opts.noteText) ||
        present(opts.commentTextFlag) || present(opts.commentQuoteFlag) || present(opts.section) || present(opts.linesFlag)) {
      invalid('Action options require --reply, --resolve, --reopen, --delete, --add or --reattach.');
    }
    const status = present(opts.commentStatusFlag) ? opts.commentStatusFlag : (opts.commentIdFlag ? 'all' : 'open');
    if (!['open', 'resolved', 'all'].includes(status)) invalid('--status must be open, resolved or all.');
    const context = present(opts.commentContextFlag) ? opts.commentContextFlag : 'snippet';
    if (!['none', 'snippet'].includes(context)) invalid('--context must be none or snippet.');
    const limit = present(opts.commentLimitFlag) ? Number(opts.commentLimitFlag) : 25;
    if (!Number.isSafeInteger(limit) || limit < 1) invalid('--limit requires a positive integer.');
    if (present(opts.commentAuthorFlag)) requireText(opts.commentAuthorFlag, '--author');
    if (opts.commentAllFlag && present(opts.commentPagesFlag)) invalid('Use either --all or --pages N.');
    const pages = present(opts.commentPagesFlag) ? Number(opts.commentPagesFlag) : 1;
    if (!Number.isSafeInteger(pages) || pages < 1) invalid('--pages requires a positive integer.');
    return { documentId: id, query: { status, limit, context, comment_id: opts.commentIdFlag,
      cursor: opts.commentCursorFlag, revision_id: opts.revisionFlag,
      author: present(opts.commentAuthorFlag) ? opts.commentAuthorFlag.trim() : undefined },
    pageLimit: opts.commentAllFlag ? Infinity : pages };
  }
  if (opts.commentAllFlag || ['commentStatusFlag', 'commentLimitFlag', 'commentCursorFlag', 'commentContextFlag',
    'commentAuthorFlag', 'commentPagesFlag', 'revisionFlag'].some(key => present(opts[key]))) {
    invalid('Listing filters cannot be combined with an action. Use --base-revision for an action base.');
  }
  if (present(opts.noteText) && action !== 'resolve') invalid('--note belongs to --resolve. Use --reply to add a message.');
  if (present(opts.noteText)) requireText(opts.noteText, '--note');
  if (action === 'add' || action === 'reattach') {
    if (action === 'add') {
      if (present(opts.commentIdFlag)) invalid('--add cannot use --id.');
      requireText(opts.commentTextFlag, '--text');
    } else {
      if (!opts.commentIdFlag) invalid('--reattach requires --id COMMENT_ID.');
      if (present(opts.commentTextFlag)) invalid('--text belongs to --add. Reattach preserves the original note.');
    }
    requireText(opts.commentQuoteFlag, '--quote');
    if (present(opts.section) && present(opts.linesFlag)) invalid('Use either --section or --lines.');
    if (present(opts.section)) requireText(opts.section, '--section');
    const anchor = { kind: 'inline', quote: opts.commentQuoteFlag };
    if (present(opts.section)) anchor.section = opts.section;
    if (present(opts.linesFlag)) anchor.lines = lineRange(opts.linesFlag);
    return { documentId: id, action: action === 'add' ? { action, text: opts.commentTextFlag, anchor }
      : { action, comment_id: opts.commentIdFlag, anchor } };
  }
  if (!opts.commentIdFlag) invalid('This action requires --id COMMENT_ID.');
  if (present(opts.commentTextFlag) || present(opts.commentQuoteFlag) || present(opts.section) || present(opts.linesFlag)) {
    invalid('--text belongs to --add. Use --add or --reattach for quote and scope options.');
  }
  if (action === 'reply') requireText(opts.commentReplyFlag, '--reply');
  const input = { action, comment_id: opts.commentIdFlag };
  if (action === 'reply') input.text = opts.commentReplyFlag;
  if (present(opts.noteText)) input.text = opts.noteText;
  return { documentId: id, action: input };
}

function endpoint(documentId) { return '/api/cloud/v1/documents/' + encodeURIComponent(documentId); }
function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (present(value)) params.set(key, value);
  return params.toString();
}
function explainUnavailable(err) {
  if (err.code === 'resource_unavailable') err.message =
    'The document is unavailable or your access has changed. Keep the intended comment action and confirm access before retrying.';
  return err;
}
function receipt(response, id, helpers, client) {
  const value = { ...response };
  const document = response.document;
  if (!document || !(document.revision_id || document.current_revision_id)) {
    throw error('temporary_service_failure', 'Cloud returned an invalid comment response.');
  }
  value.document = { ...document, url: document.url || helpers.documentUrl(client, id) };
  delete value.document.markdown;
  delete value.markdown;
  value.document_id = document.id || document.document_id || id;
  value.revision_id = document.revision_id || document.current_revision_id;
  value.url = value.document.url;
  return value;
}

async function run(opts, client, helpers) {
  const input = requestOptions(opts, client.origin);
  const id = input.documentId;
  if (!input.action) {
    const query = { ...input.query };
    const collected = [], seenCursors = new Set();
    const startedFromCursor = Boolean(query.cursor);
    if (query.cursor) seenCursors.add(query.cursor);
    let response, pagesFetched = 0, firstRevision, counts;
    function result(reason) {
      return { ...receipt(response, id, helpers, client), comments: collected.slice(), counts,
        returned_count: collected.length, pages_fetched: pagesFetched,
        started_from_cursor: startedFromCursor, complete: reason === 'complete', stopped_reason: reason,
        has_more: Boolean(response.has_more || response.next_cursor), next_cursor: response.next_cursor || null };
    }
    do {
      try {
        const page = await client.authenticated(endpoint(id) + '/comments?' + queryString(query));
        if (!Array.isArray(page.comments)) throw error('temporary_service_failure', 'Cloud returned an invalid comments list.');
        const value = receipt(page, id, helpers, client);
        if (firstRevision && firstRevision !== value.revision_id) {
          throw error('temporary_service_failure', 'Cloud returned comment pages from different revisions.');
        }
        if (!pagesFetched) { firstRevision = value.revision_id; counts = page.counts; }
        response = page;
      } catch (err) {
        if (pagesFetched) err.data = { ...err.data, partial_result: result('request_failed') };
        throw err;
      }
      pagesFetched++;
      collected.push(...response.comments);
      if (!response.has_more && !response.next_cursor) return helpers.emit(opts, 'cloud.comments', result('complete'));
      if (!response.next_cursor || seenCursors.has(response.next_cursor)) {
        throw error('temporary_service_failure', 'Cloud returned an invalid comments continuation.',
          { partial_result: result('invalid_continuation') });
      }
      seenCursors.add(response.next_cursor);
      query.cursor = response.next_cursor;
    } while (pagesFetched < input.pageLimit);
    return helpers.emit(opts, 'cloud.comments', result('page_limit'));
  }
  const credential = client.loadCredential();
  if (!credential) throw error('login_required', 'Run `sdoc cloud login`.');
  const requestHash = bindings.hash(JSON.stringify({ ...input.action, explicit_base_revision_id: opts.baseRevisionFlag || null }));
  let pending = opts.dryRunFlag ? null : bindings.getOperationPending(credential.user_id, 'comments', id);
  if (pending && pending.request_sha256 !== requestHash) pending = null;
  let request = pending && pending.request;
  if (!request) {
    let base = opts.baseRevisionFlag;
    let fingerprint;
    try {
      if (input.action.action === 'add') {
        if (!base) {
          const response = await client.authenticated(endpoint(id) + '/head');
          const head = response.document || response;
          base = head.revision_id || head.current_revision_id;
        }
      } else {
        const response = await client.authenticated(endpoint(id) + '/comments?' + queryString({
          comment_id: input.action.comment_id, status: 'all', context: 'none', revision_id: base,
        }));
        const document = response.document || {};
        base = document.revision_id || document.current_revision_id;
        const comment = Array.isArray(response.comments) && response.comments.find(value => value && value.id === input.action.comment_id);
        if (!comment) throw error('comment_unavailable', 'The selected comment is absent. Read the current comments before retrying.');
        fingerprint = comment.sha256;
        if (typeof fingerprint !== 'string' || !fingerprint) throw error('temporary_service_failure', 'Cloud did not return the selected comment fingerprint.');
      }
    } catch (err) { throw explainUnavailable(err); }
    if (!base) throw error('temporary_service_failure', 'Cloud did not return the comment action base revision.');
    request = { ...input.action, base_revision_id: base };
    if (fingerprint) request.expected_comment_sha256 = fingerprint;
    if (!opts.dryRunFlag) {
      request.idempotency_key = crypto.randomUUID();
      pending = { document_id: id, base_revision_id: base, request_sha256: requestHash,
        idempotency_key: request.idempotency_key, request };
      bindings.setOperationPending(credential.user_id, 'comments', id, pending);
    }
  }
  let response;
  try {
    response = await client.authenticated(endpoint(id) + '/comments/actions' + (opts.dryRunFlag ? '/preview' : ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch (err) {
    if (!opts.dryRunFlag && ['invalid_request', 'comment_changed', 'comment_unavailable', 'revision_conflict',
      'target_too_old', 'base_revision_unavailable', 'edit_no_match', 'edit_ambiguous', 'section_not_found',
      'section_ambiguous'].includes(err.code)) bindings.clearOperationPending(credential.user_id, 'comments', id);
    throw explainUnavailable(err);
  }
  const value = receipt(response, id, helpers, client);
  value.base_revision_id = value.base_revision_id || request.base_revision_id;
  if (opts.dryRunFlag) value.dry_run = true;
  else bindings.clearOperationPending(credential.user_id, 'comments', id);
  return helpers.emit(opts, 'cloud.comments', value, (opts.dryRunFlag ? 'Preview only. No changes saved.\n' : '') + JSON.stringify(value, null, 2));
}

module.exports = { HELP, requestOptions, documentId, run };
