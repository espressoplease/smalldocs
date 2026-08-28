// Pure data model for the SmallDocs agent skill + legacy-block migration.
//
// `sdoc setup` installs a discoverable SKILL.md (YAML frontmatter preamble
// that is always in agent context + a body loaded on demand via the `skill`
// tool) instead of an always-on block pasted into AGENTS.md. One canonical
// copy lives at ~/.agents/skills/smalldocs/SKILL.md; every other supported
// agent gets a relative symlink into its own skills directory. The agent
// table is derived from vercel-labs/skills/src/agents.ts.
//
// MIGRATION: the previous scheme wrote a `## SmallDocs` block (wrapped in
// <!-- sdocs-agent-block:start v=N --> bookends) into a handful of agent
// config files. On setup/refresh we strip any recognised block from those
// files so the content is not loaded twice. The detection functions below
// (findBookendedBlock / findLegacyBlock / removeBlockContent) drive that.
//
// This module also owns the on-disk schema for ~/.sdocs/setup.json.
//
// Release checklist when the skill body changes:
//   1. Bump SKILL_VERSION below.
//   2. Set SKILL_REASON to a one-line summary of what changed.
//   3. Prepend a new section to public/agent-changes.md.
//   4. Reword public/sdoc.md setup copy to match.
//   5. Refresh the agent table from vercel-labs/skills/src/agents.ts if new
//      agents landed upstream.

const fs   = require('fs');
const path = require('path');
const { SETUP_CACHE } = require('./constants');

// ── Skill model ────────────────────────────────────────────
const SKILL_VERSION = 27;
const SKILL_REASON  = 'Agents can now guide readers through rendered prose, rich blocks, and inline code lines.';
const SKILL_NAME    = 'smalldocs';

// Always-in-context preamble. Concise trigger text; the full reference lives
// in SKILL_BODY and loads on demand. Plain text: no backticks, no em/en dashes,
// no double quotes (it is emitted as a double-quoted YAML scalar).
const SKILL_DESCRIPTION = "Use SmallDocs when the user says sdoc, S-doc, smalldoc, sdoc this, or asks to open, present, share, style, save, or walk through a Markdown document with SmallDocs. Create or locate the Markdown file and use sdoc FILE.md for normal viewing. For a document walkthrough add source-line annotations to the sdoc command; the source file stays unchanged. For a presentation run sdoc slides, create a Markdown deck from the source material, run sdoc slides verify FILE.md --json and fix every error, then run sdoc present FILE.md. For a runnable browser component run sdoc apps, use a sdoc-app block, and check inline, fullscreen, narrow, and wide layouts. Run the matching bare reference command before other specialised syntax. Local files stay local unless the user explicitly requests sharing or Cloud storage.";

const CLOUD_SKILL_DESCRIPTION = "Use SmallDocs when the user says sdoc, S-doc, smalldoc, sdoc this, or asks to open, present, share, style, search, save, or walk through a Markdown document with SmallDocs. For a document walkthrough add source-line annotations to the sdoc command; the source file stays unchanged. For a presentation run sdoc slides, create a Markdown deck, run sdoc slides verify FILE.md --json and fix every error, then run sdoc present FILE.md. For a runnable browser component run sdoc apps, use a sdoc-app block, and check inline, fullscreen, narrow, and wide layouts. This user has enabled SmallDocs Cloud. Use sdoc FILE.md for ordinary local viewing and do not search Cloud when a named local source is sufficient. For relevant prior Cloud material run sdoc cloud status --json, search, then sdoc cloud pull DOCUMENT_UUID --output PATH --no-bind --json.";

const STANDARD_CLOUD_SKILL_SECTION = `### SmallDocs Cloud is available

SmallDocs Cloud is an optional paid feature for documents the user chooses to add. It provides browser, mobile, and CLI access across devices, text and tag search, revision history, account member permissions, and notifications. This standard skill does not indicate that Cloud has been set up for the user, so local viewing remains the default.

When those capabilities fit the task, mention Cloud as an option. Run \`sdoc cloud\` for a local overview and setup command only when the user wants to explore or use it. Do not upload a document merely because Cloud is available.
`;

