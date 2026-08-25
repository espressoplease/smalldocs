# Project Meridian: pilot model

The sheet keeps assumptions and formulas together. Readers can inspect the calculation, select cells, and download the workbook.

~~~cells
Pilot model,Q1,Q2,Q3,Q4
Design partners,3,5,8,12
Revenue per partner,12000,12000,13500,15000
Pilot revenue,=B2*B3,=C2*C3,=D2*D3,=E2*E3
Implementation cost,28000,32000,42000,54000
Local support cost,18000,21000,26000,33000
Contribution,=B4-B5-B6,=C4-C5-C6,=D4-D5-D6,=E4-E5-E6
Cumulative contribution,=B7,=B8+C7,=C8+D7,=D8+E7
~~~

## Interpretation

The pilot remains an evidence investment through Q2. Under the base assumptions, cumulative contribution turns positive in Q3. The expansion decision should use observed adoption and delivery cost rather than treating this model as a forecast.

| Decision threshold | Target |
| --- | ---: |
| Paid partner conversion | 60% |
| Median implementation time | Under 10 working days |
| Weekly active users per partner | 4 |
