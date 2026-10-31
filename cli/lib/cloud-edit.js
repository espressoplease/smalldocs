const crypto = require('crypto');
const fs = require('fs');
const bindings = require('./cloud-bindings');

const HELP = `SmallDocs Cloud edit

FIND, READ, EDIT

  sdoc cloud libraries --json
  sdoc cloud search 'specific words' --account LIBRARY_ID --compact --json
  sdoc cloud read DOCUMENT_ID --outline --json
  sdoc cloud read DOCUMENT_ID --section Pricing --json

Choose the intended library. Check the result's title, tags and snippets, then
read the relevant section. Pass its revision_id as --base-revision when saving.

  sdoc cloud edit DOCUMENT_ID --old 'Cap: 10' --new 'Cap: 20' --json
  sdoc cloud edit DOCUMENT_ID --section Pricing --old '10' --new '20' --json
  sdoc cloud edit DOCUMENT_ID --lines 10:30 --old 'Old text' --new 'New text' --json
  sdoc cloud edit DOCUMENT_ID --edits-file edits.json --dry-run --json
  sdoc cloud edit DOCUMENT_ID --edits '[{"old_text":"Draft","new_text":"Final"}]' --json
  sdoc cloud edit DOCUMENT_ID --patch-file change.diff --json

Replace exact, case-sensitive text in a Cloud document without downloading or
uploading its full Markdown. --new '' deletes the matched text. Old text must
be nonempty. For text beginning with --, use --old=TEXT or --new=TEXT.

By default, the CLI reads the current revision ID and uses it as the edit base.
Pass --base-revision REVISION_ID to edit against a retained revision you read
earlier. Section headings and 1-based inclusive line ranges select content in
that base, before any edit in the batch. All batch edits use the same base.
--section and --lines are alternatives. Heading titles or full heading paths
match exactly, for example 'Service guide > Pricing'.

A replacement must match once. If edit_ambiguous reports several matches, add
--section HEADING, --lines START:END, or --occurrence N (1-based within the
selection). --all-matches replaces every match. Use either --occurrence or
--all-matches. On edit_no_match, read the base section or lines and retry with
its exact text. section_not_found and section_ambiguous include heading details;
read --outline to locate the intended section or use a line range.
On target_too_old, read the current section and reapply the intended change
against its revision, preserving newer content.

BATCH JSON

--edits accepts inline JSON; --edits-file reads a JSON file. Both accept an
array or {"edits":[...]}:

  [{"old_text":"Cap: 10","new_text":"Cap: 20","section":"Pricing"},
   {"old_text":"Draft","new_text":"Final","lines":"10:30","occurrence":2}]

Each edit requires old_text and new_text. Optional fields are section, lines,
occurrence, all (boolean), context_before and context_after (exact strings).
Context disambiguates the old text without replacing the context itself.
Overlapping edits are refused. Batch files cannot use the single-edit flags.
--patch-file accepts a contextual unified diff for this one document. Its
context must match the base. Patch files cannot use replacement or scope flags.

PREVIEW, SAVE, AND RETRY

--dry-run returns matches, a diff and merge details without saving a revision
or changing local pending state. The preview describes the observed head.
Pass its current_revision_id as --if-current REVISION_ID to refuse a save if
another writer changes the document. --reject-conflicts refuses saves with
overlapping concurrent changes; previews still show those changes.
Normally independent changes merge and both overlapping
passages are preserved. Inspect combined and overlapping_edits_preserved.

A save returns a compact receipt with revision IDs, saved_sha256, match and
merge details, diff, and url. Read the saved revision to verify its content.
overlaps contains bounded excerpts when concurrent passages differ. These
passages are retained by default; the receipt does not impose a review step.
Account can_write describes creation, not editing. Check a document's
permission.can_edit for editing access.
If a response is lost, rerun the same command and file contents. The CLI keeps
the base revision and idempotency key so that retry does not save it twice.
Changing the edit payload starts a new operation.

For a full replacement or a local working copy, continue to use cloud pull,
edit the local file, and cloud push. Run cloud push --help for that workflow.
`;

function error(code, message, data) {
  return Object.assign(new Error(message), { code, data });
}

function invalid(message) { throw error('invalid_request', message); }
function explainUnavailable(err) {
  if (err.code === 'resource_unavailable') {
    err.message = 'The document is unavailable or your access has changed. Keep the proposed edits and confirm access before retrying.';
  }
  return err;
}
function present(value) { return value !== undefined && value !== null; }

