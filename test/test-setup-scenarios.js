/**
 * `sdoc setup` / `sdoc refresh` end-to-end scenarios.
 *
 * Each scenario sets up a fixture home, runs the real CLI binary
 * against it, and asserts on the resulting filesystem. The harness is
 * fast (sub-second per scenario) because spawned Node processes share
 * the same module cache via the v8 bytecode cache; nothing here pretends
 * to be a unit test.
 *
 * Scenarios cover what was historically painful to verify by hand:
 *   - fresh install, no agent configs present
 *   - fresh install, Claude detected
 *   - re-run on an already-current install (no-op)
 *   - upgrade an old (v6) bookended block to current
 *   - migrate a legacy (open-marker) block
 *   - leave a hand-edited legacy block alone
 *
 * When you change the CLI in a way that touches setup, refresh, the
 * agent-block format, or ~/.sdocs/setup.json schema: rerun
 * `node test/run.js` and add a scenario here if a new state matters.
 */

const path = require('path');
const cli  = require(path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js'));
const { createFixture } = require('./cli-harness');

module.exports = function (harness) {
  const { assert, testAsync } = harness;

  // Queue scenarios up rather than firing them at require time. The
  // orchestrator awaits the returned runner so the report() at the end
  // of test/run.js sees these counted. Tests run sequentially to avoid
  // concurrent mkdtempSync churn and keep failures attributable to one
  // scenario.
  const scenarios = [];
  const scenario = (name, fn) => scenarios.push([name, fn]);

  // ── 1. Fresh install, no agent configs detected ───────
  // Setup --yes records "declined" (we don't guess at opencode for the
  // user) and writes no block anywhere.
  scenario('fresh / no agent configs → setup --yes records declined, no block written', async () => {
    const fx = createFixture({});
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stdout=${r.stdout})`);
      const state = fx.readSetupState();
      assert.ok(state, 'setup.json should exist');
      assert.strictEqual(state.declined, true, 'declined when no agents detected');
      assert.deepStrictEqual(state.writtenTo, [], 'writtenTo is empty');
      assert.strictEqual(state.autoRefreshAgentFiles, false);
      assert.strictEqual(state.autoInstallUpdates, false);
    } finally { fx.cleanup(); }
  });

  // ── 2. Fresh install, Claude detected ─────────────────
  // Setup --yes appends the current-version bookended block.
  scenario('fresh / Claude detected → setup --yes writes bookended block at current version', async () => {
    const fx = createFixture({ agents: ['claude'] });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(content, 'CLAUDE.md should exist');
      assert.ok(
        content.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
        'block at current version present',
      );
      assert.ok(content.includes('<!-- sdocs-agent-block:end -->'), 'end marker present');
      const state = fx.readSetupState();
      assert.strictEqual(state.declined, false);
      assert.strictEqual(state.writtenTo.length, 1, 'wrote one file');
      assert.strictEqual(state.autoRefreshAgentFiles, true);
    } finally { fx.cleanup(); }
  });

  // ── 3. Already current ────────────────────────────────
  // Block at current version + Claude detected. fileHasBlock filters it
  // out of the "to write" list, and setup ends with the "already set up"
  // message. We're checking that we don't end up with two stacked blocks.
  scenario('already current → setup --yes is a no-op (no second block appended)', async () => {
    const fx = createFixture({
      agents: ['claude'],
      existingBlock: { in: 'claude', version: cli.AGENT_BLOCK_VERSION },
    });
    try {
      const before = fx.readAgent('claude');
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0);
      const after = fx.readAgent('claude');
      // Exactly one start marker.
      const starts = (after.match(/<!-- sdocs-agent-block:start/g) || []).length;
      assert.strictEqual(starts, 1, `expected one start marker, got ${starts}`);
      // File is unchanged.
      assert.strictEqual(after, before, 'file content unchanged');
    } finally { fx.cleanup(); }
  });

  // ── 4. Upgrade from old block ─────────────────────────
  // Block at an older version (6) + Claude detected. fileHasBlock returns
  // true for it (it's our shape), so setup --yes skips it. The canonical
  // upgrade path is `sdoc refresh` (or auto-refresh on version bump).
  scenario('upgrade / old v6 block → refresh bumps to current version', async () => {
    const fx = createFixture({
      agents: ['claude'],
      existingBlock: { in: 'claude', version: 6 },
    });
    try {
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(
        content.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
        `block should be at v${cli.AGENT_BLOCK_VERSION}, got: ${content.slice(0, 200)}`,
      );
      // Old version marker gone.
      assert.ok(
        !content.includes('<!-- sdocs-agent-block:start v=6 -->'),
        'old v6 start marker removed',
      );
      // Exactly one block.
      const starts = (content.match(/<!-- sdocs-agent-block:start/g) || []).length;
      assert.strictEqual(starts, 1);
    } finally { fx.cleanup(); }
  });

  // ── 5. Legacy block migration ─────────────────────────
  // Pre-1.5.0 open-only block (no end marker, JoshInLisbon terminator).
  // refresh should rewrite it as a bookended block at current version.
  scenario('legacy migration / open-marker v2 block → refresh rewrites as bookended', async () => {
    const fx = createFixture({
      agents: ['claude'],
      legacyBlock: { in: 'claude', version: 2 },
    });
    try {
      const before = fx.readAgent('claude');
      assert.ok(before.includes('<!-- sdocs-agent-block -->'), 'fixture seeded legacy open marker');
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const after = fx.readAgent('claude');
      // Open-only marker is gone (or part of the new bookend, but the
      // start now carries a version).
      assert.ok(
        after.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
        'now bookended at current version',
      );
      assert.ok(after.includes('<!-- sdocs-agent-block:end -->'), 'has end marker');
      // The bare legacy open marker shouldn't appear anywhere as a
      // standalone line (it'd mean we left the old shape behind).
      assert.ok(
        !/(^|\n)<!-- sdocs-agent-block -->\n/.test(after),
        'standalone legacy marker removed',
      );
    } finally { fx.cleanup(); }
  });

  // ── 6. Hand-edited block left alone ───────────────────
  // A legacy open marker whose body has been hand-edited (no JoshInLisbon
  // terminator) is not migrated. refresh reports it and changes nothing.
  scenario('hand-edited legacy block → refresh leaves it alone', async () => {
    const fx = createFixture({
      agents: ['claude'],
      // No legacyBlock / existingBlock: seed the file content directly.
      fileSeed: {
        claude: '# my notes\n\n<!-- sdocs-agent-block -->\n## SDocs (hand edited)\n\nLocal notes that were never written by sdoc.\n',
      },
    });
    try {
      const before = fx.readAgent('claude');
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const after = fx.readAgent('claude');
      assert.strictEqual(after, before, 'file unchanged');
      // Refresh prints a "local edits detected" hint. We don't pin the
      // exact wording, just that something was said about it.
      assert.ok(
        /hand[-_ ]edited|local edits|run `sdoc setup`/i.test(r.stdout + r.stderr),
        `expected hand-edited hint in output, got:\n${r.stdout}\n${r.stderr}`,
      );
    } finally { fx.cleanup(); }
  });

  // ── 7a. setup --yes upgrades an outdated block ────────
  // The "user re-pastes the install prompt after a sdoc upgrade" path.
  // setup --yes used to silently no-op when fileHasBlock() filtered the
  // file out. Now it calls refreshAllAgentFiles() first, so the block
  // gets bumped to current in one shot.
  scenario('setup --yes / outdated v6 block → upgrades to current', async () => {
    const fx = createFixture({
      agents: ['claude'],
      existingBlock: { in: 'claude', version: 6 },
    });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(
        content.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
        'block at current version present',
      );
      assert.ok(
        !content.includes('<!-- sdocs-agent-block:start v=6 -->'),
        'v6 marker removed',
      );
      const state = fx.readSetupState();
      assert.strictEqual(state.declined, false);
      assert.strictEqual(state.writtenTo.length, 1, 'recorded the refreshed file');
    } finally { fx.cleanup(); }
  });

  // ── 7b. setup --yes preserves existing user content ───
  // CLAUDE.md often has personal notes before any SDocs section. The
  // block must append after the user's content - never stomp it.
  scenario('setup --yes / existing user content → appends without breaking it', async () => {
    const userContent = '# My personal instructions\n\nAlways write tests first.\nNever use em dashes.\n\n## Project conventions\n\nUse TypeScript strict mode.\n';
    const fx = createFixture({
      agents: ['claude'],
      fileSeed: { claude: userContent },
    });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(content.startsWith(userContent), 'user content preserved at top of file');
      assert.ok(
        content.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
        'block appended',
      );
    } finally { fx.cleanup(); }
  });

  // ── 8. Multi-agent fresh install ──────────────────────
  // setup --yes writes the block to every detected agent in one pass.
  // Catches regressions where the loop body bails on the first one.
  scenario('fresh / multiple agents detected → setup --yes writes to all', async () => {
    const fx = createFixture({ agents: ['claude', 'codex', 'gemini'] });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      for (const agent of ['claude', 'codex', 'gemini']) {
        const content = fx.readAgent(agent);
        assert.ok(content, `${agent} file should exist`);
        assert.ok(
          content.includes(`<!-- sdocs-agent-block:start v=${cli.AGENT_BLOCK_VERSION} -->`),
          `${agent} should have current-version block`,
        );
      }
      const state = fx.readSetupState();
      assert.strictEqual(state.writtenTo.length, 3, 'wrote three files');
    } finally { fx.cleanup(); }
  });

  // Return the runner so the orchestrator can await completion before
  // calling report(). Tests run sequentially: each spawns its own CLI
  // child and owns its own temp HOME, but parallelising them muddles
  // failure attribution and saves no real time (each is ~100ms).
  return async function runSetupScenarios() {
    console.log('\n── CLI Setup Scenarios ────────────────────────\n');
    for (const [name, fn] of scenarios) {
      await testAsync(name, fn);
    }
  };
};
