# Agent integration

Install the renderer integration skill in the application project:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

Then ask the coding agent:

```text
Use the smalldocs-renderer skill to add the report view to this route.
```

## What the skill teaches

The skill contains the exact versioned API, lifecycle, data boundary, supported content model, and verification checklist. It tells the agent not to build a host-side fence parser or declare capabilities before analysis.

The renderer skill is separate from the SmallDocs authoring skill installed by `sdoc setup`. The authoring skill helps an agent create SmallDocs files. The renderer skill helps an agent integrate the read surface into an application.

For an agent that produces documents inside the application, install the SDK authoring skill:

```sh
npx skills add https://smalldocs.org --skill smalldocs-author
```

Then tell the runtime agent to return finished SmallDocs Markdown. The authoring skill routes it to exact references for Markdown, code, math, diagrams, charts, cells, slides, video, and styles. Slide-producing agents are directed to custom shapes when a visual model explains the concept, including for internal presentations.

## Machine-readable documentation

- `/developers/llms.txt` indexes the developer documentation.
- `/developers/llms-full.txt` contains the complete integration and authoring reference.
- `/.well-known/agent-skills/index.json` publishes the installable skill catalog.
- Every human documentation route has a `.md` version.

## Verification expected from an agent

Test ordinary Markdown, multiple rich feature types, unsafe HTML sanitisation, independent instances, update, destroy, and the absence of unrelated rich dependency requests for a plain document.
