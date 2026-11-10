# Document history in the reader

## Behaviour

The document toolbar gains the Lucide rotate-ccw-clock icon after the first saved Agent / CLI update. Creation alone, including creation through the CLI, does not reveal it. Human-only edits do not reveal it. Once revealed it remains available, including after older agent revisions expire.

The icon opens the existing right panel, with the same responsive sheet, typography, disclosures, theme and close controls as sharing and metadata. A newly observed saved revision briefly expands the icon with Updated and its local time. The normal tooltip gives the last saved update's date and time. Loading a document with existing history does not replay a notification.

The panel shows agent updates, browser editing sessions and creation in reverse order, with the person first, then the edit reason, source, time and grouped save count. Old agent updates without a reason say No reason recorded; no explanation is fabricated for them. A browser edit-mode visit gets a random session ID. Consecutive saves from that person and session form one entry. Another writer's revision splits that run, preserving chronology. Switching back to read mode ends the editing visit for presentation; intermediate autosaves remain durable.

Agent / CLI means a save authenticated using a CLI credential. It does not claim that every CLI user is an agent. The server derives this from authentication. A request cannot change its source or author using a supplied session ID. Older browser revisions without a session ID remain separate entries.

Each listed version offers Open as new document as the first action. It creates a private, independent Cloud document in the same library, preserving that version's Markdown, formatting, tags and comments. The copy starts at revision 1 with a new URL and its own history. It does not inherit shared access, source-file paths, publication or short links. The source document is untouched. View changes remains available as a separate disclosure and does not load any snapshots until requested. The existing current-session Undo and full-document CLI restore remain separate actions.

## Storage and load

Reuse the existing encrypted, Brotli-compressed revision snapshots and 90-day history retention, always retaining the current revision. Add a nullable browser editing-session identifier to revision metadata and a persistent agent-edit-seen flag to the document. No additional document copies or stored diffs are created merely by browsing history. A copy is stored only when requested.

Do not add a history polling loop. The existing lightweight head polling carries activity metadata. An indexed query finds the most recent agent update without decrypting content. History lists load 20 grouped entries per request, using a user- and document-bound signed cursor. Grouping runs in SQLite over one document's retained revision metadata. For listed rows with a reason, decrypt only their encrypted metadata envelopes. Return a detached preview of at most 512 UTF-16 units, without splitting surrogate pairs, rather than retaining the entire string in a history page. The full reason stays stored; Read full reason fetches the single selected revision on demand. Document bodies stay unopened. Existing head polling does not decrypt metadata. A non-sensitive has_edit_reason flag skips this work for older revisions without explanations.

Open a comparison by fetching only its before and after snapshots through the existing permission-checked revision endpoints. The existing text diff implementation runs in a disposable browser worker. Emit a small page of lines at a time and let the user request more. Closing the panel, changing document, hiding changes or selecting another entry terminates that worker. Render all comparison data with textContent.

Compressed snapshots keep reads, key rotation, revision pruning and backup recovery independent of a chain of patches. A delta-storage format would need checkpointing, pruning rebases and recovery changes; it is not introduced for this UI. Existing compressed_size values and a representative workload benchmark provide evidence for a later storage decision.

## Edit reasons

Every changed revision authenticated with a CLI credential requires a nonblank edit_reason. The store enforces this at revision insertion, covering full saves, targeted edits, tag updates, comment actions and restores. The API returns edit_reason_required (400); the CLI returns exit 2 and explains --reason. Browser saves and initial document creation do not require a reason. Previews and no-op target saves create no revision.

Reasons live inside the existing authenticated encrypted revision metadata, outside the Markdown. They do not affect whether document content changed. They are included in idempotency identity and save receipts, and are returned by both grouped reader history and paginated CLI revision history. Project-key rotation automatically protects them with the rest of the metadata. Library moves explicitly preserve them while re-encrypting. They are not copied into publication or private-link content.

New CLI documents receive their selected tags in the initial creation request. Tagging a new file therefore does not create a misleading second agent-update event. Existing bound-file changes and additional tags require the caller's explanation. The installed Cloud skill and all editing help explain the intended field.

## Copies and retries

