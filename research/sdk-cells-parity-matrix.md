# SDK spreadsheet parity matrix

## Goal

The production reader and browser SDK must mount the same canonical spreadsheet components. The SDK supplies lifecycle, security, asset, clipboard, download, and overlay services. It must not maintain a second spreadsheet renderer.

## Intended differences

- Production may resolve `{{file.csv}}` through the local CLI bridge. The SDK has no filesystem capability and shows the canonical unresolved-reference message unless a future explicit host resolver is designed.
- Production document export may convert a grid into an HTML table. The rendering-only SDK must preserve XLSX downloads and copy behavior. Whole-document export is not part of this slice.
- Spreadsheet edits remain an ephemeral fullscreen scratch model. They do not edit the Markdown or call a host persistence API.
- SDK `controls.copy`, `controls.fullscreen`, and `controls.download` options remove the corresponding canonical controls. They do not select alternate components.

## Production behavior to preserve

### Parsing, limits, and display

- CSV parsing, quoted values, embedded newlines, `<br>` normalization, ragged-row padding, and text-only cell painting.
- Empty, malformed, unresolved-reference, and over-limit states remain readable.
- The production limits remain aligned: 256K UTF-16 characters per block, 50 processed cell blocks per document, 200 columns and 5,000 painted inline cells, 1,000 columns and 60,000 painted fullscreen cells. Block 51 and later remain readable source, matching production.
- Number, text, boolean, empty, negative, and formula-error classes and display values match production.
- Header detection and column, row, and cell format directives match production.
- Narrow sheets hug their content. Wide sheets scroll without losing the row-number gutter or last-column boundary.

### Workbook behavior

- A lone unnamed sheet has no caption or tab strip.
- A named sheet has its production caption.
- Multiple sheets are stacked by default and use production captions.
- `cells-tabs: tabbed` produces the canonical bottom tab strip.
- Named workbooks are isolated. Cross-sheet formulas resolve only inside their workbook.
- Duplicate sheet names retain the production warning and first-name resolution behavior.
- Two reader instances may reuse identical workbook and sheet names without sharing models, formulas, selection, or edits.

### Inline interaction

- Single-cell, rectangular drag, shift, whole-row, and whole-column selection.
- Arrow movement, Ctrl/Cmd edge jumps, shift extension, focus entry at A1, Escape clearing, and horizontal edge auto-scroll.
- Active cell/range, axis highlights, address, copy label, and Sum, Avg, Min, Max, Count statistics.
- Outside clicks clear an inline selection. The sheet's own toolbar does not.
- Copy whole sheet, selected range, or selected cell with computed values and canonical feedback state.
- Sort ascending, descending, and clear. Formula columns sort by computed value while document order remains unchanged for export.
- Column resize and hover preview states match production.
- Trailing formula-summary rows remain pinned during sort.
- Copy follows the sorted view. XLSX export follows source order.

### Fullscreen and editing

- The exact production Sheet dialog, topbar, formula bar, focus grid, workbook tabs, formula toggle, copy actions, workbook download, mobile layout, Escape behavior, and focus restoration.
- Fullscreen pads beyond the used range within the production cap.
- Typing, double-click, and formula-bar editing; commit and cancel; Delete; undo and redo.
- Formula point mode, reference-range highlighting, fill handle, keyboard fill, arithmetic-series fill, and shifted formula references.
- Internal formula-aware copy/paste and external scalar, CSV, and TSV paste.
- The edited/original toggle and inline repaint on close, including growth beyond the original extent and cross-sheet recalculation.
- Clicking overlay chrome does not clear the fullscreen selection.

### Downloads and lazy loading

- Per-sheet and workbook XLSX downloads contain live formulas, current edited values, production sheet naming, and document-order rows.
- Reviewed formulas remain live in XLSX. Unsupported or syntax-broken formulas export as inert text.
- Fullscreen/editor/XLSX assets load only after the corresponding action in the SDK. Plain Markdown loading no cells assets is an SDK performance target, not current production parity.
- Repeated actions share one asset request. A failed lazy load has a visible retryable control state and does not lose the source.

## Architecture gates

