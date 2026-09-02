# Computed cells

Use a `cells` fence containing CSV when readers should inspect data or calculations. Values beginning with `=` are formulas.

````md
```cells
Item,Price,Quantity,Total
Laptop,1200,2,=B2*C2
Monitor,340,4,=B3*C3
Dock,89,4,=B4*C4
Total,,,"=ROUND(SUM(D2:D4), 0)"
```
````

The first row is treated as the header by default. Standard CSV quoting is supported. Quote formulas that contain commas, as in the `ROUND` total above. Double quotation marks inside a quoted formula: `"=IF(D2>1000, ""Review"", ""OK"")"`. Write numbers such as `1200.50` in the source, then use formatting directives to add presentation details such as thousands separators.

## Formula functions

Supported functions include `SUM`, `AVERAGE`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `PRODUCT`, `ROUND`, `ABS`, and `IF`. Formulas can use arithmetic, comparisons, cell references, and ranges.

```text
=B2*C2
=SUM(D2:D8)
=ROUND(B2*(1+C2), 2)
=IF(D2>1000, "Review", "OK")
```

## Named sheets

Name a cells block after the fence to create workbook tabs:

````md
```cells Expenses
Item,Amount
Hosting,120
Research,480
Total,=SUM(B2:B3)
```

```cells Summary
Metric,Value
Total expenses,=Expenses!B4
```
````

Each workbook recalculates in the browser. When the `sdoc` CLI is available, run `sdoc cells verify file.md --json` before handoff to catch formula errors and inspect computed results.

Use an ordinary Markdown table when no formula, selection, sorting, workbook, or download behavior is needed.
