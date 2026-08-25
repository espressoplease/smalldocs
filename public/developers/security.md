# Security

The SDK renders into the host DOM. It does not place the whole document in an iframe.

## Markdown and HTML

SmallDocs parses Markdown, sanitises the resulting HTML, then mounts the cleaned DOM. Script tags, event handlers, embedded frames, unsafe URLs, and similar executable markup are removed.

Mermaid diagrams use a hidden renderer frame while the diagram is being built. SmallDocs removes that frame before `render()` settles, sanitises the resulting SVG, and mounts the SVG in the host DOM. The document itself is never placed in the frame.

Raw HTML is treated as document content, not trusted application code. An `html` fence remains a code listing.

## SDK code

JavaScript loaded from `smalldocs.org` runs with the privileges of the host page, as it does for other third-party browser SDKs. Pin the versioned URL and include SmallDocs in the application's dependency review.

## Future executable blocks

Executable `sdoc-app` blocks are not enabled in `0.2.0`. The planned contract keeps ordinary documents in the host DOM while isolating only an explicitly executable block. The customer will choose whether executable content is disabled, sandboxed, or trusted.

## Content Security Policy

The current experimental build loads rich dependencies from jsDelivr. Merge these origins into the application's existing policy when the corresponding directives are present:

```text
script-src https://smalldocs.org https://cdn.jsdelivr.net
style-src https://smalldocs.org https://cdn.jsdelivr.net 'unsafe-inline'
font-src https://cdn.jsdelivr.net
frame-src https://smalldocs.org https://www.youtube-nocookie.com
```

The SmallDocs origin in `frame-src` is needed for Mermaid rendering. The YouTube origin is needed only for supported video fences. Remote images require the image host in the application's `img-src` directive. Some rich-feature and export dependencies run in the page and create globals such as `hljs`, `PDFLib`, and `PptxGenJS`.

For an application that enforces Trusted Types, allow the SDK policy name:

```text
trusted-types smalldocs-sdk-0.2.0 dompurify
require-trusted-types-for 'script'
```

The SDK owns a version-private Markdown parser and sanitizer. It does not use a host page's `window.marked` or `window.DOMPurify` as its security boundary.

## Host responsibility

- Keep the original Markdown available for fallback.
- Treat links and external media references as document-provided destinations.
- Test unsafe Markdown payloads in the customer application.
- Do not enable agent-authored JavaScript outside a separate executable-content policy.