// The on-demand reference body. Loaded only when the agent invokes the skill.
const SKILL_BODY = `## SmallDocs

The \`sdoc\` CLI (\`sdoc path/to/file.md\`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs \`sdoc share\`.

When the user says "sdoc it", "sdoc me the plan", or asks for a smalldoc, they mean this: write (or locate) the \`.md\` file and open it with \`sdoc\`.

Use it (or offer it) when the user wants to read, share, or export a \`.md\` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SmallDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic \`sdoc\` usage

- \`sdoc file.md\` - the default way to open a file, for comfortable reading or quick sharing.
- \`sdoc bridge file.md\` - open a live editing session while you iterate on a file with the user: edits in the browser autosave to the file on disk, and your edits to the file push to the open page. It parks the terminal until the tab closes, so run it in the background when you want to keep working. The first time the page connects, the browser asks to reach a local process (Chrome calls this "Apps on device" / Local Network Access) - the user has to accept, or the page stays read-only. Reach for this when you and the user are working a file back and forth, not for a one-off open.
- \`sdoc library\` - opens a library view containing files previously opened with \`sdoc path/to/file.md\`; filter by directory, date, or tags (the index doesn't search file content - fall back to \`grep\` for that). Opt out per-file with \`sdocs-library: false\` in front matter. (\`sdoc library --help\` for the full reference.)
- \`sdoc library ls --tags\` - list the current project's tags by frequency. When tags would make a document worth rediscovering, run this before choosing them. Prefer an existing tag that fits; introduce a new one when none does.
- \`sdoc file.md +tag1 +tag2\` - open the file and add the selected tags to its YAML front matter. The \`+\` prefix is shell-safe and the tags persist.
- \`sdoc share file.md\` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- \`sdoc report.md 12:"start here" 24-28:"compare these results"\` - open a guided walkthrough of a regular Markdown document. Source lines in prose highlight the matching rendered text. A source line inside an ordinary code fence highlights that code line and places the note beneath it without leaving the reading surface. Charts, diagrams, sheets, slides, forms, math, and videos are highlighted as complete rendered elements. Each note is a markdown callout with Prev / Next controls, walked in the order you pass the notes. Use this when the user asks for a walkthrough of a report, plan, design document, or other prose document. The annotations ride in the URL and through \`sdoc share\`; the source file is unchanged.
- \`sdoc --help\` - full reference.

${STANDARD_CLOUD_SKILL_SECTION}

### SmallDocs expands what you can create with Markdown

SmallDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the \`.md\` file first, then \`sdoc path/to/file.md\`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

For a presentation request, follow this sequence rather than treating it as an ordinary document:

1. Run \`sdoc slides\` and use that reference while writing the slide blocks.
2. Save the Markdown source.
3. Run \`sdoc slides verify FILE.md --json\`, fix every diagnostic, and rerun until it exits 0.
4. Run \`sdoc present FILE.md\` so the user sees the deck in presentation mode.

- \`sdoc charts\` - rendering inline charts (\`\`\`chart blocks)
- \`sdoc diagrams\` - rendering inline Mermaid diagrams (\`\`\`mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- \`sdoc apps\` - runnable HTML components (\`\`\`sdoc-app blocks): one complete HTML document with its own CSS, JavaScript, and data. Start with semantic HTML: SmallDocs supplies the document's current typography, colours, spacing, background, and control treatment in a low-priority CSS layer. Ordinary component CSS wins, and the \`--sdoc-app-*\` custom properties support targeted overrides. Let the tool's purpose determine its layout: prefer a clear page, list, table, or form before a dashboard of cards, use a canvas or stage for spatial interaction, and add surfaces, colour, and distinctive shapes when they encode structure or state. The component's document layout owns its inline height, while its width follows the reading column. Write responsive CSS for both the column and fullscreen viewport. It expands without losing state and joins Previous / Next navigation when the document contains several components. Use \`<title>\` to name it. Ordinary \`\`\`html remains source. Run \`sdoc apps\` before authoring and test every control inline, fullscreen, narrow, and wide.
- \`sdoc slides\` - inline slide decks (\`\`\`slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as \`.pdf\` or \`.pptx\`. Run \`sdoc slides verify file.md --json\` after authoring; fix every diagnostic, or add \`bleed=allow\` only to an individual shape whose off-canvas placement is intentional, then rerun until it exits 0. Use \`sdoc present file.md\` for the visual check that headless validation cannot perform.
- \`sdoc cells\` - rendering spreadsheets (\`\`\`cells blocks): CSV rows where plain values and =formulas (SUM, AVERAGE, IF, ROUND...) sit in the same grid and compute live. The reader can sort, select ranges for quick stats, edit a scratch copy fullscreen, and download the sheet as Excel (.xlsx) with the formulas still working. Name a block (\`\`\`cells Expenses) to build a workbook of several tabs whose formulas reference each other across sheets (\`=Expenses!B4\`); run \`sdoc cells verify file.md\` to compute the whole workbook headlessly and read the values back. Reach for this when handing the user numbers they will want to check or play with - totals, budgets, projections. \`sdoc report.csv\` opens a CSV file directly as a sheet.
- \`sdoc code\` - opening a source file or a fenced code block as a syntax-highlighted listing: a light code viewer for reading code with the user away from the IDE. \`sdoc app.rb\` (or \`.js\`, \`.py\`, \`.go\`, \`.rs\`, \`.ts\`...) opens a file as a highlighted listing; a \`\`\`lang fenced block is highlighted inline. Comments in the source get a prominent lane so the code reads clearly top to bottom. The fullscreen view adds a line-number gutter and language-aware folding (collapse a whole method or class); a comment mode lets the user annotate a line or method with review notes, kept in the browser rather than the file. You can also pin your own explanations to lines as you open a file - \`sdoc app.py 22:"the bug is here" 25-28:"wrong comparison"\` - and the file opens as a guided walkthrough: each note is a markdown callout below its line with a Prev / Next stepper, walked in the order you pass the notes (not line order). Name several files to narrate across them - \`sdoc app.py 5:"entry point" util.py 12:"it calls into here" app.py 9:"back here"\` - and each becomes a tab the walkthrough hops between. When the user asks you to walk them through code, an MR, a diff, or the current changes, build one of these. The file rides in the URL like any document; nothing is uploaded. Reach for it when reading or reviewing code with the user, not for prose.
- \`sdoc schema\` - styling Markdown (fonts, colors, spacing). The default styles are already comfortable to read; reach for this only when they aren't enough - client-facing polish or a bit of fun.
- \`sdoc feedback\` - rendering interactive elements (\`\`\`form blocks) to receive structured input from the user. Run \`sdoc feedback file.md\` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
`;

