---
title: "Sheets in SDocs"
file: "cells-intro.md"
---

# Sheets in SDocs

SmallDocs now render spreadsheets. Put CSV inside a ```cells fenced block and
it shows up as a grid with column letters, row numbers, sorting, selection,
and live formulas. The sheet is part of the markdown file - no upload, no
separate spreadsheet app, and like every SmallDoc it travels in the URL.

```cells
format: B=, C=$ D=$
Item,Qty,Unit Price,Total
Laptop,12,1100,=B2*C2
Monitor,30,280,=B3*C3
Keyboard,45,90,=B4*C4
Dock,18,210,=B5*C5
Total,=SUM(B2:B5),,=SUM(D2:D5)
```

The Total column and Total row above are formulas, computed live in the
browser. Hover any computed cell to see its formula.

## Formulas

A cell starting with `=` is a formula. Arithmetic, cell references, ranges,
and a set of functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT,
ROUND, ABS, IF. Comparisons work inside IF. A formula that fails shows a
short error code instead of breaking the sheet.

```cells
Rep,Deals,Revenue,Commission,Bonus
Alice,14,128000,"=ROUND(C2*8.5%, 0)","=IF(C2>=100000, 5000, 0)"
Ben,9,86000,"=ROUND(C3*8.5%, 0)","=IF(C3>=100000, 5000, 0)"
Total,=SUM(B2:B3),=SUM(C2:C3),=SUM(D2:D3),=SUM(E2:E3)
```

## Select, sort, edit

- Drag across cells (or Shift+Click) and a strip below the grid shows
  Sum, Avg, Min, Max, and Count for the selection.
- Click a column letter to sort by that column. Sorting is a view - the
  document underneath never changes.
- The expand icon opens the sheet fullscreen with a formula bar and in-place
  editing: type into cells, write formulas, drag a cell's corner to fill,
  copy and paste with references adjusting per row. Edits are a scratch
  copy - the original document stays as written, and a pill on the inline
  sheet lets you flip between the two.

## Download as Excel

The download icon saves the sheet as a real .xlsx workbook. Formulas arrive
live - change a number in Excel and the totals recompute. Currency and
percent column formats carry over.

Only formulas the sheet itself evaluated export as live Excel formulas.
Anything outside the supported set exports as inert text, so a shared
document cannot smuggle an executable formula into your download.

## For your agent

Coding agents can hand you numbers as a working sheet instead of a static
table. Prompts that work today:

- "Summarize the quarterly costs in this repo as a cells block with a
  formula Total row, and sdoc it to me."
- "Turn results.csv into a sheet with a percent-change column."
- "Build a budget projection I can play with in Excel."

The next sdocs-dev CLI release adds `sdoc cells` (the full reference agents
read before writing a sheet) and `sdoc report.csv`, which opens a CSV file -
including one with formulas in it - directly as a sheet.
