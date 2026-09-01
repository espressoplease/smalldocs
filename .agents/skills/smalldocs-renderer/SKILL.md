---
name: smalldocs-renderer
description: Integrate the SmallDocs browser renderer into a web application. Use when an application needs to display agent-authored Markdown or SmallDocs rich document features, when adding render, update, and destroy lifecycle wiring, or when debugging a SmallDocs renderer integration.
---

# SmallDocs renderer

Render finished Markdown as a SmallDocs document inside an application. The host supplies a mount element and Markdown. SmallDocs owns parsing, sanitisation, feature discovery, rendering, and content-driven loading.

Read [references/api.md](references/api.md) before changing integration code. It contains the current URL, lifecycle, configuration recipes, styling contract, security boundary, and supported features.

## Integration workflow

1. Inspect the host framework, route lifecycle, Content Security Policy, tests, and existing visual patterns.
2. Add one stable mount element where the document should appear.
3. Import the versioned browser module and call `await render(target, markdown)` after the application has the finished Markdown.
4. Keep the returned view. Use `view.update(markdown)` for replacement content and `view.destroy()` on unmount.
5. Style the document through SDK custom properties or scoped selectors under the mount.
6. Test from a clean customer page, not from SmallDocs application globals.

## Configuration workflow

Configure behavior in JavaScript and presentation in CSS.

- Use `navigation` for the SDK heading list.
- Use `runnableHtml: true` only when the customer has chosen to execute `sdoc-app` fences.
- Use `sections.collapsible` and `sections.defaultOpen` for section behavior.
- Use `controls.copy`, `controls.fullscreen`, and `controls.download` for actions across supported features.
- Use the documented `--sdocs-*` custom properties for typography, spacing, colors, width, padding, and radius.
- Use ordinary CSS scoped under the mount only when a custom property does not cover the required presentation.

Do not infer an application's preferred reading behavior. A report, compact answer, and long reference may use different section and navigation settings. Start from the closest recipe in the API reference and preserve the host application's existing visual patterns.

Keep configuration stable for the lifetime of a view. `view.update(markdown)` replaces content, not options. Destroy and create a new view when the application needs a different behavior configuration.

Pass the finished Markdown unchanged. Do not parse rich fences in host code or declare capabilities before inference. SmallDocs discovers code, math, Mermaid, charts, cells, slides, runnable HTML, and video from the content.

Reuse the application's existing components, tokens, dimensions, colours, typography, spacing, states, and responsive behavior before inventing SDK-specific UI. Reposition an existing pattern when needed. Add a new pattern only when the interaction is materially different.

The SDK renders the document into the host DOM and installs base CSS automatically. It owns its feature controls and fullscreen overlay. Do not add a second document iframe or fullscreen wrapper.

If the application also needs an agent to write SmallDocs Markdown, install `smalldocs-author` for that authoring step.

## Boundaries

- Treat `0.3.0` as an experimental browser renderer contract.
- Do not add comments, editing, Cloud storage, or surrounding SmallDocs application chrome.
- Do not invent keys, accounts, npm packages, framework wrappers, or API options not in the reference.
- Do not add image upload, proxying, or hosting. Discuss a first-party image pipeline before designing one.
- Keep agent-authored JavaScript inside `sdoc-app` frames. Ordinary `html` fences remain code listings. Do not enable runnable HTML without the customer's explicit choice.

## Verification

Verify ordinary Markdown, unsafe HTML sanitisation, CSS overrides, multiple instances, update, destroy, fullscreen, relevant file downloads, runnable HTML isolation and state preservation, and a document containing several rich feature types. Exercise the selected navigation and section configuration directly. Confirm a plain document does not request unrelated rich dependencies and SDK CSS does not restyle host elements outside the mount.