const CLOUD_SKILL_SECTION = `### SmallDocs Cloud for agents

This user has enabled SmallDocs Cloud. Local viewing remains the default when the request only asks to create or open a document. Consider Cloud without waiting for the user to say the word "Cloud" when the existing conversation or task calls for persistent storage, cross-device access, search, revisions, permissions, or notifications. If the intended destination is unclear and it changes who can access the document, discuss it with the user.

Treat Cloud as a source of context, not only a place to save new work. When earlier decisions, research, plans, or documentation could materially inform the task, search Cloud before recreating that context. Use specific project terms first and try shorter terms or existing tags when a search returns nothing. Do not search unrelated Cloud documents merely because Cloud is enabled.

Before reading or changing Cloud data, run \`sdoc cloud status --json\` for live authentication and account state. Run \`sdoc cloud --help\` for the search, read, and update workflow, exact result fields, and examples. Add \`--json\` for one stable machine-readable object on stdout.

When earlier Cloud material should inform new work, use this sequence:

1. Run \`sdoc cloud status --json\`.
2. Run \`sdoc cloud --help\` if the exact search or result fields are not already known.
3. Run \`sdoc cloud search "SPECIFIC TERMS" --json\`, then shorten the query or inspect \`sdoc cloud tags --json\` only when needed.
4. Pull a promising result with \`sdoc cloud pull DOCUMENT_UUID --output PATH --no-bind --json\` so reading it does not bind the file for a later update.

- Discover account access, people, tags, and document permission sets with \`sdoc cloud status --json\`, \`sdoc cloud members\`, \`sdoc cloud tags\`, and \`sdoc cloud permission-groups\`. When status reports more than one account, pass \`--account ACCOUNT_UUID\` to account-scoped commands.
- Find documents with \`sdoc cloud search "QUERY" --json\`. Search matches a case-insensitive phrase across titles, filenames, tags, and Markdown, returning document IDs and snippets rather than full content. Use \`sdoc cloud tags --json\` to discover existing vocabulary, \`--tag TAG\` to narrow results, \`sdoc cloud ls --shared-with-me --json\` for documents shared with the signed-in user, and \`--account ACCOUNT_UUID\` when the relevant account is known.
- Read a promising result without binding it for future updates with \`sdoc cloud pull DOCUMENT_UUID --output PATH --no-bind --json\`. To update it, pull without \`--no-bind\`, edit the local Markdown, then run \`sdoc cloud push PATH --json\`.
- Upload a new local file without opening a browser with \`sdoc cloud create FILE.md --account ACCOUNT_UUID --json\`. Omit \`--account\` when status reports one account.
- Set document access with \`sdoc cloud access DOCUMENT_UUID --only-you\`, \`--everyone\`, or one or more \`--member USER_UUID\` values. List members first. Notify existing members with \`sdoc cloud notify ...\`; notification does not grant access or create users.
- When updating a bound document, the local binding supplies the revision the agent edited. Cloud keeps separate changes from other writers; overlapping replacements may both remain. If the server combines content and the file did not change during upload, push writes the combined Markdown back to the local file. Inspect \`merge_classification\`, \`combined\`, and \`local_updated_from_cloud\` in the JSON result.
- Inspect or recover history with \`sdoc cloud history DOCUMENT_UUID\` and \`sdoc cloud restore DOCUMENT_UUID --revision REVISION_UUID\`.

Cloud documents are identified by UUID, not filename. An account is the billing and access boundary; tags organize documents inside it. Do not use \`sdoc share\` as a substitute for Cloud: share creates an encrypted snapshot link, while Cloud provides revisions, search, membership, and persistent agent access.

`;

