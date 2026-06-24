---
title: SmallDocs agent block changelog
file: agent-changes.md
---

# SmallDocs agent block changelog

Every change to the SmallDocs section that `sdoc setup` writes into your agent
config files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`).

The CLI links here whenever it updates an existing block. Each entry shows the
exact text that was written or replaced, so you can verify the change yourself
without trusting the tool.

## v12 (1.14.0, 2026-06-25)

**Reason:** Adds `sdoc code`: opening a source file (`sdoc app.rb`) or a
```lang fenced block as a syntax-highlighted listing - a light code viewer for
reading code with the user away from the IDE, with source comments given a
prominent lane. The fullscreen view folds by method / class and has a comment
mode for the user to annotate a line or method, kept in the browser rather than
the file. Agent annotations (`sdoc app.py 22:"..."`) pin markdown callouts to
lines so an agent can walk the user through code without editing it. One bullet
added after the `sdoc cells` line; the rest of the block is unchanged from v11.

The block body:

```markdown
## SmallDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

When the user says "sdoc it", "sdoc me the plan", or asks for a smalldoc, they mean this: write (or locate) the `.md` file and open it with `sdoc`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SmallDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - the default way to open a file, for comfortable reading or quick sharing.
- `sdoc bridge file.md` - open a live editing session while you iterate on a file with the user: edits in the browser autosave to the file on disk, and your edits to the file push to the open page. It parks the terminal until the tab closes, so run it in the background when you want to keep working. The first time the page connects, the browser asks to reach a local process (Chrome calls this "Apps on device" / Local Network Access) - the user has to accept, or the page stays read-only. Reach for this when you and the user are working a file back and forth, not for a one-off open.
- `sdoc library` - opens a library view in the browser. SmallDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SmallDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc cells` - rendering spreadsheets (```cells blocks): CSV rows where plain values and =formulas (SUM, AVERAGE, IF, ROUND...) sit in the same grid and compute live. The reader can sort, select ranges for quick stats, edit a scratch copy fullscreen, and download the sheet as Excel (.xlsx) with the formulas still working. Name a block (```cells Expenses) to build a workbook of several tabs whose formulas reference each other across sheets (`=Expenses!B4`); run `sdoc cells verify file.md` to compute the whole workbook headlessly and read the values back. Reach for this when handing the user numbers they will want to check or play with - totals, budgets, projections. `sdoc report.csv` opens a CSV file directly as a sheet.
- `sdoc code` - opening a source file or a fenced code block as a syntax-highlighted listing: a light code viewer for reading code with the user away from the IDE. `sdoc app.rb` (or `.js`, `.py`, `.go`, `.rs`, `.ts`...) opens a file as a highlighted listing; a ```lang fenced block is highlighted inline. Comments in the source get a prominent lane so the code reads clearly top to bottom. The fullscreen view adds a line-number gutter and language-aware folding (collapse a whole method or class); a comment mode lets the user annotate a line or method with review notes, kept in the browser rather than the file. You can also pin your own explanations to lines as you open a file - `sdoc app.py 22:"this method has the bug" 25-28:"wrong comparison here"` - and they render as markdown callouts below those lines, a way to walk the user through code without editing the source. The file rides in the URL like any document; nothing is uploaded. Reach for it when reading or reviewing code with the user, not for prose.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). The default styles are already comfortable to read; reach for this only when they aren't enough - client-facing polish or a bit of fun.
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v11 (1.13.1, unreleased)

**Reason:** Notes that cells blocks can be multi-tab. Naming a block
(```cells Expenses) builds a workbook of several sheets whose formulas
reference each other across tabs (`=Expenses!B4`), and `sdoc cells verify
file.md` computes the whole workbook headlessly so the agent can read the
computed values back to check its own work. One bullet changed (the `sdoc
cells` line); the rest of the block is unchanged from v10.

The block body:

