#!/usr/bin/env node
// One-line hint after `npm i -g sdocs-dev`. Non-interactive by design.
//
// Skipped on:
//   - CI=true (automated builds)
//   - NO_UPDATE_NOTIFIER=1 (user opt-out)
//   - npm installing as a dependency (not a global install)
//
// NOT gated on isTTY: when an agent installs sdoc on a user's behalf, the
// agent reads stdout, so the hint reaches the user via the agent's summary.

if (process.env.CI) process.exit(0);
if (process.env.NO_UPDATE_NOTIFIER) process.exit(0);

// `npm_config_global` is set when this is a global install (`npm i -g`).
// For local installs (as a dependency), stay silent.
if (process.env.npm_config_global !== 'true') process.exit(0);

console.log(`
sdocs-dev installed. Run \`sdoc\` to wire SDocs into your CLI coding agents.

This allows you to use SDocs in conversation with a CLI coding agent.
Try asking:
  "write up the plan and sdoc it to me"
  "explain async/await to me in a sdoc"
  "draft the release notes as a sdoc I can share"
`);
