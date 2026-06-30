// CLI I/O helpers: argv parsing, content reading, browser opening.

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { transcludeCells } = require('./cells-transclude');
const { isWrappedFile, wrapForDisplay } = require('./file-wrap');
const codeLangs = require('./code-langs');

const SUBCOMMANDS = new Set([
  'new', 'share', 'schema', 'defaults', 'help', 'version',
  'charts', 'diagrams', 'videos', 'video', 'cells', 'code', 'comments',
  'setup', 'safe', 'auto-update', 'refresh', 'upgrade',
  'bridge', 'feedback',
  'slides', 'present',
  'library',
  'color-analysis',
]);

// CLI tag arguments are `+tag` (shell-safe, no quoting). Tags written
// this way are injected into the file's YAML front matter at open time;
// front matter is the only place SDocs stores tags.
const TAG_ARG = /^\+[A-Za-z][\w-]{0,63}$/;

// Agent annotation arguments: `N:"text"` or `N-M:"text"` (the shell removes the
// quotes, so the token arrives as `22:this is the bug`). Line numbers are
// 1-based, matching what the reader sees in the gutter. Collected into an
// annotations list and written into the opened file's front matter so they
// travel with the link. The part before the colon must be digits (an optional
// range), so file paths like `app.py` never match.
const ANNOTATION_ARG = /^(\d+)(?:-(\d+))?:([\s\S]+)$/;

function parseArgs(argv) {
  const args = argv || process.argv.slice(2);
  let file = null;
  let extra = null;
  let mode = null;
  let url = null;
  let subcommand = null;
  let section = null;
  let theme = null;
  let resetFlag = false;
  let shortFlag = false;
  let jsonFlag = false;
  let auditFlag = false;
  let waitFlag = false;
  let messageText = null;
  let connectTimeoutS = null;
  let idleTimeoutS = null;
  let reconnectGraceMs = null;
  let keepOpenFlag = false;
  let logFile = null;
  let tagsFlag = false;
  let helpFlag = false;
  let yesFlag = false;
  let dryRunFlag = false;
  let sheetName = null;
  const addTags = [];
  const annotations = [];
  // Multi-file code walkthrough: every source-code positional is collected
  // into `files`, in command order. `currentFile` is the cursor an annotation
  // binds to, so `file1.py 4:"x" file2.py 13:"y"` ties line 4 to file1 and
  // line 13 to file2. The first code file also fills the single-file `file`
  // slot, so a one-file `sdoc app.py` is unchanged.
  const files = [];
  let currentFile = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // `--help` before a subcommand prints the global help. After a
    // subcommand, it is a flag the subcommand handler reads (library
    // uses this to print its own help).
    if (arg === '--help' || arg === '-h') {
      if (subcommand) helpFlag = true; else subcommand = 'help';
      continue;
    }
    if (arg === '--schema')               { subcommand = 'schema'; continue; }
    if (arg === '--version' || arg === '-v' || arg === '-V') { subcommand = 'version'; continue; }

    if (arg === '--write')   { mode = 'write'; continue; }
    if (arg === '--style')   { mode = 'style'; continue; }
    if (arg === '--raw')     { mode = 'raw';   continue; }
    if (arg === '--read')    { mode = 'read';  continue; }
    if (arg === '--comment') { mode = 'comment'; continue; }
    if (arg === '--light')   { theme = 'light'; continue; }
    if (arg === '--dark')    { theme = 'dark';  continue; }

    if (arg === '--mode' || arg === '-m') {
      mode = args[++i];
      if (!['read', 'write', 'style', 'raw', 'comment'].includes(mode)) {
        console.error(`sdoc: unknown mode "${mode}" — use read, write, style, raw, or comment`);
        process.exit(1);
      }
      continue;
    }

    if (arg === '--url') { url = args[++i]; continue; }
    if (arg === '--section' || arg === '-s') { section = args[++i]; continue; }
    if (arg === '--reset') { resetFlag = true; continue; }
    if (arg === '--short') { shortFlag = true; continue; }
    if (arg === '--json')  { jsonFlag  = true; continue; }
    if (arg === '--audit') { auditFlag = true; continue; }
    if (arg === '--wait')  { waitFlag  = true; continue; }

    // Note: `--mode` already owns `-m` for editor-mode selection, so the
    // bridge message flag is `--message` with no short alias.
    if (arg === '--message')                         { messageText      = args[++i]; continue; }
    if (arg === '--connect-timeout')                 { connectTimeoutS  = Number(args[++i]); continue; }
    if (arg === '--idle-timeout')                    { idleTimeoutS     = Number(args[++i]); continue; }
    if (arg === '--reconnect-grace')                 { reconnectGraceMs = Number(args[++i]); continue; }
    if (arg === '--keep-open')                       { keepOpenFlag     = true; continue; }
    if (arg === '--log-file')                        { logFile          = args[++i]; continue; }
    if (arg === '--tags')                            { tagsFlag         = true; continue; }
    if (arg === '--yes' || arg === '-y')             { yesFlag          = true; continue; }
    if (arg === '--dry-run')                         { dryRunFlag       = true; continue; }
    if (arg === '--sheet')                           { sheetName        = args[++i]; continue; }

    if (!subcommand && SUBCOMMANDS.has(arg)) {
      subcommand = arg;
      continue;
    }

    // Tag arguments anywhere on the command line: collected into
    // addTags, used by the library tap to inject tags into the file's
    // front matter at open time.
    if (TAG_ARG.test(arg)) { addTags.push(arg.slice(1).toLowerCase()); continue; }

    // Agent annotation: `N:"text"` / `N-M:"text"`. Captured before the file /
    // extra slots so a `22:...` token is never mistaken for a path.
    const ann = ANNOTATION_ARG.exec(arg);
    if (ann) {
      const start = parseInt(ann[1], 10);
      const end = ann[2] ? parseInt(ann[2], 10) : start;
      // Strip one layer of surrounding quotes if a shell preserved them.
      const text = ann[3].replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
      if (start >= 1 && end >= start && text.trim()) {
        // `file` binds the annotation to the most-recently-named code file
        // (null if none yet — resolved to the only/first file downstream).
        annotations.push({ line: start, endLine: end, text, file: currentFile });
      }
      continue;
    }

    // A source-code positional (in the default flow, not under a subcommand):
    // collect it as a walkthrough file and move the annotation cursor onto it.
    // Subcommand sub-args (e.g. `slides icons`) are never code files, so they
    // fall through to the file/extra slots below as before.
    if (!subcommand && codeLangs.isCodeFile(arg)) {
      files.push(arg);
      currentFile = arg;
      if (!file) file = arg;
      continue;
    }

    if (!file) { file = arg; continue; }
    // Second positional is captured as `extra` so `sdoc slides icons heart`
    // gets {subcommand: 'slides', file: 'icons', extra: 'heart'}.
    if (extra === null) { extra = arg; continue; }
  }

  return {
    file, extra, mode, url, subcommand, section, theme,
    resetFlag, shortFlag, jsonFlag, auditFlag, waitFlag,
    messageText, connectTimeoutS, idleTimeoutS, reconnectGraceMs,
    keepOpenFlag, logFile,
    tagsFlag, helpFlag, yesFlag, dryRunFlag, sheetName,
    addTags, annotations, files,
  };
}

