# Project Meridian: market evidence

The agent selected charts for the two comparisons where shape and scale matter. The recommendation remains stated in prose so the analysis is useful while a visual dependency loads.

## Reachable demand by entry market

The Netherlands offers the smallest absolute market but the highest reachable share during the first year.

~~~chart
{
  "type": "bar",
  "title": "Reachable mid-market accounts in year one",
  "labels": ["Netherlands", "Germany", "Belgium", "France"],
  "values": [420, 610, 180, 330],
  "format": "number",
  "colors": ["#3157d5", "#9aace8", "#c2cbe5", "#c2cbe5"]
}
~~~

## Expected pilot conversion

Interviews suggest the Netherlands combines the strongest initial conversion with the shortest implementation cycle.

~~~chart
{
  "type": "line",
  "title": "Expected design-partner conversion",
  "labels": ["Qualified", "Workshop", "Pilot", "Paid"],
  "datasets": [
    {"label": "Netherlands", "values": [1, 0.71, 0.46, 0.34]},
    {"label": "Germany", "values": [1, 0.62, 0.35, 0.22]}
  ],
  "format": "percent"
}
~~~

Source: agent synthesis of 34 interviews and the internal opportunity list. Values are planning estimates, not observed outcomes.
