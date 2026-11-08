# Mermaid diagrams

Use a `mermaid` fence when structure, sequence, state, or relationships are easier to understand visually than as prose.

````md
```mermaid
flowchart LR
  A[Agent analysis] --> B[Markdown]
  B --> C[SmallDocs renderer]
  C --> D[Readable document]
```
````

Common diagram declarations include:

- `flowchart` or `graph` for processes and component relationships
- `sequenceDiagram` for interactions over time
- `classDiagram` for type relationships
- `stateDiagram-v2` for state transitions
- `erDiagram` for data relationships
- `gantt` and `timeline` for schedules
- `pie` for a small proportional breakdown
- `journey`, `gitGraph`, `mindmap`, and `sankey-beta` for their corresponding models

## Sequence example

````md
```mermaid
sequenceDiagram
  participant H as Human
  participant G as Agent
  participant S as SmallDocs
  H->>G: Request a document
  G->>S: Save tagged Markdown
  S-->>G: Saved document link
  G-->>H: Open the document
```
````

Do not add Mermaid `init` directives. SmallDocs controls Mermaid configuration and removes document-level initialisation directives. Keep each diagram under 64 KB and a document under 50 Mermaid blocks.

Prefer a small number of labelled nodes and explicit edges. Split a dense diagram into several diagrams when labels or crossings make it difficult to read.
