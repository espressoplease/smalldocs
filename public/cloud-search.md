---
title: Search your Cloud library
file: cloud-search.md
---

# Search your Cloud library

Use `sdoc cloud search` to find Cloud documents by their text, tags, creator, revision writer, dates, or a selected set of document IDs. Results include evidence snippets and the document's Cloud URL. Search covers documents you can currently access across your libraries; `--account LIBRARY_UUID` narrows the scope.

```sh
sdoc cloud status --json
sdoc cloud search incident response --facets --compact --json
sdoc cloud read DOCUMENT_ID --json
```

Read `documents[].matches` to choose a result, then use `sdoc cloud read DOCUMENT_ID --json` for the complete Markdown and its Cloud URL. This command writes to stdout without creating a local file or binding. For read-only research, use discovery and read commands; keep document content, tags, and permissions unchanged. If a local reference file is useful, use `sdoc cloud pull DOCUMENT_UUID --output /tmp/reference.md --no-bind --json`. Use a normal pull when you intend to edit and push that document.

Run `sdoc cloud search --help` for the command reference. It works without signing in.

## Words, phrases, and Boolean expressions

| Query | Meaning |
| --- | --- |
| `incident response` | Both words, anywhere in the searched fields |
| `"incident response"` | Adjacent normalized words in one field, ignoring punctuation and line breaks |
| `incident OR outage` | Either word |
| `incident AND NOT exercise` | Incident, excluding documents that match exercise |
| `(incident OR outage) response` | Either first word, together with response |
| `migrat*` | Words beginning with migrat |
| `title:rollout` | Rollout in the document title |
| `body:"incident response"` | The phrase in the Markdown body |
| `tag:engineering` | The exact engineering tag |
| `author:me` | Documents created by the signed-in person |

Search is case-insensitive. Plain terms match words, and a trailing `*` matches word prefixes. `AND`, `OR`, and `NOT` are uppercase operators. Lowercase `and`, `or`, and `not` are ordinary words. `NOT` binds first, then `AND`, then `OR`. Adjacent clauses imply `AND`. Use parentheses to make grouping explicit.

Shell quotes keep command arguments together. They do not become phrase quotes. Preserve inner double quotes when you want a phrase:

```sh
# Both words, including when they appear in different fields or paragraphs.
sdoc cloud search 'incident response' --json

# The phrase with the two words together.
sdoc cloud search '"incident response"' --json

# Alternatives and exclusions.
sdoc cloud search '(incident OR outage) AND NOT exercise' --json

# A title match or a body prefix.
sdoc cloud search 'title:rollout OR body:migrat*' --json
```

Inside a double-quoted phrase, use `\"` for a literal double quote and `\\` for a backslash. Use `--literal` to find the complete supplied text as a case-insensitive substring, including punctuation, asterisks, and operator words:

```sh
sdoc cloud search 'AND NOT' --literal --json
sdoc cloud search 'C++' --literal --json
```

Text search does not infer synonyms. Supply alternatives with `OR`. `NOT` excludes documents containing a matching word or expression. It cannot distinguish endorsement from criticism, negation, or discussion of an idea. When a task asks whether a document supports a conclusion, use search to find candidates and read the sources to judge their meaning.

Add `--word-forms` to expand English singular/plural forms of ordinary unquoted terms. For example, a search for `policy` can also find `policies`. This is an opt-in lexical expansion; it does not infer related concepts or change phrase and literal matching.

```sh
sdoc cloud search 'policy OR guideline' --word-forms --compact --json
```

Search covers current document content; use `sdoc cloud history` and `sdoc cloud pull --revision` to inspect older revisions.

## Filters

Every filter group combines with the text query using `AND`. Within a group, the rules below apply. Text is optional, so filters can also browse the library.

| Option | Meaning when repeated |
| --- | --- |
| `--tag TAG` | Every listed exact tag is required |
| `--any-tag TAG` | At least one listed exact tag is required |
| `--exclude-tag TAG` | Documents with any listed tag are excluded |
| `--author USER_ID` | Any listed document creator |
| `--updated-by USER_ID` | Any listed writer of the current revision |
| `--document DOCUMENT_UUID` | Any listed document ID |
| `--field title` | Any listed text field, limited to title, filename, tags, or body |