```markdown
## SmallDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

When the user says "sdoc it", "sdoc me the plan", or asks for a smalldoc, they mean this: write (or locate) the `.md` file and open it with `sdoc`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SmallDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - the default way to open a file, for comfortable reading or quick sharing.
- `sdoc bridge file.md` - open a live editing session while you iterate on a file with the user: edits in the browser autosave to the file on disk, and your edits to the file push to the open page. It parks the terminal until the tab closes, so run it in the background when you want to keep working. The first time the page connects, the browser asks to reach a local process (Chrome calls this "Apps on device" / Local Network Access) - the user has to accept, or the page stays read-only. Reach for this when you and the user are working a file back and forth, not for a one-off open.
- `sdoc library` - opens a library view in the browser. SmallDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SmallDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc cells` - rendering spreadsheets (```cells blocks): CSV rows where plain values and =formulas (SUM, AVERAGE, IF, ROUND...) sit in the same grid and compute live. The reader can sort, select ranges for quick stats, edit a scratch copy fullscreen, and download the sheet as Excel (.xlsx) with the formulas still working. Name a block (```cells Expenses) to build a workbook of several tabs whose formulas reference each other across sheets (`=Expenses!B4`); run `sdoc cells verify file.md` to compute the whole workbook headlessly and read the values back. Reach for this when handing the user numbers they will want to check or play with - totals, budgets, projections. `sdoc report.csv` opens a CSV file directly as a sheet.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). The default styles are already comfortable to read; reach for this only when they aren't enough - client-facing polish or a bit of fun.
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v10 (1.12.0, unreleased)

**Reason:** Documents `sdoc bridge file.md`, the live editing session for
iterating on a file with the user: edits in the browser autosave to the file
on disk and edits to the file push to the open page. It parks the terminal,
so the bullet tells agents to run it in the background, and the first
connection makes the browser ask for local-process / "Apps on device"
permission the user has to accept. The plain `sdoc file.md` bullet is
reframed as the default way to open a file for comfortable reading or quick
sharing. Two bullets changed in the Basic usage list. The block heading is
renamed from SDocs to SmallDocs, the project's new name and home, and a new
intro line spells out that "sdoc it" / "sdoc me the plan" / "make me a
smalldoc" all mean: write the `.md` and open it with `sdoc`. The rest of
the block is unchanged from v9.

The block body:

```markdown
## SmallDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

When the user says "sdoc it", "sdoc me the plan", or asks for a smalldoc, they mean this: write (or locate) the `.md` file and open it with `sdoc`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SmallDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - the default way to open a file, for comfortable reading or quick sharing.
- `sdoc bridge file.md` - open a live editing session while you iterate on a file with the user: edits in the browser autosave to the file on disk, and your edits to the file push to the open page. It parks the terminal until the tab closes, so run it in the background when you want to keep working. The first time the page connects, the browser asks to reach a local process (Chrome calls this "Apps on device" / Local Network Access) - the user has to accept, or the page stays read-only. Reach for this when you and the user are working a file back and forth, not for a one-off open.
- `sdoc library` - opens a library view in the browser. SmallDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SmallDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc cells` - rendering spreadsheets (```cells blocks): CSV rows where plain values and =formulas (SUM, AVERAGE, IF, ROUND...) sit in the same grid and compute live. The reader can sort, select ranges for quick stats, edit a scratch copy fullscreen, and download the sheet as Excel (.xlsx) with the formulas still working. Reach for this when handing the user numbers they will want to check or play with - totals, budgets, projections. `sdoc report.csv` opens a CSV file directly as a sheet.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). The default styles are already comfortable to read; reach for this only when they aren't enough - client-facing polish or a bit of fun.
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v9 (1.12.0, unreleased)

**Reason:** Adds the `sdoc cells` bullet. Sheets (```cells blocks) are new
in this release: CSV rows where plain values and =formulas mix and compute
live, sortable and editable in the browser, downloadable as Excel (.xlsx)
with the formulas still working. Without this bullet, agents have no way to
discover that the block type exists. One bullet added between slides and
schema. The `sdoc schema` bullet was also tightened: styling is framed as a
step for when the comfortable default styles aren't enough, not a default
move. The rest of the block is unchanged from v8.