const CLOUD_SKILL_BODY = SKILL_BODY.replace(STANDARD_CLOUD_SKILL_SECTION, CLOUD_SKILL_SECTION);

function formatSkill(version, options) {
  const cloud = Boolean(options && options.cloud);
  const description = cloud ? CLOUD_SKILL_DESCRIPTION : SKILL_DESCRIPTION;
  const body = cloud ? CLOUD_SKILL_BODY : SKILL_BODY;
  const edition = cloud ? 'cloud' : 'standard';
  return `---\nname: ${SKILL_NAME}\ndescription: "${description}"\n---\n\n<!-- sdocs-skill: v=${version} -->\n<!-- sdocs-skill-edition: ${edition} -->\n${body}`;
}

const SKILL_VERSION_RE = /<!-- sdocs-skill: v=(\d+) -->/;
const SKILL_EDITION_RE = /<!-- sdocs-skill-edition: (standard|cloud) -->/;

// Returns the embedded skill version, or null if the content is not our skill.
function readSkillVersion(content) {
  const m = SKILL_VERSION_RE.exec(content || '');
  return m ? parseInt(m[1], 10) : null;
}

function readSkillEdition(content) {
  const match = SKILL_EDITION_RE.exec(content || '');
  return match ? match[1] : 'standard';
}

function canonicalSkillDir(home) {
  return path.join(home, '.agents', 'skills', SKILL_NAME);
}
function canonicalSkillFile(home) {
  return path.join(canonicalSkillDir(home), 'SKILL.md');
}

