# Browser API

## `render(target, markdown, options)`

```js
const view = await render('#report', markdown, {
  navigation: true,
  runnableHtml: false,
  sections: { collapsible: true, defaultOpen: true },
  controls: { copy: true, fullscreen: true, download: true },
});
```

`target` is a selector or an `Element`. Rendering replaces its children with an instance-scoped SmallDocs reading surface. The promise resolves after required rich features settle.

Reading and control options are enabled unless their value is exactly `false`. Runnable HTML is disabled unless `runnableHtml` is exactly `true`.

- `navigation` shows the in-document heading list.
- `runnableHtml` executes `sdoc-app` fences in sandboxed frames. When disabled, the fence stays readable source.
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

[Open the example gallery](/developers/examples) to compare all four configurations, or open the [standalone styled report](/developers/example/non-collapsible).

Options stay fixed for the lifetime of the returned view. `view.update(markdown)` replaces content only. Destroy the view and call `render()` again to change behavior options.

## Runnable HTML opt-in

Enable executable `sdoc-app` fences only for a renderer instance whose document source is allowed to run sandboxed browser code:

```js
const view = await render('#report', markdown, {
  runnableHtml: true,
});
```

The fence itself is not consent. Without this option, its complete HTML remains visible as source and the runnable module and frame are not loaded.

## Guided walkthrough metadata

A document can carry ordered source-line annotations in front matter:

```yaml
---
docwalk: true
annotations:
  - line: 3
    quote: "important phrase"
    text: "Start with this result."
  - line: 12
    endLine: 14
    text: "Compare the complete block."
---
```

Lines are one-based and relative to the Markdown body after front matter. `quote` is optional and narrows a prose or code step to matching text. Walkthrough steps mount after rich features settle, follow annotation order, and are removed on `view.update()` or `view.destroy()`. A walkthrough can target enabled runnable HTML. If `runnableHtml` is disabled, an annotation for that component has no executable target.

## Surrounding application menu

The SDK does not add a page-level top menu. The host application owns global navigation, account actions, route controls, and agent workflow actions. SmallDocs owns the document navigation, inline feature controls, and fullscreen surfaces inside that application.

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

An array of feature modules used by the current document, such as `math`, `mermaid`, `charts`, `cells`, `slides`, `apps`, or `walkthrough`.

## `smalldocs:rendered`

After a successful render or update, the article dispatches a bubbling event with its instance ID and current feature list:

```js
document.querySelector('#report').addEventListener('smalldocs:rendered', event => {
  console.log(event.detail.instanceId, event.detail.features);
});
```

Use this event when surrounding application layout or analytics needs to react to a completed document. Keep normal renderer lifecycle in `render()`, `update()`, and `destroy()`.

## Module exports

```js
import SmallDocs, { SmallDocs, render } from
  'https://smalldocs.org/sdk/0.3.0/smalldocs.js';
```

The named `render` function and `SmallDocs.render` are the same function.
