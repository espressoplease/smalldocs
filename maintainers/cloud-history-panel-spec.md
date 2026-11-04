# Document history in the reader

## Behaviour

The document toolbar gains the Lucide rotate-ccw-clock icon after the first saved Agent / CLI update. Creation alone, including creation through the CLI, does not reveal it. Human-only edits do not reveal it. Once revealed it remains available, including after older agent revisions expire.

The icon opens the existing right panel, with the same responsive sheet, typography, disclosures, theme and close controls as sharing and metadata. A newly observed saved revision briefly expands the icon with Updated and its local time. The normal tooltip gives the last saved update's date and time. Loading a document with existing history does not replay a notification.

The panel shows agent updates, browser editing sessions and creation in reverse order, with author, time and grouped save count. A browser edit-mode visit gets a random session ID. Consecutive saves from that person and session form one entry. Another writer's revision splits that run, preserving chronology. Switching back to read mode ends the editing visit for presentation; intermediate autosaves remain durable.

Agent / CLI means a save authenticated using a CLI credential. It does not claim that every CLI user is an agent. The server derives this from authentication. A request cannot change its source or author using a supplied session ID. Older browser revisions without a session ID remain separate entries.

This panel is read-only. It does not add a restore action or alter the existing current-session Undo control. Restoring revisions, reviewing agent changes and attributing individual passages remain separate product decisions.

## Storage and load

Reuse the existing encrypted, Brotli-compressed revision snapshots and 90-day history retention, always retaining the current revision. Add a nullable browser editing-session identifier to revision metadata and a persistent agent-edit-seen flag to the document. No additional document copies or stored diffs are created.

Do not add a history polling loop. The existing lightweight head polling carries activity metadata. An indexed query finds the most recent agent update without decrypting content. History lists load 20 grouped entries per request, using a user- and document-bound signed cursor. Grouping runs in SQLite over one document's retained revision metadata, without loading ciphertext or Markdown into the Node process.

Open a comparison by fetching only its before and after snapshots through the existing permission-checked revision endpoints. The existing text diff implementation runs in a disposable browser worker. Emit a small page of lines at a time and let the user request more. Closing the panel, changing document or selecting another entry terminates that worker. Render all comparison data with textContent.

Compressed snapshots keep reads, key rotation, revision pruning and backup recovery independent of a chain of patches. A delta-storage format would need checkpointing, pruning rebases and recovery changes; it is not introduced for this UI. Existing compressed_size values and a representative workload benchmark provide evidence for a later storage decision.

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

- Full Node suite: 2,308 passed, including history permissions, signed cursors, migration, idempotency, no-op saves and retention.
- History browser suite: 36 passed across Chromium, Firefox and WebKit. Covers grouped browser visits, interleaved agent edits, pagination, lazy comparisons, revoked access, expired versions, mobile layout, private-copy isolation and delayed responses after panel closure.
- Cached Cloud reader upgrade: passed in Chromium, starting at release 7a6f50f7 with an active service worker, then restarting on the new source with the same account and document.
- Existing editing, comments and theme regression tests: 48 passed. SDK snapshots and release manifests passed their consistency checks.
- Headless visual inspection: desktop light/dark and mobile dark. The mobile history sheet fits a 390-pixel viewport without horizontal page overflow.

Run the browser checks with `playwright test --config=playwright.history.config.js`, the full Node suite with `node test/run.js`, and the local workload with `node test/bench-cloud-history.js`.

The local workload used 10,001 retained revisions per document and 20 concurrent history requests. The agent-update batch completed in 183 ms; a single browser session containing 10,000 saves completed in 415 ms. Neither listing decrypted document bodies. Process RSS measured before and after the batches grew by 14.6 MiB and 12.7 MiB respectively; these are not peak-memory measurements or service guarantees.

Body-only Brotli samples were 636 bytes to 348 bytes for the rich editing fixture and 75,576 bytes to 34,591 bytes for the product reference document. A thousand similarly sized saved bodies would therefore occupy about 0.33 MiB or 33 MiB before encrypted metadata and database/index overhead. Snapshots are compressed, not free, but this feature adds no further body copies. Storage deltas should be considered against measured customer revision volume rather than introduced as part of the reader panel.
