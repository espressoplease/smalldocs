#!/usr/bin/env node
/**
 * sdoc CLI - thin entrypoint.
 *
 * All logic lives in ../lib. This file builds the command router,
 * dispatches on parsed argv, and re-exports the public API for the
 * test suite. Adding a new verb is a one-liner registration in
 * `buildRouter()`; the existing handlers don't move.
 *
 * Usage:
 *   sdoc report.md              # open file in browser
 *   sdoc share report.md        # copy shareable link to clipboard
 *   sdoc new                    # blank document in write mode
 *   cat file.md | sdoc          # pipe markdown to browser
 *   sdoc                        # open studio with empty editor
 */

const SDocYaml    = require('../shared/sdocs-yaml.js');
const SDocSlugify = require('../shared/sdocs-slugify.js');

const constants   = require('../lib/constants');
const router      = require('../lib/router');
const url         = require('../lib/url');
const shortLink   = require('../lib/short-link');
const agentBlock  = require('../lib/agent-block');
const agentFiles  = require('../lib/agent-files');
const updateCheck = require('../lib/update-check');
const setup       = require('../lib/setup');
const safe        = require('../lib/safe');
const styles      = require('../lib/styles');
const io          = require('../lib/io');
const helpText    = require('../lib/help-text');
const commands    = require('../lib/commands');
const bridgeCommands = require('../lib/bridge-commands');

// ── Router ────────────────────────────────────────────────
// One place that knows the full set of verbs. New chunks register here.

function buildRouter() {
  const r = new router.CommandRouter();

  // Help-text verbs print and exit.
  r.register('help',     { handler: () => { console.log(helpText.HELP);          process.exit(0); } });
  r.register('schema',   { handler: () => { console.log(helpText.SCHEMA);        process.exit(0); } });
  r.register('charts',   { handler: () => { console.log(helpText.CHARTS_HELP);   process.exit(0); } });
  r.register('diagrams', { handler: () => { console.log(helpText.DIAGRAMS_HELP); process.exit(0); } });
  r.register('comments', { handler: () => { console.log(helpText.COMMENTS_HELP); process.exit(0); } });

  // Setup / refresh / auto-update.
  r.register('setup',       { handler: async () => { await setup.runSetup({ force: true }); process.exit(0); } });
  r.register('refresh',     { handler: async () => { await setup.runRefresh(); process.exit(0); } });
  r.register('auto-update', { handler: (opts) => {
    // Sub-arg lives in opts.file (positional). Accept on/off/empty.
    setup.runAutoUpdateSubcommand((opts.file || '').toLowerCase());
    process.exit(0);
  } });

  // Trust verification (calls process.exit internally with a result code).
  r.register('safe',     { handler: (opts) => safe.runSafe(opts) });

  // Defaults: show / reset.
  r.register('defaults', { handler: (opts) => { commands.defaultsCommand(opts); process.exit(0); } });

  // `sdoc new`: open blank /new editor.
  r.register('new',      { handler: (opts) => { commands.newCommand(opts); process.exit(0); } });

  // `sdoc feedback <file> --message "..."` — agent handoff. Bridge in
  // feedback mode: Done returns 0, close-without-Done returns 2.
  r.register('feedback', { handler: (opts) => bridgeCommands.feedbackCommand(opts) });

  // `sdoc slides` family — reference text + helper subcommands.
  r.register('slides',  { handler: (opts) => { commands.slidesCommand(opts); process.exit(0); } });
  // `sdoc present <file>` — same as the default open flow but enters
  // fullscreen slide view on load.
  r.register('present', { handler: (opts) => commands.presentCommand(opts) });

  // `sdoc share <file>` (URL-only, non-blocking) and the default file-open
  // flow. The default handler starts a Bridge when given a real file path,
  // and falls back to URL-encoded snapshot for stdin / no-file.
  r.register('share',    { handler: (opts) => commands.shareCommand(opts) });
  r.register(null,       { handler: (opts) => commands.openCommand(opts) });

  return r;
}

// ── Main ───────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const opts = io.parseArgs();
    const r = buildRouter();
    await r.dispatch(opts);
  })().catch(e => {
    console.error('sdoc:', e.message);
    process.exit(1);
  });
}

// ── Public API for tests ───────────────────────────────────
// `test/test-cli.js` and `test/test-agent-block.js` import these by name.
// Keep the surface intentional — if a test needs something else, add it
// to its source module's exports and re-export it here, don't reach into
// internal modules from the test directly.

module.exports = {
  // YAML + slugify (passed through from shared modules)
  parseFrontMatter:     SDocYaml.parseFrontMatter,
  serializeFrontMatter: SDocYaml.serializeFrontMatter,
  parseSimpleYaml:      SDocYaml.parseSimpleYaml,
  slugify:              SDocSlugify.slugify,

  // URL building / compression
  toBase64Url:                url.toBase64Url,
  fromBase64Url:              url.fromBase64Url,
  compressToBase64Url:        url.compressToBase64Url,
  decompressFromBase64Url:    url.decompressFromBase64Url,
  buildUrl:                   url.buildUrl,

  // Short links
  compressAndEncrypt: shortLink.compressAndEncrypt,
  uploadShortLink:    shortLink.uploadShortLink,
  buildShortUrl:      shortLink.buildShortUrl,

  // Default styles
  mergeStyles:        styles.mergeStyles,
  applyDefaultStyles: styles.applyDefaultStyles,

  // CLI parsing
  parseArgs: io.parseArgs,

  // Agent block (pure functions and constants)
  AGENT_BLOCK_VERSION:  agentBlock.AGENT_BLOCK_VERSION,
  AGENT_BLOCK_BODY:     agentBlock.AGENT_BLOCK_BODY,
  formatAgentBlock:     agentBlock.formatAgentBlock,
  findBookendedBlock:   agentBlock.findBookendedBlock,
  findLegacyBlock:      agentBlock.findLegacyBlock,
  refreshContent:       agentBlock.refreshContent,
  compareVersions:      agentBlock.compareVersions,
  migrateSetupState:    agentBlock.migrateSetupState,
  implicitConsentState: agentBlock.implicitConsentState,

  // Router (so contract tests can exercise it directly)
  buildRouter,
  CommandRouter: router.CommandRouter,
};
