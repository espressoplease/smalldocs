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
clear). The current sort stays visible as a colored arrow. Sorting only
reorders the view - the document is untouched. Three kinds of rows are
treated differently:

- The header row stays pinned at the top.
- Data rows sort by value; formula cells (like the Total column above) sort
  by their computed value, and each value stays with its row.
- A summary row - one whose formula adds up a range of other rows, like the
  Total row's `=SUM(D2:D5)` - stays pinned at the bottom. Sorting never
  jumbles it into the data.

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

**Fullscreen - selection stats.** Select a range of numbers - their Sum, Avg,
Min, Max, and Count appear in the header bar, right next to the selection
address. Computed formula cells count by their value, so selecting the Total
column above includes the $29,430 total, not the formula text.

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

**Fullscreen - drag to fill.** Select a cell or range and a small green
square appears on its corner. Drag it down (or across) to fill the cells you
pass over: a formula's references shift as it goes (`=B2*C2` becomes
`=B3*C3`, `=B4*C4`...), plain values repeat, and a run of numbers like 1, 2
continues as 3, 4, 5. Try it: in the practice sheet, the Total column's
formula can rebuild itself - clear D3:D5 (select, press Delete), click D2,
then drag its corner square down.

**Fullscreen - copy and paste formulas.** Cmd+C (Ctrl+C on Windows) copies
the selected cells, formulas included. Paste them somewhere else and every
formula adjusts to its new position - copy `=B2*C2`, select five cells below,
paste, and each one multiplies its own row. External data (from Excel, Google
Sheets, any CSV) still pastes as plain values.

**Fullscreen - formula view.** When a sheet contains formulas, an `=fx`
button appears in the top bar. Click it and every formula cell shows its
source (`=B2*C2`) instead of its result - the whole sheet's logic at a
glance, and you can edit any formula in place. Click again to go back to
values.

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
