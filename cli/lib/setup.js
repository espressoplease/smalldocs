// `sdoc setup`, `sdoc refresh`, `sdoc auto-update`, and the implicit
// post-command refresh that keeps the SmallDocs skill current as new sdoc
// versions ship.
//
// runSetup: first-run interactive flow. Detects installed agents, installs
//   the skill (canonical copy + symlinks), strips legacy blocks. Pass
//   dryRun:true to preview without touching anything.
// runRefresh: unconditional refresh of the canonical skill + symlinks.
// runAutoUpdateSubcommand: flips state.autoInstallUpdates.
// maybeAutoRefresh: called after every successful command. Quiet, only
//   rewrites the canonical skill when its version is stale.

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const readline = require('readline');

const {
  SKILL_VERSION,
  SKILL_BODY,
  SKILL_NAME,
  formatSkill,
  canonicalSkillFile,
  canonicalSkillDir,
  legacyBlockTargets,
  findBookendedBlock,
  findLegacyBlock,
  compareVersions,
  readSetupState,
  writeSetupState,
  implicitConsentState,
} = require('./agent-block');

const { upgradeCommand, checkoutRoot } = require('./update-check');

const {
  detectSkillAgents,
  hasSetupEvidence,
  syncAgentSkill,
  syncChanged,
  toImplicitResults,
  printSyncSummary,
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
  console.log('This runs `' + upgradeCommand() + '` on your behalf when a new');
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
  console.log('\nKeep this skill updated on future sdoc upgrades?');
  console.log('');
  console.log('When sdoc adds a feature we sometimes update the skill so your');
  console.log('agent learns about it. Each change prints a notice with a link to');
  console.log(`${AGENT_CHANGES_URL} showing the exact delta - the new wording, and why.`);
  console.log('');
  console.log('Re-run `sdoc setup` any time to change this.\n');
  const a = await ask('Enable? [Y/n] ');
  return !a || a === 'y' || a === 'yes';
}

// Preview what setup would do: print the skill, the symlinks it would create,
// the agents covered by the canonical copy, and any legacy blocks it would
// strip. Touches no file and writes no state.
function dryRunPreview() {
  const home = os.homedir();
  const env = process.env;
  const skillPath = canonicalSkillFile(home);
  console.log(`--- ${skillPath} ---`);
  console.log(formatSkill(SKILL_VERSION));

  const detected = detectSkillAgents(home, env);
  const linked = detected.filter(a => !a.universal);
  const universal = detected.filter(a => a.universal);

  if (universal.length) {
    console.log('\nCovered by the canonical copy (~/.agents/skills, no symlink needed):');
    for (const a of universal) console.log(`  ${a.displayName}`);
  }
  if (linked.length) {
    console.log('\nSymlinks to create (<agent skills dir> -> canonical):');
    for (const a of linked) console.log(`  ${path.join(a.dir, SKILL_NAME)} -> ${canonicalSkillDir(home)}`);
  }
  if (detected.length === 0) {
    console.log('\nNo coding-agent configs detected. The canonical skill is still written');
    console.log('so any agent that discovers ~/.agents/skills picks it up.');
  }

  const wouldStrip = [];
  for (const t of legacyBlockTargets(home, env)) {
    let content;
    try { content = fs.readFileSync(t.file, 'utf-8'); } catch (_) { continue; }
    if (findBookendedBlock(content) || findLegacyBlock(content)) wouldStrip.push(t.file);
  }
  if (wouldStrip.length) {
    console.log('\nLegacy SmallDocs blocks to remove:');
    for (const f of wouldStrip) console.log(`  ${f}`);
  }
}

async function runSetup({ force = false, yes = false, dryRun = false } = {}) {
  if (!force) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return;
    if (process.env.CI || process.env.SDOCS_NO_SETUP) return;
    if (readSetupState()) return;
  }

  // ── --yes (non-interactive) path ───────────────────────────
  if (yes) {
    if (dryRun) { dryRunPreview(); return; }

    const result = syncAgentSkill({});
    const changed = syncChanged(result);
    const detected = detectSkillAgents(os.homedir(), process.env);

    if (changed || result.errors.length) {
      printSyncSummary(result);
    }
    if (result.errors.length) return;

    if (!changed) {
      if (detected.length > 0) {
        console.log('SmallDocs skill already at current version. Nothing to do.');
      } else {
        console.log('No coding-agent configs detected. The canonical skill is at');
        console.log('~/.agents/skills/smalldocs/SKILL.md; any agent that discovers');
        console.log('~/.agents/skills will pick it up.');
      }
    }

    writeSetupState({
      setupCompleted: new Date().toISOString(),
      writtenTo: changed ? [canonicalSkillFile(os.homedir())] : [],
      declined: false,
      autoRefreshAgentFiles: true,
      autoInstallUpdates: false,
      lastRunVersion: VERSION,
    });
    return;
  }

  // ── interactive path ───────────────────────────────────────
  const home = os.homedir();
  const detected = detectSkillAgents(home, process.env);

  console.log('\n\u2728─────── SmallDocs setup ───────\u2728');
  console.log('Install the SmallDocs skill so your coding agents know `sdoc`.\n');

  if (detected.length > 0) {
    console.log('Detected: ' + detected.map(a => a.displayName).join(', '));
    console.log('\nWill write the skill to ~/.agents/skills/smalldocs/SKILL.md.');
    console.log('Agents using that universal location read it directly; other');
    console.log('detected agents receive a symlink in their skills directory.');
  } else {
    console.log('No coding-agent configs detected. Setup still writes the canonical');
    console.log('skill at ~/.agents/skills/smalldocs/SKILL.md, which any agent that');
    console.log('discovers ~/.agents/skills will pick up.');
  }
  console.log('\nYou can ask your agent things like:');
  console.log('  "write up the plan and sdoc it to me"');
  console.log('  "explain async/await to me in a sdoc"');
  console.log('  "draft the release notes as a sdoc I can share"');

  const RULE = '\u2550'.repeat(36);
  console.log(`\n${RULE} Skill body ${RULE}`);
  console.log(SKILL_BODY.trim());
  console.log(RULE);

  const a = await ask('\nInstall? [Y/n/skip] ');
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

  const result = syncAgentSkill({});
  const changed = syncChanged(result);
  if (changed || result.errors.length) printSyncSummary(result);
  if (result.errors.length) return;

  const autoRefresh = await askAutoRefreshConsent();
  // A checkout is upgraded with git, so maybeUpdateBinary() will never act on
  // this answer. Do not ask for consent that cannot be honoured.
  const autoInstall = checkoutRoot() ? false : await askAutoInstallConsent();

  writeSetupState({
    setupCompleted: new Date().toISOString(),
    writtenTo: changed ? [canonicalSkillFile(home)] : [],
    declined: false,
    autoRefreshAgentFiles: autoRefresh,
    autoInstallUpdates: autoInstall,
    lastRunVersion: VERSION,
  });
  console.log('\nDone. Run `sdoc setup` any time to revisit.');
}

