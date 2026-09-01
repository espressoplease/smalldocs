# Lifecycle

```js
import { render } from 'https://smalldocs.org/sdk/0.3.0/smalldocs.js';

let view;

export async function showReport(markdown) {
  if (view) return view.update(markdown);
  view = await render('#report', markdown);
}

export function removeReport() {
  view?.destroy();
  view = undefined;
}
```

## Update

`await view.update(markdown)` replaces the current document. It cleans up feature instances such as charts and closes fullscreen owned by that view before mounting the replacement.

## Destroy

`view.destroy()` removes the document and releases instance listeners. Call it when the route or component unmounts.

## Multiple documents

Call `render()` once for each mount element. Heading IDs, features, updates, and fullscreen ownership stay separate between instances.
