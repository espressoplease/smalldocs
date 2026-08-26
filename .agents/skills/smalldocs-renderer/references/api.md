# SmallDocs renderer API

## Current module

```js
import { render } from 'https://smalldocs.org/sdk/0.2.0/smalldocs.js';

const view = await render('#report', markdown);
```

The host page must use HTTP or HTTPS. `target` can be a selector or an `Element`. Rendering replaces the target's children with a direct-DOM SmallDocs reading surface.

## Options

```js
const view = await render('#report', markdown, {
  navigation: true,
  sections: { collapsible: true, defaultOpen: true },
  controls: { copy: true, fullscreen: true, download: true },
});
```

Every option shown above defaults to `true`.
Set an option to exactly `false` to disable it.

- `navigation` controls the in-document heading list.
- `sections.collapsible` controls expand and collapse behavior for H1 through H4.
- `sections.defaultOpen` controls the first state of collapsible H2 through H4 sections.
- `controls.copy`, `controls.fullscreen`, and `controls.download` control those actions across supported document features.

Open and closed sections with matching heading IDs keep their state across `view.update()`.

`sections.defaultOpen` has no effect when `sections.collapsible` is `false`. Heading copy and link controls remain available when sections are not collapsible, provided `controls.copy` is enabled.

## Configuration recipes

### Always-open report

Use this for an article or report where the reader should see the complete argument while scrolling.

```js
const view = await render('#report', markdown, {
  navigation: true,
  sections: { collapsible: false },
});
```

### Compact embedded answer

Use this when the application already supplies surrounding navigation and the result is short.

```js
const view = await render('#answer', markdown, {
  navigation: false,
  sections: { collapsible: false },
  controls: { copy: true, fullscreen: true, download: true },
});
```

### Long reference

Use this when readers benefit from opening one section at a time.

```js
const view = await render('#reference', markdown, {
  navigation: true,
  sections: { collapsible: true, defaultOpen: false },
});
```

The H1 control opens or closes the complete hierarchy. Opening a nested heading also opens its parent path. Matching section state is retained when `view.update(markdown)` replaces the content.

### Read-only presentation surface

This keeps document content readable while removing copy and file actions. Rich content that supports fullscreen remains expandable.

```js
const view = await render('#report', markdown, {
  controls: { copy: false, fullscreen: true, download: false },
});
```

Controls are cross-feature policies. For example, `download: false` removes supported code, diagram, chart, spreadsheet, and slide downloads. There are no per-feature control options in `0.2.0`.

Options stay fixed for the lifetime of the returned view. `view.update(markdown)` accepts Markdown only. Destroy the view and call `render()` again to change behavior options.

The SDK does not add a page-level top menu. The host application owns global navigation, account actions, route controls, and agent workflow actions. SmallDocs owns the document navigation, inline feature controls, and fullscreen surfaces. Do not recreate the SmallDocs application toolbar inside a customer application.

## Returned view

```js
await view.update(nextMarkdown);
view.destroy();
```

- `view.element` is the `.smalldocs-document` article.
- `view.features` lists rich feature modules used by the current document.
- `update(markdown)` replaces content in the same instance.
- `destroy()` removes the view and closes fullscreen it owns.
- A newer update rejects an older unfinished update with an `AbortError`.
- Render and update resolve after detected rich features settle or fall back.

The article dispatches a bubbling `smalldocs:rendered` event after each successful render or update:

```js
document.querySelector('#report').addEventListener('smalldocs:rendered', event => {
  console.log(event.detail.instanceId, event.detail.features);
});
```

Use this event when surrounding application layout or analytics needs to react to a completed document. Keep normal renderer lifecycle in `render()`, `update()`, and `destroy()`.

## Styling

The SDK installs version-matched CSS automatically in a low-priority CSS layer. Use custom properties on the mount:

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
  --sdocs-accent: #7a1f2b;
  --sdocs-background: #fffaf0;
  --sdocs-text-color: #2b2521;
  --sdocs-border-color: #d6c8b8;
  --sdocs-code-background: #f1ece4;
  --sdocs-max-width: 860px;
  --sdocs-radius: 0;
  --sdocs-padding: 40px 48px 60px;
}
```

Heading sizes and weights can be changed individually with `--sdocs-h1-size` through `--sdocs-h4-size` and `--sdocs-h1-weight` through `--sdocs-h4-weight`.

Ordinary unlayered CSS scoped under the mount can override specific document or feature selectors.

### Match application tokens

Custom properties can point at the host application's existing tokens:

```css
#report {
  --sdocs-font-family: var(--app-reading-font);
  --sdocs-heading-font-family: var(--app-heading-font);
  --sdocs-text-color: var(--app-text);
  --sdocs-muted-color: var(--app-text-muted);
  --sdocs-accent: var(--app-accent);
  --sdocs-background: var(--app-surface);
  --sdocs-border-color: var(--app-border);
  --sdocs-code-background: var(--app-surface-subtle);
}
```

The SDK stylesheet is installed in a low-priority CSS layer. Normal unlayered application CSS wins when specificity is otherwise sufficient:

```css
#report .smalldocs-document h2 {
  border-top: 2px solid var(--app-border-strong);
}
```

Keep overrides under the mount so another renderer and the surrounding application are unaffected. Preserve visible keyboard focus when changing controls or links.

## Content contract

Send one Markdown string after inference. No envelope or capability declaration is required.

The renderer supports ordinary Markdown, navigation, code, math, Mermaid, charts, cells and workbooks, custom-shape slides, and supported video fences. The document reader and these rich surfaces use the same canonical rendering components as the SmallDocs application. Feature discovery and loading are content-driven. Unknown fences remain readable source.

Form submission, comments, Markdown editing, Cloud storage, application chrome, and a first-party image pipeline are outside this release. A `form` fence remains readable source until the SDK has a host submission contract.

## Security

The SDK parses Markdown, sanitises the resulting HTML, and mounts the cleaned document into the host DOM. It removes script tags, event handlers, embedded frames, unsafe URLs, and similar executable content.

SmallDocs JavaScript has the privileges of the host page, like other third-party browser SDKs. Pin the versioned URL and include it in dependency review. Agent-authored executable blocks are disabled in `0.2.0`.

The experimental build loads rich dependencies from jsDelivr. Merge these origins into an existing Content Security Policy when needed:

```text
script-src https://smalldocs.org https://cdn.jsdelivr.net
style-src https://smalldocs.org https://cdn.jsdelivr.net 'unsafe-inline'
font-src https://cdn.jsdelivr.net
frame-src https://smalldocs.org https://www.youtube-nocookie.com
```

The SmallDocs frame origin is needed for Mermaid rendering. The YouTube origin is needed only for supported video fences. Remote document images require their host in the application's `img-src` directive.

If the application enforces Trusted Types, allow the `smalldocs-sdk-0.2.0` and `dompurify` policy names.

## Framework-neutral lifecycle

```js
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

Keep the original Markdown available so a rendering failure does not make the agent output inaccessible.

The example gallery at `https://smalldocs.org/developers/examples` shows the complete feature surface, an always-open styled report, a compact answer, and a long reference with initially closed sections.
