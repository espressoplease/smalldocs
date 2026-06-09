// CLI bridge integration. Two entry points:
//
//   - `runBridgedOpen(opts)`  — invoked by the default `sdoc <file>` handler
//     when a file path is present. Starts a bridge in 'open' mode so the
//     browser is connected to the live file on disk. Closing the tab exits 0.
//
//   - `feedbackCommand(opts)` — `sdoc feedback FILE [--message "..."]`.
//     Starts a bridge in 'feedback' mode. The browser shows a Done button and
//     the optional message as a banner above the document. Done exits 0,
//     closing the tab without Done exits 2, no browser within the connect
//     timeout exits 3.
//
// Both go through `runBridge` so the timeout flags, signal handling, and
// terminal-bound await are shared.

'use strict';

const path = require('path');
const fs = require('fs');

const { startBridge } = require('../bin/sdocs-bridge');
const { DEFAULT_URL } = require('./constants');
const { openBrowser } = require('./io');
const { stripAndCompress } = require('./url');

function baseUrlFor(opts) {
  return opts.url || process.env.SDOCS_URL || DEFAULT_URL;
}

// Wrapped files (.csv, .mmd, .mermaid) render a derived view the bridge builds
// on connect, not the raw bytes, so we don't embed a static snapshot for them -
// they keep the pre-existing connect-or-blank behaviour. Everything else gets a
// `md=` snapshot so the page renders read-only before the socket connects and
// falls back to read-only if it never does.
const WRAPPED_EXT = new Set(['.csv', '.mmd', '.mermaid']);

// The compressed `md=` snapshot for the bridged file, or null when we can't /
// shouldn't embed one (wrapped file, unreadable, etc.). Failure is non-fatal:
// without `md=` the page just behaves as it did before this change.
function bridgeSnapshot(file) {
  if (!file) return null;
  if (WRAPPED_EXT.has(path.extname(file).toLowerCase())) return null;
  try {
    return stripAndCompress(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function buildBridgeUrl(opts, bridge) {
  const base = baseUrlFor(opts);
  const params = new URLSearchParams();
  params.set('bridge', '127.0.0.1:' + bridge.port);
  params.set('token',  bridge.token);
  if (opts.file) params.set('file', path.basename(opts.file));
  // Progressive enhancement: embed the document so the page can render it
  // (read-only) before the live socket connects, and fall back to it if the
  // socket never does, instead of showing a blank page.
  const snapshot = bridgeSnapshot(opts.file);
  if (snapshot) params.set('md', snapshot);
  // `sdoc present <file>` triggers fullscreen slide view on load.
  if (opts.present) params.set('present', '0');
  return base + '/#' + params.toString();
}

// Resolve timeout flags into the bridge's millisecond API. Negative or NaN
// inputs throw — better to fail loudly than silently disable a guard.
function timeoutOpts(opts) {
  const out = {};
  if (opts.connectTimeoutS != null) {
    if (!Number.isFinite(opts.connectTimeoutS) || opts.connectTimeoutS < 0) {
      throw new Error('--connect-timeout must be a non-negative number of seconds (0 = wait forever)');
    }
    out.noConnectTimeoutMs = Math.round(opts.connectTimeoutS * 1000);
  }
  if (opts.idleTimeoutS != null) {
    if (!Number.isFinite(opts.idleTimeoutS) || opts.idleTimeoutS < 0) {
      throw new Error('--idle-timeout must be a non-negative number of seconds (0 = off)');
    }
    out.idleTimeoutMs = Math.round(opts.idleTimeoutS * 1000);
  }
  if (opts.reconnectGraceMs != null) {
    if (!Number.isFinite(opts.reconnectGraceMs) || opts.reconnectGraceMs < 0) {
      throw new Error('--reconnect-grace must be a non-negative number of milliseconds');
    }
    out.reconnectGraceMs = opts.reconnectGraceMs;
  }
  return out;
}

async function runBridge(opts, mode, label) {
  if (!opts.file) {
    // `sdoc feedback` (no args) prints the form DSL reference. Other
    // bridge commands still require a file.
    if (mode === 'feedback') {
      const { FORM_DSL_REFERENCE } = require('./constants');
      process.stdout.write(FORM_DSL_REFERENCE);
      process.exit(0);
    }
    console.error('sdoc: ' + (opts.subcommand || 'open') + ' needs a file path');
    process.exit(1);
  }

  let bridge;
  try {
    bridge = await startBridge(Object.assign(
      { files: [opts.file], mode },
      mode === 'feedback' && opts.messageText ? { message: opts.messageText } : {},
      opts.keepOpenFlag ? { keepOpen: true } : {},
      opts.logFile         ? { logFile: opts.logFile } : {},
      timeoutOpts(opts),
    ));
  } catch (e) {
    console.error('sdoc: could not start bridge -', e.message);
    process.exit(1);
  }

  const url = buildBridgeUrl(opts, bridge);
  const onSignal = () => { bridge.close(); };
  process.on('SIGINT',  onSignal);
  process.on('SIGTERM', onSignal);

  openBrowser(url);
  // Startup chatter goes to stderr so stdout stays a clean event
  // channel (one JSON line per submit) in --keep-open mode.
  console.error(`${label} ${path.basename(opts.file)} in browser. Close the tab or press Ctrl-C to stop.`);

  // Loud warning if the parent isn't going to notice the submit. The
  // form's whole protocol assumes the spawning agent waits for this
  // process to exit. If stdout isn't a TTY AND we're in feedback mode,
  // the caller is probably an agent harness - flag the wrong shape
  // (shell `&` fire-and-forget) before the user wastes time filling in
  // a form whose answer no one's listening for.
  if (mode === 'feedback' && !process.stdout.isTTY) {
    console.error(
      'sdoc feedback: stdout is not a TTY. If your agent harness uses\n' +
      '  shell `&` to background this process, the parent will NOT be\n' +
      '  notified when the user submits. Use your harness\'s\n' +
      '  run-in-background primitive instead (e.g. Claude Code\'s Bash\n' +
      '  `run_in_background: true` flag), or run foreground and capture\n' +
      '  stdout directly. See `sdoc feedback` (no args) for details.'
    );
  }

  const result = await bridge.awaitTerminal();
  process.off('SIGINT',  onSignal);
  process.off('SIGTERM', onSignal);

  if (result.kind === 'no-connect') {
    console.error('sdoc: no browser connected within the connect timeout.');
  } else if (result.kind === 'cancel') {
    console.error('sdoc: cancelled (tab closed without clicking Done).');
  } else if (result.kind === 'submit') {
    // Belt-and-braces confirmation on stderr. The submit JSON already
    // went to stdout (clean event channel); this line is for harnesses
    // that merge stderr/stdout to a single log and need a human-
    // readable "yes the submit happened, look in stdout" marker.
    console.error('sdoc feedback: submission received - JSON line on stdout, exiting 0.');
  }
  process.exit(result.code || 0);
}

function runBridgedOpen(opts)   { return runBridge(opts, 'open',     'Open'); }
function feedbackCommand(opts)  { return runBridge(opts, 'feedback', 'Feedback on'); }

module.exports = {
  runBridgedOpen,
  feedbackCommand,
  buildBridgeUrl, // for tests
  timeoutOpts,    // for tests
};
