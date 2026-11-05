# Edit-mode integrity audit, 5 November 2026

## Scope and acceptance criteria

Focus on editing ordinary Markdown in the browser: paragraphs, headings, inline formatting, links, images, code, ordered and unordered lists, task lists, nested blocks, and tables. A small edit must preserve surrounding content and document metadata. Entering and leaving edit mode without changing anything must not rewrite the source or create a Cloud revision.

Rich elements remain source fences while editing. Returning to reading must render Mermaid, charts, cells, slides, and math again. This work does not introduce visual editing for those elements. Use disposable fixture documents rather than the user's existing staging document.

## Findings and implementation

| Area | Failure demonstrated | Change |
| --- | --- | --- |
| Untouched Markdown | Every mode switch regenerated the whole document, changing delimiters, whitespace, numbering, and code fences. | Track top-level source blocks and reuse the original bytes for unchanged blocks. A no-op session returns the complete original source. Edited blocks are serialized to equivalent Markdown. |
| Diagrams | Rendering Mermaid into the editable DOM destroyed the original source on save. | Preserve rich-fence source independently from generated DOM. The subsequent [rich editing implementation](rich-edit-mode-spec.md) reuses the existing renderers inside source-backed editor islands. |
| Ordered lists | Lists starting above one, or at zero, restarted at one. | Preserve the ordered start and item values during serialization. |
| Nested and loose lists | Paragraphs, quotations, code, and mixed nested lists were flattened, lost, or reordered. | Serialize item children in order and indent continuation blocks under their marker. Tab and Shift+Tab move complete list items, including their paragraphs and children. |
| Tasks | Checkboxes were disabled; a nested task could make its parent a task too. | Enable editor checkboxes and read only the current item's checkbox. Preserve checked state across serialization and undo. |
| Literal text | Markdown punctuation could become formatting after another edit. | Escape literal text, retain inline-code delimiters, link and image titles, and hard breaks. Move surrounding whitespace outside emphasis delimiters. |
| Code | Line breaks, long fences, full fence information, and internal blank lines could be damaged. A tab-indented block could be duplicated. | Preserve fence metadata, including nested code; serialize browser line breaks; map Marked's leading-tab expansion back to original source offsets. |
| Tables | Alignment was ignored; edited cells could lose structure or escaping. | Preserve column alignment, cell line breaks, literal pipes, inline formatting, and the surrounding document. Share alignment CSS with the reader SDK. |
| Toolbar and undo | Custom DOM changes did not reliably save, were missing from native undo, and could leave the caret outside the edited content. Native HTML replacement could inherit a removed wrapper. | Use explicit DOM transactions and one session undo/redo history for typing and toolbar actions. History stores reversible HTML deltas and selections rather than a full document per keystroke. |
| Composition | Markdown shortcuts could run during composition input. | Defer shortcuts while the browser reports an active composition. |
| Editor lifecycle | Delayed input or blur work could affect a replaced document. Re-selecting editing could replace pending input. | Bind delayed work to an edit session, reset it on document load, and refresh the visible editor when a document is replaced. |
| Theme | The active editor could retain stale style variables. | Refresh the existing editor's palette without replacing its content or caret. |
| Cloud saves | The model lagged typing by 500 ms. Explicit save and async responses could omit or overwrite the newest text. | Flush the active editor before explicit saves and before accepting async save, refresh, or tag responses. Recheck the current document after async work. |
| Concurrent saves | Continuing to type while an earlier save completed could reuse an outdated revision baseline and duplicate a passage. | Acknowledge the returned revision and rebase the newer draft before the next request. The browser and server use the same merge module. Existing permissive overlap handling remains in place. |
| Initial upload | Typing during the first upload could be marked as already saved. A response could attach a newly opened document to the previous upload. | Track the submitted source separately, queue later changes, and accept the upload receipt only for the document generation that initiated it. |
| Errors | Edits must remain available after failed or denied saves. | Verify that network errors and permission denial leave the open content intact and allow an appropriate retry. Server authorization remains authoritative. |

