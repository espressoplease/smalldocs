// `sdoc setup`, `sdoc refresh`, `sdoc auto-update`, and the implicit
// post-command refresh that keeps agent files in sync as new sdoc
// versions ship.
//
// runSetup: first-run interactive flow. Detects agent configs, writes
//   the block into the ones the user agrees to.
// runRefresh: unconditional refresh of every agent file that already
//   has a recognised block.
// runAutoUpdateSubcommand: flips state.autoInstallUpdates.
// maybeAutoRefresh: called after every successful command. Quiet, only
//   touches files whose existing block we already manage.

const os = require('os');
const path = require('path');
const readline = require('readline');

const {
  AGENT_BLOCK_VERSION,
  AGENT_BLOCK_BODY,
  compareVersions,
  readSetupState,
  writeSetupState,
  implicitConsentState,
} = require('./agent-block');

const {
  detectAgents,
  fileHasBlock,
  writeBookendedBlock,
  refreshAllAgentFiles,
  printRefreshSummary,
} = require('./agent-files');

const { VERSION, AGENT_CHANGES_URL } = require('./constants');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, a => { rl.close(); resolve(a.trim().toLowerCase()); });
  });
}

async function askAutoInstallConsent() {
  console.log('\nAuto-install sdoc updates when available?');
  console.log('');
  console.log('This runs `npm i -g sdocs-dev@latest` on your behalf when a new');
  console.log('version ships. The output includes a source-diff link so you');
  console.log('(or your agent) can verify what was installed.');
  console.log('');
  console.log('Recommended if you mostly use sdoc through coding agents.');
  console.log('');
  console.log('Change any time with `sdoc auto-update on` / `sdoc auto-update off`.\n');
  const a = await ask('Enable? [Y/n] ');
  return !a || a === 'y' || a === 'yes';
}

async function askAutoRefreshConsent() {
  console.log('\nKeep this block updated on future sdoc upgrades?');
  console.log('');
  console.log('When sdoc adds a feature we sometimes update this section so');
  console.log('your agent learns about it. Each time the block changes we');
  console.log(`print a notice with a link to ${AGENT_CHANGES_URL}`);
  console.log('showing the exact delta - the new wording, and why it changed.');
  console.log('');
  console.log('Re-run `sdoc setup` any time to change this.\n');
  const a = await ask('Enable? [Y/n] ');
  return !a || a === 'y' || a === 'yes';
}

async function runSetup({ force = false } = {}) {
  if (!force) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return;
    if (process.env.CI || process.env.SDOCS_NO_SETUP) return;
    if (readSetupState()) return;
  }

  const detected = detectAgents().filter(t => !fileHasBlock(t.filePath));

  if (detected.length === 0) {
    const opencodeAlreadyDone = fileHasBlock(path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md'));
    if (opencodeAlreadyDone) {
      writeSetupState({
        setupCompleted: new Date().toISOString(),
        writtenTo: [], declined: false,
        autoRefreshAgentFiles: true, autoInstallUpdates: false,
        lastRunVersion: VERSION,
      });
      console.log('\nSDocs is already set up in all detected agent configs. Nothing to do.');
      return;
    }
    console.log('\n✨─────── SDocs setup ───────✨');
    console.log('First run only - wire SDocs into your CLI coding agents.\n');
    console.log('No coding-agent configs detected.');
    const a = await ask('Do you use opencode? [y/N] ');
    const writtenTo = [];
    let autoRefresh = false;
    let autoInstall = false;
    if (a === 'y' || a === 'yes') {
      const target = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
      try { writeBookendedBlock(target); writtenTo.push(target); console.log(`✓ Wrote SDocs section to ${target}`); }
      catch (e) { console.error(`Failed to write ${target}: ${e.message}`); }
      autoRefresh = await askAutoRefreshConsent();
      autoInstall = await askAutoInstallConsent();
      console.log('Done. Run `sdoc setup` any time to revisit.');
    } else {
      console.log('Skipped. Run `sdoc setup` any time to revisit.');
    }
    writeSetupState({
      setupCompleted: new Date().toISOString(),
      writtenTo, declined: writtenTo.length === 0,
      autoRefreshAgentFiles: autoRefresh,
      autoInstallUpdates: autoInstall,
      lastRunVersion: VERSION,
    });
    return;
  }

  console.log('\n✨─────── SDocs setup ───────✨');
  console.log('First run only - wire SDocs into your CLI coding agents.\n');
  console.log('Detected: ' + detected.map(t => t.name).join(', '));
  console.log('\nWill append a short SDocs section to:');
  for (const t of detected) console.log('  ' + t.filePath);
  console.log('\nThese files are loaded into every conversation across all your');
  console.log('projects, so SDocs becomes available no matter where you\'re working.');
  console.log('');
  console.log('You can ask your agent things like:');
  console.log('  "write up the plan and sdoc it to me"');
  console.log('  "explain async/await to me in a sdoc"');
  console.log('  "draft the release notes as a sdoc I can share"');
  console.log('');
  console.log('This is the best way to work with SDocs');
  const RULE = '═'.repeat(36);
  console.log(`\n═══════════ Block to add ═══════════`);
  console.log(AGENT_BLOCK_BODY.trim());
  console.log(RULE);

  const a = await ask('\nAdd to all? [Y/n/skip] ');
  const skipped = a === 'skip' || (a && a !== 'y' && a !== 'yes');
  if (skipped) {
    writeSetupState({
      setupCompleted: new Date().toISOString(),
      writtenTo: [], declined: true,
      autoRefreshAgentFiles: false, autoInstallUpdates: false,
      lastRunVersion: VERSION,
    });
    console.log('Skipped. Run `sdoc setup` any time to revisit.');
    return;
  }

  const writtenTo = [];
  for (const t of detected) {
    try { writeBookendedBlock(t.filePath); writtenTo.push(t.filePath); console.log(`✓ ${t.name}: ${t.filePath}`); }
    catch (e) { console.error(`✗ ${t.name}: ${e.message}`); }
  }

  const autoRefresh = writtenTo.length > 0 ? await askAutoRefreshConsent() : false;
  const autoInstall = writtenTo.length > 0 ? await askAutoInstallConsent() : false;

  writeSetupState({
    setupCompleted: new Date().toISOString(),
    writtenTo, declined: false,
    autoRefreshAgentFiles: autoRefresh,
    autoInstallUpdates: autoInstall,
    lastRunVersion: VERSION,
  });
  console.log('\nDone. Run `sdoc setup` any time to revisit.');
}

