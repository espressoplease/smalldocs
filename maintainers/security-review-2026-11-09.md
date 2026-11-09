# Defensive review, 9 November 2026

Three reviewers inspected authentication/access, rendering, and billing/platform
behavior. Findings were reproduced in disposable local fixtures. Compatibility
checks use synthetic accounts and documents; production reads are limited to
configuration, health and an isolated backup rehearsal. No live adversarial
traffic, real payment or customer notification was used.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A malformed request target could terminate the Node HTTP server. | Return a non-cacheable 400 before route handling. Verified through a local Nginx proxy and a child-process regression. |
| P1 | A CLI access token could approve a separate persistent CLI installation. | Device approval requires the existing browser session and browser-origin checks. Normal browser approval remains supported. |
| P1 | Permitted document content could cause excessive synchronous compression and search-index expansion. | Compress asynchronously, yield during index preparation, and use an exact compact-search representation when inverted features would be expensive. The existing document limit and query language are unchanged. |
| P2 | Reusing an older refresh token stopped being detected after further rotations. | Retain consumed token hashes and revoke the installation's token family on replay. Preserve the latest request-ID retry after a lost response. |
| P2 | Accepting an invitation could replace an existing active owner's or administrator's role, or reduce an editor grant. | Preserve existing active roles and stronger project grants. Disabled members still rejoin with the invitation's role. |
| P2 | Unordered subscription webhooks could restore stale subscription state, including same-second events. | After signature verification, retrieve current Stripe state and serialize retrieval plus application per subscription. Provider read failures return a retryable response. Event-ID deduplication remains transactional. |
| P2 | Markdown CSS could alter the surrounding application interface. | The approved shared sanitizer removes document style tags and inline style attributes. Supported front-matter styles, scoped components and renderer-generated slide styling remain available. |
| P2 | Mermaid used an older vulnerable compatible release and did not apply the same SVG policy to root attributes. | Upgrade 10.9.1 to 10.9.8, update the compiler allowlist, and sanitize root and descendant SVG attributes consistently. |
| P2 | CLI pulls used predictable temporary filenames and could broaden destination permissions. | Exclusively create random private temporary files, preserve an existing file's mode, sync before rename, and clean up after failure. Released in CLI 1.20.1. |

Production already sets `TRUST_PROXY=1` behind its loopback Nginx proxy. The
production environment example now matches that deployment.

## Compatibility work

- Asynchronous preparation exposed retry starvation in simultaneous edits.
  Existing-document mutations now queue per document within the application
  process. Other documents remain independent. Transactional head checks,
  permission checks and cross-connection merge retries remain authoritative.
- Search preserves terms, phrases, prefixes, literals, Boolean queries, field
  weights, facets, snippets and cursor order across indexed and compact records.
  Access, revision and key-version checks run after asynchronous work and before
  returning documents, counts or facets.
- Replacing a search head collects its unreferenced dictionary entries. Prepared
  writes resolve IDs again inside the final transaction, so another connection's
  collection cannot redirect or invalidate them. A reverse feature index keeps
  that collection from scanning the global feature table for every term.
- Existing inverted indexes retain format 3. Compact heads use format 4, which
  older readers recognize as needing a rebuild. Existing documents stay readable.
  Prefer rolling forward: reverting also restores the older expensive rebuild.
- Startup migrations are additive. Existing logins remain valid. Migration can
  retain the previously stored consumed refresh hash, but cannot reconstruct
  historical hashes discarded by earlier versions.
- Concurrent provider-state reconciliation is process-local, matching the current
  single application process. Multiple writable application replicas would need
  shared coordination.

## Resource measurements

An isolated 4,194,342-byte save completed in 4,576 ms while concurrent health
requests had a maximum measured delay of 32 ms. An exact text query took 298 ms,
with a maximum concurrent health delay of 135 ms. The compact fixture produced
zero feature rows; its database was 3,514,368 bytes and its WAL 4,288,952 bytes.
These are individual local diagnostic runs, not production latency guarantees.

Three ordinary multi-page prose/code examples retained inverted indexes. Tests
also cover mixed representations, repeated edits, permission changes during
scans, dictionary collection during preparation, old schemas and old writers.

## Limits and follow-up

- Storage allowances still count revision payloads rather than total physical
  SQLite/index bytes. This change bounds expensive per-document representations;
  it does not redefine billing storage or perform a global historical dictionary
  sweep. Monitor actual disk use before increasing library scale.
- Compact text searches decrypt and scan the authorized compact documents.
  Cooperative yielding improves responsiveness; it does not remove total CPU,
  memory or I/O cost. This is not a 100,000-document capacity certification.
- Production npm dependencies reported zero known advisories at the review date.
  CDN dependencies require separate review. KaTeX's reviewed newer advisories
  required trusted HTML options or a separate prototype-pollution path not found
  in this application; its version was unchanged. This does not guarantee the
  absence of undiscovered vulnerabilities.
- The tracked-file and history secret-pattern checks were limited pattern scans,
  not a complete credential audit.
- Tests cover existing product contracts and the identified regressions. This
  review is not an independent penetration-test certification.

Final test, migration and deployment evidence is recorded in
`qa/release/2026-11-09-security.json`.

## References

- [OAuth device authorization, RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html#section-3.3)
- [Refresh-token protection, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)
- [Stripe webhook ordering](https://docs.stripe.com/webhooks#event-ordering)
- [Mermaid security advisories](https://github.com/mermaid-js/mermaid/security/advisories)
- [KaTeX trusted HTML advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-cg87-wmx4-v546)
- [KaTeX prototype-pollution advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)
