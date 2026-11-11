# Published-page discovery and query audit

## Published directory

The homepage footer links to `/published`. The server renders 50 published pages per page, ordered by the original publication date descending, then slug descending. An update keeps the original publication date. Each page has its own canonical URL and ordinary Previous and Next anchors, so the directory can be traversed with JavaScript disabled. `?page=1` redirects to `/published`; invalid or empty subsequent pages return 404.

The directory projects title and description from `cloud_publications.public_source`, the sanitized published snapshot. It never reads a later private draft, Cloud tags, source paths, comments or private share links. Both directory and sitemap queries join the live document, project and workspace rows and exclude deleted parents. Withdrawal clears the snapshot and removes the entry. Existing staging/host checks still send `X-Robots-Tag: noindex, nofollow` outside production. Publishing makes a page eligible for discovery, not guaranteed to be indexed.

The catalogue query uses `cloud_publications_date(active,published_at_ms DESC,slug DESC)`. It fetches 51 rows to determine Next without a full count. Pagination uses offsets to provide ordinary stable page URLs; very deep pages do more index traversal, without loading every document into memory. The directory performs one content query plus one batched view-count lookup, independent of whether it displays one or fifty entries.

The sitemap root returns a URL set for up to 50,000 publications. Above that, it becomes a sitemap index linking to numbered files containing at most 50,000 URLs each. The existing publication update time remains the sitemap lastmod value; reading a page does not change it. This follows [Google's pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading) and [sitemap limits](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Page views

When analytics is enabled, an anonymous successful published-page GET atomically increments `analytics.db.publication_views`, keyed by the public slug. HEAD, missing and withdrawn pages do not increment it. The row stores a count and last-view time, without browser identifiers, IP addresses or account IDs. Counts include repeats and automated GETs and start at feature deployment; they are not unique-reader estimates or billing figures.

The returned count appears below the published reader and remains outside its hydration root. The directory looks up all visible counts in one prepared statement using `json_each`. Counters are independent of document revisions, publication fingerprints and sitemap dates. A counting failure does not prevent reading a page. Analytics backups include the table as part of the existing analytics database.

## Visit tracking and dashboard

The new homepage was missing the old homepage's visit recorder. It now reuses the Library recorder with `data-load-type="home"`, preserving cohort attribution, opt-out behavior and explicit homepage source labels. It sends one request per page load. Cloud and local Library scopes were already recorded as `cloud-library` and `library`; the dashboard now renders separate cohort tables. New accounts appears below the aggregate weekly visit table. Previously missed homepage visits cannot be reconstructed.

## Query sweep

| Surface | Previous repeated work | Change |
| --- | --- | --- |
| Private admin accounts | One email query per account | One batched identity query; three queries total for the first page, whether one or fifty accounts |
| Search authors and updater labels | Up to three account reads per distinct person | Two batched display-only queries for all authorized result/facet IDs |
| Library member emails | Full account lookup per member | Two display-only queries for the authorized member list |
| Document history actor names | Full account lookup per distinct actor | Two display-only queries for actors on the authorized history page |
| Referrals | Full account and reward count lookups per referral | Two display-only account queries and one grouped reward query for the current referrer's page |
| Library names and roles | Separate fresh row and membership checks per library after decryption | One fresh authorized relation after all decryptions, two reads total |
| Deleted libraries and projects | Individual fresh role/name checks after decryption | Fresh authorized relation after all decryptions, preserving name, deletion, grant and role checks |
| Published cache refresh at startup | Fetch each publication again to compare renderer versions | Filter outdated renderer versions in the initial query |
| Public directory counts | Potential per-page lookup | Batched lookup by all visible public slugs |

`getUserSummaries` is internal to the auth store. Callers pass IDs derived from an already authorized result; it is not a user-search endpoint and does not accept caller-selected IDs over HTTP. It returns display names and the first verified email in the same identity order as the full account reader. Provider subjects, credentials, sessions and Terms records are not included. HTTP handlers continue projecting only the fields each surface used before.

The sweep also inspected indexed search, tags, legacy document lists/exports, feedback, account provisioning, billing and referrals. Per-document permission and key-version checks around asynchronous decryption remain. These checks can scale with authorized results and are necessary for revocation and stale-read protection. Billing mutations and per-library entitlements remain scoped and checked. This is not a claim that every query can be collapsed into a fixed number or that all future performance bottlenecks are eliminated.

## Validation

- `node test/run.js`: 2,355 passing tests, including document/list revocation and cross-library isolation regressions.
- `test/test-publication-discovery.js`: real HTTP directory, private draft exclusion, atomic concurrent counts, persistence after restart, withdrawal/deletion, sitemap pagination and 100,001 synthetic published entries in isolated storage.
- Scale case: first and final directory pages used two queries total, approximately 100 ms locally, with less than 16 MB additional heap. This is a local fixture measurement, not a production latency promise.
- `test/test-query-batching.js` and product analytics tests assert fixed query budgets for accounts, library rechecks and referrals, preserving scoped results.
- `test/publication-discovery.spec.js`: actual homepage/Library beacons, separate cohort tables, directory navigation without JavaScript, published-reader hydration, 1440/390 px layouts and both themes.
- Existing publication and product-analytics browser suites cover the unchanged public/private access boundaries and document rendering.
