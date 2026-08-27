#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  loadSuite,
  parseProfile,
  expandRuns,
  runDecision,
  summarise
} = require('../evals/smalldocs-skill/harness');

function usage() {
  return `SmallDocs skill evaluation

Usage:
  node scripts/smalldocs-skill-eval.js --list
  node scripts/smalldocs-skill-eval.js --dry-run [filters]
  node scripts/smalldocs-skill-eval.js --run [filters] --allow-auth-copy

Filters:
  --scenarios ID,ID       Run selected scenario ids
  --editions LIST         none,standard,cloud
  --models LIST           model:effort pairs

Execution:
  --run                    Run read-only Codex decision evaluations
  --allow-auth-copy        Copy only ~/.codex/auth.json into each temporary CODEX_HOME
  --auth-source FILE       Use a different Codex auth file
  --judge MODEL:EFFORT     Add a blinded LLM judge pass
  --output DIR             Store JSON artifacts here
  --keep-fixtures          Keep temporary homes for inspection
  --timeout-ms N           Per-agent timeout, default 600000

Examples:
  node scripts/smalldocs-skill-eval.js --dry-run --models gpt-5.6-luna:low,gpt-5.6-terra:medium,gpt-5.6-sol:high
  node scripts/smalldocs-skill-eval.js --run --allow-auth-copy --scenarios casual-sdoc-this,cloud-local-viewing --editions standard,cloud --models gpt-5.6-luna:low,gpt-5.6-sol:high
`;
}

function parseArgs(argv) {
  const out = { scenarioIds: [], editions: [], profiles: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--run') out.run = true;
    else if (arg === '--allow-auth-copy') out.allowAuthCopy = true;
    else if (arg === '--keep-fixtures') out.keep = true;
    else if (arg === '--scenarios') out.scenarioIds = String(argv[++i] || '').split(',').filter(Boolean);
    else if (arg === '--editions') out.editions = String(argv[++i] || '').split(',').filter(Boolean);
    else if (arg === '--models') out.profiles = String(argv[++i] || '').split(',').filter(Boolean).map(parseProfile);
    else if (arg === '--judge') out.judgeProfile = parseProfile(argv[++i]);
    else if (arg === '--auth-source') out.authSource = path.resolve(argv[++i]);
    else if (arg === '--output') out.output = path.resolve(argv[++i]);
    else if (arg === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'evals', 'smalldocs-skill', 'runs', stamp);
}

function printRuns(runs) {
  const byKind = {};
  for (const run of runs) byKind[run.scenario.kind] = (byKind[run.scenario.kind] || 0) + 1;
  console.log(`Planned runs: ${runs.length}`);
  console.log(`By kind: ${JSON.stringify(byKind)}`);
  const profiles = [...new Set(runs.map(run => `${run.profile.model}:${run.profile.effort}`))];
  console.log(`Profiles: ${profiles.join(', ')}`);
  for (const run of runs) {
    console.log(`${run.scenario.id}\t${run.scenario.kind}\t${run.edition}\t${run.profile.model}:${run.profile.effort}`);
  }
}

function safeName(run, index) {
  const model = run.profile.model.replace(/[^a-z0-9_.-]/gi, '_');
  return `${String(index + 1).padStart(3, '0')}-${run.scenario.id}-${run.edition}-${model}-${run.profile.effort}.json`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.list && !args.dryRun && !args.run)) {
    console.log(usage());
    return;
  }
  const suite = loadSuite();
  if (args.list) {
    for (const scenario of suite.scenarios) {
      console.log(`${scenario.id}\t${scenario.kind}\t${scenario.editions.join(',')}`);
    }
    return;
  }
  const runs = expandRuns(suite, args);
  if (args.dryRun) {
    printRuns(runs);
    return;
  }
  if (!args.allowAuthCopy) {
    throw new Error('--run requires --allow-auth-copy. The harness will copy only auth.json into disposable CODEX_HOME directories and delete them after each run.');
  }
  const authSource = args.authSource || path.join(process.env.HOME || '', '.codex', 'auth.json');
  if (!fs.existsSync(authSource)) throw new Error(`Codex auth file not found: ${authSource}`);
  const outputDir = args.output || defaultOutputDir();
  fs.mkdirSync(outputDir, { recursive: true });
  printRuns(runs);
  console.log(`Artifacts: ${outputDir}`);
  const results = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    process.stdout.write(`[${i + 1}/${runs.length}] ${run.scenario.id} ${run.edition} ${run.profile.model}:${run.profile.effort} ... `);
    let result;
    try {
      result = await runDecision({
        ...run,
        authSource,
        judgeProfile: args.judgeProfile,
        keep: args.keep,
        timeoutMs: args.timeoutMs || 600000
      });
      console.log(result.judge ? (result.judge.pass ? 'judge pass' : 'judge fail') : (result.deterministic.pass ? 'command pass' : 'needs review'));
    } catch (error) {
      result = {
        scenario_id: run.scenario.id,
        edition: run.edition,
        model: run.profile.model,
        effort: run.profile.effort,
        error: error.stack || error.message
      };
      console.log('error');
    }
    results.push(result);
    fs.writeFileSync(path.join(outputDir, safeName(run, i)), `${JSON.stringify(result, null, 2)}\n`);
  }
  const summary = summarise(results);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (results.some(result => result.error || result.candidate_exit_code !== 0)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