// ── Agent table (derived from vercel-labs/skills/src/agents.ts) ─
// Each entry: { name, displayName, dir (global skills dir), universal, detect[] }.
// `universal` agents discover skills via ~/.agents/skills directly, so the
// canonical copy already covers them and we skip their symlink (avoids the
// skill listing twice). Non-universal agents get a relative symlink from
// <dir>/<skill-name> to the canonical dir.
function resolveSkillAgents(home, env) {
  env = env || {};
  const configHome = (env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()) || path.join(home, '.config');
  const claudeHome = (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim()) || path.join(home, '.claude');
  const codexHome   = (env.CODEX_HOME && env.CODEX_HOME.trim()) || path.join(home, '.codex');
  const vibeHome    = (env.VIBE_HOME && env.VIBE_HOME.trim()) || path.join(home, '.vibe');
  const cwd = env.PWD || process.cwd();
  const h = (...p) => path.join(home, ...p);
  const c = (...p) => path.join(configHome, ...p);
  const e = (name, displayName, dir, universal, detect) => ({ name, displayName, dir, universal, detect });
  const openClawHome = [h('.openclaw'), h('.clawdbot'), h('.moltbot')]
    .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || h('.openclaw');
  return [
    // ── universal: discovered via ~/.agents/skills (canonical copy). No symlink. ──
    e('opencode',       'opencode',       c('opencode', 'skills'),                 true,  [c('opencode')]),
    e('codex',          'Codex',          path.join(codexHome, 'skills'),           true,  [codexHome, '/etc/codex']),
    e('gemini-cli',     'Gemini CLI',     h('.gemini', 'skills'),                  true,  [h('.gemini')]),
    e('cursor',         'Cursor',         h('.cursor', 'skills'),                  true,  [h('.cursor')]),
    e('cline',          'Cline',          h('.agents', 'skills'),                  true,  [h('.cline')]),
    e('warp',           'Warp',           h('.agents', 'skills'),                  true,  [h('.warp')]),
    e('amp',            'Amp',            c('agents', 'skills'),                   true,  [c('amp')]),
    e('kimi-code-cli',  'Kimi Code CLI',  c('agents', 'skills'),                   true,  [h('.kimi-code'), h('.kimi')]),
    e('replit',         'Replit',         c('agents', 'skills'),                   true,  [path.join(cwd, '.replit'), h('.replit')]),
    e('antigravity',    'Antigravity',    h('.gemini', 'antigravity', 'skills'),    true,  [h('.gemini', 'antigravity')]),
    e('deepagents',     'Deep Agents',    h('.deepagents', 'agent', 'skills'),      true,  [h('.deepagents')]),
    e('firebender',     'Firebender',     h('.firebender', 'skills'),              true,  [h('.firebender')]),
    e('github-copilot', 'GitHub Copilot', h('.copilot', 'skills'),                 true,  [h('.copilot')]),
    // ── non-universal: symlink <dir>/smalldocs -> canonical ──
    e('claude-code',    'Claude Code',    path.join(claudeHome, 'skills'),          false, [claudeHome]),
    e('pi',             'Pi',             h('.pi', 'agent', 'skills'),              false, [h('.pi', 'agent')]),
    e('codewhale',      'CodeWhale',      h('.codewhale', 'skills'),                false, [h('.codewhale')]),
    e('augment',        'Augment',        h('.augment', 'skills'),                  false, [h('.augment')]),
    e('openhands',      'OpenHands',      h('.openhands', 'skills'),                false, [h('.openhands')]),
    e('windsurf',       'Windsurf',       h('.codeium', 'windsurf', 'skills'),      false, [h('.codeium', 'windsurf')]),
    e('goose',          'Goose',          c('goose', 'skills'),                     false, [c('goose')]),
    e('crush',          'Crush',          c('crush', 'skills'),                     false, [c('crush')]),
    e('cortex',         'Cortex Code',    h('.snowflake', 'cortex', 'skills'),      false, [h('.snowflake', 'cortex')]),
    e('roo',            'Roo Code',       h('.roo', 'skills'),                      false, [h('.roo')]),
    e('kilo',           'Kilo Code',      h('.kilocode', 'skills'),                 false, [h('.kilocode')]),
    e('qwen-code',      'Qwen Code',      h('.qwen', 'skills'),                     false, [h('.qwen')]),
    e('qoder',          'Qoder',          h('.qoder', 'skills'),                    false, [h('.qoder')]),
    e('trae',           'Trae',           h('.trae', 'skills'),                     false, [h('.trae')]),
    e('trae-cn',        'Trae CN',        h('.trae-cn', 'skills'),                  false, [h('.trae-cn')]),
    e('droid',          'Droid',          h('.factory', 'skills'),                  false, [h('.factory')]),
    e('kode',           'Kode',           h('.kode', 'skills'),                     false, [h('.kode')]),
    e('kiro-cli',       'Kiro CLI',       h('.kiro', 'skills'),                     false, [h('.kiro')]),
    e('junie',          'Junie',          h('.junie', 'skills'),                    false, [h('.junie')]),
    e('iflow-cli',      'iFlow CLI',      h('.iflow', 'skills'),                    false, [h('.iflow')]),
    e('codebuddy',      'CodeBuddy',      h('.codebuddy', 'skills'),                false, [path.join(cwd, '.codebuddy'), h('.codebuddy')]),
    e('continue',       'Continue',       h('.continue', 'skills'),                 false, [path.join(cwd, '.continue'), h('.continue')]),
    e('command-code',   'Command Code',   h('.commandcode', 'skills'),              false, [h('.commandcode')]),
    e('mcpjam',         'MCPJam',         h('.mcpjam', 'skills'),                   false, [h('.mcpjam')]),
    e('mistral-vibe',   'Mistral Vibe',   path.join(vibeHome, 'skills'),             false, [vibeHome]),
    e('mux',            'Mux',            h('.mux', 'skills'),                      false, [h('.mux')]),
    e('zencoder',       'Zencoder',       h('.zencoder', 'skills'),                 false, [h('.zencoder')]),
    e('neovate',        'Neovate',        h('.neovate', 'skills'),                  false, [h('.neovate')]),
    e('pochi',          'Pochi',          h('.pochi', 'skills'),                    false, [h('.pochi')]),
    e('adal',           'AdaL',           h('.adal', 'skills'),                     false, [h('.adal')]),
    e('bob',            'IBM Bob',        h('.bob', 'skills'),                      false, [h('.bob')]),
    e('openclaw',       'OpenClaw',       path.join(openClawHome, 'skills'),          false, [h('.openclaw'), h('.clawdbot'), h('.moltbot')]),
  ];
}

