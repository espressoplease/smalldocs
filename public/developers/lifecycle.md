# Lifecycle

`render()` creates one view. Keep that view for the lifetime of the surrounding route or component.

```js
import { render } from 'https://smalldocs.org/sdk/0.1.2/smalldocs.js';

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

## Update

`await view.update(nextMarkdown)` replaces the document in the existing frame. Do not import or initialise the SDK again for ordinary content changes.

If a newer update replaces an unfinished update, the older promise rejects with an `AbortError`.

## Destroy

`view.destroy()` removes the frame and releases the host-side message listener. Call it when the component unmounts or the route permanently removes the document.

Calling `destroy()` more than once has no additional effect. Calling `update()` after destruction rejects.

## Multiple documents

Call `render()` once for each independent mount element. Each renderer instance has its own random message channel and lifecycle.

## Fullscreen views

When a reader expands slides, a diagram, code, or computed cells, the renderer iframe temporarily covers the browser viewport and the host page stops scrolling. Closing the expanded view restores the iframe and the previous host scroll position. The SDK handles this without host event wiring.