`--author me`, `--updated-by me`, and `--mine` resolve against the signed-in CLI user. `--mine` means `--author me`. `--shared-with-me` returns accessible documents created by somebody else. A current revision writer can differ from the document's creator.

```sh
# Planning documents carrying either rollout or migration, excluding archived.
sdoc cloud search --tag planning --any-tag rollout --any-tag migration --exclude-tag archived --json

# One creator's documents, searched in titles and body text.
sdoc cloud search 'deadline' --author USER_ID --field title --field body --json

# A current revision written by somebody else, on a document you created.
sdoc cloud search --author me --updated-by USER_ID --json

# Relevant shared documents in a known library.
sdoc cloud search 'security' --shared-with-me --account LIBRARY_UUID --json
```

Resolve a named person to a user ID with `sdoc cloud members --account LIBRARY_UUID --json`. When several people fit the name, identify the intended person before applying the filter. Use `sdoc cloud libraries --json` to find library IDs. The search scope does not change the computer's default destination for saving documents.

Field prefixes apply to their own terms; `--field` limits unqualified text. `tags:` searches tag text, while `tag:` matches an exact tag. Use a tag filter or `tag:` when tag identity matters.

## Stars

Stars belong to you and persist across the browser and CLI. They do not change document permissions. Search results include `starred`, and `--starred` restricts search or listing to your starred documents across the requested libraries. Documents you can no longer access are excluded.

```sh
sdoc cloud star DOCUMENT_UUID --json
sdoc cloud search 'release' --starred --json
sdoc cloud ls --starred --account LIBRARY_UUID --json
sdoc cloud unstar DOCUMENT_UUID --json
```

The API uses `PUT /api/cloud/v1/documents/DOCUMENT_UUID/star` with `{"starred":true}` or `{"starred":false}`. Repeating a request sets the same state. The authenticated user determines whose star changes. Use `starred_only: true` in a search JSON request for the same filter.

## Dates and ordering

Use `--created-after`, `--created-before`, `--updated-after`, and `--updated-before` with an ISO date or a date-time that includes its time zone. Bounds are inclusive. A date-only lower bound starts at midnight UTC; a date-only upper bound ends at 23:59:59.999 UTC.

```sh
# Updated at any time in September, using UTC dates.
sdoc cloud search --updated-after 2026-09-01 --updated-before 2026-09-30 --json

# An exact time interval.
sdoc cloud search 'deployment' --created-after 2026-09-01T09:00:00Z --created-before 2026-09-01T17:00:00Z --json
```

`--sort relevance` ranks text results. Use `--sort updated_desc` for the most recently changed documents or `--sort created_desc` for the newest documents. Word and phrase queries default to `relevance`; literal and metadata-only searches default to `updated_desc`. `sdoc cloud ls` accepts the same filters and defaults to `updated_desc`.

## Search a selected set of documents

Repeat `--document` to search within an existing result set:

```sh
sdoc cloud search 'deadline' --document UUID_A --document UUID_B --json
```

For a larger subset, save one UUID per line in a file and pass `--documents-file PATH`. Blank lines are ignored. File IDs and repeated `--document` values combine into one subset.

A request can contain up to 100,000 document IDs. The JSON request body can be up to 8 MiB. Split larger requests into subsets and retain the returned document IDs when combining results.

```sh
sdoc cloud search 'deadline OR milestone' --documents-file selected-documents.txt --json
```

## Evidence, facets, and pages

With `--json`, the CLI writes one object to stdout. Check `ok` and the command's exit status before using the results.

