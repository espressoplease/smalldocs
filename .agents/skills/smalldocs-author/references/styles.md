# Document styles

SmallDocs accepts optional YAML front matter at the start of the Markdown. The `styles` key controls the rendered document.

```md
---
title: Quarterly review
styles:
  fontFamily: Inter
  baseFontSize: 16
  color: "#1c1917"
  background: "#fffdf8"
  h1: { fontSize: 2.2, fontWeight: 700, color: "#1e3a5f" }
  p: { lineHeight: 1.75, marginBottom: 1.0 }
  blocks: { background: "#f4f1ed" }
  dark:
    background: "#171512"
    color: "#f4f1ed"
---

# Quarterly review
```

Prefer the default theme unless styling serves the document or host application. Top-level colours cascade into headings and blocks. SmallDocs derives dark colours when explicit `dark` overrides are absent.

Common keys include `fontFamily`, `baseFontSize`, `color`, `background`, `linkColor`, heading roles such as `h1`, paragraph and list roles, `blocks`, `code`, `blockquote`, `table`, `chart`, and `dark`.

Use valid CSS colour values and maintain readable text-background contrast in both themes. Avoid embedding host application CSS or raw style elements in the document.
