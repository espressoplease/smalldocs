const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const constants = require('./constants');
const io = require('./io');
const credentialStore = require('./cloud-credentials');
const bindings = require('./cloud-bindings');
const SDocYaml = require('../shared/sdocs-yaml.js');
const searchQuery = require('../shared/sdocs-search-query.js');

const EXIT = { unexpected: 1, invalid_request: 2, login_required: 3,
  resource_unavailable: 4, account_required: 4, account_selection_required: 4,
  permission_denied: 4, revision_conflict: 5,
  idempotency_mismatch: 5,
  unsafe_local_state: 6, base_revision_unavailable: 6, target_too_old: 6, rate_limited: 7,
  search_limit_reached: 7, search_index_building: 7, temporary_service_failure: 7, billing_not_configured: 7,
  authentication_not_configured: 7, cloud_storage_not_configured: 7,
  subscription_required: 4, subscription_read_only: 4, payment_grace_expired: 4,
  storage_limit_exceeded: 4, project_limit_reached: 4, member_limit_reached: 4,
  file_too_large: 2 };

const CLOUD_HELP = `SmallDocs Cloud

Cloud stores selected Markdown documents with search, revisions, member access,
and cross-device CLI and browser access. Run \`sdoc setup --cloud --yes\` to make
ordinary \`sdoc FILE.md\` opens create or update the Cloud document first.

SAVE, OPEN, AND LINK IN CHAT

  sdoc FILE.md --cloud --json
  sdoc FILE.md --cloud --account ACCOUNT_UUID --json
  sdoc FILE.md --cloud --no-open --json

The authenticated CLI uploads first, then opens the same Cloud URL returned
in url. The local Markdown is the editable working copy. Its binding keeps
the document ID stable across edits; successful saves advance the revision.
An unchanged file does not create another revision. --no-open still saves
and returns the URL. The browser needs its own signed-in session and access.

When linking a SmallDoc in chat, always use the returned Cloud url. Never
link to the underlying local file, a file:// URL, or a local Markdown path.
Do not invent a URL or present an upload failure as a saved document.
With --json, check ok and the exit status before using url. If
local_changed_after_upload is true, the latest local changes were not included
in this save; run the command again to save them.

Create, pull, push, and restore also return url in JSON. List and search
results include documents[].url, so existing documents can be linked without
uploading them again. The URL identifies a document; it does not grant access.
Feedback and bridge commands still use local live sessions. A Cloud URL does
not turn those sessions into Cloud-backed feedback.

LIBRARIES AND COMPUTER DEFAULTS

  sdoc cloud libraries --json
  sdoc cloud library-default --json
  sdoc cloud library-default LIBRARY_UUID --json
  sdoc cloud library-default clear --json
  sdoc cloud move DOCUMENT_UUID --account LIBRARY_UUID --dry-run --json
  sdoc cloud move DOCUMENT_UUID --account LIBRARY_UUID --json

A library is the membership boundary. A paid subscription covers a person across
libraries; payment never grants access to someone else's documents. A computer
default applies only to new unbound documents from this authenticated CLI connection.
An explicit --account takes priority. Existing file bindings keep their library.
When there are several libraries and no established destination, ask the user.
Never use the last library viewed in a browser as the CLI destination.
Moving preserves the document URL and revision history, resets access to Only you,
and removes access for old-library members. Only the document's creator can move it.
Review the destination with --dry-run before moving documents on a user's behalf.

DISCOVER AND READ

  sdoc cloud status --json
  sdoc cloud tags --json
  sdoc cloud search "incident response" --json
  sdoc cloud search "authentication" --tag engineering --limit 10 --json
  sdoc cloud ls --shared-with-me --json
  sdoc cloud read DOCUMENT_ID --json
  sdoc cloud pull DOCUMENT_UUID --output /tmp/reference.md --no-bind --json

Search finds all query words across document titles, filenames, tags, and current
Markdown. Use inner double quotes for a phrase, OR for alternatives, NOT to
exclude, and a trailing * for a word prefix. Multiple --tag values require every
listed tag. Run sdoc cloud search --help for the full query and filter reference.

With --json, search returns documents[]. Each result includes its id, url, title,
tags, current revision metadata, and matches[]. A match reports field, line,
and snippet. Search does not return the full Markdown. Use read to retrieve a
result on stdout without a local file or binding. With pull, --no-bind makes that output a read-only reference from the CLI's point
of view, so a later push will not update the Cloud document by accident.

UPDATE AN EXISTING DOCUMENT

  sdoc cloud pull DOCUMENT_UUID --output ./plan.md --json
  # Edit ./plan.md with normal file tools.
  sdoc cloud push ./plan.md --dry-run --json
  sdoc cloud push ./plan.md --json

Run sdoc cloud push --help for previews, conflict protection, verification and recovery.
Account can_write is a legacy creation capability. can_create_document names
that capability explicitly. write_entitlement describes billing, while each
document permission.can_edit describes access to edit that document. A member
can edit a shared document even without a default project for new documents.

A normal pull binds the local path to the Cloud document and revision. Push
uses that binding. Inspect merge_classification, combined,
local_updated_from_cloud, and local_changed_after_upload in the JSON response.
Cloud may combine work saved by another writer since the pull.

CREATE, ORGANIZE, AND SHARE ACCESS

  sdoc cloud create PATH [--account UUID] --json
  sdoc cloud tag DOCUMENT_UUID --tag TAG [--tag TAG ...] --json
  sdoc cloud access DOCUMENT_UUID [--only-you | --everyone | --member USER_ID ...] --json
  sdoc cloud members [--account UUID] --json
  sdoc cloud permission-groups [--account UUID] --json
  sdoc cloud notify DOCUMENT_UUID [--document DOCUMENT_UUID ...] --member USER_ID ... [--note TEXT] --json

Notification sends a message to existing account members. It does not grant
access or create a user. List members and set access deliberately before
notifying them.

HISTORY AND DELETION

  sdoc cloud history DOCUMENT_UUID --diffs --json
  sdoc cloud restore DOCUMENT_UUID --revision REVISION_UUID --json
  sdoc cloud delete DOCUMENT_UUID --base-revision UUID --json
  sdoc cloud deleted --json
  sdoc cloud undelete DOCUMENT_UUID --base-revision UUID --json

CONNECTION

  sdoc cloud                       Show capabilities and the next setup step
  sdoc cloud login [--no-open]
  sdoc cloud logout
  sdoc cloud status [--account UUID]

Search and listing span accessible libraries unless --account UUID narrows them.
Use --account UUID for account-scoped discovery or a known creation destination.
Add --json to any command for one machine-readable JSON object on stdout.`;

