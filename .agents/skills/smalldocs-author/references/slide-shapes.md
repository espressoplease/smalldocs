# Custom slide shapes

Use custom shapes when geometry explains the idea. A custom slide begins with a grid followed by shapes. Coordinates are grid units.

````md
~~~slide
grid 16 9 bg=#f8fafc
r 1 0.7 14 1 #title text=subtitle align=left color=#0f172a | How a result reaches the reader
r 1 3 3.2 2 fill=#e0e7ff color=#312e81 radius=0.2 | Agent analysis
a 4.4 4 6 4 color=#64748b
r 6 3 4 2 fill=#dbeafe color=#0c4a6e radius=0.2 | Markdown
a 10.2 4 11.8 4 color=#64748b
r 12 3 3 2 fill=#dcfce7 color=#14532d radius=0.2 | SmallDocs view
~~~
````

Prefer `grid 16 9` for ordinary widescreen slides. Keep meaningful content inside approximately `x=1..15` and `y=0.5..8.5`.

## Shape kinds

```text
r x y w h              rectangle
c cx cy radius         circle
e cx cy rx ry          ellipse
l x1 y1 x2 y2          line
a x1 y1 x2 y2          arrow
p x1,y1 x2,y2 ...      polygon
chev x y w h            chevron or arrow block
bub x y w h             speech bubble, requires tail=tx,ty
cyl x y w h             cylinder or data store
tab x y w h             tab or step marker
doc x y w h             document with folded corner
cloud x y w h           cloud source or destination
icon x y w h            Lucide outline icon, requires name=<icon>
```

Common icon names include `user`, `users`, `database`, `server`, `lock`, `cloud`, `search`, `settings`, `file-text`, `code`, `brain`, `bot`, `chart-line`, and `trending-up`. Unknown names render a visible placeholder. The complete installed CLI can search names with `sdoc slides icons QUERY`.

## Common attributes

Attributes appear between the geometry and the `|` content separator:

```text
fill=#hex             shape fill
stroke=#hex           outline colour
strokeWidth=N         outline width
color=#hex            text, line, arrow, or icon colour
radius=N              rectangle or bubble corner radius
padding=N             inner text padding
align=left|center|right
valign=top|center|bottom
text=title|subtitle|body|caption
size=fit              fit short text to its box
opacity=0..1
bleed=allow           acknowledge intentional off-canvas overflow for this shape
```

Text after `|` is Markdown content. New source lines indented beneath a shape continue that shape's content.
For a short inline label, `\\n` inserts a visible line break. Write `\\\\n` when the literal text `\\n` is required.

Shape colours can follow the document theme with style references such as `color=$color`, `color=$h1.color`, `fill=$background`, and `fill=$blocks.background`. References resolve to live document CSS values and adapt when the reader theme changes.

## Visual rules

- Use position, direction, size, or grouping to represent an actual relationship.
- Use one focal treatment per slide. Repetition plus one deviation directs attention.
- Prefer no stroke or a thin neutral stroke. Thick coloured outlines usually add noise.
- Reserve saturated fill for the focal element. Use pale fills for containers.
- Keep most multiword text left aligned. Centre only short labels or balanced callouts.
- Use two or three text roles per slide. `caption` is for supporting information, not the main argument.
- Make geometry proportional when it represents numeric magnitude. State any non-linear scale.
- Keep source order in mind: a later filled shape can cover an earlier shape.
- Reuse a small shape vocabulary across the deck so the audience learns the visual language.
- Pair an explicit slide background with explicit text colours. If the grid uses `bg=#f8fafc`, every text-bearing shape should declare a contrasting `color=`. If the slide should follow the document theme, omit the grid background and use references such as `color=$color` instead.

## Conceptual flow example

````md
~~~slide
grid 16 9
r 1 0.6 14 1 #title text=subtitle align=left color=$color | One document drives content-dependent rendering
cyl 1.2 3 2.6 2.5 fill=#eef2ff color=#312e81 | Markdown
a 4.1 4.25 6 4.25 color=#64748b
r 6.2 2.7 3.6 3 fill=#dbeafe color=#0c4a6e radius=0.25 | Discover features
a 10 4.25 11.8 4.25 color=#64748b
chev 12 3 3 2.5 fill=#dcfce7 color=#14532d | Load only what is used
~~~
````

The labels remain meaningful in the source, while the geometry shows storage, transformation, and outcome.

## Five-stage left-to-right pipeline

Five compact stages fit inside the safe area when labels wrap to two short lines. Keep the outcome in the same row when the requested relationship is explicitly left to right.

````md
~~~slide
grid 16 9 bg=#f8fafc
r 1 0.6 14 0.9 text=subtitle align=left color=#0f172a | One result moves through five visible stages
r 1 3.1 2 2.2 fill=#e0e7ff color=#312e81 radius=0.22 align=center | Agent
  analysis
a 3.1 4.2 3.5 4.2 color=#64748b
doc 3.6 3.1 2.2 2.2 fill=#ffffff stroke=#94a3b8 color=#0f172a align=center | Finished
  Markdown
a 5.9 4.2 6.3 4.2 color=#64748b
r 6.4 3.1 2.4 2.2 fill=#dbeafe color=#0c4a6e radius=0.22 align=center | Content
  discovery
a 8.9 4.2 9.3 4.2 color=#64748b
chev 9.4 3.1 2.2 2.2 fill=#fef3c7 color=#78350f align=center | Lazy feature
  loading
a 11.7 4.2 12.1 4.2 color=#64748b
r 12.2 3.1 2.5 2.2 fill=#dcfce7 color=#14532d radius=0.22 align=center | Embedded
  view
~~~
````
