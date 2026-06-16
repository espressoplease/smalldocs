---
title: 2026 Household Budget (tabbed)
cells-tabs: tabbed
---

# 2026 Household Budget

The same three-tab workbook, rendered as one pane - click a tab along the top to
switch sheets. **Summary** still computes itself from **Income** and
**Expenses** with cross-tab formulas.

```cells Income
format: B=$
Source,Monthly
Salary,5200
Freelance,800
Interest,50
Total,=SUM(B2:B4)
```

```cells Expenses
format: B=$ C=$ D=$
Category,Jan,Feb,Mar
Rent,1800,1800,1800
Groceries,600,650,580
Transport,220,240,210
Fun,300,180,260
Total,=SUM(B2:B5),=SUM(C2:C5),=SUM(D2:D5)
```

```cells Summary
Metric,Amount
Monthly income,=Income!B5
Avg monthly spend,"=ROUND(AVERAGE(Expenses!B6:D6),0)"
Monthly savings,=B2-B3
Lowest month spend,=MIN(Expenses!B6:D6)
Highest month spend,=MAX(Expenses!B6:D6)
Savings rate %,"=ROUND(B4/B2*100,1)"
```
