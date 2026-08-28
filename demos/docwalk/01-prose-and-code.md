---
title: Walkthrough demo - prose and source precision
styles:
  fontFamily: Inter
  baseFontSize: 16
---

# Walkthrough anatomy

This document tests how source lines become targets after Markdown is rendered.
A note can select only this second source line, even though both lines form one paragraph.

## Narrative landmarks

> The walkthrough should preserve the reading surface while making the current idea unmistakable.

The same ordered flow can move between different Markdown structures:

1. A paragraph or part of a paragraph
2. A quotation, list, table, equation, or code example
3. A later section, followed by a return to an earlier one

| Target | Expected treatment |
| --- | --- |
| Prose line or quote | Highlight the matching rendered words |
| Block range | Highlight every rendered block crossed by the range |
| Rich block | Outline the complete interactive element |
| Code line or token | Insert the note beneath the highlighted source line |

## A calculated checkpoint

The release score combines reliability and readiness:

$$
S = 0.65R + 0.35Q
$$

For $R=0.94$ and $Q=0.82$, the score is $S=0.898$.

## A code example inside prose

```javascript
function releaseScore(reliability, readiness) {
  return 0.65 * reliability + 0.35 * readiness;
}
```

The walkthrough keeps this example in the reading surface. Its note sits below the selected source line, while the existing copy and expand controls remain available. Expanding carries the same step into fullscreen, and closing returns to it inline.
