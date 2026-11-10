---
title: Costco's cash engine - a case study using audited 2025 accounts
cells-tabs: tabbed
styles:
  background: "#FAF5EB"
  color: "#3E3324"
  h2:
    color: "#785326"
  blocks:
    background: "#F1E6D2"
    color: "#3E3324"
  chart:
    accent: "#947039"
    palette:
      - "#947039"
      - "#3C7971"
      - "#637A9C"
---

# Costco's cash engine

**Historical case study: fiscal 2025, ended August 31, 2025. All financial amounts are USD millions unless stated otherwise.**

An income statement answers how much a business earned. A cash-flow statement answers why its cash moved. This case study reconciles the two, then tests how much cash a change in inventory or supplier payment timing could absorb.

> **Calculated result:** Operating cash flow of 13,335 exceeds net income of 8,099. Deducting capital expenditure of 5,498 leaves 7,837, below net income. Cash from operations is 1.65 times net income, while the defined post-capex cash measure is 0.97 times net income.

The source is Costco's [audited 2025 annual report](https://s201.q4cdn.com/287523651/files/doc_financials/2025/ar/COST-Annual-Report-2025.pdf), printed pages 35, 37 and 39. This is an accounting and sensitivity exercise, not a current valuation or an investment recommendation.

## 1. Separate the three profit and cash measures

