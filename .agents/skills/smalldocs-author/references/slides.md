# Slides

Use one `slide` fence per slide. Prefer tilde fences so a slide can contain nested backtick code fences.

````md
~~~slide
@extends title-body
#title: The renderer turns analysis into a reading surface
#body:
- The agent returns finished Markdown
- SmallDocs discovers rich content
- The application does not parse blocks
~~~
````

## Built-in templates

Use a built-in template with `@extends NAME`. For example, a rendered cover starts with `@extends cover`.

`@template NAME` has a different purpose: it defines a reusable user template, does not render that fence as a slide, and shadows a built-in with the same name. Do not use `@template cover` or `@template two-column` when the goal is to render a built-in layout.

| Template | Slots |
| --- | --- |
| `cover` | `eyebrow`, `title!`, `subtitle`, `meta` |
| `title-body` | `title!`, `body!`, `footer` |
| `two-column` | `title!`, `left-header`, `left!`, `right-header`, `right!` |
| `three-column` | `title!`, `left-header`, `left!`, `mid-header`, `mid!`, `right-header`, `right!` |
| `exhibit` | `title!`, `chart!`, `takeaway!`, `source` |
| `image-and-text` | `title`, `image!`, `body!` |
| `figure-hero` | `image!`, `caption` |
| `quote` | `lead!`, `attribution` |
| `metric` | `metric!`, `context` |
| `section` | `kicker`, `title!`, `subtitle` |
| `closing` | `lead!`, `contact` |

`!` marks a required slot. A slot may be one line or a multiline block following `#name:`.

Fill a required slot with the ordinary slot name, such as `#title:`. A copied `#title!:` is also accepted, but the marker only describes the template requirement and is not needed in a consumer slide.

## Visual explanation is part of normal slide authoring

Templates are useful for covers, section dividers, quotations, simple text, and repeated layouts. Do not make every internal presentation a sequence of title-and-bullet slides.

When a slide explains a process, architecture, hierarchy, comparison, feedback loop, market structure, or causal model, use custom shapes to encode that meaning visually. Internal audiences also benefit from seeing the model instead of reconstructing it from bullets.

Read [custom slide shapes](slide-shapes.md) before writing those slides. Typical combinations include:

- rectangles plus arrows for systems and flows
- chevrons for stages
- circles or ellipses for overlapping categories
- a cylinder for storage and arrows for data movement
- a speech bubble for a callout attached to a specific element
- icons paired with labels for compact concept maps

Use a template for the surrounding deck and custom shapes for the slides where geometry communicates the argument. A deck can mix both.

## Verification

Raw shapes use fixed geometry and source order is paint order. When the CLI is available, run `sdoc present file.md` and inspect text overlap, contrast, label wrapping, connector placement, balance, and consistency. Count the rendered slides against the requested deck length before handoff. If rendering is unavailable, keep the number of shapes low, use a 16 by 9 grid, and leave a one-unit safe margin.
