---
title: Walkthrough demo - slides and media
---

# Presentation surfaces

This document checks that a walkthrough can guide someone across several slides and then into embedded media.

## Slide deck

~~~slide
@extends cover
#eyebrow: WALKTHROUGH REVIEW
#title: One document, several reading surfaces
#subtitle: The note follows the rendered idea, not the source syntax
#meta: SmallDocs prototype
~~~

~~~slide
grid 16 9 bg=#f8fafc
r 1 0.6 14 0.9 text=subtitle align=left color=#0f172a | How an agent explanation reaches a reader
r 1 3.1 2.3 2.2 fill=#e0e7ff color=#312e81 radius=0.22 align=center | Source line
a 3.45 4.2 4.2 4.2 color=#64748b
doc 4.35 3.1 2.5 2.2 fill=#ffffff stroke=#94a3b8 color=#0f172a align=center | Markdown token
a 7 4.2 7.75 4.2 color=#64748b
r 7.9 3.1 2.8 2.2 fill=#dbeafe color=#0c4a6e radius=0.22 align=center | Rendered target
a 10.85 4.2 11.6 4.2 color=#64748b
chev 11.75 3.1 3.1 2.2 fill=#dcfce7 color=#14532d align=center | Guided note
r 4.1 6.5 7.8 1 fill=#fef3c7 color=#78350f radius=0.2 align=center text=caption | Text resolves precisely. Rich content resolves as a whole block.
~~~

~~~slide
@extends two-column
#title: What the first version promises
#left-header: Precise now
#left:
- Paragraph source lines
- Code lines and expressions
- Ranges across Markdown blocks
- Ordered movement through the document
#right-header: Whole block now
#right:
- Slides and sheets
- Diagrams and charts
- Forms, video, and math
~~~

## Embedded media

The video is intentionally last so the walkthrough demonstrates a transition out of the slide deck.

```video
https://www.youtube.com/watch?v=dQw4w9WgXcQ
title: Example embedded video target
start: 42
```

The first version frames the video player as one target. Selecting a timestamp or a control inside it can be explored later.