function lineRange(value, label) {
  const match = typeof value === 'string' && /^(\d+):(\d+)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))
      || Number(match[1]) < 1 || Number(match[2]) < Number(match[1])) {
    invalid((label || '--lines') + ' requires a 1-based inclusive START:END range.');
  }
  return Number(match[1]) + ':' + Number(match[2]);
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) invalid(label + ' requires a nonempty value.');
}

function validateRead(opts) {
  const selections = [present(opts.linesFlag), present(opts.section), Boolean(opts.outlineFlag)];
  if (selections.filter(Boolean).length > 1) invalid('Use one of --lines, --section, or --outline.');
  if (present(opts.linesFlag)) lineRange(opts.linesFlag);
  if (present(opts.section)) requireText(opts.section, '--section');
  if (present(opts.revisionFlag)) requireText(opts.revisionFlag, '--revision');
}

function validateEdit(edit, index) {
  const label = 'Edit ' + (index + 1);
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) invalid(label + ' must be an object.');
  const allowed = new Set(['old_text', 'new_text', 'section', 'lines', 'occurrence', 'all', 'context_before', 'context_after']);
  const has = key => Object.hasOwn(edit, key);
  for (const key of Object.keys(edit)) if (!allowed.has(key)) invalid(label + ' has an unknown field: ' + key + '.');
  if (typeof edit.old_text !== 'string' || !edit.old_text.length) invalid(label + ' requires nonempty old_text.');
  if (typeof edit.new_text !== 'string') invalid(label + ' requires new_text, which may be an empty string.');
  if (has('section') && has('lines')) invalid(label + ' must use either section or lines.');
  if (has('section')) requireText(edit.section, label + ' section');
  if (has('lines')) edit.lines = lineRange(edit.lines, label + ' lines');
  if (has('occurrence') && (!Number.isSafeInteger(edit.occurrence) || edit.occurrence < 1)) {
    invalid(label + ' occurrence must be a positive integer.');
  }
  if (has('all') && typeof edit.all !== 'boolean') invalid(label + ' all must be a boolean.');
  if (has('occurrence') && edit.all) invalid(label + ' must use either occurrence or all.');
  for (const field of ['context_before', 'context_after']) {
    if (has(field) && typeof edit[field] !== 'string') invalid(label + ' ' + field + ' must be a string.');
  }
  const normalized = {};
  for (const key of allowed) if (has(key)) normalized[key] = edit[key];
  return normalized;
}

function readFile(file, option) {
  requireText(file, option);
  try { return fs.readFileSync(file, 'utf8'); }
  catch (_) { invalid('Could not read ' + option + ': ' + file); }
}

function editRequest(opts) {
  if (!opts.extra) invalid('usage: sdoc cloud edit DOCUMENT_ID --old TEXT --new TEXT --json');
  for (const key of ['baseRevisionFlag', 'ifCurrentFlag']) {
    if (present(opts[key])) requireText(opts[key], key === 'baseRevisionFlag' ? '--base-revision' : '--if-current');
  }
  const hasSingle = [opts.oldTextFlag, opts.newTextFlag].some(present);
  const hasScope = [opts.section, opts.linesFlag, opts.occurrenceFlag].some(present) || opts.allMatchesFlag;
  const forms = [hasSingle, present(opts.editsFileFlag), present(opts.editsJsonFlag), present(opts.patchFileFlag)].filter(Boolean).length;
  if (forms !== 1) invalid('Choose --old with --new, --edits, --edits-file, or --patch-file.');
  if (!hasSingle && hasScope) invalid('Scope and match flags belong to each batch edit and cannot be used with --edits-file or --patch-file.');
  let content;
  if (present(opts.patchFileFlag)) {
    const patch = readFile(opts.patchFileFlag, '--patch-file');
    if (!patch.length) throw error('invalid_patch', 'The patch file is empty.');
    content = { patch };
  } else {
    let edits;
    if (present(opts.editsFileFlag) || present(opts.editsJsonFlag)) {
      let parsed;
      const option = present(opts.editsJsonFlag) ? '--edits' : '--edits-file';
      try { parsed = JSON.parse(present(opts.editsJsonFlag) ? opts.editsJsonFlag : readFile(opts.editsFileFlag, option)); }
      catch (err) { if (err.code) throw err; invalid(option + ' must contain valid JSON.'); }
      if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
        if (Object.keys(parsed).some(key => key !== 'edits')) invalid(option + ' wrapper accepts only the edits field.');
        parsed = parsed.edits;
      }
      if (!Array.isArray(parsed) || !parsed.length) invalid(option + ' must contain a nonempty edits array.');
      edits = parsed;
    } else {
      const edit = { old_text: opts.oldTextFlag, new_text: opts.newTextFlag };
      if (present(opts.section)) edit.section = opts.section;
      if (present(opts.linesFlag)) edit.lines = opts.linesFlag;
      if (present(opts.occurrenceFlag)) {
        if (!/^\d+$/.test(String(opts.occurrenceFlag))) invalid('--occurrence requires a positive integer.');
        edit.occurrence = Number(opts.occurrenceFlag);
      }
      if (opts.allMatchesFlag) edit.all = true;
      edits = [edit];
    }
    content = { edits: edits.map(validateEdit) };
  }
  return Object.assign(content, { reject_conflicts: Boolean(opts.rejectConflictsFlag),
    expected_current_revision_id: opts.ifCurrentFlag || undefined });
}

