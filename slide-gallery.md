---
title: SDocs Slide Gallery
---

# SDocs Slide Gallery

Slides are presentations that live inside a markdown file. Wrap shape DSL in
a `~~~slide` fenced block and it renders as a thumbnail you can click into
fullscreen - or open the whole file straight into presentation mode with
`sdoc present file.md`. Every coordinate is in grid units; the first line of
a block sets the grid, and `grid 100 56.25` is the 16:9 default.

The gallery has three parts. The first is a coherent deck - the kind of
thing you would actually present, with consistent styling across nine
slides. The second pushes the styling six different ways, each slide built
to read like it came from a different real company. The third covers raw
shapes, the system the templates are built on. The primitives come first,
then seven compositions that put coordinates, anchors, and curves to work.
Run `sdoc slides` for the full DSL reference and `sdoc slides list` for the
built-in templates.

## The deck

### Open with a cover that sets the tone

A cover is mostly type and space. This one uses `grid bg=` for a dark canvas
and the `title` / `subtitle` / `caption` text roles - no shape fills, no clip
art.

~~~slide
grid 100 56.25 bg=#0b1220
r 6 8 82 4 text=caption color=#38bdf8 align=left | NORTHWIND ANALYTICS  -  Q1 BOARD REVIEW
r 6 17 84 16 text=title color=#f1f5f9 align=left | Revenue up 39%, churn halved
r 6 36 72 6 text=subtitle color=#94a3b8 align=left | Fiscal 2026 so far, and the road to Series B
l 6 46 24 46 stroke=#38bdf8 strokeWidth=0.2
r 6 48 70 3 text=caption color=#64748b align=left | Prepared May 2026
~~~

````
~~~slide
grid 100 56.25 bg=#0b1220
r 6 8 82 4 text=caption color=#38bdf8 align=left | NORTHWIND ANALYTICS  -  Q1 BOARD REVIEW
r 6 17 84 16 text=title color=#f1f5f9 align=left | Revenue up 39%, churn halved
r 6 36 72 6 text=subtitle color=#94a3b8 align=left | Fiscal 2026 so far, and the road to Series B
l 6 46 24 46 stroke=#38bdf8 strokeWidth=0.2
r 6 48 70 3 text=caption color=#64748b align=left | Prepared May 2026
~~~
````

### Let one number carry the slide

`@extends metric` is the hero-number template: a value that scales to fill
the slide, plus one line of context. Fill two named slots and you are done -
no coordinates.

~~~slide
@extends metric
#metric: $2.36M ARR
#context: Up 39% from $1.70M a year ago. Most of the lift landed in Q1.
~~~

````
~~~slide
@extends metric
#metric: $2.36M ARR
#context: Up 39% from $1.70M a year ago. Most of the lift landed in Q1.
~~~
````

### Put a chart on the slide, with the takeaway next to it

