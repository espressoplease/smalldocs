---
title: Capacity workbook
cells-tabs: tabbed
---

# Capacity workbook

~~~cells capacity/Inputs
Metric,Value
Weekly units,120
Value per unit,25
Reserve rate,0.15
~~~

~~~cells capacity/Summary
format: B=$
Metric,Value
Revenue,=Inputs!B2*Inputs!B3
Reserve,=B2*Inputs!B4
Available,=B2-B3
~~~