- Create one reader-owned cells controller with an instance-local workbook registry, focus state, drag state, observers, timers, and cleanup list.
- Inject the pure cells model, formula engine, XLSX writer, clipboard, download, overlay, parser metadata, and optional reference resolver.
- Do not read `window.SDocs`, `#_sd_rendered`, document-wide spreadsheet collections, or mutable ambient `window.SDocCells*` values after construction.
- Document listeners may coordinate pointer or clipboard work, but they must filter to the owning reader and be removed by `destroy()` even during an active edit, drag, fill, or resize.
- Every ResizeObserver, animation frame, timeout, object URL, temporary editor input, and overlay has an idempotent cleanup path.
- Production creates the first controller through a compatibility adapter. The SDK creates another controller from the same files.
- Add the already-copied cells model, formula, and XLSX sources to the immutable SDK manifest immediately. Snapshot UI JavaScript and CSS only after they no longer capture global application state. Generated SDK snapshots are not edited directly.
- Preserve text-only untrusted content. Hardcoded icon markup uses the SDK Trusted Types helper. Cell content, names, formulas, errors, and filenames cannot become executable HTML or unsafe paths.
- Canonical CSS is scoped beneath the reader or fullscreen owner, retains the production `--md-*` behavior, accepts SDK variable mapping, and does not style host tables, buttons, inputs, or grids.
- Host CSS overrides remain possible through the mount without requiring Shadow DOM.

## Delivery sequence

1. Add production characterizations and manifest coverage for the pure cells model, formula engine, and XLSX writer.
2. Extract a pure workbook planner plus an instance-owned controller shell. Production becomes its first consumer. This slice creates no listeners, observers, overlays, object URLs, or DOM components.
3. Add a spreadsheet parity suite before changing visible canonical components.
4. Extract the canonical grid, workbook registry, error handling, limits, formatting, sorting, copy controls, stats, and tabbed-pane behavior. Keep production green.
5. Snapshot those canonical sources and CSS, then replace the SDK table approximation. Prove inline production-to-SDK parity and two-instance isolation.
6. Extract instance-owned selection with cancellation for active drag and resize operations.
7. Extract the canonical fullscreen controller. Choose one owner for topbar, Escape, focus restoration, scroll locking, and body classes.
8. Extract the editor as an instance-bound controller. Define and test whether update/destroy cancels or commits an open edit.
9. Connect canonical XLSX actions and lazy loading with stale-operation guards, then remove obsolete SDK spreadsheet markup and styles.
10. Run the full production suite, SDK customer suite, strict security checks, and all spreadsheet parity states.

## Required parity states

1. Resting single sheet, formatted values, formulas, headers, and canonical toolbar.
2. Hover sort preview. Keyboard focus-visible sort controls are a later accessibility improvement because production sort controls are currently non-focusable spans.
3. Single selection, drag range, keyboard range, row selection, column selection, and outside-click clear.
4. Ascending, descending, and cleared computed-formula sort.
5. Named stacked sheets, inline tabs, duplicate names, cross-sheet formulas, and two isolated workbooks.
6. Empty, unresolved-reference, source-limit, block-limit, inline-limit, and fullscreen-limit states. CSV parsing is intentionally lenient, so malformed input is not a normal production state.
7. Fullscreen resting view, workbook tab switch, selected range statistics, formula view, and mobile chrome.
8. Edit commit/cancel, formula-bar edit, formula point mode, delete, undo/redo, internal paste, external paste, fill handle, keyboard fill, and edited/original toggle.
9. Copy values, formulas, selection, and feedback state.
10. Single-sheet and workbook XLSX filename, signature, formulas, edited values, and sheet ordering.
11. Update and destroy while inline, fullscreen, editing, dragging, resizing, and lazy-loading.
12. Two simultaneous SDK readers with the same workbook names, then update and destroy only one.
13. Controls disabled independently, strict Trusted Types, hostile cell/name content, host CSS overrides, aggressive host resets, and no style leakage.

## Characterized production behavior versus improvements

- Current production loads the base cells assets on every reader page. Content-driven SDK loading is the target.
- Current production uses a character-count source cap and silently leaves blocks after the fiftieth as code. Preserve these behaviors during extraction before considering clearer diagnostics.
- Current production does not completely tear down document listeners, observers, active drags, or pending downloads. Complete instance cleanup is required for the SDK boundary and must be introduced with explicit regression tests.
- Current production closes fullscreen by committing an active editor. SDK update and destroy behavior must be decided and tested separately rather than inferred from close.