`@extends exhibit` pairs a chart with a takeaway column. The `chart` slot
takes a normal ` ```chart ` block - the same syntax as a chart anywhere else
in a SmallDoc - so the chart is live, not a screenshot.

~~~slide
@extends exhibit
#title: Revenue grew every quarter, with Q1 the steepest step
#chart:
  ```chart
  {"type":"bar","title":"ARR by quarter ($M)","labels":["Q2","Q3","Q4","Q1"],"values":[1.70,1.88,2.04,2.36],"color":"#2563eb"}
  ```
#takeaway:
  **+39%** across four quarters.

  Q1 alone added **$0.32M** - more than the previous two quarters combined.
#source: Finance, May 2026. Figures in $M ARR.
~~~

````
~~~slide
@extends exhibit
#title: Revenue grew every quarter, with Q1 the steepest step
#chart:
  ```chart
  {"type":"bar","title":"ARR by quarter ($M)","labels":["Q2","Q3","Q4","Q1"],"values":[1.70,1.88,2.04,2.36],"color":"#2563eb"}
  ```
#takeaway:
  **+39%** across four quarters.

  Q1 alone added **$0.32M** - more than the previous two quarters combined.
#source: Finance, May 2026. Figures in $M ARR.
~~~
````

### Break the deck with a section divider

`@extends section` is the one template with a full-bleed dark background -
the contrast tells the room you are switching gears. Its slots are `kicker`,
`title`, and `subtitle`.

~~~slide
@extends section
#kicker: PART TWO
#title: Where the growth came from
#subtitle: Three changes to how customers find, adopt, and expand
~~~

### Compare two states side by side

`@extends two-column` is for before/after, problem/solution, A versus B.
Keep the columns about the same length so they read as parallel.

~~~slide
@extends two-column
#title: We stopped guessing at onboarding and instrumented it
#left-header: BEFORE
#left:
- Activation judged by gut feel
- Support tickets triaged by hand
- Churn noticed at renewal - too late to act
#right-header: AFTER
#right:
- Activation tracked per cohort, daily
- Tickets auto-routed by a topic model
- At-risk accounts flagged 60 days out
~~~

````
~~~slide
@extends two-column
#title: We stopped guessing at onboarding and instrumented it
#left-header: BEFORE
#left:
- Activation judged by gut feel
- Support tickets triaged by hand
- Churn noticed at renewal - too late to act
#right-header: AFTER
#right:
- Activation tracked per cohort, daily
- Tickets auto-routed by a topic model
- At-risk accounts flagged 60 days out
~~~
````

### Drop a diagram straight into a slide

A ` ```mermaid ` block renders inside a slide the same way the chart slot
works - here in the body of `@extends title-body`.

~~~slide
@extends title-body
#title: How a customer query becomes a dashboard
#body:
  ```mermaid
  flowchart LR
    Q[SQL query] --> P[Planner]
    P --> C[(Column store)]
    C --> A[Aggregator]
    A --> D[Dashboard]
    A --> X[Export / API]
  ```
#footer: Northwind query pipeline, simplified
~~~

### Show a result the way a scientist would

The same `exhibit` template carries a research result as well as it carries
a revenue chart: the evidence on the left, the finding on the right, the
method in the source line.

~~~slide
@extends exhibit
#title: The v1.2 planner rewrite cut p95 latency 4x
#chart:
  ```chart
  {"type":"line","title":"p95 query latency (ms)","labels":["v1.0","v1.1","v1.2","v1.3","v1.4"],"values":[820,640,410,250,190],"color":"#15803d","dataLabels":false}
  ```
#takeaway:
  Each release moved a different bottleneck.

  **v1.2** was the single biggest step - 410ms, down from 640ms.
#source: 10k-query replay, warm cache, n = 5 runs per release.
~~~

### Give one sentence the whole slide

`@extends quote` centers a single line - a customer voice, a thesis, a
sentence worth dwelling on.

~~~slide
@extends quote
#lead: "We replaced four spreadsheets and a weekly status meeting with one dashboard."
#attribution: Director of RevOps, mid-market customer
~~~

### Close on something worth remembering

`@extends closing` is the quiet bookend. Not "thanks for listening" - one
line the room keeps.

~~~slide
@extends closing
#lead: Series B conversations open in June.
#contact: northwind.example  /  board@northwind.example
~~~

## Brand the slide

The deck above keeps one consistent styling for the same reason a real deck
does - the audience reads it once and stops noticing. Raw shapes can do the
opposite: every slide can speak in a different visual language. The six
below are single slides from six fictional companies, each pushed in a
different direction. The DSL underneath is identical; what changes is the
palette, the composition, and the tone of the copy.

### A perfumery: one shape, vast negative space

Near-monochrome ground, one hairline rule, one large word. Almost everything
on this slide is empty space, which is the point - the brand is the
restraint.