async function readContent(file) {
  if (file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`sdoc: file not found: ${file}`);
      process.exit(1);
    }
    let raw = fs.readFileSync(resolved, 'utf-8');
    // .csv / .mmd / .mermaid files are wrapped in their fenced block so the
    // renderer picks them up (a standalone .csv opens directly as a sheet).
    // The same transform runs in the bridge for live sessions - if you change
    // one, change the other (both call wrapForDisplay).
    if (isWrappedFile(file)) {
      raw = wrapForDisplay(raw, file);
    } else {
      // Bake any {{path/to/file.csv}} cells references into the doc, resolving
      // paths relative to the markdown file. Self-contained docs share safely.
      raw = transcludeCells(raw, path.dirname(resolved));
    }
    return raw;
  }

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

// Read N source files into one code-walkthrough body: each unique file wrapped
// in a ```<lang> <basename> fence, joined in command order. Returns the body
// plus the de-duplicated basename list (the tab order). Tabs are keyed by
// basename — a file named twice on the command line is one tab; two DIFFERENT
// files sharing a basename is an error rather than a silent merge (and keeps
// the shared front matter to safe basenames, matching the single-file `file:`).
function readCodewalkContent(files) {
  const parts = [];
  const tabs = [];
  const byBase = Object.create(null);
  for (const f of files) {
    const resolved = path.resolve(f);
    const base = path.basename(f);
    if (byBase[base]) {
      if (byBase[base] !== resolved) {
        console.error(`sdoc: a code walkthrough needs distinct file names — two files named "${base}"`);
        process.exit(1);
      }
      continue; // same file referenced again → one tab
    }
    if (!fs.existsSync(resolved)) {
      console.error(`sdoc: file not found: ${f}`);
      process.exit(1);
    }
    byBase[base] = resolved;
    tabs.push(base);
    const raw = fs.readFileSync(resolved, 'utf-8');
    parts.push(codeLangs.wrapCodeFile(raw, f, base));
  }
  return { body: parts.join('\n'), files: tabs };
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin')      execFileSync('open', [url]);
    else if (process.platform === 'win32')  execFileSync('cmd', ['/c', 'start', '', url]);
    else                                    execFileSync('xdg-open', [url]);
  } catch {
    console.log(`Open in browser: ${url}`);
  }
}

module.exports = {
  SUBCOMMANDS,
  parseArgs,
  readContent,
  readCodewalkContent,
  openBrowser,
};