// Auto-refresh existing agent files when the binary version is newer than the
// version that last ran. No prompt: the user already consented during setup.
// Bails on downgrades (block version > shipped version), errors, or partial
// failures (lastRunVersion only advances when every changed file succeeded).
async function maybeAutoRefresh() {
  if (process.env.SDOCS_NO_REFRESH) return;
  let state = readSetupState();

  // Implicit-consent migration for users who have a recognised SDocs block in
  // an agent file but no `~/.sdocs/setup.json`. This is the pre-1.5.0 install
  // path. `refreshContent` only signals `changed` for a block whose exact
  // shape we wrote (legacy JoshInLisbon terminator, or our bookend markers);
  // anything else is left untouched, so a user who deleted the block or
  // hand-edited it doesn't get state silently created.
  if (!state) {
    const results = refreshAllAgentFiles();
    const next = implicitConsentState(results, VERSION);
    if (!next) return;
    printRefreshSummary(results);
    writeSetupState(next);
    return;
  }

  if (!state.autoRefreshAgentFiles) return;
  if (compareVersions(VERSION, state.lastRunVersion) <= 0) return;

  const results = refreshAllAgentFiles();
  const anyChanged = results.some(r => r.changed);
  if (anyChanged) printRefreshSummary(results);

  const anyError = results.some(r => r.error);
  if (!anyError) {
    writeSetupState({ ...state, lastRunVersion: VERSION });
  }
}

// `sdoc refresh` — unconditional agent-block refresh. Useful for users whose
// setup.json was never written (pre-1.5.0 installs) or has been deleted, and
// for agents that want to trigger the migration explicitly without going
// through the interactive setup flow.
async function runRefresh() {
  const existing = readSetupState();
  const results = refreshAllAgentFiles();
  const changed = results.filter(r => r.changed);
  const errors  = results.filter(r => r.error);
  const current = results.filter(r => r.reason === 'current');
  const blocksPresent = changed.length + current.length;

  printRefreshSummary(results);

  if (changed.length === 0 && errors.length === 0) {
    if (blocksPresent === 0) {
      console.log('No SDocs blocks found in any agent file. Run `sdoc setup` to add one.');
      return;
    }
    console.log(`All SDocs agent blocks already at v${AGENT_BLOCK_VERSION}.`);
  }

  if (errors.length > 0) return;

  if (blocksPresent === 0 && !existing) return;

  writeSetupState({
    setupCompleted: existing?.setupCompleted || new Date().toISOString(),
    writtenTo: [...changed, ...current].map(r => r.path),
    declined: false,
    autoRefreshAgentFiles: existing ? existing.autoRefreshAgentFiles !== false : true,
    autoInstallUpdates: existing?.autoInstallUpdates ?? false,
    lastRunVersion: VERSION,
  });
}

// `sdoc auto-update on|off|status` — flips state.autoInstallUpdates.
function runAutoUpdateSubcommand(arg) {
  let state = readSetupState();
  if (!state) {
    console.log('Run `sdoc setup` first to configure auto-update.');
    return;
  }
  if (arg === 'on') {
    writeSetupState({ ...state, autoInstallUpdates: true });
    console.log('✓ Auto-install of sdoc updates: on');
    return;
  }
  if (arg === 'off') {
    writeSetupState({ ...state, autoInstallUpdates: false });
    console.log('✓ Auto-install of sdoc updates: off');
    return;
  }
  console.log(`Auto-install of sdoc updates: ${state.autoInstallUpdates ? 'on' : 'off'}`);
  console.log('Use `sdoc auto-update on` or `sdoc auto-update off` to change.');
}

module.exports = {
  ask,
  askAutoInstallConsent,
  askAutoRefreshConsent,
  runSetup,
  runRefresh,
  runAutoUpdateSubcommand,
  maybeAutoRefresh,
};
