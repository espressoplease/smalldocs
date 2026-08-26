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

- `navigation` shows the in-document heading list.
- `sections.collapsible` adds expand and collapse behavior to H1 through H4.
- `sections.defaultOpen` controls the first state of collapsible H2 through H4 sections.
- `controls.copy` shows copy actions for headings, code, tables, blockquotes, diagrams, charts, cells, and slides where available.
- `controls.fullscreen` shows fullscreen actions where the content supports them.
- `controls.download` shows supported file downloads.

Open and closed sections with matching heading IDs keep their state when `view.update()` renders a revised version of the document.

`sections.defaultOpen` has no effect when sections are not collapsible. Copy and link controls remain available on always-open headings when `controls.copy` is enabled.

## Common configurations

An always-open report keeps the full argument visible while retaining the SDK navigation:

```js
const view = await render('#report', markdown, {
  navigation: true,
  sections: { collapsible: false },
});
```

A compact answer can rely on the application's navigation:

```js
const view = await render('#answer', markdown, {
  navigation: false,
  sections: { collapsible: false },
});
```

A long reference can begin with its sections closed:

```js
const view = await render('#reference', markdown, {
  navigation: true,
  sections: { collapsible: true, defaultOpen: false },
});
```

[Open the styled always-open example](/developers/example/non-collapsible).

Options stay fixed for the lifetime of the returned view. `view.update(markdown)` replaces content only. Destroy the view and call `render()` again to change behavior options.

## Typography and document styling

Set custom properties on the mount element. They apply only to that renderer instance.

```css
#report {
  --sdocs-font-family: Georgia, serif;
  --sdocs-font-size: 17px;
  --sdocs-line-height: 1.8;
  --sdocs-heading-font-family: Inter, sans-serif;
  --sdocs-heading-scale: 1.05;
  --sdocs-paragraph-spacing: 1.2em;
  --sdocs-list-spacing: 0.4em;
  --sdocs-list-indent: 1.8em;
  --sdocs-link-decoration: underline;
}
```

Heading sizes and weights can be changed individually with `--sdocs-h1-size` through `--sdocs-h4-size` and `--sdocs-h1-weight` through `--sdocs-h4-weight`.

The other document properties are `--sdocs-accent`, `--sdocs-background`, `--sdocs-text-color`, `--sdocs-border-color`, `--sdocs-code-background`, `--sdocs-max-width`, `--sdocs-radius`, and `--sdocs-padding`.

Normal application CSS scoped under the mount can override a specific SmallDocs selector when a custom property is not enough:

```css
#report .smalldocs-document h1 {
  letter-spacing: -0.04em;
}
```

Custom properties can also reuse existing application tokens:

```css
#report {
  --sdocs-font-family: var(--app-reading-font);
  --sdocs-text-color: var(--app-text);
  --sdocs-accent: var(--app-accent);
  --sdocs-background: var(--app-surface);
}
```

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
