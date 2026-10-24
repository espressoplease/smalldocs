---
title: Profitable growth can run out of cash
cells-tabs: tabbed
styles:
  background: "#F6F0EC"
  color: "#432E29"
  blocks:
    background: "#EDDFD6"
    color: "#432E29"
  chart:
    accent: "#A35C42"
---

~~~slide
@extends cover
#eyebrow: FINANCE / FIVE SLIDES
#title: Profitable growth can run out of cash
#subtitle: A worked example of the gap between recognizing revenue and collecting it.
#meta: Illustrative model, USD thousands
~~~

~~~slide
grid 16 9 bg=#F6F0EC
r 1 0.6 14 1 text=subtitle align=left color=#432E29 | One profitable order still needs funding
r 1 2.6 3.7 2.2 #buy fill=#F1DDCF color=#432E29 radius=0.2 | **Day 0** buy inventory for $60k
r 6.15 2.6 3.7 2.2 #sell fill=#F1DDCF color=#432E29 radius=0.2 | **Day 30** sell for $100k on credit
r 11.3 2.6 3.7 2.2 #collect fill=#DDEBE4 color=#234436 radius=0.2 | **Day 60** collect $100k
a @buy.right @sell.left color=#A35C42
a @sell.right @collect.left color=#A35C42
r 1 6.1 14 1.5 text=body align=left color=#432E29 | Gross profit is $40k. If the supplier is paid on day 0, $60k is tied up until collection.
~~~

~~~slide
grid 16 9 bg=#F6F0EC
r 1 0.6 14 1 text=subtitle align=left color=#432E29 | A timing gap becomes a balance-sheet requirement
r 1 2.4 4 2.5 fill=#F1DDCF color=#432E29 radius=0.2 | **Inventory** 30 days at cost = $60k
r 6 2.4 4 2.5 fill=#F1DDCF color=#432E29 radius=0.2 | **Receivables** 30 days at sales = $100k
r 11 2.4 4 2.5 fill=#DDEBE4 color=#234436 radius=0.2 | **Payables** 15 days at cost = $30k
r 1 6.1 14 1.5 text=body align=left color=#432E29 | At $100k monthly sales and $60k monthly cost: working capital = $60k + $100k - $30k = $130k.
~~~

~~~slide
grid 16 9 bg=#F6F0EC
r 1 0.6 14 1 text=subtitle align=left color=#432E29 | Double the run rate, double the funding
r 1 2.4 6.5 2.8 fill=#F1DDCF color=#432E29 radius=0.2 padding=0.35 | **Before growth** $100k monthly sales require $130k of operating working capital.
r 8.5 2.4 6.5 2.8 fill=#F1DDCF color=#432E29 radius=0.2 padding=0.35 | **After growth** $200k monthly sales require $260k at the same margin and payment terms.
r 1 6.2 14 1.5 text=body align=left color=#432E29 | The additional $130k is cash absorbed during the transition, not a recurring monthly expense.
~~~

~~~slide
grid 16 9 bg=#F6F0EC
r 1 0.6 14 1 text=subtitle align=left color=#432E29 | The most useful question is about the terms
r 1 2.5 6.5 2.8 fill=#DDEBE4 color=#234436 radius=0.2 padding=0.35 | **Receivables: 30 to 15 days** At the grown run rate, funding falls by $100k.
r 8.5 2.5 6.5 2.8 fill=#DDEBE4 color=#234436 radius=0.2 padding=0.35 | **Payables: 15 to 30 days** At the grown run rate, funding falls by $60k.
r 1 6.2 14 1.5 text=body align=left color=#432E29 | Faster collection and later payment both release cash. Their feasibility and commercial costs need separate evaluation.
~~~

## Inspect the model

All amounts are USD thousands. This is a hypothetical steady-state model with 30-day months, uniform daily sales, inventory valued at cost and receivables valued at sales. The order timeline illustrates the mechanism; the balance sheet below represents a continuous stream of orders. It excludes tax, overhead, financing and bad debts.

~~~cells WorkingCapital/Inputs
Assumption,Before growth,After growth
Monthly sales,100,200
Cost as fraction of sales,0.6,0.6
Days per month,30,30
Inventory days,30,30
Receivable days,30,30
Payable days,15,15
~~~

~~~cells WorkingCapital/Model
Metric,Before growth,After growth
Daily sales,=Inputs!B2/Inputs!B4,=Inputs!C2/Inputs!C4
Daily merchandise cost,=B2*Inputs!B3,=C2*Inputs!C3
Inventory,=B3*Inputs!B5,=C3*Inputs!C5
Receivables,=B2*Inputs!B6,=C2*Inputs!C6
Payables,=B3*Inputs!B7,=C3*Inputs!C7
Operating working capital,=B4+B5-B6,=C4+C5-C6
Additional funding needed,,=C7-B7
Monthly gross profit,=Inputs!B2*(1-Inputs!B3),=Inputs!C2*(1-Inputs!C3)
~~~

~~~chart
{
  "type": "bar",
  "title": "A stock of funding and a monthly flow of profit, USD thousands",
  "labels": ["Before growth", "After growth"],
  "datasets": [
    {"label": "Working capital balance", "values": [130, 260]},
    {"label": "Monthly gross profit", "values": [40, 80]}
  ],
  "format": "number",
  "beginAtZero": true
}
~~~

The chart compares a balance with a monthly flow deliberately. Do not subtract one from the other without choosing a time horizon and modeling the transition. A profitable order book can require more funding before its additional profit turns into cash.

## Scope and accounting reference

These values are constructed examples, not company data or a forecast. Operating working capital here is inventory plus trade receivables minus trade payables, rather than total current assets minus current liabilities. For the distinction between income and operating cash adjustments in actual statements, see [Costco's audited cash-flow statement, printed page 39](https://s201.q4cdn.com/287523651/files/doc_financials/2025/ar/COST-Annual-Report-2025.pdf#page=45).