~~~slide
grid 100 56.25 bg=#ece6dc
r 8 7 40 3 text=caption color=#111111 align=left | maison ardent  -  no. 7
r 8 18 80 24 size=fit maxfont=180 color=#111111 align=left valign=center | nuit blanche
l 8 46 22 46 stroke=#111111 strokeWidth=0.08
r 8 48 70 3 text=caption color=#555555 align=left | eau de parfum  /  100ml  /  available 09.2026
r 78 52 14 3 text=caption color=#555555 align=right | paris
~~~

````
~~~slide
grid 100 56.25 bg=#ece6dc
r 8 7 40 3 text=caption color=#111111 align=left | maison ardent  -  no. 7
r 8 18 80 24 size=fit maxfont=180 color=#111111 align=left valign=center | nuit blanche
l 8 46 22 46 stroke=#111111 strokeWidth=0.08
r 8 48 70 3 text=caption color=#555555 align=left | eau de parfum  /  100ml  /  available 09.2026
r 78 52 14 3 text=caption color=#555555 align=right | paris
~~~
````

### A newsroom: ink, newsprint, one signal red

Asymmetric weekend-magazine grid. A long body column sits beside a black
exhibit panel; the kicker is the only saturated colour on the slide. The
dateline is the brand.

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

````
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
````

### A self-custody exchange: terminal black, acid green

Crypto-native, openly opinionated, with the metric front and centre and the
copy reading like a status line. Hard rectangles, no rounded corners
anywhere - the brand is the absence of softness.

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

````
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
````

### A wellness brand: warm earth tones, rounded corners

Apothecary feel: oat and terracotta, generous `radius=`, soft circles in the
margins, lowercase copy in two sentences. The aesthetic does most of the
talking.

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

````
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
````

### A maximalist popsicle brand: clashing colour, deliberate overlap

Diagonal lines, polygons, circles, and an indigo wedge laid over hot pink at
`opacity=0.85`. The visual energy is the message; the copy yells.

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

````
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
````

### A clinical biotech: precise, one trust-blue accent

Sterile white with hairline rules, a four-phase trial diagram with anchored
arrows, and exactly one piece of saturated colour - the phase the data
actually covers.

~~~slide
grid 100 56.25 bg=#ffffff
r 6 6 60 3 text=caption color=#0b5cd6 align=left | HALSON BIOSCIENCES  ·  HBS-204  ·  ASCO 2026
l 6 10 94 10 stroke=#cfd6df strokeWidth=0.05
r 6 13 86 7 text=title color=#0f172a align=left | HBS-204 in advanced cholangiocarcinoma
r 6 22 70 4 text=caption color=#475569 align=left | Phase 2b, open-label, n = 184. Primary endpoint: ORR at 24 weeks.
r 6 30 16 9 #ph1 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 1**
  safety
r 27 30 16 9 #ph2 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 2a**
  dose-finding
r 48 30 16 9 #ph2b fill=#0b5cd6 color=#ffffff align=center valign=center |
  **Phase 2b**
  ORR 41%
r 69 30 16 9 #ph3 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 3**
  planned Q4
a @ph1.right @ph2.left stroke=#94a3b8 strokeWidth=0.05
a @ph2.right @ph2b.left stroke=#94a3b8 strokeWidth=0.05
a @ph2b.right @ph3.left stroke=#0b5cd6 strokeWidth=0.08
l 6 48 94 48 stroke=#cfd6df strokeWidth=0.05
r 6 49 88 3 text=caption color=#94a3b8 align=left | Data on file. Forward-looking statements subject to risks described in 10-K, Item 1A.
~~~

````
~~~slide
grid 100 56.25 bg=#ffffff
r 6 6 60 3 text=caption color=#0b5cd6 align=left | HALSON BIOSCIENCES  ·  HBS-204  ·  ASCO 2026
l 6 10 94 10 stroke=#cfd6df strokeWidth=0.05
r 6 13 86 7 text=title color=#0f172a align=left | HBS-204 in advanced cholangiocarcinoma
r 6 22 70 4 text=caption color=#475569 align=left | Phase 2b, open-label, n = 184. Primary endpoint: ORR at 24 weeks.
r 6 30 16 9 #ph1 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 1**
  safety
