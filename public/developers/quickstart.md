# Quickstart

Add one mount element and import the versioned browser module.

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.1.2/smalldocs.js';

  const markdown = await runYourAgent();
  const view = await render('#report', markdown);
</script>
```

`#report` is a CSS selector. It identifies the host page element where the document should appear. You can pass an `Element` instead.

Call `render` after inference or analysis has produced the Markdown. The agent does not initialise SmallDocs or announce which features the result might contain.

## What appears in the mount

SmallDocs replaces the mount element's existing children with one sandboxed iframe. The frame expands to the rendered document height and isolates the document's styles from the host page.

## Requirements

- Serve the host page over HTTP or HTTPS. Rendering from `file://` is not supported.
- If the application has a Content Security Policy, allow `https://smalldocs.org` in `script-src` and `frame-src`.
- Keep the returned `view` so the application can update or destroy it later.

## Handling failure

Keep the original Markdown available. If rendering fails, show the Markdown or a readable error in the host application's normal error surface.
