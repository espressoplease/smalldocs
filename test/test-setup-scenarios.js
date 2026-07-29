/**
 * `sdoc setup` / `sdoc refresh` end-to-end scenarios (skill install model).
 *
 * Each scenario sets up a fixture home, runs the real CLI binary
 * against it, and asserts on the resulting filesystem. The harness is
 * fast (sub-second per scenario).
 *
 * The model under test: one canonical SKILL.md at ~/.agents/skills/smalldocs,
 * symlinked into each detected non-universal agent's skills dir, with legacy
 * always-on blocks stripped from the historical config files.
 *
 * Scenarios:
 *   - fresh install, no agent configs present (canonical still written)
 *   - fresh install, Claude detected (canonical + symlink)
 *   - re-run on an already-current install (no-op)
 *   - refresh strips an old (v6) bookended block + writes the skill
 *   - refresh strips a legacy open-marker block
 *   - refresh leaves a hand-edited legacy block alone
 *   - setup --yes upgrades a stale canonical skill
 *   - existing user content preserved when a block is stripped
 *   - multi-agent: symlinks for non-universal agents; opencode covered by canonical
 *   - dry-run prints paths and writes nothing
 */

const path = require('path');
const cli  = require(path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js'));
const { hasSetupEvidence } = require(path.join(__dirname, '..', 'cli', 'lib', 'agent-files'));
const { createFixture } = require('./cli-harness');

// Canonical skill paths inside a fixture home.
const skillRel = '.agents/skills/smalldocs/SKILL.md';
const skillDirRel = '.agents/skills/smalldocs';

module.exports = function (harness) {
  const { assert, testAsync } = harness;

  const scenarios = [];
  const scenario = (name, fn) => scenarios.push([name, fn]);

  // ── 1. Fresh install, no agent configs detected ───────────
  // The canonical skill is always written (it is the single source of truth
  // and any ~/.agents/skills reader picks it up), so declined stays false.
  scenario('fresh / no agent configs → setup --yes writes canonical skill', async () => {
    const fx = createFixture({});
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stdout=${r.stdout})`);
      const skill = fx.read(skillRel);
      assert.ok(skill, 'canonical SKILL.md should exist');
      assert.ok(skill.includes(`<!-- sdocs-skill: v=${cli.SKILL_VERSION} -->`), 'skill at current version');
      const state = fx.readSetupState();
      assert.ok(state, 'setup.json should exist');
      assert.strictEqual(state.declined, false, 'declined false (canonical written)');
      assert.ok(state.writtenTo.length >= 1, 'writtenTo records the skill');
    } finally { fx.cleanup(); }
  });

  // ── 2. Fresh install, Claude detected ─────────────────────
  // Canonical skill + a symlink at ~/.claude/skills/smalldocs -> canonical.
  scenario('fresh / Claude detected → setup --yes writes skill + symlinks claude', async () => {
    const fx = createFixture({ agents: ['claude'] });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);

      const skill = fx.read(skillRel);
      assert.ok(skill, 'canonical SKILL.md should exist');
      assert.ok(skill.includes(`<!-- sdocs-skill: v=${cli.SKILL_VERSION} -->`), 'current version');

      // Claude is non-universal -> a symlink into its skills dir.
      const link = fx.readlink('.claude/skills/smalldocs');
      assert.ok(link, 'claude skills symlink should exist');
      const resolved = path.resolve(path.join(fx.home, '.claude/skills'), link);
      assert.strictEqual(resolved, path.join(fx.home, skillDirRel), 'symlink resolves to canonical dir');

      const state = fx.readSetupState();
      assert.strictEqual(state.declined, false);
    } finally { fx.cleanup(); }
  });

  // ── 3. Already current → no-op ────────────────────────────
  // Canonical at current version + correct symlink. Re-run changes nothing.
  scenario('already current → setup --yes is a no-op', async () => {
    const fx = createFixture({ agents: ['claude'] });
    try {
      await fx.run('setup --yes');
      const skillBefore = fx.read(skillRel);
      const linkBefore = fx.readlink('.claude/skills/smalldocs');

      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0);
      assert.strictEqual(fx.read(skillRel), skillBefore, 'skill unchanged');
      assert.strictEqual(fx.readlink('.claude/skills/smalldocs'), linkBefore, 'symlink unchanged');
    } finally { fx.cleanup(); }
  });

  // ── 4. Upgrade / old block stripped on refresh ────────────
  // A historical v6 bookended block in CLAUDE.md is removed; the skill is
  // written. Surrounding text is preserved.
  scenario('refresh / old v6 block → stripped, skill written, text preserved', async () => {
    const fx = createFixture({
      agents: ['claude'],
      existingBlock: { in: 'claude', version: 6 },
    });
    try {
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);

      const content = fx.readAgent('claude');
      assert.ok(content != null, 'CLAUDE.md still exists');
      assert.ok(!content.includes('sdocs-agent-block'), 'no agent-block markers remain');
      assert.ok(!content.includes('Source: https://github.com/JoshInLisbon'), 'legacy terminator gone');

      const skill = fx.read(skillRel);
      assert.ok(skill, 'canonical skill written');
      assert.ok(skill.includes(`<!-- sdocs-skill: v=${cli.SKILL_VERSION} -->`), 'skill at current version');
    } finally { fx.cleanup(); }
  });

  // ── 5. Legacy open-marker block stripped ──────────────────
  scenario('refresh / legacy open-marker v2 block → stripped', async () => {
    const fx = createFixture({
      agents: ['claude'],
      legacyBlock: { in: 'claude', version: 2 },
    });
    try {
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(!/(^|\n)<!-- sdocs-agent-block -->\n/.test(content), 'standalone legacy marker removed');
      assert.ok(fx.read(skillRel), 'canonical skill written');
    } finally { fx.cleanup(); }
  });

  // ── 6. Hand-edited legacy block left alone ────────────────
  scenario('refresh / hand-edited legacy block → left untouched', async () => {
    const fx = createFixture({
      agents: ['claude'],
      fileSeed: {
        claude: '# my notes\n\n<!-- sdocs-agent-block -->\n## SDocs (hand edited)\n\nLocal notes that were never written by sdoc.\n',
      },
    });
    try {
      const before = fx.readAgent('claude');
      const r = await fx.run('refresh');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      assert.strictEqual(fx.readAgent('claude'), before, 'hand-edited file unchanged');
      assert.ok(
        /hand[-_ ]edited|local edits|left untouched/i.test(r.stdout + r.stderr),
        `expected hand-edited hint, got:\n${r.stdout}\n${r.stderr}`,
      );
    } finally { fx.cleanup(); }
  });

  // ── 7. Stale canonical upgraded by setup --yes ────────────
  scenario('setup --yes / stale canonical skill → upgraded to current', async () => {
    const fx = createFixture({ agents: ['claude'] });
    try {
      // Seed a stale canonical skill at an older version.
      const stale = cli.formatSkill(cli.SKILL_VERSION - 5).replace(
        `v=${cli.SKILL_VERSION - 5}`, `v=${cli.SKILL_VERSION - 5}`,
      );
      const staleFile = require('path').join(fx.home, skillRel);
      require('fs').mkdirSync(require('path').dirname(staleFile), { recursive: true });
      require('fs').writeFileSync(staleFile, stale);

      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const skill = fx.read(skillRel);
      assert.ok(skill.includes(`<!-- sdocs-skill: v=${cli.SKILL_VERSION} -->`), 'upgraded to current version');
    } finally { fx.cleanup(); }
  });

  // ── 8. User content preserved when stripping a block ──────
  scenario('setup --yes / user content preserved when block stripped', async () => {
    const userContent = '# My personal instructions\n\nAlways write tests first.\nNever use em dashes.\n\n## Project conventions\n\nUse TypeScript strict mode.\n';
    const fx = createFixture({
      agents: ['claude'],
      fileSeed: { claude: userContent },
      existingBlock: { in: 'claude', version: 8 },
    });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      const content = fx.readAgent('claude');
      assert.ok(content.startsWith(userContent), 'user content preserved at top of file');
      assert.ok(!content.includes('sdocs-agent-block'), 'block removed');
    } finally { fx.cleanup(); }
  });

  // ── 9. Multi-agent: non-universal symlinked, opencode canonical-only ─
  scenario('multi-agent / claude + pi + codewhale + opencode → correct links', async () => {
    const fx = createFixture({ agents: ['claude', 'pi', 'codewhale', 'opencode'] });
    try {
      const r = await fx.run('setup --yes');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);
      assert.ok(fx.read(skillRel), 'canonical skill written');

      // Non-universal agents: each gets a symlink into its skills dir.
      for (const rel of ['.claude/skills/smalldocs', '.pi/agent/skills/smalldocs', '.codewhale/skills/smalldocs']) {
        const link = fx.readlink(rel);
        assert.ok(link, `${rel} symlink should exist`);
        const resolved = path.resolve(path.join(fx.home, path.dirname(rel)), link);
        assert.strictEqual(resolved, path.join(fx.home, skillDirRel), `${rel} -> canonical`);
      }

      // opencode is universal: the canonical copy already covers it, so NO
      // extra symlink under ~/.config/opencode/skills (avoids double-listing).
      assert.strictEqual(fx.readlink('.config/opencode/skills/smalldocs'), null, 'opencode covered by canonical, no symlink');
    } finally { fx.cleanup(); }
  });

  // ── 10. Dry-run preview ───────────────────────────────────
  scenario('dry-run / prints paths, writes nothing, no state', async () => {
    const fx = createFixture({ agents: ['claude', 'codex'] });
    try {
      const r = await fx.run('setup --yes --dry-run');
      assert.strictEqual(r.exitCode, 0, `exit code (stderr=${r.stderr})`);

      // Nothing written.
      assert.strictEqual(fx.read(skillRel), null, 'canonical skill not written (dry-run)');
      assert.strictEqual(fx.readlink('.claude/skills/smalldocs'), null, 'no symlink created (dry-run)');
      assert.strictEqual(fx.readSetupState(), null, 'no setup.json created (dry-run)');

      // Output names the canonical path and a symlink target.
      assert.ok(r.stdout.includes(skillRel), 'stdout mentions canonical skill path');
      assert.ok(r.stdout.includes('.claude/skills/smalldocs'), 'stdout mentions claude symlink path');
    } finally { fx.cleanup(); }
  });

  // ── 11. Auto-refresh consent gate ─────────────────────────
  // A brand-new user (no skill, no legacy block, no setup.json) must NOT be
  // auto-installed by the post-command auto-refresh. hasSetupEvidence is the
  // predicate that gates maybeAutoRefresh; it must be false on a fresh home
  // and true once there is prior evidence.
  scenario('auto-refresh gate / fresh user has no setup evidence (no implicit install)', () => {
    const fx = createFixture({ agents: ['claude'] });
    try {
      // Fresh: no skill, no block -> no evidence.
      assert.strictEqual(hasSetupEvidence(fx.home, {}), false, 'fresh user has no setup evidence');

      // After explicit setup, the skill exists -> evidence present.
      fx.write('.agents/skills/smalldocs/SKILL.md', cli.formatSkill(cli.SKILL_VERSION));
      assert.strictEqual(hasSetupEvidence(fx.home, {}), true, 'skill on disk counts as evidence');
    } finally { fx.cleanup(); }
  });

  scenario('auto-refresh gate / legacy block counts as evidence', () => {
    const fx = createFixture({
      agents: ['claude'],
      existingBlock: { in: 'claude', version: 6 },
    });
    try {
      // A recognised block in a historical config file is prior consent.
      assert.strictEqual(hasSetupEvidence(fx.home, {}), true, 'legacy block counts as evidence');
    } finally { fx.cleanup(); }
  });

  return async function runSetupScenarios() {
    console.log('\n── CLI Setup Scenarios ────────────────────────\n');
    for (const [name, fn] of scenarios) {
      await testAsync(name, fn);
    }
  };
};
