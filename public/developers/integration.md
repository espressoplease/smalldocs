# Use the SmallDocs SDK

Render agent-authored Markdown and rich SmallDocs documents inside a web application.

Current status: experimental `0.1.0`. No account or key is required. Production pricing and terms are not set.

## Quickstart

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.1.0/smalldocs.js';

  const markdown = await runYourAgent();
  const view = await render('#report', markdown);
</script>
```

`#report` is a CSS selector for the host page element where the document should appear. You can also pass an `Element`.

Call `render` after inference or analysis has produced the Markdown. The agent does not initialise SmallDocs, declare features, or parse rich blocks.

## Content model

Send one Markdown string. SmallDocs owns Markdown parsing, sanitisation, rich-feature discovery, rendering, and content-driven dependency loading.

The experimental renderer uses the current SmallDocs read surface, including:

- ordinary Markdown, heading navigation, tables, links, and code
- math and Mermaid diagrams
- charts and computed cells
- inline slides and supported video fences

Unknown fences remain readable as source. Comments, editing, export, Cloud storage, and surrounding application chrome are not exposed.

Image upload, proxying, and hosting are not included. An HTTPS image reference remains a request to its original host.

## Lifecycle

```js
const view = await render('#report', firstMarkdown);

await view.update(nextMarkdown);
view.destroy();
```

- `view.element` is the renderer iframe.
- `update(markdown)` replaces the document in the same view.
- `destroy()` removes the frame and releases the host-side message listener.
- A newer update rejects an older unfinished update with an `AbortError`.

Keep the view in the host component or route lifecycle. Destroy it on unmount. Do not call `render()` again for ordinary content changes.

## Security and data flow

The SDK creates a sandboxed iframe from `https://smalldocs.org` and sends the Markdown to it with `postMessage`. The renderer sanitises document HTML before display. Host styles and renderer styles remain isolated.

The current integration does not upload the Markdown through an API request. JavaScript served by SmallDocs executes inside the frame and can access the displayed document in the browser. A self-hosted renderer is not currently offered.

The frame accepts messages only from the declared host origin and a random per-instance channel. Pin the versioned module URL and treat its origin as third-party executable code.

For a host Content Security Policy, merge these sources into the existing policy:

```text
script-src https://smalldocs.org
frame-src https://smalldocs.org
```

## Loading and caching

The versioned module is served with immutable one-year browser caching. Applications can import it on every route that renders a document; the browser normally downloads it once. Each frame loads the reader shell, whose static assets use normal HTTP caching. Rich browser dependencies are requested by the reader according to document content.

`render()` and `update()` resolve after the document is mounted. Rich processors that load external browser dependencies can finish and resize afterward.

## Let a coding agent integrate it

Install the project-scoped integration skill:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

Then ask the coding agent:

```text
Use the smalldocs-renderer skill to add the report view to this route.
```

The skill is separate from the SmallDocs authoring skill installed by `sdoc setup`.

For an agent that produces the Markdown shown by the SDK, install the SDK authoring skill:

```sh
npx skills add https://smalldocs.org --skill smalldocs-author
```

The authoring skill contains feature-specific references for ordinary Markdown, code, math, diagrams, charts, cells, slides, video, and document styles. It tells presentation authors to use custom shapes whenever geometry explains a concept, including for internal decks.

## Verification

Test the integration from a clean customer application. Cover:

- ordinary Markdown and a document containing multiple rich feature types
- unsafe HTML sanitisation
- two independent renderer instances
- update and destroy lifecycle
- visible source or an error when rich rendering fails
- absence of unrelated rich dependency requests for a plain document

Keep the original Markdown available so a renderer failure does not make the agent output inaccessible.

## Links

- Human documentation: https://smalldocs.org/developers
- Agent index: https://smalldocs.org/developers/llms.txt
- Skill catalog: https://smalldocs.org/.well-known/agent-skills/index.json
- Source: https://github.com/espressoplease/SDocs