POST /api/cloud/v1/documents/:document/revisions/:revision/copy reuses normal Cloud creation, with an idempotency digest bound to the source document and revision. The caller must currently read the source and be allowed to create in its project. Recheck source access, scope, retained-revision existence and billing after asynchronous decryption and immediately before creating the copy. A pruned version is unavailable; never substitute the current head.

The browser opens its new tab directly from the human's click, then navigates after a successful save. A blocked popup leaves an Open copy link. A failed response retains its operation key, so a retry does not create another document. Panel refreshes during the request retain the pending/result state. The CLI exposes the same operation as cloud copy DOCUMENT_ID --revision REVISION_ID --no-open --json.

## Access and compatibility

- Every history, head and revision request uses current document permissions and billing checks. Library membership alone does not expose a private document.
- Signed cursors cannot be reused for another caller, document or endpoint.
- The indicator and history are absent from public publications and encrypted shared copies.
- New columns have backwards-compatible defaults. Existing revisions do not need decryption or rewriting during migration.
- Session attribution participates in save idempotency. No-op saves do not create entries. Existing CLI history and diff commands remain available.
- Retention may remove a comparison's earlier version. Explain that the version is unavailable instead of substituting unrelated content.

## Verification

Exercise actual CLI bearer credentials, browser autosaves, repeated edit visits, interleaved writers, no-op saves, reloads, pagination, expired revisions, revoked access, separate companies, metadata-only listing, large diffs, panel lifecycle, mobile layout, light/dark themes and stale asynchronous responses. Benchmark long metadata histories and the existing snapshot compression before changing storage policy.

Verified on 5 November 2026:

- Full Node suite: 2,317 passed, including history permissions, signed cursors, migration, idempotency, no-op saves, reasons, historical copies and retention.
- History browser suite: 52 passed across Chromium, Firefox and WebKit, with two service-worker cases intentionally skipped outside Chromium. Covers grouped browser visits, interleaved agent edits, pagination, lazy comparisons, reasons, private historical copies, lost-response retries, revoked access, expired versions and concurrent refreshes.
- Cached Cloud reader upgrade: passed in Chromium, starting at release 01b6ff53 with an active service worker, then restarting on the new source with the same account and document. This focused check was repeated after the full browser suite.
- Existing editing, comments and theme regression tests: 48 passed after the reason/copy update. SDK snapshots and release manifests passed their consistency checks.
- Headless visual inspection: desktop light/dark and mobile dark. The mobile history sheet fits a 390-pixel viewport without horizontal page overflow.

Run the browser checks with `playwright test --config=playwright.history.config.js`, the full Node suite with `node test/run.js`, and the local workload with `node test/bench-cloud-history.js`.

The local workload used 10,001 retained revisions per document and 20 concurrent history requests. No listing decrypted document bodies. Results from the final reason/copy implementation:

| Workload | Batch elapsed | Median request | RSS growth |
| --- | --- | --- | --- |
| Agent revisions without reasons | 264 ms | 144 ms | 17.6 MiB |
| One browser session with 10,000 saves | 582 ms | 381 ms | 15.7 MiB |
| Agent revisions with ordinary reasons | 548 ms | 300 ms | 8.4 MiB |
| Stress case, 500,000-character reasons | 1,256 ms | 706 ms | 129.8 MiB |

RSS was measured before and after each batch, not at peak. These local observations are not service guarantees. The stress case shows transient decryption overhead even though responses contain detached, bounded previews. Full reasons are fetched individually on request.

Body-only Brotli samples were 636 bytes to 348 bytes for the rich editing fixture and 75,576 bytes to 34,591 bytes for the product reference document. A thousand similarly sized saved bodies would therefore occupy about 0.33 MiB or 33 MiB before encrypted metadata and database/index overhead. Snapshots are compressed, not free, but this feature adds no further body copies. Storage deltas should be considered against measured customer revision volume rather than introduced as part of the reader panel.

## Reason and copy verification

Nine dedicated store/API tests cover required reasons across every revision path, encryption without body reads, no-op saves, retry identity, exact historical copies, private access, company separation, revocation during decryption, key rotation, library moves, real CLI copy and missing-reason feedback. Browser tests cover optional diffs, visible person/reason attribution, opening older versions in a new tab, lost-response retries, concurrent list refreshes and on-demand full reasons. The suites above total 2,317 Node checks and 100 browser checks, plus the repeated focused service-worker rehearsal.