const CLOUD_SEARCH_HELP = `SmallDocs Cloud search

  sdoc cloud search [QUERY ...] [FILTERS] --json
  sdoc cloud ls [FILTERS] --json

QUERY

  sdoc cloud search incident response --json
  sdoc cloud search '"incident response"' --json
  sdoc cloud search '(incident OR outage) AND NOT exercise' --json
  sdoc cloud search 'title:rollout OR body:migrat*' --json
  sdoc cloud search 'incident response' --literal --json

Plain words require every word, anywhere in the searched fields. Search is
case-insensitive. Inner double quotes preserve a phrase; shell quotes alone
only keep an argument together. A trailing * matches word prefixes. Operators
are AND, OR, and NOT; parentheses group clauses. NOT binds before AND, which
binds before OR. Adjacent clauses imply AND. Prefix a term or phrase with
title:, filename:, body:, or tags: to search that field. Explicit field prefixes
apply to their own terms; --field limits unqualified text. --literal searches the
whole supplied text as a substring, including punctuation and operator words.
Quoted phrases require adjacent normalized words in one field, ignoring
punctuation and line breaks. Literal queries scan authorized document content
and can take longer than indexed words or phrases. This is text search; it does not infer synonyms. Use OR to supply alternatives.
NOT excludes a lexical match. It cannot decide whether a document supports,
contradicts, or merely discusses an idea. Read the sources for those judgments.
--word-forms expands English singular/plural forms of unquoted words; phrases
and literal queries keep their matching rules.

FILTERS

  --account UUID             Search one library; omitted means all accessible
  --tag TAG                  Require this exact tag; repeat for all tags
  --any-tag TAG              Require any of these exact tags; repeat
  --exclude-tag TAG          Exclude documents carrying this tag; repeat
  --author USER_ID|me           Document creator; repeated values mean any
  --mine                     Same as --author me
  --updated-by USER_ID|me       Author of the current revision; repeat for any
  --shared-with-me           Accessible documents created by somebody else
  --document UUID            Restrict to these document IDs; repeat
  --documents-file PATH      Add document IDs from a file, one per line
  --field FIELD              Search title, filename, body, or tags; repeat
  --created-after ISO_DATE   Lower creation-time bound
  --created-before ISO_DATE  Upper creation-time bound
  --updated-after ISO_DATE   Lower modification-time bound
  --updated-before ISO_DATE  Upper modification-time bound
  --sort ORDER               relevance, updated_desc, or created_desc
  --limit N                  Page size, 1 to 100; default 50
  --cursor TOKEN             Continue with the returned next_cursor
  --pages N                  Fetch up to N pages; default 1
  --all                      Follow pages until exhausted
  --max-results N            Cap returned documents; preserve continuation
  --compact                  Shorter documents[] JSON; keep evidence and IDs
  --word-forms               Expand English singular/plural word forms
  --facets [LIST]            Counts for tags,authors,libraries; comma-separated
  --facet-limit N            Maximum entries per requested facet; default 50
  --match-limit N            Evidence snippets per result, 0 to 100; default 5
  --query-file PATH          Read a search request JSON object
  --literal                  Treat query text as one literal substring
  --json                     Emit one JSON object
  --help                     Show this reference without signing in

Filter groups combine with AND. Repeated authors, revision authors, document
IDs, and fields mean any within their group. Text is optional when browsing by
metadata. Dates accept ISO 8601. Bounds are inclusive. A date without a time
covers the UTC day: after starts at midnight and before ends at 23:59:59.999.
Use members --account LIBRARY_UUID --json to resolve a person's user ID. Author
means creator, while updated-by means the writer of the current revision.
Word and phrase queries default to relevance. Literal and metadata-only searches
default to updated_desc.

  sdoc cloud search --tag engineering --any-tag rollout --any-tag migration --json
  sdoc cloud search 'deadline' --author me --updated-after 2026-01-01 --json
  sdoc cloud search 'decision' --shared-with-me --facets --limit 10 --json
  sdoc cloud search 'security' --document UUID_A --document UUID_B --json
  sdoc cloud ls --tag planning --sort updated_desc --limit 20 --json

RESULTS AND PAGINATION

Check ok before reading documents[]. Each result includes id, url, title,
filename, tags, library, author, current revision metadata, score, and matches[].
Evidence identifies its field and snippet, with a source line for Markdown.
Use total_count, has_more, and next_cursor to distinguish an empty result from
another page. --pages N and --all fetch multiple pages; --max-results caps the
returned count. complete, stopped_reason, pages_fetched, returned_count, and
started_from_cursor describe the collected result. A capped result retains its
next_cursor. Later-page failures return ok:false with partial_result.
--compact preserves IDs, title, tags, score, snippets, and all paging/facet
metadata while omitting other document metadata. Facets count matching documents
before pagination. Counts and evidence include only documents the signed-in person can currently access.

Repeat the same query, filters, and sort with --cursor NEXT_CURSOR. A cursor
does not grant access. Do not infer completeness from the first page. Search
does not return full Markdown; read a result on stdout with:

  sdoc cloud read DOCUMENT_ID --json

read returns markdown and the Cloud URL without a local file or binding. Use
sdoc cloud pull DOCUMENT_ID --output PATH --no-bind when a local reference file is useful.
Cite documents[].url without changing document access. Search and listing do not change permissions.

REPRODUCIBLE REQUESTS

--query-file reads the HTTP search request shape: expression (a query AST) or
query (a literal substring), tags, tags_any, tags_none, author_user_ids,
updated_by_user_ids, document_ids, fields, workspace_id, shared_with_me,
created_after, created_before, updated_after, updated_before, sort, limit,
cursor, facets, facet_limit, match_limit, and word_forms. CLI scalar options
override file values; repeated filters add values. A positional query replaces the file's
expression or query. --documents-file adds IDs to the document_ids subset.
See https://smalldocs.org/cloud-search for the AST and JSON examples.

RECOVERY

On no matches, broaden a word with a prefix, add an OR alternative, or remove
one narrow filter. Inspect --facets or cloud tags --account UUID --json for
existing vocabulary. Fix invalid query syntax, or use --literal for punctuation
and operator words. On search_limit_reached or rate_limited, wait for
retry_after_ms or Retry-After and retry. Narrower text or metadata filters do
not reset a request budget. login_required needs cloud login; an
invalid cursor needs the original query and filters or a fresh first page.
An empty result does not establish that an inaccessible document does not exist.
`;

const CLOUD_READ_HELP = `SmallDocs Cloud read

  sdoc cloud read DOCUMENT_ID --json
  sdoc cloud read DOCUMENT_ID

Read the current authorized document without a local file or binding.
Add --revision REVISION_ID to read a retained older revision.
With --json, the result includes markdown, url, document_id, revision_id,
revision_number, title, filename, and tags. Without --json, stdout contains
the Markdown exactly as stored. Reading does not change content or permissions.

Use sdoc cloud pull DOCUMENT_ID --output PATH --no-bind for a local reference file, or pull
without --no-bind when you intend to edit and push the document. Read a historical
revision on stdout with cloud read DOCUMENT_ID --revision REVISION_UUID --json.
Use cloud diff DOCUMENT_ID --from REVISION_ID --json to compare it with the head.
`;

const CLOUD_UPDATE_HELP = `SmallDocs Cloud document updates

  sdoc cloud pull DOCUMENT_ID --output ./plan.md --json
  sdoc cloud push ./plan.md --dry-run --json
  sdoc cloud push ./plan.md --json

For a save that must match a reviewed head:

  sdoc cloud push ./plan.md --if-current REVIEWED_HEAD_ID --json

Pull binds a working file to a document ID and revision. Editing a differently
named local file does not rename the Cloud document. Push preserves permissions.
For an unbound working copy, pass both --document ID and --base-revision ID.

--dry-run compares against the current Cloud head without saving a revision,
changing the working file, or changing bindings. Its JSON includes markdown,
would_change, current_revision_id, merge_classification, conflicts and hashes.
A preview describes the observed head; another writer can change it afterwards.
Pass that current_revision_id as --if-current to refuse a save after further
changes. --reject-conflicts refuses overlapping edits while allowing independent
edits to merge. A refusal returns revision_conflict (exit 5), current_revision_id
and conflict details.

By default, independent edits merge and both overlapping passages are saved.
combined:true and overlapping_edits_preserved:true identify that outcome.
The result can contain contradictory statements or invalid structured content.
Use history --diffs to inspect each retained change and read to verify the save.
No review step is imposed by the default save.

A save receipt includes revision_id, merged_from_revision_id, saved_sha256,
merge_classification, conflicts and the canonical Cloud url. sha256 describes
the local working copy; saved_sha256 describes the stored Markdown. A merged
save can differ from the uploaded file. If local_changed_after_upload is true,
the later local edit was not saved. Push does not replace that local edit.
An unchanged working file is checked online: no_local_changes:true does not
mean Cloud is unchanged. Inspect cloud_matches_local and remote_changed_since_pull.

Verify the committed content and any merged work:

  sdoc cloud read DOCUMENT_ID --revision SAVED_REVISION_ID --json
  sdoc cloud diff DOCUMENT_ID --from BASE_REVISION_ID --to SAVED_REVISION_ID --json
  sdoc cloud access DOCUMENT_ID --json

Read returns Markdown and its SHA-256 without creating a file or binding.
Diff returns changed, added_lines, removed_lines and line-based hunks, with
before/after text and context. Omitting --to compares with the current head.
Access without change flags reads sharing settings. To change access, use
access DOCUMENT_ID --only-you, --everyone, or --member USER_ID (repeatable).
Document permissions apply
to current content, old revisions, comparisons, previews and saves.

HISTORY AND RECOVERY

  sdoc cloud history DOCUMENT_ID --diffs --json
  sdoc cloud read DOCUMENT_ID --revision REVISION_ID --json
  sdoc cloud restore DOCUMENT_ID --revision REVISION_ID --dry-run --json
  sdoc cloud restore DOCUMENT_ID --revision REVISION_ID --base-revision REVIEWED_HEAD_ID --json

History --diffs adds a before/after diff for each retained change, alongside
its revision, author IDs and timestamp. A pruned parent is marked unavailable.
Every save retains a revision. History lists the currently retained revisions,
not an unlimited archive. Default retention is the current revision and up to
3 previous revisions, with previous revisions kept for at most 90 days.
Deployments can configure a different policy.

Restore creates a new revision containing the entire older document. For a
single-field repair, read the older revision, edit that field in a pull of the
current document, then push. This preserves unrelated newer changes. Restore
--dry-run returns the proposed Markdown, diff and observed base_revision_id.
Use that ID with --base-revision for a reviewed restore. If the head changes,
restore refuses the write. Failed or retried saves keep an idempotency key;
retrying the same operation after a lost response does not duplicate it.

If a file changes during pull, it is not overwritten. If access is revoked,
keep the local work and report the failure; do not broaden permissions to save.
Resolve ambiguous targets or incompatible intended edits with the user.
`;

