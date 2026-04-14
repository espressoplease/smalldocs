#!/usr/bin/env node
/**
 * sdoc CLI
 * Usage:
 *   sdoc report.md              # open file in browser
 *   sdoc share report.md        # copy shareable link to clipboard
 *   sdoc new                    # blank document in write mode
 *   cat file.md | sdoc          # pipe markdown to browser
 *   sdoc                        # open studio with empty editor
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const SDocYaml = require('../public/sdocs-yaml.js');
const SDocStyles = require('../public/sdocs-styles.js');

const https    = require('https');
const os       = require('os');
const readline = require('readline');

const DEFAULT_URL = 'https://sdocs.dev';
const VERSION = require('../package.json').version;

// ── Update check ─────────────────────────────────────────
// Daily background refresh of the latest version from npm (silent).
// On next invocation, if the cached `latest` is newer, prompt the user
// to install. Y/y runs `npm i -g sdocs-dev` and re-execs their command.

const UPDATE_CACHE = path.join(os.homedir(), '.sdocs', 'update-check.json');
const SETUP_CACHE  = path.join(os.homedir(), '.sdocs', 'setup.json');
const ONE_DAY = 86400000;

// ── Agent integration block ──────────────────────────────
// IMPORTANT: keep this in sync with the per-agent setup snippets in
// public/sdoc.md (the "Set up your agent" section). If you reword one,
// reword the other. The marker comment on line 1 is used to detect
// whether the block has already been written to a file (idempotent re-runs).
const AGENT_BLOCK = `<!-- sdocs-agent-block -->
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash — nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a \`.md\` file.

The \`sdoc\` CLI is installed globally:
- \`sdoc file.md\` — open styled in browser (great for easy reading).
- \`sdoc share file.md\` — copy shareable URL to clipboard.
- \`sdoc schema\` — how to adjust all stylable properties (fonts, colors, spacing).
- \`sdoc charts\` — chart types, JSON format, and styling. Charts render via Chart.js from \`\`\`chart code blocks.
- \`sdoc --help\` — full usage.

Source: https://github.com/JoshInLisbon/SDocs
`;
const AGENT_BLOCK_MARKER = '<!-- sdocs-agent-block -->';

const AGENT_TARGETS = [
  { name: 'Claude Code', dir: '.claude',                file: 'CLAUDE.md'  },
  { name: 'Codex',       dir: '.codex',                 file: 'AGENTS.md'  },
  { name: 'Gemini CLI',  dir: '.gemini',                file: 'GEMINI.md'  },
  { name: 'opencode',    dir: path.join('.config', 'opencode'), file: 'AGENTS.md' },
];

function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function readCachedLatest() {
  try { return JSON.parse(fs.readFileSync(UPDATE_CACHE, 'utf-8')).latest; }
  catch (_) { return null; }
}

async function promptUpdateIfAvailable() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return;
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;

  const latest = readCachedLatest();
  if (!latest || !isNewer(latest, VERSION)) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question(`\nUpdate available: ${VERSION} \u2192 ${latest}. Install now? [Y/n] `, a => {
      rl.close(); resolve(a.trim().toLowerCase());
    });
  });
  if (answer && answer !== 'y' && answer !== 'yes') return;

  console.log('Installing sdocs-dev@latest...');
  try {
    execSync('npm i -g sdocs-dev@latest', { stdio: 'inherit' });
    console.log(`\u2713 Updated to v${latest}`);
  } catch (_) {
    console.error('Update failed. You may need: sudo npm i -g sdocs-dev');
  }
}

function refreshUpdateCache() {
  if (!process.stdout.isTTY || process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  try {
    if (Date.now() - fs.statSync(UPDATE_CACHE).mtimeMs < ONE_DAY) return;
  } catch (_) {}

  https.get('https://registry.npmjs.org/-/package/sdocs-dev/dist-tags', { timeout: 3000 }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).latest;
        fs.mkdirSync(path.dirname(UPDATE_CACHE), { recursive: true });
        fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ latest }));
      } catch (_) {}
    });
  }).on('error', () => {}).on('timeout', function () { this.destroy(); });
}

// ── Agent setup ──────────────────────────────────────────
// On first interactive run, detect which coding-agent config dirs exist
// and offer to append AGENT_BLOCK to each. Tracked in ~/.sdocs/setup.json
// so we never prompt twice. Manually re-runnable via `sdoc setup`.

function readSetupState() {
  try { return JSON.parse(fs.readFileSync(SETUP_CACHE, 'utf-8')); }
  catch (_) { return null; }
}

function writeSetupState(state) {
  try {
    fs.mkdirSync(path.dirname(SETUP_CACHE), { recursive: true });
    fs.writeFileSync(SETUP_CACHE, JSON.stringify(state, null, 2));
  } catch (_) {}
}

function detectAgents() {
  const home = os.homedir();
  return AGENT_TARGETS
    .map(t => ({ ...t, dirPath: path.join(home, t.dir), filePath: path.join(home, t.dir, t.file) }))
    .filter(t => fs.existsSync(t.dirPath));
}

function fileHasBlock(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8').includes(AGENT_BLOCK_MARKER); }
  catch (_) { return false; }
}

function appendBlockTo(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const exists = fs.existsSync(filePath);
  const prefix = exists && fs.readFileSync(filePath, 'utf-8').endsWith('\n') ? '\n' : (exists ? '\n\n' : '');
  fs.appendFileSync(filePath, prefix + AGENT_BLOCK);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, a => { rl.close(); resolve(a.trim().toLowerCase()); });
  });
}

async function runSetup({ force = false } = {}) {
  if (!force) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return;
    if (process.env.CI || process.env.SDOCS_NO_SETUP) return;
    if (readSetupState()) return;
  }

  const detected = detectAgents().filter(t => !fileHasBlock(t.filePath));

  if (detected.length === 0) {
    // Fallback: ask about opencode if nothing detected and not already set up
    const opencodeAlreadyDone = fileHasBlock(path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md'));
    if (opencodeAlreadyDone) {
      writeSetupState({ setupCompleted: new Date().toISOString(), writtenTo: [], declined: false });
      console.log('\nSDocs is already set up in all detected agent configs. Nothing to do.');
      return;
    }
    console.log('\n\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SDocs setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728');
    console.log('First run only \u2014 wire SDocs into your coding agents.\n');
    console.log('No coding-agent configs detected.');
    const a = await ask('Do you use opencode? [y/N] ');
    const writtenTo = [];
    if (a === 'y' || a === 'yes') {
      const target = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
      try { appendBlockTo(target); writtenTo.push(target); console.log(`\u2713 Wrote SDocs section to ${target}`); }
      catch (e) { console.error(`Failed to write ${target}: ${e.message}`); }
      console.log('Done. Run `sdoc setup` any time to revisit.');
    } else {
      console.log('Skipped. Run `sdoc setup` any time to revisit.');
    }
    writeSetupState({ setupCompleted: new Date().toISOString(), writtenTo, declined: writtenTo.length === 0 });
    return;
  }

  console.log('\n\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SDocs setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728');
  console.log('First run only \u2014 wire SDocs into your coding agents.\n');
  console.log('Detected: ' + detected.map(t => t.name).join(', '));
  console.log('\nWill append a short SDocs section to:');
  for (const t of detected) console.log('  ' + t.filePath);
  const RULE = '\u2550'.repeat(36);
  const previewBody = AGENT_BLOCK.replace(AGENT_BLOCK_MARKER + '\n', '').trim();
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 Block to add \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(previewBody);
  console.log(RULE + '\n');

  const a = await ask('Add to all? [Y/n/skip] ');
  const skipped = a === 'skip' || (a && a !== 'y' && a !== 'yes');
  if (skipped) {
    writeSetupState({ setupCompleted: new Date().toISOString(), writtenTo: [], declined: true });
    console.log('Skipped. Run `sdoc setup` any time to revisit.');
    return;
  }

  const writtenTo = [];
  for (const t of detected) {
    try { appendBlockTo(t.filePath); writtenTo.push(t.filePath); console.log(`\u2713 ${t.name}: ${t.filePath}`); }
    catch (e) { console.error(`\u2717 ${t.name}: ${e.message}`); }
  }
  writeSetupState({ setupCompleted: new Date().toISOString(), writtenTo, declined: false });
  console.log('Done. Run `sdoc setup` any time to revisit.');
}

// ── Help ───────────────────────────────────────────────────
const HELP = `
SDocs CLI
=========
Open, share, and style markdown files from the terminal.

USAGE
  sdoc <file>                      Open file in browser (read mode)
  sdoc <file> --write              Open in write mode
  sdoc <file> --style              Open with style panel
  sdoc <file> --raw                Open raw markdown source
  sdoc new                         New blank document (write mode)
  sdoc share <file>                Copy shareable link to clipboard
  sdoc share <file> --section "X"  Link with section anchor
  sdoc schema                      Print the full styles schema
  sdoc charts                      Chart types, options, and styling guide
  sdoc defaults                    Show ~/.sdocs/styles.yaml
  sdoc defaults --reset            Remove default styles
  sdoc setup                       Wire SDocs into your coding agents
  sdoc help                        Show this help
  cat file.md | sdoc               Pipe markdown from stdin
  cat file.md | sdoc share         Pipe to clipboard link

MODE FLAGS
  --read     Clean reading view (default when file given)
  --write    Opens the contentEditable writer
  --style    Styled preview with style panel visible
  --raw      Shows raw markdown source

OPTIONS
  --section <heading>   Scroll to heading section on load
  --light               Open in light theme
  --dark                Open in dark theme
  --url <base>          Custom base URL (default: https://sdocs.dev)
  --mode <m>            Alias for --read / --write / --style / --raw

ENVIRONMENT
  SDOCS_URL   Fallback base URL if --url is not passed.

FILE INFO CARD
  When you \`sdoc <file>\`, the browser shows a small info card
  above the document with:
    file       The filename — included in the share URL.
    path       Relative path from the cwd — local only.
    fullPath   Absolute path on your machine — local only.

  Local fields (path, fullPath) are passed to the browser via a
  separate URL parameter that JS reads into memory and then strips
  from the address bar on load. They never appear in any URL the
  user can copy, and \`sdoc share <file>\` never includes them in
  the generated link. If someone opens your shared URL, only
  \`file\` is visible.

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

  Colors work in both themes automatically — dark mode versions
  are generated by inverting lightness. Use \`dark:\` to override.

Run \`sdoc schema\` for the complete list of style properties.
Run \`sdoc charts\` for chart types, options, and styling.
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
  background    string   Page background color (hex).
                         Default: "#ffffff" (light) / "#2c2a26" (dark)
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
    background   string  Quote background color. Default: "#f7f5f2"
    color        string  Quote text color. Default: "#6b6560"

BLOCKS (shared styling for code, blockquote, and chart blocks)
  blocks:
    background  string  Background for all block types. Cascades to code,
                        blockquote, and chart backgrounds unless overridden.
    color       string  Text color for all block types. Cascades to code,
                        blockquote, and chart text unless overridden.

CHARTS
  chart:
    accent      string  Palette base color (hex). Default: "#3b82f6"
    palette     string  Palette mode. Default: "monochrome"
                        Options: monochrome, complementary, analogous, triadic,
                        pastel, warm, cool, earth
    background  string  Chart background. Default: inherits blocks.background
    textColor   string  Chart labels/axes. Default: inherits blocks.color

  Run \`sdoc charts\` for the full chart reference — chart types, JSON
  format, axis/legend/annotation options, and per-chart styling overrides.

COLOR CASCADE
  Colors cascade from general → specific:
    color  →  headers.color  →  h1.color, h2.color, h3.color, h4.color
    color  →  p.color        →  list.color
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
  Set a child color only when you want it to differ from its parent.

THEME COLORS
  Top-level colors are light-mode colors. Dark mode is auto-generated
  by inverting lightness (same hue, flipped brightness). Light backgrounds
  become dark, dark text becomes light. Colors already very dark (like a
  dark code block background) are kept as-is.

  This means you only need to specify colors ONCE:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    headers: { color: "#8b2500" }
    blocks:
      background: "#f5e6d8"
      color: "#5a3e2e"
  ---

  Dark mode will automatically get inverted versions of all colors above.

  To override specific dark-mode colors, add a \`dark:\` block:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    blocks:
      background: "#f5e6d8"
    dark:
      background: "#1a1210"
      blocks:
        background: "#2a1a1a"
  ---

  Non-color properties (fonts, sizes, spacing, weights) remain at the
  top level and are shared across both themes.

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
    background: "#fffaf5"
    color: "#1a1a2e"
    h1: { fontSize: 2.3, fontWeight: 700, color: "#c0392b" }
    h2: { fontSize: 1.55, fontWeight: 600, color: "#8e44ad" }
    h3: { fontSize: 1.2, fontWeight: 600, color: "#16a085" }
    p: { lineHeight: 1.9, marginBottom: 1.2 }
    link: { color: "#e67e22" }
    blocks:
      background: "#faf0eb"
    blockquote: { borderColor: "#c0392b", color: "#7f8c8d" }
    dark:
      background: "#1a1520"
      h1: { color: "#ef6f5e" }
      h2: { color: "#c490e4" }
      blockquote: { borderColor: "#ef6f5e" }
  ---
`;

const CHARTS_HELP = `
SDocs — Charts
==============
Render beautiful charts in markdown using \`\`\`chart code blocks.
Charts are powered by Chart.js, loaded lazily from CDN only when needed.

BASIC SYNTAX
  Wrap a JSON object in a \`\`\`chart fenced code block:

  \`\`\`chart
  {
    "type": "bar",
    "title": "Monthly Revenue",
    "labels": ["Jan", "Feb", "Mar"],
    "values": [100, 150, 130]
  }
  \`\`\`

CHART TYPES
  pie              Circular segments (use "color" for monochrome shading)
  doughnut         Hollow-center pie (alias: donut)
  bar              Vertical bars
  horizontal_bar   Horizontal bars (alias: hbar)
  stacked_bar      Stacked vertical bars
  line             Line graph with data points
  area             Line with filled area beneath
  stacked_area     Multiple filled areas stacked (alias: stacked_line)
  radar            Spider/web chart for multi-axis comparison
  polarArea        Like pie but equal angles, varying radius
  scatter          X/Y point plots
  bubble           Like scatter with size dimension
  mixed            Combo chart — bar + line on same plot (alias: combo)

DATA FORMATS
  Simple (single dataset):
    "labels": ["A", "B", "C"],
    "values": [10, 20, 15]

  Multi-dataset:
    "labels": ["Q1", "Q2"],
    "datasets": [
      { "label": "2024", "values": [10, 20] },
      { "label": "2025", "values": [12, 25] }
    ]

  Scatter/Bubble:
    "datasets": [
      { "label": "Group", "data": [{"x": 1, "y": 2}, {"x": 3, "y": 5}] }
    ]

CHART OPTIONS
  title           string     Chart heading
  subtitle        string     Smaller text below title
  labels          string[]   Category labels
  values          number[]   Data for a single dataset
  datasets        array      Multiple datasets (see above)
  color           string     Single accent color (hex)
  colors          string[]   Per-segment/bar custom colors

AXIS OPTIONS
  xAxis / xLabel  string     X-axis label
  yAxis / yLabel  string     Y-axis label
  y2Axis          string     Right y-axis label (enables dual axis)
  min             number     Minimum value on value axis
  max             number     Maximum value on value axis
  stepSize        number     Tick interval
  beginAtZero     boolean    Default true. Set false for auto-range.

NUMBER FORMATTING
  format          string     "currency" ($), "euro" (€), "pound" (£),
                             "percent" (%), "comma" (1,000)
  prefix          string     Custom value prefix (e.g. "£")
  suffix          string     Custom value suffix (e.g. " kg", "°C")
  y2Format        string     Format for right y-axis
  y2Prefix        string     Prefix for right y-axis
  y2Suffix        string     Suffix for right y-axis

DISPLAY OPTIONS
  legend          boolean    Show/hide legend (auto by default)
  legendPosition  string     "top", "bottom" (default), "left", "right"
  dataLabels      boolean    Show values on chart (default true). Set false for clean look.
  aspectRatio     number     Width/height ratio (e.g. 2 for wide, 0.8 for tall)
  stacked         boolean    Force stacking on bar/line charts

DATASET OPTIONS (inside each dataset object)
  label           string     Name shown in legend
  values          number[]   Data points
  data            object[]   For scatter: [{x, y}], for bubble: [{x, y, r}]
  color           string     Dataset color (hex)
  colors          string[]   Per-bar colors within dataset
  type            string     Override type in mixed charts ("bar" or "line")
  yAxisID         string     "y" (left) or "y2" (right) for dual-axis charts
  fill            boolean    Fill area under line
  tension         number     Line smoothing (0 = straight, 0.4 = smooth)
  order           number     Draw order (lower = rendered on top)

ANNOTATIONS (reference lines)
  "annotations": [
    { "y": 60, "label": "Target", "color": "#ef4444" },
    { "x": "Mar", "label": "Launch", "dashed": true }
  ]

  y / x           number/string   Position of the reference line
  label           string          Text label on the line
  color           string          Line color
  width           number          Line thickness (default 2)
  dashed          boolean         Dashed style (default true)
  position        string          Label position: "start", "center", "end"

CHART STYLING (via front matter or style panel)
  Charts inherit background and text colors from the block cascade:

  ---
  styles:
    blocks:
      background: "#1a1a2e"     # all blocks: code, blockquote, charts
      color: "#c8c3bc"          # text in all blocks
    chart:
      accent: "#6366f1"         # palette base color
      palette: monochrome       # palette generation mode
      background: "#0e4a1a"     # override blocks.background for charts only
      textColor: "#c8f0d8"      # override blocks.color for charts only
  ---

  COLOR CASCADE FOR BLOCKS
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
    Set a child value only when you want it to differ from the parent.

  DARK MODE
    All colors auto-generate dark-mode counterparts (lightness inverted).
    Add a \`dark:\` block to override specific values:
      dark:
        blocks:
          background: "#2a1a1a"

  PALETTE MODES
    monochrome      Same hue, varying lightness (default)
    complementary   Hues spread evenly around the color wheel
    analogous       Neighboring hues for a harmonious feel
    triadic         Three base hues 120° apart
    pastel          Soft, light colors
    warm            Reds, oranges, yellows
    cool            Blues, teals, purples
    earth           Browns, olives, muted greens

  Per-chart override: set "accent" and/or "palette" directly in the chart JSON.
  Per-chart colors: set "colors": ["#hex", ...] to override the palette entirely.
  Single-color pie: set "color": "#hex" on a pie/doughnut for monochrome shading.

MIXED CHART EXAMPLE (dual y-axis)
  \`\`\`chart
  {
    "type": "mixed",
    "title": "Revenue vs Growth",
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "datasets": [
      { "label": "Revenue", "type": "bar", "values": [50, 65, 80, 95], "yAxisID": "y" },
      { "label": "Growth", "type": "line", "values": [12, 30, 23, 19], "yAxisID": "y2" }
    ],
    "yAxis": "Revenue ($M)",
    "y2Axis": "Growth %",
    "format": "currency",
    "y2Format": "percent"
  }
  \`\`\`
`;

// ── Compression (brotli + base64url) ─────────────────

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  b64 += '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

function compressToBase64Url(text) {
  const compressed = zlib.brotliCompressSync(Buffer.from(text, 'utf-8'), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  return toBase64Url(compressed);
}

function decompressFromBase64Url(b64url) {
  const buf = fromBase64Url(b64url);
  // Try brotli first, fall back to deflate for old URLs
  try {
    return zlib.brotliDecompressSync(buf).toString('utf-8');
  } catch (_) {
    return zlib.inflateRawSync(buf).toString('utf-8');
  }
}

// ── Slugify (shared module) ───────────────────────────────

var slugify = require('../public/sdocs-slugify').slugify;

// ── Parse args ────────────────────────────────────────────

const SUBCOMMANDS = new Set(['new', 'share', 'schema', 'defaults', 'help', 'charts', 'setup']);

function parseArgs(argv) {
  const args = argv || process.argv.slice(2);
  let file = null;
  let mode = null;
  let url = null;
  let subcommand = null;
  let section = null;
  let theme = null;
  let resetFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Legacy / shortcut flags that map to subcommands
    if (arg === '--help' || arg === '-h') { subcommand = 'help'; continue; }
    if (arg === '--schema')               { subcommand = 'schema'; continue; }

    // Mode shorthand flags
    if (arg === '--write') { mode = 'write'; continue; }
    if (arg === '--style') { mode = 'style'; continue; }
    if (arg === '--raw')   { mode = 'raw';   continue; }
    if (arg === '--read')  { mode = 'read';  continue; }
    if (arg === '--light') { theme = 'light'; continue; }
    if (arg === '--dark')  { theme = 'dark';  continue; }

    // Long-form --mode
    if (arg === '--mode' || arg === '-m') {
      mode = args[++i];
      if (!['read', 'write', 'style', 'raw'].includes(mode)) {
        console.error(`sdoc: unknown mode "${mode}" — use read, write, style, or raw`);
        process.exit(1);
      }
      continue;
    }

    // --url flag
    if (arg === '--url') { url = args[++i]; continue; }

    // --section flag
    if (arg === '--section' || arg === '-s') { section = args[++i]; continue; }

    // --reset flag (for defaults subcommand)
    if (arg === '--reset') { resetFlag = true; continue; }

    // Positional: check for subcommand first, then file
    if (!subcommand && SUBCOMMANDS.has(arg)) {
      subcommand = arg;
      continue;
    }

    if (!file) { file = arg; continue; }
  }

  return { file, mode, url, subcommand, section, theme, resetFlag };
}

// ── Build URL ─────────────────────────────────────────────

function buildUrl(content, opts) {
  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const params = new URLSearchParams();

  // Runtime-only metadata (paths). Stripped from the URL by the browser on load,
  // so anything the user copies from the address bar won't contain them.
  if (opts.local && Object.keys(opts.local).length > 0) {
    const json = JSON.stringify(opts.local);
    const b64 = Buffer.from(json, 'utf-8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    params.set('local', b64);
  }

  if (content) {
    // Strip default style values to produce shorter URLs
    const parsed = SDocYaml.parseFrontMatter(content);
    if (parsed.meta && parsed.meta.styles) {
      const stripped = SDocStyles.stripStyleDefaults(parsed.meta.styles);
      if (Object.keys(stripped).length > 0) {
        parsed.meta.styles = stripped;
      } else {
        delete parsed.meta.styles;
      }
      content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
    }
    params.set('md', compressToBase64Url(content));
  } else if (opts.defaultStyles) {
    const stylesJson = JSON.stringify(opts.defaultStyles);
    params.set('styles', encodeURIComponent(Buffer.from(stylesJson, 'utf-8').toString('base64')));
  }

  const mode = opts.mode || (content ? 'read' : 'style');
  if (mode && mode !== 'read') params.set('mode', mode);

  if (opts.theme) params.set('theme', opts.theme);

  if (opts.section) {
    params.set('sec', slugify(opts.section));
  }

  const qs = params.toString();
  return qs ? `${baseUrl}/#${qs}` : baseUrl;
}

// ── YAML parsing (shared module) ──
const { parseSimpleYaml, parseFrontMatter, serializeFrontMatter } = SDocYaml;

// ── ~/.sdocs/styles.yaml default styles ────────────────────

function getDefaultsPath() {
  return path.join(require('os').homedir(), '.sdocs', 'styles.yaml');
}

function loadDefaultStyles() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const yaml = fs.readFileSync(configPath, 'utf-8');
    return parseSimpleYaml(yaml);
  } catch {
    return null;
  }
}

function showDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles set (~/.sdocs/styles.yaml not found).');
    console.log('\nTo set defaults, style a document in SDocs and use');
    console.log('the "Save as Default" panel to generate the command.');
    return;
  }
  console.log(fs.readFileSync(configPath, 'utf-8'));
}

function resetDefaults() {
  const configPath = getDefaultsPath();
  if (!fs.existsSync(configPath)) {
    console.log('No default styles to remove.');
    return;
  }
  fs.unlinkSync(configPath);
  console.log('Removed ' + configPath);
}

// Deep merge: defaults under file styles (file wins on conflict)
// Recursive for light:/dark: sub-objects that contain nested objects
function mergeStyles(defaults, fileStyles) {
  if (!defaults) return fileStyles || {};
  if (!fileStyles) return { ...defaults };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(fileStyles)) {
    if (typeof v === 'object' && v !== null && typeof merged[k] === 'object' && merged[k] !== null) {
      // Recurse one level deeper for light/dark blocks that contain nested objects (e.g. h1: { color: ... })
      const inner = { ...merged[k] };
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'object' && iv !== null && typeof inner[ik] === 'object' && inner[ik] !== null) {
          inner[ik] = { ...inner[ik], ...iv };
        } else {
          inner[ik] = iv;
        }
      }
      merged[k] = inner;
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

// Apply default styles to content, returning modified content
function applyDefaultStyles(content) {
  const defaults = loadDefaultStyles();
  if (!defaults) return content;

  const { meta, body } = parseFrontMatter(content);
  const mergedStyles = mergeStyles(defaults, meta.styles);
  const newMeta = { ...meta, styles: mergedStyles };
  return serializeFrontMatter(newMeta) + '\n' + body;
}

// ── Read content ───────────────────────────────────────────

async function readContent(file) {
  if (file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`sdoc: file not found: ${file}`);
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

if (require.main === module) {
  (async () => {
    const opts = parseArgs();

    // Subcommand dispatch
    if (opts.subcommand === 'help')   { console.log(HELP);   process.exit(0); }
    if (opts.subcommand === 'schema') { console.log(SCHEMA); process.exit(0); }
    if (opts.subcommand === 'charts') { console.log(CHARTS_HELP); process.exit(0); }
    if (opts.subcommand === 'setup')  { await runSetup({ force: true }); process.exit(0); }
    if (opts.subcommand === 'defaults') {
      if (opts.resetFlag) resetDefaults();
      else showDefaults();
      process.exit(0);
    }
    if (opts.subcommand === 'new') {
      const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
      const url = baseUrl + '/new';
      openBrowser(url);
      console.log(`SDocs → ${url}`);
      process.exit(0);
    }

    // File / stdin handling
    let content = await readContent(opts.file);

    // Apply ~/.sdocs/styles.yaml defaults
    const defaults = loadDefaultStyles();
    if (content && defaults) {
      content = applyDefaultStyles(content);
    }

    // Inject `file:` into front matter (basename only — safe to share).
    // Respects user-set file: if already present.
    if (content && opts.file) {
      const parsed = parseFrontMatter(content);
      if (!parsed.meta.file) {
        parsed.meta.file = path.basename(opts.file);
        content = serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
      }
    }

    // Runtime-only local metadata for the opener's view.
    // `share` omits it so shared URLs never carry paths.
    let local = null;
    if (opts.file && opts.subcommand !== 'share') {
      const abs = path.resolve(opts.file);
      const rel = path.relative(process.cwd(), abs);
      local = { fullPath: abs };
      // Only include a relative path if the file is inside cwd, otherwise
      // `path` would just duplicate `fullPath`.
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        local.path = './' + rel;
      }
    }

    const url = buildUrl(content, {
      url: opts.url,
      mode: opts.mode,
      theme: opts.theme,
      defaultStyles: !content ? defaults : null,
      section: opts.section,
      local: local,
    });

    // Share: copy to clipboard
    if (opts.subcommand === 'share') {
      try {
        const clip = process.platform === 'darwin' ? 'pbcopy'
          : execSync('which xclip 2>/dev/null', { encoding: 'utf-8' }).trim() ? 'xclip -selection clipboard'
          : 'xsel --clipboard --input';
        execSync(clip, { input: url, stdio: ['pipe', 'ignore', 'ignore'] });
        const name = opts.file ? path.basename(opts.file) : 'stdin';
        console.log(`\u2713 Link for ${name} copied to clipboard`);
      } catch (_) {
        process.stdout.write(url + '\n');
      }
      refreshUpdateCache();
      await promptUpdateIfAvailable();
      await runSetup();
      return;
    }

    // Default: open browser
    openBrowser(url);
    console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
    refreshUpdateCache();
    await promptUpdateIfAvailable();
    await runSetup();
  })().catch(e => {
    console.error('sdoc:', e.message);
    process.exit(1);
  });
}

// ── Exports (for tests) ───────────────────────────────────

module.exports = {
  mergeStyles,
  applyDefaultStyles,
  parseFrontMatter,
  serializeFrontMatter,
  parseSimpleYaml,
  parseArgs,
  buildUrl,
  slugify,
  compressToBase64Url,
  decompressFromBase64Url,
};
