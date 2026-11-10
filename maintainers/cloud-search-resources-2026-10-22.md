# Cloud search, stars and resource evaluation, 22 October 2026

The browser library and CLI now use the same permission-scoped substring index,
search service, signed pagination and per-user stars. Browser literal matching
is preserved. CLI structured word/phrase queries keep their existing meaning;
`--literal` uses the same matching path as the browser. `cloud star`, `cloud
unstar` and discovery `--starred` use the same API and principal as browser stars.
CLI candidate version: 1.20.0-rc.5, skill v35. This is a staging candidate, not an
npm latest or production release.

## Behaviour and memory changes

- Format 3 adds encrypted raw vocabulary with keyed UTF-16 character features.
  Ordinary fragments verify distinct vocabulary labels, then use document postings.
  Only the returned page bodies are decrypted, including common fragments.
- Multi-run literals prune by safe raw anchors and verify candidate document
  content in batches of 32 IDs. Vocabulary verification uses pages of 64 labels.
- Literal candidates, sort, totals and pagination remain in SQLite. Structured
  expressions retain request-local JS postings maps. Tag inventory retains a map
  of distinct labels for cross-project merging and ordering.
- Evidence generation streams words and bounds candidate hits per query clause.
  Repeated words in a large document do not create an object for every occurrence.
- Per-row authorization after awaits leaves the whole-scope change stamp pending.
  Unconditional checks before selection and after the last await remove revoked,
  moved, changed or unstarred results before documents, counts, facets and cursors.
- Stars persist per user/document, survive reload and independent browser contexts,
  and grant no access. Failed writes roll back the UI; a failed refresh after a
  successful write offers search Retry without misreporting the saved state.

## 100,000-document concurrent measurements

A retained encrypted fixture contains 100,000 authorized current documents and
52,693,057 bytes of Markdown. The SQLite file after backfill is about 879 MiB,
including earlier dictionary/index allocation. New formats can add disk usage;
this measurement does not establish a universal index-to-document size ratio.

Each configuration uses a fresh Node 22.18.0 process, the same SQLite connection
and shared search implementation, concurrency 1, 4 or 8, page size 20, exact totals
and all three facets. An asynchronous local key-provider boundary makes requests
overlap. Fixture generation and backfill run outside the measured worker. There
is no forced garbage collection. Values below are total process peak RSS, not
per-request memory or an incremental memory estimate. Timing is observed wall
clock on a shared local development machine, not a reserved capacity benchmark.

| Query | One request, ms | Eight-request burst, ms | Eight-request peak, MiB | Eight-request body decryptions |
| --- | ---: | ---: | ---: | ---: |
| Rare literal fragment | 1,365 | 16,432 | 130.6 | 160 |
| Absent literal fragment | 1,116 | 15,974 | 105.0 | 0 |
| Broad indexed word | 2,615 | 27,499 | 266.5 | 160 |
| Indexed phrase | 1,361 | 17,834 | 230.4 | 160 |
| Tag inventory | 2,015 | 19,519 | 134.6 | 0 |
| Broad literal fragment | 2,402 | 26,488 | 167.8 | 160 |
| Multi-run literal phrase | 3,955 | 34,040 | 188.2 | 100,168 |

The peak across all 21 configurations was 266.5 MiB.
Every result count, selected-page cardinality, unique ID set, author/library facet
sum and expected body-decryption count passed. Tag inventory and absent fragments
decrypted no document bodies. The literal phrase matched 12,501 documents and
verified them before returning 20, so it has substantially greater CPU work than
single-run vocabulary matching.

Eight concurrent broad-fragment requests repeated three times completed 24
requests in 76,446 ms, with 180.8 MiB peak RSS. All temporary search
tables were removed. This short repeated run is a regression check, not proof
of indefinite leak-free operation.

## Larger documents

A separate retained fixture has 64 documents with about 250 KiB each, including
many repeated words. Twelve fresh-process cases cover indexed words, broad/rare
literal fragments and tags at concurrency 1, 4 and 8. Peak RSS was
148.2 MiB across these cases.

A 20-round run of eight overlapping fragment requests completed 160 searches in
3,255 ms, with 346.9 MiB process peak. Unforced garbage collection
reclaimed memory periodically; final RSS was 304.6 MiB. This workload excludes
fixture seeding but includes body decryption and evidence extraction.

## Isolation, correctness and browser checks

- All 1,733 Node tests passed, including 23 new isolation regressions.
- The independent 1,200-document oracle passed all 138 fixed/generated cases,
  623 pages, precision and recall 1.0, zero duplicate results and zero failures.
- Cross-company and within-company private documents cannot contribute IDs,
  text, tag labels, counts, author/library facets or readable cursor positions.
  Identical plaintext uses separate project digests. Company owners/admins do not
  gain access to another member's private documents.
- Twelve simultaneous real HTTP searches plus two tag inventories across two
  companies returned only each caller's authorized records. Word, single-run and
  multi-run literal paths were exercised together.
- Second-connection revocations during key, body and project-name awaits passed.
  Additional races revoke or unstar previously selected and unsnippeted records
  while another row loads. Final counts/facets/cursors contain only survivors.
- Arbitrary UTF-16 substrings, emoji halves, decomposed Unicode, case expansions,
  punctuation, tag spaces and synthetic selected-field boundaries match the
  previous trimmed/lowercase substring oracle. Lowercase highlight offsets map
  back to original source text.
- All 33 headless library people, tag and star tests passed, including reload,
  fresh context, off-page stars, per-user/company isolation, failure recovery,
  library switching, keyboard use and responsive layouts.
- Local TLS acceptance passed four flows, including real CLI/browser star parity.
  The opt-in Stripe portal case was skipped; billing was not changed here.
- A cached ccb858b1 app shell upgraded on ordinary reload through the real service
  worker. Star persistence, independent users and combined text/star filtering
  passed with no mocked APIs and zero page errors.

## Limits and remaining work

These measurements exclude HTTP transport and managed KMS latency. They do not
establish capacity on the staging VM, deployment-wide concurrency, very large
libraries with many distinct tags, or arbitrary multi-megabyte documents. CPU
and SQLite work remain material for broad exact counts and simultaneous searches:
the busiest eight-request burst took about 34 seconds. Multi-run literal queries
can still read most authorized candidate bodies. Memory is not a fixed ceiling;
structured postings maps, tag vocabulary, result size and GC affect it.

The index exposes equality, frequency, positions and character relationships.
The application server can unwrap project keys. This is not zero-knowledge or
end-to-end encryption against the service operator. The complete mechanism and
backfill procedure are in [cloud-search.md](cloud-search.md).

## Reproduction

See `scripts/search-eval/README.md` and `scripts/search-eval/concurrent.js`.
Machine-readable evidence is in
[evaluations/cloud-search-resources-2026-10-22.json](evaluations/cloud-search-resources-2026-10-22.json).