const CLOUD_OVERVIEW = `SmallDocs Cloud

SmallDocs Cloud is an optional paid feature for documents you choose to add.

- Open selected documents across browsers, mobile devices, and the CLI.
- Search document text and tags.
- Keep and restore revision history.
- Control access for account members and permission groups.
- Notify existing account members about one or more documents.

Local files remain local until you add them to Cloud. Encrypted snapshot links
created by sdoc share are separate from Cloud documents.

Run sdoc cloud --help for search, read, update, access, and history examples.`;

class CloudCommandError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.code = code;
    if (detail) this.data = detail;
  }
}

function origin() {
  return String(process.env.SDOCS_CLOUD_URL || constants.DEFAULT_URL).replace(/\/$/, '');
}

function documentUrl(client, documentId) {
  const url = new URL('/docs', client.origin);
  url.searchParams.set('cloud-document', documentId);
  return url.toString();
}

function entitlementFailure(code, status, cloudOrigin) {
  if (code === 'read_only') code = 'subscription_read_only';
  if (status !== 402 && !['subscription_required', 'subscription_read_only',
    'payment_grace_expired'].includes(code)) return null;
  if (!['subscription_required', 'subscription_read_only', 'payment_grace_expired'].includes(code)) {
    code = 'subscription_required';
  }
  if (code === 'subscription_required') {
    return { code, message: 'An active SmallDocs Cloud subscription is required to change documents.',
      action: 'subscribe', billing_url: cloudOrigin + '/cloud#pricing' };
  }
  return { code, message: 'This Cloud account is read-only because its subscription is not active. Ask an account owner to update billing.',
    action: 'manage_billing', billing_url: cloudOrigin + '/cloud/admin' };
}

class CloudClient {
  constructor(options) {
    options = options || {};
    this.origin = options.origin || origin();
    this.credentials = options.credentials || credentialStore;
    this.fetch = options.fetch || global.fetch;
  }

  loadCredential() { return this.credentials.load(this.origin); }
  saveCredential(value) { this.credentials.save(this.origin, value); }

  async raw(endpoint, options) {
    let response;
    try { response = await this.fetch(this.origin + endpoint, options || {}); }
    catch (error) {
      throw new CloudCommandError('temporary_service_failure',
        'Could not reach SmallDocs Cloud.', { cause: error && error.message });
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new CloudCommandError('temporary_service_failure',
        'SmallDocs Cloud returned an invalid response.', { http_status: response.status });
    }
    return { response, data };
  }

  async refresh(credential) {
    const result = await this.raw('/api/cloud/v1/cli/token/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: credential.refresh_token }),
    });
    if (!result.response.ok) {
      this.credentials.remove(this.origin);
      throw new CloudCommandError('login_required', 'Cloud login has expired or was revoked.');
    }
    const next = { credential_id: result.data.credential_id, user_id: result.data.user_id,
      access_token: result.data.access_token, access_token_expires_at: result.data.access_token_expires_at,
      refresh_token: result.data.refresh_token };
    this.saveCredential(next);
    return next;
  }

  async authenticated(endpoint, options, retry) {
    let credential = this.loadCredential();
    if (!credential) throw new CloudCommandError('login_required', 'Run `sdoc cloud login`.');
    if (Date.parse(credential.access_token_expires_at || 0) <= Date.now() + 30000) {
      credential = await this.refresh(credential);
    }
    const headers = Object.assign({}, options && options.headers,
      { Authorization: 'Bearer ' + credential.access_token });
    const result = await this.raw(endpoint, Object.assign({}, options, { headers }));
    if (result.response.status === 401 && retry !== false) {
      credential = await this.refresh(credential);
      return this.authenticated(endpoint, options, false);
    }
    if (!result.response.ok) {
      const entitlement = entitlementFailure(result.data.error, result.response.status, this.origin);
      if (entitlement) {
        throw new CloudCommandError(entitlement.code, entitlement.message,
          Object.assign({}, result.data, { http_status: result.response.status,
            action: entitlement.action, billing_url: entitlement.billing_url }));
      }
      var message = result.data.message;
      if (result.data.error === 'account_selection_required') {
        var choices = (result.data.accounts || []).map(function (account) {
          return account.name + ' (' + account.id + ')';
        }).join(', ');
        message = 'Choose an account with --account.' + (choices ? ' Available: ' + choices : '');
      } else if (result.data.error === 'account_required') {
        message = 'Set up SmallDocs Cloud before using this command.';
      }
      throw new CloudCommandError(result.data.error || 'temporary_service_failure',
        message, Object.assign({}, result.data, { http_status: result.response.status }));
    }
    return result.data;
  }
}

function emit(opts, command, value, human) {
  if (opts.silent) return value;
  if (opts.jsonFlag) process.stdout.write(JSON.stringify(Object.assign({ ok: true, command }, value)) + '\n');
  else process.stdout.write((human || JSON.stringify(value, null, 2)) + '\n');
  return value;
}

function skillInstallCommand(originValue, cloud) {
  const edition = cloud ? 'cloud' : 'standard';
  return 'npx skills@latest add ' + originValue + '/agent-skills/' + edition + ' --global';
}

function fail(opts, command, error) {
  const code = error.code || 'unexpected';
  const body = Object.assign({}, error.data || {},
    { ok: false, command, error: code, message: error.message || code });
  if (opts.jsonFlag) process.stdout.write(JSON.stringify(body) + '\n');
  else {
    process.stderr.write('sdoc cloud: ' + body.message + '\n');
    if (body.billing_url) process.stderr.write(
      (body.action === 'subscribe' ? 'Subscribe: ' : 'Manage billing: ') + body.billing_url + '\n');
  }
  process.exitCode = EXIT[code] || 1;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function login(opts, client) {
  const installCommand = skillInstallCommand(client.origin, true);
  const setupCommand = 'sdoc setup --cloud --yes';
  if (client.loadCredential()) {
    try {
      const me = await client.authenticated('/api/cloud/v1/me');
      return emit(opts, 'cloud.login', { user: me.user, already_logged_in: true,
        skill_mode: 'cloud', skill_install_command: installCommand,
        cloud_first_setup_command: setupCommand },
        'Already signed in as ' + (me.user.email || me.user.id) + '.\n' +
        'Enable Cloud-first SmallDocs on this machine:\n' + setupCommand);
    } catch (_) {}
  }
  const issued = await client.raw('/api/cloud/v1/cli/device-authorizations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: os.hostname() || 'SmallDocs CLI' }),
  });
  if (!issued.response.ok) throw new CloudCommandError(issued.data.error || 'temporary_service_failure');
  process.stderr.write('Authorize this CLI at:\n' + issued.data.verification_uri_complete + '\nCode: ' + issued.data.user_code + '\n');
  if (!opts.noOpenFlag) io.openBrowser(issued.data.verification_uri_complete,
    (message) => process.stderr.write(message + '\n'));
  const deadline = Date.now() + issued.data.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.max(1, issued.data.interval || 2) * 1000);
    const polled = await client.raw('/api/cloud/v1/cli/device-authorizations/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: issued.data.device_code }),
    });
    if (polled.response.status === 428 && polled.data.error === 'authorization_pending') continue;
    if (!polled.response.ok) throw new CloudCommandError('login_required', polled.data.error);
    const credential = { credential_id: polled.data.credential_id, user_id: polled.data.user_id,
      access_token: polled.data.access_token, access_token_expires_at: polled.data.access_token_expires_at,
      refresh_token: polled.data.refresh_token };
    client.saveCredential(credential);
    return emit(opts, 'cloud.login', { user_id: credential.user_id,
      credential_id: credential.credential_id, skill_mode: 'cloud',
      skill_install_command: installCommand,
      cloud_first_setup_command: setupCommand },
    'Cloud login saved for this machine.\n' +
    'Enable Cloud-first SmallDocs on this machine:\n' + setupCommand);
  }
  throw new CloudCommandError('login_required', 'Authorization expired before it was approved.');
}

