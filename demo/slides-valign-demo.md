---
title: Slide layouts and vertical alignment
---

# Slide layouts: where the text sits

A short deck built entirely from the stdlib templates (`@extends`), showing how
top-anchored body copy reads against the old centered default.

~~~slide
@extends cover
#eyebrow: STDLIB TEMPLATES
#title: Where the text sits
#subtitle: Vertical alignment, and why body copy anchors to the top
#meta: SmallDocs · slides demo
~~~

~~~slide
@extends title-body
#title: The rule of thumb
#body:
- **Top** for content areas with lots of text: bullet lists, paragraphs, columns. The first line sits just under the title and the block grows downward.
- **Center** for a single short block that balances a box or a neighbouring visual: a takeaway beside a chart, a caption, a lead line.
- **Bottom** for labels anchored to a lower edge: footers, attributions, source lines.
#footer: title-body template · valign=top
~~~

~~~slide
@extends two-column
#title: Same content, two anchorings
#left-header: TOP-ANCHORED
#left:
- First bullet sits under the title
- Reader's eye starts in a stable place
- Advancing slides don't jump around
#right-header: CENTER-ANCHORED
#right:
- Short block floats to the middle
- Fine for one balanced line
- A list here reads as a gap, then text
~~~

~~~slide
@extends three-column
#title: When each one is right
#left-header: TOP
#left:
- Bulleted body
- Multi-paragraph copy
- Parallel columns
#mid-header: CENTER
#mid:
- One-line takeaway
- A pulled stat
- A hero number
#right-header: BOTTOM
#right:
- Footer label
- Attribution
- Source note
~~~

~~~slide
@extends title-body
#title: Why centering a list reads as broken
#body:
- A bullet list has a reading order and a natural top edge. Readers expect that edge to sit just below the title.
- Center it in an oversized box and the first bullet drops toward the middle, so the title-to-content gap looks like a mistake, not a choice.
- If a top-anchored body leaves dead space below, the fix is to **shrink the shape**, not to re-center the text.
#footer: this slide is top-anchored
~~~

~~~slide
@extends closing
#lead: Text-heavy areas anchor to the top.
#contact: sdoc slides · ALIGNMENT GUIDELINES
~~~
