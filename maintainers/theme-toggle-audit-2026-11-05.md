# Light and dark theme audit

5 November 2026. Branch: `codex/homepage-next-review`.

## Result and approach

The reported slide failures were reproduced using a read-only local snapshot
of the delivery-plan document. Its white slide canvas inherited `#e7e5e2`
text from the dark document, about 1.3:1 contrast. A second reproduction used
slides without an explicit background: fullscreen inherited the document
background, while thumbnails hard-coded white.

The audit alternated structural inspection, a minimal reproduction, colour
measurements, a correction, and checks of related surfaces. It extended from
slides into asynchronous SVGs, canvas charts, body-portaled viewers, semantic
spreadsheet colours, native exports, preference persistence and the SDK.

The test benchmark for ordinary text is 4.5:1, using the computed foreground
and painted background. W3C specifies 4.5:1 for ordinary text and 3:1 for large
text in [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
This audit is not an accessibility certification. The existing CLI colour
analysis warning threshold is unchanged.

## Findings and corrections

| Priority | Finding | Correction |
| --- | --- | --- |
| P1 | Fixed white slide canvases and pastel cards inherited almost-white text in dark mode. Dark fixed canvases had the inverse problem. | Check inherited text against its effective surface. Keep a readable inherited colour; otherwise choose a contrasting foreground. Include nested headings, lists, links, code and tables. |
| P1 | Presentation thumbnails painted white while the main slide followed the document theme. | Share the canvas background between inline, fullscreen and thumbnail rendering. |
| P1 | Open presentations and spreadsheet viewers retained tokens copied when they opened. | Refresh forwarded tokens without closing the viewer or replacing document content. Preserve the selected slide, rail scroll and keyboard focus. |
| P1 | Mermaid nodes with an authored light fill inherited light labels in dark mode. | Check rendered node labels against their actual SVG fill. |
| P1 | An open diagram viewer retained its old SVG, and delayed rendering could overwrite a newer theme. | Refresh the live clone without resetting pan and zoom. Ignore superseded asynchronous render results and errors. |
| P1 | Slide charts reused the document's mutable chart store, so a later shadow-root render could remove earlier entries from refresh tracking. | Give each slide shape its own chart reader and cleanup. Refresh canvas colours against the chart's actual surface. Preserve fixed reference sizing. |
| P1 | Native PowerPoint export inferred text colour from a shape's own fill and defaulted its canvas independently. It could disagree with the reader on a dark canvas. | Read native text colours and canvas colour from the shared rendered slide. Resolve CSS colour references in the same style context for PDF and PowerPoint. |
| P2 | Cached chart thumbnails could carry pixels from the previous palette. | Reuse chart snapshots only when their palette signature matches. Rebuild the rail on a theme refresh. |
| P2 | Copy icons over SVG shapes and present icons over CSS-referenced canvases could choose the wrong contrast class. | Resolve the painted shape and corner surfaces, including CSS references, when the theme changes. |
| P2 | Spreadsheet negative amounts, errors, formula accents and warnings used fixed colours that weakened in dark mode. | Blend semantic colours with the current foreground. Check negative values and formula errors in both themes. |
| P2 | Light-theme syntax comments fell slightly below the ordinary-text contrast benchmark. | Darken the existing teal consistently in the reader and code viewer. |
| P2 | Export measurement stages could leave renderer resources alive after removal. | Destroy their shape sessions before removing the offscreen stage. |
| P2 | The existing sheet toolbar grew from 35px to 37px when its selection-copy button appeared. | Match the 4px vertical padding used by the other 35px toolbars, so selection and Escape do not shift the grid. |

## Edge-case map

| Location or transition | Check and evidence |
| --- | --- |
| Plain paragraphs, headings and links | Computed colour checks through repeated light/dark toggles. |
| Inline code and highlighted code blocks | Computed colour checks; existing code-viewer theme tests. |
| Blockquotes | Foreground and background measured together in both themes. |
| Numbered lists and list markers inside slides | Readability checks with fixed light and dark canvases. |
| Markdown tables and alternating rows | Computed cell colours; existing table and copy coverage remains in place. |
| Inline slides with inherited canvas | Follow the document palette. |
| Fixed white and fixed dark slide canvases | Keep the authored canvas; adjust unsafe inherited text. |
| Pastel shape fills | Dark and light foreground checks. |
| Transparent cards and full-slide backdrop rectangles | Resolve earlier painted rectangles in layer/source order. |
| SVG shapes with HTML text overlays | Include circles and their labels in the slide fixture. |
| `$background` and `$color` slide references | Live CSS changes, inline/fullscreen/thumbnail parity. |
| Explicit literal slide text colour | Preserve the author's literal colour. Existing override test retained. |
| Nested slide Markdown | Headings, prose, lists, links, code, quotations and tables checked. |
| Fullscreen main slide | Open before toggling, maintain current slide. |
| Presentation rail thumbnails | Match inline palettes, active state and chart snapshot freshness. |
| Repeated rapid toggles | Latest palette wins, body content remains unchanged. |
| Document charts plus multiple slide charts | All refresh independently; fixed slide sizing remains fixed. |
| Chart teardown | No Chart.js instances remain after closing the presentation and replacing the document. |
| Flowchart nodes and labels | Default nodes plus fixed white and dark node fills. |
| Sequence diagrams | Actor and message labels included in rich-document colour checks. |
| Open diagram viewer | Clone and chrome update with the source. |
| Delayed Mermaid render | Deterministic test resolves the newer render before the older one. |
| Spreadsheet cells and fullscreen sheet | Cell colours and open-viewer tokens checked in both themes. |
| Spreadsheet errors and negative amounts | Dedicated formula-error and negative-value fixture. |
| Math | KaTeX text included in the rich-document colour checks. |
| User comments | Cards remain readable; anchors, comment data and body survive theme changes and mode changes. Read mode continues to hide annotations. |
| Library and settings preference | Existing isolated Cloud-account tests cover saved choice, OS preference, reload, cross-tab sync and unavailable storage. |
| Mobile document controls | Preference sync checked at 390px; mobile screenshots inspected after transitions settle. |
| Runnable HTML components | Existing design-bridge tests cover theme changes. Authored component CSS retains its own authority. |
| SDK instances | Host CSS changes affect their own instance; a clean customer page tests open presentation, spreadsheet and diagram viewers without app globals. |
| PDF and PowerPoint | Existing geometry/text/rich-block exports plus a native PowerPoint foreground/background regression. |
| Private links and published pages | Use the same application reader and canonical rich renderers. No separate theme renderer was added. |
| Cached application shell | Upgrade rehearsal loads the previous committed service worker, restarts with this source, then verifies the new contrast helper and readable slides after ordinary reload. |

## Behaviour and limits

- The Markdown, authored slide attributes and Cloud revisions are not rewritten
  to fix a viewing preference. Contrast corrections are confined to rendered
  output and exports.
- Slides without a fixed background follow the theme. A white canvas explicitly
  authored in a slide remains white, with readable inherited text. Raster images
  and deliberately authored colours retain their appearance.
- A single text colour cannot guarantee contrast over arbitrary photographs,
  gradients, partial overlaps or author-specified whole-shape opacity. These need
  an authored text backing or an appropriate colour pair. This change does not
  add authoring restrictions or reject documents.
- Literal text colours explicitly set by the slide author remain authoritative.
  A deliberately unreadable literal pair is outside the inherited-theme repair.
- Tests cover Chromium desktop and mobile emulation. Native Safari and Firefox
  are not claimed as verified by this run.
- Muted interface metadata and disabled controls are not claimed to meet every
  WCAG criterion. The audit targets content legibility and theme consistency.

## Verification

Primary regression: `test/theme-audit.spec.js`. Supporting suites include
slides, presentation, code themes, library themes, chart copying, slide
comments, spreadsheet interactions, runnable components, PDF, PowerPoint and
SDK isolation. SDK reader snapshot and release manifests cover the shared
renderer changes in the in-development `0.3.1` release; immutable `0.3.0` is
unchanged.

An early full Node run under concurrent browser load reported a CLI-state
concurrency mismatch (`239 !== 240`) and then an unhandled test-socket reset.
The isolated full rerun passed all 2,286 checks. The CLI-state stress result is
an unrelated release follow-up, not evidence supplied by the theme fixes.

Verified:

- Full Node suite: 2,286 passed in isolation.
- Affected browser suites: 217 distinct checks passed across focused runs,
  including 14 new audit scenarios and all 111 spreadsheet checks.
- Additional PDF and PowerPoint export suites: 18 passed.
- SDK canonical snapshot, release-manifest checks and `git diff --check` passed.
- Cached-shell upgrade rehearsal passed with an active service worker, the new
  contrast helper, readable dark-mode slides and no page errors.
- Inspected desktop light/dark, presentation-rail and mobile screenshots.
- A local Chromium check with 60 slides and 240 text shapes measured eight
  synchronous theme switches at 31-40 ms, median 33 ms. This is a local sample,
  not a performance guarantee for every document or machine.

Changes are prepared on the branch. This audit does not deploy production or
publish npm. Staging deployment is separate.
