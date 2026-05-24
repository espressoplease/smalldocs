---
title: Building the world's most complex and capable markdown slides
---

# Building the world's most complex and capable markdown slides

Most markdown slide tools take your headings and bullets and put them on a screen. They make the deck you'd have written anyway, in a nicer font. This is a different thing: a coordinate language for shapes that lives inside a `.md` file, and a 400-line reference an agent reads before it writes a slide.

~~~slide
grid 100 56.25 bg=#ece6dc
r 8 7 40 3 text=caption color=#111111 align=left | maison ardent  -  no. 7
r 8 18 80 24 size=fit maxfont=180 color=#111111 align=left valign=center | nuit blanche
l 8 46 22 46 stroke=#111111 strokeWidth=0.08
r 8 48 70 3 text=caption color=#555555 align=left | eau de parfum  /  100ml  /  available 09.2026
r 78 52 14 3 text=caption color=#555555 align=right | paris
~~~

That slide is six lines of text in a markdown file. The same file, opened on your phone, opens straight into the same deck. The `.md` diffs in git. The URL hash carries the whole document, which browsers do not send to servers, so a share link reveals nothing to sdocs.dev.

If existing markdown slides are Duplo - eight studs, four colours, the castle always comes out looking like the castle on the box - this is the bin of unsorted Lego. More parts. A learning curve. And on the other side of that curve, the thing you wanted to build.

## The grid

A slide is a 100-by-56.25 coordinate grid. Coordinates are grid units; corners snap to nothing. A coarse grid gives the agent fewer legal positions and the deck more rhythm; a denser grid gives it room to thread something between.

~~~slide
grid 100 56.25
l 0 0 100 0 stroke=#cbd5e1 strokeWidth=0.04
l 0 10 100 10 stroke=#cbd5e1 strokeWidth=0.04
l 0 20 100 20 stroke=#cbd5e1 strokeWidth=0.04
l 0 30 100 30 stroke=#cbd5e1 strokeWidth=0.04
l 0 40 100 40 stroke=#cbd5e1 strokeWidth=0.04
l 0 50 100 50 stroke=#cbd5e1 strokeWidth=0.04
l 0 56.25 100 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 0 0 0 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 10 0 10 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 20 0 20 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 30 0 30 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 40 0 40 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 50 0 50 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 60 0 60 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 70 0 70 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 80 0 80 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 90 0 90 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 100 0 100 56.25 stroke=#cbd5e1 strokeWidth=0.04
r 2 2 30 4 text=caption color=#475569 align=left | 10-unit grid, one shape, corners on the lines
r 30 20 40 20 fill=#1e40af color=#ffffff align=center valign=center radius=1 | **r 30 20 40 20**
~~~

Halve the grid spacing and the agent gains positions the coarser grid cannot address. None of the shapes below sit on a 10-unit line.