async function logout(opts, client) {
  const credential = client.loadCredential();
  if (credential) {
    try { await client.authenticated('/api/cloud/v1/cli/credentials/' + encodeURIComponent(credential.credential_id),
      { method: 'DELETE' }); } catch (_) {}
    client.credentials.remove(client.origin);
  }
  const restoreCommand = skillInstallCommand(client.origin, false);
  const standardSetupCommand = 'sdoc setup --standard --yes';
  emit(opts, 'cloud.logout', { logged_out: true, skill_unchanged: true,
    standard_skill_install_command: restoreCommand,
    standard_setup_command: standardSetupCommand },
  'Signed out of SmallDocs Cloud. The installed skill was not changed.\n' +
  'If you do not expect to use Cloud on this machine, restore local-first behavior:\n' +
  standardSetupCommand);
}

function filterTags(documents, tags) {
  const wanted = (tags || []).map((tag) => String(tag).toLowerCase());
  return documents.filter((document) => wanted.every((tag) => (document.tags || []).includes(tag)));
}

function requestedLimit(value, fallback, option) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CloudCommandError('invalid_request', (option || '--limit') + ' must be a positive integer');
  }
  return value;
}

async function list(opts, client) {
  return discover(opts, client, 'cloud.ls');
}

async function notify(opts, client) {
  const documentIds = Array.from(new Set([opts.extra].concat(opts.documentFlags || []).filter(Boolean)));
  const recipientUserIds = Array.from(new Set(opts.memberFlags || []));
  if (!documentIds.length || !recipientUserIds.length) {
    throw new CloudCommandError('invalid_request',
      'usage: sdoc cloud notify DOCUMENT_UUID [--document DOCUMENT_UUID ...] ' +
      '--member USER_ID ... [--note TEXT]');
  }
  const response = await client.authenticated('/api/cloud/v1/notifications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document_ids: documentIds,
      recipient_user_ids: recipientUserIds,
      note: opts.noteText || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  });
  const notification = response.notification;
  emit(opts, 'cloud.notify', { notification_id: notification.id,
    document_ids: notification.document_ids,
    recipient_user_ids: notification.recipient_user_ids },
  notification.recipient_user_ids.length === 1
    ? 'Queued 1 notification email.'
    : 'Queued ' + notification.recipient_user_ids.length +
      ' notification emails, one for each recipient.');
}

async function tags(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/tags' + query);
  const values = (response.tags || []).map((item) => ({ tag: item.tag, document_count: item.count }));
  emit(opts, 'cloud.tags', { tags: values }, values.map((item) => item.tag + ' - ' + item.document_count).join('\n') || 'No Cloud tags.');
}

async function members(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/members' + query);
  const values = response.members || [];
  emit(opts, 'cloud.members', { account_id: response.account_id, members: values }, values.map((member) =>
    member.user_id + '  ' + (member.email || member.name) + (member.is_you ? '  You' : '')).join('\n') || 'No account members.');
}

async function permissionGroups(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const response = await client.authenticated('/api/cloud/v1/account/permission-groups' + query);
  const values = response.permission_groups || [];
  emit(opts, 'cloud.permission-groups', { account_id: response.account_id,
    permission_groups: values }, values.map((group) => group.document_id + '  '
      + (group.mode === 'everyone' ? 'Everyone' : group.member_user_ids.join(', '))).join('\n') ||
    'No Cloud permission groups.');
}

async function access(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud access DOCUMENT_UUID [--only-you | --everyone | --member USER_ID ...]');
  const choices = Number(Boolean(opts.onlyYouFlag)) + Number(Boolean(opts.everyoneFlag))
    + Number(Boolean(opts.memberFlags && opts.memberFlags.length));
  if (choices === 0) {
    const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId) + '/permission');
    return emit(opts, 'cloud.access', { document_id: documentId, permission: response.permission });
  }
  if (choices !== 1) throw new CloudCommandError('invalid_request',
    'choose one of --only-you, --everyone, or one or more --member values');
  if (opts.dryRunFlag) throw new CloudCommandError('invalid_request',
    '--dry-run is not supported for access changes. No changes were made.');
  const mode = opts.everyoneFlag ? 'everyone' : 'custom';
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + '/permission', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, member_user_ids: opts.memberFlags || [] }) });
  emit(opts, 'cloud.access', { document_id: documentId, permission: response.permission },
    'Updated access for ' + documentId + '.');
}

async function setTags(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud tag DOCUMENT_UUID --tag TAG [--tag TAG ...]');
  const current = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId));
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + '/tags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: opts.tagFilters || [],
        expected_head_revision_id: current.document.current_revision_id,
        idempotency_key: crypto.randomUUID() }) });
  emit(opts, 'cloud.tag', { document_id: documentId,
    revision_id: response.document.current_revision_id, tags: response.document.tags },
  'Updated tags for ' + documentId + '.');
}

function readSearchFile(file, json) {
  try {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    if (!json) return content.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object');
    return value;
  } catch (error) {
    throw new CloudCommandError('invalid_request', 'Could not read ' + file + ': ' + error.message);
  }
}

function searchRequest(opts, client) {
  const request = opts.queryFile ? readSearchFile(opts.queryFile, true) : {};
  if (opts.extra != null && String(opts.extra).trim()) {
    delete request.query;
    delete request.expression;
    delete request.mode;
    if (opts.literalFlag) request.query = String(opts.extra);
    else {
      try { request.expression = searchQuery.parseQuery(String(opts.extra)); }
      catch (error) {
        throw new CloudCommandError('invalid_request', error.message +
          ' Run sdoc cloud search --help for syntax, or use --literal for a substring.', error.details);
      }
    }
  }
  if (opts.literalFlag && request.query != null) request.mode = 'literal';
  const scalarOptions = {
    accountFlag: 'workspace_id', projectFlag: 'project_id', cursorFlag: 'cursor',
    sortFlag: 'sort', createdAfterFlag: 'created_after', createdBeforeFlag: 'created_before',
    updatedAfterFlag: 'updated_after', updatedBeforeFlag: 'updated_before',
    facetLimitFlag: 'facet_limit', matchLimitFlag: 'match_limit',
  };
  for (const [option, field] of Object.entries(scalarOptions)) {
    if (opts[option] != null) request[field] = opts[option];
  }
  const arrayOptions = { tagFilters: 'tags', anyTagFilters: 'tags_any',
    excludeTagFilters: 'tags_none', authorFlags: 'author_user_ids',
    updatedByFlags: 'updated_by_user_ids', documentFlags: 'document_ids', fieldFlags: 'fields' };
  for (const [option, field] of Object.entries(arrayOptions)) {
    if (opts[option] && opts[option].length) {
      if (request[field] != null && !Array.isArray(request[field])) {
        throw new CloudCommandError('invalid_request', field + ' must be an array');
      }
      request[field] = (request[field] || []).concat(opts[option]);
    }
  }
  if (opts.mineFlag) {
    if (request.author_user_ids != null && !Array.isArray(request.author_user_ids)) {
      throw new CloudCommandError('invalid_request', 'author_user_ids must be an array');
    }
    request.author_user_ids = (request.author_user_ids || []).concat('me');
  }
  for (const field of ['author_user_ids', 'updated_by_user_ids']) {
    if (!Array.isArray(request[field]) || !request[field].includes('me')) continue;
    const credential = client.loadCredential && client.loadCredential();
    if (!credential || !credential.user_id) throw new CloudCommandError('login_required',
      'Run `sdoc cloud login` before using me as a user filter.');
    request[field] = request[field].map((value) => value === 'me' ? credential.user_id : value);
  }
  if (opts.documentsFile) {
    if (request.document_ids != null && !Array.isArray(request.document_ids)) {
      throw new CloudCommandError('invalid_request', 'document_ids must be an array');
    }
    request.document_ids = (request.document_ids || []).concat(readSearchFile(opts.documentsFile, false));
  }
  if (opts.sharedWithMeFlag) request.shared_with_me = true;
  if (opts.wordFormsFlag) request.word_forms = true;
  if (opts.facetsFlag) request.facets = opts.facetsFlag;
  request.limit = requestedLimit(opts.limitFlag == null ? request.limit : opts.limitFlag, 50);
  if (request.limit > 100) throw new CloudCommandError('invalid_request', '--limit must be between 1 and 100');
  if (opts.file === 'ls' && request.sort == null) request.sort = 'updated_desc';
  try { searchQuery.normalizeSearchRequest(request); }
  catch (error) { throw new CloudCommandError('invalid_request', error.message, error.details); }
  return request;
}

