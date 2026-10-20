---
title: Find and update Cloud documents
---

# Find and update Cloud documents

Search identifies documents you can access. Pull a document to edit it, preview the proposed save, then read the committed revision to verify the result. A local working filename does not rename the Cloud document, and saving content does not change its sharing settings.

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

## Concurrent edits

A pull records the revision you read. When you push, the server compares that base with the current document and your proposed content. Independent edits can merge. The response identifies the revision your work merged with, the new revision and the saved content hash.

By default, both overlapping passages are saved. `combined:true` and `overlapping_edits_preserved:true` identify that outcome. They do not block the save or require an approval step. Use the change log to inspect what each writer changed.

Use the optional `--reject-conflicts` when a task needs overlapping changes to be refused. The server returns `revision_conflict` with the current head and conflicting base, current and proposed passages. The rejected operation does not save a revision. Read the latest content, preserve the other writer's work and resolve incompatible intended edits with the user.

Preserving both passages can leave contradictory statements or invalid structured content. SmallDocs merges complete Markdown snapshots when you save. Earlier retained revisions and their diffs remain available to agents for subsequent changes.

## Review before saving

`cloud push FILE --dry-run --json` returns the proposed merged Markdown, conflict details, hashes, diff and `current_revision_id`. It does not change revisions, the working file or its binding.

A preview describes the head observed during that request. To commit against exactly that reviewed head:

```sh
sdoc cloud push ./policy.md --if-current REVIEWED_HEAD_ID --json
```

If another writer has saved since the preview, the operation returns `revision_conflict`. This option protects the reviewed head; it does not reserve or lock the document.

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

A restore creates a new revision. History is bounded: default retention keeps the current revision and up to three previous revisions, with previous revisions retained for at most 90 days. Deployments can configure a different policy. Do not treat revision history as an unlimited archive.

## Access and failures

Current document permissions apply to history, comparisons, previews and updates. A revision ID does not bypass access checks. If access is revoked during an operation, the request fails. Keep local work and report the failure; changing permissions is a separate user action.

A pull refuses to replace a file or binding that changed while downloading. Push preserves edits made to the working file during upload. Retries of the same pending save or restore use an idempotency key, so a lost response does not create a duplicate revision.
