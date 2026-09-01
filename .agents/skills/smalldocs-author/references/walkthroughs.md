# Document walkthroughs

Use a walkthrough when the reader should follow an ordered explanation across a finished Markdown document. Each step points to source lines and renders as a note with Previous and Next controls. The Markdown remains readable without the walkthrough.

## Local CLI handoff

Pass source-line annotations after the file:

```sh
sdoc report.md 12:"Start with the result" 24-28:"Compare these figures"
```

The step order follows the command arguments, not source order. The CLI places the walkthrough metadata in the rendered document and leaves the source file unchanged. The metadata also travels through `sdoc share`.

Use this path when an agent is opening a local file for the user. Count lines in the complete source file, including existing YAML front matter.

## Renderer content

When the Markdown string itself must carry the walkthrough, add `docwalk: true` and an ordered `annotations` list to YAML front matter:

```yaml
---
docwalk: true
annotations:
  - line: 3
    text: "Start with the result"
  - line: 8
    endLine: 12
    quote: "operating margin"
    text: "Compare the margin assumptions"
---
```

These line numbers are relative to the Markdown body after the closing front matter delimiter. `line` is required and one-based. `endLine` is optional. `quote` can narrow a prose or code target to exact text. `text` contains the Markdown note shown to the reader.

Keep annotations ordered in the intended reading sequence. Do not reorder them by line number.

## Target behavior

- A prose source line highlights its matching rendered words.
- A range can cover several rendered blocks.
- A line inside an ordinary code fence highlights the corresponding code line and places the note below it.
- Mermaid, charts, cells, slides, forms, math, video, and `sdoc-app` fences target their complete rendered surface.
- A blank source line resolves to the next rendered block, or the preceding block at the end of the document.

Use stable source structure. If text is generated after the annotations are calculated, recalculate the line numbers before returning the document.

## Authoring check

Check every step in order. Confirm the selected words or rich surface match the note, Previous and Next cross feature boundaries, code steps remain aligned in fullscreen, and the document still reads normally when walkthrough metadata is ignored.