async function discover(opts, client, command) {
  const request = searchRequest(opts, client);
  if (opts.allFlag && opts.pagesFlag != null) throw new CloudCommandError('invalid_request',
    'Choose --all or --pages N. --max-results may be used with either.');
  const pageLimit = opts.allFlag ? Infinity : requestedLimit(opts.pagesFlag, 1, '--pages');
  const maxResults = opts.maxResultsFlag == null ? Infinity : requestedLimit(opts.maxResultsFlag, Infinity, '--max-results');
  const documents = [], positions = new Map(), seenCursors = new Set();
  const startedFromCursor = Boolean(request.cursor);
  if (request.cursor) seenCursors.add(request.cursor);
  let pagesFetched = 0, response = null, stoppedReason = 'page_limit';
  function resultFor(reason) {
    const result = Object.assign({}, response || {}, {
      documents: opts.compactFlag ? documents.map(compactSearchDocument) : documents,
      next_cursor: response && response.next_cursor || null,
      has_more: Boolean(response && (response.has_more || response.next_cursor)),
      pages_fetched: pagesFetched, returned_count: documents.length,
      started_from_cursor: startedFromCursor, complete: reason === 'complete', stopped_reason: reason,
    });
    delete result.ok;
    return result;
  }
  do {
    const pageRequest = Object.assign({}, request, { limit: Math.min(request.limit, maxResults - documents.length) });
    try {
      response = await client.authenticated('/api/cloud/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pageRequest),
      });
    } catch (error) {
      if (pagesFetched) error.data = Object.assign({}, error.data, { partial_result: resultFor('request_failed') });
      throw error;
    }
    pagesFetched++;
    for (const value of response.documents || []) {
      const document = Object.assign({}, value, { url: documentUrl(client, value.id) });
      if (positions.has(document.id)) documents[positions.get(document.id)] = document;
      else { positions.set(document.id, documents.length); documents.push(document); }
    }
    if (!response.has_more && !response.next_cursor) { stoppedReason = 'complete'; break; }
    if (!response.next_cursor || seenCursors.has(response.next_cursor)) {
      throw new CloudCommandError('temporary_service_failure', 'Cloud returned an invalid search continuation.',
        { partial_result: resultFor('invalid_continuation') });
    }
    seenCursors.add(response.next_cursor);
    if (documents.length >= maxResults) { stoppedReason = 'max_results'; break; }
    request.cursor = response.next_cursor;
  } while (pagesFetched < pageLimit);
  const result = resultFor(stoppedReason);
  let human = documents.map((document) => {
    let line = document.id + '  ' + document.title;
    if (document.library && document.library.name) line += '  [' + document.library.name + ']';
    for (const match of document.matches || []) {
      line += '\n  ' + match.field + (match.line ? ':' + match.line : '') + '  ' + match.snippet;
    }
    return line;
  }).join('\n') || 'No matches.';
  if (result.total_count != null) human += '\n' + result.total_count + ' matching documents.';
  for (const [kind, entries] of Object.entries(result.facets || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    human += '\n' + kind + ': ' + entries.map((item) =>
      (item.tag || item.name || item.user_id || item.id) + ' (' + item.document_count + ')').join(', ');
  }
  if (result.has_more || result.next_cursor) human += '\nMore results: repeat this query with --cursor ' + result.next_cursor;
  human += '\nReturned ' + result.returned_count + ' documents in ' + result.pages_fetched
    + (result.pages_fetched === 1 ? ' page; ' : ' pages; ') + result.stopped_reason + '.';
  return emit(opts, command, result, human);
}

function compactSearchDocument(document) {
  const value = {};
  for (const key of ['id', 'url', 'title', 'tags', 'workspace_id', 'created_by_user_id',
    'updated_by_user_id', 'current_revision_id', 'score', 'matches']) {
    if (Object.hasOwn(document, key)) value[key] = document[key];
  }
  return value;
}

async function search(opts, client) {
  return discover(opts, client, 'cloud.search');
}

async function read(opts, client) {
  if (!opts.extra) throw new CloudCommandError('invalid_request', 'usage: sdoc cloud read DOCUMENT_ID --json');
  if (opts.outputPath || opts.noBindFlag) throw new CloudCommandError('invalid_request',
    'read writes Markdown to stdout. Use cloud pull for a local file.');
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(opts.extra)
    + (opts.revisionFlag ? '/revisions/' + encodeURIComponent(opts.revisionFlag) : ''));
  const document = response.document;
  if (!document || typeof document.markdown !== 'string') throw new CloudCommandError('temporary_service_failure',
    'Cloud returned an invalid document response.');
  const value = { document_id: document.id, url: documentUrl(client, document.id),
    revision_id: document.current_revision_id, revision_number: document.revision_number,
    title: document.title, filename: document.filename, tags: document.tags,
    workspace_id: document.workspace_id, permission: response.permission,
    sha256: bindings.hash(document.markdown), markdown: document.markdown };
  if (!opts.jsonFlag && !opts.silent) { process.stdout.write(document.markdown); return value; }
  return emit(opts, 'cloud.read', value);
}

async function diff(opts, client) {
  if (!opts.extra || !opts.fromRevisionFlag) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud diff DOCUMENT_ID --from REVISION_ID [--to REVISION_ID] --json');
  const endpoint = '/api/cloud/v1/documents/' + encodeURIComponent(opts.extra);
  const before = await client.authenticated(endpoint + '/revisions/' + encodeURIComponent(opts.fromRevisionFlag));
  const after = await client.authenticated(endpoint + (opts.toRevisionFlag
    ? '/revisions/' + encodeURIComponent(opts.toRevisionFlag) : ''));
  const result = { document_id: opts.extra, url: documentUrl(client, opts.extra),
    from_revision_id: before.document.current_revision_id,
    to_revision_id: after.document.current_revision_id,
    diff: require('../shared/sdocs-text-diff').compare(before.document.markdown, after.document.markdown) };
  return emit(opts, 'cloud.diff', result);
}

function requireFile(file) {
  if (!file) throw new CloudCommandError('invalid_request', 'a Markdown file path is required');
  const absolute = bindings.canonical(file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new CloudCommandError('invalid_request', 'file not found: ' + file);
  }
  return absolute;
}

function requireCredential(client) {
  const credential = client.loadCredential();
  if (!credential) throw new CloudCommandError('login_required', 'Run `sdoc cloud login`.');
  return credential;
}

