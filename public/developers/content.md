# Document content

The SDK accepts one Markdown string. There is no capability envelope and no setup phase before inference.

## Ordinary Markdown

Headings, navigation, paragraphs, lists, quotes, links, tables, and code blocks render directly. Document HTML is sanitised before display.

## Rich content

SmallDocs discovers rich content from the document itself:

| Content | Markdown form |
| --- | --- |
| Diagrams | `mermaid` fence |
| Charts | `chart` fence |
| Computed sheets | `cells` fence |
| Slides | `slide` fence |
| Math | Display math delimiters |
| Video | Supported video fence |

The host application does not need a block parser. Feature discovery and dependency loading happen inside the renderer.

Read the [Markdown authoring reference](/developers/authoring/markdown.md) or choose a rich feature from the Authoring section. These references are also packaged in the `smalldocs-author` skill for document-producing agents.

## Mixed documents

Rich features are not separate SDK modes. One result can contain any supported combination.

~~~cells
Item,Quantity,Unit cost,Total
Research,12,8,=B2*C2
Review,4,15,=B3*C3
Total,,,=SUM(D2:D3)
~~~

## Unknown content

An unknown fence remains readable as source. A rich feature that cannot finish should leave visible source or a bounded error rather than removing the agent's result.