The block body:

```markdown
## SDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - open a file for easy reading/sharing in the browser
- `sdoc library` - opens a library view in the browser. SDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc cells` - rendering spreadsheets (```cells blocks): CSV rows where plain values and =formulas (SUM, AVERAGE, IF, ROUND...) sit in the same grid and compute live. The reader can sort, select ranges for quick stats, edit a scratch copy fullscreen, and download the sheet as Excel (.xlsx) with the formulas still working. Reach for this when handing the user numbers they will want to check or play with - totals, budgets, projections. `sdoc report.csv` opens a CSV file directly as a sheet.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). The default styles are already comfortable to read; reach for this only when they aren't enough - client-facing polish or a bit of fun.
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v8 (1.11.0, 2026-05-27)

**Reason:** The Mermaid diagrams line now names system / architectural
diagrams (sequence, flow, component layout) as the primary fit, so
agents reach for a diagram when explaining the shape of something
rather than writing three paragraphs of prose. One-line addition to
the existing diagrams bullet; rest of the block is unchanged from v7.

The block body:

```markdown
## SDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - open a file for easy reading/sharing in the browser
- `sdoc library` - opens a library view in the browser. SDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). Good for client-facing communication (or a bit of fun).
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v7 (1.10.0, 2026-05-26)

**Reason:** Block restructured around when to reach for SDocs vs when to
skip it. Adds an explicit "skip it for quick Q&A" line so agents stop
reflexively reaching for the tool on questions that fit in a chat
reply. Groups all rendering features (charts, diagrams, slides, forms)
under one frame with the matching fenced-block info-strings named
inline (```chart, ```mermaid, ```slide, ```form). Tells the agent it
can't actually deliver a `sdoc share` link — the user has to paste it
themselves. Notes that the library indexes by tag / dir / date (not
content — fall back to grep) so agents don't expect a full-text
search. Iterated through 36 sub-agent simulations across
Opus / Sonnet / Haiku before shipping.

The block body:

