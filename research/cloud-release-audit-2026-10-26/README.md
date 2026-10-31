# Cloud flow audit

`audit.md` is the report, including current repair status. `evidence.json`
records the original baseline observations. `resolutions.json` records the
local repair checks.

The five `probe-*.js` files are historical baseline reproducers for `19da4852`.
They intentionally expect the old behavior. The binding and refresh probes
synchronize at boundaries that are now serialized and can wait indefinitely
against the repaired branch. Use `node test/run.js` and the focused Playwright
suites listed in the report to verify the repaired branch.

No application deployment or npm publication was performed.
