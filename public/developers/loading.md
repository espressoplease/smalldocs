# Loading and caching

Applications can import the SDK on every route that renders a document. Normal browser caching prevents a repeated download.

## Versioned assets

`https://smalldocs.org/sdk/0.3.0/smalldocs.js` and its sibling modules and CSS use an immutable one-year cache policy. A new contract uses a new versioned URL.

## Content-driven loading

The core loads Markdown parsing, sanitisation, and base CSS. Rich modules are requested only when their content appears in the document.

A plain Markdown document does not request chart, Mermaid, spreadsheet, slide, math, or syntax-highlighting dependencies.

## Readiness

`render()` and `update()` resolve after detected rich features have rendered or produced a readable fallback. Failure to load a core SDK asset rejects the call. A superseded render rejects with an `AbortError`.
