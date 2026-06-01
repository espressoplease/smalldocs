/**
 * CLI test harness.
 *
 * Spawns the real CLI binary against a temp directory pretending to be
 * $HOME. Lets us materialise any pre-install / post-install state we
 * want and assert on what the CLI did, without touching the user's
 * real ~/.sdocs or ~/.claude/CLAUDE.md.
 *
 * The core trick: every path the CLI reads or writes is derived from
 * os.homedir(), which respects $HOME on macOS/Linux. Set HOME to a temp
 * dir in the spawned process env and the CLI thinks that dir is the
 * world. Wipe the dir afterwards.
 *
 * Usage:
 *   const fx = createFixture({
 *     agents: ['claude'],                        // seed empty CLAUDE.md
 *     existingBlock: { in: 'claude', version: 6 } // optional
 *   });
 *   const r = await fx.run('setup --yes');
 *   const content = fx.readAgent('claude');
 *   const state = fx.readSetupState();
 *   fx.cleanup();
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { spawn } = require('child_process');

const CLI_BIN = path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js');

// Mirror of AGENT_TARGETS in cli/lib/agent-block.js. Kept here so tests
// don't need to require the CLI internals just to know where files go.
const AGENT_TARGET_MAP = {
  claude:   { name: 'Claude Code', dir: '.claude',                              file: 'CLAUDE.md' },
  codex:    { name: 'Codex',       dir: '.codex',                               file: 'AGENTS.md' },
  gemini:   { name: 'Gemini CLI',  dir: '.gemini',                              file: 'GEMINI.md' },
  opencode: { name: 'opencode',    dir: path.join('.config', 'opencode'),       file: 'AGENTS.md' },
};

// Distinct from production AGENT_BLOCK_BODY so "block was rewritten"
// is visible in test assertions: the production body replaces this stub.
const DEFAULT_TEST_BLOCK_BODY = '## SDocs\n\nSeeded test body, version pinned by the fixture.\n';

function formatBookended(version, body = DEFAULT_TEST_BLOCK_BODY) {
  return `<!-- sdocs-agent-block:start v=${version} -->\n${body}<!-- sdocs-agent-block:end -->\n`;
}

// Pre-1.5.0 open-only marker. Only the JoshInLisbon-terminator shape is
// recognised by findLegacyBlock; everything else is treated as hand-edited.
// v2 added the "copy specific code" line; v1 didn't.
function formatLegacy(version) {
  const copyLine = version === 2 ? 'Also handy for copying specific code in a sdoc.\n' : '';
  return `<!-- sdocs-agent-block -->\n## SDocs\n\nLegacy block, version ${version}.\n${copyLine}Source: https://github.com/JoshInLisbon/SDocs\n`;
}

function agentFilePath(home, agent) {
  const target = AGENT_TARGET_MAP[agent];
  if (!target) throw new Error(`cli-harness: unknown agent "${agent}"`);
  return path.join(home, target.dir, target.file);
}

function createFixture(opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdoc-fx-'));

  // Seed agent files. `agents` is the list of agent runtimes that exist
  // (their config dirs are present). `fileSeed[agent]` overrides the
  // initial file contents (defaults to empty file). `existingBlock` or
  // `legacyBlock` append a block at the requested version.
  if (opts.agents) {
    for (const agent of opts.agents) {
      const filePath = agentFilePath(home, agent);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      let content = (opts.fileSeed && Object.prototype.hasOwnProperty.call(opts.fileSeed, agent))
        ? opts.fileSeed[agent]
        : '';
      if (opts.existingBlock && opts.existingBlock.in === agent) {
        content += formatBookended(opts.existingBlock.version, opts.existingBlock.body);
      } else if (opts.legacyBlock && opts.legacyBlock.in === agent) {
        content += formatLegacy(opts.legacyBlock.version);
      }
      fs.writeFileSync(filePath, content);
    }
  }

  // Seed ~/.sdocs/setup.json. Only the keys you pass are written - the
  // schemaVersion field is filled in for you.
  if (opts.setupState) {
    const setupPath = path.join(home, '.sdocs', 'setup.json');
    fs.mkdirSync(path.dirname(setupPath), { recursive: true });
    fs.writeFileSync(setupPath, JSON.stringify({
      schemaVersion: 1,
      ...opts.setupState,
    }, null, 2));
  }

  return {
    home,

    // Spawn the CLI with HOME pointed at the fixture. Returns
    // { stdout, stderr, exitCode }. Times out after 10s by default so a
    // hung interactive prompt doesn't wedge the test runner.
    run(argsString, runOpts = {}) {
      return new Promise((resolve, reject) => {
        const args = argsString.split(/\s+/).filter(Boolean);
        const env = {
          ...process.env,
          HOME: home,
          // Belt and braces: silence anything that would phone the network
          // or pop a real setup prompt if the spawned CLI path tries to.
          SDOCS_NO_UPDATE_CHECK: '1',
          SDOCS_NO_SETUP: '1',
        };
        if (runOpts.allowAutoRefresh !== true) env.SDOCS_NO_REFRESH = '1';
        delete env.CI;
        if (runOpts.env) Object.assign(env, runOpts.env);

        const child = spawn(process.execPath, [CLI_BIN, ...args], { env });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('error', reject);

        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`cli-harness: timeout running "sdoc ${argsString}"`));
        }, runOpts.timeoutMs || 10000);

        child.on('close', code => {
          clearTimeout(timeout);
          resolve({ stdout, stderr, exitCode: code });
        });

        if (runOpts.stdin != null) {
          child.stdin.write(runOpts.stdin);
        }
        child.stdin.end();
      });
    },

    // Read the contents of a seeded (or CLI-modified) agent file.
    // Returns null if the file doesn't exist.
    readAgent(agent) {
      try { return fs.readFileSync(agentFilePath(home, agent), 'utf-8'); }
      catch (_) { return null; }
    },

    // Read the parsed setup.json. Returns null if absent or unparseable.
    readSetupState() {
      try {
        return JSON.parse(fs.readFileSync(path.join(home, '.sdocs', 'setup.json'), 'utf-8'));
      } catch (_) { return null; }
    },

    // Whether a file exists in the fixture home. Path is relative to HOME.
    exists(relPath) {
      return fs.existsSync(path.join(home, relPath));
    },

    cleanup() {
      try { fs.rmSync(home, { recursive: true, force: true }); }
      catch (_) {}
    },
  };
}

module.exports = {
  createFixture,
  AGENT_TARGET_MAP,
  DEFAULT_TEST_BLOCK_BODY,
  formatBookended,
  formatLegacy,
};
