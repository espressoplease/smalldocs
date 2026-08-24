---
name: smalldocs-renderer
description: Integrate the SmallDocs browser renderer into a web application. Use when an application needs to display agent-authored Markdown or SmallDocs rich document features, when adding render, update, and destroy lifecycle wiring, or when debugging a SmallDocs renderer integration.
---

# SmallDocs renderer

Embed completed Markdown as a readable SmallDocs document. The host application supplies a mount element and Markdown. SmallDocs owns Markdown parsing, sanitisation, rich-feature discovery, rendering, and content-driven loading.

Read [references/api.md](references/api.md) before changing integration code. It contains the current versioned URL, lifecycle contract, security boundary, and supported feature set.

## Integration workflow

1. Inspect the host project's framework, route structure, Content Security Policy, and component cleanup conventions.
2. Add one stable mount element where the document should appear.
3. Import the versioned browser module and call `await render(target, markdown)` after the agent or application has produced the Markdown.
4. Keep the returned view. Call `view.update(markdown)` for replacement content and `view.destroy()` when the host component unmounts.
5. Test the integration from a clean customer page, not from SmallDocs application globals.

Pass the finished Markdown through unchanged. Do not parse rich fences in host code, declare capabilities before inference, or choose feature modules. A document can contain any supported combination of Markdown, navigation, code, math, diagrams, charts, cells, slides, and video. SmallDocs discovers what the document uses.

If the application also needs an agent to produce this Markdown, install the separate `smalldocs-author` skill for that agent. The renderer skill defines application integration; the authoring skill defines document syntax and content choices.

## Boundaries

- Treat `0.1.0` as an experimental rendering-only contract.
- Do not add comments, editing, export, Cloud storage, or application chrome to an SDK integration.
- Do not invent options, publishable keys, npm packages, React wrappers, or readiness events that are not in the API reference.
- Do not add image upload, proxying, or hosting. Ordinary HTTPS image references remain references to their original hosts. Discuss a first-party image pipeline with the user before designing one.
- Do not inject the Markdown into the host DOM. The renderer's isolated frame owns that work.

## Verification

At minimum, verify ordinary Markdown, one document containing multiple rich feature types, unsafe HTML sanitisation, two independent renderer instances, update, destroy, visible failure behavior, and that a plain document does not request unrelated rich-feature dependencies.
