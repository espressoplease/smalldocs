# Quickstart

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.3.0/smalldocs.js';

  const markdown = await runYourAgent();
  const view = await render('#report', markdown);
</script>
```

`#report` identifies the host element where the document appears. The SDK installs its base CSS, parses and sanitises the Markdown, discovers rich features, and renders directly into that element.

Serve the host page over HTTP or HTTPS. Keep the returned `view` so the application can update or destroy it later.

## Optional styling

```css
#report {
  --sdocs-accent: #0f766e;
  --sdocs-font-family: Georgia, serif;
  --sdocs-max-width: 900px;
}
```

Use the application's normal error surface if rendering fails. Keep the original Markdown available as a fallback.

Use [the Browser API reference](/developers/api) to configure navigation, collapsible sections, controls, typography, spacing, and colors.
