// Verb handlers wired into the router.
//
// Each handler takes parsed opts and returns a Promise (or void). They
// share `prepareUrl` for the load-content / apply-defaults / build-URL
// flow that `open` and `share` both need.

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SDocYaml = require('../shared/sdocs-yaml.js');

const { DEFAULT_URL } = require('./constants');
const { readContent, openBrowser } = require('./io');
const { loadDefaultStyles, applyDefaultStyles, showDefaults, resetDefaults } = require('./styles');
const { buildUrl } = require('./url');
const { buildShortUrl } = require('./short-link');
const { refreshUpdateCache, maybeUpdateBinary } = require('./update-check');
const { runSetup, maybeAutoRefresh } = require('./setup');
const { runBridgedOpen } = require('./bridge-commands');

// Shared "after the command ran" tail used by `open` and `share`.
async function postCommandHooks() {
  refreshUpdateCache();
  await maybeUpdateBinary();
  await runSetup();
  await maybeAutoRefresh();
}

// Load content (file or stdin), apply ~/.sdocs/styles.yaml defaults, inject
// `file:` into front matter, and build either a hash URL or a short URL.
// Returns { url, contentPresent }.
async function prepareUrl(opts) {
  let content = await readContent(opts.file);
  const defaults = loadDefaultStyles();
  if (content && defaults) {
    content = applyDefaultStyles(content);
  }

  // Inject `file:` into front matter (basename only — safe to share).
  // Respects user-set file: if already present.
  if (content && opts.file) {
    const parsed = SDocYaml.parseFrontMatter(content);
    if (!parsed.meta.file) {
      parsed.meta.file = path.basename(opts.file);
      content = SDocYaml.serializeFrontMatter(parsed.meta) + '\n' + parsed.body;
    }
  }

  // Runtime-only local metadata for the opener's view.
  // `share` omits it so shared URLs never carry paths.
  let local = null;
  if (opts.file && opts.subcommand !== 'share') {
    const abs = path.resolve(opts.file);
    const rel = path.relative(process.cwd(), abs);
    local = { fullPath: abs };
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      local.path = './' + rel;
    }
  }

  let url;
  if (opts.shortFlag) {
    if (opts.subcommand !== 'share') {
      console.error('sdoc: --short is only valid with the `share` subcommand');
      process.exit(1);
    }
    if (!content) {
      console.error('sdoc: --short needs content (a file path or piped stdin)');
      process.exit(1);
    }
    try {
      url = await buildShortUrl(content, {
        url: opts.url,
        mode: opts.mode,
        theme: opts.theme,
        section: opts.section,
      });
    } catch (e) {
      console.error('sdoc: could not create short link -', e.message);
      process.exit(1);
    }
  } else {
    url = buildUrl(content, {
      url: opts.url,
      mode: opts.mode,
      theme: opts.theme,
      defaultStyles: !content ? defaults : null,
      section: opts.section,
      local,
    });
  }

  return { url, contentPresent: !!content };
}

// Default flow: `sdoc <file>` or `sdoc` (no args, or piped stdin).
//
// When the caller passes a real file path on disk, route to the Bridge so the
// browser is connected to the live file (autosave back to disk, external
// changes pushed to the page). For everything else — stdin pipes, no file at
// all — fall back to the URL-encoded snapshot path.
//
// The non-blocking, share-by-URL case is `sdoc share <file>`.
async function openCommand(opts) {
  if (opts.file && fileExistsSync(opts.file)) {
    return runBridgedOpen(opts);
  }
  const { url } = await prepareUrl(opts);
  openBrowser(url);
  console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
  await postCommandHooks();
}

function fileExistsSync(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

async function shareCommand(opts) {
  const { url } = await prepareUrl(opts);
  try {
    const clip = process.platform === 'darwin' ? 'pbcopy'
      : execSync('which xclip 2>/dev/null', { encoding: 'utf-8' }).trim() ? 'xclip -selection clipboard'
      : 'xsel --clipboard --input';
    execSync(clip, { input: url, stdio: ['pipe', 'ignore', 'ignore'] });
    const name = opts.file ? path.basename(opts.file) : 'stdin';
    const label = opts.shortFlag ? 'Short link' : 'Link';
    console.log(`✓ ${label} for ${name} copied to clipboard`);
    if (opts.shortFlag) console.log(`  ${url}`);
  } catch (_) {
    process.stdout.write(url + '\n');
  }
  await postCommandHooks();
}

function defaultsCommand(opts) {
  if (opts.resetFlag) resetDefaults();
  else showDefaults();
}

function newCommand(opts) {
  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const url = baseUrl + '/new';
  openBrowser(url);
  console.log(`SDocs → ${url}`);
}

module.exports = {
  prepareUrl,
  openCommand,
  shareCommand,
  defaultsCommand,
  newCommand,
};
