# Put agent analysis inside your application

Render finished agent work as a readable document inside your product. The agent returns Markdown. SmallDocs turns that Markdown into prose, diagrams, charts, computed sheets, slides, math, code, and video where the document uses them.

[Open a working SDK example](/developers/example), or [see sample documents on the homepage](/#learn).

**Hand this to your coding agent**

1. Install the renderer skill in the application project:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

2. Give the coding agent this prompt:

```text
Use the smalldocs-renderer skill to add a SmallDocs report view to this application.
The report Markdown will be returned by our analysis agent.
Match the renderer to the application's existing visual language with CSS overrides.
Keep one renderer view, update it when the Markdown changes, and destroy it when the route unmounts.
Add a test with ordinary Markdown and a document containing rich SmallDocs blocks.
```

3. [Teach the analysis agent to author SmallDocs Markdown](/developers/agents). It returns the finished Markdown and the application passes that string to `render()`.

Current status: experimental `0.2.0`. No account or key is required. Production pricing and terms are not set.

## Render a document

```html
<div id="report"></div>

<script type="module">
  import { render } from 'https://smalldocs.org/sdk/0.2.0/smalldocs.js';

  const markdown = await runYourAgent();
  const view = await render('#report', markdown);
</script>
```

`#report` selects the element where the document should appear. You can pass an `Element` instead.

Call `render()` after the agent has produced the Markdown. The host does not parse fences or declare capabilities. SmallDocs discovers the document features and loads their renderers.

## Match your application

The SDK installs its base CSS automatically. It renders into the host DOM, so your application can override the documented variables or ordinary SmallDocs selectors.

```css
#report {
  --sdocs-font-family: Georgia, serif;
  --sdocs-font-size: 17px;
  --sdocs-line-height: 1.8;
  --sdocs-heading-font-family: Arial, sans-serif;
  --sdocs-paragraph-spacing: 1.2em;
  --sdocs-accent: #7a1f2b;
  --sdocs-background: #fffaf0;
  --sdocs-text-color: #2b2521;
  --sdocs-max-width: 820px;
  --sdocs-radius: 0;
}

#report .smalldocs-document h1 {
  letter-spacing: -0.04em;
}
```

SmallDocs base rules live in a low-priority CSS layer. Normal unlayered application CSS can override them. SDK selectors are scoped so they do not restyle headings, tables, or buttons outside the renderer.

## Configure reading behavior

```js
const view = await render('#report', markdown, {
  navigation: true,
  sections: {
    collapsible: true,
    defaultOpen: false,
  },
  controls: {
    copy: true,
    fullscreen: true,
    download: true,
  },
});
```

All options are optional. Navigation, collapsible sections, open sections, and controls are enabled by default.

Use `sections.collapsible: false` when the host application should show the full document without fold controls. Use `navigation: false` when the application supplies its own navigation. Typography, spacing, and colors are CSS rather than JavaScript options, so each customer surface can inherit or override them naturally. See the [Browser API reference](/developers/api) for the complete property list.

## Update and remove the view

```js
const view = await render('#report', firstMarkdown);

await view.update(nextMarkdown);
view.destroy();
```

- `view.element` is the rendered `<article class="smalldocs-document">`.
- `view.features` lists the rich renderers used by the current document.
- `update(markdown)` replaces the document in the same instance.
- `destroy()` removes the document and closes any fullscreen surface it owns.
- A newer update rejects an older unfinished update with an `AbortError`.

## Supported content

One Markdown string can mix ordinary Markdown, navigation, code, math, Mermaid, charts, computed cells and workbooks, custom-shape slides, and supported video fences. The SDK and the SmallDocs application use the same document and rich-feature rendering components. Feature controls include copying, fullscreen reading, and relevant file downloads such as SVG, PNG, XLSX, PDF, and PowerPoint.

Unknown fences remain readable as source. Form submission, comments, Markdown editing, Cloud storage, and surrounding application chrome are outside this SDK release. A `form` fence remains source until the SDK has a host submission contract.

Image upload, proxying, and hosting are not included. An HTTPS image reference remains a request to its original host.

## Security and data flow

Markdown stays in the browser. The SDK parses it, sanitises the resulting HTML, and mounts the cleaned document into the selected host element. Script tags, event-handler attributes, embedded frames, unsafe URLs, and similar executable markup are removed.

The document is not isolated from the application by an iframe. SmallDocs code runs with the same page privileges as other third-party browser SDKs, so pin the versioned module URL and include it in the application's dependency review.

Executable `sdoc-app` blocks are not part of `0.2.0`. Ordinary `html` fences remain code listings. A later executable-content contract can add a separately configured sandbox without moving the whole document back into an iframe.

If the application has a Content Security Policy, merge the required origins into its existing policy. The current experimental build loads rich dependencies from jsDelivr:

```text
script-src https://smalldocs.org https://cdn.jsdelivr.net
style-src https://smalldocs.org https://cdn.jsdelivr.net 'unsafe-inline'
font-src https://cdn.jsdelivr.net
frame-src https://smalldocs.org https://www.youtube-nocookie.com
```

The SmallDocs origin in `frame-src` is needed for Mermaid rendering. The YouTube origin is needed only for supported video fences. An external image URL also needs its host in the application's `img-src` directive.

Applications that enforce Trusted Types should also allow `smalldocs-sdk-0.2.0` and `dompurify` in the `trusted-types` directive.

## Loading and caching

The versioned SDK modules and stylesheet use immutable one-year browser caching. Importing the same URL on another route normally reuses the cached files.

Plain Markdown does not load chart, diagram, spreadsheet, or slide modules. Rich modules and browser dependencies are loaded from the content the document actually contains.

`render()` and `update()` resolve after the requested rich features have settled or fallen back to readable source.

## Verify an integration

Test from a customer application, not SmallDocs application globals. Cover ordinary Markdown, a multi-format document, unsafe HTML, CSS overrides, two independent instances, update, destroy, fullscreen, and file downloads. Keep the original Markdown available so a renderer failure does not hide the agent output.

## Direct documentation for agents

- Agent index: https://smalldocs.org/developers/llms.txt
- Complete reference: https://smalldocs.org/developers/llms-full.txt
- Skill catalog: https://smalldocs.org/.well-known/agent-skills/index.json
- Source: https://github.com/espressoplease/SDocs