async function create(opts, client) {
  const file = requireFile(opts.extra);
  const content = fs.readFileSync(file, 'utf8');
  const digest = bindings.hash(content);
  const credential = requireCredential(client);
  let pending = bindings.getPending(credential.user_id, file);
  if (!pending || pending.operation !== 'create' || pending.sha256 !== digest) {
    pending = { operation: 'create', destination: opts.accountFlag || 'unresolved-default', sha256: digest, idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  let destination = opts.accountFlag || null;
  if (!destination && pending && pending.operation === 'create' && pending.sha256 === digest && !['default-account', 'unresolved-default'].includes(pending.destination)) destination = pending.destination;
  if (!destination) {
    const selected = await client.authenticated('/api/cloud/v1/account');
    destination = selected.account.id;
  }
  if (!pending || pending.operation !== 'create' || pending.destination !== destination || pending.sha256 !== digest) {
    pending = { operation: 'create', destination, sha256: digest,
      idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  const response = await client.authenticated('/api/cloud/v1/account/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: destination,
      filename: path.basename(file), markdown: content,
      idempotency_key: pending.idempotency_key }),
  });
  const document = response.document;
  bindings.set(credential.user_id, file, { document_id: document.id,
    revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
  bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, content);
  bindings.clearPending(credential.user_id, file);
  const localChanged = localFileHash(file) !== digest;
  return emit(opts, 'cloud.create', { document_id: document.id, revision_id: document.current_revision_id,
    url: documentUrl(client, document.id),
    revision_number: document.revision_number,
    account_id: response.account && response.account.id || opts.accountFlag || null, path: file,
    tags: document.tags, sha256: digest, binding_created: true,
    local_changed_after_upload: localChanged }, 'Created ' + document.id + (localChanged ? '; the local file changed again during upload.' : '.'));
}

function localFileHash(file) {
  try { return bindings.hash(fs.readFileSync(file)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function atomicFileWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.sdocs-tmp-' + process.pid;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

async function pull(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.outputPath) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud pull DOCUMENT_UUID --output PATH');
  const output = bindings.canonical(opts.outputPath);
  const credential = requireCredential(client);
  const existingBinding = bindings.get(credential.user_id, output);
  if (opts.noBindFlag && existingBinding) {
    throw new CloudCommandError('unsafe_local_state',
      '--no-bind requires an output path that is not already bound');
  }
  if (opts.revisionFlag && !opts.noBindFlag) {
    throw new CloudCommandError('unsafe_local_state',
      'pulling a historical revision requires --no-bind');
  }
  if (existingBinding && existingBinding.document_id !== documentId && !opts.forceFlag) {
    throw new CloudCommandError('unsafe_local_state',
      'output is bound to a different Cloud document; use --force to replace and rebind it');
  }
  if (fs.existsSync(output) && !existingBinding && !opts.forceFlag) {
    throw new CloudCommandError('unsafe_local_state', 'output exists and is not bound; use --force to replace it');
  }
  if (fs.existsSync(output) && existingBinding && !opts.forceFlag) {
    const currentHash = bindings.hash(fs.readFileSync(output));
    if (currentHash !== existingBinding.content_sha256) {
      throw new CloudCommandError('unsafe_local_state', 'the bound file has local changes; use --force to replace it');
    }
  }
  const beforeHash = fs.existsSync(output) ? bindings.hash(fs.readFileSync(output)) : null;
  const beforeBinding = JSON.stringify(existingBinding);
  const endpoint = '/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + (opts.revisionFlag ? '/revisions/' + encodeURIComponent(opts.revisionFlag) : '');
  const response = await client.authenticated(endpoint);
  const document = response.document;
  const afterHash = fs.existsSync(output) ? bindings.hash(fs.readFileSync(output)) : null;
  if (beforeHash !== afterHash || beforeBinding !== JSON.stringify(bindings.get(credential.user_id, output))) {
    throw new CloudCommandError('unsafe_local_state',
      'The output file or its binding changed during download. The local file was not replaced.');
  }
  atomicFileWrite(output, document.markdown);
  const digest = bindings.hash(document.markdown);
  if (!opts.noBindFlag) {
    bindings.set(credential.user_id, output, { document_id: document.id,
      revision_id: document.current_revision_id, content_sha256: digest, updated_at: document.updated_at });
    bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, document.markdown);
  }
  emit(opts, 'cloud.pull', { document_id: document.id, revision_id: document.current_revision_id,
    url: documentUrl(client, document.id),
    revision_number: document.revision_number, path: output, tags: document.tags,
    title: document.title, filename: document.filename, workspace_id: document.workspace_id,
    permission: response.permission,
    sha256: digest, binding_created: !opts.noBindFlag }, 'Pulled ' + document.id + ' to ' + output + '.');
}

async function push(opts, client) {
  const file = requireFile(opts.extra);
  const credential = requireCredential(client);
  const hasExplicitBinding = opts.documentFlag || opts.baseRevisionFlag;
  if (hasExplicitBinding && (!opts.documentFlag || !opts.baseRevisionFlag)) {
    throw new CloudCommandError('unsafe_local_state',
      'provide both --document and --base-revision');
  }
  let binding = hasExplicitBinding ? null : bindings.get(credential.user_id, file);
  if (hasExplicitBinding) {
    binding = { document_id: opts.documentFlag, revision_id: opts.baseRevisionFlag };
  } else if (!binding) {
    throw new CloudCommandError('unsafe_local_state',
      'file is not bound; provide both --document and --base-revision');
  }
  const bindingBeforeUpload = JSON.stringify(bindings.get(credential.user_id, file));
  const localContent = fs.readFileSync(file, 'utf8');
  const digest = bindings.hash(localContent);
  if (binding.content_sha256 === digest && !opts.dryRunFlag && !opts.ifCurrentFlag) {
    const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(binding.document_id));
    const current = response.document;
    if (!current || typeof current.markdown !== 'string') throw new CloudCommandError('temporary_service_failure',
      'Cloud did not return the current document.');
    return emit(opts, 'cloud.push', { document_id: binding.document_id,
      url: documentUrl(client, binding.document_id),
      base_revision_id: binding.revision_id, revision_id: current.current_revision_id,
      revision_number: current.revision_number, title: current.title, filename: current.filename,
      workspace_id: current.workspace_id, sha256: digest, saved_sha256: bindings.hash(current.markdown),
      no_change: true, no_local_changes: true, cloud_matches_local: current.markdown === localContent,
      remote_changed_since_pull: current.current_revision_id !== binding.revision_id },
    'No local changes to push.' + (current.markdown === localContent ? '' : ' Cloud has newer changes; pull to read them.'));
  }
  const targetMarkdown = bindings.readBase(credential.user_id, binding.document_id,
    binding.revision_id);
  let content = localContent;
  if (opts.cloudFirst && targetMarkdown != null) {
    const cloudMeta = SDocYaml.parseFrontMatter(targetMarkdown).meta || {};
    const cloudTags = Array.isArray(cloudMeta.tags) ? cloudMeta.tags : [];
    if (cloudTags.length) {
      const parsed = SDocYaml.parseFrontMatter(localContent);
      const meta = Object.assign({}, parsed.meta, { tags: cloudTags });
      content = SDocYaml.serializeFrontMatter(meta) + '\n' + parsed.body;
    }
  }
  const uploadDigest = bindings.hash(content);
  const request = { target_revision_id: binding.revision_id,
    target_markdown: targetMarkdown == null ? undefined : targetMarkdown,
    markdown: content, reject_conflicts: Boolean(opts.rejectConflictsFlag),
    expected_current_revision_id: opts.ifCurrentFlag || undefined };
  if (opts.dryRunFlag) {
    const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(binding.document_id) + '/revisions/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    return emit(opts, 'cloud.push', Object.assign({}, response.document, { dry_run: true,
      document_id: binding.document_id, url: documentUrl(client, binding.document_id),
      base_revision_id: binding.revision_id, path: file, proposed_sha256: uploadDigest }),
    'Preview only. No changes saved.\n' + JSON.stringify(response.document, null, 2));
  }
  let pending = bindings.getPending(credential.user_id, file);
  const requestHash = bindings.hash(JSON.stringify(request));
  if (!pending || pending.document_id !== binding.document_id || pending.base_revision_id !== binding.revision_id || pending.sha256 !== uploadDigest || pending.request_sha256 !== requestHash) {
    pending = { document_id: binding.document_id, base_revision_id: binding.revision_id,
      sha256: uploadDigest, request_sha256: requestHash, idempotency_key: crypto.randomUUID() };
    bindings.setPending(credential.user_id, file, pending);
  }
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(binding.document_id) + '/revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign(request, { idempotency_key: pending.idempotency_key })),
  });
  const document = response.document;
  const bindingChanged = bindingBeforeUpload !== JSON.stringify(bindings.get(credential.user_id, file));
  const localChanged = localFileHash(file) !== digest || bindingChanged;
  const savedContent = typeof document.markdown === 'string' ? document.markdown : content;
  let savedLocalContent = savedContent;
  if (opts.cloudFirst) {
    const saved = SDocYaml.parseFrontMatter(savedContent);
    const local = SDocYaml.parseFrontMatter(localContent);
    const meta = Object.assign({}, saved.meta);
    if (Object.hasOwn(local.meta || {}, 'tags')) meta.tags = local.meta.tags;
    else delete meta.tags;
    savedLocalContent = Object.keys(meta).length
      ? SDocYaml.serializeFrontMatter(meta) + '\n' + saved.body : saved.body;
  }
  const savedDigest = bindings.hash(savedLocalContent);
  const localUpdated = !localChanged && savedLocalContent !== localContent;
  if (!localChanged) {
    if (localUpdated) atomicFileWrite(file, savedLocalContent);
    bindings.set(credential.user_id, file, { document_id: document.id,
      revision_id: document.current_revision_id, content_sha256: savedDigest,
      updated_at: document.updated_at });
  }
  bindings.cacheBase(credential.user_id, document.id, document.current_revision_id, savedContent);
  bindings.clearPending(credential.user_id, file);
  return emit(opts, 'cloud.push', { document_id: document.id, base_revision_id: binding.revision_id,
    url: documentUrl(client, document.id),
    revision_id: document.current_revision_id, revision_number: document.revision_number,
    title: document.title, filename: document.filename, workspace_id: document.workspace_id,
    tags: document.tags, sha256: savedDigest, saved_sha256: bindings.hash(savedContent),
    no_change: document.revision_created === false || (document.revision_created == null && document.merge_classification === 'noop'),
    revision_created: document.revision_created, metadata_changed: Boolean(document.metadata_changed),
    merged_from_revision_id: document.merged_from_revision_id,
    conflicts: document.conflicts || [],
    overlapping_edits_preserved: Boolean(document.combined),
    merge_classification: document.merge_classification || 'clean',
    combined: Boolean(document.combined),
    comment_id_remaps: document.comment_id_remaps || [],
    local_updated_from_cloud: localUpdated,
    binding_changed_during_upload: bindingChanged,
    local_changed_after_upload: localChanged }, 'Pushed revision ' + document.revision_number
      + (localChanged ? '; the local file changed again during upload.'
        : localUpdated ? ' and updated the local file with Cloud changes.' : '.')
      + (document.combined ? '\nBoth overlapping edits were saved. Use cloud history --diffs to inspect the changes.' : ''));
}

