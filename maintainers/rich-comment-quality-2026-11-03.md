# Comments on rich document elements

## Scope and interaction

Continue the comment structure work with slides, Mermaid diagrams, Markdown tables and computed cells. Use the existing comment store, cards, thread actions, author preferences, Cloud permissions and revision history. New targets must not insert cards into a slide, SVG drawing, table cell or spreadsheet grid.

- Slides: click an element, extend selection with Shift, or comment on the whole slide. Retain selection drafts when extending a group and while navigating presentation slides.
- Diagrams: click a flowchart node, a sequence participant or a sequence message, or use the whole-diagram comment button. Other Mermaid types support whole-diagram comments. Targets are available inline and fullscreen. Fullscreen reading has a comment action.
- Sheets: select source cells, then use Comment beside the existing copy control. Support single cells, ranges and discontiguous source rows selected in a sorted view. Place cards below the grid without widening it. Fullscreen reading can start feedback directly.
- Tables: retain the established table, row, column and cell controls. Use exact row/header evidence, full-row snapshots for repeated first-column names, and an unchanged-table fingerprint for identical rows.

## Target representation

All threads remain in `currentMeta.comments`, travel in styled Markdown and portable copy-with-comments, and use the same reply, resolve, reopen and delete actions.

`kind: cells` stores the sheet name, original source snapshot, a zero-based source range, explicit selected source row indices, header hints and raw selected values. Formula text remains raw in its context. Browser sorting changes display order, not the target. Scratch edits do not change the saved context.

`kind: diagram` stores the original Mermaid source and an optional logical target ID. Flowcharts use their source node ID. Sequence participants use their source participant ID, so aliases can change. Sequence messages retain the sender, arrow, recipient, source text and duplicate occurrence. SVG-generated IDs are not stored as identity. Whole-diagram feedback works without a node ID.

Cloud source projection uses the same sequence target parser as the browser.
Saved edits map an individual message's source range and refresh its identity
after a correction or insertion. Repeated messages have separate initial
targets; changed-source fallback leaves uncertain duplicate matches unplaced.
Top and bottom participant boxes refer to the same thread target.

## Reading table data

Read mode exposes hover and keyboard copy controls in the same positions and
dimensions as table comment controls. All targets use CSV quoting for commas
and quotes. Row values are comma-separated; a column is one field per line,
including its header. The column-control strip expands upward when a header
is hovered or focused, staying in the document flow so it does not cover preceding
text. A header tap also reveals it on touch screens. It remains available while
the pointer or focus is in the table, then collapses without reserving space.
Whole-table CSV and PNG copy remain available. Copies exclude controls and
comment cards and do not change Markdown or metadata.

Shared target-control CSS supplies the comment and copy button shapes. Read
controls are hidden in document comment mode, while embedded SDK readers keep
their own read controls. Copy success uses the existing tick feedback. Clipboard
failure or missing support produces a visible status in the table toolbar.

`kind: slide` retains the existing schema. A shared pure resolver now locates the same slide and shapes for browser rendering and backend context. Source shape identity takes precedence over generated labels such as "1st arrow". Copies report the resolved current position.

Table comments retain the existing schema with optional `row_cells` and `table_signature` recovery evidence. These distinguish actual duplicate rows from prefix-similar labels and identical duplicate tables.

The YAML subset stores nested values as JSON scalars. Normalize these at both browser load and source projection. Test actual persisted Markdown rather than only in-memory objects.

## Agent workflow and output

The Cloud comments command returns every target type with discussion, access-controlled links, source diagnosis and bounded snippets. Large snapshots and arrays remain stored but are omitted from responses. `anchor.omitted_fields` names them and `anchor.snapshot_sha256` identifies their saved values. Context-free reads omit source snippets.

Targeted edit receipts prefer a body diff and explicitly identify `diff_basis: body`. Hunk lines refer to the Markdown body after front matter. `front_matter_changed` reports refreshed anchors or other front-matter changes. Full revision differences remain available through `cloud diff`. The saved content hash still covers the entire stored file.

Skill v49 and CLI help describe source coordinates, sorted/scratch views, targeted reads and edits, and verified cleanup. Agents inspect the saved result before deleting addressed feedback or resolving a discussion they should retain. Edits do not close feedback automatically. Quote-based CLI add/reattach still selects prose, rather than reconstructing visual targets.

