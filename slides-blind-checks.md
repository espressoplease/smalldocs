---
title: "Slides: pre-flight checks for blind authoring"
description: "Proposed addition to `sdoc slides custom-shapes` - mechanical checks an agent can run on its own DSL before returning a custom-shape slide."
---

# Proposed addition to `sdoc slides custom-shapes`

Drop the block below into the `custom-shapes` help text (and add a one-line
pointer from `sdoc slides`). The text is written to be read by the agent that
is composing the slide.

```
DRAWING BLIND: CHECKS TO RUN BEFORE YOU FINISH

You are placing coordinates you cannot see rendered. The renderer will not
warn you when a shape covers text, when text sits on a fill it can't be read
against, or when a connector lands in empty space. Every failure below passed
the author's eye because the author had no eye. Run these as arithmetic on
your own DSL before returning the slide.

1. Content airspace. No later shape may paint into an earlier text shape's
   rect. Source order is paint order. List every text shape's box
   (x, y, x+w, y+h). For each one, confirm no shape that comes later in the
   source has a fill that intersects it. If text must sit on a panel, the
   panel is drawn before the text and is opaque. A title with a shape drawn
   over its second half loses that word completely - and you won't notice,
   because the coordinates look fine in isolation.

2. Polygons are their points, not their boxes. A house roof, a mountain
   ridge, a chevron tip - the apex pokes far outside the shape's body. When
   you check a polygon against anything (a title above it, a neighbour beside
   it), test its extreme points (highest apex y, widest x), not an imagined
   rectangle. The classic failure: a centred diagram whose peak rises into
   the title line one band above it.

3. Contrast is against what's painted under the text, not against the page.
   Text colour must contrast with whatever is actually beneath it at those
   coordinates - which may be the grid background, or an earlier fill the
   text overlaps. Before trusting a text colour, name the topmost opaque
   thing under it and check contrast against that. If a text shape straddles
   two fills (a stripe seam, a polygon ridge, a gradient), it fails by
   definition - move it onto a uniform substrate or give it its own opaque
   container. Never float load-bearing text directly over a decorative
   polygon or a coloured band.

4. Connectors must touch what they connect. A `l` or `a` endpoint floating
   in the gap reads as debris; an endpoint buried inside a shape, or a
   segment routed through a third shape, reads as a strike-through - the
   opposite of "connected." Anchor both endpoints to coordinates you computed
   from the two shapes' actual edges, never eyeballed. For any directional
   relationship (flow, derivation, "feeds"), use `a` (arrow), not `l`.

5. Hand-placed connectors are the highest-risk element on a blind-authored
   slide. Their correctness depends on pixel-accurate endpoints you can't
   verify. Prefer to express relationship through containment, alignment, and
   adjacency, which are robust to blind authoring. Reach for a drawn
   connector only when the connection itself is the message, and when you do,
   derive its endpoints arithmetically from the shapes it joins.

6. One channel, one variable. If two shapes differ in outline or fill colour,
   that difference must encode something a viewer can decode. Two outline
   colours imply two groups; if there is no second group, use one colour.
   Unexplained colour variation reads as inconsistency, not meaning.

7. You cannot see text wrap. Size for it. Text poured into a fixed box wraps
   where you can't predict, and a sentence in a narrow rect will orphan its
   last word. Keep shape labels to a few words known to fit on one line, or
   size the box for the exact two balanced lines you intend. Long-form
   sentences belong in markdown content, not inside a shape.

8. `caption` is ~3px in a thumbnail. It is never load-bearing. If the
   audience must read it, it is body, not caption. (See the role table in
   DESIGN GUIDELINES.)

Self-audit before returning. For each text shape, write one line: its box,
the shape painted directly beneath it, and the later shapes you confirmed do
not overlap it. If you cannot produce that line for a shape, you have not
verified the slide - simplify the layout until you can. A layout you can't
check by arithmetic is one you can't trust without rendering.
```
