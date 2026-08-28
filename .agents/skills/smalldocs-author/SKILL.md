---
name: smalldocs-author
description: Create finished SmallDocs Markdown for an application using the SmallDocs renderer. Use when an agent must produce a readable report or rich document containing diagrams, charts, computed cells, slides, runnable HTML, math, code, video, navigation, or document styling. Do not use for integrating the renderer SDK itself.
---

# SmallDocs authoring

Produce one completed Markdown string for the host application to pass to the SmallDocs renderer. Use ordinary Markdown for the document structure and add rich blocks where they make the result easier to understand. Do not emit an SDK capability declaration, feature manifest, HTML wrapper, or host-side parsing instructions. SmallDocs discovers features from the finished document.

Read only the references relevant to the requested document:

- [Markdown and navigation](references/markdown.md) for document structure, tables, links, and unknown fences.
- [Code](references/code.md) for source listings and walkthrough-friendly explanations.
- [Math](references/math.md) for inline and display equations.
- [Diagrams](references/diagrams.md) for Mermaid system, process, sequence, and relationship diagrams.
- [Charts](references/charts.md) for quantitative visualisations.
- [Cells](references/cells.md) for computed tables, formulas, and multi-sheet models.
- [Slides](references/slides.md) for presentations. Also read [custom slide shapes](references/slide-shapes.md) when explaining a concept, process, architecture, comparison, or causal model visually.
- [Video](references/video.md) for supported YouTube references.
- [Runnable HTML](references/apps.md) for self-contained interactive browser tools.
- [Styles](references/styles.md) only when the document needs explicit visual treatment beyond the SmallDocs defaults.

## Authoring decisions

- Start with the clearest document structure. Rich blocks should carry information, not decorate the page.
- A single document may mix every supported feature. Do not choose one global mode.
- Use a Mermaid diagram for relationships or sequence, cells for numbers people should inspect, charts for patterns in quantitative data, slides when the result will be presented, and runnable HTML when the reader needs to manipulate a self-contained browser tool.
- For slides, internal status is not a reason to default to bullet-only templates. When the purpose is to explain how something works, use custom shapes to encode the relationships visually. Built-in templates remain useful for covers, section breaks, simple text, and repeated layouts.
- Preserve source readability. If a rich block is not necessary, ordinary Markdown is the better format.
- Do not add image upload, proxying, or hosting instructions. Ordinary HTTPS image references remain external requests, and image infrastructure is outside this authoring contract.

## Handoff

Return the finished Markdown without commentary unless the caller requests an explanation. Before handoff, count the rendered slide fences against any requested deck length and verify that each required concept or sequence appears where requested. Do not count `@template` definitions as slides.

If the `sdoc` CLI is available, use `sdoc file.md` to inspect the complete document or `sdoc present file.md` to inspect a deck in presentation mode. Check complex slides, diagrams, charts, cells, and runnable HTML before handoff. Run `sdoc apps` before authoring a runnable component, then check it inline and fullscreen at narrow and wide widths. Otherwise keep geometry and syntax conservative and retain readable labels in the source.