```json
{
  "ok": true,
  "command": "cloud.search",
  "total_count": 14,
  "has_more": true,
  "next_cursor": "OPAQUE_CURSOR",
  "facets": {
    "tags": [{"tag": "engineering", "document_count": 8}],
    "authors": [{"user_id": "USER_ID", "name": "Alex Example", "document_count": 5}],
    "libraries": [{"id": "LIBRARY_UUID", "name": "Engineering", "document_count": 11}]
  },
  "documents": [
    {
      "id": "DOCUMENT_UUID",
      "url": "https://smalldocs.org/docs?cloud-document=DOCUMENT_UUID",
      "title": "Incident response",
      "filename": "incident-response.md",
      "workspace_id": "LIBRARY_UUID",
      "library": {"id": "LIBRARY_UUID", "name": "Engineering"},
      "author": {"user_id": "USER_ID", "name": "Alex Example"},
      "tags": ["engineering", "operations"],
      "matches": [{"field": "body", "line": 18, "snippet": "The incident response owner records the escalation."}]
    }
  ]
}
```

Documents also carry current revision metadata, `created_by_user_id`, `updated_by_user_id`, and a relevance `score`. Evidence names the matching field and contains a snippet; body matches include the source line. Search returns excerpts, so read the document before relying on surrounding context.

Request facets with bare `--facets` for tags, authors, and libraries, or `--facets tags,authors` for selected groups. `document_count` counts matching documents before pagination. `--facet-limit N` sets the maximum entries in each requested facet, default 50 and maximum 1000. `--match-limit N` sets evidence snippets per result, default 5 and maximum 100. Use `--match-limit 0` when IDs and metadata are sufficient and evidence snippets are not needed.

`facet_totals` reports the number of distinct matching values for each requested
facet. `facets_truncated` tells you whether the returned facet list stopped at
`--facet-limit`; facet lists are summaries, not an export of all matching
vocabulary. Document counts and facets apply to the complete authorized result
set, before document pagination.

`--limit N` sets the page size, default 50 and maximum 100. It does not mean that the page contains every match. When `has_more` is true, repeat the same query, filters, and sort with the returned `next_cursor`:

```sh
sdoc cloud search 'incident OR outage' --tag operations --limit 20 --json
sdoc cloud search 'incident OR outage' --tag operations --limit 20 --cursor NEXT_CURSOR --json
```

The default command fetches one page. Fetch an explicit number of pages with `--pages N`, or continue until exhaustion with `--all`. Add `--max-results N` to cap the number of returned documents. The CLI reduces the final page size to respect the cap and returns its continuation cursor; it does not discard part of a fetched page. `--all` and `--pages` are alternatives. `--max-results` alone keeps the one-page default.

```sh
sdoc cloud search 'incident OR outage' --limit 20 --pages 3 --compact --json
sdoc cloud search 'incident OR outage' --all --max-results 250 --compact --json
```

Aggregated output contains `pages_fetched`, `returned_count`, `started_from_cursor`, `complete`, and `stopped_reason`. `complete: true` means the traversal reached its last page; when `started_from_cursor` is true, that describes the remaining results from that cursor. `stopped_reason` is `complete`, `page_limit`, or `max_results`. A capped traversal has `complete: false`, `has_more: true`, and a usable `next_cursor`. A failure on a later page returns `ok: false` with a clearly marked `partial_result`; inspect the error and continuation before proceeding. Repeated document IDs are deduplicated across the live pages.

Use `--compact --json` for research runs that need shorter output. Each compact result keeps `id`, `url`, `title`, `tags`, `workspace_id`, `created_by_user_id`, `updated_by_user_id`, `current_revision_id`, `score`, and `matches` when present. Other document metadata is omitted. All top-level pagination, facet, totals, and completeness metadata is retained.

Continue until `has_more` is false when the task requires all results. A cursor belongs to the signed-in user, query, filters, and sort. Begin a fresh search if those change. Results use current permissions on each request; a cursor does not preserve access after it is removed.

Pages are a live view, not a frozen database snapshot. New edits can change the
order between requests. For a reproducible research record, save the query,
returned document IDs and `current_revision_id` values, then cite those sources.
Access is checked again on each page and read. Collected pages are the documents authorized when each page was fetched.

## Reproduce a request with JSON

`--query-file PATH` reads the HTTP search request shape. This is useful for large document subsets, saved research filters, and expressions assembled by an agent. CLI scalar options override file values. Repeated CLI filters add values. A positional query replaces the file's `query` or `expression`.