function isMarkdownFile(file) {
  return /\.(?:md|markdown|mdown|mkd)$/i.test(String(file || ''));
}

async function addCloudTags(documentId, requestedTags, client, local) {
  const additions = Array.from(new Set((requestedTags || [])
    .map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)));
  if (!additions.length) return null;
  const current = await client.authenticated('/api/cloud/v1/documents/'
    + encodeURIComponent(documentId));
  const existing = current.document && Array.isArray(current.document.tags)
    ? current.document.tags : [];
  const tags = Array.from(new Set(existing.concat(additions)));
  if (tags.length === existing.length && tags.every((tag, index) => tag === existing[index])) {
    return current.document;
  }
  const response = await client.authenticated('/api/cloud/v1/documents/'
    + encodeURIComponent(documentId) + '/tags', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags,
      expected_head_revision_id: current.document.current_revision_id,
      idempotency_key: crypto.randomUUID() }),
  });
  if (local && typeof response.document.markdown === 'string') {
    const content = fs.readFileSync(local.file, 'utf8');
    bindings.set(local.credential.user_id, local.file, {
      document_id: documentId,
      revision_id: response.document.current_revision_id,
      content_sha256: bindings.hash(content),
      updated_at: response.document.updated_at,
    });
    bindings.cacheBase(local.credential.user_id, documentId,
      response.document.current_revision_id, response.document.markdown);
  }
  if (!local || !local.silent) process.stdout.write('Updated Cloud tags for ' + documentId + '.\n');
  return response.document;
}

async function autoSyncOpen(opts, dependencies) {
  if (opts.dryRunFlag) throw new CloudCommandError('invalid_request',
    'Use cloud push PATH --dry-run to preview an existing document. No changes were made.');
  if (!opts.file || !isMarkdownFile(opts.file)) return { synced: false };
  const client = dependencies && dependencies.client || new CloudClient();
  const accountId = opts.accountFlag || dependencies && dependencies.accountId || null;
  const file = requireFile(opts.file);
  const credential = requireCredential(client);
  const binding = bindings.get(credential.user_id, file);
  const syncOpts = Object.assign({}, opts, {
    extra: file,
    accountFlag: accountId,
    jsonFlag: false,
    cloudFirst: true,
    silent: Boolean(dependencies && dependencies.silent),
  });
  const result = binding ? await push(syncOpts, client) : await create(syncOpts, client);
  const tagged = await addCloudTags(result.document_id, opts.addTags, client,
    { credential, file, silent: syncOpts.silent });
  return { synced: true, documentId: result.document_id,
    revisionId: tagged && tagged.current_revision_id || result.revision_id, created: !binding,
    localChangedAfterUpload: Boolean(result.local_changed_after_upload) };
}

async function openCloudDocument(opts, dependencies) {
  dependencies = dependencies || {};
  try {
    const client = dependencies.client || new CloudClient(opts.url
      ? { origin: new URL(opts.url).origin } : undefined);
    const saved = await autoSyncOpen(opts, {
      client, accountId: dependencies.accountId, silent: true,
    });
    if (!saved.synced) throw new CloudCommandError('invalid_request',
      'Cloud opens require a Markdown file.');
    const canonicalUrl = documentUrl(client, saved.documentId);
    if (!opts.noOpenFlag) {
      (dependencies.openBrowser || io.openBrowser)(canonicalUrl,
        (message) => process.stderr.write(message + '\n'));
    }
    return emit(opts, 'cloud.open', {
      document_id: saved.documentId, revision_id: saved.revisionId,
      url: canonicalUrl, created: saved.created,
      local_changed_after_upload: saved.localChangedAfterUpload,
    }, canonicalUrl + (saved.localChangedAfterUpload
      ? '\nThe local file changed during upload. Run sdoc again to save the latest changes.' : ''));
  } catch (error) {
    fail(opts, 'cloud.open', error);
  }
}

async function history(opts, client) {
  const documentId = opts.extra;
  if (!documentId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud history DOCUMENT_UUID');
  const revisions = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const response = await client.authenticated('/api/cloud/v1/documents/'
      + encodeURIComponent(documentId) + '/revisions?' + params.toString());
    revisions.push(...(response.revisions || []));
    cursor = response.next_cursor || null;
    if (cursor && seenCursors.has(cursor)) throw new CloudCommandError('temporary_service_failure',
      'Cloud returned the same revision cursor twice.');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  if (opts.diffsFlag) {
    const content = new Map();
    for (const revision of revisions) {
      const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
        + '/revisions/' + encodeURIComponent(revision.id));
      content.set(revision.id, response.document.markdown);
    }
    for (const revision of revisions) {
      const parent = revision.parent_revision_id;
      if (parent && !content.has(parent)) {
        revision.diff_available = false;
        revision.diff_unavailable_reason = 'parent_not_retained';
      } else {
        revision.diff_available = true;
        revision.diff = require('../shared/sdocs-text-diff').compare(parent ? content.get(parent) : '', content.get(revision.id));
      }
    }
  }
  emit(opts, 'cloud.history' , { document_id: documentId, revisions,
    next_cursor: null }, opts.diffsFlag ? undefined : revisions.map((revision) =>
    revision.revision_number + '  ' + revision.id + '  ' + revision.created_at).join('\n') || 'No revisions.');
}

async function restore(opts, client) {
  const documentId = opts.extra;
  const sourceRevisionId = opts.revisionFlag;
  if (!documentId || !sourceRevisionId) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud restore DOCUMENT_UUID --revision REVISION_UUID');
  const currentResponse = await client.authenticated('/api/cloud/v1/documents/'
    + encodeURIComponent(documentId));
  const current = currentResponse.document;
  if (!current || !current.current_revision_id) {
    throw new CloudCommandError('temporary_service_failure', 'Cloud did not return the current document revision.');
  }
  if (opts.dryRunFlag) {
    const historical = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
      + '/revisions/' + encodeURIComponent(sourceRevisionId));
    if (opts.baseRevisionFlag && opts.baseRevisionFlag !== current.current_revision_id) {
      throw new CloudCommandError('revision_conflict', 'The document changed since the reviewed revision.',
        { document_id: documentId, base_revision_id: opts.baseRevisionFlag, current_revision_id: current.current_revision_id });
    }
    return emit(opts, 'cloud.restore', { dry_run: true, document_id: documentId,
      url: documentUrl(client, documentId), base_revision_id: current.current_revision_id,
      restored_from_revision_id: sourceRevisionId, markdown: historical.document.markdown,
      sha256: bindings.hash(historical.document.markdown),
      diff: require('../shared/sdocs-text-diff').compare(current.markdown, historical.document.markdown) },
    'Preview only. No changes saved.');
  }
  const credential = client.loadCredential();
  const pendingResource = documentId + ':' + sourceRevisionId;
  let pending = bindings.getOperationPending(credential.user_id, 'restore', pendingResource);
  if (!pending || (opts.baseRevisionFlag && pending.expected_head_revision_id !== opts.baseRevisionFlag)) {
    pending = { expected_head_revision_id: opts.baseRevisionFlag || current.current_revision_id,
      idempotency_key: crypto.randomUUID() };
    bindings.setOperationPending(credential.user_id, 'restore', pendingResource, pending);
  }
  const baseRevisionId = pending.expected_head_revision_id;
  let response;
  try {
    response = await client.authenticated('/api/cloud/v1/documents/'
      + encodeURIComponent(documentId) + '/revisions/' + encodeURIComponent(sourceRevisionId) + '/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: baseRevisionId,
        idempotency_key: pending.idempotency_key }),
    });
  } catch (error) {
    if (error && error.code === 'revision_conflict') {
      bindings.clearOperationPending(credential.user_id, 'restore', pendingResource);
    }
    throw error;
  }
  bindings.clearOperationPending(credential.user_id, 'restore', pendingResource);
  const document = response.document;
  emit(opts, 'cloud.restore', { document_id: document.id,
    url: documentUrl(client, document.id),
    base_revision_id: baseRevisionId,
    restored_from_revision_id: document.restored_from_revision_id || sourceRevisionId,
    revision_id: document.current_revision_id,
    revision_number: document.revision_number,
    tags: document.tags }, 'Restored revision ' + sourceRevisionId + ' as revision '
      + document.revision_number + '.');
}

