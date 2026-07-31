---
title: "Slides help: the additions"
# Comments: block "tag:n" = nth (0-indexed) <tag> in render order.
# block kind may carry block_text (first ~60 chars) as a survival hint when the index drifts.
# inline kind anchors via quote (+ optional prefix/suffix). resolved: true marks addressed.
comments:
  - id: "c1"
    kind: "block"
    block: "blockquote:0"
    block_text: "Templates for scratch, custom layout for anything seen. The"
    author: "user"
    color: "#ffbb00"
    at: "2026-06-30T10:38:23.294Z"
    text: "slim this down, drop:\n\"Give it one accent colour used for one role per slide, a deliberate hierarchy (one number or word per slide that the eye lands on first), light and dark slides arranged for rhythm, and a layout shaped to the content rather than content poured into a slot. That costs more to author and you cannot see it as you place coordinates, so render and check it (sdoc present, or a screenshot) before you trust it, and read sdoc slides custom-shapes for the shape vocabulary and the rules that keep a hand-built slide from reading as amateur.\"\nit is too prescriptive.\n\nbut do keep a mention to sdoc slides custom-shapes"
    resolved: true
  - id: "c2"
    kind: "block"
    block: "blockquote:1"
    block_text: "When the deck is internal or you only need it to read clear"
    author: "user"
    color: "#ffbb00"
    at: "2026-06-30T10:39:36.446Z"
    text: "does this section talk about building own templates - okay to do as they can be built with custom shapes, rather than relying on default templates?"
    resolved: true
  - id: "c3"
    kind: "block"
    block: "blockquote:3"
    block_text: "Verify what you cannot see. Every principle above is a gues"
    author: "user"
    color: "#ffbb00"
    at: "2026-06-30T10:41:29.897Z"
    text: "fine but a bit too harsh, can you make this gentler - attempt to verify what you cannot see. Also maybe suggest that this can be discussed with the user - I'd like to use playwright to verify the slides, is that fine with you?"
    resolved: true
  - id: "c4"
    kind: "inline"
    quote: "They are not designed for an audience, and a deck built only from them reads that way"
    prefix: "ck you will talk over and then discard. "
    suffix: " - the same header-and-body beat on ever"
    author: "user"
    color: "#ffbb00"
    at: "2026-06-30T10:45:12.877Z"
    resolved: true
    text: "I think this is too harsh, maybe - they are not designed for an audience which cares about feel - they are good when fast information transfer is the goal - you can confirm the setting with your user if not sure - explain to them what you are considering."
---

# What got added to the slides help

Three edits, all in `cli/lib/help-text.js`. Two land in `sdoc slides`, one in `sdoc slides custom-shapes`. No `AGENT_BLOCK` change, so no version bump.

---

## 1. `sdoc slides` -> DESIGN GUIDELINES: scratch vs external

New guideline near the top of the section (read before the mechanics):

> **Templates for scratch, custom layout for anything seen.** The built-in templates are the fast path: legible, consistent, and well suited to fast information transfer - an internal review, a working draft, a deck you will talk over. They are not built for an audience that cares about feel, so a deck made only from them reads as functional rather than designed. For anything external-facing - a client, a conference, a launch, anything with your name on it that you will not be in the room to narrate - compose the deck from raw shapes instead. If you are not sure which setting you are in, ask your user, explaining the trade-off: templates are faster and uniform, raw shapes take longer but let the deck carry a designed look. See `sdoc slides custom-shapes` for the shape vocabulary and the design principles that go with it.

And the closing line of the section, reworded so it no longer steers away from raw shapes by default:

> When the deck is internal or you only need it to read clearly, `@extends` a built-in template instead of composing from raw shapes - run `sdoc slides list` to see the registry. Reach for raw shapes when the deck will be seen by an audience and the default beat is not enough; the guidelines above are what keep that hand-built deck on the professional side of the line. If a custom layout repeats across slides, define it once as your own `@template` and `@extends` it - the consistency of a template with a look you designed.

---

## 2. `sdoc slides` -> new section: VERIFYING A DECK

A whole new section. This is the verify-loop guidance, written to leave the resolution to the agent's environment.

> **VERIFYING A DECK (OPTIONAL, BUT IT IS WHAT SEPARATES CLEAN FROM BROKEN)**
>
> You are authoring slides you cannot see. You place coordinates and trust them, and the renderer does not warn you when a shape covers text, when a label wraps to a line you did not intend, when text sits on a fill it cannot be read against, or when an arrow lands in empty space. Templates mostly avoid this; hand-placed raw shapes do not. The single most effective check is to look at the rendered result and fix what you see.
>
> If you have a way to render a page to an image - a headless browser you can drive (Playwright or Puppeteer in headless mode, a headless system Chrome), or any screenshot tool in your environment - use it. Open the deck, capture the slides, look, fix the DSL, and render again. Two or three passes turns a deck with hidden text and clipped labels into one that reads cleanly. When you render, check each slide for:
>
> - text covered by a shape drawn after it (source order is paint order)
> - text with poor contrast against whatever is actually painted under it
> - labels that wrap or overflow their box
> - connectors (l / a) that float short of, or pierce, what they join
> - a composition that sits low, high, or lopsided in the frame
>
> The CLI does not bundle a browser - it has no runtime dependencies on purpose - so this check is something you bring from your environment, not something sdoc installs. If you do not have a headless browser and you judge that rendering would catch real problems, you can ask your user to install one (for example `npx playwright install chromium`, or to point you at a browser already on the machine) and explain why: a render check catches the text-overlap, contrast, and wrapping faults that are invisible in the markdown source. Leave the decision to them; it is their machine, and the subtleties of what is available are yours to work out in context.
>
> `sdoc present <file>` opens the deck fullscreen for a human to review, which is the right check when a person is in the loop. If you cannot render at all, keep each slide simple enough to verify by arithmetic - list every text shape's box and confirm no later shape's fill overlaps it - and prefer templates for anything you will not be able to see.

---

## 3. `sdoc slides custom-shapes` -> pointer principle

A short principle added to the end of DESIGN PRINCIPLES, so an agent doing raw-shape work is sent to the verify section:

> **Attempt to verify what you cannot see.** The principles above guide the layout, but a hand-placed shape can still cover text, a label can wrap, or an arrow can miss its target, and none of it shows in the source. If you can drive a headless browser or any screenshot tool in your environment, render the deck and fix what you see before trusting it. If you cannot, it is worth raising with your user - for example, "I would like to use Playwright to verify the slides render correctly, is that okay?" - since a quick render check catches problems the markdown cannot show. See the VERIFYING A DECK section of `sdoc slides` for what to look for.

---

## Why this shape, not a linter

The four-deck study said a coordinate-only linter would catch ~1 real defect in 18 while wrongly flagging ~20 deliberate design choices (full-bleed backgrounds, nested proportional diagrams, repeated accent elements, matrix cells sharing edges). The blind first drafts were geometrically clean; the real defects lived below the coordinate layer (stroke visibility, contrast, wrap, a markdown autolink turning blue) or above it (a slide with no claim). The thing that produced every good deck was seeing the render. So the docs point at that, and let the agent sort out the how.
