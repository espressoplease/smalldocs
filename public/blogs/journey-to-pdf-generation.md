---
file: journey-to-pdf-generation.md
title: The surprisingly complex journey to client-side accurate & text-selectable PDF generation
---

# The surprisingly complex journey to text-selectable client-side generated PDFs

![A SmallDocs PDF open in a viewer with body text highlighted, showing the text is selectable.](/public/images/example_sdoc_pdf.png)

If you're like me, you probably have never thought twice about PDFs. They are so prevalent that you'd think including the ability to generate them in your application would be trivial: include some widely used module and "Bob's your uncle" (as we say in the UK when something happens easily... Bob must have gotten around).

But it turns out Bob is ***not*** my uncle. That's because none of the off the shelf options to generate a PDF from a webpage were satisfactory for what SmallDocs needs.

SmallDocs is a privacy-first, productivity-first, cli-first, browser-based Markdown reader for you and your terminal based agent (`​npm i -g sdocs-dev; sdoc file.md`  renders your Markdown file in the browser [without the content ever touching our server](https://sdocs.dev/#sec=privacy). Read more more about the what and why of SmallDocs [here](https://sdocs.dev/).) Because of our focus on privacy and productivity SmallDocs PDFs needed to meet the following requirements:

1. **They must be generated client-side** (Markdown files contain highly sensitive information - new features, live bugs, architectural overviews, etc. - that's why SmallDocs' servers don't want to know anything about the content of your files.)
2. **They must be easy to download** (No one wants to fiddle with entering "print" mode, then selecting "Save as PDF". Whilst this is only annoying on desktop it is basically impossible to do without getting lost on mobile [iOS]. Only the standard download experience will do.)
3. **They must have selectable + copyable text** (everyone hates PDFs where you can't reliably select and copy text!)
4. **They must look like the rendered content** (SmallDocs [pushes](https://sdocs.dev/s/Ad-36Hhe#k=d2BvcOdAo30t4q1dFu1mVDULINFofysuIBKEFleVn6k) [the](https://sdocs.dev/s/E671sjsc#k=c8zwSWkS7tD0rQlO5Qxh_776OI3Fxrvlv3Qk3ZUe1h8) [boundaries](https://sdocs.dev/s/tNmHQ9u-#k=v584g-4a1AwkVjG8ppzDRtMDJpRz7JIgM9kdCMNDWKU) of styling Markdown. We want to preserve these styles when you convert to PDF.)

This is blog post of the journey taken to satisfy these constraints and what was learned along the way.

## Under the hood of a PDF

Before I tell you what was tried and why it failed, it's useful to understand what's going on under the hood of a PDF. The weirdness of PDFs will start to give you some ideas about why meeting my constraints was not as easy as it felt like it should be.

### PDFs are sets of instructions

Imagine a PDF with the just word "Hi" in it. While you would see the word "Hi" in your PDF reader, the underlying PDF would look something like:

```
useFont(Helvetica, 14pt)
moveTo(50, 400)
drawGlyph(43)
drawGlyph(76)
```

Where glyphs 43 and 76 are a numbered shape inside the embedded font: shape 43 is the one that looks like an "H" and shape 76 looks like an "i".

Because a PDF is actually a set of instructions, to generate one that looks like rendered HTML you need to do a fair bit of work: What is the position of the element? What are its styles? And what are the underlying glyphs?

### To copy text you need a table mapping "glyphs" to letters

Because the PDF does not actually render the *letters* "Hi" (just the shapes of the letters), selecting and copying text also requires work behind the scenes. To prevent copy and paste returning a gobbledegook of glyph integers the underlying PDF needs to include a separate side table that the embedded font also carries, called a [ToUnicode CMap](https://en.wikipedia.org/wiki/PDF#Text). It maps shape numbers back to characters:

```
Helvetica's ToUnicode table
───────────────────────────
shape 43 → "H"
shape 76 → "i"
...
```

When you select text, the viewer reads the glyph numbers off the PDF's "program" and looks each one up in the ToUnicode table to recover the original characters. Functional PDFs have copyable text, which means SmallDoc-standard PDF generation needed to include an accurate CMap.

## Out of the box solutions & where they failed

There are four well-trodden ways to generate a PDF from content in the browser. Each one failed one or more of our constraints.

### Going server-side (the Google Docs method)

If you generate a PDF in a Google Doc you get the standard download experience *and* an accurate-looking text-selectable PDF. However you don't get privacy. Your content lives on a Google server and the PDF generation occurs there/in some microservice. This was obviously not an option for privacy-first SmallDocs.

### `window.print()` + "Save as PDF"

The browser is rendering the page itself, so it has every glyph, every CMap, every font already in-memory. `window.print()` opens the print dialog. The print functionality uses the in-memory information and the browser's built in layout engine to render the page in a printable, accurate and text-selectable format. If you choose "Save as PDF" you then have your high quality client-side generated PDF.

But this experience more confusing than I'd like. On desktop you have to tell the user they need to "Save as PDF" and on iOS it is a maze of nested options in sub menus and in between screens which could easily leave you lost. Not good enough if it could be avoided (and I believed it could).

### An accurate PNG of un-selectable text (`html2pdf.js`)

Libraries like `html2pdf` take one or more screenshots of the rendered DOM. The images are then wrapped in PDF pages. Downloads work normally and you get pixel-perfect fidelity to what's on screen, but you can't select text because there is no text - only an image of text. These are low-functional PDFs. Not up to the SmallDocs standards.

### Ugly selectable text (`jsPDF`, `pdfmake`, `pdf-lib`)

These libraries allow you to have the standard download experience and do emit real glyphs and ToUnicode tables, but they don't handle positioning and styling. You get a client-side generated PDF with selectable, copyable and searchable text, but it looks like a five year old with a set of child-friendly scissors hacked apart your beautifully rendered page and stuck it back together. Not ideal.

## The solution: `pdf-lib` + a custom layout engine

Even though the **Ugly selectable text** option above was not good enough out of the box, it created the smallest and most solvable gap to meeting all my constraints. The only thing missing was a solution to PDF ugliness. Surely something could be built to accurately render and layout SmallDocs content in PDF-friendly language.

Two things gave me hope that this could be addressed. The first was that SmallDocs (currently) only renders Markdown. This meant that the list of elements we had to be able to convert to PDF render instructions was finite and small: `h1`-`h4`, `p`, `ul`, `ol`, `pre`, `blockquote`, `img`, `table`, and a `chart` block.

The second was Claude Code. This felt like exactly the type of problem LLMs are good at solving: one with a high level of fiddly working-memory-type detail (different elements and each one's corresponding list of relevant styling properties).

### The layout engine

Claude and I worked together to create rendering pipeline which roughly looks like this:

#### For every element...

```
// pseudocode
for each element in renderedMarkdown:
  if element is a heading:    drawHeading(element)
  if element is a paragraph:  drawParagraph(element)
  if element is an image:     drawImage(element)
  if element is a code block: drawCodeBlock(element)
  ...
```

#### Get the rendered styles...

```
// pseudocode
style = getComputedStyle(element)
fontSize = style.fontSize
color    = style.color
margin   = style.marginBottom
```

#### Then convert to PDF language

##### Pixels -> points

Browsers think in **pixels**. PDFs think in **points**. They are not the same:

```
1 inch on screen = 96 CSS pixels
1 inch on paper  = 72 PDF points

so: 1 CSS pixel = 0.75 PDF points
```

A 16px paragraph in the browser becomes 12pt in the PDF. Every measurement we read in step 2 gets multiplied by 0.75 before we hand it to pdf-lib.

##### Down is up and up is down

The PDF coordinate system moves in the opposite direction to the browser. When items are rendered in the browser **y grows downward** from the top of the page. But in a PDF, **y grows upward** from the bottom of the page:

```
  Browser                      PDF
  ───────                      ───
  (0,0) ─────────                  ─────────
        │                           ▲
        │                           │
        ▼                     (0,0) │
        y grows down                y grows up                 
```

Our renderer keeps a `y` cursor that tracks the current vertical position in PDF coordinates. Each handler draws its element at `y`, then *decreases* `y` by the element's height. When `y` crosses the bottom margin, we add a new page and reset.

```
// pseudocode
y = pageHeight - topMargin
for each element:
  draw element at (leftMargin, y)
  y = y - elementHeight
  if y < bottomMargin:
    addNewPage()
    y = pageHeight - topMargin
```

Roughly speaking this was all that was required to achieve accurately-rendered, text-selectable client-side PDFs.

### Gottchas 

#### Modern fonts vs. glyph to letter mappings

When you embed a font into a PDF, the embedder has to build the ToUnicode CMap mentioned above. By default, pdf-lib builds it from the font's standard `cmap` table — the lookup the font itself uses to go from a character like "H" to a glyph like shape 43. However, **this breaks for almost any modern font**.

Modern fonts do clever things. [OpenType "case"](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae#case) is one. When [Inter](https://rsms.me/inter/) [need to explain better!] sees a `(` next to a capital letter, it doesn't draw the regular `(` glyph — it draws a slightly *taller, repositioned* `(` glyph, designed to sit better next to capitals. Same for `)`, brackets, quotes, hyphens. The original `(` is glyph 12; the substituted version might be glyph 487.

Glyph 487 is in the font. It draws fine. But it's not in the standard `cmap` table — `cmap` only has entries for "characters you can type", not for "glyphs that get substituted in by font features". So pdf-lib's default ToUnicode CMap has no entry for shape 487. The PDF reader sees "draw shape 487, then shape 43" and on copy-paste tries to look those up:

```
shape 487 → ??? (no entry)
shape 43  → "H"
```

What you paste is a blank or a question mark followed by an H. The page looks identical to a working PDF. It only breaks the moment a user tries to copy a heading containing a parenthesis.

The fix was actually very simple: `subset: true`

```
// pseudocode
font = embedFont(fontBytes, { subset: true })
```

`subset: true` tells pdf-lib to use a different embedder, one that walks the *actual glyphs the document uses* (substitutions included) and builds the ToUnicode CMap from that real list. Every shape that gets drawn now has a character mapping meaning copy and paste works.

#### Links are not text

In HTML, `<a href="...">click me</a>` is one element: text and clickability are bonded together. In a PDF, the text is one thing — drawn glyphs — and the clickable region is another, called an [Annot](https://en.wikipedia.org/wiki/PDF#Interactive_elements) (annotation). An Annot is a dictionary that says "the rectangle from (x1, y1) to (x2, y2) on this page is a hyperlink to this URL":

```
// pseudocode
annotation = {
  type: "Link",
  rect: [x1, y1, x2, y2],
  action: { type: "URI", url: "https://..." },
}
page.annotations.push(annotation)
```

Our renderer needs to add the clickable rectangle to the PDF's instructions separately.

#### \<pre>, \<code> and \<blockquote>

HTML elements which style content in a particular way blend elements containing text with corresponding CSS rules. For example, the little rounded background you see behind `inline code` ("<code>inline code</code>") on the screen comes from CSS rules: `background-color`, `padding`, `border-radius`, `font-family`, etc. These are ideas which don't exist in PDF land.

To get the same effects in a PDF you have to draw the underlying shape and position the text on top.

```
// pseudocode
drawRoundedRect(x, y, width, height, radius, color = lightGray)
drawText("inline code", x + pad, y, font = mono)
```

While Claude understood this concept well, it was not great at rendering things accurately. A lot of back and forth was required to get every "fancy" looking element rendering just right.

## We did it!

![A SmallDocs PDF open in a viewer with body text highlighted, showing the text is selectable.](/public/images/example_sdoc_pdf.png)

SmallDocs can now generate highly accurate text selectable-copyable-searchable PDFs entirely client-side.

We don't know if anyone has actually used this feature today, but our hypothesis is that Markdown could be the dominant text file format of the future, replacing the heavier less-agent-friendly traditionally used formats (`.docx` and `.gdoc`). If this happens, perhaps the feature (and SmallDocs) will be widely used.

### Learn more about SmallDocs

SmallDocs is building the developer friendly open-source "Office Suite" for the cli-based agent working world that you'll actually want to use.

We've started with a beautiful, instant and 100% private Markdown renderer. Developers using CLI-based agents use SmallDocs to: 
* **Read deeply** - because reading in the terminal isn't a beautiful experience
* **Share Markdown files** - because the document is [encoded in the URL](https://sdocs.dev/#sec=urls)
* **Give feedback to agents** - using our [comment + copy functionality](https://sdocs.dev/#sec=feedback-for-agents)
* **Get copyable code snippets** - because copying from Claude Code is rough!

Install the SmallDocs cli with `npm i -g sdocs-dev` then you or your agent can `sdoc path/to/file.md`. After you run the first `sdoc` command we give you the option to add a note about SmallDocs to your base agent `.md` files (e.g. `~/.claude/CLAUDE.md`). Content here is then included in every agent session, so you can simply say: "sdoc it to me" and your coding agent will know what to do.

Learn more about SmallDocs and how to try it at [sdocs.dev](https://sdocs.dev/).