## Re-anchoring

Map diagram source and selected sheet records through actual saved edits. Update stored context after a correction. Preserve disjoint selected rows and do not include unselected source rows in a sorted range. Match CSV records across quoted multiline values and map parsed code positions to original source lines for indented fences.

Unchanged header structure preserves selected column positions even when names repeat or are empty. Changed ambiguous structures remain unplaced. Deleted rows and nodes remain available as lost feedback. Ignore node-looking text inside Mermaid labels, edge labels, comments and style/click directives.

Preserve fullscreen editors during late annotation repaints. Save or cancel removes the active editor before a guarded repaint. Duplicate diagrams retain the actual opened wrapper while it exists; unchanged-document positions can retain its identity after a comment save. Do not close a modal from an ambiguous source lookup while its opener is still installing listeners.

## Validation

New browser suites cover cells, diagrams, slide failures, tables and SDK isolation. Existing prose/list, code, Cloud thread, cell selection and workbook tests cover regressions. Test geometry on desktop and mobile, actual list markers, source immutability, formulas, sorting, hidden-tab navigation, fullscreen drafts, thread actions, export/reload and ambiguous/deleted targets.

Node tests cover raw persisted anchors, source snippets, compact responses, quoted CSV, indented fences, source rebasing, slide geometry and permissions. A dedicated API case verifies rich feedback is unavailable before sharing, visible after an explicit grant, and unavailable immediately after revocation, including mutation attempts.

Two clean-context agents received only a normal task to address a reviewer's feedback on a mixed document. Both found and corrected three targets, verified them and deleted the three addressed threads. They preserved the reviewer's unplaced question, another author's proposal, formulas, unrelated documents and an injected concurrent operator note. Parent-side exact body oracles passed. The second trial confirmed clearer three-hunk edit receipts after the first agent reported snapshot noise.

The first trial found invalid continuation indentation in the example slides. The fixture was corrected and both slide and cell verification passed before the second trial.

The service-worker upgrade check uses an old committed shell followed by the current source. SDK source snapshots/manifests are refreshed and checked; comments remain a production opt-in, outside the renderer's default controls.

## Limits

- Sheet notes remain in SmallDocs. Excel downloads retain values and formulas but do not export native Excel notes or threads.
- Diagram targeting covers flowchart nodes and sequence participants/messages. Other Mermaid types use whole-diagram notes.
- Unsupported legacy/template slide geometry can remain explicitly unverified in backend context.
- Arbitrary rewrites can destroy target identity. Keep feedback visibly unplaced rather than attach it to a plausible substitute.
- Bulk cleanup and a leaner general receipt mode were suggested by the trial agents. Existing selected-thread commands were sufficient for both tasks.

The retained example is [Delivery plan and budget](https://cloud-staging.smalldocs.org/docs?cloud-document=10fad37a-2774-4b12-8897-280a53a69fb6), saved in Joshua Eichler-Summers with `smalldocs`, `qa` and `comments` tags.

## Local release gate

- CSV and collapsing table controls: 2,285 Node tests and 26 browser checks
  passed, including CSV quoting, touch, keyboard focus, spacing, clipboard
  errors, comment-mode controls and SDK isolation. Old-shell service-worker
  upgrade and current SDK snapshot/manifest checks passed.
- Sequence and table-copy follow-up: 2,285 Node tests, 32 focused browser tests,
  23 Cloud/comment/Mermaid-copy regressions and 3 earlier-SDK prose checks passed.
  The focused run includes current-SDK table copy while its host is in comment
  mode. The old-shell service-worker upgrade can use the new cell copy control.
- 328 combined Node checks plus 28 slide-model checks passed.
- 192-test browser regression run passed. Final rich-element/list gate passed all 54 cases, and the final slide/diagram gate passed all 38 cases.
- 117 existing spreadsheet/workbook cases and the SDK host-isolation smoke passed.
- The example's two slides and both sheets passed CLI verification.
- SDK snapshot/manifests, service-worker old-shell upgrade and diff checks passed.
- One earlier mobile list run ended in a Chromium target crash while waiting for layout stability. Three isolated repeats and the complete final 54-case gate passed afterward.