~~~slide
grid 100 56.25
l 0 0 100 0 stroke=#cbd5e1 strokeWidth=0.04
l 0 5 100 5 stroke=#e2e8f0 strokeWidth=0.04
l 0 10 100 10 stroke=#cbd5e1 strokeWidth=0.04
l 0 15 100 15 stroke=#e2e8f0 strokeWidth=0.04
l 0 20 100 20 stroke=#cbd5e1 strokeWidth=0.04
l 0 25 100 25 stroke=#e2e8f0 strokeWidth=0.04
l 0 30 100 30 stroke=#cbd5e1 strokeWidth=0.04
l 0 35 100 35 stroke=#e2e8f0 strokeWidth=0.04
l 0 40 100 40 stroke=#cbd5e1 strokeWidth=0.04
l 0 45 100 45 stroke=#e2e8f0 strokeWidth=0.04
l 0 50 100 50 stroke=#cbd5e1 strokeWidth=0.04
l 0 56.25 100 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 0 0 0 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 5 0 5 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 10 0 10 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 15 0 15 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 20 0 20 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 25 0 25 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 30 0 30 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 35 0 35 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 40 0 40 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 45 0 45 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 50 0 50 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 55 0 55 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 60 0 60 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 65 0 65 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 70 0 70 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 75 0 75 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 80 0 80 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 85 0 85 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 90 0 90 56.25 stroke=#cbd5e1 strokeWidth=0.04
l 95 0 95 56.25 stroke=#e2e8f0 strokeWidth=0.04
l 100 0 100 56.25 stroke=#cbd5e1 strokeWidth=0.04
r 2 2 30 4 text=caption color=#475569 align=left | 5-unit grid, positions impossible on the 10-unit grid
r 15 15 15 10 fill=#1e40af color=#ffffff align=center valign=center radius=0.5 | **A**
r 50 15 15 10 stroke=#cbd5e1 strokeWidth=0.1 color=#475569 align=center valign=center radius=0.5 | **B**
r 15 35 15 10 stroke=#cbd5e1 strokeWidth=0.1 color=#475569 align=center valign=center radius=0.5 | **C**
r 50 35 15 10 stroke=#cbd5e1 strokeWidth=0.1 color=#475569 align=center valign=center radius=0.5 | **D**
r 75 15 10 30 fill=#f43f5e radius=0.5
~~~

## Six primitives

Every shape is one of six kinds. Rectangles, circles, ellipses and polygons hold real markdown after `|`. Lines and arrows are decoration.

~~~slide
grid 100 56.25
r 6 6 88 4 text=caption color=#475569 align=left | THE SIX PRIMITIVES
r 6 13 26 16 fill=#1e40af color=#ffffff align=center valign=center radius=1 | **r** rectangle
c 50 21 8 fill=#0891b2 color=#ffffff
r 40 17 20 8 align=center valign=center color=#ffffff | **c** circle
e 80 21 12 6 fill=#7c3aed color=#ffffff
r 68 17 24 8 align=center valign=center color=#ffffff | **e** ellipse
l 8 38 30 38 stroke=#0f172a strokeWidth=0.18
r 6 40 26 4 text=caption color=#475569 align=center | **l** line
a 40 38 60 38 stroke=#0f172a strokeWidth=0.2
r 38 40 24 4 text=caption color=#475569 align=center | **a** arrow
p 70,34 86,34 92,42 76,42 fill=#f59e0b
r 68 44 24 4 text=caption color=#475569 align=center | **p** polygon
~~~

## Four roles, not twelve sizes

Font size is a role, not a number. `text=title` is 64px on the reference stage. `text=subtitle` is 40. `text=body` is 24. `text=caption` is 14. Four sizes hold the typographic rhythm across the deck; per-shape font sizes make every slide feel improvised.

~~~slide
grid 100 56.25
r 6 6 88 5 text=caption color=#475569 align=left | THE FOUR ROLES
r 6 14 88 12 text=title color=#0f172a align=left | text=title for the headline
r 6 28 88 8 text=subtitle color=#334155 align=left | text=subtitle for the supporting line
r 6 38 88 6 text=body color=#475569 align=left | text=body is the workhorse - paragraphs, list items, anything you'd write as plain prose.
r 6 49 88 4 text=caption color=#94a3b8 align=left | text=caption is the smallest - dates, source notes, footnotes
~~~

When a shape wants the largest type that will fit, `size=fit` runs a binary search and finds it.

## Anchors

`#name` labels a shape. `@name.bottom` is the bottom-edge midpoint of that shape, from any other shape's coordinate slot. Nine anchors per box: `center`, `top`, `bottom`, `left`, `right`, and the four corners. Move a box; the arrows hanging off it follow.

