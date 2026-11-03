# Public publishing

2 November 2026. Cloud staging candidate; no production deployment.

## File info

Sharing is available through the Share icon immediately after Copy in the document toolbar. It opens the existing right panel, using the formatting panel's desktop width and mobile bottom sheet. Private link and Public page are independent expandable rows with the export panel's icon styling. Both start collapsed. Each expansion puts its primary action first, followed by URL controls and the explanation. Expansion state survives asynchronous status updates. The file-info table contains document metadata only.

The public action becomes Update public page when the current public body, title, description or styles differ. Updates keep the same URL. Private comments, tags, paths and reader theme changes do not require publishing. Publication state comes from the server and survives a reload. Existing encrypted links remain independent fixed copies.

Browser and CLI private copies omit front-matter library tags before encryption. Source Cloud documents and local files retain their tags. Older encrypted copies also omit tags in the shared reader; their stored ciphertext is unchanged.

The Share panel shows the full public URL, publication time and Unpublish. The toolbar reuses the comment notification dot: green means the public copy is current, orange means content has changed. Private links have no dot. Unknown or failed status checks do not show a green dot. Creators can withdraw or inspect their publication after free or paid access ends. A subscription is required only for creating or updating the public copy, subject to the existing trial and grace policy.

## Data and permission boundary

One cloud_publications row belongs to each source document. The publication stores independent rendered public HTML, its public Markdown source, renderer-owned style data and a public-content fingerprint, with a stable title slug and random public identifier. That copy can outlive source revision pruning. These are intentionally public data; private Cloud documents retain their encrypted storage and existing membership checks.

Publishing checks creator ownership, current Terms, membership, entitlements and the exact saved revision before and after asynchronous work. A publication generation and withdrawal record prevent an in-flight request from restoring withdrawn content. Retries do not overwrite subsequent updates or resurrect an unpublished page.

Public reads use only the stored public snapshot and synchronous source-lifecycle checks, with no private document decryption. Document, project and library deletion withdraw associated publications. Restoring private content does not republish it. An unpublish clears the public HTML, source and style data and returns an actual unavailable status on the public URL.

## Rendering and discovery

The public route uses public/index.html and the normal application modules, matching private share links. There is no separate public reader UI or renderer SDK integration. The sidebar, document actions, copy, section expansion, theme, rich components and edited-copy behavior come from the same code. Public source loading is registered through the existing source registry. Viewing and theme changes preserve the public URL. Editing creates a separate copy at /docs and cannot update the published original.

A publish-time Chromium compiler loads the same application in an empty browser context and captures only the document root. The initial HTTP response contains the readable result, document-specific title, description, canonical URL and Open Graph metadata. Slides flatten their shadow content into ordinary HTML text. Mermaid keeps accessible SVG labels. Charts include a rendered image and a data table. Sheets include their complete content when the interactive grid paints only part of the model, and all workbook tabs remain readable without JavaScript. Shape styles and math fonts use the existing renderer's styles. Video and runnable app frames load through the normal visitor renderer, rather than executing in the compiler. The saved initial HTML remains readable without JavaScript.

Existing snapshots recover rich fence source and document styles from their already public HTML. This does not decrypt a Cloud document, fetch a newer draft or change the selected publication revision. Startup rebuilds outdated compiled copies from the stored public source only. Rebuilds recheck withdrawal, generation and source lifecycle before storing a result. A failed compilation leaves the prior public copy available.

Publications are discoverable through publications-sitemap.xml and robots.txt. Local and staging deployments send noindex headers. Production indexing remains subject to search-engine discovery and selection. The document payload is identical for anonymous and authenticated visitors. Navigation may show the current visitor's own account controls, never the publisher's account. Public responses use no-store and Vary: Cookie; already downloaded or indexed copies cannot be recalled after withdrawal.

## Compiler operations

The application calls a Unix-socket worker using SDOCS_PUBLICATION_COMPILER_SOCKET. The worker runs as a separate system user without application secrets, account state or database access. It queues compilation jobs, creates an empty browser context per document and closes the browser after an idle interval. Browser requests allow only application static assets and the known font and rich-renderer dependencies. Cloud APIs, arbitrary publisher resources, redirects and frames are blocked during compilation. Chromium's sandbox remains enabled.

ops/install-publication-browser.sh installs the pinned browser independently of the application release. On Ubuntu, its executable-specific AppArmor profile permits the user namespaces needed by Chromium's sandbox. The staging deployment installs ops/systemd/smalldocs-staging-compiler.service, waits for its socket, then restarts the application. The main application's existing sandbox remains unchanged. Publishing requires the worker; viewing and unpublishing existing copies remain available if the worker is unavailable.

The production deployment preparation now includes its own compiler user, socket, service and browser wiring in ops/deploy-production.sh and ops/systemd/smalldocs-compiler.service. Production and staging workers stay separate. The units have been validated and failed-deployment rollback has been rehearsed in an isolated fixture. Production has not been deployed. See [the release checklist](production-release-checklist.md).

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

The complete Node suite passed with 2,246 assertions on 2 November 2026. Browser coverage spans publication, compiler isolation, private links, code sharing and document actions, including desktop and mobile layouts. The publication scenarios exercise delayed uploads, lost responses, unsaved edits, blocked Cloud saves, sign-in returns and withdrawal during recompilation. Anonymous rich-content checks compare slide text, geometry and colours against the application, exercise fullscreen and verify cells, math, charts, diagrams and published styles. Initial HTML is checked with JavaScript disabled. Legacy snapshot coverage verifies that a newer private draft stays private. JavaScript syntax and whitespace checks pass.

Release checks include deployed-host configuration and matching CLI installation before production rollout. Local and staging publication URLs deliberately remain noindex.
