---
title: cells - column formatting
tags: [sheets-v1, demo]
---

# Column formatting

A `format:` line lets the author choose how each column reads - currency,
percent, plain, decimals - which is what makes a `cells` block more than a
raw CSV. Formatting is display only; copy/export still emit the originals.

## Currency, percent, plain

```cells
format: A=plain B=$ C=% D=,
Year,Revenue,Margin,Units
2024,1200000,0.234,15000
2025,1505000,0.281,18400
2026,1330000,-0.072,16900
```

Year stays `2024` (plain, no comma); Revenue is `$1,200,000.00`; Margin is
`23.4%` (and `-7.2%` in red); Units use plain thousands separators.

## Decimals and other currencies

```cells
format: B=£ C=$.0 D=%.1
Item,Price,Budget,Share
Widget,12.5,5000,0.5
Gadget,8,12000,0.5
```

Price `£12.50`, Budget `$5,000` (no cents), Share `50.0%`.

## Default (no format line)

```cells
Region,Q1,Q2,Q3
North,12000,15000,-700
South,9000,9500,11000
```

Numbers get thousands separators and negatives in red automatically.
