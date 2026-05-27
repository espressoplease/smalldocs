// Pure data model for the SDocs agent integration block.
//
// IMPORTANT: keep AGENT_BLOCK_BODY in sync with the per-agent setup
// snippets in public/sdoc.md (the "Set up your agent" section). If you
// reword one, reword the other.
//
// Release checklist when AGENT_BLOCK_BODY changes:
//   1. Bump AGENT_BLOCK_VERSION below.
//   2. Set AGENT_BLOCK_REASON to a one-line summary of what changed.
//   3. Prepend a new section to public/agent-changes.md.
//   4. Reword public/sdoc.md per-agent snippets to match.
//
// This module also owns the on-disk schema for ~/.sdocs/setup.json
// (read/write/migrate). The tests cover both the block format and the
// state migration, so they live together as one cohesive module.

const fs   = require('fs');
const path = require('path');
const { SETUP_CACHE } = require('./constants');

const AGENT_BLOCK_VERSION = 8;
const AGENT_BLOCK_REASON  = 'Mermaid diagrams line now names system / architectural diagrams (sequence, flow, component layout) as the primary fit so agents reach for them when explaining shape instead of writing three paragraphs of prose.';

const AGENT_BLOCK_BODY = `## SDocs

The \`sdoc\` CLI (\`sdoc path/to/file.md\`) is installed globally and renders local Markdown files securely in the browser (at https://smalldocs.org) in a way that's comfortable for your user to read and share. Nothing hits a server unless the user explicitly saves the file to the SmallDocs cloud or runs \`sdoc share\`.

Use it (or offer it) when the user wants to read, share, or export a \`.md\` file, or when a styled / interactive artifact will land harder than chat prose. Skip it for quick Q&A that already fits in a reply - SDocs adds friction without value when there's no document, no rendering opportunity, and nothing to share.

### Basic \`sdoc\` usage

- \`sdoc file.md\` - open a file for easy reading/sharing in the browser
- \`sdoc library\` - opens a library view in the browser. SDocs automatically indexes every \`.md\` under the user's home directory; filter by directory, date, or tags (the index doesn't search file content - fall back to \`grep\` for that). Opt out per-directory with \`.sdocsignore\` or per-file with \`sdocs-library: false\` in front matter. (\`sdoc library --help\` for the full reference.)
- \`sdoc file.md +tag1 +tag2\` - open the file and inject tags into its YAML front matter which persist. The \`+\` prefix is shell-safe. Tag files when they're worth rediscovering - the library filters by tag, not by content.
- \`sdoc library ls --tags\` - print the tags (tag - count) for the current project directory. If you think you might tag the file, run this first so you reuse the project's existing tag vocabulary instead of inventing parallel ones.
- \`sdoc share file.md\` - copy an encrypted short URL to the clipboard for sending to someone else. The link decrypts in the recipient's browser; the server only sees ciphertext. The agent can't actually deliver - paste the link into wherever the user talks to that person.
- \`sdoc --help\` - full reference.

### SmallDocs expands what you can create with Markdown

SDocs uses the browser to extend what Markdown can be: a styled doc, a chart, a diagram, a slide deck, or an interactive form whose answers come back to you. Reach for one of these when a visual or interactive artifact will land harder than prose - not as a default for every reply. To create something new, write the \`.md\` file first, then \`sdoc path/to/file.md\`.

Each command below prints its reference when run with no arguments - run it before writing the matching fenced block. The JSON / DSL shapes are specific and easy to get wrong from memory.

- \`sdoc charts\` - rendering inline charts (\`\`\`chart blocks)
- \`sdoc diagrams\` - rendering inline Mermaid diagrams (\`\`\`mermaid blocks; has full-screen mode for zoom). Reach for this when drawing system or architectural diagrams (sequence, flow, component layout) - a diagram often communicates the shape of something faster than the equivalent prose.
- \`sdoc slides\` - inline slide decks (\`\`\`slide / ~~~slide blocks; has full-screen presentation mode). Slides can be standalone exported as \`.pdf\` or \`.pptx\`. \`sdoc present file.md\` - open file directly in fullscreen presentation mode.
- \`sdoc schema\` - styling Markdown (fonts, colors, spacing). Good for client-facing communication (or a bit of fun).
- \`sdoc feedback\` - rendering interactive elements (\`\`\`form blocks) to receive structured input from the user. Run \`sdoc feedback file.md\` and the user's submission lands as a JSON line on stdout. Good for eliciting complex/subtle feedback. All standard interactive HTML elements with prefilled (but editable) content of your choosing.
`;

