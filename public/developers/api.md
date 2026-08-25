# Browser API

## `render(target, markdown, options)`

```js
const view = await render('#report', markdown, {
  navigation: true,
  sections: { collapsible: true, defaultOpen: true },
  controls: { copy: true, fullscreen: true, download: true },
});
```

`target` is a selector or an `Element`. Rendering replaces its children with an instance-scoped SmallDocs reading surface. The promise resolves after required rich features settle.

Every option is enabled unless its value is exactly `false`.

## `view.update(markdown)`

Replace the content in the same instance. A newer update rejects an older unfinished update with an `AbortError`.

## `view.destroy()`

Remove the view, release feature instances, and close any fullscreen surface it owns. Destroy is idempotent.

## `view.element`

The rendered `.smalldocs-document` article. Use it for layout, observation, or scoped CSS.

## `view.features`

An array of feature modules used by the current document, such as `math`, `mermaid`, `charts`, `cells`, or `slides`.

## `smalldocs:rendered`

After a successful render or update, the article dispatches a bubbling event with its instance ID and current feature list:

```js
document.querySelector('#report').addEventListener('smalldocs:rendered', event => {
  console.log(event.detail.instanceId, event.detail.features);
});
```

## Module exports

```js
import SmallDocs, { SmallDocs, render } from
  'https://smalldocs.org/sdk/0.2.0/smalldocs.js';
```

The named `render` function and `SmallDocs.render` are the same function.
