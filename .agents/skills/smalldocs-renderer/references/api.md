# SmallDocs renderer API

## Current browser module

```js
import { render } from 'https://smalldocs.org/sdk/0.1.0/smalldocs.js';

const view = await render('#report', markdown);
```

The host page must use HTTP or HTTPS. `target` can be a CSS selector or an `Element`. Rendering replaces the target's existing children with one isolated SmallDocs frame.

## Returned view

```js
await view.update(nextMarkdown);
view.destroy();
```

- `view.element` is the renderer iframe.
- `update(markdown)` replaces the document in the same view.
- `destroy()` removes the frame and releases the host-side message listener.
- A newer update rejects an older unfinished update with an `AbortError`.
- `render()` and `update()` resolve after the document is mounted. Rich processors that load external browser dependencies can finish and resize afterward.

Keep the view in the host framework's component or route lifecycle. Destroy it on unmount. Do not call `render()` again for ordinary content changes.

## Content contract

Send one Markdown string after inference or analysis has completed. No envelope or capability declaration is required.

The experimental renderer uses the current SmallDocs read surface, including ordinary Markdown, heading navigation, code blocks, math, Mermaid diagrams, charts, cells, slides, and supported video fences. Feature discovery and dependency loading happen inside SmallDocs based on the document content. Unknown fences remain readable source.

Comments, writing tools, export controls, SmallDocs Cloud, and the surrounding reader application are outside this contract.

## Security and data flow

The SDK creates a sandboxed iframe from `https://smalldocs.org` and sends the Markdown to it with `postMessage`. The renderer sanitises document HTML before display. The current integration does not upload the Markdown through an API request, but JavaScript served by SmallDocs executes inside the frame and can access the document in the browser. A self-hosted renderer is not currently offered.

The frame accepts messages only from the declared host origin and a random per-instance channel. The host should still treat the SDK origin as third-party executable code and pin the versioned module URL.

If the host has a Content Security Policy, allow at least:

```text
script-src https://smalldocs.org
frame-src https://smalldocs.org
```

Merge these sources into the existing policy rather than replacing it.

## Loading and caching

The versioned module is served with immutable one-year browser caching. Browsers normally reuse it across routes and later page visits. Each document frame loads the SmallDocs reader shell; normal HTTP caching reuses its static assets. Rich browser dependencies are requested by the reader only when corresponding document content is present.

## Framework-neutral lifecycle

```js
let view;

export async function showReport(markdown) {
  if (view) {
    await view.update(markdown);
    return;
  }
  view = await render('#report', markdown);
}

export function removeReport() {
  view?.destroy();
  view = undefined;
}
```

Handle rejected promises using the host application's normal error surface. Keep the original Markdown available so a rendering failure does not make the agent output inaccessible.
