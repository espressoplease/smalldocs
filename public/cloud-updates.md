---
title: Find and update Cloud documents
---

# Find and update Cloud documents

Search identifies documents you can access. Use scoped reads and direct edits for a small change, or pull a working file for a larger rewrite. Both paths save revisions at the same Cloud URL. Read the committed revision to verify the result. A local working filename does not rename the Cloud document, and saving content does not change its sharing settings.

```sh
sdoc cloud search 'retry policy' --tag production --json
sdoc cloud read DOCUMENT_ID --json
sdoc cloud pull DOCUMENT_ID --output ./policy.md --json
# Edit the working file.
sdoc cloud push ./policy.md --dry-run --json
sdoc cloud push ./policy.md --json
sdoc cloud read DOCUMENT_ID --revision SAVED_REVISION_ID --json
```

Use the returned `url` in chat. It identifies the document and requires the reader to have access. Run `sdoc cloud push --help` for the full update reference.

Cloud creation saves the source file's absolute path and any supplied relative path as encrypted metadata, separate from the document's Markdown. Only the creator can see these paths in the file info panel. Sharing the document does not reveal them to other readers. Paths identify the source file; they do not connect the browser to that file or confirm it still exists. For older documents, opening an unchanged bound working file through the CLI as its creator fills in missing paths without creating a content revision.

## Concurrent edits

A pull records the revision you read. When you push, the server compares that base with the current document and your proposed content. Independent edits can merge. The response identifies the revision your work merged with, the new revision and the saved content hash.

By default, both overlapping passages are saved. `combined:true` and `overlapping_edits_preserved:true` identify that outcome. They do not block the save or require an approval step. Use the change log to inspect what each writer changed.

Use the optional `--reject-conflicts` when a task needs overlapping changes to be refused. The server returns `revision_conflict` with the current head and conflicting base, current and proposed passages. The rejected operation does not save a revision. Read the latest content, preserve the other writer's work and resolve incompatible intended edits with the user.

Preserving both passages can leave contradictory statements or invalid structured content. SmallDocs merges complete Markdown snapshots when you save. Earlier retained revisions and their diffs remain available to agents for subsequent changes.

## Read and edit a section directly

For a small change, read the relevant section and use its revision as the edit base:

```sh
sdoc cloud read DOCUMENT_ID --outline --json
sdoc cloud read DOCUMENT_ID --section 'Pricing' --json
sdoc cloud edit DOCUMENT_ID --section 'Pricing' \
  --old 'The plan costs $4 per month.' --new 'The plan costs $5 per month.' \
  --base-revision READ_REVISION_ID --json
```

You can also read `--lines 10:30`. Line numbers are one-based and inclusive. Sections include the heading and its nested content, stopping at the next heading of the same or higher level. Use a full heading path such as `Guide > Pricing` when names repeat. Headings in fenced code are ignored.

Exact replacements are case-sensitive. A unique match is required by default. When text repeats, `edit_ambiguous` returns candidate lines, sections and short excerpts. Select a section, use `context_before` and `context_after` in a JSON edit, or specify an occurrence after checking its location. `--all-matches` deliberately changes every match in the selected scope. An empty `--new ''` deletes the matched text.

Batch related changes in a JSON file:

```json
{
  "edits": [
    {"old_text":"$4 per month", "new_text":"$5 per month", "section":"Pricing"},
    {"old_text":"Contact Sam", "new_text":"Contact Priya", "section":"Support"}
  ]
}
```

```sh
sdoc cloud edit DOCUMENT_ID --edits-file changes.json --base-revision READ_REVISION_ID --json
sdoc cloud edit DOCUMENT_ID --edits '[{"old_text":"Draft","new_text":"Final"}]' --json
sdoc cloud edit DOCUMENT_ID --patch-file change.diff --base-revision READ_REVISION_ID --json
sdoc cloud edit --help
```

All operations match the original base, then save together. A missing match, unresolved ambiguity or overlapping operations saves nothing. Unified diffs verify their context and can re-anchor a unique passage when line offsets have changed. Only one document is edited per command. Full-file pull/edit/push remains available for larger rewrites or local editing tools.

The edit receipt includes matches, changed line counts, a contextual diff, merge flags, the saved revision, the complete saved content hash and the Cloud URL. It omits the full Markdown. When concurrent edits overlap, `overlaps` includes excerpts of the base and both passages. Both passages are saved by default. Large diagnostic lists and diffs report truncation; use selected reads or `cloud diff` for the rest. Read the saved revision to verify the change. Reuse a section selector if its heading is unchanged; for line selections, locate the saved passage using the diff or a fresh outline. The browser's revision checks load changes made through either editing path.

If you omit `--base-revision`, the CLI resolves the current head before editing. For a change based on a previous read, pass that read's revision explicitly. Independent changes made since the base merge, and overlapping changes preserve both passages by default. A retry of the same interrupted edit reuses its resolved base and idempotency key. Changed edit instructions start a new operation.

If the base revision has been pruned, `target_too_old` returns the current revision ID. Read the current passage and apply the intended change against that revision, keeping newer content.

## Review before saving

`cloud push FILE --dry-run --json` returns the proposed merged Markdown, conflict details, hashes, diff and `current_revision_id`. It does not change revisions, the working file or its binding.

A preview describes the head observed during that request. To commit against exactly that reviewed head:

```sh
sdoc cloud push ./policy.md --if-current REVIEWED_HEAD_ID --json
```

If another writer has saved since the preview, the operation returns `revision_conflict`. This option protects the reviewed head; it does not reserve or lock the document.

## Read and respond to reviewer feedback

Read comments and short source excerpts directly from Cloud:

```sh
sdoc cloud comments DOCUMENT_ID --json
sdoc cloud comments DOCUMENT_ID --id c7 --json
sdoc cloud comments DOCUMENT_ID --status all --limit 50 --json
sdoc cloud comments DOCUMENT_ID --author Priya --all --json
sdoc cloud comments DOCUMENT_ID --context none --json
```

The default response contains up to 25 open comments. Each has an ID, original note, author fields, replies, status, anchor and Cloud link. When a source passage is located, its snippet includes one-based line coordinates in the complete Markdown, including front matter, and a section name when available. Follow `next_cursor` with the same filters while `has_more` is true. Pages stay on the revision observed by the first request. `--revision` reads retained feedback from an earlier revision.

`anchor.match_status` reports `exact`, `relocated`, `ambiguous`, `lost` or `unverified`. `anchor.source_status` describes the source evidence behind that result. Source matching is separate from the browser's rendered placement. For example, a slide shape may have source context without a verified visual position. Comments with missing or ambiguous anchors remain available with their stored evidence. Imported author names and user IDs are editable document metadata, so they do not prove identity.

`--author` matches an exact display name (case-insensitive), a stored user ID, or `me`. `--all` follows every remaining page, and `--pages N` fetches up to N pages. `complete` reports whether the continuation was exhausted. `filtered_count` describes the matching feedback at that revision; document-wide counts remain separate.

Read the relevant section, edit its content and verify the saved revision. Then reply or resolve the feedback you addressed:

```sh
sdoc cloud comments DOCUMENT_ID --id c7 --reply 'Updated the production limit.' --json
sdoc cloud comments DOCUMENT_ID --id c7 --resolve --note 'Corrected and checked.' --json
sdoc cloud comments DOCUMENT_ID --id c7 --reopen --json
```

These actions keep the original note and discussion. `--note` adds a reply with the resolution. Content edits and comment actions save separately. The browser loads both through its existing revision checks. Earlier revisions remain available for 90 days, and the current revision is always retained.

To remove feedback that is no longer needed, including a comment you have addressed:

```sh
sdoc cloud comments DOCUMENT_ID --id c7 --delete --json
```

Delete removes the comment and all its replies from the current document. The document text and other comments stay unchanged. Resolve keeps the discussion in the current document. Deleted feedback remains in earlier revisions under the same 90-day retention policy. The deletion receipt identifies `comment_id` and returns `comment: null`; read the saved revision's feedback to verify it is absent. `--dry-run` previews deletion without saving it.

Actions on an existing comment read the selected thread before saving. `--base-revision` can use feedback you read earlier. Independent document changes and other comments are preserved. Concurrent replies append to the same thread. `comment_changed` means the target feedback changed since the base, and returns a short current-comment summary. Read it before proceeding. An interrupted action keeps its base and idempotency key for an exact retry. `--dry-run` previews a comment action without saving it.

Add an inline comment using its visible text. A section or line range disambiguates repeated passages:

```sh
sdoc cloud comments DOCUMENT_ID --add --text 'Check the approved limit.' \
  --quote '10 minutes' --section Production --json
```

If the target is lost or ambiguous, locate the intended passage before repairing its anchor:

```sh
sdoc cloud comments DOCUMENT_ID --id c7 --reattach \
  --quote '45 minutes' --section Production --json
```

Reattachment preserves the note, discussion and resolution state. It does not change the document text. Comment links use the document's existing permissions and do not grant access. Run `sdoc cloud comments --help` for command options and recovery.

## Verify what was saved

Read the saved revision, rather than assuming the uploaded file is identical to a merged result:

```sh
sdoc cloud read DOCUMENT_ID --revision SAVED_REVISION_ID --json
sdoc cloud diff DOCUMENT_ID --from BASE_REVISION_ID --to SAVED_REVISION_ID --json
sdoc cloud access DOCUMENT_ID --json
```

`read` returns Markdown and its SHA-256 without creating a local file. `diff` returns added and removed line counts and hunks with before/after text, line positions and context. Omitting `--to` compares against the current head. `access` without change flags reads sharing settings.

The save receipt's `saved_sha256` describes stored Markdown. Its `sha256` describes the local working copy. They can differ when Cloud tags are kept separately from the local file. If `local_changed_after_upload` is true, a later local edit was not included in that save. An unchanged push checks current access and reports whether Cloud still matches the working copy.

A receipt confirms one committed revision. Another person can save a later revision immediately afterwards. Read the current head as well when your task depends on the latest state.

## Recover one field or a whole document

```sh
sdoc cloud history DOCUMENT_ID --diffs --json
sdoc cloud read DOCUMENT_ID --revision OLD_REVISION_ID --json
sdoc cloud diff DOCUMENT_ID --from OLD_REVISION_ID --json
```

`history --diffs` returns each retained revision's author IDs, timestamp and line-based changes from its parent. A pruned parent is marked unavailable.

For a single-field correction, copy the older value into a working copy of the current document, then push. Restoring an entire old document would also replace newer unrelated changes.

For a full restore, preview and then bind the operation to the reviewed head:

```sh
sdoc cloud restore DOCUMENT_ID --revision OLD_REVISION_ID --dry-run --json
sdoc cloud restore DOCUMENT_ID --revision OLD_REVISION_ID --base-revision REVIEWED_HEAD_ID --json
```

A restore creates a new revision. Every revision is kept for 90 days, and the current revision is always kept. Revisions older than 90 days may be deleted.

## Access and failures

Current document permissions apply to history, comparisons, previews and updates. A revision ID does not bypass access checks. If access is revoked during an operation, the request fails. Keep local work and report the failure; changing permissions is a separate user action.

A pull refuses to replace a file or binding that changed while downloading. Push preserves edits made to the working file during upload. Retries of the same pending save or restore use an idempotency key, so a lost response does not create a duplicate revision.
