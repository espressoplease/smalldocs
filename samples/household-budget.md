---
title: 2026 Household Budget
---

# 2026 Household Budget

A small workbook with three linked tabs. **Income** and **Expenses** hold the
raw numbers; **Summary** is computed entirely from the other two with cross-tab
formulas, so the headline figures keep themselves up to date.

## Income

A `format: B=$` line renders the Monthly column as currency. The Total is a
plain in-tab `SUM`.

```cells Income
format: B=$
Source,Monthly
Salary,5200
Freelance,800
Interest,50
Total,=SUM(B2:B4)
```

## Expenses

Three months of spending by category. Each month's Total sums its column.

```cells Expenses
format: B=$ C=$ D=$
Category,Jan,Feb,Mar
Rent,1800,1800,1800
Groceries,600,650,580
Transport,220,240,210
Fun,300,180,260
Total,=SUM(B2:B5),=SUM(C2:C5),=SUM(D2:D5)
```

## Summary

Every figure here reaches into another tab. `Income!B5` reads the income
total; `AVERAGE(Expenses!B6:D6)` averages the three monthly spend totals; and
the savings rows chain off the cells above them (`=B2-B3`, `=B4/B2*100`).

```cells Summary
Metric,Amount
Monthly income,=Income!B5
Avg monthly spend,"=ROUND(AVERAGE(Expenses!B6:D6),0)"
Monthly savings,=B2-B3
Lowest month spend,=MIN(Expenses!B6:D6)
Highest month spend,=MAX(Expenses!B6:D6)
Savings rate %,"=ROUND(B4/B2*100,1)"
```

Edit a number in **Income** or **Expenses** (open a tab fullscreen to edit),
and the Summary follows when the page re-renders.
