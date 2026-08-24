# Security and data flow

The SDK treats agent-authored Markdown as untrusted input.

## Browser boundary

The SDK creates a sandboxed iframe from `https://smalldocs.org`, then sends the Markdown to that frame with `postMessage`. SmallDocs sanitises the resulting document HTML before display.

The frame accepts messages only from the declared host origin and a random per-instance channel. Host styles do not enter the document, and renderer styles do not change the host page.

## Network boundary

The current renderer does not upload the Markdown through an API request. JavaScript served by SmallDocs executes inside the frame and can access the displayed document in the browser. Treat the SmallDocs origin as third-party executable code and pin the versioned module URL.

A self-hosted renderer is not currently offered.

## Content Security Policy

Merge the following sources into the host application's existing policy:

```text
script-src https://smalldocs.org
frame-src https://smalldocs.org
```

Do not replace the application's full policy with this fragment.

## Host responsibilities

- Do not insert the Markdown into the host DOM.
- Do not weaken the iframe sandbox added by the SDK.
- Keep the original Markdown available for a readable failure path.
- Test unsafe tags, event attributes, and `javascript:` links in the customer application.
