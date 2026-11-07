# Cloud library pagination

The Cloud library displays up to 60 documents per page. Previous and Next use
the existing button and footer styles. The result count describes the whole
filtered library; the footer identifies the current page. Single-page results
do not need navigation controls. All visible tags still load when the library
opens, independently of document pages.

The browser stores one document page and the signed cursor used to reach each
visited page. Both directions reuse the same request fields, including frozen
relative date bounds. Previous fetches documents again through the search API
and its current permission checks. Returning to an earlier page discards later
cursor history so forward navigation uses the newly returned continuation.

Changing the search, filters or selected library starts at page one. Page
requests disable both buttons and expose a loading state. Failed requests keep
the current page and Retry fetches the intended page. A later page emptied by
deletions or access changes returns to the first page of the same search.
Starring a document refreshes its current page.

## Validation

- All 1,829 Node checks passed.
- All 44 Cloud library browser scenarios passed, including 15 pagination
  scenarios. Coverage includes 1, 60, 61, 120 and 121 documents, stable ordering
  at equal timestamps, combined search and every supported filter, both
  directions, permission revocation, retries, concurrent filter/library changes,
  star changes and an emptied final page.
- Keyboard and geometry checks passed at 320, 390 and 1440 pixels.
- A headless browser with the real service worker, a cached previous HTML shell
  and cached previous JavaScript loaded the new version after a normal reload.
  It displayed 60 documents then one document on the second page with no page
  errors.

The API and its authorization rules are unchanged. Local library behavior is
unchanged.
