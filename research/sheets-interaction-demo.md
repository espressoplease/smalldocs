---
title: Sheets - everything you can do
tags: [sheets-v1, demo]
---

# Sheets - everything you can do

A `cells` block turns CSV inside markdown into a spreadsheet. This doc lists
every interaction that exists today, with sheets to try them on. Two places to
interact:

- **Inline** - the grid in the document. Read-only data, but you can select,
  sort, resize, and copy.
- **Fullscreen** - click the expand icon in a sheet's top bar. This is the
  editable spreadsheet: type, write formulas, undo, paste.

Nothing you do here changes the document or any file. Edits live in the page
and are gone on reload.

**The practice sheet.** Use this one for everything below. The Total column
and Total row are live formulas - the grid computes them when it renders.
Hover a computed cell to see its formula.

```cells
format: B=, C=$ D=$
Item,Qty,Unit Price,Total
Laptop,12,1100,=B2*C2
Monitor,30,280,=B3*C3
Keyboard,45,90,=B4*C4
Dock,18,210,=B5*C5
Total,=SUM(B2:B5),,=SUM(D2:D5)
```

---

**Inline - select.** Click a cell. Its column letter and row number light up,
and the top bar shows its address (like `B3`).

**Inline - select a range.** Drag across cells, or Shift+Click, or
Shift+Arrow. The top bar shows the span (like `B2:C4`).

**Inline - select a whole column or row.** Click its letter or number.

**Inline - move with the keyboard.** Arrow keys move the selection. Cmd+Arrow
(Ctrl on Windows) jumps to the far edge. Esc clears the selection.

**Inline - sort.** Hover a column letter: an arrow appears on its right
showing what a click will do (up = sort ascending, down = descending, x =
clear). The current sort stays visible as a colored arrow. The header row
stays pinned. Sorting only reorders the view - the document is untouched.
Formula cells (like the Total column above) sort by their computed value,
and each value stays with its row.

**Inline - resize a column.** Drag the right edge of its column letter.

**Inline - copy.** The copy icon in the top bar copies the whole sheet as CSV.
When something is selected, a second button appears that copies just the
selection.

**Inline - expand.** The expand icon opens the sheet fullscreen - that is
where editing lives. Everything below happens there.

---

**Fullscreen - type to edit.** Click a cell and start typing - an editor opens
with what you typed. Enter commits and moves down, Tab commits and moves
right, Shift+ goes the other way, Esc cancels.

**Fullscreen - edit what is there.** Double-click a cell (or press Enter / F2
on it) to open it with its current value.

**Fullscreen - the formula bar.** The wide field at the top edits the active
cell. Click a cell, type into the bar, press Enter. The name box to its left
shows the address of what is selected.

**Fullscreen - the stats footer.** Select a range of numbers - the bottom
right shows their Sum, Avg, Min, Max, and Count.

**Fullscreen - write formulas.** Start a cell with `=`. Supported:

- arithmetic: `=B2*C2`, `=(A1+B1)/2`, percentages like `=B2*10%`
- aggregates: `SUM` `AVERAGE` `MIN` `MAX` `COUNT` `COUNTA` `PRODUCT`
- functions: `ROUND(x,n)` `ABS(x)` `IF(condition, then, else)`
- comparisons inside IF: `=IF(B2>20, 1, 0)`

A broken formula shows a short red code (`#DIV/0!`, `#NAME?`, `#CIRC!` for
circular references) instead of breaking the sheet.

**Fullscreen - point at cells while writing a formula.** This is the newest
feature. While typing a formula, the arrow keys stop moving the text caret and
instead point at cells in the grid, writing their reference into the formula
for you:

1. Click an empty cell and type `=SUM(`
2. Press the up arrow a few times - watch `B5`, `B4`, `B3` appear in the
   formula, and the pointed cell highlight violet in the grid
3. Hold Shift and press up - the reference grows into a range like `B3:B5`
4. Type `)` and press Enter - done, no cell names typed by hand

The other way to build a range: arrow to the start of the range, type `:`,
then arrow to the end. And after any operator (`+`, `*`, a comma in a
function), the arrows are armed again for the next reference. This works in
the cell editor and in the formula bar.

**Fullscreen - clear cells.** Select a cell or range, press Delete or
Backspace.

**Fullscreen - undo / redo.** Cmd+Z / Shift+Cmd+Z (Ctrl+Z / Ctrl+Y on
Windows). Every edit, clear, and paste is undoable.

**Fullscreen - paste a block of data.** Copy cells from Excel, Google Sheets,
or any CSV text, click a cell, and paste. The block lands with its top-left
corner at your selection.

**Fullscreen - close.** Esc or the X. Your edits show in the inline grid in
the document - but they are display-only and vanish on reload.

---

**A second sheet to play with.** Monthly numbers, no formulas - good for
trying sort, ranges, and the stats footer, or for building your own formulas
fullscreen. Try this one fullscreen: click an empty cell below Costs, type
`=SUM(`, arrow up to March's costs, Shift+Arrow up to January's, type `)`,
Enter.

```cells
format: B=$ C=$ D=%
Month,Revenue,Costs,Margin
January,42000,31000,0.262
February,38500,29800,0.226
March,51200,33400,0.348
April,47800,32100,0.328
May,55400,34800,0.372
June,49100,33900,0.310
```

---

**Loading a real CSV file.** A cells block can reference a file instead of
holding data:

    ```cells
    {{path/to/report.csv}}
    ```

When you open the doc with `sdoc`, the file's contents are baked into the
document so a shared link always shows the data. `sdoc report.csv` also opens
a CSV directly as a sheet.

**What editing is not.** Edits never write back to this markdown file, and
never touch a referenced CSV. The fullscreen sheet is for exploring numbers -
what-if changes, quick sums, scratch calculations - not for maintaining data.
The document stays exactly as the author wrote it.