The shared merge implementation lives in `cli/shared/sdocs-merge.js`. The server's existing module re-exports it; the Cloud document shell loads its browser counterpart with the existing text-diff and comment data dependencies. No separate browser merge algorithm was introduced.

## Edge-case matrix

- Lists: tight and loose; starts at zero, seven and nineteen; mixed nested list types; task parents and children; list-item paragraphs, quotations, and code; repeated edits and mode switches; Enter, Backspace, indentation, undo, and redo.
- Inline content: escaped punctuation, literal brackets and backslashes, embedded backticks, formatting boundaries with spaces, link and image titles, parenthesized destinations, and hard breaks.
- Source structure: CRLF, leading tabs, repeated identical paragraphs, invisible reference definitions, deleting adjacent content, raw HTML blocks, footnotes, and comment metadata.
- Tables: one-cell edits, alignment, inline formatting, code containing pipes, and cell line breaks.
- Rich rendering: both flowchart and sequence Mermaid diagrams, charts, workbook formulas and cross-sheet references, slides, and inline/display math after an unrelated edit.
- Lifecycle: no-op mode changes, pending debounce, replacing a document while editing, reselecting edit mode, themes, mobile layout, and preventing undo into another document.
- Cloud: explicit immediate save; delayed save, refresh and tag responses; two concurrent tabs; a server-combined save followed by further typing; failed and denied saves; typing during initial upload; changing the open document before an upload returns.

## Validation

- Full Node suite: 2,286 passing checks.
- Browser edit matrix: 34 source/editor scenarios and 11 Cloud scenarios in Chromium, Firefox, and WebKit, 135 passing checks.
- Related browser coverage: 52 existing write-mode, 18 sanitization, and 73 Cloud/comment/table/component/theme checks, 143 passing checks.
- Combined browser coverage: 278 passing checks across those suites.
- SDK 0.3.1 canonical-reader snapshot and release-manifest checks pass. Released SDK 0.3.0 is unchanged.
- A production-mode service-worker rehearsal loaded the previous committed shell, restarted the origin with the candidate code, then used a normal reload. The updated editor retained the original source on no-op, retained list numbering after a table edit, and rendered Mermaid again. No browser errors were recorded.
- Desktop light and narrow dark editor screenshots were inspected. No layout or console errors were found in those states.
- Local performance sample: 173,506 bytes, 700 paragraphs; entering editing about 114 ms; 20 measured insertions had median 4.9 ms and maximum 8.3 ms; flushing about 19 ms. These are local observations, not service-level guarantees.

One initial broader run encountered an execution-context race in the existing Cloud comment lifecycle test. Three isolated repeats and the subsequent complete related suite passed. An old HTML component assertion was updated to inspect the active editor and then the reader, since loading a document now correctly refreshes both surfaces. The sanitization suite's fixed localhost port was changed to honor the same test origin override as the editor suite.

## Running the focused matrix

```sh
npx playwright install chromium firefox webkit
npx playwright test --config=playwright.edit.config.js
```

To use an existing server:

```sh
SDOCS_TEST_BASE_URL=http://localhost:3196 npx playwright test --config=playwright.edit.config.js
```

## Practical limits and further work

- Edited blocks are serialized Markdown, so equivalent marker spelling or whitespace inside that block can change. Untouched source blocks remain byte-for-byte unchanged.
- The subsequent [rich editing implementation](rich-edit-mode-spec.md) keeps spreadsheets, slides and diagrams rendered. It adds cell editing, slide text and supported Mermaid labels while preserving structure. Other rich fences remain source-based in editing.
- Undo is scoped to the active edit session and is reset when another document is loaded. Persisted Cloud revisions remain the recovery mechanism across sessions.
- A save is durable after the server acknowledges it. These tests do not establish offline editing or recovery after abruptly closing the browser before a save finishes.
- Composition behavior is covered with browser composition flags. A real IME and physical mobile keyboards still merit manual testing.
- WebKit automation is useful engine coverage; it is not a claim that every Safari or iOS version was tested.
