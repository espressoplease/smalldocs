---
file: slides-design-delta.md
title: "Slides custom-shapes: documentation delta"
styles:
  h1: { color: "#1D4ED8" }
  a: { color: "#2563EB" }
---

# Slides custom-shapes: documentation delta

This is only the new / changed material added to `sdoc slides custom-shapes` (the raw-shapes reference). Everything else in that help text is unchanged.

## Added: three new design principles (at the top of DESIGN PRINCIPLES)

### The grid comes first

Before placing a single shape, fix a margin and a few alignment lines, then snap everything to them. This one habit is most of the distance between "designed" and "adrift".

- **Margin.** Reserve an outer margin on all four sides and let nothing but full-bleed decoration cross it. A common choice on a 100-wide grid: left 8, right 92, top 8.
- **Alignment lines.** Pick a few x positions (e.g. 8, 50, 92) and a few y rows, and begin or end shapes ON them. Every shape should share an edge - left, right, top, or centre - with at least one other shape. A shape that lines up with nothing is exactly what the eye reads as "off".
- **Text alignment counts too.** Role text defaults to `align=center`. In a left column, set `align=left` on the title and body so the text's own left edge lands on your gridline - otherwise each block centres inside its own box and nothing actually lines up. Centred multi-line body text (ragged on both sides, a lone last word stranded) is its own amateur tell. Keep `align=center` for genuinely centred layouts and short single lines (a chip, a metric).
- **Columns.** Choose one, two, or three columns and let blocks fill whole columns or the full content width. Don't invent a fourth x position for a single box.
- **One spacing unit.** Use the same vertical gap between stacked elements rather than 2 here and 1 there. Equal rhythm reads as deliberate; uneven gaps read as dropped-in.
- **Proximity.** Group related items tightly and separate unrelated ones with space. Let space do the grouping, not boxes or rules.

The tell of a missing grid: blocks whose left edges almost-but-not-quite line up, and a stray box sitting at an x and y that match nothing else on the slide.

### Palette: one background, one ink, one accent

A background, a text colour, and a single accent cover almost every slide. Add a second accent only when a second meaning genuinely needs it, and spend it sparingly. Three or more saturated hues competing on one slide is the clearest sign a deck was assembled rather than designed. The accent marks the one thing you want looked at.

### Hierarchy comes from type and space, not from boxes

Make the title read first by making it large and giving it room, not by wrapping it in a filled banner. A black or saturated box behind a heading is a common amateur tell: it adds weight without meaning and competes with the content below. Reserve filled shapes for things that ARE an element - a chip, a card holding body text, the one focal block - never as a backdrop a title could do without.

## Added: a worked example (adrift vs on a grid)

Same content, the same available shapes. The first ignores the grid; the second applies the principles above. Both slides below are live - this is what each renders to.

**DON'T** - no grid, four competing hues, title in a black box:

~~~slide
grid 100 56.25 bg=#f7f5f0
r 0 39 100 4 fill=#f9a971
r 0 43 100 4 fill=#fb6526
r 0 47 100 4 fill=#a68deb
r 0 51 100 5.25 fill=#3b2089
r 6 6 72 10 fill=#000000 color=#fff radius=1.2 text=subtitle | DRY keeps the catalog repairable
r 6 18 56 11 fill=#fff text=body | One source of truth for pricing, returns and copy.
r 66 19 28 7 fill=#0165a5 color=#fff text=body | Less duplication = less waste
~~~

Four stacked colour bands, a heavy black title bar, and a blue box at x=66 whose left edge, right edge and top match no other shape. It reads as assembled, not designed.

**DO** - one margin, one column, one accent, title by type:

~~~slide
grid 100 56.25 bg=#f7f5f0
p 0,56.25 0,49 30,44 62,48 100,45 100,56.25 fill=#ece4d8
r 8 9  70 3  color=#8a8073 text=caption align=left | PATAGONIA / ENGINEERING
r 8 13 80 13 color=#1c1917 text=title   align=left | DRY code keeps the catalog repairable
r 8 28 50 8  color=#5f574c text=body    align=left | One source of truth for pricing, returns, and product copy. Change it once and every channel inherits the fix.
r 8 38 32 5  fill=#0165a5 color=#ffffff radius=0.6 text=body align=center | Less duplication, less waste
~~~

Every block shares the left edge at x=8 - and the title and body carry `align=left`, so their text actually lands on that edge rather than centring inside its own box. The hierarchy is eyebrow -> title -> body -> one accent chip, carried by size and spacing alone. One accent (the chip), one subordinate decoration (a single low-contrast ridge anchored to the bottom edge), and the title needs no box.

## Added: icon guidance

A note on the `icon` shape, plus a new pitfall.

> Pair an icon with its label as two shapes, not one. Keep every icon in a set the same size (w = h) sitting on a shared row.

**Pitfall: icons painted over text collide with it.** The `icon` shape paints its glyph across the whole bbox. Give it `|` text, or drop it on top of a text shape, and the outline crosses the words. Keep the icon in its own box and the label in a separate shape on the same row:

~~~slide
grid 100 56.25 bg=#f7f5f0
r 8 8 80 3 color=#8a8073 text=caption | ICON + LABEL: TWO SHAPES, ONE ROW
icon 8 18 4 4 name=recycle color=#0165a5
r 13 18 60 4 text=body align=left valign=center | Repairable by design
icon 8 26 4 4 name=git-merge color=#0165a5
r 13 26 60 4 text=body align=left valign=center | One source of truth, every channel
icon 8 34 4 4 name=shield-check color=#0165a5
r 13 34 60 4 text=body align=left valign=center | Easier to audit and test
~~~

Icon in a 4x4 box; the label starts after it at x=13, centred on the same y. All icons in a set share one size and one row.

## Pared back

The descender rule under "shapes paint over each other" dropped its formula. It now reads simply:

> The fix: leave a full grid unit of clearance below a big text row (title or subtitle) before the next shape begins.

(Previously it gave two budgets including `0.2 * fontSize` in grid units with a per-role pixel breakdown.)
