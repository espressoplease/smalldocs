# Request path

The same diagram must render and behave identically in the SmallDocs reader and an SDK customer page.

~~~mermaid
flowchart LR
  subgraph Client[Customer application]
    A[Analysis agent] -->|Finished Markdown| B[SmallDocs SDK]
  end
  B --> C[Readable result]
~~~
