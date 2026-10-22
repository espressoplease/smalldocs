# Cloud search index

The Cloud server indexes the current document revision. Document bodies, titles,
filenames and tags remain encrypted under the existing project keys. Search uses
project-scoped HMAC-SHA256 word digests and positional postings, integer word and
document IDs, keyed vocabulary prefixes and character grams, an encrypted tag dictionary, and encrypted raw-run labels with keyed character
features for literal search. Search keys derive from project keys with a separate versioned HMAC
domain. There is no plaintext FTS database on disk.

This index exposes repeated keyed words, per-document word frequency and order,
word sharing between documents in one project, vocabulary prefix and character
gram relationships, raw-run equality and punctuation/whitespace relationships, document sizes and update patterns. Project-specific keys
prevent comparing the same digest between projects. A database reader without the
keys cannot directly query arbitrary plaintext words, but frequency and structure
can reveal information. This is a blind candidate index, not encryption that
conceals search or access patterns. A server with permission to unwrap project
keys can decrypt and search project content.

The existing idempotency response cache is separate from the search index. It
currently stores some plaintext response metadata and revision restore responses.
Do not describe the whole Cloud database as containing only ciphertext.

## Matching and authorization

Words contain Unicode letters, marks, numbers and underscores. Punctuation and
whitespace separate words. Word comparison uses NFKC normalization, lowercase,
German sharp-s folding and final-sigma folding. A phrase requires adjacent words
in the same field. Punctuation between those words does not affect phrase
matching. A term containing punctuation is treated as an adjacent word sequence.
Prefix matching is explicit. Literal substring queries retain the trimmed,
case-insensitive JavaScript substring semantics used by the browser and CLI.
Format 3 adds a separate raw-run vocabulary, divided into letter/number/mark/
underscore runs and their separators. It does not use normalized word candidates,
which would miss decomposed Unicode and partial compatibility sequences. Raw
features hash UTF-16LE bytes so distinct surrogate halves do not collapse through
UTF-8 replacement. Literal tag text uses space-joined labels, matching verification.

A query anchors on up to eight keyed grams of one raw run. Candidate membership
is intersected with the authorized relation in SQLite. A single-run query verifies
encrypted vocabulary labels in batches of 64, then joins accepted term IDs to
postings. A common word fragment therefore does not decrypt every matching body.
Multi-run queries verify candidate bodies individually, fetching only 32 revision
IDs at a time. Query anchors exclude synthetic field-boundary newlines, so this
optimization cannot drop matches across selected fields. False-positive candidates
are rejected by exact text verification. Returned evidence maps lowercase case
expansions back to source offsets.

Literal candidate IDs, filtering, ordering, totals and pagination remain in SQL.
Structured word/phrase evaluation still uses request-local JavaScript postings
maps. Evidence generation streams words and retains a bounded number of candidate
hits per clause, rather than one object for every repetition in a large document.
Tags use the same authorized index relation without reading document bodies.
Distinct tag labels are decrypted and merged for frequency ordering; that memory
scales with tag vocabulary size. The current inventory endpoint returns all tags.

An active workspace membership and the document's own permissions determine the
searchable set. Workspace owners and admins do not automatically gain document
access. Author, document subset, date and library filters narrow that set.
Boolean NOT complements only the caller's authorized set. Counts, facets and
scores use that set; relevance uses local field weights and occurrence counts,
not statistics from inaccessible documents.

Each query captures its authorized relation and SQLite change stamp in one read
snapshot. After each awaited key or content operation it checks `data_version`
and `total_changes()`. Any change, including a permission update on a different
connection, forces a fresh document/head and ACL check for the selected row after
a content or name await. Such a check does not advance the whole-scope stamp.
Key awaits check the scope, and unconditional whole-scope checks run before page
selection and again after the last await, before aggregation. This avoids repeated
full-corpus checks during per-document verification while retaining the final
authorization boundary. This state lasts for one request. The server's
synchronous `beforeReturn` callback rechecks read
entitlements. Search performs its final authorization checks before constructing
counts and facets. Snippets are plain text with offsets, not HTML.

## Backfill and operations

Revision creation, save, restore and cross-library move update current-head
postings in the same SQLite transaction as the document change. Soft-deleted
documents retain postings for restore, but the authorization relation excludes
them. Purging the document removes its postings by foreign-key cascade. The
project dictionary can retain encrypted vocabulary, tag labels and keyed features
after a document purge; the project purge removes these. Dictionary collection
must account for in-flight prepared revisions before removing term IDs.

Existing databases need a backfill. Search prepares at most 100 missing or stale
authorized heads per request. If more remain it returns `search_index_building`
instead of omitting unindexed documents. The operator command rebuilds in bounded
transactions and emits only counts and continuation IDs:

```sh
node ops/rebuild-cloud-search.js --status
node ops/rebuild-cloud-search.js --batch-size 100
node ops/rebuild-cloud-search.js --workspace WORKSPACE_ID --batch-size 100 --once
```

Use the deployment's `CLOUD_DB`, key-provider environment and
`CLOUD_IDEMPOTENCY_SECRET` (or `CLOUD_AUTH_PEPPER`). The command reuses the existing
Cloud key-provider factory. Run `--status` after backfill and verify `ready:true`
before enabling search on a deployment. Restarting does not require re-reading
and decrypting the entire document corpus.

Term and phrase matching, counts and facets use postings without decrypting every
matching body. Result snippets decrypt only the selected page. Single-run literal searches
also decrypt only selected page bodies, after vocabulary verification. Multi-run
literals decrypt candidate bodies and can still approach a full scan for very
common anchors. Measure those paths separately
from indexed structured queries when reporting large-library performance.

Pagination uses deterministic score/update-time/ID or timestamp/ID ordering. The
API signs cursor scope and positions. It rechecks permissions on each page, so
documents revoked or changed during a search are removed. Concurrent writes can
change order between pages; cursors do not retain a database snapshot.

## Per-user stars

`cloud_document_stars` keys a star by `(user_id,document_id)`. The authenticated
principal is used for writes; request-body user or workspace IDs do not change
it. `PUT /api/cloud/v1/documents/:id/star` sets a boolean idempotently and requires
current document read access and a readable subscription, not revision-write
rights. Stars grant no access. Purging a document cascades its stars. Soft delete
hides it through normal scope filtering; restore retains the preference.

Search returns `starred` and supports `starred_only`; signed cursor scope includes
that filter. The final change-stamp check reapplies star membership for starred-
only queries, so a concurrent unstar cannot leave inconsistent counts or facets.
Browser and CLI use this same endpoint and search filter. A failed write restores
the previous UI state. A failed refresh after a successful write offers search
Retry without rolling back the saved preference.
