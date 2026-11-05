# Rendered rich objects in edit mode

## Purpose

Keep spreadsheets, slides, and Mermaid diagrams rendered inside the document editor. Let people change values and text while preserving the object's layout, identifiers, and connections. The Markdown remains the saved document and the existing Cloud revision and permissions system remains authoritative.

## Product patterns considered

- [Excel cell editing](https://support.microsoft.com/en-gb/excel/edit-cell-contents): double-click or F2 enters a cell; Enter and Tab commit and navigate; Escape cancels. Reuse the existing SmallDocs cell editor and selection implementation for inline and fullscreen editing. Formula results remain calculated views of raw cell values.
- [PowerPoint text placeholders](https://support.microsoft.com/en-us/powerpoint/add-text-to-a-slide): editable text lives inside an existing box. Reuse SmallDocs shape rendering and its autofit behaviour. Edit the text within the rendered box; preserve the shape's coordinates, size, style, ID, and layer.
- [Google Slides text objects](https://support.google.com/docs/answer/1696521?hl=en): text and object arrangement are separate interactions. This iteration changes content within the current layout. It does not introduce selection handles, dragging, resizing, or connector editing.
- [Google Docs drawings](https://support.google.com/docs/answer/179740?hl=en): drawings have their own editing context, and linked drawings have an update action. SmallDocs already stores these objects within the same Markdown document, so object edits join the document's existing save and revision flow.
- [Mermaid flowchart escaping](https://mermaid.js.org/syntax/flowchart.html) and [sequence aliases](https://mermaid.js.org/syntax/sequenceDiagram): change text labels independently from stable identifiers. Encode punctuation and newlines as label content so typed text cannot become graph statements.

These are interaction references, not claims that SmallDocs implements the complete Office or Google editing model.

## Architecture

`public/sdocs-write-rich.js` owns rendered editing islands within the existing editor. An island's generated DOM has `contenteditable=false`. Its cell editor, slide text region, or diagram label input handles only its content. Ordinary prose continues to use the existing document editor.

Each island retains its original source `pre` and its current source text. Source cloning replaces the generated island with that source representation before comparisons, serialization, or undo-history recording. Rendered SVG, grid controls, and slide DOM are never saved as Markdown. Untouched object fences retain their original bytes.

The adapter constructs instance-owned versions of the existing cells UI, cell selection, cell editor, slide reader, and Mermaid renderer. It does not introduce another renderer or add an editing API to the renderer SDK. Optional lifecycle hooks in the existing cell focus view report changes to the application; existing read-mode spreadsheet exploration remains ephemeral.

The pure helpers in `cli/shared/sdocs-rich-edit.js` map editable text back to source spans. Slide changes affect content below an existing shape specification or a template instance slot. Mermaid changes affect labels or aliases, preserving the diagram's IDs and edges. Cells serialize raw values and formulas, retaining leading source and formatting directives.

Mermaid render IDs are namespaced per renderer instance. This prevents an asynchronous read render from removing an edit renderer's SVG with the same ID. Theme refreshes also respect renderer ownership.

## Supported editing interactions

### Spreadsheets

Use the current grid, selection, formula handling, keyboard navigation, CSV paste and cell editor. Double-click or F2 edits; Enter/Tab commits; Escape cancels. Recalculate the workbook and refresh dependent sheets after a committed change. Persist raw formulas, rather than their displayed results. Inline and fullscreen changes update the same document source.

An explicit Cloud save and leaving edit mode commit an open cell editor before saving. Remote refreshes wait while a cell or fullscreen formula bar has an open draft. Leaving the formula bar commits to the cell where typing started, preserving a newly clicked cell's selection. Escape restores the original value; Enter commits and moves down.

### Slides

Editable text uses the shape renderer's existing shadow-DOM content region. Ordinary Markdown formatting inside the text box is retained. Paste and drop insert literal text. The existing autofit logic runs when editing finishes.

Direct shape content and template-instance slots are supported. Editing inherited default text creates an override on that instance, preserving the template and other instances. A shape containing a nested diagram, code block, spreadsheet, chart, or runnable object remains rendered without making the nested object HTML part of the text editor.

### Mermaid

Flowchart node labels and sequence participant aliases and messages are editable. Implicit flowchart nodes and sequence participants gain explicit text labels or aliases while keeping their IDs. Click a label or use keyboard focus and Enter/F2. Enter commits, Shift+Enter adds a line break, and Escape restores the original text.

Other Mermaid diagram types remain rendered. This iteration does not claim text editing for every Mermaid grammar or flowchart edge label. Modern object declarations whose labels cannot be mapped to a supported source span remain rendered without a label-edit affordance. The existing Markdown source mode remains available for those changes.

### History, saves and lifecycle

Object source changes enter the same document undo history and Cloud save pipeline as prose. Cell editors also retain their existing local editing history. Source changes survive switching between read and edit modes, reloading Cloud documents, and asynchronous saves.

The edit toolbar exposes Undo in its final pill. It reverses the existing browser edit-session history and is disabled when that stack is empty. Opening another document or starting a new edit session resets it. Using Undo after an acknowledged save produces an ordinary autosave on the same Cloud document. It does not restore historical revisions or identify and reverse an agent's changes. Those broader version-history interactions remain a separate product decision.

Rich fields use their field identity to group a burst of typing. The adapter carries that identity and operation type as event metadata alongside a standard browser input type; browsers can discard unrecognised custom input-type strings. This keeps slide text undo consistent across engines without changing the Cloud revision protocol.

While a rich text field is active, a successful combined Cloud save may acknowledge the saved revision without replacing the field's DOM. The acknowledged source becomes the baseline for later changes. Deferred remote content is applied after the field closes, with new local input checked before applying it.

Destroy editor instances, listeners, portal inputs, slide render sessions and pending asynchronous render ownership when the document changes. Removing an input must detach its blur handler first, preventing a recursive commit during teardown.

## Acceptance and QA

- No-op read/edit transitions preserve the complete Markdown and do not create a Cloud revision.
- A one-cell edit retains formatting directives, raw formulas, workbook identities and cross-sheet results.
- Changing slide text preserves geometry, adjacent boxes, templates and other instances.
- Label edits preserve graph identities and connections, including repeated text and identical diagrams in the same document.
- Punctuation and markup-looking text remain content. Paste does not duplicate text or execute markup.
- Undo, redo, cancel, active drafts, theme changes, mobile layout, document replacement and late render completion preserve source integrity.
- Cloud saves and reloads retain tags and comment metadata. Remote edits combine with local rich edits without dismissing an active field or losing cell drafts.
- Verify Chromium, Firefox and WebKit, the existing prose edit suite, comments, sheets, slides, diagrams, theme coverage and the shared Node suite.

## Verification results

- The full shared Node suite passed, 2,301 tests, including 15 rich-source tests.
- The complete editor matrix passed 261 browser checks in Chromium, Firefox and WebKit: 45 prose/Cloud scenarios, 33 rich-object/Cloud scenarios and nine Undo-control scenarios per engine. Coverage includes numeric and Unicode identifiers, repeated diagrams, template overrides, empty text, literal punctuation, native typing, composition flags, mobile layout, draft preservation, concurrent saves, undo and cancellation. The 52 existing write-mode checks passed again after adding the Undo control.
- Related Chromium suites passed 285 checks covering existing editing, cells, workbook isolation, comments, Cloud UI, HTML components, tables, slide templates, theme contrast, SDK readers and sanitisation. Ten focused reader-cell checks also passed after the formula-bar changes.
- SDK 0.3.1 reader-snapshot and release-manifest checks passed. The released 0.3.0 files are unchanged. The adapted shape renderer received the same empty-text and refit lifecycle changes as the application renderer; the editor adapter is not part of the SDK.
- A production-mode service-worker rehearsal loaded the previous release, restarted the same origin with this implementation and reloaded normally. Rendered editing loaded, a cell edit survived returning to read mode, hidden editor widgets were removed and no browser errors were recorded.
- The same upgrade rehearsal exercised the new Undo button and keyboard Redo after a spreadsheet edit. Both restored the expected values before returning to read mode.
- Desktop light and dark slide text, an active diagram label and a narrow dark cell editor were visually inspected. Text remained readable and the rendered objects retained their layout. No browser errors were recorded.

The workbook-group tests had a fixed localhost port; they now accept the same origin override as the other suites. One existing Cloud list-comment hover timed out during the broader run. The complete comment-structure suite passed on rerun. WebKit's automation reports an incorrect content quad for SVG text; sequence-message testing uses an actual pointer click at the browser's measured text rectangle. Native shadow-text typing is exercised with keyboard input rather than an automation fill that WebKit can silently ignore.

## Practical limits

This is text and cell editing within rendered objects. Shape dragging, resizing, connector changes, and text editing for every Mermaid grammar remain outside this iteration. Charts, runnable objects and other complex fences retain their existing source workflow. Slide boxes that contain nested rendered objects stay rendered without treating generated widget HTML as editable prose.

Undo remains scoped to the active document edit session. Cloud revisions provide persisted history after acknowledged saves. The tests do not establish recovery from closing the browser before a save finishes. Composition flags and narrow browser viewports are covered; physical mobile keyboards, real input methods and every Safari/iOS version still merit hands-on testing.
