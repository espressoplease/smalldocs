# Writing style and public-facing copy

Read this guide when editing the homepage, install copy, README, public docs, release announcements, or user-visible UI strings.

## General writing style (docs, copy, UI strings, commit messages)

Calm, explicit, honest. Not salesy, not defensive, not cute.

- **State what something does, not how great it is.** "The server stores ciphertext," not "Our server never sees your data, your privacy is protected!"
- **Name trade-offs out loud.** If something costs you privacy, latency, or uptime compared to the alternative, say so plainly. Don't front-load reassurance to bury a caveat.
- **Skip rhetorical questions and self-defense.** "Doesn't this break privacy? It doesn't, and here's why..." is PR framing. Just describe what happens step by step; the reader forms their own view.
- **No hype words.** Avoid "simply", "just", "blazing", "seamless", "best-in-class", "trust us", "rest assured", "don't worry". Remove exclamation points from technical copy.
- **Imperative over aspirational.** "To verify, open devtools and watch the Network tab" beats "You don't have to take our word for it, feel free to verify it yourself!" Same information, half the words, no persuasion.
- **Show the mechanism, let the reader judge.** Diagrams, code, and HTTP traces are more convincing than adjectives. The Privacy section's MDN quote does this; follow that shape.
- **Boring is fine.** If a paragraph reads like documentation instead of marketing, that's the goal.

When you catch yourself writing a sentence that tries to *make the reader feel good about a choice*, delete it and write the one that explains what actually happens.

## Public-facing copy: write to the reader, not about the product

The rules above are about *what to avoid*. The deeper failure mode is *who you are writing to*.

When you write user-facing copy (homepage, install page, marketing sections, README intros, UI strings, error messages, empty states), you are talking to someone who has not built this thing, has not read the design doc, and has not raised any objection. They want to know:

1. What is this, in plain words.
2. What does it do for me.
3. What do I do next.
4. Can I trust it.

That is the entire payload. Everything else is for a different audience.

Watch for these tells that you have drifted into maker-perspective:

- **"No X, no Y"** framing - flags an objection the reader did not raise. Just state what does happen.
- **Long because-clauses** justifying a design choice - belongs in a "why this works this way" expandable, or in a design doc, not in the lead.
- **Comparisons the reader did not ask for** - "Instead of going through npm..." - the reader does not have the npm baggage in their head; do not put it there.
- **Adjectives the reader can verify themselves** - "simple", "clean", "fast". Cut. Let them decide after using it.
- **Three justifications stacked in one sentence** - that energy reads as panic, not confidence. Pick one.

Before writing any user-facing block, name the three things the reader needs to know at this exact point on the page, ranked. Write to those. No fourth thing.

## Pressure-testing public-facing copy with the `copywriter` reviewer

`~/review_room/reviewers/copywriter/` is a persona tuned for this failure mode. When you have edited user-facing copy and are not sure it lands, spawn the copywriter reviewer the same way you would `kent_beck` or `security` (see the Review Room section in `~/.claude/CLAUDE.md`). It reads every sentence as the reader and flags perspective drift, defensive framing, sales energy, and unnatural rhythm.

Use it whenever a change touches the homepage, install copy, README, public docs, or user-visible strings. The cost is one extra reviewer pass; the upside is catching the maker-voice drift before it ships.
