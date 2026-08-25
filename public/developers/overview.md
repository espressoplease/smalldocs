# Renderer SDK

Render agent-written Markdown as a SmallDocs reading surface inside your application.

> **Status:** Experimental `0.1.2`. No account or key is required. Production pricing and terms are not set.

## The integration contract

Your application supplies two things:

1. An element where the document should appear.
2. The finished Markdown returned by your agent or analysis system.

SmallDocs handles Markdown parsing, sanitisation, feature discovery, rendering, and content-driven browser loading.

~~~mermaid
flowchart LR
  A[Agent analysis] --> B[Finished Markdown]
  B --> C[SmallDocs renderer]
  C --> D[Readable document]
~~~

The host application does not parse code fences or declare document capabilities. A single document can combine ordinary prose, tables, code, diagrams, math, charts, cells, slides, and video.

## Current boundary

The SDK exposes rendering only. Comments, writing tools, export controls, Cloud storage, and the surrounding SmallDocs application are not included.

Image upload, proxying, and hosting are also outside this release. An ordinary HTTPS image reference remains a request to its original host.

## Start integrating

Open **Quickstart** for the smallest working page, then use **Lifecycle** to connect the returned view to your framework or route.