async function runEdit(opts, client, helpers) {
  // Validate the entire local payload before credential access or a request.
  const input = editRequest(opts);
  const credential = client.loadCredential();
  if (!credential) throw error('login_required', 'Run `sdoc cloud login`.');
  const documentId = opts.extra;
  const endpoint = '/api/cloud/v1/documents/' + encodeURIComponent(documentId);
  const requestHash = bindings.hash(JSON.stringify({ ...input, explicit_base_revision_id: opts.baseRevisionFlag || null }));
  let pending = opts.dryRunFlag ? null : bindings.getOperationPending(credential.user_id, 'edit', documentId);
  if (pending && pending.request_sha256 !== requestHash) pending = null;
  let baseRevisionId = pending && pending.base_revision_id || opts.baseRevisionFlag;
  if (!baseRevisionId) {
    let response;
    try { response = await client.authenticated(endpoint + '/head'); }
    catch (err) { throw explainUnavailable(err); }
    const head = response.document || response;
    baseRevisionId = head.revision_id || head.current_revision_id;
    if (!baseRevisionId) throw error('temporary_service_failure', 'Cloud did not return the current document revision.');
  }
  const request = { ...input, base_revision_id: baseRevisionId };
  if (!opts.dryRunFlag) {
    if (!pending) {
      pending = { document_id: documentId, base_revision_id: baseRevisionId,
        request_sha256: requestHash, idempotency_key: crypto.randomUUID() };
      bindings.setOperationPending(credential.user_id, 'edit', documentId, pending);
    }
    request.idempotency_key = pending.idempotency_key;
  }
  let response;
  try {
    response = await client.authenticated(endpoint + (opts.dryRunFlag ? '/edits/preview' : '/edits'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch (err) {
    explainUnavailable(err);
    if (!opts.dryRunFlag && ['invalid_request', 'edit_no_match', 'edit_ambiguous', 'section_not_found',
      'section_ambiguous', 'invalid_patch', 'overlapping_edits', 'revision_conflict',
      'base_revision_unavailable', 'target_too_old'].includes(err.code)) {
      bindings.clearOperationPending(credential.user_id, 'edit', documentId);
    }
    throw err;
  }
  const receipt = response.document || response.receipt || response;
  const revisionId = receipt.revision_id || receipt.current_revision_id;
  if (!revisionId) throw error('temporary_service_failure', 'Cloud returned an invalid edit receipt.');
  const value = { ...receipt, document_id: receipt.document_id || receipt.id || documentId,
    revision_id: revisionId, base_revision_id: receipt.base_revision_id || baseRevisionId,
    url: receipt.url || helpers.documentUrl(client, documentId) };
  delete value.markdown;
  if (opts.dryRunFlag) value.dry_run = true;
  else bindings.clearOperationPending(credential.user_id, 'edit', documentId);
  return helpers.emit(opts, 'cloud.edit', value, (opts.dryRunFlag ? 'Preview only. No changes saved.\n' : '')
    + JSON.stringify(value, null, 2));
}

module.exports = { HELP, validateRead, editRequest, runEdit, lineRange };
