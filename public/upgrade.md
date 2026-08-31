---
title: Upgrade SmallDocs
description: Upgrade the sdoc CLI to the latest version and refresh what your agent knows.
styles:
  font: Inter
  accent: "#4f46e5"
---

# Upgrade SmallDocs

This page is for upgrading an `sdoc` you installed from
[smalldocs.org/install](https://smalldocs.org/install). That installer puts
everything under `~/.sdocs`, so upgrading is a single command and never needs a
password.

If `which sdoc` points somewhere other than `~/.sdocs/bin/sdoc`, you have an older
install (often a global npm one) shadowing it. Use the full
[install-or-upgrade instructions](https://smalldocs.org/blogs/new-home) instead,
which clear the old copy first.

## Let your agent do it

Paste this to your coding agent. It assumes you installed from the link above, so
it upgrades in place and then refreshes what your agent knows about SmallDocs.

```
Upgrade my SmallDocs `sdoc` CLI to the latest version and refresh what you (my
coding agent) know about it. I installed it from smalldocs.org/install, so it
lives under ~/.sdocs. Ask me before any step that changes my filesystem.

1. Check what I have now: run `sdoc --version` and `which sdoc`. Expect
   `which sdoc` to point at `~/.sdocs/bin/sdoc`. If it points anywhere else, stop
   and tell me - I have an older install shadowing it and need the full
   instructions at https://smalldocs.org/blogs/new-home.
2. Upgrade in place. Run: sdoc upgrade
   This re-runs the smalldocs.org installer under the hood and replaces the copy
   in ~/.sdocs with the current version. If `sdoc upgrade` is not found, run the
   installer directly instead: curl -fsSL https://smalldocs.org/install | sh
3. Teach yourself the new features. Run:
   npx skills@latest add https://smalldocs.org/agent-skills/standard --global
   This installs or refreshes the standard SmallDocs skill for supported agents.
   If `npx skills` is unavailable, run `sdoc setup --yes`; that built-in fallback
   installs the standard edition and removes configuration written by older
   SmallDocs releases. Do not hand-write the skill.
4. Verify and report all three: `sdoc --version` prints the new version;
   `which sdoc` points at `~/.sdocs/bin/sdoc`; and
   `~/.agents/skills/smalldocs/SKILL.md` exists (with a `<!-- sdocs-skill: v=N -->`
   line). If you previously had an always-on SmallDocs section in your
   CLAUDE.md / AGENTS.md / GEMINI.md, it has been removed by this step.

If any step fails, stop and tell me what happened before going further.
```

## Or by hand

The simplest upgrade, if you installed from the link:

```
sdoc upgrade
```

That re-runs the installer for you and replaces `~/.sdocs` with the current
version. Two other doors reach the same place: re-run
`curl -fsSL https://smalldocs.org/install | sh`, or accept the daily update prompt
the next time you run `sdoc`.

Then refresh the standard SmallDocs skill for your coding agents:

```
npx skills@latest add https://smalldocs.org/agent-skills/standard --global
```

If `npx skills` is unavailable, use `sdoc setup --yes` as the built-in
standard-edition fallback.

To check it worked:

- `sdoc --version` prints the current version.
- `which sdoc` points at `~/.sdocs/bin/sdoc`.
