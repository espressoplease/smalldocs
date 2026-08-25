export const capacityMarkdown = String.raw`---
cells-tabs: tabbed
---
# Summary

The capacity agent converts workflow telemetry into a compact operating view. The base case has room for another 22 weekly jobs before the current service target is at risk.

## Weekly throughput

Completed workflows accelerated after the routing change on Wednesday.

~~~chart
{
  "type": "bar",
  "title": "Completed workflows",
  "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "values": [82, 91, 76, 108, 116],
  "format": "number",
  "colors": ["#2dd4bf", "#2dd4bf", "#f59e0b", "#2dd4bf", "#2dd4bf"]
}
~~~

## Capacity model

The workbook keeps input assumptions separate from its computed summary. The exported Excel file should preserve both tabs and their formulas.

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

## Operating note

Reserve should remain above 15 percent until the new routing policy has completed two full weeks.`;

export const capacityUpdateMarkdown = String.raw`# Summary

The capacity agent completed a later run without changing the surrounding risk report.

## Current position

| Measure | Value |
| --- | ---: |
| Weekly capacity | 142 |
| Scheduled workflows | 119 |
| Available reserve | 23 |

The update replaces one renderer instance and leaves every other instance intact.`;

export const riskMarkdown = String.raw`# Summary

The risk agent found no critical service issue. Low-confidence results still require a human decision before publication.

## Escalation flow

~~~mermaid
flowchart LR
  A[Agent result] --> B{Confidence}
  B -->|High| C[Publish]
  B -->|Low| D[Human review]
  D --> E{Resolved?}
  E -->|Yes| C
  E -->|No| F[Hold result]
~~~

## Confidence

The automated publication threshold is $\Pr(error) < 0.05$.

$$
Confidence = 1 - \frac{Exceptions}{Reviewed\ results}
$$

## Actions

- Review the two low-confidence routing decisions.
- Preserve the original evidence alongside the reviewer decision.
- Re-run the agent after the routing policy changes.`;

export const riskUpdateMarkdown = String.raw`# Summary

The review queue is clear.

## Latest result

All low-confidence routing decisions now have a human disposition.`;