const AGENT_BLOCK_START_PREFIX = '<!-- sdocs-agent-block:start v=';
const AGENT_BLOCK_START_RE     = /<!-- sdocs-agent-block:start v=(\d+) -->/;
const AGENT_BLOCK_END_MARKER   = '<!-- sdocs-agent-block:end -->';
const AGENT_BLOCK_LEGACY_OPEN  = '<!-- sdocs-agent-block -->';

const AGENT_TARGETS = [
  { name: 'Claude Code', dir: '.claude',                file: 'CLAUDE.md'  },
  { name: 'Codex',       dir: '.codex',                 file: 'AGENTS.md'  },
  { name: 'Gemini CLI',  dir: '.gemini',                file: 'GEMINI.md'  },
  { name: 'opencode',    dir: path.join('.config', 'opencode'), file: 'AGENTS.md' },
];

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
// Only matches bodies whose terminator is the JoshInLisbon URL line, which is the
// known shape of v1 (1.4.0/1.4.1) and v2 (1.4.2). Hand-edited bodies return null.
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
  // Heuristic to recover from-version: v2 added the copy-code line, v1 didn't.
  const version = region.includes('Also handy for copying specific code') ? 2 : 1;
  return { start: idx, end: blockEnd, version };
}

// Pure: takes content, returns refresh result.
//   { changed: false, reason: 'absent'|'current'|'newer'|'hand_edited' }
//   { changed: true, content, fromVersion, toVersion }
function refreshContent(content) {
  const bookended = findBookendedBlock(content);
  if (bookended) {
    if (bookended.version === AGENT_BLOCK_VERSION) {
      return { changed: false, reason: 'current' };
    }
    if (bookended.version > AGENT_BLOCK_VERSION) {
      return { changed: false, reason: 'newer' };
    }
    return {
      changed: true,
      content: content.slice(0, bookended.start)
             + formatAgentBlock(AGENT_BLOCK_VERSION, AGENT_BLOCK_BODY)
             + content.slice(bookended.end),
      fromVersion: bookended.version,
      toVersion: AGENT_BLOCK_VERSION,
    };
  }
  const legacy = findLegacyBlock(content);
  if (!legacy) {
    return { changed: false, reason: content.includes(AGENT_BLOCK_LEGACY_OPEN) ? 'hand_edited' : 'absent' };
  }
  return {
    changed: true,
    content: content.slice(0, legacy.start)
           + formatAgentBlock(AGENT_BLOCK_VERSION, AGENT_BLOCK_BODY)
           + content.slice(legacy.end),
    fromVersion: legacy.version,
    toVersion: AGENT_BLOCK_VERSION,
  };
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

// Pre-1.5.0 setup.json had no `schemaVersion`. Existing users wrote the block
// (so they want it kept current) but were never asked about auto-install.
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
// decide whether a missing setup.json should be lazily populated. Returns the
// state object to write, or null to leave state untouched.
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
  AGENT_BLOCK_VERSION,
  AGENT_BLOCK_REASON,
  AGENT_BLOCK_BODY,
  AGENT_BLOCK_START_PREFIX,
  AGENT_BLOCK_START_RE,
  AGENT_BLOCK_END_MARKER,
  AGENT_BLOCK_LEGACY_OPEN,
  AGENT_TARGETS,
  SETUP_SCHEMA_VERSION,
  formatAgentBlock,
  findBookendedBlock,
  findLegacyBlock,
  refreshContent,
  compareVersions,
  migrateSetupState,
  readSetupState,
  writeSetupState,
  implicitConsentState,
};