The statement inputs below are transcribed from the annual report. FY2024 and FY2025 each contain 52 weeks. The [issuer's FY2025 results release](https://investor.costco.com/news/news-details/2025/Costco-Wholesale-Corporation-Reports-Fourth-Quarter-and-Fiscal-Year-2025-Operating-Results/default.aspx) provides a second presentation of the statements.

~~~cells Costco/Statements
format: B=.0 C=.0
Reported line,FY2024,FY2025
Net sales,249625,269912
Membership revenue,4828,5323
Merchandise costs,222358,239886
Selling general and administrative costs,22810,24966
Operating income,9285,10383
Net income,7367,8099
Operating cash flow,11339,13335
Capital expenditure cash outflow,4710,5498
Opening inventory,,18647
Closing inventory,,18116
Opening accounts payable,,19421
Closing accounts payable,,19783
~~~

~~~cells Costco/Ratios
format: B2=%.2 C2=%.2 B3=%.2 C3=%.2 B4=.2 C4=.2 B7=%.2 C7=%.2
Calculated metric,FY2024,FY2025
Merchandise gross margin,=(Statements!B2-Statements!B4)/Statements!B2,=(Statements!C2-Statements!C4)/Statements!C2
Operating margin on total revenue,=Statements!B6/(Statements!B2+Statements!B3),=Statements!C6/(Statements!C2+Statements!C3)
Operating cash flow / net income,=Statements!B8/Statements!B7,=Statements!C8/Statements!C7
Operating cash flow less capex,=Statements!B8-Statements!B9,=Statements!C8-Statements!C9
Membership revenue / operating income,=Statements!B3/Statements!B6,=Statements!C3/Statements!C6
Net sales growth,,=Statements!C2/Statements!B2-1
~~~

The denominator matters. Merchandise gross margin uses net sales and merchandise costs; operating margin here uses total revenue, including membership revenue. A ratio of membership revenue to operating income compares a revenue line with a profit line. It is not a segment margin and does not allocate membership-related costs.

~~~chart
{
  "type": "bar",
  "title": "Profit and cash measures, USD millions",
  "labels": ["FY2024", "FY2025"],
  "datasets": [
    {"label": "Net income", "values": [7367, 8099]},
    {"label": "Operating cash flow", "values": [11339, 13335]},
    {"label": "Operating cash flow less capex", "values": [6629, 7837]}
  ],
  "format": "number",
  "beginAtZero": true
}
~~~

## 2. Reconcile earnings to operating cash flow

The following bridge retains every reported operating cash-flow adjustment. Positive adjustments increase cash relative to net income; negative adjustments reduce it. Depreciation is added back because it reduced accounting profit without using current-period cash. The separate capital expenditure line records the actual investment outflow.

~~~cells Costco/CashBridge
Component,FY2025
Net income,8099
Depreciation and amortization,2426
Noncash lease expense,303
Stock based compensation,860
Other noncash operating adjustments,-117
Inventory cash flow adjustment,559
Accounts payable cash flow adjustment,404
Other operating assets and liabilities,801
Calculated operating cash flow,=SUM(B2:B9)
Reported operating cash flow,=Statements!C8
Reconciliation difference,=B10-B11
Capex cash outflow,=Statements!C9
Operating cash flow less capex,=B10-B13
~~~

The reconciliation difference is zero. The inventory and accounts-payable adjustments together contribute 963 to the bridge. Year-end balance changes are not interchangeable with cash-flow adjustments: currency translation and other noncash movements can make them differ.

Calling the 7,837 residual "free cash flow" requires a definition. Here it means only operating cash flow minus additions to property and equipment. It has not deducted buybacks, dividends or debt repayments, and it is not a forecast of cash available to distribute every year. Stock-based compensation is noncash in this bridge but can still dilute shareholders.

## 3. Estimate the operating timing, then challenge it

For a timing proxy, divide average opening and closing balances by annual merchandise costs and multiply by the 364 days in this 52-week year:

$$
\text{Inventory days} =
\frac{(18{,}647+18{,}116)/2}{239{,}886}\times364
\approx27.89
$$

Using the same denominator, payable days are approximately 29.74. The resulting merchandise timing gap is about **-1.85 days**. This is not the full cash conversion cycle: receivables are excluded, payables may not map perfectly to merchandise purchases, and two year-end snapshots do not capture seasonal balances.

~~~mermaid
flowchart LR
  A[Buy merchandise] --> B[Inventory held]
  B --> C[Sell to customer]
  A --> D[Supplier payment due]
  C --> E[Customer cash collected]
  D --> F[Supplier cash paid]
~~~

The order of cash collection and supplier payment matters as well as the profit on the sale. A negative timing gap can provide financing at a stable level of activity. It does not establish that cash requirements stay negative during a slowdown.

## 4. Stress the timing without pretending to forecast it

The model assumes fixed annual merchandise costs, a uniform daily run rate, an inventory-days increase and a payable-days reduction. It changes only merchandise funding; it does not estimate sales, earnings, tax, membership renewal or management's response.

~~~cells Timing/Inputs
Assumption,Value
Annual merchandise costs,239886
Days in fiscal year,364
Inventory days increase,3
Payable days reduction,2
Baseline operating cash flow less capex,7837
Opening inventory,18647
Closing inventory,18116
Opening accounts payable,19421
Closing accounts payable,19783
~~~

~~~cells Timing/Stress
format: B2=.2 B3=.2 B4=.2 B5=.2
Calculated output,Value
Daily merchandise cost,=Inputs!B2/Inputs!B3
Baseline inventory days,=((Inputs!B7+Inputs!B8)/2)/B2
Baseline payable days,=((Inputs!B9+Inputs!B10)/2)/B2
Baseline merchandise timing gap,=B3-B4
Inventory funding increase,=B2*Inputs!B4
Lost supplier financing,=B2*Inputs!B5
Total incremental cash required,=B6+B7
Post-capex cash after timing stress,=Inputs!B6-B8
~~~

~~~cells Timing/Sensitivity
format: B=.0 C=.0 D=.0 E=.0
Inventory days added,Payables unchanged,Payables 1 day shorter,Payables 2 days shorter,Payables 3 days shorter
0,=(A2+0)*Stress!B2,=(A2+1)*Stress!B2,=(A2+2)*Stress!B2,=(A2+3)*Stress!B2
1,=(A3+0)*Stress!B2,=(A3+1)*Stress!B2,=(A3+2)*Stress!B2,=(A3+3)*Stress!B2
3,=(A4+0)*Stress!B2,=(A4+1)*Stress!B2,=(A4+2)*Stress!B2,=(A4+3)*Stress!B2
5,=(A5+0)*Stress!B2,=(A5+1)*Stress!B2,=(A5+2)*Stress!B2,=(A5+3)*Stress!B2
~~~

Three more inventory days plus two fewer payable days require about **3,295** of incremental cash, leaving about **4,542** of the defined post-capex cash measure. These are sensitivity outputs. The five-day combined change is a chosen assumption, not an observed deterioration or a management forecast.

## 5. Reproduce the arithmetic

~~~python
from math import isclose

income = 8099
adjustments = [2426, 303, 860, -117, 559, 404, 801]
operating_cash = income + sum(adjustments)
capex = 5498
daily_cost = 239886 / 364
inventory_days = ((18647 + 18116) / 2) / daily_cost
payable_days = ((19421 + 19783) / 2) / daily_cost
stress_cash = daily_cost * (3 + 2)
assert operating_cash == 13335
assert operating_cash - capex == 7837
assert isclose(stress_cash, 3295.1373626373625)
print(f"Inventory days: {inventory_days:.2f}")
print(f"Payable days: {payable_days:.2f}")
print(f"Incremental cash required: {stress_cash:.2f}")
print(f"Post-capex cash after stress: {7837 - stress_cash:.2f}")
~~~

## Questions to carry into a fuller analysis

How do quarterly inventory and supplier balances change the year-end proxy? Which supplier obligations belong in the merchandise comparison? How much capital expenditure maintains existing capacity rather than expands it? What happens to inventory turnover and payment terms under lower sales?

The statements support a reconciliation. A forecast needs additional operational assumptions, and a valuation additionally needs a price, a discount rate and an explicit view of future cash flows.
