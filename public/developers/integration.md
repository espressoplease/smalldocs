# Put agent analysis inside your application

Turn an agent's analysis into a readable document inside your product. The agent can use prose, diagrams, charts, computed sheets, or slides when each format helps. Markdown is the handoff between the agent and the SmallDocs browser renderer.

[Open a working multi-document SDK example](/developers/example), or [see sample SmallDocs on the homepage](/#learn).

**Quick start with your coding agent**

1. Install the renderer skill in your application project:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

2. Copy this prompt into the coding agent working on your application:

```text
Use the smalldocs-renderer skill to add a SmallDocs report view to this application.
The report Markdown will be returned by our analysis agent.
Keep one renderer view, update it when the Markdown changes, and destroy it when the route unmounts.
Add a test with ordinary Markdown and a document containing rich SmallDocs blocks.
```

3. [Teach your analysis agent to author SmallDocs Markdown](/developers/agents). It returns the finished Markdown and your application passes that string to `render()`.

The coding agent and analysis agent can be the same model in different steps. Their roles stay separate: one integrates the renderer, while the other produces documents.

Current status: experimental `0.1.2`. No account or key is required. Production pricing and terms are not set.

## Integrate it yourself

### One mount element and one render call

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.1.2/smalldocs.js';

  const markdown = await runYourAgent();
  const view = await render('#report', markdown);
</script>
```

`#report` is a CSS selector for the element where the document should appear. You can also pass an `Element`.

Call `render` after inference or analysis has produced the Markdown. The agent does not initialise SmallDocs, declare features, or parse rich blocks. SmallDocs inspects the finished document and loads the renderers it needs.

### Update and remove the view

```js
const view = await render('#report', firstMarkdown);

await view.update(nextMarkdown);
view.destroy();
```

- `view.element` is the renderer iframe.
- `update(markdown)` replaces the document in the same view.
- `destroy()` removes the frame and releases the host-side message listener.
- A newer update rejects an older unfinished update with an `AbortError`.

Keep the view in the host component or route lifecycle. Destroy it on unmount. Use `update()` for ordinary content changes instead of calling `render()` again.

### Fullscreen views

When a reader expands slides, a diagram, code, or computed cells, the renderer frame temporarily covers the browser viewport and locks scrolling on the host page. Closing the expanded view restores the frame and the reader's previous page position. The host application does not need fullscreen event handlers.

### What the Markdown can contain

Send one Markdown string. SmallDocs owns Markdown parsing, sanitisation, rich-feature discovery, rendering, and content-driven dependency loading.

The experimental renderer supports:

- ordinary Markdown, heading navigation, tables, links, and code
- math and Mermaid diagrams
- charts and computed cells
- inline slides and supported video fences

One document can mix these formats. Unknown fences remain readable as source. Comments, editing, export, Cloud storage, and surrounding application chrome are not exposed by this SDK.

Image upload, proxying, and hosting are not included. An HTTPS image reference remains a request to its original host.

## Operational reference

### Security and data flow

The SDK creates a sandboxed iframe from `https://smalldocs.org` and sends the Markdown to it with `postMessage`. The renderer sanitises document HTML before display. Host styles and renderer styles remain isolated.

The current integration does not upload the Markdown through an API request. JavaScript served by SmallDocs executes inside the frame and can access the displayed document in the browser. A self-hosted renderer is not currently offered.

The frame accepts messages only from the declared host origin and a random per-instance channel. Pin the versioned module URL and treat its origin as third-party executable code.

For a host Content Security Policy, merge these sources into the existing policy:

```text
script-src https://smalldocs.org
frame-src https://smalldocs.org
```

### Loading and caching

The versioned module is served with immutable one-year browser caching. Applications can import it on every route that renders a document; the browser normally downloads it once. Each frame loads the reader shell, whose static assets use normal HTTP caching. Rich browser dependencies are requested according to document content.

`render()` and `update()` resolve after the document is mounted. Rich processors that load external browser dependencies can finish and resize afterward.

### Verification

Test the integration from a clean customer application. Cover ordinary Markdown, a multi-format document, unsafe HTML sanitisation, update and destroy, and two independent renderer instances. Keep the original Markdown available so a renderer failure does not make the agent output inaccessible.

### Direct documentation for agents

- Agent index: https://smalldocs.org/developers/llms.txt
- Complete reference: https://smalldocs.org/developers/llms-full.txt
- Skill catalog: https://smalldocs.org/.well-known/agent-skills/index.json
- Source: https://github.com/espressoplease/SDocs
