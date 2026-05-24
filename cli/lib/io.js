// CLI I/O helpers: argv parsing, content reading, browser opening.

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SUBCOMMANDS = new Set([
  'new', 'share', 'schema', 'defaults', 'help',
  'charts', 'diagrams', 'comments',
  'setup', 'safe', 'auto-update', 'refresh',
  'feedback',
  'slides', 'present',
]);

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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') { subcommand = 'help'; continue; }
    if (arg === '--schema')               { subcommand = 'schema'; continue; }

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

    if (!subcommand && SUBCOMMANDS.has(arg)) {
      subcommand = arg;
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
    // .mmd / .mermaid files (standalone Mermaid sources) are wrapped in a
    // fenced block so the renderer picks them up. No special CLI path needed.
    if (/\.(mmd|mermaid)$/i.test(file)) {
      raw = '```mermaid\n' + raw.replace(/\s+$/, '') + '\n```\n';
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
  openBrowser,
};
