# Browser API

## `render(target, markdown)`

Mount a SmallDocs document and return its view.

```js
const view = await render('#report', markdown);
```

`target` is a CSS selector or an `Element`. `markdown` is converted to a string. Rendering replaces the target's existing children.

The returned promise rejects if the target does not exist, the host page is not HTTP or HTTPS, or the renderer cannot load.

## `view.update(markdown)`

Replace the content in the same renderer instance.

```js
await view.update(nextMarkdown);
```

The promise resolves after the replacement document is mounted. A newer update rejects an older unfinished update with an `AbortError`.

## `view.destroy()`

Remove the frame and the host-side listener.

```js
view.destroy();
```

Destroy is idempotent. Update is unavailable after destruction.

## `view.element`

The renderer iframe. Use this only for host layout or observation. Do not mutate the document inside the frame.

## Module exports

```js
import SmallDocs, { SmallDocs, render } from
  'https://smalldocs.org/sdk/0.1.0/smalldocs.js';
```

The named `render` function and `SmallDocs.render` are the same function.
