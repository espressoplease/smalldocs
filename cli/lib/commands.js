// Verb handlers wired into the router.
//
// Each handler takes parsed opts and returns a Promise (or void). They
// share `prepareUrl` for the load-content / apply-defaults / build-URL
// flow that `open` and `share` both need.

const path = require('path');
const { execSync } = require('child_process');

const SDocYaml = require('../shared/sdocs-yaml.js');

const { DEFAULT_URL } = require('./constants');
const { readContent, readCodewalkContent, openBrowser } = require('./io');
const { loadDefaultStyles, applyDefaultStyles, showDefaults, resetDefaults } = require('./styles');
const { buildUrl } = require('./url');
const { buildShortUrl } = require('./short-link');
const { refreshUpdateCache, maybeUpdateBinary } = require('./update-check');
const { runSetup, maybeAutoRefresh } = require('./setup');

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
// Build a hash URL (or short URL for `share --short`) from finished content.
// Shared by the single-file and the code-walkthrough paths so both honour
// `--short`, mode, theme, section, and present identically.
async function finishUrl(opts, content, local, defaults) {
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
      const url = await buildShortUrl(content, {
        url: opts.url, mode: opts.mode, theme: opts.theme, section: opts.section,
      });
      return { url, contentPresent: !!content };
    } catch (e) {
      console.error('sdoc: could not create short link -', e.message);
      process.exit(1);
    }
  }
  const url = buildUrl(content, {
    url: opts.url,
    mode: opts.mode,
    theme: opts.theme,
    defaultStyles: !content ? defaults : null,
    section: opts.section,
    local,
    present: opts.present,
  });
  return { url, contentPresent: !!content };
}

// `sdoc file1.py 4:"..." file2.py 13:"..."` — two or more source files become
// one code-walkthrough document: a tabbed multi-file view whose annotations
// step in command order across the tabs. The browser keys off `codewalk: true`
// in front matter. Front matter carries only basenames, so it is share-safe.
async function prepareCodewalkUrl(opts) {
  const { body, files } = readCodewalkContent(opts.files);

  const meta = { codewalk: true, files };
  const anns = (opts.annotations || []).map((a) => {
    // Bind to the cursor file's basename; fall back to the first tab when an
    // annotation was given before any file (or its file dropped out).
    let base = a.file ? path.basename(a.file) : files[0];
    if (files.indexOf(base) === -1) base = files[0];
    return { file: base, line: a.line, endLine: a.endLine, text: a.text };
  });
  if (anns.length) meta.annotations = anns;

  let content = SDocYaml.serializeFrontMatter(meta) + '\n' + body;
  const defaults = loadDefaultStyles();
  if (defaults) content = applyDefaultStyles(content);

  // local (the edit-this-file affordance) is single-file today; the
  // walkthrough renders entirely from the shared front matter for now.
  return finishUrl(opts, content, null, defaults);
}

