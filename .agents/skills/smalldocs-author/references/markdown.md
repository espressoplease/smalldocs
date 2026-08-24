# Markdown and navigation

SmallDocs accepts one ordinary Markdown string. Use Markdown headings to create the reading hierarchy and automatic document navigation.

## Structure

```md
# Research report

Short summary of the result.

## Evidence

- First observation
- Second observation

## Recommendation

1. First action
2. Second action
```

Use a single level-one heading for the document title. Organise substantial documents with level-two and level-three headings. Heading IDs are generated from heading text and duplicate headings receive stable suffixes.

## Tables

```md
| Option | Cost | Time |
| --- | ---: | ---: |
| A | £120 | 3 days |
| B | £180 | 1 day |
```

Use ordinary tables for values that do not need formulas or spreadsheet interaction. Use a `cells` block when readers should inspect calculations, select ranges, sort, or download a workbook.

## Links and quotes

```md
> The source distinguishes observed facts from interpretation.

[Supporting source](https://example.com/report)
```

Use descriptive link text. The renderer sanitises document HTML, but authored output should still avoid raw HTML when Markdown expresses the same structure.

## Fenced blocks

Ordinary language fences render as code. Recognised rich fences are processed by SmallDocs. An unknown fence remains readable source rather than disappearing.

````md
```python
print("ordinary code")
```

```future-feature
source remains visible
```
````

The host application does not need a fence parser or capability list.