r 27 30 16 9 #ph2 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 2a**
  dose-finding
r 48 30 16 9 #ph2b fill=#0b5cd6 color=#ffffff align=center valign=center |
  **Phase 2b**
  ORR 41%
r 69 30 16 9 #ph3 stroke=#cfd6df strokeWidth=0.08 align=center valign=center color=#475569 |
  **Phase 3**
  planned Q4
a @ph1.right @ph2.left stroke=#94a3b8 strokeWidth=0.05
a @ph2.right @ph2b.left stroke=#94a3b8 strokeWidth=0.05
a @ph2b.right @ph3.left stroke=#0b5cd6 strokeWidth=0.08
l 6 48 94 48 stroke=#cfd6df strokeWidth=0.05
r 6 49 88 3 text=caption color=#94a3b8 align=left | Data on file. Forward-looking statements subject to risks described in 10-K, Item 1A.
~~~
````

### Borrow the document's palette

Any colour value can be a `$`-reference instead of a hex code.
`bg=$blocks.background`, `color=$h1.color` - the slide pulls live values from
the document's own styles, so it always matches the surrounding doc and
follows it through a restyle or into dark mode.

~~~slide
grid 100 56.25 bg=$blocks.background
r 8 8 84 5 text=caption color=$h2.color align=left | NOT ONE HEX CODE ON THIS SLIDE
r 8 17 84 14 text=title color=$h1.color align=left | It borrows the document's palette
r 8 33 80 12 text=body color=$p.color align=left | Every colour here is a `$`-reference - `bg=$blocks.background`, `color=$h1.color`. Restyle the document and this slide follows it.
~~~

````
~~~slide
grid 100 56.25 bg=$blocks.background
r 8 8 84 5 text=caption color=$h2.color align=left | NOT ONE HEX CODE ON THIS SLIDE
r 8 17 84 14 text=title color=$h1.color align=left | It borrows the document's palette
r 8 33 80 12 text=body color=$p.color align=left | Every colour here is a `$`-reference - `bg=$blocks.background`, `color=$h1.color`. Restyle the document and this slide follows it.
~~~
````

### A note on fonts

Fonts do not work like colours. There is no per-slide or per-shape font
attribute - a slide inherits the document's fonts the same way it inherits
its background. This gallery uses SDocs defaults (Inter), but adding a
`fontFamily` to your deck's front matter re-fonts every slide at once:

```yaml
---
title: My deck
styles:
  fontFamily: Montserrat
  headers:
    fontFamily: Playfair Display
---
```

Style fonts at the deck level and colour at the slide level. Run
`sdoc schema` for the full list of styleable properties and the 24 fonts
available.

## Beyond templates: raw shapes

The templates above cover most of a deck. When a slide needs a layout no
template has - a process flow, a funnel, a market map - you compose it from
raw shapes. The primitives, operators, and layering rules come first; the
seven compositions that follow each apply them. Run `sdoc slides custom-shapes`
for the design notes.

### The shape kinds

Six primitives, placed by coordinate:

- `r x y w h` - rectangle (top-left corner plus size). Holds text and full markdown.
- `c cx cy radius` - circle (center plus radius).
- `e cx cy rx ry` - ellipse (center plus half-sizes).
- `l x1 y1 x2 y2` - line (decorative).
- `a x1 y1 x2 y2` - arrow (decorative; the tip lands on the second point).
- `p x1,y1 x2,y2 ...` - polygon (points are comma-separated `x,y` tokens).

Rectangles, circles, ellipses and polygons can all carry markdown content
after a `|`. Lines and arrows are decoration only.

