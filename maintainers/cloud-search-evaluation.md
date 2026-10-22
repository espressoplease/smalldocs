# Cloud search evaluation, 20 October 2026

This is the historical 20 October evaluation. The 22 October browser/CLI literal
search, stars, memory and isolation results are in
[cloud-search-resources-2026-10-22.md](cloud-search-resources-2026-10-22.md).

The candidate implements permission-scoped company research through the Cloud
API and CLI. It replaces the API's bounded decrypt-and-scan search with a keyed
current-revision index for words, phrases, prefixes and metadata. Literal
substring searches still scan authorized content.

## What agents can do

- Combine words, adjacent phrases, prefixes, field restrictions and Boolean
  expressions, with optional English singular/plural expansion.
- Intersect exact tags, any/excluded tags, document creators, current revision
  writers, inclusive dates, libraries, projects and document subsets.
- Receive exact authorized totals, tag/author/library facets, source passages,
  highlight offsets, source line numbers, stable document IDs and Cloud URLs.
- Follow signed keyset cursors, request a bounded number of pages, or traverse
  all pages with an explicit result cap and continuation.
- Read Markdown on stdout without creating a local file or editing binding.
- Submit reproducible structured JSON requests and subsets of 100,000 IDs.

The full command reference is `public/cloud-search.md`. Run
`sdoc cloud search --help` without authentication to inspect the installed
candidate's syntax and result contract.

## Correctness and disclosure

The independent evaluator generates Markdown and a separate fact manifest.
Expected answers come from fact predicates and an independent ACL predicate,
without importing the production parser, tokenizer, ranking function or SQL.
The 1,200-document mixed-permission corpus passed 138 fixed and generated cases,
traversing 623 pages and 17,050 returned document appearances. Precision and
recall were 1.0 in every case, with zero duplicate IDs.

Evidence checks verified 10,863 snippets and 14,819 highlights against authorized
raw source fields and explicit positive query witnesses. Mutation tests reject
missing evidence, unrelated source text, wrong fields, incorrect lines and
negative-only evidence.

Nine security and lifecycle scenarios passed: derived-index plaintext canaries,
hidden-document influence, revocation between pages, revocation during decrypt,
revocation through a second SQLite connection, atomic key-provider failure,
current-head save/delete/restore, library membership revocation and legacy index
backfill. Fifteen HTTP assertions cover disclosure and cursor tampering/replay
across principals, expressions, filters, document subsets, fields and ordering.

Additional store and HTTP regressions cover revoked cursor boundaries, document
grants without project grants, an empty explicit subset, 100,000 supplied IDs,
Unicode compatibility expansions, decomposed literal substrings, 150,000
occurrences of one word, long prefixes, and page-sized body decryption.

## 100,000-document measurements

The retained fixture contains 100,000 encrypted documents, 52,693,057 bytes of
Markdown, 5,410,619 positional posting rows and a 626,020,352-byte SQLite database.
Every document is accessible to the benchmark user. This measures a real
100,000-result scope rather than a small authorized subset of a larger corpus.

Each timed query requests 100 results plus exact totals and all three facets.
Seven samples were taken per query on the local machine with Node 22.18.0.

| Query | Exact matches | Median | Observed p95 |
| --- | ---: | ---: | ---: |
| Broad word | 100,000 | 2,337 ms | 3,856 ms |
| Rare word | 101 | 1,658 ms | 1,737 ms |
| Adjacent phrase | 12,501 | 1,835 ms | 1,919 ms |
| Word prefix | 100,000 | 3,163 ms | 4,075 ms |

The initial broad-word median was 7,386 ms and rare-word median was 6,667 ms.
Project dictionary lookup predicates, one authorized relation per request,
query-local change stamps, selective revision joins and streamed single-word
postings reduced those costs. Authorization is recalculated on any database
change and unconditionally checked before aggregation.

A fresh-process broad query took 2,669 ms and decrypted 100 returned revisions.
The operating system's disk cache was retained. Four independently constructed
keyset boundaries, at offsets 0, 37, 50,003 and 99,923, returned the exact expected
IDs, counts and facets. The last boundary correctly returned 77 documents.

The 100,000-document benchmark does not traverse every page of every timed query.
Full pagination recall is checked on the mixed-permission correctness corpus;
large-corpus checks cover first pages, totals, facets and selected boundaries.

Peak resident memory across 28 repeated large-scope queries was about 929 MiB.
These are single-process measurements with small synthetic documents and a local
key provider. They exclude network latency and managed KMS calls. They do not
establish concurrent production capacity or performance for multi-megabyte
documents. Literal scans have a different cost and are not represented by the
indexed-query timings above.

## Agent trials

Three clean-context trials used the generated Cloud skill and real CLI against
disposable HTTP environments. Agents chose their own queries and encountered
randomly generated production-policy conflicts. They used returned Cloud URLs,
kept research read-only and distinguished document creators from current writers.
The final trial found conflicting approved production documents and verified all
27 accessible, non-archived engineering documents by the requested creator in
16 CLI invocations.

The trials led to compact JSON, direct reads, automatic page collection with
explicit completeness, optional word forms and better passage allocation.
Search remains lexical. Tags and relevance do not establish document authority;
agents must read evidence and identify unresolved conflicts.

## Encryption and operational limits

Documents already use per-project envelope keys, shared through server-enforced
document permissions. Search does not require one company-wide key or a
per-user-key migration. The derived index stores keyed equality, positions,
prefix/gram relationships and encrypted labels. These expose structural
relationships and access patterns. The server can decrypt authorized content;
this is not a zero-knowledge search system.

The pre-existing idempotency response cache separately contains some plaintext
response metadata. Project dictionaries can retain encrypted labels and keyed
features after individual document purges. See `maintainers/cloud-search.md`
for the threat model and backfill procedure.

## Reproduce

```sh
node test/run.js
node scripts/search-eval/test-oracle.js
node scripts/search-eval/run.js --documents 1200 --random-cases 100 --page-size 31 --output /tmp/search-correctness.json
node scripts/search-eval/http-run.js --output /tmp/search-http.json
node scripts/search-eval/run.js --documents 100000 --all-visible --benchmark-only --keep --output /tmp/search-100k.json
node scripts/search-eval/probe.js --fixture RETAINED_DIRECTORY --kinds broad,rare,phrase,prefix --repetitions 7 --output /tmp/search-probe.json
```

Dependencies must be available to the Node runtime. `scripts/search-eval/README.md`
defines the fixtures, evidence checks and measurement limits. The sanitized
machine-readable result is `maintainers/evaluations/cloud-search-2026-10-20.json`.