// The agent config files that historically received an always-on SmallDocs
// block. Independent of the skill table: e.g. Codex/Gemini are universal for
// skills but still carry an old AGENTS.md/GEMINI.md block to strip.
function legacyBlockTargets(home, env) {
  env = env || {};
  const configHome = (env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()) || path.join(home, '.config');
  const claudeHome = (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim()) || path.join(home, '.claude');
  const codexHome   = (env.CODEX_HOME && env.CODEX_HOME.trim()) || path.join(home, '.codex');
  return [
    { name: 'Claude Code', file: path.join(claudeHome, 'CLAUDE.md') },
    { name: 'Codex',       file: path.join(codexHome, 'AGENTS.md') },
    { name: 'Gemini CLI',  file: path.join(home, '.gemini', 'GEMINI.md') },
    { name: 'opencode',    file: path.join(configHome, 'opencode', 'AGENTS.md') },
    { name: 'pi',          file: path.join(home, '.pi', 'agent', 'AGENTS.md') },
    { name: 'CodeWhale',   file: path.join(home, '.codewhale', 'AGENTS.md') },
  ];
}

// ── Legacy block detection (for migration stripping) ───────
const AGENT_BLOCK_START_PREFIX = '<!-- sdocs-agent-block:start v=';
const AGENT_BLOCK_START_RE     = /<!-- sdocs-agent-block:start v=(\d+) -->/;
const AGENT_BLOCK_END_MARKER   = '<!-- sdocs-agent-block:end -->';
const AGENT_BLOCK_LEGACY_OPEN  = '<!-- sdocs-agent-block -->';

