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

const https = require('https');
const os    = require('os');

const DEFAULT_URL = 'https://sdocs.dev';
const VERSION = require('../package.json').version;

// ── Update check (cached, every 3 days) ──────────────────

const UPDATE_CACHE = path.join(os.homedir(), '.config', 'sdocs-dev', 'update-check.json');
const THREE_DAYS = 3 * 86400000;

function checkForUpdate() {
  if (!process.stdout.isTTY || process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;

  // Skip if checked recently
  try {
    if (Date.now() - fs.statSync(UPDATE_CACHE).mtimeMs < THREE_DAYS) return;
  } catch (_) {}

  console.log('Checking for updates...');
  https.get('https://registry.npmjs.org/-/package/sdocs-dev/dist-tags', { timeout: 3000 }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).latest;
        // Update cache timestamp
        fs.mkdirSync(path.dirname(UPDATE_CACHE), { recursive: true });
        fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ latest }));

        const a = latest.split('.').map(Number);
        const b = VERSION.split('.').map(Number);
        let newer = false;
        for (let i = 0; i < 3; i++) { if (a[i] > b[i]) { newer = true; break; } if (a[i] < b[i]) break; }
        if (newer) {
          console.log(`Update available: ${VERSION} \u2192 ${latest} \u2014 run \`npm i -g sdocs-dev\` to update`);
        } else {
          console.log(`Up to date (v${VERSION})`);
        }
      } catch (_) {}
    });
  }).on('error', () => {}).on('timeout', function () { this.destroy(); });
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
  sdoc defaults                    Show ~/.sdocs/styles.yaml
  sdoc defaults --reset            Remove default styles
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

Run \`sdoc schema\` for the complete list of style properties.
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

COLOR CASCADE
  Colors cascade from general → specific:
    color  →  headers.color  →  h1.color, h2.color, h3.color, h4.color
    color  →  p.color        →  list.color
  Set a child color only when you want it to differ from its parent.

THEME COLORS
  Colors can be set per-theme using \`light:\` and \`dark:\` sub-blocks under \`styles:\`.
  Non-color properties (fonts, sizes, spacing, weights) remain at the top level
  and are shared across both themes.

  ---
  styles:
    fontFamily: Lora
    baseFontSize: 17
    light:
      background: "#ffffff"
      color: "#1a1a2e"
      h1: { color: "#c0392b" }
      link: { color: "#2563eb" }
    dark:
      background: "#2c2a26"
      color: "#e7e5e2"
      h1: { color: "#ef6f5e" }
      link: { color: "#60a5fa" }
  ---

  Top-level colors (old format) are treated as light-theme colors for
  backwards compatibility.

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
    h1: { fontSize: 2.3, fontWeight: 700 }
    h2: { fontSize: 1.55, fontWeight: 600 }
    h3: { fontSize: 1.2, fontWeight: 600 }
    p: { lineHeight: 1.9, marginBottom: 1.2 }
    light:
      background: "#fffaf5"
      color: "#1a1a2e"
      headers: { color: "#2c3e50" }
      h1: { color: "#c0392b" }
      h2: { color: "#8e44ad" }
      h3: { color: "#16a085" }
      link: { color: "#e67e22", decoration: "underline" }
      blockquote: { borderColor: "#c0392b", background: "#faf0eb", color: "#7f8c8d" }
    dark:
      background: "#1a1520"
      color: "#e7e5e2"
      headers: { color: "#b0aaa5" }
      h1: { color: "#ef6f5e" }
      h2: { color: "#c490e4" }
      h3: { color: "#5ed4b8" }
      link: { color: "#f0a860", decoration: "underline" }
      blockquote: { borderColor: "#ef6f5e", background: "#221a28", color: "#9e9590" }
  ---
`;

// ── Compression (deflate-raw + base64url) ─────────────────

function compressToBase64Url(text) {
  const deflated = zlib.deflateRawSync(Buffer.from(text, 'utf-8'));
  return deflated.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decompressFromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  b64 += '='.repeat(pad);
  return zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf-8');
}

// ── Slugify ───────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ── Parse args ────────────────────────────────────────────

const SUBCOMMANDS = new Set(['new', 'share', 'schema', 'defaults', 'help']);

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

  if (content) {
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

    const url = buildUrl(content, {
      url: opts.url,
      mode: opts.mode,
      theme: opts.theme,
      defaultStyles: !content ? defaults : null,
      section: opts.section,
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
      checkForUpdate();
      return;
    }

    // Default: open browser
    openBrowser(url);
    console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
    checkForUpdate();
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