async function prepareUrl(opts) {
  // Annotations render as a walkthrough: a tabbed tour for 2+ files, a single-
  // tab stepper for one. A plain `sdoc app.py` with no annotations stays the
  // ordinary single-file view. Walkthrough order is the order the annotations
  // were given on the command line, not their line order.
  const files = opts.files || [];
  const anns = opts.annotations || [];
  if (files.length > 1 || (files.length >= 1 && anns.length > 0)) {
    return prepareCodewalkUrl(opts);
  }

  let content = await readContent(opts.file);
  const defaults = loadDefaultStyles();
  if (content && defaults) {
    content = applyDefaultStyles(content);
  }

  // Inject `file:` into front matter (basename only — safe to share).
  // Respects user-set file: if already present. Agent annotations
  // (`sdoc app.py 22:"..."`) ride here too, in `annotations:`, so they travel
  // with the link and through `sdoc share` (front matter rides in the body,
  // unlike `local` which share strips).
  if (content && opts.file) {
    const parsed = SDocYaml.parseFrontMatter(content);
    let changed = false;
    if (!parsed.meta.file) { parsed.meta.file = path.basename(opts.file); changed = true; }
    if (opts.annotations && opts.annotations.length) {
      // A single file needs no per-annotation `file` binding — drop it so the
      // serialized shape stays {line, endLine, text}. (Multi-file keeps it, in
      // prepareCodewalkUrl.)
      parsed.meta.annotations = opts.annotations.map(({ file, ...rest }) => rest);
      changed = true;
    }
    if (changed) {
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

  return finishUrl(opts, content, local, defaults);
}

// Default flow: `sdoc <file>` or `sdoc` (no args, or piped stdin).
//
// The document travels in the URL hash and renders read-only-by-default in the
// browser; nothing connects back to disk. This is the everywhere-works path -
// no local socket, no browser permission prompt. The live, autosaving session
// (browser <-> file on disk) is opt-in via `sdoc bridge <file>`.
//
// The non-blocking, share-by-URL case is `sdoc share <file>`.
async function openCommand(opts) {
  const { url } = await prepareUrl(opts);
  openBrowser(url);
  console.log(`SDocs → ${url.length > 80 ? url.slice(0, 77) + '...' : url}`);
  await postCommandHooks();
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

// `sdoc color-analysis <file>` — grade every text-on-background pair in the
// document's custom palette against WCAG ratios, for both the light and dark
// themes. Exits 1 if anything is unreadable so an agent (or CI) notices.
async function colorAnalysisCommand(opts) {
  const SDocContrast = require('../shared/sdocs-contrast.js');
  const content = await readContent(opts.file);
  if (!content) {
    console.error('sdoc color-analysis: pass a markdown file (or pipe one in)');
    console.error('  e.g. sdoc color-analysis report.md');
    process.exit(1);
  }
  const meta = SDocYaml.parseFrontMatter(content).meta || {};
  const styles = meta.styles || null;
  const name = opts.file ? path.basename(opts.file) : 'stdin';

  if (!styles || !SDocContrast.hasCustomColors(styles)) {
    console.log(`sdoc color-analysis: ${name}`);
    console.log('  No custom colours set - the built-in palette is contrast-safe in both themes.');
    process.exit(0);
  }

  const a = SDocContrast.analyzeStyles(styles);
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  const minRatio = SDocContrast.MIN_CONTRAST;
  function line(p) {
    const tag = p.ok ? 'ok  ' : 'FAIL';
    const ratio = p.ratio == null ? '   ?  ' : (p.ratio.toFixed(2) + ':1');
    return `  ${tag}  ${pad(p.label, 16)} ${pad(p.fg + ' on ' + p.bg, 22)} ${pad(ratio, 9)} ${p.ok ? '' : '(needs ' + minRatio + ':1)'}`;
  }

  console.log(`sdoc color-analysis: ${name}\n`);
  console.log('LIGHT THEME');
  a.light.forEach(p => console.log(line(p)));
  console.log('\nDARK THEME');
  a.dark.forEach(p => console.log(line(p)));

  console.log('');
  if (a.fails.length === 0) {
    console.log('All text/background pairs meet WCAG AA. ✓');
    process.exit(0);
  }
  console.log(`${a.fails.length} unreadable pair${a.fails.length === 1 ? '' : 's'} (contrast below ${minRatio}:1).`);
  console.log('Fix the flagged colours, or add a `dark:` override so the dark theme has its own readable values.');
  console.log('Reminder: top-level colours are the LIGHT theme; dark mode is auto-derived unless you set `dark:`.');
  process.exit(1);
}

function newCommand(opts) {
  const baseUrl = opts.url || process.env.SDOCS_URL || DEFAULT_URL;
  const url = baseUrl + '/new';
  openBrowser(url);
  console.log(`SDocs → ${url}`);
}

// `sdoc slides` family. Dispatches on the positional after `slides`:
//   sdoc slides                     -> prints SLIDES_HELP
//   sdoc slides list                -> built-in template registry
//   sdoc slides custom-shapes       -> raw-shape reference
//   sdoc slides icons [query]       -> Lucide icon name listing
function slidesCommand(opts) {
  const helpText = require('./help-text');
  const sub = opts.file;
  if (sub === 'list')          { printSlideStdlib();           return; }
  if (sub === 'custom-shapes') { console.log(helpText.SLIDES_CUSTOM_SHAPES_HELP); return; }
  if (sub === 'icons')         { printIconList(opts.extra);    return; }
  console.log(helpText.SLIDES_HELP);
}

// `sdoc present <file>` opens the file straight into fullscreen slide
// view. Delegates to openCommand with `present: true` set so the URL
// gets `&present=0` and the browser auto-enters present mode on load.
function presentCommand(opts) {
  return openCommand(Object.assign({}, opts, { present: true }));
}

function printSlideStdlib() {
  // Require lazily so the browser-side slide stdlib (which uses window
  // globals) is only loaded when this command actually runs.
  const SDocSlideStdlib = require('../../public/sdocs-slide-stdlib.js');
  const names = SDocSlideStdlib.names || Object.keys(SDocSlideStdlib.templates || {});
  const slots = SDocSlideStdlib.slots || {};
  console.log('Built-in slide templates');
  console.log('========================');
  const pad = 22;
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    let label = '@extends ' + n;
    while (label.length < pad) label += ' ';
    const slotList = (slots[n] || []).join(', ');
    console.log(label + ' ' + slotList);
  }
  console.log('');
  console.log('`!` marks a required slot (resolver errors when omitted).');
  console.log('Use a built-in by adding `@extends <name>` to a slide block.');
  console.log('Define a user @template with the same name to override (you\'ll get a warning).');
}

function printIconList(query) {
  let names;
  try {
    // The manifest sits next to this file (via cli/bin/). Require by
    // resolved path so it works whether we're invoked from a globally
    // installed binary or from a checkout.
    names = require('../bin/sdocs-icon-names.js');
  } catch (e) {
    console.error('sdoc: icon names manifest missing (cli/bin/sdocs-icon-names.js).');
    console.error('Run `node scripts/build-icons.js` to generate it.');
    process.exit(1);
  }

  const q = (query || '').toLowerCase().trim();
  const matches = q ? names.filter(n => n.indexOf(q) !== -1) : names;

  if (q && matches.length === 0) {
    console.log('No Lucide icons match "' + query + '".');
    console.log('Browse the full set at https://lucide.dev/icons/ or run `sdoc slides icons` to list everything.');
    return;
  }

  if (q) {
    console.log('Lucide icons matching "' + query + '" (' + matches.length + ' of ' + names.length + ')');
  } else {
    console.log('Lucide icons available to the `icon` shape kind (' + names.length + ' total)');
  }
  console.log('Source: https://lucide.dev/icons/  -  use `name=<icon>` in slides');
  console.log('');

  const longest = matches.reduce((m, n) => n.length > m ? n.length : m, 0);
  const colWidth = longest + 2;
  const cols = 4;
  const rows = Math.ceil(matches.length / cols);
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const idx = c * rows + r;
      if (idx >= matches.length) break;
      let name = matches[idx];
      while (name.length < colWidth) name += ' ';
      line += name;
    }
    console.log(line.replace(/\s+$/, ''));
  }

  if (!q) {
    console.log('');
    console.log('Tip: filter with `sdoc slides icons <substring>` (e.g. `sdoc slides icons cloud`).');
  }
}

module.exports = {
  prepareUrl,
  openCommand,
  shareCommand,
  defaultsCommand,
  colorAnalysisCommand,
  newCommand,
  slidesCommand,
  presentCommand,
};
