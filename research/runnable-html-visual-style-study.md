# Runnable HTML visual style study

## Method

Three fresh agents received the same functional brief for an investment thesis
evidence board. The agents used different model capability profiles and did not
receive the surrounding project conversation. Each ran the `sdoc apps`
reference before authoring one complete component.

The shared brief was:

> Create one Markdown file containing exactly one complete interactive
> `sdoc-app` component: an investment thesis evidence board with three initial
> evidence statements, a Supports/Risk/Context classification control for each,
> a 1-5 weight control, Remove, Add evidence, and a compact summary of weighted
> support versus risk. Make it responsive inline and fullscreen. Choose the
> visual design yourself.

The generated files were reviewed locally in SmallDocs at the same inline
width. They were temporary study inputs rather than product examples, so they
were not added to the repository.

## Recurring treatments

| Treatment | Occurrence | Effect |
| --- | ---: | --- |
| A rounded card for every evidence item | 3 of 3 | Repeated content became visually heavier than its controls required. |
| A coloured left accent rail on every item | 3 of 3 | Classification received a strong, familiar decorative marker in addition to its text control. |
| A dashboard summary in a separate rounded surface | 3 of 3 | Three small values gained more hierarchy than the evidence itself in two designs. |
| Nested rounded surfaces | 3 of 3 | Outer canvas, summary, item, control, and badge shapes competed for attention. |
| Custom palette replacing the inherited document palette | 3 of 3 | Components read as separate microsites rather than parts of the document. |
| Decorative gradient or glow | 2 of 3 | Atmosphere was added without carrying application state. |
| Uppercase eyebrow with letter spacing | 3 of 3 | A landing-page convention appeared in a compact working tool. |
| Inline-width truncation | 1 of 3 | A horizontal row kept its controls by clipping the evidence statement. |

In this three-output sample, greater model capability improved code structure,
interaction details, and responsive behaviour, but did not remove the shared
visual conventions. The most elaborate result used more levels of cards and
decorative treatment.

## Guidance derived from the comparison

The authoring reference should not ban cards, rails, pills, gradients, or
shadows. Each can communicate useful grouping, category, selection, depth, or
atmosphere. The recurring problem was using them before establishing whether
the interaction needed them.

The lightest useful guidance is therefore procedural:

1. Start with semantic HTML and the inherited document design.
2. Choose the simplest structure that fits the task: page, list, table, form,
   canvas, or stage.
3. Establish hierarchy with order, wording, spacing, size, and weight.
4. Add a surface, semantic colour, or distinctive shape when it carries a
   specific grouping, state, or interaction.
5. Check whether repeated controls still read efficiently at the inline width.

For this evidence-board brief, a quieter starting point would be a ledger of
rows separated by rules, one compact summary line or bar, and one primary Add
action. Classification text already communicates category, so a coloured dot
could provide redundant visual scanning without turning every row into a
callout card.

## Guided rerun

A fourth fresh agent with the same lightweight capability profile received the
same brief after the first guidance draft was added to `sdoc apps`. Compared
with the original lightweight output, it removed the dark radial gradient,
shadows, coloured accent rails, and nested summary panel. It kept a separate
card for every evidence item, three metric cards, a custom palette, numbered
badges, and an uppercase eyebrow.

This rerun suggests that purpose-based guidance changes some automatic styling
choices, but concrete starting alternatives carry more weight. The final
reference therefore names divided rows, a single summary line or bar, and
unchanged inherited tokens as starting points while keeping every decorative
technique available when it communicates something specific.

A second fresh lightweight agent then received that final wording. Its result
used one compact summary bar, divided evidence rows, small semantic dots, and a
single Add action. It omitted item cards, accent rails, metric cards, gradients,
shadows, badges, and eyebrow text. The component had no horizontal overflow at
narrow or wide widths in either inline or fullscreen mode. This is one output,
not a general evaluation, but it confirms that the concrete alternatives are
understood by the kind of agent the guidance is intended to help.
