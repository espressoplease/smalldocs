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

const { startBridge } = require('../bin/sdocs-bridge');
const { DEFAULT_URL } = require('./constants');
const { openBrowser } = require('./io');

function baseUrlFor(opts) {
  return opts.url || process.env.SDOCS_URL || DEFAULT_URL;
}

function buildBridgeUrl(opts, bridge) {
  const base = baseUrlFor(opts);
  const params = new URLSearchParams();
  params.set('bridge', '127.0.0.1:' + bridge.port);
  params.set('token',  bridge.token);
  if (opts.file) params.set('file', path.basename(opts.file));
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

  const result = await bridge.awaitTerminal();
  process.off('SIGINT',  onSignal);
  process.off('SIGTERM', onSignal);

  if (result.kind === 'no-connect') {
    console.error('sdoc: no browser connected within the connect timeout.');
  } else if (result.kind === 'cancel') {
    console.error('sdoc: cancelled (tab closed without clicking Done).');
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
