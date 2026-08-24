---
title: Advanced spreadsheets
file: advanced-spreadsheets.md
cells-tabs: tabbed
---

# Advanced spreadsheets

SmallDocs has supported live spreadsheets for a long time: table-shaped text became a sortable, formula-aware sheet that could download to Excel.

This update takes them further. Agents can build linked workbooks, use deeper Excel-style formulas, edit fullscreen, verify results, and export every tab in one file.

## New things you can do

### Connect several sheets into one model

Split assumptions, source data, calculations, and summaries across linked tabs. Download from any tab to get the complete Excel workbook.

In this forecast, Assumptions and Sales feed the Model, which feeds the Dashboard.

```cells forecast/Assumptions
Parameter,Value
Corporate tax rate,0.21
Discount rate,0.08
Loan principal,250000
Annual interest rate,0.055
Loan term months,60
North growth,0.12
South growth,0.08
West growth,0.10
```

```cells forecast/Sales
format: D=$ E=$ F=$ G=$ H=$
Region,Product,Units,Price,Revenue,Unit cost,Cost,Gross profit
North,Platform,120,950,=C2*D2,410,=C2*F2,=E2-G2
South,Platform,90,950,=C3*D3,420,=C3*F3,=E3-G3
West,Platform,105,950,=C4*D4,415,=C4*F4,=E4-G4
North,Support,75,450,=C5*D5,140,=C5*F5,=E5-G5
South,Support,60,450,=C6*D6,140,=C6*F6,=E6-G6
West,Support,70,450,=C7*D7,140,=C7*F7,=E7-G7
Total,,,,=SUM(E2:E7),,=SUM(G2:G7),=SUM(H2:H7)
```

```cells forecast/Model
format: 1=plain 5=% 6=%
Metric,2026,2027,2028,2029,2030
Revenue,=Sales!E8,=B2*(1+$B$6),=C2*(1+$B$6),=D2*(1+$B$6),=E2*(1+$B$6)
Cost,=Sales!G8,=B3*(1+$B$6*0.65),=C3*(1+$B$6*0.65),=D3*(1+$B$6*0.65),=E3*(1+$B$6*0.65)
Gross profit,=B2-B3,=C2-C3,=D2-D3,=E2-E3,=F2-F3
Tax rate,=Assumptions!B2,=$B$5,=$B$5,=$B$5,=$B$5
Growth rate,=AVERAGE(Assumptions!B7:B9),=$B$6,=$B$6,=$B$6,=$B$6
Tax,"=MAX(0,B4*B5)","=MAX(0,C4*C5)","=MAX(0,D4*D5)","=MAX(0,E4*E5)","=MAX(0,F4*F5)"
Free cash,=B4-B7,=C4-C7,=D4-D7,=E4-E7,=F4-F7
Discount factor,=1/(1+Assumptions!$B$3)^(B$1-2025),=1/(1+Assumptions!$B$3)^(C$1-2025),=1/(1+Assumptions!$B$3)^(D$1-2025),=1/(1+Assumptions!$B$3)^(E$1-2025),=1/(1+Assumptions!$B$3)^(F$1-2025)
Present value,=B8*B9,=C8*C9,=D8*D9,=E8*E9,=F8*F9
```

```cells forecast/Dashboard
format: B=$ B4=%
Metric,Value,Status
Base revenue,=Model!B2,"=IF(B2=Sales!E8,""Linked"",""Review"")"
2030 revenue,=Model!F2,"=IF(B3>B2,""Growing"",""Review"")"
2026 gross margin,=Model!B4/Model!B2,"=IF(B4>0.5,""Healthy"",""Review"")"
Five-year free cash,=SUM(Model!B8:F8),"=IF(B5>0,""Positive"",""Review"")"
Present value,=SUM(Model!B10:F10),
Forecast NPV,"=NPV(Assumptions!B3,Model!C8:F8)+Model!B8",
Monthly debt payment,"=PMT(Assumptions!B5/12,Assumptions!B6,-Assumptions!B4)",
North revenue,"=SUMIF(Sales!A2:A7,""North"",Sales!E2:E7)",
Platform unit price,"=XLOOKUP(""Platform"",Sales!B2:B7,Sales!D2:D7)",
Summary label,"=CONCAT(""2030 revenue: "",ROUND(B3,0))",
```

Numbers now show up to two decimal places by default. Agents can apply currency, percent, plain, or fixed-decimal formats to a sheet, column, row, or cell. The formats carry into Excel.

Verified values before you edit:

- Base revenue: 391,500
- 2026 gross margin: about 59.32%
- North revenue: 147,750
- Platform unit price: 950

### Use deeper formulas and keep them useful in Excel

Use lookups, conditional totals, financial functions, error handling, text and boolean results, and absolute or mixed references. Supported formulas remain live in Excel; unsupported or unsafe formulas export as text. This lab also checks quoted references and Excel-safe sheet names.

```cells formula-lab/Quoted sheet?
Label,Value
Seed,100
Growth,0.075
Code,abc-123
Flag,=TRUE
```

```cells formula-lab/Formula Lab
Test,Formula,Expected
Quoted sheet link,='Quoted sheet?'!B2*2,200
Absolute reference,='Quoted sheet?'!$B$2*(1+'Quoted sheet?'!$B$3),107.5
Text formula,=UPPER('Quoted sheet?'!B4),ABC-123
Boolean formula,"=AND('Quoted sheet?'!B5,1<2)",TRUE
Error recovery,"=IFERROR(1/0,""Recovered"")",Recovered
Lookup,"=XLOOKUP(""Growth"",'Quoted sheet?'!A2:A5,'Quoted sheet?'!B2:B5)",0.075
```

### Edit sheets fullscreen

Expand a sheet to paste data, navigate with spreadsheet shortcuts, undo changes, and fill formulas or series. Relative references shift while anchored references stay fixed, and your edits are included in the download.

```cells editing-playground/Editing playground
format: C=$ D=$
Stage,Days,Daily cost,Cost
Research,5,600,=B2*C2
Build,20,850,=B3*C3
Launch,4,1000,=B4*C4
Total,,,=SUM(D2:D4)
```

## Try the complete flow

1. Edit a forecast assumption fullscreen and check the Dashboard.
2. Download the workbook, open it in Excel, and change another input.
3. Download Formula Lab separately to inspect its sheet names and typed formula results.

## Loaded when you need it

Inline sheets render and calculate immediately. Deeper tools wait until needed:

- Fullscreen editing loads the first time you select **Open fullscreen**.
- Excel generation loads the first time you select **Download workbook**.
- Later uses reuse the loaded modules.

This defers about 25.5 KB of compressed JavaScript; the core formula engine still loads upfront. A future calculation engine could use the same boundary, but none is included in this update.

## Prompts to try with an agent

Add your files, figures, and the decision you need to make.

> Turn this material into a multi-tab SmallDocs workbook with separate inputs, calculations, checks, and summaries. Link the tabs with formulas, verify the totals, and open it locally.

> Turn this analysis into an editable decision model with clear assumptions and scenarios. Use lookups, conditional calculations, and financial formulas where useful, add check cells, and run `sdoc cells verify`.

> Find related data across this project and build a linked SmallDocs workbook from it. Label editable inputs, use lookups and conditional formulas, test the links, and open it locally for a complete Excel export.
