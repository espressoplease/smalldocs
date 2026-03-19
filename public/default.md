---
styles:
  fontFamily: Inter
  baseFontSize: 16
  lineHeight: 1.75
  h1: { fontSize: 2.1, fontWeight: 700 }
  h2: { fontSize: 1.55, fontWeight: 600 }
  h3: { fontSize: 1.2, fontWeight: 600 }
  p: { lineHeight: 1.75, marginBottom: 1 }
  light:
    background: "#ffffff"
    color: "#1c1917"
  dark:
    background: "#2c2a26"
    color: "#e7e5e2"
---

# Say hello to SmallDocs: A markdown-first replacement for Word & GDocs

If you're working with agents, a document written in markdown is <ins>officially</ins>* 407 times more useful than a document locked inside a `.docx` or `.gdoc` file format. Because of this, I believe Word and GDocs' days are numbered. (*I am the official.)

But while markdown is great for agents, it's a bit annoying for humans. Quickly and elegantly reading a `.md` file requires you to open your code editor and enter "preview" mode. Sharing a markdown file requires you to actually send the file to someone. They then have to download it and find the least annoying way to read it.

SmallDocs is an [open source](https://github.com/JoshInLisbon/SDocs) attempt at something different. It lets you (or your agent) easily, elegantly and <ins>100% privately</ins> **read**, **share**, **format** and **export** `.md` files.

Reading a `.md` file in SmallDocs feels just like this (you're reading markdown right now). And creating a SmallDoc for a `.md` file (+ automatically opening your browser to read it) is as simple as:

```
# npm i sdocs-dev
sdoc README.md
```

## How SmallDocs work

### URLs

The URL format for SmallDocs is:

```
https://sdocs.dev/#md={compressed & encoded .md}
```

Your entire document (content and styles) lives in the URL hash.

To keep URLs as short as possible, SmallDocs compresses your markdown using [deflate](https://en.wikipedia.org/wiki/Deflate) (a standard compression algorithm built into every browser) and then encodes the result with [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) (a URL-safe variant of base64 that avoids characters like `+`, `/`, and `=` which would otherwise need percent-encoding).

The `mode` parameter controls which view opens. Valid values are `read` (clean reading view, style panel hidden), `style` (style panel visible), and `raw` (raw markdown editor). When sharing a link for someone to read, use `mode=read`:

```
https://sdocs.dev/#md=...&mode=read
```

You can also link directly to a section using the `sec` parameter. Click any heading's link icon to copy its section URL:

```
https://sdocs.dev/#md=...&sec=url-formatting
```

The `sec` value is the heading text slugified (lowercased, spaces become hyphens, special characters stripped). The page will scroll to that section on load.

The `theme` parameter forces a specific theme: `theme=light` or `theme=dark`. This overrides the reader's system preference, which is useful when sharing a link where the document looks best in a particular theme.

### Privacy

Because the SmallDocs url format is:

```
https://sdocs.dev/#md={compressed & encoded .md}
```

Your document never hits the SDocs server. 

This layer of privacy is built into how HTTP works. The hash fragment (everything after the `#` in a URL) is never sent to the server by the browser. It always stays entirely client-side:

> "The fragment is not sent to the server when the URI is requested; it is processed by the client" - [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment)

The [sdocs.dev](https://sdocs.dev) site is purely a rendering space. JavaScript reads `window.location.hash`, decompresses and decodes the content, and renders your `.md` locally. The server is about 60 lines of Node.js that serves static files — no database, no logging, no analytics.

### Formatting

SDocs adds basic styling to markdown files. You write your content in regular markdown and the styles live in a metadata block at the top of the file.

That metadata block is called [YAML front matter](https://jekyllrb.com/docs/front-matter/). It's a convention that started with [Jekyll](https://jekyllrb.com/) (the static site generator) back in 2008 and has since been adopted by [Hugo](https://gohugo.io/), [Gatsby](https://www.gatsbyjs.com/), [Obsidian](https://obsidian.md/), and most of the markdown ecosystem. It looks like a block of key-value pairs between two `---` lines at the top of your file:

```yaml
---
title: My Document
author: Someone
---
```

SDocs uses a `styles:` key with CSS properties written beneath it in YAML:

```yaml
---
styles:
  fontFamily: Lora
  baseFontSize: 17
  h1: { fontSize: 2.3, fontWeight: 700 }
  p: { lineHeight: 1.9, marginBottom: 1.2 }
  ...
---
```

(Click "**Raw**" — top left — to see the front matter for this file. See all available properties [here](https://sdocs.dev) or by running `npm i sdocs-dev; sdoc schema`.)

When a `Styled .md` file is rendered in the SmallDocs interface the specified styles are applied. If a plain `.md` file is rendered the default styles are applied.

#### Light & dark modes

You can nest styles in `light` and `dark` keys: 

```
  light:
    background: "#fffaf5"
    color: "#1a1a2e"
    h1: { color: "#c0392b" }
  dark:
    background: "#1a1520"
    color: "#e7e5e2"
    h1: { color: "#ef6f5e" }
```

These will be used when you view the site in each mode.

Non-color properties (fonts, sizes, spacing) are shared across themes and live at the top level.

All color controls are in the **Colors** section of the style panel. The light/dark toggle at the top of that section lets you customize each theme independently. Colors cascade from general to specific — set `color` once and it flows to headings, paragraphs, and lists unless you override them individually.

### Drag & drop

Drag any `.md` file onto the editor to SmallDoc it instantly.

### Exports

SmallDocs can export your document in four formats:

- **Raw .md** — your markdown content with all front matter stripped. Plain markdown, compatible with anything.
- **PDF** — a styled PDF generated from the rendered view via the browser's print engine.
- **Word (.docx)** — a styled Word document generated from the rendered HTML.
- **Styled .md** — your markdown with the `styles:` front matter block included. This is the format SmallDocs reads back in, so your formatting is preserved.

### Collapsed headers

SmallDocs loads with all headers collapsed. This is done because it makes it easy to get an overview of the whole document.

If you expand a parent, all of its children expand too.

### Copy & paste

Every header has its own copy and paste button. This copies its content and all of its children's content. At the moment this is the fastest way to get SmallDoc content into your agent's context, but we're looking for novel ideas to make this better.

### Works offline

`https://sdocs.dev` uses extensive client side caching. If you've loaded the site once, you can visit it even when you're offline. If something has changed server side, we invalidate the cache and the next time you visit the site you'll get the latest version.

### Auto-save

Because the URL includes your full document and dynamically updates via JavaScript, every change you make is instantly preserved in the URL. This works when you're offline.

## The CLI

### Installation

SmallDocs has a command-line tool that lets you open, share, and style markdown files from the terminal. Install it once:

```
npm i -g sdocs-dev
```

This gives you the `sdoc` command.

### Open a file

```
sdoc README.md
```

Your browser opens with the document styled and readable. That's it — one command to go from `.md` file to formatted document.

### Share a link

```
sdoc share README.md
```

This copies a shareable link to your clipboard.

You can also combine it with options:

```
sdoc share report.md --section "Results" # deep-link to a heading
sdoc share notes.md --write             # link opens in write mode
sdoc share notes.md --dark              # link opens in dark theme
```

### Start a new document

```
sdoc new
```

Opens a blank document in write mode, ready to type a `h1`.

### Style schema

```
sdoc schema
```

Prints every available style property with its type, default value, and description. This is designed to be readable by both humans and LLMs — so your agent can write YAML front matter for you.

### Modes

By default, files open in read mode. You can open in any mode:

```
sdoc README.md              # read mode (default)
sdoc README.md --write      # write mode (contentEditable editor)
sdoc README.md --style      # style mode (styling panel visible)
sdoc README.md --raw        # raw mode (plain markdown source)
```

### Pipe from stdin

Any command that outputs markdown can be piped directly into SmallDocs:

```
cat notes.md | sdoc                     # open in browser
cat notes.md | sdoc share               # pipe to clipboard link
your-agent --output md | sdoc           # pipe agent output to browser
```

### Default styles

If you find a style you like, use the "Save as Default" panel in the Style view to generate a command that saves your preferences to `~/.sdocs/styles.yaml`. The CLI automatically applies these defaults to every file you open — unless the file has its own styles, which always take priority.

```
sdoc defaults               # view your current defaults
sdoc defaults --reset       # remove them
```

### For agents

The CLI is designed to work well in automated workflows. A few patterns:

- **Generate a styled doc**: have your agent write a `.md` file with YAML front matter, then `sdoc share file.md` to copy a shareable link
- **Learn the format**: `sdoc schema` gives your agent everything it needs to know about available style properties
- **Deep-link to context**: `sdoc share file.md --section "Heading"` creates a URL that scrolls straight to the relevant section
- **No auth, no API keys**: everything is client-side — the URL *is* the document

