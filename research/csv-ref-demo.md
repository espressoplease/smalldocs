---
title: cells from a CSV file
tags: [sheets-v1, demo]
---

# Loading a sheet from a CSV file

This sheet is loaded from a file, not typed inline:

```cells
{{sample-sales.csv}}
```

The `sdoc` CLI reads `sample-sales.csv` (resolved next to this document),
reads the whole file, and bakes the values straight into the document
before it ever leaves your machine. So this doc is self-contained: a share
link shows the data, never a "file not found" error. The bar shows the
source filename as provenance - select a cell and it reads
`B3 · sample-sales.csv`.
