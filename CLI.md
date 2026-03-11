# Markdown Studio — CLI

## Overview

`bin/mdstudio.js` is a Node.js CLI that lets anyone (including LLMs) open a markdown file directly in the Markdown Studio browser editor. Content is passed via a URL hash fragment — it never touches the server, so the URL is fully self-contained and shareable.

## Install

```bash
npm link   # installs `mdstudio` globally from this directory
```

## Usage

```bash
mdstudio report.md              # open file (defaults to read mode)
mdstudio report.md --mode style # open with styling panel visible
mdstudio report.md --mode raw   # open showing raw markdown source
cat file.md | mdstudio          # pipe from stdin
mdstudio                        # open empty editor (style mode)
mdstudio --help                 # usage overview
mdstudio --schema               # full styles reference (designed for LLMs)
```

## Modes

| Mode    | Description |
|---------|-------------|
| `read`  | Clean reading view — hides toolbar and styling panel. **Default when a file is given.** |
| `style` | Styled preview with editor controls and styling panel visible. Default when no file given. |
| `raw`   | Shows raw markdown source in the textarea. |

## How it works

1. Reads the file (or stdin)
2. Base64-encodes the content
3. Checks if the server is running on `localhost:3000` — starts it in the background if not
4. Opens the browser at:
   ```
   http://localhost:3000/#md=<base64>&mode=read
   ```

The hash fragment is **never sent to the server** — it's parsed entirely in the browser by `URLSearchParams`. This means:
- No server-side file size limit (browser limit ~2MB, LLM docs are typically 5–50KB)
- The URL is self-contained and shareable — anyone with the URL sees the same content, no server session needed

After loading, the hash is cleared from the URL bar via `history.replaceState`.

## Styled Markdown format

The CLI passes the raw file content (including YAML front matter) as-is. If the file has a `styles:` block, Markdown Studio will parse it and apply all styles automatically on load.

Run `mdstudio --schema` for the complete styles reference, including all supported properties, types, defaults, the color cascade rules, and all 24 supported Google Fonts.

## Intended LLM workflow

1. LLM generates a `.md` file with YAML front matter styles
2. LLM calls `mdstudio report.md` (defaults to read mode for the user)
3. Browser opens showing the styled document — no editor chrome visible
4. User can click "Style" to open the styling panel and adjust, or export to PDF/Word

```bash
# Typical LLM invocation
mdstudio my-report.md
# → opens http://localhost:3000/#md=<base64>&mode=read
```

## package.json bin entry

```json
"bin": {
  "mdstudio": "./bin/mdstudio.js"
}
```

## Environment

```bash
PORT=8080 mdstudio report.md   # use a different port
```
