---
title: Excel export - a complex formula test
tags: [sheets-v1, demo]
---

# Excel export - a complex formula test

One sheet, every kind of formula the engine supports. The full test: click
the download icon in the sheet's toolbar, open the .xlsx in Excel, then
change a few Units or Price numbers - every formula below should recompute,
because they export as live Excel formulas, not frozen values.

**The model.** A sales sheet where every column past Price is computed:

- **Revenue** - per-row arithmetic: `=B2*C2`
- **Commission** - a percent literal inside ROUND: `=ROUND(D2*8.5%, 2)`
- **Bonus** - a conditional: `=IF(D2>=12000, 500, 0)` (deals of $12k or more
  earn a $500 bonus)
- **Net** - chained references: `=D2-E2+F2`
- **Total row** - `=SUM(...)` down each column
- **Analysis rows** - nested functions: `ROUND(AVG(...))`, `ABS(MAX()-MIN())`,
  a ratio of two computed totals, and compound growth with the power
  operator: `=ROUND(D7*1.07^3, 0)`

```cells
format: C=$ D=$ E=$ F=$ G=$
Rep,Units,Price,Revenue,Commission,Bonus,Net
Alice,142,89,=B2*C2,"=ROUND(D2*8.5%, 2)","=IF(D2>=12000, 500, 0)",=D2-E2+F2
Ben,98,115,=B3*C3,"=ROUND(D3*8.5%, 2)","=IF(D3>=12000, 500, 0)",=D3-E3+F3
Chloe,210,49,=B4*C4,"=ROUND(D4*8.5%, 2)","=IF(D4>=12000, 500, 0)",=D4-E4+F4
Dev,77,189,=B5*C5,"=ROUND(D5*8.5%, 2)","=IF(D5>=12000, 500, 0)",=D5-E5+F5
Esme,164,95,=B6*C6,"=ROUND(D6*8.5%, 2)","=IF(D6>=12000, 500, 0)",=D6-E6+F6
Total,=SUM(B2:B6),,=SUM(D2:D6),=SUM(E2:E6),=SUM(F2:F6),=SUM(G2:G6)
,,,,,,
Average deal,,,"=ROUND(AVG(D2:D6), 0)",,,
Best minus worst deal,,,=ABS(MAX(D2:D6)-MIN(D2:D6)),,,
Revenue per unit sold,,,"=ROUND(D7/B7, 2)",,,
Total in 3 yrs at 7% growth,,,"=ROUND(D7*1.07^3, 0)",,,
```

**What to check in Excel after downloading:**

1. Click any computed cell - the formula bar shows the formula, not a number.
2. `AVG` in our sheet arrives as Excel's `AVERAGE` (cell D9).
3. Change Chloe's Units (B4) to 400 - her Revenue, Commission, Bonus
   (she crosses the $12k threshold), Net, the Total row, and all four
   analysis rows update.
4. The $ columns keep their currency format.

**Things worth knowing:**

- Formulas with commas (`ROUND`, `IF`) are wrapped in quotes in the markdown
  source - standard CSV quoting, since a bare comma would split the cell.
- Each ```cells block is its own isolated sheet. A formula in one block
  cannot reference cells in another block - references only reach the
  block's own grid.
- The exported file uses the document's row order plus any fullscreen
  edits. Sorting a column changes the view, never the export.

**One more to try.** Edit this one fullscreen first (change some numbers,
add a formula of your own), then download - your edits travel into the
workbook:

```cells
format: B=$ C=$ D=%
Quarter,Budget,Actual,Used
Q1,25000,23400,=C2/B2
Q2,25000,27100,=C3/B3
Q3,30000,24800,=C4/B4
Q4,30000,,
Year,=SUM(B2:B5),=SUM(C2:C5),=C6/B6
```
