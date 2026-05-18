/**
 * Agent block bookend marker + migration tests.
 *
 * Covers the pure functions in bin/sdocs-dev.js that drive `sdoc setup`
 * and the auto-refresh on version bumps. File I/O (atomicWrite, lock,
 * symlink refusal) is exercised end-to-end in test-cli-integration if
 * we ever want it; here we pin the logic that decides what to write.
 */

const path = require('path');
const cli  = require(path.join(__dirname, '..', 'bin', 'sdocs-dev.js'));

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Agent Block Tests ──────────────────────────\n');

  // ── formatAgentBlock + findBookendedBlock round-trip ──

  test('formatAgentBlock wraps body with start v=N marker and end marker', () => {
    const out = cli.formatAgentBlock(3, '## SDocs\nbody\n');
    assert.ok(out.startsWith('<!-- sdocs-agent-block:start v=3 -->\n'),
              'starts with versioned start marker');
    assert.ok(out.endsWith('<!-- sdocs-agent-block:end -->\n'),
              'ends with end marker + newline');
  });

  test('findBookendedBlock recovers what formatAgentBlock wrote', () => {
    const block = cli.formatAgentBlock(7, 'foo\n');
    const found = cli.findBookendedBlock('# header\n\n' + block + 'after\n');
    assert.ok(found, 'should locate the block');
    assert.strictEqual(found.version, 7);
    assert.ok(found.body.includes('foo'));
  });

  test('findBookendedBlock returns null on file with no block', () => {
    assert.strictEqual(cli.findBookendedBlock('# just markdown\n\nno block here'), null);
  });

  test('findBookendedBlock bails on multiple start markers (ambiguous)', () => {
    const dup = cli.formatAgentBlock(3, 'a') + '\n' + cli.formatAgentBlock(3, 'b');
    assert.strictEqual(cli.findBookendedBlock(dup), null);
  });

  // ── findLegacyBlock ──

  const LEGACY_V1 = '<!-- sdocs-agent-block -->\n## SDocs\n\nSome body without copy-code line.\n\nSource: https://github.com/JoshInLisbon/SDocs\n';
  const LEGACY_V2 = '<!-- sdocs-agent-block -->\n## SDocs\n\nFoo\nAlso handy for copying specific code thing.\n\nSource: https://github.com/JoshInLisbon/SDocs\n';

  test('findLegacyBlock matches v1 body and reports version=1', () => {
    const found = cli.findLegacyBlock('# user\n\n' + LEGACY_V1 + 'tail\n');
    assert.ok(found);
    assert.strictEqual(found.version, 1);
  });

  test('findLegacyBlock matches v2 body and reports version=2', () => {
    const found = cli.findLegacyBlock('# user\n\n' + LEGACY_V2 + 'tail\n');
    assert.ok(found);
    assert.strictEqual(found.version, 2);
  });

  test('findLegacyBlock returns null when JoshInLisbon terminator is missing (hand-edited)', () => {
    const handEdited = '<!-- sdocs-agent-block -->\n## SDocs\n\nUser changed everything\nSource: https://github.com/somewhere-else\n';
    assert.strictEqual(cli.findLegacyBlock(handEdited), null);
  });

  test('findLegacyBlock bails on duplicate legacy markers', () => {
    const dup = LEGACY_V1 + LEGACY_V1;
    assert.strictEqual(cli.findLegacyBlock(dup), null);
  });

  // ── refreshContent ──

  test('refreshContent: no block returns absent', () => {
    const r = cli.refreshContent('# readme\n\nstuff\n');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'absent');
  });

  test('refreshContent: current bookended block is no-op', () => {
    const block = cli.formatAgentBlock(cli.AGENT_BLOCK_VERSION, cli.AGENT_BLOCK_BODY);
    const r = cli.refreshContent('prefix\n' + block + 'suffix\n');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'current');
  });

  test('refreshContent: older bookended version is rewritten to current', () => {
    const stale = cli.formatAgentBlock(cli.AGENT_BLOCK_VERSION - 1, 'old body\n');
    const r = cli.refreshContent('prefix\n' + stale + 'suffix\n');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.fromVersion, cli.AGENT_BLOCK_VERSION - 1);
    assert.strictEqual(r.toVersion, cli.AGENT_BLOCK_VERSION);
    assert.ok(r.content.includes(cli.AGENT_BLOCK_BODY.split('\n')[0]),
              'new content should contain new body heading');
    assert.ok(r.content.startsWith('prefix\n'), 'prefix preserved');
    assert.ok(r.content.endsWith('suffix\n'), 'suffix preserved');
  });

  test('refreshContent: newer bookended version is left alone (downgrade guard)', () => {
    const future = cli.formatAgentBlock(cli.AGENT_BLOCK_VERSION + 5, 'tomorrow body\n');
    const r = cli.refreshContent('prefix\n' + future + 'suffix\n');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'newer');
  });

  test('refreshContent: legacy v1 is migrated, fromVersion=1', () => {
    const r = cli.refreshContent('# user prefix\n\n' + LEGACY_V1 + 'user suffix\n');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.fromVersion, 1);
    assert.strictEqual(r.toVersion, cli.AGENT_BLOCK_VERSION);
    assert.ok(r.content.startsWith('# user prefix\n\n'));
    assert.ok(r.content.endsWith('user suffix\n'));
    assert.ok(r.content.includes('<!-- sdocs-agent-block:start v=' + cli.AGENT_BLOCK_VERSION + ' -->'));
    assert.ok(r.content.includes('<!-- sdocs-agent-block:end -->'));
  });

  test('refreshContent: legacy v2 is migrated, fromVersion=2', () => {
    const r = cli.refreshContent(LEGACY_V2);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.fromVersion, 2);
  });

  test('refreshContent: hand-edited legacy body returns hand_edited (no overwrite)', () => {
    // Open marker present but no JoshInLisbon terminator -> findLegacyBlock returns null,
    // refreshContent flags it for the user to resolve.
    const handEdited = '<!-- sdocs-agent-block -->\n## My fork\n\nWhatever I edited\n';
    const r = cli.refreshContent(handEdited);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'hand_edited');
  });

  test('refreshContent: surrounding text byte-preserved across migration', () => {
    const before = '# Top\n\nfirst para\n\n## Other section\n\nmiddle\n\n';
    const after  = '\n\n## Tail\n\nstuff after\n';
    const r = cli.refreshContent(before + LEGACY_V2 + after);
    assert.ok(r.changed);
    assert.ok(r.content.startsWith(before), 'leading text preserved exactly');
    assert.ok(r.content.endsWith(after), 'trailing text preserved exactly');
  });

  // ── compareVersions ──

  test('compareVersions: greater', () => assert.strictEqual(cli.compareVersions('1.6.0', '1.5.0'), 1));
  test('compareVersions: equal',   () => assert.strictEqual(cli.compareVersions('1.5.0', '1.5.0'), 0));
  test('compareVersions: less',    () => assert.strictEqual(cli.compareVersions('1.5.0', '1.6.0'), -1));
  test('compareVersions: handles null current as 0.0.0', () => {
    assert.strictEqual(cli.compareVersions('1.5.0', null), 1);
  });
  test('compareVersions: handles malformed strings', () => {
    // garbage in -> 0.0.0; "1.5.0" still wins
    assert.strictEqual(cli.compareVersions('1.5.0', 'oops'), 1);
  });

  // ── migrateSetupState ──

  test('migrateSetupState: pre-1.5.0 state migrates with sensible defaults', () => {
    const old = {
      setupCompleted: '2026-04-14T11:05:24.051Z',
      writtenTo: ['/Users/x/.claude/CLAUDE.md'],
      declined: false,
    };
    const m = cli.migrateSetupState(old);
    assert.ok(m, 'should return a migrated object');
    assert.strictEqual(m.schemaVersion, 1);
    assert.strictEqual(m.autoRefreshAgentFiles, true,  'declined=false -> autoRefresh on');
    assert.strictEqual(m.autoInstallUpdates,    false, 'never asked -> default off');
    assert.strictEqual(m.lastRunVersion, null);
    assert.deepStrictEqual(m.writtenTo, ['/Users/x/.claude/CLAUDE.md']);
  });

  test('migrateSetupState: declined=true -> autoRefresh off', () => {
    const old = { setupCompleted: 'x', writtenTo: [], declined: true };
    const m = cli.migrateSetupState(old);
    assert.strictEqual(m.autoRefreshAgentFiles, false);
  });

  test('migrateSetupState: future schemaVersion returns null (re-consent)', () => {
    const future = { schemaVersion: 99, setupCompleted: 'x' };
    assert.strictEqual(cli.migrateSetupState(future), null);
  });

  test('migrateSetupState: junk input returns null', () => {
    assert.strictEqual(cli.migrateSetupState(null), null);
    assert.strictEqual(cli.migrateSetupState('not an object'), null);
    assert.strictEqual(cli.migrateSetupState({}), null);
  });

  // ── implicitConsentState ──
  // Covers the pre-1.5.0 migration path: users who have a block in CLAUDE.md
  // but no setup.json. `maybeAutoRefresh` calls this to decide whether to
  // lazily write a state file so future upgrades flow through the normal
  // auto-refresh path.

  const fixedNow = new Date('2026-05-12T12:00:00.000Z');

  test('implicitConsentState: a changed file produces a write-eligible state', () => {
    const results = [
      { path: '/Users/x/.claude/CLAUDE.md', changed: true, fromVersion: 1, toVersion: 4 },
      { path: '/Users/x/.codex/AGENTS.md', changed: false, reason: 'absent' },
    ];
    const s = cli.implicitConsentState(results, '1.6.0', fixedNow);
    assert.ok(s, 'should return a state object');
    assert.strictEqual(s.autoRefreshAgentFiles, true, 'auto-refresh on by default');
    assert.strictEqual(s.autoInstallUpdates, false, 'never silently enable auto-install');
    assert.strictEqual(s.declined, false);
    assert.strictEqual(s.lastRunVersion, '1.6.0');
    assert.deepStrictEqual(s.writtenTo, ['/Users/x/.claude/CLAUDE.md']);
    assert.strictEqual(s.setupCompleted, fixedNow.toISOString());
  });

  test('implicitConsentState: no changed files returns null (no state written)', () => {
    // User has no SDocs block anywhere - leave state untouched so they get the
    // normal interactive setup flow next time they're on a TTY.
    const results = [
      { path: '/Users/x/.claude/CLAUDE.md', changed: false, reason: 'absent' },
      { path: '/Users/x/.codex/AGENTS.md', changed: false, reason: 'absent' },
    ];
    assert.strictEqual(cli.implicitConsentState(results, '1.6.0', fixedNow), null);
  });

  test('implicitConsentState: hand-edited only returns null (do not silently overwrite)', () => {
    const results = [
      { path: '/Users/x/.claude/CLAUDE.md', changed: false, reason: 'hand_edited' },
    ];
    assert.strictEqual(cli.implicitConsentState(results, '1.6.0', fixedNow), null);
  });

  test('implicitConsentState: any error in the batch suppresses state write (retry next run)', () => {
    const results = [
      { path: '/Users/x/.claude/CLAUDE.md', changed: true, fromVersion: 1, toVersion: 4 },
      { path: '/Users/x/.codex/AGENTS.md', changed: false, error: 'EACCES' },
    ];
    assert.strictEqual(cli.implicitConsentState(results, '1.6.0', fixedNow), null);
  });

  test('implicitConsentState: multiple changed files all recorded in writtenTo', () => {
    const results = [
      { path: '/Users/x/.claude/CLAUDE.md', changed: true },
      { path: '/Users/x/.codex/AGENTS.md', changed: true },
    ];
    const s = cli.implicitConsentState(results, '1.6.0', fixedNow);
    assert.deepStrictEqual(s.writtenTo, [
      '/Users/x/.claude/CLAUDE.md',
      '/Users/x/.codex/AGENTS.md',
    ]);
  });
};
