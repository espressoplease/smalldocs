---
title: Q1 SaaS Sales Dashboard
---

# Q1 SaaS Sales Dashboard

Five tabs working together. **Jan**, **Feb** and **Mar** each compute revenue
per product (`Units × Price`). **Quarter** rolls the three months up per
product, and **Insights** reads from Quarter and the monthly tabs for the
headline numbers - cross-tab references two levels deep.

## January

Revenue is `Units × Price` per row; the Total sums the Revenue column. The
Price and Revenue columns are formatted as currency.

```cells Jan
format: C=$ D=$
Product,Units,Price,Revenue
Starter,120,29,=B2*C2
Pro,80,59,=B3*C3
Enterprise,15,199,=B4*C4
Total,,,=SUM(D2:D4)
```

## February

```cells Feb
format: C=$ D=$
Product,Units,Price,Revenue
Starter,140,29,=B2*C2
Pro,95,59,=B3*C3
Enterprise,18,199,=B4*C4
Total,,,=SUM(D2:D4)
```

## March

```cells Mar
format: C=$ D=$
Product,Units,Price,Revenue
Starter,165,29,=B2*C2
Pro,110,59,=B3*C3
Enterprise,22,199,=B4*C4
Total,,,=SUM(D2:D4)
```

## Quarter

Each cell reaches into a monthly tab - `Jan!D2` is January's Starter revenue -
and the Q1 Total column sums across the three months for each product.

```cells Quarter
format: B=$ C=$ D=$ E=$
Product,Jan,Feb,Mar,Q1 Total
Starter,=Jan!D2,=Feb!D2,=Mar!D2,=SUM(B2:D2)
Pro,=Jan!D3,=Feb!D3,=Mar!D3,=SUM(B3:D3)
Enterprise,=Jan!D4,=Feb!D4,=Mar!D4,=SUM(B4:D4)
Total,=Jan!D5,=Feb!D5,=Mar!D5,=SUM(B5:D5)
```

## Insights

These read from **Quarter** (which itself reads the monthly tabs) and straight
from the monthly Totals - a reference chain two tabs deep.

```cells Insights
Metric,Value
Q1 revenue,=Quarter!E5
Top product Q1 revenue,=MAX(Quarter!E2:E4)
Mar vs Jan growth %,"=ROUND((Mar!D5-Jan!D5)/Jan!D5*100,1)"
Avg monthly revenue,"=ROUND(AVERAGE(Jan!D5,Feb!D5,Mar!D5),0)"
Best month revenue,"=MAX(Jan!D5,Feb!D5,Mar!D5)"
```
