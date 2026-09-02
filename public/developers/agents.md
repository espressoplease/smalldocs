# Have your agent produce SmallDocs documents

Install the SmallDocs authoring skill in the environment where an agent writes reports. The skill teaches that agent when and how to use prose, diagrams, charts, computed sheets, slides, math, code, video, walkthroughs, and runnable HTML in one Markdown document.

The observable result is one finished Markdown string. Your application passes that string unchanged to the SmallDocs renderer and the user receives the corresponding reading surface.

This is separate from the [renderer skill](/developers), which teaches a coding agent to integrate SmallDocs into an application.

## Give this to your document-producing agent

Install the authoring instructions:

```sh
npx skills add https://smalldocs.org --skill smalldocs-author
```

Then add this to the task prompt:

```text
Use the smalldocs-author skill to produce a finished SmallDocs report from this work.

Write for the stated reader and decision. Choose the clearest mix of prose, diagrams, charts, computed cells, slides, code, or other documented SmallDocs features. Use runnable HTML only when manipulating, simulating, rotating, zooming, or exploring linked states makes the result meaningfully easier to understand.

Return one complete Markdown document. Check every rich block against the installed skill and verify the finished document when the available SmallDocs tools support it.
```

The command installs instructions for the agent. It does not add the browser renderer to your application.

## Tell the agent what the report is for

The authoring skill defines the output format. Your task still needs to define:

1. What the agent should investigate or produce.
2. Which data, files, or sources it may use.
3. Who will read the document.
4. Which decision or action the document should support.

For example:

```text
Analyse weekly customer feedback for the product team.
Use the attached support export and interview notes.
Identify repeated problems, quantify the strongest patterns, and recommend the next three actions.
Write for a product manager deciding what enters the next sprint.

Use the smalldocs-author skill and return one finished SmallDocs Markdown document.
```

## What to expect

The agent should return readable Markdown rather than an SDK configuration or HTML wrapper. One document can mix any supported forms. The skill should select a rich form only when it carries the information more clearly than ordinary prose or a table.

- Relationships and sequences normally fit a Mermaid diagram.
- Quantitative patterns normally fit a chart.
- Values people should inspect, calculate, sort, or download normally fit computed cells.
- A requested presentation uses slides.
- Interaction belongs in runnable HTML when the interaction itself helps explain the result.
- Ordered source explanations can use a document walkthrough.

[Try three runnable HTML examples](/runnable-html) to see spatial, time-based, and dependency interactions.

## Render the returned Markdown

Pass the finished Markdown unchanged to `render()`:

```js
const markdown = await runAnalysisTask();
await render('#report', markdown);
```

[Use the renderer integration guide](/developers) to connect this result to the application, or [open the working SDK example](/developers/example).

## Documentation endpoints for agents

- `https://smalldocs.org/developers/llms.txt` is a short index whose links the agent can follow.
- `https://smalldocs.org/developers/llms-full.txt` contains the complete reference in one response.
- `https://smalldocs.org/.well-known/agent-skills/index.json` lists the installable skills and their files.
- Every page under Authoring reference has a directly fetchable `.md` URL.

Use the short index when the agent can follow links. Use the complete reference when its environment accepts only one documentation URL.
