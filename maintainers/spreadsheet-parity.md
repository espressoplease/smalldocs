# Spreadsheet parity

SmallDocs sheets have two jobs:

1. Render and edit modest CSV-backed sheets immediately.
2. Export a workbook that Excel opens with the same values, formulas, links, and types.

They do not need to reproduce Excel's complete grid UI in the initial page payload.

## Current native tier

The native engine stays dependency-free and synchronous. It supports:

- numeric, text, boolean, and error values
- relative, absolute, and mixed A1 references
- quoted and punctuation-bearing sheet names
- cross-sheet references and ranges with cycle detection
- 49 function names across aggregation, math, logic, text, conditional aggregation, lookup, date, and finance
- formula-aware copy, paste, fill, undo, and redo
- typed Excel caches for number, text, boolean, and standard error results

Excel export safety is separate from calculation. A live formula requires a fully parsed AST whose complete function set is on the computational allowlist. A cached result is never proof that a formula is safe. This prevents an unchosen IF branch from hiding a network-capable Excel function.

Large sparse ranges are intersected with populated model cells before aggregate evaluation. Excel address bounds are validated during tokenization.

## Advanced tier experiment

IronCalc 0.8.4 was tested as a lazy whole-workbook engine.

- Assets: 66 KB JavaScript and 1.97 MB WASM, about 667 KB compressed.
- Formula surface: about 495 variants in current source.
- Load-independent initialization: 3.15 ms after WASM bytes were available.
- Batched import: 5,000 values and 5,000 formulas in 32.4 ms.
- Recalculation: 6.0 ms for those 5,000 formulas.
- Unbatched writes took about 27 seconds, so pause and resume evaluation is mandatory.

It correctly handled XLOOKUP, LET, SUMIFS, dynamic arrays, quoted cross-sheet references, sheet rename, row insertion, undo, autofill, and mixed references.

Do not ship the adapter yet. The published WASM binding exposes formatted display text and value type, but not the exact unformatted computed scalar. Parsing localized display strings would corrupt statistics and Excel caches. Add a small tagged raw-value binding upstream or in a pinned local build first.

When that binding exists:

1. Add an engine facade for workbook recalculation, formula shifting, and formula detection so the UI does not depend directly on the native implementation.
2. Move Excel export analysis into an engine-independent policy that consumes formula tokens or ASTs, not evaluator result metadata.
3. Keep the native engine for workbooks using only the core grammar.
4. Scan the whole workbook before calculation.
5. Lazy-load pinned local IronCalc assets when advanced syntax is present or advanced editing opens.
6. Promote the complete workbook, not individual formulas, so one workbook never mixes semantics.
7. Batch model import behind pause and resume evaluation.
8. Keep the SmallDocs DOM grid as the view and Markdown CSV as persistence.
9. Keep the explicit Excel export allowlist. IronCalc calculation success does not authorize HYPERLINK or other external behavior in an exported workbook.

## Editing sequence

The next editing work should be transactional and workbook-wide:

1. Move clipboard source metadata from one editor instance to the fullscreen workbook so formula-aware copy survives tab changes.
2. Add Cut and cross-tab paste as one undoable transaction.
3. Add row and column insert/delete using workbook-wide structural reference rewriting.
4. Add an explicit Apply to document action before persistent formatting. Scratch edits currently remain in memory and are included in Excel downloads, but they do not rewrite the Markdown fence.
5. Add number formats, alignment, and column widths before fonts, colors, and borders.

Structural edits must not reuse relative copy shifting. Insertion and deletion update formulas in sibling sheets, including absolute references, and need workbook-level undo.

## Export validation

Every export change needs three layers of coverage:

1. Pure tests for formula parsing, safety, name mapping, types, and number formats.
2. ZIP and XML assertions for the generated package.
3. A real consumer round trip through Excel or LibreOffice.

LibreOffice successfully opened, recalculated, converted, and re-opened a generated multi-sheet workbook containing text, boolean, SUMIF, quoted cross-sheet links, and typed caches. LibreOffice does not implement XLOOKUP in the tested version and recalculates it as `#NAME?`; the export uses Excel's `_xlfn.XLOOKUP` storage form and retains the SmallDocs numeric cache before another application recalculates it.