One layout gotcha: a shape's `h` is the layout rectangle, not a hard clip.
Letters with descenders (g, p, q, y, j) draw about 20% of the font size
below the baseline, so they can hang outside the bottom of a text shape and
clash with whatever sits below. Leave a unit of breathing room under any
`text=title` or `text=subtitle` shape when the next shape is a filled box.

### Curves and segment operators

Polygon edges are straight by default. An operator between two points curves
the edge into the next one:

- `~` - a soft bow, about 10% of the chord length.
- `^h` - an arc of explicit depth `h`.
- `>P` - a quadratic curve passing through point `P`.
- `* P1 P2` - a cubic curve passing through `P1` then `P2`.
- `(r` before a point - rounds that corner with radius `r`.

The same `^h` works between a line or arrow's two endpoints to bow the
connector. A card with a domed top, a speech bubble, or a curved arrow
between two boxes are each one polygon or one arrow:

````
p 8,16 ^4 32,16 32,40 8,40            (arched-top card)
p (3 8,16 (3 32,16 (3 32,40 (3 8,40   (rounded corners)
a 10,30 ^6 50,30                      (bowed connector)
````

### Opacity and layering

Shapes paint in source order - a shape declared later sits on top of one
declared earlier. `opacity=N` (0 to 1) fades a shape so overlaps read as a
relationship rather than a stack. `layer=top | mid | bottom` is the escape
hatch for when source order is not enough.

### A process flow with one focal step

Repetition plus one deviation reads as a system: four cards share a
treatment, and the one that matters gets the slide's only saturated fill.
`#id` / `@id` references let arrows dock onto shape edges instead of raw
coordinates.

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

````
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
````

### A funnel, where the geometry is the data

Polygon bands taper from stage to stage, and each band's width tracks its
count - so the silhouette carries the drop-off before anyone reads a number.
The saturated band marks the stage that pays the bills; the counts sit in a
column to the side because the narrow bands cannot hold them.

~~~slide
grid 100 56.25
r 6 5 88 5 text=subtitle align=left | Sales funnel: where deals fall out
p 6,13 62,13 50.8,20.5 17.2,20.5 fill=#e2e8f0
p 17.2,21 50.8,21 44.1,28.5 23.9,28.5 fill=#e2e8f0
p 23.9,29 44.1,29 38.9,36.5 29.1,36.5 fill=#e2e8f0
p 29.1,37 38.9,37 37,44.5 31,44.5 fill=#1e40af
r 66 13.75 30 6 align=left valign=center | **1,200**  Leads
r 66 21.75 30 6 align=left valign=center | **720**  Qualified
r 66 29.75 30 6 align=left valign=center | **430**  Demo booked
r 66 37.75 30 6 color=#1e40af align=left valign=center | **210**  Closed won
~~~

````
~~~slide
grid 100 56.25
r 6 5 88 5 text=subtitle align=left | Sales funnel: where deals fall out
p 6,13 62,13 50.8,20.5 17.2,20.5 fill=#e2e8f0
p 17.2,21 50.8,21 44.1,28.5 23.9,28.5 fill=#e2e8f0
p 23.9,29 44.1,29 38.9,36.5 29.1,36.5 fill=#e2e8f0
p 29.1,37 38.9,37 37,44.5 31,44.5 fill=#1e40af
r 66 13.75 30 6 align=left valign=center | **1,200**  Leads
r 66 21.75 30 6 align=left valign=center | **720**  Qualified
r 66 29.75 30 6 align=left valign=center | **430**  Demo booked
r 66 37.75 30 6 color=#1e40af align=left valign=center | **210**  Closed won
~~~
````

### Three circles, one set diagram

Three translucent circles at `opacity=0.55`. Where any two overlap, the
combined opacity is about 0.8; where all three overlap, the canvas reads
almost opaque. The overlap is the data - move a circle and the regions
update for free.

~~~slide
grid 100 56.25 bg=#0b1220
r 6 4 88 4 text=caption color=#94a3b8 align=left | OPACITY LAYERING - THE OVERLAP IS THE DATA
r 6 9 88 4 text=subtitle color=#f1f5f9 align=left | Who our three product lines actually serve
c 40 28 9 fill=#38bdf8 opacity=0.55
c 54 28 9 fill=#f43f5e opacity=0.55
c 47 38 9 fill=#facc15 opacity=0.55
r 16 22 16 4 text=caption color=#e0f2fe align=right | Analysts
r 62 22 16 4 text=caption color=#fee2e2 align=left | Engineers
r 39 49 16 4 text=caption color=#fef9c3 align=center | Executives
r 41 31 12 4 text=caption color=#ffffff align=center valign=center | **all three**
~~~

````
~~~slide
grid 100 56.25 bg=#0b1220
r 6 4 88 4 text=caption color=#94a3b8 align=left | OPACITY LAYERING - THE OVERLAP IS THE DATA
r 6 9 88 4 text=subtitle color=#f1f5f9 align=left | Who our three product lines actually serve
c 40 28 9 fill=#38bdf8 opacity=0.55
c 54 28 9 fill=#f43f5e opacity=0.55
c 47 38 9 fill=#facc15 opacity=0.55
r 16 22 16 4 text=caption color=#e0f2fe align=right | Analysts
r 62 22 16 4 text=caption color=#fee2e2 align=left | Engineers
r 39 49 16 4 text=caption color=#fef9c3 align=center | Executives
r 41 31 12 4 text=caption color=#ffffff align=center valign=center | **all three**
~~~
````

### A bento dashboard, eight tiles, no drag

Eight rectangles, three sizes, one 1-unit gutter, one accent fill.
Asymmetric layouts that take twenty minutes of nudge-and-align in a WYSIWYG
tool are arithmetic here - every tile is the same shape kind with the same
radius, and the variation lives entirely in width and height.

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4 92 5 text=caption color=#94a3b8 align=left | Q1 BENTO - eight tiles, one grid, raw rectangles
r 4 11 28 20 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### $2.36M
  ARR, +39% YoY
r 33 11 28 20 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 4.1%
  monthly churn, was 8.3%
r 62 11 34 9 fill=#22d3ee radius=1.5 color=#06262b padding=2 align=left valign=center | **Net retention 132%**
r 62 21 34 10 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 1,243
  paying accounts
r 4 32 19 18 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 9.7
  NPS / 10
r 24 32 19 18 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 18 mo
  CAC payback
r 44 32 28 18 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 190ms
  p95 query, was 820ms
r 73 32 23 18 fill=#1e293b radius=1.5 color=#f8fafc padding=2 align=left valign=center |
  ### 12
  new logos, Q1
r 4 51 92 3 text=caption color=#64748b align=left | One grid. Eight tiles. No drag.
~~~

### A 2x2 matrix where position is the argument

Two crossed axis arrows, four labelled quadrants, and dots whose `cx,cy`
encodes impact and effort. Read the source: a dot at `c 30 22` is genuinely
in the upper-left "cheap and high-impact" quadrant - the coordinates carry
the meaning, not the labels.

~~~slide
grid 100 56.25
r 6 4 88 4 text=caption align=left | STRATEGY MATRIX - the position is the argument
r 6 9 88 4 text=subtitle align=left | Where each Q2 bet lands on impact vs effort
a 18 48 18 14 stroke=#94a3b8 strokeWidth=0.1
a 18 48 90 48 stroke=#94a3b8 strokeWidth=0.1
r 10 13 8 4 text=caption color=#475569 align=right | Impact
r 86 49 8 4 text=caption color=#475569 align=left | Effort
l 54 14 54 48 stroke=#e2e8f0 strokeWidth=0.1
l 18 31 90 31 stroke=#e2e8f0 strokeWidth=0.1
r 20 16 32 4 text=caption color=#94a3b8 align=left | Big wins / cheap
r 56 16 32 4 text=caption color=#94a3b8 align=right | Big wins / costly
r 20 42 32 4 text=caption color=#94a3b8 align=left | Filler
r 56 42 32 4 text=caption color=#94a3b8 align=right | Time sinks
c 30 22 1.4 fill=#1e40af
r 33 20 22 4 text=caption color=#1e40af align=left | Audit log
c 42 26 1.4 fill=#1e40af
r 45 24 22 4 text=caption color=#1e40af align=left | SSO
c 70 18 1.8 fill=#f43f5e
r 58 14 10 4 text=caption color=#f43f5e align=right | Multi-region
c 78 38 1.4 fill=#94a3b8
r 60 36 17 4 text=caption color=#94a3b8 align=right | Plugin SDK
c 28 42 1.2 fill=#94a3b8
r 31 40 24 4 text=caption color=#94a3b8 align=left | Theme picker
r 6 52 88 3 text=caption color=#64748b align=left | Top-left wins ship first. Multi-region is the only top-right with funding.
~~~

````
~~~slide
grid 100 56.25
r 6 4 88 4 text=caption align=left | STRATEGY MATRIX - the position is the argument
r 6 9 88 4 text=subtitle align=left | Where each Q2 bet lands on impact vs effort
a 18 48 18 14 stroke=#94a3b8 strokeWidth=0.1
a 18 48 90 48 stroke=#94a3b8 strokeWidth=0.1
r 10 13 8 4 text=caption color=#475569 align=right | Impact
r 86 49 8 4 text=caption color=#475569 align=left | Effort
l 54 14 54 48 stroke=#e2e8f0 strokeWidth=0.1
l 18 31 90 31 stroke=#e2e8f0 strokeWidth=0.1
r 20 16 32 4 text=caption color=#94a3b8 align=left | Big wins / cheap
r 56 16 32 4 text=caption color=#94a3b8 align=right | Big wins / costly
r 20 42 32 4 text=caption color=#94a3b8 align=left | Filler
r 56 42 32 4 text=caption color=#94a3b8 align=right | Time sinks
c 30 22 1.4 fill=#1e40af
r 33 20 22 4 text=caption color=#1e40af align=left | Audit log
c 42 26 1.4 fill=#1e40af
r 45 24 22 4 text=caption color=#1e40af align=left | SSO
c 70 18 1.8 fill=#f43f5e
r 58 14 10 4 text=caption color=#f43f5e align=right | Multi-region
c 78 38 1.4 fill=#94a3b8
r 60 36 17 4 text=caption color=#94a3b8 align=right | Plugin SDK
c 28 42 1.2 fill=#94a3b8
r 31 40 24 4 text=caption color=#94a3b8 align=left | Theme picker
r 6 52 88 3 text=caption color=#64748b align=left | Top-left wins ship first. Multi-region is the only top-right with funding.
~~~
````

### An org chart whose arrows survive an edit

Five boxes, six connectors, zero literal endpoint coordinates. Every arrow
docks onto a named shape via `@id.anchor`, and the two cyan sibling links
across the bottom curve with `^-3` so they bow past each other rather than
crossing. Move a box and the lines track.

~~~slide
grid 100 56.25
r 6 4 88 4 text=caption align=left | ORG - arrows anchored to shape ids, siblings curved
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
r 6 50 88 4 text=caption color=#64748b align=left | Cyan links are cross-functional pairings - bowed with `^-3` so they don't sit on top of each other.
~~~

````
~~~slide
grid 100 56.25
r 6 4 88 4 text=caption align=left | ORG - arrows anchored to shape ids, siblings curved
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
r 6 50 88 4 text=caption color=#64748b align=left | Cyan links are cross-functional pairings - bowed with `^-3` so they don't sit on top of each other.
~~~
````

### A timeline where coordinates mean dates

The horizontal line is the year. Each milestone circle sits at a `cx` that
corresponds to its date - January at 8, December at 92 - so the eye can read
"about three quarters in" off the geometry. The fatter red dot marks today.

~~~slide
grid 100 56.25 bg=#fafaf9
r 6 5 88 4 text=caption color=#78716c align=left | TIMELINE - position on the grid is the date
r 6 10 88 5 text=subtitle color=#1c1917 align=left | The road from v1.0 to Series B
l 8 30 92 30 stroke=#a8a29e strokeWidth=0.18
c 12 30 1.6 fill=#a8a29e
c 28 30 1.6 fill=#a8a29e
c 44 30 1.6 fill=#a8a29e
c 56 30 2.4 fill=#dc2626
c 72 30 1.6 fill=#a8a29e
c 88 30 1.6 fill=#a8a29e
r 4 18 16 4 align=center color=#1c1917 | **v1.0 ships**
r 4 22 16 5 text=caption color=#44403c align=center | Jun '25
r 20 35 16 4 align=center color=#1c1917 | **First $1M ARR**
r 20 39 16 5 text=caption color=#44403c align=center | Sep '25
r 36 18 16 4 align=center color=#1c1917 | **Planner rewrite**
r 36 22 16 5 text=caption color=#44403c align=center | Dec '25
r 48 35 16 4 align=center color=#dc2626 | **Today: board review**
r 48 39 16 5 text=caption color=#dc2626 align=center | May '26
r 64 18 16 4 align=center color=#1c1917 | **Series B open**
r 64 22 16 5 text=caption color=#44403c align=center | Aug '26
r 80 35 16 4 align=center color=#1c1917 | **Multi-region GA**
r 80 39 16 5 text=caption color=#44403c align=center | Nov '26
r 6 49 88 4 text=caption color=#78716c align=left | The red dot is today. Every other date is a real fraction of the grid.
~~~

````
~~~slide
grid 100 56.25 bg=#fafaf9
r 6 5 88 4 text=caption color=#78716c align=left | TIMELINE - position on the grid is the date
r 6 10 88 5 text=subtitle color=#1c1917 align=left | The road from v1.0 to Series B
l 8 30 92 30 stroke=#a8a29e strokeWidth=0.18
c 12 30 1.6 fill=#a8a29e
c 28 30 1.6 fill=#a8a29e
c 44 30 1.6 fill=#a8a29e
c 56 30 2.4 fill=#dc2626
c 72 30 1.6 fill=#a8a29e
c 88 30 1.6 fill=#a8a29e
r 4 18 16 4 align=center color=#1c1917 | **v1.0 ships**
r 4 22 16 5 text=caption color=#44403c align=center | Jun '25
r 20 35 16 4 align=center color=#1c1917 | **First $1M ARR**
r 20 39 16 5 text=caption color=#44403c align=center | Sep '25
r 36 18 16 4 align=center color=#1c1917 | **Planner rewrite**
r 36 22 16 5 text=caption color=#44403c align=center | Dec '25
r 48 35 16 4 align=center color=#dc2626 | **Today: board review**
r 48 39 16 5 text=caption color=#dc2626 align=center | May '26
r 64 18 16 4 align=center color=#1c1917 | **Series B open**
r 64 22 16 5 text=caption color=#44403c align=center | Aug '26
r 80 35 16 4 align=center color=#1c1917 | **Multi-region GA**
r 80 39 16 5 text=caption color=#44403c align=center | Nov '26
r 6 49 88 4 text=caption color=#78716c align=left | The red dot is today. Every other date is a real fraction of the grid.
~~~
````

## Present it

Click the present icon in a slide's top-right corner to go fullscreen, or
open a whole file straight into the deck with `sdoc present file.md`. Arrow
keys navigate, `Esc` exits, and a thumbnail rail down the side jumps between
slides. The same deck exports to PDF from the export menu - one page per
slide, with selectable text, and charts and diagrams rasterised at 2x DPR.