```markdown
## SDocs

The `sdoc` CLI (`sdoc path/to/file.md`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs `sdoc share`.

Use it (or offer it) when the user wants to read, share, or export a `.md` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic `sdoc` usage

- `sdoc file.md` - open a file for easy reading/sharing in the browser
- `sdoc library` - opens a library view in the browser. SDocs automatically indexes every `.md` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to `grep` for that). Opt out per-directory with `.sdocsignore` or per-file with `sdocs-library: false` in front matter. (`sdoc library --help` for the full reference.)
- `sdoc file.md +tag1 +tag2` - open the file and inject tags into its YAML front matter which persist. The `+` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- `sdoc library ls --tags` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- `sdoc share file.md` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- `sdoc --help` - full reference.

### SmallDocs expands what you can create with Markdown

SDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the `.md` file first, then `sdoc path/to/file.md`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- `sdoc charts` - rendering inline charts (```chart blocks)
- `sdoc diagrams` - rendering inline Mermaid diagrams (```mermaid blocks; has full-screen mode for zoom)
- `sdoc slides` - inline slide decks (```slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as `.pdf` or `.pptx`. `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc schema` - styling Markdown (fonts, colors, spacing). Good for client-facing communication (or a bit of fun).
- `sdoc feedback` - rendering interactive elements (```form blocks) to receive structured input from the user. Run `sdoc feedback file.md` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
```

## v6 (1.9.0, 2026-05-26)

**Reason:** The personal markdown library lands. Every `sdoc <file>` records
the file in a local on-machine index (`~/.sdocs/library-index.json`)
searchable at sdocs.dev/library. Agents get two new bullets:
`sdoc library ls --tags` (so an agent can see a project's existing tag
vocabulary before tagging a new file, and stay consistent), and the
`+tag` CLI flag (`sdoc plan.md +planning +q2` injects tags into the
file at open time). One more bullet points at `sdoc library --help`
for the full reference (rescue copies for `/tmp` files, macOS
autostart, `.sdocsignore`, the `sdocs-library: false` per-file
opt-out, the loopback agent's security gates).

Diff vs v5 is three new bullets inserted after the slides line:

```
- `sdoc library ls --tags` - print the tag bag (tag - count) for the user's project. Run this BEFORE you tag a new file in the project, so you reuse the vocabulary that's already in use instead of inventing parallel tags. Scope walks up to the nearest `.git` from cwd.
- `sdoc file.md +tag1 +tag2` - tag a file at open time. The `+` prefix is shell-safe; tags are injected into the file's YAML front matter and become first-class search terms in the library at sdocs.dev/library.
- `sdoc library --help` - full library reference (commands, tagging, rescue copies for files in /tmp, macOS autostart, `.sdocsignore`, per-file `sdocs-library: false` opt-out, security gates). Read this if the user asks how the library works or you need to do anything beyond `ls` and tagging.
```

Block body:

````markdown
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
- `sdoc feedback` - read this before writing a ```form block. You can ask the user something structured (radio / checkbox / select / text / textarea / number / date), run `sdoc feedback file.md`, and a single JSON line lands on stdout when they click a submit button. Defaults to one-button single-shot mode; `--keep-open` for multi-click sessions.
- `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc slides` - slide DSL reference (grids, shapes, content). Slides render from ```slide or ~~~slide blocks.
- `sdoc library ls --tags` - print the tag bag (tag - count) for the user's project. Run this BEFORE you tag a new file in the project, so you reuse the vocabulary that's already in use instead of inventing parallel tags. Scope walks up to the nearest `.git` from cwd.
- `sdoc file.md +tag1 +tag2` - tag a file at open time. The `+` prefix is shell-safe; tags are injected into the file's YAML front matter and become first-class search terms in the library at sdocs.dev/library.
- `sdoc library --help` - full library reference (commands, tagging, rescue copies for files in /tmp, macOS autostart, `.sdocsignore`, per-file `sdocs-library: false` opt-out, security gates). Read this if the user asks how the library works or you need to do anything beyond `ls` and tagging.
- `sdoc --help` - full usage.

When helping the user themselves, prefer `sdoc file.md` over `sdoc share file.md`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
````

## v5 (1.7.0, 2026-05-24)

**Reason:** Two features land together. `sdoc feedback` lets agents write a
fenced ```form block into a markdown file and ask the user something
structured (radio / checkbox / select / text / textarea / number / date);
each click writes the user's answers back into the same file and prints
one JSON line on the CLI's stdout. `sdoc slides` and `sdoc present` add
the slide DSL: ```slide / ~~~slide blocks render as in-document
thumbnails, and `sdoc present file.md` opens straight into fullscreen.
Three new bullets, all the same "read this before writing the fenced
block" shape as charts and diagrams.

Diff vs v4 is three new bullets inserted after the diagrams line
(alphabetical: feedback, present, slides):

```
- `sdoc feedback` - read this before writing a ```form block. You can ask the user something structured (radio / checkbox / select / text / textarea / number / date), run `sdoc feedback file.md`, and a single JSON line lands on stdout when they click a submit button. Defaults to one-button single-shot mode; `--keep-open` for multi-click sessions.
- `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc slides` - slide DSL reference (grids, shapes, content). Slides render from ```slide or ~~~slide blocks.
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
- `sdoc feedback` - read this before writing a ```form block. You can ask the user something structured (radio / checkbox / select / text / textarea / number / date), run `sdoc feedback file.md`, and a single JSON line lands on stdout when they click a submit button. Defaults to one-button single-shot mode; `--keep-open` for multi-click sessions.
- `sdoc present file.md` - open file directly in fullscreen presentation mode.
- `sdoc slides` - slide DSL reference (grids, shapes, content). Slides render from ```slide or ~~~slide blocks.
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
