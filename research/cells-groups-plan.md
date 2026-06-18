# Plan: Cells tab groups ("collections")

## Problem
`cells-tabs: tabbed` is one document-wide switch. Every ```cells block in the
doc merges into ONE tab strip; every sheet name shares ONE global namespace
(first-wins on collision); recalc / fullscreen / xlsx all treat the whole doc
as a single workbook. So a document cannot hold two independent tabbed
workbooks. In the pitch deck the Office-NPV model and our P&L model cannot both
be tabbed and separate. With the flag off they render as isolated stacked grids
(the "not a great look" screenshot).

## Goal
- A ```cells block can declare a group id. Blocks sharing a group id form one
  tabbed workbook: its own tab strip (placed where the group's first block
  sits), its own name namespace, its own cross-sheet formula scope, its own
  fullscreen view, its own single-file .xlsx export.
- Two groups on a page => two independent tabbed panes AND two separate .xlsx
  downloads, each a standalone workbook with working joined tabs.
- Fully backward compatible: existing docs behave exactly as today.

## Proposed DSL
Fence: ```cells <group>/<sheet>   e.g.  ```cells financials/Model
- First `/` splits group from sheet name. ```cells Model (no slash) = default
  group (id ""), sheet "Model" = today's behavior.
- Multi-word sheet names still allowed after the slash; group id is one token
  (no spaces, no slash).
- Normalized into the baked directive like today: sdoc-cells: name="Model"
  group="financials".
- (Considered group= key=value; rejected as heavier to author and ambiguous
  against the free-text name grammar. The slash reads like a folder, one token.)

## Default-group rule (backward compat)
A sheet with no explicit group belongs to the default group "". All ungrouped
sheets share that one group => today's doc-wide single-workbook behavior is
preserved byte-for-byte. Explicit group ids carve out separate workbooks.

## Changes by surface
1. DSL normalize - browser `sdocs-cells-ui.js` walkTokens (line ~39) + the CLI
   parallel: parse `cells <group>/<sheet>` -> bake name= + group=.
2. Model - `sdocs-cells.js` parseCells: peel `group` from directives ->
   model.group (default "").
3. Grouping - `processCells`: partition `sheets` by model.group preserving
   order. Per group: recalc with only that group's sheets; render. Tabbed flag
   -> one mountTabbedPane per group at the group's first block (other group
   blocks removed from flow). Stacked -> render in place as today.
   S.cellsWorkbook becomes per-group; cellsWorkbookFx(model) resolves against
   the model's own group.
4. Formula scope - recalcWorkbook already resolves within the array handed to
   it; hand it only the group's sheets. Cross-group name => #REF!.
5. Fullscreen - `sdocs-cells-focus.js`: expand shows the group's tab strip.
6. xlsx - `sdocs-cells-xlsx.js`: add buildXlsxWorkbook(sheets, fxGrids) ->
   multi-worksheet workbook.xml + rels + sheetN.xml; cross-sheet formulas
   translated to Excel Sheet!Ref ('Sheet Name'!A1 when the name has spaces).
   Fullscreen "Download workbook (.xlsx)" exports the whole group as one file,
   named from the group id.
7. CLI cells-verify - group-aware: banner names the group, resolve within
   group, --json includes group; optional --group <id> filter.
8. Docs - `sdoc cells` reference: group/sheet syntax, per-group tabbing,
   per-group xlsx.
9. Tests - node test-cells-xlsx (multi-sheet bytes + cross-sheet formula
   translation), grouping/resolution test (two groups; same sheet name in two
   groups stays isolated; cross-group ref = #REF!), playwright (two tabbed
   panes independent; each fullscreen xlsx download fires; isolation). Update
   CLAUDE.md cells notes.

## Open questions for review
1. Slash `group/sheet` vs `group=` key=value vs `#group` ?
2. Default-group merge (preserve doc-wide) vs each ungrouped sheet isolated?
3. Inline per-sheet xlsx button: export just that sheet (today) or the group?
   Or only the fullscreen "Download workbook" exports the group?
4. Strict cross-group #REF! vs lenient global-name fallback?
5. Anything in the xlsx multi-sheet path (shared strings, sheet rels, name
   sanitisation, Excel's 31-char sheet-name limit, illegal chars) that will
   bite?
