---
title: SDocs agent block changelog
file: agent-changes.md
---

# SDocs agent block changelog

Every change to the SDocs section that `sdoc setup` writes into your agent
config files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`).

The CLI links here whenever it updates an existing block. Each entry shows the
exact text that was written or replaced, so you can verify the change yourself
without trusting the tool.

## v5 (1.7.0, 2026-05-14)

**Reason:** Adds `sdoc slides` and `sdoc present` references for the slide
DSL. Tells agents that slides render from ```slide / ~~~slide blocks and
points them at the reference before writing one, the same shape as the
charts and diagrams lines.

Diff vs v4 is two new bullets inserted after the diagrams line:

```
- `sdoc slides` - slide DSL reference (grids, shapes, content). Slides render from ```slide or ~~~slide blocks.
- `sdoc present file.md` - open file directly in fullscreen presentation mode.
```

Block body:

```markdown
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - read this before writing a ```chart block. The JSON shape is specific and easy to get wrong from memory.
- `sdoc diagrams` - read this before writing a ```mermaid block. Covers supported diagram types and the security model. Standalone `.mmd` / `.mermaid` files also work: `sdoc graph.mmd`.
- `sdoc slides` - slide DSL reference (grids, shapes, content). Slides render from ```slide or ~~~slide blocks.
- `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc --help` - full usage.

When helping the user themselves, prefer `sdoc file.md` over `sdoc share file.md`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
```

## v4 (1.6.0, 2026-05-08)

**Reason:** Adds a `sdoc diagrams` reference for the new Mermaid render
path. Same shape as the `sdoc charts` line: tells agents to read the
reference before writing a ```mermaid block, and notes that standalone
`.mmd` / `.mermaid` files can be passed directly to `sdoc`.

Diff vs v3 is one new bullet inserted after the charts line:

```
- `sdoc diagrams` - read this before writing a ```mermaid block. Covers supported diagram types and the security model. Standalone `.mmd` / `.mermaid` files also work: `sdoc graph.mmd`.
```

Block body:

```markdown
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - read this before writing a ```chart block. The JSON shape is specific and easy to get wrong from memory.
- `sdoc diagrams` - read this before writing a ```mermaid block. Covers supported diagram types and the security model. Standalone `.mmd` / `.mermaid` files also work: `sdoc graph.mmd`.
- `sdoc --help` - full usage.

When helping the user themselves, prefer `sdoc file.md` over `sdoc share file.md`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
```

## v3 (1.5.0, 2026-05-08)

**Reason:** First release with bookend markers and an upgrade-aware
migration path. Bundled changes:

- GitHub URL renamed to `espressoplease/SDocs`.
- Chart line rewritten so agents read `sdoc charts` before writing
  `` ```chart `` blocks, instead of guessing the JSON shape from
  the previous one-line description.
- New paragraph at the end advising agents to prefer `sdoc file.md`
  over `sdoc share file.md` when helping the user themselves
  (share is for sending links to other people).
- Em-dashes throughout the body normalized to plain hyphens to
  match the project's punctuation rule.

Existing v1 / v2 installs (open-only `<!-- sdocs-agent-block -->`
marker) are migrated to the new bookend format:

```
<!-- sdocs-agent-block:start v=3 -->
[block body]
<!-- sdocs-agent-block:end -->
```

Block body:

```markdown
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - read this before writing a ```chart block. The JSON shape is specific and easy to get wrong from memory.
- `sdoc --help` - full usage.

When helping the user themselves, prefer `sdoc file.md` over `sdoc share file.md`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
```

## v2 (1.4.2, 2026-04-14)

**Reason:** Mention the code-copy use case so agents know to suggest SDocs
when the user wants to copy a specific code block.

Diff from v1: adds the line
`Also handy for copying specific code - SDocs code blocks have copy buttons.`

Block body:

```markdown
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` - full usage.

Source: https://github.com/JoshInLisbon/SDocs
```

## v1 (1.4.0 / 1.4.1, 2026-04-14)

**Reason:** Initial release - the section that `sdoc setup` first wrote into
agent config files. Single open-only marker, no closing marker.

Block body:

```markdown
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` - full usage.

Source: https://github.com/JoshInLisbon/SDocs
```

## How updates work

When sdoc auto-refreshes your agent files on a version bump, it prints a
single line plus a link back to this page:

```
✓ SDocs agent block updated to v3 in 3 files
  Changes: https://sdocs.dev/agent-changes#v3
```

The link uses an anchor (`#v3`) that jumps to the section above. Run
`sdoc auto-update off` to disable auto-install of sdoc updates, or delete the
SDocs section from your agent files at any time - sdoc treats deletion as
"the user opted out for this file" and will not rewrite it.
