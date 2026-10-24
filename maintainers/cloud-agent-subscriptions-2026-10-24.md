# Cloud trials and agent account management

Date: 24 October 2026. Branch: codex/homepage-next-review. Target: Cloud staging only.

## Implemented behaviour

- One calendar month free, followed by seven days with normal Cloud access and structured warnings. The payment wall starts at the original trial deadline plus seven days; visiting again or creating a library does not move it.
- Successful CLI receipts carry subscription state, notices, the exact cutoff, payment and feedback links. A normal Cloud document open launches Subscribe after the cutoff. Headless commands return the link and a nonzero exit code.
- Cloud document reads, writes, search, tags, revisions and exports require trial access or paid coverage. Library and document pages redirect to Subscribe. Settings, billing, feedback and member removal remain available.
- Agents can inspect billing, open exact settings panels, create/list/revoke invitations, remove members and submit the human's trial feedback. Existing role, last-owner, email, rate and document-permission checks remain in force. Humans complete Stripe Checkout and customer portal actions in the browser.
- Paid coverage removes the trial wall immediately, without replacing the CLI credential. One paid person is covered across their libraries.
- New accounts see one Library entry using the existing library icon. Existing accounts retain their local and Cloud navigation through a persisted preference. Settings > Preferences can change it.
- Unpaid documents are retained until a deletion policy is decided. There is no advertised deletion date. Previously queued workspace billing deletion jobs and their old notices are skipped in the single-plan model. Explicit deletion remains separate.
- Trial feedback is stored as product feedback for the SmallDocs team, separate from encrypted document content. The optional rating must come from the human. Current feedback replaces that person's earlier submission.

## Validation

The full Node suite passes 1,850 tests, including real-server and real-CLI integration, setup migrations, exact trial boundaries, paid coverage, warning-week invitation acceptance, billing recovery, user preference isolation, final-owner protection and retained content after an old deletion job runs.

The browser checks cover 61 scenarios across account management, library pagination, people filters, stars and the one-plan flow. One fixture shutdown timed out after its page assertions passed; the isolated retry and the final 17-scenario management suite passed. Desktop and 390px mobile feedback/payment pages were inspected. Headless checks use isolated data and capture mail; no real invitation was sent.

Skill v40 and CLI 1.20.0-rc.10 are installed in the local staging runtime and experiment folder. Skill validation passes. Refresh preserves credentials, bindings and the computer's library default. Public skill history includes both exact edition bodies.

## Release checks

Before staging deployment, preserve a coordinated state backup. Verify the deployed commit, authenticated billing state, cutoff and recovery responses, subscription links, old-user preference migration and service health. Confirm production release and configuration hashes are unchanged. A real card payment is not part of automated verification; existing Checkout and webhook tests use a local Stripe fixture.
