#!/usr/bin/env node
/**
 * sdocs-dev CLI
 * Usage:
 *   sdocs-dev report.md          # open file in browser
 *   cat file.md | sdocs-dev      # pipe markdown to browser
 *   sdocs-dev                    # open studio with empty editor
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// ── Help ───────────────────────────────────────────────────
const HELP = `
SDocs — CLI
===========
Opens a markdown file in the browser-based SDocs editor,
with live styling controls and export to PDF / Word / raw .md.

USAGE
  sdocs-dev [file]              Open a .md file
  sdocs-dev [file] --mode read   Open directly in read mode (hides editor + controls)
  sdocs-dev [file] --mode style  Open with styling panel visible
  sdocs-dev [file] --mode raw    Open showing raw markdown source
  cat file.md | sdocs-dev       Pipe markdown from stdin
  sdocs-dev                     Open with empty editor
  sdocs-dev --help              Show this help
  sdocs-dev --schema            Print the full styles schema (for LLMs)

MODES
  read   (default when file given) Clean reading view — hides toolbar and styling panel
  style  Styled preview with editor + styling panel visible
  raw    Shows raw markdown source

STYLED MARKDOWN FORMAT
  SDocs extends standard .md files with an optional YAML
  front matter block (the same standard used by Jekyll, Hugo, Obsidian).
  The \`styles\` key controls every visual aspect of the rendered document.

  ---
  title: "My Document"
  styles:
    fontFamily: Inter
    baseFontSize: 16
    color: "#1c1917"
    h1: { fontSize: 2.2, color: "#1a3a5c", fontWeight: 700 }
    p:  { lineHeight: 1.85, marginBottom: 1.1 }
  ---
  # My Document
  Content here...

  Drop the file back onto SDocs to restore content + styles.

Run \`sdocs-dev --schema\` for the complete list of style properties.
`;

const SCHEMA = `
SDocs — Styles Schema
=====================
All style values live under the \`styles:\` key in YAML front matter.
Every property is optional — omit anything you want left at its default.

GENERAL
  fontFamily    string   Any of the supported fonts (see FONTS below)
                         Default: "Inter"
  baseFontSize  number   Base font size in px. All rem/em values scale from this.
                         Default: 16
  color         string   Master body text color (hex). Cascades to headings,
                         paragraphs, and lists unless those are overridden.
                         Default: "#1c1917"
  lineHeight    number   Global line-height multiplier.
                         Default: 1.75

HEADINGS  (general heading controls)
  headers:
    scale         number  Relative size multiplier applied across all heading levels.
                          Default: 1.0
    marginBottom  number  Space below headings (em). Default: 0.4
    color         string  Heading color — cascades to h1/h2/h3/h4 unless overridden.
                          Default: inherits \`color\`

PER-HEADING  (each independently overrides the heading defaults above)
  h1: { fontSize: number, color: string, fontWeight: number }
  h2: { fontSize: number, color: string, fontWeight: number }
  h3: { fontSize: number, color: string, fontWeight: number }
  h4: { fontSize: number, color: string, fontWeight: number }

  fontSize is in rem (relative to baseFontSize).
  Sensible defaults: h1 2.2, h2 1.55, h3 1.2, h4 1.0
  fontWeight: 400 (regular) · 600 (semibold) · 700 (bold)

PARAGRAPH
  p:
    lineHeight    number  Line height for body paragraphs. Default: 1.75
    marginBottom  number  Space between paragraphs (em). Default: 1.1
    color         string  Paragraph text color. Default: inherits \`color\`

LISTS
  list:
    color         string  Color for list items and bullet/number markers.
                          Default: inherits paragraph color

LINKS
  link:
    color       string   Link color. Default: "#2563eb"
    decoration  string   "underline" | "none". Default: "underline"

CODE
  code:
    fontFamily  string   Monospace font. Default: "ui-monospace, monospace"
    background  string   Inline/block code background color. Default: "#F1EDE8"
    padding     number   Inline code padding (em). Default: 0.2

BLOCKQUOTE
  blockquote:
    borderColor  string  Left border accent color. Default: "#2563eb"
    borderWidth  number  Left border thickness (px). Default: 3
    color        string  Quote text color. Default: "#6b6560"

COLOR CASCADE
  Colors cascade from general → specific:
    color  →  headers.color  →  h1.color, h2.color, h3.color, h4.color
    color  →  p.color        →  list.color
  Set a child color only when you want it to differ from its parent.

FONTS (24 supported, loaded lazily from Google Fonts)
  Inter · Roboto · Open Sans · Lato · Montserrat · Source Sans 3
  Oswald · Raleway · Poppins · Merriweather · Ubuntu · Nunito
  Playfair Display · Roboto Slab · PT Sans · Lora · Mulish · Noto Sans
  Rubik · Dosis · Josefin Sans · PT Serif · Libre Franklin · Crimson Text

EXAMPLE — editorial article with colored heading tiers
  ---
  styles:
    fontFamily: Lora
    baseFontSize: 17
    color: "#1a1a2e"
    headers:
      color: "#2c3e50"
    h1: { fontSize: 2.3, color: "#c0392b", fontWeight: 700 }
    h2: { fontSize: 1.55, color: "#8e44ad", fontWeight: 600 }
    h3: { fontSize: 1.2, color: "#16a085", fontWeight: 600 }
    p: { lineHeight: 1.9, marginBottom: 1.2 }
    link: { color: "#e67e22", decoration: "underline" }
    blockquote: { borderColor: "#c0392b", borderWidth: 4, color: "#7f8c8d" }
  ---
`;

// ── Parse args ────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let file = null;
  let mode = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { console.log(HELP);   process.exit(0); }
    if (args[i] === '--schema')                    { console.log(SCHEMA); process.exit(0); }
    if (args[i] === '--mode' || args[i] === '-m') {
      mode = args[++i];
      if (!['read', 'style', 'raw'].includes(mode)) {
        console.error(`sdocs-dev: unknown mode "${mode}" — use read, style, or raw`);
        process.exit(1);
      }
    } else if (!file) {
      file = args[i];
    }
  }

  return { file, mode };
}

// ── Read content ───────────────────────────────────────────
async function readContent(file) {
  if (file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`sdocs-dev: file not found: ${file}`);
      process.exit(1);
    }
    return fs.readFileSync(resolved, 'utf-8');
  }

  // Check if stdin has data (piped input)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  return null; // no content — just open studio
}

// ── Check if server is already running ────────────────────
function isServerRunning() {
  return new Promise(resolve => {
    http.get(`${BASE_URL}/`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

// ── Start server in background ─────────────────────────────
function startServer() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const { spawn } = require('child_process');
  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait until server responds
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      if (Date.now() - start > 5000) return reject(new Error('Server did not start in time'));
      http.get(`${BASE_URL}/`, res => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        setTimeout(poll, 200);
      }).on('error', () => setTimeout(poll, 200));
    }
    setTimeout(poll, 300);
  });
}

// ── Open browser ───────────────────────────────────────────
function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin')      execSync(`open "${url}"`);
    else if (platform === 'win32')  execSync(`start "" "${url}"`);
    else                            execSync(`xdg-open "${url}"`);
  } catch {
    console.log(`Open in browser: ${url}`);
  }
}

// ── Main ───────────────────────────────────────────────────
(async () => {
  const { file, mode } = parseArgs();
  const content = await readContent(file);

  let url = BASE_URL;
  const params = new URLSearchParams();
  if (content) params.set('md', encodeURIComponent(Buffer.from(content, 'utf-8').toString('base64')));
  const effectiveMode = mode || (content ? 'read' : 'style');
  if (effectiveMode) params.set('mode', effectiveMode);
  if (params.toString()) url = `${BASE_URL}/#${params.toString()}`;

  const running = await isServerRunning();
  if (!running) {
    process.stdout.write('Starting SDocs server... ');
    await startServer();
    console.log('ready.');
  }

  openBrowser(url);
  console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
})().catch(e => {
  console.error('sdocs-dev:', e.message);
  process.exit(1);
});