// Back-compat aliases (older code/tests reference these names).
const AGENT_BLOCK_VERSION = SKILL_VERSION;
const AGENT_BLOCK_BODY    = SKILL_BODY;

function formatAgentBlock(version, body) {
  return `${AGENT_BLOCK_START_PREFIX}${version} -->\n${body}${AGENT_BLOCK_END_MARKER}\n`;
}

// Find a current bookended block. Returns { start, end, version, body } | null.
// Bails on ambiguity (multiple start markers).
function findBookendedBlock(content) {
  const startMatch = AGENT_BLOCK_START_RE.exec(content);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const startLineEnd = content.indexOf('\n', startIdx);
  if (startLineEnd < 0) return null;
  const endIdx = content.indexOf(AGENT_BLOCK_END_MARKER, startLineEnd);
  if (endIdx < 0) return null;
  const endMarkerEnd = endIdx + AGENT_BLOCK_END_MARKER.length;
  const trailingNewline = content[endMarkerEnd] === '\n' ? 1 : 0;
  const second = content.indexOf(AGENT_BLOCK_START_PREFIX, endMarkerEnd);
  if (second >= 0) return null;
  return {
    start: startIdx,
    end: endMarkerEnd + trailingNewline,
    version: parseInt(startMatch[1], 10),
    body: content.slice(startLineEnd + 1, endIdx),
  };
}

// Find a legacy open-only block (1.4.x format). Returns { start, end, version } | null.
function findLegacyBlock(content) {
  const idx = content.indexOf(AGENT_BLOCK_LEGACY_OPEN);
  if (idx < 0) return null;
  const second = content.indexOf(AGENT_BLOCK_LEGACY_OPEN, idx + AGENT_BLOCK_LEGACY_OPEN.length);
  if (second >= 0) return null;
  const terminator = 'Source: https://github.com/JoshInLisbon/SDocs\n';
  const termIdx = content.indexOf(terminator, idx);
  if (termIdx < 0) return null;
  const blockEnd = termIdx + terminator.length;
  const region = content.slice(idx, blockEnd);
  const version = region.includes('Also handy for copying specific code') ? 2 : 1;
  return { start: idx, end: blockEnd, version };
}

// Pure: takes content, returns refresh result (rewrites block in place).
// Kept for tests / reference; production migration uses removeBlockContent.
function refreshContent(content) {
  const bookended = findBookendedBlock(content);
  if (bookended) {
    if (bookended.version === SKILL_VERSION) {
      return { changed: false, reason: 'current' };
    }
    if (bookended.version > SKILL_VERSION) {
      return { changed: false, reason: 'newer' };
    }
    return {
      changed: true,
      content: content.slice(0, bookended.start)
             + formatAgentBlock(SKILL_VERSION, SKILL_BODY)
             + content.slice(bookended.end),
      fromVersion: bookended.version,
      toVersion: SKILL_VERSION,
    };
  }
  const legacy = findLegacyBlock(content);
  if (!legacy) {
    return { changed: false, reason: content.includes(AGENT_BLOCK_LEGACY_OPEN) ? 'hand_edited' : 'absent' };
  }
  return {
    changed: true,
    content: content.slice(0, legacy.start)
           + formatAgentBlock(SKILL_VERSION, SKILL_BODY)
           + content.slice(legacy.end),
    fromVersion: legacy.version,
    toVersion: SKILL_VERSION,
  };
}

