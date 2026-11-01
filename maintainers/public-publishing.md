# Public publishing

2 November 2026. Cloud staging candidate; no production deployment.

## File info

The Share row stays visible. Create private link adds a Private URL row. Publish publicly adds a Public URL row. Both use the existing file-info copy control on the right. On narrow screens, Share actions wrap within their row.

The public action becomes Update public page when the current public body, title, description or styles differ. Updates keep the same URL. Private comments, tags, paths and reader theme changes do not require publishing. Publication state comes from the server and survives a reload. Existing encrypted links remain independent fixed copies.

Browser and CLI private copies omit front-matter library tags before encryption. Source Cloud documents and local files retain their tags. Older encrypted copies also omit tags in the shared reader; their stored ciphertext is unchanged.

Manage public page opens the existing right-hand Cloud panel. It shows the full URL, publication time and Unpublish. Creators can withdraw or inspect their publication after free or paid access ends. A subscription is required only for creating or updating the public copy, subject to the existing trial and grace policy.

## Data and permission boundary

One cloud_publications row belongs to each source document. The publication stores independent, rendered public HTML and a public-content fingerprint, with a stable title slug and random public identifier. That copy can outlive source revision pruning. The public HTML is intentionally public data; private Cloud documents retain their encrypted storage and existing membership checks.

Publishing checks creator ownership, current Terms, membership, entitlements and the exact saved revision before and after asynchronous work. A publication generation and withdrawal record prevent an in-flight request from restoring withdrawn content. Retries do not overwrite subsequent updates or resurrect an unpublished page.

Public reads use only the stored public HTML and synchronous source-lifecycle checks, with no private document decryption. Document, project and library deletion withdraw associated publications. Restoring private content does not republish it. An unpublish clears the public body and returns an actual unavailable status on the public URL.

## Rendering and discovery

The public route serves readable article HTML in its initial response, with document-specific title, description, canonical URL and Open Graph metadata. Prose, headings, tables and code work without JavaScript. A public-only Markdown payload lets the pinned SmallDocs 0.3.1 reader render the same canonical slides, code, cells, math, charts, diagrams and video components used by the application. Runnable HTML remains source. The initial HTML stays available if JavaScript cannot load. Raw HTML is escaped in the initial response and sanitised by the shared reader.

Existing HTML-only snapshots recover rich fence source from their already published code blocks and use the same reader. This does not decrypt a Cloud document, fetch a newer draft or change the selected publication revision. New source payloads retain complete rich fence information, including workbook names. Both formats reuse the published, validated document style rules before rich components measure typography and geometry. Publication metadata appears after the document, and the reader does not invent an Untitled document heading.

Publications are discoverable through publications-sitemap.xml and robots.txt. Local and staging deployments send noindex headers. Production indexing remains subject to search-engine discovery and selection. Public content is served without authenticated viewer-specific navigation or private hydration data. Public responses use no-store to make withdrawal effective on subsequent requests; already downloaded or indexed copies cannot be recalled.

## API and CLI

- GET /api/cloud/v1/documents/DOCUMENT_ID/publication reports publication state, source head and management rights.
- POST to the same endpoint publishes an exact expected_revision_id with an idempotency_key.
- DELETE withdraws publication.
- GET /p/SLUG serves the current public copy anonymously.
- sdoc cloud publication DOCUMENT_ID --json inspects state.
- sdoc cloud publish DOCUMENT_ID --json publishes or updates saved Cloud content.
- sdoc cloud unpublish DOCUMENT_ID --json withdraws it.

Help sections live at /docs#sec=short-links and /docs#sec=public-pages. Cloud skill v47 documents explicit publication separately from normal private Cloud saves. Install the new CLI/skill when the matching backend is deployed; an older staging backend does not expose the publication API.

## Local interaction review

Run node scripts/publication-preview.js with the repository dependencies available. It starts a loopback-only gateway on localhost:3110 and prints the document URL. SDOCS_PUBLICATION_PORT selects another gateway port. It uses the real backend with disposable fictional accounts and no production UI banners. Stopping the process removes its temporary databases.

Automated coverage lives in test/test-cloud-publications.js, test/test-publication-render.js, test/cloud-publications.spec.js and the CLI management suite. Coverage includes public/private isolation, lost responses, stable URL updates, permissions, lapsed access, unsafe content, deletion/restore, revision retention, metadata exclusion and browser copy geometry.

## First-version verification

The complete Node suite passed with 2,245 assertions on 2 November 2026. Browser coverage spans publication, private-link, code-sharing and document-action suites, including desktop and mobile layouts. The publication scenarios exercise delayed uploads, lost responses, unsaved edits and blocked Cloud saves. Private-link coverage checks browser and CLI payloads, unchanged source tags and older encrypted copies. Anonymous rich-content checks compare slide text, geometry and colours against the application at desktop and mobile widths, exercise fullscreen, and verify cells, math, charts, diagrams and published styles. Legacy snapshot coverage verifies a newer private draft stays private. JavaScript syntax and whitespace checks pass.

Release checks include deployed-host configuration and matching CLI installation before production rollout. Local and staging publication URLs deliberately remain noindex.
