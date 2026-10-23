# Cloud library loading

The Cloud library starts document search, the complete visible tag inventory,
and library member loading together. Search changes do not restart the inventory
requests. Opening Tags uses the inventory already being fetched. Each document
row keeps the tags returned with that document, including while inventory is
pending. Tags outside the first 60 documents remain available to filter by.

A filter request failure leaves documents usable and offers Retry for the
missing filters. A library change aborts previous requests and ignores their
responses. The server still scopes tag names and counts to documents the caller
can read. Library ownership does not grant access to another member's private
tags.

Browsing uses the shared search service and its existing authorized SQL scope,
sorting, counts and signed cursor handling. With no text query, it reads only
revision metadata for the returned page and does not load body ciphertext or
decompress Markdown. Browsing and author/date/star filters open keys only for
the returned projects. Text and tag searches still use index keys. Full tag
inventories still open the keys needed for every visible tag.

Authorization, current revision, library, deletion and star checks remain after
asynchronous work and before final rows, counts, facets or cursor positions are
returned. New tests revoke a document or library during metadata/key/name loads
and revoke earlier and unselected rows during another row's load.

## Validation

- 1,829 Node checks passed.
- 29 distinct headless browser scenarios passed, including initial tag fetching,
  delayed filters, independent document loading, failed tag/member retries,
  library switching, tags outside the first page, private tags, stars and mobile
  layouts.
- The independent 1,200-document oracle passed 138 cases across 623 pages with
  exact counts, facets, full recall, no duplicates and nine security checks.
- Cursor tampering fixtures now change signature data rather than potentially
  changing only unused base64 padding bits. No cursor acceptance rules changed.

## Resource observation

The existing encrypted 100,000-document fixture was reopened in fresh Node 22
processes, without constructing a corpus in JavaScript. Requests overlap at an
asynchronous local key boundary. Each browsing request reads 60 rows and an
author facet. The combined case starts the complete tag inventory concurrently.

| Concurrent loads | Browse peak RSS | Browse elapsed | Browse with tags peak RSS | Browse with tags elapsed |
| --- | --- | --- | --- | --- |
| 1 | 97 MiB | 3.0 s | 125 MiB | 4.8 s |
| 4 | 114 MiB | 12.3 s | 140 MiB | 25.1 s |
| 8 | 112 MiB | 19.3 s | 149 MiB | 49.8 s |

Each configuration decrypted zero document bodies and exactly 60 metadata
records per browsing request. Exact authorized totals, row tags, author counts,
unique document IDs and temporary-table cleanup passed.

These are total-process resource observations on a shared development machine
with other tests running. They exclude HTTP and managed KMS, use a small repeated
tag vocabulary, and do not measure 100,000 unique tags. They do not establish a
latency improvement or deployment capacity. The full SQL scope and tag
aggregation still cost time at this size; this change removes unnecessary body
work and lets the browser display documents independently of filter loading.

Raw results: [cloud-library-loading-2026-10-23.json](evaluations/cloud-library-loading-2026-10-23.json).
