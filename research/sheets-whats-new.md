---
title: Sheets - what to test
tags: [sheets-v1, demo]
---

# Sheets - what to test

Two new inline features just landed (top), and three fullscreen features from
the last round (below) in case you have not tried them yet. Everything works
on this practice sheet - the Total column and Total row are live formulas.

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

## New today

**1. Inline selection stats.** Select a range of numbers in the grid above -
drag across cells, or click one and Shift+Click another. A strip slides open
between the top bar and the grid showing Sum, Avg, Min, Max, and Count.

Things to check:

- Select the Total column's data (D2 to D5) - the Sum counts the computed
  values, not the formula text.
- Click a single cell - the strip closes (the value is already visible).
- Press Esc - the strip closes.

**2. The edited pill.** Open the sheet fullscreen (expand icon), change any
number (double-click a cell, type, Enter), then close. An "edited" pill now
sits in the sheet's top bar.

Things to check:

- The inline grid shows your edit; the pill says "edited".
- Click the pill - the grid flips to the document's original data and the
  pill says "original".
- Click it again - back to your edits.
- While viewing the original, click expand - the fullscreen sheet opens with
  your edits (editing always resumes from them), and the inline view flips
  back to "edited" to match.
- Edit a number the Total depends on - the Total recomputes in whichever
  view is showing.

---

## From the last round

**3. Drag to fill.** Fullscreen: select a cell and a small green square
appears on its corner. Try it: select D3:D5, press Delete, click D2, drag its
corner square down to D5 - the formulas rebuild, each pointed at its own row.

**4. Copy and paste formulas.** Fullscreen: click D2, Cmd+C, select D3:D5,
Cmd+V - each cell gets the formula adjusted to its row. Pasting from outside
(Excel, plain text) still lands as values.

**5. Formula view.** Fullscreen: the `=fx` button in the top bar flips every
formula cell between its result and its source. Formulas stay editable in
place while the sources are showing.
