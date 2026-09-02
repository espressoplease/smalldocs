# Teach your agent to write SmallDocs

This guide is for the agent that produces documents. The separate [renderer guide](/developers) is for the coding agent that embeds those documents in your application.

Give your analysis agent the SmallDocs authoring skill so it can express a result as a readable document, diagram, chart, computed sheet, or presentation.

Install the authoring skill in the environment where the document-producing agent works:

```sh
npx skills add https://smalldocs.org --skill smalldocs-author
```

Then include this instruction in the task prompt:

```text
Use the smalldocs-author skill to produce a finished SmallDocs report from this analysis.
Choose the clearest mix of prose, diagrams, charts, computed cells, or slides for the result.
Use runnable HTML only when interaction expresses something that those static forms cannot express as clearly.
Return the finished Markdown.
```

Have the agent return Markdown. Your application passes that Markdown to the renderer.

## Set up the two parts

### 1. Configure the analysis task

Tell the agent what to investigate, which sources or data it can use, who will read the result, and what decision the document should support. This is your application-specific instruction.

For example:

```text
Analyse weekly customer feedback for the product team.
Identify repeated problems, quantify the strongest patterns, and recommend the next three actions.
Write for a product manager who needs to decide what enters the next sprint.
```

### 2. Teach the agent the output format

Install `smalldocs-author` and add the SmallDocs instruction shown above. The skill routes the agent to exact references for ordinary Markdown, code, math, diagrams, charts, computed cells, slides, runnable HTML, video, and document styles.

One result can mix any of these formats. Use slides when the requested output is a presentation; the slide reference includes custom shapes for explaining concepts visually. Use runnable HTML when the reader needs to manipulate, simulate, rotate, zoom, or explore linked states to understand the result. A three-input financial model may warrant an interactive surface; a fixed comparison normally belongs in a chart or computed cells.

[Read the runnable HTML explainer](/runnable-html) to see when it fits and try a live financial model.

### 3. Render the returned Markdown

[Read the renderer guide](/developers) for the install command and coding-agent prompt, or [open the working SDK example](/developers/example).

## Agent documentation endpoints

An agent can fetch the documentation directly when skill installation is not available:

- `https://smalldocs.org/developers/llms.txt` is a short index with links to the other references.
- `https://smalldocs.org/developers/llms-full.txt` contains the complete authoring reference in one response.
- `https://smalldocs.org/.well-known/agent-skills/index.json` lists the installable skills and their files.
- Each item under Authoring reference in the developer menu has a directly fetchable `.md` URL.

Use the short index when the agent can follow links. Use the complete reference when its environment accepts only one documentation URL.