~~~slide
grid 100 56.25
r 6 4 88 4 text=caption align=left | Every endpoint anchored
r 6 9 88 5 text=subtitle align=left | The team after the Q1 reorg
r 40 14 20 8 #ceo fill=#1e40af color=#ffffff radius=1.5 align=center valign=center | **CEO**
r 14 26 20 7 #platform stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Platform
r 40 26 20 7 #product stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Product
r 66 26 20 7 #gtm stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Go-to-market
a @ceo.bottom @platform.top stroke=#94a3b8 strokeWidth=0.12
a @ceo.bottom @product.top stroke=#94a3b8 strokeWidth=0.12
a @ceo.bottom @gtm.top stroke=#94a3b8 strokeWidth=0.12
r 14 40 20 7 #data stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Data eng
r 40 40 20 7 #design stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Design
r 66 40 20 7 #sales stroke=#cbd5e1 strokeWidth=0.15 radius=1.5 align=center valign=center | Sales
a @platform.bottom @data.top stroke=#94a3b8 strokeWidth=0.12
a @product.bottom @design.top stroke=#94a3b8 strokeWidth=0.12
a @gtm.bottom @sales.top stroke=#94a3b8 strokeWidth=0.12
a @design.left ^-3 @data.right stroke=#0891b2 strokeWidth=0.22
a @design.right ^-3 @sales.left stroke=#0891b2 strokeWidth=0.22
r 6 50 88 4 text=caption color=#64748b align=left | Cyan curves use `^-3` to bow past each other.
~~~

The cyan curves between `Design` and its neighbours use `^-3`: bow the line three grid units perpendicular to its chord. Same operator works on polygon edges.

## Curves

Polygon edges are straight by default. `(r` rounds the corner at a vertex with radius `r`. `^h` bows the next segment by sagitta `h`. Three operators, one fence:

~~~slide
grid 100 56.25
r 6 5 88 5 text=caption color=#475569 align=left | THREE OPERATORS
p (3 12,15 (3 32,15 (3 32,35 (3 12,35 fill=#dbeafe stroke=#1e40af strokeWidth=0.1
r 12 36 20 4 text=caption color=#1e40af align=center | (3 rounded corners
p 42,15 ^4 62,15 62,35 42,35 fill=#fef3c7 stroke=#d97706 strokeWidth=0.1
r 42 36 20 4 text=caption color=#d97706 align=center | ^4 domed top
a 72 30 ^6 96 30 stroke=#7c3aed strokeWidth=0.3
r 70 36 28 4 text=caption color=#7c3aed align=center | ^6 bowed arrow
~~~

Drawing a domed card or a curved connector in reveal.js or Slidev means dropping into raw SVG or a Vue component. Here it is one line.

## Opacity

`opacity=N` on overlapping shapes lets the intersection deepen on its own. The overlap is the data; move a circle and the regions update for free.

~~~slide
grid 100 56.25 bg=#0b1220
r 6 4 88 4 text=caption color=#94a3b8 align=left | OPACITY LAYERING
r 6 9 88 4 text=subtitle color=#f1f5f9 align=left | Who our three product lines actually serve
c 40 28 9 fill=#38bdf8 opacity=0.55
c 54 28 9 fill=#f43f5e opacity=0.55
c 47 38 9 fill=#facc15 opacity=0.55
r 16 22 16 4 text=caption color=#e0f2fe align=right | Analysts
r 62 22 16 4 text=caption color=#fee2e2 align=left | Engineers
r 39 49 16 4 text=caption color=#fef9c3 align=center | Executives
r 41 31 12 4 text=caption color=#ffffff align=center valign=center | **all three**
~~~

## The reference the agent reads

`sdoc slides custom-shapes` prints around 400 lines. The agent reads it before it writes the file. The first half is design principles, not syntax:

> **One deviation per slide.** Repetition plus deviation equals recognition. If five shapes share a treatment and the sixth doesn't, the eye lands on the sixth before reading a single label. The deviation IS the slide. Wanting two deviations is usually wanting two slides.

> **Geometry as data.** Where a shape's size, position, slope, or area corresponds to a number in the content, make it accurate. SOM at 4.7% of TAM should occupy 4.7% of TAM's area, not 30% because that's what fits the layout. Where shapes carry data, geometry IS the argument; labels confirm it.

The reference also names the pitfalls the agent would otherwise hit on the third slide: `^h` is perpendicular to the chord, not vertical; descenders in `text=title` cross into the shape below; polygon points use `x,y` and rectangles use `x y`. A human reading 400 lines about descenders would shoot themselves. An agent reads it once, applies it on slide one, applies it on slide forty.

The pattern below is one deviation per slide, taken literally. Three pale frames; one navy step. The navy is the step the customer actually feels.

~~~slide
grid 100 56.25
r 6 7 88 5 text=subtitle align=left | Four stages, and the one the customer actually feels
r 7 23 18 13 #s1 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Capture**
r 29 23 18 13 #s2 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Model**
r 51 23 18 13 #s3 fill=#1e40af color=#ffffff radius=2 align=center valign=center | **Activate**
r 73 23 18 13 #s4 stroke=#cbd5e1 strokeWidth=0.12 radius=2 align=center valign=center | **Measure**
a @s1.right @s2.left stroke=#94a3b8 strokeWidth=0.1
a @s2.right @s3.left stroke=#94a3b8 strokeWidth=0.1
a @s3.right @s4.left stroke=#94a3b8 strokeWidth=0.1
r 7 41 84 6 text=caption color=#475569 align=center | Activate is the step the customer experiences - so it gets the one bit of colour on the slide.
~~~

## What you actually get over the alternatives

Markdown slide tools have been around for a decade. The honest comparison, not a strawman:

Marp uses directives for theme and pagination; the markdown surface has no shape or coordinate primitives. Slidev has `v-drag` - a directive on an existing element that takes Left, Top, Width, Height, Rotate and gets regex-rewritten back to the source - but no shape declaration in a fenced block and no way to reference one shape's edge from another. Deckset auto-lays-out. Reveal.js leaves all geometry to inline HTML and SVG. To draw a domed card or a curved connector in any of them, you open an SVG block. Here, `p (3 12,15 (3 32,15 ...` is the markdown.

Gamma generates decks server-side; the source of truth is their database. Beautiful.ai is the same model with a cleaner `.pptx` export. Here the `.md` file is the deck. Open it offline, diff it in git, send the URL. The deck lives in the fragment after the `#`, which browsers do not send to the server.

The bit none of them ship: a reference designed for an LLM to read in one prompt. `sdoc slides custom-shapes` is ~400 lines covering DSL, design principles, pitfalls, and composite patterns. The closest equivalent on the other side of the comparison is a community Slidev MCP server with two commits. Other tools have human tutorials, not agent-readable specs.

The trade-off is worth naming. Marp is faster for a deck of bullets. Drag-and-drop tools are faster if you are the one moving boxes. The reach of a coordinate DSL plus a long agent-readable reference is on the other side: arbitrary geometry, four-pixel decisions, the same `.md` file rendering identically on every screen.

## A few more

~~~slide
grid 100 56.25 bg=#f6f1e7
r 6 6 50 3 text=caption color=#b91c1c align=left | THE LEDGER  ·  ECONOMY  ·  MAY 15 2026
l 6 10 94 10 stroke=#1a1a1a strokeWidth=0.06
r 6 12 60 12 text=title color=#1a1a1a align=left valign=top | The Fed Held. The Bond Market Did Not.
r 6 26 52 22 text=body color=#1a1a1a align=left valign=top | A pause was priced in. The 10-year still moved 18 basis points before lunch, and four large dealers cut staff on the same desk by close. The committee said nothing new; the curve disagreed.
r 60 12 34 30 fill=#1a1a1a color=#f6f1e7 padding=2.5 align=left valign=top |
  ## 18 bps
  intraday move on the 10-year, Wednesday
r 60 43 34 5 text=caption color=#666666 align=left valign=top | Source: Treasury tape, 14:00 ET close.
l 6 51 94 51 stroke=#1a1a1a strokeWidth=0.04
r 6 52 60 3 text=caption color=#666666 align=left | By M. Halberstam  ·  Pp. 14-17
~~~

~~~slide
grid 100 56.25 bg=#0a0a0a
r 4 4 92 2 text=caption color=#39ff14 align=left | NULLBYTE // STATUS // 2026-05-15T09:00Z // BLOCK 21,442,071
l 4 7 96 7 stroke=#39ff14 strokeWidth=0.08
r 4 11 60 26 size=fit maxfont=220 color=#39ff14 align=left valign=center padding=2 | **$1.42B**
r 4 35 60 4 text=caption color=#39ff14 align=left | 24H SETTLED VOLUME // +312% W/W
r 66 11 30 12 fill=#39ff14 color=#0a0a0a padding=1.5 align=left valign=center |
  **0 custodians**
  keys never leave the device
r 66 24 30 12 fill=#ff00aa color=#0a0a0a padding=1.5 align=left valign=center |
  **47ms p50**
  match-to-settle, on-chain
r 66 37 30 12 stroke=#39ff14 strokeWidth=0.1 color=#39ff14 padding=1.5 align=left valign=center |
  **$0.00**
  taker fee for makers over 30 days
l 4 51 96 51 stroke=#39ff14 strokeWidth=0.04
r 4 52 92 3 text=caption color=#666666 align=left | RUN `nullbyte stat` LOCALLY TO VERIFY // NOT A SOLICITATION
~~~

~~~slide
grid 100 56.25 bg=#efe7d8
c 84 12 5 fill=#c97b5a opacity=0.35
c 91 18 3 fill=#8a9a7b opacity=0.4
r 8 8 50 3 text=caption color=#8a9a7b align=left | kinfolk & fern  ·  field notes
r 8 16 60 12 size=fit maxfont=80 color=#2f2a24 align=left valign=center | rest is a practice, not a product.
r 8 30 56 16 fill=#ffffff radius=4 padding=3.5 color=#2f2a24 align=left valign=center | our chamomile is grown by one farm in the alentejo, harvested by hand, and rested for six weeks before it reaches you. that wait is the formula.
r 66 32 26 14 fill=#c97b5a radius=4 padding=2.5 color=#ffffff align=left valign=center |
  ## night tonic
  ships june 1
~~~

~~~slide
grid 100 56.25 bg=#ff3ea5
p 0,0 38,0 18,56.25 0,56.25 fill=#22d3ee
c 70 18 14 fill=#fbbf24
p 60,30 96,28 92,56.25 56,56.25 fill=#4338ca opacity=0.85
l 0 8 100 14 stroke=#fbbf24 strokeWidth=0.5
l 0 48 100 42 stroke=#22d3ee strokeWidth=0.5
c 24 40 6 fill=#ffffff
r 8 6 60 6 text=caption color=#ffffff align=left | SUPER POP!  -  SUMMER 26 DROP
r 6 16 56 22 size=fit maxfont=160 color=#0a0a0a align=left valign=center | EAT THE SUNSET.
r 8 40 50 8 fill=#ffffff color=#0a0a0a radius=1 padding=2 align=left valign=center | **12 FLAVOURS / 1 FRIDGE / 0 CHILL**
r 64 36 30 8 fill=#0a0a0a color=#fbbf24 align=center valign=center radius=1 | **OUT JUNE 21**
~~~

## Build one

```
npm i -g sdocs-dev
sdoc setup                  # tell your agent the DSL exists
sdoc slides custom-shapes   # 400 lines of reference, also for you
sdoc present deck.md        # straight into fullscreen
```

You will not write the DSL. Open the project you would put on slides next week and tell the agent: *the company is X, the audience is Y, build me a six-slide deck and read `sdoc slides custom-shapes` first.* Read what comes back. Send a note: tighter type on slide three, drop the icons on slide five, make slide one the cover, and so on. Then `sdoc present deck.md`.

The reference is one CLI command. The deck is one `.md` file. The castle does not come out looking like the castle on the box.
