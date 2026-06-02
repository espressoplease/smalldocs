---
title: Sheets - three things to test
tags: [sheets-v1, demo]
---

# Sheets - three things to test

Three features landed since you last looked. Each one lives in the
fullscreen sheet: click the expand icon in the practice sheet's top bar,
then work through the list.

**The practice sheet.** The Total column and Total row are live formulas.

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

**1. Drag to fill.** Select a cell and a small green square appears on its
bottom-right corner. Drag the square to fill the cells you pass over.

Try it:

1. Open the sheet fullscreen.
2. Select D3:D5 and press Delete - the Total column is now mostly empty.
3. Click D2 (it still holds `=B2*C2`).
4. Drag its green corner square down to D5.

Each filled cell gets the formula shifted to its own row: D3 becomes
`=B3*C3`, D4 becomes `=B4*C4`, and so on. The column rebuilds itself.

Also try it on plain numbers: type `1` in an empty cell, `2` below it,
select both, and drag the square down - the series continues 3, 4, 5.

**2. Copy and paste formulas.** Cmd+C copies selected cells with their
formulas. Pasting adjusts every reference to its new position.

Try it:

1. Click D2 (`=B2*C2`) and press Cmd+C.
2. Select D3:D5.
3. Press Cmd+V.

Each cell gets the formula pointed at its own row - same result as the
fill, different gesture. Pasting from outside (Excel, Google Sheets, plain
text) still lands as values, not formulas.

**3. Formula view.** When a sheet has formulas, an `=fx` button appears in
the fullscreen top bar.

Try it:

1. Click `=fx` - every formula cell shows its source (`=B2*C2`) instead of
   its result. The whole sheet's logic is visible at once.
2. Double-click any formula cell while in this view and edit it in place.
3. Click `=fx` again to go back to values.

---

**How the first two connect.** Fill and paste share one engine: a formula's
cell references shift by how far the formula moved. Copy `=B2*C2` one row
down and it becomes `=B3*C3`; move it somewhere a reference can't follow
(above row 1) and that reference shows `#REF!` instead of pointing at the
wrong cell.
