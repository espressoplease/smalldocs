# Renderer parity runner

The parity runner checks a feature across three isolated surfaces:

1. A known-good production revision extracted from Git into a temporary directory.
2. The production reader in the current working tree.
3. A clean customer page that imports the current versioned SDK.

This separates two questions. The first comparison catches production regressions. The second shows which parts of the SDK still differ from the current product.

## Run it

```sh
npm run parity -- slides
```

The default reference is `origin/main`. Choose another known-good revision when needed:

```sh
npm run parity -- slides --baseline v1.6.2
```

Use a deployed environment as the reference for a release check:

```sh
npm run parity -- slides --baseline-url https://smalldocs.org
```

The Git baseline is deterministic and is the normal development loop. The deployed baseline checks what users currently receive, but it also depends on the network and the state of that deployment.

The command writes `report.json`, a readable `index.html`, screenshots, and pixel diffs under `test-results/parity/`. It exits with status 1 when either comparison finds drift. A failed parity run that produces a report is useful evidence, not a runner failure.

## Add a feature suite

Add `test/parity/suites/<feature>.js`. A suite supplies:

- one representative Markdown fixture;
- the viewport;
- selectors for the production and SDK surfaces;
- a sequence of named states and actions;
- explicit behavior contracts for each state.

Actions are cumulative. A suite can capture an inline component, open its full-screen surface, move through interaction states, and open secondary panels without writing a separate Playwright test for every screenshot.

Keep contracts about observable behavior: control labels and order, active state, navigation, downloads, focus surfaces, and cleanup. The runner separately captures semantic DOM, selected computed styles, console and network failures, and screenshots.

## Reading the report

The report has two sections:

- `Frozen production to current production` should stay green. A failure means the current branch changed established production behavior.
- `Current production to clean customer SDK` is the extraction ledger. Red states identify remaining parallel implementations or missing behavior.

Do not mark a feature complete because its inline state passes. Every advertised state in its suite must pass against the production component.
