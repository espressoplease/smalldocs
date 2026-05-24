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

const AGENT_BLOCK_VERSION = 5;
const AGENT_BLOCK_REASON  = 'Two features land together. `sdoc feedback` adds the interactive form DSL (```form blocks; the user clicks a submit, the bridge writes answers into the file and prints one JSON line on stdout). `sdoc slides` + `sdoc present` add the slide DSL (```slide / ~~~slide blocks render inline, present mode runs fullscreen). Three new bullets in alphabetical order: feedback, present, slides.';

const AGENT_BLOCK_BODY = `## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a \`.md\` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The \`sdoc\` CLI is installed globally:
- \`sdoc file.md\` - open styled in browser (great for easy reading).
- \`sdoc share file.md\` - copy shareable URL to clipboard.
- \`sdoc schema\` - how to adjust all stylable properties (fonts, colors, spacing).
- \`sdoc charts\` - read this before writing a \`\`\`chart block. The JSON shape is specific and easy to get wrong from memory.
- \`sdoc diagrams\` - read this before writing a \`\`\`mermaid block. Covers supported diagram types and the security model. Standalone \`.mmd\` / \`.mermaid\` files also work: \`sdoc graph.mmd\`.
- \`sdoc feedback\` - read this before writing a \`\`\`form block. You can ask the user something structured (radio / checkbox / select / text / textarea / number / date), run \`sdoc feedback file.md\`, and a single JSON line lands on stdout when they click a submit button. Defaults to one-button single-shot mode; \`--keep-open\` for multi-click sessions.
- \`sdoc present file.md\` - open file directly in fullscreen presentation mode.
- \`sdoc slides\` - slide DSL reference (grids, shapes, content). Slides render from \`\`\`slide or ~~~slide blocks.
- \`sdoc --help\` - full usage.

When helping the user themselves, prefer \`sdoc file.md\` over \`sdoc share file.md\`. Share is for sending a link to someone else.

Source: https://github.com/espressoplease/SDocs
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
