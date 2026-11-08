# Charts

Use a `chart` fence containing one JSON object. Charts are loaded only when the document contains a chart block.

## Single series

````md
```chart
{
  "type": "bar",
  "title": "Requests by quarter",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "values": [120, 156, 188, 241],
  "format": "number"
}
```
````

## Multiple series

````md
```chart
{
  "type": "line",
  "title": "Conversion rate",
  "labels": ["Jan", "Feb", "Mar"],
  "datasets": [
    {"label": "Current", "values": [0.21, 0.24, 0.31]},
    {"label": "Previous", "values": [0.18, 0.20, 0.22]}
  ],
  "format": "percent"
}
```
````

## Supported types

`pie`, `doughnut`, `bar`, `horizontal_bar`, `stacked_bar`, `stacked_horizontal_bar`, `line`, `area`, `stacked_area`, `radar`, `polarArea`, `scatter`, `bubble`, and `mixed`.

Common top-level properties:

- `type`: chart type
- `title`: visible title
- `labels`: category labels
- `values`: one series of values
- `datasets`: multiple labelled series
- `format`: `currency`, `percent`, or `number`
- `legend`: boolean
- `stacked`: boolean
- `min`, `max`, and `beginAtZero`: scale controls
- `color` or `colors`: explicit series colours when the document palette is insufficient

For `mixed`, give each dataset its own `type` of `bar` or `line`. Scatter datasets use `{x, y}` points and bubble datasets use `{x, y, r}` points.

Use charts only for quantitative patterns. State the relevant conclusion in nearby prose so the result remains understandable if the visual cannot finish loading.