async function deleteDocument(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.baseRevisionFlag) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud delete DOCUMENT_UUID --base-revision UUID');
  const response = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(documentId), {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_head_revision_id: opts.baseRevisionFlag }),
  });
  const document = response.document;
  emit(opts, 'cloud.delete', { document_id: document.id,
    base_revision_id: opts.baseRevisionFlag, deleted_at: document.deleted_at,
    purge_after: document.purge_after }, 'Deleted ' + document.id + '.');
}

async function deletedDocuments(opts, client) {
  const response = await client.authenticated('/api/cloud/v1/documents/deleted');
  const documents = response.documents || [];
  emit(opts, 'cloud.deleted', { documents }, documents.map((document) =>
    document.id + '  ' + document.title + '  restore before ' + document.purge_after).join('\n') ||
    'No deleted Cloud documents.');
}

async function undeleteDocument(opts, client) {
  const documentId = opts.extra;
  if (!documentId || !opts.baseRevisionFlag) throw new CloudCommandError('invalid_request',
    'usage: sdoc cloud undelete DOCUMENT_UUID --base-revision UUID');
  const response = await client.authenticated('/api/cloud/v1/documents/' +
    encodeURIComponent(documentId) + '/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_head_revision_id: opts.baseRevisionFlag }),
  });
  const document = response.document;
  emit(opts, 'cloud.undelete', { document_id: document.id,
    revision_id: document.current_revision_id, revision_number: document.revision_number,
    tags: document.tags }, 'Restored ' + document.id + '.');
}

async function libraries(opts, client) {
  const data = await client.authenticated('/api/cloud/v1/library-settings');
  emit(opts, 'cloud.libraries', { libraries: data.libraries }, data.libraries.map(library => library.name + ' (' + library.id + ')').join('\n'));
}
async function libraryDefault(opts, client) {
  const credential = requireCredential(client);
  let data;
  if (!opts.extra) data = await client.authenticated('/api/cloud/v1/cli/library-default');
  else data = await client.authenticated('/api/cloud/v1/cli/credentials/' + encodeURIComponent(credential.credential_id) + '/library-default', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: opts.extra === 'clear' ? null : opts.extra }) });
  emit(opts, 'cloud.library-default', data, data.workspace_id ? 'Default library: ' + data.workspace_id : 'No default library. Ask when several libraries are available.');
}
async function move(opts, client) {
  if (!opts.extra || !opts.accountFlag) throw new CloudCommandError('invalid_request', 'usage: sdoc cloud move DOCUMENT_UUID --account LIBRARY_UUID [--dry-run] --json');
  const current = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(opts.extra));
  const settings = await client.authenticated('/api/cloud/v1/library-settings');
  const destination = settings.libraries.find(library => library.id === opts.accountFlag);
  if (!destination) throw new CloudCommandError('resource_unavailable', 'The destination library is unavailable.');
  if (!current.permission || !current.permission.can_manage) throw new CloudCommandError('permission_denied', 'Only the document creator can move it.');
  if (opts.dryRunFlag) return emit(opts, 'cloud.move', { dry_run: true, document_id: opts.extra,
    destination, access_after_move: 'only_you', url: documentUrl(client, opts.extra) }, 'Move ' + current.document.title + ' to ' + destination.name + '. Access will become Only you.');
  const data = await client.authenticated('/api/cloud/v1/documents/' + encodeURIComponent(opts.extra) + '/library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: opts.accountFlag, expected_head_revision_id: current.document.current_revision_id }) });
  emit(opts, 'cloud.move', { document_id: data.document.id, workspace_id: data.document.workspace_id,
    permission: data.permission, url: documentUrl(client, data.document.id) }, 'Moved to ' + destination.name + '. Access is Only you.\n' + documentUrl(client, data.document.id));
}

async function status(opts, client) {
  const query = opts.accountFlag ? '?account_id=' + encodeURIComponent(opts.accountFlag) : '';
  const me = await client.authenticated('/api/cloud/v1/account' + query);
  const credential = client.loadCredential();
  emit(opts, 'cloud.status', { user: me.user, account: me.account, accounts: me.accounts,
    credential_id: credential.credential_id, origin: client.origin },
  'Signed in as ' + (me.user.email || me.user.id) + '. Account: ' + me.account.name + '.');
}

function overview(opts, client) {
  const connected = Boolean(client.loadCredential());
  const nextAction = connected ? 'sdoc cloud status --json' : 'sdoc cloud login';
  emit(opts, 'cloud.overview', {
    cloud_available: true,
    connected,
    capabilities: ['cross_device_access', 'search', 'revision_history',
      'member_permissions', 'notifications'],
    next_action: nextAction,
  }, CLOUD_OVERVIEW + '\n\nNext: ' + nextAction);
}

async function runCloudCommand(opts, dependencies) {
  const action = String(opts.file || 'overview').toLowerCase();
  const command = 'cloud.' + action;
  const client = dependencies && dependencies.client || new CloudClient();
  try {
    if (opts.helpFlag || action === 'help') return process.stdout.write(
      ((action === 'search' || action === 'ls') ? CLOUD_SEARCH_HELP : action === 'read' ? CLOUD_READ_HELP
        : ['push', 'pull', 'diff', 'history', 'restore', 'access'].includes(action) ? CLOUD_UPDATE_HELP : CLOUD_HELP) + '\n');
    if (opts.searchArgumentErrors && opts.searchArgumentErrors.length) {
      throw new CloudCommandError('invalid_request', opts.searchArgumentErrors.join('; '));
    }
    if (opts.dryRunFlag && !['push', 'restore', 'move', 'read', 'search', 'ls', 'history', 'diff',
      'status', 'tags', 'members', 'permission-groups', 'libraries', 'overview'].includes(action)) {
      throw new CloudCommandError('invalid_request', '--dry-run is not supported for cloud ' + action + '. No changes were made.');
    }
    if (action === 'overview') return overview(opts, client);
    if (action === 'login') return await login(opts, client);
    if (action === 'logout') return await logout(opts, client);
    if (action === 'libraries') return await libraries(opts, client);
    if (action === 'library-default') return await libraryDefault(opts, client);
    if (action === 'move') return await move(opts, client);
    if (action === 'status') return await status(opts, client);
    if (action === 'members') return await members(opts, client);
    if (action === 'tags') return await tags(opts, client);
    if (action === 'permission-groups') return await permissionGroups(opts, client);
    if (action === 'access') return await access(opts, client);
    if (action === 'notify') return await notify(opts, client);
    if (action === 'tag') return await setTags(opts, client);
    if (action === 'ls') return await list(opts, client);
    if (action === 'search') return await search(opts, client);
    if (action === 'read') return await read(opts, client);
    if (action === 'diff') return await diff(opts, client);
    if (action === 'create') return await create(opts, client);
    if (action === 'pull') return await pull(opts, client);
    if (action === 'push') return await push(opts, client);
    if (action === 'history') return await history(opts, client);
    if (action === 'restore') return await restore(opts, client);
    if (action === 'delete') return await deleteDocument(opts, client);
    if (action === 'deleted') return await deletedDocuments(opts, client);
    if (action === 'undelete') return await undeleteDocument(opts, client);
    throw new CloudCommandError('invalid_request', 'unknown Cloud command: ' + action);
  } catch (error) {
    fail(opts, command, error);
  }
}

module.exports = { CloudClient, CloudCommandError, runCloudCommand, autoSyncOpen, openCloudDocument, filterTags, origin,
  EXIT, CLOUD_HELP, CLOUD_SEARCH_HELP, CLOUD_UPDATE_HELP, CLOUD_OVERVIEW, entitlementFailure, skillInstallCommand, searchRequest };
