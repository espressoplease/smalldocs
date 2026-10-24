# Cloud read isolation audit, 22 October 2026

Older read helpers now validate access and the captured document scope after asynchronous decryption, including results accumulated before a later record was decrypted. API handlers also validate the returned source scope before serializing a response.

## Scope

- Current and deleted document lists, including legacy literal search.
- Current document reads and explicitly requested historical revisions.
- Workspace and project lists, deleted workspaces, invitation lists and invitation details.
- Account selection, including names and default projects exposed in selection guidance.
- Workspace exports, including retained revisions and the existing owner-only export role.
- Queued document notification titles and notes.
- Internal billing notification context, preserving existing eligibility for an unchanged soft-deleted library.

Document access requires an active library membership, an active project, and the existing document permission rules. Library owners and administrators do not gain access to another creator's private documents through these changes.

## Publication checks

Document snapshots bind the document ID, library, project, current revision, and deletion state. Deleted lists additionally check the restore deadline. The final validation removes revoked, deleted, moved, restored or superseded records. Name checks compare the encrypted name and nonce that produced the displayed name. The snapshots retained for document lists contain identifiers and state only, not document ciphertext or Markdown.

A current read that changes scope or head while loading returns `resource_unavailable`; the caller can read again. An explicit historical read may succeed after a newer head is saved, provided the requested revision still exists in the same scope and remains accessible.

Composite responses repeat the checks after their final awaited operation. Account responses recompute role, default project and billing. Document routes validate the returned library and project against their original source context, rather than using a moved document's new location to authorize an old payload. Lists apply final filtering before pagination. Exports recheck ownership, billing access, each current document and retained revision before serialization.

These checks govern publication at the final authorization check. They cannot withdraw content already downloaded or an email already dispatched.

## Verification

- Full Node suite: 1,796 passed.
- New isolation suite: 51 passed. This includes 36 store scenarios using two real SQLite connections and 15 executions of the production API handlers in a VM with transport and authentication stubs.
- Existing live HTTP search and update suites: 47 passed during the audit, also covered by the full suite.
- Local HTTPS browser and CLI acceptance suite: four passed; the optional live Stripe portal case was skipped.
- Staging installation suite: 12 temporary-home scenarios, included in the full suite. It covers origin binding, manual updates, skill refresh, redirect handling and reinstall preservation.

The race cases cover revocation during a record's own decrypt and while a later record is loading; project or library deletion; library moves; head changes; deleted-document restoration and expiry; invitation revocation; historical revision pruning; owner demotion; billing changes; notification-note decryption; and account selection guidance. Positive cases preserve valid current reads, historical reads, lists, deleted documents and exports.

```sh
NODE_PATH=/Users/mac/code/smalldocs/node_modules node test/run.js
NODE_PATH=/Users/mac/code/smalldocs/node_modules \
  node /Users/mac/code/smalldocs/node_modules/@playwright/test/cli.js \
  test --config playwright.cloud.config.js
```

The installed staging CLI was also checked from a new shell without origin environment variables. Plain `sdoc FILE.md` requires a Cloud login, production URL overrides fail, the Cloud skill points to staging, and `sdoc upgrade` prints manual reinstall instructions without contacting npm or a hosted installer. See [Staging CLI installation](staging-cli.md).