```json
{
  "expression": {
    "op": "and",
    "clauses": [
      {
        "op": "or",
        "clauses": [
          {"field": "text", "match": "term", "value": "incident"},
          {"field": "text", "match": "term", "value": "outage"}
        ]
      },
      {"op": "not", "clause": {"field": "tags", "match": "term", "value": "exercise"}}
    ]
  },
  "tags": ["operations"],
  "tags_any": ["planning", "engineering"],
  "tags_none": ["archived"],
  "author_user_ids": ["me"],
  "updated_after": "2026-01-01",
  "sort": "relevance",
  "facets": ["tags", "authors", "libraries"],
  "limit": 20
}
```

```sh
sdoc cloud search --query-file research-search.json --json
sdoc cloud search --query-file research-search.json --cursor NEXT_CURSOR --json
```

Expression nodes have these shapes:

| Node | Shape |
| --- | --- |
| All clauses | `{"op":"and","clauses":[...]}` |
| Any clause | `{"op":"or","clauses":[...]}` |
| Exclusion | `{"op":"not","clause":{...}}` |
| Text | `{"field":"text","match":"term","value":"incident"}` |
| Phrase | `{"field":"body","match":"phrase","value":"incident response"}` |
| Prefix | `{"field":"title","match":"prefix","value":"migrat"}` |
| Exact tag | `{"field":"tag","value":"engineering"}` |
| Creator | `{"field":"author","value":"USER_ID"}` |

Text fields are `text`, `title`, `filename`, `tags`, and `body`. `text` searches the fields selected by `fields`, or all four document fields when omitted. Use `query` for a literal substring request, or `query` with `mode: "query"` to parse the string as query syntax. Supply one of `query` or `expression`.

Supported request keys are `expression`, `query`, `mode`, `workspace_id`, `project_id`, `tags`, `tags_any`, `tags_none`, `author_user_ids`, `updated_by_user_ids`, `document_ids`, `shared_with_me`, `starred_only`, `fields`, `created_after`, `created_before`, `updated_after`, `updated_before`, `sort`, `limit`, `cursor`, `facets`, `facet_limit`, `match_limit`, and `word_forms`.

## Recover from an empty result or an error

| Result | Next action |
| --- | --- |
| `ok: true`, zero matches | Try a prefix, an `OR` alternative, or remove one narrow filter. Inspect existing tags or facets from a broader query. |
| `has_more: true` | Continue with `next_cursor` before claiming the results are complete. |
| `invalid_request` with a syntax position | Close the phrase or group, correct the operator, or use `--literal` for literal text. |
| Invalid cursor | Repeat the original query and filters, or start from its first page. |
| `search_limit_reached` or `rate_limited` | Wait for `retry_after_ms` or `Retry-After`, then retry. Narrowing text or metadata filters does not reset a request budget. |
| `login_required` | Run `sdoc cloud login`. |
| `resource_unavailable` | Check the library ID and current access. |
| `temporary_service_failure` | Retry after the service becomes available. |

Use `sdoc cloud tags --account LIBRARY_UUID --json` to inspect existing vocabulary. Search evidence, result counts, and facets include documents the signed-in person can currently read. Library membership by itself does not reveal another person's private documents. A missing result does not establish that a document does not exist. Changing a document's access is a separate action from searching or linking it.


## Matching details and result completeness

Rich queries compare normalized Unicode words. Words contain letters, numbers,
marks and underscores; punctuation separates them. Comparison uses Unicode NFKC,
lowercase, sharp-s and final-sigma folding. A quoted phrase requires adjacent
words in one field, so punctuation and line breaks between those words are
ignored. Use `--literal` when punctuation itself matters, for example `C++` or
an exact error string.

Literal substring searches use keyed character indexes to find candidates. A fragment within one indexed text run is verified against encrypted vocabulary; other queries verify candidate document text. Short or common substrings can still require reading many accessible documents. Narrowing the library, dates, creator, or document subset reduces the content that must be read.

An empty explicit `document_ids` array, including an empty `--documents-file`,
matches no documents. Omitting the subset searches the selected library scope.

`search_index_building` means the service is preparing older documents. Follow
`retry_after_ms` and repeat the same request. Agents do not need to manage the
index. A failed request does not mean there are no matching documents.
