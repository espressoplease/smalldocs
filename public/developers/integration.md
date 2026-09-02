# Render agent-generated reports inside your app

SmallDocs adds a report surface to your application. Give it the Markdown returned by an agent and your users receive a readable document with prose, diagrams, charts, computed cells, slides, math, code, video, walkthroughs, and opt-in runnable tools.

After integration, each completed analysis request displays one SmallDocs report in your existing result surface. A later result replaces that report in place. Supported blocks expose their documented controls, including copy, expand, fullscreen, and download where applicable.

> **Current status:** experimental `0.3.0`. No SmallDocs account or API key is required. At runtime, the application loads a versioned browser module from `smalldocs.org`, so its Content Security Policy and network configuration must allow that origin. Production pricing and terms are not set.

[Start with the SDK example gallery](/developers/examples), or give the integration instructions below to your coding agent. You can also [inspect a working application integration](/developers/example).

## Give this to your coding agent

From the application project directory, run this command to install the SmallDocs integration skill for your coding agent:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

This installs agent instructions, not an application dependency. The agent will integrate the versioned browser module into the application.

Then give the agent this prompt:

```text
Use the smalldocs-renderer skill to add a SmallDocs report view to this application.

First inspect the existing application. Find the surface that displays agent or analysis results, the shape and lifecycle of the returned Markdown, and the nearest existing page whose visual patterns should be reused.

Integrate the report into that existing result flow. Create one renderer instance per mounted report. When that report's Markdown changes, update the existing instance instead of creating another. Destroy the instance when its component or route unmounts. If rendering fails, show the original Markdown in the result surface and preserve the application's existing error state. Do not enable runnable HTML unless this application explicitly intends to run agent-authored browser components.

Match the application's typography, colours, spacing, responsive behaviour, loading state, and error state with the documented SmallDocs styling contract.

Add tests proving that ordinary Markdown and at least two documented rich block types render, a later result updates the existing view without creating a duplicate, and unmounting destroys the view.

When finished, show me the report in the running application, tell me where its Markdown enters the view, list the files changed, and report any unresolved CSP or integration issue.
```

The agent should finish with an observable result: run the application, complete or simulate one analysis request, and show its Markdown as a SmallDocs document in the intended product surface.

## How the two agents fit together

The coding agent integrates SmallDocs once. A document-producing agent can then return SmallDocs Markdown for each report.

~~~mermaid
flowchart LR
  C[Coding agent] -->|integrates once| A[Your application]
  A -->|requests analysis| D[Document-producing agent]
  D -->|returns Markdown| A
  A -->|passes Markdown| S[SmallDocs renderer]
  S --> U[User reads, copies, expands, and downloads]
~~~

[Teach the document-producing agent to author SmallDocs](/developers/agents) after the report surface is connected.

## Prove the renderer with a fixed document

Start with a fixed Markdown string before connecting the application's agent request. This separates renderer wiring from the rest of the data flow.

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.3.0/smalldocs.js';

  const markdown = `# First report

The SmallDocs renderer is connected.`;

  const view = await render('#report', markdown);
</script>
```

`#report` is the existing host element where the document should appear. It can also be passed as an `Element`. Serve the application over HTTP or HTTPS.

Once this renders, replace the fixed string with the Markdown returned by the application's existing agent or analysis flow.

## Match your application

The SDK installs base CSS and renders into the host DOM. Set documented custom properties on the mount to reuse the application's tokens:

```css
#report {
  --sdocs-font-family: var(--app-reading-font);
  --sdocs-heading-font-family: var(--app-heading-font);
  --sdocs-font-size: 17px;
  --sdocs-line-height: 1.8;
  --sdocs-text-color: var(--app-text);
  --sdocs-muted-color: var(--app-text-muted);
  --sdocs-accent: var(--app-accent);
  --sdocs-background: var(--app-surface);
  --sdocs-border-color: var(--app-border);
  --sdocs-code-background: var(--app-surface-subtle);
  --sdocs-max-width: 860px;
}
```

SmallDocs base rules live in a low-priority CSS layer. Scope any ordinary overrides under the mount so another renderer and the surrounding application are unaffected.

The application owns its top menu, breadcrumbs, account actions, and route controls. SmallDocs owns the document hierarchy, inline feature controls, and fullscreen surfaces.

## Configure reading behavior

```js
const view = await render('#report', markdown, {
  navigation: true,
  runnableHtml: false,
  sections: { collapsible: true, defaultOpen: true },
  controls: { copy: true, fullscreen: true, download: true },
});
```

Navigation, collapsible sections, open sections, and controls are enabled by default. Runnable HTML is disabled unless its value is exactly `true`.

Use an always-open document when the complete argument should stay visible. Use initially closed sections for a long reference. The [Browser API reference](/developers/api) lists the supported configuration recipes and properties.

## Update and remove the view

```js
const view = await render('#report', firstMarkdown);

await view.update(nextMarkdown);
view.destroy();
```

- `view.update(markdown)` replaces the document in the same instance.
- `view.destroy()` removes the document and releases its feature behavior.
- `view.element` is the rendered `<article class="smalldocs-document">`.
- `view.features` lists the rich feature modules used by the current document.

Map these calls to the framework or route lifecycle already used by the application. Keep the renderer configuration stable for the lifetime of the view.

## What documents can contain

One Markdown string can mix ordinary prose, tables, code, math, Mermaid diagrams, charts, computed cells and workbooks, custom-shape slides, video, walkthroughs, and runnable HTML. SmallDocs discovers the features from the Markdown and loads only the renderers the document uses. The host does not parse fences or declare capabilities.

Unknown fences remain readable source. Form submission, comments, Markdown editing, Cloud storage, and application chrome are outside this SDK release.

Use the [authoring reference](/developers/authoring/markdown) for exact block syntax or the [example gallery](/developers/examples) to inspect rendered combinations.

## Security and availability

Ordinary Markdown is parsed in the browser. The SDK sanitises the resulting HTML before it is mounted in the host DOM. The Markdown is not uploaded to SmallDocs by the renderer. The downloaded SmallDocs module runs with the privileges of the host page, like other third-party browser code, so pin its version and include it in dependency review.

Runnable HTML is a separate opt-in. When enabled, each `sdoc-app` block runs in a sandboxed frame. The frame cannot access the host DOM, cookies, storage, or account controls, but its own code can make network requests to destinations that permit them through CORS.

The first load requires access to the versioned SDK on `smalldocs.org`. Some rich features also load browser dependencies from jsDelivr. The [Security reference](/developers/security) gives the complete browser and CSP boundary. [Loading and caching](/developers/loading) covers content-driven requests and immutable version caching.

## Verify the outcome

Before calling the integration complete, confirm:

1. One analysis result appears as one SmallDocs document in the intended application surface.
2. Ordinary Markdown and the selected rich block types render instead of appearing as raw fences.
3. Copy, collapse, fullscreen, and relevant download controls work.
4. A later Markdown result updates the same document without duplicated roots or controls.
5. Leaving and returning to the route creates one clean renderer view.
6. Loading, empty, error, narrow, and wide states follow the application design.
7. The original Markdown remains available when rendering fails.

The [working integration](/developers/example) and [configuration gallery](/developers/examples) show these behaviors in customer-style shells.

## Direct documentation for agents

- Agent index: https://smalldocs.org/developers/llms.txt
- Complete reference: https://smalldocs.org/developers/llms-full.txt
- Skill catalog: https://smalldocs.org/.well-known/agent-skills/index.json
- Source: https://github.com/espressoplease/SDocs
