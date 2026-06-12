---
title: SmallDocs
description: Render, style, and share Markdown from your terminal. New home, new features.
styles:
  font: Inter
  accent: "#4f46e5"
---

# SmallDocs has a new home

SDocs is now **SmallDocs**, and it lives at [smalldocs.org](https://smalldocs.org).

## What doesn't change

### The command

`sdoc` is still the command. The same `sdoc file.md` works, the same share links work, and your existing install will offer to update itself the next time you run it. Documents and links you made on sdocs.dev keep working there.

### How you talk to your agent

The way you talk to your coding agent is the same. You can still say:

> sdoc me this file

> write up the plan and sdoc it to me

> draft the release notes as a smalldoc I can share

You could already say "build me a smalldoc" and have it open in your browser. That has not changed either.

## New since you last looked

### Sheets

We've added sheets - live spreadsheets inside a Markdown file. A `cells` block is a working sheet:

- Formulas compute in your browser as you type - `=B2*C2`, `=SUM(D2:D4)`, plus `AVERAGE`, `MIN`, `MAX`, `IF`.
- Sort any column; select a range for an instant Sum / Avg / Min / Max.
- Format columns as currency, percent, or fixed decimals.
- Edit a scratch copy fullscreen, then download a real Excel file (`.xlsx`) with the formulas still live.

```cells
format: B=$ D=$
Plan,Price,Seats,MRR
Starter,12,40,=B2*C2
Team,40,18,=B3*C3
Business,90,6,=B4*C4
Total,,,=SUM(D2:D4)
```

The `MRR` column is `price × seats` per row, and the last row is `=SUM` of the column above. Change a price or a seat count and watch the total move. To make your own, tell your agent:

> build me a live spreadsheet of last quarter's numbers and sdoc it

> sdoc me a budget spreadsheet with live totals

> turn this CSV into a live spreadsheet and sdoc it

### Slides

Slides too - a deck written in plain text, presented fullscreen, exported to PDF or PowerPoint. Underneath the templates is a coordinate language for shapes:

- Draw from rectangles, circles, and polygons - with opacity, curves, and edge-to-edge anchors - instead of headings and bullets.
- Start from a template (`@extends cover`) or from a raw `grid`, placing each shape by coordinate.
- Present fullscreen and move with the arrow keys, then export the finished deck to PDF or PowerPoint.

~~~slide
@extends cover
#eyebrow: SMALLDOCS
#title: Your Markdown, as a deck
#subtitle: Write slides in plain text. Present them fullscreen. Export to PDF or PowerPoint.
#meta: smalldocs.org
~~~

~~~slide
grid 100 56.25 bg=#0b1020
p 0,0 34,0 14,56.25 0,56.25 fill=#4f46e5
c 80 15 15 fill=#f43f5e opacity=0.6
c 90 31 10 fill=#facc15 opacity=0.55
p 60,36 99,32 95,56.25 56,56.25 fill=#22d3ee opacity=0.8
r 8 7 80 4 text=caption color=#a5b4fc align=left | SMALLDOCS · SLIDES
r 8 15 70 26 size=fit maxfont=150 color=#ffffff align=left valign=center | Shapes, not bullets.
r 8 43 44 7 text=body color=#cbd5e1 align=left | Every circle and polygon here is one line of Markdown. No SVG, no drag-and-drop.
r 70 45 24 7 fill=#facc15 color=#0b1020 radius=1 align=center valign=center | **sdoc present**
~~~

To make your own, tell your agent:

> make me a slide deck about the launch and sdoc it

> build me a smalldoc slide deck from this proposal

> sdoc me a slide deck from these notes

### Live editing with `sdoc bridge`

`sdoc file.md` opens your file as a read-only render, same as always: the document travels in the URL, nothing runs in the background, and it works in every browser.

When you want the open page and the file on disk tied together, start a bridge:

```
sdoc bridge file.md
```

- Edit in the browser and it saves straight back to the file on disk.
- Change the file in your editor and the open page updates to match.
- Leave comments right on the document; they're written into the file, so they're still there the next time you open it.

The first time the page connects, the browser asks permission to reach a local process (Chrome calls this "Apps on device"). Bridge works in Chrome and Firefox; Safari blocks the connection, so the page stays a read-only render there. To send someone a read-only link instead, use `sdoc share file.md`.

## Install or upgrade

One command installs `sdoc`, or upgrades an existing install in place:

```
curl -fsSL https://smalldocs.org/install | sh
```

It installs into a folder you own (`~/.sdocs`), so it never asks for a password and never touches a system directory.

Already installed? Three doors lead to the same upgrade: re-run the command above, run `sdoc upgrade`, or accept the daily update prompt when it appears. Each fetches and installs the current version in place.

You need Node and either curl or wget present first. Everything else the installer sets up for you.

### Let your agent do it

Paste this to your coding agent. It installs or upgrades, clears any older copy that is shadowing the new one, and refreshes what your agent knows about SmallDocs - so it picks up sheets, slides, and bridge:

```
Install or upgrade my SmallDocs `sdoc` CLI to the latest version, and make sure you (my coding agent) know about its newest features. Ask me before any step that changes my filesystem.

1. Check what I have now: run `which sdoc` and `sdoc --version`.
2. Install or upgrade. Run: curl -fsSL https://smalldocs.org/install | sh
   This installs everything under `~/.sdocs/` (no root needed) and links the `sdoc` command into `~/.sdocs/bin`. Re-running it upgrades in place.
3. Clear out any old copy that shadows it. Run `which sdoc` again. If it points anywhere other than `~/.sdocs/bin/sdoc` (for example a global npm path), an older install is ahead of the new one on my PATH - run `npm uninstall -g sdocs-dev` to remove it. If that fails with a permission error, the old copy is in a root-owned folder: stop and tell me, don't sudo without asking.
4. Make sure `~/.sdocs/bin` is on my PATH. If `which sdoc` still does not resolve, add `export PATH="$HOME/.sdocs/bin:$PATH"` to my shell's startup file (`~/.zshrc` for zsh, `~/.bashrc` for bash, `~/.config/fish/config.fish` for fish) and tell me to open a new terminal.
5. Teach yourself the new features. Run: sdoc setup --yes
   This refreshes the short SmallDocs section in my global agent config (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, or the opencode equivalent) so you know about the latest blocks, including sheets (`cells`), slides, and `sdoc bridge`. It is the canonical writer - do not hand-write that section yourself.
6. Verify and report all three: `sdoc --version` prints the current version; `which sdoc` points at `~/.sdocs/bin/sdoc`; and my global agent config contains a line beginning with `<!-- sdocs-agent-block:start`.

If any step fails, stop and tell me what happened before going further.
```

### Or by hand

Most install trouble comes from an older setup that put `sdoc` in a system-owned folder, which then refuses to update without a password. The installer above avoids that folder entirely. If you would rather not hand it to an agent:

1. **Remove any old global copy.** If you installed through npm before, run `npm uninstall -g sdocs-dev`. A permission error means the old copy is in a root-owned folder; the next step lays down a clean copy on a path you own regardless, so you can move on.
2. **Run the installer.** `curl -fsSL https://smalldocs.org/install | sh`. It unpacks the CLI into `~/.sdocs/cli` and links the `sdoc` command into `~/.sdocs/bin`.
3. **Pick up the new PATH.** Restart your terminal, or run `export PATH="$HOME/.sdocs/bin:$PATH"` to use it in the current session.
4. **Check it.** `sdoc --version` should print the current version, and `which sdoc` should point at `~/.sdocs/bin/sdoc`.

If `sdoc` still is not found after a terminal restart, your shell startup file may not be the one the installer wrote to. Add `export PATH="$HOME/.sdocs/bin:$PATH"` to the file your shell reads on startup.
