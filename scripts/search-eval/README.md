# Cloud search evaluations

Run against a disposable local SQLite database:

```sh
node scripts/search-eval/test-oracle.js
node scripts/search-eval/run.js --documents 1200 --random-cases 100 --page-size 31 --output /tmp/search-correctness.json
node scripts/search-eval/http-run.js --output /tmp/search-http.json
node scripts/search-eval/run.js --documents 100000 --all-visible --benchmark-only --repetitions 7 --keep --output /tmp/search-100k.json
```

The server dependencies must be installed. A worktree can use an existing install
through `NODE_PATH=/path/to/smalldocs/node_modules`. Nothing is published or sent
to an external service. `--keep` retains the disposable database directory and
prints its path in the JSON report. Remove that directory when inspection ends.

The default fixture mixes private, selected-member, and everyone document access
across two accessible libraries and a third library without reader membership.
The `--all-visible` fixture grants the reader access to every document, including
all three libraries. Use that mode to measure an actual 100,000-result query.

`corpus.js` creates both text and a separate fact manifest. Every expected result
set is computed from manifest facts plus an independent permission predicate.
`scenarios.js` pairs explicit AST requests with fact predicates. The evaluator
does not import the production parser, tokenizer, ranking function, or query SQL
to compute expected answers. `generated.js` adds repeatable combinations of
known facts with AND, OR, and NOT, including nested negation.

The correctness run reads every result page and measures precision, recall,
duplicates, exact counts, and exact tag, creator, and library facets. It checks
terms, phrases, prefix matching, field restrictions, Boolean combinations, all,
any and excluded tags, creators, last editors, dates, library and project scope,
explicit document subsets, empty subsets, Unicode normalization, CJK text, and
punctuation. Dates include records exactly on each boundary.

Every returned snippet must be copied from the authorized document's named raw
field. Its highlights must identify positive query evidence and its body line
must locate the first highlight in that source. `evidence.js` uses literal
witnesses from the corpus recipe, including enumerated punctuation, whitespace,
prefix, and Unicode variants. It does not use the production tokenizer. Oracle
mutation tests reject missing evidence, unrelated source words, altered source
text, wrong fields, wrong lines, invalid terms, and negated evidence. The report
counts checked document appearances, snippets, and highlights. A document found
only through negation can correctly have no highlighted evidence.

Security checks compare the entire visible result after adding inaccessible
documents that repeat a matching word. Counts, facets, order, scores, snippets,
and continuation position must remain unchanged. Other checks revoke document
access between pages and while a revision decrypts; remove library membership;
fail atomically during a key outage; rebuild a legacy encrypted library without
decrypting inaccessible documents; and update, delete, and restore current
content. An 80-character prefix also checks a 45 KB token. Every column of every derived
`cloud_search_*` table is scanned for three plaintext canaries. This scan is
scoped to the derived index. Existing idempotency responses outside those tables
contain plaintext document metadata and are a separate storage concern.

`http-run.js` starts the existing isolated onboarding fixture with real cookies
and a real HTTP server. It checks result disclosure and signed cursor tampering,
including replay with a different query, expression, tag selection, excluded
tags, creator selection, document subset, field scope, sort, or principal. A
revoked document must disappear when an already-issued cursor is reused.

The benchmark measures first-page latency and verifies exact totals, facets and
returned-document precision against the manifest for every repetition. It does
not claim full pagination recall when `--benchmark-only` is used. The report
labels this distinction. For at least 10,000 documents, it separately checks first,
early, middle, and final keyset boundaries against manifest timestamps and IDs,
including an ID tie-break inside a shared timestamp. A new child Node process measures startup and the first
query against the existing index. The operating system's disk cache is retained.
The key provider is local AES encryption; timings exclude network calls to a
managed KMS. Median, p95, maximum latency, and revision decryption counts are reported. No
arbitrary machine-dependent latency threshold is imposed.

The main correctness adapter submits explicit ASTs. This keeps expected result
truth independent from parsing, but it does not prove that every equivalent
human query string parses into that AST. HTTP scenarios exercise the query
endpoint and cursor binding; parser syntax also has its own unit tests.

The current corpus is about 540 bytes per Markdown document. The generated
100,000-document fixture therefore measures index cardinality, authorization,
posting intersections, facet aggregation and pagination, with about 54 MB of
plaintext content. It is not evidence for 100,000 multi-megabyte documents.

A retained benchmark fixture can be reopened after a backend change:

```sh
node scripts/search-eval/run.js --fixture /tmp/sdocs-search-eval-EXAMPLE --benchmark-only --repetitions 7 --output /tmp/search-100k-rerun.json
```

Reuse fixtures created with `--benchmark-only`. Full correctness runs deliberately
mutate permissions, content, and membership after the initial manifest snapshot.

For a focused query profile without seeding or generating the corpus manifest:

```sh
node --cpu-prof --cpu-prof-dir=/tmp scripts/search-eval/probe.js --fixture /tmp/sdocs-search-eval-EXAMPLE --kinds broad,rare,phrase --repetitions 1 --sql-profile --output /tmp/search-profile.json
```

This probe reports memory before opening the store and after each query. SQL
profiling groups execution and preparation time by statement. Omit
`--sql-profile` for final latency samples. All-visible fixture counts and author
and library facet totals are checked using independent arithmetic.