// Auto-refresh when the binary version is newer than the version that last
// ran. No prompt: the user already consented during setup. Rewrites only the
// canonical skill (every symlink follows); re-checks symlinks and re-strips
// any block that reappeared. Bails on downgrades or errors.
async function maybeAutoRefresh() {
  if (process.env.SDOCS_NO_REFRESH) return;
  let state = readSetupState();

  // Implicit-consent migration for users who have evidence of a prior setup
  // (a skill file on disk, or a recognised always-on block in one of the
  // historical config files) but no ~/.sdocs/setup.json. A brand-new user has
  // no evidence and is left for the interactive first-run prompt instead, so
  // nothing is auto-installed without consent.
  if (!state) {
    if (!hasSetupEvidence(os.homedir(), process.env)) return;
    const result = syncAgentSkill({});
    if (result.errors.length) { printSyncSummary(result); return; }
    if (!syncChanged(result)) return;
    const next = implicitConsentState(toImplicitResults(result), VERSION);
    if (!next) return;
    printSyncSummary(result);
    writeSetupState(next);
    return;
  }

  if (!state.autoRefreshAgentFiles) return;
  if (compareVersions(VERSION, state.lastRunVersion) <= 0) return;

  const result = syncAgentSkill({});
  if (syncChanged(result) || result.errors.length) printSyncSummary(result);

  if (!result.errors.length) {
    writeSetupState({ ...state, lastRunVersion: VERSION });
  }
}

// `sdoc refresh` - unconditional skill refresh. Useful when setup.json was
// never written or has been deleted, or to force the migration explicitly.
async function runRefresh() {
  const existing = readSetupState();
  const result = syncAgentSkill({});
  printSyncSummary(result);

  if (!syncChanged(result) && !result.errors.length) {
    console.log(`SmallDocs skill already at v${SKILL_VERSION}.`);
  }
  if (result.errors.length) return;

  writeSetupState({
    setupCompleted: existing && existing.setupCompleted || new Date().toISOString(),
    writtenTo: [canonicalSkillFile(os.homedir())],
    declined: false,
    autoRefreshAgentFiles: existing ? existing.autoRefreshAgentFiles !== false : true,
    autoInstallUpdates: existing && existing.autoInstallUpdates != null ? existing.autoInstallUpdates : false,
    lastRunVersion: VERSION,
  });
}

// `sdoc auto-update on|off|status` - flips state.autoInstallUpdates.
function runAutoUpdateSubcommand(arg) {
  let state = readSetupState();
  if (!state) {
    console.log('Run `sdoc setup` first to configure auto-update.');
    return;
  }
  if (arg === 'on') {
    const checkout = checkoutRoot();
    if (checkout) {
      console.log(`sdoc is running from a checkout at ${checkout}, which is`);
      console.log('upgraded with git. Auto-install stays off while that is the case.');
      return;
    }
    writeSetupState({ ...state, autoInstallUpdates: true });
    console.log('\u2713 Auto-install of sdoc updates: on');
    return;
  }
  if (arg === 'off') {
    writeSetupState({ ...state, autoInstallUpdates: false });
    console.log('\u2713 Auto-install of sdoc updates: off');
    return;
  }
  console.log(`Auto-install of sdoc updates: ${state.autoInstallUpdates ? 'on' : 'off'}`);
  console.log('Use `sdoc auto-update on` or `sdoc auto-update off` to change.');
}

module.exports = {
  ask,
  askAutoInstallConsent,
  askAutoRefreshConsent,
  dryRunPreview,
  runSetup,
  runRefresh,
  runAutoUpdateSubcommand,
  maybeAutoRefresh,
};
