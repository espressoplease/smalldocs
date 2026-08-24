# Loading and caching

Applications can import the SDK on every route that renders a document. Normal browser caching prevents the versioned module from being downloaded on every page.

## Versioned module

`https://smalldocs.org/sdk/0.1.0/smalldocs.js` is served with an immutable one-year browser cache policy. A new contract uses a new versioned URL.

## Reader shell

Each document view creates a renderer frame. The frame loads the SmallDocs read shell, while its static assets use normal HTTP caching across routes and later visits.

## Rich dependencies

The reader discovers features from the Markdown. Rich browser dependencies are requested when corresponding content is present, not because the agent declared them before inference.

A plain Markdown document should not request unrelated chart, diagram, spreadsheet, or slide dependencies.

## Readiness

`render()` and `update()` resolve after the document is mounted. Rich processors that load external browser dependencies can finish and resize afterward.
