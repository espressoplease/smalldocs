# Security

The SDK renders into the host DOM. It does not place the whole document in an iframe.

## Markdown and HTML

SmallDocs parses Markdown, sanitises the resulting HTML, then mounts the cleaned DOM. Script tags, event handlers, embedded frames, unsafe URLs, and similar executable markup are removed from ordinary document content.

Mermaid diagrams use a hidden renderer frame while the diagram is being built. SmallDocs removes that frame before `render()` settles, sanitises the resulting SVG, and mounts the SVG in the host DOM. The document itself is never placed in the frame.

Raw HTML is treated as document content, not trusted application code. An `html` fence remains a code listing.

## SDK code

JavaScript loaded from `smalldocs.org` runs with the privileges of the host page, as it does for other third-party browser SDKs. Pin the versioned URL and include SmallDocs in the application's dependency review.

## Runnable HTML

A `sdoc-app` fence is the only executable document form. Its complete HTML document runs inside a separate sandboxed frame. Scripts, forms, modals, downloads, and popups are available. The frame does not receive same-origin access or top-level navigation, so its code cannot reach the SmallDocs or host application DOM, storage, cookies, or account controls.

The sandbox is a browser boundary, not a network boundary. Component code can request external resources and communicate with services that allow it through CORS. Those destinations receive the normal request metadata exposed by the browser.

## Content Security Policy

The current experimental build loads rich dependencies from jsDelivr. Merge these origins into the application's existing policy when the corresponding directives are present:

```text
script-src https://smalldocs.org https://cdn.jsdelivr.net
style-src https://smalldocs.org https://cdn.jsdelivr.net 'unsafe-inline'
font-src https://cdn.jsdelivr.net
frame-src https://smalldocs.org https://www.youtube-nocookie.com
```

The SmallDocs origin in `frame-src` is needed for Mermaid rendering and runnable HTML frames. The YouTube origin is needed only for supported video fences. Remote images require the image host in the application's `img-src` directive. Runnable HTML requests also need the relevant origin in the host policy. Some rich-feature and export dependencies run in the page and create globals such as `hljs`, `PDFLib`, and `PptxGenJS`.

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
- Keep agent-authored JavaScript inside `sdoc-app` frames.
