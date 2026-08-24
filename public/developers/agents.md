# Create SDoc Markdown with an agent

Give the agent that produces your document the SmallDocs authoring skill:

```sh
npx skills add https://smalldocs.org --skill smalldocs-author
```

Then ask it for finished SmallDocs Markdown:

```text
Use the smalldocs-author skill to produce a SmallDocs report from this analysis.
Return the finished Markdown.
```

Pass that Markdown to `render()`. The agent does not initialise the SDK, announce which features it intends to use, or return a capability envelope.

## What the agent can produce

The skill routes the agent to exact references for ordinary Markdown, code, math, diagrams, charts, computed cells, slides, video, and document styles. One document can mix any of these.

Slide-producing agents are directed to use custom shapes when geometry explains a concept, including in internal presentations.

## Let the agent read the documentation directly

An agent can fetch the documentation without installing a skill:

- `/developers/llms.txt` is the short index.
- `/developers/llms-full.txt` contains the complete authoring reference.
- Every reference in the developer menu has a directly fetchable `.md` URL.
- `/.well-known/agent-skills/index.json` publishes the skill catalog.

Use the short index when the agent can fetch additional pages itself. Use the complete reference when the environment only accepts one documentation URL.

## If a coding agent is integrating the SDK

Install the separate renderer skill in the application project:

```sh
npx skills add https://smalldocs.org --skill smalldocs-renderer
```

The renderer skill teaches the coding agent how to mount, update, destroy, and test the SDK integration. It does not teach the runtime agent how to write the document.