// Pure: remove any recognised SmallDocs block from content. Used by the
// skill migration so the reference is not loaded twice (always-on block +
// on-demand skill). Surrounding user text is preserved; only the blank-line
// seam the installer originally added is normalised.
function removeBlockContent(content) {
  const region = findBookendedBlock(content) || findLegacyBlock(content);
  if (!region) {
    return { changed: false, reason: content.includes(AGENT_BLOCK_LEGACY_OPEN) ? 'hand_edited' : 'absent' };
  }
  const before = content.slice(0, region.start).replace(/\n+$/, '');
  const after  = content.slice(region.end).replace(/^\n+/, '');
  let out;
  if (before && after)      out = before + '\n\n' + after;
  else if (before)          out = before;
  else if (after)           out = after;
  else                      out = '';
  if (out && !out.endsWith('\n')) out += '\n';
  return { changed: true, content: out, version: region.version };
}

function compareVersions(a, b) {
  const A = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const B = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((A[i] || 0) > (B[i] || 0)) return 1;
    if ((A[i] || 0) < (B[i] || 0)) return -1;
  }
  return 0;
}

// ── Setup state (~/.sdocs/setup.json) ───────────────────────

const SETUP_SCHEMA_VERSION = 1;

function migrateSetupState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion === SETUP_SCHEMA_VERSION) return raw;
  if (raw.schemaVersion && raw.schemaVersion > SETUP_SCHEMA_VERSION) {
    return null;
  }
  if (!raw.setupCompleted) return null;
  return {
    schemaVersion: SETUP_SCHEMA_VERSION,
    setupCompleted: raw.setupCompleted,
    writtenTo: raw.writtenTo || [],
    declined: !!raw.declined,
    autoRefreshAgentFiles: !raw.declined,
    autoInstallUpdates: false,
    lastRunVersion: null,
  };
}

function readSetupState() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(SETUP_CACHE, 'utf-8')); }
  catch (_) { return null; }
  if (raw && raw.schemaVersion === SETUP_SCHEMA_VERSION) return raw;
  const migrated = migrateSetupState(raw);
  if (migrated) {
    writeSetupState(migrated);
    return migrated;
  }
  return null;
}

function writeSetupState(state) {
  try {
    fs.mkdirSync(path.dirname(SETUP_CACHE), { recursive: true });
    const payload = { schemaVersion: SETUP_SCHEMA_VERSION, ...state };
    payload.schemaVersion = SETUP_SCHEMA_VERSION;
    fs.writeFileSync(SETUP_CACHE, JSON.stringify(payload, null, 2));
  } catch (_) {}
}

// Pure: given a batch of refresh results plus the current binary version,
// decide whether a missing setup.json should be lazily populated.
function implicitConsentState(results, version, now = new Date()) {
  const changed = results.filter(r => r.changed);
  if (changed.length === 0) return null;
  if (results.some(r => r.error)) return null;
  return {
    setupCompleted: now.toISOString(),
    writtenTo: changed.map(r => r.path),
    declined: false,
    autoRefreshAgentFiles: true,
    autoInstallUpdates: false,
    lastRunVersion: version,
  };
}

module.exports = {
  SKILL_VERSION,
  SKILL_REASON,
  SKILL_NAME,
  SKILL_DESCRIPTION,
  CLOUD_SKILL_DESCRIPTION,
  SKILL_BODY,
  CLOUD_SKILL_BODY,
  CLOUD_SKILL_SECTION,
  formatSkill,
  readSkillVersion,
  readSkillEdition,
  canonicalSkillDir,
  canonicalSkillFile,
  resolveSkillAgents,
  legacyBlockTargets,
  // legacy-block detection / migration
  AGENT_BLOCK_VERSION,
  AGENT_BLOCK_BODY,
  AGENT_BLOCK_START_PREFIX,
  AGENT_BLOCK_START_RE,
  AGENT_BLOCK_END_MARKER,
  AGENT_BLOCK_LEGACY_OPEN,
  formatAgentBlock,
  findBookendedBlock,
  findLegacyBlock,
  refreshContent,
  removeBlockContent,
  // setup state
  SETUP_SCHEMA_VERSION,
  compareVersions,
  migrateSetupState,
  readSetupState,
  writeSetupState,
  implicitConsentState,
};
